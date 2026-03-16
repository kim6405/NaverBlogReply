const { chromium } = require('playwright');
require('dotenv').config({ path: '../../.env' });

async function testCommentScraping() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const blogId = process.env.NAVER_BLOG_ID || 'kjh_hero';
  
  // Navigate to the user's blog
  await page.goto(`https://m.blog.naver.com/${blogId}?tab=1`, { waitUntil: 'networkidle' });
  
  // Find all posts by their links
  const posts = await page.$$eval('a[class*="link__"]', els => {
    return els.map(el => {
      const titleEl = el.querySelector('strong span');
      const url = el.href;
      const naverPostId = new URLSearchParams(url.split('?')[1]).get("logNo") || url.split("/").pop() || "";
      return {
        title: titleEl ? titleEl.textContent.trim() : "제목 없음",
        url,
        naverPostId
      };
    }).filter(p => p.url && !p.url.includes('CategoryList'));
  });
  
  console.log("Found posts:", posts.length);
  
  for (const post of posts.slice(0, 3)) {
    console.log(`Checking post: ${post.title}`);
    const commentUrl = `https://m.blog.naver.com/CommentList.naver?blogId=${blogId}&logNo=${post.naverPostId}`;
    await page.goto(commentUrl, { waitUntil: 'networkidle' });
    
    // wait for comments to load
    try {
      await page.waitForSelector('.u_cbox_comment', { timeout: 3000 });
      
      const commentsData = await page.$$eval('.u_cbox_comment', els => {
        return els.map(el => {
          const isReply = el.classList.contains('u_cbox_type_reply') || el.classList.contains('u_cbox_reply');
          const authorEl = el.querySelector('.u_cbox_name');
          const isOwner = el.querySelector('.u_cbox_info_badge') !== null || (authorEl && authorEl.textContent.includes('블로그주인'));
          return {
            isReply,
            isOwner,
            text: el.querySelector('.u_cbox_contents') ? el.querySelector('.u_cbox_contents').textContent : ''
          };
        });
      });
      
      console.log(commentsData);
      
      // Calculate unanswered: a comment that is NOT a reply, NOT by owner, and NOT followed by an owner's reply
      let unansweredCount = 0;
      for (let i = 0; i < commentsData.length; i++) {
        const c = commentsData[i];
        if (!c.isReply && !c.isOwner) {
          // Check if the next comment is a reply from the owner
          let isAnswered = false;
          let j = i + 1;
          while (j < commentsData.length && commentsData[j].isReply) {
            if (commentsData[j].isOwner) {
              isAnswered = true;
              break;
            }
            j++;
          }
          if (!isAnswered) unansweredCount++;
        }
      }
      
      console.log(`Unanswered count: ${unansweredCount}`);
    } catch(e) {
      console.log("No comments or timeout");
    }
  }
  
  await browser.close();
}

testCommentScraping();
