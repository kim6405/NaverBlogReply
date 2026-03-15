const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: true });
    const page = await context.newPage();
    try {
        await page.goto("https://m.blog.naver.com/kjh_hero", { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        const html = await page.evaluate(() => {
            const profile = document.querySelector('.profile_area') || document.querySelector('[class*="profile"]');
            return profile ? profile.outerHTML : 'Profile area not found';
        });
        console.log(html);
    } finally {
        await context.close();
    }
})();
