import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Load environment variables before initializing Prisma
dotenv.config();

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./dev.db';
}

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma = globalThis.prismaGlobal ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

export const DEMO_USER_ID = 'demo-user-default-id-0001';

export async function getOrCreateDemoUser() {
  const existing = await prisma.user.findUnique({
    where: { id: DEMO_USER_ID },
  });
  if (existing) {
    return existing;
  }

  return prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: {
      id: DEMO_USER_ID,
    },
  });
}

