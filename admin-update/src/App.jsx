import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Bell, CalendarClock, ChevronDown, ChevronRight, CircleHelp, Command, FlaskConical,
  Headphones, LogOut, Mail, Menu, Plus, Search, ShieldCheck, UserRound, X, CheckCircle2,
} from 'lucide-react';
import { Avatar, Badge, Button, Dialog, Empty } from './components.jsx';
import { Details } from './details.jsx';
import { ActionForm } from './forms.jsx';
import { Login, Profile } from './Auth.jsx';
import { LiveLogin, LiveProfile } from './LiveAuth.jsx';
import { api, command, isLive } from './live-api.js';
import { setWorkspaceDate } from '../shared/seed.mjs';
import { loadAccount, saveSession, signedIn } from './demo-auth.js';
import { navigation, openRequests, Overview, pageNames, ServiceIcon, WorkspacePage } from './pages.jsx';
import { loadWorkspace, storeWorkspace, execute } from './workspace.js';
import { canPerform, dateLabel, daysDue, freshWorkspace, invoiceStatus, titleCase } from '../shared/workflows.mjs';

const roles = [
  { code: 'admin', name: 'Aisha Rahman', label: 'Administrator' },
  { code: 'finance', name: 'Daniel Cole', label: 'Finance' },
  { code: 'support', name: 'Riya Nair', label: 'Support' },
];

function currentRoute() {
  const [page, segment] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { page: Object.hasOwn(pageNames, page) ? page : 'overview', segment: segment || 'all' };
}

function GlobalSearch({ workspace, onClose, open, navigate }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const results = [
    ...Object.entries(pageNames).map(([id, name]) => ({ id, name, type: 'Page', page: true })),
    ...workspace.customers.map(item => ({ id: item.id, name: item.display_name, type: 'Client', collection: 'customers', hint: item.customer_no })),
    ...workspace.services.map(item => ({ id: item.id, name: item.title, type: 'Service', collection: 'services', hint: item.service_no, category: item.category })),
    ...workspace.orders.map(item => ({ id: item.id, name: item.title, type: 'Request', collection: 'orders', hint: item.order_no })),
    ...workspace.invoices.map(item => ({ id: item.id, name: item.invoice_no, type: 'Invoice', collection: 'invoices', hint: item.description })),
    ...workspace.contracts.map(item => ({ id: item.id, name: item.title, type: 'Contract', collection: 'contracts', hint: item.contract_no })),
    ...workspace.tickets.map(item => ({ id: item.id, name: item.subject, type: 'Support', collection: 'tickets', hint: item.ticket_no })),
  ].filter(item => [item.name, item.type, item.hint].join(' ').toLowerCase().includes(needle)).slice(0, needle ? 10 : 6);
  return <Dialog title="Search workspace" eyebrow="QUICK FIND" onClose={onClose}>
    <label className="search-field global-search-input"><Search size={19} /><input autoFocus type="search" aria-label="Search workspace"
      placeholder="Try a client, service or invoice number" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {!results.length ? <Empty /> : <div className="search-results">{results.map(item => <button className="list-item" key={item.id} onClick={() => {
      onClose();
      if (item.page) navigate(item.id);
      else open(item.collection, item.id);
    }}>
      {item.category ? <ServiceIcon category={item.category} /> : <span className="entity-icon"><Search size={17} /></span>}
      <div><strong>{item.name}</strong><small>{item.type}{item.hint && ' · ' + item.hint}</small></div><ChevronRight size={16} />
    </button>)}</div>}
  </Dialog>;
}

export default function App() {
  const [mode, setMode] = useState('');
  useEffect(() => { isLive().then(live => setMode(live ? 'live' : 'demo')); }, []);
  if (!mode) return <main className="page"><p role="status">Connecting to Safcodes Admin…</p></main>;
  return mode === 'live' ? <ConnectedApp /> : <DemoApp />;
}

function ConnectedApp() {
  const [session, setSession] = useState(undefined);
  const [workspace, setWorkspace] = useState(null);
  const [error, setError] = useState('');
  const activation = window.location.hash.match(/^#activate\/([a-f0-9-]+)$/i)?.[1];
  async function load() {
    setError('');
    try {
      const current = await api('session');
      const data = await api('workspace');
      setWorkspaceDate(data.asOf);
      setWorkspace(data);
      setSession(current);
    } catch (reason) {
      if (reason.status === 401) setSession(null);
      else setError(reason.message);
    }
  }
  useEffect(() => { if (!activation) load(); }, [activation]);
  if (activation) return <LiveLogin activationId={activation} />;
  if (error) return <main className="page"><h1>Could not load the workspace</h1><p role="alert">{error}</p><Button onClick={load}>Retry</Button></main>;
  if (session === undefined) return <main className="page"><p role="status">Checking your admin session…</p></main>;
  if (!session) return <LiveLogin onLogin={load} />;
  return <Admin account={session.account} live={session} initialWorkspace={workspace}
    onAccountChange={account => setSession(current => ({ ...current, account }))}
    onSessionExpired={() => setSession(null)}
    onSignOut={async () => { await api('auth/logout', {}); setSession(null); }} />;
}

function DemoApp() {
  const [account, setAccount] = useState(loadAccount);
  const [active, setActive] = useState(signedIn);
  function session(value) {
    saveSession(value);
    setActive(value);
  }
  if (!active) return <Login account={account} onLogin={() => session(true)} onAccountChange={setAccount} />;
  return <Admin account={account} onAccountChange={setAccount} onSignOut={() => session(false)} />;
}

function Admin({ account, onAccountChange, onSignOut, live, initialWorkspace, onSessionExpired }) {
  const [workspace, setWorkspace] = useState(() => initialWorkspace || loadWorkspace());
  const [route, setRoute] = useState(currentRoute);
  const [selection, setSelection] = useState(null);
  const [form, setForm] = useState(null);
  const [overlay, setOverlay] = useState('');
  const [menu, setMenu] = useState('');
  const [mobile, setMobile] = useState(false);
  const [role, setRole] = useState('admin');
  const [toast, setToast] = useState('');
  const [delivery, setDelivery] = useState(null);
  const actor = live ? { name: account.name, label: titleCase(account.roles[0]) }
    : role === 'admin' ? { ...roles[0], name: account.name } : roles.find(item => item.code === role);
  const clients = useMemo(() => new Map(workspace.customers.map(client => [client.id, client.display_name])), [workspace.customers]);
  const clientName = id => clients.get(id) || '—';
  const allowed = action => live ? live.actions.includes(action) : canPerform(role, action);
  const overdue = workspace.invoices.filter(invoice => invoiceStatus(invoice) === 'overdue');
  const openTickets = workspace.tickets.filter(ticket => !['resolved','closed'].includes(ticket.status)).length;
  const requests = openRequests(workspace.orders).length;
  const dueSoon = workspace.services.filter(service => service.billing_mode === 'annual' && service.status !== 'cancelled' && daysDue(service.term_end) >= 0 && daysDue(service.term_end) <= 7);
  const notifications = overdue.length + dueSoon.length + workspace.notifications.length;

  useEffect(() => {
    const sync = () => { setRoute(currentRoute()); setSelection(null); };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    const listen = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !form && !selection) {
        event.preventDefault();
        setOverlay('search');
        setMenu('');
      }
      if (event.key === 'Escape') { setMenu(''); setMobile(false); }
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, [form, selection]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  function navigate(page, segment = 'all') {
    setRoute({ page, segment });
    const hash = page + (segment === 'all' ? '' : '/' + segment);
    if (window.location.hash !== '#' + hash) window.history.pushState(null, '', '#' + hash);
    setSelection(null);
    setOverlay('');
    setMobile(false);
    setMenu('');
    window.scrollTo({ top: 0 });
  }
  function open(collection, id) {
    setMenu('');
    setOverlay('');
    setSelection({ collection, id });
  }
  function action(action, title, record = {}, summary) {
    setMenu('');
    setForm({ action, title, record, summary });
  }
  async function submit(name, values, requestId) {
    let result;
    let saved = true;
    if (live) {
      try { result = await command(name, values, requestId); }
      catch (reason) { if (reason.status === 401) onSessionExpired(); throw reason; }
      try {
        const next = await api('workspace');
        setWorkspaceDate(next.asOf);
        setWorkspace(next);
      } catch (reason) {
        if (reason.status === 401) onSessionExpired();
        setForm(null);
        setToast(result.message + ' Reload to see the updated record.');
        return;
      }
    } else {
      result = execute(workspace, name, values, { role, name: actor.name });
      setWorkspace(result.workspace);
      saved = storeWorkspace(result.workspace);
    }
    setToast(result.message + (saved ? '' : ' · changes are in memory for this session'));
    setForm(null);
    if (['invoiceOrder', 'renew', 'contractInvoice'].includes(name)) open('invoices', result.record.id);
    const collections = { customer: 'customers', service: 'services', marketing: 'services', request: 'orders',
      contract: 'contracts', project: 'projects', staff: 'staff', ticket: 'tickets', plan: 'plans', catalogEntry: 'catalog_entries', provider: 'providers' };
    if (collections[name] && result.record) open(collections[name], result.record.id);
    if (result.demoDelivery) setDelivery(result.demoDelivery);
  }
  function reset() {
    const clean = freshWorkspace();
    setWorkspace(clean);
    const saved = storeWorkspace(clean);
    setOverlay('');
    setToast(saved ? 'Sample workspace restored' : 'Sample workspace restored for this session');
  }
  const shared = { workspace, navigate, open, action, clientName, allowed, role, live };
  const counts = { requests, support: openTickets };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to main content</a>
    {mobile && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobile(false)} />}
    <aside id="navigation" className={'sidebar ' + (mobile ? 'mobile-open' : '')} aria-label="Workspace navigation">
      <button className="brand" onClick={() => navigate('overview')}>
        <img src="/brand/safcodes-logo-standard.png" alt="Safcodes" /><span>ADMIN CONSOLE</span>
      </button>
      <button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobile(false)}><X size={21} /></button>
      <div className="workspace-select"><span className="workspace-avatar">S</span><div><strong>Safcodes Workspace</strong><small>Operations console</small></div></div>
      <nav>{navigation.map(group => <div className="nav-group" key={group.label}>
        <p>{group.label}</p>
        {group.pages.map(([page, label, Icon]) => <a key={page} href={'#' + page}
          className={route.page === page ? 'active' : ''} aria-current={route.page === page ? 'page' : undefined}
          onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(page); }}>
          <Icon size={19} /><span>{label}</span>{counts[page] > 0 && <small>{counts[page]}</small>}</a>)}
      </div>)}</nav>
      <div className="sidebar-foot"><FlaskConical size={17} /><div><strong>{live ? 'PostgreSQL workspace' : 'Demo workspace'}</strong><small>{live ? 'Connected through the Node API' : 'Sample data · browser storage'}</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <button className="icon-button menu-toggle" aria-label="Open navigation" aria-expanded={mobile} aria-controls="navigation" onClick={() => setMobile(true)}><Menu size={22} /></button>
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={15} /><strong>{pageNames[route.page]}</strong></div>
        <div className="header-actions">
          <button className="top-search" aria-label="Search workspace" onClick={() => { setOverlay('search'); setMenu(''); }}><Search size={18} /><span>Search anything…</span><kbd><Command size={12} /> K</kbd></button>
          <div className="menu-anchor">
            <button className="icon-button quick-button" aria-label="Quick create" aria-expanded={menu === 'create'} onClick={() => setMenu(menu === 'create' ? '' : 'create')}><Plus size={21} /></button>
            {menu === 'create' && <div className="popover"><span className="popover-title">Quick create</span>
              {[['customer', 'Add client'], ['request', 'New request'], ['contract', 'Add contract'], ['ticket', 'Create ticket']].filter(([actionName]) => allowed(actionName))
                .map(([actionName, label]) => <button key={actionName} onClick={() => action(actionName, label)}><Plus size={16} />{label}</button>)}
              {!['customer', 'request', 'contract', 'ticket'].some(allowed) && <p>No creation actions for this role.</p>}</div>}
          </div>
          <button className="icon-button notification-button" aria-label={`Notifications (${notifications})`} onClick={() => { setOverlay('notifications'); setMenu(''); }}>
            <Bell size={21} />{notifications > 0 && <i />}</button>
          <span className="header-divider" />
          <div className="menu-anchor">
            <button className="profile" aria-label={live ? "Account menu" : "Role preview"} aria-expanded={menu === 'profile'} onClick={() => setMenu(menu === 'profile' ? '' : 'profile')}>
              <Avatar name={actor.name} /><span><strong>{actor.name}</strong><small>{actor.label}</small></span><ChevronDown size={15} /></button>
            {menu === 'profile' && <div className="popover">{!live && <>
              <span className="popover-title">Preview a role</span>
              {roles.map(item => <button key={item.code} className={role === item.code ? 'selected' : ''} onClick={() => { setRole(item.code); setMenu(''); setToast(item.label + ' preview enabled'); }}>
                <ShieldCheck size={17} />{item.label}</button>)}</>}
              <span className="popover-title">Account</span>
              <button onClick={() => navigate('profile')}><UserRound size={17} />My profile</button>
              <button onClick={async () => { try { await onSignOut(); } catch (reason) { setToast(reason.message); } }}><LogOut size={17} />Sign out</button></div>}
          </div>
        </div>
      </header>
      {menu && <button className="popover-scrim" tabIndex={-1} aria-label="Dismiss menu" onClick={() => setMenu('')} />}
      <main id="main-content" tabIndex={-1}>
        {route.page === 'profile' ? (live ? <LiveProfile account={account} onAccountChange={onAccountChange} /> : <Profile account={account} onAccountChange={onAccountChange} />)
          : route.page === 'overview' ? <Overview {...shared} /> : <WorkspacePage {...shared} page={route.page} segment={route.segment}
            setSegment={segment => navigate(route.page, segment)} reset={() => setOverlay('reset')} />}
      </main>
      <footer className="page-footer"><span>Safcodes Admin Console</span><span>{live ? 'PostgreSQL workspace' : 'Sample data workspace'}</span></footer>
    </div>
    {selection && <Details key={selection.collection + selection.id} selection={selection} {...shared} onClose={() => setSelection(null)} />}
    {form && <ActionForm form={form} workspace={workspace} live={live} onClose={() => setForm(null)} onSubmit={submit} />}
    {delivery && <Dialog title="Client access approved" eyebrow="DEMO EMAIL PREVIEW" onClose={() => setDelivery(null)}>
      <div className="notice blue-notice"><strong><Mail size={17} /> Portal access email</strong>
        <span>To {delivery.email}</span><span>Temporary password</span><code className="access-code">{delivery.password}</code></div>
      <p className="detail-copy">This password is shown once in the demo. Email delivery and sign-in on the separate client portal require the backend.</p>
      <div className="dialog-actions"><Button tone="primary" onClick={() => setDelivery(null)}>Done</Button></div>
    </Dialog>}
    {overlay === 'search' && <GlobalSearch workspace={workspace} onClose={() => setOverlay('')} open={open} navigate={navigate} />}
    {overlay === 'notifications' && <Dialog title="Notifications" eyebrow="WORKSPACE INBOX" drawer onClose={() => setOverlay('')}>
      {notifications === 0 ? <Empty title="You're caught up" description="There are no pending items." /> :
        <div className="stacked-list">{dueSoon.map(service => <button className="list-item" key={service.id} onClick={() => open('services', service.id)}>
          <span className="entity-icon"><CalendarClock size={18} /></span><div><strong>{service.title}</strong><small>Renewal due {dateLabel(service.term_end)}</small></div><ChevronRight size={17} /></button>)}
        {overdue.map(invoice => <button className="list-item" key={invoice.id} onClick={() => open('invoices', invoice.id)}>
          <span className="entity-icon"><Bell size={18} /></span><div><strong>{invoice.invoice_no}</strong><small>{clientName(invoice.customer_id)} · Overdue invoice</small></div><ChevronRight size={17} /></button>)}
        {workspace.notifications.map(item => <button className="list-item" key={item.id} onClick={() => open('invoices', item.invoice_id)}>
          <span className="entity-icon"><Bell size={18} /></span><div><strong>{item.title}</strong><small>{dateLabel(item.created_at)}</small></div><Badge value="queued" /></button>)}</div>}
    </Dialog>}
    {overlay === 'reset' && <Dialog title="Reset sample data?" eyebrow="DEMO WORKSPACE" onClose={() => setOverlay('')}>
      <p className="detail-copy">This removes the changes made in this browser and restores the original sample records.</p>
      <div className="dialog-actions"><Button onClick={() => setOverlay('')}>Cancel</Button><Button tone="primary" onClick={reset}>Reset sample data</Button></div>
    </Dialog>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16} /></button></div>}
  </div>;
}
