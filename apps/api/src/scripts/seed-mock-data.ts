/**
 * Seed mock data for local development.
 *
 *   npm run seed --workspace=@task-scheduler/api
 *
 * Creates three PlatformConnections (acme-crm, beta-store, gamma-ops), a few
 * Workers per platform, ScheduledJobs covering every status, two
 * RecurringSchedules per platform, and one INPUT + one OUTPUT artifact on the
 * SUCCEEDED job of each platform.
 *
 * Idempotent: re-runs upsert by projectSlug / (projectConnectionId, workerId) /
 * (projectConnectionId, name) and replace the job + artifact set so the dataset
 * stays in a known shape.
 *
 * Required env (same as the API):
 *   SCHEDULER_DATABASE_URL, SCHEDULER_SECRET_KEY
 */
import { loadEnv } from '../config/env.js';
import { disconnectPrisma, getPrisma } from '../db.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { encrypt, generateToken, hashToken, loadEncryptionKey } from '../utils/crypto.js';

interface PlatformSeed {
  projectSlug: string;
  name: string;
  baseUrl: string;
  targetType: 'NODE' | 'DOTNET';
  config: Record<string, unknown>;
  workers: { workerId: string; capabilities: string[] }[];
}

const PLATFORMS: PlatformSeed[] = [
  {
    projectSlug: 'acme-crm',
    name: 'Acme CRM (production)',
    baseUrl: 'https://acme-crm.example.com',
    targetType: 'NODE',
    config: {
      pollIntervalMs: 2000,
      retryPolicy: { maxAttempts: 5, backoffMs: [5_000, 30_000, 120_000] },
      systemJobs: { cleanupTokensCron: '0 3 * * *', cleanupAuditCron: '15 3 * * *' },
    },
    workers: [
      { workerId: 'acme-crm-worker-1', capabilities: ['BULK_IMPORT', 'BULK_EXPORT', 'SCHEDULED_ACTION'] },
      { workerId: 'acme-crm-worker-2', capabilities: ['BULK_IMPORT', 'BULK_UPDATE', 'EMAIL_BLAST'] },
    ],
  },
  {
    projectSlug: 'beta-store',
    name: 'Beta Storefront',
    baseUrl: 'https://beta-store.example.com',
    targetType: 'NODE',
    config: {
      pollIntervalMs: 5000,
      retryPolicy: { maxAttempts: 3, backoffMs: [2_000, 10_000, 60_000] },
      systemJobs: { cleanupUploadsCron: '0 4 * * *' },
    },
    workers: [
      { workerId: 'beta-store-worker-1', capabilities: ['WEBHOOK_DELIVERY', 'EXTERNAL_SYNC', 'REPORT_GENERATION'] },
    ],
  },
  {
    projectSlug: 'gamma-ops',
    name: 'Gamma Ops Internal Tools',
    baseUrl: 'https://gamma-ops.example.com',
    targetType: 'DOTNET',
    config: {
      pollIntervalMs: 3000,
      retryPolicy: { maxAttempts: 4, backoffMs: [3_000, 15_000, 90_000] },
      systemJobs: { cleanupJobsCron: '30 4 * * 0' },
    },
    workers: [
      { workerId: 'gamma-ops-worker-1', capabilities: ['BULK_IMPORT', 'BULK_DELETE'] },
      { workerId: 'gamma-ops-worker-2', capabilities: ['REPORT_GENERATION', 'EXTERNAL_SYNC'] },
      { workerId: 'gamma-ops-worker-3', capabilities: ['EMAIL_BLAST'] },
    ],
  },
];

const RECURRING: { projectSlug: string; name: string; type: string; cron: string; payload: Record<string, unknown> }[] = [
  { projectSlug: 'acme-crm', name: 'system:cleanupExpiredTokens', type: 'SYSTEM_CLEANUP_TOKENS', cron: '0 3 * * *', payload: { olderThanDays: 30 } },
  { projectSlug: 'acme-crm', name: 'action:nightly-customer-sync', type: 'SCHEDULED_ACTION', cron: '0 2 * * *', payload: { entitySlug: 'customer', mode: 'incremental' } },
  { projectSlug: 'beta-store', name: 'system:cleanupUploads', type: 'SYSTEM_CLEANUP_UPLOADS', cron: '0 4 * * *', payload: { olderThanDays: 7 } },
  { projectSlug: 'beta-store', name: 'action:hourly-inventory-export', type: 'REPORT_GENERATION', cron: '0 * * * *', payload: { reportSlug: 'inventory-snapshot' } },
  { projectSlug: 'gamma-ops', name: 'system:cleanupJobs', type: 'SYSTEM_CLEANUP_JOBS', cron: '30 4 * * 0', payload: { olderThanDays: 14 } },
  { projectSlug: 'gamma-ops', name: 'action:weekly-finance-report', type: 'REPORT_GENERATION', cron: '0 6 * * 1', payload: { reportSlug: 'finance-weekly' } },
];

const minutesAgo = (m: number): Date => new Date(Date.now() - m * 60_000);
const minutesAhead = (m: number): Date => new Date(Date.now() + m * 60_000);

const asBytes = (b: Buffer): Uint8Array<ArrayBuffer> => {
  const view = new Uint8Array(new ArrayBuffer(b.byteLength));
  view.set(b);
  return view;
};

interface SeededPlatform {
  id: string;
  projectSlug: string;
  workerIds: Record<string, string>;
}

const seedPlatform = async (
  prisma: PrismaClient,
  key: Buffer,
  spec: PlatformSeed,
): Promise<SeededPlatform> => {
  const jwtSecret = `seed-jwt-${spec.projectSlug}-${generateToken(8)}`;
  const platform = await prisma.platformConnection.upsert({
    where: { projectSlug: spec.projectSlug },
    create: {
      projectSlug: spec.projectSlug,
      name: spec.name,
      baseUrl: spec.baseUrl,
      targetType: spec.targetType,
      jwtSecretCiphertext: asBytes(encrypt(jwtSecret, key)),
      config: spec.config as never,
      enabled: true,
    },
    update: {
      name: spec.name,
      baseUrl: spec.baseUrl,
      targetType: spec.targetType,
      config: spec.config as never,
      enabled: true,
    },
    select: { id: true, projectSlug: true },
  });

  const workerIds: Record<string, string> = {};
  for (const w of spec.workers) {
    const bearer = `seed-bearer-${spec.projectSlug}-${w.workerId}`;
    const row = await prisma.worker.upsert({
      where: {
        projectConnectionId_workerId: {
          projectConnectionId: platform.id,
          workerId: w.workerId,
        },
      },
      create: {
        projectConnectionId: platform.id,
        workerId: w.workerId,
        bearerTokenHash: hashToken(bearer),
        capabilities: w.capabilities,
        enabled: true,
      },
      update: {
        capabilities: w.capabilities,
        lastSeenAt: new Date(),
        enabled: true,
      },
      select: { id: true, workerId: true },
    });
    workerIds[w.workerId] = row.id;
  }

  return { id: platform.id, projectSlug: platform.projectSlug, workerIds };
};

const seedJobs = async (
  prisma: PrismaClient,
  p: SeededPlatform,
): Promise<{ succeededJobId: string }> => {
  await prisma.scheduledJob.deleteMany({ where: { projectConnectionId: p.id } });

  const primaryWorkerId = Object.values(p.workerIds)[0];
  const tag = p.projectSlug;

  const succeeded = await prisma.scheduledJob.create({
    data: {
      projectConnectionId: p.id,
      type: 'BULK_EXPORT',
      entitySlug: 'customer',
      payload: { exportFormat: 'csv', filter: { status: 'active' } },
      status: 'SUCCEEDED',
      priority: 5,
      attempts: 1,
      maxAttempts: 3,
      scheduledFor: minutesAgo(120),
      startedAt: minutesAgo(118),
      completedAt: minutesAgo(110),
      progress: 100,
      totalUnits: 4_812,
      processedUnits: 4_812,
      successCount: 4_812,
      result: { rows: 4_812, sizeBytes: 1_482_900 },
      triggeredBy: 'user-42',
      triggerSource: 'MANUAL',
      lockedById: primaryWorkerId ?? null,
    },
    select: { id: true },
  });

  await prisma.scheduledJob.create({
    data: {
      projectConnectionId: p.id,
      type: 'BULK_IMPORT',
      entitySlug: 'customer',
      payload: { source: `s3://imports/${tag}/customers.csv`, mode: 'upsert' },
      status: 'RUNNING',
      priority: 10,
      attempts: 1,
      maxAttempts: 3,
      scheduledFor: minutesAgo(10),
      startedAt: minutesAgo(8),
      progress: 47,
      totalUnits: 10_000,
      processedUnits: 4_700,
      successCount: 4_650,
      errorCount: 50,
      triggeredBy: 'user-17',
      triggerSource: 'MANUAL',
      lockedById: primaryWorkerId ?? null,
      lockedUntil: minutesAhead(4),
    },
  });

  await prisma.scheduledJob.create({
    data: {
      projectConnectionId: p.id,
      type: 'SCHEDULED_ACTION',
      entitySlug: 'invoice',
      payload: { actionSlug: 'send-reminder', batch: 50 },
      status: 'PENDING',
      priority: 0,
      scheduledFor: minutesAhead(15),
      triggeredBy: 'cron',
      triggerSource: 'RECURRING',
    },
  });

  await prisma.scheduledJob.create({
    data: {
      projectConnectionId: p.id,
      type: 'REPORT_GENERATION',
      payload: { reportSlug: 'monthly-summary', period: '2026-04' },
      status: 'SCHEDULED',
      priority: 0,
      scheduledFor: minutesAhead(120),
      triggeredBy: 'user-08',
      triggerSource: 'MANUAL',
    },
  });

  await prisma.scheduledJob.create({
    data: {
      projectConnectionId: p.id,
      type: 'EMAIL_BLAST',
      payload: { templateSlug: 'spring-promo', segmentSlug: 'all-active' },
      status: 'FAILED',
      priority: 1,
      attempts: 3,
      maxAttempts: 3,
      scheduledFor: minutesAgo(240),
      startedAt: minutesAgo(238),
      failedAt: minutesAgo(232),
      progress: 12,
      totalUnits: 50_000,
      processedUnits: 6_000,
      successCount: 5_700,
      errorCount: 300,
      error: 'SMTP relay rejected batch after 3 retries (550 5.7.1)',
      triggeredBy: 'user-23',
      triggerSource: 'MANUAL',
    },
  });

  await prisma.scheduledJob.create({
    data: {
      projectConnectionId: p.id,
      type: 'BULK_UPDATE',
      entitySlug: 'product',
      payload: { filter: { category: 'archived' }, patch: { isVisible: false } },
      status: 'RETRYING',
      priority: 2,
      attempts: 2,
      maxAttempts: 5,
      scheduledFor: minutesAhead(1),
      startedAt: minutesAgo(35),
      error: 'transient DB deadlock, retry scheduled',
      triggeredBy: 'user-11',
      triggerSource: 'MANUAL',
    },
  });

  await prisma.scheduledJob.create({
    data: {
      projectConnectionId: p.id,
      type: 'BULK_DELETE',
      entitySlug: 'audit_log',
      payload: { olderThanDays: 365 },
      status: 'CANCELLED',
      priority: 0,
      attempts: 0,
      scheduledFor: minutesAgo(60),
      cancelledAt: minutesAgo(58),
      triggeredBy: 'user-01',
      triggerSource: 'MANUAL',
    },
  });

  await prisma.scheduledJob.create({
    data: {
      projectConnectionId: p.id,
      type: 'EXTERNAL_SYNC',
      payload: { provider: 'stripe', resource: 'invoices' },
      status: 'DEAD_LETTER',
      priority: 0,
      attempts: 5,
      maxAttempts: 5,
      scheduledFor: minutesAgo(720),
      startedAt: minutesAgo(718),
      failedAt: minutesAgo(700),
      error: 'upstream provider 503 — exceeded retry budget',
      triggeredBy: 'cron',
      triggerSource: 'RECURRING',
    },
  });

  await prisma.scheduledJob.create({
    data: {
      projectConnectionId: p.id,
      type: 'WEBHOOK_DELIVERY',
      payload: { url: 'https://hooks.example.com/inbound', event: 'order.created' },
      status: 'CLAIMED',
      priority: 8,
      attempts: 0,
      maxAttempts: 3,
      scheduledFor: minutesAgo(1),
      triggeredBy: 'system',
      triggerSource: 'WEBHOOK',
      lockedById: primaryWorkerId ?? null,
      lockedUntil: minutesAhead(5),
    },
  });

  return { succeededJobId: succeeded.id };
};

const seedRecurring = async (prisma: PrismaClient, platformsById: Map<string, string>): Promise<void> => {
  for (const r of RECURRING) {
    const platformId = platformsById.get(r.projectSlug);
    if (!platformId) continue;
    await prisma.recurringSchedule.upsert({
      where: { projectConnectionId_name: { projectConnectionId: platformId, name: r.name } },
      create: {
        projectConnectionId: platformId,
        name: r.name,
        type: r.type as never,
        payload: r.payload as never,
        cronExpression: r.cron,
        timezone: 'UTC',
        enabled: true,
        overlapPolicy: 'SKIP',
        nextRunAt: minutesAhead(60),
      },
      update: {
        payload: r.payload as never,
        cronExpression: r.cron,
        enabled: true,
        nextRunAt: minutesAhead(60),
      },
    });
  }
};

const seedArtifacts = async (
  prisma: PrismaClient,
  p: SeededPlatform,
  jobId: string,
): Promise<void> => {
  await prisma.jobArtifact.deleteMany({ where: { jobId } });
  await prisma.jobArtifact.createMany({
    data: [
      {
        projectConnectionId: p.id,
        jobId,
        kind: 'INPUT',
        filename: 'customers.csv',
        storage: 'LOCAL',
        path: `seed/${p.projectSlug}/${jobId}/customers.csv`,
        sizeBytes: 1_204_800,
        mimeType: 'text/csv',
      },
      {
        projectConnectionId: p.id,
        jobId,
        kind: 'OUTPUT',
        filename: 'export.zip',
        storage: 'LOCAL',
        path: `seed/${p.projectSlug}/${jobId}/export.zip`,
        sizeBytes: 1_482_900,
        mimeType: 'application/zip',
        checksumSha256: 'd2c1' + '0'.repeat(60),
      },
    ],
  });
};

const main = async (): Promise<void> => {
  loadEnv();
  const key = loadEncryptionKey();
  const prisma = getPrisma();

  try {
    const seeded: SeededPlatform[] = [];
    for (const spec of PLATFORMS) {
      const p = await seedPlatform(prisma, key, spec);
      seeded.push(p);
      console.log(`upserted platform ${p.projectSlug} (${p.id}) with ${Object.keys(p.workerIds).length} worker(s)`);
    }

    const platformsById = new Map(seeded.map((p) => [p.projectSlug, p.id]));
    await seedRecurring(prisma, platformsById);
    console.log(`upserted ${RECURRING.length} recurring schedules`);

    let jobs = 0;
    let artifacts = 0;
    for (const p of seeded) {
      const { succeededJobId } = await seedJobs(prisma, p);
      await seedArtifacts(prisma, p, succeededJobId);
      jobs += 9;
      artifacts += 2;
    }
    console.log(`inserted ${jobs} jobs across ${seeded.length} platforms (one of each status)`);
    console.log(`inserted ${artifacts} artifacts`);
    console.log('seed complete');
  } finally {
    await disconnectPrisma();
  }
};

main().catch((err) => {
  console.error('seed-mock-data failed:', err);
  process.exit(1);
});
