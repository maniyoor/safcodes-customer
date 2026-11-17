import { addMonths } from '../../shared/workflows.mjs';
import { marketingTypes, productTypes, projectTypes } from '../../shared/catalog-data.mjs';
import { randomBytes } from 'node:crypto';
import { challenge, passwordHash } from './auth.mjs';
import {
  audit, clientRecord, day, domain, email, enumeration, flag, httpsLink, identifier, insert,
  integer, lock, money, numeric, one, reference, requireValue, requiredRow, rows, string, update,
} from './core.mjs';

const optional = { optional: true };
const note = { optional: true, max: 2000 };
const serviceStatuses = ['active', 'provisioning', 'suspended', 'expired', 'cancelled'];

export async function serviceRecord(db, id, lockRow = false) {
  return requiredRow(db, `SELECT s.*,i.category FROM services s JOIN catalog_items i ON i.id=s.catalog_item_id
    JOIN customers c ON c.id=s.customer_id WHERE s.id=$1 AND s.currency='AED' AND c.currency='AED'`
    + (lockRow ? ' FOR UPDATE OF s' : ''), [identifier(id, 'service')], 'Service');
}
export const catalogItem = (db, id) => requiredRow(db, 'SELECT * FROM catalog_items WHERE id=$1', [identifier(id, 'category')], 'Category');
export const planRecord = (db, id) => requiredRow(db, `SELECT p.*,price.unit_amount,price.tax_inclusive FROM catalog_plans p
  LEFT JOIN LATERAL (SELECT * FROM catalog_prices WHERE plan_id=p.id AND currency='AED' AND term_months=12
    AND valid_from<=current_date AND (valid_until IS NULL OR valid_until>current_date) ORDER BY valid_from DESC LIMIT 1) price ON true
  WHERE p.id=$1`, [identifier(id, 'plan')], 'Plan');
const providerRecord = (db, id, kind) => requiredRow(db, 'SELECT * FROM providers WHERE id=$1 AND kind=$2',
  [identifier(id, 'provider'), kind], 'Provider');

async function saveAddress(db, clientId, body) {
  const location = string(body.office_location, 'office location', optional);
  if (!location) return;
  const country = string(body.country, 'country', optional);
  let countryCode = null;
  if (country) {
    const matched = await one(db, 'SELECT code FROM countries WHERE lower(name)=lower($1) OR code=upper($1)', [country]);
    requireValue(matched, 'Use an existing country from the PostgreSQL country catalogue.');
    countryCode = matched.code;
  }
  const address = await one(db, "SELECT id FROM customer_addresses WHERE customer_id=$1 AND kind='office' AND is_default", [clientId]);
  const fields = { line1: location, country_code: countryCode, region_id: null, city_id: null,
    region_text: string(body.region, 'region', optional), city_text: string(body.city, 'city', optional) };
  if (address) await update(db, 'customer_addresses', address.id, fields);
  else await insert(db, 'customer_addresses', { ...fields, customer_id: clientId, kind: 'office', is_default: true });
}
export async function customer(db, actor, body) {
  const existing = body.id ? await clientRecord(db, body.id, true) : null;
  const contact = string(body.contact_name, 'client name');
  const registered = email(body.portal_email || body.billing_email);
  const billing = email(body.billing_email);
  const company = string(body.company_name, 'company', optional);
  const mobile = string(body.phone, 'mobile number', optional);
  const prefix = string(body.dial_code, 'dial code', optional) || '+971';
  requireValue(!mobile || (/^\+?[0-9 ()-]{6,24}$/.test(mobile) && /^\+\d{1,4}$/.test(prefix)), 'Enter a valid mobile number and dial code.');
  const status = enumeration(body.status === 'inactive' ? 'on_hold' : body.status, ['active', 'on_hold', 'closed'], 'client status');
  const fields = {
    primary_contact_name: contact, portal_email: registered, billing_email: billing, display_name: company || contact,
    legal_name: string(body.legal_name, 'billing name', optional) || company || contact,
    phone: mobile && (mobile.startsWith('+') ? mobile : prefix + ' ' + mobile),
    industry: string(body.industry, 'industry', optional), status,
  };
  const result = existing ? await update(db, 'customers', existing.id, fields)
    : await insert(db, 'customers', { ...fields, customer_no: reference('CUS'), currency: 'AED', account_manager_id: actor.id });
  await saveAddress(db, result.id, body);
  return { record: result, message: existing ? 'Client updated.' : 'Client saved.', entity: 'customer', customerId: result.id };
}

export async function clientAccess(db, actor, body, config) {
  const client = await clientRecord(db, body.id, true);
  requireValue(client.status === 'active', 'Activate the client record first.');
  const address = email(client.portal_email || client.billing_email);
  await lock(db, 'user-email:' + address);
  let user = await one(db, 'SELECT * FROM users WHERE email=$1 FOR UPDATE', [address]);
  requireValue(!user?.is_staff && (!user || ['active', 'invited'].includes(user.status)), 'This email cannot be used for client access.');
  if (!user) user = await insert(db, 'users', {
    email: address, display_name: client.primary_contact_name || client.display_name, status: 'invited', is_staff: false,
  });
  const member = await one(db, 'SELECT * FROM customer_members WHERE customer_id=$1 AND user_id=$2', [client.id, user.id]);
  const active = user.status === 'active' && user.password_hash && user.email_verified_at && !user.must_change_password;
  requireValue(!active || member?.status !== 'active', 'This client contact already has access.', 409);
  if (!active && user.status === 'active' && !user.password_hash) {
    user = await update(db, 'users', user.id, { status: 'invited' });
    await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [user.id]);
  }
  if (!active) requireValue(user.status === 'invited', 'Resolve the existing account status before approving access.');
  let temporaryPassword;
  let otp;
  if (!active) {
    if (config.customerInviteMode === 'temporary_password') {
      temporaryPassword = 'Sc-' + randomBytes(18).toString('base64url');
      await db.query(`UPDATE users SET password_hash=$2,password_algorithm='bcrypt',must_change_password=true,
        customer_temp_password_expires_at=now()+interval '24 hours' WHERE id=$1`, [user.id, await passwordHash(temporaryPassword)]);
      await db.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose='password_reset' AND consumed_at IS NULL", [user.id]);
    } else {
      otp = await challenge(db, user, 'password_reset', config.secret, { lifetimeSeconds: config.customerOrigin ? 86400 : 300 });
      if (config.customerOrigin) await update(db, 'users', user.id, { password_hash: null,
        password_algorithm: null, must_change_password: false, customer_temp_password_expires_at: null });
    }
  }
  await db.query(`INSERT INTO customer_members(customer_id,user_id,role_code,status,access_approved_at) VALUES($1,$2,'customer_owner',$3,now())
    ON CONFLICT(customer_id,user_id) DO UPDATE SET status=excluded.status,access_approved_at=now()`,
  [client.id, user.id, active ? 'active' : 'invited']);
  const origin = config.customerOrigin || config.origin;
  const text = temporaryPassword ? `Open ${origin} and sign in with your registered email.
Temporary password: ${temporaryPassword}
It expires in 24 hours. Enter the emailed verification code and choose a new password to finish setup.`
    : otp ? `Set your Safcodes password at ${origin}/#activate/${otp.id}
Verification code: ${otp.code}
This invitation expires in ${config.customerOrigin ? '24 hours' : 'five minutes'}. Contact Safcodes if you need another invitation.`
    : `You have been granted access to ${client.display_name}. Sign in at ${origin} with your existing Safcodes account.`;
  return {
    record: client, message: active ? 'Client membership activated.' : 'Client invitation approved.',
    entity: 'customer', customerId: client.id,
    mail: { to: address, subject: 'Safcodes client access',
      text },
  };
}

async function linkedDomain(db, customerId, body) {
  if (body.domain_service_id === 'other') return { id: null, fqdn: domain(body.other_domain) };
  return requiredRow(db, `SELECT d.service_id AS id,d.fqdn FROM service_domains d JOIN services s ON s.id=d.service_id
    WHERE d.service_id=$1 AND d.customer_id=$2 AND s.status NOT IN ('cancelled','terminated')`,
  [identifier(body.domain_service_id, 'domain'), customerId], 'Domain belonging to this client');
}
async function subscriptionReference(db, service, provider, external) {
  if (!provider && !external) return;
  const previous = await one(db, `SELECT id FROM provider_subscriptions WHERE service_id=$1 AND status='active'
    ORDER BY setup_on DESC NULLS LAST,id LIMIT 1`, [service.id]);
  const fields = { provider_id: provider || null, external_reference: external || null, setup_on: service.term_start, ends_on: service.term_end };
  if (previous) await update(db, 'provider_subscriptions', previous.id, fields);
  else await insert(db, 'provider_subscriptions', { ...fields, service_id: service.id, customer_id: service.customer_id });
}
export async function service(db, actor, body) {
  const existing = body.id ? await serviceRecord(db, body.id, true) : null;
  const client = await clientRecord(db, existing?.customer_id || body.customer_id);
  const item = await catalogItem(db, existing?.catalog_item_id || body.catalog_item_id);
  requireValue(productTypes.includes(item.category) && (item.active || existing), 'Choose a valid product category.');
  const plan = body.plan_id ? await planRecord(db, body.plan_id) : null;
  requireValue(item.category === 'qr_code' || plan, 'Select a plan or domain extension.');
  if (plan) requireValue(plan.catalog_item_id === item.id && (plan.active || plan.id === existing?.plan_id), 'Choose a plan for this category.');
  const isDomain = item.category === 'domain';
  const hosting = ['shared_hosting','cloud_hosting'].includes(item.category);
  const isEmail = item.category === 'email';
  const providerId = body.provider_id || plan?.provider_id || null;
  const provider = providerId && await providerRecord(db, providerId, isDomain ? 'registrar' : isEmail ? 'email' : 'hosting');
  requireValue(!(isDomain || isEmail) || provider, 'Select a provider.');
  requireValue(!provider || provider.active || existing, 'Select an active provider.');
  requireValue(!isEmail || !plan?.provider_id || plan.provider_id === providerId, 'Select a plan for this email provider.');
  const start = day(body.term_start, 'registration date');
  const years = integer(body.term_years || 1, 1, 10, 'registration term');
  const end = existing?.term_start === start && Number(existing.registration_term_years || 1) === years
    ? existing.term_end : addMonths(start, 12 * years);
  const quantity = isEmail ? integer(body.quantity, 1, 10000, 'license quantity') : 1;
  const rate = numeric(body.purchased_unit_amount || plan?.unit_amount, '0.01', '9999999999', 'annual price');
  const discount = numeric(body.discount_pct || 0, 0, '99.99', 'discount');
  const recurring = money(rate).mul(money(100).minus(discount)).div(100).toFixed(2);
  requireValue(money(recurring).gt(0), 'The discounted price must be positive.');
  let fqdn;
  let tld;
  if (isDomain) {
    const extension = await requiredRow(db, 'SELECT tld FROM domain_tlds WHERE plan_id=$1', [plan.id], 'Domain extension');
    const label = string(body.domain_label, 'domain name');
    const oldDomain = existing && await one(db, 'SELECT fqdn,tld FROM service_domains WHERE service_id=$1', [existing.id]);
    const keep = existing?.plan_id === plan.id && oldDomain?.fqdn === label.toLowerCase();
    requireValue(keep || !label.includes('.') || label.toLowerCase().endsWith(extension.tld), 'Enter the domain label or a matching full domain.');
    fqdn = domain(keep || label.toLowerCase().endsWith(extension.tld) ? label : label + extension.tld);
    tld = keep ? oldDomain.tld : extension.tld;
  }
  const link = hosting || isEmail ? await linkedDomain(db, client.id, body) : null;
  const status = enumeration(body.status, serviceStatuses, 'product status');
  const fields = {
    title: fqdn || string(body.title, 'product title'), plan_id: plan?.id || null, quantity, status,
    term_start: start, term_end: end, next_due_date: end, registration_term_years: years,
    purchased_unit_amount: rate, discount_pct: discount, recurring_unit_amount: recurring,
    tax_inclusive: plan?.tax_inclusive ?? existing?.tax_inclusive ?? false,
    state_version: existing ? existing.state_version + 1 : 1,
  };
  const result = existing ? await update(db, 'services', existing.id, fields) : await insert(db, 'services', {
    ...fields, service_no: reference('SVC'), customer_id: client.id, catalog_item_id: item.id,
    currency: 'AED', billing_mode: 'annual', billing_cycle_months: 12,
  });
  if (isDomain) {
    await db.query(`INSERT INTO service_domains(service_id,customer_id,fqdn,tld,registrar_id,registered_on)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(service_id) DO UPDATE
      SET fqdn=excluded.fqdn,tld=excluded.tld,registrar_id=excluded.registrar_id,registered_on=excluded.registered_on`,
    [result.id, client.id, fqdn, tld, provider.id, start]);
    await db.query('UPDATE service_hosting SET primary_domain=$1 WHERE domain_service_id=$2', [fqdn, result.id]);
    await db.query('UPDATE service_email SET domain_name=$1 WHERE domain_service_id=$2', [fqdn, result.id]);
  }
  if (hosting) await db.query(`INSERT INTO service_hosting(service_id,customer_id,primary_domain,domain_service_id,control_panel_url)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(service_id) DO UPDATE SET
    primary_domain=excluded.primary_domain,domain_service_id=excluded.domain_service_id,control_panel_url=excluded.control_panel_url`,
  [result.id, client.id, link.fqdn, link.id, body.control_panel_url ? httpsLink(body.control_panel_url) : null]);
  if (isEmail) await db.query(`INSERT INTO service_email(service_id,customer_id,domain_name,domain_service_id,provider_id)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(service_id) DO UPDATE SET
    domain_name=excluded.domain_name,domain_service_id=excluded.domain_service_id,provider_id=excluded.provider_id`,
  [result.id, client.id, link.fqdn, link.id, provider.id]);
  await subscriptionReference(db, result, providerId, string(body.provider_reference, 'provider reference', optional));
  return { record: result, message: existing ? 'Product updated.' : 'Product added.', entity: 'service', customerId: client.id };
}
export async function serviceStatus(db, actor, body) {
  const old = await serviceRecord(db, body.id, true);
  const status = enumeration(body.status, serviceStatuses, 'service status');
  requireValue(!(old.status === 'expired' && status === 'active'), 'Renew an expired service before activating it.');
  const reason = string(body.reason, 'reason', { max: 2000 });
  const result = await update(db, 'services', old.id, { status, state_version: old.state_version + 1 });
  await insert(db, 'service_events', { customer_id: old.customer_id, service_id: old.id, event_type: 'status_updated',
    old_state: { status: old.status }, new_state: { status, reason }, actor_id: actor.id });
  return { record: result, message: 'Service status updated.', entity: 'service', customerId: old.customer_id };
}
async function serviceCategory(db, category) {
  return requiredRow(db, 'SELECT * FROM catalog_items WHERE category=$1 AND active ORDER BY code LIMIT 1', [category], 'Catalogue category');
}
export async function marketing(db, actor, body) {
  const old = body.id ? await serviceRecord(db, body.id, true) : null;
  requireValue(!old || marketingTypes.includes(old.category), 'Choose a marketing service.');
  const client = await clientRecord(db, old?.customer_id || body.customer_id);
  requireValue(Array.isArray(body.activity_ids) && body.activity_ids.length > 0 && body.activity_ids.length <= 100, 'Select marketing activities.');
  const ids = [...new Set(body.activity_ids)].map(value => identifier(value, 'activity'));
  const activities = await rows(db, 'SELECT id,active FROM marketing_activities WHERE id=ANY($1::uuid[])', [ids]);
  const previous = old ? await rows(db, 'SELECT activity_id FROM service_marketing_activities WHERE service_id=$1', [old.id]) : [];
  requireValue(activities.length === ids.length && activities.every(item => item.active || previous.some(row => row.activity_id === item.id)),
    'Select valid marketing activities.');
  const start = day(body.term_start);
  const end = day(body.term_end);
  requireValue(end > start, 'Choose an end date after the start.');
  const fields = { title: string(body.title, 'account title'), status: enumeration(body.status, ['active','suspended','cancelled'], 'status'),
    term_start: start, term_end: end, attributes: { ...old?.attributes, scope: string(body.scope, 'scope', note) } };
  const item = old ? null : await serviceCategory(db, 'digital_marketing');
  const result = old ? await update(db, 'services', old.id, fields) : await insert(db, 'services', {
    ...fields, customer_id: client.id, service_no: reference('SVC'), catalog_item_id: item.id, currency: 'AED', billing_mode: 'contract',
  });
  await db.query('DELETE FROM service_marketing_activities WHERE service_id=$1', [result.id]);
  await db.query('INSERT INTO service_marketing_activities(customer_id,service_id,activity_id) SELECT $1,$2,unnest($3::uuid[])',
    [client.id, result.id, ids]);
  return { record: result, message: 'Marketing account saved.', entity: 'service', customerId: client.id };
}

export async function project(db, actor, body) {
  const old = body.id ? await requiredRow(db, 'SELECT * FROM projects WHERE id=$1 FOR UPDATE', [identifier(body.id, 'project')], 'Project') : null;
  const client = await clientRecord(db, old?.customer_id || body.customer_id);
  const category = enumeration(body.project_type, projectTypes, 'project type');
  const technologyId = identifier(String(body.technology_id || '').split(':')[0], 'technology');
  const tech = await requiredRow(db, `SELECT t.* FROM technology_stacks t JOIN technology_stack_categories c ON c.tech_stack_id=t.id
    WHERE t.id=$1 AND c.project_category=$2`, [technologyId, category], 'Technology for this project type');
  requireValue(tech.active || tech.id === old?.tech_stack_id, 'Select an active technology.');
  const start = day(body.start_date);
  const end = day(body.target_date);
  const progress = integer(body.progress, 0, 100, 'progress');
  requireValue(end >= start, 'Choose a target date on or after the start.');
  const item = await serviceCategory(db, category);
  const oldService = old && await serviceRecord(db, old.service_id, true);
  const serviceFields = { title: string(body.title, 'project title'), catalog_item_id: item.id,
    attributes: { ...oldService?.attributes, scope: string(body.scope, 'scope', note) } };
  if (!oldService || oldService.billing_mode === 'project') {
    serviceFields.term_start = start;
    serviceFields.term_end = end === start ? addMonths(start, 1) : end;
  }
  const s = oldService ? await update(db, 'services', oldService.id, serviceFields)
    : await insert(db, 'services', { ...serviceFields, service_no: reference('SVC'), customer_id: client.id,
      status: 'active', currency: 'AED', billing_mode: 'project' });
  const fields = { tech_stack_id: tech.id, phase: string(body.phase, 'project phase'), start_date: start,
    target_date: end, progress, status: progress === 100 ? 'completed' : 'ongoing',
    completed_at: progress === 100 ? old?.completed_at || new Date() : null, maintenance_included: flag(body.maintenance_included) };
  const result = old ? await update(db, 'projects', old.id, fields)
    : await insert(db, 'projects', { ...fields, service_id: s.id, customer_id: client.id });
  const manager = string(body.manager, 'project lead', optional);
  if (manager) {
    const people = await rows(db, "SELECT id FROM users WHERE is_staff AND status='active' AND lower(display_name)=lower($1) LIMIT 2", [manager]);
    requireValue(people.length === 1, 'Enter the exact name of one active staff member for the project lead.');
    await db.query("DELETE FROM project_members WHERE project_id=$1 AND role='lead'", [result.id]);
    await insert(db, 'project_members', { project_id: result.id, customer_id: client.id, user_id: people[0].id, role: 'lead' });
  } else await db.query("DELETE FROM project_members WHERE project_id=$1 AND role='lead'", [result.id]);
  return { record: result, message: 'Project saved.', entity: 'project', customerId: client.id };
}

export async function contract(db, actor, body, config) {
  const old = body.id ? await requiredRow(db, 'SELECT * FROM contracts WHERE id=$1 AND currency=\'AED\' FOR UPDATE',
    [identifier(body.id, 'contract')], 'Contract') : null;
  const client = await clientRecord(db, old?.customer_id || body.customer_id);
  const amc = body.amc_plan_id && await requiredRow(db, 'SELECT * FROM amc_plans WHERE id=$1', [identifier(body.amc_plan_id, 'AMC plan')], 'AMC plan');
  requireValue(amc?.active || Boolean(old && (!amc || amc.id === old.amc_plan_id)), 'Choose an AMC plan.');
  const project = body.project_id && await requiredRow(db, `SELECT p.id,s.title FROM projects p JOIN services s ON s.id=p.service_id
    WHERE p.id=$1 AND p.customer_id=$2`, [identifier(body.project_id, 'project'), client.id], 'Project belonging to this client');
  const status = enumeration(body.status === 'suspended' ? 'on_hold' : body.status, ['draft','active','on_hold','completed','cancelled'], 'contract status');
  const billed = old && await one(db, `SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
    WHERE l.contract_id=$1 AND i.status='issued' LIMIT 1`, [old.id]);
  const fields = { title: string(body.title, 'contract title'), amc_plan_id: amc?.id || null,
    contract_type: amc?.code || old?.contract_type, project_id: project?.id || null,
    project_name: project?.title || string(body.project_name, 'project name', optional),
    scope: string(body.scope, 'scope', { max: 2000 }), status };
  if (!billed) {
    const cycle = await requiredRow(db, 'SELECT * FROM billing_cycles WHERE id=$1', [identifier(body.cycle_id, 'billing cycle')], 'Billing cycle');
    requireValue(cycle.active || old?.billing_cycle_id === cycle.id, 'Select an active billing cycle.');
    const start = day(body.start_date);
    const end = addMonths(start, 12);
    const due = day(body.first_due_date);
    requireValue(due >= start && due < end, 'Choose a first payment date within the contract year.');
    Object.assign(fields, { annual_value: numeric(body.annual_value, '0.12', '999999999999', 'annual value'),
      start_date: start, end_date: end, first_due_date: due, billing_cycle_id: cycle.id,
      billing_cycle_months: old?.billing_cycle_id === cycle.id ? old.billing_cycle_months : cycle.months,
      tax_inclusive: old?.tax_inclusive ?? true });
  }
  const result = old ? await update(db, 'contracts', old.id, fields) : await insert(db, 'contracts', {
    ...fields, contract_no: reference('AMC'), customer_id: client.id, currency: 'AED', account_manager_id: actor.id,
  });
  if (!billed) {
    await db.query(`INSERT INTO billing_schedules(customer_id,contract_id,cycle_months,anchor_date,next_period_start,next_due_date,ends_on)
      VALUES($1,$2,$3,$4,$5,$4,$6) ON CONFLICT(contract_id) WHERE active DO UPDATE
      SET cycle_months=excluded.cycle_months,anchor_date=excluded.anchor_date,next_period_start=excluded.next_period_start,
      next_due_date=excluded.next_due_date,ends_on=excluded.ends_on`,
    [client.id, result.id, result.billing_cycle_months, result.first_due_date, result.start_date, result.end_date]);
  }
  return { record: result, message: 'Contract saved.', entity: 'contract', customerId: client.id };
}

export async function plan(db, actor, body) {
  const old = body.id ? await planRecord(db, body.id) : null;
  const item = await catalogItem(db, old?.catalog_item_id || body.catalog_item_id);
  requireValue(productTypes.includes(item.category), 'Choose a product category.');
  const name = string(body.name, 'plan name');
  const isDomain = item.category === 'domain';
  if (isDomain) requireValue(/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(name), 'Use a domain extension such as .ae.');
  const providerId = item.category === 'email' ? (await providerRecord(db, old?.provider_id || body.provider_id, 'email')).id : null;
  await lock(db, 'catalog-plan:' + item.id + ':' + name.toLowerCase());
  const duplicate = await one(db, `SELECT id FROM catalog_plans WHERE catalog_item_id=$1 AND lower(name)=lower($2)
    AND provider_id IS NOT DISTINCT FROM $3::uuid AND id IS DISTINCT FROM $4::uuid`, [item.id, name, providerId, old?.id || null]);
  requireValue(!duplicate, 'This plan already exists.', 409);
  const fields = { name, provider_id: providerId, tier_rank: integer(body.tier_rank || 1, 1, 99, 'upgrade tier'),
    specifications: { ...old?.specifications, summary: string(body.summary, 'plan details', { max: 2000 }) }, active: flag(body.active) };
  if (old) {
    await db.query('SELECT id FROM catalog_plans WHERE id=$1 FOR UPDATE', [old.id]);
    if (isDomain && old.name !== name) {
      const used = await one(db, 'SELECT 1 FROM service_domains WHERE tld=$1 LIMIT 1', [old.name]);
      requireValue(!used, 'Create a new extension when the existing extension is in use.');
      await db.query('DELETE FROM domain_tlds WHERE plan_id=$1', [old.id]);
    }
  }
  const result = old ? await update(db, 'catalog_plans', old.id, fields) : await insert(db, 'catalog_plans', {
    ...fields, code: reference('PLAN').toLowerCase(), catalog_item_id: item.id, unit: isDomain ? 'domain' : item.category === 'email' ? 'seat' : 'service',
  });
  if (isDomain) {
    await db.query('INSERT INTO domain_tlds(tld,plan_id) VALUES($1,$2) ON CONFLICT(plan_id) DO NOTHING', [name, result.id]);
  }
  const rate = numeric(body.unit_amount, '0.01', '999999999999', 'annual rate');
  const taxInclusive = body.tax_inclusive === undefined ? old?.tax_inclusive ?? false : flag(body.tax_inclusive);
  await db.query(`UPDATE catalog_prices SET valid_until=current_date WHERE plan_id=$1 AND currency='AED' AND term_months=12
    AND valid_from<current_date AND (valid_until IS NULL OR valid_until>current_date)`, [result.id]);
  await db.query(`INSERT INTO catalog_prices(plan_id,currency,unit_amount,term_months,tax_inclusive,valid_from,valid_until)
    VALUES($1,'AED',$2,12,$3,current_date,
      (SELECT min(valid_from) FROM catalog_prices WHERE plan_id=$1 AND currency='AED' AND term_months=12 AND valid_from>current_date))
    ON CONFLICT(plan_id,currency,term_months,valid_from) DO UPDATE SET unit_amount=excluded.unit_amount,tax_inclusive=excluded.tax_inclusive`,
  [result.id, rate, taxInclusive]);
  return { record: result, message: 'Plan saved.', entity: 'plan' };
}

const groups = { marketing: 'marketing_activities', amc: 'amc_plans', cycle: 'billing_cycles', technology: 'technology_stacks' };
export async function catalogEntry(db, actor, body) {
  const group = enumeration(body.group, Object.keys(groups), 'catalogue group');
  const table = groups[group];
  const [entryId, originalCategory] = String(body.id || '').split(':');
  const old = entryId ? await requiredRow(db, 'SELECT * FROM ' + table + ' WHERE id=$1 FOR UPDATE', [identifier(entryId)], 'Catalogue item') : null;
  const fields = { name: string(body.name, 'catalogue name'), active: flag(body.active) };
  let category;
  if (group === 'technology') category = enumeration(originalCategory || body.project_type, projectTypes, 'project type');
  else if (group === 'cycle') fields.months = integer(body.months, 1, 12, 'billing interval');
  else fields.description = string(body.description, 'description', note);
  const result = old ? await update(db, table, old.id, fields) : await insert(db, table, { ...fields, code: reference(group).toLowerCase() });
  if (category) await db.query(`INSERT INTO technology_stack_categories(tech_stack_id,project_category)
    VALUES($1,$2) ON CONFLICT DO NOTHING`, [result.id, category]);
  return { record: { id: result.id + (category ? ':' + category : '') }, message: 'Catalogue item saved.', entity: table };
}

export async function provider(db, actor, body) {
  const existing = body.id ? await requiredRow(db, 'SELECT * FROM providers WHERE id=$1 FOR UPDATE', [identifier(body.id)], 'Provider') : null;
  const fields = { name: string(body.name, 'provider name'), active: flag(body.active) };
  const result = existing ? await update(db, 'providers', existing.id, fields) : await insert(db, 'providers', {
    ...fields, kind: enumeration(body.kind, ['registrar','hosting','email','payment'], 'provider type'), code: reference('provider').toLowerCase(),
  });
  return { record: result, message: 'Provider saved.', entity: 'provider' };
}
export async function staff(db, actor, body) {
  await lock(db, 'staff:admin');
  const existing = body.id ? await requiredRow(db, 'SELECT * FROM users WHERE id=$1 AND is_staff FOR UPDATE',
    [identifier(body.id)], 'Staff member') : null;
  const address = email(body.email);
  requireValue(!existing || existing.email === address, 'Create a verified email-change flow before changing an existing staff email.');
  const role = enumeration(body.role_code, ['admin','finance','support'], 'staff role');
  const desired = enumeration(body.status, ['active','inactive','invited','disabled','locked'], 'staff status');
  const active = desired === 'active';
  requireValue(!existing || existing.id !== actor.id || (active && role === 'admin'), 'Keep your own administrator account active.');
  if (existing && (!active || role !== 'admin')) {
    const other = await one(db, `SELECT 1 FROM users u JOIN staff_roles s ON s.user_id=u.id
      WHERE s.role_code='admin' AND u.status='active' AND u.is_staff AND u.id<>$1 LIMIT 1`, [existing.id]);
    requireValue(other, 'Keep at least one active administrator.');
  }
  const status = active ? (existing?.password_hash ? 'active' : 'invited') : desired === 'inactive' ? 'disabled' : desired;
  const fields = { display_name: string(body.display_name, 'staff name'), status };
  const user = existing ? await update(db, 'users', existing.id, fields)
    : await insert(db, 'users', { ...fields, email: address, is_staff: true, email_otp_required: true });
  await db.query('DELETE FROM staff_roles WHERE user_id=$1', [user.id]);
  await insert(db, 'staff_roles', { user_id: user.id, role_code: role });
  await db.query(`INSERT INTO staff_profiles(user_id,designation) VALUES($1,$2)
    ON CONFLICT(user_id) DO UPDATE SET designation=excluded.designation`, [user.id, string(body.designation, 'job title', optional)]);
  if (user.status !== 'active') await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [user.id]);
  return { record: user, message: user.status === 'invited' ? 'Staff invitation saved. Use Forgot password to set up sign-in.' : 'Staff member saved.', entity: 'staff' };
}
export async function settings(db, actor, body) {
  await db.query('UPDATE admin_settings SET company_name=$1,billing_email=$2 WHERE singleton',
    [string(body.company_name, 'company name'), email(body.billing_email)]);
  return { record: { id: 'workspace' }, message: 'Settings saved.', entity: 'settings' };
}
