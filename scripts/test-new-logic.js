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

    // 새 로직 테스트
    const collectedFeedMap = new Map();

    for (let i = 0; i < 15; i++) {
        const currentPosts = await page.evaluate(() => {
            const containers = Array.from(document.querySelectorAll('.card_item, .feed_card_item, li[class*="item"], div[class*="item"]'));
            const results = [];

            containers.forEach(container => {
                const linkEl = container.querySelector('a');
                if (!linkEl) return;
                
                const isRecommendSection = !!container.closest('[class*="recommend_section"], [class*="discover_section"]');
                if (isRecommendSection) return;

                const href = linkEl.href;
                const blogIdMatch = href.match(/blogId=([^&]+)/) || href.match(/m\.blog\.naver\.com\/([^\/]+)\/(\d+)/);
                if (!blogIdMatch) return;
                const logNoMatch = href.match(/logNo=(\d+)/) || href.match(/\/(\d{10,})(?:\?|$|#)/);
                if (!logNoMatch) return;

                const blogId = blogIdMatch[1];
                const logNo = logNoMatch[1];
                if (blogId === 'FeedList.naver' || blogId === 'CommentList.naver' || blogId === 'Recommendation.naver') return;

                const hasFollowBtn = !!container.querySelector('[class*="add_btn"], [class*="follow_btn"]');
                const innerText = container.textContent || "";
                const isRecommendText = innerText.includes('추천글') || innerText.includes('추천 블로그') || innerText.includes('광고');
                const isRecommendMark = !!container.querySelector('[class*="recommend"], [id*="recommend"], .spcb, .spc_txt, .text_ad');

                if (!(hasFollowBtn || isRecommendText || isRecommendMark)) {
                    const titleEl = container.querySelector('strong, h3, [class*="title"], .title');
                    results.push({ url: href, blogId, logNo, title: titleEl?.textContent?.trim() || "제목 없음" });
                }
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
    l(`\n==== NEW LOGIC RESULTS ====`);
    l(`Total found posts: ${feedPosts.length}`);
    feedPosts.slice(0, 10).forEach((p, i) => l(`[${i}] ${p.blogId} / ${p.logNo} - ${p.title.substring(0, 20)}`));

    // 파일로 저장
    fs.writeFileSync(path.resolve(process.cwd(), 'scripts/test-new-logic-output.txt'), log.join('\n'), 'utf8');
    l('\nOutput saved to scripts/test-new-logic-output.txt');

    await page.waitForTimeout(1000);
    await context.close();
})();
