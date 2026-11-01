import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { pbkdf2Sync, createHmac } from 'node:crypto';
import worker, { validateData, passwordHash } from '../src/worker.js';

let mf, db, cookieA, userA, recoveryA;
const passwordA = 'SyntheticPasswordA1';
const passwordB = 'SyntheticPasswordB2';
const resetPassword = 'SyntheticReplacement3';
const pepper = '42'.repeat(32);
const site = 'https://synthetic-study.example';
const invalidPassword = 'Synthetic invalid password';
async function call(path, { method = 'GET', data, cookie, account, headers = {} } = {}) {
  const response = await mf.dispatchFetch(`https://private-worker.example/api${path}`, {
    method,
    headers: { 'X-Learning-Origin': site, Origin: site, 'CF-Connecting-IP': '192.0.2.10',
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(account ? { 'X-Account-ID': account } : {}), ...headers },
    body: data ? JSON.stringify(data) : undefined
  });
  return { response, status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
before(async () => {
  mf = new Miniflare({ modules: true, scriptPath: new URL('../src/worker.js', import.meta.url).pathname,
    compatibilityDate: '2026-08-01', d1Databases: ['DB', 'LEGACY'], bindings: { ALLOWED_ORIGINS: site, AUTH_RELEASE_VERIFIED: 'true', PASSWORD_PEPPER: pepper } });
  db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
});
after(async () => { await mf.dispose(); });

test('register hashes chosen password with independent salt and secret pepper, returns only recovery', async () => {
  const result = await call('/auth/register', { method: 'POST', data: { username: 'Synthetic_A', password: passwordA } });
  assert.equal(result.status, 201);
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.match(result.body.recoveryCode, /^[a-f0-9]{48}$/);
  assert.equal(result.body.token, undefined);
  cookieA = result.cookie; userA = result.body.user; recoveryA = result.body.recoveryCode;
  assert.equal(result.body.loginCode, undefined); assert.equal(result.body.password, undefined);
  const row = await db.prepare('SELECT * FROM users WHERE id=?').bind(userA.id).first();
  assert.notEqual(row.login_code_hash, passwordA); assert.equal(row.login_code_hash.length, 64);
  assert.match(row.password_salt, /^[a-f0-9]{32}$/);
  assert.equal(row.password_scheme, 'pbkdf2-sha256-10000-hmac-v1');
  assert.equal(JSON.stringify(row).includes(passwordA), false);
  assert.equal(row.login_code_hash, createHmac('sha256', Buffer.from(pepper, 'hex')).update(pbkdf2Sync(passwordA, Buffer.from(row.password_salt, 'hex'), 10000, 32, 'sha256')).digest('hex'));
  assert.notEqual(row.recovery_hash, recoveryA);
  assert.equal((await call('/auth/me', { cookie: cookieA })).body.user.id, userA.id);
});
test('credential validation, username case folding and authentication', async () => {
  assert.equal((await call('/auth/register', { method: 'POST', data: { username: 'Synthetic_A', password: 'weak' } })).status, 400);
  assert.equal((await call('/auth/login', { method: 'POST', data: { username: 'synthetic_a', password: invalidPassword } })).status, 401);
  const login = await call('/auth/login', { method: 'POST', data: { username: 'synthetic_a', password: passwordA } });
  assert.equal(login.status, 200); assert.equal(login.body.user.id, userA.id);
  assert.equal((await call('/auth/register', { method: 'POST', data: { username: 'SYNTHETIC_A', password: passwordA } })).status, 409);
});
test('origin and unauthenticated requests denied', async () => {
  assert.equal((await call('/auth/me', { headers: { 'X-Learning-Origin': 'https://evil.example' } })).status, 403);
  assert.equal((await call('/auth/logout', { method: 'POST', cookie: cookieA, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('/sync/poetry', { account: userA.id })).status, 401);
  assert.equal((await call('/sync/poetry', { cookie: cookieA, account: 'another-user' })).body.error, 'account_changed');
});
test('CAS prevents stale overwrite, concurrent first write has one winner, apps separated', async () => {
  assert.deepEqual((await call('/sync/poetry', { cookie: cookieA, account: userA.id })).body, { revision: 0, data: null, updatedAt: null });
  const put = data => call('/sync/poetry', { method: 'PUT', cookie: cookieA, account: userA.id, data });
  const [a, b] = await Promise.all([put({ baseRevision: 0, data: { version: 1, selectedIds: ['synthetic-one'] } }), put({ baseRevision: 0, data: { version: 1, selectedIds: ['synthetic-two'] } })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const snapshot = (await call('/sync/poetry', { cookie: cookieA, account: userA.id })).body;
  assert.equal(snapshot.revision, 1);
  const stale = await put({ baseRevision: 0, data: { version: 1 } });
  assert.equal(stale.status, 409); assert.deepEqual(stale.body.data, snapshot.data);
  const update = await put({ baseRevision: 1, data: { version: 1, selectedIds: ['synthetic-three'] } });
  assert.equal(update.body.revision, 2);
  assert.equal((await call('/sync/english', { cookie: cookieA, account: userA.id })).body.revision, 0);
});
test('accounts isolated even when client supplies victim id', async () => {
  const b = await call('/auth/register', { method: 'POST', data: { username: 'Synthetic_B', password: passwordB } });
  assert.equal(b.status, 201);
  assert.equal((await call('/sync/poetry', { cookie: b.cookie, account: userA.id })).status, 409);
  assert.equal((await call('/sync/poetry', { cookie: b.cookie, account: b.body.user.id })).body.data, null);
});
test('explicit whitelist rejects API keys and unauthorized top-level data', async () => {
  const put = data => call('/sync/english', { method: 'PUT', cookie: cookieA, account: userA.id, data: { baseRevision: 0, data } });
  assert.equal((await put({ version: 3, EGL_AI_KEYS_v2: ['synthetic-never-upload'] })).status, 400);
  assert.equal((await put({ version: 3, custom: { apiKey: 'synthetic-never-upload' } })).status, 400);
  assert.equal((await put({ version: 3, global: { answered: 1, correct: 1 } })).status, 200);
  const data = (await call('/sync/english', { cookie: cookieA, account: userA.id })).body.data;
  assert.equal(JSON.stringify(data).includes('synthetic-never-upload'), false);
});
test('recovery revokes existing sessions and cannot reuse old code', async () => {
  // Model a concurrent legitimate login which already observed the next version.
  const currentRaw = 'c'.repeat(64);
  const currentHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(currentRaw))).toString('hex');
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,credential_version) VALUES(?,?,?,?)').bind(currentHash,userA.id,Date.now()+60000,2).run();
  const recovered = await call('/auth/recover', { method: 'POST', data: { username: 'Synthetic_A', recoveryCode: recoveryA, password: resetPassword } });
  assert.equal(recovered.status, 200); assert.notEqual(recovered.body.recoveryCode, recoveryA);
  assert.equal((await call('/auth/me', { cookie: `__Host-learning-session=${currentRaw}` })).body.user.id, userA.id);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=? AND credential_version<2').bind(userA.id).first()).n, 0);
  assert.equal(recovered.body.loginCode, undefined);
  const replacement = await call('/auth/login', { method: 'POST', data: { username: 'Synthetic_A', password: resetPassword } });
  assert.equal(replacement.status, 200);
  assert.equal((await call('/auth/login', { method: 'POST', data: { username: 'Synthetic_A', password: passwordA } })).status, 401);
  assert.equal((await call('/auth/me', { cookie: cookieA })).body.user, null);
  assert.equal((await call('/auth/recover', { method: 'POST', data: { username: 'Synthetic_A', recoveryCode: recoveryA, password: resetPassword } })).status, 401);
  cookieA = recovered.cookie;
  assert.equal((await call('/auth/me', { cookie: cookieA })).body.user.id, userA.id);
  // Simulate an old password authentication completing after recovery: version mismatch blocks it.
  const raw = 'a'.repeat(64);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('hex');
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,credential_version) VALUES(?,?,?,?)').bind(hash,userA.id,Date.now()+10000,1).run();
  assert.equal((await call('/auth/me', { cookie: `__Host-learning-session=${raw}` })).body.user, null);
});
test('logout revokes server session and clears cookie', async () => {
  const out = await call('/auth/logout', { method: 'POST', cookie: cookieA });
  assert.equal(out.status, 200); assert.match(out.response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('/auth/me', { cookie: cookieA })).body.user, null);
});
test('rate limiting uses shared database atomic counters', async () => {
  const ipHeaders = { 'CF-Connecting-IP': '192.0.2.200' };
  let last;
  for (let n = 0; n < 31; n++) last = await call('/auth/login', { method: 'POST', data: { username: `Missing_${n}`, password: invalidPassword }, headers: ipHeaders });
  assert.equal(last.status, 429);
});
test('default release gate blocks authentication before database or password work', async () => {
  for (const action of ['register','login','recover']) {
    const response = await worker.fetch(new Request(`https://private-worker.example/api/auth/${action}`, {
      method: 'POST', headers: { 'X-Learning-Origin': site, Origin: site }
    }), { ALLOWED_ORIGINS: site, AUTH_RELEASE_VERIFIED: 'false' });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'auth_unavailable');
  }
});
test('oversized and excessive-node snapshots are rejected without writes', () => {
  assert.throws(() => validateData('poetry', { version: 1, stage: 'x'.repeat(64 * 1024) }), e => e.status === 413);
  assert.throws(() => validateData('poetry', { version: 1, selectedIds: Array(2001).fill('x') }), e => e.status === 400);
});

test('missing pepper fails closed before database access', async () => {
  const response = await worker.fetch(new Request('https://private-worker.example/api/auth/login', {
    method: 'POST', headers: { 'X-Learning-Origin': site, Origin: site, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Synthetic_A', password: passwordA })
  }), { ALLOWED_ORIGINS: site, AUTH_RELEASE_VERIFIED: 'true', DB: { prepare() { throw new Error('must not access DB'); } } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'auth_unavailable');
});
test('standard PBKDF2 plus HMAC matches independent implementation and changes with salt and pepper', async () => {
  const salt = '01'.repeat(16), vectorPassword = ' Synthetic vector! 9 ';
  const hash = await passwordHash(vectorPassword, salt, pepper);
  const expected = createHmac('sha256', Buffer.from(pepper, 'hex')).update(pbkdf2Sync(vectorPassword, Buffer.from(salt, 'hex'), 10000, 32, 'sha256')).digest('hex');
  assert.equal(hash, expected);
  assert.notEqual(hash, await passwordHash(vectorPassword, '02'.repeat(16), pepper));
  assert.notEqual(hash, await passwordHash(vectorPassword, salt, '43'.repeat(32)));
});
test('additive password migration preserves legacy account and learning data', async () => {
  const legacy = await mf.getD1Database('LEGACY');
  const fresh = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  const old = fresh.replace(' password_salt TEXT,\n', '').replace(" password_scheme TEXT NOT NULL DEFAULT 'generated-v1',\n", '');
  await legacy.batch(old.split(';').filter(s => s.trim()).map(s => legacy.prepare(s)));
  await legacy.prepare('INSERT INTO users(id,username,username_key,login_code_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').bind('legacy-synthetic-id','LegacySynthetic','legacysynthetic','a'.repeat(64),'b'.repeat(64),1).run();
  await legacy.prepare('INSERT INTO learning_data(user_id,app,revision,data,updated_at) VALUES(?,?,?,?,?)').bind('legacy-synthetic-id','poetry',9,'{"version":1}',1).run();
  const migration = await readFile(new URL('../migrations/0001-passwords.sql', import.meta.url), 'utf8');
  await legacy.batch(migration.split(';').filter(s => s.trim()).map(s => legacy.prepare(s)));
  const row = await legacy.prepare('SELECT * FROM users WHERE id=?').bind('legacy-synthetic-id').first();
  assert.equal(row.password_scheme, 'generated-v1'); assert.equal(row.password_salt, null);
  assert.equal(row.login_code_hash, 'a'.repeat(64));
  assert.equal((await legacy.prepare('SELECT revision FROM learning_data WHERE user_id=?').bind(row.id).first()).revision, 9);
});
test('sync batch preserves durable rate limit and cannot write on 429', async () => {
  const registered = await call('/auth/register', { method: 'POST', data: { username: 'Synthetic_Limit', password: passwordB } });
  assert.equal(registered.status, 201);
  const id = registered.body.user.id;
  const buckets = [Math.floor(Date.now() / 60000), Math.floor(Date.now() / 60000) + 1];
  async function setCount(count) {
    for (const bucket of buckets) await db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count').bind(`sync:${id}:${bucket}`, count, (bucket + 1) * 60000).run();
  }
  function put(baseRevision, learned) { return call('/sync/poetry', { method: 'PUT', cookie: registered.cookie, account: id, data: { baseRevision, data: { version: 1, learnedIds: [learned] } } }); }
  await setCount(120);
  assert.equal((await put(0, 'blocked-insert')).status, 429);
  assert.equal((await call('/sync/poetry', { cookie: registered.cookie, account: id })).body.revision, 0);
  await setCount(119);
  assert.equal((await put(0, 'allowed-insert')).status, 200);
  assert.equal((await put(1, 'blocked-update')).status, 429);
  let current = (await call('/sync/poetry', { cookie: registered.cookie, account: id })).body;
  assert.equal(current.revision, 1); assert.deepEqual(current.data.learnedIds, ['allowed-insert']);
  await setCount(119);
  const results = await Promise.all([put(1, 'concurrent-a'), put(1, 'concurrent-b')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 429]);
  current = (await call('/sync/poetry', { cookie: registered.cookie, account: id })).body;
  assert.equal(current.revision, 2);
  assert.deepEqual(current.data.learnedIds, [results[0].status === 200 ? 'concurrent-a' : 'concurrent-b']);
});

test('batched username limit blocks login before issuing a session', async () => {
  const countBefore = (await db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').bind(userA.id).first()).n;
  const bucket = Math.floor(Date.now() / 900000);
  for (const b of [bucket, bucket + 1]) await db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count').bind(`auth-user:synthetic_a:${b}`,15,(b+1)*900000).run();
  const result = await call('/auth/login', { method: 'POST', data: { username: 'Synthetic_A', password: resetPassword } });
  assert.equal(result.status, 429); assert.equal(result.cookie, undefined);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').bind(userA.id).first()).n, countBefore);
});


test('new passwords allow six letters, digits or mixed characters and reject invalid choices', async () => {
  const headers = { 'CF-Connecting-IP': '198.51.100.60' };
  for (const password of ['abc12', 'abc12!', 'abc 12', 'abc12中', 'abcdef\n', 'a'.repeat(129)]) {
    for (const action of ['register', 'recover']) {
      const result = await call(`/auth/${action}`, { method: 'POST', headers, data: { username: 'SyntheticPolicyInvalid', password, recoveryCode: 'a'.repeat(48) } });
      assert.equal(result.status, 400); assert.equal(result.body.error, 'password');
    }
  }
  const registered = [];
  for (const [i, password] of ['abcdef', '123456', 'Ab12cD'].entries()) {
    const result = await call('/auth/register', { method: 'POST', headers, data: { username: `SyntheticPolicy${i}`, password } });
    assert.equal(result.status, 201); registered.push(result);
    assert.equal((await call('/auth/login', { method: 'POST', headers, data: { username: `SyntheticPolicy${i}`, password } })).status, 200);
  }
  const changed = await call('/auth/recover', { method: 'POST', headers, data: { username: 'SyntheticPolicy0', recoveryCode: registered[0].body.recoveryCode, password: '654321' } });
  assert.equal(changed.status, 200);
  assert.equal((await call('/auth/login', { method: 'POST', headers, data: { username: 'SyntheticPolicy0', password: 'abcdef' } })).status, 401);
  assert.equal((await call('/auth/login', { method: 'POST', headers, data: { username: 'SyntheticPolicy0', password: '654321' } })).status, 200);
});

test('existing passwords containing spaces and symbols still authenticate verbatim', async () => {
  const oldPassword = ' Legacy Password! 9 ', salt = '03'.repeat(16), id = 'legacy-password-synthetic';
  await db.prepare('INSERT INTO users(id,username,username_key,login_code_hash,recovery_hash,created_at,password_salt,password_scheme) VALUES(?,?,?,?,?,?,?,?)')
    .bind(id, 'SyntheticLegacyPassword', 'syntheticlegacypassword', await passwordHash(oldPassword, salt, pepper), 'b'.repeat(64), Date.now(), salt, 'pbkdf2-sha256-10000-hmac-v1').run();
  const headers = { 'CF-Connecting-IP': '198.51.100.70' };
  const login = password => call('/auth/login', { method: 'POST', headers, data: { username: 'SyntheticLegacyPassword', password } });
  const result = await login(oldPassword);
  assert.equal(result.status, 200); assert.equal(result.body.user.id, id);
  assert.equal((await login(oldPassword.trim())).status, 401);
  assert.equal((await login(oldPassword.toLowerCase())).status, 401);
});
