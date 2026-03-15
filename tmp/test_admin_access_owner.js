const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: true });
    const page = await context.newPage();
    const blogId = 'kjh_hero';
    try {
        const adminUrl = `https://m.blog.naver.com/re_setting/ProfileSetting.naver?blogId=${blogId}`;
        await page.goto(adminUrl, { waitUntil: "networkidle" });
        console.log("Admin Page URL for kjh_hero:", page.url());
        
        const isAuthPage = page.url().includes('ProfileSetting.naver');
        console.log("Is Auth Page?:", isAuthPage);
    } finally {
        await context.close();
    }
})();
