/**
 * grow-pool.js
 * 신규 채널 발굴(검색)과 기존 채널 재스캔(구독자/조회수 성장 추적)을 하나의 프로세스에서
 * 라운드 단위로 순차 병행한다. pool.json 동시쓰기 충돌을 피하려고 항상 단일 프로세스·순차 저장.
 *
 * 재스캔한 채널은 history 배열({t,s,v,n} 스냅샷)에 값을 누적하고, 최근 30일 구간의
 * 구독자 증감(subsGrowth30d/subsGrowthPct30d)과 추세(trend: rising/flat/declining/new)를 계산한다.
 * 신규 검색어가 소진되면 발굴은 멈추고 재스캔만 무한 반복한다(성장 추적은 끝이 없으므로).
 *
 * 실행 예:
 *   TARGET_ADD=20000 node grow-pool.js
 *   RESCAN_ROUND=300 MIN_RESCAN_GAP_HOURS=24 node grow-pool.js
 */
const fs = require('fs');
const path = require('path');
const scraper = require('./scraper');
const { buildQueryPlan } = require('./query-topics');
const { withFreshPool } = require('./pool-lock');

const POOL_PATH = path.join(__dirname, 'data', 'pool.json');
const TARGET_ADD = Number(process.env.TARGET_ADD || 0); // 0 = 신규발굴 없이 재스캔만
const DISCOVERY_ROUND = Number(process.env.DISCOVERY_ROUND || 20); // 라운드당 신규발굴 검색어 수
const RESCAN_ROUND = Number(process.env.RESCAN_ROUND || 150); // 라운드당 재스캔 채널 수
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const PER_QUERY = Number(process.env.PER_QUERY || 20);
const REQUIRE_DOMESTIC = process.env.REQUIRE_DOMESTIC !== '0';
const MIN_RESCAN_GAP_MS = Number(process.env.MIN_RESCAN_GAP_HOURS || 24) * 3600 * 1000; // 채널당 하루 1회 재스캔이 기본 — 더 자주 돌려봐야 의미있는 증감이 안 나옴
const MAX_HISTORY = 40; // 채널당 최대 스냅샷 수(넘으면 오래된 절반을 솎아냄)
const GROWTH_WINDOW_MS = 30 * 24 * 3600 * 1000;
const DOMESTIC_COUNTRY = '대한민국';

const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
pool.channels = pool.channels || [];
pool.crawledQueries = pool.crawledQueries || [];
pool.expansionQueries = pool.expansionQueries || [];
if (REQUIRE_DOMESTIC) pool.channels = pool.channels.filter((c) => c.country === DOMESTIC_COUNTRY);

const found = new Map(pool.channels.map((c) => [c.id, c]));
const originalCount = found.size;
const triedQueries = new Set([...pool.crawledQueries, ...pool.expansionQueries]);
const queries = buildQueryPlan(pool.channels.map((c) => c.category), triedQueries, 0);
let queryIdx = 0;
let newlyAdded = 0;
let rescannedTotal = 0;
// datascope-verify.js 같은 다른 프로세스가 그 사이 pool.json을 고쳤을 수 있으므로,
// 저장할 때는 절대 이 프로세스의 낡은 전체 스냅샷을 덮어쓰지 않고 "이번에 실제로 건드린 채널/검색어"만
// 디스크의 최신 내용 위에 병합한다(touchedIds/newlyTriedQueries 방식).
let touchedIds = new Set();
let newlyTriedQueries = new Set();

async function save() {
  const idsToWrite = touchedIds;
  const queriesToWrite = newlyTriedQueries;
  touchedIds = new Set();
  newlyTriedQueries = new Set();
  if (!idsToWrite.size && !queriesToWrite.size) return;
  await withFreshPool(POOL_PATH, (fresh) => {
    fresh.channels = fresh.channels || [];
    fresh.crawledQueries = fresh.crawledQueries || [];
    fresh.expansionQueries = fresh.expansionQueries || [];
    const byId = new Map(fresh.channels.map((c) => [c.id, c]));
    for (const id of idsToWrite) {
      const ch = found.get(id);
      if (ch) byId.set(id, ch);
    }
    let channels = [...byId.values()];
    if (REQUIRE_DOMESTIC) channels = channels.filter((c) => c.country === DOMESTIC_COUNTRY);
    fresh.channels = channels;
    for (const q of queriesToWrite) if (!fresh.expansionQueries.includes(q)) fresh.expansionQueries.push(q);
  });
}

function ensureBaselineHistory(ch) {
  if (!Array.isArray(ch.history) || !ch.history.length) {
    const baselineT = ch.addedAt ? new Date(ch.addedAt).getTime() : Date.now();
    ch.history = [{
      t: Number.isFinite(baselineT) ? baselineT : Date.now(),
      s: ch.subscribers ?? null, v: ch.totalViews ?? null, n: ch.videoCount ?? null,
    }];
  }
}

function pushHistory(ch, snapshot) {
  ensureBaselineHistory(ch);
  ch.history.push(snapshot);
  if (ch.history.length > MAX_HISTORY) {
    const half = Math.floor(ch.history.length / 2);
    const thinnedOld = ch.history.slice(0, half).filter((_, i) => i % 2 === 0);
    ch.history = [...thinnedOld, ...ch.history.slice(half)];
  }
}

function computeGrowth(ch) {
  const h = ch.history || [];
  if (h.length < 2) { ch.trend = 'new'; ch.subsGrowth30d = null; ch.subsGrowthPct30d = null; return; }
  const now = Date.now();
  const base = h.find((p) => now - p.t <= GROWTH_WINDOW_MS) || h[0];
  const latest = h[h.length - 1];
  if (base === latest || base.s == null || latest.s == null) {
    ch.trend = 'new'; ch.subsGrowth30d = null; ch.subsGrowthPct30d = null;
    return;
  }
  const diff = latest.s - base.s;
  const pct = base.s ? diff / base.s : null;
  ch.subsGrowth30d = diff;
  ch.subsGrowthPct30d = pct;
  if (pct == null) ch.trend = 'new';
  else if (pct > 0.03) ch.trend = 'rising';
  else if (pct < -0.01) ch.trend = 'declining';
  else ch.trend = 'flat';
}

async function rescanOne(ch) {
  try {
    const core = await scraper.getChannelCore(ch.id);
    const now = Date.now();
    const snapshot = {
      t: now,
      s: core.subscribers ?? ch.subscribers ?? null,
      v: core.totalViews ?? ch.totalViews ?? null,
      n: core.videoCount ?? ch.videoCount ?? null,
    };
    pushHistory(ch, snapshot);
    ch.subscribers = snapshot.s;
    ch.totalViews = snapshot.v;
    ch.videoCount = snapshot.n;
    if (core.name) ch.name = core.name;
    if (core.avatarUrl) ch.avatarUrl = core.avatarUrl;
    if (core.country) ch.country = core.country;
    ch.lastScannedAt = now;
    ch.lastScanError = null;
    computeGrowth(ch);
    rescannedTotal++;
  } catch (err) {
    ch.lastScannedAt = Date.now(); // 실패해도 큐 뒤로 넘겨서 특정 채널만 계속 재시도되는 것을 방지
    ch.lastScanError = err.message;
  }
  touchedIds.add(ch.id);
}

function pickRescanBatch(count) {
  return [...found.values()]
    .filter((c) => Date.now() - (c.lastScannedAt || 0) >= MIN_RESCAN_GAP_MS)
    .sort((a, b) => (a.lastScannedAt || 0) - (b.lastScannedAt || 0))
    .slice(0, count);
}

async function runDiscoveryRound(count) {
  const batch = [];
  while (batch.length < count && queryIdx < queries.length) batch.push(queries[queryIdx++]);
  if (!batch.length) return 0;

  let added = 0;
  let idx = 0;
  async function worker() {
    while (idx < batch.length) {
      const { query, category } = batch[idx++];
      let succeeded = false;
      try {
        const results = await scraper.searchChannels(query, PER_QUERY);
        succeeded = true;
        for (const channel of results) {
          if (!channel.id || found.has(channel.id)) continue;
          if (REQUIRE_DOMESTIC) {
            let core;
            try { core = await scraper.getChannelCore(channel.id); } catch { continue; }
            if (core.country !== DOMESTIC_COUNTRY) continue;
            const now = Date.now();
            found.set(channel.id, {
              ...channel, ...core,
              name: core.name || channel.name,
              handle: core.handle || channel.handle,
              subscribers: core.subscribers ?? channel.subscribers,
              avatarUrl: core.avatarUrl || channel.avatarUrl,
              category, enriched: true,
              expansionSource: query,
              addedAt: new Date().toISOString(),
              lastScannedAt: now,
              history: [{ t: now, s: core.subscribers ?? channel.subscribers ?? null, v: core.totalViews ?? null, n: core.videoCount ?? null }],
              trend: 'new', subsGrowth30d: null, subsGrowthPct30d: null,
            });
          } else {
            found.set(channel.id, { ...channel, category, enriched: false, expansionSource: query, addedAt: new Date().toISOString() });
          }
          touchedIds.add(channel.id);
          added++;
          newlyAdded++;
        }
      } catch {
        // 검색 실패 시 이 검색어는 tried 목록에 넣지 않고 다음으로 넘어감
      } finally {
        if (succeeded) newlyTriedQueries.add(query);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
  return added;
}

async function runRescanRound(count) {
  const batch = pickRescanBatch(count);
  if (!batch.length) return 0;
  let idx = 0;
  async function worker() {
    while (idx < batch.length) await rescanOne(batch[idx++]);
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
  return batch.length;
}

async function run() {
  console.log(`[성장추적] 시작 — 채널 ${originalCount}개, 신규 목표 ${TARGET_ADD || '0(재스캔전용)'}개, 후보 검색어 ${queries.length}개`);
  let round = 0;
  for (;;) {
    round++;
    const discoveryLeft = TARGET_ADD > 0 ? TARGET_ADD - newlyAdded : 0;
    const doDiscovery = discoveryLeft > 0 && queryIdx < queries.length;
    const addedThisRound = doDiscovery ? await runDiscoveryRound(DISCOVERY_ROUND) : 0;
    const rescannedThisRound = await runRescanRound(RESCAN_ROUND);
    await save();
    console.log(`[성장추적] 라운드 ${round}: 검색어 ${queryIdx}/${queries.length}, 신규 +${addedThisRound}(누적 ${newlyAdded}${TARGET_ADD ? '/' + TARGET_ADD : ''}), 재스캔 ${rescannedThisRound}개(누적 ${rescannedTotal}), 전체 ${found.size}개`);
    if (!doDiscovery && !rescannedThisRound) {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  }
}

run().catch(async (err) => {
  console.error('[성장추적] 오류:', err.message);
  await save();
  process.exit(1);
});
