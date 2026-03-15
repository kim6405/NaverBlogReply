const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kjh_hero?listStyle=card', { waitUntil: 'networkidle' });
    const results = await p.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('div[class*="item__"]'));
        return cards.map(c => {
            const title = c.querySelector('strong')?.textContent.trim();
            const time = c.querySelector('[class*="time__"], .time, .date')?.textContent.trim();
            const link = c.querySelector('a[href*="logNo="]')?.href;
            return { title, time, link };
        });
    });
    console.log(JSON.stringify(results, null, 2));
    await b.close();
})();
