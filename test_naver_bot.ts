const { NaverBlogBot } = require('./src/lib/naverBot');

(async () => {
    try {
        const bot = new NaverBlogBot();
        await bot.init();
        console.log("Starting crawlComments...");
        const posts = await bot.crawlComments('kkokkoribbon');
        console.log("Crawl Result:", posts);
        await bot.close();
    } catch (err) {
        console.error("Error:", err);
    }
})();
