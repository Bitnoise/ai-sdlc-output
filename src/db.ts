import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString,
  // Most hosted Postgres providers (Render, Neon, Supabase, ...) require SSL.
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS session (
      sid    VARCHAR NOT NULL PRIMARY KEY,
      sess   JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
  `);
}

export interface User {
  id: number;
  email: string;
  password_hash: string;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const { rows } = await pool.query<User>(
    "SELECT id, email, password_hash FROM users WHERE email = $1",
    [email],
  );
  return rows[0];
}

export async function findUserById(id: number): Promise<User | undefined> {
  const { rows } = await pool.query<User>(
    "SELECT id, email, password_hash FROM users WHERE id = $1",
    [id],
  );
  return rows[0];
}

/** Returns the new user, or undefined if the email is already taken. */
export async function createUser(email: string, passwordHash: string): Promise<User | undefined> {
  const { rows } = await pool.query<User>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, password_hash`,
    [email, passwordHash],
  );
  return rows[0];
}
