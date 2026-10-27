"use client";

import {useEffect, useId, useRef, useState} from "react";

type Player = {id: number; nickname: string; member_code: string};

export default function PlayerSelect({name, label, players, required = true}: {
  name: string; label: string; players: Player[]; required?: boolean;
}) {
  const id = useId();
  const select = useRef<HTMLSelectElement>(null);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const keyword = query.trim().toLocaleLowerCase();
  const matches = players.filter(player =>
    `${player.nickname} ${player.member_code}`.toLocaleLowerCase().includes(keyword));
  const matchingIds = new Set(matches.map(player => player.id));
  // Keep the selected player available when changing the search text.
  const options = players.filter(player =>
    String(player.id) === value || matchingIds.has(player.id));

  useEffect(() => {
    const form = select.current?.form;
    const reset = () => {setQuery(""); setValue("");};
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);

  return <div className="player-select">
    <label htmlFor={id}>{label}{required && <b className="required"> *</b>}</label>
    <input aria-label={`搜索${label}玩家`} placeholder="搜索昵称 / 会员 ID"
      type="search" autoComplete="off" value={query}
      onChange={event => setQuery(event.target.value)} />
    <select ref={select} id={id} name={name} required={required} value={value}
      onChange={event => setValue(event.target.value)}>
      <option value="">选择玩家</option>
      {options.map(player => <option key={player.id} value={player.id}>
        {player.nickname} · {player.member_code}
      </option>)}
    </select>
    {keyword && matches.length === 0 && <small role="status">未找到匹配玩家，请更换昵称或会员 ID</small>}
  </div>;
}
