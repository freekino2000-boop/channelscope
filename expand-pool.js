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

const BASE_TOPICS = [
  '먹방', '요리', '게임', '브이로그', '여행', '홈트레이닝', '축구', '야구', '골프',
  '낚시', '캠핑', '자동차', '테크 리뷰', '과학', '역사', '경제', '주식', '부동산',
  '코딩', 'AI', '영어공부', '공부', '음악', '커버곡', '댄스', '뷰티', '패션',
  '키즈', '영화리뷰', '드라마', '예능', '코미디', '인터뷰', '뉴스', '다큐',
  '쇼츠', '일상', '인테리어', 'KPOP', '아이돌', '동요', '뮤직비디오',
  '개발자', '프로그래밍', '롤', '마인크래프트', '모바일게임', '디저트', '베이킹',
  '맛집', '커피', '육아', '시골생활', '심리학', '철학', '수학', '물리학',
  '의학', '건강', '재테크', '창업', '마케팅', '등산', '자전거', '러닝',
  '피아노', '기타 연주', '영화', '웹툰', '타로', '명상', '요가', '필라테스',
  '헬스', '전기차', '오토바이', '국내여행', '한국사', '일본어', '중국어',
  '트로트', '발라드', '힙합', '클래식', '국악', '스타크래프트', '발로란트',
  '원신', '로블록스', '한식', '중식', '일식', '분식', '홈베이킹', '라면',
  '치킨', '해산물', '메이크업', '스킨케어', '골프레슨', '파이썬',
  '자바스크립트', '데이터분석', '머신러닝', '챗GPT', '보안', '유튜브 수익',
  '부업', '스마트스토어', '코인', '미국주식', '청약', '과학실험', '세계사',
  '정치', '토론', '자기계발', '연애상담', '교육', '입시', '유학', '토익',
  '캠핑 브이로그', '제주도', '일본여행', '세계여행', '반려견', '반려묘',
  '식물', '가드닝', '살림', '직장인 브이로그', '대학생 브이로그', '제품리뷰',
  '가전리뷰', '스마트폰 리뷰', 'ASMR', '실화', '사건사고', '챌린지',
  '리액션', '웹드라마', '숏폼', '해외축구', 'NBA', 'F1', '탐사보도',
  '북리뷰', '영상편집', '포토샵', '웹툰작가',
];

const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '제주', '경기',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '세종',
];

const PREFIXES = ['한국', '국내', '대한민국', 'Korean'];
const SUFFIXES = [
  '유튜브', '유튜버', '채널', '추천', '리뷰', '강의', '입문', '전문가',
  '브이로그', '뉴스', '하이라이트', '라이브', '쇼츠', '랭킹',
];

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function categoryFromQuery(query, topics) {
  return topics.find((topic) => query.includes(topic)) || query.split(/\s+/)[0] || '확장수집';
}

function buildQueryPlan() {
  const existingCategories = pool.channels.map((channel) => channel.category);
  const topics = unique([...existingCategories, ...BASE_TOPICS]);
  const plan = [];

  for (const topic of topics) {
    plan.push({ query: topic, category: topic });
    for (const suffix of SUFFIXES) plan.push({ query: `${topic} ${suffix}`, category: topic });
    for (const prefix of PREFIXES) plan.push({ query: `${prefix} ${topic}`, category: topic });
    for (const region of REGIONS) plan.push({ query: `${region} ${topic}`, category: topic });
  }

  return unique(plan.map((item) => item.query))
    .filter((query) => !triedQueries.has(query))
    .map((query) => ({ query, category: categoryFromQuery(query, topics) }))
    .slice(0, MAX_QUERIES || undefined);
}

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

  const queries = buildQueryPlan();
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
