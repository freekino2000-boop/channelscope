/**
 * matching-engine.js (v0.4 — CIV 통합)
 * AI 매칭 알고리즘(설계문서 AI매칭알고리즘_설계문서.md v0.4)의 실제 구현.
 * 채널스코프/데이터스코프의 실행(grow-pool.js, datascope-verify.js)과는 완전히 분리된 단독 모듈 —
 * pool.json 등을 읽기 전용으로만 사용하고, 어디에도 값을 쓰지 않는다. publish.sh에도 연결하지 않음.
 *
 * 입력(광고): { adName, concept, keywords, videoFormat, references, platforms }
 *
 * 알고리즘(v0.4): 적합도(Fit) × 가치(CIV) 2계층 구조
 *   [적합도 — 이 광고와 얼마나 맞는가]
 *   1) 하드필터        — 플랫폼/국내판정/데이터스코프 상태 + CIV D등급·어뷰징 확정 제외(CIV 설계서 02/14장)
 *   2) 키워드매칭      — Lv1.5(핵심/맥락 키워드 분리 + 조사 제거 매칭)
 *   3) 영상형식적합도  — video-format.js
 *   4) 레퍼런스유사도  — 카테고리(40)+형식(30)+어휘(20)+티어근접(10), 리졸브 실패 시 축 생략
 *   [가치 — 이 채널이 광고 집행처로서 얼마나 가치 있는가]
 *   5) CIV 보정계수    — YOUCHI CIV(광고용) 0~100점(civ-engine.js) → 0.6~1.4배 곱셈 보정
 *                        CIV 미산출(최소기준 미달) 채널은 0.75배 고정 + '분석 준비 중' 표시
 *
 * 스코어: 레퍼런스 있으면 (키워드×0.5 + 형식×0.2 + 레퍼런스×0.3) × CIV보정(0.6~1.45)
 *         레퍼런스 없으면 (키워드×0.8 + 형식×0.2) × CIV보정
 *         CIV보정 = 0.6 + CIV광고용/100 × 0.8 (+협찬경험 0.05)
 *
 * 실행 예(데모): node matching-engine.js
 */
const fs = require('fs');
const path = require('path');
const { classifyVideoFormats, formatMatchScore } = require('./video-format');
const { deriveMetrics } = require('./derived-metrics');
// civ-engine.js는 대외비 산정방식 구현이라 깃허브에 올리지 않음(.gitignore) —
// 모듈이 없는 환경(공개 저장소 클론 등)에서는 CIV 보정 없이 중립(×1.0)으로 동작한다.
let civEngine = null;
try { civEngine = require('./civ-engine'); } catch { /* 비공개 모듈 미설치 — 중립 보정 폴백 */ }

const DIR = __dirname;
const DOMESTIC_COUNTRY = '대한민국';
const UNREACHABLE_STRIKES_LIMIT = 3;

// 가중치(설계문서 v0.3 — 초기 가설값, 피드백 루프로 보정 예정)
const WEIGHTS_WITH_REF = { keyword: 0.5, format: 0.2, reference: 0.3 };
const WEIGHTS_NO_REF = { keyword: 0.8, format: 0.2 };

const TIERS = [
  { key: 'mega', label: '메가', min: 5_000_000 },
  { key: 'large', label: '대형', min: 1_000_000 },
  { key: 'medium', label: '중형', min: 100_000 },
  { key: 'small', label: '소형', min: 0 },
];
function tierIndexOf(metric) { return Math.max(0, TIERS.findIndex((t) => (metric || 0) >= t.min)); }
function tierLabelOf(metric) { return TIERS[tierIndexOf(metric)].label; }

const PLATFORM_SOURCES = {
  youtube: { poolPath: path.join(DIR, 'data', 'pool.json'), arrayKey: 'channels', idField: 'id', nameField: 'name', metricField: 'subscribers' },
  tiktok: { poolPath: path.join(DIR, 'data', 'pool-tiktok.json'), arrayKey: 'creators', idField: 'uniqueId', nameField: 'nickname', metricField: 'followerCount' },
  instagram: { poolPath: path.join(DIR, 'data', 'pool-instagram.json'), arrayKey: 'creators', idField: 'uniqueId', nameField: 'nickname', metricField: 'followerCount' },
  facebook: { poolPath: path.join(DIR, 'data', 'pool-facebook.json'), arrayKey: 'creators', idField: 'uniqueId', nameField: 'nickname', metricField: 'followerCount' },
};
const ALL_PLATFORMS = Object.keys(PLATFORM_SOURCES);

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

const DEMO_POOL_PATH = path.join(DIR, 'data', 'demo-pool.json');

/** 플랫폼별 풀을 [{platform, src, items}] 형태로 로드(한 번만 읽어서 재사용).
 *  데모 모드: 실제 풀 파일이 하나도 없으면(깃허브 클론 환경 등) 가상 채널 40개(demo-pool.json)로
 *  자동 대체 — 로직 테스트용이며 실존 채널이 아니다. */
function loadPools(platforms) {
  const list = (platforms && platforms.length ? platforms : ALL_PLATFORMS).filter((p) => PLATFORM_SOURCES[p]);
  const pools = list.map((platform) => {
    const src = PLATFORM_SOURCES[platform];
    const pool = loadJson(src.poolPath, {});
    return { platform, src, items: pool[src.arrayKey] || [] };
  });
  if (pools.every((p) => !p.items.length)) {
    const demo = loadJson(DEMO_POOL_PATH, null);
    if (demo?.channels?.length) {
      console.warn(`[매칭엔진] 실제 풀 데이터(pool.json) 없음 → 데모 모드: 가상 채널 ${demo.channels.length}개로 동작합니다`);
      return [{ platform: 'youtube', src: PLATFORM_SOURCES.youtube, items: demo.channels, demo: true }];
    }
  }
  return pools;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[,\s/·\-_|()[\]{}"'!?.,;:]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
}

// 한국어 조사/어미(토큰 끝에 붙는 것들) — 긴 것부터 매칭해서 1회 제거
const JOSA = ['으로', '에서', '에게', '한테', '부터', '까지', '처럼', '보다', '마다', '라도', '이나', '이랑', '하고', '들을', '들이', '을', '를', '이', '가', '은', '는', '와', '과', '의', '에', '로', '도', '만', '랑', '들'];

/** 토큰 끝의 조사 1개 제거("직장인을"→"직장인"). 제거 후 2자 미만이면 원형 유지 */
function stripJosa(token) {
  for (const j of JOSA) {
    if (token.length - j.length >= 2 && token.endsWith(j)) return token.slice(0, -j.length);
  }
  return token;
}

/** 광고 토큰이 크리에이터 텍스트에 있는지 — 원형 우선, 없으면 조사 제거형으로 재시도(Lv1.5) */
function tokenMatches(creatorText, token) {
  if (creatorText.includes(token)) return true;
  const stripped = stripJosa(token);
  return stripped !== token && creatorText.includes(stripped);
}

/**
 * 광고에서 매칭용 키워드 추출(v0.4.1 — 핵심/맥락 분리).
 * - core: 광고주가 직접 입력한 keywords 필드(매칭 점수의 분모 — 의도가 명확한 핵심어)
 * - context: 광고명+컨셉의 토큰(보너스 가점용 — 문장 서술어가 분모를 키우지 않도록 분리)
 */
function extractAdKeywords(ad) {
  const core = [...new Set(tokenize(ad.keywords))];
  const coreSet = new Set(core);
  const context = [...new Set(tokenize([ad.adName, ad.concept].filter(Boolean).join(' ')))].filter((t) => !coreSet.has(t));
  return { core, context, all: [...core, ...context] };
}

/** 크리에이터의 매칭용 텍스트(카테고리+설명+최근 영상 제목/태그) */
function buildCreatorText(creator) {
  const parts = [creator.category, creator.description || creator.bio];
  for (const v of creator.topVideos || []) {
    parts.push(v.title, (v.tags || []).join(' '));
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Lv1.5 키워드 매칭 스코어(v0.4.1):
 * - 핵심 키워드(keywords 필드) 매칭 비율 × 90 + 맥락 토큰(광고명/컨셉) 매칭 비율 × 20 (최대 100)
 *   → 핵심어를 다 맞추면 맥락 절반만 겹쳐도 100점. "신제품/캠페인" 같은 서술어가 점수를 깎지 않음
 * - 핵심 키워드가 없으면 맥락 토큰만으로 종전 방식(비율×100) 적용
 * - 조사 제거 매칭(tokenMatches): "직장인을"도 "직장인"으로 잡음
 */
function keywordMatchScore(adKeywords, creatorText) {
  const { core, context } = adKeywords;
  if (!core.length && !context.length) return { score: 50, hits: [] }; // 키워드가 아예 없으면 중립값
  const coreHits = core.filter((kw) => tokenMatches(creatorText, kw));
  const contextHits = context.filter((kw) => tokenMatches(creatorText, kw));
  let score;
  if (core.length) {
    const coreRatio = coreHits.length / core.length;
    const contextRatio = context.length ? contextHits.length / context.length : 0;
    score = Math.min(100, Math.round(coreRatio * 90 + contextRatio * 20));
  } else {
    score = Math.round((contextHits.length / context.length) * 100);
  }
  return { score, hits: [...coreHits, ...contextHits], coreHits, contextHits };
}

// ─────────────────────────────────────────────────────────────
// 레퍼런스 리졸버 (v0.3 신규 — 설계문서 2-2장)
// ─────────────────────────────────────────────────────────────

/** 레퍼런스 문자열 하나를 {type, value}로 파싱: 영상ID / 채널ID / 핸들 / 이름 */
function parseReference(ref) {
  const s = String(ref || '').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/))) return { type: 'videoId', value: m[1] };
  if ((m = s.match(/youtube\.com\/channel\/(UC[\w-]+)/))) return { type: 'channelId', value: m[1] };
  if ((m = s.match(/(?:youtube\.com\/)?@([\w.\-가-힣]+)/))) return { type: 'handle', value: '@' + m[1].toLowerCase() };
  if (/^UC[\w-]{16,}$/.test(s)) return { type: 'channelId', value: s };
  return { type: 'name', value: s.toLowerCase() };
}

/** 파싱된 레퍼런스를 풀에서 찾아 채널 객체 반환(없으면 null) */
function findInPools(parsed, pools) {
  for (const { src, items } of pools) {
    for (const c of items) {
      if (parsed.type === 'channelId' && c[src.idField] === parsed.value) return c;
      if (parsed.type === 'handle' && String(c.handle || '').toLowerCase() === parsed.value) return c;
      if (parsed.type === 'name' && String(c[src.nameField] || '').toLowerCase() === parsed.value) return c;
      if (parsed.type === 'videoId' && (c.topVideos || []).some((v) => v.videoId === parsed.value)) return c;
    }
  }
  return null;
}

/**
 * 레퍼런스 배열 → 레퍼런스 프로필.
 * 광고주가 말로 표현 못 한 니즈를 레퍼런스 채널의 데이터에서 역산한다:
 * 카테고리 / 영상형식 태그 / 어휘(제목·태그 빈도 상위) / 티어(규모대)
 */
function resolveReferences(references, pools) {
  const resolved = [];
  const unresolved = [];
  for (const ref of references || []) {
    const parsed = parseReference(ref);
    if (!parsed) continue;
    const channel = findInPools(parsed, pools);
    if (channel) resolved.push(channel);
    else unresolved.push(ref);
  }
  if (!resolved.length) return { resolved: [], unresolved, profile: null };

  const categories = new Set();
  const formatTags = new Set();
  const termFreq = new Map();
  const tierIndexes = [];
  for (const ch of resolved) {
    if (ch.category) categories.add(String(ch.category).toLowerCase());
    for (const f of classifyVideoFormats(ch.topVideos)) formatTags.add(f);
    tierIndexes.push(tierIndexOf(ch.subscribers ?? ch.followerCount));
    for (const v of ch.topVideos || []) {
      for (const t of tokenize(`${v.title || ''} ${(v.tags || []).join(' ')}`)) {
        termFreq.set(t, (termFreq.get(t) || 0) + 1);
      }
    }
  }
  const topTerms = [...termFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t);

  return {
    resolved: resolved.map((ch) => ({ id: ch.id || ch.uniqueId, name: ch.name || ch.nickname, category: ch.category })),
    unresolved,
    profile: { categories, formatTags, topTerms, tierIndexes },
  };
}

/** 4단계 — 레퍼런스 유사도(0~100): 카테고리 40 + 형식 30 + 어휘 20 + 티어근접 10 */
function referenceSimilarity(creator, profile, creatorFormats, creatorText, metric) {
  if (!profile) return null;
  const reasons = [];
  let score = 0;

  const cat = String(creator.category || '').toLowerCase();
  if (cat && profile.categories.has(cat)) { score += 40; reasons.push(`카테고리 일치(${creator.category})`); }
  else if (cat && [...profile.categories].some((rc) => rc.includes(cat) || cat.includes(rc))) { score += 20; reasons.push(`카테고리 유사(${creator.category})`); }

  if (profile.formatTags.size && creatorFormats.length) {
    const shared = creatorFormats.filter((f) => profile.formatTags.has(f));
    if (shared.length) {
      score += Math.max(15, Math.round((shared.length / profile.formatTags.size) * 30));
      reasons.push(`영상형식 겹침(${shared.join(', ')})`);
    }
  }

  if (profile.topTerms.length) {
    const hits = profile.topTerms.filter((t) => creatorText.includes(t));
    const vocabScore = Math.min(20, Math.round((hits.length / profile.topTerms.length) * 40));
    score += vocabScore;
    if (vocabScore >= 5) reasons.push(`레퍼런스 어휘 ${hits.length}/${profile.topTerms.length}개 겹침`);
  }

  const myTier = tierIndexOf(metric);
  const minDist = Math.min(...profile.tierIndexes.map((t) => Math.abs(t - myTier)));
  if (minDist === 0) { score += 10; reasons.push('레퍼런스와 같은 규모대'); }
  else if (minDist === 1) { score += 5; }

  return { score: Math.min(100, score), reasons };
}

// ─────────────────────────────────────────────────────────────
// 품질보정 / 하드필터
// ─────────────────────────────────────────────────────────────

/** 영상당 평균 참여율((좋아요+댓글)/조회수) — 0~1 사이 소수, 데이터 없으면 null */
function engagementRate(creator) {
  const videos = (creator.topVideos || []).filter((v) => v.views > 0);
  if (!videos.length) return null;
  const rates = videos.map((v) => ((v.likes || 0) + (v.commentCount || 0)) / v.views);
  return rates.reduce((s, r) => s + r, 0) / rates.length;
}

/**
 * 5단계 — CIV 보정계수(v0.4): YOUCHI CIV 광고용 점수를 곱셈 보정으로 변환.
 * CIV 50점(평균 수준) = ×1.0, 100점 = ×1.4, 0점 = ×0.6. 협찬경험 시 +0.05.
 * CIV 미산출(최소기준 미달) 채널은 보수적으로 ×0.75 고정.
 * 반환: { multiplier, civ, reasons, exclude } — exclude=true면 매칭에서 제외(D등급/어뷰징, CIV 설계서)
 */
function civMultiplier(creator, derived, civStats, metricField) {
  if (!civEngine) {
    // CIV 모듈 미설치 환경: 보정 없이 중립 — 협찬경험 가점만 유지
    const m = derived.sponsored.hasExperience ? 1.05 : 1.0;
    return {
      multiplier: m,
      civ: { available: false, score: null, grade: null },
      reasons: ['CIV 모듈 미설치 — 중립 보정 ×1.0'],
      exclude: false,
    };
  }
  const civ = civEngine.computeCiv(creator, civStats, 'ad', metricField);
  const reasons = [];

  if (civ.abuse) return { multiplier: 0, civ, reasons: ['어뷰징 신호 확정(도달효율+좋아요율 교차) — 광고 매칭 자동 제외'], exclude: true };
  if (civ.available && civ.grade === 'D') return { multiplier: 0, civ, reasons: [`CIV ${civ.score}점 D등급 — 매칭 제외`], exclude: true };

  let m;
  if (!civ.available) {
    m = 0.75;
    reasons.push('CIV 분석 준비 중(최소기준 미달) — 보수적 보정 ×0.75');
  } else {
    m = 0.6 + (civ.score / 100) * 0.8;
    reasons.push(`CIV 광고용 ${civ.score}점 (${civ.grade}) → ×${m.toFixed(2)}`);
    const entries = Object.entries(civ.areas).sort((a, b) => b[1] - a[1]);
    reasons.push(`강점: ${civEngine.AREA_LABELS[entries[0][0]]} ${entries[0][1]}점`);
    if (entries.at(-1)[1] < 50) reasons.push(`약점: ${civEngine.AREA_LABELS[entries.at(-1)[0]]} ${entries.at(-1)[1]}점`);
  }
  if (derived.sponsored.hasExperience) { m += 0.05; reasons.push(`협찬경험 ${derived.sponsored.count}건(+0.05)`); }

  return { multiplier: Math.max(0.6, Math.min(1.45, m)), civ, reasons, exclude: false };
}

/** 1단계 — 하드필터: 국내판정 + 접근불가 3회 이상(추정 폐쇄) 채널 제외 */
function passesHardFilter(creator) {
  if (creator.country && creator.country !== DOMESTIC_COUNTRY) return false;
  if ((creator.dsUnreachableStrikes || 0) >= UNREACHABLE_STRIKES_LIMIT) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────
// 스코어링
// ─────────────────────────────────────────────────────────────

/** 광고 1건에 대한 전처리(0단계): 키워드 추출 + 풀 로드 + 레퍼런스 리졸브. 결과를 재사용.
 *  poolsCache를 주면 디스크 재로드 없이 재사용(match-server.js가 메모리 캐시로 사용) */
function prepareAd(ad, poolsCache) {
  const wanted = ad.platforms && ad.platforms.length ? ad.platforms : ALL_PLATFORMS;
  let pools = poolsCache
    ? poolsCache.filter((p) => wanted.includes(p.platform))
    : loadPools(ad.platforms);
  // 데모 모드에서 선택 플랫폼과 데모 풀(youtube)이 어긋나 비어버리면 데모 풀 유지
  if (poolsCache && !pools.some((p) => p.items.length) && poolsCache.some((p) => p.demo)) {
    pools = poolsCache.filter((p) => p.demo);
  }
  const demoMode = pools.some((p) => p.demo);
  const adKeywords = extractAdKeywords(ad);
  const refs = resolveReferences(ad.references, pools);
  // CIV 카테고리 통계(보정/신뢰도 블렌딩 기준) — 파일 캐시 우선, 없으면 즉석 생성 후 저장
  let civStats = null;
  if (civEngine) {
    civStats = civEngine.loadStatsFile();
    if (!civStats) { civStats = civEngine.buildStats(pools); civEngine.saveStats(civStats); }
  }
  return { ad, pools, adKeywords, refs, civStats, demoMode, weights: refs.profile ? WEIGHTS_WITH_REF : WEIGHTS_NO_REF };
}

/** 크리에이터 1명 스코어링 — 일괄 스코어링과 크리에이터 카드 조회가 공유하는 핵심 함수 */
function scoreCreator(creator, prepared, platform) {
  const src = PLATFORM_SOURCES[platform];
  const { ad, adKeywords, refs, weights } = prepared;

  const creatorText = buildCreatorText(creator);
  const kw = keywordMatchScore(adKeywords, creatorText);
  const kwScore = kw.score;
  const kwHits = kw.hits;

  const formatTags = classifyVideoFormats(creator.topVideos);
  const fmtScore = formatMatchScore(ad.videoFormat, formatTags);

  const metric = creator[src.metricField] ?? null;
  const refSim = refs.profile ? referenceSimilarity(creator, refs.profile, formatTags, creatorText, metric) : null;

  const derived = deriveMetrics(creator, src.metricField);
  const { multiplier, civ, reasons: qualityReasons, exclude } = civMultiplier(creator, derived, prepared.civStats, src.metricField);
  if (exclude) return null; // CIV D등급/어뷰징 확정 — 매칭 제외(설계서 02/14장)

  const rawScore = refSim
    ? kwScore * weights.keyword + fmtScore * weights.format + refSim.score * weights.reference
    : kwScore * weights.keyword + fmtScore * weights.format;
  // CIV 보정으로 100을 넘을 수 있어 0~100 스케일로 캡(점수 해석 일관성)
  const finalScore = Math.min(100, Math.round(rawScore * multiplier * 10) / 10);

  return {
    platform,
    id: creator[src.idField],
    name: creator[src.nameField] || '',
    category: creator.category || '',
    metric,
    tier: tierLabelOf(metric),
    score: finalScore,
    breakdown: {
      keywordScore: kwScore,
      matchedKeywords: kwHits,
      matchedCoreKeywords: kw.coreHits || [],
      formatScore: fmtScore,
      creatorFormatTags: formatTags,
      referenceScore: refSim ? refSim.score : null,
      referenceReasons: refSim ? refSim.reasons : [],
      qualityMultiplier: Math.round(multiplier * 100) / 100,
      qualityReasons,
      civ: {
        available: civ.available,
        score: civ.score,
        grade: civ.grade,
        areas: civ.available ? civ.areas : null,
        confidence: civ.confidence ?? null,
      },
      derived: {
        sponsoredExperience: derived.sponsored.hasExperience,
        shortsRatio: derived.shortsRatio,
        viewSubRatio: derived.viewSubRatio != null ? Math.round(derived.viewSubRatio * 100) / 100 : null,
        contactEmail: derived.contactEmail,
      },
    },
  };
}

/**
 * 메인 매칭 함수 — 광고 1건에 대해 후보군 전체 스코어링.
 * @param {{adName:string, concept:string, keywords:string, videoFormat:string, references:string[], platforms:string[]}} ad
 * @param {{limit?:number, all?:boolean, prepared?:object}} options  all=true면 전체 반환(일괄 스코어링용),
 *   prepared를 주면 풀 재로드 없이 재사용(ad-store.js가 사용)
 */
function matchCreators(ad, options = {}) {
  const prepared = options.prepared || prepareAd(ad);
  const results = [];
  for (const { platform, items } of prepared.pools) {
    for (const creator of items) {
      if (!passesHardFilter(creator)) continue;
      const scored = scoreCreator(creator, prepared, platform);
      if (scored) results.push(scored); // null = CIV 제외(D등급/어뷰징)
    }
  }
  results.sort((a, b) => b.score - a.score);
  return options.all ? results : results.slice(0, options.limit || 20);
}

module.exports = {
  matchCreators,
  prepareAd,
  scoreCreator,
  resolveReferences,
  parseReference,
  findInPools,
  extractAdKeywords,
  keywordMatchScore,
  tokenMatches,
  stripJosa,
  civMultiplier,
  engagementRate,
  passesHardFilter,
  loadPools,
  tierLabelOf,
  PLATFORM_SOURCES,
};

if (require.main === module) {
  // 데모: 실제 pool.json(읽기 전용)으로 v0.3 샘플 광고를 돌려본다. 어디에도 쓰지 않음.
  const demoAd = {
    adName: '단백질 보충제 신제품 런칭 캠페인',
    concept: '운동 초보도 부담 없는 저당 단백질 쉐이크, 담백하고 신뢰감 있는 톤',
    keywords: '헬스, 다이어트, 보디빌딩, 운동, 단백질',
    videoFormat: '리뷰',
    references: [],
    platforms: ['youtube'],
  };
  console.log('[매칭엔진 v0.4 데모] 광고:', JSON.stringify(demoAd));
  const start = Date.now();
  const top = matchCreators(demoAd, { limit: 5 });
  console.log(`[매칭엔진 v0.4 데모] ${Date.now() - start}ms 소요, 상위 ${top.length}개`);
  console.log(JSON.stringify(top, null, 2));
}
