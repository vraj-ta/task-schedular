-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "PlatformTargetType" AS ENUM ('NODE', 'DOTNET');

-- CreateEnum
CREATE TYPE "ScheduledJobType" AS ENUM ('BULK_IMPORT', 'BULK_UPDATE', 'BULK_DELETE', 'BULK_EXPORT', 'SCHEDULED_ACTION', 'SYSTEM_CLEANUP_TOKENS', 'SYSTEM_CLEANUP_AUDIT', 'SYSTEM_CLEANUP_UPLOADS', 'SYSTEM_CLEANUP_JOBS', 'WEBHOOK_DELIVERY', 'EMAIL_BLAST', 'REPORT_GENERATION', 'EXTERNAL_SYNC');

-- CreateEnum
CREATE TYPE "ScheduledJobStatus" AS ENUM ('PENDING', 'SCHEDULED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETRYING', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "TriggerSource" AS ENUM ('MANUAL', 'SCHEDULED', 'RECURRING', 'WEBHOOK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('INPUT', 'OUTPUT', 'ERROR_REPORT');

-- CreateEnum
CREATE TYPE "ArtifactStorage" AS ENUM ('LOCAL', 'S3');

-- CreateEnum
CREATE TYPE "OverlapPolicy" AS ENUM ('SKIP', 'QUEUE', 'CANCEL_PREV');

-- CreateTable
CREATE TABLE "PlatformConnection" (
    "id" TEXT NOT NULL,
    "projectSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "targetType" "PlatformTargetType" NOT NULL DEFAULT 'NODE',
    "jwtSecretCiphertext" BYTEA NOT NULL,
    "credentialsCiphertext" BYTEA,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "projectConnectionId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "bearerTokenHash" TEXT NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "projectConnectionId" TEXT NOT NULL,
    "type" "ScheduledJobType" NOT NULL,
    "entitySlug" TEXT,
    "payload" JSONB NOT NULL,
    "status" "ScheduledJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalUnits" INTEGER,
    "processedUnits" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "triggerSource" "TriggerSource" NOT NULL,
    "parentJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringSchedule" (
    "id" TEXT NOT NULL,
    "projectConnectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ScheduledJobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "overlapPolicy" "OverlapPolicy" NOT NULL DEFAULT 'SKIP',
    "lastRunAt" TIMESTAMP(3),
    "lastJobId" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobArtifact" (
    "id" TEXT NOT NULL,
    "projectConnectionId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "storage" "ArtifactStorage" NOT NULL DEFAULT 'LOCAL',
    "path" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformConnection_projectSlug_key" ON "PlatformConnection"("projectSlug");

-- CreateIndex
CREATE INDEX "PlatformConnection_enabled_idx" ON "PlatformConnection"("enabled");

-- CreateIndex
CREATE INDEX "Worker_projectConnectionId_lastSeenAt_idx" ON "Worker"("projectConnectionId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_projectConnectionId_workerId_key" ON "Worker"("projectConnectionId", "workerId");

-- CreateIndex
CREATE INDEX "ScheduledJob_projectConnectionId_status_priority_scheduledF_idx" ON "ScheduledJob"("projectConnectionId", "status", "priority", "scheduledFor", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledJob_projectConnectionId_status_scheduledFor_idx" ON "ScheduledJob"("projectConnectionId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ScheduledJob_type_status_idx" ON "ScheduledJob"("type", "status");

-- CreateIndex
CREATE INDEX "ScheduledJob_entitySlug_idx" ON "ScheduledJob"("entitySlug");

-- CreateIndex
CREATE INDEX "ScheduledJob_triggeredBy_idx" ON "ScheduledJob"("triggeredBy");

-- CreateIndex
CREATE INDEX "ScheduledJob_parentJobId_idx" ON "ScheduledJob"("parentJobId");

-- CreateIndex
CREATE INDEX "RecurringSchedule_enabled_nextRunAt_idx" ON "RecurringSchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringSchedule_projectConnectionId_name_key" ON "RecurringSchedule"("projectConnectionId", "name");

-- CreateIndex
CREATE INDEX "JobArtifact_projectConnectionId_jobId_idx" ON "JobArtifact"("projectConnectionId", "jobId");

-- CreateIndex
CREATE INDEX "JobArtifact_expiresAt_idx" ON "JobArtifact"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_enabled_idx" ON "AdminUser"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_refreshTokenHash_key" ON "AdminSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_adminUserId_revokedAt_idx" ON "AdminSession"("adminUserId", "revokedAt");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_projectConnectionId_fkey" FOREIGN KEY ("projectConnectionId") REFERENCES "PlatformConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledJob" ADD CONSTRAINT "ScheduledJob_projectConnectionId_fkey" FOREIGN KEY ("projectConnectionId") REFERENCES "PlatformConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledJob" ADD CONSTRAINT "ScheduledJob_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledJob" ADD CONSTRAINT "ScheduledJob_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "ScheduledJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_projectConnectionId_fkey" FOREIGN KEY ("projectConnectionId") REFERENCES "PlatformConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobArtifact" ADD CONSTRAINT "JobArtifact_projectConnectionId_fkey" FOREIGN KEY ("projectConnectionId") REFERENCES "PlatformConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobArtifact" ADD CONSTRAINT "JobArtifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
