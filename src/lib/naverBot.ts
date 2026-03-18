import { chromium, type BrowserContext, type Page } from "playwright";
import path from "path";
import { prisma } from "./prisma";

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
            } catch (e) { }
            await this.page.waitForURL(url => !url.href.includes("nidlogin.login"), { timeout: 60000 });
        }

        if (blogId) {
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
            if (!isOwner) {
                throw new Error(`현재 로그인된 계정은 '${blogId}' 블로그의 주인 계정이 아닙니다. 올바른 계정으로 다시 로그인해주세요.`);
            }
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
                if (m) { parsedDate = new Date(parseInt(m[1]) < 100 ? parseInt(m[1]) + 2000 : parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])); if (Math.ceil(Math.abs(new Date().getTime() - parsedDate.getTime()) / (1000 * 3600 * 24)) <= 30) isRecent = true; }
            }
            if (!isRecent) continue;
            let unansweredCount = 0;
            if (p.totalCommentCount > 0 && p.canCheckComment) {
                try {
                    const commentPage = await this.context!.newPage();
                    await commentPage.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${blogId}&logNo=${p.naverPostId}`, { waitUntil: "networkidle" });
                    await commentPage.waitForSelector('.u_cbox_comment', { timeout: 3000 }).catch(() => { });
                    const data = await commentPage.$$eval('.u_cbox_comment', els => els.map(el => {
                        const isReply = !!el.closest('.u_cbox_reply_area');
                        let isOwner = false;
                        const info = el.querySelector('.u_cbox_info, .u_cbox_info_main, .u_cbox_info_base');
                        if (info && info.closest('.u_cbox_comment') === el) {
                            isOwner = info.textContent?.includes('블로그주인') || false;
                        } else {
                            const ownerBadge = el.querySelector('.u_cbox_owner');
                            if (ownerBadge && ownerBadge.closest('.u_cbox_comment') === el) isOwner = true;
                        }
                        let isSecret = false;
                        const content = el.querySelector('.u_cbox_contents, .u_cbox_secret, .u_cbox_text_wrap');
                        if (content && content.closest('.u_cbox_comment') === el) {
                            isSecret = content.textContent?.includes('비밀 댓글입니다.') || false;
                        }
                        return { isReply, isOwner, isSecret };
                    }));
                    for (let j = 0; j < data.length; j++) {
                        // 1. 부모 댓글( !isReply )이면서 블로그 주인이 아닌 경우( !isOwner ) 체크 대상
                        // (비밀 댓글 여부와 상관없이 답변이 달려야 하는 원격글은 모두 포함)
                        if (!data[j].isReply && !data[j].isOwner) {
                            let has = false;
                            for (let k = j + 1; k < data.length && data[k].isReply; k++) {
                                // 2. 대댓글이 하나라도 있으면 답변 완료로 간주
                                has = true; break;
                            }
                            if (!has) unansweredCount++;
                        }
                    }
                    await commentPage.close();
                } catch (e) { }
            }
            finalResults.push({ title: p.title, url: p.url, naverPostId: p.naverPostId, commentCount: unansweredCount, postDate: parsedDate });
        }
        return finalResults;
    }

    /**
     * 이웃 새글 피드 탐색 및 댓글 작성
     */
    async processNeighborFeed(generateReplyFn: (comment: string, images?: any[]) => Promise<string>): Promise<number> {
        if (!this.context || !this.page) throw new Error("Bot not initialized");
        const { NeighborBot } = await import('./neighborBot');
        const neighborBot = new NeighborBot(this.context, this.page, this.visitedNeighbors);
        return await neighborBot.processNeighborFeed(generateReplyFn);
    }


    async writeRepliesForPost(url: string, generateReplyFn: (comment: string, images?: any[]) => Promise<string>): Promise<number> {
        if (!this.page) throw new Error("Bot not initialized");
        const blogIdMatch = url.match(/blogId=([^&]+)/);
        const logNoMatch = url.match(/logNo=(\d+)/) || url.match(/\/(\d+)\??/);
        const targetUrl = (blogIdMatch && logNoMatch) ? `https://m.blog.naver.com/CommentList.naver?blogId=${blogIdMatch[1]}&logNo=${logNoMatch[1]}` : url;
        await this.page.goto(targetUrl, { waitUntil: "networkidle" });
        await this.page.waitForTimeout(2000);
        await this.page.waitForSelector('.u_cbox_list', { timeout: 10000 }).catch(() => { });
        await this.page.evaluate(() => window.scrollBy(0, 500));
        await this.page.waitForTimeout(1000);
        const targetIds = await this.page.evaluate(() => {
            const comments = Array.from(document.querySelectorAll('.u_cbox_comment'));
            const ids: string[] = [];
            for (let i = 0; i < comments.length; i++) {
                const el = comments[i];
                const isReply = !!el.closest('.u_cbox_reply_area');
                let isOwner = false;
                const info = el.querySelector('.u_cbox_info, .u_cbox_info_main, .u_cbox_info_base');
                if (info && info.closest('.u_cbox_comment') === el) {
                    isOwner = info.textContent?.includes('블로그주인') || false;
                } else {
                    const ownerBadge = el.querySelector('.u_cbox_owner');
                    if (ownerBadge && ownerBadge.closest('.u_cbox_comment') === el) isOwner = true;
                }
                let isSecret = false;
                const content = el.querySelector('.u_cbox_contents, .u_cbox_secret, .u_cbox_text_wrap');
                if (content && content.closest('.u_cbox_comment') === el) {
                    isSecret = content.textContent?.includes('비밀 댓글입니다.') || false;
                }

                // 부모 댓글( !isReply )이면서 블로그 주인이 아닌 경우( !isOwner ) 답변 작성 시도 대상
                if (!isReply && !isOwner) {
                    let has = false;
                    for (let j = i + 1; j < comments.length; j++) {
                        const nextEl = comments[j];
                        const nextIsReply = !!nextEl.closest('.u_cbox_reply_area');
                        if (!nextIsReply) break;

                        // 대댓글이 존재하면 바로 답변 완료로 간주
                        has = true; break;
                    }
                    const match = el.getAttribute('data-info')?.match(/commentNo\s*:\s*["'](\d+)["']/);
                    if (!has && match) {
                        // 답변 작성 페이즈에서는 실제 내용을 확인해야 하므로,
                        // 만약 로그인이 되어있지 않아 여전히 "비밀 댓글입니다."라면 건너뛸 수 있도록
                        // (실제로는 API에서 ensureLogin을 호출하므로 이 단계에서는 내용이 보일 것입니다.)
                        ids.push(match[1]);
                    }
                }
            }
            return ids;
        });
        let repliesMade = 0;
        const neighborsToVisit = new Set<string>();

        for (const commentNo of targetIds) {
            try {
                if (!this.page || this.page.isClosed()) {
                    console.log("[Bot] 메인 브라우저 창이 닫혀있어 작업을 중단합니다.");
                    break;
                }

                const el = this.page.locator(`.u_cbox_comment[data-info*='${commentNo}']`).first();
                if (await el.isVisible()) {
                    const nickName = await el.locator('.u_cbox_nick').innerText().catch(() => "익명");
                    const content = await el.locator('.u_cbox_contents').innerText().catch(() => "");
                    const aiReply = await generateReplyFn(content);
                    // 기존에 열려있을 수 있는 다른 답글창 닫기 위해 해당 댓글 답글버튼 클릭
                    await el.locator('.u_cbox_btn_reply').first().click();

                    // 네이버 모바일 블로그는 대댓글 작성창(.u_cbox_write_wrap)이 이동합니다.
                    // 현재 활성화된(visible) 작성창의 텍스트 에리어를 찾아서 입력합니다.
                    const inputLocator = this.page.locator('.u_cbox_write_wrap .u_cbox_text').locator('visible=true').first();
                    await inputLocator.waitFor({ state: 'visible', timeout: 5000 });
                    
                    // 혹시 이전 내용이 남아있다면 지우기 (모바일 환경 특성상 필요)
                    await inputLocator.click();
                    await this.page.keyboard.down('Control');
                    await this.page.keyboard.press('A');
                    await this.page.keyboard.up('Control');
                    await this.page.keyboard.press('Backspace');
                    
                    await inputLocator.fill(aiReply);
                    await this.page.waitForTimeout(500);
                    
                    // visible한 등록 버튼을 전역에서 찾아 클릭
                    const uploadBtn = this.page.locator('.u_cbox_write_wrap .u_cbox_btn_upload').locator('visible=true').first();
                    await uploadBtn.click();
                    
                    await this.page.waitForTimeout(3000);
                    repliesMade++;
                    
                    // 작성창이 닫히거나 상태가 초기화될 시간을 좀 더 여유있게 확보
                    await this.page.waitForTimeout(2000);
                    
                    const href = await el.locator('.u_cbox_name').first().getAttribute('href').catch(() => null);
                    let nBlogId = null;
                    if (href) {
                        const m1 = href.match(/blogId=([^&]+)/);
                        if (m1 && m1[1]) nBlogId = m1[1];
                        else {
                            const m2 = href.match(/m\.blog\.naver\.com\/([^\/?#]+)/);
                            if (m2 && m2[1]) nBlogId = m2[1];
                        }
                    }
                    if (nBlogId && !['CommentList.naver', 'FeedList.naver', 'PostList.naver', 'MyBlog.naver'].includes(nBlogId)) {
                        neighborsToVisit.add(nBlogId);
                    }
                }
            } catch (e: any) {
                console.error(`[Bot] 대댓글 작성 중 오류 발생: ${e.message}`);
                if (e.message.includes('Target closed') || !this.page || this.page.isClosed()) {
                    break;
                }
            }
        }

        // --- 이웃 블로그 방문 페이즈 ---
        if (neighborsToVisit.size > 0 && this.context && this.page) {
            const { NeighborBot } = await import('./neighborBot');
            const neighborBot = new NeighborBot(this.context, this.page, this.visitedNeighbors);
            const neighborReplies = await neighborBot.visitNeighbors(neighborsToVisit, generateReplyFn);
            repliesMade += neighborReplies;
        }

        return repliesMade;
    }
}
