const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kkokkoribbon?listStyle=post&tab=1', { waitUntil: 'networkidle' });
    const items = await p.$$eval('a[class*="link__"]', els => els.map(el => {
        const container = el.closest('div[class^="item__"], li, div[class*="post_"]');
        const c_html = container ? container.innerHTML.substring(0, 100) : "no container";
        const btn = container ? container.querySelector('[class*="comment_"], [class*="like_"]') : null;
        return {
            url: el.href,
            btnHTML: btn ? btn.outerHTML : "None",
            c_html
        };
    }).filter(i => i.url.includes('223818237562') || i.url.includes('223840543746')));
    console.log(items);
    await b.close();
})();
