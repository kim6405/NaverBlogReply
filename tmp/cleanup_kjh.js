const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const result = await prisma.post.deleteMany({
        where: { blogId: 'kjh_hero' }
    });
    console.log(`DELETED ${result.count} posts for kjh_hero`);
    
    // Also reset stats
    await prisma.dashboardStats.deleteMany({
        where: { blogId: 'kjh_hero' }
    });
    console.log('RESET stats for kjh_hero');
}
main().catch(console.error).finally(() => prisma.$disconnect());
