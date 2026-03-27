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
        viewport: null,
        userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
    });
    const page = await context.newPage();

    // 혹시 모바일이 아닌 환경으로 접속되는 것을 막기 위해 userAgent 주입 후 접속
    await page.goto('https://m.blog.naver.com/FeedList.naver?groupId=1', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // 새 로직 테스트 (A 태그 위주 수집)
    const collectedFeedMap = new Map();

    for (let i = 0; i < 15; i++) {
        const currentPosts = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const results = [];

            links.forEach(linkEl => {
                const href = linkEl.href;
                if (!href.includes('blog.naver.com')) return;
                if (href.includes('Recommendation') || href.includes('FeedList') || href.includes('CommentList') || href.includes('PostList') || href.includes('MyBlog')) return;

                const blogIdMatch = href.match(/blogId=([^&]+)/) || href.match(/m\.blog\.naver\.com\/([^\/\?#]+)/);
                if (!blogIdMatch) return;
                
                const logNoMatch = href.match(/logNo=(\d+)/) || href.match(/\/(\d{10,})(?:\?|$|#)/);
                if (!logNoMatch) return;

                const blogId = blogIdMatch[1];
                const logNo = logNoMatch[1];
                
                if (['FeedList.naver', 'CommentList.naver', 'Recommendation.naver'].includes(blogId)) return;

                const container = linkEl.closest('li, article, div[class*="card"], div[class*="item"]') || linkEl.parentElement;
                
                if (container) {
                    const isRecommendSection = !!container.closest('[class*="recommend_section"], [class*="discover_section"], [class*="ad_section"]');
                    if (isRecommendSection) return;

                    const hasFollowBtn = !!container.querySelector('[class*="add_btn"], [class*="follow_btn"]');
                    const innerText = container.textContent || "";
                    const isRecommendText = innerText.includes('추천글') || innerText.includes('추천 블로그') || innerText.includes('광고');
                    const isRecommendMark = !!container.querySelector('[class*="recommend"], [id*="recommend"], .spcb, .spc_txt, .text_ad');

                    if (hasFollowBtn || isRecommendText || isRecommendMark) return;
                }

                let titleText = "제목 없음";
                if (container) {
                    const titleEl = container.querySelector('strong, h3, [class*="title"], .title');
                    if (titleEl && titleEl.textContent) titleText = titleEl.textContent.trim();
                    else titleText = linkEl.textContent?.trim() || "";
                } else {
                    titleText = linkEl.textContent?.trim() || "";
                }
                
                results.push({ url: href, blogId, logNo, title: titleText.substring(0, 30) });
            });
            return results;
        });

        currentPosts.forEach(post => {
            const key = `${post.blogId}_${post.logNo}`;
            if (!collectedFeedMap.has(key)) {
                collectedFeedMap.set(key, post);
            }
        });

        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(500);
    }

    const feedPosts = Array.from(collectedFeedMap.values());
    l(`\n==== NEW LOGIC (A-tag based) RESULTS ====`);
    l(`Total found posts: ${feedPosts.length}`);
    feedPosts.slice(0, 20).forEach((p, i) => l(`[${i}] ${p.blogId} / ${p.logNo} - ${p.title.replace(/\n/g, ' ')}`));

    // 파일로 저장
    fs.writeFileSync(path.resolve(process.cwd(), 'scripts/test-new-logic-output2.txt'), log.join('\n'), 'utf8');
    l('\nOutput saved to scripts/test-new-logic-output2.txt');

    await page.waitForTimeout(2000);
    await context.close();
})();
