import { NaverBlogBot } from "./naverBot";

/**
 * 브라우저 봇 인스턴스를 싱글톤으로 관리합니다.
 * - 최초 start 시 init + 로그인 1회
 * - 이후 사이클에서는 기존 브라우저를 재사용
 * - stop 시 브라우저 종료
 */
let botInstance: NaverBlogBot | null = null;
let isLoggedIn = false;
let currentBlogId = "";

/**
 * 봇 인스턴스를 가져옵니다. 없으면 초기화 + 로그인합니다.
 */
export async function getBot(blogId: string): Promise<NaverBlogBot> {
  // 이미 초기화된 봇이 있고, 같은 blogId라면 재사용
  if (botInstance && isLoggedIn && currentBlogId === blogId) {
    // 브라우저가 아직 살아있는지 간단히 확인
    try {
      const isAlive = await botInstance.isAlive();
      if (isAlive) {
        console.log("[BotManager] 기존 브라우저 세션을 재사용합니다.");
        return botInstance;
      }
    } catch {
      // 브라우저가 죽었으면 아래에서 새로 만듦
    }
    console.log("[BotManager] 기존 브라우저가 종료되었습니다. 새로 초기화합니다.");
    botInstance = null;
    isLoggedIn = false;
  }

  // 새 봇 인스턴스 생성
  console.log("[BotManager] 새 브라우저를 초기화하고 로그인합니다...");
  botInstance = new NaverBlogBot();
  await botInstance.init();
  await botInstance.ensureLogin(blogId);
  isLoggedIn = true;
  currentBlogId = blogId;
  console.log("[BotManager] 로그인 완료. 브라우저 세션을 유지합니다.");
  return botInstance;
}

/**
 * 봇을 완전히 종료합니다 (종료 버튼 클릭 시).
 */
export async function closeBot(): Promise<void> {
  if (botInstance) {
    console.log("[BotManager] 브라우저를 종료합니다.");
    await botInstance.close();
    botInstance = null;
    isLoggedIn = false;
    currentBlogId = "";
  }
}

/**
 * 현재 봇이 활성 상태인지 확인합니다.
 */
export function isBotActive(): boolean {
  return botInstance !== null && isLoggedIn;
}
