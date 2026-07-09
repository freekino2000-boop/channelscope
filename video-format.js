/**
 * video-format.js
 * 크리에이터의 topVideos 제목/태그를 보고 "주로 만드는 영상형식"을 키워드 사전으로 분류한다.
 * sentiment.js와 같은 패턴(외부 AI API 없이 키워드 매칭) — AI 매칭 알고리즘의 3단계(영상형식 적합도)에서 사용.
 */
const FORMAT_KEYWORDS = {
  '리뷰': ['리뷰', '후기', '사용기', '내돈내산', 'review'],
  '언박싱': ['언박싱', '개봉기', 'unboxing'],
  '브이로그': ['브이로그', 'vlog'],
  '쇼츠': ['쇼츠', 'shorts'],
  '라이브': ['라이브', 'live', '생방송', '라방'],
  '튜토리얼': ['튜토리얼', '강좌', '하는법', '방법', 'tutorial', '따라하기', '강의'],
  '챌린지': ['챌린지', 'challenge'],
  '먹방': ['먹방', 'mukbang', '먹는', '만개'],
  '인터뷰': ['인터뷰', 'interview', '토크'],
  '예능': ['예능', '몰카', '몰래카메라', '콘텐츠'],
  '정보전달': ['꿀팁', '정보', '분석', '총정리', '비교'],
  '게임공략': ['공략', '플레이', 'gameplay', '실황'],
  'ASMR': ['asmr', '수면유도', '백색소음'],
};

/**
 * @param {Array} topVideos 채널의 topVideos 배열({title, tags} 포함)
 * @returns {string[]} 매칭된 영상형식 태그 목록(여러 개 가능)
 */
function classifyVideoFormats(topVideos) {
  if (!Array.isArray(topVideos) || !topVideos.length) return [];
  const text = topVideos
    .map((v) => `${v.title || ''} ${(v.tags || []).join(' ')}`)
    .join(' ')
    .toLowerCase();

  const matched = [];
  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw.toLowerCase()))) matched.push(format);
  }
  return matched;
}

/**
 * 광고주가 원하는 영상형식과 크리에이터의 실제 형식 태그를 비교해 0~100점 산출.
 * 완전 불일치라도 0점 처리는 하지 않음(형식은 유동적) — 최소 30점 보장.
 */
function formatMatchScore(desiredFormat, creatorFormats) {
  if (!desiredFormat) return 60; // 광고주가 형식을 지정 안 했으면 중립값
  const desired = String(desiredFormat).toLowerCase();
  if (!creatorFormats.length) return 40; // 형식 태깅이 안 된 채널(topVideos 없음 등)은 약간 감점된 중립
  const hit = creatorFormats.some((f) => f.toLowerCase() === desired || desired.includes(f.toLowerCase()) || f.toLowerCase().includes(desired));
  return hit ? 100 : 30;
}

module.exports = { FORMAT_KEYWORDS, classifyVideoFormats, formatMatchScore };
