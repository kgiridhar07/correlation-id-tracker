/**
 * @fileoverview Background service worker entry point.
 * Bootstraps all subsystems: network listener, storage batch timer,
 * cleanup scheduler, and message bus.
 */

import { startNetworkListener } from './networkListener.js';
import { startBatchTimer } from './storageManager.js';
import { startCleanupScheduler } from './cleanupManager.js';
import { initMessageBus } from './messageBus.js';
import { loadConfig } from '../utils/configManager.js';
import * as log from '../utils/logger.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────

bootstrap().catch((err) => {
  log.error('Background service worker failed to start', err);
});

async function bootstrap() {
  log.info('Background service worker starting...');

  await loadConfig();

  // 1. Initialise message bus (must be first so popup can communicate immediately)
  initMessageBus();

  // 2. Start network interception
  startNetworkListener();

  // 3. Start batched write timer
  startBatchTimer();

  // 4. Start retention cleanup scheduler
  startCleanupScheduler();

  log.info('Background service worker ready');
}
