'use client';
import { useEffect, useRef, useState } from 'react';
import Auth from './Auth';
import { api, accountPath } from './api';
import { aed, changeEligible, date, daysTo, duration, emailProvider, emailProviders, exVat, label,
  orderPricing, priceBreakdown, renewable, requestCategories, servicePricing, ticketAction, ticketClosed } from './data';
import { ActionMenu, Badge, Brand, Btn, Empty, Expiry, Field, Heading, Icon, Info, LayoutToggle, Panel,
  PriceSummary, Row, ServiceIcon, Tabs } from './ui';
import { PortalDialog } from './PortalDialog';

import { Context, usePortal, useCommand, invoiceForService, openRenewal } from './portal-context';
const renewalLink = ['renewals','Renewals','refresh'];
const workspaceLinks = [['overview','Dashboard','grid'],['portfolio','All products & services','layers'],renewalLink];
const profileLink = ['profile','Profile & security','user'];
const businessGroups = [
  ['products','Products','package', [['domains','Domains','globe'],['hosting','Hosting','server'],['email','Business Emails','mail'],['qr','QR Code','qr']]],
  ['services','Services','spark', [['websites','Websites & portals','website'],['stores','Online stores','store'],
    ['apps','Mobile apps','mobile'],['marketing','Digital marketing','megaphone'],['contracts','AMC / SLA','shield']]],
];
const accountGroups = [
  ['support','Support','help', [['support','Support tickets','chat']]],
  ['billing','Billing','wallet', [['orders','Orders & requests','requests'],['invoices','Invoices & payments','document'],['payment-methods','Payment methods','card']]],
];
const groups = [...businessGroups, ...accountGroups];
const allLinks = [...workspaceLinks, ...groups.flatMap(([, , , items]) => items), profileLink];
const names = { ...Object.fromEntries(allLinks.map(([id,name]) => [id,name])), projects:'Websites, stores & apps' };
const categories = {
  domains: ['domain'], hosting: ['shared_hosting','cloud_hosting'], email: ['email'], qr: ['qr_code'],
  projects: ['website','web_portal','online_store','mobile_app'], websites: ['website','web_portal'],
  stores: ['online_store'], apps: ['mobile_app'], marketing: ['digital_marketing','performance_marketing'],
};
const routeNow = () => {
  const page = window.location.hash.replace(/^#\/?/, '');
  return Object.hasOwn(names,page) ? page : 'overview';
};
const dueInvoices = data => data.invoices.filter(i => Number(i.balance)>0);
const upcomingRenewals = data => data.services.filter(s => renewable(s) && daysTo(data.asOf,s.term_end)<=30);
const openTickets = data => data.tickets.filter(t => !ticketClosed(t));
const countLabel = (number, name) => number + ' ' + name + (number===1 ? '' : 's');

export default function Portal() {
  const [session,setSession] = useState(undefined);
  const [sessionError,setSessionError] = useState('');
  const [message,setMessage] = useState('');
  const [accountId,setAccountId] = useState('');
  const [workspace,setWorkspace] = useState(null);
  const [error,setError] = useState('');
  const [page,setPage] = useState('overview');
  const [modal,setModal] = useState(null);
  const [menu,setMenu] = useState(false);
  const [expandedGroups,setExpandedGroups] = useState({ products:true,services:true });
  const [toast,setToast] = useState('');
  const [refreshing,setRefreshing] = useState(false);
  const currentAccount = useRef('');
  const timer = useRef(null);
  const revision = useRef(0);
  const menuButton = useRef(null);
  const closeMenuButton = useRef(null);
  const account = session?.accounts.find(a => a.id === accountId);
  const data = workspace?.id === accountId ? workspace.data : null;

  function expire() {
    currentAccount.current = '';
    setWorkspace(null);
    setSession(null);
    setModal(null);
  }
  async function loadSession(verified = false) {
    setSessionError('');
    try {
      const next = await api('/session');
      const id = next.accounts.some(a => a.id === currentAccount.current) ? currentAccount.current : next.accounts[0].id;
      currentAccount.current = id;
      setSession(next);
      setAccountId(id);
      setMessage('');
    } catch (problem) {
      if (verified) throw problem;
      setSession(null);
      if (problem.status !== 401) setSessionError(problem.message);
    }
  }
  async function refresh(id = currentAccount.current) {
    if (!id) return;
    const request = ++revision.current;
    setError('');
    setRefreshing(true);
    try {
      const next = await api(accountPath(id,'workspace'));
      if (currentAccount.current === id && request === revision.current) setWorkspace({ id, data: next });
    } catch (problem) {
      if (currentAccount.current !== id || request !== revision.current) return;
      if (problem.status === 401 || problem.status === 404) {
        expire();
        setMessage('Your access changed or your session expired. Sign in again to continue.');
      } else setError(problem.message);
    } finally {
      if (request === revision.current) setRefreshing(false);
    }
  }
  useEffect(() => {
    loadSession();
    function updateRoute() { setPage(routeNow()); setMenu(false); setModal(null); }
    updateRoute();
    window.addEventListener('hashchange',updateRoute);
    return () => { window.removeEventListener('hashchange',updateRoute); clearTimeout(timer.current); };
  }, []);
  useEffect(() => { if (accountId) refresh(accountId); }, [accountId]);
  useEffect(() => {
    window.scrollTo(0,0);
    const group = page==='projects' ? 'services' : groups.find(([, , , items]) => items.some(([id]) => id===page))?.[0];
    if (group) setExpandedGroups(previous => previous[group] ? previous : { ...previous,[group]:true });
  }, [page]);
  useEffect(() => {
    if (!menu) return;
    closeMenuButton.current?.focus();
    function onEscape(event) { if (event.key==='Escape') closeMenu(); }
    window.addEventListener('keydown',onEscape);
    return () => window.removeEventListener('keydown',onEscape);
  }, [menu]);
  useEffect(() => {
    if (!data || modal) return;
    function onSearch(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k') {
        event.preventDefault();
        setModal({ type:'search' }); setMenu(false);
      }
    }
    window.addEventListener('keydown',onSearch);
    return () => window.removeEventListener('keydown',onSearch);
  }, [data,modal]);
  useEffect(() => {
    if (!accountId) return;
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(accountId); };
    window.addEventListener('focus',onFocus);
    return () => window.removeEventListener('focus',onFocus);
  }, [accountId]);

  function notify(text) {
    clearTimeout(timer.current);
    setToast(text);
    timer.current = setTimeout(() => setToast(''), 5000);
  }
  function go(target) {
    window.history.pushState(null,'','#/' + target);
    setPage(target); setModal(null); setMenu(false);
  }
  function closeMenu() {
    setMenu(false);
    menuButton.current?.focus();
  }
  function switchAccount(id) {
    if (id === accountId) return;
    currentAccount.current = id;
    setAccountId(id); setWorkspace(null); setToast('');
    go('overview');
  }
  async function signOut(reason) {
    try { await api('/auth/logout',{}); }
    catch (problem) { if (problem.status !== 401) { notify(problem.message); return; } }
    expire();
    setAccountId('');
    go('overview');
    setMessage(typeof reason==='string' ? reason : 'You signed out.');
  }
  async function command(action,fields,key) {
    const id = currentAccount.current;
    try {
      const result = await api(accountPath(id,'commands'),{ action, data: fields },key);
      await refresh(id);
      notify(result.message);
      return result;
    } catch (problem) {
      if (problem.status === 401) {
        expire();
        setMessage('Your session expired. Sign in again to continue.');
      }
      throw problem;
    }
  }
  async function updateProfile(fields) {
    const result = await api('/profile',fields);
    setSession(previous => ({ ...previous, user: { ...previous.user, ...result } }));
    notify('Profile updated.');
  }
  if (session === undefined) return <div className="loading-screen"><Brand/><p>Checking your sign-in…</p></div>;
  if (!session) return <Auth onSuccess={() => loadSession(true)} message={message || sessionError}/>;

  const permits = permission => account?.permissions.includes(permission);
  const visible = id => ['invoices','payment-methods'].includes(id) ? permits('billing.view') : id === 'orders' ? permits('orders.create') :
    id === 'support' ? permits('support.create') : true;
  const open = (type,id,options) => { setModal({ type,id,options }); setMenu(false); };
  const counts = data ? {
    ...Object.fromEntries(Object.entries(categories).map(([id,types]) => [id,data.services.filter(s => types.includes(s.category)).length])),
    renewals:upcomingRenewals(data).length, contracts:data.contracts.length, support:openTickets(data).length,
  } : {};
  const links = (items, showCounts = false) => items.filter(([id]) => visible(id)).map(([id,title,icon]) =>
    <button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={() => go(id)}>
      <Icon name={icon}/><span>{title}</span>
      {showCounts && counts[id]!=null && <small className={id==='renewals'?'count':undefined} aria-hidden="true">{counts[id]}</small>}
    </button>);
  const groupMenu = ([id,title,icon,items]) => {
    const allowedItems = items.filter(([item]) => visible(item));
    if (!allowedItems.length) return null;
    const expanded = Boolean(expandedGroups[id]);
    const hasActive = allowedItems.some(([item]) => item===page) || (id==='services' && page==='projects');
    return <div className="nav-group" key={id}>
      <button type="button" className={'group-toggle' + (hasActive?' has-active':'')}
        aria-expanded={expanded} aria-controls={'nav-' + id}
        onClick={() => setExpandedGroups(previous => ({ ...previous,[id]:!previous[id] }))}>
        <Icon name={icon}/><span>{title}</span><Icon name="down" className={'chevron' + (expanded?' expanded':'')}/>
      </button>
      <div className="nav-sub" id={'nav-' + id} hidden={!expanded}>{links(allowedItems,true)}</div>
    </div>;
  };
  const initials = account?.display_name.trim().split(/\s+/).slice(0,2).map(word => word[0]).join('').toUpperCase();
  const context = { data, account, session, permits, go, open, close:() => setModal(null), command, signOut, updateProfile,
    estimate: fields => api(accountPath(account.id,'estimate'),fields), navigation:allLinks.filter(([id]) => visible(id)) };
  return <Context.Provider value={context}>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <div className="shell" inert={Boolean(modal)}>
      {menu && <div className="menu-backdrop visible" aria-hidden="true" onClick={closeMenu}/>}
      <aside id="portal-sidebar" className={'sidebar advanced' + (menu ? ' open' : '')} aria-label="Main navigation">
        <div className="live-sidebar-brand">
          <Brand/>
          <button type="button" ref={closeMenuButton} className="icon-button mobile-menu live-menu-close" aria-label="Close navigation" onClick={closeMenu}><Icon name="close"/></button>
        </div>
        <div className="sidebar-scroll">
          <div className="nav-label">Workspace</div>
          <nav className="nav" aria-label="Workspace">{links(workspaceLinks,true)}</nav>
          <div className="nav-label second">Manage your business</div>
          <nav className="nav group-nav" aria-label="Manage your business">
            {businessGroups.map(groupMenu)}
          </nav>
          <div className="nav-label second">Account & support</div>
          <nav className="nav group-nav" aria-label="Account & support">{accountGroups.map(groupMenu)}{links([profileLink])}</nav>
        </div>
        <div className="side-bottom">
          {permits('orders.create') && <button type="button" className="sidebar-request" disabled={!data} onClick={() => open('request')}>
            <Icon name="plus"/><span>Request something new</span><Icon name="right"/>
          </button>}
          <div className="live-sidebar-account">
            <button type="button" className="account account-button" onClick={() => go('profile')} aria-label="Profile & security">
              <span className="avatar">{initials}</span><span className="live-account-label"><strong>{account?.display_name}</strong><small>Client account</small></span>
              <Icon name="right"/>
            </button>
            <button type="button" className="icon-button live-sidebar-signout" aria-label="Sign out" onClick={signOut}><Icon name="logout"/></button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="crumb"><button ref={menuButton} className="icon-button mobile-menu" aria-label="Open navigation" aria-controls="portal-sidebar" aria-expanded={menu} onClick={() => setMenu(true)}><Icon name="menu"/></button>
            <span className="live-crumb-parent">Workspace</span><span className="live-crumb-divider" aria-hidden="true">/</span><strong>{names[page]}</strong></div>
          <div className="live-top-actions">
            <button type="button" className="live-workspace-search" onClick={() => open('search')} aria-label="Search workspace" disabled={!data}>
              <Icon name="search"/><span>Search workspace</span><kbd>Ctrl K</kbd>
            </button>
            {session.accounts.length>1 ? <select value={accountId} aria-label="Customer account" onChange={event => switchAccount(event.target.value)}>
              {session.accounts.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}</select> : <span className="live-account">{account?.display_name}</span>}
            <button className="icon-button" onClick={() => refresh()} aria-label="Refresh workspace" disabled={refreshing}><Icon name="refresh"/></button>
            <ActionMenu label="Account menu" icon="user" items={[
              ['Profile',() => go('profile'),'user'],['Log out',signOut,'logout'],
            ]}>{session.user.avatar && <img className="live-menu-avatar" src={session.user.avatar} alt=""/>}</ActionMenu>
          </div>
        </header>
        <main className="main" id="main" tabIndex={-1} key={page}>
          {error && <p className="live-error" role="alert">{error} <button type="button" className="text-button" onClick={() => refresh()}>Try again</button></p>}
          {data && data.taxRate===undefined && <div className="live-api-notice"><Info icon="help">
            This portal is connected to an older Admin API. Install the matching API files and restart it for current pricing and actions.
          </Info></div>}
          {!data ? <Panel><p role="status">{error ? 'Workspace unavailable.' : 'Loading your account…'}</p></Panel>
            : visible(page) ? <WorkspacePage page={page}/> : <Empty title="This page is restricted" description="Contact Safcodes if you need access."/>}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">{links([
        workspaceLinks[0],['portfolio','Products & services','layers'],
        ...accountGroups[1][3].slice(0,2),
      ])}</nav>
    </div>
    {modal && data && <PortalDialog key={modal.type + (modal.id || '')} modal={modal}/>}
    <div id="toast" className={toast?'show':''} role="status" aria-live="polite">{toast}</div>
  </Context.Provider>;
}

function WorkspacePage({page}) {
  switch (page) {
    case 'overview': return <Dashboard/>;
    case 'renewals': return <Renewals/>;
    case 'contracts': return <Contracts/>;
    case 'invoices': return <Invoices/>;
    case 'orders': return <Orders/>;
    case 'payment-methods': return <PaymentMethods/>;
    case 'support': return <Support/>;
    case 'profile': return <Profile/>;
    default: return <Portfolio page={page}/>;
  }
}

function Dashboard() {
  const { data, session, permits, open, go } = usePortal();
  const canBill = permits('billing.view');
  const canOrder = permits('orders.create');
  const canSupport = permits('support.create');
  const invoices = dueInvoices(data);
  const renewals = upcomingRenewals(data).sort((a,b) => a.term_end.localeCompare(b.term_end));
  return <div className="live-dashboard">
    <section className="live-welcome">
      <div><div className="eyebrow">YOUR DIGITAL WORKSPACE</div><h1>Dashboard</h1>
        <p>Welcome back, {session.user.display_name}. Here’s what needs your attention.</p></div>
      <div className="live-card-actions live-dashboard-actions">
        {canSupport && <Btn icon="chat" onClick={() => go('support')}>Support tickets</Btn>}
        {canOrder && <Btn primary icon="plus" onClick={() => open('request')}>Request a product or service</Btn>}
      </div>
    </section>
    <section aria-label="Product overview" className="live-product-grid">
      {businessGroups[0][3].filter(([id]) => id!=='qr').map(([id,title,icon]) => {
        const list = data.services.filter(s => categories[id].includes(s.category));
        const active = list.filter(s => s.status==='active').length;
        const due = renewals.filter(s => categories[id].includes(s.category)).length;
        return <button type="button" className="live-product-summary" key={id} onClick={() => go(id)}>
          <span className="service-icon blue"><Icon name={icon}/></span><span className="live-product-copy"><strong>{title}</strong>
            <span>{countLabel(active,'active subscription')}{due>0 && ' · ' + due + ' due soon or overdue'}</span></span>
          <span className="live-product-count">{list.length}<Icon name="right"/></span>
        </button>;
      })}
    </section>
    <div className="live-dash-columns live-dash-priority">
      {canBill && <Panel title="Upcoming invoices" subtitle={invoices.length ? aed(invoices.reduce((sum,i) => sum + Number(i.balance),0))+' outstanding' : 'Review open balances and due dates'}
        action={<Btn ghost end="right" onClick={() => go('invoices')}>View invoices</Btn>}>
        {invoices.length ? <div className="mini-list live-record-list">{invoices.slice(0,4).map(i => <button key={i.id} onClick={() => open('invoice',i.id)}>
          <span className="service-icon blue"><Icon name="document"/></span><span className="live-record-copy"><strong>{i.lines[0]?.description || i.invoice_no}</strong>
            <small>{i.invoice_no} · Due {date(i.due_on)}</small></span><strong className="live-dash-amount">{aed(i.balance)}</strong>
        </button>)}</div> : <Empty icon="document" title="No outstanding invoices" description="New invoices will appear here after Safcodes issues them."/>}
      </Panel>}
      <Panel title="Annual renewals" subtitle="Due in the next 30 days or overdue" className="live-dash-renewals"
        action={<Btn ghost end="right" onClick={() => go('renewals')}>View renewals</Btn>}>
        {renewals.length ? <div className="mini-list live-record-list">{renewals.slice(0,4).map(s => <button key={s.id} onClick={() => open('renewal',s.id)}>
          <ServiceIcon service={s}/><span className="live-record-copy"><strong>{s.title}</strong><small>{label(s.category)} · {date(s.term_end)}</small></span>
          <Badge>{s.term_end < data.asOf ? 'Overdue' : 'Due soon'}</Badge>
        </button>)}</div> : <Empty icon="refresh" title="No renewals due soon" description="You can check all expiry dates under Renewals."/>}
      </Panel>
    </div>
    <div className="live-dash-activity">
      <ServicePortfolio/>
      {canOrder && <Panel title="Recent orders & requests" action={<Btn ghost end="right" onClick={() => go('orders')}>View all</Btn>}>
        {data.orders.length ? <div className="mini-list live-record-list">{data.orders.slice(0,3).map(o => <button key={o.id} onClick={() => open('order',o.id)}>
          <ServiceIcon category={o.category}/><span className="live-record-copy"><strong>{o.title}</strong><small>{o.order_no} · {date(o.created_at)}</small></span><Badge>{label(o.status)}</Badge>
        </button>)}</div> : <Empty icon="requests" title="No orders yet" description="New requests and Admin updates will appear here."/>}
      </Panel>}
      {canSupport && <Panel title="Recent support tickets" subtitle={countLabel(openTickets(data).length,'open ticket')}
        action={<Btn ghost end="right" onClick={() => go('support')}>View all</Btn>}>
        {data.tickets.length ? <div className="mini-list live-record-list">{data.tickets.slice(0,3).map(t => <button key={t.id} onClick={() => open('ticket',t.id)}>
          <span className="service-icon blue"><Icon name="chat"/></span><span className="live-record-copy"><strong>{t.subject}</strong><small>{t.ticket_no} · {date(t.updated_at)}</small></span><Badge>{label(t.status)}</Badge>
        </button>)}</div> : <Empty icon="chat" title="No support tickets" description="Open a ticket if you need help with your account."/>}
      </Panel>}
    </div>
  </div>;
}

const portfolioGroups = [
  ['domains','Domains','#213d91'], ['hosting','Hosting','#4771cf'], ['email','Business emails','#117586'],
  ['qr','QR codes','#6656a3'], ['projects','Websites, stores & apps','#347d51'],
  ['marketing','Marketing','#906426'], ['portfolio','Other services','#5a6b85'],
];
function ServicePortfolio() {
  const { data,go } = usePortal();
  const total = data.services.length;
  const assigned = new Map();
  for (const service of data.services) {
    const group = portfolioGroups.find(([id]) => categories[id]?.includes(service.category))?.[0] || 'portfolio';
    assigned.set(group,(assigned.get(group) || 0)+1);
  }
  let offset = 0;
  const segments = portfolioGroups.flatMap(([id,name,color]) => {
    const count = assigned.get(id);
    if (!count) return [];
    const share = 100 * count / total;
    const segment = { id,name,color,count,share,offset };
    offset += share;
    return [segment];
  });
  return <Panel title="Service portfolio" subtitle="Assigned products and services" className="live-portfolio-chart">
    {total ? <div className="live-chart-content">
      <div className="live-donut" aria-hidden="true">
        <svg viewBox="0 0 100 100" focusable="false">
          <circle className="live-chart-track" cx="50" cy="50" r="42"/>
          {segments.map(s => <circle key={s.id} cx="50" cy="50" r="42" pathLength="100"
            transform="rotate(-90 50 50)" stroke={s.color} strokeDasharray={s.share+' '+(100-s.share)} strokeDashoffset={-s.offset}/>)}
        </svg>
        <div><strong>{total}</strong><span>Total</span></div>
      </div>
      <ul className="live-chart-legend" aria-label={countLabel(total,'assigned item')+' by category'}>
        {segments.map(s => <li key={s.id}><button type="button" onClick={() => go(s.id)}>
          <i style={{background:s.color}} aria-hidden="true"/><span>{s.name}</span><strong>{s.count}</strong>
        </button></li>)}
      </ul>
    </div> : <Empty icon="layers" title="No services assigned" description="Your active portfolio will appear here once services are added."/>}
  </Panel>;
}

function Search({query,setQuery,placeholder}) {
  return <div className="search"><Icon name="search"/><input aria-label={placeholder} placeholder={placeholder} value={query} onChange={e => setQuery(e.target.value)}/></div>;
}
const includes = (query,...values) => values.filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase());
const addLabels = { domains:'Add New Domain', hosting:'Add New Hosting', email:'Add New Business Email', qr:'Add New QR Code',
  websites:'Request a Website', stores:'Request an Online Store', apps:'Request a Mobile App', marketing:'Request Marketing' };
const hostingFilters = [{id:'All',label:'All hosting'},{id:'shared_hosting',label:'Shared hosting'},{id:'cloud_hosting',label:'Cloud hosting'}];

const deliveryPages = ['projects','websites','stores','apps','marketing'];

function Portfolio({page}) {
  const { data, open, permits } = usePortal();
  const assigned = data.services.filter(s => !categories[page] || categories[page].includes(s.category));
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState(() => page==='email'
    ? emailProviders.find(provider => assigned.some(s => emailProvider(s)===provider.id))?.id || 'microsoft' : 'All');
  const [view,setView] = useState(page==='portfolio'?'grid':'table');
  const qrPlans = page==='qr' ? [
    ...new Map([
      ...data.plans.filter(p => data.catalog.some(c => c.id===p.catalog_item_id && c.category==='qr_code')).map(p => [p.id,p.name]),
      ...assigned.filter(s => s.plan_id && s.plan).map(s => [s.plan_id,s.plan]),
    ]).entries(),
  ].map(([id,label]) => ({id,label})) : [];
  const tabs = {
    portfolio:['All','Product','Service'], hosting:hostingFilters, email:emailProviders,
    qr:[{id:'All',label:'All plans'},...qrPlans],
  }[page];
  const matchesTab = s => {
    if (filter==='All') return true;
    if (page==='email') return emailProvider(s)===filter;
    if (page==='qr') return s.plan_id===filter;
    return s.category===filter || label(s.segment)===filter;
  };
  const list = assigned.filter(s => matchesTab(s) && includes(query,s.title,s.domain,s.plan,s.provider,s.service_no,s.catalog_name,label(s.category)));
  const category = page==='hosting' ? (filter==='All'?'hosting':filter) : categories[page]?.[0];
  const options = page==='email' ? { provider:filter } : page==='qr' && filter!=='All' ? { planId:filter } : undefined;
  const add = permits('orders.create') ? () => open('request',category,options) : undefined;
  const buttonLabel = addLabels[page] || 'Request a product or service';
  return <>
    <Heading eyebrow="YOUR DIGITAL PORTFOLIO" title={names[page]} description="View the services and subscriptions assigned to your account." action={add} label={buttonLabel}/>
    {(assigned.length>0 || tabs) && <div className="filterbar live-table-toolbar">
      {tabs && <Tabs items={tabs} value={filter} onChange={setFilter} label={names[page]+' filters'}/>}
      <div className="view-search"><Search query={query} setQuery={setQuery} placeholder="Search your portfolio"/>
        <LayoutToggle label="Portfolio layout" value={view} onChange={setView}/>
      </div>
    </div>}
    {list.length ? view==='table'
      ? deliveryPages.includes(page) ? <DeliveryTable services={list}/> : <PortfolioTable services={list} page={page}/>
      : <div className="service-grid">{list.map(s => <ServiceCard key={s.id} service={s}/>)}</div>
      : <Panel><Empty title={assigned.length ? 'No matching services' : `No ${(page==='portfolio'?'products or services':names[page]).toLowerCase()} yet`}
        description={assigned.length ? 'No records match this filter or search.' : 'Approved and provisioned services will appear here.'}>
        {!assigned.length && add && <Btn primary icon="plus" onClick={add}>{buttonLabel}</Btn>}
      </Empty></Panel>}
  </>;
}

function ServiceCard({service:s}) {
  const { data,open,permits } = usePortal();
  const price = s.segment==='product' && permits('billing.view') ? servicePricing(s,data.taxRate) : null;
  return <article className="service-card">
    <div className="service-card-top"><ServiceIcon service={s}/><Badge>{label(s.status)}</Badge></div>
    <h2>{s.title}</h2><p>{s.plan || requestCategories[s.category] || label(s.category)}{s.provider && s.provider!==s.plan ? ' · ' + s.provider : ''}{s.domain && s.domain!==s.title ? ' · ' + s.domain : ''}</p>
    {s.billing_mode==='annual' ? <><Row label="Current expiry">{date(s.term_end)}</Row>
      <Row label="Expires in"><Expiry asOf={data.asOf} ends={s.term_end}/></Row></> : <Row label="Billing">{label(s.billing_mode)}</Row>}
    {price && <Row label="Price"><PriceSummary price={price}/></Row>}
    <div className="live-card-actions"><Btn onClick={() => open('service',s.id)}>View details</Btn><ProductActions service={s}/></div>
  </article>;
}

function ProductActions({service:s}) {
  const { data, permits, open } = usePortal();
  const items = [['View',() => open('service',s.id),'eye']];
  if (renewable(s) && (permits('orders.create') || invoiceForService(data,s) || openRenewal(data,s.id))) {
    items.push(['Renew',() => open('renewal',s.id),'refresh']);
  }
  if (permits('orders.create') && changeEligible(s,data.asOf)) {
    const email = s.category==='email';
    items.push([email?'Resize business email':'Upgrade hosting',() => open('change',s.id),email?'mail':'arrowUp']);
  }
  return <ActionMenu label={'Actions for ' + s.title} items={items}/>;
}

function ServiceName({service,subtitle}) {
  const { open } = usePortal();
  return <div className="service-cell"><ServiceIcon service={service}/>
    <button type="button" className="text-button service-text" onClick={() => open('service',service.id)}>
      <strong>{service.title}</strong><small>{subtitle || service.service_no}</small>
    </button>
  </div>;
}

function PortfolioTable({services,page}) {
  const { data,permits } = usePortal();
  const domains = page==='domains';
  const emails = page==='email';
  const products = domains || emails || page==='hosting' || page==='qr';
  const canSeePrice = permits('billing.view') && (products || page==='portfolio');
  return <Panel><div className="table-wrap"><table className="table portfolio-table live-data-table">
    <thead><tr><th scope="col">{domains?'Domain name':'Product or service'}</th>{!domains && <th scope="col">Plan / provider</th>}
      {emails && <th scope="col">Licenses</th>}
      <th scope="col">{products?'Start date':'Billing'}</th><th scope="col">{products?'Next renewal':'Renewal or next due'}</th>
      {products && <th scope="col">Expires in</th>}{canSeePrice && <th scope="col">Price</th>}
      <th scope="col">Status</th><th scope="col" className="live-actions-col">Actions</th></tr></thead>
    <tbody>{services.map(s => <tr key={s.id}>
      <td><ServiceName service={s} subtitle={domains && s.plan ? s.plan+' · '+s.service_no : s.domain!==s.title ? s.domain : null}/></td>
      {!domains && <td>{s.plan || s.catalog_name || label(s.category)}{s.provider && <small className="live-cell-note">{s.provider}</small>}</td>}
      {emails && <td>{s.quantity}</td>}
      <td>{products ? date(s.term_start) : label(s.billing_mode)}</td><td>{date(s.billing_mode==='annual' ? s.term_end : s.next_due_date)}</td>
      {products && <td><Expiry asOf={data.asOf} ends={s.term_end}/></td>}
      {canSeePrice && <td>{s.segment==='product' ? <PriceSummary price={servicePricing(s,data.taxRate)}/> : '—'}</td>}
      <td><Badge>{label(s.status)}</Badge></td><td className="live-actions-col"><ProductActions service={s}/></td>
    </tr>)}</tbody>
  </table></div></Panel>;
}

function DeliveryTable({services}) {
  const { data,open } = usePortal();
  const projects = new Map(data.projects.map(project => [project.service_id,project]));
  return <Panel><div className="table-wrap"><table className="table live-data-table">
    <thead><tr><th scope="col">Title</th><th scope="col">Plan</th><th scope="col">Technology</th><th scope="col">Duration</th>
      <th scope="col">Maintenance</th><th scope="col">Status</th><th scope="col" className="live-actions-col">Actions</th></tr></thead>
    <tbody>{services.map(s => {
      const project = projects.get(s.id);
      const start = project?.start_date || s.term_start;
      const end = project?.completed_on || project?.target_date || s.term_end;
      return <tr key={s.id}>
        <td><ServiceName service={s}/></td><td>{s.plan || requestCategories[s.category] || s.catalog_name}</td>
        <td>{project?.technology || '—'}</td><td>{duration(s,project)}{(start || end) && <small className="live-cell-note">{date(start)} – {date(end)}</small>}</td>
        <td>{project?.maintenance_included ? 'Yes' : 'No'}</td><td><Badge>{label(project?.status || s.status)}</Badge></td>
        <td className="live-actions-col"><button type="button" className="icon-button" aria-label={'View '+s.title} onClick={() => open('service',s.id)}><Icon name="right"/></button></td>
      </tr>;
    })}</tbody>
  </table></div></Panel>;
}

const renewalWindows = [
  { id:'past',label:'Past Due',matches:days => days<0 },
  { id:'30',label:'30 Days',matches:days => days>=0 && days<=30 },
  { id:'90',label:'90 Days',matches:days => days>=0 && days<=90 },
];
function Renewals() {
  const { data, open, permits } = usePortal();
  const [windowId,setWindowId] = useState('30');
  const subscriptions = data.services.filter(renewable).sort((a,b) => a.term_end.localeCompare(b.term_end));
  const windows = renewalWindows.map(option => ({ ...option,
    records:subscriptions.filter(s => option.matches(daysTo(data.asOf,s.term_end))),
  }));
  const list = windows.find(option => option.id===windowId).records;
  const canBill = permits('billing.view');
  return <><Heading eyebrow="KEEP YOUR SERVICES RUNNING" title="Annual renewals" description="Review past-due subscriptions and renewals coming up in the next 30 or 90 days."/>
    <div className="live-renewal-tabs"><Tabs items={windows.map(({ id,label,records }) => ({id,label,count:records.length}))}
      label="Renewal period" value={windowId} onChange={setWindowId}/></div>
    <Panel>{list.length ? <div className="table-wrap"><table className="table live-data-table"><thead><tr>
      <th scope="col">Subscription</th><th scope="col">Current expiry</th><th scope="col">Expires in</th>
      {canBill && <th scope="col">Annual price</th>}<th scope="col">Next step</th></tr></thead><tbody>
      {list.map(s => {
        const invoice=invoiceForService(data,s), request=openRenewal(data,s.id);
        return <tr key={s.id}><td><ServiceName service={s}/></td>
          <td>{date(s.term_end)}</td><td><Expiry asOf={data.asOf} ends={s.term_end}/></td>
          {canBill && <td><PriceSummary price={servicePricing(s,data.taxRate)}/></td>}
          <td>{invoice || request || permits('orders.create') ? <Btn small onClick={() => open('renewal',s.id)}>
            {invoice?'Review payment':request?'View renewal request':'Renew'}</Btn> : 'Contact Safcodes'}</td></tr>;
      })}
    </tbody></table></div> : <Empty icon="refresh" title={windowId==='past'?'No past-due renewals':'No renewals in this period'}
      description="Use the tabs to check another renewal period."/>}</Panel></>;
}

function Contracts() {
  const { data, account, open, permits } = usePortal();
  const [view,setView] = useState('table');
  const canBill = permits('billing.view');
  const contracts = [...data.contracts].sort((a,b) => (a.payment_due_on || '9999').localeCompare(b.payment_due_on || '9999'));
  const canReviewPayment = contract => canBill && data.invoices.some(i => Number(i.balance)>0 && i.lines.some(l => l.contract_id===contract.id));
  return <><Heading eyebrow="ONGOING AGREEMENTS" title="AMC / SLA" description="Review contract values, billing cycles and upcoming instalments."/>
    <div className="live-contract-toolbar"><span>{countLabel(contracts.length,'agreement')}</span>
      <LayoutToggle label="Agreement layout" value={view} onChange={setView}/></div>
    {!contracts.length ? <Panel><Empty title="No agreements yet" description="Your AMC and SLA records will appear here once Safcodes adds them."/></Panel>
      : view==='grid' ? <div className="live-contract-grid">{contracts.map(c => <article key={c.id} className="panel live-contract-card">
        <div className="live-contract-top"><span className="service-icon"><Icon name="shield"/></span><Badge>{label(c.status)}</Badge></div>
        <div className="live-contract-ref">{c.contract_no} · {account.display_name}</div>
        <h2>{c.title}</h2><p>{c.plan || label(c.contract_type)}</p>
        {c.billing && <><dl className="live-contract-values">
          <div><dt>Annual value</dt><dd><PriceSummary price={priceBreakdown(c.annual_value,{inclusive:c.tax_inclusive,taxRate:data.taxRate,netUnit:c.billing.annualNet})}/></dd></div>
          <div><dt>Every {countLabel(c.billing_cycle_months,'month')}</dt><dd><PriceSummary price={priceBreakdown(c.billing.nextAmount,{inclusive:c.tax_inclusive,taxRate:data.taxRate,netUnit:c.billing.nextNet})}/></dd></div>
        </dl>
        <div className="live-contract-dates"><span>Last paid {date(c.last_payment_received_at)}</span><span>Due {date(c.payment_due_on)}</span></div></>}
        <div className="live-contract-footer">
          <div><ContractOverdue contract={c}/></div>
          <div className="live-card-actions">{canReviewPayment(c) && <Btn small onClick={() => open('contract-payment',c.id)}>Review payment</Btn>}
            <Btn small end="right" onClick={() => open('contract',c.id)}>View</Btn></div>
        </div>
      </article>)}</div>
      : <Panel><div className="table-wrap"><table className="table live-data-table"><thead><tr>
        <th scope="col">Agreement</th><th scope="col">Cycle</th><th scope="col">Status</th>
        {canBill && <><th scope="col">Next due</th><th scope="col">Invoiced balance</th><th scope="col">Past due</th></>}
        <th scope="col" className="live-actions-col">Actions</th>
      </tr></thead><tbody>{contracts.map(c => <tr key={c.id}>
        <td><div className="service-cell"><span className="service-icon blue"><Icon name="shield"/></span>
          <button type="button" className="text-button service-text" onClick={() => open('contract',c.id)}>
            <strong>{c.title}</strong><small>{c.contract_no} · {c.plan || label(c.contract_type)}</small>
          </button></div></td>
        <td>{countLabel(c.billing_cycle_months,'month')}</td><td><Badge>{label(c.status)}</Badge></td>
        {canBill && <><td>{date(c.payment_due_on)}
          <PriceSummary price={priceBreakdown(c.billing?.nextAmount,{inclusive:c.tax_inclusive,taxRate:data.taxRate,netUnit:c.billing?.nextNet})} empty="—"/></td>
          <td>{aed(c.outstanding_amount)}</td><td><ContractOverdue contract={c}/></td></>}
        <td className="live-actions-col"><ActionMenu label={'Actions for ' + c.title} items={[
          ['View',() => open('contract',c.id),'eye'],
          ...(canReviewPayment(c) ? [['Review payment',() => open('contract-payment',c.id),'wallet']] : []),
        ]}/></td>
      </tr>)}</tbody></table></div></Panel>}
  </>;
}

function ContractOverdue({contract}) {
  const billing = contract.billing;
  if (!billing?.overdueMonths) return null;
  return <><span className="badge live-past-due">{countLabel(billing.overdueMonths,'month')} past due
    {Number(billing.overdueBalance)>0 && ' · '+aed(billing.overdueBalance)}</span>
    {Number(billing.unissuedOverdue)>0 && <small className="live-cell-note">{exVat(billing.unissuedOverdue)} awaiting invoice</small>}</>;
}

function InvoiceTable({invoices,compact=false}) {
  const { open } = usePortal();
  if (!invoices.length) return <Empty title="No matching invoices" description="Issued invoices will appear here." />;
  return <div className="table-wrap"><table className="table"><thead><tr><th>Invoice</th><th>Due</th><th>Balance</th><th>Status</th><th>{compact?'Action':'Payment link'}</th></tr></thead>
    <tbody>{invoices.map(i => <tr key={i.id}><td><button className="text-button service-text" onClick={() => open('invoice',i.id)}>
      <strong>{i.invoice_no}</strong><small>{i.lines[0]?.description || label(i.segment)}</small></button></td><td>{date(i.due_on)}</td>
      <td className="nowrap">{aed(i.balance)}</td><td><Badge>{label(i.payment_status)}</Badge></td>
      <td>{compact ? <Btn small onClick={() => open('invoice',i.id)}>Review</Btn> : i.payment_link ? 'Ready' : i.payment_link_requested ? 'Requested' : Number(i.balance)>0 ? 'Pending' : '—'}</td></tr>)}</tbody>
  </table></div>;
}
function Invoices() {
  const { data } = usePortal();
  const [segment,setSegment] = useState('All');
  const [filter,setFilter] = useState('Outstanding');
  const [query,setQuery] = useState('');
  const list = data.invoices.filter(i => (segment==='All' || label(i.segment)===segment) &&
    (filter==='All' || (filter==='Outstanding' ? Number(i.balance)>0 : Number(i.balance)<=0)) &&
    includes(query,i.invoice_no,...i.lines.map(l => l.description)));
  return <><Heading eyebrow="YOUR BILLING WORKSPACE" title="Invoices & payments" description="Review issued invoices, verified payments and available payment links."/>
    <Tabs items={['All','Product','Service','Mixed']} value={segment} onChange={setSegment}/>
    <div className="filterbar"><Tabs items={['Outstanding','Settled','All']} value={filter} onChange={setFilter}/>
      <Search query={query} setQuery={setQuery} placeholder="Search invoices"/></div><Panel><InvoiceTable invoices={list}/></Panel></>;
}

function PaymentMethods() {
  const { account,data,permits } = usePortal();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function manageCards() {
    setBusy(true); setError('');
    try {
      const { url } = await api(accountPath(account.id,'payment-portal'),{});
      window.location.assign(url);
    } catch (problem) { setError(problem.message); setBusy(false); }
  }
  return <><Heading eyebrow="YOUR BILLING WORKSPACE" title="Payment methods" description="Manage the cards associated with your company’s billing account."/>
    <Panel title="Saved cards" subtitle={data.paymentMethodsEnabled ? 'Stripe sandbox' : undefined}>
      <div className="live-panel-body">
        {data.paymentMethodsEnabled ? <><p>Add, replace, or remove test cards on Stripe’s hosted payment methods page.</p>
          {error && <p role="alert" className="live-error">{error}</p>}
          <Btn primary icon="card" end="right" disabled={busy} onClick={manageCards}>{busy?'Opening card management…':'Manage cards'}</Btn></>
          : <Info icon="card">{permits('account.manage') ? 'Saved cards are available after Safcodes enables the payment provider for this account.' : 'The company account owner manages saved cards.'}</Info>}
      </div>
    </Panel></>;
}

function Orders() {
  const { data,open } = usePortal();
  const [segment,setSegment] = useState('All');
  const [status,setStatus] = useState('All');
  const [query,setQuery] = useState('');
  const list = data.orders.filter(o => (segment==='All' || label(o.segment)===segment) &&
    (status==='All' || o.status===status) && includes(query,o.order_no,o.title,label(o.kind)));
  return <><Heading eyebrow="FROM REQUEST TO APPROVAL" title="Orders & requests" description="Track reviews, quotes, renewals and changes to your services."
    action={() => open('request')} label="Request a product or service"/>
    <Tabs items={['All','Product','Service']} value={segment} onChange={setSegment}/>
    <div className="filterbar"><Search query={query} setQuery={setQuery} placeholder="Search requests"/>
      <Field id="order-status" label="Status"><select id="order-status" value={status} onChange={e => setStatus(e.target.value)}>
        <option>All</option>{[...new Set(data.orders.map(o => o.status))].map(s => <option key={s} value={s}>{label(s)}</option>)}
      </select></Field></div>
    <Panel>{list.length ? <div className="table-wrap"><table className="table live-data-table"><thead><tr>
      <th scope="col">Request</th><th scope="col">Type</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col">Estimate / quote</th>
      <th scope="col" className="live-actions-col">View</th></tr></thead>
      <tbody>{list.map(o => <tr key={o.id}><td><button className="text-button service-text" onClick={() => open('order',o.id)}><strong>{o.title}</strong><small>{o.order_no}</small></button></td>
        <td>{o.amc_request?'AMC contract request':label(o.kind)}</td><td>{date(o.created_at)}</td><td><Badge>{label(o.status)}</Badge></td>
        <td><PriceSummary price={orderPricing(o,data.taxRate)} empty="To be quoted"/></td>
        <td className="live-actions-col"><button type="button" className="icon-button" title="View request"
          aria-label={'View '+o.order_no} onClick={() => open('order',o.id)}><Icon name="right"/></button></td>
      </tr>)}</tbody></table></div>
      : <Empty title="No matching requests" description="Create a request or choose another filter."/>}</Panel></>;
}

function Support() {
  const { data,open } = usePortal();
  const action = useCommand();
  const [filter,setFilter] = useState('All');
  const [query,setQuery] = useState('');
  const list = data.tickets.filter(t => (filter==='All' || (filter==='Closed')===ticketClosed(t)) &&
    includes(query,t.subject,t.ticket_no,label(t.status)));
  return <><Heading eyebrow="CONTACT SAFCODES" title="Support tickets" description="Open a ticket and follow replies from the Safcodes team." action={() => open('ticket-new')} label="New support ticket"/>
    <div className="filterbar live-table-toolbar"><Tabs items={['All','Open','Closed']} value={filter} onChange={setFilter}/>
      <Search query={query} setQuery={setQuery} placeholder="Search ticket or reference"/></div>
    {action.error && <p role="alert" className="live-error">{action.error}</p>}
    <Panel title="Ticket history" subtitle={countLabel(list.length,'ticket')}>
      {list.length ? <div className="table-wrap"><table className="table live-data-table"><thead><tr>
        <th scope="col">Ticket</th><th scope="col">Updated</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col" className="live-actions-col">Actions</th>
      </tr></thead><tbody>{list.map(t => <tr key={t.id}>
        <td><div className="service-cell"><span className="service-icon blue"><Icon name="chat"/></span>
          <button type="button" className="text-button service-text" onClick={() => open('ticket',t.id)}><strong>{t.subject}</strong><small>{t.ticket_no}</small></button>
        </div></td><td>{date(t.updated_at)}</td><td>{label(t.priority)}</td><td><Badge>{label(t.status)}</Badge></td>
        <td className="live-actions-col"><ActionMenu label={'Actions for ' + t.ticket_no} items={[
          ['View ticket',() => open('ticket',t.id),'eye'],
          ...(!action.busy ? [[ticketAction(t),() => action.run('ticket_status',{id:t.id,status:ticketClosed(t)?'open':'closed'}),ticketClosed(t)?'refresh':'check']] : []),
        ]}/></td>
      </tr>)}</tbody></table></div> : <Empty icon="chat" title={data.tickets.length?'No matching tickets':'No support tickets'}
        description={data.tickets.length?'Try another filter or search.':'Your support conversations will appear here.'}/>}
    </Panel></>;
}

function Profile() {
  const { session,account,updateProfile,open } = usePortal();
  const [editing,setEditing] = useState(false);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [reading,setReading] = useState(false);
  const [avatar,setAvatar] = useState(undefined);
  const preview = editing && avatar!==undefined ? avatar : session.user.avatar;
  async function choosePhoto(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    setError(''); setReading(true);
    try {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024) {
        throw new Error('Choose a JPG, PNG, or WebP image up to 5 MB.');
      }
      let image;
      try { image = await createImageBitmap(file); }
      catch { throw new Error('This image could not be opened. Choose another photo.'); }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 192;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,192,192);
        const side = Math.min(image.width,image.height);
        ctx.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,192,192);
        setAvatar(canvas.toDataURL('image/jpeg',0.86));
      } finally { image.close(); }
    } catch (problem) { setError(problem.message); } finally { setReading(false); }
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      await updateProfile(avatar===undefined ? fields : { ...fields,avatar });
      setAvatar(undefined);
      setEditing(false);
    } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  }
  return <><Heading eyebrow="ACCOUNT SETTINGS" title="Your profile" description="Manage your contact details, account access and sign-in security."/>
    <div className="live-profile-grid">
      <Panel title="Personal details" action={!editing && <Btn small icon="user" onClick={() => setEditing(true)}>Edit profile</Btn>}>
        <div className="live-panel-body">
          <div className="live-profile-photo">
            {preview ? <img src={preview} alt="Your profile photo"/> : <span aria-label="No profile photo"><Icon name="user"/></span>}
            <div><strong>Profile photo</strong><p>{editing ? 'JPG, PNG or WebP, up to 5 MB.' : 'Shown in the account menu.'}</p></div>
          </div>
          {editing ? <form onSubmit={save}>
            <div className="live-profile-photo-edit">
              <Field id="profile-image" label="Choose profile photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={busy||reading}/>
              {preview && <Btn small disabled={busy||reading} onClick={() => setAvatar(null)}>Remove photo</Btn>}
            </div>
            <Field id="profile-name" name="display_name" label="Display name" defaultValue={session.user.display_name} required maxLength={120}/>
            {error && <p role="alert" className="live-error">{error}</p>}
            <div className="live-card-actions"><Btn primary type="submit" disabled={busy||reading}>Save profile</Btn>
              <Btn disabled={busy||reading} onClick={() => { setEditing(false); setError(''); setAvatar(undefined); }}>Cancel</Btn></div>
          </form> : <Row label="Display name">{session.user.display_name}</Row>}
          <Row label="Sign-in email">{session.user.email}</Row>
        </div>
      </Panel>
      <Panel title="Company account"><div className="live-panel-body">
        <Row label="Company">{account.display_name}</Row><Row label="Customer number">{account.customer_no}</Row>
        <Row label="Billing email">{account.billing_email}</Row><Row label="Access">{label(account.role_code)}</Row>
      </div></Panel>
      <Panel title="Sign-in security" subtitle="Manage your password and verification methods" className="live-profile-security">
        <div className="live-panel-body live-security-list">
          <div className="live-security-row"><span className="service-icon blue"><Icon name="lock"/></span>
            <div><strong>Password</strong><p>Use a code sent to your sign-in email to reset your password.</p></div>
            <Btn small onClick={() => open('password-reset')}>Reset password</Btn></div>
          <div className="live-security-row"><span className="service-icon blue"><Icon name="mobile"/></span>
            <div><strong>Mobile number</strong><p>{account.phone || 'No mobile number on file'}</p></div>
            <Btn small disabled>Verify mobile number</Btn></div>
          <div className="live-security-row"><span className="service-icon blue"><Icon name="shield"/></span>
            <div><strong>Two-factor authentication</strong><p>Email codes protect sign-in. Additional verification methods are planned.</p></div>
            <Btn small disabled>Set up 2FA</Btn></div>
        </div>
      </Panel>
    </div>
  </>;
}
