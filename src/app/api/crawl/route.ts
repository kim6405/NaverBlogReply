import { NextResponse } from "next/server";
import { NaverBlogBot } from "@/lib/naverBot";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const blogId = searchParams.get("blogId") || process.env.NAVER_BLOG_ID;
  
  if (!blogId) {
    return NextResponse.json({ error: "NAVER_BLOG_ID not set or provided" }, { status: 400 });
  }

  const bot = new NaverBlogBot();
  try {
    await bot.init();
    const posts = await bot.crawlComments(blogId);
    
    // DB에 수집된 포스트 정보 업데이트
    const foundPostIds = posts.map(p => p.naverPostId).filter(id => !!id);
    
    // 1. 이번 스캔에서 발견되지 않은 이 블로그의 기존 포스트들은 댓글 카운트를 0으로 초기화 (동기화)
    await prisma.post.updateMany({
      where: {
        blogId: blogId,
        naverPostId: { notIn: foundPostIds }
      },
      data: { commentCount: 0 }
    });

    // 2. 발견된 포스트들 업데이트 또는 생성 (ID가 있는 유효한 데이터만)
    const now = new Date(); // 정확히 동일한 시각 사용
    const validPosts = posts.filter(p => !!p.naverPostId);

    for (const post of validPosts) {
      await prisma.post.upsert({
        where: { blogId_naverPostId: { blogId, naverPostId: post.naverPostId } },
        update: { 
          title: post.title, 
          url: post.url, 
          commentCount: post.commentCount,
          postDate: post.postDate,
          lastSeenAt: now 
        },
        create: {
          blogId,
          naverPostId: post.naverPostId,
          title: post.title,
          url: post.url,
          commentCount: post.commentCount,
          postDate: post.postDate,
          lastSeenAt: now
        }
      });
    }

    // 통계 업데이트 (블로그별) - 동일한 now 시각 반영
    await prisma.dashboardStats.upsert({
      where: { blogId: blogId },
      update: { lastCrawlTime: now },
      create: { blogId: blogId, lastCrawlTime: now }
    });

    return NextResponse.json({ success: true, posts });
  } catch (error: any) {
    console.error("Crawl error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await bot.close();
  }
}
