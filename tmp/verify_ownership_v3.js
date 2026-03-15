const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: true });
    const page = await context.newPage();
    const blogId = 'kkokkoribbon'; // Non-owner
    try {
        await page.goto(`https://m.blog.naver.com/${blogId}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        const hasWriteLinkWithId = await page.evaluate((id) => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.some(a => a.href.includes('PostWriteForm') && a.href.includes(id));
        }, blogId);
        console.log(`Non-owner (kkokkoribbon) has write link for ${blogId}?:`, hasWriteLinkWithId);

        const ownBlogId = 'kjh_hero'; // Owner
        await page.goto(`https://m.blog.naver.com/${ownBlogId}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        const hasWriteLinkWithOwnerId = await page.evaluate((id) => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.some(a => a.href.includes('PostWriteForm') && a.href.includes(id));
        }, ownBlogId);
        console.log(`Owner (kjh_hero) has write link for ${ownBlogId}?:`, hasWriteLinkWithOwnerId);
    } finally {
        await context.close();
    }
})();
