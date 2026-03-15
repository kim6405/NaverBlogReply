const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kjh_hero?tab=1', { waitUntil: 'networkidle' });
    await p.evaluate(() => window.scrollBy(0, 5000));
    await p.waitForTimeout(2000);
    const items = await p.$$eval('a[class*="link__"]', els => els.slice(0, 10).map(el => {
        const container = el.closest('div[class^="item__"], li, div[class*="post_"]');
        let dateText = "not found";
        if (container) {
            // try to find date
            const dateEl = container.querySelector('.date, [class*="date__"], .time, [class*="time__"], .author__D2_E2');
            if (dateEl) dateText = dateEl.textContent.trim();
            else {
                // dump all text
                dateText = container.textContent.trim().substring(0, 100).replace(/\n/g, ' ');
            }
        }
        return el.href + ' || DATE: ' + dateText;
    }));
    console.log(items);
    await b.close();
})();
