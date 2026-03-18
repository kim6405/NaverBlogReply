const { chromium } = require('playwright');
const path = require('path');

async function test() {
    const userDataDir = path.resolve("C:\\Users\\Win10\\NaverBlogReply", ".naver_session");
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true
    });
    const page = await context.newPage();
    const myBlogId = 'kim6405'; 
    const logNo = '223795324083'; // We don't know the exact logNo, we'll just check what the comment user link looks like.
    
    // Instead of using a random logNo, let's just go to kim6405 main and check the logNo of the first post.
    await page.goto(`https://m.blog.naver.com/${myBlogId}?listStyle=card`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    
    const postLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.includes('logNo'));
    });
    
    if (postLinks.length > 0) {
        console.log("First post link:", postLinks[0]);
        await page.goto(postLinks[0].replace('m.blog.naver.com/', 'm.blog.naver.com/CommentList.naver?blogId=kim6405&logNo=').replace(/.*\//, ''), { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        
        const commentLinks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.u_cbox_name'))
                        .map(a => a.getAttribute('href'));
        });
        console.log("Comment User Links:", commentLinks);
    }
    
    await context.close();
}

test().catch(console.error);
