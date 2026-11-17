import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createApp, settings } from '../lib/http.mjs';
import { passwordHash } from '../lib/auth.mjs';

const sql = path => readFile(new URL(path, import.meta.url),'utf8');
const staff = { email:'admin@safcodes.example', password:'Example-admin-test-2026!' };
const password = 'Example-customer-password!';
const otherPassword = 'Example-new-password-2026!';
const front = 'http://127.0.0.1:3000';
const codeOf = message => message.text.match(/\b\d{6}\b/)[0];
const noCodes = message => assert.equal(/temporary password:/i.test(message.text), false);

function poolFor(pg) {
  let pending = Promise.resolve();
  return {
    async connect() {
      let release;
      const next = new Promise(resolve => { release=resolve; });
      const previous=pending; pending=next; await previous;
      return { release, async query(statement,values) {
        if (statement.startsWith('SET LOCAL search_path=')) return (await pg.exec(statement)).at(-1);
        const result=await pg.query(statement,values);
        for (const {name,dataTypeID} of result.fields) {
          if (dataTypeID===1082) for (const row of result.rows) if (row[name] instanceof Date) row[name]=row[name].toISOString().slice(0,10);
        }
        return result;
      } };
    },
  };
}

test('customer portal works against the migrated PostgreSQL schema and worker role', async t => {
  const pg = new PGlite();
  const mail = [];
  let server;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await pg.close(); });
  for (const file of ['01_schema.sql','02_catalog.sql','03_demo.sql']) await pg.exec(await sql('./fixtures/'+file));
  await pg.exec((await sql('./fixtures/04_roles.sql')).split('\n').filter(line=>!line.startsWith('\\')).join('\n')
    .replaceAll(":'app_password'","'runtime-test'").replaceAll(":'worker_password'","'worker-test'"));
  for (const file of ['06_admin_v2.sql','07_admin_v2_grants.sql','09_admin_api.sql','10_customer_portal.sql',
    '11_customer_preferences.sql','11_customer_preferences.sql']) await pg.exec(await sql('../../database/'+file));
  await pg.query("UPDATE safcodes.users SET password_hash=$1,password_algorithm='bcrypt',email_otp_required=false WHERE email=$2",
    [await passwordHash(staff.password),staff.email]);
  await pg.exec("UPDATE safcodes.customers SET portal_email='alex@cedarcoast.example',stripe_test_customer_id='cus_TestCedar' WHERE customer_no='CUS-DEMO-001'");
  await pg.exec(`UPDATE safcodes.catalog_prices SET tax_inclusive=false WHERE plan_id IN
    (SELECT id FROM safcodes.catalog_plans WHERE code IN ('shared-grow','domain.ae'));
    UPDATE safcodes.projects SET completed_at='2026-04-01T12:00:00+04:00',phase='Handover' WHERE status='completed';
    INSERT INTO safcodes.project_members(customer_id,project_id,user_id,role)
    SELECT p.customer_id,p.id,u.id,'lead' FROM safcodes.projects p CROSS JOIN safcodes.users u WHERE u.email='admin@safcodes.example';`);
  await pg.exec('SET ROLE safcodes_jobs');
  const config = settings({ CUSTOMER_ORIGIN:front, AUTH_SECRET:'local-customer-test-secret-abcd-123456789',
    TAX_RATE:'0.05', PAYMENT_LINK_HOSTS:'pay.example.test', STRIPE_TEST_SECRET_KEY:'sk_test_Fixture', STRIPE_TEST_PORTAL_CONFIGURATION:'bpc_Fixture' });
  let providerCalls = 0;
  let providerUrl = 'https://billing.stripe.com/p/session/test_fixture';
  const paymentFetch = async (url, request) => {
    providerCalls++;
    assert.equal(url,'https://api.stripe.com/v1/billing_portal/sessions');
    assert.equal(request.body.get('customer'),'cus_TestCedar');
    assert.equal(request.body.get('configuration'),'bpc_Fixture');
    assert.equal(request.body.get('return_url'),front+'/#/payment-methods');
    return Response.json({ customer:'cus_TestCedar',livemode:false,url:providerUrl });
  };
  server = createApp({ pool:poolFor(pg), config, mailer:{ mode:'preview', send:async message=>mail.push(message) },
    paymentFetch,
    logger:{ error:(message,details)=>t.diagnostic(message+' '+JSON.stringify(details)) } }).listen(0,'127.0.0.1');
  await once(server,'listening');
  config.host='127.0.0.1:'+server.address().port;
  config.origin='http://'+config.host;

  async function call(realm,path,body,session,key,originOverride) {
    const origin = originOverride || (realm==='client' ? front : config.origin);
    const response = await fetch(config.origin+(realm==='client'?'/api/client/v1/':'/api/v1/')+path,{
      method:body===undefined?'GET':'POST',
      headers:{ ...(body===undefined?{}:{ 'Content-Type':'application/json','X-Safcodes-API':'1',Origin:origin }),
        ...(key?{'Idempotency-Key':key}:{}), ...(session?{Cookie:session}:{}) },
      body:body===undefined?undefined:JSON.stringify(body),
    });
    return { status:response.status, data:await response.json(), cookie:response.headers.get('set-cookie') };
  }
  const good = result => { assert.equal(result.status,200,JSON.stringify(result.data)); return result.data; };
  const token = result => { good(result); return result.cookie.split(';')[0]; };
  const admin = token(await call('admin','auth/login',staff));
  const adminAction = (action,data) => call('admin','commands',{action,data},admin,randomUUID()).then(good);
  const adminWorkspace = () => call('admin','workspace',undefined,admin).then(good);
  const snapshot = await adminWorkspace();
  const cedar = snapshot.customers.find(c => c.customer_no==='CUS-DEMO-001');
  const harbor = snapshot.customers.find(c => c.customer_no==='CUS-DEMO-002');
  const email = 'new.customer@example.test';
  const client = (path,data,session,key,origin) => call('client',path,data,session,key,origin);
  const created = (await adminAction('customer',{ contact_name:'Aisha Test',company_name:'Portal Test',portal_email:email,
    billing_email:email,status:'active' })).record.id;
  const command = (session,id,action,data,key=randomUUID()) => client('accounts/'+id+'/commands',{action,data},session,key);
  const workspace = (session,id=created) => client('accounts/'+id+'/workspace',undefined,session).then(good);
  async function signIn(address, value=password) {
    const login = good(await client('auth/login',{email:address,password:value}));
    assert.equal(login.next,'verify');
    return token(await client('auth/verify',{challengeId:login.challengeId,code:codeOf(mail.at(-1))}));
  }
  async function approveInvite(id, pass=password) {
    await adminAction('clientAccess',{id});
    const invite = mail.at(-1);
    assert.match(invite.text,/24 hours/);
    assert.ok(invite.text.includes(front+'/#activate/'));
    noCodes(invite);
    const challengeId = invite.text.match(/#activate\/([a-f0-9-]+)/)[1];
    good(await client('auth/activate',{challengeId,code:codeOf(invite),password:pass,confirmation:pass}));
    return invite;
  }

  assert.equal((await client('session',undefined,admin)).status,401);
  assert.equal((await client('auth/login',{email,password})).status,401);
  assert.equal((await client('auth/login',{email,password},null,null,'http://evil.example')).status,403);
  await approveInvite(created);
  const login = good(await client('auth/login',{email,password}));
  const otp = codeOf(mail.at(-1));
  assert.equal((await client('session')).status,401);
  assert.equal((await client('auth/verify',{challengeId:login.challengeId,code:otp==='100000'?'100001':'100000'})).status,401);
  const verified=await client('auth/verify',{challengeId:login.challengeId,code:otp});
  const session=token(verified);
  assert.match(verified.cookie,/HttpOnly; SameSite=Strict/);
  assert.equal((await client('auth/verify',{challengeId:login.challengeId,code:otp})).status,401);
  assert.equal((await call('admin','session',undefined,session)).status,401);
  assert.equal(good(await client('session',undefined,session)).accounts[0].id,created);
  assert.equal((await client('accounts/'+harbor.id+'/workspace',undefined,session)).status,404);
  assert.equal((await workspace(session)).services.length,0);
  await approveInvite(cedar.id);
  const cedarSession = await signIn('alex@cedarcoast.example');
  const seeded = await workspace(cedarSession,cedar.id);
  assert.ok(seeded.contracts.length);
  assert.ok(seeded.projects.length);
  assert.ok(seeded.invoices.length);
  assert.ok(seeded.contracts[0].billing);
  assert.equal(Number(seeded.taxRate),0.05);
  const project = seeded.projects.find(p => p.status==='completed');
  assert.equal(project.project_lead,'Safcodes Demo Admin');
  assert.equal(project.completed_on,'2026-04-01');
  assert.equal(project.phase,'Handover');
  const amc = {kind:'new_service',amc_request:true,existing_service_id:project.service_id,brief:'Maintenance and backups.'};
  assert.equal((await command(session,created,'request',amc)).status,404);
  const amcRequest = good(await command(cedarSession,cedar.id,'request',amc));
  const recordedAmc = (await adminWorkspace()).orders.find(order => order.id===amcRequest.id);
  assert.equal(recordedAmc.amc_request,true);
  assert.equal(recordedAmc.existing_service_id,project.service_id);
  assert.equal(recordedAmc.segment,'service');
  assert.equal(seeded.paymentMethodsEnabled,true);
  assert.equal((await workspace(session)).paymentMethodsEnabled,false);
  const cards = (id, cookie) => client('accounts/'+id+'/payment-portal',{},cookie);
  assert.equal((await cards(cedar.id,session)).status,404);
  assert.equal((await cards(created,session)).status,409);
  assert.equal(providerCalls,0);
  assert.equal(good(await cards(cedar.id,cedarSession)).url,providerUrl);
  providerUrl = 'https://example.test/p/session/test_fixture';
  assert.equal((await cards(cedar.id,cedarSession)).status,502);
  assert.equal(providerCalls,2);
  t.diagnostic('Admin approval, customer activation and email OTP, separate cookie realms and customer isolation passed');

  const cat = seeded.catalog.find(item=>item.category==='email');
  const emailPlan = seeded.plans.find(plan=>plan.catalog_item_id===cat.id && plan.unit_amount);
  const key = randomUUID();
  const request = {kind:'new_product',catalog_item_id:cat.id,requested_plan_id:emailPlan.id,domain_name:'portal-test.example',
    requested_quantity:4,requested_years:2,brief:'Configure four mailboxes.'};
  const createdRequest = good(await command(session,created,'request',request,key));
  assert.deepEqual(good(await command(session,created,'request',request,key)),createdRequest);
  let o=(await workspace(session)).orders.find(order=>order.id===createdRequest.id);
  assert.equal(Number(o.estimate), Number(emailPlan.unit_amount)*8);
  assert.ok(Math.abs(Number(o.estimate_net)*1.05-Number(o.estimate))<0.00001);
  assert.ok(Math.abs(Number(emailPlan.net_unit_amount)*1.05-Number(emailPlan.unit_amount))<0.00001);
  assert.equal(o.requested_domain, request.domain_name);
  assert.equal((await command(cedarSession,cedar.id,'reply',{ id:o.id,collection:'orders',body:'Other account' })).status,404);
  await adminAction('review',{ id:o.id,status:'needs_information',customer_status_note:'Please confirm expected setup.' });
  await adminAction('note',{ id:o.id,collection:'orders',visibility:'internal',body:'Internal only' });
  await adminAction('note',{ id:o.id,collection:'orders',visibility:'customer',body:'Visible update' });
  o=(await workspace(session)).orders.find(order=>order.id===o.id);
  assert.equal(o.status,'needs_information');
  assert.deepEqual(o.messages.map(m=>m.body),['Visible update']);
  good(await command(session,created,'reply',{ id:o.id,collection:'orders',body:'Confirmed' }));
  assert.equal((await workspace(session)).orders.find(order=>order.id===o.id).status,'under_review');
  await adminAction('quote',{ id:o.id,quote_amount:'490',tax_inclusive:false,quote_note:'Quoted scope and payment terms' });
  o=(await workspace(session)).orders.find(order=>order.id===o.id);
  assert.equal(o.status,'quoted');
  assert.equal(Number(o.quote_subtotal),490);
  assert.equal(Number(o.quote_total),514.50);
  assert.equal((await command(session,created,'accept_quote',{id:o.id,quote_id:randomUUID()})).status,409);
  good(await command(session,created,'accept_quote',{ id:o.id,quote_id:o.quote_id }));
  const invoiceId=(await adminAction('invoiceOrder',{ id:o.id,due_on:snapshot.asOf })).record.id;
  assert.equal((await workspace(session)).orders.find(order=>order.id===o.id).status,'awaiting_payment');
  const requestLink=good(await command(session,created,'payment_link',{id:invoiceId}));
  assert.equal(good(await command(session,created,'payment_link',{id:invoiceId})).id,requestLink.id);
  const linkQueue = await adminWorkspace();
  assert.equal(linkQueue.invoices.find(i=>i.id===invoiceId).payment_link_status,'requested');
  assert.equal(linkQueue.notifications.filter(n=>n.invoice_id===invoiceId && n.title.startsWith('Payment link requested')).length,1);
  assert.equal(linkQueue.notifications.find(n=>n.invoice_id===invoiceId).id,requestLink.id);
  assert.equal((await workspace(session)).invoices.find(i=>i.id===invoiceId).payment_link_requested,true);
  const gateway=snapshot.providers.find(p=>p.kind==='payment'&&p.active);
  await adminAction('paymentLink',{ id:invoiceId,url:'https://pay.example.test/checkout/example',gateway_id:gateway.id });
  let invoice=(await workspace(session)).invoices.find(i=>i.id===invoiceId);
  assert.equal(invoice.payment_link,'https://pay.example.test/checkout/example');
  assert.equal(Number(invoice.tax_amount),24.50);
  assert.equal(invoice.payment_link_requested,false);
  assert.equal((await adminWorkspace()).invoices.find(i=>i.id===invoiceId).payment_link_status,'ready');
  await adminAction('payment',{ id:invoiceId,amount:invoice.balance,reference:'customer-portal-test-payment',received_on:snapshot.asOf });
  invoice=(await workspace(session)).invoices.find(i=>i.id===invoiceId);
  assert.equal(invoice.payment_status,'settled');
  assert.equal(invoice.payment_link,null);
  assert.equal(invoice.payments.length,1);
  t.diagnostic('New product, idempotency, status and replies, hidden notes, quote acceptance, invoice, payment request/link and verified settlement passed');

  const host=seeded.services.find(s=>s.category==='shared_hosting');
  const hostPlan=seeded.plans.find(p=>p.catalog_item_id===host.catalog_item_id && p.name==='Grow');
  const estimate={ kind:'hosting_upgrade',existing_service_id:host.id,requested_plan_id:hostPlan.id };
  const result=good(await client('accounts/'+cedar.id+'/estimate',estimate,cedarSession));
  assert.equal(host.tax_inclusive,true);
  assert.equal(hostPlan.tax_inclusive,false);
  assert.equal(Number(result.netPrices.unit),Number(hostPlan.unit_amount));
  assert.equal(result.tax_inclusive,false);
  assert.equal(Number(result.charge.net),Number(result.amount));
  assert.ok(Number(result.charge.vat)>0);
  assert.ok(Number(result.amount)>0);
  assert.ok(Number(result.charge.net)<Number(result.charge.total));
  assert.ok(result.remaining<=result.term);
  assert.equal((await client('accounts/'+created+'/estimate',estimate,session)).status,404);
  const mailbox=seeded.services.find(s=>s.category==='email');
  const scaling={ kind:'email_scale',existing_service_id:mailbox.id,requested_quantity:mailbox.quantity+2 };
  assert.ok(Number(good(await client('accounts/'+cedar.id+'/estimate',scaling,cedarSession)).amount)>0);
  good(await command(cedarSession,cedar.id,'request',{ ...scaling,brief:'Please add two seats.' }));
  const upgrade = good(await command(cedarSession,cedar.id,'request',{ ...estimate,brief:'Please upgrade this plan.' }));
  await adminAction('quote',{id:upgrade.id,quote_note:'Mixed VAT basis hosting upgrade.'});
  const upgradeQuote = (await workspace(cedarSession,cedar.id)).orders.find(order=>order.id===upgrade.id);
  assert.equal(Number(upgradeQuote.quote_total),Number(result.charge.total));
  good(await command(cedarSession,cedar.id,'accept_quote',{ id:upgrade.id,quote_id:upgradeQuote.quote_id }));
  const upgradeInvoice = (await adminAction('invoiceOrder',{id:upgrade.id,due_on:snapshot.asOf})).record.id;
  await adminAction('payment',{ id:upgradeInvoice,amount:result.charge.total,reference:'mixed-tax-upgrade',received_on:snapshot.asOf });
  const upgraded = (await workspace(cedarSession,cedar.id)).services.find(service=>service.id===host.id);
  assert.equal(upgraded.plan_id,hostPlan.id);
  assert.equal(Number(upgraded.recurring_unit_amount),Number(hostPlan.unit_amount));
  assert.equal(upgraded.tax_inclusive,false);
  assert.equal(upgraded.term_end,host.term_end);
  const domainPlan=seeded.plans.find(p=>p.tld==='.ae');
  const registrar=(await adminAction('provider',{ kind:'registrar',name:'Customer Portal QA Registrar',active:true })).record.id;
  const domain=(await adminAction('service',{ customer_id:created,catalog_item_id:domainPlan.catalog_item_id,
    plan_id:domainPlan.id, provider_id:registrar,domain_label:'customer-test',
    term_start:snapshot.asOf,term_years:1,purchased_unit_amount:170,status:'active' })).record.id;
  const renewal={ kind:'renewal',existing_service_id:domain,request_payment_link:true,brief:'One year renewal' };
  const renewalId=good(await command(session,created,'request',{...renewal,request_payment_link:false})).id;
  assert.equal(good(await command(session,created,'request',renewal)).id,renewalId);
  assert.equal((await adminWorkspace()).orders.find(order=>order.id===renewalId).request_payment_link,true);
  assert.equal((await command(session,created,'request',renewal)).status,409);
  const renewalInvoice=(await adminAction('renew',{ id:domain })).record.id;
  const issuedRenewal = (await workspace(session)).invoices.find(i=>i.id===renewalInvoice);
  assert.equal(issuedRenewal.lines[0].order_id,renewalId);
  assert.equal(issuedRenewal.payment_link_requested,true);
  assert.equal(Number(issuedRenewal.net_amount),170);
  assert.equal(Number(issuedRenewal.tax_amount),8.5);
  await adminAction('payment',{ id:renewalInvoice,amount:issuedRenewal.balance,reference:'renewal-portal-test',received_on:snapshot.asOf });
  const renewedWorkspace = await workspace(session);
  assert.equal(renewedWorkspace.orders.find(order=>order.id===renewalId).status,'completed');
  assert.equal(renewedWorkspace.services.find(service=>service.id===domain).term_end,issuedRenewal.lines[0].period_end);

  const ticket=good(await command(session,created,'ticket',{ subject:'Question',priority:'normal',department:'technical',body:'Customer message' }));
  await adminAction('note',{ id:ticket.id,collection:'tickets',visibility:'internal',body:'Private diagnosis' });
  assert.deepEqual((await workspace(session)).tickets.find(x=>x.id===ticket.id).messages.map(m=>m.body),['Customer message']);
  good(await command(session,created,'reply',{ id:ticket.id,collection:'tickets',body:'Another detail' }));
  assert.equal((await command(cedarSession,cedar.id,'ticket_status',{id:ticket.id,status:'closed'})).status,404);
  good(await command(session,created,'ticket_status',{id:ticket.id,status:'closed'}));
  const closedTicket = (await adminWorkspace()).tickets.find(t=>t.id===ticket.id);
  assert.equal(closedTicket.status,'closed');
  assert.ok(closedTicket.closed_at);
  assert.equal((await command(session,created,'reply',{id:ticket.id,collection:'tickets',body:'Closed reply'})).status,409);
  good(await command(session,created,'ticket_status',{id:ticket.id,status:'open'}));
  assert.equal((await workspace(session)).tickets.find(t=>t.id===ticket.id).status,'open');
  assert.equal((await adminWorkspace()).tickets.find(t=>t.id===ticket.id).closed_at,null);
  assert.equal((await client('profile',{display_name:'Aisha Updated',avatar:'data:image/svg+xml;base64,abcd'},session)).status,400);
  good(await client('profile',{display_name:'Aisha Updated'},session));
  assert.equal(good(await client('session',undefined,session)).user.display_name,'Aisha Updated');
  t.diagnostic('Service reads, AMC, proration, renewal reconciliation, support and profile passed');

  const reset = good(await client('auth/reset/request',{email}));
  const resetCode=codeOf(mail.at(-1));
  good(await client('auth/reset/confirm',{ challengeId:reset.challengeId,code:resetCode,password:otherPassword,confirmation:otherPassword }));
  assert.equal((await client('session',undefined,session)).status,401);
  config.customerInviteMode='temporary_password';
  const tempEmail='temporary-customer@example.test';
  const temporaryId=(await adminAction('customer',{contact_name:'Temporary User',billing_email:tempEmail,status:'active'})).record.id;
  await adminAction('clientAccess',{id:temporaryId});
  const temporaryPassword=mail.at(-1).text.match(/Temporary password: ([A-Za-z0-9_-]+)/)[1];
  const temp=good(await client('auth/login',{email:tempEmail,password:temporaryPassword}));
  assert.equal(temp.next,'activate');
  assert.equal((await client('session')).status,401);
  good(await client('auth/activate',{challengeId:temp.challengeId,code:codeOf(mail.at(-1)),password,confirmation:password}));
  assert.equal((await client('auth/login',{email:tempEmail,password:temporaryPassword})).status,401);
  const tempSession=await signIn(tempEmail);
  good(await client('auth/logout',{},tempSession));
  assert.equal((await client('session',undefined,tempSession)).status,401);
  assert.throws(()=>settings({CLIENT_INVITE_MODE:'temporary_password',CUSTOMER_ORIGIN:front,MAIL_MODE:'smtp'}),/limited to local/);
  t.diagnostic('Password reset revokes sessions. Local temporary password requires OTP and is replaced on activation.');
});
