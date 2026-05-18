/**
 * Bootstrap the first admin user.
 *
 * Run from the api workspace:
 *   tsx src/scripts/bootstrap-admin.ts --email me@example.com --password secret123 --name "Me"
 *
 * Or via npm script:
 *   npm run bootstrap-admin --workspace=@task-scheduler/api -- --email ... --password ... --name ...
 *
 * Env (the env loader applies):
 *   SCHEDULER_DATABASE_URL, BCRYPT_ROUNDS (optional, defaults to 10)
 */
import { parseArgs } from 'node:util';

import { loadEnv } from '../config/env.js';
import { disconnectPrisma, getPrisma } from '../db.js';
import { hashPassword } from '../utils/passwords.js';

interface Args {
  email: string;
  password: string;
  name: string;
  role: 'ADMIN' | 'VIEWER';
}

const parseCli = (): Args => {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: 'ADMIN' },
    },
  });
  const email = values.email?.trim().toLowerCase();
  const password = values.password;
  const name = values.name?.trim();
  const role = values.role === 'VIEWER' ? 'VIEWER' : 'ADMIN';
  if (!email || !password || !name) {
    console.error('Usage: bootstrap-admin --email <e> --password <p> --name <display-name> [--role ADMIN|VIEWER]');
    process.exit(2);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(2);
  }
  return { email, password, name, role };
};

const main = async (): Promise<void> => {
  const env = loadEnv();
  const args = parseCli();
  const prisma = getPrisma();
  try {
    const passwordHash = await hashPassword(args.password, env.BCRYPT_ROUNDS);
    const existing = await prisma.adminUser.findUnique({
      where: { email: args.email },
      select: { id: true },
    });
    if (existing) {
      await prisma.adminUser.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          displayName: args.name,
          role: args.role,
          enabled: true,
        },
        select: { id: true },
      });
      console.log(`Updated existing admin: ${args.email} (${existing.id})`);
    } else {
      const created = await prisma.adminUser.create({
        data: {
          email: args.email,
          passwordHash,
          displayName: args.name,
          role: args.role,
          enabled: true,
        },
        select: { id: true },
      });
      console.log(`Created admin: ${args.email} (${created.id})`);
    }
  } finally {
    await disconnectPrisma();
  }
};

main().catch((err) => {
  console.error('bootstrap-admin failed:', err);
  process.exit(1);
});
