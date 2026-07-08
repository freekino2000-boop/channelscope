/**
 * scraper-instagram.js
 * 인스타그램은 검색 페이지는 로그인 벽이 있지만(직접 테스트로 확인),
 * 해시태그 탐색 페이지(/explore/tags/{키워드}/)와 프로필 페이지는 로그인 없이 열린다.
 * 해시태그 페이지에서 게시물 작성자 아이디를 모아 발견(디스커버리)하고,
 * 프로필 페이지의 meta description에서 팔로워/팔로잉/게시물수·소개글을 파싱한다.
 * (영상/게시물 본문, 댓글은 수집하지 않음 — 파일럿 범위)
 */
const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const NON_PROFILE_PATHS = new Set(['popular', 'explore', 'accounts', 'reel', 'reels', 'p', 'stories', 'direct', 'about']);

async function withBrowser(fn) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
    return await fn(context);
  } finally {
    await browser.close();
  }
}

function parseCount(text) {
  if (!text) return null;
  const s = String(text).replace(/,/g, '').trim();
  const m = s.match(/([\d.]+)\s*(만|천|억|K|M|B)?/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const mul = { 만: 1e4, 천: 1e3, 억: 1e8, K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1;
  return Math.round(num * mul);
}

/** 해시태그 탐색 페이지에서 게시물 작성자 아이디 목록 추출 (로그인 불필요) */
async function discoverUsers(context, keyword) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.instagram.com/explore/tags/${encodeURIComponent(keyword)}/`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(2500);
    const links = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || ''))]
    );
    return links
      .map((href) => (href.match(/^\/([a-zA-Z0-9._]+)\/?$/) || [])[1])
      .filter((id) => id && !NON_PROFILE_PATHS.has(id.toLowerCase()));
  } catch {
    return [];
  } finally {
    await page.close();
  }
}

/** 프로필 페이지에서 채널 단위 통계 수집 */
async function getUserProfile(context, username) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(2000);
    const metaDesc = await page.evaluate(() => document.querySelector('meta[name="description"]')?.content || '');
    if (!metaDesc) return null;
    // "팔로워 519K명, 팔로잉 1,155명, 게시물 891개 - 먹스나 muksna (@sn_muk)님의 Instagram 계정: '소개글'"
    const m = metaDesc.match(/^(.*?)\s*-\s*(.*?)\s*\(@[^)]+\)님의 Instagram 계정[:.]?\s*'?([\s\S]*?)'?$/);
    if (!m) return null;
    const [, stats, nickname, bio] = m;
    const followerMatch = stats.match(/팔로워\s*([\d.,]+\s*[만천억]?|[\d.,]+[KMB]?)\s*명/i);
    const followingMatch = stats.match(/팔로잉\s*([\d.,]+\s*[만천억]?|[\d.,]+[KMB]?)\s*명/i);
    const postMatch = stats.match(/게시물\s*([\d.,]+)\s*개/);
    const avatarUrl = await page.evaluate(() => document.querySelector('header img')?.src || '');
    return {
      uniqueId: username,
      nickname: (nickname || username).trim(),
      bio: (bio || '').trim(),
      avatarUrl: avatarUrl || '',
      followerCount: parseCount(followerMatch?.[1]),
      followingCount: parseCount(followingMatch?.[1]),
      postCount: postMatch ? parseInt(postMatch[1].replace(/,/g, ''), 10) : null,
      profileUrl: `https://www.instagram.com/${username}/`,
    };
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

module.exports = { withBrowser, discoverUsers, getUserProfile };
