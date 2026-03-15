const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    console.log('--- ALL Posts for kjh_hero ---');
    const posts = await prisma.post.findMany({
        where: { blogId: 'kjh_hero' }
    });
    console.log(JSON.stringify(posts, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
