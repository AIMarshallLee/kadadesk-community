import { marketLabel, type CustomerMarket } from '../shared/customer-market';
export default function CustomerMarketField({value,onChange,disabled=false}: {value?:CustomerMarket;onChange(value:CustomerMarket):void;disabled?:boolean}) {
  return <label className="field"><span>当前客户市场</span><select aria-label="当前客户市场" value={value??'unknown'} disabled={disabled} onChange={e=>onChange(e.target.value as CustomerMarket)}>{Object.entries(marketLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><small>选了哪个市场就只报那个市场的价格；不确定就选「未确认」，咔哒会先问客户在哪个地区。</small></label>;
}
