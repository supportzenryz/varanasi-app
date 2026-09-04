/**
 * Runs once when a server instance boots, before it takes requests.
 *
 * The runtime guard matters: this file is also evaluated for the edge runtime,
 * where node:fs and node:sqlite do not exist, and importing the backup module
 * there would fail the build rather than degrade quietly.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackupSchedule } = await import("@/lib/backup");
  startBackupSchedule();
}
