import nodemailer from "nodemailer";
import dns from "dns";

/**
 * 사이클 리포트 데이터 구조
 */
export interface CycleReport {
  /** 사이클 시작 시간 */
  startTime: Date;
  /** 사이클 종료 시간 */
  endTime: Date;
  /** 이웃 새글 피드에서 발견된 포스트 수 */
  neighborPostCount: number;
  /** 이웃 블로그에 작성 완료한 댓글 수 */
  neighborReplySuccess: number;
  /** 내 블로그에 작성 완료한 대댓글 수 */
  myBlogReplySuccess: number;
  /** 실패 내역 */
  failures: { target: string; reason: string }[];
}

/**
 * 한국 시간(KST) 포맷으로 변환
 */
function formatKST(date: Date): string {
  return date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

/**
 * 사이클 리포트를 HTML 이메일로 생성
 */
function buildReportHtml(report: CycleReport): string {
  const duration = Math.round(
    (report.endTime.getTime() - report.startTime.getTime()) / 1000 / 60
  );

  const failureRows =
    report.failures.length > 0
      ? report.failures
          .map(
            (f) =>
              `<tr><td style="padding:8px;border:1px solid #ddd;">${f.target}</td><td style="padding:8px;border:1px solid #ddd;">${f.reason}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="2" style="padding:8px;border:1px solid #ddd;text-align:center;color:#888;">실패 내역 없음 ✅</td></tr>`;

  return `
    <div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#03C75A;border-bottom:2px solid #03C75A;padding-bottom:10px;">
        📊 네이버 블로그 자동화 작업 리포트
      </h2>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr style="background:#f8f9fa;">
          <td style="padding:10px;border:1px solid #ddd;font-weight:bold;width:40%;">🕐 시작 시간</td>
          <td style="padding:10px;border:1px solid #ddd;">${formatKST(report.startTime)}</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">🕐 종료 시간</td>
          <td style="padding:10px;border:1px solid #ddd;">${formatKST(report.endTime)}</td>
        </tr>
        <tr style="background:#f8f9fa;">
          <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">⏱️ 소요 시간</td>
          <td style="padding:10px;border:1px solid #ddd;">${duration}분</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">📰 이웃 새글 포스트 수</td>
          <td style="padding:10px;border:1px solid #ddd;">${report.neighborPostCount}건</td>
        </tr>
        <tr style="background:#f8f9fa;">
          <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">✍️ 이웃 댓글 작성 완료</td>
          <td style="padding:10px;border:1px solid #ddd;">${report.neighborReplySuccess}건</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">💬 대댓글 작성 완료</td>
          <td style="padding:10px;border:1px solid #ddd;">${report.myBlogReplySuccess}건</td>
        </tr>
      </table>

      <h3 style="color:#e74c3c;margin-top:24px;">❌ 실패 내역</h3>
      <table style="width:100%;border-collapse:collapse;margin:8px 0;">
        <tr style="background:#ffeef0;">
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">대상</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">사유</th>
        </tr>
        ${failureRows}
      </table>

      <p style="color:#888;font-size:12px;margin-top:24px;text-align:center;">
        이 메일은 NaverBlogReply 자동화 시스템에서 자동 발송되었습니다.
      </p>
    </div>
  `;
}

/**
 * 사이클 리포트를 이메일로 발송합니다.
 * 환경변수가 설정되지 않은 경우 경고만 출력하고 건너뜁니다.
 */
export async function sendCycleReport(report: CycleReport): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NOTIFICATION_EMAIL } =
    process.env;

  if (
    !SMTP_HOST ||
    !SMTP_USER ||
    !SMTP_PASS ||
    !NOTIFICATION_EMAIL ||
    SMTP_USER === "your-email@gmail.com"
  ) {
    console.warn(
      "[Mailer] 이메일 환경변수(SMTP_HOST/SMTP_USER/SMTP_PASS/NOTIFICATION_EMAIL)가 설정되지 않았습니다. 이메일 발송을 건너뜁니다."
    );
    return;
  }

  // IPv6 ENETUNREACH 오류 방지: DNS 조회 시 IPv4 우선 사용
  dns.setDefaultResultOrder("ipv4first");

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "587", 10),
    secure: parseInt(SMTP_PORT || "587", 10) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const dateStr = formatKST(report.endTime).split(" ")[0];
  const totalSuccess =
    report.neighborReplySuccess + report.myBlogReplySuccess;

  try {
    await transporter.sendMail({
      from: `"블로그 자동화 봇" <${SMTP_USER}>`,
      to: NOTIFICATION_EMAIL,
      subject: `[블로그봇] ${dateStr} 작업 리포트 — 댓글 ${totalSuccess}건 완료${report.failures.length > 0 ? ` / 실패 ${report.failures.length}건` : ""}`,
      html: buildReportHtml(report),
    });
    console.log(
      `[Mailer] 작업 리포트를 ${NOTIFICATION_EMAIL}로 발송했습니다.`
    );
  } catch (error: any) {
    console.error(`[Mailer] 이메일 발송 실패: ${error.message}`);
  }
}
