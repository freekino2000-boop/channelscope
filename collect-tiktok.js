/**
 * collect-tiktok.js
 * 한국 관련 검색어로 틱톡 크리에이터를 찾아 채널 단위 통계(팔로워수·좋아요합계·영상수 등)만 수집합니다.
 * 헤드리스 브라우저(Playwright)를 사용하며, 영상 목록/댓글은 안티봇에 막혀 수집하지 않습니다(파일럿 범위).
 *
 * 실행: node collect-tiktok.js
 *   TARGET_ADD=500 node collect-tiktok.js   (추가 목표 채널 수, 기본 300)
 */
const fs = require('fs');
const path = require('path');
const { withBrowser, searchUsers, getUserProfile } = require('./scraper-tiktok');

const POOL_PATH = path.join(__dirname, 'data', 'pool-tiktok.json');
const TARGET_ADD = Number(process.env.TARGET_ADD || 300);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const SAVE_EVERY = 10;

const BASE_TOPICS = [
  '먹방', '요리', '게임', '브이로그', '여행', '홈트레이닝', '축구', '야구', '골프',
  '낚시', '캠핑', '자동차', '테크리뷰', '과학', '역사', '경제', '주식', '부동산',
  '코딩', 'AI', '영어공부', '공부', '음악', '커버곡', '댄스', '뷰티', '패션',
  '키즈', '영화리뷰', '드라마', '예능', '코미디', '인터뷰', '뉴스', '다큐',
  '쇼츠', '일상', '인테리어', 'KPOP', '아이돌', '동요', '뮤직비디오',
  '개발자', '프로그래밍', '롤', '마인크래프트', '모바일게임', '디저트', '베이킹',
  '맛집', '커피', '육아', '시골생활', '심리학', '철학',
  '의학', '건강', '재테크', '창업', '마케팅', '등산', '자전거', '러닝',
  '피아노', '기타연주', '영화', '웹툰', '타로', '명상', '요가', '필라테스',
  '헬스', '전기차', '오토바이', '국내여행', '한국사', '일본어', '중국어',
  '트로트', '발라드', '힙합', '클래식', '국악',
  '한식', '중식', '일식', '분식', '홈베이킹', '라면',
  '치킨', '해산물', '메이크업', '스킨케어', '골프레슨',
  '유튜브수익', '부업', '스마트스토어', '코인',
  '자기계발', '연애상담', '교육', '입시', '유학', '토익',
  '제주도', '일본여행', '세계여행', '반려견', '반려묘',
  '식물', '가드닝', '살림', '직장인브이로그', '대학생브이로그', '제품리뷰',
  '가전리뷰', '스마트폰리뷰', 'ASMR', '실화', '사건사고', '챌린지',
  '리액션', '숏폼', '해외축구',
  '북리뷰', '영상편집',
];
const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '제주', '경기',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '세종',
];
const PREFIXES = ['한국', '국내', '대한민국', 'Korean'];
const SUFFIXES = ['틱톡', '크리에이터', '인플루언서', '추천', '브이로그', '챌린지', '일상'];

function unique(values) {
  return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))];
}

function buildQueryPlan(tried) {
  const plan = [];
  for (const topic of BASE_TOPICS) {
    plan.push(topic);
    for (const suffix of SUFFIXES) plan.push(`${topic} ${suffix}`);
    for (const prefix of PREFIXES) plan.push(`${prefix} ${topic}`);
    for (const region of REGIONS) plan.push(`${region} ${topic}`);
  }
  return unique(plan).filter((q) => !tried.has(q));
}

function looksKorean(profile) {
  const text = `${profile.nickname || ''} ${profile.bio || ''}`;
  return profile.language === 'ko' || /[가-힣]/.test(text);
}

function load() {
  if (!fs.existsSync(POOL_PATH)) return { updatedAt: null, triedQueries: [], creators: [] };
  return JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
}

function save(pool) {
  fs.writeFileSync(POOL_PATH, JSON.stringify(pool));
}

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 40); // 세션 장시간 사용 시 틱톡이 조용히 빈 응답을 주기 시작해 주기적으로 브라우저를 새로 띄움

async function run() {
  const pool = load();
  const found = new Map(pool.creators.map((c) => [c.uniqueId, c]));
  const triedQueries = new Set(pool.triedQueries || []);
  const originalCount = found.size;
  const newIds = [];

  const queries = buildQueryPlan(triedQueries);
  console.log(`[틱톡수집] 현재 ${originalCount}개, 추가 목표 ${TARGET_ADD}개, 후보 검색어 ${queries.length}개`);
  if (!queries.length) { console.log('[틱톡수집] 새 검색어가 없습니다.'); return; }

  let idx = 0;
  let processed = 0;
  while (idx < queries.length && newIds.length < TARGET_ADD) {
    const batchEnd = Math.min(idx + BATCH_SIZE, queries.length);
    await withBrowser(async (context) => {
      let batchIdx = idx;
      async function worker() {
        while (batchIdx < batchEnd && newIds.length < TARGET_ADD) {
          const query = queries[batchIdx++];
          let handles = [];
          try { handles = await searchUsers(context, query); } catch { handles = []; }
          triedQueries.add(query);
          for (const handle of handles) {
            if (found.has(handle) || newIds.length >= TARGET_ADD) continue;
            const profile = await getUserProfile(context, handle);
            if (!profile) continue;
            if (!looksKorean(profile)) continue; // 한국 관련성 없는 크리에이터는 저장하지 않고 버림
            found.set(handle, { ...profile, category: query, domestic: true, collectedAt: new Date().toISOString() });
            newIds.push(handle);
          }
          processed++;
          if (processed % SAVE_EVERY === 0 || newIds.length >= TARGET_ADD) {
            pool.creators = [...found.values()];
            pool.triedQueries = [...triedQueries];
            pool.updatedAt = Date.now();
            save(pool);
            console.log(`[틱톡수집] 검색어 ${processed}/${queries.length}, 새 크리에이터 ${newIds.length}/${TARGET_ADD}, 누적 ${found.size}개`);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batchEnd - idx) }, worker));
    });
    idx = batchEnd;
  }

  pool.creators = [...found.values()];
  pool.triedQueries = [...triedQueries];
  pool.updatedAt = Date.now();
  save(pool);
  console.log(`[틱톡수집] 완료: 기존 ${originalCount}개 → 현재 ${found.size}개 (+${found.size - originalCount}개, 전부 국내 추정)`);
}

run().catch((e) => { console.error('[틱톡수집] 오류:', e.message); process.exit(1); });
