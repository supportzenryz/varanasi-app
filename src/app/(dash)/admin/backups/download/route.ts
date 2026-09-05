import fs from "node:fs";
import path from "node:path";
import { requireAbility } from "@/lib/auth";
import { backupDir } from "@/lib/backup";
import { record } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hands one backup to the owner as a download — the only way, short of the
 * host's own tooling, to get a copy off the volume the database lives on.
 * That matters: the scheduled backups sit beside the database, so they
 * survive a bad deploy or a mistaken delete but not the loss of the disk.
 */
export async function GET(request: Request) {
  const session = await requireAbility("manageBackups");
  const name = new URL(request.url).searchParams.get("file") ?? "";

  // The name comes from a query string, so it is attacker-controlled: resolve
  // it and require the result to still be inside the backup directory, or
  // `?file=../../.env.local` would serve whatever the process can read.
  const dir = backupDir();
  const target = path.resolve(dir, name);
  if (!name || !/^varanasi-[\w-]+\.db$/.test(name) || path.dirname(target) !== path.resolve(dir)) {
    return new Response("Not found", { status: 404 });
  }
  if (!fs.existsSync(target)) return new Response("Not found", { status: 404 });

  /* Reported to the owner the moment it happens. This is the entire customer
     database — names, phones, dietary notes, voucher balances — leaving in a
     single file, so it is the one admin action where a delayed notice is no
     notice at all. */
  record(session, {
    action: "backup.download", entity: "database", entityId: name,
    detail: `downloaded ${name}`,
  });

  return new Response(fs.readFileSync(target) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
