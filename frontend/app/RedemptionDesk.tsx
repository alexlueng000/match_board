"use client";
import { useEffect, useRef, useState } from "react";

type Row = Record<string, any>;
export default function RedemptionDesk({ api, onSaved }: {
  api: (path: string, body?: Row) => Promise<any>;
  onSaved: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<Row[]>([]);
  const [player, setPlayer] = useState<Row | null>(null);
  const [rewards, setRewards] = useState<Row[]>([]);
  const [ids, setIds] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const submitting = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirming) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelButton.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, [confirming]);
  useEffect(() => {
    let active = true;
    setPlayers([]);
    if (!query.trim()) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      api("/users?q=" + encodeURIComponent(query.trim())).then(rows => { if (active) setPlayers(rows); })
        .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [api, query]);
  useEffect(() => {
    const current = ++sequence.current;
    setRewards([]); setIds([]); setConfirming(false); setError("");
    if (!player) return;
    setLoading(true);
    api(`/rewards?status=pending&user_id=${player.id}`).then(rows => {
      if (current === sequence.current) setRewards(rows);
    }).catch(e => { if (current === sequence.current) setError(e.message); })
      .finally(() => { if (current === sequence.current) setLoading(false); });
    return () => { sequence.current++; };
  }, [api, player]);
  async function redeem() {
    if (submitting.current || !player || !ids.length) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/rewards/redeem-batch", { user_id: player.id, reward_ids: ids });
      setConfirming(false); setIds([]);
      setNotice(`${player.nickname}：已核销 ${result.count} 份奖励`);
      setRewards(rows => rows.filter(r => !ids.includes(r.id)));
      try { setRewards(await api(`/rewards?status=pending&user_id=${player.id}`)); await onSaved(); }
      catch { setError("核销已完成，列表刷新失败，请重新选择玩家查看最新状态"); }
    } catch (e) { setError((e as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <>
    <section className="card redemption-desk">
      <div className="card-heading"><h2>按玩家核销</h2><span>查找玩家 → 勾选奖励 → 确认使用</span></div>
      <div className="redemption-content">
        <label htmlFor="redemption-player-search">昵称 / 会员 ID</label>
        <input id="redemption-player-search" placeholder="输入昵称或会员 ID，选择对应玩家" value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setPlayer(null); setNotice(""); setError(""); }}/>
        {!player && query.trim() && <div className="redemption-players">{players.map(p => <button type="button" className="redemption-player" key={p.id} disabled={busy} onClick={() => { setPlayer(p); setNotice(""); }}>
          {p.avatar_url && <img className="member-avatar" src={(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000") + p.avatar_url} alt=""/>}
          <strong>{p.nickname}</strong><span>会员 ID · {p.member_code}</span>
        </button>)}{!players.length && <p className="muted">{searching ? "正在查找…" : "未找到玩家，请检查昵称或会员 ID"}</p>}</div>}
        {player && <>
          <div className="redemption-selected"><strong>{player.nickname}</strong><span>会员 ID · {player.member_code}</span><button type="button" className="link" disabled={busy} onClick={() => setPlayer(null)}>重新选择</button><button type="button" className="link" disabled={busy || loading} onClick={() => setPlayer({...player})}>刷新奖励</button></div>
          <p className="muted">请先核对会员 ID，再选择本次实际使用的奖励。每张门票单独计算。</p>
          {loading ? <p>正在加载奖励…</p> : rewards.length ? <>
            <label className="redemption-reward"><input type="checkbox" checked={ids.length === Math.min(rewards.length, 100)} disabled={busy} onChange={e => setIds(e.target.checked ? rewards.slice(0, 100).map(r => r.id) : [])}/>{rewards.length > 100 ? "选择前 100 份奖励" : `全选待使用奖励（${rewards.length} 份）`}</label>
            {rewards.map(r => <label className="redemption-reward" key={r.id}><input type="checkbox" checked={ids.includes(r.id)} disabled={busy || (!ids.includes(r.id) && ids.length >= 100)} onChange={e => setIds(selected => e.target.checked ? [...selected, r.id] : selected.filter(id => id !== r.id))}/><strong>{r.reward_name}</strong><span>#{r.id} · {r.issued_at.replace("T", " ").slice(0, 16)}</span></label>)}
            <button type="button" disabled={busy || !ids.length} onClick={() => { setError(""); setConfirming(true); }}>核销选中 {ids.length} 份奖励</button>
          </> : <p className="empty">该玩家暂无待使用奖励</p>}
        </>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {error && !confirming && <div className="error" role="alert">{error}</div>}
      </div>
    </section>
    {confirming && player && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setConfirming(false); }}>
      <section ref={dialog} className="modal player-modal" role="dialog" aria-modal="true" aria-label="确认核销奖励" onKeyDown={e => {
        if (e.key === "Escape" && !busy) setConfirming(false);
        if (e.key === "Tab") {
          const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
          if (!buttons?.length) { e.preventDefault(); return; }
          if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons[buttons.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === buttons[buttons.length - 1]) { e.preventDefault(); buttons[0].focus(); }
        }
      }}>
        <div className="card-heading"><h2>确认核销奖励</h2></div>
        <p><strong>{player.nickname}</strong> · {player.member_code}</p>
        <ul>{rewards.filter(r => ids.includes(r.id)).map(r => <li key={r.id}>{r.reward_name} · #{r.id}</li>)}</ul>
        <p>共 {ids.length} 份，确认后将标记为已使用。</p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="player-modal-actions"><button ref={cancelButton} className="secondary" disabled={busy} onClick={() => setConfirming(false)}>取消</button><button disabled={busy} onClick={redeem}>{busy ? "正在核销…" : "确认使用"}</button></div>
      </section>
    </div>}
  </>;
}
