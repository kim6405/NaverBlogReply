import { NextResponse } from "next/server";
import {
  startScheduler,
  stopScheduler,
  pauseScheduler,
  getSchedulerState,
} from "@/lib/scheduler";
import { closeBot } from "@/lib/botManager";

/**
 * GET: 서버 스케줄러 상태를 조회합니다.
 * 클라이언트가 이 API를 폴링하여 현재 상태, 남은 시간, 로그 등을 확인합니다.
 * 
 * Query params:
 *   sinceLogIndex (optional): 이 인덱스 이후의 로그만 반환합니다.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sinceLogIndex = parseInt(searchParams.get("sinceLogIndex") || "0", 10);

  const state = getSchedulerState();

  // sinceLogIndex 이후의 로그만 반환 (폴링 시 중복 방지)
  const newLogs = state.logs.slice(sinceLogIndex);

  return NextResponse.json({
    status: state.status,
    blogId: state.blogId,
    nextRunTime: state.nextRunTime,
    lastCycleResult: state.lastCycleResult,
    logs: newLogs,
    totalLogCount: state.logs.length,
  });
}

/**
 * POST: 서버 스케줄러를 제어합니다.
 * body: { action: "start" | "pause" | "stop", blogId?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, blogId } = body;

    if (!["start", "pause", "stop"].includes(action)) {
      return NextResponse.json(
        { error: "유효하지 않은 액션입니다. (start/pause/stop)" },
        { status: 400 }
      );
    }

    if (action === "start") {
      if (!blogId?.trim()) {
        return NextResponse.json(
          { error: "블로그 ID가 필요합니다." },
          { status: 400 }
        );
      }
      startScheduler(blogId.trim());
    } else if (action === "pause") {
      pauseScheduler();
    } else if (action === "stop") {
      stopScheduler();
      await closeBot();
    }

    const state = getSchedulerState();
    return NextResponse.json({
      success: true,
      action,
      status: state.status,
    });
  } catch (error: any) {
    console.error("[Scheduler API] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
