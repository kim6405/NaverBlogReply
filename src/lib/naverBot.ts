import { chromium, type BrowserContext, type Page } from "playwright";
import path from "path";

/**
 * 네이버 블로그 댓글 크롤러 및 작성 봇 클래스
 */
export interface PostInfo {
    title: string;
    url: string;
    commentCount: number;
    naverPostId: string;
    postDate: Date;
}

export class NaverBlogBot {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private visitedNeighbors: Set<string> = new Set();

  async init() {
    const userDataDir = path.resolve(process.cwd(), ".naver_session");
    console.log(`[Bot] Initializing with userDataDir: ${userDataDir}`);
    
    try {
      this.context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: false,  
        viewport: null,
        args: [
          '--start-maximized',
          '--window-size=1280,800',
          '--window-position=0,0',
          '--disable-blink-features=AutomationControlled'
        ],
        ignoreDefaultArgs: ['--enable-automation']
      });
      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
      this.visitedNeighbors.clear();
      console.log("[Bot] Browser initialized successfully.");
    } catch (e: any) {
      console.error("[Bot] Failed to initialize browser context:", e);
      throw new Error(`브라우저 초기화 실패: ${e.message || String(e)}`);
    }
  }

  async close() {
    try {
      if (this.context) {
        await this.context.close();
      }
    } catch (e) {
      console.error("[Bot] Error closing browser:", e);
    }
  }

  async ensureLogin(blogId?: string) {
    if (!this.page) throw new Error("Bot not initialized");
    
    await this.page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "networkidle" });
    
    if (this.page.url().includes("nidlogin.login")) {
      console.log("로그인이 필요합니다. 브라우저 창에서 로그인을 완료해주세요.");
      try {
        const idInput = await this.page.waitForSelector('#id', { state: 'visible', timeout: 5000 });
        if (idInput) {
            await this.page.bringToFront();
            await idInput.focus();
            await idInput.click();
        }
      } catch (e) {}
      await this.page.waitForURL(url => !url.href.includes("nidlogin.login"), { timeout: 60000 });
    }

    if (blogId) {
        try {
            await this.page.goto(`https://m.blog.naver.com/${blogId}`, { waitUntil: "networkidle" });
            await this.page.waitForTimeout(2000);
            const isOwner = await this.page.evaluate(() => {
                const neighborKeywords = ['이웃추가', '서로이웃', '이웃'];
                const hasNeighborBtn = Array.from(document.querySelectorAll('a, button, span')).some(el => {
                    const text = (el.textContent || "").trim();
                    return neighborKeywords.includes(text) && (el as HTMLElement).offsetParent !== null;
                });
                if (hasNeighborBtn) return false;
                const profileArea = document.querySelector('[class*="profile"], [class*="user_info"], [class*="btn_area"]');
                if (!profileArea) return false;
                const ownerKeywords = ['글쓰기', '관리', '통계'];
                return Array.from(profileArea.querySelectorAll('a, button, span')).some(el => {
                    const text = el.textContent || "";
                    return ownerKeywords.some(keyword => text.includes(keyword)) && (el as HTMLElement).offsetParent !== null;
                });
            });
            if (!isOwner) throw new Error("연결된 블로그 ID에 대한 관리 권한이 없습니다.");
        } catch (e) {}
    }
    return true;
  }

  async crawlComments(blogId: string): Promise<PostInfo[]> {
    if (!this.page) throw new Error("Bot not initialized");
    const url = `https://m.blog.naver.com/${blogId}?listStyle=card`;
    await this.page.goto(url, { waitUntil: "networkidle" });
    await this.page.evaluate(() => { document.body.style.zoom = "0.7"; });
    await this.page.waitForTimeout(1000);
    for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => window.scrollBy(0, 1500));
        await this.page.waitForTimeout(1000);
    }
    const extractedLinks = await this.page.evaluate(() => {
        const results: any[] = [];
        const seenLogNos = new Set();
        Array.from(document.querySelectorAll('a')).forEach(link => {
            const postUrl = link.href;
            const logNoMatch = postUrl.match(/logNo=(\d+)/) || postUrl.match(/\/(\d+)\??/);
            const naverPostId = logNoMatch ? logNoMatch[1] : "";
            if (!naverPostId || seenLogNos.has(naverPostId)) return;
            const isPopular = !!link.closest('[class*="popular"], [id*="popular"]');
            if (isPopular) return;

            const container = link.closest('div[class*="card__"], li[class*="card__"], div[class*="item__"], li[class*="item__"], .lst_section_item, div[class*="post_area"]');
            if (!container) return;
            const titleEl = container.querySelector('strong, h3, [class*="title"], .title') || link;
            const titleText = titleEl.textContent?.trim() || "제목 없음";
            const commentBtn = container.querySelector('[class*="comment_btn__"], .u_txt_comment');
            const commentCountStr = commentBtn ? commentBtn.textContent || "0" : "0";
            const ds = (container as HTMLElement).innerText.match(/\d+시간\s*전|\d+분\s*전|방금\s*전|어제|\d{2,4}\.\s*\d{1,2}\.\s*\d{1,2}/)?.[0] || "";
            seenLogNos.add(naverPostId);
            results.push({ title: titleText, url: postUrl, naverPostId, dateStr: ds, totalCommentCount: parseInt(commentCountStr.replace(/[^0-9]/g, "") || "0"), canCheckComment: !!commentBtn });
        });
        return results;
    });
    const finalResults = [];
    for (const p of extractedLinks) {
        let isRecent = false;
        let parsedDate = new Date();
        if (p.dateStr.includes('전') || p.dateStr.includes('어제')) { isRecent = true; if (p.dateStr.includes('어제')) parsedDate.setDate(parsedDate.getDate() - 1); }
        else {
            const m = p.dateStr.match(/(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
            if (m) { parsedDate = new Date(parseInt(m[1]) < 100 ? parseInt(m[1]) + 2000 : parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])); if (Math.ceil(Math.abs(new Date().getTime() - parsedDate.getTime()) / (1000 * 3600 * 24)) <= 15) isRecent = true; }
        }
        if (!isRecent) continue;
        let unansweredCount = 0;
        if (p.totalCommentCount > 0 && p.canCheckComment) {
            try {
                const commentPage = await this.context!.newPage();
                await commentPage.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${blogId}&logNo=${p.naverPostId}`, { waitUntil: "networkidle" });
                await commentPage.waitForSelector('.u_cbox_comment', { timeout: 3000 }).catch(() => {});
                const data = await commentPage.$$eval('.u_cbox_comment', els => els.map(el => ({ isReply: el.classList.contains('u_cbox_type_reply'), isOwner: el.textContent?.includes('블로그주인') || !!el.querySelector('.u_cbox_owner') })));
                for (let j = 0; j < data.length; j++) { if (!data[j].isReply && !data[j].isOwner) { let has = false; for (let k = j + 1; k < data.length && data[k].isReply; k++) { if (data[k].isOwner) { has = true; break; } } if (!has) unansweredCount++; } }
                await commentPage.close();
            } catch (e) {}
        }
        finalResults.push({ title: p.title, url: p.url, naverPostId: p.naverPostId, commentCount: unansweredCount, postDate: parsedDate });
    }
    return finalResults;
  }

  async writeRepliesForPost(url: string, generateReplyFn: (comment: string) => Promise<string>): Promise<number> {
    if (!this.page) throw new Error("Bot not initialized");
    const blogIdMatch = url.match(/blogId=([^&]+)/);
    const logNoMatch = url.match(/logNo=(\d+)/) || url.match(/\/(\d+)\??/);
    const targetUrl = (blogIdMatch && logNoMatch) ? `https://m.blog.naver.com/CommentList.naver?blogId=${blogIdMatch[1]}&logNo=${logNoMatch[1]}` : url;
    await this.page.goto(targetUrl, { waitUntil: "networkidle" });
    await this.page.waitForTimeout(2000);
    await this.page.waitForSelector('.u_cbox_list', { timeout: 10000 }).catch(() => {});
    await this.page.evaluate(() => window.scrollBy(0, 500));
    await this.page.waitForTimeout(1000);
    const targetIds = await this.page.evaluate(() => {
        const comments = Array.from(document.querySelectorAll('.u_cbox_comment'));
        const ids: string[] = [];
        for (let i = 0; i < comments.length; i++) {
            const el = comments[i];
            if (!(el.classList.contains('u_cbox_type_reply')) && !(el.textContent?.includes('블로그주인') || el.querySelector('.u_cbox_owner'))) {
                let has = false;
                for (let j = i + 1; j < comments.length; j++) {
                    if (!(comments[j].classList.contains('u_cbox_type_reply'))) break;
                    if (comments[j].textContent?.includes('블로그주인') || comments[j].querySelector('.u_cbox_owner')) { has = true; break; }
                }
                const match = el.getAttribute('data-info')?.match(/commentNo\s*:\s*["'](\d+)["']/);
                if (!has && match) ids.push(match[1]);
            }
        }
        return ids;
    });
    let repliesMade = 0;
    for (const commentNo of targetIds) {
        try {
            const el = this.page.locator(`.u_cbox_comment[data-info*='${commentNo}']`).first();
            if (await el.isVisible()) {
                const nickName = await el.locator('.u_cbox_nick').innerText().catch(() => "익명");
                const content = await el.locator('.u_cbox_contents').innerText().catch(() => "");
                const aiReply = await generateReplyFn(content);
                await el.scrollIntoViewIfNeeded();
                await el.locator('.u_cbox_btn_reply').first().click();
                const input = await this.page.waitForSelector('.u_cbox_reply_area .u_cbox_text', { state: 'visible', timeout: 5000 });
                await input.fill(aiReply);
                await this.page.locator('.u_cbox_reply_area .u_cbox_btn_upload').first().click();
                await this.page.waitForTimeout(3000);
                repliesMade++;
                const nickLink = el.locator('.u_cbox_nick').first();
                const pagePromise = this.context!.waitForEvent('page');
                await nickLink.click();
                const newPage = await pagePromise;
                await newPage.waitForLoadState('networkidle').catch(() => {});
                const info = await newPage.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a')).map(l => {
                        const m = l.href.match(/logNo=(\d+)/) || l.href.match(/\/(\d+)\??/);
                        let isPop = false; let c: HTMLElement | null = l; while (c && c !== document.body) { if (c.className?.includes('popular') || c.id?.includes('popular')) { isPop = true; break; } c = c.parentElement; }
                        return { href: l.href, logNo: m ? parseInt(m[1]) : null, isPop, title: l.textContent?.trim() || "" };
                    }).filter(c => c.logNo);
                    const target = links.filter(c => !c.isPop).sort((a,b) => (b.logNo||0) - (a.logNo||0))[0] || links.sort((a,b) => (b.logNo||0) - (a.logNo||0))[0];
                    const bId = new URLSearchParams(window.location.search).get('blogId') || window.location.pathname.split('/')[1];
                    return { blogId: bId, logNo: target?.logNo, title: target?.title.replace(/사진\s*개수\s*\d+/g, "").trim() || "최신 포스트" };
                });
                if (info.logNo && info.blogId && !this.visitedNeighbors.has(info.blogId)) {
                    console.log(`[Visit] ${info.blogId}님의 최신글("${info.title}")을 읽는 중...`);
                    
                    // 1. 포스트 본문 페이지 방문하여 내용 읽기
                    const postViewUrl = `https://m.blog.naver.com/${info.blogId}/${info.logNo}`;
                    await newPage.goto(postViewUrl, { waitUntil: "networkidle" });
                    await newPage.waitForTimeout(1500);
                    
                    const postBody = await newPage.evaluate(() => {
                        // 네이버 블로그 스마트에디터 원본 컨테이너 탐색
                        const contentEl = document.querySelector('.se-main-container, .post_article, [class*="content__"], #post-view, .se-viewer');
                        if (!contentEl) return "";
                        // 댓글 제외, 본문 텍스트만 추출 (최대 1200자)
                        return contentEl.textContent?.trim().replace(/\s+/g, " ").slice(0, 1200) || "";
                    });

                    // 2. 댓글 작성 페이지로 이동
                    await newPage.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${info.blogId}&logNo=${info.logNo}`, { waitUntil: "networkidle" });
                    
                    const already = await newPage.evaluate(() => {
                        const myNick = document.querySelector('.u_cbox_write_area .u_cbox_nick')?.textContent?.trim();
                        return myNick ? Array.from(document.querySelectorAll('.u_cbox_nick:not(.u_cbox_write_area .u_cbox_nick)')).some(n => {
                            const text = n.textContent?.trim() || "";
                            return text === myNick || (myNick.length > 2 && text.includes(myNick));
                        }) : false;
                    });

                    if (!already) {
                        // 본문 내용을 포함한 맞춤형 프롬프트 구성
                        const prompt = `역할: 방문객. 
다음에 제공되는 이웃의 블로그 포스트 내용을 읽고, 포스트의 핵심 내용이나 인상 깊은 점을 구체적으로 언급하며 다정하게 댓글을 작성해줘.

포스트 제목: "${info.title}"
포스트 내용: "${postBody || "내용 읽기 실패(제목 참고)"}"

[작성 규칙]
1. 당신은 블로그 주인이 아니라 순수한 '방문객'입니다. (예: "포스팅 잘 봤습니다", "정보 감사합니다" 등)
2. 본문에 언급된 단어나 상황을 하나 이상 포함하여 구체적으로 작성하세요.
3. 친근하고 정중하게 두 문장 이내로 작성하세요.
4. "실례합니다"나 "제 포스트에도 방문 부탁드려요" 같은 서론/홍보 문구는 절대로 넣지 마세요.
5. 오직 실제로 게시할 댓글 본문만 출력하세요.`;

                        const rawAi = await generateReplyFn(prompt);
                        const finalComment = rawAi.trim().split(/\n+/).pop()?.trim() || rawAi;
                        
                        const box = newPage.locator('.u_cbox_write_area .u_cbox_text');
                        if (await box.isVisible()) {
                            await box.fill(finalComment);
                            await newPage.waitForTimeout(500);
                            await newPage.locator('.u_cbox_btn_upload').first().click();
                            await newPage.waitForTimeout(3000);
                            console.log(`[Visit] 맞춤형 댓글 작성 완료: ${finalComment}`);
                            this.visitedNeighbors.add(info.blogId);
                        }
                    } else {
                        console.log(`[Visit] 이미 내 댓글이 존재하여 방문 기록만 추가합니다.`);
                        this.visitedNeighbors.add(info.blogId);
                    }
                }
                await newPage.close().catch(() => {});
                await this.page.bringToFront();
                await this.page.waitForTimeout(2000);
            }
        } catch (e) {}
    }
    return repliesMade;
  }
}
