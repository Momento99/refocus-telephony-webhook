// prisma/seed.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // Филиалы
  const branchesData = ["Кант", "Сокулук", "Кара-Балта", "Беловодск"];
  for (const name of branchesData) {
    await prisma.branch.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Пара сотрудников (по одному в Кант и Сокулук)
  const kant = await prisma.branch.findUnique({ where: { name: "Кант" } });
  const sokuluk = await prisma.branch.findUnique({ where: { name: "Сокулук" } });

  if (kant) {
    await prisma.employee.upsert({
      where: { id: "seed-kant-seller" },
      update: {},
      create: {
        id: "seed-kant-seller",
        fullName: "Аэлина",
        role: "SELLER",
        mbank: "+996 555 111 222",
        branchId: kant.id,
      },
    });
  }
  if (sokuluk) {
    await prisma.employee.upsert({
      where: { id: "seed-sok-seller" },
      update: {},
      create: {
        id: "seed-sok-seller",
        fullName: "Алина",
        role: "SELLER",
        mbank: "+996 555 000 999",
        branchId: sokuluk.id,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed done.");
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
