const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kjh_hero?listStyle=card', { waitUntil: 'networkidle' });
    await p.evaluate(() => document.body.style.zoom = '0.6');
    await p.waitForTimeout(2000);
    const data = await p.evaluate(() => {
        const items = Array.from(document.querySelectorAll('div[class*="item__"], li[class*="item__"]')).slice(0, 3);
        return items.map((item, idx) => ({
            idx,
            className: item.className,
            innerText: item.innerText,
            links: Array.from(item.querySelectorAll('a')).map(a => a.href),
            titles: Array.from(item.querySelectorAll('strong, h3, .title')).map(t => t.innerText)
        }));
    });
    console.log(JSON.stringify(data, null, 2));
    await b.close();
})();
