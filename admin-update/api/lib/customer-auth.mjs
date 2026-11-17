import { randomUUID } from 'node:crypto';
import { challenge, consume, createSession, passwordHash, passwordOK } from './auth.mjs';
import { ApiError, email, hash, identifier, one, requireValue, rows, string, transaction, update } from './core.mjs';

const cookieName = 'safcodes_customer_session';
const cookiePath = '/api/client/v1';
const sessionSeconds = 8 * 60 * 60;
const resetMessage = 'If the email has an active customer account, a verification code was sent.';
const cookie = (token, secure, age = sessionSeconds) =>
  `${cookieName}=${token}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;

function avatar(value) {
  if (value === null) return null;
  const prefix = 'data:image/jpeg;base64,';
  requireValue(typeof value === 'string' && value.startsWith(prefix) && value.length <= 96000, 'Choose a valid profile photo.');
  const encoded = value.slice(prefix.length);
  const bytes = Buffer.from(encoded, 'base64');
  requireValue(bytes.length > 4 && bytes.toString('base64') === encoded &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
    bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9, 'Choose a valid profile photo.');
  return value;
}

async function eligible(db, id, invited = false) {
  return (await one(db, 'SELECT customer_sign_in_allowed($1,$2) AS allowed', [id, invited])).allowed;
}

async function accounts(db, userId) {
  return rows(db, `SELECT c.id,c.customer_no,c.display_name,c.legal_name,c.billing_email,c.phone,m.role_code,
    ARRAY(SELECT permission_code FROM role_permissions WHERE role_code=m.role_code ORDER BY permission_code) AS permissions
    FROM customer_members m JOIN customers c ON c.id=m.customer_id JOIN roles r ON r.code=m.role_code
    WHERE m.user_id=$1 AND m.status='active' AND r.scope='customer' AND c.status='active' AND c.currency='AED'
    ORDER BY lower(c.display_name),c.id`, [userId]);
}

export async function customerActor(db, request) {
  const token = (request.headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  requireValue(/^[a-f0-9]{64}$/.test(token || ''), 'Sign in to continue.', 401);
  const user = await one(db, `SELECT u.id,u.display_name,u.email,s.id AS session_id
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT u.is_staff
      AND u.status='active' AND u.email_verified_at IS NOT NULL AND NOT u.must_change_password`, [hash(token)]);
  requireValue(user, 'Sign in to continue.', 401);
  await db.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
  return { ...user, accounts: await accounts(db, user.id) };
}

export function createCustomerAuth({ pool, config, mailer }) {
  const { secret, customerSecure: secure } = config;
  async function send(user, otp, subject) {
    try {
      await mailer.send({ to: user.email, subject, text: `Your Safcodes verification code is ${otp.code}. It expires in five minutes.` });
    } catch {
      await transaction(pool, null, db => db.query(
        'UPDATE auth_challenges SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL', [otp.id]));
      throw new ApiError(503, 'The verification email could not be delivered. Try again shortly.');
    }
  }
  const lockChallengeUser = (db, id) => db.query(`SELECT u.id FROM users u JOIN auth_challenges c ON c.user_id=u.id
    WHERE c.id=$1 AND NOT u.is_staff FOR UPDATE OF u`, [identifier(id, 'verification code request')]);
  const resultFor = token => ({ body: { signedIn: true }, cookie: cookie(token, secure) });

  return {
    async login(body) {
      const address = email(body.email);
      const result = await transaction(pool, null, async db => {
        const user = await one(db, `SELECT *,customer_temp_password_expires_at>now() AS temporary_valid
          FROM users WHERE email=$1 AND NOT is_staff FOR UPDATE`, [address]);
        const valid = await passwordOK(body.password, user?.password_hash);
        const temporary = user?.status === 'invited' && user.must_change_password && user.temporary_valid;
        const regular = user?.status === 'active' && !user.must_change_password;
        requireValue(valid && (temporary || regular) && await eligible(db, user.id, temporary), 'Check your registered email and password.', 401);
        return { user, temporary, otp: await challenge(db, user, temporary ? 'password_reset' : 'login_otp', secret) };
      });
      await send(result.user, result.otp, result.temporary ? 'Safcodes first sign-in code' : 'Safcodes customer sign-in code');
      return { body: { challengeId: result.otp.id, next: result.temporary ? 'activate' : 'verify' } };
    },
    async verify(body) {
      const token = await transaction(pool, null, async db => {
        await lockChallengeUser(db, body.challengeId);
        const row = await consume(db, body.challengeId, body.code, 'login_otp', secret,
          item => !item.is_staff && item.status === 'active' && !item.must_change_password);
        return row && await eligible(db, row.user_id) ? createSession(db, { id: row.user_id }) : null;
      });
      requireValue(token, 'The code is incorrect, expired or already used.', 401);
      return resultFor(token);
    },
    async resetRequest(body) {
      const address = email(body.email);
      const result = await transaction(pool, null, async db => {
        const user = await one(db, "SELECT id,email FROM users WHERE email=$1 AND NOT is_staff AND status='active' FOR UPDATE", [address]);
        if (!user || !await eligible(db, user.id)) return null;
        try { return { user, otp: await challenge(db, user, 'password_reset', secret) }; }
        catch (error) { if (error.status !== 429) throw error; return null; }
      });
      if (result) {
        try { await send(result.user, result.otp, 'Safcodes customer password reset'); }
        catch (error) { if (error.status !== 503) throw error; }
      }
      return { body: { challengeId: result?.otp.id || randomUUID(), message: resetMessage } };
    },
    async setPassword(body, activation) {
      requireValue(body.password === body.confirmation, 'Passwords do not match.');
      const hashed = await passwordHash(body.password);
      const success = await transaction(pool, null, async db => {
        await lockChallengeUser(db, body.challengeId);
        const row = await consume(db, body.challengeId, body.code, 'password_reset', secret,
          item => !item.is_staff && item.status === (activation ? 'invited' : 'active'));
        if (!row || !await eligible(db, row.user_id, activation)) return false;
        if (activation) {
          const approved = await one(db, 'SELECT activate_approved_memberships($1,$2) AS affected', [row.user_id, row.id]);
          if (!approved.affected) return false;
        }
        await update(db, 'users', row.user_id, { password_hash: hashed, password_algorithm: 'bcrypt',
          status: 'active', must_change_password: false, customer_temp_password_expires_at: null,
          email_verified_at: new Date() });
        await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [row.user_id]);
        await db.query('UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL', [row.user_id]);
        return true;
      });
      requireValue(success, 'The code is incorrect, expired or already used.', 401);
      return { body: { message: activation ? 'Access is ready. Sign in with your new password.' : 'Password updated. Sign in to continue.' } };
    },
    async profile(db, actor, body) {
      const name = string(body.display_name, 'name', { max: 120 });
      const fields = { display_name: name };
      if (Object.hasOwn(body,'avatar')) fields.customer_avatar = avatar(body.avatar);
      const saved = await update(db, 'users', actor.id, fields);
      return { body: { display_name: name, avatar: saved.customer_avatar } };
    },
    async logout(db, actor) {
      await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1', [actor.session_id]);
      return { body: { signedOut: true }, cookie: cookie('', secure, 0) };
    },
  };
}
