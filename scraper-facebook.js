/**
 * scraper-facebook.js
 * 페이스북은 검색(/search/*)이 로그인 없이는 전부 막혀있지만(직접 테스트로 확인),
 * 해시태그 피드(/hashtag/{키워드})와 프로필/페이지는 로그인 없이 열린다.
 * 다만 해시태그 피드는 로그인 없이는 노출되는 게시물 수가 매우 적어(검색어 대부분 0~1건),
 * 다른 플랫폼보다 수집 효율이 훨씬 낮다 — 가능한 범위 내에서 최대한 수집하는 파일럿.
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

function parseCount(text) {
  if (!text) return null;
  const s = String(text).replace(/,/g, '').trim();
  const m = s.match(/([\d.]+)\s*(만|천|억|K|M|B)?/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const mul = { 만: 1e4, 천: 1e3, 억: 1e8, K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1;
  return Math.round(num * mul);
}

/** 해시태그 피드에서 게시물 작성자(개인/페이지) 프로필 링크 추출 (로그인 불필요, 결과가 적을 수 있음) */
async function discoverUsers(context, keyword) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.facebook.com/hashtag/${encodeURIComponent(keyword)}`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(2500);
    const links = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href*="/people/"]')].map((a) => (a.getAttribute('href') || '').split('?')[0]))]
    );
    return links.filter(Boolean);
  } catch {
    return [];
  } finally {
    await page.close();
  }
}

/** 프로필/페이지에서 채널 단위 통계 수집 (게시물 본문은 수집하지 않음) */
async function getUserProfile(context, profilePath) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.facebook.com${profilePath}`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(2000);
    const metaDesc = await page.evaluate(() => document.querySelector('meta[name="description"]')?.content || '');
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    if (!metaDesc && !bodyText) return null;
    // "이름. 좋아하는 사람 3,703명 · 이야기하고 있는 사람들 1,067명. 소개글"
    const m = metaDesc.match(/^(.*?)\.\s*좋아하는 사람\s*([\d.,만천억KMB]+)\s*명[\s\S]*?\.\s*([\s\S]*)$/);
    const nickname = (m?.[1] || '').trim();
    const likeCount = parseCount(m?.[2]);
    const bio = (m?.[3] || '').trim();
    const followerMatch = bodyText.match(/팔로워\s*([\d.,]+\s*[만천억]?|[\d.,]+[KMB]?)\s*명/i);
    if (!nickname && followerMatch == null) return null;
    const avatarUrl = await page.evaluate(() => document.querySelector('image, svg image')?.getAttribute?.('xlink:href') || document.querySelector('img[referrerpolicy]')?.src || '');
    return {
      uniqueId: profilePath.replace(/^\//, ''),
      nickname: nickname || profilePath,
      bio,
      avatarUrl: avatarUrl || '',
      followerCount: parseCount(followerMatch?.[1]),
      likeCount,
      profileUrl: `https://www.facebook.com${profilePath}`,
    };
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

module.exports = { withBrowser, discoverUsers, getUserProfile };
