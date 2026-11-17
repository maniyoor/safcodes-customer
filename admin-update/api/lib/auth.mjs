import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ApiError, email, hash, identifier, insert, lock, one, requireValue, rows, string, transaction, update } from './core.mjs';

const cookieName = 'safcodes_admin_session';
const sessionAge = 8 * 60 * 60;
const resetResponse = 'If the account is eligible, a verification code was sent.';
const fakeHash = bcrypt.hashSync('dummy-password-for-nonexistent-account', 12);
export const passwordHash = value => {
  requireValue(typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 72,
    'Use a password of at least 12 characters and at most 72 bytes.');
  return bcrypt.hash(value, 12);
};
export const passwordOK = (value, digest) => bcrypt.compare(typeof value === 'string' && Buffer.byteLength(value) <= 72 ? value : '', digest || fakeHash);

export async function staffActor(db, userId) {
  const profile = await one(db, `SELECT u.id,u.email,u.display_name AS name,u.email_verified_at,u.must_change_password,
    p.phone,p.designation FROM users u LEFT JOIN staff_profiles p ON p.user_id=u.id
    WHERE u.id=$1 AND u.is_staff AND u.status='active'`, [userId]);
  if (!profile) return null;
  const roleRows = await rows(db, `SELECT DISTINCT r.code,p.permission_code
    FROM staff_roles m JOIN roles r ON r.code=m.role_code AND r.scope='staff'
    LEFT JOIN role_permissions p ON p.role_code=r.code WHERE m.user_id=$1`, [userId]);
  const permissions = [...new Set(roleRows.map(row => row.permission_code).filter(Boolean))];
  if (!permissions.includes('customers.read_all')) return null;
  return { ...profile, permissions, roles: [...new Set(roleRows.map(row => row.code))] };
}
export const accountView = actor => ({
  id: actor.id, name: actor.name, email: actor.email, phone: actor.phone, designation: actor.designation,
  roles: actor.roles, permissions: actor.permissions,
});
const cookie = (token, secure, age = sessionAge) =>
  cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (secure ? '; Secure' : '');
export const clearCookie = secure => cookie('', secure, 0);
function sessionToken(request) {
  const token = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  return /^[\da-f]{64}$/.test(token || '') ? token : null;
}
export async function sessionActor(db, request) {
  const token = sessionToken(request);
  requireValue(token, 'Sign in to continue.', 401);
  const session = await one(db, `SELECT id,user_id FROM auth_sessions
    WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()`, [hash(token)]);
  const actor = session && await staffActor(db, session.user_id);
  requireValue(actor && !actor.must_change_password, 'Sign in to continue.', 401);
  await db.query("SELECT set_config('app.user_id',$1,true)", [actor.id]);
  return { ...actor, sessionId: session.id };
}
export async function createSession(db, user) {
  const token = randomBytes(32).toString('hex');
  await db.query("INSERT INTO auth_sessions(user_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,now(),now()+interval '8 hours')", [user.id, hash(token)]);
  await db.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  return token;
}
const digest = (secret, challenge, code) => createHmac('sha256', secret).update(challenge + ':' + code).digest('hex');

export async function challenge(db, user, purpose, secret, { lifetimeSeconds = 300 } = {}) {
  const last = await one(db, `SELECT id FROM auth_challenges
    WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL AND resend_after>now() LIMIT 1`, [user.id, purpose]);
  requireValue(!last, 'Wait 30 seconds before requesting another code.', 429);
  await db.query('UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL', [user.id, purpose]);
  const id = randomUUID();
  const code = String(randomInt(100000, 1000000));
  await db.query(`INSERT INTO auth_challenges(id,user_id,purpose,secret_hash,expires_at,resend_after)
    VALUES($1,$2,$3,$4,now()+make_interval(secs => $5),now()+interval '30 seconds')`, [id, user.id, purpose, digest(secret, id, code), lifetimeSeconds]);
  return { id, code };
}
export async function consume(db, id, code, purpose, secret, eligible) {
  if (!/^[0-9]{6}$/.test(String(code))) return null;
  const record = await one(db, `SELECT ch.*,u.is_staff,u.status,u.email,u.must_change_password,
    ch.expires_at>now() AS fresh FROM auth_challenges ch JOIN users u ON u.id=ch.user_id
    WHERE ch.id=$1 AND ch.purpose=$2 FOR UPDATE OF ch`, [identifier(id, 'verification code request'), purpose]);
  if (!record || record.consumed_at || !record.fresh || record.attempts >= record.max_attempts || !eligible(record)) return null;
  if (!/^[0-9a-f]{64}$/.test(record.secret_hash) || !timingSafeEqual(Buffer.from(record.secret_hash, 'utf8'), Buffer.from(digest(secret, id, code), 'utf8'))) {
    await db.query('UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1', [id]);
    return null;
  }
  await db.query('UPDATE auth_challenges SET consumed_at=now() WHERE id=$1', [id]);
  return record;
}

export function createAuth({ pool, secret, secure, mailer }) {
  requireValue(typeof secret === 'string' && secret.length >= 32 && !secret.startsWith('replace_'), 'Set AUTH_SECRET to a random value of at least 32 characters.');
  const mailCode = async (user, otp, subject) => {
    try { await mailer.send({ to: user.email, subject, text: 'Your Safcodes verification code is ' + otp.code + '. It expires in five minutes.' }); }
    catch { throw new ApiError(503, 'Could not deliver the verification code. Check the mail configuration.'); }
  };
  return {
    async login(body) {
      const address = email(body.email);
      const result = await transaction(pool, null, async db => {
        const user = await one(db, 'SELECT * FROM users WHERE email=$1 AND is_staff FOR UPDATE', [address]);
        const good = await passwordOK(body.password, user?.password_hash);
        requireValue(good && user?.status === 'active' && await staffActor(db, user.id), 'Check your admin email and password.', 401);
        requireValue(!user.must_change_password, 'Use Forgot password to set a new password before signing in.', 403);
        if (user.email_otp_required) return { user, otp: await challenge(db, user, 'login_otp', secret) };
        return { token: await createSession(db, user) };
      });
      if (result.otp) {
        await mailCode(result.user, result.otp, 'Safcodes admin sign-in code');
        return { body: { challengeId: result.otp.id, needsCode: true } };
      }
      return { body: { signedIn: true }, cookie: cookie(result.token, secure) };
    },
    async verify(body) {
      const token = await transaction(pool, null, async db => {
        const row = await consume(db, body.challengeId, body.code, 'login_otp', secret, item => item.is_staff && item.status === 'active' && !item.must_change_password);
        if (!row || !await staffActor(db, row.user_id)) return null;
        await db.query('UPDATE users SET email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1', [row.user_id]);
        return createSession(db, { id: row.user_id });
      });
      requireValue(token, 'The code is incorrect, expired or already used.', 401);
      return { body: { signedIn: true }, cookie: cookie(token, secure) };
    },
    async resetRequest(body) {
      const address = email(body.email);
      const result = await transaction(pool, null, async db => {
        const user = await one(db, `SELECT * FROM users WHERE email=$1 AND is_staff AND status IN ('active','invited') FOR UPDATE`, [address]);
        if (!user) return null;
        try { return { user, otp: await challenge(db, user, 'password_reset', secret) }; }
        catch (error) { if (error.status === 429) return null; throw error; }
      });
      if (result) await mailCode(result.user, result.otp, 'Safcodes admin password reset');
      return { body: { message: resetResponse, challengeId: result?.otp.id || randomUUID() } };
    },
    async reset(body, client = false) {
      requireValue(body.password === body.confirmation, 'Passwords do not match.');
      const hashed = await passwordHash(body.password);
      const success = await transaction(pool, null, async db => {
        const row = await consume(db, body.challengeId, body.code, 'password_reset', secret,
          item => client ? !item.is_staff && item.status === 'invited' : item.is_staff && ['active', 'invited'].includes(item.status));
        if (!row) return false;
        if (client) {
          const approved = await one(db, 'SELECT activate_approved_memberships($1,$2) AS affected', [row.user_id,row.id]);
          if (!approved?.affected) return false;
        }
        await update(db, 'users', row.user_id, { password_hash: hashed, password_algorithm: 'bcrypt',
          status: 'active', must_change_password: false, email_verified_at: new Date() });
        await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [row.user_id]);
        await db.query('UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL', [row.user_id]);
        return true;
      });
      requireValue(success, 'The code is incorrect, expired or already used.', 401);
      return { body: { message: client ? 'Client access activated.' : 'Password updated. Sign in to continue.' } };
    },
    async profile(db, actor, body) {
      const name = string(body.name, 'name');
      await update(db, 'users', actor.id, { display_name: name });
      await db.query(`INSERT INTO staff_profiles(user_id,phone,designation) VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,designation=excluded.designation`,
      [actor.id, string(body.phone, 'phone', { optional: true }), string(body.designation, 'job title', { optional: true })]);
      return { body: accountView(await staffActor(db, actor.id)) };
    },
    async changePassword(db, actor, body) {
      requireValue(body.password === body.confirmation, 'Passwords do not match.');
      const user = await one(db, 'SELECT * FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
      requireValue(await passwordOK(body.currentPassword, user.password_hash), 'Check your current password.', 403);
      await update(db, 'users', actor.id, { password_hash: await passwordHash(body.password), password_algorithm: 'bcrypt' });
      await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL', [actor.id, actor.sessionId]);
      return { body: { message: 'Password updated.' } };
    },
    async logout(db, actor) {
      await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1', [actor.sessionId]);
      return { body: { signedOut: true }, cookie: clearCookie(secure) };
    },
  };
}
