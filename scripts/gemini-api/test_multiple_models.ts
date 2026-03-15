import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  try {
    // Note: listModels is not directly on genAI in older versions, 
    // but in @google/generative-ai it might be different.
    // Actually, let's just try to call a few common models.
    const models = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro", "gemini-1.5-flash-latest"];
    for (const m of models) {
      try {
        const model = genAI.getGenerativeModel({ model: m });
        await model.generateContent("test");
        console.log(`Model ${m} is working!`);
      } catch (e: any) {
        console.log(`Model ${m} failed: ${e.message}`);
      }
    }
  } catch (err: any) {
    console.error("Error listing models:", err.message);
  }
}

listModels();
