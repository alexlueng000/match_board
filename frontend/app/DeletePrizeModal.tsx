"use client";
import {FormEvent, useEffect, useRef, useState} from "react";

export default function DeletePrizeModal({name, onClose, onDelete}: {
  name: string; onClose: () => void; onDelete: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; cancel.current?.focus();
    return () => {document.body.style.overflow = overflow; previous?.focus();};
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting.current) return;
    if (!reason.trim()) {setError("请填写删除原因"); return;}
    submitting.current = true; setPending(true); setError("");
    try {await onDelete(reason.trim());}
    catch (e) {setError(e instanceof Error ? e.message : "删除失败，请重试");}
    finally {submitting.current = false; setPending(false);}
  }
  return <div className="modal-backdrop" onClick={e => {if (e.target === e.currentTarget && !pending) onClose();}}>
    <section ref={dialog} className="modal player-modal" role="dialog" aria-modal="true" aria-label="删除奖品" onKeyDown={e => {
      if (e.key === "Escape" && !pending) onClose();
      if (e.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)");
        if (!controls?.length) {e.preventDefault(); return;}
        if (e.shiftKey && document.activeElement === controls[0]) {e.preventDefault(); controls[controls.length - 1].focus();}
        else if (!e.shiftKey && document.activeElement === controls[controls.length - 1]) {e.preventDefault(); controls[0].focus();}
      }
    }}>
      <div className="card-heading"><h2>删除奖品</h2></div>
      <p>确认删除“{name || "未命名奖品"}”？</p>
      <p className="muted">删除后不再发放或兑换，已发奖励和库存流水仍保留。比赛规则仍在使用的奖品需先替换或停止发放。</p>
      <form onSubmit={submit} noValidate>
        <label>删除原因<input value={reason} maxLength={480} disabled={pending} onChange={e => setReason(e.target.value)} placeholder="例如：重复添加、奖品不再提供"/></label>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="player-modal-actions"><button ref={cancel} type="button" className="secondary" disabled={pending} onClick={onClose}>取消</button><button className="danger" disabled={pending}>{pending ? "正在删除…" : "确认删除"}</button></div>
      </form>
    </section>
  </div>;
}
