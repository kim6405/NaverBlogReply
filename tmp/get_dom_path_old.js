const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.goto('https://m.blog.naver.com/kjh_hero?listStyle=card', { waitUntil: 'networkidle' });
    const data = await p.evaluate(() => {
        const allA = Array.from(document.querySelectorAll('a'));
        const oldPostA = allA.find(a => a.href.includes('120208785490'));
        if (!oldPostA) return { error: 'Old post not found' };
        const path = [];
        let curr = oldPostA;
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
    fs.writeFileSync('tmp/dom_path_old.json', JSON.stringify(data, null, 2));
    await b.close();
})();
