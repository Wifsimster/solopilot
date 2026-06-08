/**
 * Workflow run persistence.
 *
 * Writes workflow executions to the `workflow_runs` table — the workflow-aware
 * generalization of the legacy `runs` table (ADR-0013). The engine stays pure;
 * the runner uses this store to open a run before execution and close it after.
 */
import { getDb, DEFAULT_PRODUCT_ID, type WorkflowRunRecord } from '../db.js';
import type { Trigger, WorkflowRun } from './types.js';

export function openWorkflowRun(
  workflowId: string,
  activityId: string,
  trigger: Trigger['kind'],
): number {
  const db = getDb();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO workflow_runs (workflow_id, product_id, trigger_type, status, started_at)
       VALUES (?, ?, ?, 'running', datetime('now'))`,
    )
    .run(workflowId, activityId, trigger);
  return Number(lastInsertRowid);
}

export function closeWorkflowRun(id: number, run: WorkflowRun): void {
  const db = getDb();
  db.prepare(
    `UPDATE workflow_runs
     SET status = ?, finished_at = ?, trace = ?, error_message = ?
     WHERE id = ?`,
  ).run(
    run.status,
    run.finishedAt ?? new Date().toISOString(),
    JSON.stringify(run.trace),
    run.error,
    id,
  );
}

export function getWorkflowRun(id: number): WorkflowRunRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as
    | WorkflowRunRecord
    | undefined;
}

export function listWorkflowRuns(
  limit = 20,
  offset = 0,
  filter?: { workflowId?: string; activityId?: string },
): WorkflowRunRecord[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.workflowId) {
    clauses.push('workflow_id = ?');
    params.push(filter.workflowId);
  }
  if (filter?.activityId) {
    clauses.push('product_id = ?');
    params.push(filter.activityId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit, offset);
  return db
    .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params) as WorkflowRunRecord[];
}

/** Startup recovery — mark interrupted workflow runs as errored (mirrors runs recovery). */
export function recoverStaleWorkflowRuns(): number {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE workflow_runs
       SET finished_at = datetime('now'), status = 'error', error_message = 'Processus interrompu de manière inattendue'
       WHERE status = 'running'`,
    )
    .run();
  return result.changes;
}

export { DEFAULT_PRODUCT_ID };
