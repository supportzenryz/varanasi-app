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

    // ORDER MATTERS. busy_timeout has to be the first statement on the
    // connection, because it is what every *later* statement relies on to wait
    // rather than fail. Setting it last — as this did — leaves the statements
    // above it running with SQLite's default timeout of zero, so under
    // contention they fail on contact. `next build` fans out to ~31 workers
    // that all open this database within the same few milliseconds, which is
    // exactly that contention, and it is why raising the timeout value had no
    // effect: the statement that was failing ran before the timeout was set.
    this.db.exec("PRAGMA busy_timeout = 15000");

    // journal_mode is a persistent property of the database *file*, not of the
    // connection: once the migration has set WAL, every later connection
    // inherits it and re-issuing this is a no-op. Switching modes needs a brief
    // exclusive lock though, so when many processes start together one of them
    // can still lose the race. Since the value is already correct in that case,
    // a failure here is not worth taking the process down for.
    try {
      this.db.exec("PRAGMA journal_mode = WAL");
    } catch {
      // Another process set it first, which is the outcome we wanted anyway.
    }

    this.db.exec("PRAGMA foreign_keys = ON");
    // Durable enough for a restaurant, and far faster than FULL under WAL.
    this.db.exec("PRAGMA synchronous = NORMAL");
  }
  prepare(sql: string) { return new Statement(this.db.prepare(sql)); }
  exec(sql: string) { this.db.exec(sql); }
  close() { this.db.close(); }
}
