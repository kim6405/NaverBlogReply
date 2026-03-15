// naverBot.ts와 완전히 동일한 로직으로 최종 검증
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
const myBlogReferer = `https://m.blog.naver.com/kjh_hero`;

console.log(`[Test] ${neighborId} 최종 검증`);
await page.goto('about:blank', { waitUntil: 'load' });
await page.waitForTimeout(3000);

await page.goto(`https://blog.naver.com/${neighborId}`, {
  waitUntil: 'networkidle',
  timeout: 30000,
  referer: myBlogReferer,
});
await page.waitForTimeout(3000);

let latestLogNo = null;
const frames = page.frames();

// 1차: PostList iframe에서 a[href] 파싱
for (const frame of frames) {
  if (frame === page.mainFrame()) continue;
  const frameUrl = frame.url();
  if (!frameUrl.includes('PostList') && !frameUrl.includes(neighborId)) continue;
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
      console.log(`✅ 1차 성공 - logNo: ${latestLogNo} (iframe: ${frameUrl.substring(0, 70)})`);
      break;
    }
  } catch(e) {}
}

// 2차: 전체 iframe
if (!latestLogNo) {
  for (const frame of frames) {
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
        console.log(`✅ 2차 성공 - logNo: ${latestLogNo}`);
        break;
      }
    } catch(_) {}
  }
}

console.log('[Result] latestLogNo:', latestLogNo);

if (latestLogNo) {
  const directPostUrl = `https://m.blog.naver.com/${neighborId}/${latestLogNo}`;
  console.log(`[Step] 포스트로 이동: ${directPostUrl}`);
  await page.goto(directPostUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const finalUrl = page.url();
  console.log('[Result] 최종 URL:', finalUrl);
  const isOk = !finalUrl.includes('ErrorView') && !finalUrl.includes('errorType=');
  console.log(isOk ? '✅ 포스트 정상 접속 성공!' : '❌ 오류 페이지');
  if (isOk) {
    const title = await page.$eval('title', el => el.textContent).catch(() => '없음');
    console.log('  타이틀:', title);
  }
}

console.log('\n15초 후 종료...');
await page.waitForTimeout(15000);
await context.close();
