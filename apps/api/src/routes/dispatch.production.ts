import type { Router } from 'express';

import { createDispatchRouter } from './dispatch.js';

export const buildDispatchRouter = (): Router => createDispatchRouter();
