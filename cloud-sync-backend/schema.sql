CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL,
 username_key TEXT NOT NULL UNIQUE,
 login_code_hash TEXT NOT NULL,
 password_salt TEXT,
 password_scheme TEXT NOT NULL DEFAULT 'generated-v1',
 recovery_hash TEXT NOT NULL,
 credential_version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 credential_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS learning_data (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 app TEXT NOT NULL CHECK(app IN ('poetry','english')),
 revision INTEGER NOT NULL,
 data TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, app)
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(expires_at);
