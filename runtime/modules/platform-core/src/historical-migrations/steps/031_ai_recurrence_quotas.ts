import { addColumnIfMissing, type Migration } from "../types.js";

/**
 * Durcissement collaborateurs IA :
 * - `tasks.next_run_at` : prochaine occurrence d'une tâche IA récurrente
 *   (`recurring_schedule` = `every 15m|2h|1d` ou `daily@HH:MM`), pilotée par
 *   le tick 1/min du runner ;
 * - `task_runs.usage_tokens` : tokens LLM consommés par run (quota journalier
 *   AI_MAX_TOKENS_PER_DAY (env marque)).
 */
const migration: Migration = {
  version: 31,
  name: "ai-recurrence-quotas",
  up(db) {
    addColumnIfMissing(db, "tasks", "next_run_at", "TEXT");
    addColumnIfMissing(db, "task_runs", "usage_tokens", "INTEGER NOT NULL DEFAULT 0");
    db.exec(`
CREATE INDEX IF NOT EXISTS idx_tasks_next_run
  ON tasks(next_run_at) WHERE next_run_at IS NOT NULL;
`);
  },
};

export default migration;
