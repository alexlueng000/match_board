"""Legacy exchange history and member locks; new point exchanges are retired."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from .db import User, PointLog, ExchangeOrder, Reward
from .main import session, admin
from .mini import player

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
@router.post("/mini/exchange")
def retired_exchange(user=Depends(player)):
    raise HTTPException(410, "积分兑换已停止，门票按比赛名次直接发放，请在“奖励”中查看")


@router.get("/users/{uid}/exchange")
def member_exchange(uid: int, db=Depends(session), a=Depends(admin)):
    if not db.get(User, uid):
        raise HTTPException(404, "会员不存在")
    return {**wallet(db, uid), "history": history(db, uid)}
