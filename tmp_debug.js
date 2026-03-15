const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kkokkoribbon?listStyle=card&tab=1', { waitUntil: 'networkidle' });
    await p.evaluate(() => window.scrollBy(0, 5000));
    await p.waitForTimeout(2000);
    const items = await p.$$eval('a[class*="link__"]', els => els.slice(0, 10).map(e => {
        let titleEl = e.querySelector('strong span') || e.querySelector('strong');
        return e.href + ' || Title: ' + (titleEl ? titleEl.textContent.trim() : 'NOT FOUND');
    }));
    console.log("Card View Test:");
    console.log(items);

    await b.close();
})();
