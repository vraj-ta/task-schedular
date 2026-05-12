import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

let client: PrismaClient | null = null;

const create = (): PrismaClient => {
  const connectionString = process.env.SCHEDULER_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'SCHEDULER_DATABASE_URL is required to initialize the control-plane database client',
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
};

export const getPrisma = (): PrismaClient => {
  if (!client) client = create();
  return client;
};

export const disconnectPrisma = async (): Promise<void> => {
  if (client) {
    await client.$disconnect();
    client = null;
  }
};
