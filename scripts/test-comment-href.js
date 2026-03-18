const { chromium } = require('playwright');
const path = require('path');

async function test() {
    const userDataDir = path.resolve("C:\\Users\\Win10\\NaverBlogReply", ".naver_session");
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true
    });
    const page = await context.newPage();
    
    // We can go to a known comment list, e.g. kim6405's recent post comments.
    // Or we can just log in and check one post. Let's find one post from kim6405.
    await page.goto("https://m.blog.naver.com/kim6405?listStyle=card", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    
    const postUrls = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(h => h.includes('logNo'));
    });
    
    if (postUrls[0]) {
        const u = new URL(postUrls[0]);
        const logNo = u.searchParams.get('logNo') || postUrls[0].match(/\/(\d+)/)[1];
        console.log("logNo:", logNo);
        
        await page.goto(`https://m.blog.naver.com/CommentList.naver?blogId=kim6405&logNo=${logNo}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        
        const names = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.u_cbox_name')).map(el => {
                return { text: el.textContent, href: el.getAttribute('href') };
            });
        });
        
        console.log("Names:", JSON.stringify(names, null, 2));
    }

    await context.close();
}

test().catch(console.error);
