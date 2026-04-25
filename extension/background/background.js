/**
 * @fileoverview Background service worker entry point.
 * Bootstraps all subsystems: network listener, storage batch timer,
 * cleanup scheduler, and message bus.
 */

import { startNetworkListener } from './networkListener.js';
import { startBatchTimer } from './storageManager.js';
import { startCleanupScheduler } from './cleanupManager.js';
import { initMessageBus } from './messageBus.js';
import * as log from '../utils/logger.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────

log.info('Background service worker starting...');

// 1. Initialise message bus (must be first so popup can communicate immediately)
initMessageBus();

// 2. Start network interception
startNetworkListener();

// 3. Start batched write timer
startBatchTimer();

// 4. Start retention cleanup scheduler
startCleanupScheduler();

log.info('Background service worker ready');
