
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const post = await prisma.post.findFirst({
    where: {
      blogId: 'kjh_hero',
      title: { contains: 'TEST2' }
    }
  });
  console.log(JSON.stringify(post, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
