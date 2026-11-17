import React, { useMemo, useState } from 'react';
import {
  Activity, ArrowRight, ArrowUpRight, Bell, Building2, CalendarClock, CheckCircle2, CircleDollarSign,
  ClipboardList, Cloud, Code2, CreditCard, FileText, Globe2, Headphones, Layers3, LayoutDashboard, Mail,
  Megaphone, Plus, ReceiptText, Server, Settings2, ShieldCheck, Sparkles, Wallet, UsersRound,
  ChartNoAxesCombined, Handshake, Package, QrCode, Smartphone, ShoppingBag, Download,
} from 'lucide-react';
import { Avatar, Badge, Button, Empty, exportCsv, Table, Tabs } from './components.jsx';
import { categories, contractBilling, dateLabel, daysDue, dueLabel, invoiceStatus, kinds, money, titleCase } from '../shared/workflows.mjs';
import { TODAY } from '../shared/seed.mjs';
import { catalogGroups, marketingTypes, orderStatuses, productTypes, projectTypes } from '../shared/catalog-data.mjs';

export const navigation = [
  { label: 'WORKSPACE', pages: [
    ['overview', 'Overview', LayoutDashboard], ['clients', 'Clients', UsersRound], ['renewals', 'Renewals', CalendarClock],
    ['requests', 'Orders & Requests', ClipboardList],
  ] },
  { label: 'SERVICE OPERATIONS', pages: [
    ['products', 'Products', Package], ['projects', 'Projects', Layers3], ['marketing', 'Digital Marketing', Megaphone],
    ['contracts', 'AMC / SLA', Handshake],
  ] },
  { label: 'FINANCE & SUPPORT', pages: [
    ['invoices', 'Invoices & Payments', CreditCard], ['support', 'Support', Headphones], ['reports', 'Reports', ChartNoAxesCombined],
  ] },
  { label: 'ADMINISTRATION', pages: [
    ['catalogue', 'Catalogue', Layers3], ['team', 'Team & Access', ShieldCheck], ['providers', 'Providers', Cloud],
    ['activity', 'Activity Log', Activity], ['settings', 'Settings', Settings2],
  ] },
];
export const pageNames = { ...Object.fromEntries(navigation.flatMap(group => group.pages.map(([id, name]) => [id, name]))), profile: 'My Profile' };
export const descriptions = {
  clients: 'Manage client profiles, their active services and billing history.',
  requests: 'Review requests, agree quotes, and track work through to completion.',
  products: 'Manage domains, hosting, email subscriptions and QR codes.',
  projects: 'Track delivery across websites, portals, stores and mobile apps.',
  marketing: 'Manage SEO, social media and performance marketing services.',
  contracts: 'Track contract value, billing cycles and the next instalment.',
  renewals: 'Prioritize upcoming expiries and prepare annual renewal invoices.',
  invoices: 'Manage outstanding balances, payment links and recorded receipts.',
  support: 'Assign, respond to and resolve client support tickets.',
  reports: 'Review revenue and operational balances and export the underlying records.',
  catalogue: 'Review product plans, annual rates and availability for new requests.',
  team: 'Define staff roles and preview their available actions.',
  providers: 'Manage the provider directory for services and payments.',
  activity: 'Review the history of actions taken in this demo workspace.',
  settings: 'Manage company preferences and reset the sample workspace.',
};

const serviceIcons = { domain: Globe2, shared_hosting: Server, cloud_hosting: Cloud, email: Mail,
  qr_code: QrCode, website: Globe2, web_portal: Code2, online_store: ShoppingBag, mobile_app: Smartphone,
  digital_marketing: Megaphone, performance_marketing: ChartNoAxesCombined, other: Layers3 };

export function ServiceIcon({ category }) {
  const Icon = serviceIcons[category] || Package;
  return <span className={'entity-icon type-' + category}><Icon size={19} /></span>;
}
export const isProduct = item => productTypes.includes(item.category);
export const upcoming = services => services.filter(service => service.billing_mode === 'annual' && service.status !== 'cancelled' && service.term_end)
  .sort((a, b) => a.term_end.localeCompare(b.term_end));
export const openRequests = orders => orders.filter(order => !['completed', 'declined'].includes(order.status));
export const sumBy = (rows, field) => Math.round(rows.reduce((sum, row) => sum + Number(row[field] || 0), 0) * 100) / 100;
export const monthlyRevenue = workspace => sumBy(workspace.contracts.filter(item => item.status === 'active'), 'monthly_equivalent')
  + workspace.services.filter(item => item.billing_mode === 'monthly' && item.status === 'active')
    .reduce((sum, service) => sum + Number(service.recurring_unit_amount) * service.quantity, 0);

const quickTitles = { customer: 'Add client', service: 'Add product', project: 'Add project', marketing: 'Add marketing account', plan: 'Add product plan', catalogEntry: 'Add catalogue item', provider: 'Add provider', request: 'New request', contract: 'Add contract', ticket: 'Create ticket', staff: 'Add team member' };

function Block({ title, subtitle, children, action, className = '' }) {
  return <section className={'block ' + className}>
    <div className="block-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}
  </section>;
}

function Stat({ icon: Icon, label, value, note, tone, onClick }) {
  return <button className="stat-card" onClick={onClick}>
    <span className="stat-top"><span className={'stat-icon ' + tone}><Icon size={20} /></span><ArrowUpRight className="stat-arrow" size={17} /></span>
    <span className="stat-label">{label}</span><strong>{value}</strong><span className="stat-note">{note}</span>
  </button>;
}

function Collections({ workspace }) {
  const [range, setRange] = useState(6);
  const payments = useMemo(() => workspace.payments.filter(payment => payment.received_on <= TODAY), [workspace.payments]);
  const buckets = Array.from({ length: range }, (_, index) => {
    const date = new Date(TODAY);
    const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - range + index + 1, 1));
    const month = value.toISOString().slice(0, 7);
    return { label: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(value),
      total: sumBy(payments.filter(payment => payment.received_on?.startsWith(month)), 'amount') };
  });
  const maximum = Math.max(1000, Math.ceil(Math.max(...buckets.map(bucket => bucket.total)) / 2000) * 2000);
  return <Block title="Payment collections" subtitle="Verified receipts by month" className="collections"
    action={<label className="range-select"><span className="sr-only">Collection period</span><select value={range} onChange={event => setRange(Number(event.target.value))}><option value="6">Last 6 months</option><option value="3">Last 3 months</option></select></label>}>
    <div className="chart-total"><strong>{money(sumBy(buckets, 'total'))}</strong><span><i /> Amount collected</span></div>
    <div className="bar-chart" role="img" aria-label={buckets.map(bucket => bucket.label + ' ' + money(bucket.total)).join(', ')}>
      <div className="chart-axis">{[1, .75, .5, .25, 0].map(fraction => <span key={fraction}>{fraction === 0 ? '0' : (maximum * fraction / 1000) + 'k'}</span>)}</div>
      <div className="plot"><div className="grid-lines">{[0, 1, 2, 3, 4].map(i => <i key={i} />)}</div>
        <div className="bars">{buckets.map((bucket, index) => <div className="bar-column" key={bucket.label}>
          <div className={'bar ' + (index === buckets.length - 1 ? 'latest' : '')} title={money(bucket.total)} style={{ height: Math.max(1, bucket.total / maximum * 100) + '%' }} />
          <span>{bucket.label}</span></div>)}</div>
      </div>
    </div>
  </Block>;
}

function Portfolio({ workspace, navigate }) {
  const products = workspace.services.filter(isProduct).length;
  const marketing = workspace.services.filter(item => item.category.includes('marketing')).length;
  const delivery = workspace.services.length - products - marketing;
  const size = workspace.services.length || 1;
  const productShare = products / size * 100;
  const serviceShare = (products + delivery) / size * 100;
  return <Block title="Service portfolio" subtitle="Products and services under management" className="portfolio"
    action={<button className="icon-button" aria-label="Open products" onClick={() => navigate('products')}><ArrowUpRight size={18} /></button>}>
    <div className="donut" style={{ background: `conic-gradient(#233fa5 0 ${productShare}%, #13a5b6 ${productShare}% ${serviceShare}%, #98a9f2 ${serviceShare}% 100%)` }}>
      <div><strong>{workspace.services.length}</strong><span>Total services</span></div>
    </div>
    <div className="legend">{[['Products', products, '#233fa5'], ['Project services', delivery, '#13a5b6'], ['Marketing', marketing, '#98a9f2']].map(([label, value, color]) =>
      <div key={label}><i style={{ background: color }} /><span>{label}</span><strong>{value}</strong></div>)}</div>
  </Block>;
}

export function Overview({ workspace, navigate, open, action, clientName, allowed, role }) {
  const outstanding = workspace.invoices.filter(invoice => Number(invoice.balance) > 0);
  const overdue = outstanding.filter(invoice => daysDue(invoice.due_on) < 0);
  const renewals = upcoming(workspace.services);
  const imminent = renewals.filter(service => daysDue(service.term_end) >= 0 && daysDue(service.term_end) <= 30);
  const requests = openRequests(workspace.orders);
  const monthly = workspace.payments.filter(payment => payment.received_on?.startsWith(TODAY.slice(0, 7)));
  return <div className="overview">
    <div className="page-heading overview-heading"><div>
      <span className="eyebrow"><i /> OPERATIONS WORKSPACE</span>
      <h1>Overview</h1><p>Manage clients, renewals and billing from one workspace.</p>
    </div><div className="page-actions"><span className="date-chip"><CalendarClock size={16} />{dateLabel(TODAY)}</span>
      {allowed('request') && <Button tone="primary" icon={Plus} onClick={() => action('request', 'New request')}>New request</Button>}</div></div>
    <div className="priority-strip">
      <div className="priority-title"><span className="priority-icon"><Sparkles size={20} /></span><div><strong>Needs attention</strong><small>Start with the work due soon.</small></div></div>
      <div className="priority-links">
        <button onClick={() => navigate('renewals', '30')}><span>{imminent.length}</span> renewals in 30 days <ArrowRight size={14} /></button>
        <button onClick={() => navigate('invoices', 'overdue')}><span>{overdue.length}</span> overdue invoices <ArrowRight size={14} /></button>
        <button onClick={() => navigate('requests', 'open')}><span>{requests.length}</span> open requests <ArrowRight size={14} /></button>
      </div>
    </div>
    <div className="stats">
      <Stat icon={Wallet} label="Collected this month" value={money(sumBy(monthly, 'amount'))} note={monthly.length + ' verified receipts'} tone="blue" onClick={() => navigate('invoices', 'receipts')} />
      <Stat icon={ReceiptText} label="Outstanding balance" value={money(sumBy(outstanding, 'balance'))} note={overdue.length + ' overdue invoices'} tone="amber" onClick={() => navigate('invoices')} />
      <Stat icon={Activity} label="Monthly recurring" value={money(monthlyRevenue(workspace))} note="Active contracts and retainers" tone="teal" onClick={() => navigate('contracts')} />
      <Stat icon={Building2} label="Active clients" value={workspace.customers.filter(client => client.status === 'active').length} note={workspace.services.filter(service => service.status === 'active').length + ' active services'} tone="violet" onClick={() => navigate('clients')} />
    </div>
    <div className="dashboard-grid"><Collections workspace={workspace} /><Portfolio workspace={workspace} navigate={navigate} /></div>
    <div className="dashboard-grid lower-grid">
      <Block title="Renewal queue" subtitle="Annual services with the nearest expiry"
        action={<Button onClick={() => navigate('renewals')} icon={ArrowRight}>View renewals</Button>}>
        <div className="stacked-list">{renewals.slice(0, 5).map(service => <button className="list-item" key={service.id} onClick={() => open('services', service.id)}>
          <ServiceIcon category={service.category} /><div><strong>{service.title}</strong><small>{clientName(service.customer_id)} · {dateLabel(service.term_end)}</small></div>
          <Badge label={dueLabel(service.term_end)} tone={daysDue(service.term_end) < 0 ? 'red' : 'amber'} />
        </button>)}</div>
      </Block>
      <Block title="Recent activity" subtitle="Latest workspace changes"
        action={<button className="icon-button" aria-label="Open activity log" onClick={() => navigate('activity')}><ArrowUpRight size={18} /></button>}>
        <div className="activity-list">{workspace.activity.slice(0, 4).map(event => <div key={event.id}>
          <Avatar name={event.actor} /><div><strong>{event.action}</strong><small>{event.detail}</small></div><time>{dateLabel(event.occurred_at).replace(/ \d{4}$/, '')}</time>
        </div>)}</div>
      </Block>
    </div>
    {role !== 'admin' && <div className="notice blue-notice"><strong>{titleCase(role)} action preview</strong><span>Switch roles from the profile menu to try other permissions.</span></div>}
  </div>;
}

const col = (key, label, value, render) => ({ key, label, value, render });
const badgeCol = (key = 'status', label = 'Status', get = record => record[key]) => col(key, label, get, record => <Badge value={get(record)} />);
const dateCol = (key, label) => col(key, label, record => record[key], record => dateLabel(record[key]));
const moneyCol = (key, label) => col(key, label, record => Number(record[key]), record => <span className="amount">{money(record[key])}</span>);

export function WorkspacePage({ page, segment, setSegment, workspace, open, action, clientName, allowed, reset, query, live }) {
  const clientCol = col('client', 'Client', item => clientName(item.customer_id));
  const buttons = {
    clients: 'customer', products: 'service', requests: 'request', contracts: 'contract', support: 'ticket', team: 'staff',
    projects: 'project', marketing: 'marketing', catalogue: Object.hasOwn(catalogGroups, segment) ? 'catalogEntry' : 'plan',
    providers: 'provider',
  };
  const create = buttons[page];
  const category = workspace.catalog.find(item => item.category === segment);
  const createDefaults = page === 'products' || page === 'catalogue' && create === 'plan' ? { catalog_item_id: category?.id }
    : page === 'catalogue' ? { group: segment } : page === 'projects' && projectTypes.includes(segment) ? { project_type: segment } : {};
  const searchText = item => [...Object.values(item).filter(value => typeof value === 'string'), clientName(item.customer_id)].join(' ');
  const controls = (choices, label) => <Tabs items={choices} value={segment} onChange={setSegment} label={label} />;
  const dataTable = (collection, rows, columns, title, subtitle, config = {}) => <Table
    key={page + ':' + segment + ':' + query} rows={rows} columns={columns} getTitle={title} getSubtitle={subtitle}
    onOpen={item => open(collection, item.id)} searchText={searchText} exportName={'safcodes-' + page} query={query} {...config} />;
  const services = (rows, renew = false) => dataTable('services', rows, [
    clientCol, col('category', 'Category', item => categories[item.category]), col('plan_name', 'Plan', item => item.plan_name),
    dateCol('term_end', renew ? 'Renewal date' : 'Term end'),
    col('annual', 'Recurring amount', item => Number(item.recurring_unit_amount) * item.quantity, item => item.billing_mode === 'annual' || item.billing_mode === 'monthly'
      ? <span className="amount">{money(Number(item.recurring_unit_amount) * item.quantity)}<small> / {item.billing_mode === 'annual' ? 'yr' : 'mo'}</small></span> : '—'),
    renew ? col('due', 'Due', item => daysDue(item.term_end), item => <Badge label={dueLabel(item.term_end)} tone={daysDue(item.term_end) < 0 ? 'red' : 'amber'} />) : badgeCol(),
  ], item => item.title, item => item.service_no, { getIcon: item => <ServiceIcon category={item.category} />, filter: item => item.status,
    filters: [...new Set(rows.map(item => item.status))] });
  let content;
  switch (page) {
    case 'clients':
      content = dataTable('customers', workspace.customers, [
        col('contact', 'Contact', item => item.contact_name || '—', item => <div className="table-secondary"><strong>{item.contact_name || '—'}</strong><small>{item.billing_email}</small></div>),
        col('industry', 'Industry', item => item.industry || '—'), col('city', 'City', item => item.city || '—'),
        col('services', 'Services', item => workspace.services.filter(service => service.customer_id === item.id).length),
        badgeCol('access', 'Portal access', item => item.portal_access?.status || 'pending'), badgeCol(),
      ], item => item.display_name, item => item.customer_no, { filter: item => item.status, filters: ['active', 'inactive'],
        getIcon: item => <Avatar name={item.display_name} index={workspace.customers.indexOf(item)} /> });
      break;
    case 'requests': {
      const rows = segment === 'open' ? openRequests(workspace.orders) : workspace.orders.filter(item => segment === 'all' || item.segment === segment);
      content = <>{controls([{ value: 'all', label: 'All requests', count: workspace.orders.length },
        { value: 'product', label: 'Products' }, { value: 'service', label: 'Services' }, { value: 'open', label: 'Open queue' }], 'Request type')}
        {dataTable('orders', rows, [clientCol, col('kind', 'Request type', item => kinds[item.kind]),
          col('amount', 'Estimate / quote', item => Number(item.quote_amount || item.estimate), item => Number(item.quote_amount || item.estimate) > 0 ? money(item.quote_amount || item.estimate) : 'To be quoted'),
          dateCol('created_at', 'Created'), col('invoice', 'Invoice', item => workspace.invoices.find(invoice => invoice.id === item.invoice_id)?.invoice_no || '—'),
          col('status', 'Status', item => orderStatuses[item.status] || item.status, item => <Badge value={item.status} label={orderStatuses[item.status]} />)], item => item.title, item => item.order_no,
        { getIcon: () => <span className="entity-icon"><ClipboardList size={18} /></span>, statusLabels: orderStatuses, filter: item => item.status, filters: [...new Set(rows.map(item => item.status))] })}
      </>;
      break;
    }
    case 'products': {
      const rows = workspace.services.filter(item => isProduct(item) && (segment === 'all' || item.category === segment));
      content = <>{controls([{ value: 'all', label: 'All products' }, ...productTypes
        .map(value => ({ value, label: categories[value] }))], 'Product category')}{services(rows)}</>;
      break;
    }
    case 'marketing': {
      const activityNames = item => (item.activity_ids || []).map(id => workspace.catalog_entries.find(entry => entry.id === id)?.name).filter(Boolean);
      const rows = workspace.services.filter(item => marketingTypes.includes(item.category));
      content = dataTable('services', rows, [clientCol, col('activities', 'Activities', item => activityNames(item).join(', '),
        item => <div className="tag-list">{activityNames(item).map(name => <span key={name}>{name}</span>)}</div>),
        dateCol('term_start', 'Starts'), dateCol('term_end', 'Ends'), badgeCol()], item => item.title, item => item.service_no,
        { getIcon: item => <ServiceIcon category={item.category} />, filter: item => item.status, filters: ['active', 'suspended', 'cancelled'] });
      break;
    }
    case 'renewals': {
      const rows = upcoming(workspace.services);
      const filtered = rows.filter(item => {
        const due = daysDue(item.term_end);
        return segment === 'all' || (segment === 'overdue' ? due < 0 : due >= 0 && due <= Number(segment));
      });
      content = <>{controls([{ value: 'all', label: 'All annual renewals' }, { value: 'overdue', label: 'Past due', count: rows.filter(item => daysDue(item.term_end) < 0).length },
        { value: '30', label: 'Next 30 days' }, { value: '90', label: 'Next 90 days' }], 'Renewal window')}{services(filtered, true)}</>;
      break;
    }
    case 'projects': {
      const categoryOf = project => project.project_type;
      const projects = workspace.projects.filter(item => segment === 'all' || categoryOf(item) === segment);
      content = <>{controls([{ value: 'all', label: 'All projects' }, ...projectTypes.map(value => ({ value, label: categories[value] }))], 'Project category')}
        <div className="card-grid">{projects.map(project => <article className="record-card" key={project.id}>
          <div className="card-top"><ServiceIcon category={categoryOf(project)} /><Badge value={project.status} /></div>
          <p className="card-kicker">{clientName(project.customer_id)}</p><h2>{project.title}</h2><p>{project.tech_stack} · {project.phase}</p>
          <div className="progress-caption"><span>Delivery progress</span><strong>{project.progress}%</strong></div>
          <progress value={project.progress} max="100" aria-label="Delivery progress" />
          <div className="card-footer"><span>Target {dateLabel(project.target_date)}</span><Button icon={ArrowRight} onClick={() => open('projects', project.id)}>View</Button></div>
        </article>)}</div>{!projects.length && <Empty />}</>;
      break;
    }
    case 'contracts':
      content = <div className="card-grid">{workspace.contracts.map(contract => {
        const billing = contractBilling(workspace, contract);
        const plan = workspace.catalog_entries.find(item => item.id === contract.amc_plan_id);
        const balance = Number(billing.overdueBalance) + Number(billing.unissuedOverdue);
        return <article className="record-card contract-card" key={contract.id}>
          <div className="card-top"><span className="entity-icon teal"><Handshake size={20} /></span><Badge value={contract.status} /></div>
          <p className="card-kicker">{contract.contract_no} · {clientName(contract.customer_id)}</p><h2>{contract.title}</h2><p>{plan?.name || titleCase(contract.contract_type)}</p>
          <div className="contract-amounts"><div><span>Annual value</span><strong>{money(contract.annual_value)}</strong></div>
            <div><span>Every {contract.billing_cycle_months} month{contract.billing_cycle_months === 1 ? '' : 's'}</span><strong>{money(contract.indicative_instalment)}</strong></div></div>
          <div className="contract-dates"><span>Last paid {dateLabel(billing.lastPayment)}</span><span>Due {dateLabel(billing.dueDate)}</span></div>
          <div className="card-footer">{billing.overdueMonths ? <Badge tone="red" label={billing.overdueMonths + ' mo past due · ' + money(balance)} /> : <span>{dueLabel(billing.dueDate)}</span>}
            <Button icon={ArrowRight} onClick={() => open('contracts', contract.id)}>View</Button></div>
        </article>;
      })}</div>;
      break;
    case 'invoices': {
      const invoices = workspace.invoices.filter(item => {
        if (segment === 'all') return true;
        if (segment === 'link_requested') return item.payment_link_status === 'requested';
        if (segment === 'overdue') return invoiceStatus(item) === 'overdue';
        if (segment === 'upcoming') return Number(item.balance) > 0 && daysDue(item.due_on) >= 0;
        return item.segment === segment;
      });
      content = <>{controls([{ value: 'all', label: 'All invoices' }, { value: 'product', label: 'Products' }, { value: 'service', label: 'Services' },
        { value: 'upcoming', label: 'Upcoming' }, { value: 'overdue', label: 'Overdue' },
        { value: 'link_requested', label: 'Link requested' }, { value: 'receipts', label: 'Receipts' }], 'Billing view')}
        {segment === 'receipts' ? dataTable('payments', workspace.payments, [clientCol, dateCol('received_on', 'Received'), moneyCol('amount', 'Amount'),
          col('invoice', 'Invoice', payment => workspace.invoices.find(invoice => invoice.id === payment.invoice_id)?.invoice_no)],
        item => item.reference, () => 'Bank transfer', { getIcon: () => <span className="entity-icon teal"><Wallet size={18} /></span> })
          : dataTable('invoices', invoices, [clientCol, dateCol('due_on', 'Due date'), moneyCol('gross_amount', 'Invoice total'), moneyCol('balance', 'Balance'),
            badgeCol('status', 'Status', invoiceStatus), col('payment_link', 'Payment link', item => item.payment_link_status, item =>
              item.payment_link_status === 'requested' ? <Badge tone="amber" label="Requested" />
                : item.payment_link_status === 'ready' ? 'Ready' : '—')], item => item.invoice_no, item => item.description,
          { getIcon: () => <span className="entity-icon"><ReceiptText size={18} /></span>, filter: invoiceStatus, filters: ['open', 'partially_paid', 'overdue', 'paid'] })}
      </>;
      break;
    }
    case 'support':
      content = dataTable('tickets', workspace.tickets, [clientCol, badgeCol('priority', 'Priority'),
        col('assignee', 'Assigned to', item => workspace.staff.find(person => person.id === item.assigned_to)?.display_name || 'Unassigned'), badgeCol()],
      item => item.subject, item => item.ticket_no, { filter: item => item.status, filters: ['open', 'in_progress', 'awaiting_client', 'resolved', 'closed'],
        getIcon: () => <span className="entity-icon"><Headphones size={18} /></span> });
      break;
    case 'catalogue': {
      const entryView = Object.hasOwn(catalogGroups, segment);
      const groups = [{ value: 'all', label: 'Product plans' }, ...Object.entries(catalogGroups).map(([value, label]) => ({ value, label }))];
      const rows = workspace.plans.filter(plan => !productTypes.includes(segment) || plan.category === segment);
      content = <>{<Tabs items={groups} value={entryView ? segment : 'all'} onChange={setSegment} label="Catalogue type" />}
        {entryView ? dataTable('catalog_entries', workspace.catalog_entries.filter(item => item.group === segment), [
          col('description', 'Description', item => item.description || '—'),
          ...(segment === 'technology' ? [col('type', 'Project type', item => categories[item.project_type])] : []),
          ...(segment === 'cycle' ? [col('months', 'Interval (months)', item => item.months)] : []),
          badgeCol('active', 'Availability', item => item.active ? 'active' : 'archived'),
        ], item => item.name, () => catalogGroups[segment], { getIcon: () => <span className="entity-icon"><Layers3 size={18} /></span> })
        : <>{controls([{ value: 'all', label: 'All plans' }, ...productTypes.map(value => ({ value, label: categories[value] }))], 'Product plan category')}
          <div className="card-grid">{rows.map(plan => <article className="record-card plan-card" key={plan.id}>
            <div className="card-top"><ServiceIcon category={plan.category} /><Badge value={plan.active ? 'active' : 'archived'} /></div>
            <p className="card-kicker">{workspace.providers.find(provider => provider.id === plan.provider_id)?.name || categories[plan.category]}</p>
            <h2>{plan.name}</h2><p>{plan.specifications.summary}</p>
            <div className="card-footer"><strong>{money(plan.unit_amount)}<small> / {plan.unit === 'seat' ? 'seat / ' : ''}yr</small></strong>
              <Button icon={ArrowRight} onClick={() => open('plans', plan.id)}>View plan</Button></div>
          </article>)}</div>{!rows.length && <Empty title="No plans yet" description="Add a product plan to use it on new products." />}</>}
      </>;
      break;
    }
    case 'team':
      content = <><div className="notice blue-notice"><strong>Action permissions</strong><span>Admins manage the workspace. Finance handles quotes, invoices and payments. Support handles requests, tickets and delivery updates.</span></div>
        {dataTable('staff', workspace.staff, [col('email', 'Email', item => item.email), col('role', 'Role', item => titleCase(item.role_code)), badgeCol()],
          item => item.display_name, item => item.designation, { getIcon: item => <Avatar name={item.display_name} /> })}</>;
      break;
    case 'providers':
      content = dataTable('providers', workspace.providers, [col('kind', 'Type', item => titleCase(item.kind)), col('code', 'Code', item => item.code),
        badgeCol('active', 'Status', item => item.active ? 'active' : 'archived')], item => item.name, () => 'Sample provider',
      { getIcon: () => <span className="entity-icon"><Cloud size={18} /></span> });
      break;
    case 'activity':
      content = dataTable('activity', workspace.activity, [col('actor', 'Staff member', item => item.actor), dateCol('occurred_at', 'Date')],
        item => item.action, item => item.detail, { getIcon: () => <span className="entity-icon"><Activity size={18} /></span> });
      break;
    case 'reports':
      content = <><div className="dashboard-grid"><Collections workspace={workspace} /><Portfolio workspace={workspace} navigate={target => { window.location.hash = target; }} /></div>
        <Block title="Export workspace reports" subtitle="Download a CSV for review in Excel or Google Sheets.">
          <div className="report-actions">
            <Button icon={Download} onClick={() => exportCsv('safcodes-invoice-ledger', ['Invoice', 'Client', 'Due', 'Total', 'Paid', 'Balance'],
              workspace.invoices.map(item => [item.invoice_no, clientName(item.customer_id), item.due_on, item.gross_amount, item.paid_amount, item.balance]))}>Invoice ledger</Button>
            <Button icon={Download} onClick={() => exportCsv('safcodes-renewal-schedule', ['Service', 'Client', 'Term end', 'Annual AED'],
              upcoming(workspace.services).map(item => [item.title, clientName(item.customer_id), item.term_end, Number(item.recurring_unit_amount) * item.quantity]))}>Renewal schedule</Button>
            <Button icon={Download} onClick={() => exportCsv('safcodes-amc-contracts', ['Contract', 'Client', 'Annual AED', 'Cycle months', 'Next instalment'],
              workspace.contracts.map(item => [item.title, clientName(item.customer_id), item.annual_value, item.billing_cycle_months, item.next_due_date]))}>Contract billing</Button>
          </div>
        </Block></>;
      break;
    case 'settings':
      content = <div className="settings-grid">
        <Block title="Company profile" subtitle="Billing details used by the workspace.">
          <div className="settings-content"><dl><dt>Company</dt><dd>{workspace.settings.company_name}</dd>
            <dt>Billing email</dt><dd>{workspace.settings.billing_email}</dd><dt>Currency</dt><dd>AED</dd></dl>
            {allowed('settings') && <Button icon={Settings2} onClick={() => action('settings', 'Edit company profile', workspace.settings)}>Edit profile</Button>}</div>
        </Block>
        {live ? <Block title="Database connection" subtitle="Workspace records are loaded from PostgreSQL.">
          <div className="settings-content"><p>Email delivery mode: {live.mailMode}.</p><Button onClick={() => window.location.reload()}>Reload workspace</Button></div>
        </Block> : <Block title="Demo workspace" subtitle="Sample data and local browser storage.">
          <div className="settings-content"><p>Changes are saved in this browser. Resetting restores the sample clients, services, invoices and activity.</p>
            <Button onClick={reset}>Reset sample data</Button></div>
        </Block>}
      </div>;
      break;
    default: content = <Empty />;
  }
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">SAFCODES ADMIN</span><h1>{pageNames[page]}</h1><p>{descriptions[page]}</p></div>
    {create && allowed(create) && <Button tone="primary" icon={Plus} onClick={() => action(create, quickTitles[create], createDefaults)}>{quickTitles[create]}</Button>}</div>{content}</div>;
}
