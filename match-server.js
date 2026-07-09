/**
 * match-server.js — 매칭스코프 서버
 * 광고주가 웹 폼(매칭스코프.html)에서 광고 소재를 등록하면:
 *   등록 → 전체 후보군 일괄 스코어링(분포/등급컷 저장) → 상위 1~10위 크리에이터 랭킹 반환.
 *
 * 채널스코프 서버(server.js, 3456)와 완전히 분리된 별도 프로세스(기본 포트 3457) —
 * pool.json은 시작 시 메모리에 읽기 전용 캐시로 올려두고, 어디에도 쓰지 않는다.
 * 광고 데이터(data/ads.json, data/ad-scores/)만 이 서버(ad-store.js)가 소유한다.
 *
 * 실행: node match-server.js   (또는 "매칭스코프 실행.command" 더블클릭)
 *
 * API:
 *   GET    /api/ads                 등록된 광고 목록(스코어 요약 포함)
 *   POST   /api/ads                 광고 등록 + 즉시 스코어링 → 상위 10위 랭킹 반환
 *   GET    /api/ads/{adId}/ranking  저장된 랭킹 조회
 *   GET    /api/ads/{adId}/report   공유용 단독 HTML(?download=1 이면 다운로드)
 *   DELETE /api/ads/{adId}          광고 + 분포 삭제
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadPools } = require('./matching-engine');
const { loadAds, loadAdScores, scoreAd, percentileOf, createAd, deleteAd } = require('./ad-store');
const { buildShareForAd } = require('./match-share');

const PORT = process.env.MATCH_PORT || 3457;
const PAGE_PATH = path.join(__dirname, '매칭스코프.html');
const RANK_LIMIT = 10;

// 풀 메모리 캐시(읽기 전용) — 시작 시 1회 로드, 갱신은 서버 재시작 또는 /api/reload
let POOLS = [];
function reloadPools() {
  const started = Date.now();
  POOLS = loadPools(); // 전 플랫폼
  const total = POOLS.reduce((s, p) => s + p.items.length, 0);
  console.log(`[매칭스코프] 풀 로드: ${POOLS.map((p) => `${p.platform} ${p.items.length.toLocaleString()}`).join(', ')} (총 ${total.toLocaleString()}, ${Date.now() - started}ms)`);
}

/** 저장된 스코어 레코드 → 상위 1~10위 랭킹(백분위/유튜브 링크 포함) */
function rankingOf(record) {
  return (record.topCandidates || []).slice(0, RANK_LIMIT).map((c, i) => ({
    rank: i + 1,
    ...c,
    percentile: percentileOf(c.score, record),
    channelUrl: c.platform === 'youtube' ? `https://www.youtube.com/channel/${c.id}` : null,
  }));
}

function metaOf(record) {
  return {
    adId: record.adId,
    demo: record.demo || false,
    scoredAt: record.scoredAt,
    tookMs: record.tookMs,
    candidateCount: record.candidateCount,
    weights: record.weights,
    references: record.references,
    gradeCuts: record.gradeCuts,
    stats: record.stats,
  };
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(PAGE_PATH));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/ads') {
      const { ads } = loadAds();
      const list = ads.map((ad) => {
        const rec = loadAdScores(ad.adId);
        return { ...ad, scored: !!rec, candidateCount: rec?.candidateCount ?? null, scoredAt: rec?.scoredAt ?? null };
      });
      sendJson(res, 200, { ads: list.reverse() }); // 최신 광고 먼저
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ads') {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.adName || !String(body.adName).trim()) { sendJson(res, 400, { error: '광고명은 필수입니다' }); return; }
      const ad = createAd(body);
      console.log(`[매칭스코프] 광고 등록: ${ad.adId} "${ad.adName}" — 스코어링 시작`);
      const record = scoreAd(ad, POOLS);
      console.log(`[매칭스코프] 스코어링 완료: 후보 ${record.candidateCount.toLocaleString()}명, ${record.tookMs}ms`);
      sendJson(res, 200, { ad, ranking: rankingOf(record), meta: metaOf(record) });
      return;
    }

    const rankMatch = url.pathname.match(/^\/api\/ads\/([\w-]+)\/ranking$/);
    if (req.method === 'GET' && rankMatch) {
      const record = loadAdScores(rankMatch[1]);
      if (!record) { sendJson(res, 404, { error: '스코어 기록 없음' }); return; }
      const { ads } = loadAds();
      sendJson(res, 200, { ad: ads.find((a) => a.adId === rankMatch[1]) || null, ranking: rankingOf(record), meta: metaOf(record) });
      return;
    }

    // 공유용 단독 HTML(모든 데이터 내장, 서버 없이 열림). ?download=1 이면 파일로 다운로드
    const reportMatch = url.pathname.match(/^\/api\/ads\/([\w-]+)\/report$/);
    if (req.method === 'GET' && reportMatch) {
      try {
        const { html, ad } = buildShareForAd(reportMatch[1]);
        const headers = { 'Content-Type': 'text/html; charset=utf-8' };
        if (url.searchParams.get('download')) {
          const safeName = String(ad.adName).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
          headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(`매칭리포트_${safeName}.html`)}`;
        }
        res.writeHead(200, headers);
        res.end(html);
      } catch (err) {
        sendJson(res, 404, { error: err.message });
      }
      return;
    }

    const delMatch = url.pathname.match(/^\/api\/ads\/([\w-]+)$/);
    if (req.method === 'DELETE' && delMatch) {
      sendJson(res, deleteAd(delMatch[1]) ? 200 : 404, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reload') {
      reloadPools();
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[매칭스코프] 오류:', err.message);
    sendJson(res, 500, { error: err.message });
  }
});

reloadPools();
server.listen(PORT, () => {
  console.log(`[매칭스코프] http://localhost:${PORT} 에서 실행 중 (채널스코프와 별도 프로세스)`);
});
