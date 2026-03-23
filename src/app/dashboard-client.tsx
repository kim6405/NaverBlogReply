"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";


// 2~4시간 사이 랜덤 밀리초 생성
function getRandomInterval(): number {
  const minHours = 2;
  const maxHours = 4;
  const hours = minHours + Math.random() * (maxHours - minHours);
  return Math.round(hours * 60 * 60 * 1000);
}

/*
// 1~3분 사이 랜덤 밀리초 생성 (테스트용)
function getRandomInterval(): number {
  const minMinutes = 1;
  const maxMinutes = 3;
  const minutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
  return Math.round(minutes * 60 * 1000); // 1,000을 곱해 밀리초로 변환
}
*/


/**
 * 현재 시간이 취침 시간(오후 11시 ~ 오전 9시)인지 판단합니다.
 */
function isQuietTime(): boolean {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 9;
}

/**
 * 다음 활동 시간까지 남은 시간을 "X시간 Y분" 형태로 반환합니다.
 */
function getTimeUntilActive(): string {
  const now = new Date();
  const hour = now.getHours();
  let targetHour = 9;
  const target = new Date(now);
  if (hour >= 9) {
    // 이미 9시가 지났고 23시 이전이면 활동 중이므로 이 함수는 호출되지 않아야 하지만,
    // 만약 23시 이후라면 다음날 9시로 설정
    target.setDate(target.getDate() + 1);
  }
  target.setHours(targetHour, 0, 0, 0);
  const diff = target.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}시간 ${minutes}분`;
}

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

  // 누적 카운트 (자동 실행 세션 동안 사이클별 누적 등)
  const [cumulativeStats, setCumulativeStats] = useState({
    newComments: 0,      // 신규 댓글 누적
    totalReplies: 0,     // 총 작성 대댓글 누적
    activePosts: 0,      // 진행 중인 포스트 (누적은 아니지만 자동 실행 전엔 0으로 시작)
  });

  // 자동화 상태
  const [autoStatus, setAutoStatus] = useState<"stopped" | "running" | "paused" | "working" | "quiet">("stopped");
  const [isWorking, setIsWorking] = useState(false);
  const [nextRunTime, setNextRunTime] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydration 불일치 방지를 위해 클라이언트 마운트 후 초기 로그 설정
  useEffect(() => {
    setLogs([
      { time: new Date().toLocaleTimeString(), type: 'info', msg: '시스템 초기화 완료.' },
      { time: new Date().toLocaleTimeString(), type: 'info', msg: '사용자 인증 세션 확인됨.' },
    ]);
  }, []);

  // initialStats가 서버에서 갱신되어 올 때 반영 (진행 중인 포스트만 업데이트)
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
  // 핵심: 한 사이클 실행 (이웃 방문 → 스캔 → 대댓글)
  // ────────────────────────────────────────────
  const runOneCycle = useCallback(async () => {
    // 취침 시간 체크
    if (isQuietTime()) {
      setAutoStatus("quiet");
      addLog('info', `취침 시간입니다. ${getTimeUntilActive()} 후에 자동으로 재개됩니다.`);
      return;
    }

    if (!blogId.trim()) {
      addLog('error', '블로그 ID가 설정되지 않아 사이클을 건너뜁니다.');
      return;
    }

    setIsWorking(true);
    setAutoStatus("working");
    addLog('scan', '🔄 자동 사이클 시작: 이웃 새글 탐색 → 내 블로그 스캔 → 대댓글 작성...');

    try {
      const res = await fetch(`/api/reply?blogId=${encodeURIComponent(blogId.trim())}`, { method: 'POST' });
      const data = await res.json();

      if (data.skipped) {
        addLog('info', data.reason);
      } else if (data.success) {
        addLog('success', `✅ 사이클 완료: 총 ${data.replyCount}건의 댓글을 작성했습니다.`);

        // 사이클 완료 시 누적 카운트 업데이트
        if (data.cycleStats) {
          setCumulativeStats(prev => ({
            newComments: prev.newComments + (data.cycleStats.newComments || 0),
            totalReplies: prev.totalReplies + (data.replyCount || 0),
            activePosts: data.cycleStats.scannedPosts ?? prev.activePosts, // 최신 값 갱신
          }));
        }

        router.refresh();
      } else {
        throw new Error(data.error || "작업 중 오류 발생");
      }
    } catch (err: any) {
      addLog('error', `❌ 사이클 오류: ${err.message}`);
    } finally {
      setIsWorking(false);
      // 아직 "running" 상태라면 다시 running으로 복귀
      setAutoStatus(prev => (prev === "working" ? "running" : prev));

      // 다음 실행 시간 설정 (2~4시간 랜덤)
      const interval = getRandomInterval();
      const next = new Date(Date.now() + interval);
      const intervalMin = Math.round(interval / 60000);
      setNextRunTime(next);
      addLog('info', `다음 사이클: ${next.toLocaleTimeString('ko-KR')} (약 ${Math.floor(intervalMin / 60)}시간 ${intervalMin % 60}분 후)`);
    }
  }, [blogId, addLog, router]);

  // ────────────────────────────────────────────
  // 타이머 관리: autoStatus가 "running"이면 주기적으로 실행
  // ────────────────────────────────────────────
  useEffect(() => {
    // 기존 타이머 정리
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (autoStatus === "running") {
      // 처음 시작하거나, nextRunTime이 없으면 즉시 한 사이클 실행
      if (!nextRunTime) {
        runOneCycle();
      }

      timerRef.current = setInterval(() => {
        // 매 분마다 체크: 취침 시간이면 상태를 quiet로, 아니면 다음 실행시간 도래 여부 확인
        if (isQuietTime()) {
          setAutoStatus("quiet");
          return;
        }

        if (nextRunTime && Date.now() >= nextRunTime.getTime()) {
          runOneCycle();
        }
      }, 60 * 1000); // 1분마다 체크
    }

    if (autoStatus === "quiet") {
      // 취침 시간 중에도 1분마다 체크하여 활동 시간이 되면 자동 재개
      timerRef.current = setInterval(() => {
        if (!isQuietTime()) {
          addLog('info', '🌅 활동 시간이 되었습니다. 자동 사이클을 재개합니다.');
          setAutoStatus("running");
          setNextRunTime(null); // 즉시 실행되도록 리셋
        }
      }, 60 * 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoStatus, nextRunTime, runOneCycle, addLog]);

  // ────────────────────────────────────────────
  // 카운트다운 표시
  // ────────────────────────────────────────────
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);

    if ((autoStatus === "running" || autoStatus === "quiet") && nextRunTime) {
      const updateCountdown = () => {
        const diff = nextRunTime.getTime() - Date.now();
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
  }, [autoStatus, nextRunTime]);

  // ────────────────────────────────────────────
  // 버튼 핸들러
  // ────────────────────────────────────────────
  const handleStart = async () => {
    if (!blogId.trim()) {
      alert("네이버 블로그 아이디를 먼저 입력해주세요.");
      return;
    }
    addLog('info', '🚀 자동 실행을 시작합니다. (4시간 주기)');
    // 자동 실행 시작 시 로컬 카운트 초기화
    setCumulativeStats({ newComments: 0, totalReplies: 0, activePosts: 0 });
    setAutoStatus("running");
    setNextRunTime(null); // 즉시 첫 사이클 트리거

    // 서버에 상태 저장
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', blogId: blogId.trim() })
    });
  };

  const handlePause = async () => {
    addLog('info', '⏸️ 자동 실행이 일시정지되었습니다.');
    setAutoStatus("paused");
    setNextRunTime(null);

    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause', blogId: blogId.trim() })
    });
  };

  const handleStop = async () => {
    addLog('info', '⏹️ 자동 실행이 완전히 종료되었습니다.');
    setAutoStatus("stopped");
    setNextRunTime(null);

    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', blogId: blogId.trim() })
    });
  };

  // 상태별 표시 정보
  const statusConfig: Record<string, { label: string; color: string; dotClass: string }> = {
    stopped: { label: "대기 중", color: "text-slate-400", dotClass: "bg-slate-500" },
    running: { label: "자동 실행 중", color: "text-green-400", dotClass: "bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,1)]" },
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
        <StatCard title="총 작성 대댓글" value={cumulativeStats.totalReplies} unit="건" color="purple" />
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
          <p>• <strong>자동 실행 시작</strong>: 즉시 첫 사이클을 실행하고, 이후 2~4시간 간격으로 랜덤 반복합니다.</p>
          <p>• <strong>취침 시간</strong>(오후 11시 ~ 오전 9시)에는 자동으로 작업이 중단되며, 오전 9시에 자동 재개됩니다.</p>
          <p>• 실행 순서: 이웃 새글 댓글(최대 30개) → 내 블로그 포스트 스캔(30일) → 대댓글 작성</p>
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
