"use client";

import { FormEvent, useRef, useState } from "react";

export default function ManualRewardForm({ types, disabled, onIssue }: {
  types: Record<string, string>;
  disabled: boolean;
  onIssue: (body: { reward_type: string; quantity: number; reason: string }) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || disabled) return;
    const values = new FormData(event.currentTarget);
    const reward_type = String(values.get("reward_type") || "");
    const quantity = Number(values.get("quantity"));
    const reason = String(values.get("reason") || "").trim();
    if (!types[reward_type] || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !reason) {
      setError("请选择奖励，填写 1–20 份发放数量及发放原因"); return;
    }
    submitting.current = true; setPending(true); setError("");
    try { await onIssue({ reward_type, quantity, reason }); }
    catch (e) { setError(e instanceof Error ? e.message : "发放失败，请稍后重试"); }
    finally { submitting.current = false; setPending(false); }
  }
  const locked = pending || disabled;
  return <>
    <h3>手动发放奖励</h3>
    <p className="muted">奖励发给当前玩家，不扣积分；发放时扣减可用库存，每份奖励独立使用。</p>
    <form className="form-grid" onSubmit={submit} aria-busy={pending}>
      <label>发放奖品<select name="reward_type" defaultValue="" required disabled={locked}><option value="" disabled>请选择奖品</option>{Object.entries(types).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label>发放份数<input name="quantity" type="number" min={1} max={20} step={1} required defaultValue={1} disabled={locked}/></label>
      <label className="wide">发放原因<input name="reason" required maxLength={500} placeholder="例如：活动奖励、历史补发" disabled={locked}/></label>
      {!Object.keys(types).length && <p className="note wide">暂无启用奖品，请先到“奖品设置”配置。</p>}
      {error && <div className="error wide" role="alert">{error}</div>}
      <div className="form-footer"><button disabled={locked || !Object.keys(types).length}>{pending ? "正在发放…" : "确认发放奖励"}</button></div>
    </form>
  </>;
}
