import { PrismaClient } from '@prisma/client';

const logQueries = process.env.PRISMA_LOG_QUERIES === 'true';

export const prisma = new PrismaClient({
  log: logQueries
    ? ['query', 'warn', 'error']
    : (process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']),
});
