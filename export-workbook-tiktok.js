/**
 * export-workbook-tiktok.js
 * 틱톡 파일럿 수집 데이터(채널 단위 통계만, 영상/댓글 없음)를 엑셀로 내보냅니다.
 * xlsx-writer.js를 그대로 재사용합니다.
 */
const { buildXlsx } = require('./xlsx-writer');

const TIERS = [
  { key: 'mega', label: '메가', min: 5_000_000 },
  { key: 'large', label: '대형', min: 1_000_000 },
  { key: 'medium', label: '중형', min: 100_000 },
  { key: 'small', label: '소형', min: 0 },
];
function tierOf(followers) { return TIERS.find((t) => (followers || 0) >= t.min) || TIERS.at(-1); }

function buildCreatorSheet(creators) {
  return {
    name: '크리에이터목록',
    columns: [
      '카테고리', '닉네임', '아이디', '등급', '인증여부', '팔로워수', '팔로잉수',
      '좋아요합계', '영상수', '가입일', '프로필URL', '소개글',
    ],
    widths: [14, 24, 22, 8, 8, 14, 12, 16, 10, 12, 42, 60],
    rows: creators.map((c) => [
      c.category || '', c.nickname || '', '@' + (c.uniqueId || ''), c.tierLabel || '',
      c.verified ? 'Y' : '', c.followerCount ?? null, c.followingCount ?? null,
      c.heartCount ?? null, c.videoCount ?? null, c.createdAt || '', c.profileUrl || '', c.bio || '',
    ]),
  };
}

function buildCategorySheet(creators) {
  const byCat = {};
  for (const c of creators) {
    const key = c.category || '(미분류)';
    const g = byCat[key] || (byCat[key] = { n: 0, followers: 0, hearts: 0 });
    g.n++; g.followers += c.followerCount || 0; g.hearts += c.heartCount || 0;
  }
  return {
    name: '카테고리별요약',
    columns: ['카테고리', '크리에이터수', '팔로워합계', '좋아요합계', '평균팔로워'],
    widths: [18, 12, 16, 16, 14],
    rows: Object.entries(byCat)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([key, g]) => [key, g.n, g.followers, g.hearts, g.n ? Math.round(g.followers / g.n) : null]),
  };
}

function buildTierSheet(creators) {
  return {
    name: '등급별요약',
    columns: ['등급', '크리에이터수', '팔로워합계', '좋아요합계', '평균팔로워'],
    widths: [12, 12, 16, 16, 14],
    rows: TIERS.map((tier) => {
      const group = creators.filter((c) => c.tier === tier.key);
      const followers = group.reduce((s, c) => s + (c.followerCount || 0), 0);
      const hearts = group.reduce((s, c) => s + (c.heartCount || 0), 0);
      return [tier.label, group.length, followers, hearts, group.length ? Math.round(followers / group.length) : null];
    }),
  };
}

function buildInfoSheet(creators, meta) {
  return {
    name: '데이터설명',
    columns: ['항목', '값'],
    widths: [24, 90],
    rows: [
      ['생성시각', meta.generatedAt || new Date().toISOString()],
      ['원본데이터갱신시각', meta.updatedAt ? new Date(meta.updatedAt).toISOString() : ''],
      ['수집범위', '파일럿 — 크리에이터 채널 단위 통계만 수집 (팔로워/팔로잉/좋아요합계/영상수/인증여부/소개글)'],
      ['미지원항목', '영상 목록, 댓글, 댓글 감성분석은 틱톡 안티봇 제약으로 이번 파일럿 범위에서 제외'],
      ['수집방식', '헤드리스 브라우저(Playwright)로 프로필 페이지에 내장된 데이터를 읽어 수집'],
      ['국내판정기준', '검색은 한국 관련 키워드로 진행하고, 프로필 언어=ko 또는 닉네임/소개글에 한글이 포함된 경우만 저장'],
      ['크리에이터수', creators.length],
    ],
  };
}

function buildTiktokWorkbook(creators, meta = {}) {
  const normalized = creators.map((c) => ({ ...c, tier: c.tier || tierOf(c.followerCount).key, tierLabel: c.tierLabel || tierOf(c.followerCount).label }))
    .sort((a, b) => (b.followerCount || 0) - (a.followerCount || 0));
  return buildXlsx([
    buildCreatorSheet(normalized),
    buildCategorySheet(normalized),
    buildTierSheet(normalized),
    buildInfoSheet(normalized, meta),
  ]);
}

module.exports = { buildTiktokWorkbook };
