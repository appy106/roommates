const { DatabaseSync } = require("node:sqlite");
const path = require("path");

// DATA_DIR lets a host with a persistent disk (e.g. Render) point the
// database somewhere that survives redeploys. Defaults to the project
// folder for local development.
const dataDir = process.env.DATA_DIR || __dirname;
const db = new DatabaseSync(path.join(dataDir, "data.sqlite"));

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    needs_password_setup INTEGER NOT NULL DEFAULT 0,
    last_household_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS household_members (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('admin','member')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(household_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    code TEXT UNIQUE NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS password_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('setup','reset')),
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS groceries (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    name TEXT NOT NULL,
    added_by TEXT REFERENCES users(id),
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chores (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    task TEXT NOT NULL,
    assignment_type TEXT NOT NULL CHECK (assignment_type IN ('manual','auto')),
    assigned_to TEXT REFERENCES users(id),
    frequency TEXT CHECK (frequency IN ('daily','weekly','monthly','once') OR frequency IS NULL),
    next_due TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    paid_by TEXT NOT NULL REFERENCES users(id),
    split_type TEXT NOT NULL CHECK (split_type IN ('equal','custom')),
    date TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bill_splits (
    id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL REFERENCES bills(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    share_amount REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    from_user TEXT NOT NULL REFERENCES users(id),
    to_user TEXT NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    date TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
