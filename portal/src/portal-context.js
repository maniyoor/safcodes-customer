import { createContext, useContext, useRef, useState } from 'react';

export const Context = createContext(null);
export const usePortal = () => useContext(Context);
export const invoiceForService = (data, service) => data.invoices.find(i => i.lines.some(l =>
  l.service_id === service.id && l.charge_type === 'annual_renewal' && l.period_start === service.term_end));
export const openRenewal = (data, id) => data.orders.find(o => o.kind === 'renewal' && o.existing_service_id === id &&
  ['under_review','needs_information','on_hold','awaiting_payment','paid'].includes(o.status));

export function useCommand() {
  const { command } = usePortal();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const last = useRef(null);
  const sending = useRef(false);
  async function run(action,fields,done) {
    if (sending.current) return;
    sending.current = true;
    setError(''); setBusy(true);
    try {
      const signature = JSON.stringify([action,fields]);
      if (last.current?.signature !== signature) last.current = { signature, key: crypto.randomUUID() };
      const result = await command(action,fields,last.current.key);
      last.current = null;
      done?.(result);
    }
    catch (problem) { setError(problem.message); }
    finally { setBusy(false); sending.current = false; }
  }
  return { run,busy,error };
}
