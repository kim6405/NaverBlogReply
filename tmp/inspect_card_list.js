const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    // Use the user's blog from the screenshot to check
    await p.goto('https://m.blog.naver.com/kkokkoribbon?listStyle=card', { waitUntil: 'networkidle' });
    await p.evaluate(() => window.scrollBy(0, 2000));
    await p.waitForTimeout(1000);
    
    const results = await p.evaluate(() => {
        const items = Array.from(document.querySelectorAll('div[class*="item__"], li[class*="item__"]'));
        return items.map(item => {
            const titleEl = item.querySelector('strong[class*="title"]');
            const linkEl = item.querySelector('a[class*="link__"]');
            return {
                title: titleEl ? titleEl.textContent.trim() : 'NOT FOUND',
                href: linkEl ? linkEl.href : 'NOT FOUND'
            };
        });
    });
    
    console.log(JSON.stringify(results, null, 2));
    await b.close();
})();
