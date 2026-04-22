import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: npx tsx prisma/set-password.ts <password>");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const business = await prisma.business.findFirst();
  if (!business) {
    console.error("No business found");
    process.exit(1);
  }

  await prisma.business.update({
    where: { id: business.id },
    data: { passwordHash: hash },
  });

  console.log(`✓ Password set for business: ${business.name}`);
}

main().finally(() => prisma.$disconnect());
