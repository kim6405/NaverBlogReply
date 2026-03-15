// 실제 존재하는 포스트 logNo를 찾는 방법 탐색
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

// 방법 1: PostList.naver URL의 iframe에서 가진 logNo의 실제 접속 가능 여부 확인
console.log('[A] PostList.naver (일반 포스트) - 카테고리 전체');
const apiA = `https://blog.naver.com/PostList.naver?blogId=${neighborId}&widgetTypeCall=true&topObjectType=post&skinType=&blogMainViewType=LNB&currentPage=1&countPerPage=5&postListType=&categoryNo=&parentCategoryNo=`;
await page.goto(apiA, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);
const framesA = page.frames();
for (const f of framesA) {
  if (f === page.mainFrame()) continue;
  try {
    const html = await f.evaluate(() => document.documentElement.innerHTML);
    const matches = [...html.matchAll(/logNo[=:"'\s]+(\d{5,})/g)];
    const nos = [...new Set(matches.map(m => m[1]))];
    if (nos.length > 0) console.log('  [A] frame logNos:', nos, ' url:', f.url().substring(0, 80));
  } catch(_) {}
}

// 방법 2: blogId로 전체 글 목록 JSON API
console.log('\n[B] PostTitleListAsync - JSON API');
const apiB = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${neighborId}&viewdate=&currentPage=1&categoryNo=&postListType=QS&listStyle=&countPerPage=10`;
await page.goto(apiB, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);
const textB = await page.evaluate(() => document.body.innerText);
console.log('[B] 응답:', textB.substring(0, 500));

// 방법 3: 모바일 API (metatag 기반)
console.log('\n[C] 모바일 카테고리 특정');
const apiC = `https://m.blog.naver.com/${neighborId}?categoryNo=42`; // 메모글 카테고리
await page.goto(apiC, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);
console.log('[C] URL:', page.url());
const linksC = await page.$$eval('a', ls =>
  ls.filter(l => l.href.includes('logNo') || /\/\d{8,}/.test(l.href))
    .map(l => l.href)
    .slice(0, 5)
);
console.log('[C] links:', linksC);

// 방법 4: RSS 피드
console.log('\n[D] RSS 피드');
const apiD = `https://rss.blog.naver.com/${neighborId}.xml`;
await page.goto(apiD, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);
const rssText = await page.evaluate(() => document.body.innerText);
console.log('[D] RSS 일부:', rssText.substring(0, 500));

// RSS에서 logNo 추출
const rssMatches = [...rssText.matchAll(/logNo[=:'"]+(\d+)|naver\.com\/(\d+)/g)];
const rssLogNos = rssMatches.map(m => m[1] || m[2]).filter(Boolean);
console.log('[D] logNos from RSS:', rssLogNos);

if (rssLogNos.length > 0) {
  const testUrl = `https://m.blog.naver.com/${neighborId}/${rssLogNos[0]}`;
  console.log(`\n[D] RSS logNo로 접속 테스트: ${testUrl}`);
  await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  console.log('[D] 결과 URL:', page.url());
  const isOk = !page.url().includes('ErrorView');
  console.log(isOk ? '✅ 성공!' : '❌ 오류 페이지');
}

console.log('\n10초 후 종료...');
await page.waitForTimeout(10000);
await context.close();
