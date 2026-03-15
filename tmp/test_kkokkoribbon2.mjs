// 정확한 방식으로 포스트 URL 추출 재테스트
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

console.log(`[Test] ${neighborId} 블로그 포스트 탐색`);
await page.goto('about:blank', { waitUntil: 'load' });
await page.waitForTimeout(2000);

await page.goto(`https://blog.naver.com/${neighborId}`, {
  waitUntil: 'networkidle',
  timeout: 30000,
  referer: myBlogReferer,
});
await page.waitForTimeout(3000);

// iframe에서 a태그 href로 정확한 logNo 추출
const frames = page.frames();
console.log(`프레임 수: ${frames.length}`);

for (const frame of frames) {
  if (frame === page.mainFrame()) continue;
  const fUrl = frame.url();
  if (!fUrl.includes('PostList') && !fUrl.includes('blog.naver.com/') ) continue;
  
  try {
    // a태그 href에서 직접 logNo 추출 (더 정확한 방법)
    const postLinks = await frame.$$eval('a', (links, blogId) => {
      return links
        .map(l => l.href)
        .filter(h => {
          // blog.naver.com/blogId/logNo 또는 logNo=xxx 패턴
          return (h.includes(`blog.naver.com/${blogId}/`) || h.includes(`blogId=${blogId}`)) &&
                 (h.match(/\/\d{9,11}/) || h.match(/logNo=\d{9,11}/));
        })
        .map(h => {
          const m = h.match(/\/(\d{9,11})/) || h.match(/logNo=(\d{9,11})/);
          return m ? m[1] : null;
        })
        .filter(Boolean);
    }, neighborId).catch(() => []);
    
    if (postLinks.length > 0) {
      console.log(`✅ iframe (${fUrl.substring(0,80)}) → logNos:`, [...new Set(postLinks)]);
    }
    
    // 방법 2: PostView URL 직접 파싱
    const allHrefs = await frame.$$eval('a', ls => ls.map(l => l.href)).catch(() => []);
    const postViewHrefs = allHrefs.filter(h => 
      h.includes('PostView.naver') || 
      (h.includes('naver.com') && /\/\d{9,11}/.test(h))
    );
    if (postViewHrefs.length > 0) {
      console.log(`  PostView hrefs:`, postViewHrefs.slice(0, 5));
    }
  } catch(e) { console.log(`  frame 오류: ${e.message}`); }
}

// 메인 프레임 a태그도 확인
const mainPostLinks = await page.$$eval('a', (links, blogId) => {
  return links
    .map(l => l.href)
    .filter(h => h.includes(blogId) && (/\/\d{9,11}/.test(h) || /logNo=\d{9,11}/.test(h)))
    .slice(0, 10);
}, neighborId);
console.log('\n메인 프레임 포스트 링크:', mainPostLinks);

console.log('\n15초 후 종료...');
await page.waitForTimeout(15000);
await context.close();
