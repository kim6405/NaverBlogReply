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
        console.log(`updatedAt: ${p.updatedAt}`);
        console.log(`commentCount: ${p.commentCount}`);
        console.log('-----------------------------------');
    });

    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    console.log(`Fifteen Days Ago: ${fifteenDaysAgo.toISOString()}`);

    const active = posts.filter(p => p.postDate && new Date(p.postDate) >= fifteenDaysAgo);
    console.log(`Active Posts Count (calculated): ${active.length}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
