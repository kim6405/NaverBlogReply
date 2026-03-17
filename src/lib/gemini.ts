import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * 네이버 블로그 댓글에 대한 개인화된 대댓글을 생성합니다.
 * @param content 원본 댓글의 내용 또는 프롬프트
 * @param imageUrls (선택 사항) 분석할 이미지 URL 리스트
 * @returns AI가 생성한 대댓글 텍스트
 */
export async function generateReply(content: string, images?: { inlineData: { data: string, mimeType: string } }[]): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  // 가용 모델 확인 (기존 모델 사용)
  const modelName = "gemini-3.1-flash-lite-preview";
  const model = genAI.getGenerativeModel({ model: modelName });

  const isCustomPrompt = content.includes("역할:") || content.includes("포스트 제목");

  const promptText = isCustomPrompt ? content : `
    당신은 네이버 블로그의 주인입니다. 
    사용자가 당신의 블로그 포스트에 다음과 같은 댓글을 남겼습니다.
    
    댓글 내용: "${content}"
    
    이 댓글에 대해 블로그 주인으로서 친근하고, 예의 바르며 적절한 답신과 함께 글을 읽어준 것에 대해 감사하는 마음을 담은 2-3문장의 대댓글을 작성해주세요.
    상황에 맞는 이모지도 적절히 섞어서 자연스럽게 작성해주세요.

    [절대 규칙]
    1. 부연 설명 없이, **오직 실제로 게시할 대댓글 내용만** 출력하세요.
    2. 여러 가지 제안을 하지 말고, 가장 자연스러운 **단 하나의 답변만** 출력하세요.
    3. 마크다운 형식이나 따옴표 등을 붙이지 말고 순수 텍스트로만 보내주세요.
    `;

  try {
    const parts: any[] = [{ text: promptText }];
    if (images && images.length > 0) {
      parts.push(...images);
    }

    const result = await model.generateContent(parts);
    const response = await result.response;
    return response.text();
  } catch (error: any) {
    console.error(`[Gemini API Error]: ${error.message}`);
    throw error;
  }
}
