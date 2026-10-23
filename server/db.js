import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { planSchema } from "./schema.js";
export function database(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','member')),joined INTEGER);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,member_id INTEGER REFERENCES members(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS plans(key TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS blocks(id INTEGER PRIMARY KEY,plan_key TEXT REFERENCES plans(key),start TEXT NOT NULL,end TEXT NOT NULL,weeks INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS logs(member_id INTEGER REFERENCES members(id),date TEXT NOT NULL,block_id INTEGER REFERENCES blocks(id),day_id TEXT NOT NULL,body TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(member_id,date));
 CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS challenges(email TEXT PRIMARY KEY,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
 `);
  // Existing accounts remain active when upgrading an older database.
  const memberColumns = db.prepare("PRAGMA table_info(members)").all();
  if (!memberColumns.some((column) => column.name === "removed_at")) {
    db.exec("ALTER TABLE members ADD COLUMN removed_at INTEGER");
  }
  if (!memberColumns.some((column) => column.name === "access_version")) {
    db.exec(
      "ALTER TABLE members ADD COLUMN access_version INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!memberColumns.some((column) => column.name === "theme")) {
    db.exec(
      "ALTER TABLE members ADD COLUMN theme TEXT NOT NULL DEFAULT 'ember-sky'",
    );
  }
  // A configuration mistake must never create a second administrator.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS single_owner ON members(role) WHERE role='owner'",
  );
  for (const file of [
    "foundation-v1.json",
    "foundation-v2.json",
    "foundation-v3.json",
  ]) {
    const plan = planSchema.parse(
      JSON.parse(
        readFileSync(new URL(`../plans/${file}`, import.meta.url), "utf8"),
      ),
    );
    db.prepare("INSERT OR IGNORE INTO plans VALUES (?,?)").run(
      `${plan.id}@${plan.version}`,
      JSON.stringify(plan),
    );
  }
  return db;
}
