import type { Metadata } from "next";
import { auth } from "@/auth"
import "./globals.css";

export const metadata: Metadata = {
  title: "Naver Blog AI Reply",
  description: "AI를 이용한 네이버 블로그 자동 대댓글 시스템",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth()

  return (
    <html lang="ko">
      <body className="antialiased font-sans bg-slate-950 text-slate-50">
        <div className="min-h-screen">
          <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center font-bold text-slate-950 shadow-[0_0_15px_rgba(34,197,94,0.4)]">N</div>
                <span className="text-xl font-bold tracking-tight">BlogReply <span className="text-green-500">AI</span></span>
              </div>
              <div className="flex items-center gap-4">
                {session ? (
                  <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                      <p className="text-sm font-medium">{session.user?.name}</p>
                      <p className="text-xs text-slate-400">{session.user?.email}</p>
                    </div>
                    {session.user?.image && (
                      <img src={session.user.image} alt="User Profile" className="w-9 h-9 rounded-full ring-2 ring-slate-800" />
                    )}
                  </div>
                ) : (
                  <button className="px-4 py-2 bg-slate-100 text-slate-900 rounded-lg font-semibold hover:bg-slate-200 transition-colors">
                    로그인
                  </button>
                )}
              </div>
            </div>
          </nav>
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
