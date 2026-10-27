"use client";
import {useCallback,useEffect,useState} from 'react';
import DeletePrizeModal from './DeletePrizeModal';
type Row=Record<string,any>;
type Props={api:(path:string,body?:Row)=>Promise<any>;onSaved:()=>Promise<void>};
const labels:Row={regular_champion:'常规赛 · 冠军',regular_second:'常规赛 · 亚军',regular_third:'常规赛 · 季军',regular_pool27:'常规赛 · 27收池',gto_champion_tickets:'GTO · 冠军方案 A',gto_champion_gift:'GTO · 冠军方案 B',gto_second:'GTO · 亚军',gto_third:'GTO · 季军',gto_pool27:'GTO · 27收池'};
export function awardLabel(config:Row,key:string,fallback:string){const rule=config.rules?.find((r:Row)=>r.key===key);const prize=config.prizes?.find((p:Row)=>p.code===rule?.prize_code);return rule&&prize?`${prize.name} × ${rule.quantity}`:fallback;}
export default function PrizeSettings({api,onSaved}:Props){
 const [savedCodes,setSavedCodes]=useState<string[]>([]),[deleting,setDeleting]=useState<Row|null>(null);
 const [prizes,setPrizes]=useState<Row[]>([]),[rules,setRules]=useState<Row[]>([]),[logs,setLogs]=useState<Row[]>([]),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const load=useCallback(async()=>{const [settings,history]=await Promise.all([api('/prize-settings'),api('/inventory-logs')]);setPrizes(settings.prizes);setSavedCodes(settings.prizes.map((p:Row)=>p.code));setRules(settings.rules);setLogs(history);setLoaded(true);},[api]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
 function edit(code:string,field:string,value:any){setPrizes(rows=>rows.map(p=>p.code===code?{...p,[field]:value}:p));}
 async function deletePrize(reason:string){
  if(!deleting)return;
  setBusy(true);setError('');setNotice('');
  try{
   const saved=savedCodes.includes(deleting.code);
   if(saved)await api('/prizes/'+encodeURIComponent(deleting.code)+'/delete',{version:deleting.version,reason});
   else if(rules.some(r=>r.prize_code===deleting.code))throw Error('请先更换引用该草稿奖品的发奖规则，再删除');
   const remaining=prizes.filter(p=>p.code!==deleting.code);
   setPrizes(remaining);setSavedCodes(codes=>codes.filter(code=>code!==deleting.code));
   setDeleting(null);setNotice('奖品已删除');
   if(saved){try{setLogs(await api('/inventory-logs'));await onSaved();}catch{setError('奖品已删除，记录刷新失败，请刷新查看最新状态');}}
  }finally{setBusy(false)}
 }
 return <><div className="note">库存是可继续发放的数量，发放时扣减；核销不重复扣减。撤销已预占库存的未使用奖励会退回库存。数量为 0 表示该名次不发奖品。门票随比赛名次直接发放，积分用于月赛榜和总榜排名。</div>
 {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="notice" role="status">{notice}</div>}
 <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');setNotice('');try{await api('/prize-settings',{prizes,rules,reason});await load();setReason('');setNotice('奖品、发放数量和库存已保存');await onSaved();}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>
 <section className="card"><div className="card-heading"><h2>奖品与库存</h2><button type="button" className="link" disabled={busy} onClick={()=>{if(window.confirm('刷新会丢弃未保存修改，继续？'))load().catch(e=>setError(e.message));}}>刷新设置与库存</button></div><div className="table-wrap"><table><thead><tr><th>奖品名称</th><th>可发放库存</th><th>库存模式</th><th>启用</th><th>操作</th></tr></thead><tbody>{prizes.map(p=><tr key={p.code}><td><input aria-label={p.code+'奖品名称'} required maxLength={100} value={p.name} disabled={busy} onChange={e=>edit(p.code,'name',e.target.value)}/></td><td>{p.stock===null?'不限库存':<input aria-label={p.code+'库存'} type="number" required min={0} max={1000000} value={p.stock} disabled={busy} onChange={e=>edit(p.code,'stock',e.target.value===''?'':Number(e.target.value))}/>}</td><td><label><input type="checkbox" checked={p.stock===null} disabled={busy} onChange={e=>edit(p.code,'stock',e.target.checked?null:0)}/> 不限库存</label></td><td><input aria-label={p.code+'启用'} type="checkbox" checked={p.enabled} disabled={busy} onChange={e=>edit(p.code,'enabled',e.target.checked)}/></td><td><button type="button" className="link danger" aria-label={'删除'+(p.name||'未命名奖品')} disabled={busy} onClick={()=>setDeleting(p)}>删除</button></td></tr>)}</tbody></table></div><div className="form-footer"><p>新奖品设置库存后可用于赛事奖励和手动补发。</p><button type="button" disabled={busy||!loaded} onClick={()=>setPrizes(rows=>[...rows,{code:'CUSTOM_'+crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),name:'',stock:0,enabled:true,version:0}])}>新增奖品</button></div></section>
 <section className="card"><div className="card-heading"><h2>各名次奖品与发放数量</h2><span>每份奖品独立核销</span></div><div className="table-wrap"><table><thead><tr><th>赛事 / 名次</th><th>发放奖品</th><th>发放份数</th></tr></thead><tbody>{rules.map(r=><tr key={r.key}><td>{labels[r.key]}</td><td><select aria-label={labels[r.key]+'奖品'} value={r.prize_code} disabled={busy} onChange={e=>setRules(rows=>rows.map(row=>row.key===r.key?{...row,prize_code:e.target.value}:row))}>{!prizes.some(p=>p.code===r.prize_code)&&<option value={r.prize_code}>已删除奖品（停止发放）</option>}{prizes.map(p=><option key={p.code} value={p.code}>{p.name||'未命名奖品'}{!p.enabled?'（已停用）':''}</option>)}</select></td><td><input aria-label={labels[r.key]+'数量'} type="number" required min={0} max={20} value={r.quantity} disabled={busy} onChange={e=>setRules(rows=>rows.map(row=>row.key===r.key?{...row,quantity:e.target.value===''?'':Number(e.target.value)}:row))}/></td></tr>)}</tbody></table></div><div className="form-grid"><label className="wide">设置 / 库存调整原因 <b className="required">*</b><input required maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="例如：新增礼品并补货20份"/></label><div className="form-footer"><p>保存后用于之后的发放，已发奖励保留原来的记录。库存变化时请先刷新再调整。</p><button disabled={busy||!loaded}>{busy?'保存中…':'保存奖品设置'}</button></div></div></section></form>
 <section className="card"><div className="card-heading"><h2>库存流水</h2><span>最近100条</span></div><div className="table-wrap"><table><thead><tr><th>时间 / 奖品</th><th>变化</th><th>剩余</th><th>原因</th><th>奖励 / 管理员</th></tr></thead><tbody>{logs.map(l=><tr key={l.id}><td>{l.prize_name}<small>{l.created_at.replace('T',' ').slice(0,19)}</small></td><td>{l.change===null?'库存模式设置':l.change>0?'+'+l.change:l.change}</td><td>{l.balance===null?'不限':l.balance}</td><td>{l.reason}</td><td>{l.reward_id?'奖励 #'+l.reward_id:'设置调整'} · {l.operator_id?`管理员 #${l.operator_id}`:'会员积分兑换'}</td></tr>)}{!logs.length&&<tr><td colSpan={5} className="empty">暂无库存流水</td></tr>}</tbody></table></div></section>{deleting&&<DeletePrizeModal name={deleting.name} onClose={()=>setDeleting(null)} onDelete={deletePrize}/>}</>;
}
