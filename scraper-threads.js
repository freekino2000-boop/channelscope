/**
 * scraper-threads.js
 * 스레드(Threads)는 로그인 없이도 프로필 통계와 검색 결과가 그대로 노출된다(직접 테스트로 확인).
 * meta description 태그에서 팔로워수/스레드수/소개글을 파싱하고,
 * 검색 결과 페이지 DOM에서 사용자 핸들을 추출한다.
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

/** 검색어로 스레드 게시물을 찾아 작성자 핸들 목록 추출 (로그인 불필요) */
async function searchUsers(context, query) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.threads.net/search?q=${encodeURIComponent(query)}&serp_type=default`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(2500);
    const handles = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href^="/@"]')].map((a) => a.getAttribute('href') || ''))]
    );
    return handles
      .map((href) => (href.match(/^\/@([^/?]+)/) || [])[1])
      .filter(Boolean)
      .map((id) => decodeURIComponent(id));
  } catch {
    return [];
  } finally {
    await page.close();
  }
}

/** 프로필 페이지에서 채널 단위 통계 수집 (개별 스레드 본문은 수집하지 않음) */
async function getUserProfile(context, handle) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.threads.net/@${encodeURIComponent(handle)}`, {
      waitUntil: 'load', timeout: 20000,
    });
    await page.waitForTimeout(2000);
    const metaDesc = await page.evaluate(() => document.querySelector('meta[name="description"]')?.content || '');
    if (!metaDesc) return null;
    // "팔로워 166명 • 스레드 55개 • 빵순이 🍞. @oh_homez님과의 최근 대화를 확인해보세요." 형태
    const followerMatch = metaDesc.match(/팔로워\s*([\d.,]+\s*[만천억]?|[\d.,]+[KMB]?)\s*명/i);
    const threadCountMatch = metaDesc.match(/스레드\s*([\d.,]+)\s*개/);
    const bioMatch = metaDesc
      .split('•').slice(2).join('•')
      .replace(new RegExp(`\\.?\\s*@${handle}님과의[\\s\\S]*$`), '')
      .trim();
    // 첫 h1은 보통 핸들, 두번째 h1이 실제 표시 이름인 경우가 많아 핸들과 다른 첫 값을 사용
    const nickname = await page.evaluate((h) => {
      const hs = [...document.querySelectorAll('h1')].map((e) => e.textContent.trim());
      return hs.find((t) => t && t !== h) || hs[0] || '';
    }, handle);
    const avatarUrl = await page.evaluate(() => document.querySelector('header img, img[alt*="프로필"]')?.src || '');
    return {
      uniqueId: handle,
      nickname: nickname || handle,
      bio: bioMatch || '',
      avatarUrl: avatarUrl || '',
      followerCount: parseCount(followerMatch?.[1]),
      threadCount: threadCountMatch ? parseInt(threadCountMatch[1].replace(/,/g, ''), 10) : null,
      profileUrl: `https://www.threads.net/@${handle}`,
    };
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

module.exports = { withBrowser, searchUsers, getUserProfile };
