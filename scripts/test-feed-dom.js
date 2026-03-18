const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const userDataDir = path.resolve(process.cwd(), '.naver_session');
  console.log('Using profile:', userDataDir);
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: null
  });
  const page = await context.newPage();
  
  await page.goto('https://m.blog.naver.com/FeedList.naver?groupId=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(1000);
  }

  const posts = await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.card_item, .feed_card_item, li[class*="item"], div[class*="item"]'));
    const results = [];
    const seenLogNos = new Set();
    
    containers.forEach(container => {
      const linkEl = container.querySelector('a');
      if (!linkEl) return;
      
      const href = linkEl.href;
      const blogIdMatch = href.match(/blogId=([^&]+)/) || href.match(/m\.blog\.naver\.com\/([^\/]+)\/(\d+)/);
      if(!blogIdMatch) return;
      const blogId = blogIdMatch[1];
      
      // 모든 하위 요소의 클래스 모음
      const allClassList = Array.from(container.querySelectorAll('*')).map(el => el.className).join(' ');
      
      const targetIds = ['sol2roo', 'park710109']; // 샘플로 확인 (사용자가 말한 2개일 가능성 있는 아이디들?)
      // 실제 사용자의 이웃 아이디를 모르니, 일단 전체 출력
      
      results.push({
        blogId,
        title: (container.querySelector('strong, h3, .title')?.textContent || "").trim().substring(0, 15),
        classes: container.className,
        allClasses: allClassList.substring(0, 200)
      });
    });

    return results;
  });
  
  console.log('==== ALL A TAGS IN FEED ====');
  posts.forEach(p => console.log(p));
  console.log('Total a tags with blogId/logNo:', posts.length);
  
  await context.close();
})();
