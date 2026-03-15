const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    console.log('--- Post Table Data for kjh_hero ---');
    const posts = await prisma.post.findMany({
        where: { blogId: 'kjh_hero' }
    });
    posts.forEach(p => {
        console.log(`Title: ${p.title}`);
        console.log(`naverPostId: ${p.naverPostId}`);
        console.log(`postDate: ${p.postDate}`);
        console.log(`lastSeenAt: ${p.lastSeenAt}`);
        console.log(`updatedAt: ${p.updatedAt}`);
        console.log('-----------------------------------');
    });

    const stats = await prisma.dashboardStats.findUnique({ where: { blogId: 'kjh_hero' } });
    console.log(`Last Crawl Time: ${stats?.lastCrawlTime}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
