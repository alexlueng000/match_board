import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from contextlib import asynccontextmanager
import jwt
from pwdlib import PasswordHash
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select, func, update, case
from sqlalchemy.exc import IntegrityError
from .db import *

passwords = PasswordHash.recommended()
dummy_password_hash = passwords.hash(secrets.token_urlsafe(32))


@asynccontextmanager
async def lifespan(app):
    if not 1 <= len(settings.admin_password) <= 256:
        raise RuntimeError("ADMIN_PASSWORD 须为1至256位")
    if len(settings.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET 至少32位")
    with Session.begin() as db:
        if not db.scalar(
            select(Admin).where(Admin.username == settings.admin_username)
        ):
            db.add(
                Admin(
                    username=settings.admin_username,
                    password_hash=passwords.hash(settings.admin_password),
                )
            )
        if not db.get(Config, "current_month"):
            db.add(
                Config(key="current_month", value=business_today().strftime("%Y-%m"))
            )
        from .prizes import initialize

        initialize(db)
    yield


app = FastAPI(title="27Nuts 管理 API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def session():
    with Session() as db:
        yield db


security = HTTPBearer()


def admin(auth: HTTPAuthorizationCredentials = Depends(security), db=Depends(session)):
    try:
        data = jwt.decode(
            auth.credentials,
            settings.jwt_secret,
            algorithms=["HS256"],
            options={"require": ["exp", "sub"]},
        )
        if data.get("kind") == "player":
            member = db.get(User, int(data["sub"]))
            if not member or not member.openid or not member.admin_id:
                raise ValueError()
            account = db.get(Admin, member.admin_id)
        else:
            account = db.get(Admin, int(data["sub"]))
            if data.get("kind", "admin") != "admin" or not account or data.get("ver") != account.token_version:
                raise ValueError()
        if not account:
            raise ValueError()
        return account
    except (jwt.PyJWTError, ValueError, TypeError, KeyError):
        raise HTTPException(401, "无管理员权限或登录已过期，请重新登录")


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


@app.post("/auth/login")
def login(body: Login, db=Depends(session)):
    account = db.scalar(
        select(Admin).where(Admin.username == body.username).with_for_update()
    )
    if account and account.locked_until and account.locked_until > now():
        raise HTTPException(429, "登录失败次数过多，请15分钟后重试")
    valid = passwords.verify(
        body.password, account.password_hash if account else dummy_password_hash
    )
    if not account or not valid:
        if account:
            account.failed_attempts += 1
            if account.failed_attempts >= 5:
                account.locked_until = now() + timedelta(minutes=15)
                account.failed_attempts = 0
            db.commit()
        raise HTTPException(401, "账号或密码错误")
    account.failed_attempts = 0
    account.locked_until = None
    db.commit()
    token = jwt.encode(
        {
            "sub": str(account.id),
            "ver": account.token_version,
            "exp": datetime.now(timezone.utc) + timedelta(hours=8),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    return {"access_token": token, "username": account.username}


@app.get("/health")
def health(db=Depends(session)):
    db.execute(select(1))
    return {"status": "ok"}


def current_month(db):
    return db.get(Config, "current_month").value


@app.get("/settings")
def get_settings(db=Depends(session), a=Depends(admin)):
    return {"current_month": current_month(db)}


class Month(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


@app.post("/settings/month")
def month(body: Month, db=Depends(session), a=Depends(admin)):
    db.get(Config, "current_month").value = body.month
    db.commit()
    return {"current_month": body.month}


def rankings(db, month=None):
    monthly = func.coalesce(
        func.sum(case((PointLog.month_key == month, PointLog.points_change), else_=0)),
        0,
    )
    total = func.coalesce(func.sum(PointLog.points_change), 0)
    rows = (
        db.execute(
            select(
                User.id,
                User.member_code,
                User.nickname,
                User.avatar_url,
                monthly.label("monthly_score"),
                total.label("total_score"),
            )
            .outerjoin(PointLog, PointLog.user_id == User.id)
            .group_by(User.id, User.member_code, User.nickname, User.avatar_url)
        )
        .mappings()
        .all()
    )
    result = [dict(r) for r in rows]
    earned = db.execute(
        select(PointLog.user_id, func.max(PointLog.created_at), func.max(PointLog.id))
        .where(PointLog.month_key == month, PointLog.points_change > 0)
        .group_by(PointLog.user_id)
    ).all()
    earned_at = {uid: (timestamp, log_id) for uid, timestamp, log_id in earned}
    result.sort(
        key=lambda r: (
            -r["monthly_score"],
            earned_at.get(r["id"], (datetime.max, float("inf"))),
            r["id"],
        )
    )
    for i, r in enumerate(result):
        r["monthly_rank"] = i + 1
    result.sort(key=lambda r: (-r["total_score"], r["id"]))
    for i, r in enumerate(result):
        r["total_rank"] = i + 1
    return result


@app.get("/users")
def users(q: str = "", db=Depends(session), a=Depends(admin)):
    return [
        r
        for r in rankings(db, current_month(db))
        if q.lower() in (r["nickname"] + " " + r["member_code"]).lower()
    ]


class NewUser(BaseModel):
    nickname: str = Field(min_length=1, max_length=80)


@app.post("/users")
def create_user(body: NewUser, db=Depends(session), a=Depends(admin)):
    if not body.nickname.strip():
        raise HTTPException(422, "昵称不能为空")
    user = User(
        nickname=body.nickname.strip(), member_code=secrets.token_hex(4).upper()
    )
    db.add(user)
    db.commit()
    return {"id": user.id, "member_code": user.member_code, "nickname": user.nickname}


def require_user(db, uid):
    if not db.get(User, uid):
        raise HTTPException(404, "用户不存在")


@app.get("/users/{uid}")
def detail(uid: int, db=Depends(session), a=Depends(admin)):
    require_user(db, uid)
    from .exchanges import wallet, history
    logs = db.scalars(
        select(PointLog).where(PointLog.user_id == uid).order_by(PointLog.id)
    ).all()
    monthly_balances = {}
    total_balance = 0
    records = []
    for log in logs:
        monthly_balances[log.month_key] = (
            monthly_balances.get(log.month_key, 0) + log.points_change
        )
        total_balance += log.points_change
        record = {
            column.name: getattr(log, column.name)
            for column in PointLog.__table__.columns
        }
        record["monthly_score_after"] = monthly_balances[log.month_key]
        record["total_score_after"] = total_balance
        records.append(record)
    return {
        "user": {**next(r for r in rankings(db, current_month(db)) if r["id"] == uid), **wallet(db, uid), "is_admin": bool(db.get(User, uid).admin_id), "has_wechat": bool(db.get(User, uid).openid)},
        "exchanges": history(db, uid),
        "points": records[::-1],
        "rewards": db.scalars(
            select(Reward).where(Reward.user_id == uid).order_by(Reward.id.desc())
        ).all(),
    }


class AdminAccessInput(BaseModel):
    enabled: bool


@app.post("/users/{uid}/admin")
def set_member_admin(uid: int, body: AdminAccessInput, db=Depends(session), a=Depends(admin)):
    member = db.scalar(select(User).where(User.id == uid).with_for_update())
    if not member:
        raise HTTPException(404, "用户不存在")
    if body.enabled and not member.openid:
        raise HTTPException(422, "该玩家尚未微信登录，无法授予微信管理员权限")
    if bool(member.admin_id) != body.enabled:
        if body.enabled:
            # Each grant has its own identity so historical operation records survive revocation.
            account = Admin(username="wx_" + secrets.token_hex(12), password_hash=passwords.hash(secrets.token_urlsafe(48)))
            db.add(account)
            db.flush()
            member.admin_id = account.id
        else:
            member.admin_id = None
        member.admin_granted_by = a.id
        member.admin_changed_at = now()
        db.commit()
    return {"is_admin": bool(member.admin_id)}


@app.get("/mini/staff/me")
def mini_staff_identity(a=Depends(admin)):
    return {"username": a.username}


class Adjustment(Month):
    points: int = Field(ge=-10000, le=10000)
    reason: str = Field(min_length=1, max_length=500)


@app.post("/users/{uid}/points")
def adjust(uid: int, body: Adjustment, db=Depends(session), a=Depends(admin)):
    from .exchanges import lock_member
    lock_member(db, uid)
    if not body.points or not body.reason.strip():
        raise HTTPException(422, "积分不能为0，原因不能为空")
    db.add(
        PointLog(
            user_id=uid,
            month_key=body.month,
            points_change=body.points,
            source_type="manual_adjust",
            remark=body.reason,
            operator_id=a.id,
        )
    )
    db.commit()
    return {"ok": True}


RULES = {
    "regular": {
        "champion": (5, "REGULAR_TICKET", "常规赛门票"),
        "second": (3, "REGULAR_50_OFF", "常规赛五折门票"),
        "third": (1, "REGULAR_70_OFF", "常规赛七折门票"),
        "pool27": (0, "REGULAR_50_OFF", "常规赛五折门票"),
    },
    "gto": {
        "champion": (10, "GTO_TICKET", "GTO赛事门票"),
        "second": (6, "GTO_TICKET", "GTO赛事门票"),
        "third": (2, "GTO_50_OFF", "GTO赛事五折门票"),
        "pool27": (0, "GTO_50_OFF", "GTO赛事五折门票"),
    },
}
REWARDS = {typ: name for rules in RULES.values() for _, typ, name in rules.values()} | {
    "GIFT": "GTO冠军礼品"
}


def issue(db, uid, typ, operator, competition=None, remark=""):
    from .prizes import reserve

    reserve(db, uid, typ, operator, competition, remark)


class CompetitionInput(BaseModel):
    request_id: str = Field(min_length=8, max_length=64)
    type: Literal["regular", "gto"]
    date: date
    champion: int
    second: int
    third: int
    pool27: int | None = None
    champion_reward: Literal["gift", "tickets"] | None = None
    session_id: int | None = None


@app.post("/competitions")
def competition(body: CompetitionInput, db=Depends(session), a=Depends(admin)):
    existing = db.scalar(
        select(Competition).where(Competition.request_id == body.request_id)
    )
    if existing:
        if (
            existing.request_payload
            != body.model_dump_json(
                exclude={"session_id"} if body.session_id is None else set()
            )
            or existing.created_by != a.id
        ):
            raise HTTPException(409, "提交标识已用于另一份赛事结果，请刷新后重新录入")
        return {"id": existing.id, "duplicate": True}
    if len({body.champion, body.second, body.third}) != 3:
        raise HTTPException(422, "前三名必须是不同玩家")
    if body.type == "gto" and not body.champion_reward:
        raise HTTPException(422, "请选择GTO冠军奖励")
    match = None
    if body.session_id is not None:
        match = db.scalar(
            select(MatchSession)
            .where(MatchSession.id == body.session_id)
            .with_for_update()
        )
        if not match:
            raise HTTPException(404, "场次不存在")
        # A request may have waited for another submission to finish. Use a
        # current locking read rather than the earlier MySQL snapshot.
        if match.competition_id is not None:
            saved = db.scalar(
                select(Competition)
                .where(Competition.id == match.competition_id)
                .with_for_update()
            )
            if (
                saved
                and saved.request_id == body.request_id
                and saved.created_by == a.id
                and saved.request_payload == body.model_dump_json()
            ):
                return {"id": saved.id, "duplicate": True}
        if match.status != "running" or match.competition_id is not None:
            raise HTTPException(409, "仅进行中的场次可以记分，已结束场次不能重复记分")
        if body.type != match.type or body.date != match.starts_at.date():
            raise HTTPException(422, "比赛类型和日期必须与场次一致")
        eligible = set(
            db.scalars(
                select(Enrollment.user_id)
                .where(
                    Enrollment.session_id == match.id, Enrollment.status == "checked_in"
                )
                .with_for_update()
            ).all()
        )
        if any(
            uid not in eligible
            for uid in [body.champion, body.second, body.third, body.pool27]
            if uid is not None
        ):
            raise HTTPException(422, "获奖玩家必须是本场已确认到场的参赛者")
    from .exchanges import lock_member
    for uid in sorted({uid for uid in [body.champion, body.second, body.third, body.pool27] if uid is not None}):
        lock_member(db, uid)
    c = Competition(
        request_id=body.request_id,
        request_payload=body.model_dump_json(
            exclude={"session_id"} if body.session_id is None else set()
        ),
        type=body.type,
        date=body.date,
        month_key=body.date.strftime("%Y-%m"),
        created_by=a.id,
    )
    db.add(c)
    try:
        db.flush()
        if match:
            match.competition_id = c.id
            match.status = "finished"
        from .prizes import award_rules

        configured = award_rules(db)
        for role in ["champion", "second", "third", "pool27"]:
            uid = getattr(body, role)
            if uid is None:
                continue
            points, typ, _ = RULES[body.type][role]
            db.add(
                Result(
                    competition_id=c.id,
                    user_id=uid,
                    result_type=role,
                    points=points,
                    reward_choice=(
                        body.champion_reward
                        if role == "champion" and body.type == "gto"
                        else None
                    ),
                )
            )
            if points:
                db.add(
                    PointLog(
                        user_id=uid,
                        competition_id=c.id,
                        month_key=c.month_key,
                        points_change=points,
                        source_type=f"{body.type}_{role}",
                        operator_id=a.id,
                    )
                )
            key = f"{body.type}_{role}"
            if body.type == "gto" and role == "champion":
                key += "_gift" if body.champion_reward == "gift" else "_tickets"
            rule = configured[key]
            typ, count = rule.prize_code, rule.quantity
            for _ in range(count):
                issue(db, uid, typ, a.id, c.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(Competition).where(Competition.request_id == body.request_id)
        )
        if existing:
            if (
                existing.request_payload
                != body.model_dump_json(
                    exclude={"session_id"} if body.session_id is None else set()
                )
                or existing.created_by != a.id
            ):
                raise HTTPException(409, "提交标识已用于另一份赛事结果")
            return {"id": existing.id, "duplicate": True}
        raise HTTPException(409, "记录冲突，请重试")
    return {"id": c.id, "duplicate": False}


@app.get("/competitions")
def competitions(db=Depends(session), a=Depends(admin)):
    return db.scalars(select(Competition).order_by(Competition.id.desc())).all()


@app.get("/rankings")
def ranking(
    scope: Literal["monthly", "total"] = "monthly",
    month: str | None = None,
    db=Depends(session),
    a=Depends(admin),
):
    return sorted(
        rankings(db, month or current_month(db)),
        key=lambda r: r["monthly_rank" if scope == "monthly" else "total_rank"],
    )


@app.get("/reward-types")
def reward_types(db=Depends(session), a=Depends(admin)):
    return {
        p.code: p.name
        for p in db.scalars(select(Prize).where(Prize.enabled == True, Prize.deleted == False)).all()
    }


@app.get("/rewards")
def rewards(status: str = "", code: str = "", user_id: int | None = None, db=Depends(session), a=Depends(admin)):
    stmt = select(Reward, User.nickname, User.member_code).join(
        User, User.id == Reward.user_id
    )
    if status:
        stmt = stmt.where(Reward.status == status)
    if code:
        stmt = stmt.where(Reward.redeem_code == code.upper())
    if user_id is not None:
        stmt = stmt.where(Reward.user_id == user_id)
    return [
        dict(
            **{c.name: getattr(r, c.name) for c in Reward.__table__.columns},
            nickname=n,
            member_code=m,
        )
        for r, n, m in db.execute(stmt.order_by(Reward.id.desc())).all()
    ]


class IssueInput(BaseModel):
    quantity: int = Field(default=1, ge=1, le=20)
    user_id: int
    reward_type: str
    reason: str = Field(min_length=1, max_length=500)


@app.post("/rewards")
def manual_reward(body: IssueInput, db=Depends(session), a=Depends(admin)):
    from .exchanges import lock_member
    lock_member(db, body.user_id)
    if not body.reason.strip():
        raise HTTPException(422, "奖励类型或原因无效")
    for _ in range(body.quantity):
        issue(db, body.user_id, body.reward_type, a.id, remark=body.reason)
    db.commit()
    return {"ok": True}


class Reason(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class BatchRedeem(BaseModel):
    user_id: int
    reward_ids: list[int] = Field(min_length=1, max_length=100)


@app.post("/rewards/redeem-batch")
def redeem_batch(body: BatchRedeem, db=Depends(session), a=Depends(admin)):
    if len(set(body.reward_ids)) != len(body.reward_ids):
        raise HTTPException(422, "请勿重复选择奖励")
    from .exchanges import lock_member
    lock_member(db, body.user_id)
    changed = db.execute(update(Reward).where(Reward.id.in_(body.reward_ids), Reward.user_id == body.user_id, Reward.status == "pending")
        .values(status="redeemed", redeemed_at=now(), redeemed_by=a.id)).rowcount
    if changed != len(body.reward_ids):
        db.rollback()
        raise HTTPException(409, "奖励归属或状态已变化，本次未核销，请刷新后重新选择")
    db.commit()
    return {"ok": True, "count": changed}


@app.post("/rewards/{rid}/redeem")
def redeem(rid: int, db=Depends(session), a=Depends(admin)):
    changed = db.execute(
        update(Reward)
        .where(Reward.id == rid, Reward.status == "pending")
        .values(status="redeemed", redeemed_at=now(), redeemed_by=a.id)
    ).rowcount
    if not changed:
        db.rollback()
        raise HTTPException(409, "奖励不存在或已核销/撤销")
    db.commit()
    return {"ok": True}


@app.post("/rewards/{rid}/cancel")
def cancel(rid: int, body: Reason, db=Depends(session), a=Depends(admin)):
    if not body.reason.strip():
        raise HTTPException(422, "请填写原因")
    reward_owner = db.scalar(select(Reward.user_id).where(Reward.id == rid))
    if reward_owner is None:
        raise HTTPException(404, "奖励不存在")
    from .exchanges import lock_member
    lock_member(db, reward_owner)
    changed = db.execute(
        update(Reward)
        .where(Reward.id == rid, Reward.status == "pending")
        .values(
            status="cancelled",
            cancelled_at=now(),
            cancelled_by=a.id,
            cancellation_reason=body.reason,
        )
    ).rowcount
    if not changed:
        db.rollback()
        raise HTTPException(409, "只能撤销待核销奖励")
    from .prizes import release

    reward = db.scalar(select(Reward).where(Reward.id == rid).with_for_update())
    release(db, reward, a.id)
    order = db.scalar(select(ExchangeOrder).where(ExchangeOrder.reward_id == rid).with_for_update())
    if order:
        order.refunded_at = now()
    db.commit()
    return {"ok": True}


@app.get("/dashboard")
def dashboard(db=Depends(session), a=Depends(admin)):
    m = current_month(db)
    return {
        "current_month": m,
        "users": db.scalar(select(func.count(User.id))),
        "month_points": db.scalar(
            select(func.coalesce(func.sum(PointLog.points_change), 0)).where(
                PointLog.month_key == m, PointLog.points_change > 0
            )
        ),
        "month_winners": db.scalar(
            select(func.count(func.distinct(Result.user_id)))
            .join(Competition, Competition.id == Result.competition_id)
            .where(Competition.month_key == m)
        ),
        "pending_rewards": db.scalar(
            select(func.count(Reward.id)).where(Reward.status == "pending")
        ),
        "today_redeemed": db.scalar(
            select(func.count(Reward.id)).where(
                Reward.status == "redeemed",
                func.date(Reward.redeemed_at) == business_today(),
            )
        ),
        "competitions": db.scalar(
            select(func.count(Competition.id)).where(Competition.month_key == m)
        ),
    }


@app.get("/competitions/{cid}")
def competition_detail(cid: int, db=Depends(session), a=Depends(admin)):
    competition = db.get(Competition, cid)
    if not competition:
        raise HTTPException(404, "赛事不存在")
    results = db.execute(
        select(Result, User.nickname, User.member_code)
        .join(User, User.id == Result.user_id)
        .where(Result.competition_id == cid)
    ).all()
    return {
        "competition": competition,
        "results": [
            {
                "user_id": r.user_id,
                "nickname": n,
                "member_code": m,
                "result_type": r.result_type,
                "points": r.points,
                "reward_choice": r.reward_choice,
            }
            for r, n, m in results
        ],
    }


from fastapi.staticfiles import StaticFiles
from pathlib import Path
from .mini import router as mini_router
from .matches import router as match_router
from .prizes import router as prize_router
from .exchanges import router as exchange_router

app.include_router(mini_router)
app.include_router(match_router)
app.include_router(prize_router)
app.include_router(exchange_router)
app.mount(
    "/assets/mini",
    StaticFiles(directory=Path(__file__).resolve().parents[1] / "assets" / "mini"),
    name="mini-assets",
)
from .avatars import AVATAR_DIR

app.mount("/assets/avatars", StaticFiles(directory=AVATAR_DIR), name="member-avatars")
