// PostList API로 최신 포스트 logNo 가져오기 테스트
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

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

const neighborId = 'shindoragon';
const postListUrl = `https://blog.naver.com/PostList.naver?blogId=${neighborId}&widgetTypeCall=true&currentPage=1&countPerPage=1&postListType=&categoryNo=&parentCategoryNo=`;

console.log(`[Test] PostList API 호출: ${postListUrl}`);
await page.goto(postListUrl, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(3000);

console.log('[Test] 현재 URL:', page.url());

// a 태그에서 logNo 추출
const allLinks = await page.$$eval('a', links =>
  links.map(l => l.href).filter(h => h.includes('logNo') || /\/\d{8,}/.test(h))
);
console.log('[Test] logNo 포함 링크:', allLinks);

// iframe에서 logNo 추출
const iframeSrcs = await page.$$eval('iframe', iframes => iframes.map(i => i.src));
console.log('[Test] iframe srcs:', iframeSrcs);

// HTML에서 logNo 패턴
const html = await page.content();
const match = html.match(/"logNo"\s*:\s*"?(\d+)"?/) || html.match(/logNo=(\d+)/);
console.log('[Test] HTML에서 logNo 추출:', match ? match[1] : '없음');

// 성공 시 해당 포스트로 이동
if (match && match[1]) {
  const logNo = match[1];
  const postUrl = `https://m.blog.naver.com/${neighborId}/${logNo}`;
  console.log(`\n[Test] 포스트로 직접 이동: ${postUrl}`);
  await page.goto(postUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('[Test] 이동 후 URL:', page.url());
  const title = await page.$eval('title', el => el.textContent).catch(() => '없음');
  console.log('[Test] 페이지 타이틀:', title);
}

console.log('\n[Test] 완료. 10초 후 종료...');
await page.waitForTimeout(10000);
await context.close();
