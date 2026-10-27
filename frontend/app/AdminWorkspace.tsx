"use client";
import MatchSessions from "./MatchSessions";
import CreatePlayerModal from "./CreatePlayerModal";
import PlayerSelect from "./PlayerSelect";
import RedemptionDesk from "./RedemptionDesk";
import MemberAdminAccess from "./MemberAdminAccess";
import ManualRewardForm from "./ManualRewardForm";
import PrizeSettings, {awardLabel} from "./PrizeSettings";
import { useState, useEffect, useCallback, useRef, FormEvent } from "react";
import {
  LayoutDashboard,
  Users,
  Trophy,
  Gift,
  ScanLine,
  Settings,
  LogOut,
  ArrowUpRight,
  Plus,
  Search,
  Menu,
} from "lucide-react";
type Row = Record<string, any>;
const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const nav = [
  ["dashboard", "运营概览", LayoutDashboard],
  ["users", "玩家管理", Users],
  ["sessions", "比赛场次", Trophy],
  ["competitions", "赛事记分", Trophy],
  ["rankings", "积分排行榜", Trophy],
  ["rewards", "奖励管理", Gift],
  ["prizes", "奖品设置", Gift],
  ["redeem", "到店核销", ScanLine],
  ["settings", "月赛设置", Settings],
] as const;
const statuses: Row = {
  pending: "待核销",
  redeemed: "已核销",
  cancelled: "已撤销",
  expired: "已失效",
};
const sourceLabels:Row={regular_champion:"常规赛冠军",regular_second:"常规赛亚军",regular_third:"常规赛季军",gto_champion:"GTO冠军",gto_second:"GTO亚军",gto_third:"GTO季军",manual_adjust:"手动调整"};
const fmt = (v: any) => (v ? String(v).replace("T", " ").slice(0, 19) : "—");
export default function AdminWorkspace({ sessionId }: { sessionId?: number }) {
  const [token, setToken] = useState(""),
    [ready, setReady] = useState(false),
    [tab, setTab] = useState(sessionId ? "sessions" : "dashboard"),
    [data, setData] = useState<Row[]>([]),
    [players, setPlayers] = useState<Row[]>([]),
    [stats, setStats] = useState<Row>({}),
    [types, setTypes] = useState<Row>({}),
    [prizeConfig, setPrizeConfig] = useState<Row>({}),
    [month, setMonth] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [scope, setScope] = useState("monthly"),
    [status, setStatus] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [mobile, setMobile] = useState(false),
    [eventDetail, setEventDetail] = useState<Row | null>(null),
    [rewardDetail, setRewardDetail] = useState<Row | null>(null),
    [eventType, setEventType] = useState("regular");
  const loadSequence = useRef(0);
  const adjustmentSubmitting = useRef(false);
  const [creatingPlayer, setCreatingPlayer] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState("");
  useEffect(() => {
    setToken(sessionStorage.getItem("nuts_token") || "");
    if (!sessionId) {
      const requested = new URLSearchParams(window.location.search).get("tab");
      if (nav.some(([id]) => id === requested)) setTab(requested!);
    }
    setReady(true);
  }, []);
  const api = useCallback(
    async (path: string, body?: Row) => {
      const r = await fetch(apiBase + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await r.json();
      if (!r.ok) {
        if (r.status === 401) {
          sessionStorage.removeItem("nuts_token");
          setToken("");
        }
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : "请检查必填项与输入格式",
        );
      }
      return result;
    },
    [token],
  );
  const load = useCallback(async () => {
    if (!token) return;
    const sequence = ++loadSequence.current;
    setError("");
    try {
      const path =
        tab === "users"
          ? "/users?q=" + encodeURIComponent(query)
          : tab === "competitions"
            ? "/competitions"
            : tab === "rankings"
              ? "/rankings?scope=" + scope
              : tab === "rewards"
                ? "/rewards?status=" + status
                : null;
      const [s, u, t, rows, prizes] = await Promise.all([
        api("/dashboard"),
        api("/users"),
        api("/reward-types"),
        path ? api(path) : Promise.resolve([]),
        api("/prize-settings"),
      ]);
      if (sequence !== loadSequence.current) return;
      setStats(s);
      setPlayers(u);
      setTypes(t);
      setPrizeConfig(prizes);
      setMonth(s.current_month);
      setData(rows);
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    }
  }, [token, tab, query, scope, status, api]);
  useEffect(() => {
    setData([]);
    const id = setTimeout(load, 200);
    return () => {
      clearTimeout(id);
      loadSequence.current++;
    };
  }, [load]);
  async function action(path: string, body: Row, msg: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, body);
      setNotice(msg);
      await load();
      if (detail) setDetail(await api("/users/" + detail.user.id));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch(apiBase + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(f)),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.detail);
      sessionStorage.setItem("nuts_token", d.access_token);
      setToken(d.access_token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selectPlayer = (name: string, label: string, required = true) => (
    <PlayerSelect name={name} label={label} required={required} players={players as {id:number; nickname:string; member_code:string}[]} />
  );
  const rewardTable = (rows: Row[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>玩家 / 会员 ID</th>
            <th>奖励</th>
            <th>状态</th>
            <th>获得时间</th>
            <th>核销时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.nickname || detail?.user.nickname}
                <small>{r.member_code || detail?.user.member_code}</small>
              </td>
              <td>
                <button className="link" onClick={()=>setRewardDetail(r)}>{r.reward_name}</button>
                <small>{r.redeem_code}</small>
              </td>
              <td>
                <span className={"badge " + r.status}>
                  {statuses[r.status]}
                </span>
              </td>
              <td>{fmt(r.issued_at)}</td>
              <td>{fmt(r.redeemed_at)}</td>
              <td>
                {r.status === "pending" && (
                  <>
                    <button
                      className="link"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            `确认核销 ${r.nickname || detail?.user.nickname} 的「${r.reward_name}」？`,
                          )
                        )
                          action(
                            "/rewards/" + r.id + "/redeem",
                            {},
                            "核销成功",
                          );
                      }}
                    >
                      核销
                    </button>
                    <button
                      className="link muted"
                      disabled={busy}
                      onClick={() => {
                        const reason = prompt("填写撤销原因");
                        if (reason)
                          action(
                            "/rewards/" + r.id + "/cancel",
                            { reason },
                            "奖励已撤销",
                          );
                      }}
                    >
                      撤销
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="empty">暂无奖励记录</div>}
    </div>
  );
  if (!ready) return <div className="loading">加载管理后台…</div>;
  if (!token)
    return (
      <main className="login">
        <div className="login-brand">
          <span className="logo">
            27<span>NUTS.</span>
          </span>
          <h1>
            让每一次竞技
            <br />
            都有所收获。
          </h1>
          <p>智力竞技馆 · 赛事运营管理平台</p>
        </div>
        <form onSubmit={login} className="login-card">
          <div className="eyebrow">ADMIN PORTAL</div>
          <h2>欢迎回来</h2>
          <p>登录后管理赛事、积分与玩家奖励</p>
          <label>
            管理员账号
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>
            {busy ? "登录中…" : "登录管理后台"} <ArrowUpRight size={16} />
          </button>
        </form>
      </main>
    );
  return (
    <div className="shell">
      <aside className={mobile ? "open" : ""}>
        <div className="logo">
          27<span>NUTS.</span>
        </div>
        <div className="sidebar-sub">智力竞技馆 · 管理后台</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                if (sessionId) { window.location.assign("/?tab=" + id); return; }
                setTab(id);
                setQuery("");
                setStatus("");
                setDetail(null);
                setNotice("");
                setMobile(false);
              }}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className="online" /> 门店运营工作台
          </div>
          <button
            onClick={() => {
              sessionStorage.removeItem("nuts_token");
              setToken("");
            }}
          >
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>
      <main className="main">
        <header>
          <button className="menu" onClick={() => setMobile(!mobile)}>
            <Menu />
          </button>
          <div>
            WORKSPACE <span>/ {nav.find((n) => n[0] === tab)?.[1]}</span>
          </div>
          <div className="admin-avatar">A</div>
        </header>
        <section className="content">
          <div className="page-title">
            <div>
              <div className="eyebrow">27NUTS · OPERATIONS</div>
              <h1>{nav.find((n) => n[0] === tab)?.[1]}</h1>
              <p>
                {tab === "dashboard"
                  ? "掌握门店赛事动态，让每一场比赛有序进行。"
                  : "记录清晰，操作可追溯。"}
              </p>
            </div>
            <span className="month-chip">{stats.current_month} 月赛</span>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="success">
              {notice}
            </div>
          )}
          {tab === "dashboard" && (
            <>
              <div className="metrics">
                {[
                  ["注册玩家", stats.users, "位"],
                  ["本月赛事", stats.competitions, "场"],
                  ["本月发放积分", stats.month_points, "分"],
                  ["待核销奖励", stats.pending_rewards, "份"],
                ].map(([label, value, unit]) => (
                  <div className="metric" key={label}>
                    <span>{label}</span>
                    <strong>
                      {value ?? "—"}
                      <small>{unit}</small>
                    </strong>
                    <div className="metric-line" />
                  </div>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="card">
                  <div className="card-heading">
                    <h2>快速操作</h2>
                    <span>日常运营</span>
                  </div>
                  <div className="quick-actions">
                    {[
                      [
                        "competitions",
                        "记录比赛结果",
                        "自动发放积分与奖励",
                        Trophy,
                      ],
                      [
                        "redeem",
                        "核销玩家奖励",
                        "查询凭证并确认使用",
                        ScanLine,
                      ],
                      ["users", "管理玩家", "查看积分流水与奖励", Users],
                    ].map(([id, title, desc, Icon]: any) => (
                      <button key={id} onClick={() => setTab(id)}>
                        <Icon size={24} />
                        <div>
                          <strong>{title}</strong>
                          <small>{desc}</small>
                        </div>
                        <ArrowUpRight size={18} />
                      </button>
                    ))}
                  </div>
                </section>
                <section className="card">
                  <div className="card-heading">
                    <h2>本月运营</h2>
                    <span>{stats.current_month}</span>
                  </div>
                  <div className="summary-row">
                    <span>本月获奖人数</span>
                    <strong>{stats.month_winners ?? 0} 位</strong>
                  </div>
                  <div className="summary-row">
                    <span>今日已核销</span>
                    <strong>{stats.today_redeemed ?? 0} 份</strong>
                  </div>
                  <div className="note">
                    赛事结果提交后，积分与奖励同时发放。跨月补录按比赛日期归属，历史流水保留。
                  </div>
                </section>
              </div>
              <section className="card">
                <div className="card-heading">
                  <h2>月赛积分预览</h2>
                  <button className="link" onClick={() => setTab("rankings")}>
                    完整榜单 ↗
                  </button>
                </div>
                {players
                  .slice()
                  .sort((a, b) => a.monthly_rank - b.monthly_rank)
                  .slice(0, 5)
                  .map((p) => (
                    <div className="rank-row" key={p.id}>
                      <span className="rank-number">
                        {p.monthly_rank.toString().padStart(2, "0")}
                      </span>
                      <div className="avatar">{p.nickname.slice(0, 1)}</div>
                      <div>
                        <strong>{p.nickname}</strong>
                        <small>{p.member_code}</small>
                      </div>
                      <strong className="rank-score">
                        {p.monthly_score} <small>分</small>
                      </strong>
                    </div>
                  ))}
                {!players.length && (
                  <div className="empty">创建玩家后开始记录赛事</div>
                )}
              </section>
            </>
          )}
          {tab === "users" && (
            <>
              <div className="toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    placeholder="搜索昵称或会员 ID"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => {
                    setCreatingPlayer(true);
                  }}
                >
                  <Plus size={16} />
                  新增玩家
                </button>
              </div>
              <section className="card">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>玩家</th>
                        <th>会员 ID</th>
                        <th>本月积分</th>
                        <th>总积分</th>
                        <th>本月排名</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((p) => (
                        <tr key={p.id}>
                          <td><span className="member-profile">{p.avatar_url && <img className="member-avatar" src={apiBase + p.avatar_url} alt="" />}{p.nickname}</span></td>
                          <td>{p.member_code}</td>
                          <td>{p.monthly_score}</td>
                          <td>{p.total_score}</td>
                          <td>#{p.monthly_rank}</td>
                          <td>
                            <button
                              className="link"
                              onClick={async () => {
                                try {
                                  setDetail(await api("/users/" + p.id));
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              查看详情
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.length && <div className="empty">未找到玩家</div>}
                </div>
              </section>
            </>
          )}
          {tab === "prizes" && <PrizeSettings api={api} onSaved={load} />}
          {tab === "sessions" && <MatchSessions api={api} onSaved={load} sessionId={sessionId} prizeConfig={prizeConfig} />}
          {tab === "competitions" && (
            <>
              <section className="card">
                <div className="card-heading">
                  <h2>独立赛事 / 历史补录</h2>
                  <span>积分与奖励一次发放</span>
                </div>
                <form
                  className="form-grid"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = Object.fromEntries(new FormData(form));
                    const body = {
                      ...f,
                      request_id: form.dataset.requestId || crypto.randomUUID(),
                      champion: Number(f.champion),
                      second: Number(f.second),
                      third: Number(f.third),
                      pool27: f.pool27 ? Number(f.pool27) : null,
                    };
                    form.dataset.requestId = body.request_id;
                    if (
                      await action(
                        "/competitions",
                        body,
                        "比赛结果已记录，积分与奖励已发放",
                      )
                    ) {
                      form.reset();
                      setEventType("regular");
                      delete form.dataset.requestId;
                    }
                  }}
                >
                  <label>
                    赛事类型 <b className="required">*</b>
                    <select
                      name="type"
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                    >
                      <option value="regular">常规赛</option>
                      <option value="gto">GTO 赛事</option>
                    </select>
                  </label>
                  <label>
                    比赛日期 <b className="required">*</b>
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={new Date().toLocaleDateString("en-CA", {
                        timeZone: "Asia/Shanghai",
                      })}
                    />
                  </label>
                  {selectPlayer("champion", "冠军")}
                  {selectPlayer("second", "亚军")}
                  {selectPlayer("third", "季军")}
                  {selectPlayer("pool27", "27收池", false)}
                  {eventType === "gto" && (
                    <label>
                      GTO 冠军奖励
                      <select name="champion_reward">
                        <option value="tickets">
                          {awardLabel(prizeConfig,"gto_champion_tickets","冠军方案 A")}
                        </option>
                        <option value="gift">{awardLabel(prizeConfig,"gto_champion_gift","冠军方案 B")}</option>
                      </select>
                    </label>
                  )}
                  <div className="form-footer">
                    <p>
                      已创建场次的比赛请从“比赛场次”记分，避免重复录入。常规赛：5 / 3 / 1 分；GTO：10 / 6 / 2 分。
                    </p>
                    <button disabled={busy}>
                      {busy ? "发放中…" : "确认发放"}
                    </button>
                  </div>
                </form>
              </section>
              <section className="card">
                <div className="card-heading">
                  <h2>最近赛事</h2>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>赛事编号</th>
                        <th>赛事类型</th>
                        <th>比赛日期</th>
                        <th>积分月份</th>
                        <th>记录时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((c) => (
                        <tr key={c.id}>
                          <td>#{c.id}</td>
                          <td>{c.type === "gto" ? "GTO赛事" : "常规赛"}</td>
                          <td>{c.date}</td>
                          <td>{c.month_key}</td>
                          <td>{fmt(c.created_at)}</td>
                          <td>
                            <button
                              className="link"
                              onClick={async () => {
                                try {
                                  setEventDetail(
                                    await api(`/competitions/${c.id}`),
                                  );
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              查看结果
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.length && <div className="empty">暂无赛事</div>}
                </div>
              </section>
            </>
          )}
          {tab === "rankings" && (
            <>
              <div className="toolbar">
                <div className="segmented">
                  <button
                    className={scope === "monthly" ? "selected" : ""}
                    onClick={() => setScope("monthly")}
                  >
                    月赛榜
                  </button>
                  <button
                    className={scope === "total" ? "selected" : ""}
                    onClick={() => setScope("total")}
                  >
                    总榜
                  </button>
                </div>
                <span className="muted">
                  月榜同分按最后获分时间排序；总榜同分按玩家编号排序
                </span>
              </div>
              <section className="card">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>排名</th>
                        <th>玩家</th>
                        <th>会员 ID</th>
                        <th>积分</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <span className="rank-number">
                              #
                              {
                                p[
                                  scope === "monthly"
                                    ? "monthly_rank"
                                    : "total_rank"
                                ]
                              }
                            </span>
                          </td>
                          <td>{p.nickname}</td>
                          <td>{p.member_code}</td>
                          <td>
                            {
                              p[
                                scope === "monthly"
                                  ? "monthly_score"
                                  : "total_score"
                              ]
                            }
                          </td>
                          <td><button className="link" onClick={async () => {
                            try { setAdjustmentError(""); setDetail(await api("/users/" + p.id)); }
                            catch (e) { setError((e as Error).message); }
                          }}>调整积分</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.length && <div className="empty">暂无排名数据</div>}
                </div>
              </section>
            </>
          )}
          {tab === "rewards" && (
            <>
              <div className="toolbar">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">全部状态</option>
                  {Object.entries(statuses).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <section className="card">{rewardTable(data)}</section>
              <section className="card">
                <div className="card-heading">
                  <h2>手动补发奖励</h2>
                </div>
                <form
                  className="form-grid"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = Object.fromEntries(new FormData(e.currentTarget));
                    await action(
                      "/rewards",
                      { ...f, user_id: Number(f.user_id), quantity: Number(f.quantity) },
                      "奖励已补发",
                    );
                  }}
                >
                  {selectPlayer("user_id", "玩家")}
                  <label>
                    奖励类型
                    <select name="reward_type">
                      {Object.entries(types).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>补发份数 <input name="quantity" type="number" required min={1} max={20} defaultValue={1} /></label>
                  <label className="wide">
                    补发原因 <b className="required">*</b>
                    <input name="reason" required maxLength={500} />
                  </label>
                  <div className="form-footer">
                    <button disabled={busy}>确认补发</button>
                  </div>
                </form>
              </section>
            </>
          )}
          {tab === "redeem" && <RedemptionDesk api={api} onSaved={load}/>}
          {tab === "settings" && (
            <section className="card">
              <div className="card-heading">
                <h2>当前月赛</h2>
                <span>历史积分始终保留</span>
              </div>
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (confirm(`切换到 ${month} 月赛？历史流水不会删除。`))
                    action("/settings/month", { month }, "当前月赛已切换");
                }}
              >
                <label>
                  赛事月份{" "}
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    required
                  />
                </label>
                <div className="form-footer">
                  <p>切换月份仅改变默认榜单。比赛积分根据比赛日期归属。</p>
                  <button disabled={busy}>切换月赛</button>
                </div>
              </form>
              <div className="note">
                V1
                奖励无自动到期；管理员可撤销待核销奖励。积分修正必须填写原因。
              </div>
            </section>
          )}
          {creatingPlayer && <CreatePlayerModal onClose={() => setCreatingPlayer(false)} onCreate={async (nickname) => {
            await api("/users", { nickname });
            setNotice("玩家已创建");
            await load();
          }} />}
          {eventDetail && (
            <div className="modal-backdrop">
              <section className="modal">
                <div className="card-heading">
                  <h2>
                    赛事 #{eventDetail.competition.id} ·{" "}
                    {eventDetail.competition.date}
                  </h2>
                  <button className="link" onClick={() => setEventDetail(null)}>
                    关闭
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>名次</th>
                        <th>玩家</th>
                        <th>会员 ID</th>
                        <th>积分</th>
                        <th>冠军奖励选择</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eventDetail.results.map((r: Row) => (
                        <tr key={r.result_type}>
                          <td>
                            {
                              {
                                champion: "冠军",
                                second: "亚军",
                                third: "季军",
                                pool27: "27收池",
                              }[r.result_type as "champion"]
                            }
                          </td>
                          <td>{r.nickname}</td>
                          <td>{r.member_code}</td>
                          <td>{r.points}</td>
                          <td>
                            {r.reward_choice === "gift"
                              ? "礼品"
                              : r.reward_choice === "tickets"
                                ? "门票 × 2"
                                : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
          {rewardDetail && <div className="modal-backdrop reward-modal"><section className="modal" role="dialog" aria-modal="true" aria-label="奖励详情"><div className="card-heading"><h2>奖励详情 · #{rewardDetail.id}</h2><button className="link" onClick={()=>setRewardDetail(null)}>关闭</button></div><div className="summary-row"><span>玩家</span><strong>{rewardDetail.nickname||detail?.user.nickname} · {rewardDetail.member_code||detail?.user.member_code}</strong></div><div className="summary-row"><span>奖励</span><strong>{rewardDetail.reward_name}</strong></div><div className="summary-row"><span>状态</span><strong>{statuses[rewardDetail.status]}</strong></div><div className="summary-row"><span>来源赛事</span><strong>{rewardDetail.operated_by===null?'积分兑换':rewardDetail.competition_id?`#${rewardDetail.competition_id}`:'手动补发'}</strong></div><div className="summary-row"><span>获得时间</span><strong>{fmt(rewardDetail.issued_at)}</strong></div><div className="summary-row"><span>核销时间 / 管理员</span><strong>{fmt(rewardDetail.redeemed_at)} / {rewardDetail.redeemed_by?`#${rewardDetail.redeemed_by}`:'—'}</strong></div><div className="summary-row"><span>发放原因</span><strong>{rewardDetail.remark||'赛事自动发放'}</strong></div>{rewardDetail.status==='cancelled'&&<div className="note">撤销原因：{rewardDetail.cancellation_reason} · 管理员 #{rewardDetail.cancelled_by} · {fmt(rewardDetail.cancelled_at)}</div>}</section></div>}
          {detail && (
            <div className="modal-backdrop">
              <section className="modal" role="dialog" aria-modal="true" aria-label="玩家详情与积分调整">
                <div className="card-heading">
                  <h2 className="member-profile">{detail.user.avatar_url && <img className="member-avatar" src={apiBase + detail.user.avatar_url} alt="" />}{detail.user.nickname} · 玩家详情</h2>
                  <button className="link" onClick={() => setDetail(null)}>
                    关闭
                  </button>
                </div>
                <p>
                  {detail.user.member_code} · 本月 {detail.user.monthly_score}{" "}
                  分 · 累计 {detail.user.total_score} 分
                </p>
                <MemberAdminAccess key={detail.user.id} member={detail.user} disabled={busy} api={api} onSaved={async () => setDetail(await api("/users/" + detail.user.id))}/>
                <ManualRewardForm key={detail.user.id} types={types} disabled={busy} onIssue={async (body) => {
                  setBusy(true);
                  try {
                    await api("/rewards", { ...body, user_id: detail.user.id });
                    setDetail(null);
                    setNotice("奖励已发放");
                    await load();
                  } finally { setBusy(false); }
                }}/>
                <h3>积分调整</h3>
                <p className="muted">正数加分，负数扣分；调整会同时计入归属月份和累计总积分，并保留操作流水。</p>
                <form
                  className="form-grid"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = Object.fromEntries(new FormData(e.currentTarget));
                    const points = Number(f.points), reason = String(f.reason).trim();
                    if (adjustmentSubmitting.current || busy) return;
                    if (!Number.isInteger(points) || !points || Math.abs(points) > 10000 || !reason) {
                      setAdjustmentError("请填写非零整数积分和调整原因"); return;
                    }
                    adjustmentSubmitting.current = true;
                    setBusy(true); setAdjustmentError("");
                    try {
                      await api("/users/" + detail.user.id + "/points", { ...f, points, reason });
                      setDetail(null);
                      setNotice("积分已调整");
                      await load();
                    } catch (e) { setAdjustmentError((e as Error).message); }
                    finally { adjustmentSubmitting.current = false; setBusy(false); }
                  }}
                >
                  <label>
                    积分变动
                    <input
                      type="number"
                      name="points"
                      required
                      min={-10000}
                      max={10000}
                    />
                  </label>
                  <label>
                    归属月份
                    <input
                      type="month"
                      name="month"
                      defaultValue={month}
                      required
                    />
                  </label>
                  <label className="wide">
                    原因
                    <input name="reason" required maxLength={500} />
                  </label>
                  <div className="form-footer">
                    <button disabled={busy}>确认调整</button>
                  </div>
                  {adjustmentError && <div className="error wide" role="alert">{adjustmentError}</div>}
                </form>
                <h3>积分流水</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>月份</th>
                        <th>变动</th>
                        <th>变动后月积分 / 总积分</th>
                        <th>来源 / 原因</th>
                        <th>操作人</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.points.map((p: Row) => (
                        <tr key={p.id}>
                          <td>{p.month_key}</td>
                          <td>
                            {p.points_change > 0 ? "+" : ""}
                            {p.points_change}
                          </td>
                          <td>
                            {p.monthly_score_after} / {p.total_score_after}
                          </td>
                          <td>
                            {sourceLabels[p.source_type]||"其他积分变动"}
                            <small>{p.remark}</small>
                          </td>
                          <td>管理员 #{p.operator_id}</td>
                          <td>{fmt(p.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>奖励记录</h3>
                {!!detail.exchanges?.length && <><h3>积分兑换记录</h3><div className="table-wrap"><table><thead><tr><th>门票</th><th>消耗积分</th><th>时间</th><th>退款</th></tr></thead><tbody>{detail.exchanges.map((order: Row) => <tr key={order.id}><td>{order.reward_name}</td><td>{order.points}</td><td>{fmt(order.created_at)}</td><td>{order.refunded_at ? "已退回可用积分" : "—"}</td></tr>)}</tbody></table></div></>}
                {rewardTable(detail.rewards)}
              </section>
            </div>
          )}
          <footer>
            27NUTS. 智力竞技馆 <span>赛事 · 积分 · 荣誉</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
