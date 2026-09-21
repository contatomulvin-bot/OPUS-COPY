import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword, normalizeEmail } from "../src/security.js";

const prisma = new PrismaClient();

async function main() {
  await prisma.creditAction.upsert({
    where: { code: "SHORT_AI" },
    create: {
      code: "SHORT_AI",
      label: "Short gerado por IA",
      unitCost: 100,
      enabled: true
    },
    update: {
      label: "Short gerado por IA"
    }
  });

  const email = process.env.MISTCUT_ADMIN_EMAIL?.trim();
  const password = process.env.MISTCUT_ADMIN_PASSWORD;

  if (email && password) {
    if (password.length < 12) {
      throw new Error("MISTCUT_ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.");
    }

    const normalized = normalizeEmail(email);
    const passwordHash = await hashPassword(password);

    await prisma.user.upsert({
      where: { email: normalized },
      create: {
        email: normalized,
        passwordHash,
        role: UserRole.SUPER_ADMIN,
        wallet: { create: {} }
      },
      update: {
        passwordHash,
        role: UserRole.SUPER_ADMIN,
        disabledAt: null
      }
    });

    console.log("Administrador MISTCUT criado/atualizado: " + normalized);
  } else {
    console.log("Admin não criado. Defina MISTCUT_ADMIN_EMAIL e MISTCUT_ADMIN_PASSWORD se necessário.");
  }
}

main()
  .finally(async () => prisma.$disconnect());
