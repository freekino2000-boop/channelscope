/**
 * derived-metrics.js
 * 설계문서 v0.3 2-3장 "A그룹" — 이미 수집된 데이터에서 집계만으로 얻는 파생 필드.
 * sentiment.js/video-format.js와 같은 원칙: 외부 AI API 없이 순수 함수, pool에 아무것도 쓰지 않음.
 *
 * 제공 필드:
 *   - sponsoredExperience : 협찬/유료광고 경험 여부(제목·설명 패턴 탐지)
 *   - shortsRatio         : topVideos 중 60초 이하 영상 비율(0~1)
 *   - viewSubRatio        : 평균 조회수 / 구독자수 (실질 도달력)
 *   - contactEmail        : description에서 추출한 연락 이메일
 *   - koreanCommentRatio  : 댓글 중 한글 포함 비율(국내 시청자 비중 추정)
 */

/** 협찬/유료광고 표기 패턴(유튜브 필수 고지 문구 포함) */
const SPONSORED_PATTERNS = [
  '유료광고', '유료 광고', '협찬', '광고포함', '광고 포함', '제공받아', '제공 받아',
  '지원받아', '지원 받아', '브랜디드', 'sponsored', 'paid promotion', '#ad', '[ad]', '(ad)',
];

/** topVideos 제목/설명/태그에서 협찬 이력을 찾는다. hits에 근거(영상 제목)를 담아 반환 */
function detectSponsoredExperience(topVideos) {
  const hits = [];
  for (const v of topVideos || []) {
    const text = `${v.title || ''} ${v.description || ''} ${(v.tags || []).join(' ')}`.toLowerCase();
    if (SPONSORED_PATTERNS.some((p) => text.includes(p))) hits.push(v.title || v.videoId);
  }
  return { hasExperience: hits.length > 0, count: hits.length, evidence: hits.slice(0, 3) };
}

/** "MM:SS" 또는 "HH:MM:SS" 형식의 duration을 초로 변환. 파싱 실패 시 null */
function durationToSeconds(duration) {
  if (typeof duration === 'number') return duration;
  const parts = String(duration || '').split(':').map((n) => parseInt(n, 10));
  if (!parts.length || parts.some(Number.isNaN)) return null;
  return parts.reduce((s, n) => s * 60 + n, 0);
}

/** 60초 이하(쇼츠 추정) 영상 비율. duration 파싱 가능한 영상이 없으면 null */
function shortsRatio(topVideos) {
  const secs = (topVideos || []).map((v) => durationToSeconds(v.duration)).filter((s) => s != null);
  if (!secs.length) return null;
  return secs.filter((s) => s <= 60).length / secs.length;
}

/** 평균 조회수 ÷ 구독자수 — 구독자만 크고 실제론 안 보는 채널 판별. 계산 불가 시 null */
function viewSubRatio(creator, metricField = 'subscribers') {
  const subs = creator[metricField];
  const views = (creator.topVideos || []).map((v) => v.views).filter((n) => n > 0);
  if (!subs || !views.length) return null;
  return views.reduce((s, n) => s + n, 0) / views.length / subs;
}

/** description(또는 bio)에서 첫 이메일 주소 추출. 없으면 null */
function extractContactEmail(creator) {
  const text = `${creator.description || ''} ${creator.bio || ''}`;
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : null;
}

/** 댓글 중 한글이 포함된 비율(0~1) — 국내 시청자 비중 추정. 댓글 없으면 null */
function koreanCommentRatio(topVideos) {
  let total = 0;
  let korean = 0;
  for (const v of topVideos || []) {
    for (const c of v.comments || []) {
      if (!c.text) continue;
      total += 1;
      if (/[가-힣]/.test(c.text)) korean += 1;
    }
  }
  return total ? korean / total : null;
}

/** 크리에이터 하나에 대한 파생 필드 일괄 계산(매칭엔진/리포트에서 사용) */
function deriveMetrics(creator, metricField = 'subscribers') {
  return {
    sponsored: detectSponsoredExperience(creator.topVideos),
    shortsRatio: shortsRatio(creator.topVideos),
    viewSubRatio: viewSubRatio(creator, metricField),
    contactEmail: extractContactEmail(creator),
    koreanCommentRatio: koreanCommentRatio(creator.topVideos),
  };
}

module.exports = {
  detectSponsoredExperience,
  durationToSeconds,
  shortsRatio,
  viewSubRatio,
  extractContactEmail,
  koreanCommentRatio,
  deriveMetrics,
};
