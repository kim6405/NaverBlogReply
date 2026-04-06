"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";

// 사이클 간격 표시용 (실제 스케줄링은 서버에서 수행)
const MIN_INTERVAL_HOURS = 2;
const MAX_INTERVAL_HOURS = 4;

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
  const [logs, setLogs] = useState<any[]>([]);
  const [blogId, setBlogId] = useState(defaultBlogId);
  const [displayStats, setDisplayStats] = useState(initialStats);

  // 누적 카운트
  const [cumulativeStats, setCumulativeStats] = useState({
    newComments: 0,
    totalReplies: 0,
    activePosts: 0,
  });

  // 서버 스케줄러 상태
  const [autoStatus, setAutoStatus] = useState<"stopped" | "running" | "paused" | "working" | "quiet">("stopped");
  const [isWorking, setIsWorking] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [nextRunTimeStr, setNextRunTimeStr] = useState<string | null>(null);

  // 폴링 관련 ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logIndexRef = useRef(0);

  // Hydration 불일치 방지를 위해 클라이언트 마운트 후 초기 로그 설정
  useEffect(() => {
    setLogs([
      { time: new Date().toLocaleTimeString(), type: 'info', msg: '시스템 초기화 완료.' },
      { time: new Date().toLocaleTimeString(), type: 'info', msg: '사용자 인증 세션 확인됨.' },
    ]);

    // 마운트 시 서버 스케줄러 상태 확인
    fetchSchedulerStatus();
  }, []);

  // initialStats가 서버에서 갱신되어 올 때 반영
  useEffect(() => {
    setDisplayStats((prev: any) => ({
      ...prev,
      activePosts: initialStats.activePosts,
    }));
  }, [initialStats]);

  const addLog = useCallback((type: string, msg: string) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type, msg }]);
  }, []);

  // ────────────────────────────────────────────
  // 서버 스케줄러 상태 폴링
  // ────────────────────────────────────────────
  const fetchSchedulerStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/scheduler?sinceLogIndex=${logIndexRef.current}`);
      const data = await res.json();

      // 상태 업데이트
      if (data.status === "stopped") {
        setAutoStatus(prev => {
          // 서버가 stopped이지만 클라이언트에서 paused로 표시했다면 유지
          if (prev === "paused") return "paused";
          return "stopped";
        });
      } else {
        setAutoStatus(data.status);
      }

      setIsWorking(data.status === "working");
      setNextRunTimeStr(data.nextRunTime);

      // 서버에서 온 새 로그 추가
      if (data.logs && data.logs.length > 0) {
        setLogs(prev => [...prev, ...data.logs]);
        logIndexRef.current = data.totalLogCount;
      }

      // 사이클 결과가 있으면 누적 카운트 업데이트
      if (data.lastCycleResult) {
        const result = data.lastCycleResult;
        setCumulativeStats(prev => ({
          newComments: prev.newComments,
          totalReplies: prev.totalReplies + (result.replyCount || 0),
          activePosts: result.scannedPosts ?? prev.activePosts,
        }));
        router.refresh();
      }
    } catch {
      // 네트워크 오류는 무시 (폴링 재시도)
    }
  }, [router]);

  // ────────────────────────────────────────────
  // 서버 상태 폴링 타이머
  // ────────────────────────────────────────────
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    // 실행 중이면 5초마다 폴링, 그 외에는 30초마다
    const isActive = autoStatus === "running" || autoStatus === "working" || autoStatus === "quiet";
    const pollInterval = isActive ? 5000 : 30000;

    if (autoStatus !== "stopped") {
      pollRef.current = setInterval(fetchSchedulerStatus, pollInterval);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [autoStatus, fetchSchedulerStatus]);

  // ────────────────────────────────────────────
  // 카운트다운 표시
  // ────────────────────────────────────────────
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);

    if ((autoStatus === "running" || autoStatus === "quiet") && nextRunTimeStr) {
      const updateCountdown = () => {
        const diff = new Date(nextRunTimeStr).getTime() - Date.now();
        if (diff <= 0) {
          setCountdown("곧 실행...");
          return;
        }
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        setCountdown(`${h}시간 ${m}분 ${s}초 후`);
      };
      updateCountdown();
      countdownRef.current = setInterval(updateCountdown, 1000);
    } else {
      setCountdown("");
    }

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoStatus, nextRunTimeStr]);

  // ────────────────────────────────────────────
  // 버튼 핸들러 — 서버 스케줄러 API 호출
  // ────────────────────────────────────────────
  const handleStart = async () => {
    if (!blogId.trim()) {
      alert("네이버 블로그 아이디를 먼저 입력해주세요.");
      return;
    }
    addLog('info', `🚀 자동 실행을 시작합니다. (${MIN_INTERVAL_HOURS}~${MAX_INTERVAL_HOURS}시간 주기, 서버 스케줄러)`);
    setCumulativeStats({ newComments: 0, totalReplies: 0, activePosts: 0 });
    logIndexRef.current = 0;

    // 서버 스케줄러 시작
    await fetch('/api/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', blogId: blogId.trim() })
    });

    // 서버에 상태 저장 (기존 settings API도 호출)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', blogId: blogId.trim() })
    });

    setAutoStatus("running");
    // 즉시 상태 폴링 시작
    fetchSchedulerStatus();
  };

  const handlePause = async () => {
    addLog('info', '⏸️ 자동 실행이 일시정지되었습니다.');

    await fetch('/api/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause', blogId: blogId.trim() })
    });

    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause', blogId: blogId.trim() })
    });

    setAutoStatus("paused");
    setNextRunTimeStr(null);
  };

  const handleStop = async () => {
    addLog('info', '⏹️ 자동 실행이 완전히 종료되었습니다.');

    await fetch('/api/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', blogId: blogId.trim() })
    });

    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', blogId: blogId.trim() })
    });

    setAutoStatus("stopped");
    setNextRunTimeStr(null);
  };

  // 상태별 표시 정보
  const statusConfig: Record<string, { label: string; color: string; dotClass: string }> = {
    stopped: { label: "대기 중", color: "text-slate-400", dotClass: "bg-slate-500" },
    running: { label: "자동 실행 중 (서버)", color: "text-green-400", dotClass: "bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,1)]" },
    working: { label: "작업 수행 중...", color: "text-yellow-400", dotClass: "bg-yellow-500 animate-spin" },
    paused: { label: "일시 정지됨", color: "text-orange-400", dotClass: "bg-orange-500" },
    quiet: { label: "취침 시간 (자동 대기)", color: "text-blue-400", dotClass: "bg-blue-500 animate-pulse" },
  };

  const currentStatus = statusConfig[autoStatus] || statusConfig.stopped;

  return (
    <div className="space-y-12 animate-in fade-in duration-700">
      {/* Stats Header */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="신규 댓글" value={cumulativeStats.newComments} unit="건" color="green" progress={cumulativeStats.newComments > 0 ? 100 : 0} />
        <StatCard title="진행 중인 포스트" value={cumulativeStats.activePosts} unit="개" color="blue" progress={cumulativeStats.activePosts > 0 ? 100 : 0} />
        <StatCard title="총 작성 댓글" value={cumulativeStats.totalReplies} unit="건" color="purple" />
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
                disabled={autoStatus !== "stopped" && autoStatus !== "paused"}
                className="bg-transparent text-white px-1 outline-none w-full text-sm placeholder:text-slate-700 font-semibold disabled:opacity-50"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <div className={`w-2.5 h-2.5 rounded-full ${currentStatus.dotClass}`} />
            <span className={`text-xl font-bold tracking-tight ${currentStatus.color}`}>{currentStatus.label}</span>
          </div>
        </div>
      </div>

      {/* 자동화 제어 패널 */}
      <div className="bg-slate-900/90 p-6 rounded-3xl border border-slate-700 shadow-xl">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <span className="w-2 h-8 bg-green-500 rounded-full" />
              자동화 제어
            </h2>
            {countdown && (
              <div className="px-4 py-1.5 bg-slate-800 rounded-full text-sm font-mono text-slate-300 border border-slate-700">
                ⏳ 다음 실행: {countdown}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* 시작 버튼: 대기 중 또는 일시정지 상태에서만 표시 */}
            {(autoStatus === "stopped" || autoStatus === "paused") && (
              <button
                onClick={handleStart}
                className="px-6 py-2.5 bg-green-500 text-slate-950 font-bold rounded-2xl transition-all active:scale-95 shadow-lg hover:bg-green-400 hover:shadow-green-500/30 whitespace-nowrap"
              >
                {autoStatus === "paused" ? "▶️ 재시작" : "🚀 자동 실행 시작"}
              </button>
            )}

            {/* 일시정지 버튼: 실행 중일 때만 표시 */}
            {(autoStatus === "running" || autoStatus === "working" || autoStatus === "quiet") && (
              <button
                onClick={handlePause}
                disabled={isWorking}
                className={`px-6 py-2.5 bg-orange-500 text-white font-bold rounded-2xl transition-all active:scale-95 shadow-lg hover:bg-orange-400 whitespace-nowrap ${isWorking ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                ⏸️ 일시정지
              </button>
            )}

            {/* 종료 버튼: 대기 중이 아닐 때 항상 표시 */}
            {autoStatus !== "stopped" && (
              <button
                onClick={handleStop}
                disabled={isWorking}
                className={`px-6 py-2.5 bg-red-600 text-white font-bold rounded-2xl transition-all active:scale-95 shadow-lg hover:bg-red-500 whitespace-nowrap ${isWorking ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                ⏹️ 종료
              </button>
            )}
          </div>
        </div>

        {/* 안내 문구 */}
        <div className="mt-4 text-sm text-slate-400 space-y-1">
          <p>• <strong>자동 실행 시작</strong>: 즉시 첫 사이클을 실행하고, 이후 {MIN_INTERVAL_HOURS}~{MAX_INTERVAL_HOURS}시간 간격으로 랜덤 반복합니다.</p>
          <p>• <strong>취침 시간</strong>(오후 11시 ~ 오전 9시)에는 자동으로 작업이 중단되며, 오전 9시에 자동 재개됩니다.</p>
          <p>• 실행 순서: 이웃 새글 댓글(최대 30개) → 내 블로그 포스트 스캔(30일) → 댓글 작성</p>
          <p>• <strong className="text-green-400">🖥️ 서버 스케줄러</strong>: 타이머가 서버에서 동작하므로 브라우저를 닫거나 노트북 덮개를 덮어도 정상 작동합니다.</p>
        </div>
      </div>

      {/* 시스템 로그 */}
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
          {isWorking && (
            <div className="pt-4 flex items-center gap-2 italic text-slate-400 animate-pulse font-medium">
              <div className="w-2 h-2 rounded-full bg-yellow-500" />
              네이버 블로그 자동화 작업 수행 중... (Playwright 실행 중)
            </div>
          )}
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
