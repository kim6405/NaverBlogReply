const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kkokkoribbon?listStyle=post&tab=1', { waitUntil: 'networkidle' });
    const items = await p.$$eval('a[class*="link__"]', els => els.slice(0, 5).map(el => {
        const container = el.closest('div[class^="item__"], li, div[class*="post_"]');
        let titleEl = el.querySelector('strong span') || el.querySelector('strong');
        if (!titleEl && container) {
            titleEl = container.querySelector('[class*="title"]') || container.querySelector('strong');
        }
        const commentBtn = container ? container.querySelector('[class*="comment_btn__"]') : null;
        const commentCountStr = commentBtn ? commentBtn.textContent : "0";
        const dateEl = container ? container.querySelector('.time, [class*="time__"], .date, [class*="date__"]') : null;
        const dateStr = dateEl ? dateEl.textContent.trim() : "";
        return {
            title: titleEl ? titleEl.textContent.trim() : "NOT FOUND",
            url: el.href,
            dateStr,
            commentCountStr,
            hasContainer: !!container
        };
    }));
    console.log(items);
    await b.close();
})();
