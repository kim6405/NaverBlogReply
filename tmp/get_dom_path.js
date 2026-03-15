const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kjh_hero?listStyle=card', { waitUntil: 'networkidle' });
    const data = await p.evaluate(() => {
        const a = document.querySelector('a[href*="224213699088"]');
        if (!a) return { error: 'Not found' };
        const path = [];
        let curr = a;
        while(curr && curr.tagName !== 'BODY') {
            path.push({ 
                tag: curr.tagName, 
                class: curr.className,
                innerText: (curr.innerText || "").substring(0, 50)
            });
            curr = curr.parentElement;
        }
        return path;
    });
    console.log(JSON.stringify(data, null, 2));
    await b.close();
})();
