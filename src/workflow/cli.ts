import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { getDb } from '../db.js';
import { registerSolopilot } from './bootstrap.js';
import { runWorkflowById } from './runner.js';
import { listWorkflows } from './registry.js';

const id = process.argv[2];

getDb();
registerSolopilot();

if (!id) {
  const ids = listWorkflows().map((w) => w.id);
  console.error('usage: node dist/workflow/cli.js <workflow-id>');
  console.error(`available: ${ids.join(', ')}`);
  process.exit(1);
}

const config = loadConfig();
runWorkflowById(id, { config, trigger: 'manual' })
  .then((run) => {
    logger.info('Workflow run complete', { id, status: run.status, trace: run.trace });
    process.exit(run.status === 'error' ? 1 : 0);
  })
  .catch((err) => {
    logger.error('Workflow run failed', { id, message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
