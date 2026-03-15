const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: true });
    const page = await context.newPage();
    const blogId = 'kkokkoribbon';
    try {
        await page.goto(`https://m.blog.naver.com/${blogId}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        const elements = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a, button, span')).map(el => ({
                tag: el.tagName,
                text: el.innerText,
                href: el.href || ''
            })).filter(e => (e.text || '').includes('관리') || (e.text || '').includes('통계') || (e.text || '').includes('글쓰기'));
        });
        console.log(JSON.stringify(elements, null, 2));
    } finally {
        await context.close();
    }
})();
