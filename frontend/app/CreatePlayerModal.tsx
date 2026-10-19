"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

export default function CreatePlayerModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (nickname: string) => Promise<void>;
}) {
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const value = nickname.trim();
    if (!value) { setError("请填写玩家昵称"); input.current?.focus(); return; }
    submitting.current = true;
    setPending(true);
    setError("");
    try { await onCreate(value); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "创建失败，请稍后重试"); }
    finally { submitting.current = false; setPending(false); }
  }

  return <div className="modal-backdrop" onClick={(e) => {
    if (e.target === e.currentTarget && !pending) onClose();
  }}>
    <section ref={dialog} className="modal player-modal" role="dialog" aria-modal="true" aria-labelledby="create-player-title" onKeyDown={(e) => {
      if (e.key === "Escape") { e.stopPropagation(); if (!pending) onClose(); }
      if (e.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
        if (!controls?.length) { e.preventDefault(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}>
      <div className="card-heading"><h2 id="create-player-title">新增玩家</h2><button type="button" className="link" disabled={pending} onClick={onClose}>关闭</button></div>
      <form onSubmit={submit} noValidate aria-busy={pending}>
        <label htmlFor="new-player-nickname">玩家昵称</label>
        <input ref={input} id="new-player-nickname" value={nickname} maxLength={80} placeholder="请输入玩家昵称" disabled={pending} aria-invalid={Boolean(error)} aria-describedby={error ? "create-player-error" : undefined} onChange={(e) => { setNickname(e.target.value); setError(""); }}/>
        {error && <div id="create-player-error" className="error" role="alert">{error}</div>}
        <div className="player-modal-actions"><button type="button" className="secondary" disabled={pending} onClick={onClose}>取消</button><button type="submit" disabled={pending}>{pending ? "正在创建…" : "确认创建"}</button></div>
      </form>
    </section>
  </div>;
}
