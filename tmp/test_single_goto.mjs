// 수정된 로직 최종 검증 - blog.naver.com 한 번만 접속
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
const blogUrl = `https://blog.naver.com/${neighborId}`; // 처음부터 PC 버전

console.log(`[Test] ${neighborId} 단일 접속 후 iframe 탐색`);

// Step 1: about:blank
await page.goto('about:blank', { waitUntil: 'load' });
await page.waitForTimeout(3000);

// Step 2: blog.naver.com/${neighborId} 단 한 번만 접속
console.log(`[Step 2] 접속: ${blogUrl}`);
const response = await page.goto(blogUrl, {
  waitUntil: 'networkidle',
  timeout: 35000,
  referer: myBlogReferer,
});
await page.waitForTimeout(3000);

const currentUrl = page.url();
console.log(`[Step 2] 최종 URL: ${currentUrl}`);
console.log(`[Step 2] HTTP: ${response?.status()}`);

// 오류 감지
const isErrorUrl = currentUrl.includes('ErrorView') || currentUrl.includes('errorType=');
const content = await page.content();
const hasErrorText = ['일시적인 오류', '유효하지 않은 요청', '접속할 수 없습니다'].some(k => content.includes(k));
if (isErrorUrl || hasErrorText) {
  console.log('❌ 오류 페이지:', currentUrl);
  await page.waitForTimeout(5000);
  await context.close();
  process.exit(0);
}
console.log('✅ 정상 접속 확인');

// Step 3: 같은 페이지에서 iframe 탐색 (재접속 없음!)
console.log(`[Step 3] iframe에서 logNo 탐색...`);
let latestLogNo = null;

// 1차: PostList iframe
for (const frame of page.frames()) {
  if (frame === page.mainFrame()) continue;
  const fUrl = frame.url();
  if (!fUrl.includes('PostList') && !fUrl.includes(neighborId)) continue;
  try {
    const logNos = await frame.$$eval('a', (links, blogId) => {
      return links
        .map(l => l.href)
        .filter(h => h.includes(`blogId=${blogId}`) || h.includes(`naver.com/${blogId}/`))
        .map(h => {
          const m = h.match(/logNo=(\d{9,12})/) || h.match(new RegExp(`/${blogId}/(\\d{9,12})`));
          return m ? m[1] : null;
        })
        .filter(Boolean);
    }, neighborId);
    const unique = [...new Set(logNos)];
    if (unique.length > 0) {
      latestLogNo = unique[0];
      console.log(`✅ [1차] logNo: ${latestLogNo} (${fUrl.substring(0, 70)})`);
      break;
    }
  } catch(_) {}
}

// 2차: 전체 iframe
if (!latestLogNo) {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const logNos = await frame.$$eval('a', (links, blogId) => {
        return links
          .map(l => l.href)
          .map(h => {
            const m = h.match(/logNo=(\d{9,12})/) || h.match(new RegExp(`/${blogId}/(\\d{9,12})`));
            return m ? m[1] : null;
          })
          .filter(Boolean);
      }, neighborId);
      const unique = [...new Set(logNos)];
      if (unique.length > 0) {
        latestLogNo = unique[0];
        console.log(`✅ [2차] logNo: ${latestLogNo}`);
        break;
      }
    } catch(_) {}
  }
}

if (!latestLogNo) {
  console.log('❌ logNo 탐색 실패');
  await page.waitForTimeout(5000);
  await context.close();
  process.exit(0);
}

// Step 4: 포스트 직접 이동
const directPostUrl = `https://m.blog.naver.com/${neighborId}/${latestLogNo}`;
console.log(`\n[Step 4] 포스트 이동: ${directPostUrl}`);
await page.goto(directPostUrl, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

const finalUrl = page.url();
console.log(`[Step 4] 최종 URL: ${finalUrl}`);
const isOk = !finalUrl.includes('ErrorView') && !finalUrl.includes('errorType=');
console.log(isOk ? '✅ 성공! 포스트 정상 접속' : `❌ 오류: ${finalUrl}`);

if (isOk) {
  const title = await page.$eval('title', el => el.textContent).catch(() => '없음');
  console.log('  타이틀:', title);
}

console.log('\n15초 후 종료...');
await page.waitForTimeout(15000);
await context.close();
