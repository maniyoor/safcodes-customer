import { useId, useRef } from 'react';
import { aed, categoryIcons, daysTo, exVat, paths } from './data';
const extra={package:'m12 2 9 5v10l-9 5-9-5V7l9-5 M3 7l9 5 9-5 M12 12v10 M7.5 4.5l9 5',mobile:'M7 2h10v20H7z M10 5h4 M11 19h2',chat:'M21 3H3v14h5v5l6-5h7V3 M7 8h10 M7 12h6',user:'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2 M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',logout:'M9 4H3v16h6 M8 12h13 m-5-5 5 5-5 5',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',send:'m22 2-7 20-4-9-9-4L22 2 M11 13 22 2'};
export function Icon({name,...props}){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={name==='more'?'M5 12h.01 M12 12h.01 M19 12h.01':extra[name]||paths[name]||paths.layers} strokeWidth={name==='more'?3:undefined}/></svg>}
export function Brand(){return <><div className="brand real-brand"><img src="/brand/safcodes-logo-standard.png" alt="Safcodes — bug free solutions" width="240" height="60"/></div><div className="brand-sub">Client portal</div></>}
export function Btn({children,icon,end,primary,lime,small,ghost,className='',...props}){return <button type="button" className={`btn ${primary?'primary':''} ${lime?'lime':''} ${small?'small':''} ${ghost?'ghost':''} ${className}`} {...props}>{icon&&<Icon name={icon}/>}<span>{children}</span>{end&&<Icon name={end}/>}</button>}
export function Badge({children}){const s=String(children||'');const tone=/overdue|due|unpaid|awaiting|pending/i.test(s)?'amber':/review|prepared|progress|development/i.test(s)?'blue':/cancel|closed/i.test(s)?'gray':'';return <span className={`badge ${tone}`}>{children}</span>}
export function ServiceIcon({service,category}){return <span className="service-icon blue"><Icon name={categoryIcons[category||service?.category]||'layers'}/></span>}
export function Heading({eyebrow,title,description,action,label='Request a service',actionIcon='plus'}){return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action&&<Btn primary icon={actionIcon} onClick={action}>{label}</Btn>}</div>}
export function Panel({title,subtitle,action,children,className=''}){return <section className={`panel ${className}`}>{title&&<div className="panel-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>}{children}</section>}
export function Empty({icon='layers',title,description,children}){return <div className="empty"><Icon name={icon}/><h3>{title}</h3><p>{description}</p>{children}</div>}
export function Info({children,icon='help'}){return <div className="info-box"><Icon name={icon}/>{children}</div>}
export function Field({label,id,hint,children,...props}){return <div className="field"><label htmlFor={id}>{label}</label>{children||<input id={id} {...props}/>} {hint&&<small>{hint}</small>}</div>}
export function Row({label,children,total=false}){return <div className={`summary-row ${total?'total':''}`}><span>{label}</span><strong>{children}</strong></div>}
export function Tabs({items,value,onChange,label}) {
  const options = new Map();
  for (const item of items) {
    const option = typeof item === 'string' ? { id:item,label:item } : item;
    if (option?.id && !options.has(option.id)) options.set(option.id,option);
  }
  return <div className="tabs" role={label?'group':undefined} aria-label={label}>
    {[...options.values()].map(option => <button key={option.id} type="button" className={'tab'+(value===option.id?' active':'')}
      aria-pressed={value===option.id} onClick={() => onChange(option.id)}>
      {option.label}{option.count!=null && <span className="tab-count">{option.count}</span>}
    </button>)}
  </div>;
}
export function LayoutToggle({label,value,onChange}) {
  return <div className="view-toggle" role="group" aria-label={label}>
    <button type="button" aria-label="Card view" title="Card view" aria-pressed={value==='grid'} onClick={() => onChange('grid')}><Icon name="grid"/></button>
    <button type="button" aria-label="List view" title="List view" aria-pressed={value==='table'} onClick={() => onChange('table')}><Icon name="requests"/></button>
  </div>;
}
export function Expiry({asOf,ends}) {
  const days = daysTo(asOf,ends);
  if (!Number.isFinite(days)) return '—';
  const magnitude = Math.abs(days);
  const text = days===0 ? 'Due today' : magnitude + (magnitude===1?' day':' days') + (days<0?' overdue':' left');
  return <span className={'live-expiry'+(days<=30?' urgent':'')}>{text}</span>;
}
export function PriceSummary({price,empty='Price on request'}) {
  if (!price) return empty;
  if (price.total==null) return exVat(price.net);
  return <span className="live-price"><strong>{aed(price.total)}</strong>
    <small>{price.net==null ? 'VAT included' : aed(price.net) + ' + ' + aed(price.vat) + ' VAT'}</small>
  </span>;
}
export function PriceRows({price,label='Price'}) {
  if (!price) return <Row label={label}>Price on request</Row>;
  if (price.total==null) return <Row label={label}>{exVat(price.net)}</Row>;
  if (price.net==null) return <Row label={label}>{aed(price.total)} incl. VAT</Row>;
  return <><Row label={label+' excl. VAT'}>{aed(price.net)}</Row><Row label="VAT">{aed(price.vat)}</Row>
    <Row label="Total incl. VAT" total>{aed(price.total)}</Row></>;
}
export function Steps({step,names=['Choose a service','Your requirements','Review request']}){return <div className="steps" aria-label={`Step ${step+1} of ${names.length}`}>{names.map((n,i)=><span key={n} className={`step ${i<=step?'active':''}`} aria-current={step===i?'step':undefined}><em>{i<step?'✓':i+1}</em>{n}</span>)}</div>}

export function ActionMenu({label,icon='more',items,children}) {
  const id = useId();
  const menu = useRef(null);
  function position(event) {
    const anchor = event.currentTarget.getBoundingClientRect();
    const height = 16 + items.length * 40;
    menu.current.style.top = Math.max(8,anchor.bottom + height < innerHeight ? anchor.bottom + 6 : anchor.top - height - 6) + 'px';
    menu.current.style.right = Math.max(8,innerWidth - anchor.right) + 'px';
  }
  return <>
    <button type="button" className="icon-button live-action-trigger" aria-label={label} popoverTarget={id} onClick={position}>{children || <Icon name={icon}/>}</button>
    <div id={id} ref={menu} popover="auto" className="live-action-popover" role="group" aria-label={label}>
      {items.map(([text,action,symbol]) => <button type="button" key={text} onClick={() => { menu.current.hidePopover(); action(); }}>
        <Icon name={symbol}/><span>{text}</span>
      </button>)}
    </div>
  </>;
}
