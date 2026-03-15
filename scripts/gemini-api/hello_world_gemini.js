const { GoogleGenerativeAI } = require('@google/generative-ai');
async function check() {
  const genAI = new GoogleGenerativeAI('AIzaSyC2XGzVEVs3y-IsiWhLPxr3zF23_yYy7i8');
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
    const res = await model.generateContent('hello');
    console.log(res.response.text());
  } catch(e) {
    console.error(e.message);
  }
}
check();
