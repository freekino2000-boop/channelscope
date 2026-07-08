/**
 * export-workbook-instagram.js
 * 인스타그램 파일럿 수집 데이터(채널 단위 통계만, 게시물 본문 없음)를 엑셀로 내보냅니다.
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
    columns: ['카테고리', '닉네임', '아이디', '등급', '팔로워수', '팔로잉수', '게시물수', '프로필URL', '소개글'],
    widths: [14, 24, 22, 8, 14, 12, 10, 42, 60],
    rows: creators.map((c) => [
      c.category || '', c.nickname || '', '@' + (c.uniqueId || ''), c.tierLabel || '',
      c.followerCount ?? null, c.followingCount ?? null, c.postCount ?? null,
      c.profileUrl || '', c.bio || '',
    ]),
  };
}

function buildCategorySheet(creators) {
  const byCat = {};
  for (const c of creators) {
    const key = c.category || '(미분류)';
    const g = byCat[key] || (byCat[key] = { n: 0, followers: 0 });
    g.n++; g.followers += c.followerCount || 0;
  }
  return {
    name: '카테고리별요약',
    columns: ['카테고리', '크리에이터수', '팔로워합계', '평균팔로워'],
    widths: [18, 12, 16, 14],
    rows: Object.entries(byCat)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([key, g]) => [key, g.n, g.followers, g.n ? Math.round(g.followers / g.n) : null]),
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
      ['수집범위', '파일럿 — 크리에이터 채널 단위 통계만 수집 (팔로워/팔로잉/게시물수/소개글)'],
      ['미지원항목', '개별 게시물 본문·댓글은 이번 파일럿 범위에서 제외'],
      ['수집방식', '헤드리스 브라우저(Playwright)로 해시태그 탐색 페이지+프로필 페이지를 읽어 수집 (로그인 불필요, 검색 기능은 로그인 필요해 해시태그로 대체)'],
      ['국내판정기준', '해시태그는 한국 관련 키워드로 탐색하고, 닉네임/소개글에 한글이 포함된 경우만 저장'],
      ['크리에이터수', creators.length],
    ],
  };
}

function buildInstagramWorkbook(creators, meta = {}) {
  const normalized = creators.map((c) => ({ ...c, tier: c.tier || tierOf(c.followerCount).key, tierLabel: c.tierLabel || tierOf(c.followerCount).label }))
    .sort((a, b) => (b.followerCount || 0) - (a.followerCount || 0));
  return buildXlsx([
    buildCreatorSheet(normalized),
    buildCategorySheet(normalized),
    buildInfoSheet(normalized, meta),
  ]);
}

module.exports = { buildInstagramWorkbook };
