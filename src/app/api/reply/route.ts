import { NextResponse } from "next/server";
import { getBot } from "@/lib/botManager";
import { prisma } from "@/lib/prisma";
import { generateReply } from "@/lib/gemini";
import { sendCycleReport, type CycleReport } from "@/lib/mailer";

/**
 * 취침 시간(오후 11시 ~ 오전 9시)인지 확인합니다.
 */
function isQuietTime(): boolean {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 23 || hour < 9;
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const blogId = searchParams.get("blogId") || process.env.NAVER_BLOG_ID || "";

  if (!blogId) {
    return NextResponse.json({ error: "블로그 ID가 설정되지 않았습니다." }, { status: 400 });
  }

  // 취침 시간 확인
  if (isQuietTime()) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "취침 시간(오후 11시 ~ 오전 9시)이므로 작업을 건너뜁니다.",
      replyCount: 0
    });
  }

  let totalReplyCount = 0;
  const startTime = new Date();
  const failures: { target: string; reason: string }[] = [];

  try {
    // botManager를 통해 싱글톤 봇을 가져옵니다.
    // 최초 호출 시에만 브라우저 초기화 + 로그인이 수행됩니다.
    const bot = await getBot(blogId);

    // ───────────────────────────────────────────
    // 1단계: 이웃 블로그 새글 탐색 및 댓글 작성 (최우선)
    // ───────────────────────────────────────────
    let feedReplyCount = 0;
    let feedProcessedCount = 0;
    console.log("[자동화] 1단계: 이웃 새글 탐색 시작...");
    try {
      const feedResult = await bot.processNeighborFeed(async (commentText, images) => {
        return await generateReply(commentText, images);
      });
      feedReplyCount = feedResult.repliesMade;
      feedProcessedCount = feedResult.processedCount;
      if (feedResult.failures && feedResult.failures.length > 0) {
        failures.push(...feedResult.failures);
      }
      totalReplyCount += feedReplyCount;
    } catch (e: any) {
      console.error(`[자동화] 1단계 오류: ${e.message}`);
      failures.push({ target: "이웃 새글 탐색", reason: e.message });
    }
    console.log(`[자동화] 1단계 완료: 스캔 ${feedProcessedCount}건 중 이웃 댓글 ${feedReplyCount}건 작성`);

    // ───────────────────────────────────────────
    // 2단계: 내 블로그 최근 30일 포스트 스캔 (크롤링)
    // ───────────────────────────────────────────
    console.log("[자동화] 2단계: 내 블로그 포스트 스캔 시작...");
    let crawledPosts: any[] = [];
    try {
      crawledPosts = await bot.crawlComments(blogId);

      // 크롤링 결과를 DB에 반영
      for (const post of crawledPosts) {
        await prisma.post.upsert({
          where: {
            blogId_naverPostId: { blogId, naverPostId: post.naverPostId }
          },
          update: {
            title: post.title,
            url: post.url,
            commentCount: post.commentCount,
            postDate: post.postDate,
            lastSeenAt: new Date(),
          },
          create: {
            blogId,
            naverPostId: post.naverPostId,
            title: post.title,
            url: post.url,
            commentCount: post.commentCount,
            postDate: post.postDate,
            lastSeenAt: new Date(),
          },
        });
      }
    } catch (e: any) {
      console.error(`[자동화] 2단계 오류: ${e.message}`);
      failures.push({ target: "포스트 스캔", reason: e.message });
    }
    console.log(`[자동화] 2단계 완료: ${crawledPosts.length}개 포스트 스캔됨`);

    // 이번 사이클의 신규 댓글 수 계산 (스캔된 포스트들의 댓글 합계)
    const cycleNewComments = crawledPosts.reduce((acc, p) => acc + p.commentCount, 0);

    // ───────────────────────────────────────────
    // 3단계: 스캔된 포스트 중 미답변 댓글이 있는 것에 댓글 작성
    // ───────────────────────────────────────────
    const postsWithComments = crawledPosts.filter(p => p.commentCount > 0);
    console.log(`[자동화] 3단계: ${postsWithComments.length}개 포스트에 댓글 작성 시작...`);

    for (const post of postsWithComments) {
      console.log(`  → 포스트 처리 중: ${post.title}`);
      try {
        const count = await bot.writeRepliesForPost(post.url, async (commentText, images) => {
          return await generateReply(commentText, images);
        });

        totalReplyCount += count;

        await prisma.post.updateMany({
          where: { blogId, naverPostId: post.naverPostId },
          data: { commentCount: 0 }
        });
      } catch (e: any) {
        console.error(`[자동화] 댓글 작성 오류 (${post.title}): ${e.message}`);
        failures.push({ target: `댓글: ${post.title}`, reason: e.message });
      }
    }
    const myBlogReplies = totalReplyCount - feedReplyCount;
    console.log(`[자동화] 3단계 완료: 댓글 ${myBlogReplies}건 작성`);

    // ───────────────────────────────────────────
    // 통계 업데이트
    // ───────────────────────────────────────────
    await prisma.dashboardStats.upsert({
      where: { blogId },
      update: {
        totalReplies: { increment: totalReplyCount },
        todayReplies: { increment: totalReplyCount },
        lastReplyDate: new Date(),
        lastCrawlTime: new Date()
      },
      create: {
        blogId,
        totalReplies: totalReplyCount,
        todayReplies: totalReplyCount,
        lastReplyDate: new Date(),
        lastCrawlTime: new Date()
      }
    });

    console.log(`[자동화] 전체 완료: 총 ${totalReplyCount}건 (이웃 ${feedReplyCount}건 + 댓글 ${myBlogReplies}건)`);

    // ───────────────────────────────────────────
    // 이메일 리포트 발송
    // ───────────────────────────────────────────
    const endTime = new Date();
    const report: CycleReport = {
      startTime,
      endTime,
      neighborPostCount: feedProcessedCount + crawledPosts.length, // 이웃 새글 수 + 내 블로그 스캔 수
      neighborReplySuccess: feedReplyCount,
      myBlogReplySuccess: myBlogReplies,
      failures,
    };
    await sendCycleReport(report);

    // ⚠️ 주의: 여기서 bot.close()를 호출하지 않습니다!
    // 브라우저는 botManager에 의해 유지되며, 다음 사이클에서 재사용됩니다.
    // 종료는 settings API의 "stop" 액션에서만 수행됩니다.

    return NextResponse.json({
      success: true,
      replyCount: totalReplyCount,
      cycleStats: {
        newComments: cycleNewComments,       // 이번 사이클에서 발견된 신규 댓글 수
        neighborReplies: feedReplyCount,     // 이웃 블로그에 작성한 댓글 수
        myBlogReplies: myBlogReplies,        // 내 블로그에 작성한 댓글 수
        scannedPosts: crawledPosts.length,   // 스캔된 포스트 수
        failures: failures.length,           // 실패 건수
      }
    });
  } catch (error: any) {
    console.error("[자동화] 오류 발생:", error);

    // 전체 실패 시에도 이메일 발송 시도
    const endTime = new Date();
    failures.push({ target: "전체 사이클", reason: error.message });
    const report: CycleReport = {
      startTime,
      endTime,
      neighborPostCount: 0,
      neighborReplySuccess: 0,
      myBlogReplySuccess: 0,
      failures,
    };
    await sendCycleReport(report).catch(() => {});

    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
