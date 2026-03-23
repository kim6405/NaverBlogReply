import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { closeBot } from "@/lib/botManager";

/**
 * GET: 현재 자동화 상태를 조회합니다.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const blogId = searchParams.get("blogId") || process.env.NAVER_BLOG_ID || "";

  if (!blogId) {
    return NextResponse.json({ error: "블로그 ID가 필요합니다." }, { status: 400 });
  }

  const stats = await prisma.dashboardStats.findUnique({
    where: { blogId },
  });

  return NextResponse.json({
    isAutoRunning: stats?.isAutoRunning ?? false,
  });
}

/**
 * POST: 자동화 상태를 변경합니다. (시작/일시정지/종료)
 * body: { action: "start" | "pause" | "stop", blogId: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, blogId } = body;

    if (!blogId) {
      return NextResponse.json({ error: "블로그 ID가 필요합니다." }, { status: 400 });
    }

    if (!["start", "pause", "stop"].includes(action)) {
      return NextResponse.json({ error: "유효하지 않은 액션입니다. (start/pause/stop)" }, { status: 400 });
    }

    const isAutoRunning = action === "start";

    // 종료 시 브라우저도 함께 닫기
    if (action === "stop") {
      await closeBot();
    }

    await prisma.dashboardStats.upsert({
      where: { blogId },
      update: { isAutoRunning },
      create: {
        blogId,
        isAutoRunning,
        totalReplies: 0,
        todayReplies: 0,
      },
    });

    return NextResponse.json({
      success: true,
      action,
      isAutoRunning,
    });
  } catch (error: any) {
    console.error("Settings API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
