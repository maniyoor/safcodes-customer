import { acceptQuote, changeEstimate, paymentLinkRequestMessage, pricing, queuePaymentLink, request as createRequest } from './billing.mjs';
import { planRecord, serviceRecord } from './records.mjs';
import { period } from './workspace.mjs';
import { addMonths } from '../../shared/workflows.mjs';
import {
  audit, enumeration, hash, identifier, insert, integer, lock, money, one, reference, requireValue,
  requiredRow, rows, string, today, update,
} from './core.mjs';

const productCategories = ['domain','shared_hosting','cloud_hosting','email','qr_code'];
const changes = ['hosting_upgrade','email_scale'];
const publicNote = { max: 2000 };
const can = (account, permission) => account.permissions.includes(permission);
const allowed = (account, permission) => requireValue(can(account, permission), 'Your account role does not allow this action.', 403);
const net = (value, inclusive, taxRate) => value == null ? null : inclusive
  ? money(value).div(money(1).plus(taxRate)).toFixed(6) : String(value);
export const accountFor = (actor, id) => {
  const account = actor.accounts.find(item => item.id === identifier(id, 'customer account'));
  requireValue(account, 'Customer account not found.', 404);
  return account;
};
const protectedRecord = (db, table, id, account, name, forUpdate = false) =>
  requiredRow(db, 'SELECT * FROM ' + table + ' WHERE id=$1 AND customer_id=$2' + (forUpdate ? ' FOR UPDATE' : ''),
    [identifier(id, name), account.id], name);

function allowedLink(value, hosts) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && hosts.includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

export async function customerWorkspace(db, account, config) {
  const ids = [account.id];
  const asOf = await today(db);
  const catalog = await rows(db, `SELECT id,category,segment,name,description FROM catalog_items WHERE active ORDER BY segment,name`);
  const plans = await rows(db, `SELECT p.id,p.catalog_item_id,p.name,p.tier_rank,p.unit,p.specifications,
    t.tld,v.name AS provider,v.code AS provider_code,price.unit_amount,price.tax_inclusive FROM catalog_plans p
    JOIN catalog_items c ON c.id=p.catalog_item_id AND c.active
    LEFT JOIN providers v ON v.id=p.provider_id LEFT JOIN domain_tlds t ON t.plan_id=p.id
    LEFT JOIN LATERAL (SELECT unit_amount,tax_inclusive FROM catalog_prices
      WHERE plan_id=p.id AND currency='AED' AND term_months=12
      AND valid_from<=current_date AND (valid_until IS NULL OR valid_until>current_date)
      ORDER BY valid_from DESC LIMIT 1) price ON true
    WHERE p.active AND (p.provider_id IS NULL OR v.active) AND (c.category<>'domain' OR t.tld IS NOT NULL)
    ORDER BY p.catalog_item_id,p.tier_rank,p.name`);
  for (const plan of plans) plan.net_unit_amount = net(plan.unit_amount, plan.tax_inclusive, config.taxRate);
  const services = await rows(db, `SELECT s.id,s.service_no,s.title,s.plan_id,s.catalog_item_id,s.quantity,s.status,s.health,
    s.billing_mode,s.billing_cycle_months,s.term_start,s.term_end,s.next_due_date,s.auto_renew,p.name AS plan,p.tier_rank AS plan_tier_rank,
    i.category,i.segment,i.name AS catalog_name,coalesce(d.fqdn,h.primary_domain,e.domain_name,j.primary_domain) AS domain,
    provider.name AS provider,provider.code AS provider_code, s.attributes->>'scope' AS scope, p.specifications,
    coalesce((SELECT jsonb_agg(a.name ORDER BY a.name) FROM service_marketing_activities m
      JOIN marketing_activities a ON a.id=m.activity_id WHERE m.service_id=s.id),'[]') AS activities
    ${can(account,'billing.view') ? ',s.recurring_unit_amount,s.tax_inclusive' : ''}
    FROM services s JOIN catalog_items i ON i.id=s.catalog_item_id LEFT JOIN catalog_plans p ON p.id=s.plan_id
    LEFT JOIN service_domains d ON d.service_id=s.id LEFT JOIN service_hosting h ON h.service_id=s.id
    LEFT JOIN service_email e ON e.service_id=s.id LEFT JOIN projects j ON j.service_id=s.id
    LEFT JOIN providers provider ON provider.id=coalesce(e.provider_id,d.registrar_id,p.provider_id)
    WHERE s.customer_id=$1 AND s.currency='AED' ORDER BY s.title,s.id`, ids);
  for (const service of services) {
    if (Object.hasOwn(service,'recurring_unit_amount')) service.recurring_net_unit_amount = net(service.recurring_unit_amount, service.tax_inclusive, config.taxRate);
  }
  const projects = await rows(db, `SELECT j.id,j.service_id,j.status,j.progress,j.start_date,j.target_date,j.completed_at::date AS completed_on,
    j.phase,j.maintenance_included,t.name AS technology,hosting.title AS hosting,
    (SELECT u.display_name FROM project_members member JOIN users u ON u.id=member.user_id
      WHERE member.project_id=j.id AND member.role='lead' AND u.is_staff ORDER BY u.id LIMIT 1) AS project_lead,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'due_date',m.due_date,'completed_at',m.completed_at)
      ORDER BY m.due_date,m.id) FROM project_milestones m WHERE m.project_id=j.id),'[]') AS milestones
    FROM projects j LEFT JOIN technology_stacks t ON t.id=j.tech_stack_id
    LEFT JOIN services hosting ON hosting.id=j.hosting_service_id AND hosting.customer_id=j.customer_id
    WHERE j.customer_id=$1 ORDER BY j.target_date NULLS LAST,j.id`, ids);
  const contracts = await rows(db, `SELECT c.id,c.contract_no,c.title,c.contract_type,p.name AS plan,c.status,c.project_id,c.project_name,
    c.start_date,c.end_date,c.billing_cycle_months,c.scope,c.response_target_minutes,
    coalesce((SELECT jsonb_agg(service_id) FROM contract_services WHERE contract_id=c.id),'[]') AS service_ids
    ${can(account,'billing.view') ? `,c.annual_value,c.tax_inclusive,c.indicative_instalment,c.next_due_date,c.outstanding_amount,
      c.oldest_unpaid_due_on,c.overdue_invoice_count,s.next_period_start,c.last_payment_received_at,
      c.payment_due_on,c.days_to_due` : ''}
    FROM contract_admin_overview c LEFT JOIN amc_plans p ON p.id=c.amc_plan_id
    LEFT JOIN billing_schedules s ON s.contract_id=c.id AND s.active
    WHERE c.customer_id=$1 AND c.currency='AED' AND c.status<>'draft' ORDER BY c.start_date DESC,c.id`, ids);
  const orders = can(account,'orders.create') ? await rows(db, `SELECT o.id,o.order_no,o.segment,o.kind,o.status,o.brief,
    o.customer_status_note,o.created_at,coalesce(i.description,o.order_no) AS title,i.existing_service_id,
    i.requested_quantity,i.requested_years,i.options->>'domain' AS requested_domain,plan.name AS requested_plan,c.category,
    i.options->>'estimate' AS estimate,i.options->'amc_request'='true'::jsonb AS amc_request,
    i.options->'request_payment_link'='true'::jsonb AS request_payment_link,
    coalesce((i.options->>'estimate_tax_inclusive')::boolean,existing.tax_inclusive,plan_price.tax_inclusive,false) AS estimate_tax_inclusive,
    q.id AS quote_id,q.status AS quote_status,q.terms AS quote_terms,
    q.expires_at AS quote_expires_at,q.expires_at>now() AS quote_valid,
    (SELECT sum(gross_amount) FROM quote_lines WHERE quote_id=q.id) AS quote_total,
    (SELECT sum(net_amount) FROM quote_lines WHERE quote_id=q.id) AS quote_subtotal,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'author',CASE WHEN u.is_staff THEN 'Safcodes' ELSE u.display_name END,
      'body',m.body,'created_at',m.created_at) ORDER BY m.created_at,m.id)
      FROM order_messages m JOIN users u ON u.id=m.author_id WHERE m.order_id=o.id AND m.visibility='customer'),'[]') AS messages
    FROM orders o LEFT JOIN LATERAL (SELECT * FROM order_items WHERE order_id=o.id ORDER BY id LIMIT 1) i ON true
    LEFT JOIN catalog_items c ON c.id=i.catalog_item_id LEFT JOIN catalog_plans plan ON plan.id=i.requested_plan_id
    LEFT JOIN services existing ON existing.id=i.existing_service_id
    LEFT JOIN LATERAL (SELECT tax_inclusive FROM catalog_prices WHERE plan_id=plan.id AND currency='AED' AND term_months=12
      AND valid_from<=o.created_at::date AND (valid_until IS NULL OR valid_until>o.created_at::date)
      ORDER BY valid_from DESC LIMIT 1) plan_price ON true
    LEFT JOIN LATERAL (SELECT id,status,terms,expires_at FROM quotes WHERE order_id=o.id AND status IN ('sent','accepted')
      AND currency='AED' ORDER BY version DESC LIMIT 1) q ON true
    WHERE o.customer_id=$1 ORDER BY o.created_at DESC,o.id`, ids) : [];
  for (const order of orders) order.estimate_net = net(order.estimate, order.estimate_tax_inclusive, config.taxRate);
  const invoices = can(account,'billing.view') ? await rows(db, `SELECT i.id,i.invoice_no,i.issued_on,i.due_on,i.segment,i.billing_name,
    i.net_amount,i.tax_amount,i.gross_amount,i.paid_amount,i.credited_amount,i.balance,i.payment_status,
    coalesce((SELECT jsonb_agg(jsonb_build_object('description',l.description,'quantity',l.quantity,'gross_amount',l.gross_amount,'net_amount',l.net_amount,
      'charge_type',l.charge_type,'service_id',l.service_id,'contract_id',l.contract_id,'order_id',l.order_id,
      'period_start',l.period_start,'period_end',l.period_end) ORDER BY l.line_no) FROM invoice_lines l WHERE l.invoice_id=i.id),'[]') AS lines,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount,'method',p.method,'received_on',p.received_at::date)
      ORDER BY p.received_at,a.id) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id
      WHERE a.invoice_id=i.id AND p.status='captured'),'[]') AS payments,
    CASE WHEN i.balance>0 THEN link.url END AS payment_link,
    i.balance>0 AND EXISTS (SELECT 1 FROM payment_requests r WHERE r.invoice_id=i.id AND r.status='queued'
      AND r.message=$2) AS payment_link_requested
    FROM invoice_balances i LEFT JOIN LATERAL (SELECT url FROM payment_links WHERE invoice_id=i.id AND status='ready'
      AND expires_at>now() ORDER BY created_at DESC,id DESC LIMIT 1) link ON true
    WHERE i.customer_id=$1 AND i.status='issued' AND i.currency='AED' ORDER BY i.due_on,i.id`, [account.id,paymentLinkRequestMessage]) : [];
  for (const invoice of invoices) invoice.payment_link = allowedLink(invoice.payment_link, config.paymentHosts);
  for (const contract of contracts) {
    if (!can(account,'billing.view')) break;
    const next = contract.status === 'active' ? period(contract) : null;
    let months = 0;
    let overdueBalance = money(0);
    for (const invoice of invoices) {
      if (Number(invoice.balance) <= 0 || invoice.due_on >= asOf) continue;
      const agreementLines = invoice.lines.filter(line => line.contract_id === contract.id);
      const agreementGross = agreementLines.reduce((sum,line) => sum.plus(line.gross_amount),money(0));
      if (Number(invoice.gross_amount)>0) overdueBalance = overdueBalance.plus(money(invoice.balance).mul(agreementGross).div(invoice.gross_amount));
      for (const line of agreementLines) {
        const span = line.period_start && line.period_end ? (Number(line.period_end.slice(0,4)) - Number(line.period_start.slice(0,4))) * 12
          + Number(line.period_end.slice(5,7)) - Number(line.period_start.slice(5,7)) : contract.billing_cycle_months;
        months += Math.max(1,span);
      }
    }
    let scheduled = next;
    let unissued = money(0);
    for (let n=0; scheduled && scheduled.due<asOf && n<12; n++) {
      months += scheduled.months;
      unissued = unissued.plus(scheduled.gross);
      scheduled = period({ ...contract, next_period_start: scheduled.end, next_due_date: addMonths(scheduled.due, contract.billing_cycle_months) });
    }
    const nextAmount = next?.gross ?? contract.indicative_instalment;
    contract.billing = { nextAmount, nextNet: net(nextAmount, contract.tax_inclusive, config.taxRate),
      annualNet: net(contract.annual_value, contract.tax_inclusive, config.taxRate),
      overdueMonths: months, overdueBalance: overdueBalance.toFixed(2), unissuedOverdue: net(unissued, contract.tax_inclusive, config.taxRate) };
  }
  const tickets = can(account,'support.create') ? await rows(db, `SELECT t.id,t.ticket_no,t.subject,t.status,t.priority,t.related_service_id,t.updated_at,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'author',CASE WHEN u.is_staff THEN 'Safcodes' ELSE u.display_name END,
      'body',m.body,'created_at',m.created_at) ORDER BY m.created_at,m.id) FROM ticket_messages m JOIN users u ON u.id=m.author_id
      WHERE m.ticket_id=t.id AND m.visibility='customer'),'[]') AS messages
    FROM support_tickets t WHERE t.customer_id=$1 ORDER BY t.updated_at DESC,t.id`, ids) : [];
  const paymentMethodsEnabled = Boolean(config.stripe && can(account,'billing.view') && can(account,'account.manage') &&
    (await one(db, 'SELECT stripe_test_customer_id FROM customers WHERE id=$1', ids))?.stripe_test_customer_id);
  return { asOf, taxRate: config.taxRate, catalog, plans, services, projects, contracts, orders, invoices, tickets, paymentMethodsEnabled };
}

export async function customerEstimate(db, account, data, config) {
  allowed(account, 'orders.create');
  const service = await serviceRecord(db, data.existing_service_id);
  requireValue(service.customer_id === account.id, 'Service not found.', 404);
  const kind = enumeration(data.kind, changes, 'change type');
  const plan = await planRecord(db, kind === 'email_scale' ? service.plan_id : data.requested_plan_id);
  const quantity = kind === 'email_scale' ? integer(data.requested_quantity, 1, 10000, 'seat quantity') : service.quantity;
  const estimate = await changeEstimate(db, kind, service, plan, quantity, config.taxRate);
  const netPrices = Object.fromEntries(['unit','oldAnnual','newAnnual','amount'].map(field =>
    [field, net(estimate[field], estimate.taxInclusive, config.taxRate)]));
  const { net_amount, tax_amount } = pricing(estimate.amount, estimate.taxInclusive, config.taxRate);
  return { ...estimate, netPrices, tax_inclusive: estimate.taxInclusive, term_end: service.term_end,
    charge: { net: net_amount, vat: tax_amount, total: money(net_amount).plus(tax_amount).toFixed(2) } };
}

async function order(db, actor, account, data, config, key) {
  allowed(account, 'orders.create');
  const kind = enumeration(data.kind, ['new_product','new_service','renewal',...changes], 'request type');
  const wantsLink = kind==='renewal' && data.request_payment_link===true;
  const amc = kind==='new_service' && data.amc_request===true;
  if (wantsLink) allowed(account, 'billing.view');
  const existing = amc || [...changes,'renewal'].includes(kind);
  const service = existing ? await serviceRecord(db, data.existing_service_id) : null;
  requireValue(!service || service.customer_id === account.id, 'Service not found.', 404);
  const item = !existing && await requiredRow(db, 'SELECT name,category FROM catalog_items WHERE id=$1 AND active',
    [identifier(data.catalog_item_id, 'category')], 'Category');
  const planId = kind === 'email_scale' ? service.plan_id : kind === 'renewal' ? null : data.requested_plan_id;
  if (planId) await requiredRow(db, `SELECT p.id FROM catalog_plans p LEFT JOIN providers v ON v.id=p.provider_id
    WHERE p.id=$1 AND p.active AND (p.provider_id IS NULL OR v.active)`, [identifier(planId, 'plan')], 'Available plan');
  const requestedDomain = item && productCategories.includes(item.category) && item.category !== 'qr_code'
    ? string(data.domain_name, 'domain name') : null;
  const title = amc ? 'AMC contract · ' + service.title
    : service ? (kind === 'renewal' ? 'Renew ' : kind === 'email_scale' ? 'Scale ' : 'Upgrade ') + service.title
    : (requestedDomain ? item.name + ' · ' + requestedDomain : string(data.title, 'request title'));
  return createRequest(db, actor, {
    customer_id: account.id, kind, title, brief: data.brief, catalog_item_id: data.catalog_item_id,
    existing_service_id: service?.id, requested_plan_id: planId,
    requested_quantity: data.requested_quantity, requested_years: data.requested_years, domain_name: requestedDomain,
    request_payment_link: wantsLink, amc_request: amc,
  }, config, key);
}

async function paymentRequest(db, actor, account, data, config, key) {
  allowed(account, 'billing.view');
  const invoice = await protectedRecord(db, 'invoices', data.id, account, 'Invoice', true);
  const summary = await one(db, 'SELECT balance FROM invoice_balances WHERE id=$1', [invoice.id]);
  requireValue(invoice.status === 'issued' && invoice.currency === 'AED' && money(summary.balance).gt(0), 'There is no outstanding balance.', 409);
  const current = await one(db, "SELECT url FROM payment_links WHERE invoice_id=$1 AND status='ready' AND expires_at>now() ORDER BY created_at DESC,id DESC LIMIT 1", [invoice.id]);
  requireValue(!allowedLink(current?.url, config.paymentHosts), 'The invoice already has a payment link. Refresh the invoice to use it.', 409);
  const record = await queuePaymentLink(db, invoice, actor.id, account.billing_email, key);
  return { record, entity: 'payment_request', message: 'Payment link requested. It will appear on the invoice once Safcodes adds it.' };
}

async function quoteAccept(db, actor, account, data) {
  allowed(account, 'orders.create');
  allowed(account, 'billing.view');
  const parent = await protectedRecord(db, 'orders', data.id, account, 'Request', true);
  return acceptQuote(db, actor, parent.id, 'Accepted in the customer portal.', identifier(data.quote_id, 'quote'));
}

async function support(db, actor, account, data) {
  allowed(account, 'support.create');
  const service = data.service_id && await protectedRecord(db, 'services', data.service_id, account, 'Service');
  const result = await insert(db, 'support_tickets', {
    customer_id: account.id, ticket_no: reference('TKT'), opened_by: actor.id, related_service_id: service?.id || null,
    subject: string(data.subject, 'subject'), department_code: enumeration(data.department, ['technical','billing','sales','delivery'], 'department'),
    priority: enumeration(data.priority, ['low','normal','high','urgent'], 'priority'),
  });
  await insert(db, 'ticket_messages', { customer_id: account.id, ticket_id: result.id, author_id: actor.id,
    body: string(data.body, 'message', publicNote), visibility: 'customer' });
  return { record: result, entity: 'ticket', message: 'Support ticket opened.' };
}

async function reply(db, actor, account, data) {
  const order = enumeration(data.collection, ['orders','tickets'], 'conversation') === 'orders';
  allowed(account, order ? 'orders.create' : 'support.create');
  const parent = await protectedRecord(db, order ? 'orders' : 'support_tickets', data.id, account, order ? 'Request' : 'Ticket', true);
  requireValue(!(order ? ['completed','rejected','cancelled','superseded'] : ['resolved','closed']).includes(parent.status), 'This conversation is closed.', 409);
  await insert(db, order ? 'order_messages' : 'ticket_messages', {
    customer_id: account.id, [order ? 'order_id' : 'ticket_id']: parent.id, author_id: actor.id,
    body: string(data.body, 'message', publicNote), visibility: 'customer',
  });
  if (order && parent.status === 'needs_information') {
    await db.query("UPDATE orders SET status='under_review',customer_status_note=NULL WHERE id=$1", [parent.id]);
  }
  if (!order) await db.query(`UPDATE support_tickets SET updated_at=now(),
    status=CASE WHEN status='awaiting_client' THEN 'open' ELSE status END WHERE id=$1`, [parent.id]);
  return { record: parent, entity: order ? 'order' : 'ticket', message: 'Reply sent.' };
}

async function ticketStatus(db, actor, account, data) {
  allowed(account, 'support.create');
  const status = enumeration(data.status, ['open','closed'], 'ticket status');
  const ticket = await protectedRecord(db, 'support_tickets', data.id, account, 'Ticket', true);
  const closed = ['resolved','closed'].includes(ticket.status);
  if (closed === (status === 'closed')) return { record: ticket, entity: 'ticket',
    message: closed ? 'Ticket is already closed.' : 'Ticket is already open.' };
  const record = await update(db, 'support_tickets', ticket.id, { status, closed_at: status === 'closed' ? new Date() : null });
  return { record, entity: 'ticket', message: status === 'closed' ? 'Ticket closed.' : 'Ticket reopened.' };
}

const actions = { request: order, payment_link: paymentRequest, accept_quote: quoteAccept, ticket: support, ticket_status: ticketStatus, reply };
export async function customerCommand(db, actor, account, idempotencyKey, body, config) {
  const { action, data } = body;
  requireValue(typeof action === 'string' && Object.hasOwn(actions, action), 'Unknown customer action.');
  requireValue(data && typeof data === 'object' && !Array.isArray(data), 'Provide action data.');
  const key = identifier(idempotencyKey, 'idempotency key');
  const fingerprint = hash(JSON.stringify(['customer', account.id, action, data]));
  await lock(db, 'command:' + actor.id + ':' + key);
  const previous = await one(db, 'SELECT fingerprint,response FROM admin_command_receipts WHERE actor_id=$1 AND request_id=$2', [actor.id,key]);
  if (previous) {
    requireValue(previous.fingerprint === fingerprint, 'This action key was already used for a different submission.', 409);
    return { id: previous.response.record.id, message: previous.response.message };
  }
  const result = await actions[action](db, actor, account, data, config, key);
  const response = { record: { id: result.record.id }, message: result.message };
  await audit(db, actor, 'customer_' + action, result.entity, result.record.id, account.id, { label: result.message });
  await insert(db, 'admin_command_receipts', { actor_id: actor.id, request_id: key, action: 'customer_' + action, fingerprint, response });
  return { id: response.record.id, message: response.message };
}
