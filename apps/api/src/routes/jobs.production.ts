import type { Router } from 'express';

import { createJobsRouter } from './jobs.js';

export const buildJobsRouter = (): Router => createJobsRouter();
