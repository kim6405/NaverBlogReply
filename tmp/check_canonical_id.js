const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: true });
    const page = await context.newPage();
    try {
        await page.goto("https://m.blog.naver.com/MyBlog.naver", { waitUntil: "networkidle" });
        console.log("Redirected URL:", page.url());
        const pathname = new URL(page.url()).pathname.replace('/', '');
        console.log("Canonical Blog ID (from URL):", pathname);
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await context.close();
    }
})();
