const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kkokkoribbon?listStyle=post&tab=1', { waitUntil: 'networkidle' });
    const items = await p.$$eval('a[class*="link__"]', els => els.slice(0, 2).map(el => {
        let parent = el.parentElement;
        const classes = [];
        let curr = parent;
        while(curr && curr.tagName !== 'BODY') {
            classes.push(curr.tagName + '.' + Array.from(curr.classList).join('.'));
            curr = curr.parentElement;
        }
        return { url: el.href, parents: classes };
    }));
    console.log(JSON.stringify(items, null, 2));
    await b.close();
})();
