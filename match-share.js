/**
 * match-share.js
 * 광고 1건의 매칭 랭킹(상위 1~10위)을 "서버 없이 열리는 공유용 단독 HTML"로 내보낸다.
 * 저장된 스코어 분포(data/ad-scores/{adId}.json)를 읽어 모든 데이터를 HTML 안에 박아 넣으므로
 * 파일 하나만 카카오톡/메일로 보내면 어디서든 열린다. (채널스코프.html standalone 패턴)
 *
 * 사용:
 *   node match-share.js <adId>            → 매칭리포트/공유_{광고명}.html 생성
 *   match-server.js: GET /api/ads/{adId}/report 에서도 같은 HTML 반환
 */
const fs = require('fs');
const path = require('path');
const { loadAds, loadAdScores, percentileOf } = require('./ad-store');

const REPORT_DIR = path.join(__dirname, '매칭리포트');
const RANK_LIMIT = 10;
const GRADE_COLORS = { S: '#7c3aed', A: '#2563eb', B: '#059669', C: '#6b7280', D: '#9ca3af' };
const PLATFORM_LABELS = { youtube: '유튜브', tiktok: '틱톡', instagram: '인스타그램', facebook: '메타' };

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rankCard(c) {
  const b = c.breakdown;
  const g = c.percentile.grade;
  const badges = [];
  if (b.derived.sponsoredExperience) badges.push('협찬경험');
  if (b.derived.contactEmail) badges.push('연락 가능');
  for (const r of b.qualityReasons || []) if (r.startsWith('강점:') || r.startsWith('약점:')) badges.push(r);
  const channelUrl = c.platform === 'youtube' ? `https://www.youtube.com/channel/${c.id}` : null;
  return `
  <div class="rank-card">
    <div class="rank-num ${c.rank <= 3 ? 'top3' : ''}">${c.rank}</div>
    <div class="rank-body">
      <div class="rank-head">
        ${channelUrl ? `<a href="${esc(channelUrl)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : `<span class="nm">${esc(c.name)}</span>`}
        <span class="info">${esc(c.category)} · ${esc(c.tier)} · ${c.metric != null ? c.metric.toLocaleString() + '명' : '-'} · ${PLATFORM_LABELS[c.platform] || esc(c.platform)}</span>
      </div>
      <div class="scoreline">
        <span class="score-big">${c.score}</span>
        <span class="grade" style="background:${GRADE_COLORS[g] || '#6b7280'}">${g}</span>
        <span class="pct">상위 ${c.percentile.topPct}%</span>
      </div>
      <div class="axes">
        <span>키워드 <b>${b.keywordScore}</b></span>
        <span>형식 <b>${b.formatScore}</b></span>
        ${b.referenceScore != null ? `<span>레퍼런스 <b>${b.referenceScore}</b></span>` : ''}
        <span>CIV <b>${b.civ && b.civ.available ? `${b.civ.score} (${b.civ.grade})` : '분석 준비 중'}</b> → ×${b.qualityMultiplier}</span>
      </div>
      ${b.matchedKeywords.length ? `<div class="chips">${b.matchedKeywords.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div>` : ''}
      ${b.creatorFormatTags.length ? `<div class="chips">${b.creatorFormatTags.map((f) => `<span class="chip fmt">${esc(f)}</span>`).join('')}</div>` : ''}
      ${badges.length ? `<div class="chips">${badges.map((x) => `<span class="chip badge">${esc(x)}</span>`).join('')}</div>` : ''}
      ${b.referenceReasons.length ? `<div class="refwhy">레퍼런스 근거: ${b.referenceReasons.map(esc).join(' · ')}</div>` : ''}
      ${b.derived.contactEmail ? `<div class="email">문의: ${esc(b.derived.contactEmail)}</div>` : ''}
    </div>
  </div>`;
}

/** 광고 + 저장된 스코어 레코드 → 공유용 단독 HTML 문자열 */
function buildShareHtml(ad, record) {
  const ranking = (record.topCandidates || []).slice(0, RANK_LIMIT).map((c, i) => ({
    rank: i + 1,
    ...c,
    percentile: percentileOf(c.score, record),
  }));
  const w = record.weights;
  const refs = record.references || { resolved: [], unresolved: [] };
  const refLine = refs.resolved.length
    ? `레퍼런스: ${refs.resolved.map((r) => esc(r.name)).join(', ')}`
    : (ad.references || []).length ? `레퍼런스: ${ad.references.map(esc).join(', ')} (풀에서 미인식)` : '레퍼런스 없음';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>매칭 리포트 — ${esc(ad.adName)}</title>
<style>
  :root{--ink:#111827;--sub:#6b7280;--line:#e5e7eb;--accent:#4f46e5;--accent-soft:#eef2ff}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#f4f5f7;color:var(--ink)}
  .wrap{max-width:760px;margin:0 auto;padding:24px 16px}
  .head{background:#1e1b4b;color:#fff;border-radius:16px;padding:22px 24px;margin-bottom:16px}
  .head h1{margin:0 0 4px;font-size:20px}
  .head .sub{font-size:12px;opacity:.75}
  .adinfo{background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
  .adinfo h2{margin:0 0 10px;font-size:15px}
  .adinfo .row{font-size:13px;color:#374151;margin:4px 0}
  .adinfo .row b{color:var(--ink)}
  .meta{font-size:12px;color:var(--sub);line-height:1.8;border-top:1px solid var(--line);margin-top:12px;padding-top:10px}
  .rank-card{display:flex;gap:14px;background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
  .rank-num{font-size:22px;font-weight:800;color:var(--accent);width:36px;text-align:center;flex-shrink:0}
  .rank-num.top3{color:#d97706}
  .rank-body{flex:1;min-width:0}
  .rank-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
  .rank-head a,.rank-head .nm{color:var(--ink);font-weight:700;font-size:15px;text-decoration:none}
  .rank-head a:hover{text-decoration:underline}
  .rank-head .info{font-size:12px;color:var(--sub)}
  .scoreline{display:flex;align-items:center;gap:10px;margin:6px 0}
  .score-big{font-size:19px;font-weight:800}
  .grade{font-size:12px;font-weight:800;color:#fff;border-radius:6px;padding:2px 8px}
  .pct{font-size:12px;color:var(--sub)}
  .axes{display:flex;gap:12px;font-size:11px;color:var(--sub);flex-wrap:wrap;margin-bottom:6px}
  .axes b{color:var(--ink)}
  .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
  .chip{background:var(--accent-soft);color:#3730a3;border-radius:999px;padding:2px 8px;font-size:11px}
  .chip.badge{background:#ecfdf5;color:#065f46}
  .chip.fmt{background:#fef3c7;color:#92400e}
  .refwhy{font-size:11px;color:var(--sub);margin-top:4px}
  .email{font-size:11px;color:#059669;margin-top:4px}
  .foot{font-size:11px;color:#9ca3af;text-align:center;padding:16px 0}
  @media print{body{background:#fff}.rank-card,.adinfo{box-shadow:none;border:1px solid var(--line)}}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <h1>크리에이터 매칭 리포트 TOP ${ranking.length}</h1>
    <div class="sub">매칭스코프 · 매칭엔진 v0.4 (적합도 × YOUCHI CIV) · 이 파일은 단독으로 열립니다</div>
  </div>
  <div class="adinfo">
    ${record.demo ? '<div style="background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;margin-bottom:10px">🧪 데모 모드 리포트 — 가상 샘플 채널 기반이며 실존 채널이 아닙니다</div>' : ''}
    <h2>📣 ${esc(ad.adName)}</h2>
    ${ad.concept ? `<div class="row"><b>컨셉</b> — ${esc(ad.concept)}</div>` : ''}
    ${ad.keywords ? `<div class="row"><b>키워드</b> — ${esc(ad.keywords)}</div>` : ''}
    ${ad.videoFormat ? `<div class="row"><b>영상제작방식</b> — ${esc(ad.videoFormat)}</div>` : ''}
    <div class="row"><b>플랫폼</b> — ${(ad.platforms || []).map((p) => PLATFORM_LABELS[p] || p).join(', ')}</div>
    <div class="row">${refLine}</div>
    <div class="meta">
      후보 <b>${record.candidateCount.toLocaleString()}</b>명 전체 스코어링 · ${esc(record.scoredAt.slice(0, 16).replace('T', ' '))} 기준<br>
      가중치: 키워드 ${Math.round(w.keyword * 100)}% / 형식 ${Math.round(w.format * 100)}%${w.reference ? ` / 레퍼런스 ${Math.round(w.reference * 100)}%` : ''} ·
      등급컷: ${record.gradeCuts.map((g) => `${g.grade} ≥ ${g.minScore}점(상위 ${g.topPct}%)`).join(' · ')}
    </div>
  </div>
  ${ranking.map(rankCard).join('')}
  <div class="foot">본 리포트는 실제 업로드된 영상 데이터 기반으로 산출되었습니다 · CIV = YOUCHI 채널 가치 평가(광고용) · © 매칭스코프</div>
</div>
</body>
</html>`;
}

/** adId로 공유 HTML 생성(CLI/서버 공용). 반환: { html, ad, record } */
function buildShareForAd(adId) {
  const { ads } = loadAds();
  const ad = ads.find((a) => a.adId === adId);
  if (!ad) throw new Error(`광고 ${adId}를 찾을 수 없음`);
  const record = loadAdScores(adId);
  if (!record) throw new Error(`광고 ${adId}의 스코어 기록 없음 — node ad-store.js rescore ${adId} 먼저 실행`);
  return { html: buildShareHtml(ad, record), ad, record };
}

module.exports = { buildShareHtml, buildShareForAd };

if (require.main === module) {
  const adId = process.argv[2];
  if (!adId) { console.log('사용법: node match-share.js <adId>   (adId는 node ad-store.js list 로 확인)'); process.exit(1); }
  const { html, ad } = buildShareForAd(adId);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const safeName = String(ad.adName).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  const outPath = path.join(REPORT_DIR, `공유_${safeName}.html`);
  fs.writeFileSync(outPath, html);
  console.log(`[공유 리포트] 생성: ${outPath}`);
  console.log('  이 파일 하나만 전달하면 서버 없이 어디서든 열립니다.');
}
