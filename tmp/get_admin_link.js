const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: true });
    const page = await context.newPage();
    const blogId = 'kjh_hero';
    try {
        await page.goto(`https://m.blog.naver.com/${blogId}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        const adminLink = await page.evaluate(() => {
            const a = Array.from(document.querySelectorAll('a')).find(el => el.innerText.includes('관리'));
            return a ? { href: a.href, text: a.innerText, html: a.outerHTML } : null;
        });
        console.log("Admin Link Info:", JSON.stringify(adminLink, null, 2));
    } finally {
        await context.close();
    }
})();
