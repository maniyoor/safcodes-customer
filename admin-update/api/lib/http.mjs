import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, money, one, requireValue, transaction } from './core.mjs';
import { accountView, createAuth, sessionActor } from './auth.mjs';
import { availableActions, executeCommand } from './commands.mjs';
import { workspace } from './workspace.mjs';
import { createCustomerAuth, customerActor } from './customer-auth.mjs';
import { accountFor, customerCommand, customerEstimate, customerWorkspace } from './customer-workspace.mjs';

export function settings(env = process.env) {
  const port = Number(env.PORT || 5173);
  const url = new URL(env.PUBLIC_ORIGIN || 'http://127.0.0.1:' + port);
  if (!['https:','http:'].includes(url.protocol) || url.origin !== url.href.replace(/\/$/, '')) throw new Error('PUBLIC_ORIGIN must be an origin without a path.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid PORT.');
  const taxRate = money(env.TAX_RATE || '0');
  if (!taxRate.isFinite() || taxRate.lt(0) || taxRate.gt(1) || taxRate.decimalPlaces() > 6) throw new Error('TAX_RATE must be a decimal from 0 to 1.');
  const customer = env.CUSTOMER_ORIGIN && new URL(env.CUSTOMER_ORIGIN);
  if (customer && (!['http:','https:'].includes(customer.protocol) || customer.origin !== customer.href.replace(/\/$/, '')
    || customer.origin === url.origin)) throw new Error('CUSTOMER_ORIGIN must be a separate HTTP or HTTPS origin without a path.');
  const customerInviteMode = env.CLIENT_INVITE_MODE || 'setup_link';
  if (!['setup_link','temporary_password'].includes(customerInviteMode)) throw new Error('Set a valid CLIENT_INVITE_MODE.');
  if (customerInviteMode === 'temporary_password' && (!customer || (env.MAIL_MODE || 'preview') !== 'preview'
    || !['localhost','127.0.0.1','[::1]'].includes(customer.hostname) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)))
    throw new Error('Temporary customer passwords are limited to local origins and MAIL_MODE=preview.');
  const stripeKey = env.STRIPE_TEST_SECRET_KEY;
  const stripePortal = env.STRIPE_TEST_PORTAL_CONFIGURATION;
  if ((stripeKey || stripePortal) && (!customer || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(stripeKey || '')
    || !/^bpc_[A-Za-z0-9]+$/.test(stripePortal || ''))) throw new Error('Set a Stripe test key and test portal configuration together.');
  return { customerOrigin: customer?.origin, customerSecure: customer?.protocol === 'https:', customerInviteMode,
    stripe: stripeKey ? { key: stripeKey, portal: stripePortal } : null,
    port, origin: url.origin, host: url.host, secure: url.protocol === 'https:', secret: env.AUTH_SECRET,
    taxRate: taxRate.toFixed(6), paymentHosts: (env.PAYMENT_LINK_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean) };
}
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const apiDocs = new URL('../../docs/openapi.json', import.meta.url);
const bodyLimit = 256 * 1024;
function json(response, status, value, cookie) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...(cookie ? { 'Set-Cookie': cookie } : {}) });
  response.end(JSON.stringify(value));
}
async function readJson(request) {
  requireValue(request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() === 'application/json', 'Use application/json.', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    requireValue(size <= bodyLimit, 'Request is too large.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'Invalid JSON.'); }
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Provide a JSON object.');
  return value;
}
function errorResponse(error) {
  if (error instanceof ApiError) return [error.status, error.message];
  if (['23505','23P01'].includes(error.code)) return [409, 'This record already exists or conflicts with another record.'];
  if (['23503','23502','23514','22P02','22003'].includes(error.code)) return [400, 'The database rejected an invalid or incompatible record.'];
  if (['40001','40P01','55P03','57014'].includes(error.code)) return [409, 'The database was busy. Retry the same action.'];
  if (error.code === 'P0001') return [409, error.message];
  return [500, 'The server could not complete the request. Check the server and database connection.'];
}
async function staticFile(request, response, pathname) {
  if (!['GET','HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
  const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
  const location = relative(dist, file);
  const contentType = contentTypes[extname(file)];
  if (!contentType || location === '..' || location.startsWith('..' + sep)) return json(response, 404, { error: 'Not found.' });
  let info;
  try { info = await stat(file); } catch { return json(response, 404, { error: 'Not found. Build or extract the dist folder.' }); }
  if (!info.isFile()) return json(response, 404, { error: 'Not found.' });
  response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': info.size, 'Cache-Control': 'no-store' });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).on('error', () => response.destroy()).pipe(response);
}

export function createApp({ pool, config, mailer, logger = console, paymentFetch = fetch }) {
  const auth = createAuth({ pool, secret: config.secret, secure: config.secure, mailer });
  const customerAuth = createCustomerAuth({ pool, config, mailer });
  const clientPrefix = '/api/client/v1';
  const limits = new Map();
  function throttle(request, path) {
    const now = Date.now();
    for (const [key, value] of limits) if (value.reset <= now) limits.delete(key);
    const key = request.socket.remoteAddress + ':' + path;
    const entry = limits.get(key) || { reset: now + 60000, count: 0 };
    entry.count++;
    limits.set(key, entry);
    requireValue(entry.count <= (path.endsWith('/verify') ? 25 : 12), 'Too many requests. Try again in a minute.', 429);
  }
  const protectedRoute = (request, run, readSnapshot = false) =>
    transaction(pool, null, async db => run(db, await sessionActor(db, request)), readSnapshot);
  const authRoutes = {
    '/api/v1/auth/login': body => auth.login(body),
    '/api/v1/auth/verify': body => auth.verify(body),
    '/api/v1/auth/reset/request': body => auth.resetRequest(body),
    '/api/v1/auth/reset/confirm': body => auth.reset(body),
    '/api/v1/access/activate': body => auth.reset(body, true),
  };
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      requireValue(request.headers.host === config.host, 'Use the configured local admin address.', 400);
      const pathname = decodeURIComponent(new URL(request.url, config.origin).pathname);
      const method = request.method;
      if (!pathname.startsWith('/api/')) return await staticFile(request, response, pathname);
      if (pathname.startsWith(clientPrefix + '/')) {
        requireValue(config.customerOrigin, 'The customer portal has not been enabled on this API.', 404);
        const path = pathname.slice(clientPrefix.length);
        if (method === 'POST') {
          requireValue(request.headers['x-safcodes-api'] === '1' &&
            (!request.headers.origin || request.headers.origin === config.customerOrigin) && request.headers['sec-fetch-site'] !== 'cross-site',
          'Use the customer portal on its configured origin.', 403);
        }
        const publicActions = {
          '/auth/login': customerAuth.login,
          '/auth/verify': customerAuth.verify,
          '/auth/reset/request': customerAuth.resetRequest,
          '/auth/reset/confirm': body => customerAuth.setPassword(body, false),
          '/auth/activate': body => customerAuth.setPassword(body, true),
        };
        if (method === 'POST' && Object.hasOwn(publicActions, path)) {
          throttle(request, pathname);
          const result = await publicActions[path](await readJson(request));
          return json(response, 200, result.body, result.cookie);
        }
        if (method === 'GET' && path === '/session') {
          const result = await transaction(pool, null, async db => {
            const { id, display_name, email, accounts } = await customerActor(db, request);
            requireValue(accounts.length, 'No active customer access. Contact Safcodes.', 403);
            const { customer_avatar: avatar } = await one(db, 'SELECT customer_avatar FROM users WHERE id=$1', [id]);
            return { user: { display_name, email, avatar }, accounts };
          }, true);
          return json(response, 200, result);
        }
        if (method === 'POST' && ['/auth/logout','/profile'].includes(path)) {
          const body = await readJson(request);
          const result = await transaction(pool, null, async db => {
            const actor = await customerActor(db, request);
            if (path === '/auth/logout') return customerAuth.logout(db, actor);
            requireValue(actor.accounts.length, 'No active customer access. Contact Safcodes.', 403);
            return customerAuth.profile(db, actor, body);
          });
          return json(response, 200, result.body, result.cookie);
        }
        const match = /^\/accounts\/([^/]+)\/(workspace|estimate|commands|payment-portal)$/.exec(path);
        if (match && (match[2] === 'workspace' ? method === 'GET' : method === 'POST')) {
          const [, id, operation] = match;
          const body = method === 'POST' ? await readJson(request) : null;
          if (operation === 'payment-portal') {
            throttle(request, clientPrefix + '/payment-portal');
            const customer = await transaction(pool, null, async db => {
              const account = accountFor(await customerActor(db, request), id);
              requireValue(account.permissions.includes('account.manage') && account.permissions.includes('billing.view'),
                'Only the company account owner can manage payment methods.', 403);
              const row = config.stripe && await one(db, 'SELECT stripe_test_customer_id FROM customers WHERE id=$1', [account.id]);
              requireValue(row?.stripe_test_customer_id, 'Payment methods are not enabled for this account.', 409);
              return row.stripe_test_customer_id;
            }, true);
            return json(response, 200, await cardPortal(config, customer, paymentFetch));
          }
          const result = await transaction(pool, null, async db => {
            const actor = await customerActor(db, request);
            const account = accountFor(actor, id);
            if (operation === 'workspace') return customerWorkspace(db, account, config);
            if (operation === 'estimate') return customerEstimate(db, account, body, config);
            return customerCommand(db, actor, account, request.headers['idempotency-key'], body, config);
          }, operation !== 'commands');
          return json(response, 200, result);
        }
        return json(response, 404, { error: 'Customer API route not found.' });
      }
      if (method === 'POST') {
        requireValue(request.headers['x-safcodes-api'] === '1' &&
          (!request.headers.origin || request.headers.origin === config.origin) && request.headers['sec-fetch-site'] !== 'cross-site',
        'Use the admin application on the same origin.', 403);
      }
      if (method === 'GET' && pathname === '/api/v1/health') return json(response, 200, { ok: true, mode: 'live' });
      if (method === 'GET' && pathname === '/api/v1/openapi.json') {
        return json(response, 200, JSON.parse(await readFile(apiDocs, 'utf8')));
      }
      if (method === 'POST' && Object.hasOwn(authRoutes, pathname)) {
        throttle(request, pathname);
        const result = await authRoutes[pathname](await readJson(request));
        return json(response, 200, result.body, result.cookie);
      }
      if (method === 'GET' && pathname === '/api/v1/session') {
        const result = await protectedRoute(request, async (db, actor) => ({
          account: accountView(actor), actions: availableActions(actor), mailMode: mailer.mode,
        }));
        return json(response, 200, result);
      }
      if (method === 'GET' && pathname === '/api/v1/workspace') {
        return json(response, 200, await protectedRoute(request, workspace, true));
      }
      if (method === 'POST' && pathname === '/api/v1/commands') {
        const body = await readJson(request);
        const command = await protectedRoute(request, (db, actor) =>
          executeCommand(db, actor, request.headers['idempotency-key'], body, config));
        if (command.mail) {
          let delivered = false;
          try { await mailer.send(command.mail); delivered = true; } catch { /* Preserve the committed record and report delivery state. */ }
          if (command.mailRequestId) await transaction(pool, command.actorId, db => db.query(
            "UPDATE payment_requests SET status=$1,sent_at=CASE WHEN $1='sent' THEN now() END WHERE id=$2",
            [delivered ? 'sent' : 'failed', command.mailRequestId]));
          const delivery = delivered ? (mailer.mode === 'preview' ? 'Email preview saved.' : 'Email sent.') : 'Email delivery failed. Check mail settings and retry.';
          command.response.message += ' ' + delivery;
        }
        return json(response, 200, command.response);
      }
      const accountRoutes = { '/api/v1/profile': auth.profile, '/api/v1/auth/password': auth.changePassword, '/api/v1/auth/logout': auth.logout };
      if (method === 'POST' && Object.hasOwn(accountRoutes, pathname)) {
        const body = await readJson(request);
        const result = await protectedRoute(request, (db, actor) => accountRoutes[pathname](db, actor, body));
        return json(response, 200, result.body, result.cookie);
      }
      return json(response, 404, { error: 'API route not found.' });
    } catch (error) {
      if (response.destroyed || response.headersSent) return;
      const [status, message] = errorResponse(error);
      if (status >= 500) logger.error('Admin request failed', { status, code: error.code || error.name });
      json(response, status, { error: message });
    }
  });
}

async function cardPortal(config, customer, paymentFetch) {
  try {
    const response = await paymentFetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + config.stripe.key },
      body: new URLSearchParams({ customer, configuration: config.stripe.portal, return_url: config.customerOrigin + '/#/payment-methods' }),
      redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const result = await response.json();
      const url = new URL(result.url);
      if (result.customer === customer && result.livemode === false && url.origin === 'https://billing.stripe.com'
        && !url.username && !url.password && url.pathname.startsWith('/p/session')) return { url: url.href };
    }
  } catch { /* Keep provider credentials and diagnostics out of customer responses. */ }
  throw new ApiError(502, 'The card management page is unavailable. Try again or contact Safcodes.');
}
