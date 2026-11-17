'use client';
import {useEffect,useRef,useState} from 'react';
import Auth from './Auth';
import {api,accountPath} from './api';
import {Icon} from './ui';

const money=minor=>new Intl.NumberFormat('en-AE',{style:'currency',currency:'AED'}).format(Number(minor)/100);
const date=value=>value?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')):'—';
const done=['test_completed','completed','review_required','failed','canceled','expired'];
const sum=items=>items.reduce((s,i)=>({amount_minor:s.amount_minor+i.amount_minor,net_minor:s.net_minor+i.net_minor,vat_minor:s.vat_minor+i.vat_minor}),{amount_minor:0,net_minor:0,vat_minor:0});
const empty={error:'',busy:false};

export default function Checkout(){
  const [identity,setIdentity]=useState(undefined),[accountId,setAccountId]=useState('');
  const [quote,setQuote]=useState(null),[selected,setSelected]=useState([]),[checkout,setCheckout]=useState(null);
  const [step,setStep]=useState(0),[reviewed,setReviewed]=useState(false),[state,setState]=useState(empty);
  const params=useRef(null),key=useRef(null),requestId=useRef(0);
  const account=identity?.accounts.find(a=>a.id===accountId);
  async function loadSession(){
    try{const session=await api('/session');setIdentity(session);return session}
    catch(error){if(error.status===401){setIdentity(null);return null}throw error}
  }
  useEffect(()=>{params.current=new URLSearchParams(window.location.search);key.current=crypto.randomUUID();
    loadSession().then(session=>{if(!session)return;const id=params.current.get('account')||session.accounts[0]?.id;
      if(!session.accounts.some(a=>a.id===id))throw new Error('This checkout is not available for your current account.');setAccountId(id);
    }).catch(error=>setState({error:error.message,busy:false}));
  },[]);
  async function call(body,id=accountId,requestKey){return api(accountPath(id,'checkout'),body,requestKey)}
  async function loadQuote(){
    const revision=++requestId.current;setState({error:'',busy:true});
    try{const value=await call({operation:'preview',kind:params.current.get('kind'),target_id:params.current.get('target')});
      if(revision!==requestId.current)return;setQuote(value);setSelected(value.items.map(i=>i.key));setState(empty);
    }catch(error){if(revision===requestId.current)setState({error:error.message,busy:false})}
  }
  async function check(id=checkout?.id){
    if(!id)return;setState({error:'',busy:true});
    try{const value=await call({operation:'status',id});setCheckout(value);setState(empty)}
    catch(error){setState({error:error.message,busy:false})}
  }
  useEffect(()=>{
    if(!accountId)return;
    if(params.current.get('session'))check(params.current.get('session'));else loadQuote();
  },[accountId]);
  useEffect(()=>{
    if(!checkout?.id||done.includes(checkout.status))return;
    const timer=setInterval(()=>check(checkout.id),5000);return()=>clearInterval(timer);
  },[checkout?.id,checkout?.status,accountId]);
  const testMode=(checkout||quote)?.test_mode;
  const confirmed=['test_completed','completed','review_required'].includes(checkout?.status);
  const items=quote?.items.filter(i=>selected.includes(i.key))||[];
  const totals=sum(items),fee=Math.round(totals.amount_minor*7/100);
  const toggle=id=>{setSelected(previous=>previous.includes(id)?previous.filter(i=>i!==id):[...previous,id]);setReviewed(false);key.current=crypto.randomUUID()};
  const back='/#/'+(quote?.kind==='renewal'||checkout?.kind==='renewal'?'renewals':'contracts');
  async function pay(){
    if(state.busy||!reviewed)return;setState({error:'',busy:true});
    try{
      const prepared=await call({operation:'prepare',kind:quote.kind,target_id:quote.target_id,revision:quote.revision,selected_keys:selected},accountId,key.current);
      params.current.set('session',prepared.id);window.history.replaceState(null,'','/checkout?'+params.current);
      const started=await call({operation:'start',id:prepared.id,gateway:'ziina'});
      setCheckout(started);setState(empty);
      if(started.status==='pending'&&started.redirect_url)window.location.assign(started.redirect_url);
    }catch(error){
      setState({error:error.message,busy:false});
      if(params.current.get('session')){
        try{const current=await call({operation:'status',id:params.current.get('session')});setCheckout(current)}catch{}
      }
    }
  }
  function restart(){
    if(!checkout)return;
    params.current=new URLSearchParams({account:accountId,kind:checkout.kind,target:checkout.target_id});
    window.history.replaceState(null,'','/checkout?'+params.current);setCheckout(null);setStep(0);setReviewed(false);key.current=crypto.randomUUID();loadQuote();
  }
  if(identity===null)return <Auth onSuccess={session=>{setIdentity(session);setAccountId(params.current.get('account')||session.accounts[0]?.id)}} message="Sign in to continue your checkout."/>;
  return <div className="ck-page">
    <header className="ck-header"><a href="/#/overview" aria-label="Safcodes workspace"><img src="/brand/safcodes-logo-standard.png" alt="Safcodes" width="180" height="45"/></a><div><span className="ck-test-tag">{testMode===undefined?'CHECKOUT':testMode?'TEST MODE':'LIVE PAYMENT'}</span><span>{account?.display_name||'Customer checkout'}</span></div></header>
    <main className="ck-main">
      <a className="ck-back" href={back}><Icon name="left"/>Back to workspace</a>
      <div className="ck-title"><div><p className="eyebrow">SAFCODES CHECKOUT</p><h1>{checkout?'Payment status':quote?.kind==='contract'?'AMC / SLA payment':'Renew your subscription'}</h1>
        <p>{checkout?.title || quote?.title || 'Loading your billing details…'}</p></div><div className="ck-lock"><Icon name="shield"/>Secure hosted payment</div></div>
      <>{testMode===true&&<div className="ck-test-notice" role="note"><Icon name="shield"/><p><strong>Ziina test checkout</strong> No real payment will be collected. Test payments do not settle live invoices or change renewal dates.</p></div>}{testMode===false&&<div className="ck-test-notice ck-live-notice" role="note"><Icon name="shield"/><p><strong>Secure Ziina payment</strong> Your card will be charged the confirmed total. Selected AMC / SLA periods are paid in full; product renewals are processed by Safcodes after payment.</p></div>}</>
      {state.error&&<div className="ck-error" role="alert">{state.error}{!checkout&&<button onClick={loadQuote} disabled={state.busy}>Refresh billing details</button>}</div>}
      {!checkout&&!quote&&<div className="ck-card ck-loading" role="status">{state.busy?'Loading current prices and billing periods…':'Waiting for account information…'}</div>}
      {!checkout&&quote&&<>
        <ol className="ck-steps" aria-label="Checkout steps"><li aria-current={step===0?'step':undefined} className={step>=0?'active':''}><b>{step>0?<Icon name="check"/>:1}</b>Review checkout</li><li className={step===1?'active':''} aria-current={step===1?'step':undefined}><b>2</b>Payment method</li></ol>
        {!quote.items.length?<div className="ck-card ck-empty"><Icon name="check"/><h2>No outstanding payments</h2><p>Your agreement has no pending or upcoming instalments available for checkout.</p><a className="btn primary" href={back}>Return to workspace</a></div>:<div className="ck-columns">
          <section className="ck-content">
            {step===0?<div className="ck-card">
              <div className="ck-section-head"><div><h2>{quote.kind==='contract'?'Choose billing periods':'Renewal details'}</h2><p>{quote.kind==='contract'?(quote.pending_count?`Total ${quote.pending_count} ${quote.items.every(i=>i.label.indexOf(' – ')<0)?'month(s)':'billing period(s)'} payment pending. Pay the full amount or select periods to pay.`:'Your next scheduled instalment is available for payment.'):'Review the full renewal amount before continuing.'}</p></div></div>
              {quote.kind==='contract'&&<div className="ck-selection-head"><span>{selected.length} of {quote.items.length} selected</span><button type="button" onClick={()=>{setSelected(quote.items.map(i=>i.key));setReviewed(false);key.current=crypto.randomUUID()}}>Select all</button></div>}
              <div className="ck-items">{quote.items.map(item=><label className={'ck-item'+(selected.includes(item.key)?' selected':'')} key={item.key}>
                {quote.kind==='contract'&&<input type="checkbox" checked={selected.includes(item.key)} onChange={()=>toggle(item.key)} aria-label={'Pay '+item.label}/>}
                <span className="ck-item-icon"><Icon name={quote.kind==='contract'?'calendar':'globe'}/></span>
                <span className="ck-item-copy"><strong>{item.label}</strong><small>{item.description}</small><small>{date(item.period_start)} – {date(item.period_end)} · Due {date(item.due_on)}</small>
                  <small>{item.invoice_id?'Issued invoice':'Scheduled instalment / renewal'}{quote.kind==='renewal'?' · Quantity '+item.quantity:''}</small></span>
                <span className="ck-item-price"><strong>{money(item.amount_minor)}</strong><small>incl. VAT</small></span>
              </label>)}</div>
              <p className="ck-help">{quote.kind==='contract'?'Pay the full outstanding amount for the periods you select. Entering a custom part-payment amount is not available.':'Product renewals are payable in full. The new term starts at the current expiry date.'}</p>
            </div>:<div className="ck-card">
              <div className="ck-section-head"><div><h2>Select payment method</h2><p>Choose how you would like to complete this {testMode?'test payment':'payment'}.</p></div></div>
              <label className={'ck-method selected'+(!quote.ziina_enabled?' disabled':'')}><input type="radio" name="payment-method" checked readOnly disabled={!quote.ziina_enabled}/><span><strong>Credit or debit card</strong><small>Hosted securely by Ziina{testMode?' · Test mode':''}</small><small>No additional checkout service fee</small></span><b className="ck-ziina">ziina</b></label>
              <label className="ck-method disabled" aria-disabled="true"><input type="radio" name="payment-method" disabled/><span><strong>Pay with Tamara <em>Coming later</em></strong><small>Tamara service fee: 7% · {money(fee)}</small><small>Indicative total with Tamara: {money(totals.amount_minor+fee)}</small></span><b className="ck-tamara">tamara</b></label>
              <p className="ck-help">Tamara is inactive. Its indicative 7% service fee is calculated on your selected VAT-inclusive total and is not added to a Ziina payment.</p>
              {!quote.ziina_enabled&&<div className="ck-error">Ziina checkout is currently unavailable. Contact Safcodes for assistance.</div>}
              <button className="ck-text-button" type="button" onClick={()=>setStep(0)}><Icon name="left"/>Change selected items</button>
            </div>}
          </section>
          <aside className="ck-card ck-summary"><h2>Order summary</h2><p>{quote.title}</p>
            {items.map(i=><div className="ck-summary-line ck-summary-item" key={i.key}><span>{i.label}</span><b>{money(i.amount_minor)}</b></div>)}
            <div className="ck-totals"><div className="ck-summary-line"><span>Subtotal excl. VAT</span><b>{money(totals.net_minor)}</b></div><div className="ck-summary-line"><span>VAT</span><b>{money(totals.vat_minor)}</b></div>
              <div className="ck-summary-line"><span>Ziina service fee</span><b>{money(0)}</b></div><div className="ck-summary-line ck-total"><span>Total</span><strong>{money(totals.amount_minor)}</strong></div></div>
            {testMode===false&&<p className="ck-help">Required invoices are issued when you continue to Ziina. Only the selected periods receive a payment allocation.</p>}
            {totals.amount_minor>0&&totals.amount_minor<200&&<p className="ck-error">The minimum Ziina payment is AED 2.00. Select additional periods or request a payment link.</p>}
            {step===0?<button className="btn primary ck-pay" type="button" disabled={!selected.length||totals.amount_minor<200||state.busy} onClick={()=>setStep(1)}>Continue to Payment <Icon name="right"/></button>:<>
              <label className="ck-confirm"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/>I have reviewed the selected items and total.</label>
              <button className="btn primary ck-pay" type="button" disabled={!reviewed||state.busy||!quote.ziina_enabled||!selected.length||totals.amount_minor<200} onClick={pay}>{state.busy?'Preparing checkout…':'Pay '+money(totals.amount_minor)+' with Ziina'}<Icon name="right"/></button>
            </>}
            <p className="ck-help ck-secure"><Icon name="lock"/>Your card details are entered only on Ziina’s hosted checkout.</p>
          </aside>
        </div>}
      </>}
      {checkout&&<div className="ck-card ck-result">
        <div className={'ck-result-icon '+(confirmed?'success':'')}><Icon name={confirmed?'check':checkout.status==='failed'?'close':'refresh'}/></div>
        <h2>{({completed:'Payment confirmed',review_required:'Payment received — review in progress',test_completed:'Test payment confirmed',failed:'Payment was not completed',canceled:'Checkout canceled',expired:'Checkout expired',uncertain:'Checking checkout creation',creating:'Preparing Ziina checkout',pending:'Waiting for payment confirmation',draft:'Checkout ready'})[checkout.status]}</h2>
        <p>{checkout.status==='test_completed'?'Ziina confirmed this test payment. No money was collected, and live invoices and renewal dates remain unchanged.':checkout.status==='review_required'?'Your payment was received. Safcodes finance will reconcile a changed invoice balance. Please do not pay again.':checkout.status==='completed'?(checkout.kind==='contract'?'Your selected AMC / SLA periods have been paid. Other outstanding periods remain available in your workspace.':checkout.fulfillment_status==='completed'?'Safcodes has confirmed your product renewal.':'Your renewal payment is recorded. Safcodes will process the product renewal and update its dates.'):'Safcodes checks the payment directly with Ziina. If confirmation is pending, do not start another payment.'}</p>
        <div className="ck-result-details"><div className="ck-summary-line"><span>{testMode?'Test checkout reference':'Checkout reference'}</span><b>{checkout.id}</b></div><div className="ck-summary-line"><span>Selected items</span><b>{checkout.items.length}</b></div><div className="ck-summary-line ck-total"><span>{testMode?'Test payment total':'Payment total'}</span><strong>{money(checkout.amount_minor)}</strong></div>
          {checkout.items.map(i=><div className="ck-summary-line" key={i.key}><span>{i.label}</span><b>{money(i.amount_minor)}</b></div>)}{checkout.payment_id&&<div className="ck-summary-line"><span>Receipt reference</span><b>{checkout.payment_id}</b></div>}</div>
        <div className="ck-result-actions">
          {checkout.redirect_url&&checkout.status==='pending'&&<a className="btn primary" href={checkout.redirect_url}>Continue on Ziina</a>}
          {!confirmed&&<button type="button" className="btn" disabled={state.busy} onClick={()=>check()}>{state.busy?'Checking…':'Check payment status'}</button>}
          {['draft','failed','canceled','expired'].includes(checkout.status)&&<button type="button" className="btn" onClick={restart}>Review checkout again</button>}
          <a className="btn" href={back}>Return to workspace</a>
        </div>
      </div>}
    </main><footer className="ck-footer">Safcodes · Your business, connected.</footer>
  </div>;
}
