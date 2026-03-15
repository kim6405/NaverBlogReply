const { GoogleGenerativeAI } = require('@google/generative-ai');
async function check() {
  const genAI = new GoogleGenerativeAI('AIzaSyC2XGzVEVs3y-IsiWhLPxr3zF23_yYy7i8');
  try {
    // There is no listModels method directly on genAI in the new SDK sometimes, but let's try
    const fetch = require('node-fetch'); // wait, node 20 has global fetch
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyC2XGzVEVs3y-IsiWhLPxr3zF23_yYy7i8');
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch(e) {
    console.error(e.message);
  }
}
check();
