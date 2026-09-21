import "dotenv/config";
import { PrismaClient } from "@prisma/client";

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

  console.log(
    "CreditAction SHORT_AI pronta. Contas e senhas são gerenciadas pelo Supabase Auth. " +
    "Para bootstrap de SUPER_ADMIN, configure MISTCUT_SUPER_ADMIN_EMAILS no backend."
  );
}

main()
  .finally(async () => prisma.$disconnect());
