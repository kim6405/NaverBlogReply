const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kjh_hero?listStyle=card', { waitUntil: 'networkidle' });
    const data = await p.evaluate(() => {
        const link = document.querySelector('a[href*="220285355299"]');
        if (!link) return { error: 'Link not found' };
        const card = link.closest('div[class*="item__"], li[class*="item__"], div[class*="post_area"]');
        if (!card) return { error: 'Card not found' };
        const dateEl = card.querySelector('.time, [class*="time__"], .date, [class*="date__"], .author__D2_E2');
        return { 
            dateText: dateEl ? dateEl.textContent.trim() : 'NOT FOUND',
            html: dateEl ? dateEl.outerHTML : 'NOT FOUND'
        };
    });
    console.log(JSON.stringify(data, null, 2));
    await b.close();
})();
