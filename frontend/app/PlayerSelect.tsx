"use client";

import {useEffect, useId, useRef, useState} from "react";

type Player = {id: number; nickname: string; member_code: string};

export default function PlayerSelect({name, label, players, required = true}: {
  name: string; label: string; players: Player[]; required?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = players.find(player => String(player.id) === value);
  const normalize = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase();
  const keyword = selected ? "" : normalize(query);
  const matches = players.filter(player =>
    normalize(`${player.nickname} ${player.member_code}`).includes(keyword));
  const listId = id + "-players";
  function choose(player: Player) {
    setValue(String(player.id));
    setQuery(`${player.nickname} · ${player.member_code}`);
    setOpen(false);
  }

  useEffect(() => {
    input.current?.setCustomValidity(query && !selected ? "请从搜索结果中选择玩家" : "");
  }, [query, selected]);

  useEffect(() => {
    const form = input.current?.form;
    const reset = () => {setQuery(""); setValue(""); setOpen(false); setActive(0);};
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);

  return <div className="player-select" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <label htmlFor={id}>{label}{required && <b className="required"> *</b>}</label>
    <input type="hidden" name={name} value={selected ? value : ""} />
    <div className="player-search">
      <input ref={input} id={id} role="combobox" placeholder="输入昵称 / 会员 ID，点击结果选择"
        required={required} autoComplete="off" value={query}
        aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        onFocus={() => {setOpen(true); setActive(0);}}
        onInvalid={() => setOpen(true)}
        onChange={event => {setQuery(event.target.value); setValue(""); setActive(0); setOpen(true);}}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            const next = !open ? 0 : Math.max(0, Math.min(matches.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)));
            setActive(next);
            input.current?.form?.querySelector(`[id="${listId}-${matches[next]?.id}"]`)?.scrollIntoView?.({block: "nearest"});
          } else if (event.key === "Enter" && open) {
            event.preventDefault(); if (matches[active]) choose(matches[active]);
          } else if (event.key === "Escape") {event.preventDefault(); setOpen(false);}
        }} />
      {open && <div className="player-options" id={listId} role="listbox" aria-label={`${label}玩家`}>
        {matches.map((player, index) => <button type="button" role="option" tabIndex={-1}
          id={`${listId}-${player.id}`} key={player.id} aria-selected={String(player.id) === value}
          className={index === active ? "active" : ""} onClick={() => choose(player)}>
          <span>{player.nickname}</span><small>{player.member_code}</small>
        </button>)}
        {!matches.length && <div className="player-no-results" role="status">未找到匹配玩家，请更换昵称或会员 ID</div>}
      </div>}
    </div>
  </div>;
}
