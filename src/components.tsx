import type { ReactNode, ButtonHTMLAttributes } from 'react';
export function Button({children,variant='primary',busy=false,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary';busy?:boolean}) {
  return <button className={'btn '+variant} {...props} disabled={props.disabled||busy}>{children}</button>;
}
export function Field({label,children}: {label:string;children:ReactNode}) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function PageHead({title,eyebrow,description}: {title:string;eyebrow:string;description:string}) {
  return <header className="page-head"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></header>;
}
