"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

export default function DashboardClient({
  initialStats,
  initialPosts,
  defaultBlogId = ""
}: {
  initialStats: any;
  initialPosts: any[];
  defaultBlogId?: string;
}) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [blogId, setBlogId] = useState(defaultBlogId);
  const [canWriteReplies, setCanWriteReplies] = useState(false);
  const [displayStats, setDisplayStats] = useState(initialStats);

  // Hydration 불일치 방지를 위해 클라이언트 마운트 후 초기 로그 설정
  useEffect(() => {
    setLogs([
      { time: new Date().toLocaleTimeString(), type: 'info', msg: '시스템 초기화 완료.' },
      { time: new Date().toLocaleTimeString(), type: 'info', msg: '사용자 인증 세션 확인됨.' },
    ]);
  }, []);

  // 블로그 ID가 변경되면(입력 포인트 발생 시) 통계 및 버튼 초기화
  useEffect(() => {
    setCanWriteReplies(false);
    setDisplayStats((prev: any) => ({
      ...prev,
      activePosts: 0,
      totalReplies: 0,
      newComments: 0
    }));
  }, [blogId]);

  // initialStats가 서버에서 갱신되어 올 때(스캔 성공 후 router.refresh() 시) 다시 반영
  useEffect(() => {
    if (canWriteReplies) {
      setDisplayStats(initialStats);
    }
  }, [initialStats, canWriteReplies]);

  const handleAutoReply = async () => {
    // 이제 스캔(canWriteReplies)과 무관하게 이웃 새글 탐색이 가능해야 하므로 조건 완화
    if (!blogId.trim()) {
      alert("네이버 블로그 아이디를 먼저 입력해주세요.");
      return;
    }

    setIsRefreshing(true);
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'scan', msg: '이웃 새글 탐색 및 AI 대댓글 일괄 생성 시작...' }]);

    try {
      const res = await fetch(`/api/reply?blogId=${encodeURIComponent(blogId.trim())}`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        setLogs(prev => [...prev, {
          time: new Date().toLocaleTimeString(),
          type: 'success',
          msg: `작업 완료: 총 ${data.replyCount}개의 대댓글을 작성했습니다.`
        }]);
        setCanWriteReplies(false); // 작업 완료 후 다시 비활성화 (필요시 재스캔 유도)
        router.refresh();
      } else {
        throw new Error(data.error || "작업 중 오류 발생");
      }
    } catch (err: any) {
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'error', msg: `오류 발생: ${err.message}` }]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    if (!blogId.trim()) {
      alert("네이버 블로그 아이디를 입력해주세요.");
      return;
    }
    setIsRefreshing(true);
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'scan', msg: '네이버 블로그 신규 댓글 스캔 시작...' }]);

    try {
      const res = await fetch(`/api/crawl?blogId=${encodeURIComponent(blogId.trim())}`);
      const data = await res.json();

      if (data.success) {
        const postsWithComments = data.posts.filter((p: any) => p.commentCount > 0);
        setLogs(prev => [...prev, {
          time: new Date().toLocaleTimeString(),
          type: 'success',
          msg: `블로그에서 ${data.posts.length}개의 포스트 검색 완료. (새로 대댓글을 작성할 포스트: ${postsWithComments.length}개)`
        }]);

        setCanWriteReplies(true); // 스캔 완료 후 버튼 활성화

        // URL 업데이트하여 서버 필터링 적용
        router.push(`/?blogId=${encodeURIComponent(blogId.trim())}`);
        router.refresh();
      } else {
        throw new Error(data.error || "알 수 없는 오류");
      }
    } catch (err: any) {
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'error', msg: `오류 발생: ${err.message}` }]);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 스캔 완료 전에는 목록을 보여주지 않음 (initialPosts는 이전 블로그 데이터일 수 있으므로)
  const filteredPosts = canWriteReplies ? initialPosts.filter(p => p.comments > 0) : [];

  return (
    <div className="space-y-12 animate-in fade-in duration-700">
      {/* Stats Header */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="신규 댓글" value={displayStats.newComments} unit="건" color="green" progress={displayStats.newComments > 0 ? 100 : 0} />
        <StatCard title="진행 중인 포스트" value={displayStats.activePosts} unit="개" color="blue" progress={displayStats.activePosts > 0 ? 100 : 0} />
        <StatCard title="총 작성 대댓글" value={displayStats.totalReplies} unit="건" color="purple" />
        <div className="bg-slate-900/80 p-6 rounded-3xl border border-slate-700 backdrop-blur-md shadow-xl transition-all flex flex-col justify-between">
          <div>
            <p className="text-slate-200 font-bold mb-1">블로그 연결</p>
            <div className="flex items-center gap-2 bg-slate-950/50 p-2 mt-2 rounded-xl border border-slate-800 shadow-inner">
              <span className="text-slate-500 pl-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              </span>
              <input
                type="text"
                placeholder="네이버 ID"
                value={blogId}
                onChange={e => setBlogId(e.target.value)}
                className="bg-transparent text-white px-1 outline-none w-full text-sm placeholder:text-slate-700 font-semibold"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <div className={`w-2.5 h-2.5 rounded-full ${isRefreshing ? 'bg-yellow-500 animate-spin' : 'bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,1)]'}`} />
            <span className="text-xl font-bold text-white tracking-tight">{isRefreshing ? '스캔 중...' : displayStats.lastUpdate}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <span className="w-2 h-8 bg-green-500 rounded-full" />
              신규 댓글 포스트
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={handleAutoReply}
                disabled={isRefreshing}
                className={`px-6 py-2.5 font-bold rounded-2xl transition-all active:scale-95 shadow-lg whitespace-nowrap ${isRefreshing
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-50'
                    : 'bg-green-500 text-slate-950 hover:bg-green-400 hover:shadow-green-500/30'
                  }`}
              >
                {isRefreshing ? '작성 중...' : 'AI 댓글 일괄 작성'}
              </button>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={`px-6 py-2.5 bg-slate-100 text-slate-900 font-bold rounded-2xl transition-all active:scale-95 shadow-lg whitespace-nowrap ${isRefreshing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white hover:shadow-white/10'}`}
              >
                {isRefreshing ? '스캔 중...' : '전체 새로고침'}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {filteredPosts.length > 0 ? filteredPosts.map((post, idx) => (
              <div key={idx} className="bg-slate-900/90 p-6 rounded-3xl border border-slate-700 flex items-center justify-between group hover:bg-slate-800/80 transition-all duration-300 shadow-xl">
                <div className="space-y-1">
                  <h3 className="font-bold text-xl text-white group-hover:text-green-400 transition-colors uppercase tracking-tight">{post.title}</h3>
                  <p className="text-sm text-slate-300 flex items-center gap-2 font-medium">
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                    대기 중인 댓글 {post.comments}개
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1 bg-green-500/10 text-green-400 text-xs font-bold rounded-full border border-green-500/20">대기중</div>
                </div>
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center py-24 bg-slate-900/40 rounded-[2.5rem] border-2 border-dashed border-slate-800 text-slate-500 space-y-4">
                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-3xl">📭</div>
                <p className="font-bold text-xl text-white">신규 댓글이 있는 포스트가 없습니다.</p>
                <p className="text-base text-slate-300 font-medium">'전체 새로고침'을 눌러 블로그를 연결해주세요.</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <span className="w-2 h-8 bg-blue-500 rounded-full" />
            시스템 로그
          </h2>
          <div className="bg-slate-900/90 rounded-3xl border border-slate-700 p-6 h-[500px] overflow-y-auto space-y-3 font-mono text-xs shadow-2xl custom-scrollbar border-t-8 border-t-slate-800">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-3 text-slate-400 border-b border-slate-800/50 pb-2">
                <span className="text-blue-500 font-bold shrink-0">[{log.time}]</span>
                <span className={log.type === 'success' ? 'text-green-400 font-bold' : log.type === 'error' ? 'text-red-400' : 'text-slate-100'}>
                  {log.msg}
                </span>
              </div>
            ))}
            {isRefreshing && (
              <div className="pt-4 flex items-center gap-2 italic text-slate-400 animate-pulse font-medium">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                네이버 블로그 데이터 수집 중... (Playwright 실행 중)
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, unit, color, progress }: any) {
  const colors: any = {
    green: "text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.4)]",
    blue: "text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.4)]",
    purple: "text-purple-400 drop-shadow-[0_0_8px_rgba(192,132,252,0.4)]"
  };
  const bgColors: any = {
    green: "bg-green-500",
    blue: "bg-blue-400",
    purple: "bg-purple-500"
  };

  return (
    <div className="bg-slate-900/80 p-6 rounded-3xl border border-slate-700 backdrop-blur-md shadow-xl group hover:border-slate-500 transition-all duration-300">
      <p className="text-slate-300 font-bold mb-1 text-sm tracking-wide uppercase">{title}</p>
      <div className="flex items-end gap-2">
        <span className={`text-4xl font-black ${colors[color]}`}>{value}</span>
        <span className="text-slate-500 mb-1 font-bold">{unit}</span>
      </div>
      {progress !== undefined && (
        <div className="mt-5 w-full h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${bgColors[color]} transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(255,255,255,0.1)]`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
