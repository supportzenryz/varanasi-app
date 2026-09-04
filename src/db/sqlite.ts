import { DatabaseSync, type StatementSync } from "node:sqlite";

/**
 * Node ships SQLite in core, so this project needs no native module and no
 * node-gyp build step — which matters on Windows, where better-sqlite3's
 * postinstall is exactly the thing npm's script policy blocks.
 *
 * Drizzle's SQLite driver only ever calls prepare / all / get / run and
 * raw().all / raw().get, so this thin shim is the whole compatibility surface.
 */
class Statement {
  constructor(private readonly stmt: StatementSync) {}

  private plain<T>(fn: () => T): T {
    this.stmt.setReturnArrays(false);
    return fn();
  }
  private arrays<T>(fn: () => T): T {
    this.stmt.setReturnArrays(true);
    try { return fn(); } finally { this.stmt.setReturnArrays(false); }
  }

  all(...params: unknown[]) { return this.plain(() => this.stmt.all(...(params as never[]))); }
  get(...params: unknown[]) { return this.plain(() => this.stmt.get(...(params as never[]))); }
  run(...params: unknown[]) {
    const r = this.plain(() => this.stmt.run(...(params as never[])));
    // drizzle reads lastInsertRowid as a number; node:sqlite hands back a bigint
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  raw() {
    return {
      all: (...params: unknown[]) => this.arrays(() => this.stmt.all(...(params as never[]))),
      get: (...params: unknown[]) => this.arrays(() => this.stmt.get(...(params as never[]))),
    };
  }
}

export class Sqlite {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    // Without this, a write that meets a concurrent write fails immediately
    // with SQLITE_BUSY rather than waiting its turn. Two guests booking in the
    // same second is exactly when we least want an error page.
    this.db.exec("PRAGMA busy_timeout = 3000");
    // Durable enough for a restaurant, and far faster than FULL under WAL.
    this.db.exec("PRAGMA synchronous = NORMAL");
  }
  prepare(sql: string) { return new Statement(this.db.prepare(sql)); }
  exec(sql: string) { this.db.exec(sql); }
  close() { this.db.close(); }
}
