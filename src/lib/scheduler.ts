import { getBot } from "./botManager";
import { prisma } from "./prisma";
import { generateReply } from "./gemini";
import { sendCycleReport, type CycleReport } from "./mailer";

// ─────────────────────────────────────────────
// 사이클 간격 설정 (시간 단위)
// ─────────────────────────────────────────────
const MIN_INTERVAL_HOURS = 2;
const MAX_INTERVAL_HOURS = 4;

function getRandomInterval(): number {
  const hours =
    MIN_INTERVAL_HOURS +
    Math.random() * (MAX_INTERVAL_HOURS - MIN_INTERVAL_HOURS);
  return Math.round(hours * 60 * 60 * 1000);
}

/*
// 테스트용: 1~3분 사이 랜덤
function getRandomInterval(): number {
  const minMinutes = 1;
  const maxMinutes = 3;
  const minutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
  return Math.round(minutes * 60 * 1000);
}
*/

function isQuietTime(): boolean {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 9;
}

function getTimeUntilActive(): number {
  const now = new Date();
  const hour = now.getHours();
  const target = new Date(now);
  if (hour >= 9) {
    // 23시 이후 -> 다음날 9시
    target.setDate(target.getDate() + 1);
  }
  target.setHours(9, 0, 0, 0);
  return target.getTime() - now.getTime();
}

// ─────────────────────────────────────────────
// 서버 사이드 스케줄러 상태
// ─────────────────────────────────────────────
export interface SchedulerState {
  status: "stopped" | "running" | "working" | "quiet";
  blogId: string;
  nextRunTime: string | null;
  lastCycleResult: CycleResult | null;
  logs: LogEntry[];
}

export interface CycleResult {
  success: boolean;
  replyCount: number;
  neighborReplies: number;
  myBlogReplies: number;
  scannedPosts: number;
  failures: number;
  completedAt: string;
}

export interface LogEntry {
  time: string;
  type: "info" | "success" | "error" | "scan";
  msg: string;
}

let schedulerStatus: "stopped" | "running" | "working" | "quiet" = "stopped";
let schedulerBlogId = "";
let nextRunTime: Date | null = null;
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let lastCycleResult: CycleResult | null = null;
const schedulerLogs: LogEntry[] = [];
const MAX_LOGS = 200;

function addLog(type: LogEntry["type"], msg: string) {
  const entry: LogEntry = {
    time: new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" }),
    type,
    msg,
  };
  schedulerLogs.push(entry);
  if (schedulerLogs.length > MAX_LOGS) {
    schedulerLogs.splice(0, schedulerLogs.length - MAX_LOGS);
  }
  console.log(`[Scheduler][${entry.type}] ${entry.msg}`);
}

// ─────────────────────────────────────────────
// 핵심: 한 사이클 실행
// ─────────────────────────────────────────────
async function runOneCycle() {
  if (schedulerStatus === "stopped") return;

  // 취침 시간 체크
  if (isQuietTime()) {
    schedulerStatus = "quiet";
    const waitMs = getTimeUntilActive();
    const waitHours = Math.floor(waitMs / (1000 * 60 * 60));
    const waitMinutes = Math.floor(
      (waitMs % (1000 * 60 * 60)) / (1000 * 60)
    );
    addLog(
      "info",
      `취침 시간입니다. ${waitHours}시간 ${waitMinutes}분 후에 자동으로 재개됩니다.`
    );
    scheduleNext(waitMs);
    return;
  }

  if (!schedulerBlogId.trim()) {
    addLog("error", "블로그 ID가 설정되지 않아 사이클을 건너뜁니다.");
    scheduleNext(getRandomInterval());
    return;
  }

  schedulerStatus = "working";
  addLog(
    "scan",
    "🔄 자동 사이클 시작: 이웃 새글 탐색 → 내 블로그 스캔 → 댓글 작성..."
  );

  const blogId = schedulerBlogId;
  let totalReplyCount = 0;
  const startTime = new Date();
  const failures: { target: string; reason: string }[] = [];

  try {
    const bot = await getBot(blogId);

    // ── 1단계: 이웃 블로그 새글 탐색 ──
    let feedReplyCount = 0;
    let feedProcessedCount = 0;
    addLog("info", "1단계: 이웃 새글 탐색 시작...");
    try {
      const feedResult = await bot.processNeighborFeed(
        async (commentText, images) => {
          return await generateReply(commentText, images);
        }
      );
      feedReplyCount = feedResult.repliesMade;
      feedProcessedCount = feedResult.processedCount;
      if (feedResult.failures && feedResult.failures.length > 0) {
        failures.push(...feedResult.failures);
      }
      totalReplyCount += feedReplyCount;
    } catch (e: any) {
      addLog("error", `1단계 오류: ${e.message}`);
      failures.push({ target: "이웃 새글 탐색", reason: e.message });
    }
    addLog(
      "info",
      `1단계 완료: 스캔 ${feedProcessedCount}건 중 이웃 댓글 ${feedReplyCount}건 작성`
    );

    // ── 2단계: 내 블로그 최근 30일 포스트 스캔 ──
    addLog("info", "2단계: 내 블로그 포스트 스캔 시작...");
    let crawledPosts: any[] = [];
    try {
      crawledPosts = await bot.crawlComments(blogId);
      for (const post of crawledPosts) {
        await prisma.post.upsert({
          where: {
            blogId_naverPostId: { blogId, naverPostId: post.naverPostId },
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
      addLog("error", `2단계 오류: ${e.message}`);
      failures.push({ target: "포스트 스캔", reason: e.message });
    }
    addLog("info", `2단계 완료: ${crawledPosts.length}개 포스트 스캔됨`);

    // ── 3단계: 미답변 댓글에 대댓글 작성 ──
    const postsWithComments = crawledPosts.filter((p) => p.commentCount > 0);
    addLog(
      "info",
      `3단계: ${postsWithComments.length}개 포스트에 댓글 작성 시작...`
    );

    for (const post of postsWithComments) {
      try {
        const count = await bot.writeRepliesForPost(
          post.url,
          async (commentText, images) => {
            return await generateReply(commentText, images);
          }
        );
        totalReplyCount += count;
        await prisma.post.updateMany({
          where: { blogId, naverPostId: post.naverPostId },
          data: { commentCount: 0 },
        });
      } catch (e: any) {
        addLog("error", `댓글 작성 오류 (${post.title}): ${e.message}`);
        failures.push({
          target: `댓글: ${post.title}`,
          reason: e.message,
        });
      }
    }
    const myBlogReplies = totalReplyCount - feedReplyCount;
    addLog("info", `3단계 완료: 대댓글 ${myBlogReplies}건 작성`);

    // ── 통계 업데이트 ──
    await prisma.dashboardStats.upsert({
      where: { blogId },
      update: {
        totalReplies: { increment: totalReplyCount },
        todayReplies: { increment: totalReplyCount },
        lastReplyDate: new Date(),
        lastCrawlTime: new Date(),
      },
      create: {
        blogId,
        totalReplies: totalReplyCount,
        todayReplies: totalReplyCount,
        lastReplyDate: new Date(),
        lastCrawlTime: new Date(),
      },
    });

    addLog(
      "success",
      `✅ 사이클 완료: 총 ${totalReplyCount}건 (이웃 ${feedReplyCount}건 + 대댓글 ${myBlogReplies}건)`
    );

    // ── 이메일 리포트 발송 ──
    const endTime = new Date();
    const report: CycleReport = {
      startTime,
      endTime,
      neighborPostCount: feedProcessedCount + crawledPosts.length,
      neighborReplySuccess: feedReplyCount,
      myBlogReplySuccess: myBlogReplies,
      failures,
    };
    await sendCycleReport(report);

    lastCycleResult = {
      success: true,
      replyCount: totalReplyCount,
      neighborReplies: feedReplyCount,
      myBlogReplies,
      scannedPosts: crawledPosts.length,
      failures: failures.length,
      completedAt: endTime.toISOString(),
    };
  } catch (error: any) {
    addLog("error", `❌ 사이클 오류: ${error.message}`);

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

    lastCycleResult = {
      success: false,
      replyCount: 0,
      neighborReplies: 0,
      myBlogReplies: 0,
      scannedPosts: 0,
      failures: failures.length,
      completedAt: endTime.toISOString(),
    };
  }

  // 다음 사이클 예약
  if (schedulerStatus === "working") {
    schedulerStatus = "running";
    scheduleNext(getRandomInterval());
  }
}

// ─────────────────────────────────────────────
// 다음 사이클 예약
// ─────────────────────────────────────────────
function scheduleNext(intervalMs: number) {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }

  nextRunTime = new Date(Date.now() + intervalMs);
  const intervalMin = Math.round(intervalMs / 60000);
  addLog(
    "info",
    `다음 사이클: ${nextRunTime.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })} (약 ${Math.floor(intervalMin / 60)}시간 ${intervalMin % 60}분 후)`
  );

  schedulerTimer = setTimeout(() => {
    runOneCycle();
  }, intervalMs);
}

// ─────────────────────────────────────────────
// 외부에서 호출하는 제어 함수들
// ─────────────────────────────────────────────
export function startScheduler(blogId: string) {
  if (schedulerStatus !== "stopped") {
    // 이미 실행 중이면 무시
    return;
  }
  schedulerBlogId = blogId;
  schedulerStatus = "running";
  lastCycleResult = null;
  schedulerLogs.length = 0;
  addLog(
    "info",
    `🚀 서버 스케줄러 시작 (${MIN_INTERVAL_HOURS}~${MAX_INTERVAL_HOURS}시간 주기)`
  );

  // 즉시 첫 사이클 실행
  runOneCycle();
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerStatus = "stopped";
  nextRunTime = null;
  addLog("info", "⏹️ 서버 스케줄러가 완전히 종료되었습니다.");
}

export function pauseScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerStatus = "stopped";
  nextRunTime = null;
  addLog("info", "⏸️ 서버 스케줄러가 일시정지되었습니다.");
}

export function getSchedulerState(): SchedulerState {
  return {
    status: schedulerStatus,
    blogId: schedulerBlogId,
    nextRunTime: nextRunTime?.toISOString() ?? null,
    lastCycleResult,
    logs: [...schedulerLogs],
  };
}
