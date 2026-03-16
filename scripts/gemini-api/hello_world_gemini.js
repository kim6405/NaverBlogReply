const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: '../../.env' });

async function check() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
    const res = await model.generateContent('hello');
    console.log(res.response.text());
  } catch(e) {
    console.error(e.message);
  }
}
check();
