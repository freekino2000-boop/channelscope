/**
 * build-datascope-report.js — 에이전트2 "데이터스코프"의 검증 리포트를 정적 HTML로 생성한다.
 * datascope-verify.js가 쌓은 data/datascope-summary.json / data/datascope-history.json을 읽어
 * 플랫폼별 🔵🟡🔴 현황과 최근 정정 이력을 하나의 파일(데이터스코프.html)로 만든다.
 *
 * 실행: node build-datascope-report.js
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SUMMARY_PATH = path.join(DIR, 'data', 'datascope-summary.json');
const HISTORY_PATH = path.join(DIR, 'data', 'datascope-history.json');
const OUT_PATH = path.join(DIR, '데이터스코프.html');
const HISTORY_SHOW = 300;

const PLATFORM_LABEL = { youtube: '유튜브', tiktok: '틱톡', instagram: '인스타그램', facebook: '메타' };

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { if (n == null) return '-'; if (typeof n !== 'number') return String(n); return n.toLocaleString('ko-KR'); }
function fmtDate(t) { if (!t) return '-'; const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function dot(status) { return { blue: '🔵', yellow: '🟡', red: '🔴' }[status] || '⚪'; }

const summary = loadJson(SUMMARY_PATH, {});
const history = loadJson(HISTORY_PATH, []);

const platformCards = Object.keys(PLATFORM_LABEL).map((platform) => {
  const s = summary[platform];
  const label = PLATFORM_LABEL[platform];
  if (!s) {
    return `<div class="card"><h3>${label}</h3><p class="muted">아직 검증 실행 이력이 없습니다.</p></div>`;
  }
  const coveragePct = s.totalItems ? Math.min(100, Math.round((s.verifiedTotal / s.totalItems) * 100)) : 0;
  const lb = s.lastBatch || {};
  const cum = s.cumulative || {};
  return `<div class="card">
    <h3>${label}</h3>
    <div class="meta">마지막 실행: ${fmtDate(s.lastRunAt)} (라운드 ${fmt(s.lastRound)})</div>
    <div class="meta">전체 ${fmt(s.totalItems)}개 중 ${fmt(s.verifiedTotal)}개 검증(첫 감사 사이클 진행률 ${coveragePct}%)</div>
    <div class="lights">
      <span class="light-blue">🔵 ${fmt(lb.blue)}</span>
      <span class="light-yellow">🟡 ${fmt(lb.yellow)}</span>
      <span class="light-red">🔴 ${fmt(lb.red)}</span>
      <span class="light-label">(최근 라운드)</span>
    </div>
    <div class="meta">누적 검증: ${fmt(cum.checked)}회 · 🔵${fmt(cum.blue)} 🟡${fmt(cum.yellow)} 🔴${fmt(cum.red)}</div>
  </div>`;
}).join('');

const sortedHistory = history.slice().sort((a, b) => b.t - a.t).slice(0, HISTORY_SHOW);
const historyRows = sortedHistory.map((h) => {
  const changesHtml = (h.changes || []).map((c) => `<div class="change">${esc(c.field)}: <span class="old">${esc(c.old)}</span> → <span class="new">${esc(c.new)}</span></div>`).join('');
  return `<tr data-platform="${esc(h.platform)}">
    <td>${fmtDate(h.t)}</td>
    <td>${esc(PLATFORM_LABEL[h.platform] || h.platform)}</td>
    <td>${dot(h.status)} ${esc(h.status)}</td>
    <td>${esc(h.name)}<br><span class="muted">${esc(h.id)}</span></td>
    <td>${(h.reasons || []).map((r) => `<div>${esc(r)}</div>`).join('')}</td>
    <td>${changesHtml || '-'}</td>
  </tr>`;
}).join('');

const platformCounts = Object.keys(PLATFORM_LABEL).reduce((acc, p) => {
  acc[p] = sortedHistory.filter((h) => h.platform === p).length;
  return acc;
}, {});
const tabButtons = ['<button class="tab active" data-tab="all">전체 <span class="tab-count">' + sortedHistory.length + '</span></button>']
  .concat(Object.keys(PLATFORM_LABEL).map((p) =>
    `<button class="tab" data-tab="${p}">${PLATFORM_LABEL[p]} <span class="tab-count">${platformCounts[p]}</span></button>`
  )).join('');

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>데이터스코프 — 검증 리포트</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#161616; color:#eee; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Pretendard,sans-serif; }
  header { padding:28px 24px 18px; border-bottom:1px solid #2a2a2a; }
  header h1 { margin:0 0 6px; font-size:22px; }
  header p { margin:0; color:#999; font-size:13.5px; }
  main { padding:24px; max-width:1200px; margin:0 auto; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; margin-bottom:32px; }
  .card { background:#1f1f1f; border:1px solid #2a2a2a; border-radius:14px; padding:18px 20px; }
  .card h3 { margin:0 0 10px; font-size:16px; }
  .meta { color:#aaa; font-size:12.5px; margin-bottom:6px; }
  .muted { color:#888; font-size:12px; }
  .lights { display:flex; gap:10px; align-items:center; margin:10px 0; font-size:14px; flex-wrap:wrap; }
  .light-label { color:#888; font-size:12px; }
  h2 { font-size:17px; margin:0 0 12px; }
  table { width:100%; border-collapse:collapse; font-size:13px; background:#1c1c1c; border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid #2a2a2a; vertical-align:top; }
  th { background:#232323; color:#bbb; font-weight:600; position:sticky; top:0; }
  .change { margin-bottom:2px; }
  .old { color:#ff8a80; text-decoration:line-through; }
  .new { color:#69f0ae; }
  .table-wrap { overflow-x:auto; border:1px solid #2a2a2a; border-radius:10px; }
  .empty { padding:20px; color:#888; text-align:center; }
  .tabs { display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; }
  .tab { background:#1f1f1f; border:1px solid #2a2a2a; color:#ccc; border-radius:999px; padding:7px 16px; font-size:13px; cursor:pointer; font-family:inherit; }
  .tab:hover { border-color:#444; }
  .tab.active { background:#2f6fed; border-color:#2f6fed; color:#fff; }
  .tab-count { color:inherit; opacity:.75; margin-left:4px; }
  tr[data-platform] { display:none; }
  tr[data-platform].show { display:table-row; }
</style></head>
<body>
<header>
  <h1>🔎 데이터스코프 — 데이터 검증 리포트</h1>
  <p>채널스코프(에이전트1)가 모은 데이터를 실시간 재조회해서 대조 검증합니다. 🔵 정상 · 🟡 부분오류(자동수정) · 🔴 오류(자동수정 또는 접근불가 표시). 생성 시각: ${fmtDate(Date.now())}</p>
</header>
<main>
  <div class="cards">${platformCards}</div>
  <h2>최근 정정 이력 (최대 ${HISTORY_SHOW}건, 최신순)</h2>
  <div class="tabs">${tabButtons}</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>시각</th><th>플랫폼</th><th>판정</th><th>채널/계정</th><th>사유</th><th>변경 내역</th></tr></thead>
      <tbody id="history-body">${historyRows || ''}</tbody>
    </table>
    ${sortedHistory.length ? '' : '<div class="empty">아직 부분오류·오류로 정정된 이력이 없습니다 (전부 정상이거나, 아직 검증이 실행되지 않았습니다).</div>'}
    <div class="empty" id="tab-empty" hidden>이 플랫폼은 아직 부분오류·오류 이력이 없습니다.</div>
  </div>
</main>
<script>
(function(){
  var tabs = document.querySelectorAll('.tab');
  var rows = document.querySelectorAll('#history-body tr');
  var emptyMsg = document.getElementById('tab-empty');
  function applyTab(tab){
    var visible = 0;
    rows.forEach(function(row){
      var match = tab === 'all' || row.getAttribute('data-platform') === tab;
      row.classList.toggle('show', match);
      if (match) visible++;
    });
    emptyMsg.hidden = visible !== 0 || rows.length === 0;
  }
  tabs.forEach(function(btn){
    btn.addEventListener('click', function(){
      tabs.forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      applyTab(btn.getAttribute('data-tab'));
    });
  });
  applyTab('all');
})();
</script>
</body></html>`;

fs.writeFileSync(OUT_PATH, html);
console.log(`생성: ${OUT_PATH} — 플랫폼 ${Object.keys(summary).length}개, 이력 ${history.length}건(표시 ${sortedHistory.length}건)`);
