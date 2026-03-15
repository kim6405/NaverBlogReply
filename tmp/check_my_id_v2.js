const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: true });
    const page = await context.newPage();
    try {
        // 내 블로그 가기 버튼을 누르면 자신의 블로그 주소로 리다이렉트됨
        await page.goto("https://m.blog.naver.com/MyBlog.naver", { waitUntil: "networkidle" });
        const myBlogUrl = page.url();
        console.log("My Blog URL:", myBlogUrl);
        
        // 정규표현식으로 ID 추출 (m.blog.naver.com/아이디 또는 blog.naver.com/아이디)
        const match = myBlogUrl.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
        const myId = match ? match[1] : "";
        console.log("Extracted My Blog ID:", myId);
    } catch (e) {
        console.error(e);
    } finally {
        await context.close();
    }
})();
