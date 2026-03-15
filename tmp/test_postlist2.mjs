// 다양한 API로 최신 포스트 logNo 가져오기 시도
import { chromium } from 'playwright';
import path from 'path';

const userDataDir = path.resolve(process.cwd(), '.naver_session_test_tmp');

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
  args: ['--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'],
  viewport: null,
});

const pages = context.pages();
const page = pages.length > 0 ? pages[0] : await context.newPage();

const neighborId = 'shindoragon';

// API 1: PostTitleList.naver (JSON 반환, 전체 카테고리)
const url1 = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${neighborId}&viewdate=&currentPage=1&categoryNo=&postListType=QS&listStyle=&countPerPage=5`;
console.log('\n[API 1] PostTitleListAsync:', url1);
await page.goto(url1, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);
const text1 = await page.evaluate(() => document.body.innerText);
console.log('[API 1] 응답:', text1.substring(0, 500));

// API 2: blog.naver.com/PostView.naver (전체 포스트 목록에서 제일 위 것)
const url2 = `https://blog.naver.com/${neighborId}`;
console.log('\n[API 2] 블로그 메인 (PC):', url2);
await page.goto(url2, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);
console.log('[API 2] 현재 URL:', page.url());
const logNos2 = await page.evaluate(() => {
  const html = document.documentElement.innerHTML;
  const matches = [...html.matchAll(/logNo[=:"'\s]+(\d{8,})/g)];
  return [...new Set(matches.map(m => m[1]))].slice(0, 5);
});
console.log('[API 2] logNo 목록:', logNos2);

// API 3: iframe으로 로드되는 실제 블로그 컨텐츠 파싱
const frames = page.frames();
console.log('[API 2] 프레임 수:', frames.length);
for (const frame of frames) {
  console.log('  Frame URL:', frame.url());
  const frameLogNos = await frame.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const matches = [...html.matchAll(/logNo[=:"'\s]+(\d{8,})/g)];
    return [...new Set(matches.map(m => m[1]))].slice(0, 3);
  }).catch(() => []);
  if (frameLogNos.length > 0) console.log('  Frame logNos:', frameLogNos);
}

console.log('\n[Test] 완료. 10초 후 종료...');
await page.waitForTimeout(10000);
await context.close();
