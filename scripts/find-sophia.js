const { chromium } = require('playwright');
const path = require('path');

async function test() {
    const userDataDir = path.resolve("C:\\Users\\Win10\\NaverBlogReply", ".naver_session");
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true
    });
    const page = await context.newPage();
    const myBlogId = 'kim6405';
    
    // go to user's blog and check comments
    await page.goto(`https://m.blog.naver.com/${myBlogId}?listStyle=card`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    
    const postLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(h => h.includes('logNo'));
    });
    
    let sophiaHref = null;
    let sophiaBlogId = null;

    for (let i = 0; i < Math.min(3, postLinks.length); i++) {
        const u = new URL(postLinks[i]);
        const logNo = u.searchParams.get('logNo') || postLinks[i].match(/\/(\d+)/)[1];
        
        await page.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${myBlogId}&logNo=${logNo}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        
        const res = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('.u_cbox_comment'));
            for (const el of els) {
                const nick = el.querySelector('.u_cbox_nick');
                if (nick && nick.textContent.includes('소피아')) {
                    const a = el.querySelector('.u_cbox_name');
                    return a ? a.getAttribute('href') : null;
                }
            }
            return null;
        });
        
        if (res) {
            sophiaHref = res;
            console.log("Found Sophia's href:", res);
            break;
        }
    }

    if (sophiaHref) {
        const m1 = sophiaHref.match(/blogId=([^&]+)/);
        if (m1 && m1[1]) sophiaBlogId = m1[1];
        else {
            const m2 = sophiaHref.match(/m\.blog\.naver\.com\/([^\/?#]+)/);
            if (m2 && m2[1]) sophiaBlogId = m2[1];
        }
        console.log("Sophia's Blog ID:", sophiaBlogId);
        
        if (sophiaBlogId) {
            console.log("Visiting Sophia's blog directly...");
            await page.goto(`https://m.blog.naver.com/${sophiaBlogId}?listStyle=card`, { waitUntil: "networkidle" });
            await page.waitForTimeout(2000);
            const content = await page.content();
            
            // Check links
            const info = await page.evaluate((nId) => {
                const results = [];
                const links = Array.from(document.querySelectorAll('a'));
                for (const l of links) {
                    const container = l.closest('div[class*="card__"], li[class*="card__"], div[class*="item__"], li[class*="item__"], .lst_section_item, div[class*="post_area"]');
                    if (!container) continue;
                    
                    const isPop = !!l.closest('[class*="popular"], [id*="popular"], [class*="notice"], [id*="notice"]');
                    if (isPop) continue;

                    const m = l.href.match(/logNo=(\d+)/) || l.href.match(/\/(\d+)(?:\?|$)/);
                    if (!m) continue;
                    
                    const logNo = parseInt(m[1]);
                    if (!logNo) continue;
                    
                    const titleEl = container.querySelector('strong, h3, [class*="title"], .title') || l;
                    results.push({ logNo, title: titleEl.textContent?.trim() || "최신 포스트" });
                }
                
                if (results.length === 0) {
                    for (const l of links) {
                        const isPop = !!l.closest('[class*="popular"], [id*="popular"]');
                        if (isPop) continue;
                        const m = l.href.match(/logNo=(\d+)/) || l.href.match(/\/(\d+)(?:\?|$)/);
                        if (m) results.push({ logNo: parseInt(m[1]), title: l.textContent?.trim() || "최신 포스트" });
                    }
                }
                
                const target = results.sort((a, b) => b.logNo - a.logNo)[0];
                return { blogId: nId, logNo: target?.logNo, title: target?.title.replace(/사진\s*개수\s*\d+/g, "").trim() || "최신 포스트" };
            }, sophiaBlogId);
            
            console.log("Sophia's Info Result:", JSON.stringify(info, null, 2));
        }
    }

    await context.close();
}

test().catch(console.error);
