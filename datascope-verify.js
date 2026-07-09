/**
 * datascope-verify.js — 에이전트2 "데이터스코프"
 * 채널스코프(에이전트1: expand-pool.js/grow-pool.js 등)가 모아 놓은 데이터가
 * 실제 온라인 상태와 같은지 재확인하고, 다르면(노란불=부분오류/빨간불=오류) 즉시 최신 값으로
 * 고치면서 정정 이력을 data/datascope-history.json에 남긴다.
 *
 * 판정: blue(정상) / yellow(부분오류, 자동수정) / red(오류, 자동수정 또는 접근불가 표시)
 *
 * pool.json 등 공용 파일은 grow-pool.js와 동시에 건드릴 수 있으므로 pool-lock.js의
 * withFreshPool()로 항상 "최신 디스크 상태 위에 이번에 검증한 채널만" 병합 저장한다.
 *
 * 실행 예:
 *   node datascope-verify.js                                  # 유튜브, 무한 반복(하루 1회/채널)
 *   PLATFORM=tiktok MAX_ROUNDS=30 node datascope-verify.js     # 틱톡, 30라운드만 돌고 종료
 */
const fs = require('fs');
const path = require('path');
const scraper = require('./scraper');
const tiktok = require('./scraper-tiktok');
const instagram = require('./scraper-instagram');
const facebook = require('./scraper-facebook');
const { withFreshPool } = require('./pool-lock');

const DIR = __dirname;
const PLATFORM = process.env.PLATFORM || 'youtube';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 100);
const CONCURRENCY = Number(process.env.CONCURRENCY || (PLATFORM === 'youtube' ? 5 : 2));
const MIN_VERIFY_GAP_MS = Number(process.env.MIN_VERIFY_GAP_HOURS || 24) * 3600 * 1000;
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS || 0); // 0 = 무한 반복
const HISTORY_PATH = path.join(DIR, 'data', 'datascope-history.json');
const SUMMARY_PATH = path.join(DIR, 'data', 'datascope-summary.json');
const MAX_HISTORY_ENTRIES = 5000;
const UNREACHABLE_STRIKES_TO_FLAG = 3;

const PLATFORMS = {
  youtube: {
    poolPath: path.join(DIR, 'data', 'pool.json'), arrayKey: 'channels', idField: 'id',
    nameField: 'name', metricField: 'subscribers', metricLabel: '구독자수', countryField: 'country', label: '유튜브',
    async fetchLive(items) { return fetchLiveDirect(items, (id) => scraper.getChannelCore(id)); },
  },
  tiktok: {
    poolPath: path.join(DIR, 'data', 'pool-tiktok.json'), arrayKey: 'creators', idField: 'uniqueId',
    nameField: 'nickname', metricField: 'followerCount', metricLabel: '팔로워수', countryField: null, label: '틱톡',
    async fetchLive(items) { return fetchLiveViaBrowser(tiktok, items); },
  },
  instagram: {
    poolPath: path.join(DIR, 'data', 'pool-instagram.json'), arrayKey: 'creators', idField: 'uniqueId',
    nameField: 'nickname', metricField: 'followerCount', metricLabel: '팔로워수', countryField: null, label: '인스타그램',
    async fetchLive(items) { return fetchLiveViaBrowser(instagram, items); },
  },
  facebook: {
    poolPath: path.join(DIR, 'data', 'pool-facebook.json'), arrayKey: 'creators', idField: 'uniqueId',
    nameField: 'nickname', metricField: 'followerCount', metricLabel: '팔로워수', countryField: null, label: '메타',
    async fetchLive(items) { return fetchLiveViaBrowser(facebook, items, (id) => '/' + id); },
  },
};

const cfg = PLATFORMS[PLATFORM];
if (!cfg) throw new Error(`알 수 없는 PLATFORM: ${PLATFORM} (youtube|tiktok|instagram|facebook)`);

async function fetchLiveDirect(ids, fetchOne) {
  const results = new Map();
  let idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const id = ids[idx++];
      try { results.set(id, await fetchOne(id)); } catch { results.set(id, null); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  return results;
}

async function fetchLiveViaBrowser(mod, ids, toArg) {
  const results = new Map();
  await mod.withBrowser(async (context) => {
    let idx = 0;
    async function worker() {
      while (idx < ids.length) {
        const id = ids[idx++];
        try { results.set(id, await mod.getUserProfile(context, toArg ? toArg(id) : id)); } catch { results.set(id, null); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  });
  return results;
}

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function appendHistory(entries) {
  if (!entries.length) return;
  const history = loadJson(HISTORY_PATH, []);
  history.push(...entries);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(-MAX_HISTORY_ENTRIES)));
}
function saveSummary(patch) {
  const summary = loadJson(SUMMARY_PATH, {});
  summary[PLATFORM] = { ...(summary[PLATFORM] || {}), ...patch };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary));
}

function relDiff(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  return Math.abs(b - a) / Math.max(1, Math.abs(a));
}

/** 저장값(stored) vs 실측값(live)을 비교해 blue/yellow/red 판정 + 반영할 필드 변경분을 만든다 */
function classify(stored, live) {
  if (live === null) {
    stored.dsUnreachableStrikes = (stored.dsUnreachableStrikes || 0) + 1;
    const flagged = stored.dsUnreachableStrikes >= UNREACHABLE_STRIKES_TO_FLAG;
    return {
      status: flagged ? 'red' : 'yellow',
      reasons: [flagged
        ? `${UNREACHABLE_STRIKES_TO_FLAG}회 연속 접근 실패 — 삭제·비공개 전환 가능성 높음`
        : `일시적으로 접근 실패(${stored.dsUnreachableStrikes}/${UNREACHABLE_STRIKES_TO_FLAG}회째, 네트워크 문제일 수 있어 관찰 중)`],
      changes: [],
    };
  }

  let status = 'blue';
  const reasons = [];
  const changes = [];
  const bump = (next) => { if (next === 'red' || (next === 'yellow' && status !== 'red')) status = next; };

  if (cfg.countryField && stored[cfg.countryField] === '대한민국' && live[cfg.countryField] && live[cfg.countryField] !== '대한민국') {
    bump('red');
    reasons.push(`국내 판정 오류: 저장값 '대한민국' → 재확인 결과 '${live[cfg.countryField]}'`);
    changes.push({ field: cfg.countryField, old: stored[cfg.countryField], value: live[cfg.countryField] });
  }

  const mf = cfg.metricField;
  const d = relDiff(stored[mf], live[mf]);
  if (live[mf] != null && (stored[mf] == null || d > 0.02)) {
    if (stored[mf] == null) { bump('yellow'); reasons.push(`${cfg.metricLabel} 값이 비어 있었음 → ${live[mf]}로 채움`); }
    else if (d > 0.5) { bump('red'); reasons.push(`${cfg.metricLabel} 차이가 큼: 저장값 ${stored[mf]} → 실측값 ${live[mf]} (${(d * 100).toFixed(0)}% 차이, 단순 성장으로 보기 어려움)`); }
    else if (d > 0.05) { bump('yellow'); reasons.push(`${cfg.metricLabel} 변동: 저장값 ${stored[mf]} → 실측값 ${live[mf]} (${(d * 100).toFixed(1)}%)`); }
    if (d == null || d > 0.02) changes.push({ field: mf, old: stored[mf] ?? null, value: live[mf] });
  }

  const storedName = String(stored[cfg.nameField] || '').trim();
  const liveName = String(live[cfg.nameField] || '').trim();
  if (storedName && liveName && storedName !== liveName && !storedName.includes(liveName) && !liveName.includes(storedName)) {
    bump('yellow');
    reasons.push(`이름 불일치: '${storedName}' → '${liveName}'`);
    changes.push({ field: cfg.nameField, old: storedName, value: liveName });
  }

  if (live.videoCount != null && stored.videoCount != null && live.videoCount < stored.videoCount * 0.5 && stored.videoCount > 5) {
    bump('yellow');
    reasons.push(`업로드 영상수가 저장값보다 크게 줄어듦(삭제·비공개 다수 가능성): ${stored.videoCount} → ${live.videoCount}`);
    changes.push({ field: 'videoCount', old: stored.videoCount, value: live.videoCount });
  }

  if (status === 'blue' && stored.dsUnreachableStrikes) changes.push({ field: 'dsUnreachableStrikes', old: stored.dsUnreachableStrikes, value: 0 });
  return { status, reasons, changes };
}

function pickVerifyBatch(items, count) {
  return items
    .filter((c) => Date.now() - (c.dsLastVerifiedAt || 0) >= MIN_VERIFY_GAP_MS)
    .sort((a, b) => (a.dsLastVerifiedAt || 0) - (b.dsLastVerifiedAt || 0))
    .slice(0, count);
}

async function runRound(roundNo) {
  const raw = loadJson(cfg.poolPath, {});
  const items = raw[cfg.arrayKey] || [];
  const batch = pickVerifyBatch(items, BATCH_SIZE);
  if (!batch.length) return { checked: 0, blue: 0, yellow: 0, red: 0 };

  const ids = batch.map((c) => c[cfg.idField]);
  const liveById = await cfg.fetchLive(ids);

  const tally = { checked: 0, blue: 0, yellow: 0, red: 0 };
  const historyEntries = [];
  const now = Date.now();
  const touched = new Map();

  for (const stored of batch) {
    const id = stored[cfg.idField];
    const live = liveById.has(id) ? liveById.get(id) : null;
    const { status, reasons, changes } = classify(stored, live);
    tally.checked++;
    tally[status]++;

    const patched = { ...stored, dsLastVerifiedAt: now, dsStatus: status };
    for (const c of changes) patched[c.field] = c.value;
    touched.set(id, patched);

    if (status !== 'blue') {
      historyEntries.push({
        t: now, platform: PLATFORM, id, name: stored[cfg.nameField] || '',
        status, reasons, changes: changes.map((c) => ({ field: c.field, old: c.old, new: c.value })),
      });
    }
  }

  await withFreshPool(cfg.poolPath, (fresh) => {
    fresh[cfg.arrayKey] = fresh[cfg.arrayKey] || [];
    const byId = new Map(fresh[cfg.arrayKey].map((c) => [c[cfg.idField], c]));
    for (const [id, patched] of touched) {
      const current = byId.get(id) || {};
      byId.set(id, { ...current, ...patched });
    }
    fresh[cfg.arrayKey] = [...byId.values()];
  });

  appendHistory(historyEntries);
  const prevSummary = loadJson(SUMMARY_PATH, {})[PLATFORM] || {};
  const cumulative = {
    checked: (prevSummary.cumulative?.checked || 0) + tally.checked,
    blue: (prevSummary.cumulative?.blue || 0) + tally.blue,
    yellow: (prevSummary.cumulative?.yellow || 0) + tally.yellow,
    red: (prevSummary.cumulative?.red || 0) + tally.red,
  };
  saveSummary({
    lastRunAt: now, lastRound: roundNo,
    totalItems: items.length,
    // 첫 전체 감사 사이클의 진행률 근사치(하루 간격이 지나면 다시 늘어날 수 있음)
    verifiedTotal: Math.min(items.length, (prevSummary.verifiedTotal || 0) + tally.checked),
    lastBatch: tally,
    cumulative,
  });

  return tally;
}

async function run() {
  console.log(`[데이터스코프] 시작 — 플랫폼: ${cfg.label}, 배치 ${BATCH_SIZE}개/라운드, 최소재검증간격 ${MIN_VERIFY_GAP_MS / 3600000}시간, ${MAX_ROUNDS ? MAX_ROUNDS + '라운드 후 종료' : '무한반복'}`);
  let round = 0;
  for (;;) {
    round++;
    const tally = await runRound(round);
    console.log(`[데이터스코프] 라운드 ${round}: 검증 ${tally.checked}개 — 🔵${tally.blue} 🟡${tally.yellow} 🔴${tally.red}`);
    if (MAX_ROUNDS && round >= MAX_ROUNDS) break;
    if (!tally.checked) await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
  console.log('[데이터스코프] 종료');
}

run().catch((err) => {
  console.error('[데이터스코프] 오류:', err.message);
  process.exit(1);
});
