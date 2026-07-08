/**
 * API 키 없이 유튜브 데이터를 가져오는 모듈.
 *
 * 유튜브 웹사이트가 내부적으로 사용하는 공개 엔드포인트(youtubei/v1, Innertube)를
 * 그대로 호출합니다. API 키·로그인·쿠키가 전혀 필요 없습니다.
 * 유튜브 UI 개편으로 응답 구조가 바뀔 수 있으므로, 특정 경로에 의존하지 않고
 * JSON 트리를 깊이 탐색(findAll)하는 방식으로 최대한 방어적으로 파싱합니다.
 */
const INNERTUBE = 'https://www.youtube.com/youtubei/v1';
const CONTEXT = {
  client: { clientName: 'WEB', clientVersion: '2.20250620.00.00', hl: 'ko', gl: 'KR' },
};
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const COMMENT_LIMIT = 10;

async function yt(endpoint, body) {
  const res = await fetch(`${INNERTUBE}/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Accept-Language': 'ko',
    },
    body: JSON.stringify({ context: CONTEXT, ...body }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`유튜브 응답 오류 (${endpoint} ${res.status})`);
  return res.json();
}

// ---------- JSON 깊이 탐색 ----------
function findAll(obj, key, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 45) return out;
  if (Array.isArray(obj)) {
    for (const v of obj) findAll(v, key, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) out.push(v);
    findAll(v, key, out, depth + 1);
  }
  return out;
}
const findFirst = (obj, key) => findAll(obj, key)[0];

// ---------- 텍스트/숫자 파싱 ----------
function getText(t) {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  if (t.simpleText) return t.simpleText;
  if (t.runs) return t.runs.map((r) => r.text).join('');
  if (t.content) return t.content;
  return '';
}

/** "구독자 318만명", "조회수 5,829,366,593회", "3.2천", "1.2M" → 숫자 */
function parseCount(text) {
  const s = getText(text);
  if (!s) return null;
  const m = s.replace(/\s/g, '').match(/([\d,]+(?:\.\d+)?)(억|만|천|B|M|K|b|m|k)?/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  const mul = { 억: 1e8, 만: 1e4, 천: 1e3, B: 1e9, M: 1e6, K: 1e3, b: 1e9, m: 1e6, k: 1e3 }[m[2]] || 1;
  return Math.round(num * mul);
}

/** "가입일: 2014. 9. 30." → "2014-09-30" */
function parseJoinedDate(text) {
  const m = getText(text).match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function parseFirstMetric(strings, patterns) {
  for (const raw of strings) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = parseCount(match[1]);
      if (value != null) return value;
    }
  }
  return null;
}

function extractChannelMetrics(obj) {
  const strings = collectStrings(obj);
  return {
    channelLikes: parseFirstMetric(strings, [
      /(?:채널|전체|누적|총)\s*좋아요\s*([\d,]+(?:\.\d+)?\s*(?:억|만|천|B|M|K)?)/i,
      /(?:total|channel)\s+likes?\D*([\d,]+(?:\.\d+)?\s*(?:B|M|K)?)/i,
    ]),
  };
}

function mergeChannelMetrics(target, metrics) {
  if (metrics.channelLikes != null) target.channelLikes = metrics.channelLikes;
}

function fixUrl(u) {
  if (!u) return '';
  return u.startsWith('//') ? 'https:' + u : u;
}

/** 채널 ID 해시로 카드 그라데이션 색상 생성 (배너 없을 때 대비) */
function colorsFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [`hsl(${h % 360}, 65%, 50%)`, `hsl(${(h * 7) % 360}, 70%, 40%)`];
}

// ---------- 채널 검색 ----------
async function searchChannels(query, limit = 8) {
  const data = await yt('search', { query, params: 'EgIQAg==' }); // 채널만 필터
  return findAll(data, 'channelRenderer')
    .slice(0, limit)
    .map((c) => {
      // 현 유튜브 응답: subscriberCountText=핸들(@x), videoCountText=구독자수
      const texts = [getText(c.subscriberCountText), getText(c.videoCountText)];
      const handle = texts.find((t) => t.startsWith('@')) || '';
      const subText = texts.find((t) => /구독자|subscriber/.test(t)) || '';
      return {
        id: c.channelId,
        name: getText(c.title),
        handle,
        subscribers: parseCount(subText),
        avatarUrl: fixUrl(c.thumbnail?.thumbnails?.at(-1)?.url),
        description: getText(c.descriptionSnippet),
      };
    })
    .filter((c) => c.id);
}

// ---------- 채널 기본 정보 (구독자, 배너, 가입일, 총 조회수) ----------
async function getChannelCore(channelId) {
  const b = await yt('browse', { browseId: channelId });

  const meta = findFirst(b, 'channelMetadataRenderer') || {};
  const bannerSrc = findFirst(b, 'imageBannerViewModel')?.image?.sources?.at(-1)?.url;

  // 헤더의 문자열들에서 구독자/동영상 수 추출
  const headerTexts = findAll(b.header || {}, 'content').filter((t) => typeof t === 'string');
  const subText = headerTexts.find((t) => /구독자|subscriber/.test(t));
  const vidText = headerTexts.find((t) => /동영상|videos/.test(t));
  const handle = headerTexts.find((t) => t.startsWith('@')) || '';

  const ch = {
    id: channelId,
    name: meta.title || headerTexts[0] || '',
    handle,
    description: meta.description || '',
    avatarUrl: fixUrl(meta.avatar?.thumbnails?.[0]?.url),
    bannerUrl: fixUrl(bannerSrc),
    subscribers: parseCount(subText),
    videoCount: parseCount(vidText),
    totalViews: null,
    channelLikes: null,
    createdAt: null,
    country: null,
  };
  mergeChannelMetrics(ch, extractChannelMetrics(b));

  // About 패널 (가입일·총조회수): browse 응답의 continuation 토큰들을 순회하며 시도
  const tokens = findAll(b, 'continuationCommand').map((t) => t.token).filter(Boolean);
  for (const token of tokens.slice(0, 5)) {
    try {
      const r = await yt('browse', { browseId: channelId, continuation: token });
      const about = findFirst(r, 'aboutChannelViewModel');
      if (about) {
        ch.createdAt = parseJoinedDate(about.joinedDateText);
        ch.totalViews = parseCount(about.viewCountText);
        ch.country = getText(about.country) || null;
        if (about.videoCountText) ch.videoCount = parseCount(about.videoCountText) ?? ch.videoCount;
        if (about.subscriberCountText) ch.subscribers = parseCount(about.subscriberCountText) ?? ch.subscribers;
        mergeChannelMetrics(ch, extractChannelMetrics(r));
        break;
      }
    } catch { /* 다음 토큰 시도 */ }
  }
  return ch;
}

// ---------- 인기 영상 (동영상 탭 → '인기순' 칩) ----------
function parseLockup(l) {
  const metaTexts = findAll(l.metadata || {}, 'content').filter((t) => typeof t === 'string');
  const title = l.metadata?.lockupMetadataViewModel?.title?.content || metaTexts[0] || '';
  const viewText = metaTexts.find((t) => /조회수|views/.test(t)) || '';
  const whenText = metaTexts.find((t) => /전$|ago/.test(t)) || '';
  const badge = findAll(l, 'thumbnailBadgeViewModel')
    .map((x) => x.text)
    .find((t) => /^[\d:]+$/.test(t || ''));
  return {
    videoId: l.contentId,
    title,
    views: parseCount(viewText),
    likes: null, // 목록에서는 좋아요 수를 제공하지 않음
    publishedAt: whenText, // "5년 전" 같은 상대 시간
    duration: badge || '',
    thumbnail: fixUrl(l.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url),
  };
}

async function getPopularVideos(channelId, limit = 6) {
  const tab = await yt('browse', { browseId: channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' });
  let items = findAll(tab, 'lockupViewModel');

  // '인기순' 칩의 continuation으로 인기 정렬 목록 요청
  const chip = findAll(tab, 'chipViewModel').find((c) => /인기|Popular/i.test(c.text || ''));
  const token = chip && findFirst(chip, 'continuationCommand')?.token;
  if (token) {
    try {
      const pop = await yt('browse', { continuation: token });
      const popItems = findAll(pop, 'lockupViewModel');
      if (popItems.length) items = popItems;
    } catch { /* 실패 시 최신순으로 대체 */ }
  }

  const videos = items.map(parseLockup).filter((v) => v.videoId && v.title);
  if (!token) videos.sort((a, b) => (b.views || 0) - (a.views || 0)); // 칩 없으면 조회수로 정렬
  return videos.slice(0, limit);
}

// 객체 트리의 모든 문자열 값을 수집 (좋아요 라벨 탐색용)
function collectStrings(obj, out = [], depth = 0) {
  if (obj == null || depth > 45) return out;
  if (typeof obj === 'string') { out.push(obj); return out; }
  if (typeof obj !== 'object') return out;
  if (Array.isArray(obj)) { for (const v of obj) collectStrings(v, out, depth + 1); return out; }
  for (const v of Object.values(obj)) collectStrings(v, out, depth + 1);
  return out;
}

function fmtSeconds(sec) {
  sec = Number(sec) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (v) => String(v).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function commentReplyCount(payload) {
  const direct =
    parseCount(payload.toolbar?.replyCount) ??
    parseCount(payload.toolbar?.replyCountText) ??
    parseCount(payload.toolbar?.replyButton?.buttonRenderer?.text);
  if (direct != null) return direct;
  const text = collectStrings(payload.toolbar || payload)
    .find((s) => /답글|repl/i.test(String(s || '')) && /[\d,]/.test(String(s || '')));
  return parseCount(text) || 0;
}

// ---------- 영상 상세 (조회수·좋아요·댓글수·설명·태그·카테고리·업로드일 + 댓글) ----------
async function getVideoFull(videoId, commentLimit = COMMENT_LIMIT) {
  const out = {
    videoId, title: '', views: null, likes: null, commentCount: null,
    description: '', tags: [], category: '', uploadDate: '', duration: '',
    thumbnail: '', comments: [],
  };

  // 1) player: 제목·조회수·설명·태그·카테고리·업로드일·길이
  try {
    const p = await yt('player', { videoId });
    const vd = p.videoDetails || {};
    const mf = p.microformat?.playerMicroformatRenderer || {};
    out.title = vd.title || '';
    out.views = Number(vd.viewCount) || null;
    out.description = vd.shortDescription || '';
    out.tags = Array.isArray(vd.keywords) ? vd.keywords : [];
    out.category = mf.category || '';
    out.uploadDate = (mf.uploadDate || mf.publishDate || '').slice(0, 10);
    out.duration = vd.lengthSeconds ? fmtSeconds(vd.lengthSeconds) : '';
    out.thumbnail = fixUrl(vd.thumbnail?.thumbnails?.at(-1)?.url);
  } catch { /* 비공개/삭제 영상 */ }

  // 2) next(초기): 좋아요 수 라벨 + 댓글 continuation 토큰
  let commentToken = null;
  try {
    const n = await yt('next', { videoId });
    const strings = collectStrings(n);
    // "다른 사용자 146,378명과 함께..." 또는 "좋아요 32만개"
    for (const s of strings) {
      let m = s.match(/다른 사용자\s*([\d,]+)\s*명/);
      if (m) { out.likes = parseCount(m[1]); break; }
      m = s.match(/좋아요\s*([\d.,]+[만천억]?)\s*개/);
      if (m) { out.likes = parseCount(m[1]); break; }
    }
    const sections = findAll(n, 'itemSectionRenderer').filter((s) => s.sectionIdentifier === 'comment-item-section');
    commentToken = findFirst(sections, 'continuationCommand')?.token;
  } catch { /* next 실패 */ }

  // 3) next(댓글): 댓글 수 + 댓글 목록 (commentLimit개 모일 때까지 페이지네이션)
  if (commentToken) {
    const comments = [];
    const MAX_PAGES = Math.max(3, Math.ceil(commentLimit / 15) + 3); // 페이지당 대략 15~20개 기준 여유분 포함
    let token = commentToken;
    let pages = 0;
    while (token && comments.length < commentLimit && pages < MAX_PAGES) {
      let c;
      try { c = await yt('next', { continuation: token }); } catch { break; }
      pages++;
      if (out.commentCount == null) {
        const header = findFirst(c, 'commentsHeaderRenderer');
        const countText = header?.countText?.runs?.map((r) => r.text).join('') || '';
        out.commentCount = parseCount(countText);
      }
      const batch = findAll(c, 'commentEntityPayload')
        .map((p) => ({
          author: p.author?.displayName || '',
          text: p.properties?.content?.content || '',
          likes: parseCount(p.toolbar?.likeCountNotliked) || 0,
          replyCount: commentReplyCount(p),
          replies: [],
          publishedAt: p.properties?.publishedTime || '',
        }))
        .filter((c2) => c2.text);
      comments.push(...batch);
      // 다음 페이지 토큰: 여러 continuationCommand 중 마지막 항목이 보통 "더보기"(답글 토큰은 앞쪽에 위치)
      const nextTokens = findAll(c, 'continuationCommand').map((t) => t.token).filter(Boolean);
      const next = nextTokens.length ? nextTokens.at(-1) : null;
      if (!next || next === token) break; // 더 이상 페이지 없음 / 토큰 미갱신
      token = next;
    }
    out.comments = comments.slice(0, commentLimit);
  }

  return out;
}

module.exports = {
  searchChannels,
  getChannelCore,
  getPopularVideos,
  getVideoFull,
  colorsFor,
  COMMENT_LIMIT,
};
