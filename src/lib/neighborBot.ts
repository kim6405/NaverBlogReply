import { type BrowserContext, type Page } from "playwright";
import { prisma } from "./prisma";

/**
 * 이웃 블로그 피드 크롤링 및 새글 댓글 작성을 돕는 봇
 */
export class NeighborBot {
    private context: BrowserContext;
    private page: Page;
    private visitedNeighbors: Set<string>;

    constructor(context: BrowserContext, page: Page, visitedNeighbors: Set<string>) {
        this.context = context;
        this.page = page;
        this.visitedNeighbors = visitedNeighbors;
    }

    /**
     * 댓글 입력 영역에 텍스트를 입력하는 헬퍼 메서드.
     * textarea(fill) → contenteditable(innerText) → keyboard.type() 순으로 시도합니다.
     */
    private async typeComment(targetPage: Page, comment: string): Promise<boolean> {
        // 셀렉터 목록 (댓글 입력 가능한 요소들)
        const selectors = [
            'textarea.u_cbox_text',
            '.u_cbox_write_area .u_cbox_text',
            '#u_cbox_contents',
            '.u_cbox_write_area textarea',
            '[contenteditable="true"].u_cbox_text',
            '.u_cbox_inbox [contenteditable="true"]',
        ];

        // --- 1단계: Playwright fill() 시도 (textarea 전용) ---
        for (const sel of selectors) {
            const loc = targetPage.locator(sel).locator('visible=true').first();
            if (await loc.count() > 0) {
                try {
                    await loc.click({ timeout: 3000 });
                    await targetPage.waitForTimeout(300);
                    await loc.fill(comment);
                    await targetPage.waitForTimeout(500);

                    // 입력 검증
                    const value = await loc.evaluate((el: any) =>
                        el.value || el.innerText || el.textContent || ''
                    );
                    if (value.trim().length > 0) {
                        console.log(`[typeComment] fill() 성공 (selector: ${sel})`);
                        return true;
                    }
                } catch (e) {
                    // fill() 실패 시 다음 전략으로
                }
            }
        }

        // --- 2단계: contenteditable 등 비표준 요소에 직접 삽입 ---
        for (const sel of selectors) {
            const loc = targetPage.locator(sel).locator('visible=true').first();
            if (await loc.count() > 0) {
                try {
                    await loc.click({ force: true, timeout: 3000 });
                    await targetPage.waitForTimeout(300);

                    await loc.evaluate((el: any, val: string) => {
                        el.focus();
                        // textarea인 경우
                        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                            el.value = val;
                        } else {
                            // contenteditable인 경우
                            el.innerText = val;
                        }
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        // React 등의 프레임워크용 이벤트도 dispatch
                        el.dispatchEvent(new Event('keyup', { bubbles: true }));
                    }, comment);

                    // 키보드 이벤트 트리거 (네이버 댓글 시스템 활성화용)
                    await targetPage.keyboard.type(' ');
                    await targetPage.keyboard.press('Backspace');
                    await targetPage.waitForTimeout(500);

                    const value = await loc.evaluate((el: any) =>
                        el.value || el.innerText || el.textContent || ''
                    );
                    if (value.trim().length > 0) {
                        console.log(`[typeComment] evaluate 삽입 성공 (selector: ${sel})`);
                        return true;
                    }
                } catch (e) {
                    // 실패 시 다음으로
                }
            }
        }

        // --- 3단계: 아무 활성 요소에나 키보드로 직접 타이핑 ---
        try {
            const anyBox = targetPage.locator('.u_cbox_write_area').locator('visible=true').first();
            if (await anyBox.count() > 0) {
                await anyBox.click({ force: true });
                await targetPage.waitForTimeout(500);
                // 기존 내용 전체 선택 후 삭제
                await targetPage.keyboard.down('Control');
                await targetPage.keyboard.press('A');
                await targetPage.keyboard.up('Control');
                await targetPage.keyboard.press('Backspace');
                await targetPage.waitForTimeout(200);
                // 직접 키보드 입력
                await targetPage.keyboard.type(comment, { delay: 30 });
                await targetPage.waitForTimeout(500);
                console.log(`[typeComment] keyboard.type() 직접 입력 시도 완료`);
                return true;
            }
        } catch (e) {
            console.error(`[typeComment] 모든 입력 방법 실패`);
        }

        return false;
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
                    newPage = await this.context.newPage();
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
                        
                        try {
                            const inputted = await this.typeComment(newPage, finalComment);
                            if (inputted) {
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
                                } else {
                                    console.log(`[Visit-Feed] 등록 버튼을 찾을 수 없습니다.`);
                                }
                            } else {
                                console.log(`[Visit-Feed] 댓글 입력에 실패했습니다.`);
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

    /**
     * 특정 이웃들의 최신글을 방문하여 댓글 작성
     */
    async visitNeighbors(neighborsToVisit: Set<string>, generateReplyFn: (comment: string, images?: any[]) => Promise<string>): Promise<number> {
        let repliesMade = 0;
        for (const neighborBlogId of neighborsToVisit) {
            if (this.visitedNeighbors.has(neighborBlogId)) continue;
            let newPage;
            try {
                if (!this.page || this.page.isClosed()) break;
                console.log(`[Visit] ${neighborBlogId}님의 블로그를 방문합니다...`);
                newPage = await this.context.newPage();
                await newPage.goto(`https://m.blog.naver.com/${neighborBlogId}?listStyle=card`, { waitUntil: "networkidle" }).catch(()=>{});
                await newPage.waitForTimeout(2000);
                
                // 스크롤 약간 내리기
                await newPage.evaluate(() => window.scrollBy(0, 500));
                await newPage.waitForTimeout(1000);

                const info = await newPage.evaluate((nId) => {
                    const errorMsg = document.body.innerText;
                    const isBlocked = errorMsg.includes('접근 불가') || errorMsg.includes('삭제되었습니다') || errorMsg.includes('제한된') || errorMsg.includes('유효하지 않은');
                    if (isBlocked) return { isBlocked: true, blogId: nId };

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
                    return { blogId: nId, logNo: target?.logNo, title: (target?.title || "최신 포스트").replace(/사진\s*개수\s*\d+/g, "").trim(), isBlocked: false };
                }, neighborBlogId);

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
                        
                        try {
                            const inputted = await this.typeComment(newPage, finalComment);
                            if (inputted) {
                                const uploadBtn = newPage.locator('.u_cbox_btn_upload').locator('visible=true').first();
                                if (await uploadBtn.count() > 0) {
                                    await uploadBtn.click({ force: true });
                                    await newPage.waitForTimeout(3000);
                                    console.log(`[Visit] 맞춤형 댓글 작성 완료: ${finalComment}`);
                                    repliesMade++;
                                    
                                    try {
                                        await prisma.visitHistory.upsert({
                                            where: { blogId_postId: { blogId: info.blogId, postId: info.logNo.toString() } },
                                            update: {},
                                            create: { blogId: info.blogId, postId: info.logNo.toString() }
                                        });
                                    } catch (error) {}
                                } else {
                                    console.log(`[Visit] 등록 버튼을 찾을 수 없습니다.`);
                                }
                            } else {
                                console.log(`[Visit] 댓글 입력에 실패했습니다.`);
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
