const { buildXlsx } = require('./xlsx-writer');
const { classifyComment, summarizeSentiment } = require('./sentiment');

const TIERS = [
  { key: 'mega', label: '메가', min: 5_000_000 },
  { key: 'large', label: '대형', min: 1_000_000 },
  { key: 'medium', label: '중형', min: 100_000 },
  { key: 'small', label: '소형', min: 0 },
];
const COMMENT_LIMIT = 100;

function tierOf(subscribers) {
  return TIERS.find((t) => (subscribers || 0) >= t.min) || TIERS.at(-1);
}

function isRising(ch) {
  if (ch.rising != null) return Boolean(ch.rising);
  if (!ch.createdAt) return false;
  const ageYears = (Date.now() - new Date(ch.createdAt).getTime()) / 3.156e10;
  return ageYears < 3 && (ch.subscribers || 0) >= 50_000;
}

function sumNumbers(values) {
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function topVideoLikes(ch) {
  const likes = (ch.topVideos || [])
    .map((v) => v.likes)
    .filter((n) => typeof n === 'number' && Number.isFinite(n));
  return likes.length ? sumNumbers(likes) : null;
}

function channelUrl(ch) {
  return String(ch.id || '').startsWith('UC') ? `https://www.youtube.com/channel/${ch.id}` : '';
}

function videoUrl(videoId) {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
}

function isDomestic(ch) {
  if (ch.country === '대한민국') return 'Y';
  if (!ch.country) return '미확인';
  return 'N';
}

function joinedReplies(comment) {
  return (comment.replies || [])
    .map((reply) => reply.text || reply.content || '')
    .filter(Boolean)
    .join('\n---\n');
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value == null) return false;
  return String(value).trim() !== '';
}

function flattenVideos(channels) {
  const rows = [];
  for (const channel of channels) {
    for (const video of channel.topVideos || []) rows.push({ channel, video });
  }
  return rows;
}

function flattenComments(channels) {
  const rows = [];
  for (const channel of channels) {
    const videos = channel.topVideos || [];
    const hasPerVideoComments = videos.some((v) => v.comments);
    if (hasPerVideoComments) {
      for (const video of videos) {
        for (const comment of video.comments || []) rows.push({ channel, baseVideo: video, comment });
      }
    } else {
      const baseVideo = videos[0] || {};
      for (const comment of channel.comments || []) rows.push({ channel, baseVideo, comment });
    }
  }
  return rows;
}

function coverageRow(label, sheet, column, filled, total, note = '') {
  const rate = total ? `${Math.round((filled / total) * 1000) / 10}%` : '0%';
  let status = '수집필요';
  if (total && filled === total) status = '완료';
  else if (filled > 0) status = '부분수집';
  return [label, sheet, column, filled, total, rate, status, note];
}

function topCountrySummary(channels, limit = 12) {
  const counts = {};
  for (const c of channels) {
    const key = c.country || '(미확인)';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([country, count]) => `${country} ${count}`)
    .join(', ');
}

function normalizeChannel(ch) {
  const tier = ch.tier && ch.tierLabel ? { key: ch.tier, label: ch.tierLabel } : tierOf(ch.subscribers);
  const comments = ch.comments || [];
  const topVideos = ch.topVideos || [];
  const allComments = topVideos.some((v) => v.comments) ? topVideos.flatMap((v) => v.comments || []) : comments;
  return {
    ...ch,
    tier: tier.key,
    tierLabel: tier.label,
    rising: isRising(ch),
    channelLikes: ch.channelLikes ?? null,
    topVideoLikes: ch.topVideoLikes ?? topVideoLikes(ch),
    topVideos,
    comments,
    commentSentiment: ch.commentSentiment ?? summarizeSentiment(allComments),
    channelUrl: channelUrl(ch),
  };
}

function sortedChannels(channels) {
  return channels.map(normalizeChannel).sort((a, b) =>
    (b.subscribers || 0) - (a.subscribers || 0) ||
    (a.category || '힣').localeCompare(b.category || '힣', 'ko')
  );
}

function buildChannelSheet(channels) {
  return {
    name: '채널목록',
    columns: [
      '채널ID', '카테고리', '채널명', '핸들', '등급', '급상승', '국내판정', '국가',
      '공개구독자수', '채널총조회수', '채널영상수', '채널생성일', '채널썸네일URL',
      '채널배너URL', '채널URL', '상세수집여부', '영상수집여부', '저장대표영상수',
      '저장댓글수', '긍정률(%)', '중립률(%)', '부정률(%)', '채널설명',
    ],
    widths: [26, 14, 28, 22, 8, 8, 10, 10, 14, 14, 11, 12, 36, 36, 44, 12, 12, 12, 10, 10, 10, 10, 60],
    rows: channels.map((c) => [
      c.id || '', c.category || '', c.name || '', c.handle || '', c.tierLabel || '',
      c.rising ? 'Y' : '', isDomestic(c), c.country || '', c.subscribers ?? null,
      c.totalViews ?? null, c.videoCount ?? null, c.createdAt || '', c.avatarUrl || '',
      c.bannerUrl || '', c.channelUrl, c.enriched ? 'Y' : '', c.videosCollected ? 'Y' : '',
      (c.topVideos || []).length, (c.comments || []).length,
      c.commentSentiment?.total ? c.commentSentiment.positivePct : null,
      c.commentSentiment?.total ? c.commentSentiment.neutralPct : null,
      c.commentSentiment?.total ? c.commentSentiment.negativePct : null,
      c.description || '',
    ]),
  };
}

function buildVideoSheet(channels) {
  const rows = [];
  for (const c of channels) {
    (c.topVideos || []).forEach((v, index) => {
      rows.push([
        c.category || '', c.name || '', c.id || '', c.handle || '', isDomestic(c),
        c.country || '', c.description || '', c.avatarUrl || '', c.createdAt || '',
        c.subscribers ?? null, c.totalViews ?? null, index + 1, v.videoId || '',
        v.title || '', v.views ?? null, v.likes ?? null, v.commentCount ?? null,
        (v.comments || []).length,
        v.description || '', v.uploadDate || v.publishedAt || '', (v.tags || []).join(', '),
        v.category || '', v.duration || '', videoUrl(v.videoId), v.thumbnail || '',
      ]);
    });
  }
  return {
    name: '영상백데이터',
    columns: [
      '카테고리', '채널명', '채널ID', '핸들', '국내판정', '국가', '채널설명',
      '채널썸네일URL', '채널생성일', '공개구독자수', '채널총조회수', '영상순위',
      '영상ID', '영상제목', '영상조회수', '좋아요수', '댓글수', '저장댓글수', '영상설명',
      '영상업로드일', '영상태그', '영상카테고리', '영상길이', '영상URL', '영상썸네일URL',
    ],
    widths: [14, 28, 26, 22, 10, 10, 52, 36, 12, 14, 14, 8, 16, 48, 14, 12, 12, 10, 60, 12, 44, 16, 9, 42, 36],
    rows,
  };
}

function buildCommentSheet(channels) {
  const rows = [];
  for (const c of channels) {
    const videos = c.topVideos || [];
    const hasPerVideoComments = videos.some((v) => v.comments);
    // 영상별로 댓글이 저장된 최신 데이터는 대표 영상 최대 3개 전체를, 예전 데이터는 대표 영상 1개만 담는다.
    const videoGroups = hasPerVideoComments
      ? videos.map((v, i) => ({ video: v, rank: i + 1, comments: v.comments || [] }))
      : [{ video: videos[0] || {}, rank: 1, comments: c.comments || [] }];
    for (const { video, rank, comments } of videoGroups) {
      comments.slice(0, COMMENT_LIMIT).forEach((comment, index) => {
        const sentiment = comment.sentiment || classifyComment(comment.text);
        const sentimentLabel = { positive: '긍정', neutral: '중립', negative: '부정' }[sentiment] || '중립';
        rows.push([
          c.category || '', c.name || '', c.id || '', c.handle || '', isDomestic(c),
          rank, video.videoId || '', video.title || '', index + 1, comment.author || '',
          comment.likes ?? null, comment.replyCount ?? null, comment.publishedAt || '',
          sentimentLabel, comment.text || '', joinedReplies(comment), videoUrl(video.videoId),
        ]);
      });
    }
  }
  return {
    name: '댓글백데이터',
    columns: [
      '카테고리', '채널명', '채널ID', '핸들', '국내판정', '영상순위', '영상ID', '영상제목',
      '댓글순위', '작성자', '댓글좋아요수', '댓글답글수', '게시시점', '감성',
      '댓글내용', '댓글답글내용', '영상URL',
    ],
    widths: [14, 28, 26, 22, 10, 8, 16, 48, 8, 22, 12, 12, 14, 8, 70, 70, 42],
    rows,
  };
}

function buildSentimentSheet(channels) {
  const byCat = {};
  const overall = { channels: 0, withComments: 0, total: 0, positive: 0, neutral: 0, negative: 0 };
  for (const c of channels) {
    const key = c.category || '(미분류)';
    const g = byCat[key] || (byCat[key] = {
      channels: 0, withComments: 0, total: 0, positive: 0, neutral: 0, negative: 0,
    });
    g.channels++;
    overall.channels++;
    const s = c.commentSentiment;
    if (s && s.total) {
      g.withComments++; g.total += s.total; g.positive += s.positive; g.neutral += s.neutral; g.negative += s.negative;
      overall.withComments++; overall.total += s.total; overall.positive += s.positive; overall.neutral += s.neutral; overall.negative += s.negative;
    }
  }
  const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : null);
  const rows = Object.entries(byCat)
    .sort((a, b) => b[1].channels - a[1].channels)
    .map(([key, g]) => [
      key, g.channels, g.withComments, g.total, g.positive, g.neutral, g.negative,
      pct(g.positive, g.total), pct(g.neutral, g.total), pct(g.negative, g.total),
    ]);
  rows.unshift([
    '전체', overall.channels, overall.withComments, overall.total, overall.positive, overall.neutral, overall.negative,
    pct(overall.positive, overall.total), pct(overall.neutral, overall.total), pct(overall.negative, overall.total),
  ]);
  return {
    name: '댓글감성요약',
    columns: [
      '카테고리', '채널수', '댓글수집채널수', '총댓글수', '긍정수', '중립수', '부정수',
      '긍정률(%)', '중립률(%)', '부정률(%)',
    ],
    widths: [18, 8, 12, 10, 8, 8, 8, 10, 10, 10],
    rows,
  };
}

function groupByCategory(channels) {
  const byCat = {};
  for (const c of channels) {
    const key = c.category || '(미분류)';
    const group = byCat[key] || (byCat[key] = {
      n: 0, mega: 0, large: 0, medium: 0, small: 0, rising: 0,
      domestic: 0, overseas: 0, unknownCountry: 0,
      subs: 0, views: 0, channelLikes: 0, topVideoLikes: 0, videoRows: 0, commentRows: 0,
    });
    group.n++;
    group[c.tier]++;
    if (c.rising) group.rising++;
    const domesticFlag = isDomestic(c);
    if (domesticFlag === 'Y') group.domestic++;
    else if (domesticFlag === 'N') group.overseas++;
    else group.unknownCountry++;
    group.subs += c.subscribers || 0;
    group.views += c.totalViews || 0;
    group.channelLikes += c.channelLikes || 0;
    group.topVideoLikes += c.topVideoLikes || 0;
    group.videoRows += (c.topVideos || []).length;
    group.commentRows += (c.comments || []).length;
  }
  return byCat;
}

function buildCategorySheet(channels) {
  const byCat = groupByCategory(channels);
  return {
    name: '카테고리별요약',
    columns: [
      '카테고리', '채널수', '메가', '대형', '중형', '소형', '급상승',
      '국내', '해외', '국가미확인', '구독자합계', '총조회수합계',
      '채널좋아요합계', '대표영상좋아요합계', '영상백데이터행수', '댓글백데이터행수',
    ],
    widths: [18, 8, 7, 7, 7, 7, 8, 8, 8, 11, 16, 18, 16, 18, 16, 16],
    rows: Object.entries(byCat)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([key, g]) => [
        key, g.n, g.mega, g.large, g.medium, g.small, g.rising,
        g.domestic, g.overseas, g.unknownCountry, g.subs, g.views,
        g.channelLikes || null, g.topVideoLikes || null, g.videoRows, g.commentRows,
      ]),
  };
}

// 카테고리를 열로 펼친 가로형 요약 — 인쇄 시 모든 카테고리가 한 페이지 너비에 들어가도록 구성
function buildCategoryWideSheet(channels) {
  const byCat = groupByCategory(channels);
  const sortedCats = Object.entries(byCat).sort((a, b) => b[1].n - a[1].n);
  const metrics = [
    ['채널수', (g) => g.n],
    ['메가', (g) => g.mega],
    ['대형', (g) => g.large],
    ['중형', (g) => g.medium],
    ['소형', (g) => g.small],
    ['급상승', (g) => g.rising],
    ['구독자합계', (g) => g.subs],
    ['총조회수합계', (g) => g.views],
  ];
  return {
    name: '카테고리요약(가로형)',
    columns: ['항목', ...sortedCats.map(([key]) => key)],
    widths: [14, ...sortedCats.map(() => 9)],
    rows: metrics.map(([label, pick]) => [label, ...sortedCats.map(([, g]) => pick(g))]),
    landscape: true,
    freezeFirstCol: true,
  };
}

function buildTierSheet(channels) {
  const rows = TIERS.map((tier) => {
    const group = channels.filter((c) => c.tier === tier.key);
    const subs = sumNumbers(group.map((c) => c.subscribers || 0));
    const views = sumNumbers(group.map((c) => c.totalViews || 0));
    const likes = sumNumbers(group.map((c) => c.topVideoLikes || 0));
    const videoRows = sumNumbers(group.map((c) => (c.topVideos || []).length));
    const commentRows = sumNumbers(group.map((c) => (c.comments || []).length));
    return [
      tier.label, group.length, subs, views, likes || null,
      group.length ? Math.round(subs / group.length) : null,
      group.length ? Math.round(views / group.length) : null,
      videoRows, commentRows,
    ];
  });
  const rising = channels.filter((c) => c.rising);
  const risingVideoRows = sumNumbers(rising.map((c) => (c.topVideos || []).length));
  const risingCommentRows = sumNumbers(rising.map((c) => (c.comments || []).length));
  rows.push([
    '급상승', rising.length,
    sumNumbers(rising.map((c) => c.subscribers || 0)),
    sumNumbers(rising.map((c) => c.totalViews || 0)),
    sumNumbers(rising.map((c) => c.topVideoLikes || 0)) || null,
    rising.length ? Math.round(sumNumbers(rising.map((c) => c.subscribers || 0)) / rising.length) : null,
    rising.length ? Math.round(sumNumbers(rising.map((c) => c.totalViews || 0)) / rising.length) : null,
    risingVideoRows, risingCommentRows,
  ]);
  return {
    name: '등급별요약',
    columns: [
      '등급', '채널수', '구독자합계', '총조회수합계', '대표영상좋아요합계',
      '평균구독자수', '평균조회수', '영상백데이터행수', '댓글백데이터행수',
    ],
    widths: [14, 10, 16, 18, 18, 14, 16, 16, 16],
    rows,
  };
}

function buildFieldCoverageSheet(channels) {
  const videos = flattenVideos(channels);
  const comments = flattenComments(channels);
  const rows = [
    coverageRow(
      '영상 조회수', '영상백데이터', '영상조회수',
      videos.filter(({ video }) => hasValue(video.views)).length, videos.length
    ),
    coverageRow(
      '좋아요 수', '영상백데이터', '좋아요수',
      videos.filter(({ video }) => hasValue(video.likes)).length, videos.length,
      '유튜브 공개 화면에서 좋아요 수가 노출되는 영상만 채워짐'
    ),
    coverageRow(
      '댓글 수', '영상백데이터', '댓글수',
      videos.filter(({ video }) => hasValue(video.commentCount)).length, videos.length,
      '댓글 비활성/비공개 영상은 비어 있을 수 있음'
    ),
    coverageRow('채널명', '채널목록', '채널명', channels.filter((c) => hasValue(c.name)).length, channels.length),
    coverageRow('채널 설명', '채널목록', '채널설명', channels.filter((c) => hasValue(c.description)).length, channels.length),
    coverageRow('채널 썸네일', '채널목록', '채널썸네일URL', channels.filter((c) => hasValue(c.avatarUrl)).length, channels.length),
    coverageRow('채널 생성일', '채널목록', '채널생성일', channels.filter((c) => hasValue(c.createdAt)).length, channels.length),
    coverageRow('공개 구독자 수', '채널목록', '공개구독자수', channels.filter((c) => hasValue(c.subscribers)).length, channels.length),
    coverageRow('채널 총 조회수', '채널목록', '채널총조회수', channels.filter((c) => hasValue(c.totalViews)).length, channels.length),
    coverageRow('영상 제목', '영상백데이터', '영상제목', videos.filter(({ video }) => hasValue(video.title)).length, videos.length),
    coverageRow('영상 설명', '영상백데이터', '영상설명', videos.filter(({ video }) => hasValue(video.description)).length, videos.length),
    coverageRow(
      '영상 업로드일', '영상백데이터', '영상업로드일',
      videos.filter(({ video }) => hasValue(video.uploadDate || video.publishedAt)).length, videos.length
    ),
    coverageRow('영상 태그', '영상백데이터', '영상태그', videos.filter(({ video }) => hasValue(video.tags)).length, videos.length),
    coverageRow('영상 카테고리', '영상백데이터', '영상카테고리', videos.filter(({ video }) => hasValue(video.category)).length, videos.length),
    coverageRow('영상 길이', '영상백데이터', '영상길이', videos.filter(({ video }) => hasValue(video.duration)).length, videos.length),
    coverageRow('댓글 내용', '댓글백데이터', '댓글내용', comments.filter(({ comment }) => hasValue(comment.text)).length, comments.length),
    coverageRow(
      '댓글 답글', '댓글백데이터', '댓글답글수, 댓글답글내용',
      comments.filter(({ comment }) => hasValue(comment.replyCount) || hasValue(comment.replies)).length,
      comments.length,
      '기존 저장본에는 답글 본문이 없으며 새 수집분부터 replyCount/replies 구조로 저장'
    ),
  ];
  return {
    name: '필드커버리지',
    columns: ['이미지항목', '백데이터시트', '컬럼명', '채워진행수', '전체행수', '충족률', '상태', '비고'],
    widths: [18, 18, 26, 12, 12, 10, 10, 70],
    rows,
  };
}

function buildInfoSheet(channels, meta) {
  const videoRows = sumNumbers(channels.map((c) => (c.topVideos || []).length));
  const commentRows = sumNumbers(channels.map((c) => (c.comments || []).length));
  const domestic = channels.filter((c) => isDomestic(c) === 'Y').length;
  const overseas = channels.filter((c) => isDomestic(c) === 'N').length;
  const unknownCountry = channels.filter((c) => isDomestic(c) === '미확인').length;
  const videosCollected = channels.filter((c) => c.videosCollected).length;
  const domesticOnly = meta.domesticOnly ?? (channels.length > 0 && domestic === channels.length);
  return {
    name: '데이터설명',
    columns: ['항목', '값'],
    widths: [28, 90],
    rows: [
      ['생성시각', meta.generatedAt || new Date().toISOString()],
      ['원본데이터갱신시각', meta.updatedAt ? new Date(meta.updatedAt).toISOString() : ''],
      ['데이터모드', meta.sourceMode || 'offline'],
      ['수집방식', 'API 키 없이 유튜브 공개 웹 응답(Innertube browse/search/player/next)을 파싱한 현재 백데이터'],
      ['지역화설정', '유튜브 요청 context는 hl=ko, gl=KR이며 검색어도 한국어 중심.'],
      ['국내한정여부', domesticOnly
        ? '예. 국가 필드가 대한민국으로 확인된 채널만 포함하고, 국가 미확인/해외 채널은 제거함.'
        : '아님. 국가 필드가 대한민국이면 국내판정=Y, 해외 국가는 N, 비공개/미노출 국가는 미확인으로 표시.'],
      ['국가분포Top', topCountrySummary(channels)],
      ['채널수', channels.length],
      ['국내판정Y', domestic],
      ['국내판정N', overseas],
      ['국가미확인', unknownCountry],
      ['영상수집완료채널', videosCollected],
      ['영상백데이터행수', videoRows],
      ['댓글백데이터행수', commentRows],
      ['댓글수집기준', `채널당 최대 ${COMMENT_LIMIT}개. 기존 저장본은 재수집 전까지 더 적을 수 있음.`],
      ['댓글답글설계', '댓글백데이터에 댓글답글수/댓글답글내용 컬럼을 둠. 기존 저장본의 답글 본문은 비어 있으며 재수집된 댓글부터 저장 가능.'],
      ['시트구성', '채널목록, 영상백데이터, 댓글백데이터, 댓글감성요약, 카테고리별요약, 카테고리요약(가로형), 등급별요약, 필드커버리지, 데이터설명'],
      ['댓글감성분석', '외부 AI API 없이 한국어 긍정/부정 키워드 사전(sentiment.js)으로 분류한 규칙 기반 결과이며 참고용입니다.'],
    ],
  };
}

function buildBackendWorkbook(inputChannels, meta = {}) {
  const channels = sortedChannels(inputChannels);
  return buildXlsx([
    buildChannelSheet(channels),
    buildVideoSheet(channels),
    buildCommentSheet(channels),
    buildSentimentSheet(channels),
    buildCategorySheet(channels),
    buildCategoryWideSheet(channels),
    buildTierSheet(channels),
    buildFieldCoverageSheet(channels),
    buildInfoSheet(channels, meta),
  ]);
}

module.exports = { buildBackendWorkbook };
