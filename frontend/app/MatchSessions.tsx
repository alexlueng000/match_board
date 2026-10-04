"use client";
import {awardLabel} from "./PrizeSettings";
import { useCallback, useEffect, useState } from "react";
type Row = Record<string, any>;
type Props = { api: (path: string, body?: Row) => Promise<any>; onSaved: () => Promise<void>; sessionId?: number; prizeConfig?: Row };
const labels: Row = { open: "报名中", running: "进行中", finished: "已结束", cancelled: "已取消", joined: "已报名", checked_in: "已到场", withdrawn: "已退出" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
export default function MatchSessions({ api, onSaved, sessionId, prizeConfig = {} }: Props) {
  const [day, setDay] = useState(today), [rows, setRows] = useState<Row[]>([]), [detail, setDetail] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => { if(sessionId) setDetail(await api(`/sessions/${sessionId}`)); else setRows(await api("/sessions?day=" + day)); }, [api, day, sessionId]);
  useEffect(() => { setDetail(null); load().catch(e => setError(e.message)); }, [load]);
  useEffect(() => { if(!sessionId) { const saved = new URLSearchParams(window.location.search).get("day"); if(saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) setDay(saved); } }, [sessionId]);
  async function mutate(path: string, body: Row, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await api(path, body); setNotice(message); await load(); await onSaved(); return true; }
    catch(e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  const checked = detail?.roster.filter((r: Row) => r.status === "checked_in") || [];
  return <>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {!sessionId && <>
    <section className="card"><div className="card-heading"><h2>创建比赛场次</h2><span>时间采用北京时间</span></div>
      <form className="form-grid" onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget; const f = Object.fromEntries(new FormData(form));
        if(await mutate('/sessions', { ...f, starts_at: `${f.date}T${f.time}:00+08:00`, capacity: Number(f.capacity), date: undefined, time: undefined }, '场次已创建，用户可在当天加入')) { form.reset(); setDay(String(f.date)); }
      }}>
        <label>场次名称 <b className="required">*</b><input name="name" required maxLength={80} placeholder="例如：晚间常规赛" /></label>
        <label>比赛类型<select name="type"><option value="regular">常规赛</option><option value="gto">GTO 赛事</option></select></label>
        <label>比赛日期 <b className="required">*</b><input name="date" type="date" required min={today()} defaultValue={today()} /></label>
        <label>开始时间 <b className="required">*</b><input name="time" type="time" required defaultValue="19:30" /></label>
        <label>人数上限 <b className="required">*</b><input name="capacity" type="number" required min={3} max={500} defaultValue={27} /></label>
        <div className="form-footer"><p>用户加入后，店员确认到场；开赛后关闭报名。</p><button disabled={busy}>创建场次</button></div>
      </form>
    </section>
    <section className="card"><div className="card-heading"><h2>比赛场次</h2><label>查看日期 <input aria-label="查看场次日期" type="date" value={day} onChange={e => setDay(e.target.value)} /></label><button className="link" disabled={busy} onClick={() => load().catch(e => setError(e.message))}>刷新场次</button></div>
      <div className="table-wrap"><table><thead><tr><th>场次</th><th>类型 / 时间</th><th>报名人数</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id}><td>{r.name} · #{r.id}</td><td>{r.type === 'gto' ? 'GTO' : '常规赛'} · {r.starts_at.replace('T', ' ').slice(0,16)}</td><td>{r.enrolled_count} / {r.capacity}</td><td>{labels[r.status]}</td><td><a className="link" href={`/sessions/${r.id}`}>参赛名单 / 记分</a></td></tr>)}
        {!rows.length && <tr><td colSpan={5} className="empty">当日暂无场次</td></tr>}
      </tbody></table></div>
    </section>
    </>}
    {sessionId && <div className="card-heading"><a className="link" href={`/?tab=sessions&day=${detail?.starts_at.slice(0,10) || day}`}>← 返回场次列表</a><span>场次 #{sessionId} · 参赛名单与记分</span></div>}
    {sessionId && !detail && !error && <section className="card"><p>正在加载参赛名单…</p></section>}
    {detail && <section className="card"><div className="card-heading"><h2>{detail.name} · {labels[detail.status]}</h2><button className="link" disabled={busy} onClick={() => load().catch(e => setError(e.message))}>刷新名单</button></div>
      <div className="table-wrap"><table><thead><tr><th>玩家 / 会员 ID</th><th>报名时间</th><th>状态</th><th>到场确认</th></tr></thead><tbody>
        {detail.roster.map((r: Row) => <tr key={r.user_id}><td>{r.nickname}<small>{r.member_code}</small></td><td>{r.joined_at.replace('T',' ').slice(0,16)}</td><td>{labels[r.status]}</td><td>{['open','running'].includes(detail.status) && r.status !== 'withdrawn' && <button className="link" disabled={busy} onClick={() => mutate(`/sessions/${detail.id}/participants/${r.user_id}/check-in`, { checked_in: r.status !== 'checked_in' }, '到场状态已更新')}>{r.status === 'checked_in' ? '取消到场' : '确认到场'}</button>}</td></tr>)}
        {!detail.roster.length && <tr><td colSpan={4} className="empty">还没有玩家加入</td></tr>}
      </tbody></table></div>
      <div className="form-footer"><p>已到场 {checked.length} 人。开赛后用户不能加入或退出，可继续确认已报名玩家到场。</p>
        {detail.status === 'open' && <button disabled={busy} onClick={() => { if(window.confirm('开始比赛并关闭报名？')) mutate(`/sessions/${detail.id}/status`, { status: 'running' }, '比赛已开始，报名已关闭'); }}>开始比赛</button>}
        {['open','running'].includes(detail.status) && <button className="button-ghost" disabled={busy} onClick={() => { if(window.confirm('确认取消本场比赛？此操作不能恢复。')) mutate(`/sessions/${detail.id}/status`, { status: 'cancelled' }, '场次已取消'); }}>取消场次</button>}
      </div>
      {detail.status === 'running' && <form key={detail.id} className="form-grid" onChange={e => { const form = e.currentTarget; delete form.dataset.requestId; }} onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget; const f = Object.fromEntries(new FormData(form));
        const requestId = form.dataset.requestId || crypto.randomUUID(); form.dataset.requestId = requestId;
        if(!window.confirm('确认比赛结果并发放积分、奖励？提交后本场将结束。')) return;
        await mutate('/competitions', { ...f, session_id: detail.id, type: detail.type, date: detail.starts_at.slice(0,10), request_id: requestId, champion: Number(f.champion), second: Number(f.second), third: Number(f.third), pool27: f.pool27 ? Number(f.pool27) : null }, '比赛已结束，积分与奖励已发放');
      }}>
        {([['champion','冠军'],['second','亚军'],['third','季军'],['pool27','27收池']] as const).map(([name,label]) => <label key={name}>{label}{name !== 'pool27' && <b className="required"> *</b>}<select name={name} required={name !== 'pool27'} defaultValue=""><option value="">选择本场已到场玩家</option>{checked.map((r: Row) => <option key={r.user_id} value={r.user_id}>{r.nickname} · {r.member_code}</option>)}</select></label>)}
        {detail.type === 'gto' && <label>GTO 冠军奖励<select name="champion_reward"><option value="tickets">{awardLabel(prizeConfig,"gto_champion_tickets","冠军方案 A")}</option><option value="gift">{awardLabel(prizeConfig,"gto_champion_gift","冠军方案 B")}</option></select></label>}
        <div className="form-footer"><p>常规赛：5 / 3 / 1 分；GTO：10 / 6 / 2 分。至少3位已到场玩家才能记分。</p><button disabled={busy || checked.length < 3}>确认结果并结束比赛</button></div>
      </form>}
      {detail.status === 'finished' && <p className="note">已关联赛事 #{detail.competition_id}，可在“赛事记分”的最近赛事查看发放明细。</p>}
    </section>}
  </>;
}
