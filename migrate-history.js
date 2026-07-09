/**
 * migrate-history.js
 * 채널별 성장 추적을 위한 history 필드를 1회성으로 백필한다.
 * 이미 history가 있는 채널은 건드리지 않음 — 여러 번 실행해도 안전.
 * 실행: node migrate-history.js
 */
const fs = require('fs');
const path = require('path');

const POOL_PATH = path.join(__dirname, 'data', 'pool.json');
const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));

let added = 0;
for (const ch of pool.channels || []) {
  if (Array.isArray(ch.history) && ch.history.length) continue;
  const baselineT = ch.addedAt ? new Date(ch.addedAt).getTime() : (pool.updatedAt || Date.now());
  ch.history = [{ t: Number.isFinite(baselineT) ? baselineT : Date.now(), s: ch.subscribers ?? null, v: ch.totalViews ?? null, n: ch.videoCount ?? null }];
  if (ch.lastScannedAt === undefined) ch.lastScannedAt = null;
  if (ch.trend === undefined) ch.trend = 'new';
  if (ch.subsGrowth30d === undefined) ch.subsGrowth30d = null;
  if (ch.subsGrowthPct30d === undefined) ch.subsGrowthPct30d = null;
  added++;
}

fs.writeFileSync(POOL_PATH, JSON.stringify(pool));
console.log(`[히스토리마이그레이션] 총 ${pool.channels.length}개 중 ${added}개에 baseline 스냅샷 추가`);
