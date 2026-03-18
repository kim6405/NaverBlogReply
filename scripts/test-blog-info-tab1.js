const { chromium } = require('playwright');
const path = require('path');

async function test() {
    const userDataDir = path.resolve("C:\\Users\\Win10\\NaverBlogReply", ".naver_session");
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true
    });
    const page = await context.newPage();
    const neighborBlogId = 'kim6405'; // replace with an arbitrary blogId
    
    await page.goto(`https://m.blog.naver.com/${neighborBlogId}?tab=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const info = await page.evaluate(() => {
        const errorMsg = document.body.innerText;
        const isBlocked = errorMsg.includes('접근 불가') || errorMsg.includes('삭제되었습니다') || errorMsg.includes('제한된');
        if (isBlocked) return { isBlocked: true };

        const links = Array.from(document.querySelectorAll('a')).map(l => {
            const m = l.href.match(/logNo=(\d+)/) || l.href.match(/\/(\d+)\??/);
            let isPop = false; let c = l; 
            while (c && c !== document.body) { 
                if (c.className?.includes('popular') || c.id?.includes('popular')) { 
                    isPop = true; break; 
                } 
                c = c.parentElement; 
            }
            return { href: l.href, logNo: m ? parseInt(m[1]) : null, isPop, title: l.textContent?.trim() || "" };
        }).filter(c => c.logNo);
        const target = links.filter(c => !c.isPop).sort((a, b) => (b.logNo || 0) - (a.logNo || 0))[0] || links.sort((a, b) => (b.logNo || 0) - (a.logNo || 0))[0];
        const bId = new URLSearchParams(window.location.search).get('blogId') || window.location.pathname.split('/')[1];
        return { blogId: bId, logNo: target?.logNo, title: target?.title.replace(/사진\s*개수\s*\d+/g, "").trim() || "최신 포스트", isBlocked: false, allLinksCount: links.length };
    });

    console.log(JSON.stringify(info, null, 2));
    await context.close();
}

test().catch(console.error);
