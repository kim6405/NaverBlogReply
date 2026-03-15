const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
    const posts = await prisma.post.findMany({
        where: { blogId: 'kjh_hero' }
    });
    console.log(JSON.stringify(posts, null, 2));
    await prisma.$disconnect();
})();
