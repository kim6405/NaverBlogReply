// Playwright로 shindoragon 블로그 접속 테스트
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userDataDir = path.resolve(process.cwd(), '.naver_session_test_tmp');

console.log(`[Test] userDataDir: ${userDataDir}`);
console.log(`[Test] 브라우저 실행 중...`);

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
  args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
  viewport: null,
});

const pages = context.pages();
const page = pages.length > 0 ? pages[0] : await context.newPage();

// 로그인 확인
console.log('[Test] 네이버 로그인 페이지로 이동...');
await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'networkidle' });
if (page.url().includes('nidlogin.login')) {
  console.log('[Test] ⚠️  로그인이 필요합니다. 브라우저 창에서 로그인 후 Enter를 눌러주세요...');
  await page.waitForURL(url => !url.href.includes('nidlogin.login'), { timeout: 120000 });
  console.log('[Test] 로그인 완료!');
} else {
  console.log('[Test] 이미 로그인 상태');
}

// ---- 테스트 1: PC 버전 ----
console.log('\n[Test 1] blog.naver.com 접속 시도...');
await page.goto('about:blank', { waitUntil: 'load' });
await page.waitForTimeout(2000);

const r1 = await page.goto('https://blog.naver.com/shindoragon', {
  waitUntil: 'networkidle',
  timeout: 30000,
});

await page.waitForTimeout(3000);
const url1 = page.url();
console.log(`[Test 1] 최종 URL: ${url1}`);
console.log(`[Test 1] HTTP Status: ${r1?.status()}`);

// 오류 페이지 여부 확인
const content1 = await page.content();
const isErr1 = url1.includes('MobileErrorView') || url1.includes('errorType=') || content1.includes('일시적인 오류');
console.log(`[Test 1] 오류 페이지 여부: ${isErr1}`);

// 첫 번째 포스트 링크 탐색
const postLinks1 = await page.$$eval('a', links =>
  links
    .map(l => ({ href: l.href, text: l.textContent?.trim() }))
    .filter(l => l.href.includes('shindoragon') && (l.href.includes('logNo=') || /\/\d{8,}/.test(l.href)))
    .slice(0, 5)
);
console.log(`[Test 1] 발견된 포스트 링크:`, postLinks1);

// ---- 테스트 2: 모바일 버전 ----
console.log('\n[Test 2] m.blog.naver.com 접속 시도...');
await page.goto('about:blank', { waitUntil: 'load' });
await page.waitForTimeout(2000);

const r2 = await page.goto('https://m.blog.naver.com/shindoragon', {
  waitUntil: 'networkidle',
  timeout: 30000,
});

await page.waitForTimeout(3000);
const url2 = page.url();
console.log(`[Test 2] 최종 URL: ${url2}`);
console.log(`[Test 2] HTTP Status: ${r2?.status()}`);

const content2 = await page.content();
const isErr2 = url2.includes('MobileErrorView') || url2.includes('errorType=') || content2.includes('일시적인 오류');
console.log(`[Test 2] 오류 페이지 여부: ${isErr2}`);

// 모바일에서 포스트 링크 탐색 (코드와 동일한 셀렉터 사용)
const postLinks2 = await page.$$eval(
  'a[class*="item__"], a[class*="card__"], .lst_section_item a',
  links => links.map(l => ({ href: l.href, text: l.textContent?.trim() })).slice(0, 5)
);
console.log(`[Test 2] 현재 셀렉터로 발견된 포스트 링크:`, postLinks2);

// 모든 a태그에서 포스트 후보 탐색
const allPostLinks2 = await page.$$eval('a', links =>
  links
    .map(l => ({ href: l.href, text: l.textContent?.trim(), class: l.className }))
    .filter(l => l.href.includes('shindoragon') && (l.href.includes('logNo=') || /\/\d{8,}/.test(l.href)))
    .slice(0, 5)
);
console.log(`[Test 2] 전체 a태그에서 포스트 링크:`, allPostLinks2);

console.log('\n[Test] 완료. 10초 후 브라우저 닫힘...');
await page.waitForTimeout(10000);
await context.close();
