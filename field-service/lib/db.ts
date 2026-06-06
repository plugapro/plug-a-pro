import { PrismaClient } from '@prisma/client'
import { serviceCategoryCanonicalizationExtension } from './prisma-service-category-normalization'

// Singleton pattern - prevents connection pool exhaustion in serverless
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  }).$extends(serviceCategoryCanonicalizationExtension) as unknown as PrismaClient
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
