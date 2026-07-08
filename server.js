/**
 * 유튜브 채널 탐색기 서버
 *
 * 실행: node server.js  (기본 포트 3456)
 *
 * API 키 없이 유튜브 내부 공개 엔드포인트를 사용합니다.
 * 시작 시 카테고리별 검색으로 채널 풀(100개 이상)을 수집해 data/pool.json에 저장하고,
 * 백그라운드에서 각 채널의 상세 정보(개설일·총조회수·배너)를 채워 넣습니다.
 *
 * 데모 데이터로 실행: DATA_MODE=mock node server.js
 * 풀 강제 재수집: REFRESH_POOL=1 node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const scraper = require('./scraper');
const { buildBackendWorkbook } = require('./export-workbook');

const PORT = process.env.PORT || 3456;
const MOCK_ONLY = process.env.DATA_MODE === 'mock';
const PUBLIC_DIR = path.join(__dirname, 'public');
const POOL_PATH = path.join(__dirname, 'data', 'pool.json');
const POOL_TTL = 24 * 60 * 60 * 1000; // 풀 재수집 주기: 24시간
const COMMENT_LIMIT = scraper.COMMENT_LIMIT || 10;
const DOMESTIC_COUNTRY = '대한민국';
const MOCK = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'mock-channels.json'), 'utf8')
);

// 채널 풀 수집용 카테고리 검색어 (카테고리당 상위 4개 채널 수집 → 총 100개 이상)
const CATEGORIES = [
  '먹방', '요리', '게임', '브이로그', '여행', '홈트레이닝', '축구', '야구',
  '골프', '낚시', '캠핑', '자동차', '테크 리뷰', '과학', '역사', '경제',
  '주식', '부동산', '코딩', 'AI', '영어공부', '공부', '음악', '커버곡',
  '댄스', '뷰티', '패션', '반려동물', '키즈', '영화리뷰', '드라마', '예능',
  '코미디', '인터뷰', '뉴스', '다큐', '미스터리', '쇼츠', '일상', '인테리어',
  // 메가급 채널이 잘 잡히는 검색어
  'KPOP', '아이돌', '동요', '뮤직비디오', '먹방 유튜버', '개그', '축구 하이라이트', '애니메이션',
  // 풀 확장 2차 (500개 목표)
  '개발자', '프로그래밍', '롤', '마인크래프트', '배틀그라운드', '모바일게임', '닌텐도', '피파',
  '디저트', '베이킹', '길거리음식', '맛집', '와인', '커피', '술먹방',
  '미니멀라이프', '자취', '육아', '시골생활', '전원주택', '청소',
  '심리학', '철학', '수학', '물리학', '우주', '의학', '건강', '한의학',
  '재테크', '창업', '자영업', '마케팅', '쇼핑몰',
  '변호사', '의사 브이로그', '간호사', '경찰', '소방관', '농부',
  '등산', '자전거', '러닝', '수영', '테니스', '배드민턴', '볼링', '당구', '바둑',
  '그림', '드로잉', '사진', '피아노', '기타 연주', '바이올린', '드럼', '작곡',
  '영화', '넷플릭스', '웹툰', '성우', '연기',
  '타로', '명상', '요가', '필라테스', '헬스', '보디빌딩', '격투기', '복싱',
  '전기차', '오토바이', '캠핑카', '고양이', '강아지 훈련', '파충류', '앵무새',
  '국내여행', '해외여행', '배낭여행', '수능', '한국사', '일본어', '중국어',
  '헤어', '네일', '다이어트',
  // 풀 확장 3차 (1000개 목표)
  '트로트', '발라드', '힙합', '랩', '재즈', '클래식', '인디음악', '밴드', '버스킹',
  '노래방', '가창력', '보컬', '색소폰', '첼로', '플루트', '하모니카', '국악',
  '롤토체스', '오버워치', '스타크래프트', '디아블로', '메이플스토리', '발로란트',
  '원신', '로블록스', '어몽어스', '피망', '스팀게임', '인디게임', '레트로게임',
  '공포게임', '방탈출', '보드게임', 'e스포츠',
  '한식', '중식', '일식', '양식', '분식', '비건', '홈베이킹', '수제버거',
  '라면', '치킨', '삼겹살', '해산물', '전통주', '칵테일', '홈카페', '다이어트요리',
  '자취요리', '도시락', '반찬', '김치', '빵', '케이크',
  '뷰티 유튜버', '메이크업', '스킨케어', '헤어스타일', '다이어트 브이로그',
  '패션 하울', '코디', '명품', '빈티지', '스니커즈', '시계', '주얼리',
  '홈트', '요가강사', '크로스핏', '마라톤', '클라이밍', '서핑', '스노보드', '스키',
  '스케이트보드', '농구', '배구', '탁구', '태권도', '유도', '검도', '주짓수',
  '프로그래밍 강의', '파이썬', '자바스크립트', '리액트', '데이터분석', '머신러닝',
  '챗GPT', '블록체인', '해킹', '보안', '리눅스', '클라우드', '앱개발', '게임개발',
  '유튜브 수익', 'N잡', '부업', '온라인쇼핑몰', '스마트스토어', '블로그', '디지털노마드',
  '주식투자', '코인', '비트코인', '선물옵션', '배당주', '미국주식', '연금', '세금',
  '보험', '대출', '신용카드', '경매', '청약',
  '과학실험', '천문학', '생물학', '화학', '지구과학', '공학', '건축', '로봇',
  '세계사', '전쟁사', '고전', '문학', '독서', '책리뷰', '시사', '정치', '토론',
  '경제뉴스', '부동산투자', '창업스토리', '성공스토리', '자기계발', '동기부여',
  '심리상담', '연애상담', '인간관계', '육아상담', '교육', '입시', '유학', '토익',
  '영어회화', '스페인어', '프랑스어', '독일어', '베트남어', '태국어',
  '캠핑 브이로그', '차박', '백패킹', '오토캠핑', '글램핑', '전국일주', '제주도',
  '유럽여행', '동남아여행', '미국여행', '일본여행', '세계여행', '기차여행', '크루즈',
  '반려견', '반려묘', '강아지 브이로그', '고양이 브이로그', '수족관', '열대어',
  '식물', '가드닝', '다육이', '텃밭', '시골 브이로그', '귀농', '전원생활',
  '인테리어 디자인', '셀프인테리어', '집꾸미기', '정리수납', '살림', '요리 브이로그',
  '직장인 브이로그', '대학생 브이로그', '워킹맘', '신혼부부', '결혼', '출산',
  '메이크업 튜토리얼', '패션쇼', '뷰티 리뷰', '언박싱', '제품리뷰', '가전리뷰',
  '스마트폰 리뷰', '노트북 리뷰', '카메라 리뷰', '자동차 리뷰', '오토바이 리뷰',
  'ASMR', '먹방 ASMR', '수면', '백색소음', '빗소리', '힐링음악', '명상음악',
  '실화', '사건사고', '범죄', '괴담', '공포', '심령', 'UFO', '음모론',
  '개그맨', '코미디언', '몰카', '챌린지', '리액션', '커플', '일상툰', '웹드라마',
  '숏폼', '틱톡', '릴스', '짤방', '하이라이트', '레전드', '명장면', '짤',
  '골프레슨', '스크린골프', '낚시 브이로그', '바다낚시', '민물낚시', '루어낚시',
  '드론', '항공촬영', '타임랩스', '브이로그 카메라', '영상편집', '프리미어',
  '포토샵', '일러스트', '캘리그라피', '수채화', '유화', '디지털드로잉', '웹툰작가',
  // 풀 확장 4차 (5000개 목표) — 지역/세부장르/롱테일
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '제주', '경기도', '강원도',
  '전라도', '경상도', '충청도', '수원', '성남', '고양', '용인', '창원', '천안', '청주',
  '트월킹', '왁킹', '팝핑', '비보이', '스트릿댄스', 'K팝댄스', '방송댄스', '커버댄스',
  '리듬게임', '액션게임', 'RPG게임', '시뮬레이션게임', '전략게임', '퍼즐게임', '레이싱게임',
  '콘솔게임', 'PC게임', '스팀', 'PS5', '엑스박스', '스위치게임', '모바일RPG',
  '홈스쿨링', '유아교육', '초등교육', '중등교육', '고등교육', '한자', '독서논술', '토론수업',
  '기초영어', '비즈니스영어', '여행영어', '생활영어', '영어원서', '영어듣기', '영어발음',
  '주식차트', '기술적분석', '가치투자', '단타', '스윙', '해외선물', 'ETF', '리츠',
  '연금저축', 'IRP', '절세', '가계부', '짠테크', '중고거래', '리셀',
  '홈트여자', '홈트남자', '전신운동', '복근운동', '하체운동', '스트레칭', '유산소', '다이어트식단',
  '벌크업', '린매스업', '단백질', '보충제', '운동루틴', 'PT', '체형교정',
  '자연요리', '집밥', '엄마요리', '아빠요리', '초보요리', '캠핑요리', '에어프라이어',
  '밀키트', '간편식', '건강식', '샐러드', '스무디', '주스', '전통차', '홈술',
  '캐릭터그림', '수묵화', '판화', '조각', '도예', '공예', '뜨개질', '자수', '가죽공예',
  '목공', 'DIY', '리폼', '핸드메이드', '비누만들기', '캔들', '플라워',
  '차량정비', '중고차', '수입차', '국산차', '튜닝', '세차', '드라이브', '카리뷰',
  '전기차리뷰', '캠핑카개조', '오토바이투어', '자전거여행', '로드바이크', 'MTB',
  '고양이집사', '강아지훈련사', '유기견', '동물병원', '펫케어', '햄스터', '고슴도치',
  '금붕어', '비단잉어', '식충식물', '분재', '허브', '베란다텃밭', '주말농장',
  '미니멀', '살림꿀팁', '수납정리', '냉장고정리', '옷장정리', '베이킹클래스',
  '신혼집', '자취방', '원룸인테리어', '아파트인테리어', '전셋집', '집들이',
  '연예뉴스', '아이돌직캠', '음악방송', '팬캠', '뮤직쇼', '콘서트', '페스티벌',
  '트로트가수', '발라드가수', '싱어송라이터', '작곡가', '프로듀서', '세션', '뮤지션',
  '스포츠뉴스', '해외축구', 'EPL', '라리가', '분데스리가', '챔피언스리그', 'MLB', 'NBA',
  '배구경기', '농구경기', '테니스경기', '골프대회', 'F1', '격투기경기', 'UFC',
  '역사다큐', '자연다큐', '과학다큐', '동물다큐', '우주다큐', '시사다큐', '탐사보도',
  '북리뷰', '자기계발서', '경제경영서', '에세이', '소설추천', '인문학', '고전읽기',
];
const PER_CATEGORY = 20;

// ---------- 등급 계산 ----------
const TIERS = {
  mega:   { key: 'mega',   label: '메가',   min: 5_000_000 },
  large:  { key: 'large',  label: '대형',   min: 1_000_000 },
  medium: { key: 'medium', label: '중형',   min: 100_000 },
  small:  { key: 'small',  label: '소형',   min: 0 },
};
const RISING_GROWTH = 8;        // 목데이터: 30일 성장률(%) 기준
const RISING_MAX_AGE_YEARS = 3; // 실데이터: 개설 3년 미만이면서
const RISING_MIN_SUBS = 50_000; //          구독자 5만 이상이면 급상승으로 판정

function tierOf(subscribers) {
  const s = subscribers || 0;
  if (s >= TIERS.mega.min) return TIERS.mega;
  if (s >= TIERS.large.min) return TIERS.large;
  if (s >= TIERS.medium.min) return TIERS.medium;
  return TIERS.small;
}

function isRisingLive(ch) {
  if (!ch.createdAt) return false;
  const ageYears = (Date.now() - new Date(ch.createdAt).getTime()) / 3.156e10;
  return ageYears < RISING_MAX_AGE_YEARS && (ch.subscribers || 0) >= RISING_MIN_SUBS;
}

function isDomesticChannel(ch) {
  return ch?.country === DOMESTIC_COUNTRY;
}

function domesticOnly(list) {
  return list.filter(isDomesticChannel);
}

function topVideoLikes(ch) {
  const likes = (ch.topVideos || [])
    .map((v) => v.likes)
    .filter((n) => typeof n === 'number' && Number.isFinite(n));
  return likes.length ? likes.reduce((sum, n) => sum + n, 0) : null;
}

function normalizeMetrics(ch) {
  return {
    ...ch,
    channelLikes: ch.channelLikes ?? null,
    topVideoLikes: ch.topVideoLikes ?? topVideoLikes(ch),
    comments: (ch.comments || []).slice(0, COMMENT_LIMIT),
  };
}

function decorateMock(ch) {
  const tier = tierOf(ch.subscribers);
  return normalizeMetrics({
    ...ch,
    tier: tier.key,
    tierLabel: tier.label,
    rising: (ch.growth30d || 0) >= RISING_GROWTH,
  });
}

function decorateLive(ch) {
  const tier = tierOf(ch.subscribers);
  const [color1, color2] = scraper.colorsFor(ch.id);
  return normalizeMetrics({
    growth30d: null, emoji: '📺', category: '',
    topVideos: [], comments: [],
    channelLikes: null, topVideoLikes: null,
    ...ch,
    color1, color2,
    tier: tier.key, tierLabel: tier.label,
    rising: isRisingLive(ch),
  });
}

// ---------- 동시성 제한 헬퍼 ----------
async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch { results[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------- 채널 풀 (수집 + 디스크 캐시) ----------
let pool = [];            // [{id, name, handle, subscribers, avatarUrl, category, ...core}]
let poolUpdatedAt = 0;
let crawledQueries = [];  // 이미 수집한 검색어 (새 검색어만 증분 수집)
let crawling = false;

function loadPool() {
  try {
    const saved = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
    pool = domesticOnly(saved.channels || []);
    poolUpdatedAt = saved.updatedAt || 0;
    crawledQueries = saved.crawledQueries || [];
  } catch { /* 첫 실행 */ }
}

function savePool() {
  pool = domesticOnly(pool);
  fs.writeFileSync(POOL_PATH, JSON.stringify({ updatedAt: poolUpdatedAt, crawledQueries, channels: pool }));
}

const enrichedCount = () => pool.filter((c) => c.enriched).length;

/** 1단계: 카테고리별 검색으로 채널 목록 확보 (구독자수·아바타까지 즉시 사용 가능) */
async function crawlSearchPhase(queries) {
  const found = new Map(pool.map((c) => [c.id, c])); // 기존 풀 유지하며 추가
  await mapLimit(queries, 4, async (cat) => {
    const results = await scraper.searchChannels(cat, PER_CATEGORY);
    let kept = 0;
    for (const ch of results) {
      if (!ch.id || found.has(ch.id)) continue;
      try {
        const core = await scraper.getChannelCore(ch.id);
        if (!isDomesticChannel(core)) continue;
        found.set(ch.id, {
          ...ch,
          ...core,
          name: core.name || ch.name,
          handle: core.handle || ch.handle,
          subscribers: core.subscribers ?? ch.subscribers,
          avatarUrl: core.avatarUrl || ch.avatarUrl,
          category: cat,
          enriched: true,
        });
        kept++;
      } catch { /* 상세 확인 실패 또는 국가 미확인 채널은 저장하지 않음 */ }
    }
    if (!crawledQueries.includes(cat)) crawledQueries.push(cat);
    console.log(`[수집] ${cat}: ${results.length}개 검색, 국내 확인 ${kept}개 (누적 ${found.size}개)`);
  });
  pool = [...found.values()];
  poolUpdatedAt = Date.now();
  savePool();
}

/** 2단계: 각 채널의 개설일·총조회수·배너를 백그라운드로 채움 */
async function crawlEnrichPhase() {
  const targets = pool.filter((c) => !c.enriched);
  let done = 0;
  await mapLimit(targets, 4, async (ch) => {
    const core = await scraper.getChannelCore(ch.id);
    Object.assign(ch, {
      ...core,
      // 검색 결과 값이 더 신뢰되는 필드는 보존
      name: core.name || ch.name,
      handle: core.handle || ch.handle,
      subscribers: core.subscribers ?? ch.subscribers,
      avatarUrl: core.avatarUrl || ch.avatarUrl,
      category: ch.category,
      enriched: true,
    });
    done++;
    if (done % 10 === 0) { savePool(); console.log(`[상세] ${done}/${targets.length} 완료`); }
  });
  pool = domesticOnly(pool);
  savePool();
  console.log(`[상세] 전체 완료: ${enrichedCount()}/${pool.length}`);
}

async function buildPool(force = false) {
  if (crawling) return;
  crawling = true;
  try {
    const stale = Date.now() - poolUpdatedAt > POOL_TTL;
    if (force || stale) crawledQueries = []; // 전체 재수집
    const newQueries = CATEGORIES.filter((c) => !crawledQueries.includes(c));
    if (newQueries.length) {
      console.log(`[수집] 채널 풀 수집 시작 (검색어 ${newQueries.length}개)...`);
      await crawlSearchPhase(newQueries);
    }
    if (pool.some((c) => !c.enriched)) {
      console.log(`[상세] 상세 정보 수집 시작 (${pool.filter((c) => !c.enriched).length}개)...`);
      await crawlEnrichPhase();
    }
  } catch (err) {
    console.error('[수집] 오류:', err.message);
  } finally {
    crawling = false;
  }
}

// ---------- 검색 캐시 ----------
const cache = new Map();
const TTL = 10 * 60 * 1000;
function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = fn();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

// ---------- 목록 필터/정렬 ----------
function filterTier(list, tier) {
  if (tier === 'rising') return list.filter((c) => c.rising);
  if (tier && TIERS[tier]) return list.filter((c) => c.tier === tier);
  return list;
}

function sortList(list, sort) {
  const bySubs = (a, b) => (b.subscribers || 0) - (a.subscribers || 0);
  if (sort === 'views') list.sort((a, b) => (b.totalViews || 0) - (a.totalViews || 0));
  else if (sort === 'growth') list.sort((a, b) => (b.growth30d ?? -1) - (a.growth30d ?? -1) || bySubs(a, b));
  else if (sort === 'newest') list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  else list.sort(bySubs);
  return list;
}

function mockList({ q, tier, sort, cat }) {
  let list = MOCK.channels.map(decorateMock);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.handle.toLowerCase().includes(needle) ||
        (c.category || '').toLowerCase().includes(needle)
    );
  }
  if (cat) list = list.filter((c) => c.category === cat);
  return sortList(filterTier(list, tier), sort);
}

function mockDetail(id) {
  const ch = MOCK.channels.find((c) => c.id === id);
  return ch ? decorateMock(ch) : null;
}

async function liveList({ q, tier, sort, cat }) {
  let list;
  if (q) {
    // 검색: 유튜브 실시간 검색 결과 상위 8개 + 상세 정보
    const found = await cached(`search:${q}`, () => scraper.searchChannels(q, 8));
    const settled = await Promise.allSettled(
      found.map((c) => cached(`core:${c.id}`, () => scraper.getChannelCore(c.id)))
    );
    list = settled
      .map((r, i) => (r.status === 'fulfilled' && r.value?.name ? { ...found[i], ...r.value } : null))
      .filter((c) => c?.name && isDomesticChannel(c))
      .map(decorateLive);
  } else {
    list = domesticOnly(pool).map(decorateLive);
  }
  if (cat) list = list.filter((c) => c.category === cat);
  return sortList(filterTier(list, tier), sort);
}

function liveDetail(id) {
  return cached(`detail:${id}`, async () => {
    const fromPool = pool.find((c) => c.id === id);
    const core = fromPool?.enriched
      ? fromPool
      : { ...(fromPool || {}), ...(await scraper.getChannelCore(id)) };
    if (!isDomesticChannel(core)) return null;
    const ch = decorateLive(core);
    // 대표 영상 3개 + 각 영상의 상세 데이터(좋아요·댓글수·태그·카테고리·설명·업로드일)
    let base = [];
    try {
      base = await scraper.getPopularVideos(id, 3);
    } catch { base = []; }
    const full = await Promise.all(base.map(async (v) => {
      try {
        const f = await scraper.getVideoFull(v.videoId, COMMENT_LIMIT);
        return {
          ...v,
          views: f.views ?? v.views,
          duration: f.duration || v.duration,
          thumbnail: v.thumbnail || f.thumbnail,
          likes: f.likes,
          commentCount: f.commentCount,
          description: f.description,
          tags: f.tags,
          category: f.category,
          uploadDate: f.uploadDate,
          _comments: f.comments,
        };
      } catch { return v; }
    }));
    ch.topVideos = full;
    // 채널 대표 댓글: 1위 영상의 댓글을 사용
    ch.comments = ((full[0] && full[0]._comments) || []).slice(0, COMMENT_LIMIT);
    ch.topVideos = ch.topVideos.map(({ _comments, ...v }) => v);
    ch.topVideoLikes = topVideoLikes(ch);
    return ch;
  });
}

// ---------- HTTP 서버 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// 수집한 채널로 백데이터 엑셀 워크북을 만든다.
function buildChannelsWorkbook() {
  const channels = MOCK_ONLY ? MOCK.channels.map(decorateMock) : domesticOnly(pool).map(decorateLive);
  return buildBackendWorkbook(channels, {
    updatedAt: poolUpdatedAt,
    sourceMode: MOCK_ONLY ? 'mock' : 'live',
    domesticOnly: !MOCK_ONLY,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    if (p === '/api/config') {
      return sendJson(res, 200, {
        mode: MOCK_ONLY ? 'mock' : 'live',
        crawling,
        total: pool.length,
        enriched: enrichedCount(),
      });
    }

    // ---- 데이터 내보내기 (수집한 풀 전체를 JSON/CSV로 다운로드) ----
    if (p === '/api/export.json') {
      const channels = (MOCK_ONLY ? MOCK.channels.map(decorateMock) : domesticOnly(pool).map(decorateLive))
        .map(({ topVideos, comments, emoji, color1, color2, ...c }) => ({
          ...c,
          channelUrl: c.id.startsWith('UC') ? `https://www.youtube.com/channel/${c.id}` : '',
        }));
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="channels.json"',
      });
      return res.end(JSON.stringify({ exportedAt: new Date().toISOString(), count: channels.length, channels }, null, 2));
    }
    if (p === '/api/export.csv') {
      const channels = MOCK_ONLY ? MOCK.channels.map(decorateMock) : domesticOnly(pool).map(decorateLive);
      const cols = [
        'id', 'name', 'handle', 'category', 'tierLabel', 'rising', 'subscribers',
        'totalViews', 'channelLikes', 'topVideoLikes', 'videoCount', 'createdAt',
        'country', 'channelUrl',
      ];
      const escCsv = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = channels.map((c) =>
        cols.map((k) => escCsv(
          k === 'channelUrl'
            ? (c.id.startsWith('UC') ? `https://www.youtube.com/channel/${c.id}` : '')
            : c[k]
        )).join(',')
      );
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="channels.csv"',
      });
      // BOM을 붙여 엑셀에서 한글이 깨지지 않게 함
      return res.end('\uFEFF' + cols.join(',') + '\n' + rows.join('\n'));
    }
    if (p === '/api/export.xlsx') {
      const buf = buildChannelsWorkbook();
      const today = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="channelscope_backend_${today}.xlsx"`,
        'Content-Length': buf.length,
      });
      return res.end(buf);
    }
    if (p === '/api/channels') {
      const opts = {
        q: url.searchParams.get('q') || '',
        tier: url.searchParams.get('tier') || '',
        sort: url.searchParams.get('sort') || 'subscribers',
        cat: url.searchParams.get('cat') || '',
      };
      const status = {
        crawling,
        total: MOCK_ONLY ? MOCK.channels.length : domesticOnly(pool).length,
        enriched: enrichedCount(),
        categories: MOCK_ONLY
          ? [...new Set(MOCK.channels.map((c) => c.category))]
          : [...new Set(domesticOnly(pool).map((c) => c.category).filter(Boolean))],
      };
      if (MOCK_ONLY) return sendJson(res, 200, { mode: 'mock', ...status, crawling: false, channels: mockList(opts) });
      try {
        return sendJson(res, 200, { mode: 'live', ...status, channels: await liveList(opts) });
      } catch (err) {
        console.error('실시간 목록 실패, 데모 데이터로 대체:', err.message);
        return sendJson(res, 200, { mode: 'mock-fallback', ...status, channels: mockList(opts) });
      }
    }
    const detailMatch = p.match(/^\/api\/channel\/([^/]+)$/);
    if (detailMatch) {
      const id = decodeURIComponent(detailMatch[1]);
      const ch = id.startsWith('ch-') || MOCK_ONLY ? mockDetail(id) : await liveDetail(id);
      if (!ch) return sendJson(res, 404, { error: '채널을 찾을 수 없습니다.' });
      return sendJson(res, 200, { channel: ch });
    }

    // 정적 파일
    let filePath = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); return res.end('Forbidden');
    }
    if (!fs.existsSync(filePath)) filePath = path.join(PUBLIC_DIR, 'index.html'); // SPA 폴백
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`유튜브 채널 탐색기 실행 중 → http://localhost:${PORT}`);
  console.log(`데이터 모드: ${MOCK_ONLY ? '데모 데이터' : '실시간 (API 키 불필요)'}`);
  if (!MOCK_ONLY) {
    loadPool();
    console.log(`채널 풀: ${pool.length}개 로드됨 (상세 완료 ${enrichedCount()}개)`);
    buildPool(process.env.REFRESH_POOL === '1'); // 백그라운드 수집
  }
});
