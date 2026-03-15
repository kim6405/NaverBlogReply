const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch({ headless: true });
    const p = await b.newPage();
    const url = 'https://m.blog.naver.com/CommentList.naver?blogId=kjh_hero&logNo=224212584126';
    await p.goto(url, { waitUntil: 'networkidle' });
    await p.waitForSelector('.u_cbox_comment', { timeout: 3000 }).catch(() => {});
    const data = await p.evaluate(() => {
        return Array.from(document.querySelectorAll('.u_cbox_comment')).map(el => ({
            content: el.querySelector('.u_cbox_contents')?.innerText,
            isReply: el.classList.contains('u_cbox_type_reply'),
            isOwner: el.innerText.includes('블로그주인')
        }));
    });
    console.log(JSON.stringify(data, null, 2));
    await b.close();
})();
