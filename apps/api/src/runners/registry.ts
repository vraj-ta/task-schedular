import type { ScheduledJobType } from '@task-scheduler/shared-types';

import {
  bulkDeleteStub,
  bulkExportStub,
  bulkImportStub,
  bulkUpdateStub,
} from './bulk-stubs.js';
import type { Runner } from './runner.interface.js';
import { scheduledActionRunner } from './scheduled-action.js';
import { systemCleanupJobsRunner } from './system-cleanup-jobs.js';
import {
  systemCleanupAuditRunner,
  systemCleanupTokensRunner,
  systemCleanupUploadsRunner,
} from './system-cleanup-project-db.js';

const all: Runner[] = [
  bulkImportStub,
  bulkUpdateStub,
  bulkDeleteStub,
  bulkExportStub,
  scheduledActionRunner,
  systemCleanupJobsRunner,
  systemCleanupTokensRunner,
  systemCleanupAuditRunner,
  systemCleanupUploadsRunner,
];

const byType: Map<ScheduledJobType, Runner> = new Map(all.map((r) => [r.type, r]));

export const runnerRegistry = {
  /** Resolve a runner for a job type, or undefined if no runner is registered. */
  get(type: ScheduledJobType): Runner | undefined {
    return byType.get(type);
  },
  /** Job types this control-plane build can execute (capability list). */
  supportedTypes(): ScheduledJobType[] {
    return Array.from(byType.keys());
  },
};
