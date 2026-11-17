import { addMonths, daysBetween } from '../../shared/workflows.mjs';
import { catalogItem, planRecord, serviceRecord } from './records.mjs';
import { period } from './workspace.mjs';
import {
  audit, clientRecord, day, domain, enumeration, flag, httpsLink, identifier, insert, integer, lock, money,
  numeric, one, reference, requireValue, requiredRow, rows, string, today, update,
} from './core.mjs';

const upgrades = ['hosting_upgrade','email_scale'];
const reviewing = ['under_review','needs_information','on_hold'];
const note = { max: 2000 };
export const paymentLinkRequestMessage = 'Payment link requested.';
const requestRow = (db, id) => requiredRow(db, `SELECT o.* FROM orders o JOIN customers c ON c.id=o.customer_id
  WHERE o.id=$1 AND c.currency='AED' FOR UPDATE OF o`, [identifier(id, 'request')], 'Request');
const orderItems = (db, id) => rows(db, 'SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [id]);

export async function changeEstimate(db, kind, service, plan, quantity, taxRate) {
  requireValue(service.status === 'active' && service.billing_mode === 'annual' && service.term_start && service.term_end,
    'Choose an active annual subscription.');
  const date = await today(db);
  const term = daysBetween(service.term_start, service.term_end);
  const remaining = Math.min(term, daysBetween(date, service.term_end));
  requireValue(remaining > 0 && term > 0 && date >= service.term_start, 'The service term is not eligible for proration.');
  requireValue(plan.active && plan.catalog_item_id === service.catalog_item_id, 'Choose a valid plan for the current service.');
  if (kind === 'hosting_upgrade') {
    const current = await planRecord(db, service.plan_id);
    requireValue(['shared_hosting','cloud_hosting'].includes(service.category) && plan.tier_rank > current.tier_rank &&
      quantity === service.quantity && plan.unit_amount !== null, 'Choose a higher hosting plan with an annual price.');
  } else requireValue(service.category === 'email' && plan.id === service.plan_id && quantity > service.quantity,
    'Select the current email plan and a higher number of seats.');
  const target = kind === 'email_scale' ? service : plan;
  const targetUnit = money(target.recurring_unit_amount ?? target.unit_amount);
  const taxFactor = money(1).plus(taxRate);
  // Legacy inclusive-to-inclusive changes keep their agreed gross basis. Mixed plans prorate before VAT.
  const taxInclusive = service.tax_inclusive && target.tax_inclusive;
  const unit = target.tax_inclusive && !taxInclusive ? targetUnit.div(taxFactor) : targetUnit;
  const existingUnit = money(service.recurring_unit_amount);
  const oldAnnual = (service.tax_inclusive && !taxInclusive ? existingUnit.div(taxFactor) : existingUnit).mul(service.quantity);
  const newAnnual = unit.mul(quantity);
  requireValue(newAnnual.gt(oldAnnual), 'Choose an increase in annual value.');
  const delta = newAnnual.minus(oldAnnual).toFixed(4);
  const value = await one(db, 'SELECT prorate($1,$2,$3,$4,2) AS amount', [delta, service.term_start, service.term_end, date]);
  requireValue(money(value.amount).gt(0), 'The calculated adjustment is below AED 0.01.');
  return { amount: value.amount, date, term, remaining, unit: unit.toFixed(4), oldAnnual: oldAnnual.toFixed(4),
    newAnnual: newAnnual.toFixed(4), taxInclusive, targetUnit: targetUnit.toFixed(4), targetTaxInclusive: target.tax_inclusive };
}

export async function request(db, actor, body, config, requestId) {
  const client = await clientRecord(db, body.customer_id);
  const kind = enumeration(body.kind, ['new_product','new_service','renewal',...upgrades,'cancellation'], 'request type');
  const renewal = kind === 'renewal';
  const amc = kind === 'new_service' && body.amc_request === true;
  const needsService = amc || [...upgrades,'renewal','cancellation'].includes(kind);
  const service = needsService ? await serviceRecord(db, body.existing_service_id, renewal) : null;
  requireValue(!service || service.customer_id === client.id, 'Select a service belonging to this client.');
  const item = await catalogItem(db, service?.catalog_item_id || body.catalog_item_id);
  if (amc) requireValue(item.segment === 'service', 'Select a project or service for the AMC request.');
  requireValue(item.active || service, 'Choose an active category.');
  requireValue(needsService || item.segment === (kind === 'new_product' ? 'product' : 'service'), 'Choose a matching category.');
  const plan = body.requested_plan_id ? await planRecord(db, body.requested_plan_id) : null;
  requireValue(!plan || plan.catalog_item_id === item.id && plan.active, 'Select a valid plan.');
  if (!needsService && item.segment === 'product' && item.category !== 'qr_code') requireValue(plan?.unit_amount, 'Select an available priced plan.');
  const years = renewal ? 1 : integer(body.requested_years || 1, 1, 10, 'registration term');
  let quantity = kind === 'new_product' && item.category === 'email' ? integer(body.requested_quantity ?? 1, 1, 10000, 'seat quantity') : 1;
  let estimate = plan?.unit_amount ? money(plan.unit_amount).mul(quantity).mul(item.segment === 'product' ? years : 1).toFixed(2) : '0.00';
  let estimateTaxInclusive = Boolean(needsService ? service.tax_inclusive : plan?.tax_inclusive);
  if (renewal) {
    requireValue(service.billing_mode === 'annual' && service.term_end && !['cancelled','terminated','provisioning'].includes(service.status),
      'Choose a renewable annual service.');
    const open = await one(db, `SELECT o.*,i.id AS item_id,i.options FROM orders o JOIN order_items i ON i.order_id=o.id
      WHERE o.customer_id=$1 AND i.existing_service_id=$2 AND o.kind='renewal'
      AND o.status IN ('under_review','needs_information','on_hold','awaiting_payment') ORDER BY o.created_at,o.id LIMIT 1 FOR UPDATE OF o`, [client.id,service.id]);
    const invoice = await one(db, `SELECT l.id FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
      WHERE l.service_id=$1 AND l.period_start=$2 AND l.charge_type='annual_renewal' AND i.status='issued' LIMIT 1`, [service.id,service.term_end]);
    if (!invoice && open && reviewing.includes(open.status) && body.request_payment_link === true && open.options.request_payment_link !== true) {
      await update(db, 'order_items', open.item_id, { options: { ...open.options, request_payment_link: true, payment_link_requested_by: actor.id } });
      return { record: open, message: 'Payment link requested for the existing renewal.', entity: 'order', customerId: client.id };
    }
    requireValue(!open && !invoice, 'There is already a request or invoice for this renewal. Refresh to see the latest status.', 409);
    quantity = service.quantity;
    estimate = money(service.recurring_unit_amount).mul(quantity).toFixed(2);
    requireValue(money(estimate).gt(0), 'Contact Safcodes for a renewal price.');
  }
  let requestedDomain;
  if (kind === 'new_product' && body.domain_name) {
    requireValue(['domain','shared_hosting','cloud_hosting','email'].includes(item.category), 'This product does not use a domain.');
    requestedDomain = domain(body.domain_name);
    if (item.category === 'domain') {
      const extension = await requiredRow(db, 'SELECT tld FROM domain_tlds WHERE plan_id=$1', [plan.id], 'Domain extension');
      requireValue(requestedDomain.endsWith(extension.tld), 'Use a domain with the selected extension.');
    }
  }
  if (upgrades.includes(kind)) {
    requireValue(plan, 'Select a plan.');
    quantity = kind === 'email_scale' ? integer(body.requested_quantity, 1, 10000, 'seat quantity') : service.quantity;
    const change = await changeEstimate(db, kind, service, plan, quantity, config.taxRate);
    estimate = change.amount;
    estimateTaxInclusive = change.taxInclusive;
  }
  const result = await insert(db, 'orders', { customer_id: client.id, order_no: reference('REQ'), segment: item.segment,
    kind, status: 'under_review', requested_by: actor.id, brief: string(body.brief, 'request details', note), idempotency_key: requestId });
  await insert(db, 'order_items', { customer_id: client.id, order_id: result.id, catalog_item_id: item.id,
    requested_plan_id: plan?.id || null, existing_service_id: service?.id || null,
    requested_quantity: quantity, requested_years: years,
    description: string(body.title, 'request title'), options: { estimate,
      estimate_tax_inclusive: estimateTaxInclusive,
      ...(requestedDomain ? { domain: requestedDomain } : {}),
      ...(amc ? { amc_request: true } : {}),
      ...(renewal && body.request_payment_link===true ? { request_payment_link: true } : {}) } });
  return { record: result, message: 'Request created.', entity: 'order', customerId: client.id };
}
export async function review(db, actor, body) {
  const order = await requestRow(db, body.id);
  requireValue(reviewing.includes(order.status), 'The request is no longer in review.', 409);
  const status = enumeration(body.status === 'declined' ? 'rejected' : body.status, [...reviewing,'rejected'], 'review status');
  const details = string(body.customer_status_note, 'status note', { ...note, optional: status !== 'needs_information' });
  const result = await update(db, 'orders', order.id, { status, customer_status_note: details });
  return { record: result, message: 'Request status updated.', entity: 'order', customerId: order.customer_id };
}

export function pricing(value, taxInclusive, rate) {
  const entered = money(value).toDecimalPlaces(2);
  const taxRate = money(rate);
  const net = taxInclusive ? entered.div(taxRate.plus(1)).toDecimalPlaces(2) : entered.toDecimalPlaces(2);
  const tax = taxInclusive ? entered.minus(net).toDecimalPlaces(2) : net.mul(taxRate).toDecimalPlaces(2);
  return { unit_net: net.toFixed(4), discount_net: '0.00', tax_rate: taxRate.toFixed(6),
    net_amount: net.toFixed(2), tax_amount: tax.toFixed(2) };
}
export async function quote(db, actor, body, config) {
  const order = await requestRow(db, body.id);
  requireValue([...reviewing,'quoted'].includes(order.status) && !['cancellation','renewal'].includes(order.kind), 'This request cannot be quoted.', 409);
  const items = await orderItems(db, order.id);
  requireValue(items.length === 1, 'The console editor supports one item per quote. Issue an existing approved multi-item quote without revising it here.');
  const item = items[0];
  let amount;
  let change;
  let service;
  let selected;
  if (upgrades.includes(order.kind)) {
    service = await serviceRecord(db, item.existing_service_id, true);
    selected = await planRecord(db, item.requested_plan_id);
    change = await changeEstimate(db, order.kind, service, selected, item.requested_quantity, config.taxRate);
    amount = change.amount;
  } else amount = numeric(body.quote_amount, '0.01', '999999999999', 'quote amount');
  await db.query("UPDATE quotes SET status='superseded' WHERE order_id=$1 AND status IN ('draft','sent')", [order.id]);
  await db.query("UPDATE service_changes SET status='superseded' WHERE order_id=$1 AND status IN ('requested','quoted')", [order.id]);
  const { version } = await one(db, 'SELECT coalesce(max(version),0)+1 AS version FROM quotes WHERE order_id=$1', [order.id]);
  const q = await insert(db, 'quotes', { customer_id: order.customer_id, order_id: order.id, version, currency: 'AED',
    expires_at: new Date(Date.now() + 7 * 86400000), terms: string(body.quote_note, 'quote terms', note), created_by: actor.id });
  const taxInclusive = change ? change.taxInclusive : body.tax_inclusive === undefined || flag(body.tax_inclusive);
  const amounts = pricing(amount, taxInclusive, config.taxRate);
  const snapshot = { priced_on: await today(db) };
  if (change && order.kind === 'hosting_upgrade') {
    snapshot.target_unit_amount = change.targetUnit;
    snapshot.target_tax_inclusive = change.targetTaxInclusive;
  }
  await insert(db, 'quote_lines', { customer_id: order.customer_id, quote_id: q.id, order_item_id: item.id,
    description: item.description, quantity: 1, ...amounts, pricing_snapshot: snapshot });
  if (change) await insert(db, 'service_changes', {
    customer_id: service.customer_id, service_id: service.id, order_id: order.id, quote_id: q.id, kind: order.kind,
    base_version: service.state_version, old_plan_id: service.plan_id, new_plan_id: selected.id,
    old_quantity: service.quantity, new_quantity: item.requested_quantity, term_start: service.term_start, term_end: service.term_end,
    effective_on: change.date, old_annual_amount: change.oldAnnual, new_annual_amount: change.newAnnual,
    remaining_days: change.remaining, term_days: change.term, prorated_amount: amount, currency: 'AED', status: 'quoted',
  });
  await update(db, 'quotes', q.id, { status: 'sent', issued_at: new Date() });
  const result = await update(db, 'orders', order.id, { status: 'quoted', customer_status_note: null });
  return { record: result, message: 'Quote finalized.', entity: 'order', customerId: order.customer_id };
}
export function approve(db, actor, body) {
  return acceptQuote(db, actor, body.id, body.reference);
}

export async function acceptQuote(db, actor, orderId, referenceText, customerQuoteId) {
  const order = await requestRow(db, orderId);
  requireValue(order.status === 'quoted', 'Finalize a quote first.', 409);
  const evidence = string(referenceText, 'approval reference', note);
  const q = await requiredRow(db, "SELECT * FROM quotes WHERE order_id=$1 AND status='sent' AND expires_at>now() ORDER BY version DESC LIMIT 1 FOR UPDATE",
    [order.id], 'Current unexpired quote');
  requireValue(!customerQuoteId || q.id === customerQuoteId, 'The quote has changed. Refresh the request before accepting.', 409);
  await update(db, 'quotes', q.id, { status: 'accepted', accepted_at: new Date(), accepted_by: actor.id });
  await db.query("UPDATE service_changes SET status='approved' WHERE quote_id=$1 AND status='quoted'", [q.id]);
  await insert(db, 'order_messages', { customer_id: order.customer_id, order_id: order.id, author_id: actor.id,
    body: customerQuoteId ? evidence : 'Acceptance evidence: ' + evidence, visibility: customerQuoteId ? 'customer' : 'internal' });
  const result = await update(db, 'orders', order.id, { status: 'accepted' });
  return { record: result, message: 'Quote acceptance recorded.', entity: 'order', customerId: order.customer_id };
}

async function issue(db, client, segment, due, lines, quoteId = null) {
  const issued = await today(db);
  const address = await one(db, "SELECT line1,line2,country_code,region_text,city_text,postal_code FROM customer_addresses WHERE customer_id=$1 AND kind='billing' ORDER BY is_default DESC,id LIMIT 1", [client.id]);
  const invoice = await insert(db, 'invoices', { customer_id: client.id, invoice_no: reference('INV-' + issued.slice(0,4)),
    segment, currency: 'AED', quote_id: quoteId, billing_name: client.legal_name,
    billing_address: address || {}, billing_tax_no: client.tax_registration_no });
  const records = [];
  for (const [index, line] of lines.entries()) records.push(await insert(db, 'invoice_lines', {
    customer_id: client.id, invoice_id: invoice.id, line_no: index + 1, ...line,
  }));
  const result = await update(db, 'invoices', invoice.id, { status: 'issued', issued_on: issued,
    due_on: due < issued ? issued : due, finalized_at: new Date() });
  return { result, lines: records };
}
export async function invoiceOrder(db, actor, body) {
  const order = await requestRow(db, body.id);
  requireValue(order.status === 'accepted', 'Record client acceptance before issuing an invoice.', 409);
  const due = day(body.due_on, 'due date');
  requireValue(due >= await today(db), 'Choose a due date on or after the issue date.');
  const q = await requiredRow(db, "SELECT * FROM quotes WHERE order_id=$1 AND status='accepted'", [order.id], 'Accepted quote');
  const client = await clientRecord(db, order.customer_id);
  const change = await one(db, "SELECT * FROM service_changes WHERE quote_id=$1 AND status='approved' FOR UPDATE", [q.id]);
  if (change) {
    const s = await serviceRecord(db, change.service_id, true);
    requireValue(s.state_version === change.base_version, 'The service changed after quotation. Reconcile this request before invoicing.', 409);
  }
  const quoted = await rows(db, 'SELECT * FROM quote_lines WHERE quote_id=$1 ORDER BY id', [q.id]);
  requireValue(quoted.length > 0, 'The accepted quote has no lines.');
  const { result } = await issue(db, client, order.segment, due, quoted.map((line, index) => ({
    charge_type: change && !index ? 'proration' : 'new_order', order_id: order.id,
    service_id: change && !index ? change.service_id : null, service_change_id: change && !index ? change.id : null,
    description: line.description, quantity: line.quantity, unit_net: line.unit_net, discount_net: line.discount_net,
    tax_rate: line.tax_rate, net_amount: line.net_amount, tax_amount: line.tax_amount, pricing_snapshot: line.pricing_snapshot,
  })), q.id);
  await update(db, 'orders', order.id, { status: 'awaiting_payment' });
  return { record: result, message: 'Invoice issued.', entity: 'invoice', customerId: client.id };
}

export async function renew(db, actor, body, config) {
  const service = await serviceRecord(db, body.id, true);
  requireValue(service.billing_mode === 'annual' && service.term_start && service.term_end &&
    !['cancelled','terminated','provisioning'].includes(service.status), 'Choose a renewable annual service.');
  const duplicate = await one(db, `SELECT l.id FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
    WHERE l.service_id=$1 AND l.period_start=$2 AND l.charge_type='annual_renewal' AND i.status='issued' LIMIT 1`,
  [service.id, service.term_end]);
  requireValue(!duplicate, 'A renewal invoice already exists for this term.', 409);
  const total = money(service.recurring_unit_amount).mul(service.quantity);
  requireValue(total.gt(0), 'Record a positive recurring price before issuing a renewal.');
  const client = await clientRecord(db, service.customer_id);
  const request = await one(db, `SELECT o.id,coalesce(i.options->>'payment_link_requested_by',o.requested_by::text) AS requested_by,
    i.options->'request_payment_link'='true'::jsonb AS wants_link
    FROM orders o JOIN order_items i ON i.order_id=o.id
    WHERE o.customer_id=$1 AND i.existing_service_id=$2 AND o.kind='renewal'
    AND o.status IN ('under_review','needs_information','on_hold') ORDER BY o.created_at LIMIT 1 FOR UPDATE OF o`, [client.id,service.id]);
  const { result } = await issue(db, client, 'product', service.term_end, [{
    charge_type: 'annual_renewal', service_id: service.id, order_id: request?.id || null, description: service.title + ' · annual renewal',
    period_start: service.term_end, period_end: addMonths(service.term_end, 12), quantity: 1,
    ...pricing(total, service.tax_inclusive, config.taxRate), pricing_snapshot: { service_version: service.state_version },
  }]);
  if (request) await update(db, 'orders', request.id, { status: 'awaiting_payment', customer_status_note: null });
  if (request?.wants_link) {
    await queuePaymentLink(db, result, request.requested_by, client.billing_email, 'renewal-' + request.id);
  }
  return { record: result, message: 'Renewal invoice issued.', entity: 'invoice', customerId: client.id };
}
export async function contractInvoice(db, actor, body, config) {
  const contract = await requiredRow(db, "SELECT * FROM contracts WHERE id=$1 AND currency='AED' AND status='active' FOR UPDATE",
    [identifier(body.id, 'active contract')], 'Active contract');
  const schedule = await requiredRow(db, 'SELECT * FROM billing_schedules WHERE contract_id=$1 AND active FOR UPDATE',
    [contract.id], 'Active billing schedule');
  const cycle = period({ ...contract, ...schedule, billing_cycle_months: contract.billing_cycle_months });
  requireValue(cycle && money(cycle.gross).gt(0), 'There is no billable instalment remaining.', 409);
  const client = await clientRecord(db, contract.customer_id);
  const { result, lines } = await issue(db, client, 'service', cycle.due, [{
    charge_type: 'contract_instalment', contract_id: contract.id, description: contract.title + ' · ' + cycle.start, quantity: 1,
    period_start: cycle.start, period_end: cycle.end, ...pricing(cycle.gross, contract.tax_inclusive, config.taxRate),
    pricing_snapshot: { cycle_months: cycle.months, scheduled_due: cycle.due },
  }]);
  await insert(db, 'billing_occurrences', { customer_id: client.id, schedule_id: schedule.id,
    invoice_line_id: lines[0].id, period_start: cycle.start, period_end: cycle.end, due_date: cycle.due });
  const elapsed = (Number(cycle.end.slice(0, 4)) - Number(contract.start_date.slice(0, 4))) * 12
    + Number(cycle.end.slice(5, 7)) - Number(contract.start_date.slice(5, 7));
  await update(db, 'billing_schedules', schedule.id, { next_period_start: cycle.end,
    next_due_date: addMonths(schedule.anchor_date, elapsed), active: cycle.end < contract.end_date });
  return { record: result, message: 'Instalment invoice issued.', entity: 'invoice', customerId: client.id };
}

async function invoiceRecord(db, value) {
  return requiredRow(db, `SELECT i.* FROM invoices i JOIN customers c ON c.id=i.customer_id
    WHERE i.id=$1 AND i.currency='AED' AND c.currency='AED' AND i.status='issued' FOR UPDATE OF i`,
  [identifier(value, 'invoice')], 'Issued invoice');
}
async function balance(db, invoice) {
  return requiredRow(db, 'SELECT * FROM invoice_balances WHERE id=$1', [invoice.id], 'Invoice balance');
}
async function settlementReview(db, actor, invoice, message) {
  await audit(db, actor, 'settlement_review', 'invoice', invoice.id, invoice.customer_id, { label: message });
}
async function finishRenewal(db, actor, invoice, line) {
  const service = await serviceRecord(db, line.service_id, true);
  const version = line.pricing_snapshot?.service_version;
  if (!line.period_start || !line.period_end || line.period_start !== service.term_end ||
    ['cancelled','terminated'].includes(service.status) || (version && version !== service.state_version)) {
    await settlementReview(db, actor, invoice, 'Payment recorded. Review the changed service before applying renewal.');
    return false;
  }
  await insert(db, 'renewals', { customer_id: service.customer_id, service_id: service.id, invoice_line_id: line.id,
    old_term_start: service.term_start, old_term_end: service.term_end, new_term_start: line.period_start,
    new_term_end: line.period_end, state_version_before: service.state_version });
  await update(db, 'services', service.id, { term_start: line.period_start, term_end: line.period_end, next_due_date: line.period_end,
    registration_term_years: 1, status: 'active', state_version: service.state_version + 1 });
  await db.query("UPDATE provider_subscriptions SET ends_on=$1 WHERE service_id=$2 AND status='active'", [line.period_end, service.id]);
  return true;
}
async function finishChange(db, actor, invoice, line) {
  const change = await requiredRow(db, 'SELECT * FROM service_changes WHERE id=$1 FOR UPDATE', [line.service_change_id], 'Service change');
  const service = await serviceRecord(db, change.service_id, true);
  if (change.status !== 'approved' || service.state_version !== change.base_version ||
    service.term_end !== change.term_end || service.status !== 'active' || service.term_end <= await today(db)) {
    await settlementReview(db, actor, invoice, 'Payment recorded. Review the changed service before applying the upgrade.');
    return false;
  }
  const snapshot = line.pricing_snapshot || {};
  const annualUnit = snapshot.target_unit_amount ?? money(change.new_annual_amount).div(change.new_quantity).toFixed(4);
  const fields = { plan_id: change.new_plan_id, quantity: change.new_quantity, recurring_unit_amount: annualUnit,
    state_version: service.state_version + 1 };
  if (change.kind === 'hosting_upgrade') Object.assign(fields, { purchased_unit_amount: annualUnit, discount_pct: 0,
    tax_inclusive: snapshot.target_tax_inclusive ?? service.tax_inclusive });
  await update(db, 'services', service.id, fields);
  await update(db, 'service_changes', change.id, { status: 'applied', applied_at: new Date() });
  return true;
}
export async function payment(db, actor, body) {
  const invoice = await invoiceRecord(db, body.id);
  const before = await balance(db, invoice);
  const amount = numeric(body.amount, '0.01', '999999999999', 'receipt amount');
  requireValue(money(amount).lte(before.balance), 'Receipt amount exceeds the outstanding balance.', 409);
  const date = day(body.received_on, 'receipt date');
  requireValue(date <= await today(db), 'The receipt date cannot be in the future.');
  const bankReference = string(body.reference, 'bank reference', { max: 120 });
  await lock(db, 'bank:' + invoice.customer_id + ':' + bankReference.toLowerCase());
  const duplicate = await one(db, "SELECT id FROM payments WHERE customer_id=$1 AND method='bank_transfer' AND lower(provider_payment_id)=lower($2)",
    [invoice.customer_id, bankReference]);
  requireValue(!duplicate, 'This bank reference has already been recorded for the client.', 409);
  const receipt = await insert(db, 'payments', { customer_id: invoice.customer_id, currency: 'AED', method: 'bank_transfer',
    provider_payment_id: bankReference, amount, status: 'captured', received_at: date + 'T12:00:00+04:00', verified_by: actor.id });
  await insert(db, 'payment_allocations', { customer_id: invoice.customer_id, invoice_id: invoice.id, currency: 'AED', payment_id: receipt.id, amount });
  const after = await balance(db, invoice);
  if (money(after.balance).eq(0)) {
    await db.query("UPDATE payment_requests SET status='cancelled' WHERE invoice_id=$1 AND status='queued' AND message=$2",
      [invoice.id,paymentLinkRequestMessage]);
    if (money(after.credited_amount).gt(0)) await settlementReview(db, actor, invoice, 'Invoice settled with credits. Review fulfilment manually.');
    else {
      const lines = await rows(db, 'SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no', [invoice.id]);
      for (const line of lines) {
        const renewal = line.charge_type === 'annual_renewal' && line.service_id;
        const renewed = renewal && await finishRenewal(db, actor, invoice, line);
        if (line.order_id) {
          const order = await requestRow(db, line.order_id);
          if (order.status !== 'awaiting_payment') continue;
          const status = renewal ? renewed ? 'completed' : 'paid' : line.service_change_id
            ? await finishChange(db, actor, invoice, line) ? 'completed' : 'paid'
            : 'fulfilling';
          await update(db, 'orders', order.id, { status });
        }
      }
    }
  }
  return { record: invoice, message: 'Bank receipt recorded.', entity: 'invoice', customerId: invoice.customer_id };
}
export async function fulfill(db, actor, body) {
  const order = await requestRow(db, body.id);
  const cancel = order.kind === 'cancellation';
  requireValue(cancel ? reviewing.includes(order.status) : order.status === 'fulfilling', 'This request is not ready to complete.', 409);
  const detail = string(body.reference, 'completion notes', note);
  const [item] = await orderItems(db, order.id);
  if (cancel) {
    const service = await serviceRecord(db, item?.existing_service_id, true);
    requireValue(service.customer_id === order.customer_id, 'The service belongs to another client.');
    await update(db, 'services', service.id, { status: 'cancelled', state_version: service.state_version + 1,
      terminated_at: new Date(), termination_reason: detail });
    await db.query('UPDATE billing_schedules SET active=false WHERE service_id=$1 AND active', [service.id]);
  } else if (order.kind === 'new_product' || body.service_id) {
    const service = await serviceRecord(db, body.service_id, true);
    requireValue(service.customer_id === order.customer_id && service.status === 'active' &&
      service.catalog_item_id === item?.catalog_item_id && (!item.requested_plan_id || service.plan_id === item.requested_plan_id) &&
      service.quantity >= (item.requested_quantity || 1), 'Choose an active matching product or service for this client.');
  }
  await insert(db, 'order_messages', { customer_id: order.customer_id, order_id: order.id, author_id: actor.id,
    body: 'Completion notes: ' + detail, visibility: 'internal' });
  const result = await update(db, 'orders', order.id, { status: 'completed' });
  return { record: result, message: 'Request completed.', entity: 'order', customerId: order.customer_id };
}

// Call after locking the invoice, or in the transaction that created it.
export async function queuePaymentLink(db, invoice, actorId, recipient, key) {
  const queued = await one(db, `SELECT id FROM payment_requests WHERE invoice_id=$1 AND status='queued' AND message=$2
    ORDER BY created_at,id LIMIT 1`, [invoice.id,paymentLinkRequestMessage]);
  return queued || insert(db, 'payment_requests', { customer_id: invoice.customer_id, invoice_id: invoice.id,
    requested_by: actorId, recipient_email: recipient, message: paymentLinkRequestMessage, idempotency_key: key });
}

export async function paymentLink(db, actor, body, config, requestId) {
  const invoice = await invoiceRecord(db, body.id);
  requireValue(money((await balance(db, invoice)).balance).gt(0), 'The invoice is already settled.', 409);
  const client = await clientRecord(db, invoice.customer_id);
  if (!body.url) {
    await queuePaymentLink(db, invoice, actor.id, client.billing_email, requestId);
  } else {
    const url = httpsLink(body.url, config.paymentHosts);
    const provider = await requiredRow(db, "SELECT id FROM providers WHERE id=$1 AND kind='payment' AND active",
      [identifier(body.gateway_id, 'payment provider')], 'Active payment provider');
    await db.query("UPDATE payment_links SET status='cancelled' WHERE invoice_id=$1 AND status='ready'", [invoice.id]);
    const link = await insert(db, 'payment_links', { customer_id: client.id, invoice_id: invoice.id,
      gateway_id: provider.id, url, provider_reference: reference('LINK'), expires_at: new Date(Date.now() + 7 * 86400000) });
    await db.query("UPDATE payment_requests SET payment_link_id=$1,status='cancelled' WHERE invoice_id=$2 AND status='queued' AND message=$3",
      [link.id, invoice.id, paymentLinkRequestMessage]);
  }
  return { record: invoice, message: body.url ? 'Payment link saved.' : 'Payment link requested.', entity: 'invoice', customerId: client.id };
}
export async function reminder(db, actor, body, config, requestId) {
  const invoice = await invoiceRecord(db, body.id);
  const result = await balance(db, invoice);
  requireValue(money(result.balance).gt(0), 'The invoice is already settled.', 409);
  const client = await clientRecord(db, invoice.customer_id);
  const link = await one(db, "SELECT * FROM payment_links WHERE invoice_id=$1 AND status='ready' AND expires_at>now() ORDER BY created_at DESC LIMIT 1", [invoice.id]);
  const text = 'Invoice ' + invoice.invoice_no + ' has an outstanding balance of AED ' + money(result.balance).toFixed(2) +
    '. Due date: ' + invoice.due_on + '.' + (link ? '\nPayment link: ' + link.url : '');
  const request = await insert(db, 'payment_requests', { customer_id: client.id, invoice_id: invoice.id,
    payment_link_id: link?.id || null, requested_by: actor.id, recipient_email: client.billing_email,
    message: text, idempotency_key: requestId });
  return { record: invoice, message: 'Payment reminder recorded.', entity: 'invoice', customerId: client.id,
    mail: { to: client.billing_email, subject: 'Safcodes invoice reminder', text }, mailRequestId: request.id };
}
