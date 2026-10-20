"""Member ticket purchases use a separate spending ledger, never ranking points."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from .db import User, Prize, PointLog, ExchangeOrder, Reward
from .main import session, admin
from .mini import player
from .prizes import reserve

router = APIRouter(tags=["积分兑换"])


def lock_member(db, uid):
    member = db.scalar(select(User).where(User.id == uid).with_for_update())
    if not member:
        raise HTTPException(404, "会员不存在")
    return member


def wallet(db, uid, lock=False):
    if lock:
        # Current locking reads avoid an older MySQL snapshot taken during login.
        earned = sum(db.scalars(select(PointLog.points_change).where(PointLog.user_id == uid).with_for_update()).all())
        spent = sum(db.scalars(select(ExchangeOrder.points).where(ExchangeOrder.user_id == uid, ExchangeOrder.refunded_at.is_(None)).with_for_update()).all())
    else:
        earned = db.scalar(select(func.coalesce(func.sum(PointLog.points_change), 0)).where(PointLog.user_id == uid))
        spent = db.scalar(select(func.coalesce(func.sum(ExchangeOrder.points), 0)).where(ExchangeOrder.user_id == uid, ExchangeOrder.refunded_at.is_(None)))
    return {"earned_points": earned, "spent_points": spent, "available_points": max(0, earned - spent)}


def history(db, uid):
    return [dict(id=order.id, request_id=order.request_id, reward_id=order.reward_id, reward_name=reward.reward_name,
                 points=order.points, status=reward.status, created_at=order.created_at,
                 refunded_at=order.refunded_at)
            for order, reward in db.execute(select(ExchangeOrder, Reward).join(Reward, Reward.id == ExchangeOrder.reward_id)
                .where(ExchangeOrder.user_id == uid).order_by(ExchangeOrder.id.desc()).limit(100)).all()]


@router.get("/mini/exchange")
def catalog(db=Depends(session), user=Depends(player)):
    prizes = db.scalars(select(Prize).where(Prize.enabled == True, Prize.exchange_points.is_not(None)).order_by(Prize.exchange_points, Prize.code)).all()
    return {**wallet(db, user.id), "member_code": user.member_code, "items": [dict(code=p.code, name=p.name, points=p.exchange_points, stock=p.stock) for p in prizes], "history": history(db, user.id)}


class Purchase(BaseModel):
    request_id: str = Field(min_length=8, max_length=80)
    prize_code: str = Field(min_length=1, max_length=40)
    expected_points: int = Field(ge=1, le=1000000)


@router.post("/mini/exchange")
def purchase(body: Purchase, db=Depends(session), user=Depends(player)):
    lock_member(db, user.id)
    previous = db.scalar(select(ExchangeOrder).where(ExchangeOrder.user_id == user.id, ExchangeOrder.request_id == body.request_id).with_for_update())
    if previous:
        if previous.prize_code != body.prize_code or previous.points != body.expected_points:
            raise HTTPException(409, "提交标识已用于另一笔兑换")
        return {"reward_id": previous.reward_id, "duplicate": True}
    balance = wallet(db, user.id, lock=True)
    prize = db.scalar(select(Prize).where(Prize.code == body.prize_code).with_for_update())
    if not prize or not prize.enabled or prize.deleted or prize.exchange_points is None:
        raise HTTPException(409, "该门票已停止兑换，请刷新兑换列表")
    if prize.exchange_points != body.expected_points:
        raise HTTPException(409, "兑换价格已调整，请刷新后确认")
    if balance["available_points"] < prize.exchange_points:
        raise HTTPException(409, "可用积分不足")
    reward = reserve(db, user.id, prize.code, None, remark=f"积分兑换，消耗 {prize.exchange_points} 分")
    db.add(ExchangeOrder(user_id=user.id, request_id=body.request_id, prize_code=prize.code, reward_id=reward.id, points=prize.exchange_points))
    db.commit()
    return {"reward_id": reward.id, "duplicate": False}


@router.get("/users/{uid}/exchange")
def member_exchange(uid: int, db=Depends(session), a=Depends(admin)):
    if not db.get(User, uid):
        raise HTTPException(404, "会员不存在")
    return {**wallet(db, uid), "history": history(db, uid)}
