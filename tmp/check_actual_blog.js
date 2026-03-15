const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('Navigating to kjh_hero blog...');
    await page.goto('https://m.blog.naver.com/kjh_hero?listStyle=card', { waitUntil: 'networkidle' });
    
    // Scroll a bit to ensure items are loaded
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(1000);
    
    const screenshotPath = path.join(process.cwd(), 'tmp', 'kjh_hero_blog.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);
    
    const posts = await page.evaluate(() => {
        const itemSelectors = [
            'div[class*="item__"]',
            'li[class*="item__"]',
            'div[class*="post_area"]'
        ];
        const items = Array.from(document.querySelectorAll(itemSelectors.join(',')));
        return items.map(container => ({
            title: container.querySelector('strong[class*="title"]')?.textContent?.trim(),
            href: container.querySelector('a')?.href
        })).filter(p => p.title);
    });
    
    console.log('Actual posts on blog:', JSON.stringify(posts, null, 2));
    
    await browser.close();
})();
