/**
 * sync-final-data.js
 * build-standalone.js가 만든 최신 엑셀 백데이터(이미 datascope-verify.js가 실시간 재조회로
 * 검증·정정한 pool.json/pool-*.json 기준으로 생성됨)를 "최종데이터" 폴더에 복사하고,
 * 그 시점의 데이터스코프 검증 현황을 요약한 매니페스트를 함께 남긴다.
 *
 * 실행: node sync-final-data.js (publish.sh에서 build-standalone.js 다음에 호출)
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT_DIR = path.join(DIR, '최종데이터');
const SUMMARY_PATH = path.join(DIR, 'data', 'datascope-summary.json');

const FILES = [
  '채널스코프_백데이터.xlsx',
  '채널스코프_틱톡_백데이터.xlsx',
  '채널스코프_메타_백데이터.xlsx',
  '채널스코프_인스타그램_백데이터.xlsx',
];
const PLATFORM_LABEL = { youtube: '유튜브', tiktok: '틱톡', instagram: '인스타그램', facebook: '메타' };

fs.mkdirSync(OUT_DIR, { recursive: true });

let copied = 0;
for (const name of FILES) {
  const src = path.join(DIR, name);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(OUT_DIR, name));
  copied++;
}

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
const summary = loadJson(SUMMARY_PATH, {});

const lines = [];
lines.push('최종데이터 동기화 시각: ' + new Date().toISOString());
lines.push('');
lines.push('이 폴더의 엑셀 파일은 에이전트2 "데이터스코프"(datascope-verify.js)가 실시간 재조회로');
lines.push('검증·정정한 데이터를 기준으로 매 주기 자동 생성된 최신 스냅샷입니다.');
lines.push('');
for (const platform of Object.keys(PLATFORM_LABEL)) {
  const s = summary[platform];
  const label = PLATFORM_LABEL[platform];
  if (!s) { lines.push(`- ${label}: 아직 데이터스코프 검증 이력 없음`); continue; }
  const coveragePct = s.totalItems ? Math.min(100, Math.round((s.verifiedTotal / s.totalItems) * 100)) : 0;
  const cum = s.cumulative || {};
  lines.push(`- ${label}: 전체 ${s.totalItems}개 중 ${s.verifiedTotal}개 검증(${coveragePct}%) · 누적 🔵${cum.blue || 0} 🟡${cum.yellow || 0} 🔴${cum.red || 0} · 마지막 실행 ${new Date(s.lastRunAt).toISOString()}`);
}

fs.writeFileSync(path.join(OUT_DIR, '검증현황.txt'), lines.join('\n'));
fs.writeFileSync(path.join(OUT_DIR, '검증현황.json'), JSON.stringify({ syncedAt: Date.now(), summary }, null, 2));

console.log(`[최종데이터] 엑셀 ${copied}개 동기화 완료 → ${OUT_DIR}`);
