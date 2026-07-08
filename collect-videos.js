/**
 * collect-videos.js
 * 모든 채널의 대표 영상 3개 상세 데이터(좋아요·댓글수·태그·카테고리·설명·업로드일)와
 * 영상별 댓글(최대 COMMENT_LIMIT개, 부족하면 있는 만큼)을 미리 수집해 data/pool.json에 저장합니다.
 * 오프라인 파일에 그대로 담기 위한 사전 수집.
 *
 * - 중단해도 재실행하면 안 한 채널만 이어서 수집합니다 (videosCollected 플래그).
 * - 주기적으로 pool.json에 저장하므로 진행분은 보존됩니다.
 *
 * 실행: node collect-videos.js
 */
const fs = require('fs');
const path = require('path');
const scraper = require('./scraper');
const { classifyComment, summarizeSentiment } = require('./sentiment');

const POOL_PATH = path.join(__dirname, 'data', 'pool.json');
const CONCURRENCY = 6;
const SAVE_EVERY = 30;
const VIDEO_LIMIT = 3;
const COMMENT_LIMIT = Number(process.env.COMMENT_LIMIT || 100);
const DOMESTIC_COUNTRY = '대한민국';

const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
pool.channels = (pool.channels || []).filter((channel) => channel.country === DOMESTIC_COUNTRY);
const channels = pool.channels;

function save() {
  fs.writeFileSync(POOL_PATH, JSON.stringify(pool));
}

const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');
const sumLikes = (videos) => {
  const likes = (videos || []).map((v) => v.likes).filter((n) => typeof n === 'number' && Number.isFinite(n));
  return likes.length ? likes.reduce((sum, n) => sum + n, 0) : null;
};

async function collectChannel(ch) {
  const hadVideos = (ch.topVideos || []).length > 0;

  let base = [];
  try { base = await scraper.getPopularVideos(ch.id, VIDEO_LIMIT); } catch { base = []; }

  // 이번 시도에서 영상 목록을 못 가져왔는데 기존에 수집된 데이터가 있다면,
  // 일시적 실패/탭 접근 불가로 빈 값을 덮어써 기존 데이터를 잃지 않도록 그대로 보존한다.
  if (!base.length && hadVideos) {
    ch.videosCollected = true;
    return;
  }

  const videos = [];
  const allComments = [];
  for (let i = 0; i < base.length; i++) {
    const v = base[i];
    let f = {};
    // 영상별로 각각 최대 COMMENT_LIMIT개까지 댓글 수집 (부족하면 있는 만큼만)
    try { f = await scraper.getVideoFull(v.videoId, COMMENT_LIMIT); } catch { f = {}; }
    const videoComments = (f.comments || []).slice(0, COMMENT_LIMIT).map((c) => ({
      author: c.author,
      text: trunc(c.text, 200),
      likes: c.likes,
      replyCount: c.replyCount ?? 0,
      replies: c.replies || [],
      publishedAt: c.publishedAt,
      sentiment: classifyComment(c.text),
    }));
    videos.push({
      videoId: v.videoId,
      title: f.title || v.title || '',
      views: f.views ?? v.views ?? null,
      likes: f.likes ?? null,
      commentCount: f.commentCount ?? null,
      description: trunc(f.description || '', 220),
      tags: (f.tags || []).slice(0, 8),
      category: f.category || '',
      uploadDate: f.uploadDate || '',
      duration: f.duration || v.duration || '',
      thumbnail: v.thumbnail || f.thumbnail || '',
      comments: videoComments,
    });
    allComments.push(...videoComments);
  }
  ch.topVideos = videos;
  ch.comments = videos[0]?.comments || []; // 프론트 상세 화면 노출용(대표 영상 기준, 기존과 동일)
  ch.commentsCollectedLimit = COMMENT_LIMIT;
  ch.commentsScope = 'per-video';
  ch.commentSentiment = summarizeSentiment(allComments); // 수집된 대표 영상 최대 3개 전체 댓글 기준
  ch.channelLikes = ch.channelLikes ?? null;
  ch.topVideoLikes = sumLikes(videos);
  ch.videosCollected = true;
}

async function run() {
  const todo = channels.filter((c) =>
    !c.videosCollected || c.commentsCollectedLimit !== COMMENT_LIMIT || c.commentsScope !== 'per-video'
  );
  const total = todo.length;
  console.log(`[영상수집] 시작: 전체 ${channels.length}개 중 ${total}개 남음 (완료 ${channels.length - total}개)`);
  if (!total) { console.log('[영상수집] 이미 전부 완료됨'); return; }

  let done = 0;
  let idx = 0;
  async function worker() {
    while (idx < todo.length) {
      const ch = todo[idx++];
      await collectChannel(ch);
      done++;
      if (done % SAVE_EVERY === 0) { save(); console.log(`[영상수집] ${done}/${total} 완료`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  console.log(`[영상수집] 전체 완료: ${channels.filter((c) => c.videosCollected).length}/${channels.length}`);
}

run().catch((e) => { console.error('[영상수집] 오류:', e.message); save(); process.exit(1); });
