"use server";
import { revalidatePath } from "next/cache";
import { requireAbility } from "@/lib/auth";
import { runBackup } from "@/lib/backup";
import { ok, problem } from "@/lib/admin-feedback";

import { record } from "@/lib/audit";

export async function backupNow() {
  const session = await requireAbility("manageBackups");
  const result = runBackup(`manual by ${session.name}`);

  record(session, {
    action: "backup.run",
    entity: "database",
    entityId: "backup",
    detail: result.ok ? `ok, ${Math.round(result.bytes / 1024)}KB` : `FAILED: ${result.error}`,
  });

  revalidatePath("/admin/backups");

  /* The same two words as everywhere else, and the detail carried in the
     message rather than hardcoded in the page. `?done=1` meant the screen had
     to write its own sentence, so the size — which the action had already
     measured and is the one thing that tells you the backup is not empty —
     never reached the person who pressed the button. */
  if (!result.ok) problem("/admin/backups", `The backup failed: ${result.error}`);
  ok("/admin/backups", `Backup taken and checked — ${Math.round(result.bytes / 1024)}KB, `
    + `it opens and every table is there.`);
}
