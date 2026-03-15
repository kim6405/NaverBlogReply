const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kjh_hero?listStyle=card', { waitUntil: 'networkidle' });
    
    const results = await p.evaluate(() => {
        // Find ALL links and see which ones look like posts
        const allLinks = Array.from(document.querySelectorAll('a'));
        return allLinks.filter(l => l.href.includes('logNo='))
            .map(l => ({
                href: l.href,
                text: l.textContent.trim(),
                logNo: new URLSearchParams(l.href.split('?')[1]).get('logNo')
            }));
    });
    
    // De-duplicate by logNo
    const unique = {};
    results.forEach(r => {
        if (r.logNo) unique[r.logNo] = r;
    });
    
    console.log(JSON.stringify(Object.values(unique), null, 2));
    await b.close();
})();
