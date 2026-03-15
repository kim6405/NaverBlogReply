import { auth, signIn } from "@/auth"
import Link from "next/link"
import { prisma } from "@/lib/prisma"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ blogId?: string }>;
}) {
  const params = await searchParams;
  const blogId = params.blogId || process.env.NAVER_BLOG_ID || "";
  const session = await auth()

  if (!session) {
    // ... (same as before)
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
        {/* ... (keep existing content) */}
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-5xl animate-pulse shadow-[0_0_40px_rgba(34,197,94,0.3)]">AI</div>
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-black text-white sm:text-5xl tracking-tight">AI 대댓글 서비스</h1>
          <p className="text-slate-300 max-w-md mx-auto text-lg leading-relaxed">
            네이버 블로그의 댓글을 AI가 분석하고 당신의 목소리로 대댓글을 작성합니다.
          </p>
        </div>
        <form
          action={async () => {
            "use server"
            await signIn("google")
          }}
        >
          <button className="flex items-center gap-3 px-10 py-5 bg-white text-slate-900 rounded-2xl font-bold text-xl hover:scale-105 active:scale-95 transition-all shadow-xl hover:shadow-2xl">
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path fill="#EA4335" d="m12.48 10.92v3.28h7.84c-.24 1.84-.9 3.22-2.03 4.35-1.12 1.12-2.8 2.38-5.81 2.38-4.65 0-8.32-3.77-8.32-8.42s3.67-8.42 8.32-8.42c2.53 0 4.43.99 5.8 2.29l2.3-2.3c-1.99-1.89-4.59-3.3-8.1-3.3-6.62 0-12 5.38-12 12s5.38 12 12 12c3.56 0 6.25-1.17 8.35-3.35 2.17-2.17 2.85-5.22 2.85-7.66 0-.48-.04-.95-.11-1.37h-11.12z" />
            </svg>
            구글로 시작하기
          </button>
        </form>
      </div>
    )
  }

  const statsFromDb = await prisma.dashboardStats.findUnique({ where: { blogId: blogId } });
  
  // 현재 선택된 블로그의 포스트만 필터링하여 가져오기
  const allPostsFromDb = await prisma.post.findMany({
    where: { blogId: blogId },
    orderBy: { updatedAt: 'desc' }
  });

  // 15일 이내 작성된 포스트 중 "실제 존재"하는 것만 필터링
  const fifteenDaysAgo = new Date();
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

  const activeMonitoringPosts = allPostsFromDb.filter((p: any) => {
    // 1. postDate가 15일 이내여야 함
    if (!p.postDate) return false;
    const isWithin15Days = new Date(p.postDate) >= fifteenDaysAgo;
    
    // 2. 가장 최근 스캔(lastCrawlTime)에서 실제로 발견되었는지 확인 (lastSeenAt 기준)
    // lastSeenAt이 없거나, 스캔 시간보다 확실히 이전이면 삭제된 유령 포스트로 간주
    if (!p.lastSeenAt) return false;
    
    const crawlTime = statsFromDb?.lastCrawlTime ? new Date(statsFromDb.lastCrawlTime).getTime() : 0;
    const lastSeenTime = new Date(p.lastSeenAt).getTime();
    
    // 스캔 시간과 실제 발견 시간 차이가 3분 이내인 경우만 '현재 존재하는 포스트'로 간주
    const isCurrentlyPresent = Math.abs(crawlTime - lastSeenTime) < 180000; 

    return isWithin15Days && isCurrentlyPresent;
  });

  // 오늘 작성된 대댓글 확인 (현재 블로그 기준)
  const isToday = (date: Date | null | undefined) => {
    if (!date) return false;
    const now = new Date();
    const d = new Date(date);
    return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  };
  const todayRepliesCount = isToday(statsFromDb?.lastReplyDate) ? (statsFromDb?.todayReplies || 0) : 0;

  const stats = {
    newComments: allPostsFromDb.reduce((acc, p) => acc + p.commentCount, 0),
    activePosts: activeMonitoringPosts.length, // 블로그별 15일 이내 게시물만 카운트
    totalReplies: todayRepliesCount, // 블로그별 오늘 작성 건수
    lastUpdate: statsFromDb?.lastCrawlTime?.toLocaleString("ko-KR", { timeStyle: 'short' }) || "업데이트 전"
  }

  const recentPosts = allPostsFromDb.slice(0, 10).map((p: any) => ({
    title: p.title,
    comments: p.commentCount,
    url: p.url,
    naverPostId: p.naverPostId
  }));

  return (
    <DashboardClient 
      initialStats={stats}
      initialPosts={recentPosts}
      defaultBlogId={blogId}
    />
  );
}

// Client Component Import
import DashboardClient from "./dashboard-client";
