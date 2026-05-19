// scripts/create-admin.ts
// 관리자 계정을 생성하는 스크립트입니다.

import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

async function main() {
  const loginId = process.env.ADMIN_BOOTSTRAP_LOGIN_ID || "admin";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || "1111";
  const role = (process.env.ADMIN_BOOTSTRAP_ROLE || "ADMIN") as any;

  const hash = await bcrypt.hash(password, 12);

  const exists = await prisma.adminUser.findUnique({ where: { loginId } });
  if (exists) {
    console.log("AdminUser already exists:", loginId);
    return;
  }

  await prisma.adminUser.create({
    data: {
      loginId,
      passwordHash: hash,
      role,
      isActive: true,
      displayName: "Bootstrap Admin",
    },
  });

  console.log("Created AdminUser:", loginId, "role:", role);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
