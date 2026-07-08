/**
 * sentiment.js
 * 외부 API 없이 한국어 긍정/부정 단어 사전으로 댓글 감성을 분류합니다.
 * 규칙 기반이라 반어법·신조어·이모지 조합 등은 정확하지 않을 수 있습니다.
 */

const POSITIVE_WORDS = [
  '최고', '좋아요', '좋다', '좋네', '좋은', '굿', 'good', '대박', '감사', '고마워', '고맙',
  '사랑', '재밌', '재미있', '재미잇', '웃김', '웃겨', '힐링', '성지', '멋지', '멋있', '예쁘',
  '이쁘', '귀엽', '짱', '훌륭', '완벽', '최애', '응원', '축하', '부럽', '뿌듯', '감동', '힘내',
  '화이팅', '파이팅', '잘한다', '잘했', '대단', '든든', '설렌', '설레', '행복', '흥미', '유익',
  '꿀잼', '개꿀', '레전드', '갓', '찐', '만족', '추천', '기대', '든두', '위로', '따뜻', '존잘',
  '존예', '역시', '👍', '❤', '😍', '😊', '🥰', '💕', 'ㅎㅎ', 'ㅋㅋ',
];

const NEGATIVE_WORDS = [
  '싫어', '싫다', '별로', '최악', '짜증', '실망', '화나', '화남', '노잼', '지루', '유감',
  '안좋', '아쉽', '형편없', '문제', '사기', '거짓말', '비추', '실패', '후회', '답답', '불편',
  '어이없', '황당', '역겹', '민폐', '한심', '수준', '개판', '망함', '망했', '별로다', '짜증나',
  '불쾌', '불만', '욕', '비난', '구림', '구려', '재미없', '쓸모없', '어그로',
  '눈살', '피곤', '괴롭', '슬프', '속상', '눈물', '😡', '👎', '😞', '😢', 'ㅡㅡ',
];

function classifyComment(text) {
  const t = String(text || '');
  if (!t.trim()) return 'neutral';
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_WORDS) if (t.includes(w)) pos++;
  for (const w of NEGATIVE_WORDS) if (t.includes(w)) neg++;
  if (pos === 0 && neg === 0) return 'neutral';
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

function summarizeSentiment(comments) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const c of comments || []) {
    const label = c.sentiment || classifyComment(c.text);
    counts[label]++;
  }
  const total = (comments || []).length;
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    total,
    positive: counts.positive,
    neutral: counts.neutral,
    negative: counts.negative,
    positivePct: pct(counts.positive),
    neutralPct: pct(counts.neutral),
    negativePct: pct(counts.negative),
  };
}

module.exports = { classifyComment, summarizeSentiment };
