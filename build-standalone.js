/**
 * build-standalone.js
 * 백엔드에 수집된 채널 풀(data/pool.json)을 통째로 담은 "단독 실행 대시보드 HTML"을 생성합니다.
 * 서버·인터넷 없이 더블클릭만으로 열리며, 전체보기는 구독자 순 평면 목록으로 동작합니다.
 *
 * 실행: node build-standalone.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildBackendWorkbook } = require('./export-workbook');
const { buildTiktokWorkbook } = require('./export-workbook-tiktok');
const { buildFacebookWorkbook } = require('./export-workbook-facebook');
const { buildInstagramWorkbook } = require('./export-workbook-instagram');

const DIR = __dirname;
const pool = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'pool.json'), 'utf8'));
const TIKTOK_POOL_PATH = path.join(DIR, 'data', 'pool-tiktok.json');
const tiktokPool = fs.existsSync(TIKTOK_POOL_PATH)
  ? JSON.parse(fs.readFileSync(TIKTOK_POOL_PATH, 'utf8'))
  : { creators: [], updatedAt: null };
const FACEBOOK_POOL_PATH = path.join(DIR, 'data', 'pool-facebook.json');
const facebookPool = fs.existsSync(FACEBOOK_POOL_PATH)
  ? JSON.parse(fs.readFileSync(FACEBOOK_POOL_PATH, 'utf8'))
  : { creators: [], updatedAt: null };
const INSTAGRAM_POOL_PATH = path.join(DIR, 'data', 'pool-instagram.json');
const instagramPool = fs.existsSync(INSTAGRAM_POOL_PATH)
  ? JSON.parse(fs.readFileSync(INSTAGRAM_POOL_PATH, 'utf8'))
  : { creators: [], updatedAt: null };
const css = fs.readFileSync(path.join(DIR, 'public', 'style.css'), 'utf8');
const XLSX_NAME = '채널스코프_백데이터.xlsx';
const TIKTOK_XLSX_NAME = '채널스코프_틱톡_백데이터.xlsx';
const FACEBOOK_XLSX_NAME = '채널스코프_페이스북_백데이터.xlsx';
const INSTAGRAM_XLSX_NAME = '채널스코프_인스타그램_백데이터.xlsx';
const DOMESTIC_COUNTRY = '대한민국';

// ----- 서버와 동일한 등급/색상 로직 -----
const TIERS = [
  { key: 'mega', label: '메가', min: 5_000_000 },
  { key: 'large', label: '대형', min: 1_000_000 },
  { key: 'medium', label: '중형', min: 100_000 },
  { key: 'small', label: '소형', min: 0 },
];
function tierOf(s) { return TIERS.find((t) => (s || 0) >= t.min); }
function colorsFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [`hsl(${h % 360}, 65%, 50%)`, `hsl(${(h * 7) % 360}, 70%, 40%)`];
}
function isRising(ch) {
  if (!ch.createdAt) return false;
  const age = (Date.now() - new Date(ch.createdAt).getTime()) / 3.156e10;
  return age < 3 && (ch.subscribers || 0) >= 50_000;
}
function topVideoLikes(ch) {
  const likes = (ch.topVideos || [])
    .map((v) => v.likes)
    .filter((n) => typeof n === 'number' && Number.isFinite(n));
  return likes.length ? likes.reduce((sum, n) => sum + n, 0) : null;
}
const COMMENT_LIMIT = 10;

const channels = pool.channels.filter((c) => c.country === DOMESTIC_COUNTRY).map((c) => {
  const t = tierOf(c.subscribers);
  const [color1, color2] = colorsFor(c.id);
  return {
    id: c.id, name: c.name, handle: c.handle || '', category: c.category || '',
    description: c.description || '', subscribers: c.subscribers ?? null,
    totalViews: c.totalViews ?? null, channelLikes: c.channelLikes ?? null,
    topVideoLikes: c.topVideoLikes ?? topVideoLikes(c), videoCount: c.videoCount ?? null,
    createdAt: c.createdAt || null, country: c.country || '',
    avatarUrl: c.avatarUrl || '', bannerUrl: c.bannerUrl || '',
    enriched: c.enriched || false, videosCollected: c.videosCollected || false,
    tier: t.key, tierLabel: t.label, rising: isRising(c), color1, color2,
    // 영상별 원본 댓글(최대 300개/채널)은 백엔드·엑셀 전용 데이터라 html에는 담지 않고 메타데이터만 포함
    topVideos: (c.topVideos || []).map(({ comments, ...v }) => v),
    comments: (c.comments || []).slice(0, COMMENT_LIMIT),
    commentSentiment: c.commentSentiment || null,
  };
});

const catCount = {};
for (const c of channels) catCount[c.category] = (catCount[c.category] || 0) + 1;
const categories = Object.keys(catCount).filter(Boolean).sort((a, b) => catCount[b] - catCount[a]);
const tierCount = { mega: 0, large: 0, medium: 0, small: 0, rising: 0 };
for (const c of channels) { tierCount[c.tier]++; if (c.rising) tierCount.rising++; }

const dataJson = JSON.stringify({ channels, categories, tierCount, updatedAt: pool.updatedAt })
  .replace(/</g, '\\u003c');

// ----- 틱톡 (파일럿: 채널 단위 통계만, 영상/댓글 없음) -----
const tiktokCreators = (tiktokPool.creators || []).filter((c) => c.domestic).map((c) => {
  const [color1, color2] = colorsFor(c.uniqueId);
  const t = tierOf(c.followerCount); // 유튜브와 동일한 구독자/팔로워 구간 기준 재사용
  return {
    id: c.id, uniqueId: c.uniqueId, nickname: c.nickname || '', bio: c.bio || '',
    avatarUrl: c.avatarUrl || '', verified: !!c.verified, language: c.language || '',
    createdAt: c.createdAt || null, followerCount: c.followerCount ?? null,
    followingCount: c.followingCount ?? null, heartCount: c.heartCount ?? null,
    videoCount: c.videoCount ?? null, profileUrl: c.profileUrl || `https://www.tiktok.com/@${c.uniqueId}`,
    category: c.category || '', tier: t.key, tierLabel: t.label, color1, color2,
  };
});
const tiktokCatCount = {};
for (const c of tiktokCreators) tiktokCatCount[c.category] = (tiktokCatCount[c.category] || 0) + 1;
const tiktokCategories = Object.keys(tiktokCatCount).filter(Boolean).sort((a, b) => tiktokCatCount[b] - tiktokCatCount[a]);
const tiktokTierCount = { mega: 0, large: 0, medium: 0, small: 0 };
for (const c of tiktokCreators) tiktokTierCount[c.tier]++;
const tiktokJson = JSON.stringify({ creators: tiktokCreators, categories: tiktokCategories, tierCount: tiktokTierCount, updatedAt: tiktokPool.updatedAt })
  .replace(/</g, '\\u003c');
const tiktokWorkbookBuffer = buildTiktokWorkbook(tiktokCreators, { updatedAt: tiktokPool.updatedAt });

// ----- 페이스북 (파일럿: 채널 단위 통계만, 개별 게시물 본문 없음) -----
const facebookCreators = (facebookPool.creators || []).filter((c) => c.domestic).map((c) => {
  const [color1, color2] = colorsFor(c.uniqueId);
  const t = tierOf(c.followerCount);
  return {
    uniqueId: c.uniqueId, nickname: c.nickname || '', bio: c.bio || '',
    avatarUrl: c.avatarUrl || '', followerCount: c.followerCount ?? null,
    likeCount: c.likeCount ?? null, profileUrl: c.profileUrl || `https://www.facebook.com/${c.uniqueId}`,
    category: c.category || '', tier: t.key, tierLabel: t.label, color1, color2,
  };
});
const facebookCatCount = {};
for (const c of facebookCreators) facebookCatCount[c.category] = (facebookCatCount[c.category] || 0) + 1;
const facebookCategories = Object.keys(facebookCatCount).filter(Boolean).sort((a, b) => facebookCatCount[b] - facebookCatCount[a]);
const facebookTierCount = { mega: 0, large: 0, medium: 0, small: 0 };
for (const c of facebookCreators) facebookTierCount[c.tier]++;
const facebookJson = JSON.stringify({ creators: facebookCreators, categories: facebookCategories, tierCount: facebookTierCount, updatedAt: facebookPool.updatedAt })
  .replace(/</g, '\\u003c');
const facebookWorkbookBuffer = buildFacebookWorkbook(facebookCreators, { updatedAt: facebookPool.updatedAt });

// ----- 인스타그램 (파일럿: 채널 단위 통계만, 게시물 본문 없음) -----
const instagramCreators = (instagramPool.creators || []).filter((c) => c.domestic).map((c) => {
  const [color1, color2] = colorsFor(c.uniqueId);
  const t = tierOf(c.followerCount);
  return {
    uniqueId: c.uniqueId, nickname: c.nickname || '', bio: c.bio || '',
    avatarUrl: c.avatarUrl || '', followerCount: c.followerCount ?? null,
    followingCount: c.followingCount ?? null, postCount: c.postCount ?? null,
    profileUrl: c.profileUrl || `https://www.instagram.com/${c.uniqueId}/`,
    category: c.category || '', tier: t.key, tierLabel: t.label, color1, color2,
  };
});
const instagramCatCount = {};
for (const c of instagramCreators) instagramCatCount[c.category] = (instagramCatCount[c.category] || 0) + 1;
const instagramCategories = Object.keys(instagramCatCount).filter(Boolean).sort((a, b) => instagramCatCount[b] - instagramCatCount[a]);
const instagramTierCount = { mega: 0, large: 0, medium: 0, small: 0 };
for (const c of instagramCreators) instagramTierCount[c.tier]++;
const instagramJson = JSON.stringify({ creators: instagramCreators, categories: instagramCategories, tierCount: instagramTierCount, updatedAt: instagramPool.updatedAt })
  .replace(/</g, '\\u003c');
const instagramWorkbookBuffer = buildInstagramWorkbook(instagramCreators, { updatedAt: instagramPool.updatedAt });
const workbookBuffer = buildBackendWorkbook(channels, {
  updatedAt: pool.updatedAt,
  sourceMode: 'offline',
  domesticOnly: true,
});

const appJs = String.raw`
const DATA = window.__CHANNELS__;
const TIKTOK = window.__TIKTOK__;
const FACEBOOK = window.__FACEBOOK__;
const INSTAGRAM = window.__INSTAGRAM__;
const $ = (s) => document.querySelector(s);
const grid = $('#channel-grid');
const resultInfo = $('#result-info');
const landingView = $('#landing-view');
const listView = $('#list-view');
const detailView = $('#detail-view');
const tiktokView = $('#tiktok-view');
const tiktokDetailView = $('#tiktok-detail-view');
const facebookView = $('#facebook-view');
const facebookDetailView = $('#facebook-detail-view');
const instagramView = $('#instagram-view');
const instagramDetailView = $('#instagram-detail-view');
const searchInput = $('#search-input');
const searchWrap = $('#search-wrap');
const modeBadge = $('#mode-badge');
const state = { q: '', tier: '', sort: 'subscribers', cat: '' };
const tiktokState = { q: '', sort: 'followers', cat: '', tier: '' };
const facebookState = { q: '', sort: 'followers', cat: '', tier: '' };
const instagramState = { q: '', sort: 'followers', cat: '', tier: '' };
const COMMENT_LIMIT = ${COMMENT_LIMIT};

function allSections(){ return [landingView, listView, detailView, tiktokView, tiktokDetailView, facebookView, facebookDetailView, instagramView, instagramDetailView]; }
function showOnly(section){ allSections().forEach((s)=>{ if(s) s.hidden = s!==section; }); }

function fmt(n){ if(n==null)return '-'; if(n>=1e8)return (n/1e8).toFixed(n>=1e9?0:1).replace(/\.0$/,'')+'억'; if(n>=1e4)return (n/1e4).toFixed(n>=1e6?0:1).replace(/\.0$/,'')+'만'; if(n>=1e3)return n.toLocaleString('ko-KR'); return String(n); }
function fmtDate(d){ if(!d)return '-'; const t=new Date(d); if(isNaN(t))return d; return t.getFullYear()+'년 '+(t.getMonth()+1)+'월 '+t.getDate()+'일'; }
function ageText(d){ if(!d||isNaN(new Date(d)))return ''; const y=(Date.now()-new Date(d).getTime())/3.156e10; return y<1?'개설 '+Math.max(1,Math.round(y*12))+'개월차':'개설 '+Math.floor(y)+'년차'; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function grad(ch,deg){ return 'linear-gradient('+(deg||135)+'deg, '+ch.color1+', '+ch.color2+')'; }
function channelLikeValue(ch){ return ch.channelLikes ?? ch.topVideoLikes ?? null; }
function channelLikeSub(ch){ if(ch.channelLikes!=null)return '채널 공개 수치'; if(ch.topVideoLikes!=null)return '대표 영상 합계'; return '공개 수치 없음'; }
function tierBadge(ch){ const cls={mega:'badge-mega',large:'badge-large',medium:'badge-medium',small:'badge-small'}[ch.tier]||'badge-small'; let h='<span class="badge '+cls+'">'+esc(ch.tierLabel)+'</span>'; if(ch.rising)h+='<span class="badge badge-rising">🚀 급상승</span>'; return h; }

function cardHtml(ch){
  return '<article class="channel-card" data-id="'+esc(ch.id)+'">'+
    '<div class="mini-home"><div class="mini-banner" style="background:'+grad(ch)+'">'+
      (ch.bannerUrl?'<img class="mini-banner-img" src="'+esc(ch.bannerUrl)+'" alt="" onerror="this.remove()">':'')+
      '<div class="card-badges">'+tierBadge(ch)+'</div>'+
      '<div class="mini-avatar" style="'+(ch.avatarUrl?'':'background:'+grad(ch,45))+'">'+(ch.avatarUrl?'<img src="'+esc(ch.avatarUrl)+'" alt="">':'📺')+'</div>'+
    '</div></div>'+
    '<div class="card-body"><div class="card-name">'+esc(ch.name)+'</div>'+
      '<div class="card-handle">'+esc(ch.handle)+(ch.category?' · '+esc(ch.category):'')+'</div>'+
      '<div class="card-stats"><span>구독자 <b>'+fmt(ch.subscribers)+'</b></span><span>조회수 <b>'+fmt(ch.totalViews)+'</b></span>'+(channelLikeValue(ch)!=null?'<span>좋아요 <b>'+fmt(channelLikeValue(ch))+'</b></span>':'')+'</div>'+
    '</div></article>';
}

function bindCards(root){ root.querySelectorAll('.channel-card').forEach((c)=>c.addEventListener('click',()=>{location.hash='#/youtube/channel/'+encodeURIComponent(c.dataset.id);})); }

// ---- 필터된 평면 그리드 ----
function renderGrid(){
  grid.hidden=false;
  let list=DATA.channels.slice();
  if(state.q){ const n=state.q.toLowerCase(); list=list.filter((c)=>c.name.toLowerCase().includes(n)||(c.handle||'').toLowerCase().includes(n)||(c.category||'').toLowerCase().includes(n)); }
  if(state.cat) list=list.filter((c)=>c.category===state.cat);
  if(state.tier==='rising') list=list.filter((c)=>c.rising);
  else if(state.tier) list=list.filter((c)=>c.tier===state.tier);
  if(state.sort==='views') list.sort((a,b)=>(b.totalViews||0)-(a.totalViews||0));
  else if(state.sort==='newest') list.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  else list.sort((a,b)=>(b.subscribers||0)-(a.subscribers||0));

  const tierName={'':'전체',rising:'급상승',mega:'메가',large:'대형',medium:'중형',small:'소형'}[state.tier];
  let info=tierName+' 채널 '+list.length+'개'; if(state.cat)info+=' · '+state.cat; if(state.q)info+=' · "'+state.q+'" 검색';
  resultInfo.textContent=info;
  if(!list.length){ grid.innerHTML='<div class="empty">조건에 맞는 채널이 없습니다 😢</div>'; return; }
  grid.innerHTML=list.map(cardHtml).join('');
  bindCards(grid);
}

function renderView(){
  resultInfo.style.display = '';
  renderGrid();
}

function videosHtml(ch){
  const vids=ch.topVideos||[];
  if(!vids.length){
    const yt=ch.id.indexOf('UC')===0?'https://www.youtube.com/channel/'+ch.id:'';
    return (yt?'<h3 class="section-title">🔗 채널 바로가기</h3><div class="video-list"><a class="video-item" href="'+yt+'" target="_blank" rel="noopener"><div class="video-rank top">▶</div><div class="video-meta"><div class="video-title">유튜브에서 이 채널 열기</div><div class="video-sub"><span>영상 데이터가 아직 수집되지 않은 채널입니다</span></div></div></a></div>':'');
  }
  return '<h3 class="section-title">🔥 대표 영상 TOP '+vids.length+'</h3><div class="video-list vlist-rich">'+
    vids.map((v,i)=>{
      const date=v.uploadDate?fmtDate(v.uploadDate):'';
      const tags=(v.tags||[]).slice(0,8);
      return '<div class="video-item-rich"><div class="video-top">'+
        '<div class="video-rank '+(i===0?'top':'')+'">'+(i+1)+'</div>'+
        '<div class="video-thumb" style="'+(v.thumbnail?'':'background:linear-gradient('+(120+i*40)+'deg, '+ch.color1+'44, '+ch.color2+'66)')+'">'+
          (v.thumbnail?'<img src="'+esc(v.thumbnail)+'" alt="">':'▶')+'<span class="dur">'+esc(v.duration||'')+'</span></div>'+
        '<div class="video-meta"><div class="video-title" title="'+esc(v.title)+'">'+esc(v.title)+'</div>'+
          '<div class="video-sub"><span>👁 조회수 <b>'+fmt(v.views)+'</b></span>'+
            (v.likes!=null?'<span>👍 좋아요 <b>'+fmt(v.likes)+'</b></span>':'')+
            (v.commentCount!=null?'<span>💬 댓글 <b>'+fmt(v.commentCount)+'</b></span>':'')+
            (date?'<span>📅 '+date+'</span>':'')+
            (v.category?'<span class="v-cat">'+esc(v.category)+'</span>':'')+'</div></div></div>'+
        (v.description?'<div class="video-desc">'+esc(v.description)+'</div>':'')+
        (tags.length?'<div class="video-tags">'+tags.map((t)=>'<span class="vtag">#'+esc(t)+'</span>').join('')+'</div>':'')+
        (v.videoId?'<a class="video-open" href="https://www.youtube.com/watch?v='+esc(v.videoId)+'" target="_blank" rel="noopener">▶ 유튜브에서 보기</a>':'')+
      '</div>';
    }).join('')+'</div>';
}

function sentimentHtml(ch){
  const s=ch.commentSentiment;
  if(!s||!s.total)return '';
  return '<h3 class="section-title">📊 댓글 감성 분석 (표본 '+s.total+'개)</h3>'+
    '<div class="sentiment-bar">'+
      '<div class="sentiment-seg sentiment-pos" style="width:'+s.positivePct+'%" title="긍정 '+s.positivePct+'%"></div>'+
      '<div class="sentiment-seg sentiment-neu" style="width:'+s.neutralPct+'%" title="중립 '+s.neutralPct+'%"></div>'+
      '<div class="sentiment-seg sentiment-neg" style="width:'+s.negativePct+'%" title="부정 '+s.negativePct+'%"></div>'+
    '</div>'+
    '<div class="sentiment-legend">'+
      '<span><span class="sentiment-dot sentiment-pos"></span>긍정 '+s.positivePct+'% ('+s.positive+')</span>'+
      '<span><span class="sentiment-dot sentiment-neu"></span>중립 '+s.neutralPct+'% ('+s.neutral+')</span>'+
      '<span><span class="sentiment-dot sentiment-neg"></span>부정 '+s.negativePct+'% ('+s.negative+')</span>'+
    '</div>';
}

function commentsHtml(ch){
  const cs=(ch.comments||[]).slice(0,COMMENT_LIMIT);
  if(!cs.length)return '';
  return sentimentHtml(ch)+'<h3 class="section-title">💬 인기 댓글 TOP '+Math.min(COMMENT_LIMIT, cs.length)+'</h3><div class="comment-list">'+
    cs.map((c,i)=>'<div class="comment"><div class="comment-avatar" style="background:linear-gradient('+(45+i*70)+'deg, '+ch.color2+', '+ch.color1+')">'+
      esc((c.author||'?').replace(/^@/,'').charAt(0).toUpperCase())+'</div>'+
      '<div class="comment-body"><div class="comment-author">'+esc(c.author)+' <span>'+fmtDate(c.publishedAt)+'</span></div>'+
      '<div class="comment-text">'+esc(c.text)+'</div><div class="comment-likes">👍 '+fmt(c.likes)+'</div></div></div>').join('')+'</div>';
}

function renderDetail(ch){
  detailView.innerHTML=
    '<button class="back-btn" onclick="location.hash='+"'#/youtube'"+'">← 목록으로</button>'+
    '<div class="detail-banner" style="background:'+grad(ch)+'">'+(ch.bannerUrl?'<img src="'+esc(ch.bannerUrl)+'" alt="" onerror="this.remove()">':'')+'</div>'+
    '<div class="detail-head"><div class="detail-avatar" style="'+(ch.avatarUrl?'':'background:'+grad(ch,45))+'">'+(ch.avatarUrl?'<img src="'+esc(ch.avatarUrl)+'" alt="">':'📺')+'</div>'+
      '<div class="detail-title"><h2>'+esc(ch.name)+' '+tierBadge(ch)+'</h2><div class="card-handle">'+esc(ch.handle)+(ch.category?' · '+esc(ch.category):'')+'</div></div></div>'+
    '<p class="detail-desc">'+esc(ch.description)+'</p>'+
    '<div class="stat-row">'+
      '<div class="stat-box"><div class="label">구독자</div><div class="value">'+fmt(ch.subscribers)+'</div></div>'+
      '<div class="stat-box"><div class="label">총 조회수</div><div class="value">'+fmt(ch.totalViews)+'</div></div>'+
      '<div class="stat-box"><div class="label">채널 좋아요</div><div class="value">'+(channelLikeValue(ch)==null?'-':fmt(channelLikeValue(ch)))+'</div><div class="sub">'+channelLikeSub(ch)+'</div></div>'+
      '<div class="stat-box"><div class="label">업로드 영상</div><div class="value">'+fmt(ch.videoCount)+'개</div></div>'+
      '<div class="stat-box"><div class="label">채널 개설일</div><div class="value" style="font-size:17px">'+fmtDate(ch.createdAt)+'</div><div class="sub">'+ageText(ch.createdAt)+(ch.country?' · '+esc(ch.country):'')+'</div></div>'+
    '</div>'+
    videosHtml(ch)+
    commentsHtml(ch);
}

// ---- 틱톡 카드/그리드/상세 ----
function tiktokTierBadge(c){ const cls={mega:'badge-mega',large:'badge-large',medium:'badge-medium',small:'badge-small'}[c.tier]||'badge-small'; return '<span class="badge '+cls+'">'+esc(c.tierLabel)+'</span>'; }

function tiktokCardHtml(c){
  return '<article class="channel-card tiktok-card" data-id="'+esc(c.id)+'">'+
    '<div class="mini-home"><div class="mini-banner" style="background:'+grad(c)+'">'+
      '<div class="card-badges">'+tiktokTierBadge(c)+(c.verified?'<span class="badge badge-rising">✔ 인증</span>':'')+'</div>'+
      '<div class="mini-avatar" style="'+(c.avatarUrl?'':'background:'+grad(c,45))+'">'+(c.avatarUrl?'<img src="'+esc(c.avatarUrl)+'" alt="">':'♪')+'</div>'+
    '</div></div>'+
    '<div class="card-body"><div class="card-name">'+esc(c.nickname||c.uniqueId)+'</div>'+
      '<div class="card-handle">@'+esc(c.uniqueId)+(c.category?' · '+esc(c.category):'')+'</div>'+
      '<div class="card-stats"><span>팔로워 <b>'+fmt(c.followerCount)+'</b></span><span>좋아요 <b>'+fmt(c.heartCount)+'</b></span><span>영상 <b>'+fmt(c.videoCount)+'</b></span></div>'+
    '</div></article>';
}
function bindTiktokCards(root){ root.querySelectorAll('.tiktok-card').forEach((c)=>c.addEventListener('click',()=>{location.hash='#/tiktok/creator/'+encodeURIComponent(c.dataset.id);})); }

function renderTiktokGrid(){
  const tgrid=$('#tiktok-grid'); const tinfo=$('#tiktok-result-info');
  let list=TIKTOK.creators.slice();
  if(tiktokState.q){ const n=tiktokState.q.toLowerCase(); list=list.filter((c)=>(c.nickname||'').toLowerCase().includes(n)||(c.uniqueId||'').toLowerCase().includes(n)||(c.category||'').toLowerCase().includes(n)); }
  if(tiktokState.cat) list=list.filter((c)=>c.category===tiktokState.cat);
  if(tiktokState.tier) list=list.filter((c)=>c.tier===tiktokState.tier);
  if(tiktokState.sort==='hearts') list.sort((a,b)=>(b.heartCount||0)-(a.heartCount||0));
  else if(tiktokState.sort==='videos') list.sort((a,b)=>(b.videoCount||0)-(a.videoCount||0));
  else list.sort((a,b)=>(b.followerCount||0)-(a.followerCount||0));

  const tierName={'':'전체',mega:'메가',large:'대형',medium:'중형',small:'소형'}[tiktokState.tier];
  let info=tierName+' 크리에이터 '+list.length+'명'; if(tiktokState.cat)info+=' · '+tiktokState.cat; if(tiktokState.q)info+=' · "'+tiktokState.q+'" 검색';
  tinfo.textContent=info;
  if(!list.length){ tgrid.innerHTML='<div class="empty">조건에 맞는 크리에이터가 없습니다 😢</div>'; return; }
  tgrid.innerHTML=list.map(tiktokCardHtml).join('');
  bindTiktokCards(tgrid);
}

function renderTiktokDetail(c){
  tiktokDetailView.innerHTML=
    '<button class="back-btn" onclick="location.hash='+"'#/tiktok'"+'">← 목록으로</button>'+
    '<div class="detail-banner" style="background:'+grad(c)+'"></div>'+
    '<div class="detail-head"><div class="detail-avatar" style="'+(c.avatarUrl?'':'background:'+grad(c,45))+'">'+(c.avatarUrl?'<img src="'+esc(c.avatarUrl)+'" alt="">':'♪')+'</div>'+
      '<div class="detail-title"><h2>'+esc(c.nickname||c.uniqueId)+' '+tiktokTierBadge(c)+(c.verified?' <span class="badge badge-rising">✔ 인증</span>':'')+'</h2><div class="card-handle">@'+esc(c.uniqueId)+(c.category?' · '+esc(c.category):'')+'</div></div></div>'+
    '<p class="detail-desc">'+esc(c.bio)+'</p>'+
    '<div class="stat-row">'+
      '<div class="stat-box"><div class="label">팔로워</div><div class="value">'+fmt(c.followerCount)+'</div></div>'+
      '<div class="stat-box"><div class="label">팔로잉</div><div class="value">'+fmt(c.followingCount)+'</div></div>'+
      '<div class="stat-box"><div class="label">좋아요 합계</div><div class="value">'+fmt(c.heartCount)+'</div></div>'+
      '<div class="stat-box"><div class="label">업로드 영상</div><div class="value">'+fmt(c.videoCount)+'개</div></div>'+
      '<div class="stat-box"><div class="label">가입일</div><div class="value" style="font-size:17px">'+fmtDate(c.createdAt)+'</div><div class="sub">'+ageText(c.createdAt)+'</div></div>'+
    '</div>'+
    '<h3 class="section-title">🔗 틱톡에서 열기</h3><div class="video-list"><a class="video-item" href="'+esc(c.profileUrl)+'" target="_blank" rel="noopener"><div class="video-rank top">▶</div><div class="video-meta"><div class="video-title">틱톡에서 이 크리에이터 프로필 열기</div><div class="video-sub"><span>영상 목록·댓글은 파일럿 범위에서 미지원</span></div></div></a></div>';
}

function fillTiktokCategories(){ const sel=$('#tiktok-cat-select'); sel.innerHTML='<option value="">모든 카테고리</option>'; for(const c of TIKTOK.categories){ const o=document.createElement('option'); o.value=c; o.textContent=c+' ('+TIKTOK.creators.filter((x)=>x.category===c).length+')'; sel.appendChild(o);} }

// ---- 페이스북 카드/그리드/상세 ----
function facebookTierBadge(c){ const cls={mega:'badge-mega',large:'badge-large',medium:'badge-medium',small:'badge-small'}[c.tier]||'badge-small'; return '<span class="badge '+cls+'">'+esc(c.tierLabel)+'</span>'; }

function facebookCardHtml(c){
  return '<article class="channel-card facebook-card" data-id="'+esc(c.uniqueId)+'">'+
    '<div class="mini-home"><div class="mini-banner" style="background:'+grad(c)+'">'+
      '<div class="card-badges">'+facebookTierBadge(c)+'</div>'+
      '<div class="mini-avatar" style="'+(c.avatarUrl?'':'background:'+grad(c,45))+'">'+(c.avatarUrl?'<img src="'+esc(c.avatarUrl)+'" alt="">':'f')+'</div>'+
    '</div></div>'+
    '<div class="card-body"><div class="card-name">'+esc(c.nickname||c.uniqueId)+'</div>'+
      '<div class="card-handle">@'+esc(c.uniqueId)+(c.category?' · '+esc(c.category):'')+'</div>'+
      '<div class="card-stats"><span>팔로워 <b>'+fmt(c.followerCount)+'</b></span><span>좋아요 <b>'+fmt(c.likeCount)+'</b></span></div>'+
    '</div></article>';
}
function bindFacebookCards(root){ root.querySelectorAll('.facebook-card').forEach((c)=>c.addEventListener('click',()=>{location.hash='#/facebook/creator/'+encodeURIComponent(c.dataset.id);})); }

function renderFacebookGrid(){
  const tgrid=$('#facebook-grid'); const tinfo=$('#facebook-result-info');
  let list=FACEBOOK.creators.slice();
  if(facebookState.q){ const n=facebookState.q.toLowerCase(); list=list.filter((c)=>(c.nickname||'').toLowerCase().includes(n)||(c.uniqueId||'').toLowerCase().includes(n)||(c.category||'').toLowerCase().includes(n)); }
  if(facebookState.cat) list=list.filter((c)=>c.category===facebookState.cat);
  if(facebookState.tier) list=list.filter((c)=>c.tier===facebookState.tier);
  if(facebookState.sort==='facebook') list.sort((a,b)=>(b.likeCount||0)-(a.likeCount||0));
  else list.sort((a,b)=>(b.followerCount||0)-(a.followerCount||0));

  const tierName={'':'전체',mega:'메가',large:'대형',medium:'중형',small:'소형'}[facebookState.tier];
  let info=tierName+' 크리에이터 '+list.length+'명'; if(facebookState.cat)info+=' · '+facebookState.cat; if(facebookState.q)info+=' · "'+facebookState.q+'" 검색';
  tinfo.textContent=info;
  if(!list.length){ tgrid.innerHTML='<div class="empty">조건에 맞는 크리에이터가 없습니다 😢</div>'; return; }
  tgrid.innerHTML=list.map(facebookCardHtml).join('');
  bindFacebookCards(tgrid);
}

function renderFacebookDetail(c){
  facebookDetailView.innerHTML=
    '<button class="back-btn" onclick="location.hash='+"'#/facebook'"+'">← 목록으로</button>'+
    '<div class="detail-banner" style="background:'+grad(c)+'"></div>'+
    '<div class="detail-head"><div class="detail-avatar" style="'+(c.avatarUrl?'':'background:'+grad(c,45))+'">'+(c.avatarUrl?'<img src="'+esc(c.avatarUrl)+'" alt="">':'f')+'</div>'+
      '<div class="detail-title"><h2>'+esc(c.nickname||c.uniqueId)+' '+facebookTierBadge(c)+'</h2><div class="card-handle">@'+esc(c.uniqueId)+(c.category?' · '+esc(c.category):'')+'</div></div></div>'+
    '<p class="detail-desc">'+esc(c.bio)+'</p>'+
    '<div class="stat-row">'+
      '<div class="stat-box"><div class="label">팔로워</div><div class="value">'+fmt(c.followerCount)+'</div></div>'+
      '<div class="stat-box"><div class="label">좋아요 수</div><div class="value">'+fmt(c.likeCount)+'</div></div>'+
    '</div>'+
    '<h3 class="section-title">🔗 페이스북에서 열기</h3><div class="video-list"><a class="video-item" href="'+esc(c.profileUrl)+'" target="_blank" rel="noopener"><div class="video-rank top">▶</div><div class="video-meta"><div class="video-title">페이스북에서 이 크리에이터 프로필 열기</div><div class="video-sub"><span>개별 게시물 본문은 파일럿 범위에서 미지원</span></div></div></a></div>';
}

function fillFacebookCategories(){ const sel=$('#facebook-cat-select'); sel.innerHTML='<option value="">모든 카테고리</option>'; for(const c of FACEBOOK.categories){ const o=document.createElement('option'); o.value=c; o.textContent=c+' ('+FACEBOOK.creators.filter((x)=>x.category===c).length+')'; sel.appendChild(o);} }

// ---- 인스타그램 카드/그리드/상세 ----
function instagramTierBadge(c){ const cls={mega:'badge-mega',large:'badge-large',medium:'badge-medium',small:'badge-small'}[c.tier]||'badge-small'; return '<span class="badge '+cls+'">'+esc(c.tierLabel)+'</span>'; }

function instagramCardHtml(c){
  return '<article class="channel-card instagram-card" data-id="'+esc(c.uniqueId)+'">'+
    '<div class="mini-home"><div class="mini-banner" style="background:'+grad(c)+'">'+
      '<div class="card-badges">'+instagramTierBadge(c)+'</div>'+
      '<div class="mini-avatar" style="'+(c.avatarUrl?'':'background:'+grad(c,45))+'">'+(c.avatarUrl?'<img src="'+esc(c.avatarUrl)+'" alt="">':'📷')+'</div>'+
    '</div></div>'+
    '<div class="card-body"><div class="card-name">'+esc(c.nickname||c.uniqueId)+'</div>'+
      '<div class="card-handle">@'+esc(c.uniqueId)+(c.category?' · '+esc(c.category):'')+'</div>'+
      '<div class="card-stats"><span>팔로워 <b>'+fmt(c.followerCount)+'</b></span><span>게시물 <b>'+fmt(c.postCount)+'</b></span></div>'+
    '</div></article>';
}
function bindInstagramCards(root){ root.querySelectorAll('.instagram-card').forEach((c)=>c.addEventListener('click',()=>{location.hash='#/instagram/creator/'+encodeURIComponent(c.dataset.id);})); }

function renderInstagramGrid(){
  const tgrid=$('#instagram-grid'); const tinfo=$('#instagram-result-info');
  let list=INSTAGRAM.creators.slice();
  if(instagramState.q){ const n=instagramState.q.toLowerCase(); list=list.filter((c)=>(c.nickname||'').toLowerCase().includes(n)||(c.uniqueId||'').toLowerCase().includes(n)||(c.category||'').toLowerCase().includes(n)); }
  if(instagramState.cat) list=list.filter((c)=>c.category===instagramState.cat);
  if(instagramState.tier) list=list.filter((c)=>c.tier===instagramState.tier);
  if(instagramState.sort==='posts') list.sort((a,b)=>(b.postCount||0)-(a.postCount||0));
  else list.sort((a,b)=>(b.followerCount||0)-(a.followerCount||0));

  const tierName={'':'전체',mega:'메가',large:'대형',medium:'중형',small:'소형'}[instagramState.tier];
  let info=tierName+' 크리에이터 '+list.length+'명'; if(instagramState.cat)info+=' · '+instagramState.cat; if(instagramState.q)info+=' · "'+instagramState.q+'" 검색';
  tinfo.textContent=info;
  if(!list.length){ tgrid.innerHTML='<div class="empty">조건에 맞는 크리에이터가 없습니다 😢</div>'; return; }
  tgrid.innerHTML=list.map(instagramCardHtml).join('');
  bindInstagramCards(tgrid);
}

function renderInstagramDetail(c){
  instagramDetailView.innerHTML=
    '<button class="back-btn" onclick="location.hash='+"'#/instagram'"+'">← 목록으로</button>'+
    '<div class="detail-banner" style="background:'+grad(c)+'"></div>'+
    '<div class="detail-head"><div class="detail-avatar" style="'+(c.avatarUrl?'':'background:'+grad(c,45))+'">'+(c.avatarUrl?'<img src="'+esc(c.avatarUrl)+'" alt="">':'📷')+'</div>'+
      '<div class="detail-title"><h2>'+esc(c.nickname||c.uniqueId)+' '+instagramTierBadge(c)+'</h2><div class="card-handle">@'+esc(c.uniqueId)+(c.category?' · '+esc(c.category):'')+'</div></div></div>'+
    '<p class="detail-desc">'+esc(c.bio)+'</p>'+
    '<div class="stat-row">'+
      '<div class="stat-box"><div class="label">팔로워</div><div class="value">'+fmt(c.followerCount)+'</div></div>'+
      '<div class="stat-box"><div class="label">팔로잉</div><div class="value">'+fmt(c.followingCount)+'</div></div>'+
      '<div class="stat-box"><div class="label">게시물 수</div><div class="value">'+fmt(c.postCount)+'</div></div>'+
    '</div>'+
    '<h3 class="section-title">🔗 인스타그램에서 열기</h3><div class="video-list"><a class="video-item" href="'+esc(c.profileUrl)+'" target="_blank" rel="noopener"><div class="video-rank top">▶</div><div class="video-meta"><div class="video-title">인스타그램에서 이 크리에이터 프로필 열기</div><div class="video-sub"><span>개별 게시물 본문은 파일럿 범위에서 미지원</span></div></div></a></div>';
}

function fillInstagramCategories(){ const sel=$('#instagram-cat-select'); sel.innerHTML='<option value="">모든 카테고리</option>'; for(const c of INSTAGRAM.categories){ const o=document.createElement('option'); o.value=c; o.textContent=c+' ('+INSTAGRAM.creators.filter((x)=>x.category===c).length+')'; sel.appendChild(o);} }

// ---- 랜딩 ----
function animateStat(el, target){
  if(el.dataset.animated===String(target))return; // 같은 값이면 재애니메이션 생략
  el.dataset.animated=String(target);
  const dur=700; const t0=performance.now();
  function tick(now){
    const p=Math.min(1,(now-t0)/dur);
    const eased=1-Math.pow(1-p,3);
    el.textContent=fmt(Math.round(target*eased));
    if(p<1)requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderLanding(){
  const ySubs=DATA.channels.reduce((s,c)=>s+(c.subscribers||0),0);
  const yViews=DATA.channels.reduce((s,c)=>s+(c.totalViews||0),0);
  animateStat($('.platform-stat-value[data-stat="channels"]'), DATA.channels.length);
  animateStat($('.platform-stat-value[data-stat="subs"]'), ySubs);
  animateStat($('.platform-stat-value[data-stat="views"]'), yViews);

  const tFollowers=TIKTOK.creators.reduce((s,c)=>s+(c.followerCount||0),0);
  const tHearts=TIKTOK.creators.reduce((s,c)=>s+(c.heartCount||0),0);
  animateStat($('.platform-stat-value[data-stat="creators"]'), TIKTOK.creators.length);
  animateStat($('.platform-stat-value[data-stat="followers"]'), tFollowers);
  animateStat($('.platform-stat-value[data-stat="hearts"]'), tHearts);

  const thFollowers=FACEBOOK.creators.reduce((s,c)=>s+(c.followerCount||0),0);
  const thFacebook=FACEBOOK.creators.reduce((s,c)=>s+(c.likeCount||0),0);
  animateStat($('.platform-stat-value[data-stat="fb-creators"]'), FACEBOOK.creators.length);
  animateStat($('.platform-stat-value[data-stat="fb-followers"]'), thFollowers);
  animateStat($('.platform-stat-value[data-stat="fb-likes"]'), thFacebook);

  const iFollowers=INSTAGRAM.creators.reduce((s,c)=>s+(c.followerCount||0),0);
  const iPosts=INSTAGRAM.creators.reduce((s,c)=>s+(c.postCount||0),0);
  animateStat($('.platform-stat-value[data-stat="ig-creators"]'), INSTAGRAM.creators.length);
  animateStat($('.platform-stat-value[data-stat="ig-followers"]'), iFollowers);
  animateStat($('.platform-stat-value[data-stat="ig-posts"]'), iPosts);

  const times=[DATA.updatedAt, TIKTOK.updatedAt, FACEBOOK.updatedAt, INSTAGRAM.updatedAt].filter(Boolean);
  const latest=times.length?new Date(Math.max(...times.map((t)=>new Date(t).getTime()))):null;
  $('#landing-updated').textContent=latest?'마지막 데이터 갱신: '+latest.getFullYear()+'년 '+(latest.getMonth()+1)+'월 '+latest.getDate()+'일 '+String(latest.getHours()).padStart(2,'0')+':'+String(latest.getMinutes()).padStart(2,'0'):'';
}

function setChrome(view){
  // view: 'landing' | 'youtube' | 'tiktok' | 'facebook' | 'instagram'
  searchWrap.hidden = view!=='youtube';
  if(view==='youtube') modeBadge.textContent='💾 오프라인 · '+fmt(DATA.channels.length)+'개 채널';
  else if(view==='tiktok') modeBadge.textContent='💾 오프라인 · '+fmt(TIKTOK.creators.length)+'명 크리에이터 (파일럿)';
  else if(view==='facebook') modeBadge.textContent='💾 오프라인 · '+fmt(FACEBOOK.creators.length)+'명 크리에이터 (파일럿)';
  else if(view==='instagram') modeBadge.textContent='💾 오프라인 · '+fmt(INSTAGRAM.creators.length)+'명 크리에이터 (파일럿)';
  else modeBadge.textContent='💾 오프라인 저장본';
}

function route(){
  const hash=location.hash||'#/';
  let m;
  if(hash==='#/'){
    showOnly(landingView); setChrome('landing'); renderLanding(); window.scrollTo(0,0); return;
  }
  if((m=hash.match(/^#\/youtube\/channel\/(.+)$/))){
    const id=decodeURIComponent(m[1]); const ch=DATA.channels.find((c)=>c.id===id);
    showOnly(detailView); setChrome('youtube');
    if(ch)renderDetail(ch); else detailView.innerHTML='<button class="back-btn" onclick="location.hash='+"'#/youtube'"+'">← 목록으로</button><div class="empty">채널을 찾을 수 없습니다.</div>';
    window.scrollTo(0,0); return;
  }
  if(hash==='#/youtube'){ showOnly(listView); setChrome('youtube'); renderView(); return; }
  if((m=hash.match(/^#\/tiktok\/creator\/(.+)$/))){
    const id=decodeURIComponent(m[1]); const c=TIKTOK.creators.find((x)=>x.id===id);
    showOnly(tiktokDetailView); setChrome('tiktok');
    if(c)renderTiktokDetail(c); else tiktokDetailView.innerHTML='<button class="back-btn" onclick="location.hash='+"'#/tiktok'"+'">← 목록으로</button><div class="empty">크리에이터를 찾을 수 없습니다.</div>';
    window.scrollTo(0,0); return;
  }
  if(hash==='#/tiktok'){ showOnly(tiktokView); setChrome('tiktok'); renderTiktokGrid(); return; }
  if((m=hash.match(/^#\/facebook\/creator\/(.+)$/))){
    const id=decodeURIComponent(m[1]); const c=FACEBOOK.creators.find((x)=>x.uniqueId===id);
    showOnly(facebookDetailView); setChrome('facebook');
    if(c)renderFacebookDetail(c); else facebookDetailView.innerHTML='<button class="back-btn" onclick="location.hash='+"'#/facebook'"+'">← 목록으로</button><div class="empty">크리에이터를 찾을 수 없습니다.</div>';
    window.scrollTo(0,0); return;
  }
  if(hash==='#/facebook'){ showOnly(facebookView); setChrome('facebook'); renderFacebookGrid(); return; }
  if((m=hash.match(/^#\/instagram\/creator\/(.+)$/))){
    const id=decodeURIComponent(m[1]); const c=INSTAGRAM.creators.find((x)=>x.uniqueId===id);
    showOnly(instagramDetailView); setChrome('instagram');
    if(c)renderInstagramDetail(c); else instagramDetailView.innerHTML='<button class="back-btn" onclick="location.hash='+"'#/instagram'"+'">← 목록으로</button><div class="empty">크리에이터를 찾을 수 없습니다.</div>';
    window.scrollTo(0,0); return;
  }
  if(hash==='#/instagram'){ showOnly(instagramView); setChrome('instagram'); renderInstagramGrid(); return; }
  location.hash='#/';
}

function fillCategories(){ const sel=$('#cat-select'); for(const c of DATA.categories){ const o=document.createElement('option'); o.value=c; o.textContent=c+' ('+DATA.channels.filter((x)=>x.category===c).length+')'; sel.appendChild(o);} }

$('#tier-tabs').addEventListener('click',(e)=>{ const b=e.target.closest('.tab'); if(!b)return; document.querySelectorAll('.tab').forEach((t)=>t.classList.remove('active')); b.classList.add('active'); state.tier=b.dataset.tier; if(location.hash!=='#/youtube')location.hash='#/youtube'; else renderView(); });
$('#sort-select').addEventListener('change',(e)=>{ state.sort=e.target.value; renderView(); });
$('#cat-select').addEventListener('change',(e)=>{ state.cat=e.target.value; renderView(); });
function doSearch(){ state.q=searchInput.value.trim(); if(location.hash!=='#/youtube')location.hash='#/youtube'; else renderView(); }
$('#search-btn').addEventListener('click',doSearch);
searchInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter')doSearch(); });

$('#tiktok-tier-tabs').addEventListener('click',(e)=>{ const b=e.target.closest('.tab'); if(!b)return; $('#tiktok-tier-tabs').querySelectorAll('.tab').forEach((t)=>t.classList.remove('active')); b.classList.add('active'); tiktokState.tier=b.dataset.tier; renderTiktokGrid(); });
$('#tiktok-sort-select').addEventListener('change',(e)=>{ tiktokState.sort=e.target.value; renderTiktokGrid(); });
$('#tiktok-cat-select').addEventListener('change',(e)=>{ tiktokState.cat=e.target.value; renderTiktokGrid(); });

$('#facebook-tier-tabs').addEventListener('click',(e)=>{ const b=e.target.closest('.tab'); if(!b)return; $('#facebook-tier-tabs').querySelectorAll('.tab').forEach((t)=>t.classList.remove('active')); b.classList.add('active'); facebookState.tier=b.dataset.tier; renderFacebookGrid(); });
$('#facebook-sort-select').addEventListener('change',(e)=>{ facebookState.sort=e.target.value; renderFacebookGrid(); });
$('#facebook-cat-select').addEventListener('change',(e)=>{ facebookState.cat=e.target.value; renderFacebookGrid(); });

$('#instagram-tier-tabs').addEventListener('click',(e)=>{ const b=e.target.closest('.tab'); if(!b)return; $('#instagram-tier-tabs').querySelectorAll('.tab').forEach((t)=>t.classList.remove('active')); b.classList.add('active'); instagramState.tier=b.dataset.tier; renderInstagramGrid(); });
$('#instagram-sort-select').addEventListener('change',(e)=>{ instagramState.sort=e.target.value; renderInstagramGrid(); });
$('#instagram-cat-select').addEventListener('change',(e)=>{ instagramState.cat=e.target.value; renderInstagramGrid(); });

window.addEventListener('hashchange',route);

fillCategories(); fillTiktokCategories(); fillFacebookCategories(); fillInstagramCategories(); route();
`;

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>채널스코프 대시보드 (오프라인)</title>
<style>
${css}
</style>
</head>
<body>
<header class="topbar">
  <a class="logo" href="#/" id="logo"><span class="logo-mark">▶</span><span class="logo-text">채널스코프</span></a>
  <div class="search-wrap" id="search-wrap"><input id="search-input" type="search" placeholder="채널 이름, 핸들, 카테고리 검색..." autocomplete="off" /><button id="search-btn" title="검색">🔍</button></div>
  <span class="mode-badge" id="mode-badge"></span>
</header>
<main id="app">
  <section id="landing-view">
    <div class="hero"><h1>크리에이터 탐색기</h1><p>플랫폼을 선택하면 수집된 채널·크리에이터를 볼 수 있습니다</p></div>
    <div class="platform-grid">
      <a class="platform-card" href="#/youtube" id="platform-youtube">
        <div class="platform-icon platform-icon-youtube">▶</div>
        <div class="platform-name">유튜브</div>
        <div class="platform-desc">국내 채널 구독자·조회수·인기영상·댓글 감성분석</div>
        <div class="platform-stat-row" id="platform-youtube-stats">
          <div class="platform-stat"><div class="platform-stat-value" data-stat="channels">0</div><div class="platform-stat-label">채널 수</div></div>
          <div class="platform-stat"><div class="platform-stat-value" data-stat="subs">0</div><div class="platform-stat-label">구독자 합계</div></div>
          <div class="platform-stat"><div class="platform-stat-value" data-stat="views">0</div><div class="platform-stat-label">조회수 합계</div></div>
        </div>
      </a>
      <a class="platform-card" href="#/tiktok" id="platform-tiktok">
        <div class="platform-icon platform-icon-tiktok">♪</div>
        <div class="platform-name">틱톡 <span class="badge badge-pilot">파일럿</span></div>
        <div class="platform-desc">국내 추정 크리에이터 팔로워·좋아요 통계 (영상/댓글 미지원)</div>
        <div class="platform-stat-row" id="platform-tiktok-stats">
          <div class="platform-stat"><div class="platform-stat-value" data-stat="creators">0</div><div class="platform-stat-label">크리에이터 수</div></div>
          <div class="platform-stat"><div class="platform-stat-value" data-stat="followers">0</div><div class="platform-stat-label">팔로워 합계</div></div>
          <div class="platform-stat"><div class="platform-stat-value" data-stat="hearts">0</div><div class="platform-stat-label">좋아요 합계</div></div>
        </div>
      </a>
      <a class="platform-card" href="#/facebook" id="platform-facebook">
        <div class="platform-icon platform-icon-facebook">f</div>
        <div class="platform-name">페이스북 <span class="badge badge-pilot">파일럿</span></div>
        <div class="platform-desc">국내 추정 크리에이터 팔로워·좋아요수 통계 (게시물 본문 미지원)</div>
        <div class="platform-stat-row" id="platform-facebook-stats">
          <div class="platform-stat"><div class="platform-stat-value" data-stat="fb-creators">0</div><div class="platform-stat-label">크리에이터 수</div></div>
          <div class="platform-stat"><div class="platform-stat-value" data-stat="fb-followers">0</div><div class="platform-stat-label">팔로워 합계</div></div>
          <div class="platform-stat"><div class="platform-stat-value" data-stat="fb-likes">0</div><div class="platform-stat-label">좋아요 합계</div></div>
        </div>
      </a>
      <a class="platform-card" href="#/instagram" id="platform-instagram">
        <div class="platform-icon platform-icon-instagram">📷</div>
        <div class="platform-name">인스타그램 <span class="badge badge-pilot">파일럿</span></div>
        <div class="platform-desc">국내 추정 크리에이터 팔로워·게시물수 통계 (게시물 본문 미지원)</div>
        <div class="platform-stat-row" id="platform-instagram-stats">
          <div class="platform-stat"><div class="platform-stat-value" data-stat="ig-creators">0</div><div class="platform-stat-label">크리에이터 수</div></div>
          <div class="platform-stat"><div class="platform-stat-value" data-stat="ig-followers">0</div><div class="platform-stat-label">팔로워 합계</div></div>
          <div class="platform-stat"><div class="platform-stat-value" data-stat="ig-posts">0</div><div class="platform-stat-label">게시물 합계</div></div>
        </div>
      </a>
    </div>
    <div class="landing-updated" id="landing-updated"></div>
  </section>
  <section id="list-view" hidden>
    <div class="hero"><h1>국내 채널 대시보드</h1><p>대한민국으로 확인된 채널만 구독자 순으로 정렬한 오프라인 저장본</p></div>
    <div class="controls">
      <nav class="tier-tabs" id="tier-tabs">
        <button class="tab active" data-tier="">전체</button>
        <button class="tab tab-rising" data-tier="rising">🚀 급상승</button>
        <button class="tab" data-tier="mega">💎 메가 <small>500만+</small></button>
        <button class="tab" data-tier="large">🏆 대형 <small>100만+</small></button>
        <button class="tab" data-tier="medium">⭐ 중형 <small>10만+</small></button>
        <button class="tab" data-tier="small">🌱 소형</button>
      </nav>
      <select id="cat-select"><option value="">모든 카테고리</option></select>
      <select id="sort-select"><option value="subscribers">구독자순</option><option value="views">총 조회수순</option><option value="newest">최신 개설순</option></select>
      <span class="export-links"><a class="export-xlsx" href="./${XLSX_NAME}" download title="현재 백데이터 전체를 엑셀 파일로 다운로드">📊 엑셀 다운로드</a></span>
    </div>
    <div id="result-info" class="result-info"></div>
    <div id="channel-grid" class="channel-grid"></div>
  </section>
  <section id="detail-view" hidden></section>
  <section id="tiktok-view" hidden>
    <div class="hero"><h1>틱톡 크리에이터 <span class="badge badge-pilot">파일럿</span></h1><p>국내 추정 크리에이터를 팔로워 순으로 정렬 (영상 목록·댓글은 미지원)</p></div>
    <div class="controls">
      <nav class="tier-tabs" id="tiktok-tier-tabs">
        <button class="tab active" data-tier="">전체</button>
        <button class="tab" data-tier="mega">💎 메가 <small>500만+</small></button>
        <button class="tab" data-tier="large">🏆 대형 <small>100만+</small></button>
        <button class="tab" data-tier="medium">⭐ 중형 <small>10만+</small></button>
        <button class="tab" data-tier="small">🌱 소형</button>
      </nav>
      <select id="tiktok-cat-select"><option value="">모든 카테고리</option></select>
      <select id="tiktok-sort-select"><option value="followers">팔로워순</option><option value="hearts">좋아요합계순</option><option value="videos">영상수순</option></select>
      <span class="export-links"><a class="export-xlsx" href="./${TIKTOK_XLSX_NAME}" download title="틱톡 크리에이터 백데이터만 엑셀 파일로 다운로드">📊 엑셀 다운로드</a></span>
    </div>
    <div id="tiktok-result-info" class="result-info"></div>
    <div id="tiktok-grid" class="channel-grid"></div>
  </section>
  <section id="tiktok-detail-view" hidden></section>
  <section id="facebook-view" hidden>
    <div class="hero"><h1>페이스북 크리에이터 <span class="badge badge-pilot">파일럿</span></h1><p>국내 추정 크리에이터를 팔로워 순으로 정렬 (개별 게시물 본문은 미지원)</p></div>
    <div class="controls">
      <nav class="tier-tabs" id="facebook-tier-tabs">
        <button class="tab active" data-tier="">전체</button>
        <button class="tab" data-tier="mega">💎 메가 <small>500만+</small></button>
        <button class="tab" data-tier="large">🏆 대형 <small>100만+</small></button>
        <button class="tab" data-tier="medium">⭐ 중형 <small>10만+</small></button>
        <button class="tab" data-tier="small">🌱 소형</button>
      </nav>
      <select id="facebook-cat-select"><option value="">모든 카테고리</option></select>
      <select id="facebook-sort-select"><option value="followers">팔로워순</option><option value="facebook">좋아요순</option></select>
      <span class="export-links"><a class="export-xlsx" href="./${FACEBOOK_XLSX_NAME}" download title="페이스북 크리에이터 백데이터만 엑셀 파일로 다운로드">📊 엑셀 다운로드</a></span>
    </div>
    <div id="facebook-result-info" class="result-info"></div>
    <div id="facebook-grid" class="channel-grid"></div>
  </section>
  <section id="facebook-detail-view" hidden></section>
  <section id="instagram-view" hidden>
    <div class="hero"><h1>인스타그램 크리에이터 <span class="badge badge-pilot">파일럿</span></h1><p>국내 추정 크리에이터를 팔로워 순으로 정렬 (게시물 본문은 미지원)</p></div>
    <div class="controls">
      <nav class="tier-tabs" id="instagram-tier-tabs">
        <button class="tab active" data-tier="">전체</button>
        <button class="tab" data-tier="mega">💎 메가 <small>500만+</small></button>
        <button class="tab" data-tier="large">🏆 대형 <small>100만+</small></button>
        <button class="tab" data-tier="medium">⭐ 중형 <small>10만+</small></button>
        <button class="tab" data-tier="small">🌱 소형</button>
      </nav>
      <select id="instagram-cat-select"><option value="">모든 카테고리</option></select>
      <select id="instagram-sort-select"><option value="followers">팔로워순</option><option value="posts">게시물수순</option></select>
      <span class="export-links"><a class="export-xlsx" href="./${INSTAGRAM_XLSX_NAME}" download title="인스타그램 크리에이터 백데이터만 엑셀 파일로 다운로드">📊 엑셀 다운로드</a></span>
    </div>
    <div id="instagram-result-info" class="result-info"></div>
    <div id="instagram-grid" class="channel-grid"></div>
  </section>
  <section id="instagram-detail-view" hidden></section>
</main>
<footer class="footer">채널스코프 대시보드 · 백엔드 수집 데이터를 파일에 내장 · 서버 없이 동작</footer>
<script>window.__CHANNELS__ = ${dataJson};</script>
<script>window.__TIKTOK__ = ${tiktokJson};</script>
<script>window.__FACEBOOK__ = ${facebookJson};</script>
<script>window.__INSTAGRAM__ = ${instagramJson};</script>
<script>${appJs}</script>
</body>
</html>`;

for (const out of [path.join(DIR, '채널스코프.html'), path.join(os.homedir(), 'Desktop', '채널스코프.html')]) {
  fs.writeFileSync(out, html);
  fs.writeFileSync(path.join(path.dirname(out), XLSX_NAME), workbookBuffer);
  fs.writeFileSync(path.join(path.dirname(out), TIKTOK_XLSX_NAME), tiktokWorkbookBuffer);
  fs.writeFileSync(path.join(path.dirname(out), FACEBOOK_XLSX_NAME), facebookWorkbookBuffer);
  fs.writeFileSync(path.join(path.dirname(out), INSTAGRAM_XLSX_NAME), instagramWorkbookBuffer);
  console.log('생성:', out, '(' + (html.length / 1024 / 1024).toFixed(2) + 'MB)');
}
console.log('채널:', channels.length, '| 카테고리:', categories.length,
  '| 등급:', JSON.stringify(tierCount));
console.log('엑셀:', XLSX_NAME, '(' + (workbookBuffer.length / 1024 / 1024).toFixed(2) + 'MB)');
console.log('틱톡:', tiktokCreators.length, '명 |', TIKTOK_XLSX_NAME,
  '(' + (tiktokWorkbookBuffer.length / 1024 / 1024).toFixed(2) + 'MB)');
console.log('페이스북:', facebookCreators.length, '명 |', FACEBOOK_XLSX_NAME,
  '(' + (facebookWorkbookBuffer.length / 1024 / 1024).toFixed(2) + 'MB)');
console.log('인스타그램:', instagramCreators.length, '명 |', INSTAGRAM_XLSX_NAME,
  '(' + (instagramWorkbookBuffer.length / 1024 / 1024).toFixed(2) + 'MB)');
