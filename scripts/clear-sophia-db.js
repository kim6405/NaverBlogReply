const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAndClear() {
    const visits = await prisma.visitHistory.findMany({
        where: { blogId: 'sofia_kim1125' }
    });
    console.log("Visits for Sophia:", visits);
    
    if (visits.length > 0) {
        await prisma.visitHistory.deleteMany({
            where: { blogId: 'sofia_kim1125' }
        });
        console.log("Deleted Sophia's visit history.");
    }
    await prisma.$disconnect();
}

checkAndClear().catch(console.error);
