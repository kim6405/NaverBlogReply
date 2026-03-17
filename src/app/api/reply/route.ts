import { NextResponse } from "next/server";
import { NaverBlogBot } from "@/lib/naverBot";
import { prisma } from "@/lib/prisma";
import { generateReply } from "@/lib/gemini";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const blogId = searchParams.get("blogId") || process.env.NAVER_BLOG_ID || "";

  if (!blogId) {
    return NextResponse.json({ error: "블로그 ID가 설정되지 않았습니다." }, { status: 400 });
  }

  const postsWithComments = await prisma.post.findMany({
    where: { 
      blogId: blogId,
      commentCount: { gt: 0 } 
    },
  });

  const bot = new NaverBlogBot();
  let totalReplyCount = 0;

  try {
    await bot.init();
    await bot.ensureLogin(blogId); 
    
    for (const post of postsWithComments) {
      console.log(`Processing post: ${post.title}`);
      
      const count = await bot.writeRepliesForPost(post.url, async (commentText, images) => {
        return await generateReply(commentText, images);
      });
      
      totalReplyCount += count;

      await prisma.post.update({
        where: { id: post.id },
        data: { commentCount: 0 }
      });
    }

    // 통계 업데이트
    await prisma.dashboardStats.upsert({
      where: { blogId: blogId },
      update: { 
        totalReplies: { increment: totalReplyCount },
        todayReplies: { increment: totalReplyCount },
        lastReplyDate: new Date(),
        lastCrawlTime: new Date() 
      },
      create: {
        blogId: blogId,
        totalReplies: totalReplyCount,
        todayReplies: totalReplyCount,
        lastReplyDate: new Date(),
        lastCrawlTime: new Date()
      }
    });

    return NextResponse.json({ success: true, replyCount: totalReplyCount });
  } catch (error: any) {
    console.error("Auto reply error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await bot.close();
  }
}

