"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAbility } from "@/lib/auth";
import { runBackup } from "@/lib/backup";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

export async function backupNow() {
  const session = await requireAbility("manageBackups");
  const result = runBackup(`manual by ${session.name}`);

  db.insert(auditLog).values({
    userId: session.userId,
    action: "backup.run",
    entity: "database",
    entityId: "backup",
    detail: result.ok ? `ok, ${Math.round(result.bytes / 1024)}KB` : `FAILED: ${result.error}`,
  }).run();

  revalidatePath("/admin/backups");
  redirect(result.ok ? "/admin/backups?done=1" : `/admin/backups?failed=${encodeURIComponent(result.error)}`);
}
