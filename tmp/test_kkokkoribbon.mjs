// kkokkoribbon 블로그 이웃 방문 시뮬레이션 (naverBot.ts 로직과 동일)
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

const neighborId = 'kkokkoribbon';
const myBlogId = 'kjh_hero';
const myBlogReferer = `https://m.blog.naver.com/${myBlogId}`;

console.log(`\n============================`);
console.log(`[Test] 블로그: ${neighborId}`);
console.log(`============================`);

// Step 1: about:blank 경유
console.log('[Step 1] about:blank 경유 (3초 대기)...');
await page.goto('about:blank', { waitUntil: 'load' });
await page.waitForTimeout(3000);

// Step 2: PC 블로그 접속
const pcBlogUrl = `https://blog.naver.com/${neighborId}`;
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

// 오류 페이지 감지
const isErrorUrl = currentUrl.includes('MobileErrorView') || currentUrl.includes('errorType=');
const pageContent = await page.content();
const errorKeywords = ['페이지를 찾을 수 없습니다', '일시적인 오류', '일시적오류', '서비스에 접속할 수 없습니다', '접속할 수 없습니다', '존재하지 않는 블로그', '비공개 블로그'];
const matchedError = errorKeywords.find(k => pageContent.includes(k));
if (isErrorUrl || matchedError) {
  console.log('❌ 오류 페이지 감지:', matchedError || currentUrl);
  await page.waitForTimeout(5000);
  await context.close();
  process.exit(0);
}

// Step 3: iframe에서 logNo 탐색
console.log('[Step 3] iframe에서 logNo 탐색...');
let latestLogNo = null;
const frames = page.frames();
console.log(`  프레임 수: ${frames.length}`);

for (const frame of frames) {
  if (frame === page.mainFrame()) continue;
  try {
    const frameHtml = await frame.evaluate(() => document.documentElement.innerHTML);
    const matches = [...frameHtml.matchAll(/logNo[=:"'\s]+(\d{8,})/g)];
    const logNos = [...new Set(matches.map(m => m[1]))];
    if (logNos.length > 0) {
      console.log(`  ✅ iframe에서 logNo 발견: ${logNos} (${frame.url().substring(0, 70)})`);
      if (!latestLogNo) latestLogNo = logNos[0];
    }
  } catch(_) {}
}

// 메인 프레임에서도 시도
if (!latestLogNo) {
  const mainHtml = await page.evaluate(() => document.documentElement.innerHTML);
  const match = mainHtml.match(/logNo[=:"'\s]+(\d{8,})/);
  if (match) {
    latestLogNo = match[1];
    console.log(`  ✅ 메인 프레임에서 logNo 발견: ${latestLogNo}`);
  }
}

if (!latestLogNo) {
  console.log('❌ logNo를 찾을 수 없음. RSS로 시도...');
  const apiD = `https://rss.blog.naver.com/${neighborId}.xml`;
  await page.goto(apiD, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  const rssText = await page.evaluate(() => document.body.innerText);
  const rssMatches = [...rssText.matchAll(/logNo[=:'"]+(\d+)/g)];
  const rssLogNos = rssMatches.map(m => m[1]).filter(Boolean);
  console.log('  RSS logNos:', rssLogNos);
  if (rssLogNos.length > 0) latestLogNo = rssLogNos[0];
}

console.log('\n[Result] 최종 logNo:', latestLogNo);

if (!latestLogNo) {
  console.log('❌ 접속 가능한 포스트 없음. 종료.');
  await page.waitForTimeout(5000);
  await context.close();
  process.exit(0);
}

// Step 4: 포스트로 직접 이동
const directPostUrl = `https://m.blog.naver.com/${neighborId}/${latestLogNo}`;
console.log(`\n[Step 4] 포스트로 이동: ${directPostUrl}`);
await page.goto(directPostUrl, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

const postUrl = page.url();
console.log('[Step 4] 이동 후 URL:', postUrl);
const isPostError = postUrl.includes('ErrorView') || postUrl.includes('errorType=');
if (isPostError) {
  console.log('❌ 포스트 접속 오류:', postUrl);
} else {
  console.log('✅ 포스트 정상 접속!');
  const title = await page.$eval('title', el => el.textContent).catch(() => '없음');
  console.log('  페이지 타이틀:', title);
}

console.log('\n15초 후 종료...');
await page.waitForTimeout(15000);
await context.close();
