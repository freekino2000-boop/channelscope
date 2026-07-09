/**
 * expand-pool.js
 * 기존 API 없는 수집 방식(scraper.searchChannels)을 유지하면서 채널 풀을 증분 확장합니다.
 *
 * 실행 예:
 *   TARGET_ADD=10000 node expand-pool.js
 *   TARGET_ADD=10000 REQUIRE_DOMESTIC=0 node expand-pool.js
 */
const fs = require('fs');
const path = require('path');
const scraper = require('./scraper');
const { buildQueryPlan } = require('./query-topics');

const POOL_PATH = path.join(__dirname, 'data', 'pool.json');
const TARGET_ADD = Number(process.env.TARGET_ADD || process.argv[2] || 10000);
const PER_QUERY = Number(process.env.PER_QUERY || 20);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const SAVE_EVERY = Number(process.env.SAVE_EVERY || 25);
const MAX_QUERIES = Number(process.env.MAX_QUERIES || 0);
const ENRICH_NEW = process.env.ENRICH_NEW === '1';
const REQUIRE_DOMESTIC = process.env.REQUIRE_DOMESTIC !== '0';
const DOMESTIC_COUNTRY = '대한민국';

const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
pool.channels = pool.channels || [];
pool.crawledQueries = pool.crawledQueries || [];
pool.expansionQueries = pool.expansionQueries || [];
if (REQUIRE_DOMESTIC) pool.channels = pool.channels.filter((channel) => channel.country === DOMESTIC_COUNTRY);

const found = new Map(pool.channels.map((channel) => [channel.id, channel]));
const originalCount = found.size;
const triedQueries = new Set([...pool.crawledQueries, ...pool.expansionQueries]);
const newlyAddedIds = [];
let stopReason = '';
let networkFailures = 0;

function save() {
  pool.channels = [...found.values()].filter((channel) => !REQUIRE_DOMESTIC || channel.country === DOMESTIC_COUNTRY);
  pool.updatedAt = Date.now();
  fs.writeFileSync(POOL_PATH, JSON.stringify(pool));
}

async function enrichNewChannels() {
  if (REQUIRE_DOMESTIC || !ENRICH_NEW || !newlyAddedIds.length) return;

  let idx = 0;
  let done = 0;
  async function worker() {
    while (idx < newlyAddedIds.length) {
      const id = newlyAddedIds[idx++];
      const channel = found.get(id);
      if (!channel || channel.enriched) continue;
      try {
        const core = await scraper.getChannelCore(id);
        Object.assign(channel, {
          ...core,
          name: core.name || channel.name,
          handle: core.handle || channel.handle,
          subscribers: core.subscribers ?? channel.subscribers,
          avatarUrl: core.avatarUrl || channel.avatarUrl,
          category: channel.category,
          enriched: true,
        });
      } catch (err) {
        channel.enriched = false;
        channel.enrichError = err.message;
      }
      done++;
      if (done % SAVE_EVERY === 0) {
        save();
        console.log(`[확장상세] ${done}/${newlyAddedIds.length} 완료`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, newlyAddedIds.length) }, worker));
  save();
}

async function run() {
  if (!Number.isFinite(TARGET_ADD) || TARGET_ADD <= 0) {
    throw new Error('TARGET_ADD는 1 이상의 숫자여야 합니다.');
  }

  const queries = buildQueryPlan(pool.channels.map((channel) => channel.category), triedQueries, MAX_QUERIES);
  console.log(`[확장수집] 현재 ${originalCount}개, 추가 목표 ${TARGET_ADD}개, 후보 검색어 ${queries.length}개, 국내확인전용 ${REQUIRE_DOMESTIC ? 'ON' : 'OFF'}`);
  if (!queries.length) {
    console.log('[확장수집] 새 검색어가 없습니다.');
    return;
  }

  let idx = 0;
  let processed = 0;
  async function worker() {
    while (idx < queries.length && newlyAddedIds.length < TARGET_ADD && !stopReason) {
      const { query, category } = queries[idx++];
      let resultCount = 0;
      let succeeded = false;
      try {
        const results = await scraper.searchChannels(query, PER_QUERY);
        succeeded = true;
        networkFailures = 0;
        resultCount = results.length;
        for (const channel of results) {
          if (!channel.id || found.has(channel.id)) continue;
          if (REQUIRE_DOMESTIC) {
            let core;
            try {
              core = await scraper.getChannelCore(channel.id);
            } catch { continue; }
            if (core.country !== DOMESTIC_COUNTRY) continue;
            found.set(channel.id, {
              ...channel,
              ...core,
              name: core.name || channel.name,
              handle: core.handle || channel.handle,
              subscribers: core.subscribers ?? channel.subscribers,
              avatarUrl: core.avatarUrl || channel.avatarUrl,
              category,
              enriched: true,
              expansionSource: query,
              addedAt: new Date().toISOString(),
            });
            newlyAddedIds.push(channel.id);
          } else {
            found.set(channel.id, {
              ...channel,
              category,
              enriched: false,
              expansionSource: query,
              addedAt: new Date().toISOString(),
            });
            newlyAddedIds.push(channel.id);
          }
          if (newlyAddedIds.length >= TARGET_ADD) break;
        }
      } catch (err) {
        networkFailures++;
        if (networkFailures <= 5 || networkFailures % 10 === 0) {
          console.log(`[확장수집] 실패: ${query} (${err.message})`);
        }
        if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(err.message) && networkFailures >= 25) {
          stopReason = '네트워크 연결 실패가 반복되어 중단';
        }
      } finally {
        if (succeeded && !pool.expansionQueries.includes(query)) pool.expansionQueries.push(query);
        processed++;
        if (processed % SAVE_EVERY === 0 || newlyAddedIds.length >= TARGET_ADD) {
          save();
          console.log(`[확장수집] 검색어 ${processed}/${queries.length}, 새 채널 ${newlyAddedIds.length}/${TARGET_ADD}, 누적 ${found.size}개, 최근 "${query}" ${resultCount}개`);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queries.length) }, worker));
  save();
  await enrichNewChannels();
  if (stopReason) console.log(`[확장수집] 중단 사유: ${stopReason}`);
  console.log(`[확장수집] 완료: 기존 ${originalCount}개 → 현재 ${found.size}개 (+${found.size - originalCount}개)`);
}

run().catch((err) => {
  console.error('[확장수집] 오류:', err.message);
  save();
  process.exit(1);
});
