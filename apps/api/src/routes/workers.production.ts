import type { Router } from 'express';

import { createWorkersRouter } from './workers.js';

export const buildWorkersRouter = (): Router => createWorkersRouter();
