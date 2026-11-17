import React, { useState } from 'react';
import {
  ArrowRight, Bell, CalendarClock, Check, ChevronRight, CircleDollarSign, ClipboardList, Edit3,
  FilePlus, FileText, Link2, Mail, MessageSquare, Plus, ReceiptText, Server, ShieldCheck, UsersRound,
} from 'lucide-react';
import { Avatar, Badge, Button, Dialog, Empty, InfoGrid, Subsection } from './components.jsx';
import { ServiceIcon, sumBy } from './pages.jsx';
import { categories, clientPortalView, contractBilling, dateLabel, daysDue, dueLabel, invoiceStatus, kinds, money, titleCase } from '../shared/workflows.mjs';
import { catalogGroups, marketingTypes, orderStatuses, productTypes } from '../shared/catalog-data.mjs';

function RecordLink({ icon: Icon, name, description, badge, onClick }) {
  return <button className="list-item detail-link" onClick={onClick}>
    <span className="entity-icon"><Icon size={18} /></span><div><strong>{name}</strong><small>{description}</small></div>
    {badge || <ChevronRight size={17} />}
  </button>;
}

function Conversation({ record, onNote }) {
  return <Subsection title="Conversation" action={onNote && <Button icon={MessageSquare} onClick={onNote}>Add message</Button>}>
    {!record.messages?.length ? <p className="detail-copy">No messages yet.</p> : <div className="conversation">{record.messages.map(message => <article key={message.id}>
      <Avatar name={message.author_name} /><div><div className="message-head"><strong>{message.author_name}</strong>
        <span className={message.visibility === 'internal' ? 'internal' : ''}>{message.visibility === 'internal' ? 'Internal' : 'Client'}</span></div>
        <p>{message.body}</p><time>{dateLabel(message.created_at)}</time></div>
    </article>)}</div>}
  </Subsection>;
}

function Steps({ status, renewal = false }) {
  const steps = ['Review', 'Quote', 'Acceptance', 'Invoice', 'Complete'];
  const progress = { under_review: 0, needs_information: 0, on_hold: 0, quoted: 1, accepted: 2, invoiced: 3, paid: 3, fulfilling: 3, completed: 4 }[status];
  if (progress === undefined) return null;
  const positions = renewal ? [0,3,4] : [0,1,2,3,4];
  return <ol className="steps">{positions.map((index, ordinal) => <li key={steps[index]} className={index <= progress ? 'done' : ''} aria-current={index === progress ? 'step' : undefined}>
    <span>{index < progress || status === 'completed' ? <Check size={13} /> : ordinal + 1}</span>{steps[index]}</li>)}</ol>;
}

export function Details({ selection, workspace, clientName, open, action, allowed, onClose }) {
  const { collection, id } = selection;
  const isClientView = ['subscriptions', 'clientPreview'].includes(collection);
  const record = workspace[isClientView ? 'customers' : collection]?.find(item => item.id === id);
  if (!record) return <Dialog title="Record unavailable" eyebrow="WORKSPACE" drawer onClose={onClose}><Empty /></Dialog>;
  const client = clientName(record.customer_id);
  const edit = (key, title, icon, payload = record, summary, primary = false, label = title) =>
    allowed(key) && <Button icon={icon} tone={primary ? 'primary' : 'secondary'} onClick={() => action(key, title, payload, summary)}>{label}</Button>;
  const invoiceLink = invoice => <RecordLink key={invoice.id} icon={ReceiptText} name={invoice.invoice_no}
    description={invoice.description + ' · ' + money(invoice.balance) + ' remaining'} badge={<Badge value={invoiceStatus(invoice)} />}
    onClick={() => open('invoices', invoice.id)} />;
  const serviceLink = service => <RecordLink key={service.id} icon={Server} name={service.title} description={categories[service.category] + ' · ' + service.plan_name}
    badge={<Badge value={service.status} />} onClick={() => open('services', service.id)} />;
  const linkClient = record.customer_id && <Button className="text-button" onClick={() => open('customers', record.customer_id)} icon={ArrowRight}>{client}</Button>;
  let title;
  let eyebrow;
  let content;
  switch (collection) {
    case 'customers': {
      const subscriptions = workspace.services.filter(item => item.customer_id === record.id);
      const invoices = workspace.invoices.filter(item => item.customer_id === record.id);
      const access = record.portal_access?.status || 'pending';
      title = record.display_name;
      eyebrow = record.customer_no;
      content = <>
        <div className="detail-toolbar"><Badge value={record.status} />{edit('customer', 'Edit client', Edit3, record, null, true)}</div>
        <InfoGrid items={ [['Client name', record.contact_name], ['Company', record.company_name || record.legal_name], ['Registered email', record.portal_email || record.billing_email],
          ['Mobile number', record.phone], ['Office location', record.office_location], ['Country', record.country],
          ['State / emirate', record.region], ['City', record.city], ['Industry', record.industry],
          ['Outstanding balance', money(sumBy(invoices, 'balance'))]]} />
        <Subsection title="Portal access">
          <div className="detail-toolbar"><Badge value={access} label={access === 'active' ? 'Access approved' : 'Awaiting approval'} />
          {access !== 'active' && record.status === 'active' && edit('clientAccess', 'Approve & create access', ShieldCheck, record,
            [['Registered email', record.portal_email || record.billing_email]], true)}</div>
          {record.portal_access?.approved_at && <p className="detail-copy">Approved {dateLabel(record.portal_access.approved_at)} by {record.portal_access.approved_by}.</p>}
        </Subsection>
        <Subsection title="Client workspace">
          <p className="detail-copy">{subscriptions.length} products and services assigned to this client.</p>
          <div className="detail-actions">
            <Button icon={Server} onClick={() => open('subscriptions', id)}>View subscriptions</Button>
            <Button icon={UsersRound} onClick={() => open('clientPreview', id)}>Preview client portal</Button>
          </div>
        </Subsection>
        <Subsection title="Invoices">{invoices.length ? invoices.map(invoiceLink) : <p className="detail-copy">No invoices issued.</p>}</Subsection>
      </>;
      break;
    }
    case 'subscriptions': {
      const view = clientPortalView(workspace, id);
      title = 'Subscriptions';
      eyebrow = record.display_name.toUpperCase();
      const groups = [
        ['Products', view.subscriptions.filter(item => productTypes.includes(item.category))],
        ['Projects and services', view.subscriptions.filter(item => !productTypes.includes(item.category))],
      ];
      content = <>
        <div className="detail-toolbar"><Button onClick={() => open('customers', id)}>Back to client</Button>
          {edit('service', 'Add product', Plus, { customer_id: id }, null, true)}</div>
        {groups.map(([label, records]) => <Subsection key={label} title={label}>
          {records.length ? records.map(serviceLink) : <p className="detail-copy">No records in this group.</p>}</Subsection>)}
        <Subsection title="AMC / SLA">{view.contracts.length ? view.contracts.map(contract => <RecordLink key={contract.id}
          icon={ShieldCheck} name={contract.title} description={money(contract.indicative_instalment) + ' per cycle'}
          onClick={() => open('contracts', contract.id)} />) : <p className="detail-copy">No contracts assigned.</p>}</Subsection>
      </>;
      break;
    }
    case 'clientPreview': {
      const view = clientPortalView(workspace, id);
      title = record.display_name + ' · Client view';
      eyebrow = 'CLIENT PORTAL PREVIEW';
      content = <ClientPreview view={view} back={() => open('customers', id)} />;
      break;
    }
    case 'services': {
      title = record.title;
      eyebrow = record.service_no + ' / ' + categories[record.category].toUpperCase();
      const annual = record.billing_mode === 'annual';
      const price = money(Number(record.recurring_unit_amount) * record.quantity);
      const renewal = workspace.invoices.find(invoice => invoice.renewal_service_id === record.id && invoice.period_start === record.term_end);
      const hosting = ['shared_hosting', 'cloud_hosting'].includes(record.category);
      const marketing = marketingTypes.includes(record.category);
      const product = productTypes.includes(record.category);
      const project = workspace.projects.find(item => item.service_id === id);
      const provider = workspace.providers.find(item => item.id === record.provider_id);
      const activities = (record.activity_ids || []).map(value => workspace.catalog_entries.find(item => item.id === value)?.name).filter(Boolean);
      const currentPlan = workspace.plans.find(plan => plan.id === record.plan_id);
      const canUpgrade = hosting && currentPlan && workspace.plans.some(plan => plan.catalog_item_id === currentPlan.catalog_item_id && plan.active && plan.tier_rank > currentPlan.tier_rank);
      const change = (kind, label) => edit('request', label, Plus, { kind, title: label + ' · ' + record.title, customer_id: record.customer_id,
        existing_service_id: record.id }, null, true);
      content = <>
        <div className="detail-toolbar"><Badge value={record.status} />{linkClient}</div>
        <div className="detail-hero"><ServiceIcon category={record.category} /><div><span>{annual ? 'Annual service value' : record.billing_mode === 'monthly' ? 'Monthly service value' : 'Billing arrangement'}</span>
          <strong>{['annual', 'monthly'].includes(record.billing_mode) ? price : titleCase(record.billing_mode)}</strong></div></div>
        <InfoGrid items={ [['Plan', record.plan_name], ['Quantity', record.quantity], ['Term start', dateLabel(record.term_start)],
          ['Term end', dateLabel(record.term_end)], ['Renewal timing', annual ? dueLabel(record.term_end) : '—'], ['Domain', record.domain_name],
          ['Health', titleCase(record.health)], ['Billing mode', titleCase(record.billing_mode)],
          ...(product ? [['Provider', provider?.name], ['Product ID', record.provider_reference],
            ['Discount', (record.discount_pct || 0) + '%'], ['Final term price', money(Number(record.recurring_unit_amount) * record.quantity * (record.term_years || 1))]] : [])]} />
        {record.control_panel_url && <p className="detail-copy">Control panel · {record.control_panel_url}</p>}
        {marketing && <Subsection title="Marketing activities"><div className="tag-list">{activities.map(name => <span key={name}>{name}</span>)}</div>
          {record.scope && <p className="detail-copy">{record.scope}</p>}</Subsection>}
        {project && <RecordLink icon={FileText} name={project.title} description={project.tech_stack} onClick={() => open('projects', project.id)} />}
        {record.status_reason && <p className="detail-copy">{record.status_reason}</p>}
        <Subsection title="Service actions"><div className="detail-actions">
          {canUpgrade && record.status === 'active' && daysDue(record.term_end) > 0 && change('hosting_upgrade', 'Upgrade hosting')}
          {record.category === 'email' && record.status === 'active' && daysDue(record.term_end) > 0 && change('email_scale', 'Scale email seats')}
          {annual && !renewal && record.status !== 'cancelled' && edit('renew', 'Create renewal invoice', CalendarClock, record, [['Service', record.title], ['Annual total', price], ['Current expiry', dateLabel(record.term_end)]])}
          {edit('serviceStatus', 'Update status', Edit3)}
          {product && edit('service', 'Edit product', Edit3)}
          {marketing && edit('marketing', 'Edit marketing account', Edit3, record, null, true)}
        </div></Subsection>
        {renewal && <Subsection title="Current renewal invoice">{invoiceLink(renewal)}</Subsection>}
      </>;
      break;
    }
    case 'orders': {
      title = record.title;
      eyebrow = record.order_no + ' / ' + kinds[record.kind].toUpperCase();
      const invoice = workspace.invoices.find(item => item.id === record.invoice_id);
      const service = workspace.services.find(item => item.id === record.existing_service_id);
      const plan = workspace.plans.find(item => item.id === record.requested_plan_id);
      const reviewing = ['under_review', 'needs_information', 'on_hold'].includes(record.status);
      content = <>
        <div className="detail-toolbar"><Badge value={record.status} label={orderStatuses[record.status]} />{linkClient}</div><Steps status={record.status} renewal={record.kind === 'renewal'} />
        {record.customer_status_note && <div className="notice blue-notice"><strong>Client status update</strong><span>{record.customer_status_note}</span></div>}
        {reviewing && record.request_payment_link && <div className="notice blue-notice">
          <strong>Payment link requested</strong><span>Issue the renewal invoice, then add the payment link from Invoices &amp; payments.</span>
        </div>}
        <InfoGrid items={ [['Request type', record.amc_request ? 'AMC contract request' : kinds[record.kind]], ['Created', dateLabel(record.created_at)],
          ['Estimated amount', Number(record.estimate) ? money(record.estimate) : 'To be quoted'], ['Quote', record.quote_amount ? money(record.quote_amount) : '—'],
          ...(plan ? [['Requested plan', plan.name]] : []), ...(record.requested_domain ? [['Requested domain', record.requested_domain]] : []),
          ...(record.kind === 'new_product' && record.requested_years ? [['Requested years', record.requested_years]] : []),
          ...(record.kind === 'email_scale' || (record.kind === 'new_product' && record.requested_quantity > 1) ? [['Requested seats', record.requested_quantity]] : [])]} />
        <Subsection title="Request details"><p className="detail-copy">{record.brief}</p>{service && serviceLink(service)}</Subsection>
        {record.quote_note && <Subsection title="Quote terms"><p className="detail-copy">{record.quote_note}</p>
          {record.approval_reference && <div className="notice blue-notice"><strong>Client acceptance</strong><span>{record.approval_reference}</span></div>}</Subsection>}
        <div className="detail-actions">
          {reviewing && edit('review', 'Update review status', Edit3)}
          {(reviewing || record.status === 'quoted') && !['cancellation','renewal'].includes(record.kind) && edit('quote', record.status === 'quoted' ? 'Revise quote' : 'Finalize quote', FileText, record, null, true)}
          {reviewing && record.kind === 'renewal' && service && edit('renew', 'Issue renewal invoice', CalendarClock, service, [['Service', service.title], ['Current expiry', dateLabel(service.term_end)]], true)}
          {record.status === 'quoted' && edit('approve', 'Record acceptance', Check, record, [['Quoted amount', money(record.quote_amount)]], true)}
          {record.status === 'accepted' && edit('invoiceOrder', 'Issue invoice', FilePlus, record, [['Approved quote', money(record.quote_amount)]], true)}
          {(record.status === 'fulfilling' || (record.kind === 'cancellation' && record.status === 'under_review')) && edit('fulfill', 'Complete request', Check, record, null, true)}
        </div>
        {record.fulfillment_reference && <Subsection title="Completion"><p className="detail-copy">{record.fulfillment_reference}</p></Subsection>}
        {invoice && <Subsection title="Issued invoice">{invoiceLink(invoice)}</Subsection>}
        <Conversation record={record} onNote={allowed('note') ? () => action('note', 'Add request message', { id, collection }) : null} />
      </>;
      break;
    }
    case 'invoices': {
      title = record.invoice_no;
      eyebrow = 'INVOICE / ' + titleCase(record.charge_type).toUpperCase();
      const payments = workspace.payments.filter(item => item.invoice_id === record.id);
      const openBalance = Number(record.balance) > 0;
      content = <>
        <div className="detail-toolbar"><Badge value={invoiceStatus(record)} />{linkClient}</div>
        <div className="detail-hero"><span className="entity-icon"><CircleDollarSign size={22} /></span>
          <div><span>Outstanding balance</span><strong>{money(record.balance)}</strong></div></div>
        <InfoGrid items={ [['Invoice amount', money(record.gross_amount)], ['Paid to date', money(record.paid_amount)],
          ['Issued', dateLabel(record.issued_on)], ['Due', dateLabel(record.due_on)], ['Payment link', titleCase(record.payment_link_status)],
          ['Invoice type', titleCase(record.segment)]]} />
        <p className="detail-copy">{record.description}</p>
        {openBalance && record.payment_link_status === 'requested' && <div className="notice blue-notice">
          <strong>Payment link requested</strong><span>Add the approved link below to make it available in the customer portal.</span>
        </div>}
        {record.payment_link && <div className="notice blue-notice"><strong>Payment link on file</strong><span>{record.payment_link}</span></div>}
        {record.follow_up && <div className="notice warning"><strong>Review required</strong><span>{record.follow_up}</span></div>}
        {openBalance && <div className="detail-actions">
          {edit('payment', 'Record payment', CircleDollarSign, record, [['Balance available', money(record.balance)]], true)}
          {edit('paymentLink', 'Manage payment link', Link2)}
          {edit('reminder', 'Queue reminder', Bell)}
        </div>}
        <Subsection title="Bank receipts">{payments.length ? payments.map(item => <RecordLink key={item.id} icon={ReceiptText} name={item.reference}
          description={dateLabel(item.received_on) + ' · ' + money(item.amount)} onClick={() => open('payments', item.id)} />) : <p className="detail-copy">No bank receipts recorded.</p>}</Subsection>
      </>;
      break;
    }
    case 'payments': {
      title = record.reference;
      eyebrow = 'BANK RECEIPT';
      const invoice = workspace.invoices.find(item => item.id === record.invoice_id);
      content = <><div className="detail-toolbar"><Badge value="paid" label="Recorded" />{linkClient}</div>
        <InfoGrid items={ [['Amount received', money(record.amount)], ['Received on', dateLabel(record.received_on)], ['Method', 'Bank transfer']]} />
        {invoice && <Subsection title="Allocated invoice">{invoiceLink(invoice)}</Subsection>}</>;
      break;
    }
    case 'contracts': {
      title = record.title;
      eyebrow = record.contract_no + ' / AMC / SLA';
      const invoices = workspace.invoices.filter(item => item.contract_id === id);
      const billing = contractBilling(workspace, record);
      const covered = workspace.services.filter(item => record.service_ids.includes(item.id));
      const plan = workspace.catalog_entries.find(item => item.id === record.amc_plan_id);
      content = <>
        <div className="detail-toolbar"><Badge value={record.status} />{linkClient}</div>
        <div className="detail-hero"><span className="entity-icon teal"><ShieldCheck size={22} /></span>
          <div><span>Annual contract value</span><strong>{money(record.annual_value)}</strong></div></div>
        <InfoGrid items={ [['AMC / SLA plan', plan?.name || titleCase(record.contract_type)], ['Billing cycle', record.billing_cycle_months + ' month(s)'],
          ['Related project', workspace.projects.find(item => item.id === record.project_id)?.title || record.project_name],
          ['AMC start date', dateLabel(record.start_date)], ['Contract end', dateLabel(record.end_date)],
          ['First payment date', dateLabel(record.first_due_date)], ['Last payment received', dateLabel(billing.lastPayment)],
          ['Days since last payment', billing.daysSincePayment === null ? '—' : billing.daysSincePayment + ' days'],
          ['Next scheduled instalment', dateLabel(billing.nextScheduled)],
          ['Scheduled amount', billing.nextAmount ? money(billing.nextAmount) : '—'],
          ['Payment due', dateLabel(billing.dueDate)],
          ['Days to due', billing.dueDays === null ? '—' : billing.dueDays + ' days'],
          ['Billing months past due', billing.overdueMonths + ' month(s)'],
          ['Overdue invoice balance', money(billing.overdueBalance)],
          ['Overdue, awaiting invoice', money(billing.unissuedOverdue)]]} />
        <Subsection title="Scope"><p className="detail-copy">{record.scope}</p></Subsection>
        <div className="detail-actions">
          {billing.nextScheduled && edit('contractInvoice', 'Issue instalment invoice', FilePlus, record,
            [['Next billing date', dateLabel(billing.nextScheduled)], ['Instalment amount', money(billing.nextAmount)]], true)}
          {edit('contract', 'Edit contract', Edit3)}
        </div>
        {covered.length > 0 && <Subsection title="Covered services">{covered.map(serviceLink)}</Subsection>}
        <Subsection title="Contract invoices">{invoices.length ? invoices.map(invoiceLink) : <p className="detail-copy">No invoices issued.</p>}</Subsection>
      </>;
      break;
    }
    case 'projects':
      title = record.title;
      eyebrow = 'PROJECT DELIVERY';
      content = <><div className="detail-toolbar"><Badge value={record.status} />{linkClient}</div>
        <InfoGrid items={ [['Project type', categories[record.project_type]], ['Technology', record.tech_stack], ['Current phase', record.phase], ['Target', dateLabel(record.target_date)],
          ['Project lead', record.manager], ['Progress', record.progress + '%'], ['Maintenance', record.maintenance_included ? 'Included' : 'Separate']]} />
        <div className="detail-progress"><progress value={record.progress} max="100" aria-label="Delivery progress" /></div>
        {record.scope && <p className="detail-copy">{record.scope}</p>}
        <div className="detail-actions">{edit('project', 'Edit project', Edit3, record, null, true)}</div></>;
      break;
    case 'tickets':
      title = record.subject;
      eyebrow = record.ticket_no + ' / SUPPORT';
      content = <><div className="detail-toolbar"><Badge value={record.status} />{linkClient}</div>
        <InfoGrid items={ [['Priority', titleCase(record.priority)], ['Department', titleCase(record.department_code || 'technical')],
          ['Opened', dateLabel(record.created_at)], ['Assigned to', workspace.staff.find(item => item.id === record.assigned_to)?.display_name || 'Unassigned']]} />
        <div className="detail-actions">{edit('ticketStatus', 'Assign or update ticket', Edit3, record, null, true)}</div>
        <Conversation record={record} onNote={allowed('note') ? () => action('note', 'Add ticket message', { id, collection }) : null} /></>;
      break;
    case 'plans':
      title = record.name;
      eyebrow = 'CATALOGUE / ' + categories[record.category].toUpperCase();
      content = <><div className="detail-toolbar"><Badge value={record.active ? 'active' : 'archived'} /></div>
        <InfoGrid items={ [['Annual rate', money(record.unit_amount)], ['Rate unit', titleCase(record.unit)], ['Plan code', record.code], ['Term', record.term_months + ' months']]} />
        <Subsection title="Plan details"><p className="detail-copy">{record.specifications.summary}</p></Subsection>
        <p className="detail-copy">Rate changes apply to future quotes. Existing service rates stay as purchased.</p>
        <div className="detail-actions">{edit('plan', 'Edit plan', Edit3, record, null, true)}</div></>;
      break;
    case 'staff':
      title = record.display_name;
      eyebrow = 'TEAM & ACCESS';
      content = <><div className="detail-toolbar"><Badge value={record.status} /></div>
        <InfoGrid items={ [['Email', record.email], ['Role', titleCase(record.role_code)], ['Title', record.designation]]} />
        <div className="detail-actions">{edit('staff', 'Edit team member', Edit3, record, null, true)}</div></>;
      break;
    case 'providers':
      title = record.name;
      eyebrow = 'PROVIDER DIRECTORY';
      content = <><div className="detail-toolbar"><Badge value={record.active ? 'active' : 'archived'} /></div>
        <InfoGrid items={ [['Type', titleCase(record.kind)], ['Provider code', record.code]]} />
        <div className="detail-actions">{edit('provider', 'Edit provider', Edit3, record, null, true)}</div></>;
      break;
    case 'catalog_entries':
      title = record.name;
      eyebrow = 'CATALOGUE / ' + catalogGroups[record.group].toUpperCase();
      content = <><div className="detail-toolbar"><Badge value={record.active ? 'active' : 'archived'} /></div>
        <InfoGrid items={ [['Type', catalogGroups[record.group]], ['Description', record.description],
          ...(record.group === 'technology' ? [['Project type', categories[record.project_type]]] : []),
          ...(record.group === 'cycle' ? [['Interval', record.months + ' month(s)']] : [])]} />
        <div className="detail-actions">{edit('catalogEntry', 'Edit catalogue item', Edit3, record, null, true)}</div></>;
      break;
    case 'activity':
      title = record.action;
      eyebrow = 'ACTIVITY LOG';
      content = <InfoGrid items={ [['Staff member', record.actor], ['Date', dateLabel(record.occurred_at)], ['Details', record.detail]]} />;
      break;
    default: title = 'Workspace record'; content = <Empty />;
  }
  return <Dialog drawer title={title} eyebrow={eyebrow} onClose={onClose}>{content}</Dialog>;
}

function ClientPreview({ view, back }) {
  const [invoiceId, setInvoiceId] = useState(null);
  const invoice = view.invoices.find(item => item.id === invoiceId);
  return <>
    <div className="detail-toolbar"><Button onClick={back}>Back to client</Button><Badge tone="blue" label="Sample client view" /></div>
    {invoice ? <Subsection title={invoice.invoice_no} action={<Button onClick={() => setInvoiceId(null)}>Back to invoices</Button>}>
      <InfoGrid items={ [['Description', invoice.description], ['Status', titleCase(invoiceStatus(invoice))], ['Due date', dateLabel(invoice.due_on)],
        ['Total', money(invoice.gross_amount)], ['Balance', money(invoice.balance)], ['Payment link', titleCase(invoice.payment_link_status)]]} />
    </Subsection> : <>
      <Subsection title="Orders & requests">
        {view.requests.length ? view.requests.map(request => <article className="preview-request" key={request.id}>
          <div className="detail-toolbar"><strong>{request.title}</strong><Badge value={request.status} label={orderStatuses[request.status]} /></div>
          <p>{request.order_no}{request.quote_amount && ' · ' + money(request.quote_amount)}</p>
          {request.customer_status_note && <p>{request.customer_status_note}</p>}
          {request.quote_note && <p>{request.quote_note}</p>}
          {request.invoice_id && view.invoices.some(item => item.id === request.invoice_id) &&
            <Button icon={ReceiptText} onClick={() => setInvoiceId(request.invoice_id)}>View issued invoice</Button>}
        </article>) : <p className="detail-copy">No requests yet.</p>}
      </Subsection>
      <Subsection title="Invoices">{view.invoices.length ? view.invoices.map(item => <RecordLink key={item.id} icon={ReceiptText}
        name={item.invoice_no} description={item.description + ' · ' + money(item.balance) + ' outstanding'}
        badge={<Badge value={invoiceStatus(item)} />} onClick={() => setInvoiceId(item.id)} />)
        : <p className="detail-copy">No invoices issued.</p>}</Subsection>
    </>}
  </>;
}
