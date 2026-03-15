// shindoragon 블로그에서 실제 포스트 링크 구조 분석
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userDataDir = path.resolve(process.cwd(), '.naver_session_test_tmp');

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
  args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
  viewport: null,
});

const pages = context.pages();
const page = pages.length > 0 ? pages[0] : await context.newPage();

console.log('[Test] m.blog.naver.com/shindoragon 접속 중...');
await page.goto('https://m.blog.naver.com/shindoragon', {
  waitUntil: 'networkidle',
  timeout: 30000,
});
await page.waitForTimeout(3000);

console.log('[Test] 현재 URL:', page.url());

// 페이지의 모든 a 태그 href 목록 출력 (logNo 포함된 것만)
const allLinks = await page.$$eval('a', links =>
  links
    .filter(l => l.href && l.href.trim() !== '')
    .map(l => ({ href: l.href, class: l.className, text: l.textContent?.trim().substring(0, 30) }))
    .filter(l => l.href.includes('logNo') || /\/\d{8,}/.test(l.href) || l.href.includes('PostView'))
);
console.log('[Test] logNo 포함 링크:', allLinks);

// 페이지 HTML에서 주요 컨테이너 확인
const containers = await page.$$eval('[class*="item"], [class*="card"], [class*="post"], [class*="list"]', els =>
  els.slice(0, 5).map(el => ({ tag: el.tagName, class: el.className, text: el.innerText?.substring(0, 50) }))
);
console.log('[Test] 포스트 컨테이너 후보:', containers);

// 스크롤 후 다시 확인
await page.evaluate(() => window.scrollBy(0, 1500));
await page.waitForTimeout(2000);
const afterScrollLinks = await page.$$eval('a', links =>
  links
    .filter(l => l.href && (l.href.includes('logNo') || /\/\d{8,}/.test(l.href)))
    .map(l => ({ href: l.href, class: l.className }))
);
console.log('[Test] 스크롤 후 포스트 링크:', afterScrollLinks);

console.log('[Test] 10초 후 종료...');
await page.waitForTimeout(10000);
await context.close();
