const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext("./.naver_session", { headless: false });
    const page = await context.newPage();
    try {
        await page.goto("https://m.blog.naver.com/kkokkoribbon", { waitUntil: "networkidle" });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'tmp/kkokkoribbon_view.png' });
        
        // 주인 전용이라고 생각한 버튼들이 있는지 확인
        const adminElements = await page.evaluate(() => {
            const sels = ['a[href*="/PostWriteForm"]', 'a[href*="/admin/"]', 'a[href*="/BlogStat"]', '.btn_admin', '.btn_stat'];
            return sels.map(s => ({
                selector: s,
                exists: !!document.querySelector(s),
                text: document.querySelector(s)?.innerText || '',
                html: document.querySelector(s)?.outerHTML || ''
            }));
        });
        console.log(JSON.stringify(adminElements, null, 2));
    } finally {
        await context.close();
    }
})();
