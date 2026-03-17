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
                        const isReply = el.classList.contains('u_cbox_type_reply') || !!el.querySelector('.u_cbox_ico_reply');
                        const isOwner = el.textContent?.includes('블로그주인') || !!el.querySelector('.u_cbox_owner');
                        const isSecret = el.textContent?.includes('비밀 댓글입니다.');
                        return { isReply, isOwner, isSecret };
                    }));
                    for (let j = 0; j < data.length; j++) {
                        // 1. 부모 댓글( !isReply )이면서 블로그 주인이 아닌 경우( !isOwner ) 체크 대상
                        // (비밀 댓글 여부와 상관없이 답변이 달려야 하는 원격글은 모두 포함)
                        if (!data[j].isReply && !data[j].isOwner) {
                            let has = false;
                            for (let k = j + 1; k < data.length && data[k].isReply; k++) {
                                // 2. 대댓글 중 주인의 글이거나, 내용이 가려진 비밀 답변이 있다면 답변 완료로 간주
                                if (data[k].isOwner || data[k].isSecret) { has = true; break; }
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
                const isReply = el.classList.contains('u_cbox_type_reply') || !!el.querySelector('.u_cbox_ico_reply');
                const isOwner = el.textContent?.includes('블로그주인') || !!el.querySelector('.u_cbox_owner');
                const isSecret = el.textContent?.includes('비밀 댓글입니다.');

                // 부모 댓글( !isReply )이면서 블로그 주인이 아닌 경우( !isOwner ) 답변 작성 시도 대상
                if (!isReply && !isOwner) {
                    let has = false;
                    for (let j = i + 1; j < comments.length; j++) {
                        const nextEl = comments[j];
                        const nextIsReply = nextEl.classList.contains('u_cbox_type_reply') || !!nextEl.querySelector('.u_cbox_ico_reply');
                        if (!nextIsReply) break;

                        const nextIsOwner = nextEl.textContent?.includes('블로그주인') || !!nextEl.querySelector('.u_cbox_owner');
                        const nextIsSecret = nextEl.textContent?.includes('비밀 댓글입니다.');
                        
                        // 이미 주인이 답변했거나 비밀 대댓글이 달려있으면 답변 완료로 판단
                        if (nextIsOwner || nextIsSecret) { has = true; break; }
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
        for (const commentNo of targetIds) {
            try {
                // 0. 메인 페이지가 닫혀있는지 먼저 체크 (사용자가 창을 닫았을 때 대비)
                if (!this.page || this.page.isClosed()) {
                    console.log("[Bot] 메인 브라우저 창이 닫혀있어 작업을 중단합니다.");
                    break;
                }

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
                    await newPage.waitForLoadState('networkidle').catch(() => { });
                    const info = await newPage.evaluate(() => {
                        // "접근 불가" 또는 "삭제" 등의 에러 메시지가 있는지 먼저 확인
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
                        console.log(`[Visit] ${nickName}님의 블로그는 접근 불가 또는 삭제된 상태입니다. 스킵합니다.`);
                        await newPage.close().catch(() => { });
                        continue;
                    }
                    if (info.logNo && info.blogId && !this.visitedNeighbors.has(info.blogId)) {
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
                                .slice(0, 2); // 최대 2장만

                            return { body, imageUrls: imgs };
                        });

                        // 이미지 데이터 가져오기 (base64)
                        const aiImages: any[] = [];
                        for (const imgUrl of postContent.imageUrls) {
                            try {
                                const response = await fetch(imgUrl!);
                                const buffer = await response.arrayBuffer();
                                const base64 = Buffer.from(buffer).toString('base64');
                                const mimeType = response.headers.get('content-type') || 'image/jpeg';
                                aiImages.push({ inlineData: { data: base64, mimeType } });
                            } catch (e) {
                                console.error(`[Visit] 이미지 다운로드 실패: ${imgUrl}`, e);
                            }
                        }

                        // 2. 댓글 작성 페이지로 이동
                        const response = await newPage.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${info.blogId}&logNo=${info.logNo}`, { waitUntil: "networkidle" });
                        
                        // 이동 실패(404 등) 시 스킵
                        if (!response || !response.ok()) {
                            console.log(`[Visit] 댓글 페이지 이동 실패 (${response?.status()}). 스킵합니다.`);
                            await newPage.close().catch(() => { });
                            continue;
                        }
                        await newPage.waitForSelector('.u_cbox_list', { timeout: 5000 }).catch(() => { });

                        const already = await newPage.evaluate(() => {
                            // 내 닉네임을 찾기 위한 여러 시도 (댓글 작성란, 헤더 등)
                            const myNickEl = document.querySelector('.u_cbox_write_area .u_cbox_nick, .u_header_user_name, .gnb_my_name');
                            const myNick = myNickEl?.textContent?.trim() || "";

                            if (!myNick) return false;

                            // 현재 댓글 목록에 내 닉네임이 있는지 확인
                            const commentNicks = Array.from(document.querySelectorAll('.u_cbox_nick:not(.u_cbox_write_area .u_cbox_nick)'));
                            return commentNicks.some(n => {
                                const text = n.textContent?.trim() || "";
                                // 닉네임이 완전히 일치하거나 포함되어 있는지 확인
                                return text === myNick || (myNick.length > 1 && text.includes(myNick));
                            });
                        });

                        if (!already) {
                            const prompt = `역할: 블로그 방문객 (다정한 이웃)
상황: 이웃의 블로그 포스트("${info.title}")를 읽고 댓글을 남기려 합니다.

[포스트 정보]
제목: "${info.title}"
본문 내용: "${postContent.body || "텍스트 내용이 적거나 사진 위주의 포스트입니다."}"

[작성 규칙 - 필독]
1. **텍스트 우선 분석**: 본문에 "아스파라거스의 효능", "정보 공유" 등 읽을만한 구체적인 내용이 있다면 사진은 무시하고 **본문 내용에 대해서만** 정중하게 댓글을 쓰세요.
2. **사진은 플랜B**: 본문 내용이 거의 없거나 "오늘의 일상"처럼 단순할 때만 사진 분석 정보를 참고하여 "사진 속 ~가 멋지네요" 등을 언급하세요. (아무 내용이 없는데 사진만 보고 "먹음직스럽네요" 하면 안 됩니다.)
3. **시간 정보 무시**: "15시간 전" 등은 무조건 작성 시각입니다. 내용과 절대 엮지 마세요.
4. **인간적인 짧은 소통**: 따뜻한 인사를 포함하여 한두 문장으로 자연스럽게 작성하세요.
5. 오직 실제로 게시할 댓글 본문만 출력하세요.`;

                            const rawAi = await generateReplyFn(prompt, aiImages);
                            const finalComment = rawAi.trim().split(/\n+/).pop()?.trim() || rawAi;

                            const box = newPage.locator('.u_cbox_write_area .u_cbox_text');
                            if (await box.isVisible()) {
                                await box.fill(finalComment);
                                await newPage.waitForTimeout(500);
                                await newPage.locator('.u_cbox_btn_upload').first().click();
                                await newPage.waitForTimeout(3000);
                                console.log(`[Visit] 맞춤형 댓글 작성 완료: ${finalComment}`);
                            }
                        } else {
                            console.log(`[Visit] 이미 내 댓글이 존재합니다.`);
                        }
                        // 어떤 경우든(작성했든, 이미 존재하여 스킵했든) 이 블로그 ID는 이번 세션에서 중복 방문하지 않도록 추가
                        this.visitedNeighbors.add(info.blogId);
                    }
                    await newPage.close().catch(() => { });
                    if (this.page && !this.page.isClosed()) {
                        await this.page.bringToFront();
                        await this.page.waitForTimeout(2000);
                    }
                }
            } catch (e: any) {
                console.error(`[Bot] 댓글 작성 중 오류 발생: ${e.message}`);
                // 전체 브라우저가 종료되거나 메인 페이지가 닫혔다면 루프 종료
                if (e.message.includes('Target closed') || !this.page || this.page.isClosed()) {
                    break;
                }
            }
        }
        return repliesMade;
    }
}
