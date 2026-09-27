// Tests delete all rows, so they use their own database, never DATABASE_URL.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://app:app@localhost:5432/app_test";
process.env.SESSION_SECRET = "test-secret";
