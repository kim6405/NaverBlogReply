const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: true });
    const page = await context.newPage();
    const blogId = 'kkokkoribbon'; 
    try {
        await page.goto(`https://m.blog.naver.com/${blogId}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        const hasNeighborBtn = await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes('이웃추가') || text.includes('서로이웃');
        });
        console.log(`Non-owner (kkokkoribbon) has neighbor button?:`, hasNeighborBtn);

        // Assume we need a real owner session to test the owner side
    } finally {
        await context.close();
    }
})();
