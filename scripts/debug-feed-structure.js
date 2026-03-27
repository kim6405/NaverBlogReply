const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const log = [];
function l(msg) { log.push(msg); console.log(msg); }

(async () => {
  const userDataDir = path.resolve(process.cwd(), '.naver_session');
  l('Using profile: ' + userDataDir);
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: null
  });
  const page = await context.newPage();
  
  await page.goto('https://m.blog.naver.com/FeedList.naver?groupId=1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  // 1. 스크롤 전 피드 아이템 수
  const beforeScrollCount = await page.evaluate(() => {
    return {
      allLinks: document.querySelectorAll('a').length,
      cardItems: document.querySelectorAll('.card_item').length,
      feedCardItems: document.querySelectorAll('.feed_card_item').length,
      liItemStar: document.querySelectorAll('li[class*="item"]').length,
      divItemStar: document.querySelectorAll('div[class*="item"]').length,
    };
  });
  l('\n==== BEFORE SCROLL - Element counts ====');
  l(JSON.stringify(beforeScrollCount, null, 2));

  // 2. 피드 아이템의 실제 구조 (첫번째 블로그 포스트 링크의 부모 계층)
  const feedItemStructure = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const blogLink = links.find(link => {
      const h = link.href;
      return h.includes('blog.naver.com') && 
        !h.includes('FeedList') && !h.includes('CommentList') && !h.includes('Recommendation') &&
        (h.match(/logNo=\d+/) || h.match(/\/\d{10,}/));
    });
    if (!blogLink) return null;
    
    const hierarchy = [];
    let el = blogLink;
    for (let i = 0; i < 15 && el; i++) {
      hierarchy.push({
        tag: el.tagName,
        cls: (el.className || '').toString().substring(0, 200),
        id: el.id || '',
        childCount: el.children ? el.children.length : 0,
      });
      el = el.parentElement;
    }
    return { linkHref: blogLink.href, hierarchy };
  });
  l('\n==== Feed item DOM hierarchy ====');
  if (feedItemStructure) {
    l('Link: ' + feedItemStructure.linkHref);
    feedItemStructure.hierarchy.forEach((h, i) => l('  Level ' + i + ': ' + JSON.stringify(h)));
  }

  // 3. 피드 컨테이너의 모든 직접 자식 클래스 (피드 리스트의 루트 확인)
  const feedListRoot = await page.evaluate(() => {
    // class*="feed" 또는 class*="list" 인 컨테이너를 찾아서 자식 구조를 확인합니다
    const candidates = Array.from(document.querySelectorAll('[class*="feed_list"], [class*="feedList"], [class*="feed_area"], [class*="content_list"], ul[class*="list"], ol[class*="list"]'));
    return candidates.map(c => ({
      tag: c.tagName,
      cls: (c.className || '').toString().substring(0, 200),
      childCount: c.children.length,
      firstChildTag: c.children[0]?.tagName || '',
      firstChildCls: (c.children[0]?.className || '').toString().substring(0, 200) || '',
    }));
  });
  l('\n==== Feed list root candidates ====');
  feedListRoot.forEach((r, i) => l('[' + i + '] ' + JSON.stringify(r)));

  // 4. 스크롤하면서 각 스텝에서 a 태그 수 확인
  l('\n==== SCROLLING TEST ====');
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(800);
    
    const count = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const blogLinks = links.filter(l => {
        const h = l.href;
        return h.includes('blog.naver.com') && 
          !h.includes('FeedList') && !h.includes('CommentList') && !h.includes('Recommendation') &&
          (h.match(/logNo=\d+/) || h.match(/\/\d{10,}/));
      });
      const unique = new Set(blogLinks.map(l => l.href));
      return { totalDoml: document.querySelectorAll('*').length, totalLinks: links.length, blogLinks: blogLinks.length, uniqueBlogLinks: unique.size };
    });
    l('  Scroll ' + (i+1) + ': ' + JSON.stringify(count));
  }

  // 5. 최종 - 모든 감지된 블로그 포스트
  const finalPosts = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const results = [];
    const seen = new Set();
    
    for (const l of links) {
      const href = l.href;
      if (!href.includes('blog.naver.com')) continue;
      if (href.includes('FeedList') || href.includes('CommentList') || href.includes('Recommendation')) continue;
      
      const blogIdMatch = href.match(/blogId=([^&]+)/) || href.match(/m\.blog\.naver\.com\/([^\/\?#]+)\/(\d+)/);
      const logNoMatch = href.match(/logNo=(\d+)/) || href.match(/\/(\d{10,})(?:\?|$|#)/);
      
      if (!blogIdMatch || !logNoMatch) continue;
      
      const blogId = blogIdMatch[1];
      const logNo = logNoMatch[1];
      const key = blogId + '_' + logNo;
      
      if (seen.has(key)) continue;
      if (['FeedList.naver', 'CommentList.naver', 'PostList.naver'].includes(blogId)) continue;
      
      seen.add(key);
      
      const container = l.closest('li, article, [class*="card"], [class*="feed"]') || l.parentElement;
      
      results.push({
        blogId,
        logNo,
        containerCls: (container?.className || '').toString().substring(0, 100),
        containerTag: container?.tagName || 'none',
      });
    }
    return results;
  });
  l('\n==== FINAL - All detected blog posts ====');
  finalPosts.forEach((p, i) => l('[' + i + '] ' + JSON.stringify(p)));
  l('Total unique posts: ' + finalPosts.length);

  // 6. 현재 코드의 셀렉터로 테스트
  const currentCodeResult = await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.card_item, .feed_card_item, li[class*="item"], div[class*="item"]'));
    const results = [];
    const seenLogNos = new Set();

    containers.forEach(container => {
      const linkEl = container.querySelector('a');
      if (!linkEl) return;
      const href = linkEl.href;
      const blogIdMatch = href.match(/blogId=([^&]+)/) || href.match(/m\.blog\.naver\.com\/([^\/]+)\/(\d+)/);
      if (!blogIdMatch) return;
      const logNoMatch = href.match(/logNo=(\d+)/) || href.match(/\/(\d+)\??/);
      if (!logNoMatch) return;

      const blogId = blogIdMatch[1];
      const logNo = logNoMatch[logNoMatch.length - 1];
      if (blogId === 'FeedList.naver' || blogId === 'CommentList.naver') return;

      const key = blogId + '_' + logNo;
      if (seenLogNos.has(key)) return;

      const hasFollowBtn = !!container.querySelector('[class*="add_btn"], [class*="follow_btn"]');
      const innerText = container.textContent || "";
      const isRecommendText = innerText.includes('추천글') || innerText.includes('추천 블로그') || innerText.includes('광고');
      const isRecommendMark = !!container.querySelector('[class*="recommend"], [id*="recommend"], .spcb, .spc_txt, .text_ad');

      if (!(hasFollowBtn || isRecommendText || isRecommendMark)) {
        seenLogNos.add(key);
        results.push({ blogId, logNo, containerCls: container.className.toString().substring(0, 100), containerTag: container.tagName });
      }
    });
    return results;
  });
  l('\n==== CURRENT CODE SELECTOR RESULT ====');
  currentCodeResult.forEach((p, i) => l('[' + i + '] ' + JSON.stringify(p)));
  l('Total with current selectors: ' + currentCodeResult.length);

  // 파일로 저장
  fs.writeFileSync(path.resolve(process.cwd(), 'scripts/debug-feed-output.txt'), log.join('\n'), 'utf8');
  l('\nOutput saved to scripts/debug-feed-output.txt');

  await page.waitForTimeout(1000);
  await context.close();
})();
