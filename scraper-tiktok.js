/**
 * scraper-tiktok.js
 * 틱톡은 유튜브(Innertube)와 달리 로그인 없는 순수 요청은 WAF(봇 차단) 챌린지로 막히고,
 * 영상목록/댓글 API는 헤드리스 브라우저로도 빈 응답만 온다(더 강한 안티봇).
 * 대신 프로필 페이지에 서버사이드로 내장되는 JSON(__UNIVERSAL_DATA_FOR_REHYDRATION__)에는
 * 팔로워수·좋아요합계·영상수 등 채널 단위 통계가 안정적으로 들어있어 이것만 수집한다.
 * (영상 목록/댓글은 미지원 — 파일럿 범위)
 */
const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function withBrowser(fn) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
    return await fn(context);
  } finally {
    await browser.close();
  }
}

function readUniversalData(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch { return null; }
  });
}

/** 검색어로 사용자 핸들 목록 수집 (검색 결과 페이지 DOM에서 프로필 링크만 추출, 페이지네이션 없음) */
async function searchUsers(context, query) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.tiktok.com/search/user?q=${encodeURIComponent(query)}`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(2500);
    const links = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href*="/@"]')].map((a) => a.getAttribute('href') || ''))]
    );
    return links
      .map((href) => (href.match(/\/@([^/?]+)/) || [])[1])
      .filter(Boolean)
      .map((id) => decodeURIComponent(id));
  } catch {
    return [];
  } finally {
    await page.close();
  }
}

/** 프로필 페이지에서 채널 단위 통계 수집 (영상 목록/댓글 없음) */
async function getUserProfile(context, uniqueId) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.tiktok.com/@${encodeURIComponent(uniqueId)}`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(2000);
    const data = await readUniversalData(page);
    const detail = data?.__DEFAULT_SCOPE__?.['webapp.user-detail'];
    if (!detail || detail.statusCode !== 0) return null;
    const u = detail.userInfo.user;
    const s = detail.userInfo.stats;
    const s2 = detail.userInfo.statsV2 || {}; // 문자열로 된 큰 수 — stats(32비트)는 대형 계정에서 오버플로/음수가 남
    const bigCount = (v2, v1) => { const n = Number(v2); return Number.isFinite(n) && n >= 0 ? n : (v1 ?? null); };
    return {
      id: u.id,
      uniqueId: u.uniqueId,
      nickname: u.nickname,
      bio: u.signature || '',
      avatarUrl: u.avatarLarger || u.avatarMedium || '',
      verified: !!u.verified,
      privateAccount: !!u.privateAccount,
      language: u.language || '',
      createdAt: u.createTime ? new Date(u.createTime * 1000).toISOString().slice(0, 10) : null,
      followerCount: bigCount(s2.followerCount, s.followerCount),
      followingCount: bigCount(s2.followingCount, s.followingCount),
      heartCount: bigCount(s2.heartCount, s.heartCount),
      videoCount: bigCount(s2.videoCount, s.videoCount),
      profileUrl: `https://www.tiktok.com/@${u.uniqueId}`,
    };
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

module.exports = { withBrowser, searchUsers, getUserProfile };
