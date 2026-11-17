import React, { useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert } from 'lucide-react';
import { Button, Dialog, InfoGrid } from './components.jsx';
import { addMonths, categories, contractBilling, dateLabel, daysBetween, estimateChange, kinds, money, titleCase } from '../shared/workflows.mjs';
import { TODAY } from '../shared/seed.mjs';
import { catalogGroups, clientDomains, lookup, orderStatuses, productTypes, projectTypes, providersFor } from '../shared/catalog-data.mjs';
import Combobox from './Combobox.jsx';

const field = (key, label, properties = {}) => ({ key, label, ...properties });
const options = values => values.map(value => ({ value, label: titleCase(value) }));
const text = (key, label, properties = {}) => field(key, label, { required: true, ...properties });
const choice = (key, label, choices, properties = {}) => field(key, label, { options: choices, required: true, ...properties });
const long = (key, label, properties = {}) => text(key, label, { type: 'textarea', wide: true, ...properties });
const numeric = (key, label, properties = {}) => text(key, label, { type: 'number', min: '0.01', step: '0.01', ...properties });
const date = (key, label, properties = {}) => text(key, label, { type: 'date', ...properties });
const named = rows => rows.map(item => ({ value: item.id, label: item.name }));
const categoryOptions = values => values.map(value => ({ value, label: categories[value] }));
const availability = [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Archived' }];
const vatBases = [{ value: 'false', label: 'VAT added to amount' }, { value: 'true', label: 'VAT included in amount' }];
const productStatuses = options(['active', 'provisioning', 'suspended', 'expired', 'cancelled']);
const countries = ['United Arab Emirates', 'Saudi Arabia', 'India', 'Oman', 'Qatar', 'Bahrain', 'Kuwait', 'Pakistan', 'United Kingdom', 'United States'];
const emirates = ['Abu Dhabi', 'Ajman', 'Dubai', 'Fujairah', 'Ras Al Khaimah', 'Sharjah', 'Umm Al Quwain'];

const labels = {
  customer: 'Save client', clientAccess: 'Approve & create access', service: 'Save product', marketing: 'Save marketing account', catalogEntry: 'Save item', serviceStatus: 'Update service', request: 'Create request', review: 'Update review',
  quote: 'Finalize quote', approve: 'Record acceptance', invoiceOrder: 'Issue invoice', renew: 'Issue renewal invoice',
  contract: 'Save contract', contractInvoice: 'Issue instalment invoice', payment: 'Record payment', paymentLink: 'Save link status',
  reminder: 'Queue reminder', note: 'Save message', ticket: 'Create ticket', ticketStatus: 'Update ticket',
  project: 'Save project', plan: 'Save plan', staff: 'Save team member', provider: 'Save provider',
  settings: 'Save settings', fulfill: 'Complete request',
};

function schema(action, data, workspace, live) {
  const clients = workspace.customers.map(client => ({
    value: client.id, label: client.display_name, keywords: [client.contact_name, client.billing_email, client.customer_no].join(' '),
  }));
  const client = choice('customer_id', 'Client', clients, { searchable: true });
  const locked = Boolean(data.id);
  switch (action) {
    case 'customer':
      return [text('contact_name', 'Client name'), text('billing_email', live ? 'Billing email' : 'Registered email', { type: 'email' }),
        ...(live ? [field('portal_email', 'Portal email (defaults to billing)', { type: 'email' })] : []),
        text('dial_code', 'Dial code', { placeholder: '+971' }), text('phone', 'Mobile number', { type: 'tel' }),
        field('company_name', 'Company'), field('legal_name', 'Legal / billing name'),
        field('office_location', 'Office location', { wide: true }),
        text('country', 'Country', { suggestions: live ? workspace.countries.map(item => item.name) : countries }),
        field('region', data.country === 'United Arab Emirates' ? 'Emirate' : 'State / region', { suggestions: data.country === 'United Arab Emirates' ? emirates : undefined }),
        text('city', 'City'), field('industry', 'Industry'), choice('status', 'Status', options(live ? ['active','on_hold','closed'] : ['active', 'inactive']))];
    case 'clientAccess':
      return [];
    case 'service': {
      const catalog = workspace.catalog.filter(item => (item.active || item.id === data.catalog_item_id) && productTypes.includes(item.category));
      const category = catalog.find(item => item.id === data.catalog_item_id)?.category;
      const categoryField = choice('catalog_item_id', 'Product category', catalog.map(item => ({ value: item.id, label: categories[item.category] })), { disabled: locked });
      if (!category) return [{ ...client, disabled: locked }, categoryField];
      const domain = category === 'domain';
      const email = category === 'email';
      const hosting = ['shared_hosting', 'cloud_hosting'].includes(category);
      const plans = workspace.plans.filter(plan => (plan.active || plan.id === data.plan_id) && plan.catalog_item_id === data.catalog_item_id
        && (!email || plan.provider_id === data.provider_id));
      const domains = clientDomains(workspace, data.customer_id, data.domain_service_id)
        .map(item => ({ value: item.id, label: item.domain_name || item.title, keywords: item.service_no }));
      domains.push({ value: 'other', label: 'Other · external domain' });
      return [{ ...client, disabled: locked }, categoryField,
        ...(domain || email || hosting ? [choice('provider_id', domain ? 'Registrar' : email ? 'Email provider' : 'Hosting provider',
          named(providersFor(workspace, category, data.provider_id)), { searchable: true, required: domain || email })] : []),
        domain ? text('domain_label', 'Domain name', { placeholder: 'example' }) : text('title', 'Product title'),
        ...(email || hosting ? [choice('domain_service_id', 'Domain', domains, { searchable: true }),
          ...(data.domain_service_id === 'other' ? [text('other_domain', 'External domain', { placeholder: 'example.com' })] : [])] : []),
        field('provider_reference', 'Product ID / provider reference'),
        ...(hosting ? [field('control_panel_url', 'cPanel / control panel link', { type: 'url', wide: true, placeholder: 'https://…' })] : []),
        ...(category !== 'qr_code' || plans.length ? [choice('plan_id', domain ? 'Domain extension' : 'Plan', plans.map(item =>
          ({ value: item.id, label: item.name + ' · ' + money(item.unit_amount) + ' / yr' })), { required: category !== 'qr_code' })] : []),
        numeric('purchased_unit_amount', email ? 'Annual price per license (AED)' : 'Annual plan price (AED)'),
        ...(email ? [numeric('quantity', 'License quantity', { min: 1, max: 10000, step: 1 })] : []),
        date('term_start', 'Registration date'),
        choice('term_years', 'Registration term', Array.from({ length: 10 }, (_, index) => ({ value: index + 1, label: (index + 1) + (index ? ' years' : ' year') }))),
        numeric('discount_pct', 'Discount (%)', { required: false, min: 0, max: 99.99 }),
        choice('status', 'Status', productStatuses)];
    }
    case 'marketing': {
      const activities = workspace.catalog_entries.filter(item => item.group === 'marketing' && (item.active || data.activity_ids?.includes(item.id)));
      return [{ ...client, disabled: locked }, text('title', 'Account title'),
        field('activity_ids', 'Marketing activities', { type: 'checkboxes', options: named(activities), wide: true, required: true }),
        date('term_start', 'Start date'), date('term_end', 'End date'),
        choice('status', 'Status', options(['active', 'suspended', 'cancelled'])), long('scope', 'Scope and notes', { required: false })];
    }
    case 'serviceStatus':
      return [choice('status', 'Status', options(['active', 'suspended', 'cancelled'])), long('reason', 'Reason')];
    case 'request':
      return [client, choice('kind', 'Request type', Object.entries(kinds).map(([value, label]) => ({ value, label }))),
        text('title', 'Request title', { wide: true }), long('brief', 'Request details')];
    case 'review': return [choice('status', 'Review status', ['under_review', 'needs_information', 'on_hold', 'declined']
      .map(value => ({ value, label: orderStatuses[value] }))),
      long('customer_status_note', data.status === 'needs_information' ? 'Information needed' : 'Client status note', { required: data.status === 'needs_information' })];
    case 'quote': {
      const prorated = ['hosting_upgrade', 'email_scale'].includes(data.kind);
      return [numeric('quote_amount', prorated && live ? 'Recorded estimate (AED)' : 'Quote amount (AED)', { readOnly: prorated }),
        ...(live && !prorated ? [choice('tax_inclusive', 'VAT basis', vatBases)] : []), long('quote_note', 'Quote terms')];
    }
    case 'approve': return [long('reference', 'Approval reference', { placeholder: 'Example: client email dated 4 Nov, reference APR-1042' })];
    case 'invoiceOrder': return [date('due_on', 'Due date')];
    case 'renew':
    case 'contractInvoice':
    case 'reminder': return [];
    case 'contract': {
      const billed = locked && workspace.invoices.some(invoice => invoice.contract_id === data.id);
      const projectOptions = workspace.projects.filter(project => project.customer_id === data.customer_id)
        .map(project => ({ value: project.id, label: project.title }));
      const cycles = lookup(workspace, 'cycle', data.cycle_id).map(item => ({
        value: item.id, label: item.name + ' · ' + (billed && item.id === data.cycle_id ? data.billing_cycle_months : item.months) + ' mo',
      }));
      return [{ ...client, disabled: locked }, choice('amc_plan_id', 'AMC / SLA plan', named(lookup(workspace, 'amc', data.amc_plan_id)), { searchable: true }),
        choice('project_id', 'Related project', projectOptions, { searchable: true, required: false, placeholder: 'Find a client project (optional)' }),
        field('project_name', 'Project name', { readOnly: Boolean(data.project_id) }),
        text('title', 'AMC / SLA title'),
        numeric('annual_value', 'Annual contract value (AED)', { readOnly: billed }),
        choice('cycle_id', 'Billing cycle', cycles, { disabled: billed }),
        date('start_date', 'AMC start date', { readOnly: billed }), date('first_due_date', 'First payment date', { readOnly: billed }),
        choice('status', 'Status', options(live ? ['draft','active','on_hold','cancelled','completed'] : ['active', 'suspended', 'cancelled', 'completed'])),
        long('scope', 'Scope of work')];
    }
    case 'payment':
      return [numeric('amount', 'Amount received (AED)', { max: data.balance }), date('received_on', 'Payment date'),
        text('reference', 'Bank reference', { wide: true, placeholder: 'Example: BANK-2026-1042' })];
    case 'paymentLink':
      return [field('url', 'HTTPS payment link', { type: 'url', wide: true, placeholder: 'https://…' }),
        ...(live && data.url ? [choice('gateway_id', 'Payment provider', named(workspace.providers.filter(item => item.kind === 'payment' && item.active)))] : [])];
    case 'note':
      return [choice('visibility', 'Visibility', [{ value: 'internal', label: 'Internal note' }, { value: 'customer', label: live ? 'Customer reply' : 'Customer reply (demo)' }]),
        long('body', 'Message')];
    case 'ticket':
      return [client, choice('priority', 'Priority', options(['low', 'normal', 'high', 'urgent'])),
        text('subject', 'Subject', { wide: true }), long('body', 'Description')];
    case 'ticketStatus':
      return [choice('status', 'Status', options(['open', 'in_progress', 'awaiting_client', 'resolved', 'closed'])),
        choice('assigned_to', 'Assignee', workspace.staff.filter(person => person.status === 'active')
          .map(person => ({ value: person.id, label: person.display_name })), { required: false, placeholder: 'Unassigned' })];
    case 'project': {
      const technologies = lookup(workspace, 'technology', data.technology_id).filter(item => item.project_type === data.project_type);
      return [{ ...client, disabled: locked }, text('title', 'Project title'),
        choice('project_type', 'Project type', categoryOptions(projectTypes)),
        choice('technology_id', 'Technology / tech stack', named(technologies), { searchable: true }),
        date('start_date', 'Start date'), date('target_date', 'Target date'), text('phase', 'Project phase'),
        numeric('progress', 'Progress (%)', { min: '0', max: '100', step: '1' }), field('manager', 'Project lead'),
        choice('maintenance_included', 'Maintenance', [{ value: 'false', label: 'Separate' }, { value: 'true', label: 'Included' }]),
        long('scope', 'Scope and notes', { required: false })];
    }
    case 'plan': {
      const products = workspace.catalog.filter(item => (item.active || item.id === data.catalog_item_id) && productTypes.includes(item.category));
      const category = products.find(item => item.id === data.catalog_item_id)?.category;
      return [choice('catalog_item_id', 'Product category', products.map(item => ({ value: item.id, label: categories[item.category] })), { disabled: locked }),
        text('name', category === 'domain' ? 'Domain extension' : 'Plan name'),
        ...(category === 'email' ? [choice('provider_id', 'Email provider', named(providersFor(workspace, category, data.provider_id)), { searchable: true, disabled: locked })] : []),
        numeric('unit_amount', 'Annual rate (AED)'),
        ...(live ? [choice('tax_inclusive', 'VAT basis', vatBases)] : []),
        ...(['shared_hosting', 'cloud_hosting'].includes(category) ? [numeric('tier_rank', 'Upgrade tier', { min: 1, max: 99, step: 1 })] : []),
        choice('active', 'Availability', availability), long('summary', 'Plan details')];
    }
    case 'catalogEntry':
      return [choice('group', 'Catalogue type', Object.entries(catalogGroups).map(([value, label]) => ({ value, label })), { disabled: locked }),
        text('name', 'Item name'),
        ...(data.group === 'technology' ? [choice('project_type', 'Project type', categoryOptions(projectTypes), { disabled: locked })] : []),
        ...(data.group === 'cycle' ? [numeric('months', 'Billing interval (months)', { min: 1, max: 12, step: 1 })] : []),
        choice('active', 'Availability', availability), long('description', 'Description', { required: false })];
    case 'staff':
      return [text('display_name', 'Full name'), text('email', 'Email', { type: 'email', readOnly: live && locked }), field('designation', 'Job title'),
        choice('role_code', 'Role', options(['admin', 'finance', 'support'])), choice('status', 'Status', options(live ? ['active','inactive','invited','disabled','locked'] : ['active', 'inactive']))];
    case 'provider':
      return [text('name', 'Provider name'), choice('kind', 'Provider type', options(['registrar', 'hosting', 'email', 'payment']), { disabled: locked }),
        choice('active', 'Availability', availability)];
    case 'settings':
      return [text('company_name', 'Company name'), text('billing_email', 'Billing email', { type: 'email' })];
    case 'fulfill':
      return [
        ...(live && data.kind === 'new_product' ? [choice('service_id', 'Provisioned product', workspace.services.filter(item =>
          item.customer_id === data.customer_id && item.status === 'active' && item.catalog_item_id === data.catalog_item_id
          && (!data.requested_plan_id || item.plan_id === data.requested_plan_id)).map(item => ({ value: item.id, label: item.title })), { searchable: true })] : []),
        long('reference', 'Completion notes', { placeholder: 'Record the provisioning or cancellation evidence.' })];
    default: return [];
  }
}

function initialValues(action, record, workspace, live) {
  const base = { ...record };
  if (action === 'service') {
    const plan = workspace.plans.find(item => item.id === record.plan_id);
    const domain = record.domain_name || '';
    const suffix = plan?.name || '';
    return { term_start: TODAY, quantity: 1, term_years: 1, discount_pct: 0, status: 'active', ...base,
      term_years: record.term_years || 1, discount_pct: record.discount_pct || 0,
      domain_label: suffix && domain.endsWith(suffix) ? domain.slice(0, -suffix.length) : domain,
      domain_service_id: record.domain_service_id || (domain ? 'other' : ''),
      other_domain: domain, purchased_unit_amount: record.purchased_unit_amount ?? record.recurring_unit_amount,
    };
  }
  if (action === 'project') return { project_type: 'website', start_date: TODAY, progress: 0, phase: 'Discovery', maintenance_included: 'false',
    ...base, phase: record.phase || 'Discovery', maintenance_included: String(record.maintenance_included ?? false) };
  if (action === 'marketing') return { term_start: TODAY, term_end: addMonths(TODAY, 12), activity_ids: [], status: 'active', ...base };
  if (action === 'plan') return { active: 'true', tier_rank: 1, ...base, tax_inclusive: String(record.tax_inclusive ?? false),
    summary: record.specifications?.summary || '' };
  if (['provider', 'catalogEntry'].includes(action)) return { active: 'true', ...base };
  if (action === 'request') {
    const service = workspace.services.find(item => item.id === record.existing_service_id);
    return { kind: 'new_product', requested_quantity: service ? service.quantity + 1 : 1,
      ...base, requested_plan_id: record.kind === 'email_scale' ? service?.plan_id : record.requested_plan_id || '' };
  }
  if (action === 'quote') {
    const plan = workspace.plans.find(item => item.id === base.requested_plan_id);
    if (live) {
      if (['hosting_upgrade', 'email_scale'].includes(base.kind)) return { ...base, quote_amount: base.quote_amount || base.estimate };
      if (base.quote_subtotal != null) return { ...base, quote_amount: base.quote_subtotal, tax_inclusive: 'false' };
      if (base.quote_amount != null) return { ...base, tax_inclusive: 'true' };
      return { ...base, quote_amount: base.estimate, tax_inclusive: String(base.estimate_tax_inclusive ?? plan?.tax_inclusive ?? false) };
    }
    let quote = base.quote_amount || base.estimate;
    const service = workspace.services.find(item => item.id === base.existing_service_id);
    if (service && plan) {
      try { quote = estimateChange(service, plan, base.requested_quantity).total; } catch { /* Keep the earlier estimate visible. */ }
    }
    return { ...base, quote_amount: quote };
  }
  if (action === 'payment') return { ...base, amount: record.balance, received_on: TODAY };
  if (action === 'paymentLink') return { ...base, url: record.payment_link || '' };
  if (action === 'invoiceOrder') return { ...base, due_on: new Date(Date.parse(TODAY) + 14 * 86400000).toISOString().slice(0, 10) };
  if (action === 'note') return { ...base, visibility: 'internal' };
  if (action === 'ticket') return { priority: 'normal', ...base };
  if (action === 'contract') return { cycle_id: workspace.catalog_entries.find(item => item.group === 'cycle' && item.months === 1 && item.active)?.id, start_date: TODAY, first_due_date: TODAY, status: 'active', ...base };
  if (action === 'staff') return { role_code: 'support', status: 'active', ...base };
  if (action === 'customer') {
    const parsed = /^(\+\d{1,4})\s+(.+)$/.exec(record.phone || '');
    return { status: 'active', country: 'United Arab Emirates', ...base,
      company_name: record.company_name ?? record.display_name,
      dial_code: record.dial_code || parsed?.[1] || '+971', phone: parsed?.[2] || record.phone,
    };
  }
  return base;
}

function Input({ config, value, onChange }) {
  if (config.type === 'checkboxes') return <fieldset className="activity-options wide">
    <legend>{config.label}<i> *</i></legend><div className="option-grid">{config.options.map(option => {
      const selected = (value || []).includes(option.value);
      return <label key={option.value} className={'option-card check-option ' + (selected ? 'selected' : '')}>
        <input type="checkbox" checked={selected} onChange={() => onChange(config.key,
          selected ? value.filter(item => item !== option.value) : [...(value || []), option.value])} />
        <strong>{option.label}</strong></label>;
    })}{!config.options.length && <p>Add an active marketing activity in the catalogue.</p>}</div>
  </fieldset>;
  if (config.searchable) return <Combobox config={config} value={value} onChange={onChange} />;
  const { key, label, type, options: choices, wide, placeholder, suggestions, ...attributes } = config;
  const inputProps = { ...attributes, id: 'edit-' + key, value: value ?? '', onChange: event => onChange(key, event.target.value) };
  return <label className={'form-field' + (wide ? ' wide' : '')} htmlFor={'edit-' + key}>
    <span>{label}{attributes.required && !attributes.readOnly && !attributes.disabled ? <i> *</i> : ''}</span>
    {choices ? <select {...inputProps}><option value="">{placeholder || 'Select ' + label.toLowerCase()}</option>
      {choices.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      : type === 'textarea' ? <textarea {...inputProps} placeholder={placeholder} rows={3} maxLength={2000} />
      : <input {...inputProps} type={type || 'text'} placeholder={placeholder} list={suggestions ? 'options-' + key : undefined} maxLength={type ? undefined : 200} />}
    {suggestions && <datalist id={'options-' + key}>{suggestions.map(option => <option key={option} value={option} />)}</datalist>}
  </label>;
}

function RequestOptions({ data, workspace, change }) {
  const existing = ['hosting_upgrade', 'email_scale', 'cancellation'].includes(data.kind);
  const selected = workspace.services.find(item => item.id === data.existing_service_id && item.customer_id === data.customer_id);
  const current = workspace.plans.find(item => item.id === selected?.plan_id);
  const products = workspace.catalog.filter(item => item.active && item.segment === (data.kind === 'new_service' ? 'service' : 'product'));
  const services = workspace.services.filter(item => item.customer_id === data.customer_id && item.status !== 'cancelled'
    && (data.kind === 'email_scale' ? item.category === 'email' : data.kind === 'hosting_upgrade' ? ['shared_hosting', 'cloud_hosting'].includes(item.category) : true));
  const plans = workspace.plans.filter(plan => plan.active && plan.catalog_item_id === (existing ? selected?.catalog_item_id : data.catalog_item_id)
    && (data.kind !== 'hosting_upgrade' || plan.tier_rank > current?.tier_rank));
  const chosen = workspace.plans.find(plan => plan.id === data.requested_plan_id);
  let estimate;
  if (selected && chosen && data.kind !== 'cancellation') {
    const quantity = data.kind === 'email_scale' ? Number(data.requested_quantity) : selected.quantity;
    try { estimate = estimateChange(selected, chosen, quantity); } catch { /* Validation runs on submit. */ }
  }
  return <div className="request-options wide">
    {existing
      ? <Input config={choice('existing_service_id', 'Current service', services.map(item => ({ value: item.id, label: item.title + ' · ' + item.plan_name })))} value={data.existing_service_id} onChange={change} />
      : <fieldset><legend>Product or service category</legend><div className="option-grid">
        {products.map(item => <button className={'option-card ' + (data.catalog_item_id === item.id ? 'selected' : '')}
          type="button" aria-pressed={data.catalog_item_id === item.id} key={item.id} onClick={() => change('catalog_item_id', item.id)}>
          <strong>{categories[item.category]}</strong><small>{item.name}</small></button>)}
      </div></fieldset>}
    {data.kind === 'email_scale' && selected && <Input config={numeric('requested_quantity', 'New total email seats', { step: '1', min: selected.quantity + 1, max: 10000 })} value={data.requested_quantity} onChange={change} />}
    {plans.length > 0 && !['email_scale', 'cancellation'].includes(data.kind) && <fieldset><legend>{data.kind === 'hosting_upgrade' ? 'Upgrade plan' : 'Plan'}</legend>
      <div className="option-grid">{plans.map(plan => <button key={plan.id} type="button" className={'option-card ' + (data.requested_plan_id === plan.id ? 'selected' : '')}
        aria-pressed={data.requested_plan_id === plan.id} onClick={() => change('requested_plan_id', plan.id)}>
        <strong>{plan.name}</strong><small>{money(plan.unit_amount)} / year</small><small>{plan.specifications.summary}</small>
      </button>)}</div></fieldset>}
    {estimate && <div className="notice blue-notice"><strong>Prorated estimate · {money(estimate.total)}</strong><span>{estimate.remaining} of {estimate.term} days remain. Current term ends {dateLabel(selected.term_end)}.</span></div>}
  </div>;
}

export function ActionForm({ form, workspace, live, onClose, onSubmit }) {
  const [data, setData] = useState(() => initialValues(form.action, form.record, workspace, live));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(null);
  const fields = schema(form.action, data, workspace, live);
  function change(key, value) {
    setError('');
    setData(previous => {
      const updated = { ...previous, [key]: value };
      if (form.action === 'service') {
        if (key === 'catalog_item_id') return { ...updated, plan_id: '', provider_id: '', purchased_unit_amount: '', domain_service_id: '', other_domain: '' };
        if (key === 'customer_id') return { ...updated, domain_service_id: '', other_domain: '' };
        if (key === 'provider_id' && workspace.catalog.find(item => item.id === updated.catalog_item_id)?.category === 'email')
          return { ...updated, plan_id: '', purchased_unit_amount: '' };
        if (key === 'plan_id') return { ...updated, purchased_unit_amount: workspace.plans.find(item => item.id === value)?.unit_amount || '' };
      }
      if (form.action === 'project' && key === 'project_type') return { ...updated, technology_id: '' };
      if (form.action === 'contract') {
        if (key === 'customer_id') return { ...updated, project_id: '', project_name: '' };
        if (key === 'project_id') return { ...updated, project_name: workspace.projects.find(item => item.id === value)?.title || '' };
      }
      if (form.action !== 'request') return updated;
      if (key === 'customer_id' || key === 'kind') return { ...updated, catalog_item_id: '', requested_plan_id: '', existing_service_id: '' };
      if (key === 'catalog_item_id') {
        const item = workspace.catalog.find(record => record.id === value);
        return { ...updated, requested_plan_id: '', title: previous.title || item?.name };
      }
      if (key === 'existing_service_id') {
        const item = workspace.services.find(record => record.id === value);
        return { ...updated, requested_plan_id: updated.kind === 'email_scale' ? item?.plan_id : '',
          requested_quantity: item ? item.quantity + 1 : 1, title: previous.title || (kinds[updated.kind] + ' · ' + item?.title) };
      }
      return updated;
    });
  }
  const isRequest = form.action === 'request';
  const intro = {
    service: 'Record the purchased plan, registration term, and provider details.',
    clientAccess: live ? 'Send the contact a one-time code to set their portal password.' : 'Approve portal access and generate a temporary password for this registered email. The delivery preview is simulated.',
    renew: 'The current expiry moves forward after the renewal invoice is fully paid.',
    quote: live && ['hosting_upgrade', 'email_scale'].includes(data.kind) ? 'The API recalculates the prorated amount and VAT before issuing the quote.' : undefined,
    invoiceOrder: 'The issued invoice uses the accepted quote amount.',
    contractInvoice: 'This creates the next instalment invoice and advances the billing schedule.',
    payment: 'Record a verified bank receipt against the outstanding balance.',
    paymentLink: 'Leave the link blank to record a payment link request for finance.',
    reminder: live ? 'Record and deliver a reminder using the configured mail mode.' : 'This adds a reminder to the demo queue.',
    fulfill: 'Record completion after the service work is confirmed.',
  }[form.action];
  return <Dialog title={form.title} eyebrow="WORKSPACE ACTION" onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError('');
      const fingerprint = JSON.stringify(data);
      if (live && request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      try { await onSubmit(form.action, data, request.current?.id); }
      catch (reason) { setError(reason.message); }
      finally { setBusy(false); }
    }}>
      {intro && <p className="form-intro">{intro}</p>}
      {form.summary && <InfoGrid items={form.summary} />}
      <div className="form-grid">
        {(isRequest ? fields.slice(0, 2) : fields).map(config => <Input key={config.key} config={config} value={data[config.key]} onChange={change} />)}
        {isRequest && <RequestOptions data={data} workspace={workspace} change={change} />}
        {isRequest && fields.slice(2).map(config => <Input key={config.key} config={config} value={data[config.key]} onChange={change} />)}
      </div>
      {form.action === 'service' && data.catalog_item_id && <ProductEstimate data={data} original={form.record} />}
      {form.action === 'contract' && <ContractEstimate data={data} workspace={workspace} />}
      {error && <p className="form-error" role="alert"><CircleAlert size={17} />{error}</p>}
      <div className="dialog-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button tone="primary" type="submit" disabled={busy} icon={['quote', 'approve', 'payment'].includes(form.action) ? Check : ArrowRight}>{busy ? 'Saving…' : labels[form.action]}</Button></div>
    </form>
  </Dialog>;
}

function ProductEstimate({ data, original }) {
  if (!data.term_start || !data.term_years) return null;
  const end = original.id && original.term_start === data.term_start && Number(original.term_years || 1) === Number(data.term_years)
    ? original.term_end : addMonths(data.term_start, Number(data.term_years) * 12);
  const quantity = Number(data.quantity || 1);
  const discountedUnit = Math.round(Number(data.purchased_unit_amount || 0) * (100 - Number(data.discount_pct || 0))) / 100;
  return <div className="form-estimate"><InfoGrid items={ [['Expiry date', dateLabel(end)], ['Expiry in days', daysBetween(TODAY, end)],
    ['Annual amount', money(discountedUnit * quantity)], ['Final price for term', money(discountedUnit * quantity * Number(data.term_years))]]} /></div>;
}

function ContractEstimate({ data, workspace }) {
  const cycle = workspace.catalog_entries.find(item => item.id === data.cycle_id);
  const billed = data.id && workspace.invoices.some(invoice => invoice.contract_id === data.id);
  const payment = billed ? contractBilling(workspace, data).nextScheduled : data.first_due_date;
  const months = billed ? data.billing_cycle_months : cycle?.months;
  return <div className="form-estimate"><InfoGrid items={ [['Next scheduled payment', dateLabel(payment)],
    ['Indicative instalment', months && data.annual_value ? money(Number(data.annual_value) * months / 12) : '—']] } />
    {billed && <p className="detail-copy">The contract’s billing terms are locked because invoices have been issued.</p>}</div>;
}
