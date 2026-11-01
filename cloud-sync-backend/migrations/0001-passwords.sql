-- Apply ONCE to the earlier generated-code schema, before deploying password auth.
-- Fresh databases use schema.sql directly and must not run this migration.
-- No table is dropped and no existing account or learning data is modified.
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_scheme TEXT NOT NULL DEFAULT 'generated-v1';
