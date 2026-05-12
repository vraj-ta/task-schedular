import winston from 'winston';

const { combine, timestamp, errors, json } = winston.format;

// Surface Prisma-specific fields (code, meta, clientVersion) onto top-level
// log keys so operators can grep across logs from this service and the platform
// for the same `P\d{4}` codes. Mirrors the intent of the platform's
// app/backend/src/utils/logger.ts but emits JSON instead of pretty text — the
// control-plane runs in a container and Docker collects stdout.
const annotatePrismaErrors = winston.format((info) => {
  if (typeof info.code === 'string' && /^P\d{4}$/.test(info.code)) {
    info.prismaCode = info.code;
    if (typeof info.clientVersion === 'string') {
      info.prismaClientVersion = info.clientVersion;
    }
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  defaultMeta: { service: 'task-scheduler-control-plane' },
  format: combine(
    timestamp(),
    errors({ stack: true }),
    annotatePrismaErrors(),
    json(),
  ),
  transports: [new winston.transports.Console()],
});
