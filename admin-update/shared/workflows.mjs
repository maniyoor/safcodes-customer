import { cloneSeed, TODAY } from './seed.mjs';
import { catalogGroups, clientDomains, lookup, marketingTypes, productTypes, projectTypes, providersFor, upgradeWorkspace } from './catalog-data.mjs';

export const categories = {
  domain: 'Domains', shared_hosting: 'Shared hosting', cloud_hosting: 'Cloud hosting',
  email: 'Business Emails', qr_code: 'QR codes', website: 'Websites', web_portal: 'Web portals',
  online_store: 'Online stores', mobile_app: 'Mobile apps', digital_marketing: 'Digital marketing',
  performance_marketing: 'Performance marketing', other: 'Other services',
};

export const kinds = {
  new_product: 'Product order', new_service: 'Service request',
  hosting_upgrade: 'Hosting upgrade', email_scale: 'Email scaling', renewal: 'Annual renewal', cancellation: 'Cancellation',
};

const number = new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = value => 'AED ' + number.format(Number(value || 0));
export const dateLabel = value => value ? new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(value)) : '—';
export const titleCase = value => String(value ?? '—').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
export const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
export const daysDue = value => value ? daysBetween(TODAY, value.slice(0, 10)) : Infinity;
export const dueLabel = value => {
  const days = daysDue(value);
  if (!Number.isFinite(days)) return '—';
  if (days === 0) return 'Due today';
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  return `In ${days} day${days === 1 ? '' : 's'}`;
};

const fail = (condition, message) => {
  if (!condition) throw new Error(message);
};
const row = (rows, id, label) => {
  const item = rows.find(record => record.id === id);
  fail(item, `${label} could not be found.`);
  return item;
};
export const id = () => globalThis.crypto?.randomUUID?.() ?? 'demo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
const cents = value => Math.round(Number(value) * 100);
const amount = value => (value / 100).toFixed(2);
const now = () => new Date().toISOString();
const emailAddress = (value, label) => {
  const email = required(value, label).toLowerCase();
  fail(/^\S+@[^\s@]+\.[^\s@]+$/.test(email) && email.split('@').length === 2, 'Enter a valid email address.');
  return email;
};
const hostname = (value, label) => {
  const domain = required(value, label).toLowerCase().replace(/\.$/, '');
  fail(domain.length <= 253 && domain.includes('.') && domain.split('.').every(part =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)), 'Enter a domain such as example.com.');
  return domain;
};
const optionalHttps = value => {
  const clean = String(value || '').trim();
  if (!clean) return '';
  let url;
  try { url = new URL(clean); } catch { throw new Error('Enter a valid HTTPS control panel link.'); }
  fail(url.protocol === 'https:' && !url.username && !url.password, 'Enter a valid HTTPS control panel link.');
  return url.href;
};
const activeEntry = (workspace, group, value, oldValue) => row(lookup(workspace, group, oldValue), value, catalogGroups[group]);
const clientProject = (data, projectId, customerId) => {
  if (!projectId) return null;
  const project = row(data.projects, projectId, 'Project');
  fail(project.customer_id === customerId, 'Select a project belonging to this client.');
  return project;
};
const required = (value, label) => {
  const clean = String(value ?? '').trim();
  fail(clean, `Enter ${label.toLowerCase()}.`);
  return clean;
};
const positive = (value, label) => {
  const clean = Number(value);
  fail(Number.isFinite(clean) && clean > 0, `Enter a valid ${label.toLowerCase()}.`);
  return clean;
};
const dateValue = (value, label) => {
  const clean = required(value, label);
  fail(/^\d{4}-\d{2}-\d{2}$/.test(clean) && Number.isFinite(Date.parse(clean)) && new Date(clean).toISOString().slice(0, 10) === clean, `Enter a valid ${label.toLowerCase()}.`);
  return clean;
};

export function addMonths(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const maxDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, maxDay))).toISOString().slice(0, 10);
}

export function freshWorkspace() {
  const data = cloneSeed();
  data.contracts[0].next_due_date = '2026-12-10';
  data.contracts[1].next_due_date = '2027-01-05';
  data.contracts[2].next_due_date = '2026-11-05';
  data.orders[4].quote_amount = '2500.00';
  data.orders[4].quote_note = 'Arabic language interface and quality assurance.';
  data.orders[4].quote_on = '2026-11-03';
  data.invoices[5].renewal_service_id = data.services[22].id;
  data.invoices[5].period_start = data.services[22].term_end;
  data.invoices[5].period_end = addMonths(data.services[22].term_end, 12);
  data.payments = data.invoices.filter(invoice => Number(invoice.paid_amount) > 0).map((invoice, index) => ({
    id: 'seed-payment-' + index, invoice_id: invoice.id, customer_id: invoice.customer_id,
    amount: invoice.paid_amount, reference: 'DEMO-TRX-' + (411 + index), received_on: index < 2 ? TODAY : invoice.due_on,
  }));
  return upgradeWorkspace(data);
}

export function annualRate(plan, service = {}) {
  const base = Number(service.plan_id === plan.id ? (service.purchased_unit_amount ?? plan.unit_amount) : plan.unit_amount);
  const discount = Number(service.plan_id === plan.id ? (service.discount_pct || 0) : 0);
  return amount(Math.round(cents(base) * (100 - discount) / 100));
}

export function estimateChange(service, plan, quantity, asOf = TODAY) {
  fail(service.status === 'active' && service.billing_mode === 'annual', 'An active annual service is required.');
  const term = daysBetween(service.term_start, service.term_end);
  const remaining = Math.min(term, Math.max(0, daysBetween(asOf, service.term_end)));
  fail(term > 0 && remaining > 0, 'Renew the service before changing the plan or quantity.');
  const newAnnual = cents(annualRate(plan, service)) * quantity;
  const oldAnnual = cents(service.recurring_unit_amount) * service.quantity;
  const annualDifference = newAnnual - oldAnnual;
  fail(annualDifference > 0, 'Choose an upgrade with a higher annual amount.');
  return { total: amount(Math.round(annualDifference * remaining / term)), remaining, term, annualDifference: amount(annualDifference), unitAmount: annualRate(plan, service) };
}

export function invoiceStatus(invoice) {
  if (Number(invoice.balance) <= 0) return 'paid';
  if (daysDue(invoice.due_on) < 0) return 'overdue';
  return Number(invoice.paid_amount) ? 'partially_paid' : 'open';
}

function contractPeriod(contract, index = contract.issued_periods ?? 0) {
  const cycle = contract.billing_cycle_months;
  const anchor = contract.schedule_anchor || contract.first_due_date;
  if (!anchor || !cycle) return null;
  const due = addMonths(anchor, index * cycle);
  if (!contract.coverage_anchor) {
    if (due >= contract.end_date) return null;
    const end = addMonths(anchor, (index + 1) * cycle);
    return { due, start: due, end: end < contract.end_date ? end : contract.end_date,
      months: cycle, gross: amount(Math.round(cents(contract.annual_value) * cycle / 12)) };
  }
  const covered = index * cycle;
  if (covered >= 12) return null;
  const next = Math.min(12, covered + cycle);
  const annual = cents(contract.annual_value);
  return {
    due, start: addMonths(contract.coverage_anchor, covered), end: addMonths(contract.coverage_anchor, next),
    months: next - covered, gross: amount(Math.round(annual * next / 12) - Math.round(annual * covered / 12)),
  };
}

export function contractBilling(workspace, contract, asOf = TODAY) {
  if (contract.live_billing) return contract.live_billing;
  const invoices = workspace.invoices.filter(invoice => invoice.contract_id === contract.id);
  const invoiceIds = new Set(invoices.map(invoice => invoice.id));
  const lastPayment = workspace.payments.filter(payment => invoiceIds.has(payment.invoice_id) && payment.received_on <= asOf)
    .map(payment => payment.received_on).sort().at(-1);
  const outstanding = invoices.filter(invoice => Number(invoice.balance) > 0);
  const late = outstanding.filter(invoice => invoice.due_on < asOf);
  const pastDueBalance = late.reduce((sum, invoice) => sum + cents(invoice.balance), 0);
  let months = late.reduce((sum, invoice) => sum + (invoice.coverage_months || contract.billing_cycle_months), 0);
  let unissued = 0;
  const upcoming = contract.status === 'active' ? contractPeriod(contract) : null;
  if (upcoming?.due < asOf) {
    const invoicePeriods = new Set(invoices.map(invoice => invoice.period_start));
    for (let index = contract.issued_periods ?? 0; index < 12; index++) {
      const period = contractPeriod(contract, index);
      if (!period || period.due >= asOf) break;
      if (invoicePeriods.has(period.start)) continue;
      months += period.months;
      unissued += cents(period.gross);
    }
  }
  const dueDate = [...outstanding.map(invoice => invoice.due_on), upcoming?.due].filter(Boolean).sort()[0];
  return {
    lastPayment, daysSincePayment: lastPayment ? daysBetween(lastPayment, asOf) : null, dueDate, dueDays: dueDate ? daysBetween(asOf, dueDate) : null,
    nextScheduled: upcoming?.due, nextAmount: upcoming?.gross, overdueMonths: months,
    overdueBalance: amount(pastDueBalance), unissuedOverdue: amount(unissued),
  };
}

export function canPerform(role, action) {
  if (role === 'admin') return true;
  if (role === 'finance') return ['quote', 'approve', 'invoiceOrder', 'renew', 'contractInvoice', 'payment', 'paymentLink', 'reminder'].includes(action);
  return ['note', 'ticket', 'ticketStatus', 'request', 'review', 'project'].includes(action);
}

function issueInvoice(data, values) {
  const gross = cents(positive(values.gross_amount, 'invoice amount'));
  const invoice = {
    id: id(), invoice_no: 'INV-2026-' + (1112 + data.invoices.length - 12),
    status: 'issued', currency: 'AED', issued_on: TODAY,
    ...values, gross_amount: amount(gross), paid_amount: '0.00', balance: amount(gross),
    payment_link_status: 'not_created',
  };
  data.invoices.unshift(invoice);
  return invoice;
}

function applyPaidInvoice(data, invoice) {
  if (invoice.renewal_service_id) {
    const service = row(data.services, invoice.renewal_service_id, 'Service');
    if (service.status === 'cancelled' || service.term_end !== invoice.period_start) {
      invoice.follow_up = 'The service term has changed. Review this payment before updating the renewal.';
      return;
    }
    service.term_start = invoice.period_start;
    service.term_end = invoice.period_end;
    service.next_due_date = invoice.period_end;
    service.term_years = 1;
    service.status = 'active';
    service.state_version++;
  }
  if (!invoice.order_id) return;
  const order = row(data.orders, invoice.order_id, 'Request');
  order.status = 'paid';
  if (!['hosting_upgrade', 'email_scale'].includes(order.kind)) {
    order.status = 'fulfilling';
    return;
  }
  const service = row(data.services, order.existing_service_id, 'Service');
  if (service.state_version !== order.service_version) {
    invoice.follow_up = 'The service changed after quotation. Review this payment before applying the change.';
    return;
  }
  const plan = row(data.plans, order.requested_plan_id, 'Plan');
  if (service.plan_id !== plan.id) {
    service.purchased_unit_amount = order.quoted_unit_amount;
    service.discount_pct = 0;
  }
  service.plan_id = plan.id;
  service.plan_name = plan.name;
  service.quantity = order.requested_quantity;
  service.recurring_unit_amount = order.quoted_unit_amount;
  service.state_version++;
  order.status = 'completed';
}

export function applyAction(workspace, action, payload, actor) {
  fail(canPerform(actor.role, action), 'This role does not have permission for that action.');
  const data = structuredClone(workspace);
  let target;
  let label;
  let demoDelivery;
  switch (action) {
    case 'customer': {
      const email = emailAddress(payload.billing_email, 'Registered email');
      const name = required(payload.contact_name || payload.display_name, 'Client name');
      const company = String(payload.company_name ?? payload.display_name ?? '').trim();
      fail(!data.customers.some(item => item.id !== payload.id && item.billing_email.toLowerCase() === email), 'This email is already assigned to a client.');
      target = payload.id ? row(data.customers, payload.id, 'Client') : {
        id: id(), customer_no: 'CUS-' + (1024 + data.customers.length), created_at: now(),
        portal_access: { status: 'pending' },
      };
      if (target.billing_email && target.billing_email !== email) target.portal_access = { status: 'pending' };
      const displayName = company || name;
      const mobile = String(payload.phone ?? '').trim();
      const prefix = String(payload.dial_code || '+971').trim();
      if (mobile) fail(/^\+?[0-9 ()-]{6,24}$/.test(mobile), 'Enter a valid mobile number.');
      if (!mobile.startsWith('+')) fail(/^\+\d{1,4}$/.test(prefix), 'Enter a dial code such as +971.');
      Object.assign(target, {
        display_name: displayName, legal_name: payload.legal_name?.trim() || company || name,
        company_name: company, contact_name: name, billing_email: email,
        phone: mobile && !mobile.startsWith('+') ? prefix + ' ' + mobile : mobile, dial_code: prefix,
        country: payload.country?.trim(), region: payload.region?.trim(), city: payload.city?.trim(),
        office_location: payload.office_location?.trim(), industry: payload.industry?.trim(),
        status: payload.status || 'active', currency: 'AED',
        initials: displayName.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(),
      });
      if (!payload.id) data.customers.unshift(target);
      label = payload.id ? 'Client updated' : 'Client added';
      break;
    }
    case 'clientAccess': {
      target = row(data.customers, payload.id, 'Client');
      fail(target.status === 'active', 'Activate the client record before approving access.');
      fail(target.portal_access?.status !== 'active', 'This client already has portal access.');
      const email = emailAddress(target.billing_email, 'Registered email');
      const token = new Uint8Array(10);
      globalThis.crypto.getRandomValues(token);
      const password = 'Sc!' + Array.from(token, byte => byte.toString(16).padStart(2, '0')).join('');
      target.portal_access = { status: 'active', approved_at: now(), approved_by: actor.name };
      demoDelivery = { email, password };
      label = 'Demo portal access approved';
      break;
    }
    case 'service': {
      const existing = payload.id ? row(data.services, payload.id, 'Product') : null;
      const customerId = existing?.customer_id || payload.customer_id;
      row(data.customers, customerId, 'Client');
      const item = row(data.catalog, existing?.catalog_item_id || payload.catalog_item_id, 'Product category');
      fail(productTypes.includes(item.category) && (item.active || existing), 'Choose a product category.');
      const plan = payload.plan_id ? row(data.plans, payload.plan_id, 'Plan') : null;
      if (plan) fail((plan.active || plan.id === existing?.plan_id) && plan.catalog_item_id === item.id, 'Choose a plan for this category.');
      if (item.category !== 'qr_code') fail(plan, 'Choose a plan or domain extension.');
      const start = dateValue(payload.term_start, 'Registration date');
      const years = Number(payload.term_years ?? 1);
      fail(Number.isInteger(years) && years >= 1 && years <= 10, 'Select a registration term from 1 to 10 years.');
      const end = existing && existing.term_start === start && Number(existing.term_years || 1) === years
        ? existing.term_end : addMonths(start, years * 12);
      const quantity = item.category === 'email' ? Number(payload.quantity) : 1;
      fail(Number.isInteger(quantity) && quantity > 0 && quantity <= 10000, 'Enter a valid license quantity.');
      const rate = positive(payload.purchased_unit_amount || plan?.unit_amount || payload.recurring_unit_amount, 'Annual unit price');
      const discount = Number(payload.discount_pct || 0);
      fail(Number.isFinite(discount) && discount >= 0 && discount < 100, 'Discount must be at least 0% and below 100%.');
      const net = Math.round(cents(rate) * (100 - discount) / 100);
      fail(net > 0, 'The discounted annual price must be at least AED 0.01.');
      const status = payload.status || 'active';
      fail(['active', 'suspended', 'expired', 'cancelled', 'provisioning'].includes(status), 'Choose a product status.');
      const requiresDomain = ['shared_hosting', 'cloud_hosting', 'email'].includes(item.category);
      const providerId = payload.provider_id || plan?.provider_id || existing?.provider_id;
      if (providerId) row(providersFor(data, item.category, existing?.provider_id), providerId, 'Provider');
      if (item.category === 'domain' || item.category === 'email') fail(providerId, 'Select a provider.');
      if (plan?.provider_id) fail(plan.provider_id === providerId, 'Select a plan for this email provider.');
      let domain = null;
      let linked = null;
      if (item.category === 'domain') {
        const base = required(payload.domain_label || payload.domain_name, 'Domain name').toLowerCase().replace(/\.$/, '');
        const extension = plan.name.toLowerCase();
        const originalDomain = existing?.plan_id === plan.id && base === existing.domain_name?.toLowerCase();
        fail(originalDomain || !base.includes('.') || base.endsWith(extension), 'Enter the domain label or a name matching the selected extension.');
        domain = hostname(originalDomain || base.endsWith(extension) ? base : base + extension, 'Domain name');
        fail(!data.services.some(service => service.id !== existing?.id && service.category === 'domain' &&
          service.status !== 'cancelled' && service.domain_name?.toLowerCase() === domain), 'This domain is already registered in the workspace.');
      } else if (requiresDomain) {
        if (payload.domain_service_id === 'other') domain = hostname(payload.other_domain || payload.domain_name, 'External domain');
        else {
          linked = row(clientDomains(data, customerId, existing?.domain_service_id), payload.domain_service_id, 'Client domain');
          domain = linked.domain_name;
        }
      }
      target = existing || {
        id: id(), service_no: 'SVC-' + (1024 + data.services.length), created_at: now(), state_version: 1,
      };
      const oldDomain = target.domain_name;
      const planChanged = existing && (existing.plan_id !== plan?.id || Number(existing.recurring_unit_amount) !== net / 100
        || existing.quantity !== quantity || existing.term_start !== start || existing.term_end !== end || existing.status !== status);
      Object.assign(target, {
        customer_id: customerId, title: item.category === 'domain' ? domain : required(payload.title, 'Product title'),
        category: item.category, catalog_item_id: item.id, plan_id: plan?.id || null, plan_name: plan?.name || 'Custom scope',
        provider_id: providerId || null, provider_reference: payload.provider_reference?.trim(),
        control_panel_url: optionalHttps(payload.control_panel_url),
        term_start: start, term_end: end, term_years: years, next_due_date: end,
        billing_mode: 'annual', currency: 'AED', purchased_unit_amount: amount(cents(rate)),
        recurring_unit_amount: amount(net), discount_pct: discount, quantity,
        domain_name: domain, domain_service_id: linked?.id || null,
        status, health: existing?.health || 'healthy',
      });
      if (planChanged) target.state_version++;
      if (!existing) data.services.unshift(target);
      if (item.category === 'domain' && oldDomain !== domain) {
        for (const service of data.services.filter(item => item.domain_service_id === target.id)) service.domain_name = domain;
      }
      label = existing ? 'Product updated' : 'Product added';
      break;
    }
    case 'marketing': {
      const existing = payload.id ? row(data.services, payload.id, 'Marketing account') : null;
      const customerId = existing?.customer_id || payload.customer_id;
      row(data.customers, customerId, 'Client');
      const activityIds = [...new Set(payload.activity_ids || [])];
      fail(activityIds.length > 0, 'Select at least one marketing activity.');
      for (const activityId of activityIds) activeEntry(data, 'marketing', activityId, existing?.activity_ids?.includes(activityId) ? activityId : undefined);
      const start = dateValue(payload.term_start, 'Start date');
      const end = dateValue(payload.term_end, 'End date');
      fail(end > start, 'Choose an end date after the start date.');
      const category = existing?.category || 'digital_marketing';
      const catalog = data.catalog.find(item => item.category === category);
      target = existing || { id: id(), service_no: 'SVC-' + (1024 + data.services.length), state_version: 1, created_at: now() };
      Object.assign(target, {
        title: required(payload.title, 'Account title'), customer_id: customerId, category, catalog_item_id: catalog.id,
        activity_ids: activityIds, term_start: start, term_end: end, scope: payload.scope?.trim(),
        billing_mode: 'contract', plan_name: 'Marketing account', quantity: 1, recurring_unit_amount: '0.00',
        status: payload.status || 'active', currency: 'AED', health: 'healthy',
      });
      if (!existing) data.services.unshift(target);
      label = existing ? 'Marketing account updated' : 'Marketing account added';
      break;
    }
    case 'serviceStatus': {
      target = row(data.services, payload.id, 'Service');
      required(payload.reason, 'Reason');
      fail(['active', 'suspended', 'cancelled'].includes(payload.status), 'Select a valid service status.');
      fail(target.status !== 'expired' || payload.status !== 'active', 'Use a renewal invoice to reactivate an expired service.');
      target.status = payload.status;
      target.status_reason = payload.reason.trim();
      target.state_version++;
      label = 'Service status updated';
      break;
    }
    case 'request': {
      const kind = payload.kind;
      fail(Object.hasOwn(kinds, kind), 'Choose a request type.');
      row(data.customers, payload.customer_id, 'Client');
      const existing = payload.existing_service_id ? row(data.services, payload.existing_service_id, 'Service') : null;
      if (existing) fail(existing.customer_id === payload.customer_id, 'Choose a service for this client.');
      const plan = payload.requested_plan_id ? row(data.plans, payload.requested_plan_id, 'Plan') : null;
      const catalogId = existing?.catalog_item_id ?? payload.catalog_item_id;
      const item = row(data.catalog, catalogId, 'Product or service');
      fail(item.active, 'This category is unavailable for new requests.');
      let estimate = plan ? amount(cents(plan.unit_amount)) : '0.00';
      let qty = 1;
      if (['hosting_upgrade', 'email_scale'].includes(kind)) {
        fail(existing && plan && plan.active && plan.catalog_item_id === existing.catalog_item_id, 'Select a valid current service and plan.');
        if (kind === 'hosting_upgrade') {
          const current = row(data.plans, existing.plan_id, 'Current plan');
          fail(['shared_hosting', 'cloud_hosting'].includes(existing.category) && plan.tier_rank > current.tier_rank, 'Choose a higher hosting plan in the same family.');
          qty = existing.quantity;
        } else {
          qty = Number(payload.requested_quantity);
          fail(existing.category === 'email' && plan.id === existing.plan_id && Number.isInteger(qty) && qty > existing.quantity && qty <= 10000, 'Enter a larger whole number of email seats.');
        }
        estimate = estimateChange(existing, plan, qty).total;
      } else if (kind === 'cancellation') {
        fail(existing, 'Select a service to cancel.');
      } else {
        fail(item.segment === (kind === 'new_product' ? 'product' : 'service'), 'Choose a matching category.');
        if (data.plans.some(choice => choice.active && choice.catalog_item_id === item.id)) fail(plan, 'Choose a plan.');
        if (plan) fail(plan.active && plan.catalog_item_id === item.id, 'Choose a plan for this category.');
      }
      target = {
        id: id(), order_no: 'REQ-' + (1061 + data.orders.length), customer_id: payload.customer_id,
        title: required(payload.title, 'Request title'), brief: required(payload.brief, 'Request details'),
        kind, catalog_item_id: item.id, requested_plan_id: plan?.id ?? null, existing_service_id: existing?.id ?? null,
        segment: item.segment, estimate, requested_quantity: qty, created_at: now(), currency: 'AED',
        status: 'under_review', messages: [],
      };
      data.orders.unshift(target);
      label = 'Request created';
      break;
    }
    case 'review': {
      target = row(data.orders, payload.id, 'Request');
      fail(['under_review', 'needs_information', 'on_hold'].includes(target.status), 'This request already moved past review.');
      fail(['under_review', 'needs_information', 'on_hold', 'declined'].includes(payload.status), 'Choose a review status.');
      target.status = payload.status;
      target.customer_status_note = String(payload.customer_status_note || '').trim();
      if (target.status === 'needs_information') required(target.customer_status_note, 'Information needed');
      label = 'Request reviewed';
      break;
    }
    case 'quote': {
      target = row(data.orders, payload.id, 'Request');
      fail(['under_review', 'needs_information', 'on_hold', 'quoted'].includes(target.status) && target.kind !== 'cancellation', 'This request is not available for quotation.');
      let quote = positive(payload.quote_amount, 'quote amount');
      if (['hosting_upgrade', 'email_scale'].includes(target.kind)) {
        const service = row(data.services, target.existing_service_id, 'Service');
        const plan = row(data.plans, target.requested_plan_id, 'Plan');
        const estimate = estimateChange(service, plan, target.requested_quantity);
        quote = Number(estimate.total);
        target.service_version = service.state_version;
        target.quoted_unit_amount = estimate.unitAmount;
      }
      target.customer_status_note = '';
      target.quote_amount = quote.toFixed(2);
      target.quote_note = required(payload.quote_note, 'Quote terms');
      target.quote_on = TODAY;
      target.status = 'quoted';
      label = 'Quote finalized';
      break;
    }
    case 'approve': {
      target = row(data.orders, payload.id, 'Request');
      fail(target.status === 'quoted', 'Finalize a quote first.');
      target.approval_reference = required(payload.reference, 'Approval reference');
      target.status = 'accepted';
      label = 'Quote acceptance recorded';
      break;
    }
    case 'invoiceOrder': {
      const order = row(data.orders, payload.id, 'Request');
      fail(order.status === 'accepted', 'Record client acceptance before issuing an invoice.');
      const due = dateValue(payload.due_on, 'Due date');
      fail(due >= TODAY, 'Choose a due date on or after the issue date.');
      target = issueInvoice(data, { customer_id: order.customer_id, description: order.title, segment: order.segment,
        charge_type: order.kind, order_id: order.id, gross_amount: order.quote_amount, due_on: due });
      order.invoice_id = target.id;
      order.status = 'invoiced';
      label = 'Invoice issued';
      break;
    }
    case 'fulfill': {
      target = row(data.orders, payload.id, 'Request');
      fail(target.status === 'fulfilling' || (target.kind === 'cancellation' && target.status === 'under_review'), 'This request is not ready to complete.');
      target.fulfillment_reference = required(payload.reference, 'Completion notes');
      if (target.kind === 'cancellation') {
        const service = row(data.services, target.existing_service_id, 'Service');
        service.status = 'cancelled';
        service.state_version++;
      }
      target.status = 'completed';
      label = 'Request completed';
      break;
    }
    case 'renew': {
      const service = row(data.services, payload.id, 'Service');
      fail(service.billing_mode === 'annual' && service.status !== 'cancelled', 'Select an annual service eligible for renewal.');
      fail(!data.invoices.some(invoice => invoice.renewal_service_id === service.id && invoice.period_start === service.term_end), 'A renewal invoice already exists for this term.');
      target = issueInvoice(data, { customer_id: service.customer_id, description: service.title + ' · annual renewal',
        segment: 'product', charge_type: 'annual_renewal', renewal_service_id: service.id,
        period_start: service.term_end, period_end: addMonths(service.term_end, 12), due_on: service.term_end,
        gross_amount: amount(cents(service.recurring_unit_amount) * service.quantity) });
      label = 'Renewal invoice issued';
      break;
    }
    case 'contract': {
      const existing = payload.id ? row(data.contracts, payload.id, 'Contract') : null;
      const customerId = existing?.customer_id || payload.customer_id;
      row(data.customers, customerId, 'Client');
      const billed = existing && data.invoices.some(invoice => invoice.contract_id === existing.id);
      const amcPlan = activeEntry(data, 'amc', payload.amc_plan_id || existing?.amc_plan_id, existing?.amc_plan_id);
      const project = clientProject(data, payload.project_id, customerId);
      const status = payload.status || existing?.status || 'active';
      fail(['active', 'suspended', 'cancelled', 'completed'].includes(status), 'Choose a contract status.');
      target = existing || { id: id(), contract_no: 'AMC-' + (1001 + data.contracts.length),
        customer_id: customerId, currency: 'AED', service_ids: [] };
      if (!billed) {
        const cycle = activeEntry(data, 'cycle', payload.cycle_id || existing?.cycle_id, existing?.cycle_id);
        const months = existing && existing.cycle_id === cycle.id ? existing.billing_cycle_months : cycle.months;
        const start = dateValue(payload.start_date, 'Start date');
        const first = dateValue(payload.first_due_date, 'First payment date');
        const end = addMonths(start, 12);
        const annual = positive(payload.annual_value, 'Annual value');
        fail(first >= start && first < end, 'Choose a first payment date within the contract year.');
        fail(cents(annual) >= 12, 'The annual value must be at least AED 0.12.');
        Object.assign(target, {
          cycle_id: cycle.id, billing_cycle_months: months, annual_value: annual.toFixed(2),
          start_date: start, end_date: end, first_due_date: first, next_due_date: first,
          schedule_anchor: first, coverage_anchor: start, issued_periods: 0,
          monthly_equivalent: (annual / 12).toFixed(2), indicative_instalment: (annual * months / 12).toFixed(2),
        });
      }
      Object.assign(target, {
        title: required(payload.title, 'Contract title'), amc_plan_id: amcPlan.id, contract_type: amcPlan.name,
        scope: required(payload.scope, 'Scope'), project_id: project?.id ?? null,
        project_name: project?.title || payload.project_name?.trim(), status,
      });
      if (project?.service_id && !target.service_ids.includes(project.service_id)) target.service_ids.push(project.service_id);
      if (!existing) data.contracts.unshift(target);
      label = existing ? 'Contract updated' : 'Contract added';
      break;
    }
    case 'contractInvoice': {
      const contract = row(data.contracts, payload.id, 'Contract');
      const period = contractPeriod(contract);
      fail(contract.status === 'active' && period, 'This contract has no remaining billing period.');
      fail(!data.invoices.some(invoice => invoice.contract_id === contract.id && invoice.period_start === period.start), 'An invoice already exists for this period.');
      target = issueInvoice(data, {
        customer_id: contract.customer_id, contract_id: contract.id, description: contract.title + ' · ' + dateLabel(period.start),
        segment: 'service', charge_type: 'contract_instalment', gross_amount: period.gross, due_on: period.due,
        period_start: period.start, period_end: period.end, coverage_months: period.months,
      });
      contract.issued_periods = (contract.issued_periods ?? 0) + 1;
      contract.next_due_date = contractPeriod(contract)?.due || null;
      label = 'Contract invoice issued';
      break;
    }
    case 'payment': {
      target = row(data.invoices, payload.id, 'Invoice');
      const reference = required(payload.reference, 'Payment reference');
      const received = dateValue(payload.received_on, 'Payment date');
      const paid = cents(positive(payload.amount, 'Payment amount'));
      fail(paid > 0 && paid <= cents(target.balance), 'Payment must be greater than zero and within the outstanding balance.');
      fail(!data.payments.some(item => item.customer_id === target.customer_id && item.reference.toLowerCase() === reference.toLowerCase()), 'This payment reference is already recorded.');
      data.payments.unshift({ id: id(), invoice_id: target.id, customer_id: target.customer_id, reference, amount: amount(paid), received_on: received });
      target.paid_amount = amount(cents(target.paid_amount) + paid);
      target.balance = amount(cents(target.balance) - paid);
      if (Number(target.balance) === 0) applyPaidInvoice(data, target);
      label = 'Payment recorded';
      break;
    }
    case 'paymentLink': {
      target = row(data.invoices, payload.id, 'Invoice');
      fail(Number(target.balance) > 0, 'The invoice is already settled.');
      const value = String(payload.url || '').trim();
      if (value) {
        let url;
        try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS link.'); }
        fail(url.protocol === 'https:' && !url.username && !url.password, 'Enter a valid HTTPS link.');
      }
      target.payment_link = value;
      target.payment_link_status = value ? 'ready' : 'requested';
      label = value ? 'Payment link saved' : 'Payment link requested';
      break;
    }
    case 'reminder': {
      target = row(data.invoices, payload.id, 'Invoice');
      fail(Number(target.balance) > 0, 'The invoice is already settled.');
      data.notifications.unshift({ id: id(), invoice_id: target.id, status: 'queued', created_at: now(), title: 'Reminder queued for ' + target.invoice_no });
      label = 'Demo reminder queued';
      break;
    }
    case 'note': {
      const type = payload.collection === 'tickets' ? 'tickets' : 'orders';
      target = row(data[type], payload.id, type === 'tickets' ? 'Ticket' : 'Request');
      target.messages.push({ id: id(), author_name: actor.name, body: required(payload.body, 'Message'),
        visibility: payload.visibility === 'customer' ? 'customer' : 'internal', created_at: now() });
      label = payload.visibility === 'customer' ? 'Demo reply saved' : 'Internal note added';
      break;
    }
    case 'ticket': {
      row(data.customers, payload.customer_id, 'Client');
      target = { id: id(), ticket_no: 'TKT-' + (2017 + data.tickets.length), customer_id: payload.customer_id,
        subject: required(payload.subject, 'Subject'), priority: payload.priority, status: 'open',
        created_at: now(), messages: [{ id: id(), author_name: actor.name, visibility: 'internal',
          body: required(payload.body, 'Description'), created_at: now() }] };
      data.tickets.unshift(target);
      label = 'Ticket created';
      break;
    }
    case 'ticketStatus': {
      target = row(data.tickets, payload.id, 'Ticket');
      fail(['open', 'in_progress', 'awaiting_client', 'resolved'].includes(payload.status), 'Select a valid ticket status.');
      target.status = payload.status;
      target.assigned_to = payload.assigned_to || null;
      label = 'Ticket updated';
      break;
    }
    case 'project': {
      const existing = payload.id ? row(data.projects, payload.id, 'Project') : null;
      const customerId = existing?.customer_id || payload.customer_id;
      row(data.customers, customerId, 'Client');
      const category = payload.project_type || existing?.project_type;
      fail(projectTypes.includes(category), 'Choose a project type.');
      const technology = activeEntry(data, 'technology', payload.technology_id, existing?.technology_id);
      fail(technology.project_type === category, 'Choose a technology for this project type.');
      const start = dateValue(payload.start_date, 'Start date');
      const end = dateValue(payload.target_date, 'Target date');
      fail(end >= start, 'Choose a target date on or after the start.');
      const progress = Number(payload.progress);
      fail(Number.isInteger(progress) && progress >= 0 && progress <= 100, 'Progress must be between 0 and 100.');
      const service = existing?.service_id ? row(data.services, existing.service_id, 'Project subscription') : {
        id: id(), service_no: 'SVC-' + (1024 + data.services.length), state_version: 1, created_at: now(),
        plan_name: 'Custom scope', quantity: 1, recurring_unit_amount: '0.00', currency: 'AED',
        billing_mode: 'project', health: 'healthy', status: 'active',
      };
      const item = data.catalog.find(record => record.category === category);
      const name = required(payload.title, 'Project title');
      Object.assign(service, { customer_id: customerId, title: name, category, catalog_item_id: item.id });
      if (service.billing_mode === 'project') Object.assign(service, { term_start: start, term_end: end });
      if (!existing?.service_id) data.services.unshift(service);
      target = existing || { id: id(), service_id: service.id };
      Object.assign(target, { customer_id: customerId, title: name, project_type: category, technology_id: technology.id,
        tech_stack: technology.name, progress, phase: required(payload.phase, 'Project phase'), start_date: start, target_date: end,
        manager: payload.manager?.trim(), scope: payload.scope?.trim(), maintenance_included: payload.maintenance_included === 'true',
        status: progress === 100 ? 'completed' : 'ongoing' });
      if (!existing) data.projects.unshift(target);
      label = existing ? 'Project updated' : 'Project added';
      break;
    }
    case 'plan': {
      const existing = payload.id ? row(data.plans, payload.id, 'Plan') : null;
      const item = row(data.catalog, existing?.catalog_item_id || payload.catalog_item_id, 'Product category');
      fail(productTypes.includes(item.category), 'Choose a product category.');
      const name = required(payload.name || existing?.name, item.category === 'domain' ? 'Domain extension' : 'Plan name');
      if (item.category === 'domain') fail(/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(name), 'Use an extension such as .ae or .co.uk.');
      const provider = item.category === 'email' ? row(providersFor(data, 'email', existing?.provider_id), existing?.provider_id || payload.provider_id, 'Email provider') : null;
      fail(!data.plans.some(plan => plan.id !== existing?.id && plan.catalog_item_id === item.id && (plan.provider_id || null) === (provider?.id || null)
        && plan.name.toLowerCase() === name.toLowerCase()), 'A plan with this name already exists.');
      const tier = Number(payload.tier_rank || existing?.tier_rank || 1);
      fail(Number.isInteger(tier) && tier > 0 && tier <= 99, 'Enter a valid plan tier.');
      target = existing || { id: id(), code: 'plan-' + id(), catalog_item_id: item.id, category: item.category, currency: 'AED',
        term_months: 12, unit: item.category === 'email' ? 'seat' : item.category === 'domain' ? 'domain' : 'service', specifications: {} };
      Object.assign(target, { name, unit_amount: positive(payload.unit_amount, 'Annual rate').toFixed(2), tier_rank: tier,
        provider_id: provider?.id, active: String(payload.active) !== 'false' });
      target.specifications.summary = required(payload.summary, 'Plan details');
      if (!existing) data.plans.unshift(target);
      label = existing ? 'Catalogue plan updated' : 'Catalogue plan added';
      break;
    }
    case 'catalogEntry': {
      const existing = payload.id ? row(data.catalog_entries, payload.id, 'Catalogue item') : null;
      const group = existing?.group || payload.group;
      fail(Object.hasOwn(catalogGroups, group), 'Choose a catalogue type.');
      const name = required(payload.name, 'Item name');
      const category = group === 'technology' ? (existing?.project_type || payload.project_type) : undefined;
      if (category !== undefined || group === 'technology') fail(projectTypes.includes(category), 'Choose a project type.');
      const months = group === 'cycle' ? Number(payload.months) : undefined;
      if (group === 'cycle') {
        fail(Number.isInteger(months) && months >= 1 && months <= 12, 'Choose a billing interval from 1 to 12 months.');
        fail(!data.catalog_entries.some(item => item.id !== existing?.id && item.group === group && item.months === months), 'This billing interval already exists.');
      }
      fail(!data.catalog_entries.some(item => item.id !== existing?.id && item.group === group &&
        item.project_type === category && item.name.toLowerCase() === name.toLowerCase()), 'An item with this name already exists.');
      target = existing || { id: id(), group };
      Object.assign(target, { name, project_type: category, months, description: payload.description?.trim(), active: String(payload.active) !== 'false' });
      if (!existing) data.catalog_entries.unshift(target);
      label = existing ? 'Catalogue item updated' : 'Catalogue item added';
      break;
    }
    case 'staff': {
      const email = required(payload.email, 'Staff email').toLowerCase();
      fail(/^\S+@\S+\.\S+$/.test(email), 'Enter a valid staff email.');
      fail(!data.staff.some(person => person.email === email && person.id !== payload.id), 'This staff email already exists.');
      fail(['admin', 'finance', 'support'].includes(payload.role_code), 'Choose a staff role.');
      target = payload.id ? row(data.staff, payload.id, 'Team member') : { id: id() };
      const otherAdmin = data.staff.some(person => person.id !== target.id && person.role_code === 'admin' && person.status === 'active');
      fail(otherAdmin || (payload.role_code === 'admin' && payload.status === 'active'), 'Keep at least one active administrator.');
      Object.assign(target, { display_name: required(payload.display_name, 'Full name'), email,
        role_code: payload.role_code, status: payload.status, designation: payload.designation?.trim() });
      if (!payload.id) data.staff.unshift(target);
      label = 'Team member saved';
      break;
    }
    case 'provider': {
      const existing = payload.id ? row(data.providers, payload.id, 'Provider') : null;
      const kind = existing?.kind || payload.kind;
      fail(['registrar', 'hosting', 'email', 'payment'].includes(kind), 'Choose a provider type.');
      const name = required(payload.name || existing?.name, 'Provider name');
      fail(!data.providers.some(item => item.id !== existing?.id && item.kind === kind && item.name.toLowerCase() === name.toLowerCase()), 'This provider already exists.');
      target = existing || { id: id(), kind, code: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + data.providers.length };
      Object.assign(target, { name, active: String(payload.active) !== 'false' });
      if (!existing) data.providers.unshift(target);
      label = existing ? 'Provider updated' : 'Provider added';
      break;
    }
    case 'settings': {
      data.settings.company_name = required(payload.company_name, 'Company name');
      data.settings.billing_email = required(payload.billing_email, 'Billing email');
      label = 'Settings saved';
      break;
    }
    default: throw new Error('Unsupported action.');
  }
  data.activity.unshift({
    id: id(), actor: actor.name, action: label, entity_id: target?.id,
    occurred_at: now(), detail: target?.title || target?.invoice_no || target?.subject || target?.display_name || target?.name || data.settings.company_name,
  });
  return { workspace: data, record: target, message: label, demoDelivery };
}

export function clientPortalView(workspace, customerId) {
  const customer = row(workspace.customers, customerId, 'Client');
  return {
    customer,
    requests: workspace.orders.filter(order => order.customer_id === customerId).map(order => ({
      id: order.id, order_no: order.order_no, title: order.title, status: order.status, invoice_id: order.invoice_id,
      quote_amount: order.quote_amount, customer_status_note: order.customer_status_note, quote_note: order.quote_note,
    })),
    invoices: workspace.invoices.filter(invoice => invoice.customer_id === customerId),
    subscriptions: workspace.services.filter(service => service.customer_id === customerId),
    contracts: workspace.contracts.filter(contract => contract.customer_id === customerId),
  };
}
