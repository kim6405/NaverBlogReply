const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kjh_hero?listStyle=card', { waitUntil: 'networkidle' });
    const data = await p.evaluate(() => {
        const link = document.querySelector('a[href*="224213699088"]');
        if (!link) return { error: 'Link not found' };
        const container = link.closest('div[class*="item__"], li[class*="item__"], div[class*="area"], div[class*="post_area"], div[class*="lst_item"]');
        return {
            title: link.innerText,
            containerClass: container ? container.className : 'NOT FOUND',
            innerText: container ? container.innerText : 'NOT FOUND',
            innerHTML: container ? container.innerHTML : 'NOT FOUND'
        };
    });
    console.log(JSON.stringify(data, null, 2));
    await b.close();
})();
