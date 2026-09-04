import fs from "node:fs";
import path from "node:path";
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { createTableRelationsHelpers, extractTablesRelationalConfig } from "drizzle-orm/relations";
import { Sqlite } from "./sqlite";
import * as schema from "./schema";

/**
 * Drizzle's `drizzle-orm/better-sqlite3` entry point imports the native
 * better-sqlite3 package at the top of the file, so importing it would drag a
 * node-gyp build back into the project. Its *session* has no such import, so we
 * assemble the database the same way that entry point does — dialect, session,
 * db — over Node's built-in SQLite instead.
 */
/**
 * Hosts hand this over as a connection string, so it commonly arrives as
 * `file:/data/varanasi.db`. Node's SQLite takes a filesystem path, not a URL,
 * and would otherwise create a directory literally named `file:`.
 */
export function databasePath(raw = process.env.DATABASE_URL): string {
  const v = (raw ?? "").trim();
  if (!v) return "./data/varanasi.db";
  return v.startsWith("file:") ? v.slice("file:".length) || "./data/varanasi.db" : v;
}

type Db = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

function connect(): Db {
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const client = new Sqlite(file);
  const dialect = new SQLiteSyncDialect();

  const tablesConfig = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
  const relational = {
    fullSchema: schema,
    schema: tablesConfig.tables,
    tableNamesMap: tablesConfig.tableNamesMap,
  };

  const session = new BetterSQLiteSession(client as never, dialect, relational as never, {});

  return new BaseSQLiteDatabase("sync", dialect, session as never, relational as never) as Db;
}

let instance: Db | null = null;

/**
 * Opened on first query rather than on import.
 *
 * `next build` collects page data in ~31 worker processes, and importing this
 * module is enough to pull in the route tree — so an eager connection had all
 * of them opening the same file at once during a phase where most never run a
 * query at all. Deferring it means only the workers that genuinely read data
 * ever touch the file, and they arrive spread out rather than in one burst.
 *
 * The Proxy keeps the export a plain synchronous value, so the ~180 call sites
 * that do `db.select()...` are unchanged.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    instance ??= connect();
    const value = Reflect.get(instance as object, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, prop) {
    instance ??= connect();
    return Reflect.has(instance as object, prop);
  },
});

export { schema };
