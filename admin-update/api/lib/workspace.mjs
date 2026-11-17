import { rows, today, one, money } from './core.mjs';
import { addMonths, daysBetween } from '../../shared/workflows.mjs';

const limit = ' LIMIT 5001';
async function list(db, sql, values) {
  const result = await rows(db, sql + limit, values);
  if (result.length > 5000) throw new Error('Workspace exceeds the local console limit of 5,000 records per collection.');
  return result;
}
const statusMap = { awaiting_payment: 'invoiced', rejected: 'declined' };

export function period(contract) {
  if (!contract.next_period_start || !contract.next_due_date || contract.next_period_start >= contract.end_date) return null;
  const start = contract.next_period_start;
  const months = contract.billing_cycle_months;
  const elapsed = (Number(start.slice(0, 4)) - Number(contract.start_date.slice(0, 4))) * 12
    + Number(start.slice(5, 7)) - Number(contract.start_date.slice(5, 7));
  const covered = Math.min(months, Math.max(0, 12 - elapsed));
  if (covered < 1) return null;
  const anchor = addMonths(contract.start_date, Math.max(0, elapsed) + covered);
  const end = anchor > start ? (anchor < contract.end_date ? anchor : contract.end_date) : contract.end_date;
  const annual = money(contract.annual_value);
  const gross = annual.mul(elapsed + covered).div(12).toDecimalPlaces(2)
    .minus(annual.mul(elapsed).div(12).toDecimalPlaces(2)).toFixed(2);
  return { start, end, due: contract.next_due_date, months: covered, gross };
}

export async function workspace(db, actor) {
  const asOf = await today(db);
  const customers = await list(db, `SELECT c.id,c.customer_no,c.display_name,c.legal_name,c.billing_email,c.phone,c.industry,c.status,
    c.portal_email,coalesce(c.primary_contact_name,m.display_name) AS contact_name,c.display_name AS company_name,
    a.line1 AS office_location,coalesce(y.name,a.country_code) AS country,coalesce(r.name,a.region_text) AS region,
    coalesce(z.name,a.city_text) AS city,
    jsonb_build_object('status',CASE WHEN m.member_status='active' AND m.credentials_ready THEN 'active' ELSE 'pending' END,
      'approved_at',m.access_approved_at) AS portal_access
    FROM customers c
    LEFT JOIN LATERAL (SELECT u.display_name, cm.status AS member_status,(u.status='active' AND u.password_hash IS NOT NULL AND u.email_verified_at IS NOT NULL AND NOT u.must_change_password) AS credentials_ready,cm.access_approved_at
      FROM customer_members cm JOIN users u ON u.id=cm.user_id
      WHERE cm.customer_id=c.id AND cm.status<>'revoked' AND (c.portal_email IS NULL OR u.email=c.portal_email)
      ORDER BY (cm.status='active' AND u.status='active' AND u.password_hash IS NOT NULL AND u.email_verified_at IS NOT NULL AND NOT u.must_change_password) DESC,cm.is_billing_contact DESC,u.created_at LIMIT 1) m ON true
    LEFT JOIN LATERAL (SELECT * FROM customer_addresses WHERE customer_id=c.id AND kind IN ('office','billing')
      ORDER BY (kind='office') DESC,is_default DESC,id LIMIT 1) a ON true
    LEFT JOIN countries y ON y.code=a.country_code LEFT JOIN regions r ON r.id=a.region_id LEFT JOIN cities z ON z.id=a.city_id
    WHERE c.currency='AED' ORDER BY c.created_at DESC,c.id`);
  const services = await list(db, `SELECT s.id,s.customer_id,s.service_no,s.title,s.catalog_item_id,s.plan_id,s.quantity,s.status,s.health,
    s.billing_mode,s.currency,s.recurring_unit_amount,s.tax_inclusive,s.billing_cycle_months,s.term_start,
    s.term_end,s.next_due_date,s.auto_renew,s.state_version,s.purchased_unit_amount,s.discount_pct,
    s.created_at,s.termination_reason AS status_reason,i.category,p.name AS plan_name,
    coalesce(d.fqdn,h.primary_domain,e.domain_name) AS domain_name,
    coalesce(h.domain_service_id,e.domain_service_id) AS domain_service_id,
    coalesce(d.registrar_id,e.provider_id,b.provider_id,p.provider_id) AS provider_id,
    h.control_panel_url,b.external_reference AS provider_reference,
    s.registration_term_years AS term_years,s.attributes->>'scope' AS scope,
    coalesce((SELECT jsonb_agg(m.activity_id) FROM service_marketing_activities m WHERE m.service_id=s.id),'[]') AS activity_ids
    FROM services s JOIN customers c ON c.id=s.customer_id JOIN catalog_items i ON i.id=s.catalog_item_id
    LEFT JOIN catalog_plans p ON p.id=s.plan_id LEFT JOIN service_domains d ON d.service_id=s.id
    LEFT JOIN service_hosting h ON h.service_id=s.id LEFT JOIN service_email e ON e.service_id=s.id
    LEFT JOIN LATERAL (SELECT provider_id,external_reference FROM provider_subscriptions
       WHERE service_id=s.id ORDER BY (status='active') DESC,setup_on DESC NULLS LAST,id LIMIT 1) b ON true
    WHERE c.currency='AED' AND s.currency='AED' ORDER BY s.created_at DESC,s.id`);
  const projects = await list(db, `SELECT j.*,s.title,i.category AS project_type,
    j.tech_stack_id::text||':'||i.category AS technology_id,t.name AS tech_stack,s.attributes->>'scope' AS scope,
    (SELECT u.display_name FROM project_members m JOIN users u ON u.id=m.user_id
      WHERE m.project_id=j.id AND m.role='lead' ORDER BY u.id LIMIT 1) AS manager
    FROM projects j JOIN services s ON s.id=j.service_id JOIN customers c ON c.id=j.customer_id
    JOIN catalog_items i ON i.id=s.catalog_item_id LEFT JOIN technology_stacks t ON t.id=j.tech_stack_id
    WHERE c.currency='AED' ORDER BY j.target_date NULLS LAST,j.id`);
  const contracts = await list(db, `SELECT a.*,coalesce(a.amc_plan_id,(SELECT id FROM amc_plans WHERE code=a.contract_type)) AS amc_plan_id,coalesce(a.billing_cycle_id,(SELECT id FROM billing_cycles WHERE months=a.billing_cycle_months)) AS cycle_id,
    b.next_period_start,b.id AS schedule_id,b.anchor_date,
    coalesce((SELECT jsonb_agg(s.service_id) FROM contract_services s WHERE s.contract_id=a.id),'[]') AS service_ids
    FROM contract_admin_overview a JOIN customers c ON c.id=a.customer_id
    LEFT JOIN billing_schedules b ON b.contract_id=a.id AND b.active
    WHERE c.currency='AED' AND a.currency='AED' ORDER BY a.start_date DESC,a.id`);
  const orders = (await list(db, `SELECT o.*,coalesce(item.description,o.brief,o.order_no) AS title,
    item.catalog_item_id,item.requested_plan_id,item.existing_service_id,item.requested_quantity,item.requested_years,
    item.options->>'estimate' AS estimate,(item.options->>'estimate_tax_inclusive')::boolean AS estimate_tax_inclusive,
    item.options->>'domain' AS requested_domain,
    item.options->'request_payment_link'='true'::jsonb AS request_payment_link,
    item.options->'amc_request'='true'::jsonb AS amc_request,q.terms AS quote_note,q.issued_at::date AS quote_on,
    (SELECT sum(gross_amount) FROM quote_lines l WHERE l.quote_id=q.id) AS quote_amount,
    (SELECT sum(net_amount) FROM quote_lines l WHERE l.quote_id=q.id) AS quote_subtotal,
    coalesce(i.id,(SELECT l.invoice_id FROM invoice_lines l JOIN invoices h ON h.id=l.invoice_id
      WHERE l.order_id=o.id AND h.status='issued' ORDER BY h.issued_on DESC,h.id LIMIT 1)) AS invoice_id,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'author_name',u.display_name,'body',m.body,
        'visibility',m.visibility,'created_at',m.created_at) ORDER BY m.created_at)
      FROM order_messages m JOIN users u ON u.id=m.author_id WHERE m.order_id=o.id),'[]') AS messages
    FROM orders o JOIN customers c ON c.id=o.customer_id
    LEFT JOIN LATERAL (SELECT * FROM order_items WHERE order_id=o.id ORDER BY id LIMIT 1) item ON true
    LEFT JOIN LATERAL (SELECT * FROM quotes WHERE order_id=o.id AND status IN ('sent','accepted') ORDER BY version DESC LIMIT 1) q ON true
    LEFT JOIN invoices i ON i.quote_id=q.id AND i.status='issued'
    WHERE c.currency='AED' ORDER BY o.created_at DESC,o.id`)).map(order => ({ ...order, status: statusMap[order.status] || order.status }));
  const invoices = await list(db, `SELECT a.*,coalesce(l.description,a.invoice_no) AS description,l.charge_type,l.order_id,l.contract_id,
    CASE WHEN l.charge_type='annual_renewal' THEN l.service_id END AS renewal_service_id,
    l.period_start,l.period_end,
    coalesce(link.url,'') AS payment_link,link.gateway_id,
    CASE WHEN a.balance<=0 THEN 'not_created' WHEN link.id IS NOT NULL THEN 'ready'
      WHEN EXISTS(SELECT 1 FROM payment_requests pr WHERE pr.invoice_id=a.id AND pr.status='queued' AND pr.message='Payment link requested.')
      THEN 'requested' ELSE 'not_created' END AS payment_link_status,
    (SELECT e.changes->>'label' FROM audit_events e WHERE e.entity_type='invoice'
      AND e.entity_id=a.id::text AND e.action='settlement_review' ORDER BY e.id DESC LIMIT 1) AS follow_up
    FROM invoice_balances a JOIN customers c ON c.id=a.customer_id
    LEFT JOIN LATERAL (SELECT * FROM invoice_lines WHERE invoice_id=a.id ORDER BY line_no LIMIT 1) l ON true
    LEFT JOIN LATERAL (SELECT id,url,gateway_id FROM payment_links WHERE invoice_id=a.id AND status='ready'
      AND expires_at>now() ORDER BY created_at DESC,id DESC LIMIT 1) link ON true
    WHERE a.status='issued' AND a.currency='AED' AND c.currency='AED' ORDER BY a.issued_on DESC,a.invoice_no DESC`);
  const payments = await list(db, `SELECT pa.id,pa.invoice_id,pa.customer_id,pa.amount,
    coalesce(p.provider_payment_id,p.id::text) AS reference,p.received_at::date AS received_on
    FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id JOIN customers c ON c.id=pa.customer_id
    WHERE p.status='captured' AND pa.currency='AED' AND c.currency='AED' ORDER BY p.received_at DESC,pa.id`);
  const tickets = await list(db, `SELECT t.*,coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'author_name',u.display_name,
    'body',m.body,'visibility',m.visibility,'created_at',m.created_at) ORDER BY m.created_at)
    FROM ticket_messages m JOIN users u ON u.id=m.author_id WHERE m.ticket_id=t.id),'[]') AS messages
    FROM support_tickets t JOIN customers c ON c.id=t.customer_id WHERE c.currency='AED' ORDER BY t.created_at DESC,t.id`);
  const staff = await list(db, `SELECT u.id,u.email,u.display_name,sp.designation,u.status,
    coalesce((SELECT r.role_code FROM staff_roles r JOIN roles d ON d.code=r.role_code
      WHERE r.user_id=u.id AND d.scope='staff' ORDER BY CASE r.role_code WHEN 'admin' THEN 0 WHEN 'finance' THEN 1 ELSE 2 END,r.role_code LIMIT 1),'support') AS role_code
    FROM users u LEFT JOIN staff_profiles sp ON sp.user_id=u.id WHERE u.is_staff ORDER BY u.display_name,u.id`);
  const plans = await list(db, `SELECT p.*,i.category,price.unit_amount,price.term_months,price.tax_inclusive,
    'AED' AS currency FROM catalog_plans p JOIN catalog_items i ON i.id=p.catalog_item_id
    LEFT JOIN LATERAL (SELECT * FROM catalog_prices WHERE plan_id=p.id AND currency='AED' AND term_months=12
      AND valid_from<=current_date AND (valid_until IS NULL OR valid_until>current_date) ORDER BY valid_from DESC LIMIT 1) price ON true
    ORDER BY i.category,p.tier_rank,p.name`);
  const catalog = await list(db, 'SELECT * FROM catalog_items ORDER BY name');
  const providers = await list(db, 'SELECT * FROM providers ORDER BY name');
  const catalog_entries = await list(db, `SELECT t.id::text||':'||a.project_category AS id,'technology' AS "group",t.name,t.active,a.project_category AS project_type,
    null::smallint AS months,null::text AS description FROM technology_stacks t JOIN technology_stack_categories a ON a.tech_stack_id=t.id
    UNION ALL SELECT id::text,'marketing',name,active,null,null,description FROM marketing_activities
    UNION ALL SELECT id::text,'amc',name,active,null,null,description FROM amc_plans
    UNION ALL SELECT id::text,'cycle',name,active,null,months,null FROM billing_cycles ORDER BY "group",name`);
  const activity = actor.roles.includes('admin') ? await rows(db, `SELECT e.id,e.action,e.occurred_at,coalesce(u.display_name,'Staff') AS actor,
    coalesce(e.changes->>'label',e.entity_type) AS detail FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id
    LEFT JOIN customers c ON c.id=e.customer_id WHERE e.customer_id IS NULL OR c.currency='AED' ORDER BY e.id DESC LIMIT 100`) : [];
  const notifications = await rows(db, `SELECT p.id,p.invoice_id,
    (CASE WHEN p.message='Payment link requested.' THEN 'Payment link requested · ' ELSE 'Payment reminder · ' END)||i.invoice_no AS title,
    p.status,p.created_at FROM payment_requests p JOIN invoices i ON i.id=p.invoice_id
    WHERE i.currency='AED' AND p.status IN ('queued','failed') ORDER BY p.created_at DESC,p.id LIMIT 100`);
  const countries = await rows(db, 'SELECT code,name FROM countries ORDER BY name');
  const settings = await one(db, 'SELECT company_name,billing_email FROM admin_settings WHERE singleton');
  for (const contract of contracts) {
    const next = contract.status === 'active' ? period(contract) : null;
    const unpaid = invoices.filter(invoice => invoice.contract_id === contract.id && money(invoice.balance).gt(0) && invoice.due_on < asOf);
    const overdueMonths = unpaid.reduce((total, invoice) => {
      if (!invoice.period_start || !invoice.period_end) return total + Number(contract.billing_cycle_months);
      const start = new Date(invoice.period_start);
      const end = new Date(invoice.period_end);
      return total + Math.max(1, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth());
    }, 0);
    let unissued = money(0);
    let missed = 0;
    let upcoming = next;
    for (let index = 0; upcoming && upcoming.due < asOf && index < 12; index++) {
      missed += upcoming.months;
      unissued = unissued.plus(upcoming.gross);
      upcoming = period({ ...contract, next_period_start: upcoming.end, next_due_date: addMonths(upcoming.due, contract.billing_cycle_months) });
    }
    contract.live_billing = {
      lastPayment: contract.last_payment_received_at?.toISOString?.().slice(0,10) || contract.last_payment_received_at,
      daysSincePayment: contract.last_payment_received_at ? daysBetween(new Date(contract.last_payment_received_at).toISOString().slice(0,10), asOf) : null,
      dueDate: contract.payment_due_on, dueDays: contract.days_to_due,
      nextScheduled: next?.due, nextAmount: next?.gross, overdueMonths: overdueMonths + missed,
      overdueBalance: unpaid.reduce((total, invoice) => total.plus(invoice.balance), money(0)).toFixed(2),
      unissuedOverdue: unissued.toFixed(2),
    };
  }
  return { asOf, customers, services, projects, contracts, orders, invoices, payments, tickets, staff, plans,
    catalog, catalog_entries, providers, countries, activity, notifications, settings, quotes: [], renewals: [] };
}
