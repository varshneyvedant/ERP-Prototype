const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.periodLock.deleteMany({});
  console.log("Successfully unlocked all accounting periods.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
