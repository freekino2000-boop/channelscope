/**
 * collect-facebook.js
 * 한국 관련 해시태그로 페이스북 크리에이터/페이지를 찾아 채널 단위 통계(팔로워/좋아하는 사람 수)만 수집합니다.
 * 검색은 로그인이 필요해 완전히 막혀있고, 해시태그 피드도 로그인 없이는 노출되는 게시물이 적어
 * (해시태그 대부분 0~1건) 다른 플랫폼보다 수집 효율이 낮습니다 — 가능한 범위 내 최대치를 노립니다.
 *
 * 실행: node collect-facebook.js
 *   TARGET_ADD=500 node collect-facebook.js
 */
const fs = require('fs');
const path = require('path');
const { withBrowser, discoverUsers, getUserProfile } = require('./scraper-facebook');

const POOL_PATH = path.join(__dirname, 'data', 'pool-facebook.json');
const TARGET_ADD = Number(process.env.TARGET_ADD || 300);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const SAVE_EVERY = 5;
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 40);

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
const PREFIXES = ['한국', '국내', '대한민국'];
const SUFFIXES = ['일상', '인플루언서', '추천', '크리에이터'];

function unique(values) {
  return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))];
}

// 해시태그(지역/접두/접미가 붙은 조합)에서 원래 기본 주제만 추출해 카테고리로 사용
function categoryFromQuery(query) {
  return BASE_TOPICS.find((topic) => query.includes(topic)) || query;
}

function buildQueryPlan(tried) {
  const plan = [];
  for (const topic of BASE_TOPICS) {
    plan.push(topic);
    for (const suffix of SUFFIXES) plan.push(`${topic}${suffix}`);
    for (const prefix of PREFIXES) plan.push(`${prefix}${topic}`);
    for (const region of REGIONS) plan.push(`${region}${topic}`);
  }
  return unique(plan).filter((q) => !tried.has(q));
}

function looksKorean(profile) {
  const text = `${profile.nickname || ''} ${profile.bio || ''}`;
  return /[가-힣]/.test(text);
}

function load() {
  if (!fs.existsSync(POOL_PATH)) return { updatedAt: null, triedQueries: [], creators: [] };
  return JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
}

function save(pool) {
  fs.writeFileSync(POOL_PATH, JSON.stringify(pool));
}

async function run() {
  const pool = load();
  const found = new Map(pool.creators.map((c) => [c.uniqueId, c]));
  const triedQueries = new Set(pool.triedQueries || []);
  const originalCount = found.size;
  const newIds = [];

  const queries = buildQueryPlan(triedQueries);
  console.log(`[페이스북수집] 현재 ${originalCount}개, 추가 목표 ${TARGET_ADD}개, 후보 해시태그 ${queries.length}개`);
  if (!queries.length) { console.log('[페이스북수집] 새 해시태그가 없습니다.'); return; }

  let idx = 0;
  let processed = 0;
  while (idx < queries.length && newIds.length < TARGET_ADD) {
    const batchEnd = Math.min(idx + BATCH_SIZE, queries.length);
    await withBrowser(async (context) => {
      let batchIdx = idx;
      async function worker() {
        while (batchIdx < batchEnd && newIds.length < TARGET_ADD) {
          const query = queries[batchIdx++];
          let paths = [];
          try { paths = await discoverUsers(context, query); } catch { paths = []; }
          triedQueries.add(query);
          for (const p of paths) {
            if (found.has(p) || newIds.length >= TARGET_ADD) continue;
            const profile = await getUserProfile(context, p);
            if (!profile) continue;
            if (!looksKorean(profile)) continue; // 한국 관련성 없는 크리에이터는 저장하지 않고 버림
            found.set(p, { ...profile, category: categoryFromQuery(query), domestic: true, collectedAt: new Date().toISOString() });
            newIds.push(p);
          }
          processed++;
          if (processed % SAVE_EVERY === 0 || newIds.length >= TARGET_ADD) {
            pool.creators = [...found.values()];
            pool.triedQueries = [...triedQueries];
            pool.updatedAt = Date.now();
            save(pool);
            console.log(`[페이스북수집] 해시태그 ${processed}/${queries.length}, 새 크리에이터 ${newIds.length}/${TARGET_ADD}, 누적 ${found.size}개`);
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
  console.log(`[페이스북수집] 완료: 기존 ${originalCount}개 → 현재 ${found.size}개 (+${found.size - originalCount}개, 전부 국내 추정)`);
}

run().then(() => process.exit(0)).catch((e) => { console.error('[페이스북수집] 오류:', e.message); process.exit(1); });
