/* 채널스코프 프론트엔드 (해시 라우팅 SPA) */

const $ = (sel) => document.querySelector(sel);
const listView = $('#list-view');
const detailView = $('#detail-view');
const grid = $('#channel-grid');
const resultInfo = $('#result-info');
const searchInput = $('#search-input');

const state = { q: '', tier: '', sort: 'subscribers', cat: '' };
const COMMENT_LIMIT = 10;
let refreshTimer = null;   // 수집 진행 중 자동 새로고침
let catsLoaded = false;

// ---------- 유틸 ----------
function fmt(n) {
  if (n == null) return '-';
  if (n >= 100000000) return (n / 100000000).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억';
  if (n >= 10000) return (n / 10000).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + '만';
  if (n >= 1000) return n.toLocaleString('ko-KR');
  return String(n);
}

function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt)) return d; // "5년 전" 같은 상대 시간은 그대로 표시
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일`;
}

function ageText(d) {
  if (!d || isNaN(new Date(d))) return '';
  const years = (Date.now() - new Date(d).getTime()) / 3.156e10;
  if (years < 1) return `개설 ${Math.max(1, Math.round(years * 12))}개월차`;
  return `개설 ${Math.floor(years)}년차`;
}

function fmtDuration(iso) {
  if (!iso) return '';
  if (!iso.startsWith('PT')) return iso; // 목데이터는 이미 "mm:ss" 형식
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const [, h, mi, s] = m;
  const pad = (v) => String(v || 0).padStart(2, '0');
  return h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi || 0}:${pad(s)}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function tierBadge(ch) {
  const cls = { mega: 'badge-mega', large: 'badge-large', medium: 'badge-medium', small: 'badge-small' }[ch.tier] || 'badge-small';
  let html = `<span class="badge ${cls}">${esc(ch.tierLabel)}</span>`;
  if (ch.rising) html += `<span class="badge badge-rising">🚀 급상승</span>`;
  return html;
}

function gradient(ch, deg = 135) {
  return `linear-gradient(${deg}deg, ${ch.color1 || '#ff0000'}, ${ch.color2 || '#282828'})`;
}

function channelLikeValue(ch) {
  return ch.channelLikes ?? ch.topVideoLikes ?? null;
}

function channelLikeSub(ch) {
  if (ch.channelLikes != null) return '채널 공개 수치';
  if (ch.topVideoLikes != null) return '대표 영상 합계';
  return '공개 수치 없음';
}

// ---------- 목록 뷰 ----------
async function loadChannels({ silent = false } = {}) {
  if (!silent) grid.innerHTML = `<div class="loading">채널을 불러오는 중...</div>`;
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.tier) params.set('tier', state.tier);
  if (state.sort) params.set('sort', state.sort);
  if (state.cat) params.set('cat', state.cat);

  try {
    const res = await fetch(`/api/channels?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 실패');
    setModeBadge(data.mode);
    fillCategories(data.categories || []);
    renderList(data.channels, data);
    scheduleRefresh(data);
  } catch (err) {
    grid.innerHTML = `<div class="empty">⚠️ 데이터를 불러오지 못했습니다.<br>${esc(err.message)}</div>`;
  }
}

// 서버가 백그라운드로 채널을 수집하는 동안 목록을 주기적으로 갱신
function scheduleRefresh(data) {
  clearTimeout(refreshTimer);
  if (data.crawling && !listView.hidden) {
    refreshTimer = setTimeout(() => loadChannels({ silent: true }), 4000);
  }
}

function fillCategories(cats) {
  if (catsLoaded || !cats.length) return;
  catsLoaded = true;
  const sel = $('#cat-select');
  for (const c of cats) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }
}

function renderList(channels, meta = {}) {
  const tierName = {
    '': '전체', rising: '급상승', mega: '메가', large: '대형', medium: '중형', small: '소형',
  }[state.tier];
  let info = `${tierName} 채널 ${channels.length}개`;
  if (state.cat) info += ` · ${state.cat}`;
  if (state.q) info += ` · "${state.q}" 검색 결과`;
  if (meta.crawling) {
    info += ` · ⏳ 데이터 수집 중 (${meta.enriched || 0}/${meta.total || 0} 상세 완료, 자동 갱신됩니다)`;
  }
  resultInfo.textContent = info;

  if (!channels.length) {
    grid.innerHTML = `<div class="empty">조건에 맞는 채널이 없습니다 😢</div>`;
    return;
  }

  grid.innerHTML = channels.map((ch) => `
    <article class="channel-card" data-id="${esc(ch.id)}">
      <div class="mini-home">
        <div class="mini-banner" style="background:${gradient(ch)}">
          ${ch.bannerUrl ? `<img class="mini-banner-img" src="${esc(ch.bannerUrl)}" alt="" onerror="this.remove()">` : ''}
          <div class="card-badges">${tierBadge(ch)}</div>
          <div class="mini-avatar" style="${ch.avatarUrl ? '' : `background:${gradient(ch, 45)}`}">
            ${ch.avatarUrl ? `<img src="${esc(ch.avatarUrl)}" alt="">` : esc(ch.emoji || '📺')}
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-name">${esc(ch.name)}</div>
        <div class="card-handle">${esc(ch.handle)}${ch.category ? ' · ' + esc(ch.category) : ''}</div>
        <div class="card-stats">
          <span>구독자 <b>${fmt(ch.subscribers)}</b></span>
          <span>조회수 <b>${fmt(ch.totalViews)}</b></span>
          ${channelLikeValue(ch) != null ? `<span>좋아요 <b>${fmt(channelLikeValue(ch))}</b></span>` : ''}
          ${ch.growth30d != null ? `<span class="card-growth">▲ ${ch.growth30d}%</span>` : ''}
        </div>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('.channel-card').forEach((card) => {
    card.addEventListener('click', () => {
      location.hash = `#/channel/${encodeURIComponent(card.dataset.id)}`;
    });
  });
}

// ---------- 상세 뷰 ----------
async function loadDetail(id) {
  detailView.innerHTML = `<div class="loading">채널 정보를 불러오는 중...</div>`;
  try {
    const res = await fetch(`/api/channel/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 실패');
    renderDetail(data.channel);
  } catch (err) {
    detailView.innerHTML = `
      <button class="back-btn" onclick="location.hash='#/'">← 목록으로</button>
      <div class="empty">⚠️ ${esc(err.message)}</div>`;
  }
}

function renderDetail(ch) {
  const avatarLetterBg = gradient(ch, 45);
  detailView.innerHTML = `
    <button class="back-btn" onclick="location.hash='#/'">← 목록으로</button>

    <div class="detail-banner" style="background:${gradient(ch)}">
      ${ch.bannerUrl ? `<img src="${esc(ch.bannerUrl)}" alt="" onerror="this.remove()">` : ''}
    </div>
    <div class="detail-head">
      <div class="detail-avatar" style="${ch.avatarUrl ? '' : `background:${avatarLetterBg}`}">
        ${ch.avatarUrl ? `<img src="${esc(ch.avatarUrl)}" alt="">` : esc(ch.emoji || '📺')}
      </div>
      <div class="detail-title">
        <h2>${esc(ch.name)} ${tierBadge(ch)}</h2>
        <div class="card-handle">${esc(ch.handle)}${ch.category ? ' · ' + esc(ch.category) : ''}</div>
      </div>
    </div>

    <p class="detail-desc">${esc(ch.description)}</p>

    <div class="stat-row">
      <div class="stat-box">
        <div class="label">구독자</div>
        <div class="value">${fmt(ch.subscribers)}</div>
        ${ch.growth30d != null ? `<div class="sub card-growth">최근 30일 ▲ ${ch.growth30d}%</div>` : ''}
      </div>
      <div class="stat-box">
        <div class="label">총 조회수</div>
        <div class="value">${fmt(ch.totalViews)}</div>
      </div>
      <div class="stat-box">
        <div class="label">채널 좋아요</div>
        <div class="value">${channelLikeValue(ch) == null ? '-' : fmt(channelLikeValue(ch))}</div>
        <div class="sub">${channelLikeSub(ch)}</div>
      </div>
      <div class="stat-box">
        <div class="label">업로드 영상</div>
        <div class="value">${fmt(ch.videoCount)}개</div>
      </div>
      <div class="stat-box">
        <div class="label">채널 개설일</div>
        <div class="value" style="font-size:17px">${fmtDate(ch.createdAt)}</div>
        <div class="sub">${ageText(ch.createdAt)}</div>
      </div>
    </div>

    <h3 class="section-title">🔥 대표 영상 TOP ${ch.topVideos.length}</h3>
    <div class="video-list vlist-rich">
      ${ch.topVideos.length ? ch.topVideos.map((v, i) => {
        const dateStr = v.uploadDate ? fmtDate(v.uploadDate) : fmtDate(v.publishedAt);
        const tags = (v.tags || []).slice(0, 8);
        const inner = `
          <div class="video-top">
            <div class="video-rank ${i === 0 ? 'top' : ''}">${i + 1}</div>
            <div class="video-thumb" style="${v.thumbnail ? '' : `background:linear-gradient(${120 + i * 40}deg, ${ch.color1}44, ${ch.color2}66)`}">
              ${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="">` : '▶'}
              <span class="dur">${fmtDuration(v.duration)}</span>
            </div>
            <div class="video-meta">
              <div class="video-title" title="${esc(v.title)}">${esc(v.title)}</div>
              <div class="video-sub">
                <span>👁 조회수 <b>${fmt(v.views)}</b></span>
                ${v.likes != null ? `<span>👍 좋아요 <b>${fmt(v.likes)}</b></span>` : ''}
                ${v.commentCount != null ? `<span>💬 댓글 <b>${fmt(v.commentCount)}</b></span>` : ''}
                <span>📅 ${dateStr}</span>
                ${v.category ? `<span class="v-cat">${esc(v.category)}</span>` : ''}
              </div>
            </div>
          </div>
          ${v.description ? `<div class="video-desc">${esc(v.description)}</div>` : ''}
          ${tags.length ? `<div class="video-tags">${tags.map((t) => `<span class="vtag">#${esc(t)}</span>`).join('')}</div>` : ''}`;
        return `<div class="video-item-rich">${inner}
          ${v.videoId ? `<a class="video-open" href="https://www.youtube.com/watch?v=${esc(v.videoId)}" target="_blank" rel="noopener">▶ 유튜브에서 보기</a>` : ''}</div>`;
      }).join('') : `<div class="empty">영상 정보를 가져올 수 없습니다.</div>`}
    </div>

    <h3 class="section-title">💬 인기 댓글 TOP ${Math.min(COMMENT_LIMIT, ch.comments.length)}</h3>
    <div class="comment-list">
      ${ch.comments.length ? ch.comments.slice(0, COMMENT_LIMIT).map((c, i) => `
        <div class="comment">
          <div class="comment-avatar" style="background:linear-gradient(${45 + i * 70}deg, ${ch.color2}, ${ch.color1})">
            ${esc((c.author || '?').replace(/^@/, '').charAt(0).toUpperCase())}
          </div>
          <div class="comment-body">
            <div class="comment-author">${esc(c.author)} <span>${fmtDate(c.publishedAt)}</span></div>
            <div class="comment-text">${esc(c.text)}</div>
            <div class="comment-likes">👍 ${fmt(c.likes)}</div>
          </div>
        </div>
      `).join('') : `<div class="empty">댓글 정보를 가져올 수 없습니다.</div>`}
    </div>
  `;
}

// ---------- 라우터 ----------
function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/channel\/(.+)$/);
  if (m) {
    clearTimeout(refreshTimer);
    listView.hidden = true;
    detailView.hidden = false;
    loadDetail(decodeURIComponent(m[1]));
    window.scrollTo(0, 0);
  } else {
    detailView.hidden = true;
    listView.hidden = false;
    loadChannels();
  }
}

// ---------- 이벤트 ----------
$('#tier-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  state.tier = btn.dataset.tier;
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  else loadChannels();
});

$('#sort-select').addEventListener('change', (e) => {
  state.sort = e.target.value;
  loadChannels();
});

$('#cat-select').addEventListener('change', (e) => {
  state.cat = e.target.value;
  loadChannels();
});

function doSearch() {
  state.q = searchInput.value.trim();
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  else loadChannels();
}
$('#search-btn').addEventListener('click', doSearch);
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

window.addEventListener('hashchange', route);

// 데이터 모드 표시
function setModeBadge(mode) {
  $('#mode-badge').textContent = {
    live: '🟢 실시간 데이터',
    mock: '🟡 데모 데이터',
    'mock-fallback': '🟠 데모 데이터 (유튜브 연결 실패)',
  }[mode] || '';
}
fetch('/api/config').then((r) => r.json()).then((c) => setModeBadge(c.mode)).catch(() => {});

route();
