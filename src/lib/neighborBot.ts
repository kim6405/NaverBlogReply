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
     * 1) 입력 영역을 스크롤하여 뷰포트에 노출
     * 2) 존재하는 입력 요소를 단일 evaluate로 빠르게 탐지
     * 3) fill() → evaluate 삽입 → keyboard.type() 순으로 시도
     */
    private async typeComment(targetPage: Page, comment: string): Promise<boolean> {
        // 0단계: 댓글 입력 영역을 뷰포트에 노출시킴 (스크롤)
        await targetPage.evaluate(() => {
            const writeArea = document.querySelector('.u_cbox_write_area');
            if (writeArea) {
                writeArea.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
        });
        await targetPage.waitForTimeout(300);

        // 1단계: 존재하는 입력 요소를 한번에 탐지
        const foundSelector = await targetPage.evaluate(() => {
            const candidates = [
                'textarea.u_cbox_text',
                '.u_cbox_write_area .u_cbox_text',
                '#u_cbox_contents',
                '.u_cbox_write_area textarea',
                '[contenteditable="true"].u_cbox_text',
                '.u_cbox_inbox [contenteditable="true"]',
            ];
            for (const sel of candidates) {
                const el = document.querySelector(sel) as HTMLElement | null;
                if (el && el.offsetParent !== null) {
                    return { selector: sel, isTextarea: el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' };
                }
            }
            return null;
        });

        if (foundSelector) {
            const loc = targetPage.locator(foundSelector.selector).locator('visible=true').first();

            // 시도 A: fill() (textarea에 가장 효과적)
            try {
                await loc.click({ timeout: 2000 });
                await loc.fill(comment);
                await targetPage.waitForTimeout(200);

                const value = await loc.evaluate((el: any) =>
                    el.value || el.innerText || el.textContent || ''
                );
                if (value.trim().length > 0) {
                    console.log(`[typeComment] fill() 성공`);
                    return true;
                }
            } catch { /* fill 실패, 다음 시도 */ }

            // 시도 B: evaluate로 직접 값 삽입
            try {
                await loc.click({ force: true, timeout: 2000 });
                await loc.evaluate((el: any, val: string) => {
                    el.focus();
                    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                        el.value = val;
                    } else {
                        el.innerText = val;
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('keyup', { bubbles: true }));
                }, comment);
                // 네이버 댓글 시스템 등록 버튼 활성화 트리거
                await targetPage.keyboard.type(' ');
                await targetPage.keyboard.press('Backspace');
                await targetPage.waitForTimeout(200);

                const value = await loc.evaluate((el: any) =>
                    el.value || el.innerText || el.textContent || ''
                );
                if (value.trim().length > 0) {
                    console.log(`[typeComment] evaluate 삽입 성공`);
                    return true;
                }
            } catch { /* 실패, 다음 시도 */ }
        }

        // 최종 폴백: 입력 영역 클릭 후 키보드 직접 타이핑
        try {
            const writeArea = targetPage.locator('.u_cbox_write_area').locator('visible=true').first();
            if (await writeArea.count() > 0) {
                await writeArea.click({ force: true });
                await targetPage.waitForTimeout(300);
                await targetPage.keyboard.down('Control');
                await targetPage.keyboard.press('A');
                await targetPage.keyboard.up('Control');
                await targetPage.keyboard.press('Backspace');
                await targetPage.keyboard.type(comment, { delay: 20 });
                await targetPage.waitForTimeout(200);
                console.log(`[typeComment] keyboard.type() 직접 입력 완료`);
                return true;
            }
        } catch {
            console.error(`[typeComment] 모든 입력 방법 실패`);
        }

        return false;
    }

    /**
     * 이웃 새글 피드 탐색 및 댓글 작성
     * @returns { processedCount: number, repliesMade: number, failures: {target: string, reason: string}[] }
     */
    async processNeighborFeed(generateReplyFn: (comment: string, images?: any[]) => Promise<string>, maxComments: number = 30): Promise<{ processedCount: number, repliesMade: number, failures: {target: string, reason: string}[] }> {
        if (!this.page) throw new Error("Bot not initialized");

        console.log(`[Bot] 이웃 새글 피드를 탐색합니다... (최대 ${maxComments}건 댓글 작성)`);
        let repliesMade = 0;
        let processedCount = 0;
        const failures: { target: string, reason: string }[] = [];

        try {
            await this.page.goto("https://m.blog.naver.com/FeedList.naver?groupId=1", { waitUntil: "domcontentloaded" });
            await this.page.waitForTimeout(1000);

            // 가상 스크롤(virtual scroll) 환경에서는 뷰포트를 벗어난 아이템이 DOM에서 제거될 수 있습니다.
            // 따라서 스크롤을 내릴 때마다 현재 보이는 아이템을 점진적으로 수집합니다.
            const collectedFeedMap = new Map<string, { url: string, blogId: string, logNo: string, title: string }>();

            for (let i = 0; i < 15; i++) {
                // 수정된 방식: 먼저 a 태그를 모두 찾고 href를 분석해 블로그 포스트를 식별합니다. (클래스명 의존성 제거)
                const currentPosts = await this.page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const results: { url: string, blogId: string, logNo: string, title: string }[] = [];

                    links.forEach(linkEl => {
                        const href = linkEl.href;
                        // 기본적으로 블로그 포스트 권장 URL 형식을 따르는지 확인
                        if (!href.includes('blog.naver.com')) return;
                        
                        // 관리 기능, 통계, 내 블로그 등 제외
                        if (href.includes('Recommendation') || href.includes('FeedList') || href.includes('CommentList') || href.includes('PostList') || href.includes('MyBlog')) return;

                        // blogId 추출
                        const blogIdMatch = href.match(/blogId=([^&]+)/) || href.match(/m\.blog\.naver\.com\/([^\/\?#]+)/);
                        if (!blogIdMatch) return;
                        
                        // logNo 추출 (10자리 이상의 숫자로 한정하여 다른 숫자(예: blogId 자체의 숫자)가 오인되지 않게 주의)
                        const logNoMatch = href.match(/logNo=(\d+)/) || href.match(/\/(\d{10,})(?:\?|$|#)/);
                        if (!logNoMatch) return;

                        const blogId = blogIdMatch[1];
                        const logNo = logNoMatch[1];
                        
                        if (['FeedList.naver', 'CommentList.naver', 'Recommendation.naver'].includes(blogId)) return;

                        // 가장 가까운 피드 컨테이너 혹은 리스트 아이템 찾기
                        // 컨테이너를 찾는 이유는 광고/추천 여부를 파악하기 위함입니다.
                        const container = linkEl.closest('li, article, div[class*="card"], div[class*="item"]') || linkEl.parentElement;
                        
                        if (container) {
                            // 추천/발견 섹션 제외
                            const isRecommendSection = !!container.closest('[class*="recommend_section"], [class*="discover_section"], [class*="ad_section"]');
                            if (isRecommendSection) return;

                            // 개별 아이템 수준의 추천/광고 텍스트 확인
                            const hasFollowBtn = !!container.querySelector('[class*="add_btn"], [class*="follow_btn"]');
                            const innerText = container.textContent || "";
                            const isRecommendText = innerText.includes('추천글') || innerText.includes('추천 블로그') || innerText.includes('광고');
                            const isRecommendMark = !!container.querySelector('[class*="recommend"], [id*="recommend"], .spcb, .spc_txt, .text_ad');

                            // 추천글이나 광고가 "아니라면" 수집 (이웃 추가 버튼이 있는 것도 추천글이므로 제외하려면 !hasFollowBtn 조건 유지 필요하나 로직상 기존대로)
                            if (hasFollowBtn || isRecommendText || isRecommendMark) return;
                        }

                        // 제목 추출: 1) 컨테이너 내의 강조 태그, 2) 실패시 a 태그 자체 텍스트
                        let titleText = "제목 없음";
                        if (container) {
                            const titleEl = container.querySelector('strong, h3, [class*="title"], .title');
                            if (titleEl && titleEl.textContent) titleText = titleEl.textContent.trim();
                            else titleText = linkEl.textContent?.trim() || "";
                        } else {
                            titleText = linkEl.textContent?.trim() || "";
                        }
                        
                        // 내용이 비어있으면(이미지만 있는 a 태그 등) 무시 처리 시도 (단, 사진 피드의 경우 남겨둠)

                        results.push({ url: href, blogId, logNo, title: titleText });
                    });
                    return results;
                });

                // 누적 추가
                currentPosts.forEach(post => {
                    const key = `${post.blogId}_${post.logNo}`;
                    if (!collectedFeedMap.has(key)) {
                        collectedFeedMap.set(key, post);
                    }
                });

                // 스크롤 이동 및 대기
                await this.page.evaluate(() => window.scrollBy(0, 1500));
                await this.page.waitForTimeout(500);
            }

            const feedPosts = Array.from(collectedFeedMap.values());

            console.log(`[Bot] 이웃 새글 피드에서 ${feedPosts.length}개의 포스트를 발견했습니다.`);

            for (const post of feedPosts) {
                // 최대 댓글 수 제한 체크
                if (repliesMade >= maxComments) {
                    console.log(`[Bot] 이웃 댓글 ${maxComments}건 달성. 이웃 새글 탐색을 종료합니다.`);
                    break;
                }

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
                    await newPage.goto(`https://m.blog.naver.com/${post.blogId}/${post.logNo}`, { waitUntil: "domcontentloaded" });
                    await newPage.waitForSelector('.se-main-container, .post_article, .se-viewer, #post-view', { timeout: 5000 }).catch(() => { });

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

                    // 이미지 병렬 다운로드
                    const aiImages: any[] = [];
                    if (postContent.imageUrls.length > 0) {
                        const imgResults = await Promise.allSettled(
                            postContent.imageUrls.map(async (imgUrl) => {
                                const response = await fetch(imgUrl!);
                                const buffer = await response.arrayBuffer();
                                return { inlineData: { data: Buffer.from(buffer).toString('base64'), mimeType: response.headers.get('content-type') || 'image/jpeg' } };
                            })
                        );
                        imgResults.forEach(r => { if (r.status === 'fulfilled') aiImages.push(r.value); });
                    }

                    await newPage.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${post.blogId}&logNo=${post.logNo}`, { waitUntil: "domcontentloaded" });
                    await newPage.waitForSelector('.u_cbox_write_area', { timeout: 5000 }).catch(() => { });

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
                                    const navPromise = newPage.waitForResponse(resp => resp.url().includes('CommentWrite') || resp.url().includes('comment'), { timeout: 5000 }).catch(() => null);
                                    await uploadBtn.click({ force: true });
                                    await navPromise;
                                    await newPage.waitForTimeout(500);
                                    console.log(`[Visit-Feed] 댓글 작성 완료: ${finalComment}`);
                                    repliesMade++;
                                    await prisma.visitHistory.upsert({
                                        where: { blogId_postId: { blogId: post.blogId, postId: post.logNo } },
                                        update: {},
                                        create: { blogId: post.blogId, postId: post.logNo }
                                    });
                                } else {
                                    console.log(`[Visit-Feed] 등록 버튼을 찾을 수 없습니다.`);
                                    failures.push({ target: post.logNo, reason: '등록 버튼을 찾을 수 없습니다.' });
                                }
                            } else {
                                console.log(`[Visit-Feed] 댓글 입력에 실패했습니다.`);
                                failures.push({ target: post.logNo, reason: '입력 요소 찾기 연산 실패.' });
                            }
                        } catch (err: any) {
                            console.error(`[Visit-Feed] 입력 중 오류: ${err.message}`);
                            failures.push({ target: post.logNo, reason: err.message });
                        }
                    } else {
                        console.log(`[Visit-Feed] 이미 댓글이 존재합니다. 기록 업데이트.`);
                        await prisma.visitHistory.upsert({
                            where: { blogId_postId: { blogId: post.blogId, postId: post.logNo } },
                            update: {},
                            create: { blogId: post.blogId, postId: post.logNo }
                        }).catch(() => { });
                    }
                } catch (e: any) {
                    console.error(`[Visit-Feed] 오류: ${e.message}`);
                    failures.push({ target: post.logNo, reason: e.message });
                } finally {
                    processedCount++;
                    await newPage?.close().catch(() => { });
                }
            }
        } catch (e: any) {
            console.error(`[Bot] 피드 탐색 중 오류: ${e.message}`);
            failures.push({ target: 'Feed Crawl', reason: e.message });
        }

        console.log(`[Bot] 이웃 새글 탐색 완료. 스캔 ${processedCount}건, 총 ${repliesMade}건 답방 작성.`);
        return { processedCount, repliesMade, failures };
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
                await newPage.goto(`https://m.blog.naver.com/${neighborBlogId}?listStyle=card`, { waitUntil: "domcontentloaded" }).catch(() => { });
                await newPage.waitForTimeout(1000);

                // 스크롤 약간 내리기
                await newPage.evaluate(() => window.scrollBy(0, 500));
                await newPage.waitForTimeout(500);

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
                    await newPage.goto(postViewUrl, { waitUntil: "domcontentloaded" });
                    await newPage.waitForSelector('.se-main-container, .post_article, .se-viewer, #post-view', { timeout: 5000 }).catch(() => { });

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

                    // 이미지 병렬 다운로드
                    const aiImages: any[] = [];
                    if (postContent.imageUrls.length > 0) {
                        const imgResults = await Promise.allSettled(
                            postContent.imageUrls.map(async (imgUrl) => {
                                const response = await fetch(imgUrl!);
                                const buffer = await response.arrayBuffer();
                                return { inlineData: { data: Buffer.from(buffer).toString('base64'), mimeType: response.headers.get('content-type') || 'image/jpeg' } };
                            })
                        );
                        imgResults.forEach(r => { if (r.status === 'fulfilled') aiImages.push(r.value); });
                    }

                    const navResponse = await newPage.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${info.blogId}&logNo=${info.logNo}`, { waitUntil: "domcontentloaded" });
                    if (!navResponse || !navResponse.ok()) {
                        console.log(`[Visit] 댓글 페이지 이동 실패.`);
                        await newPage.close().catch(() => { });
                        continue;
                    }
                    await newPage.waitForSelector('.u_cbox_write_area', { timeout: 5000 }).catch(() => { });

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
                                    const navPromise = newPage.waitForResponse(resp => resp.url().includes('CommentWrite') || resp.url().includes('comment'), { timeout: 5000 }).catch(() => null);
                                    await uploadBtn.click({ force: true });
                                    await navPromise;
                                    await newPage.waitForTimeout(500);
                                    console.log(`[Visit] 맞춤형 댓글 작성 완료: ${finalComment}`);
                                    repliesMade++;

                                    try {
                                        await prisma.visitHistory.upsert({
                                            where: { blogId_postId: { blogId: info.blogId, postId: info.logNo.toString() } },
                                            update: {},
                                            create: { blogId: info.blogId, postId: info.logNo.toString() }
                                        });
                                    } catch (error) { }
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
                        } catch (e) { }
                    }
                    this.visitedNeighbors.add(info.blogId);
                }
                await newPage.close().catch(() => { });
                if (this.page && !this.page.isClosed()) {
                    await this.page.bringToFront();
                    await this.page.waitForTimeout(500);
                }
            } catch (e: any) {
                console.error(`[Visit] 이웃 방문 중 오류: ${e.message}`);
                await newPage?.close().catch(() => { });
            }
        }
        return repliesMade;
    }
}
