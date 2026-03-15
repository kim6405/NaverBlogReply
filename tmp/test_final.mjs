// naverBot.ts의 새 방식과 동일한 로직으로 최종 검증
import { chromium } from 'playwright';
import path from 'path';

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
const myBlogId = 'kjh_hero'; // 내 블로그 ID

console.log(`[Test] 이웃 방문 시뮬레이션: ${neighborId}`);
console.log('[Step 1] about:blank 경유...');
await page.goto('about:blank', { waitUntil: 'load' });
await page.waitForTimeout(3000);

// 1차 오류 감지 후 PC 블로그로 접속
const pcBlogUrl = `https://blog.naver.com/${neighborId}`;
const myBlogReferer = `https://m.blog.naver.com/${myBlogId}`;
console.log(`[Step 2] PC 블로그 접속: ${pcBlogUrl}`);
const res = await page.goto(pcBlogUrl, {
  waitUntil: 'networkidle',
  timeout: 30000,
  referer: myBlogReferer,
});
await page.waitForTimeout(3000);

const currentUrl = page.url();
console.log('[Step 2] 최종 URL:', currentUrl);
console.log('[Step 2] HTTP Status:', res?.status());

// iframe에서 logNo 탐색
let latestLogNo = null;
const frames = page.frames();
console.log(`[Step 3] 프레임 수: ${frames.length}`);
for (const frame of frames) {
  if (frame === page.mainFrame()) continue;
  try {
    const frameUrl = frame.url();
    const frameHtml = await frame.evaluate(() => document.documentElement.innerHTML);
    const matches = [...frameHtml.matchAll(/logNo[=:"'\s]+(\d{8,})/g)];
    const logNos = [...new Set(matches.map(m => m[1]))];
    if (logNos.length > 0) {
      console.log(`  iframe (${frameUrl}) → logNo:`, logNos);
      if (!latestLogNo) latestLogNo = logNos[0];
    }
  } catch (e) {}
}

if (!latestLogNo) {
  // 메인 프레임 시도
  const mainHtml = await page.evaluate(() => document.documentElement.innerHTML);
  const match = mainHtml.match(/logNo[=:"'\s]+(\d{8,})/);
  if (match) latestLogNo = match[1];
}

console.log('\n[Result] 최종 logNo:', latestLogNo);

if (latestLogNo) {
  const postUrl = `https://m.blog.naver.com/${neighborId}/${latestLogNo}`;
  console.log(`[Step 4] 포스트로 이동: ${postUrl}`);
  await page.goto(postUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('[Step 4] 이동 후 URL:', page.url());
  const isError = page.url().includes('MobileErrorView') || page.url().includes('errorType=');
  console.log('[Step 4] 오류 페이지 여부:', isError);
  if (!isError) console.log('✅ 성공! 포스트 페이지 정상 접속');
} else {
  console.log('❌ logNo를 찾을 수 없음');
}

console.log('\n10초 후 종료...');
await page.waitForTimeout(10000);
await context.close();
