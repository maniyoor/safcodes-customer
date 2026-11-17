'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { specificationEntries } from './public-specifications.mjs';
import './plan-choices.css';
import { usePortal, useCommand, invoiceForService, openRenewal } from './portal-context';
import CheckoutButton, { invoiceCheckoutEligible } from './CheckoutButton';
import { aed, changeEligible, date, deliveryCategories, duration, emailProvider, emailProviders, exVat, label,
  orderPricing, planPricing, priceBreakdown, renewable, requestCategories, servicePricing, ticketAction, ticketClosed } from './data';
import { Badge, Btn, Empty, Expiry, Field, Icon, Info, PriceRows, PriceSummary, Row, ServiceIcon, Steps, Tabs } from './ui';

function Frame({title,subtitle,children,focusOnOpen,drawer=false}) {
  const { close } = usePortal();
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    const prior = document.activeElement;
    element.showModal();
    if (focusOnOpen) element.querySelector(focusOnOpen)?.focus();
    return () => { element.close(); if (prior?.isConnected) requestAnimationFrame(() => prior.focus()); };
  }, []);
  return <dialog ref={dialog} className={'live-dialog' + (drawer?' live-drawer':'')} aria-labelledby="dialog-title" onCancel={close}>
    <div className="live-dialog-head"><div><h2 id="dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <button autoFocus type="button" className="icon-button" aria-label="Close dialog" onClick={close}><Icon name="close"/></button></div>
    <div className="live-dialog-body">{children}</div>
  </dialog>;
}

const ErrorMessage = ({error}) => error ? <p className="live-error" role="alert">{error}</p> : null;
function Actions({children}) { return <div className="live-card-actions">{children}</div>; }

export function PortalDialog({modal}) {
  const { data } = usePortal();
  const { type,id,options } = modal;
  const service = ['service','change','renewal','amc-request'].includes(type) && data.services.find(s => s.id===id);
  const invoice = type==='invoice' && data.invoices.find(i => i.id===id);
  const order = type==='order' && data.orders.find(o => o.id===id);
  const contract = ['contract','contract-payment'].includes(type) && data.contracts.find(c => c.id===id);
  const ticket = type==='ticket' && data.tickets.find(t => t.id===id);
  if (type==='search') return <WorkspaceSearch/>;
  if (type==='password-reset') return <PasswordReset/>;
  if (type==='request') return <RequestFlow category={id} options={options}/>;
  if (type==='ticket-new') return <NewTicket serviceId={id}/>;
  if (service) {
    if (type==='change') return <Change service={service}/>;
    if (type==='renewal') return <Renewal key={service.id} service={service}/>;
    if (type==='amc-request') return <AmcRequest service={service}/>;
    return <Service service={service}/>;
  }
  if (invoice) return <Invoice invoice={invoice}/>;
  if (order) return <Order order={order}/>;
  if (contract) return <Contract key={contract.id} contract={contract} paymentFirst={type==='contract-payment'}/>;
  if (ticket) return <Ticket ticket={ticket}/>;
  return <Frame title="Record unavailable"><Empty title="This record is unavailable" description="Return to the workspace and refresh."/></Frame>;
}

function WorkspaceSearch() {
  const { data,navigation,permits,go,open } = usePortal();
  const [query,setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matches = (...fields) => fields.filter(Boolean).join(' ').toLowerCase().includes(term);
  const pages = (term ? navigation.filter(([,name]) => matches(name)) : navigation).slice(0,5);
  const records = term ? [
    ...data.services.filter(s => matches(s.title,s.domain,s.service_no,s.plan)).map(s => ['service',s.id,s.title,s.service_no,'layers']),
    ...data.contracts.filter(c => matches(c.title,c.contract_no)).map(c => ['contract',c.id,c.title,c.contract_no,'shield']),
    ...(permits('billing.view') ? data.invoices.filter(i => matches(i.invoice_no,i.lines[0]?.description))
      .map(i => ['invoice',i.id,i.invoice_no,i.lines[0]?.description,'document']) : []),
    ...(permits('orders.create') ? data.orders.filter(o => matches(o.title,o.order_no))
      .map(o => ['order',o.id,o.title,o.order_no,'requests']) : []),
    ...(permits('support.create') ? data.tickets.filter(t => matches(t.subject,t.ticket_no))
      .map(t => ['ticket',t.id,t.subject,t.ticket_no,'chat']) : []),
  ].slice(0,8) : [];
  return <Frame title="Search workspace" subtitle="Find pages, services, invoices, and requests for this account." focusOnOpen="#workspace-query">
    <div className="search live-search-field"><Icon name="search"/>
      <input id="workspace-query" type="search" aria-label="Search this account" placeholder="Search by name or reference"
        value={query} onChange={event => setQuery(event.target.value)}/>
    </div>
    {(pages.length>0 || records.length>0) ? <div className="mini-list live-search-results">
      {pages.map(([id,name,icon]) => <button type="button" key={id} onClick={() => go(id)}>
        <Icon name={icon}/><span><strong>{name}</strong><small>Workspace page</small></span><Icon name="right"/>
      </button>)}
      {records.map(([type,id,title,reference,icon]) => <button type="button" key={type + id} onClick={() => open(type,id)}>
        <Icon name={icon}/><span><strong>{title}</strong><small>{reference || label(type)}</small></span><Icon name="right"/>
      </button>)}
    </div> : <Empty icon="search" title="No matches" description="Try a different name or reference."/>}
  </Frame>;
}

function Specifications({value}) {
  const items = specificationEntries(value);
  return items.length ? <div className="live-specs">{items.map(([key,text]) => <Row key={key} label={label(key)}>{text}</Row>)}</div> : null;
}
function Service({service:s}) {
  const { data,permits,open } = usePortal();
  const project = data.projects.find(p => p.service_id===s.id);
  const contracts = data.contracts.filter(c => c.service_ids.includes(s.id) || (project && c.project_id===project.id));
  const invoice = invoiceForService(data,s);
  const renewal = openRenewal(data,s.id);
  const canOrder = permits('orders.create');
  const canChange = canOrder && changeEligible(s,data.asOf);
  const delivery = deliveryCategories.includes(s.category);
  const price = permits('billing.view') ? servicePricing(s,data.taxRate) : null;
  return <Frame drawer title={s.title} subtitle={`${s.service_no} · ${requestCategories[s.category] || label(s.category)}`}>
    <div className="service-card-top"><ServiceIcon service={s}/><Badge>{label(project?.status || s.status)}</Badge></div>
    <div className="review-box">
      <Row label="Plan">{s.plan || requestCategories[s.category] || s.catalog_name || '—'}</Row>
      {s.domain && <Row label="Domain">{s.domain}</Row>}{s.provider && <Row label="Provider">{s.provider}</Row>}
      <Row label="Service health">{label(s.health)}</Row><Row label="Billing type">{label(s.billing_mode)}</Row>
      {s.category==='email' && <Row label="Active licenses">{s.quantity}</Row>}
      {!delivery && s.term_start && <Row label="Current term">{date(s.term_start)} – {date(s.term_end)}</Row>}
      {s.segment==='product' && <Row label="Expires in"><Expiry asOf={data.asOf} ends={s.term_end}/></Row>}
      {s.next_due_date && <Row label="Next due">{date(s.next_due_date)}</Row>}
    </div>
    {permits('billing.view') && (s.segment==='product' || (price?.total ?? price?.net)>0) && <div className="review-box">
      <PriceRows label={s.billing_mode==='annual'?'Annual price':'Service price'} price={price}/>
    </div>}
    {delivery && <div className="review-box">
      <Row label="Technology">{project?.technology || '—'}</Row><Row label="Project lead">{project?.project_lead || 'Unassigned'}</Row>
      <Row label="Start date">{date(project?.start_date || s.term_start)}</Row><Row label="Target date">{date(project?.target_date || s.term_end)}</Row>
      <Row label="Completion date">{date(project?.completed_on)}</Row><Row label="Duration">{duration(s,project)}</Row>
      <Row label="Maintenance included">{project?.maintenance_included ? 'Yes' : 'No'}</Row>
      {project?.phase && <Row label="Phase">{project.phase}</Row>}
      {project?.hosting && <Row label="Hosting">{project.hosting}</Row>}
    </div>}
    {s.scope && <><h3>Scope</h3><p className="live-copy">{s.scope}</p></>}
    {!!s.activities.length && <><h3>Marketing activities</h3><ul>{s.activities.map(a => <li key={a}>{a}</li>)}</ul></>}
    <Specifications value={s.specifications}/>
    {project && <div className="live-section"><h3>Project progress</h3>
      <label className="live-progress">Progress <progress value={project.progress} max="100"/> {project.progress}%</label>
      {project.milestones.map((m,index) => <Row key={m.id || index} label={m.title}>{m.completed_at ? 'Completed · '+date(m.completed_at) : date(m.due_date)}</Row>)}
    </div>}
    {contracts.map(c => <Actions key={c.id}><Btn icon="shield" onClick={() => open('contract',c.id)}>{c.title}</Btn></Actions>)}
    <Actions>
      {renewable(s) && (invoice || renewal || canOrder) &&
        <Btn primary onClick={() => open('renewal',s.id)}>{invoice?'Review renewal payment':'Renew'}</Btn>}
      {canChange && <Btn onClick={() => open('change',s.id)} icon={s.category==='email' ? 'plus' : 'arrowUp'}>{s.category==='email' ? 'Resize business email' : 'Upgrade hosting'}</Btn>}
      {delivery && canOrder && <Btn onClick={() => open('amc-request',s.id)} icon="shield">Request AMC Contract</Btn>}
      {permits('support.create') && <Btn onClick={() => open('ticket-new',s.id)} icon="chat">Ask about this service</Btn>}
    </Actions>
  </Frame>;
}
function AmcRequest({service}) {
  const { open } = usePortal();
  const action = useCommand();
  return <Frame drawer title="Request AMC Contract" subtitle={service.title}>
    <Info icon="shield">Safcodes will review your requirements and prepare a maintenance proposal for this service.</Info>
    <form onSubmit={event => {
      event.preventDefault();
      const brief = new FormData(event.currentTarget).get('brief');
      action.run('request',{ kind:'new_service',amc_request:true,existing_service_id:service.id,brief }, result => open('order',result.id));
    }}>
      <Field id="amc-brief" label="Maintenance requirements"><textarea id="amc-brief" name="brief" required maxLength={2000} rows={4}
        placeholder="Tell us what you would like the contract to cover."/></Field>
      <ErrorMessage error={action.error}/>
      <Actions><Btn type="submit" primary disabled={action.busy} end="right">{action.busy?'Sending…':'Submit AMC request'}</Btn></Actions>
    </form>
  </Frame>;
}

function Renewal({service}) {
  const { data, open, permits } = usePortal();
  const action = useCommand();
  const currentInvoice = invoiceForService(data,service);
  const [trackedInvoiceId,setTrackedInvoiceId] = useState(currentInvoice?.id || '');
  useEffect(() => { if (currentInvoice?.id) setTrackedInvoiceId(currentInvoice.id); }, [currentInvoice?.id]);
  const invoice = currentInvoice || data.invoices.find(i => i.id===trackedInvoiceId);
  const request = openRenewal(data,service.id);
  const canPay = permits('billing.view');
  const price = canPay ? servicePricing(service,data.taxRate) : null;
  const canRequestLink = canPay && (!request || (!request.request_payment_link && ['under_review','needs_information','on_hold'].includes(request.status)));
  const requestRenewal = () => action.run('request',{ kind:'renewal',existing_service_id:service.id,request_payment_link:canPay,
    brief:canPay?'Please issue a one-year renewal invoice and provide a payment link.':'Please issue a one-year renewal invoice.' });
  return <Frame drawer title="Renew subscription" subtitle={service.title}>
    <div className="review-box">
      <Row label="Subscription">{service.service_no}</Row><Row label="Plan">{service.plan || label(service.category)}</Row>
      <Row label="Current expiry">{date(service.term_end)}</Row><Row label="Renewal term">1 year</Row>
      <Row label="Expires in"><Expiry asOf={data.asOf} ends={service.term_end}/></Row>
      <Row label={service.category==='email'?'Licenses':'Quantity'}>{service.quantity}</Row>
      {!invoice && canPay && <PriceRows price={price} label="Indicative renewal price"/>}
    </div>
    {invoice ? <>
      <Row label="Invoice">{invoice.invoice_no}</Row><Row label="Amount due" total>{aed(invoice.balance)}</Row>
      <InvoicePaymentActions invoice={invoice}/>
      <Actions><Btn onClick={() => open('invoice',invoice.id)}>View invoice</Btn></Actions>
    </> : <>
      <Info icon="calendar">{request?.request_payment_link ? 'Payment link requested. It will appear after Safcodes issues the invoice and adds the link.'
        : request ? 'Your renewal is with Safcodes for review.' : 'Safcodes will issue a one-year renewal invoice. Your renewal date changes after payment is verified.'}</Info>
      <ErrorMessage error={action.error}/>
      <Actions>
        {request && <Btn onClick={() => open('order',request.id)}>View renewal request</Btn>}
        {permits('orders.create') && (!request || canRequestLink) && <Btn primary icon="link"
          disabled={action.busy || (!request && (price?.total ?? price?.net)===0)} onClick={requestRenewal}>
          {canPay?'Request Payment Link':'Request renewal'}</Btn>}
        {canPay && !invoice?.payment_link && <CheckoutButton kind="renewal" targetId={service.id}/>}
      </Actions>
    </>}
  </Frame>;
}

function PlanCards({plans,value,onSelect}) {
  const { data } = usePortal();
  return <div className="live-choice-grid live-plan-grid">{plans.map(plan => <button type="button" className={'plan-card live-choice live-plan-compact' + (plan.id===value?' live-selected':'')}
    key={plan.id} aria-pressed={plan.id===value} onClick={() => onSelect(plan.id)}>
    <span className="live-plan-heading"><strong>{plan.tld || plan.name}</strong>{plan.provider && <small>{plan.provider}</small>}</span>
    <span className="live-plan-pricing"><PriceSummary price={planPricing(plan,data.taxRate)} empty="Quote on request"/>
      {(plan.unit_amount!=null || plan.net_unit_amount!=null) && <small className="live-plan-term">{plan.unit==='seat' ? 'Per seat, per year' : 'Per year'}</small>}</span>
    {specificationEntries(plan.specifications).slice(0,2).map(([key,text]) => <small className="live-plan-feature" key={key}
      title={text}>{key==='summary' || key==='description' ? text : label(key)+' · '+text}</small>)}
  </button>)}</div>;
}

function Change({service:s}) {
  const { data,estimate,open } = usePortal();
  const action = useCommand();
  const email = s.category==='email';
  const kind = email?'email_scale':'hosting_upgrade';
  const currentTier = s.plan_tier_rank ?? data.plans.find(p => p.id===s.plan_id)?.tier_rank;
  const candidates = data.plans.filter(p => p.catalog_item_id===s.catalog_item_id && p.tier_rank>currentTier && p.unit_amount!=null);
  const [planId,setPlan] = useState('');
  const [quantity,setQuantity] = useState(s.quantity+1);
  const [result,setResult] = useState(null);
  const [pending,setPending] = useState(false);
  const [error,setError] = useState('');
  const fields = { kind, existing_service_id:s.id, ...(email ? { requested_quantity:Number(quantity) } : { requested_plan_id:planId }) };
  const calculatedPrice = key => priceBreakdown(result[key],{
    inclusive:result.tax_inclusive ?? s.tax_inclusive, taxRate:data.taxRate, netUnit:result.netPrices?.[key],
  });
  async function calculate(event) {
    event.preventDefault();
    setPending(true); setError(''); setResult(null);
    try { setResult(await estimate(fields)); } catch (problem) { setError(problem.message); } finally { setPending(false); }
  }
  return <Frame drawer title={email?'Resize business email':'Upgrade hosting'} subtitle={s.title}>
    <form onSubmit={calculate}>
      <div className="review-box"><Row label="Current plan">{s.plan || '—'}</Row>
        <Row label={email?'Current licenses':'Current quantity'}>{s.quantity}</Row><Row label="Term ends">{date(s.term_end)}</Row></div>
      {email && <p className="live-copy">Add licenses for the rest of your current term.</p>}
      {email ? <Field id="new-seats" label="New total licenses" type="number" min={s.quantity+1} max={10000}
        value={quantity} onChange={event => { setQuantity(event.target.value); setResult(null); }} disabled={pending||action.busy} required/> :
        candidates.length ? <fieldset disabled={pending||action.busy}><legend>Choose a higher plan</legend><PlanCards plans={candidates} value={planId}
          onSelect={id => { setPlan(id); setResult(null); }}/></fieldset> : <Info>There are no higher plans in the current hosting family. Contact Safcodes to discuss your options.</Info>}
      <ErrorMessage error={error}/>
      <Actions><Btn primary type="submit" disabled={pending||action.busy||(email ? s.quantity>=10000 : !planId)}>{pending?'Calculating…':'Calculate estimate'}</Btn></Actions>
    </form>
    {result && <div className="live-section"><div className="review-box">
      <Row label="Remaining term">{result.remaining} of {result.term} days</Row><Row label="Current expiry">{date(result.term_end)}</Row>
      <Row label={email?'New total licenses':'Upgrade quantity'}>{email ? Number(quantity) : s.quantity}</Row>
      <Row label="Annual unit price after change"><PriceSummary price={calculatedPrice('unit')}/></Row>
      <Row label="Current annual total"><PriceSummary price={calculatedPrice('oldAnnual')}/></Row>
      <Row label="New annual total"><PriceSummary price={calculatedPrice('newAnnual')}/></Row>
      <PriceRows label="Prorated charge" price={result.charge || calculatedPrice('amount')}/>
    </div><p>Safcodes will confirm the price and issue a quote before any change is applied.</p>
    <ErrorMessage error={action.error}/><Actions><Btn primary disabled={action.busy} onClick={() => action.run('request',
      { ...fields, brief:email?'Please increase my total email licenses.':'Please upgrade my hosting plan.' }, value => open('order',value.id))}>Submit change request</Btn></Actions></div>}
  </Frame>;
}

function RequestFlow({category,options}) {
  const { data,open } = usePortal();
  const action = useCommand();
  const initialItem = data.catalog.find(i => i.category===category);
  const [segment,setSegment] = useState(initialItem?.segment || 'product');
  const [itemId,setItem] = useState(initialItem?.id || '');
  const [planId,setPlan] = useState(options?.planId || '');
  const [step,setStep] = useState(initialItem ? 1 : 0);
  const [details,setDetails] = useState({ title:'', domain_name:'', requested_quantity:'1', requested_years:'1', brief:'' });
  const item = data.catalog.find(i => i.id===itemId);
  const product = item?.segment==='product';
  const needsPlan = product && item.category!=='qr_code';
  const [domainSource,setDomainSource] = useState('manual');
  const domains = data.services.filter(s => s.category==='domain' && s.domain && !['cancelled','terminated'].includes(s.status));
  const catalogue = Object.keys(requestCategories).flatMap(type => data.catalog.filter(c => c.category===type &&
    c.segment===segment && (category!=='hosting' || ['shared_hosting','cloud_hosting'].includes(type))));
  const provider = item?.category==='email' && options?.provider;
  const plans = data.plans.filter(p => p.catalog_item_id===itemId && (!needsPlan || p.unit_amount!=null) &&
    (!provider || emailProvider(p)===provider));
  const plan = plans.find(p => p.id===planId);
  const units = product ? Number(details.requested_quantity) * Number(details.requested_years) : 1;
  const price = plan ? planPricing(plan,data.taxRate,units) : null;
  const set = field => event => setDetails(previous => ({ ...previous,[field]:event.target.value }));
  const chosen = (next) => { setItem(next); setPlan(''); setDomainSource('manual'); setDetails({ title:'',domain_name:'',requested_quantity:'1',requested_years:'1',brief:'' }); };
  const submit = () => action.run('request', {
    kind:product?'new_product':'new_service', catalog_item_id:itemId, requested_plan_id:plan?.id || null,
    ...(needsPlan ? { domain_name:details.domain_name, requested_years:Number(details.requested_years),
      requested_quantity:Number(details.requested_quantity) } : { title:details.title }), brief:details.brief,
  }, result => open('order',result.id));
  const providerName = emailProviders.find(option => option.id===provider)?.label;
  const requestTitle = providerName ? 'Request '+providerName : category==='hosting' ? 'Add New Hosting'
    : initialItem ? 'Request ' + requestCategories[initialItem.category] : 'Request a product or service';
  const currentStep = item ? step : 0;
  return <Frame drawer={Boolean(category)} title={requestTitle} subtitle="This creates an order for Admin review. A quote or invoice follows after review.">
    <Steps step={currentStep} names={['Choose a category','Plan and requirements','Review request']}/>
    {currentStep===0 && <>{category!=='hosting' && <Tabs items={[{id:'product',label:'Products'},{id:'service',label:'Services'}]} value={segment}
      onChange={next => { setSegment(next); chosen(''); }}/>}
      <div className="live-choice-grid">{catalogue.map(c => <button key={c.id} className={'live-choice'+(itemId===c.id?' live-selected':'')}
      type="button" aria-pressed={itemId===c.id} onClick={() => chosen(c.id)}><ServiceIcon category={c.category}/><strong>{requestCategories[c.category]}</strong>
      <small>{c.description || label(c.segment)}</small></button>)}</div>
      {!catalogue.length && <Info>No catalogue items are available yet. Contact Safcodes to discuss your requirements.</Info>}
      <Actions><Btn primary disabled={!item} end="right" onClick={() => setStep(1)}>Continue</Btn></Actions></>}
    {currentStep===1 && <form onSubmit={event => { event.preventDefault(); setStep(2); }}>
      {plans.length>0 && <fieldset><legend>{needsPlan?'Choose a plan':'Choose a plan (optional)'}</legend><PlanCards plans={plans} value={planId}
        onSelect={id => setPlan(id===planId&&!needsPlan?'':id)}/></fieldset>}
      {needsPlan && !plans.length && <Info>{providerName ? 'Safcodes has not published a priced plan for '+providerName+'.'
        : 'This category has no priced plans available yet.'}</Info>}
      {needsPlan ? <>
        {item.category!=='domain' && domains.length>0 && <Field id="domain-source" label="Use an existing domain">
          <select id="domain-source" value={domainSource} onChange={event => {
            const value=event.target.value;
            setDomainSource(value); setDetails(previous => ({ ...previous,domain_name:value==='manual'?'':value }));
          }}><option value="manual">Enter a domain</option>
            {[...new Set(domains.map(s => s.domain))].map(name => <option key={name} value={name}>{name}</option>)}
          </select></Field>}
        {domainSource==='manual' && <Field id="request-domain" label={item.category==='domain'?'Full domain name':item.category==='security'?'Protected domain (base domain for wildcard SSL)':'Domain for this service'} required maxLength={253}
          placeholder={'example' + (plan?.tld || '.com')} value={details.domain_name} onChange={set('domain_name')}/>}
        <div className="live-form-grid"><Field id="request-years" label={item.category==='security'?'Subscription term in years':'Term in years'} type="number" min={1} max={10} required value={details.requested_years} onChange={set('requested_years')}/>
          {item.category==='email' && <Field id="request-seats" label="License quantity" type="number" min={1} max={10000} required value={details.requested_quantity} onChange={set('requested_quantity')}/>}</div></>
        : <Field id="request-title" label="Request title" required maxLength={300} value={details.title} onChange={set('title')}/>}
      {item.category==='security' && <Info>The term is for subscription billing. Safcodes will confirm certificate coverage and issuance separately.</Info>}
      <Field id="request-brief" label="Requirements"><textarea id="request-brief" required maxLength={2000} rows={4} value={details.brief} onChange={set('brief')}/></Field>
      {price && <div className="review-box"><PriceRows label="Indicative price" price={price}/></div>}
      <Actions><Btn onClick={() => setStep(0)}>Choose another category</Btn><Btn primary type="submit" disabled={needsPlan&&!plan}>Review request</Btn></Actions>
    </form>}
    {currentStep===2 && <><div className="review-box"><Row label="Category">{requestCategories[item.category]}</Row>{plan && <Row label="Plan">{plan.name}</Row>}
      <Row label={needsPlan?'Domain':'Title'}>{needsPlan?details.domain_name:details.title}</Row>{needsPlan && <Row label={item.category==='security'?'Subscription term':'Term'}>{details.requested_years} year(s)</Row>}
      {item.category==='email' && <Row label="Licenses">{details.requested_quantity}</Row>}
      {price ? <PriceRows label="Catalogue estimate" price={price}/> : <Row label="Catalogue estimate">To be quoted</Row>}</div>
      <p className="live-copy">{details.brief}</p><ErrorMessage error={action.error}/>
      <Actions><Btn disabled={action.busy} onClick={() => setStep(1)}>Back</Btn><Btn primary disabled={action.busy} onClick={submit}>Submit order</Btn></Actions></>}
  </Frame>;
}

function InvoicePaymentActions({invoice:i,suppressCheckout=false}) {
  const action = useCommand();
  if (Number(i.balance)<=0) return <Info icon="check">This invoice has been settled.</Info>;
  return <>
    <Info icon="link">{i.payment_link ? 'Open the payment link provided by Safcodes.' :
      i.payment_link_requested ? 'Payment link requested. It will appear here after Safcodes adds it.' :
      'Request a payment link from Safcodes.'}</Info>
    {i.payment_link && <p className="live-copy">Payment opens in a new window. Return here to see the verified result.</p>}
    <ErrorMessage error={action.error}/>
    <Actions>
      <Btn icon="link" disabled={action.busy||i.payment_link_requested||Boolean(i.payment_link)} onClick={() => action.run('payment_link',{ id:i.id })}>
        {i.payment_link_requested?'Payment Link Requested':'Request Payment Link'}</Btn>
      {i.payment_link && <a className="btn" href={i.payment_link} target="_blank" rel="noopener noreferrer">Open Payment Link <Icon name="right"/></a>}
      {!suppressCheckout && (invoiceCheckoutEligible(i) ? <CheckoutButton kind="invoice" targetId={i.id}/> : !i.payment_link && <Btn primary disabled title="Available after a payment link is added">Pay Now</Btn>)}
      {i.can_check_payment && <Btn icon="refresh" disabled={action.busy} onClick={() => action.run('check_payment',{id:i.id})}>Check payment status</Btn>}
    </Actions>
  </>;
}

function Invoice({invoice:i}) {
  return <Frame drawer title={i.invoice_no} subtitle={`${i.billing_name} · Issued ${date(i.issued_on)}`}>
    <div className="live-status"><Badge>{label(i.payment_status)}</Badge><span>Due {date(i.due_on)}</span></div>
    <div className="review-box">
      {i.lines.map((line,n) => <Row key={n} label={line.description}>{line.net_amount==null
        ? aed(line.gross_amount)+' incl. VAT' : aed(line.net_amount)}</Row>)}
      <Row label="Subtotal excl. VAT">{aed(i.net_amount)}</Row><Row label="VAT">{aed(i.tax_amount)}</Row><Row label="Invoice total">{aed(i.gross_amount)}</Row>
      {Number(i.paid_amount)>0 && <Row label="Payments received">{aed(i.paid_amount)}</Row>}
      {Number(i.credited_amount)>0 && <Row label="Credits">{aed(i.credited_amount)}</Row>}
      <Row label="Outstanding balance" total>{aed(i.balance)}</Row>
    </div>
    <InvoicePaymentActions invoice={i}/>
    {!!i.payments.length && <div className="live-section"><h3>Verified payments</h3>{i.payments.map(p =>
      <Row key={p.id} label={date(p.received_on)+' · '+label(p.method)}>{aed(p.amount)}</Row>)}</div>}
  </Frame>;
}

function Contract({contract:c,paymentFirst=false}) {
  const { data,open } = usePortal();
  const invoices = data.invoices.filter(i => i.lines.some(l => l.contract_id===c.id));
  const outstanding = invoices.filter(i => Number(i.balance)>0);
  const action = useCommand();
  const [selection,setSelection] = useState(outstanding[0]?.id || '');
  useEffect(() => { if (!selection && outstanding[0]) setSelection(outstanding[0].id); }, [selection,outstanding[0]?.id]);
  const invoice = invoices.find(i => i.id===selection) || outstanding[0];
  return <Frame drawer title={paymentFirst?'Agreement payment':c.title} subtitle={paymentFirst?c.title:c.contract_no+' · '+(c.plan||label(c.contract_type))}>
    <div className="live-status"><Badge>{label(c.status)}</Badge></div>
    <div className="review-box"><Row label="Agreement term">{date(c.start_date)} – {date(c.end_date)}</Row>
      <Row label="Billing cycle">{c.billing_cycle_months} month(s)</Row>{c.billing && <>
        <PriceRows label="Annual contract price" price={priceBreakdown(c.annual_value,{
          inclusive:c.tax_inclusive,taxRate:data.taxRate,netUnit:c.billing.annualNet,
        })}/>
        <PriceRows label="Instalment price" price={priceBreakdown(c.billing.nextAmount,{
          inclusive:c.tax_inclusive,taxRate:data.taxRate,netUnit:c.billing.nextNet,
        })}/>
        <p className="live-copy">AMC / SLA contract prices exclude VAT. VAT is added to each billing period.</p>
        <Row label="Last verified payment">{date(c.last_payment_received_at)}</Row><Row label="Payment due">{date(c.payment_due_on)}</Row>
        <Row label="Days to due">{c.days_to_due ?? '—'}</Row><Row label="Past-due periods">{c.billing.overdueMonths} month(s)</Row>
        <Row label="Outstanding invoiced balance incl. VAT">{aed(c.outstanding_amount)}</Row>
        <Row label="Past-due invoiced amount incl. VAT">{aed(c.billing.overdueBalance)}</Row>
        {Number(c.billing.unissuedOverdue)>0 && <PriceRows label="Past-due scheduled amount awaiting invoice" price={priceBreakdown(c.billing.unissuedOverdue,{taxRate:data.taxRate})}/> }
      </>}</div>
    {c.scope && <><h3>Scope</h3><p className="live-copy">{c.scope}</p></>}
    {c.response_target_minutes && <Row label="Initial response target">{c.response_target_minutes} minutes</Row>}
    <Actions><CheckoutButton kind="contract" targetId={c.id}/></Actions>
    {invoice && <div className="live-section"><h3>Payment</h3>
      {invoices.length>1 && <Field id="agreement-payment-invoice" label="Choose an invoice"><select id="agreement-payment-invoice" value={invoice.id} onChange={event => setSelection(event.target.value)}>
        {invoices.map(i => <option key={i.id} value={i.id}>{i.invoice_no} · {Number(i.balance)>0 ? aed(i.balance)+' outstanding' : 'Settled'}</option>)}
      </select></Field>}
      <Row label={invoice.invoice_no} total>{aed(invoice.balance)}</Row>
      <InvoicePaymentActions key={invoice.id} invoice={invoice} suppressCheckout/>
    </div>}
    {!invoice && c.billing && <div className="live-section"><h3>Next instalment payment</h3>
      <Info icon="calendar">{c.payment_link_requested ? 'Payment link requested. Safcodes will issue the invoice and publish its link here.'
        : c.billing.nextPeriodStart ? 'Request a payment link for the next scheduled instalment. Safcodes will review and issue the invoice first.'
        : 'There are no further scheduled instalments for this agreement.'}</Info>
      {c.billing.nextPeriodStart && <><Row label="Scheduled payment">{date(c.billing.nextDue)}</Row>
        <ErrorMessage error={action.error}/><Actions><Btn icon="link" primary disabled={action.busy||c.payment_link_requested}
          onClick={() => action.run('contract_payment_link',{id:c.id,period_start:c.billing.nextPeriodStart})}>
          {c.payment_link_requested?'Payment Link Requested':'Request Payment Link'}</Btn></Actions></>}
    </div>}
    {invoices.length>0 && <div className="live-section"><h3>Agreement invoices</h3><div className="mini-list">
      {invoices.map(i => <button key={i.id} onClick={() => open('invoice',i.id)}><Icon name="document"/><span><strong>{i.invoice_no}</strong>
        <small>Due {date(i.due_on)} · {aed(i.balance)} outstanding</small></span><Icon name="right"/></button>)}
    </div></div>}
  </Frame>;
}

function Thread({id,collection,messages,closed}) {
  const action = useCommand();
  async function reply(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await action.run('reply',{ id,collection,body:new FormData(form).get('body') }, () => form.reset());
  }
  return <div className="live-section"><h3>Conversation</h3>{messages.length ? <div className="live-thread">{messages.map(m => <article key={m.id}>
    <strong>{m.author}</strong><time>{date(m.created_at)}</time><p className="live-copy">{m.body}</p></article>)}</div> : <p>No messages yet.</p>}
    {!closed && <form onSubmit={reply}><Field id="conversation-reply" label="Your reply">
      <textarea id="conversation-reply" name="body" maxLength={2000} required rows={3}/></Field>
      <ErrorMessage error={action.error}/><Actions><Btn type="submit" primary disabled={action.busy} icon="send">Send reply</Btn></Actions></form>}
  </div>;
}
function Order({order:o}) {
  const { data,permits,open } = usePortal();
  const [confirmingQuote,setConfirmingQuote] = useState(null);
  const confirmed = confirmingQuote === o.quote_id;
  const action = useCommand();
  const invoice = data.invoices.find(i => i.lines.some(l => l.order_id===o.id));
  const price = orderPricing(o,data.taxRate);
  return <Frame drawer title={o.title} subtitle={o.order_no+' · '+(o.amc_request?'AMC contract request':label(o.kind))}>
    <div className="live-status"><Badge>{label(o.status)}</Badge><span>Submitted {date(o.created_at)}</span></div>
    <p className="live-copy">{o.brief}</p>{o.customer_status_note && <Info icon="chat">{o.customer_status_note}</Info>}
    {o.requested_plan && <Row label="Requested plan">{o.requested_plan}</Row>}
    {o.requested_domain && <Row label="Requested domain">{o.requested_domain}</Row>}
    {o.kind==='email_scale' && <Row label="New total licenses">{o.requested_quantity}</Row>}
    {o.request_payment_link && !invoice && <Info icon="link">Payment link requested. Safcodes will add it after issuing the invoice.</Info>}
    {o.quote_id ? <div className="review-box"><PriceRows label="Quote subtotal" price={price}/>
      <Row label="Quote valid until">{date(o.quote_expires_at)}</Row><p className="live-copy">{o.quote_terms}</p>
      {o.status==='quoted' && o.quote_valid && permits('billing.view') && <>
        <label className="live-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmingQuote(e.target.checked ? o.quote_id : null)}/> I accept this quote and its terms.</label>
        <ErrorMessage error={action.error}/><Actions><Btn primary disabled={!confirmed||action.busy} onClick={() => action.run('accept_quote',{ id:o.id,quote_id:o.quote_id })}>Accept quote</Btn></Actions>
      </>}{o.status==='quoted' && !o.quote_valid && <Info>This quote expired. Ask Safcodes for an updated quote.</Info>}
    </div> : price && <div className="review-box"><PriceRows label="Initial estimate" price={price}/></div>}
    {invoice && <Actions><Btn primary onClick={() => open('invoice',invoice.id)} end="right">View issued invoice</Btn></Actions>}
    <Thread id={o.id} collection="orders" messages={o.messages} closed={['completed','rejected','cancelled','superseded'].includes(o.status)}/>
  </Frame>;
}
function Ticket({ticket:t}) {
  const action = useCommand();
  const closed = ticketClosed(t);
  return <Frame drawer title={t.subject} subtitle={t.ticket_no}>
    <div className="live-status"><Badge>{label(t.status)}</Badge><span>{label(t.priority)} priority</span></div>
    <ErrorMessage error={action.error}/>
    <Actions><Btn icon={closed?'refresh':'check'} disabled={action.busy} onClick={() => action.run('ticket_status',
      { id:t.id,status:closed?'open':'closed' })}>{ticketAction(t)}</Btn></Actions>
    <Thread id={t.id} collection="tickets" messages={t.messages} closed={closed}/>
  </Frame>;
}
function NewTicket({serviceId}) {
  const { data,open } = usePortal();
  const action = useCommand();
  return <Frame drawer title="New support ticket" subtitle="Send your question to the Safcodes team.">
    <form onSubmit={event => { event.preventDefault(); action.run('ticket',Object.fromEntries(new FormData(event.currentTarget)), result => open('ticket',result.id)); }}>
      <Field id="ticket-subject" name="subject" label="Subject" required maxLength={300}/>
      <Field id="ticket-service" label="Related service"><select id="ticket-service" name="service_id" defaultValue={serviceId||''}>
        <option value="">General question</option>{data.services.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></Field>
      <div className="live-form-grid"><Field id="ticket-department" label="Department"><select id="ticket-department" name="department" defaultValue="technical">
        <option value="technical">Technical support</option><option value="billing">Billing</option><option value="sales">Sales</option><option value="delivery">Delivery</option>
      </select></Field><Field id="ticket-priority" label="Priority"><select id="ticket-priority" name="priority" defaultValue="normal">
        {['low','normal','high','urgent'].map(s => <option value={s} key={s}>{label(s)}</option>)}
      </select></Field></div>
      <Field id="ticket-body" label="Message"><textarea id="ticket-body" name="body" required rows={4} maxLength={2000}/></Field>
      <ErrorMessage error={action.error}/><Actions><Btn primary type="submit" disabled={action.busy}>Create ticket</Btn></Actions>
    </form>
  </Frame>;
}

function PasswordReset() {
  const { session,signOut } = usePortal();
  const [challengeId,setChallengeId] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function send() {
    setBusy(true); setError('');
    try { setChallengeId((await api('/auth/reset/request',{ email:session.user.email })).challengeId); }
    catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  async function confirm(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError('');
    try {
      await api('/auth/reset/confirm',{ ...fields,challengeId });
      await signOut('Password updated. Sign in with your new password.');
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  return <Frame drawer title="Reset password" subtitle="Verify your sign-in email to choose a new password.">
    <Row label="Sign-in email">{session.user.email}</Row>
    <ErrorMessage error={error}/>
    {challengeId ? <form onSubmit={confirm}>
      <Info icon="mail">Enter the six-digit code from your email. The code expires in five minutes.</Info>
      <Field id="reset-code" name="code" label="Verification code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/>
      <Field id="reset-password" name="password" label="New password" type="password" autoComplete="new-password" minLength={12} required/>
      <Field id="reset-confirmation" name="confirmation" label="Confirm new password" type="password" autoComplete="new-password" minLength={12} required/>
      <Actions><Btn primary type="submit" disabled={busy}>Update password</Btn><Btn disabled={busy} onClick={send}>Send a new code</Btn></Actions>
    </form> : <Actions><Btn primary icon="mail" disabled={busy} onClick={send}>Send reset code</Btn></Actions>}
  </Frame>;
}
