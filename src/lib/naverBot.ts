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
        if (!this.page) throw new Error("Bot not initialized");
        
        console.log("[Bot] 이웃 새글 피드를 탐색합니다...");
        let repliesMade = 0;

        try {
            await this.page.goto("https://m.blog.naver.com/FeedList.naver?groupId=1", { waitUntil: "networkidle" });
            await this.page.waitForTimeout(2000);
            
            for (let i = 0; i < 3; i++) {
                await this.page.evaluate(() => window.scrollBy(0, 1500));
                await this.page.waitForTimeout(1000);
            }

            const feedPosts = await this.page.evaluate(() => {
                const containers = Array.from(document.querySelectorAll('.card_item, .feed_card_item, li[class*="item"], div[class*="item"]'));
                const results: { url: string, blogId: string, logNo: string, title: string }[] = [];
                const seenLogNos = new Set();
                
                containers.forEach(container => {
                    const linkEl = container.querySelector('a');
                    if (!linkEl) return;
                    const href = linkEl.href;
                    const blogIdMatch = href.match(/blogId=([^&]+)/) || href.match(/m\.blog\.naver\.com\/([^\/]+)\/(\d+)/);
                    if (!blogIdMatch) return;
                    const logNoMatch = href.match(/logNo=(\d+)/) || href.match(/\/(\d+)\??/);
                    if (!logNoMatch) return;

                    const blogId = blogIdMatch[1];
                    const logNo = logNoMatch[logNoMatch.length - 1];
                    if (blogId === 'FeedList.naver' || blogId === 'CommentList.naver') return;

                    const key = `${blogId}_${logNo}`;
                    if (seenLogNos.has(key)) return;
                    
                    const hasFollowBtn = !!container.querySelector('[class*="add_btn"], [class*="follow_btn"]');
                    const innerText = container.textContent || "";
                    const isRecommendText = innerText.includes('추천글') || innerText.includes('추천 블로그') || innerText.includes('광고');
                    const isRecommendMark = !!container.querySelector('[class*="recommend"], [id*="recommend"], .spcb, .spc_txt, .text_ad');
                    
                    if (!(hasFollowBtn || isRecommendText || isRecommendMark)) {
                        seenLogNos.add(key);
                        const titleEl = container.querySelector('strong, h3, [class*="title"], .title');
                        results.push({ url: href, blogId, logNo, title: titleEl?.textContent?.trim() || "제목 없음" });
                    }
                });
                return results;
            });

            console.log(`[Bot] 이웃 새글 피드에서 ${feedPosts.length}개의 포스트를 발견했습니다.`);

            for (const post of feedPosts) {
                const history = await prisma.visitHistory.findUnique({
                    where: { blogId_postId: { blogId: post.blogId, postId: post.logNo } }
                });

                if (history) {
                    console.log(`[Bot] 스킵: 이미 답방한 포스트 - ${post.blogId}의 ${post.logNo}`);
                    continue;
                }

                let newPage;
                try {
                    console.log(`[Visit-Feed] ${post.blogId}님의 새글("${post.title}")을 읽는 중...`);
                    newPage = await this.context!.newPage();
                    await newPage.goto(`https://m.blog.naver.com/${post.blogId}/${post.logNo}`, { waitUntil: "networkidle" });
                    await newPage.waitForTimeout(1500);

                    const postContent = await newPage.evaluate(() => {
                        const contentEl = document.querySelector('.se-main-container, .post_article, .se-viewer, #post-view');
                        if (!contentEl) return { body: "", imageUrls: [] };
                        const body = contentEl.textContent?.trim().replace(/\s+/g, " ").slice(0, 1000) || "";
                        const imgs = Array.from(contentEl.querySelectorAll('img'))
                            .map(img => img.src || img.getAttribute('data-lazy-src'))
                            .filter(src => src && src.startsWith('http') && !src.includes('static.naver.net'))
                            .slice(0, 2);
                        return { body, imageUrls: imgs };
                    });

                    const aiImages: any[] = [];
                    for (const imgUrl of postContent.imageUrls) {
                        try {
                            const response = await fetch(imgUrl!);
                            const buffer = await response.arrayBuffer();
                            aiImages.push({ inlineData: { data: Buffer.from(buffer).toString('base64'), mimeType: response.headers.get('content-type') || 'image/jpeg' } });
                        } catch (e) { }
                    }

                    await newPage.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${post.blogId}&logNo=${post.logNo}`, { waitUntil: "networkidle" });
                    await newPage.waitForSelector('.u_cbox_list', { timeout: 3000 }).catch(() => { });

                    const already = await newPage.evaluate(() => {
                        const myNickEl = document.querySelector('.u_cbox_write_area .u_cbox_nick, .u_header_user_name, .gnb_my_name');
                        const myNick = myNickEl?.textContent?.trim() || "";
                        if (!myNick) return false;
                        const commentNicks = Array.from(document.querySelectorAll('.u_cbox_nick:not(.u_cbox_write_area .u_cbox_nick)'));
                        return commentNicks.some(n => n.textContent?.trim() === myNick);
                    });

                    if (!already) {
                        const prompt = `역할: 블로그 이웃 (다정한 소통)\n상황: 이웃의 블로그 새글("${post.title}")을 읽고 정성스러운 댓글을 남기려 합니다.\n\n[포스트 정보]\n제목: "${post.title}"\n본문 내용: "${postContent.body || "텍스트 내용이 적거나 사진 위주의 포스트입니다."}"\n\n[작성 규칙 - 필독]\n1. 본문 내용을 기반으로 공감하고 칭찬하세요.\n2. 자연스럽고 따뜻한 어투(해요체)로 1~2문장만 쓰세요. "잘 보고 갑니다" 등 금지.\n3. 댓글 내용만 출력하세요.`;
                        const rawAi = await generateReplyFn(prompt, aiImages);
                        const finalComment = rawAi.trim().split(/\n+/).pop()?.trim() || rawAi;

                        console.log(`[Visit-Feed] 댓글 작성 시도: ${post.blogId}`);
                        await newPage.bringToFront();
                        const box = newPage.locator('textarea.u_cbox_text, .u_cbox_write_area .u_cbox_text, #u_cbox_contents').locator('visible=true').first();
                        
                        try {
                            await box.click({ force: true, delay: 500 }).catch(() => {});
                            await newPage.waitForTimeout(500);
                            await box.evaluate((el: any, val) => {
                                el.focus(); el.value = val;
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                            }, finalComment);
                            await newPage.keyboard.type(" ");
                            await newPage.keyboard.press("Backspace");
                            
                            const uploadBtn = newPage.locator('.u_cbox_btn_upload').locator('visible=true').first();
                            if (await uploadBtn.count() > 0) {
                                await uploadBtn.click({ force: true });
                                await newPage.waitForTimeout(3000);
                                console.log(`[Visit-Feed] 댓글 작성 완료: ${finalComment}`);
                                repliesMade++;
                                await prisma.visitHistory.upsert({
                                    where: { blogId_postId: { blogId: post.blogId, postId: post.logNo } },
                                    update: {},
                                    create: { blogId: post.blogId, postId: post.logNo }
                                });
                            }
                        } catch (err: any) { console.error(`[Visit-Feed] 입력 중 오류: ${err.message}`); }
                    } else {
                        console.log(`[Visit-Feed] 이미 댓글이 존재합니다. 기록 업데이트.`);
                        await prisma.visitHistory.upsert({
                            where: { blogId_postId: { blogId: post.blogId, postId: post.logNo } },
                            update: {},
                            create: { blogId: post.blogId, postId: post.logNo }
                        }).catch(() => {});
                    }
                } catch (e: any) {
                    console.error(`[Visit-Feed] 오류: ${e.message}`);
                } finally {
                    await newPage?.close().catch(() => {});
                }
            }
        } catch (e: any) {
            console.error(`[Bot] 피드 탐색 중 오류: ${e.message}`);
        }
        
        console.log(`[Bot] 이웃 새글 탐색 완료. 총 ${repliesMade}건 답방 작성.`);
        return repliesMade;
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
                    const blogIdMatch = href?.match(/blogId=([^&]+)/);
                    if (blogIdMatch) {
                        neighborsToVisit.add(blogIdMatch[1]);
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
        for (const neighborBlogId of neighborsToVisit) {
            if (this.visitedNeighbors.has(neighborBlogId)) continue;
            let newPage;
            try {
                if (!this.page || this.page.isClosed()) break;
                console.log(`[Visit] ${neighborBlogId}님의 블로그를 방문합니다...`);
                newPage = await this.context!.newPage();
                await newPage.goto(`https://m.blog.naver.com/${neighborBlogId}`, { waitUntil: "networkidle" }).catch(()=>{});
                await newPage.waitForTimeout(1000);

                const info = await newPage.evaluate(() => {
                    const errorMsg = document.body.innerText;
                    const isBlocked = errorMsg.includes('접근 불가') || errorMsg.includes('삭제되었습니다') || errorMsg.includes('제한된');
                    if (isBlocked) return { isBlocked: true };

                    const links = Array.from(document.querySelectorAll('a')).map(l => {
                        const m = l.href.match(/logNo=(\d+)/) || l.href.match(/\/(\d+)\??/);
                        let isPop = false; let c: HTMLElement | null = l; while (c && c !== document.body) { if (c.className?.includes('popular') || c.id?.includes('popular')) { isPop = true; break; } c = c.parentElement; }
                        return { href: l.href, logNo: m ? parseInt(m[1]) : null, isPop, title: l.textContent?.trim() || "" };
                    }).filter(c => c.logNo);
                    const target = links.filter(c => !c.isPop).sort((a, b) => (b.logNo || 0) - (a.logNo || 0))[0] || links.sort((a, b) => (b.logNo || 0) - (a.logNo || 0))[0];
                    const bId = new URLSearchParams(window.location.search).get('blogId') || window.location.pathname.split('/')[1];
                    return { blogId: bId, logNo: target?.logNo, title: target?.title.replace(/사진\s*개수\s*\d+/g, "").trim() || "최신 포스트", isBlocked: false };
                });

                if (info.isBlocked) {
                    console.log(`[Visit] ${neighborBlogId}님의 블로그는 접근 불가 상태입니다.`);
                    await newPage.close().catch(() => { });
                    continue;
                }
                
                if (info.logNo && info.blogId) {
                    // History DB 체크
                    const history = await prisma.visitHistory.findUnique({
                        where: { blogId_postId: { blogId: info.blogId, postId: info.logNo.toString() } }
                    });
                    if (history) {
                        console.log(`[Visit] 스킵: 이미 방문한 최신글 - ${info.blogId}의 ${info.logNo}`);
                        await newPage.close().catch(() => { });
                        continue;
                    }

                    console.log(`[Visit] ${info.blogId}님의 최신글("${info.title}")을 읽는 중...`);
                    const postViewUrl = `https://m.blog.naver.com/${info.blogId}/${info.logNo}`;
                    await newPage.goto(postViewUrl, { waitUntil: "networkidle" });
                    await newPage.waitForTimeout(1500);

                    const postContent = await newPage.evaluate(() => {
                        const contentEl = document.querySelector('.se-main-container, .post_article, .se-viewer, #post-view');
                        if (!contentEl) return { body: "", imageUrls: [] };
                        const body = contentEl.textContent?.trim().replace(/\s+/g, " ").slice(0, 1000) || "";
                        const imgs = Array.from(contentEl.querySelectorAll('img'))
                            .map(img => img.src || img.getAttribute('data-lazy-src'))
                            .filter(src => src && src.startsWith('http') && !src.includes('static.naver.net'))
                            .slice(0, 2);
                        return { body, imageUrls: imgs };
                    });

                    const aiImages: any[] = [];
                    for (const imgUrl of postContent.imageUrls) {
                        try {
                            const response = await fetch(imgUrl!);
                            const buffer = await response.arrayBuffer();
                            const base64 = Buffer.from(buffer).toString('base64');
                            const mimeType = response.headers.get('content-type') || 'image/jpeg';
                            aiImages.push({ inlineData: { data: base64, mimeType } });
                        } catch (e) {
                            console.error(`[Visit] 이미지 로드 실패: ${imgUrl}`, e);
                        }
                    }

                    const response = await newPage.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${info.blogId}&logNo=${info.logNo}`, { waitUntil: "networkidle" });
                    if (!response || !response.ok()) {
                        console.log(`[Visit] 댓글 페이지 이동 실패.`);
                        await newPage.close().catch(() => { });
                        continue;
                    }
                    await newPage.waitForSelector('.u_cbox_list', { timeout: 3000 }).catch(() => { });

                    const already = await newPage.evaluate(() => {
                        const myNickEl = document.querySelector('.u_cbox_write_area .u_cbox_nick, .u_header_user_name, .gnb_my_name');
                        const myNick = myNickEl?.textContent?.trim() || "";
                        if (!myNick) return false;
                        const commentNicks = Array.from(document.querySelectorAll('.u_cbox_nick:not(.u_cbox_write_area .u_cbox_nick)'));
                        return commentNicks.some(n => n.textContent?.trim() === myNick);
                    });

                    if (!already) {
                        const prompt = `역할: 블로그 방문객 (다정한 이웃)\n상황: 이웃의 블로그 포스트("${info.title}")를 읽고 댓글을 남기려 합니다.\n\n[포스트 정보]\n본문 내용: "${postContent.body || "텍스트 내용이 적거나 사진 위주의 포스트입니다."}"\n\n1. 본문 내용에 대해서만 정중하게 댓글을 쓰세요.\n2. 따뜻한 인사를 포함하여 한두 문장으로 자연스럽게 작성하세요.\n3. 댓글 본문만 출력하세요.`;
                        const rawAi = await generateReplyFn(prompt, aiImages);
                        const finalComment = rawAi.trim().split(/\n+/).pop()?.trim() || rawAi;

                        console.log(`[Visit] ${info.blogId} 댓글 작성 시도...`);
                        await newPage.bringToFront();
                        
                        const box = newPage.locator('textarea.u_cbox_text, .u_cbox_write_area .u_cbox_text, #u_cbox_contents').locator('visible=true').first();
                        
                        try {
                            await box.click({ force: true, delay: 500 }).catch(() => {});
                            await newPage.waitForTimeout(500);
                            
                            await box.evaluate((el: any, val) => {
                                el.focus(); el.value = val;
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                            }, finalComment);
                            
                            await newPage.keyboard.type(" ");
                            await newPage.keyboard.press("Backspace");
                            await newPage.waitForTimeout(1000);
                            
                            const uploadBtn = newPage.locator('.u_cbox_btn_upload').locator('visible=true').first();
                            if (await uploadBtn.count() > 0) {
                                await uploadBtn.click({ force: true });
                                await newPage.waitForTimeout(3000);
                                console.log(`[Visit] 맞춤형 댓글 작성 완료: ${finalComment}`);
                                
                                try {
                                    await prisma.visitHistory.upsert({
                                        where: { blogId_postId: { blogId: info.blogId, postId: info.logNo.toString() } },
                                        update: {},
                                        create: { blogId: info.blogId, postId: info.logNo.toString() }
                                    });
                                } catch (error) {}
                            }
                        } catch (e: any) {
                            console.error(`[Visit] 댓글 입력 시도 중 오류: ${e.message}`);
                        }
                    } else {
                        console.log(`[Visit] 이미 내 댓글이 존재합니다.`);
                        try {
                            await prisma.visitHistory.upsert({
                                where: { blogId_postId: { blogId: info.blogId!, postId: info.logNo!.toString() } },
                                update: {},
                                create: { blogId: info.blogId!, postId: info.logNo!.toString() }
                            });
                        } catch(e) {}
                    }
                    this.visitedNeighbors.add(info.blogId);
                }
                await newPage.close().catch(() => { });
                if (this.page && !this.page.isClosed()) {
                    await this.page.bringToFront();
                    await this.page.waitForTimeout(1000);
                }
            } catch (e: any) {
                console.error(`[Visit] 이웃 방문 중 오류: ${e.message}`);
                await newPage?.close().catch(()=>{});
            }
        }
        return repliesMade;
    }
}
