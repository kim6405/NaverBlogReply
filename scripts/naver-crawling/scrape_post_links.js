const { chromium } = require('playwright');
require('dotenv').config({ path: '../../.env' });

(async () => {
    const b = await chromium.launch();
    const p = await b.newPage();
    const blogId = process.env.NAVER_BLOG_ID || 'kjh_hero';
    await p.goto(`https://m.blog.naver.com/${blogId}?tab=1`, { waitUntil: 'networkidle' });
    await p.evaluate(() => window.scrollBy(0, 10000));
    await p.waitForTimeout(2000);
    const items = await p.$$eval('a[class*="link__"]', els => els.map(e => e.href + ' || ' + e.textContent.trim()));
    console.log("Post links with 'link__'");
    console.log(items);

    const blocks = await p.$$eval('.post_list .post_item', els => els.map(e => {
        const a = e.querySelector('a');
        return (a ? a.href : 'no link') + ' || ' + e.textContent.trim().substring(0, 50).replace(/\n/g, '');
    }));
    console.log("Blocks with .post_list .post_item (old view style)");
    console.log(blocks);

    const oldLinks = await p.$$eval('a', els => els.filter(e => e.href.includes('logNo=')).map(e => e.href + ' || ' + e.textContent.trim().substring(0, 50).replace(/\n/g, '')));
    console.log("All links with logNo=");
    console.log(oldLinks.slice(0, 20)); // Limit to first 20

    await b.close();
})();
