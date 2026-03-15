const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: true });
    const page = await context.newPage();
    const blogId = 'kkokkoribbon';
    try {
        // 관리자 전용 URL로 직접 시도
        const adminUrl = `https://m.blog.naver.com/re_setting/ProfileSetting.naver?blogId=${blogId}`;
        await page.goto(adminUrl, { waitUntil: "networkidle" });
        console.log("Admin Page URL:", page.url());
        
        const hasPermission = !page.url().includes('error') && !page.url().match(new RegExp(`${blogId}$`));
        console.log("Has Permission?:", hasPermission);
    } finally {
        await context.close();
    }
})();
