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
const file = process.env.DATABASE_URL ?? "./data/varanasi.db";
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

export const db = new BaseSQLiteDatabase(
  "sync",
  dialect,
  session as never,
  relational as never,
) as BaseSQLiteDatabase<"sync", unknown, typeof schema>;

export { schema };
