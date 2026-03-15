import { chromium, type Browser, type Page } from "playwright";
import path from "path";

/**
 * 네이버 블로그 댓글 크롤러 및 작성 봇 클래스
 */
export class NaverBlogBot {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async init() {
    const userDataDir = path.resolve(process.cwd(), ".naver_session");
    
    console.log(`[Bot] Initializing with userDataDir: ${userDataDir}`);
    
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome', // 시스템 크롬 사용
        headless: false,  
        viewport: null,    // 뷰포트를 창 크기에 맞춤
        args: [
          '--start-maximized',
          '--window-size=1280,800', // 창 크기 강제 지정
          '--window-position=0,0', // 창 위치를 화면 상단으로 초기화
          '--disable-blink-features=AutomationControlled'
        ],
        ignoreDefaultArgs: ['--enable-automation']
      });
      this.browser = null;
      const pages = context.pages();
      this.page = pages.length > 0 ? pages[0] : await context.newPage();
      console.log("[Bot] Browser initialized successfully.");
    } catch (e: any) {
      console.error("[Bot] Failed to initialize browser context:", e);
      throw new Error(`브라우저 초기화 실패: ${e.message || String(e)}`);
    }
  }

  async close() {
    try {
      if (this.page) {
        const context = this.page.context();
        await context.close();
      }
    } catch (e) {
      console.error("[Bot] Error closing browser:", e);
    }
  }

  /**
   * 네이버 로그인 상태를 확인하고 필요시 로그인을 안내합니다.
   */
  async ensureLogin(blogId?: string) {
    if (!this.page) throw new Error("Bot not initialized");
    
    await this.page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "networkidle" });
    
    if (this.page.url().includes("nidlogin.login")) {
      console.log("로그인이 필요합니다. 브라우저 창에서 로그인을 완료해주세요.");
      
      try {
        const idInput = await this.page.waitForSelector('#id', { state: 'visible', timeout: 5000 });
        if (idInput) {
            console.log("[Login] 아이디 입력칸에 포커스를 맞춥니다.");
            await this.page.bringToFront();
            await idInput.focus();
            await idInput.click();
        }
      } catch (e) {
        console.log("아이디 입력창 포커스 실패 (수동 입력 필요):", e instanceof Error ? e.message : String(e));
      }

      await this.page.waitForURL(url => !url.href.includes("nidlogin.login"), { timeout: 60000 });
    }

    console.log("로그인 상태 확인 완료.");

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
                const interactiveElements = Array.from(profileArea.querySelectorAll('a, button, span'));
                
                return interactiveElements.some(el => {
                    const text = el.textContent || "";
                    return ownerKeywords.some(keyword => text.includes(keyword)) && 
                           (el as HTMLElement).offsetParent !== null;
                });
            });

            if (!isOwner) {
                console.log(`[Auth Fail] ${blogId} 블로그의 관리 권한이 없습니다.`);
                await this.page.evaluate(() => {
                    alert("연결된 블로그를 확인해 주세요. (로그인한 계정이 블로그 주인이 아니거나 관리 권한이 없습니다.)");
                });
                await this.page.waitForTimeout(3000);
                throw new Error("연결된 블로그 ID에 대한 관리 권한이 없습니다.");
            }
            console.log(`블로그 소유권 확인 성공: ${blogId}`);
        } catch (e: any) {
            if (e.message.includes("관리 권한")) throw e;
            console.log("소유권 확인 중 오류 발생 (무시하고 진행):", e.message);
        }
    }

    return true;
  }

  /**
   * 블로그 포스트에서 신규 댓글 목록을 수집하는 메서드
   */
  async crawlComments(blogId: string) {
    if (!this.page) throw new Error("Bot not initialized");

    const url = `https://m.blog.naver.com/${blogId}?listStyle=card`;
    await this.page.goto(url, { waitUntil: "networkidle" });
    
    await this.page.evaluate(() => {
        document.body.style.zoom = "0.7"; 
    });
    await this.page.waitForTimeout(1000);

    for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => window.scrollBy(0, 1500));
        await this.page.waitForTimeout(1000);
    }
    await this.page.waitForTimeout(1000);

    const extractedLinks = await this.page.evaluate(() => {
        const allLinks = Array.from(document.querySelectorAll('a'));
        const postLinks = allLinks.filter(l => 
            l.href.includes('blogId=') && 
            (l.href.includes('logNo=') || l.href.includes('PostView.naver'))
        );

        const results: any[] = [];
        const seenLogNos = new Set();
        
        postLinks.forEach(link => {
            const postUrl = link.href;
            const logNoMatch = postUrl.match(/logNo=(\d+)/) || postUrl.match(/\/(\d+)\??/);
            const naverPostId = logNoMatch ? logNoMatch[1] : "";
            
            if (!naverPostId || seenLogNos.has(naverPostId)) return;
            
            const container = link.closest('div[class*="card__"], li[class*="card__"]') as HTMLElement || 
                              link.closest('div[class*="item__"], li[class*="item__"], .lst_section_item, div[class*="post_area"]') as HTMLElement;
            if (!container) return;

            const titleEl = container.querySelector('strong, h3, [class*="title"], .title') || link;
            const titleText = titleEl.textContent?.trim() || "제목 없음";
            
            const commentBtn = container.querySelector('[class*="comment_btn__"], .u_txt_comment');
            const commentCountStr = commentBtn ? commentBtn.textContent || "0" : "0";
            
            const findDate = (el: HTMLElement) => {
                const found = el.querySelector('[class*="time"], [class*="date"], .time, .date, [class*="author"]');
                if (found && found.textContent?.trim()) return found.textContent.trim();
                const allText = el.innerText || "";
                const timeMatch = allText.match(/\d+시간\s*전|\d+분\s*전|방금\s*전|어제|\d{2,4}\.\s*\d{1,2}\.\s*\d{1,2}|(\d{2}:\d{2})/);
                return timeMatch ? timeMatch[0] : "";
            };

            const dateStr = findDate(container);
            
            seenLogNos.add(naverPostId);
            results.push({
                title: titleText,
                url: postUrl,
                naverPostId,
                dateStr,
                totalCommentCount: parseInt(commentCountStr.replace(/[^0-9]/g, "") || "0"),
                canCheckComment: !!commentBtn
            });
        });
        
        return results;
    });

    const uniquePosts = new Map();
    const finalResults = [];

    for (const postLinkParams of extractedLinks) {
        if (!postLinkParams.url || postLinkParams.url.includes('CategoryList')) continue;
        if (!postLinkParams.url.includes('logNo') && !postLinkParams.url.match(/\/\d+$|\/\d+\?/)) continue;
        if (!postLinkParams.naverPostId || isNaN(Number(postLinkParams.naverPostId))) continue;
        if (uniquePosts.has(postLinkParams.naverPostId)) continue;
        
        uniquePosts.set(postLinkParams.naverPostId, true);

        let isRecent = false;
        let parsedDate: Date | null = null;
        const ds = postLinkParams.dateStr;
        const isTimeOnly = ds.includes(':') && !ds.includes('.');
        
        if (ds.includes('전') || ds.includes('어제') || isTimeOnly) {
            isRecent = true; 
            parsedDate = new Date(); 
            if (ds.includes('어제')) parsedDate.setDate(parsedDate.getDate() - 1);
        } else {
            const dateMatch = ds.match(/(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
            if (dateMatch) {
                let year = parseInt(dateMatch[1]);
                if (year < 100) year += 2000;
                const month = parseInt(dateMatch[2]) - 1; 
                const day = parseInt(dateMatch[3]);
                parsedDate = new Date(year, month, day);
                const today = new Date();
                const diffDays = Math.ceil(Math.abs(today.getTime() - parsedDate.getTime()) / (1000 * 60 * 60 * 24));
                if (diffDays <= 15) isRecent = true;
            }
        }

        if (!isRecent) continue;

        let unansweredCount = 0;
        if (postLinkParams.totalCommentCount > 0 && postLinkParams.canCheckComment) {
            try {
                const commentUrl = `https://m.blog.naver.com/CommentList.naver?blogId=${blogId}&logNo=${postLinkParams.naverPostId}`;
                const commentPage = await this.page.context().newPage();
                await commentPage.goto(commentUrl, { waitUntil: "networkidle" });
                await commentPage.waitForSelector('.u_cbox_comment', { timeout: 3000 }).catch(() => {});

                const commentsData = await commentPage.$$eval('.u_cbox_comment', els => {
                    return els.map(el => {
                        const isReply = el.classList.contains('u_cbox_type_reply') || el.classList.contains('u_cbox_reply');
                        const isOwner = el.textContent?.includes('블로그주인') || !!el.querySelector('.u_cbox_owner');
                        return { isReply, isOwner };
                    });
                });

                for (let j = 0; j < commentsData.length; j++) {
                    const c = commentsData[j];
                    if (!c.isReply && !c.isOwner) {
                        let isAnswered = false;
                        let k = j + 1;
                        while (k < commentsData.length && commentsData[k].isReply) {
                            if (commentsData[k].isOwner) {
                                isAnswered = true;
                                break;
                            }
                            k++;
                        }
                        if (!isAnswered) unansweredCount++;
                    }
                }
                await commentPage.close();
            } catch (err) {
                console.error(`Error checking comments for post ${postLinkParams.naverPostId}:`, err);
            }
        }

        finalResults.push({
            title: postLinkParams.title,
            url: postLinkParams.url,
            naverPostId: postLinkParams.naverPostId,
            commentCount: unansweredCount,
            postDate: parsedDate || new Date()
        });
    }

    return finalResults;
  }

  /**
   * 블로그 게시물의 미응답 댓글을 찾아 각각 AI 대댓글을 작성하는 메서드
   */
  async writeRepliesForPost(url: string, generateReplyFn: (comment: string) => Promise<string>): Promise<number> {
    if (!this.page) throw new Error("Bot not initialized");

    // 1. URL에서 blogId와 logNo를 추출하여 댓글 목록 페이지로 직접 이동
    let targetUrl = url;
    const blogIdMatch = url.match(/blogId=([^&]+)/);
    const logNoMatch = url.match(/logNo=(\d+)/) || url.match(/\/(\d+)\??/);
    
    if (blogIdMatch && logNoMatch) {
        targetUrl = `https://m.blog.naver.com/CommentList.naver?blogId=${blogIdMatch[1]}&logNo=${logNoMatch[1]}`;
    }

    console.log(`[Reply] 댓글 목록 접속 중: ${targetUrl}`);
    await this.page.goto(targetUrl, { waitUntil: "networkidle" });
    await this.page.waitForTimeout(2000);
    
    // 댓글이 보일 때까지 대기
    await this.page.waitForSelector('.u_cbox_comment', { timeout: 10000 }).catch(() => {
        console.log("[Reply] 댓글 요소를 찾을 수 없습니다. (목록이 비어있거나 로딩 실패)");
    });
    
    // 페이지 하단으로 조금씩 스크롤하여 레이지 로딩된 댓글들 불러오기
    await this.page.evaluate(() => window.scrollBy(0, 500));
    await this.page.waitForTimeout(1000);
    
    let repliesMade = 0;


    console.log(`[Reply] 대댓글 작성 대상 스캔 시작...`);

    // 1단계: 작성해야 할 원댓글의 고유 ID(commentNo)를 모두 수집
    const targetCommentIds = await this.page.evaluate(() => {
        const comments = Array.from(document.querySelectorAll('.u_cbox_comment'));
        const idsToReply: string[] = [];
        
        for (let i = 0; i < comments.length; i++) {
            const el = comments[i];
            const isReply = el.classList.contains('u_cbox_type_reply') || el.classList.contains('u_cbox_reply');
            const isOwner = el.textContent?.includes('블로그주인') || !!el.querySelector('.u_cbox_owner');
            
            // 원댓글이고 주인이 아닌 경우
            if (!isReply && !isOwner) {
                let hasOwnerReply = false;
                // 뒤따르는 답글들 중 주인 답글이 있는지 체크
                for (let j = i + 1; j < comments.length; j++) {
                    const nextEl = comments[j];
                    const nextIsReply = nextEl.classList.contains('u_cbox_type_reply') || nextEl.classList.contains('u_cbox_reply');
                    if (!nextIsReply) break;
                    if (nextEl.textContent?.includes('블로그주인') || !!nextEl.querySelector('.u_cbox_owner')) {
                        hasOwnerReply = true;
                        break;
                    }
                }
                
                if (!hasOwnerReply) {
                    const dataInfo = el.getAttribute('data-info') || "";
                    const match = dataInfo.match(/commentNo\s*:\s*["'](\d+)["']/);
                    if (match) {
                        idsToReply.push(match[1]);
                    } else {
                        console.log(`[Eval] No commentNo match in data-info: ${dataInfo}`);
                    }
                }
            }
        }
        console.log(`[Eval] Found ${idsToReply.length} potential reply targets out of ${comments.length} comments.`);
        return idsToReply;
    });

    console.log(`[Reply] 총 ${targetCommentIds.length}개의 답글 작성이 필요합니다.`);

    // 2단계: 수집된 ID 목록을 하나씩 순차적으로 처리
    for (const commentNo of targetCommentIds) {
        try {
            // 고유 번호를 포함하는 댓글 요소를 유연하게 찾음
            const commentSelector = `.u_cbox_comment[data-info*='${commentNo}']`;
            const commentEl = this.page.locator(commentSelector).first();
            
            if (await commentEl.isVisible()) {
                const nickName = await commentEl.locator('.u_cbox_nick').innerText().catch(() => "익명");
                const content = await commentEl.locator('.u_cbox_contents').innerText().catch(() => "");
                
                // 1. 답변 먼저 생성 (입력창 열기 전)
                const aiReply = await generateReplyFn(content);
                
                console.log(`[Reply] "${nickName}"님 댓글에 답글 작성 (${repliesMade + 1}/${targetCommentIds.length})`);
                
                // 2. 해당 댓글로 스크롤 및 답글 버튼 클릭
                await commentEl.scrollIntoViewIfNeeded();
                const replyBtn = commentEl.locator('.u_cbox_btn_reply').first();
                await replyBtn.click();
                
                // 3. 대댓글 입력창 대기 및 포커스
                const replyInputSelector = '.u_cbox_reply_area .u_cbox_text';
                const replyInput = await this.page.waitForSelector(replyInputSelector, { state: 'visible', timeout: 5000 });
                
                await replyInput.click();
                await this.page.waitForTimeout(200); // 500 -> 200
                
                // 4. 내용 입력 (fill + 타이핑 효과)
                await replyInput.fill(aiReply);
                await this.page.keyboard.press('End');
                await this.page.waitForTimeout(200); // 500 -> 200
                
                const submitBtn = await this.page.waitForSelector('.u_cbox_reply_area .u_cbox_btn_upload', { state: 'visible', timeout: 5000 });
                await submitBtn.click();
                
                // 등록 확인 대기를 3초로 단축 (등록 버튼 클릭 후 바로 다음 단계로 넘어가기 위함)
                await this.page.waitForSelector('.u_cbox_reply_area', { state: 'hidden', timeout: 3000 }).catch(() => {});

                console.log(`[Reply] 작성 완료: ${nickName}`);
                repliesMade++;
                // AI 답변 생성 자체에 이미 수 초가 소요되므로, 마지막 대기는 2초면 충분합니다.
                await this.page.waitForTimeout(2000);
            }
        } catch (err: any) {
            console.error(`[Reply] 고유번호 ${commentNo} 처리 중 오류: ${err.message}`);
            // 오류 발생 시에도 잠시 대기 (Rate Limit 방지)
            await this.page.waitForTimeout(5000);
        }
    }
    
    return repliesMade;
  }
}
