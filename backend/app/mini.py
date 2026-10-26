import secrets
from datetime import datetime, timedelta, timezone
import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .db import User, Reward, settings, now
from .avatars import read_avatar, store_avatar
from .main import session, rankings, current_month

router = APIRouter(prefix="/mini", tags=["微信小程序"])
bearer = HTTPBearer()


class WechatLogin(BaseModel):
    code: str = Field(min_length=1, max_length=256)
    nickname: str = Field(default="", max_length=80)
    existing_only: bool = False


def exchange_code(code):
    if not settings.wechat_app_id or not settings.wechat_app_secret:
        raise HTTPException(503, "微信登录尚未配置，请联系门店")
    try:
        response = httpx.get(
            "https://api.weixin.qq.com/sns/jscode2session",
            params={
                "appid": settings.wechat_app_id,
                "secret": settings.wechat_app_secret,
                "js_code": code,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "微信登录服务暂时不可用，请重试")
    if (
        payload.get("errcode")
        or not isinstance(payload.get("openid"), str)
        or not payload["openid"]
    ):
        raise HTTPException(401, "微信登录凭证已失效，请重试")
    return payload["openid"]


def player_token(user):
    return jwt.encode(
        {
            "sub": str(user.id),
            "kind": "player",
            "exp": datetime.now(timezone.utc) + timedelta(days=7),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


@router.post("/auth")
def login(body: WechatLogin, db=Depends(session)):
    openid = exchange_code(body.code)
    user = db.scalar(select(User).where(User.openid == openid))
    if not user:
        if body.existing_only:
            raise HTTPException(404, "你还没有微信会员档案，请先选择头像并填写昵称完成注册")
        code = secrets.token_hex(4).upper()
        user = User(
            openid=openid,
            member_code=code,
            nickname=body.nickname.strip() or "玩家" + code[-4:],
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            user = db.scalar(select(User).where(User.openid == openid))
            if not user:
                raise HTTPException(409, "注册冲突，请重试")
    return {"access_token": player_token(user), "member_code": user.member_code}


def player(auth: HTTPAuthorizationCredentials = Depends(bearer), db=Depends(session)):
    try:
        payload = jwt.decode(
            auth.credentials,
            settings.jwt_secret,
            algorithms=["HS256"],
            options={"require": ["sub", "kind", "exp"]},
        )
        if payload["kind"] != "player":
            raise ValueError()
        user = db.get(User, int(payload["sub"]))
        if not user or not user.openid:
            raise ValueError()
        return user
    except (jwt.PyJWTError, ValueError, TypeError, KeyError):
        raise HTTPException(401, "登录已过期，请重新登录")


def save_member_profile(db, user, nickname, content):
    url, path = store_avatar(content)
    try:
        user.nickname = nickname.strip()
        user.avatar_url = url
        user.profile_consented_at = now()
        db.add(user)
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return {"nickname": user.nickname, "avatar_url": url}


@router.post("/auth/register")
def register(
    code: str = Form(min_length=1, max_length=256),
    nickname: str = Form(min_length=1, max_length=80),
    agreed: bool = Form(),
    avatar: UploadFile = File(),
    db=Depends(session),
):
    if not agreed or not nickname.strip():
        raise HTTPException(422, "请同意会员资料说明并填写昵称")
    content = read_avatar(avatar)
    openid = exchange_code(code)
    user = db.scalar(select(User).where(User.openid == openid).with_for_update())
    if not user:
        user = User(openid=openid, member_code=secrets.token_hex(4).upper(), nickname=nickname.strip())
    try:
        profile = save_member_profile(db, user, nickname, content)
    except IntegrityError:
        # Concurrent registration of the same WeChat identity reuses its member.
        user = db.scalar(select(User).where(User.openid == openid).with_for_update())
        if not user:
            raise HTTPException(409, "注册冲突，请重试")
        profile = save_member_profile(db, user, nickname, content)
    return {"access_token": player_token(user), "member_code": user.member_code, **profile}


@router.post("/profile/avatar")
def update_avatar(
    nickname: str = Form(min_length=1, max_length=80),
    avatar: UploadFile = File(),
    db=Depends(session),
    user=Depends(player),
):
    if not nickname.strip():
        raise HTTPException(422, "请输入昵称")
    return save_member_profile(db, user, nickname, read_avatar(avatar))


@router.get("/me")
def me(db=Depends(session), user=Depends(player)):
    from .exchanges import wallet
    month = current_month(db)
    row = next(r for r in rankings(db, month) if r["id"] == user.id)
    return {**row, **wallet(db, user.id), "current_month": month, "profile_complete": bool(user.avatar_url and user.profile_consented_at)}


class Profile(BaseModel):
    nickname: str = Field(min_length=1, max_length=80)


@router.post("/profile")
def profile(body: Profile, db=Depends(session), user=Depends(player)):
    if not body.nickname.strip():
        raise HTTPException(422, "请输入昵称")
    user.nickname = body.nickname.strip()
    db.commit()
    return {"nickname": user.nickname}


@router.get("/rankings")
def ranking(scope: str = "monthly", db=Depends(session)):
    if scope not in ["monthly", "total"]:
        raise HTTPException(422, "榜单类型无效")
    key = "monthly_rank" if scope == "monthly" else "total_rank"
    rows = sorted(rankings(db, current_month(db)), key=lambda r: r[key])
    return {
        "current_month": current_month(db),
        "rows": [
            {
                "nickname": r["nickname"],
                "avatar_url": r["avatar_url"],
                "member_code": r["member_code"],
                "rank": r[key],
                "score": r["monthly_score" if scope == "monthly" else "total_score"],
            }
            for r in rows
        ],
    }


def reward_json(reward):
    return {
        "id": reward.id,
        "reward_name": reward.reward_name,
        "status": reward.status,
        "issued_at": reward.issued_at,
        "redeemed_at": reward.redeemed_at,
        "competition_id": reward.competition_id,
        "source_label": "积分兑换" if reward.operated_by is None else ("赛事奖励" if reward.competition_id else "门店补发奖励"),
        "redeem_code": reward.redeem_code if reward.status == "pending" else None,
    }


@router.get("/rewards")
def rewards(db=Depends(session), user=Depends(player)):
    return [
        reward_json(r)
        for r in db.scalars(
            select(Reward).where(Reward.user_id == user.id).order_by(Reward.id.desc())
        ).all()
    ]


@router.get("/rewards/{rid}")
def reward_detail(rid: int, db=Depends(session), user=Depends(player)):
    reward = db.scalar(
        select(Reward).where(Reward.id == rid, Reward.user_id == user.id)
    )
    if not reward:
        raise HTTPException(404, "奖励不存在")
    result = {**reward_json(reward), "member_code": user.member_code}
    if reward.status == "pending":
        import qrcode
        qr = qrcode.QRCode(box_size=1, border=4)
        qr.add_data("NUTS:TICKET:" + reward.redeem_code)
        qr.make(fit=True)
        result["qr_matrix"] = qr.get_matrix()
    return result
