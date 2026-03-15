const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kjh_hero?listStyle=card', { waitUntil: 'networkidle' });
    const results = await p.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a')).filter(l => l.href.includes('logNo='));
        return links.map(l => ({
            href: l.href,
            hasContainer: !!l.closest('div[class*="item__"], li[class*="item__"], div[class*="area"], div[class*="post_area"]')
        }));
    });
    console.log(JSON.stringify(results, null, 2));
    await b.close();
})();
