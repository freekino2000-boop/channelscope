/**
 * ad-store.js
 * 광고 저장소 + 광고별 일괄 스코어링(설계문서 v0.3 — 0단계 전처리, 4장 아키텍처).
 *
 * - 광고는 data/ads.json에 저장: { adId, adName, concept, keywords, videoFormat, references[], platforms[], createdAt, status }
 * - 광고 등록/재스코어 시 전체 후보군을 일괄 스코어링해서 data/ad-scores/{adId}.json에 저장:
 *   점수 분포(백분위 계산용) + 등급컷(S/A/B/C) + 상위 후보 요약.
 *   → 크리에이터 카드(match-report.js)는 이 분포를 읽어 "상위 X%"를 계산한다.
 * - pool.json은 matching-engine을 통해 읽기 전용으로만 사용. publish.sh 비연결.
 *
 * 사용법:
 *   node ad-store.js add '{"adName":"...","concept":"...","keywords":"...","videoFormat":"리뷰","references":["@handle"],"platforms":["youtube"]}'
 *   node ad-store.js add --file 광고.json
 *   node ad-store.js list
 *   node ad-store.js rescore <adId>     # pool 갱신 후 재스코어링(일 1회 권장)
 */
const fs = require('fs');
const path = require('path');
const { matchCreators, prepareAd } = require('./matching-engine');

const DIR = __dirname;
const ADS_PATH = path.join(DIR, 'data', 'ads.json');
const SCORES_DIR = path.join(DIR, 'data', 'ad-scores');

// 등급컷 백분위(설계문서 8장 예시값 — 추후 조정 가능): S=상위 5%, A=상위 20%, B=상위 50%
const GRADE_CUTS = [
  { grade: 'S', topPct: 5 },
  { grade: 'A', topPct: 20 },
  { grade: 'B', topPct: 50 },
];

function loadAds() {
  try { return JSON.parse(fs.readFileSync(ADS_PATH, 'utf8')); } catch { return { ads: [] }; }
}

function saveAds(store) {
  fs.mkdirSync(path.dirname(ADS_PATH), { recursive: true });
  fs.writeFileSync(ADS_PATH, JSON.stringify(store, null, 2));
}

function newAdId() {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `ad-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 광고 1건 일괄 스코어링 → 분포/등급컷/상위요약을 ad-scores/{adId}.json에 저장.
 *  poolsCache를 주면 디스크 재로드 없이 재사용(match-server.js) */
function scoreAd(ad, poolsCache) {
  const started = Date.now();
  const prepared = prepareAd(ad, poolsCache); // 풀 로드/레퍼런스 리졸브 1회 후 재사용
  const results = matchCreators(ad, { all: true, prepared });

  const scores = results.map((r) => r.score); // 내림차순 정렬 상태
  const count = scores.length;
  const cuts = GRADE_CUTS.map(({ grade, topPct }) => ({
    grade,
    topPct,
    minScore: count ? scores[Math.max(0, Math.ceil((topPct / 100) * count) - 1)] : 0,
  }));

  const record = {
    adId: ad.adId,
    scoredAt: new Date().toISOString(),
    tookMs: Date.now() - started,
    candidateCount: count,
    weights: prepared.weights,
    references: { resolved: prepared.refs.resolved, unresolved: prepared.refs.unresolved },
    gradeCuts: cuts,
    stats: count ? {
      max: scores[0],
      median: scores[Math.floor(count / 2)],
      mean: Math.round((scores.reduce((s, n) => s + n, 0) / count) * 10) / 10,
    } : null,
    // 백분위 계산용 분포(내림차순 전체 점수) — 크리에이터 카드가 이걸 읽는다
    scores,
    // 광고주용 상위 후보 요약(설명가능성 breakdown 포함)
    topCandidates: results.slice(0, 20),
  };

  fs.mkdirSync(SCORES_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCORES_DIR, `${ad.adId}.json`), JSON.stringify(record, null, 2));
  return record;
}

function loadAdScores(adId) {
  try { return JSON.parse(fs.readFileSync(path.join(SCORES_DIR, `${adId}.json`), 'utf8')); } catch { return null; }
}

/** 점수 → 상위 백분위(%)와 등급. distribution은 loadAdScores() 결과 */
function percentileOf(score, record) {
  const { scores } = record;
  if (!scores?.length) return { topPct: null, grade: 'C' };
  const above = scores.filter((s) => s > score).length;
  const topPct = Math.max(0.1, Math.round(((above + 1) / scores.length) * 1000) / 10);
  const cut = record.gradeCuts.find((c) => topPct <= c.topPct);
  return { topPct, grade: cut ? cut.grade : 'C' };
}

/** 광고 생성 + ads.json 저장(스코어링은 별도 — 서버/CLI가 각자 호출) */
function createAd(input) {
  const store = loadAds();
  const ad = {
    adId: newAdId(),
    adName: input.adName || '',
    concept: input.concept || '',
    keywords: input.keywords || '',
    videoFormat: input.videoFormat || '',
    references: (input.references || []).filter(Boolean),
    platforms: input.platforms && input.platforms.length ? input.platforms : ['youtube', 'tiktok', 'instagram', 'facebook'],
    createdAt: new Date().toISOString(),
    status: 'active',
  };
  store.ads.push(ad);
  saveAds(store);
  return ad;
}

function deleteAd(adId) {
  const store = loadAds();
  const before = store.ads.length;
  store.ads = store.ads.filter((a) => a.adId !== adId);
  if (store.ads.length === before) return false;
  saveAds(store);
  try { fs.unlinkSync(path.join(SCORES_DIR, `${adId}.json`)); } catch { /* 분포 파일 없으면 무시 */ }
  return true;
}

function addAd(input) {
  const ad = createAd(input);
  console.log(`[광고등록] ${ad.adId} "${ad.adName}" (플랫폼: ${ad.platforms.join(',')})`);
  const record = scoreAd(ad);
  console.log(`[스코어링] 후보 ${record.candidateCount.toLocaleString()}명, ${record.tookMs}ms`);
  if (record.references.resolved.length) console.log(`[레퍼런스] 리졸브됨: ${record.references.resolved.map((r) => r.name).join(', ')}`);
  if (record.references.unresolved.length) console.log(`[레퍼런스] 풀에 없음: ${record.references.unresolved.join(', ')}`);
  console.log(`[등급컷] ${record.gradeCuts.map((c) => `${c.grade}≥${c.minScore}점(상위${c.topPct}%)`).join(' / ')}`);
  console.log(`[상위 3] ${record.topCandidates.slice(0, 3).map((c) => `${c.name}(${c.score})`).join(', ')}`);
  return ad;
}

module.exports = { loadAds, loadAdScores, scoreAd, percentileOf, createAd, deleteAd, GRADE_CUTS };

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'add') {
    let input;
    if (args[0] === '--file') input = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    else input = JSON.parse(args.join(' '));
    addAd(input);
  } else if (cmd === 'list') {
    const { ads } = loadAds();
    if (!ads.length) { console.log('등록된 광고 없음'); process.exit(0); }
    for (const ad of ads) {
      const rec = loadAdScores(ad.adId);
      console.log(`${ad.adId} | ${ad.status} | "${ad.adName}" | ${ad.platforms.join(',')} | 후보 ${rec ? rec.candidateCount.toLocaleString() : '미채점'} | ${ad.createdAt.slice(0, 10)}`);
    }
  } else if (cmd === 'rescore') {
    const { ads } = loadAds();
    const targets = args[0] ? ads.filter((a) => a.adId === args[0]) : ads.filter((a) => a.status === 'active');
    if (!targets.length) { console.error('대상 광고를 찾을 수 없음'); process.exit(1); }
    for (const ad of targets) {
      const rec = scoreAd(ad);
      console.log(`[재스코어] ${ad.adId} 후보 ${rec.candidateCount.toLocaleString()}명, ${rec.tookMs}ms`);
    }
  } else {
    console.log('사용법: node ad-store.js add <JSON|--file 파일> | list | rescore [adId]');
  }
}
