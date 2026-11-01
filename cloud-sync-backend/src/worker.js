// The Worker is private: Pages Functions call it through a service binding.
// Never enable workers.dev or attach a public route without redesigning proxy trust.
// User-approved reduced-cost password hashing for the Free CPU budget.
// 10,000 is below the current OWASP recommendation; the independent Worker
// pepper is essential against a database-only leak and must never be in Git.
const PASSWORD_ITERATIONS = 10000;
const PASSWORD_SCHEME = 'pbkdf2-sha256-10000-hmac-v1';
const SESSION_DAYS = 30;
const MAX_DATA_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = MAX_DATA_BYTES + 4096;
const COOKIE = '__Host-learning-session';
const enc = new TextEncoder();
const FIELDS = {
  poetry: new Set('version stage selectedIds learnedIds recents quizStats wrongItems wrongBook sentenceReview review daily prefs'.split(' ')),
  english: new Set('version global topics tags errorTypes wrongBook sessions daily usedPool challengeUnlocked lastStudyAt createdAt goal agg custom'.split(' '))
};
const SECRET_FIELD = /^(?:.*(?:api[_-]?key|password|secret|credential|access[_-]?token|refresh[_-]?token|session[_-]?token|login[_-]?code|recovery[_-]?code|cookie)|EGL_AI_KEY_v1|EGL_AI_KEYS_v2|__proto__|constructor|prototype)$/i;

class ApiError extends Error {
  constructor(status, error, message, extra = {}) { super(message); Object.assign(this, { status, error, extra }); }
}
function fail(status, code, message, extra) { throw new ApiError(status, code, message, extra); }
function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
function random(bytes = 32) { return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), n => n.toString(16).padStart(2, '0')).join(''); }
function hex(value) { return Array.from(new Uint8Array(value), n => n.toString(16).padStart(2, '0')).join(''); }
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(value))); }
function fromHex(value) { return Uint8Array.from(value.match(/../g), part => parseInt(part, 16)); }
function password(value) {
  if (typeof value.password !== 'string' || value.password.length < 10 || value.password.length > 128) fail(400, 'password', '密码需为 10–128 个字符。');
  return value.password;
}
function requirePepper(env) {
  if (typeof env.PASSWORD_PEPPER !== 'string' || !/^[a-f0-9]{64}$/i.test(env.PASSWORD_PEPPER)) fail(503, 'auth_unavailable', '账号服务尚未配置，请继续使用本地学习。');
}
export async function passwordHash(value, salt, pepper) {
  const base = await crypto.subtle.importKey('raw', enc.encode(value), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations: PASSWORD_ITERATIONS }, base, 256);
  const key = await crypto.subtle.importKey('raw', fromHex(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, derived));
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
async function body(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, 'content_type', '需要 JSON 请求。');
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) fail(413, 'too_large', '同步数据超过大小限制，请保留本地备份。');
  if (!request.body) fail(400, 'invalid_json', '请求内容无效。');
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_REQUEST_BYTES) { await reader.cancel(); fail(413, 'too_large', '同步数据超过大小限制，请保留本地备份。'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  try { const parsed = JSON.parse(new TextDecoder().decode(bytes)); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw 0; return parsed; }
  catch { fail(400, 'invalid_json', '请求内容无效。'); }
}
function credentials(value) {
  if (typeof value.username !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(value.username)) fail(400, 'username', '用户名需为 3–32 位字母、数字、下划线或短横线。');
  return value.username.toLowerCase();
}
async function budget(db, name, limit, seconds) {
  const now = Date.now(), bucket = Math.floor(now / (seconds * 1000));
  const key = `${name}:${bucket}`;
  const row = await db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key, (bucket + 1) * seconds * 1000).first();
  if (row.count > limit) fail(429, 'rate_limited', '操作过于频繁，请稍后再试。');
}
function cookie(token, maxAge = SESSION_DAYS * 86400) { return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`; }
async function session(request, env) {
  const token = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await digest(token);
  const user = await env.DB.prepare('SELECT u.id,u.username FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND s.credential_version=u.credential_version').bind(tokenHash, Date.now()).first();
  return user ? { user, tokenHash } : null;
}
async function makeSession(env, user, credentialVersion = 1) {
  const token = random();
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,credential_version) VALUES(?,?,?,?)').bind(await digest(token), user.id, Date.now() + SESSION_DAYS * 86400000, credentialVersion).run();
  return cookie(token);
}
export function validateData(app, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'invalid_data', '学习数据格式错误。');
  if (Object.keys(data).some(key => !FIELDS[app].has(key))) fail(400, 'unknown_field', '同步内容包含未允许的字段。');
  if (!Number.isInteger(data.version)) fail(400, 'invalid_data', '学习数据缺少版本。');
  let count = 0;
  function walk(value, depth) {
    if (++count > 2000 || depth > 16) fail(400, 'invalid_data', '学习数据结构过于复杂。');
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) walk(value[i], depth + 1); }
    else if (value && typeof value === 'object') for (const key in value) { if (!Object.hasOwn(value, key)) continue; if (SECRET_FIELD.test(key)) fail(400, 'private_field', '同步内容包含私密认证字段。'); walk(value[key], depth + 1); }
  }
  walk(data, 0);
  const serialized = JSON.stringify(data);
  if (enc.encode(serialized).byteLength > MAX_DATA_BYTES) fail(413, 'too_large', '同步数据超过 64 KiB，请保留本地备份。');
  return serialized;
}
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname.replace(/^\/api/, '');
  const site = request.headers.get('x-learning-origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!site || !allowed.includes(site)) fail(403, 'origin', '站点未获授权。');
  const origin = request.headers.get('origin');
  if ((origin && origin !== site) || (!['GET','HEAD'].includes(request.method) && origin !== site)) fail(403, 'origin', '请求来源不匹配。');
  if (request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'origin', '不允许跨站请求。');
  if (path === '/auth/me' && request.method === 'GET') return json({ user: (await session(request, env))?.user || null });
  if (path === '/auth/logout' && request.method === 'POST') {
    const current = await session(request, env);
    if (current) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(current.tokenHash).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  if (['/auth/register','/auth/login','/auth/recover'].includes(path) && request.method === 'POST') {
    // Release gate: enable only after the complete password flow passes real Free CPU tests.
    if (env.AUTH_RELEASE_VERIFIED !== 'true') fail(503, 'auth_unavailable', '账号服务尚未上线，请继续使用本地学习与导出备份。');
    requirePepper(env);
    const ipHash = await digest(request.headers.get('cf-connecting-ip') || 'unknown');
    await budget(env.DB, `auth-ip:${ipHash}`, 30, 900);
    const value = await body(request), usernameKey = credentials(value);
    const plainPassword = password(value);
    await budget(env.DB, `auth-user:${usernameKey}`, 15, 900);
    if (path === '/auth/register') {
      await budget(env.DB, `register:${ipHash}`, 5, 3600);
      const salt = random(16), recoveryCode = random(24), id = crypto.randomUUID();
      const hashed = await passwordHash(plainPassword, salt, env.PASSWORD_PEPPER);
      const recoveryHash = await digest(recoveryCode);
      try {
        await env.DB.prepare('INSERT INTO users(id,username,username_key,login_code_hash,recovery_hash,created_at,password_salt,password_scheme) VALUES(?,?,?,?,?,?,?,?)').bind(id, value.username, usernameKey, hashed, recoveryHash, Date.now(), salt, PASSWORD_SCHEME).run();
      } catch (error) { if (String(error.message).includes('UNIQUE')) fail(409, 'username_taken', '该用户名不可用。'); throw error; }
      const user = { id, username: value.username };
      return json({ user, recoveryCode }, 201, { 'Set-Cookie': await makeSession(env, user) });
    }
    const stored = await env.DB.prepare('SELECT id,username,login_code_hash,recovery_hash,credential_version,password_salt,password_scheme FROM users WHERE username_key=?').bind(usernameKey).first();
    if (path === '/auth/login') {
      // Compatibility only for the earlier synthetic generated-code accounts.
      // New registrations never use the legacy scheme.
      const hashed = stored?.password_scheme === 'generated-v1'
        ? await digest(plainPassword)
        : await passwordHash(plainPassword, stored?.password_salt || '00000000000000000000000000000000', env.PASSWORD_PEPPER);
      if (!stored || !equal(hashed, stored.login_code_hash)) fail(401, 'credentials', '用户名或密码错误。');
      const user = { id: stored.id, username: stored.username };
      return json({ user }, 200, { 'Set-Cookie': await makeSession(env, user, stored.credential_version) });
    }
    if (typeof value.recoveryCode !== 'string' || !/^[a-f0-9]{48}$/.test(value.recoveryCode)) fail(401, 'credentials', '用户名或恢复码错误。');
    const oldRecoveryHash = await digest(value.recoveryCode);
    if (!stored || !equal(oldRecoveryHash, stored.recovery_hash)) fail(401, 'credentials', '用户名或恢复码错误。');
    const salt = random(16), recoveryCode = random(24), newHash = await passwordHash(plainPassword, salt, env.PASSWORD_PEPPER);
    // Compare and swap makes a recovery code single use even under concurrent requests.
    const result = await env.DB.prepare('UPDATE users SET login_code_hash=?,recovery_hash=?,password_salt=?,password_scheme=?,credential_version=credential_version+1 WHERE id=? AND recovery_hash=? RETURNING id,credential_version').bind(newHash, await digest(recoveryCode), salt, PASSWORD_SCHEME, stored.id, oldRecoveryHash).first();
    if (!result) fail(409, 'recovery_used', '恢复码已使用，请使用最新恢复码。');
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(stored.id).run();
    const user = { id: stored.id, username: stored.username };
    return json({ user, recoveryCode }, 200, { 'Set-Cookie': await makeSession(env, user, result.credential_version) });
  }
  const match = path.match(/^\/sync\/(poetry|english)$/);
  if (match && ['GET','PUT'].includes(request.method)) {
    const current = await session(request, env);
    if (!current) fail(401, 'unauthenticated', '请先登录。');
    if (request.headers.get('x-account-id') !== current.user.id) fail(409, 'account_changed', '账号已切换，请刷新后重新登录确认。');
    const app = match[1], id = current.user.id;
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT revision,data,updated_at FROM learning_data WHERE user_id=? AND app=?').bind(id, app).first();
      return json(row ? { revision: row.revision, data: JSON.parse(row.data), updatedAt: row.updated_at } : { revision: 0, data: null, updatedAt: null });
    }
    const value = await body(request);
    if (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0) fail(400, 'invalid_revision', '同步版本号无效。');
    const data = validateData(app, value.data), now = Date.now();
    const bucket = Math.floor(now / 60000), rateKey = `sync:${id}:${bucket}`;
    const counter = env.DB.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(rateKey, (bucket + 1) * 60000);
    // INSERT and UPDATE are atomic CAS statements: no stale read/write gap.
    const statement = value.baseRevision === 0
      ? env.DB.prepare('INSERT INTO learning_data(user_id,app,revision,data,updated_at) SELECT ?,?,1,?,? WHERE (SELECT count FROM rate_limits WHERE key=?)<=120 ON CONFLICT(user_id,app) DO NOTHING RETURNING revision,updated_at').bind(id, app, data, now, rateKey)
      : env.DB.prepare('UPDATE learning_data SET revision=revision+1,data=?,updated_at=? WHERE user_id=? AND app=? AND revision=? AND (SELECT count FROM rate_limits WHERE key=?)<=120 RETURNING revision,updated_at').bind(data, now, id, app, value.baseRevision, rateKey);
    // D1 batches are transactions: count and guarded CAS share one RPC and commit
    // atomically. Over-limit requests increment the counter but cannot mutate data.
    const [limited, updated] = await env.DB.batch([counter, statement]);
    const attempts = limited.results?.[0]?.count;
    if (!Number.isInteger(attempts)) fail(500, 'server_error', '同步暂时不可用，本地记录已保留。');
    if (attempts > 120) fail(429, 'rate_limited', '同步过于频繁，请稍后再试。');
    const saved = updated.results?.[0];
    if (!saved) {
      const row = await env.DB.prepare('SELECT revision,data,updated_at FROM learning_data WHERE user_id=? AND app=?').bind(id, app).first();
      fail(409, 'conflict', '另一台设备已更新，请先选择保留哪份记录。', row ? { revision: row.revision, data: JSON.parse(row.data), updatedAt: row.updated_at } : { revision: 0, data: null, updatedAt: null });
    }
    return json({ revision: saved.revision, updatedAt: saved.updated_at });
  }
  fail(404, 'not_found', '接口不存在。');
}
export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (error) { if (error instanceof ApiError) return json({ error: error.error, message: error.message, ...error.extra }, error.status); return json({ error: 'server_error', message: '云端暂时不可用，本地记录已保留。' }, 500); }
  },
  async scheduled(_controller, env) {
    const now = Date.now();
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now), env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now)]);
  }
};
