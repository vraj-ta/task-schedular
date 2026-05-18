import type { Router } from 'express';

import { createSchedulesRouter } from './schedules.js';

export const buildSchedulesRouter = (): Router => createSchedulesRouter();
