export const paths = {
 logo:'M18 5h-7a5 5 0 0 0 0 10h4a4 4 0 0 1 0 8H6',
 grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 layers:'m12 3 10 5-10 5L2 8l10-5 M2 12l10 5 10-5 M2 16l10 5 10-5',
 refresh:'M20 7v5h-5 M4 17v-5h5 M6.1 6a8 8 0 0 1 13.3 2M4.6 16A8 8 0 0 0 18 18',
 wallet:'M20 8V5H4a2 2 0 0 0 0 4h17v11H4a2 2 0 0 1-2-2V7 M21 12h-5v5h5 M17 14.5h1',
 requests:'M8 3h12v18H4V7h4V3 M8 3v5H4 M8 12h8 M8 16h5',
 globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18',
 server:'M3 3h18v7H3z M3 14h18v7H3z M6 6.5h.01 M6 17.5h.01 M15 6.5h3 M15 17.5h3',
 mail:'M3 5h18v14H3z m0 0 9 7 9-7',
 website:'M3 4h18v16H3z M3 9h18 M6 6.5h.01 M9 6.5h.01 M7 13h4 M7 16h7',
 store:'M3 9h18l-2-6H5L3 9 M4 9v12h16V9 M8 21v-7h8v7 M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0',
 chart:'M3 3v18h18 M7 16l4-5 4 2 6-8 M17 5h4v4',
 megaphone:'m3 10 14-6v16L3 15v-5 M7 16l1 5h4l-2-4 M21 9v6',
 plus:'M12 5v14 M5 12h14', right:'M5 12h14 m-5-5 5 5-5 5', left:'M19 12H5 m5-5-5 5 5 5',
 down:'m6 9 6 6 6-6', close:'m6 6 12 12 M18 6 6 18', check:'m5 12 4 4L19 6',
 lock:'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
 bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
 menu:'M3 6h18 M3 12h18 M3 18h18', help:'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4 M12 18h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 clock:'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 shield:'m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5l8-3 m-4 10 3 3 5-6',
 calendar:'M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18 M7 14h3 M14 14h3 M7 17h3',
 spark:'m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2',
 search:'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
 card:'M2 5h20v14H2z M2 10h20 M6 15h4', bank:'m2 8 10-6 10 6H2 M3 21h18 M5 10v8 M12 10v8 M19 10v8',
 qr:'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M12 12h3v3h3v-3h3 M12 18v3h3 M18 18h3v3',
 document:'M6 2h9l4 4v16H6z M14 2v5h5 M9 11h7 M9 15h7 M9 18h4',
 link:'m10 13 4-4 M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M12 18a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1',
 arrowUp:'M7 17 17 7 M7 7h10v10', reset:'M3 11a9 9 0 1 1 2 7 M3 5v6h6'
};
export const categoryIcons = {
  domain: 'globe', shared_hosting: 'server', cloud_hosting: 'server', email: 'mail', security: 'shield',
  website: 'website', web_portal: 'website', online_store: 'store', mobile_app: 'mobile',
  digital_marketing: 'chart', performance_marketing: 'megaphone', qr_code: 'qr', other:'spark',
};
export const requestCategories = {
  domain:'Domain Registration', shared_hosting:'Shared Hosting', cloud_hosting:'Cloud Hosting',
  email:'Business Email', security:'Security & SSL', qr_code:'QR Code', website:'Website', web_portal:'Web Portal', online_store:'Online Store',
  mobile_app:'Mobile Application', digital_marketing:'Digital Marketing', performance_marketing:'Performance Marketing',
  other:'Other Service',
};
export const deliveryCategories = ['website','web_portal','online_store','mobile_app','digital_marketing','performance_marketing'];
export const emailProviders = [
  { id:'microsoft', label:'Microsoft Office365' }, { id:'google', label:'Google Workspace' },
  { id:'zoho', label:'Zoho Email' }, { id:'business', label:'Business Emails' },
];
export function emailProvider(record) {
  if (emailProviders.some(provider => provider.id===record.provider_code)) return record.provider_code;
  const name = [record.provider_code, record.provider, record.plan, record.name].filter(Boolean).join(' ');
  if (/microsoft|office\s*365|\bm365\b|exchange online/i.test(name)) return 'microsoft';
  if (/google|g\s*suite/i.test(name)) return 'google';
  return /\bzoho\b/i.test(name) ? 'zoho' : 'business';
}
export const labels = {
  under_review: 'Under review', needs_information: 'Needs more information', quoted: 'Quote processed',
  accepted: 'Quote accepted', awaiting_payment: 'Invoice issued', fulfilling: 'In progress',
  new_product: 'Product order', new_service: 'Service request', email_scale: 'Email scaling',
  hosting_upgrade: 'Hosting upgrade', awaiting_client: 'Awaiting your reply',
  settled: 'Settled', partially_paid: 'Partially paid', annual_renewal: 'Annual renewal',
  contract_instalment: 'AMC / SLA instalment', healthy: 'Operational', unknown: 'Not reported',
};
export const label = value => labels[value] || (value ? value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) : '—');
const currency = new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function amountNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export const aed = value => amountNumber(value) === null ? '—' : 'AED ' + currency.format(Number(value));
export const exVat = value => amountNumber(value) === null ? '—' : aed(value) + ' excl. VAT';
const roundAmount = value => Math.round((value + Number.EPSILON * Math.abs(value)) * 100) / 100;

export function priceBreakdown(amount, { quantity = 1, inclusive = false, taxRate, netUnit } = {}) {
  const unit = amountNumber(amount);
  const net = amountNumber(netUnit);
  const count = amountNumber(quantity);
  const rate = amountNumber(taxRate);
  if (count === null || (unit === null && net === null)) return null;
  if (inclusive && unit !== null) {
    const total = roundAmount(unit * count);
    const subtotal = rate !== null ? roundAmount(total / (1 + rate)) : net !== null ? roundAmount(net * count) : null;
    return { net: subtotal, vat: subtotal === null ? null : roundAmount(total - subtotal), total };
  }
  const subtotal = roundAmount((net ?? unit) * count);
  const vat = rate === null ? null : roundAmount(subtotal * rate);
  return { net: subtotal, vat, total: vat === null ? null : roundAmount(subtotal + vat) };
}
export const servicePricing = (service,taxRate) => priceBreakdown(service.recurring_unit_amount, {
  quantity:service.quantity, inclusive:service.tax_inclusive, netUnit:service.recurring_net_unit_amount, taxRate,
});
export const planPricing = (plan,taxRate,quantity=1) => priceBreakdown(plan.unit_amount, {
  quantity, inclusive:plan.tax_inclusive, netUnit:plan.net_unit_amount, taxRate,
});
export function orderPricing(order,taxRate) {
  if (order.quote_id) {
    const total = amountNumber(order.quote_total);
    const net = amountNumber(order.quote_subtotal);
    return total === null ? null : { total, net, vat: net === null ? null : roundAmount(total - net) };
  }
  if (!(amountNumber(order.estimate ?? order.estimate_net) > 0)) return null;
  return priceBreakdown(order.estimate, {
    inclusive:order.estimate_tax_inclusive, netUnit:order.estimate_net, taxRate,
  });
}
const calendar = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Dubai' });
export const date = value => value && Number.isFinite(Date.parse(value)) ? calendar.format(new Date(value)) : '—';
export const daysTo = (from,to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
export function duration(service, project) {
  const start = project?.start_date || service.term_start;
  const end = project?.completed_on && project.completed_on >= start ? project.completed_on : project?.target_date || service.term_end;
  const days = daysTo(start,end);
  return Number.isFinite(days) && days >= 0 ? days + (days===1 ? ' day' : ' days') : '—';
}
export const renewable = service => service.billing_mode === 'annual' && service.term_end &&
  !['cancelled','terminated','provisioning'].includes(service.status);
export const changeEligible = (service,asOf) => service.status === 'active' && renewable(service) && service.plan_id &&
  service.term_start && service.term_start <= asOf && service.term_end > asOf &&
  ['shared_hosting','cloud_hosting','email'].includes(service.category);
export const scopeText = value => value == null ? '' : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
export const ticketClosed = ticket => ['resolved','closed'].includes(ticket.status);
export const ticketAction = ticket => ticketClosed(ticket) ? 'Reopen ticket' : 'Close ticket';
