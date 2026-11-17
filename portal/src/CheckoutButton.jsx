'use client';
import { usePortal } from './portal-context';
import { Btn } from './ui';
export function invoiceCheckoutEligible(invoice) {
  return !invoice.payment_link && invoice.lines?.length===1 && ['annual_renewal','contract_instalment'].includes(invoice.lines[0].charge_type);
}
export default function CheckoutButton({kind,targetId}) {
  const {account,permits}=usePortal();
  if(!permits('billing.view'))return null;
  const url='/checkout?'+new URLSearchParams({account:account.id,kind,target:targetId});
  return <Btn primary icon="card" onClick={()=>window.location.assign(url)}>Pay Now</Btn>;
}
