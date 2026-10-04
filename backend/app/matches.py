"""Daily sessions; all roster mutations lock their parent session."""

from datetime import date, datetime, time, timedelta
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, func
from .db import MatchSession, Enrollment, User, now, business_today
from .main import session, admin
from .mini import player

router = APIRouter(tags=["比赛场次"])


class CreateSession(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: Literal["regular", "gto"]
    starts_at: datetime
    capacity: int = Field(ge=3, le=500)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("请输入场次名称")
        return value.strip()

    @field_validator("starts_at")
    @classmethod
    def local_time(cls, value):
        if value.tzinfo is not None:
            from zoneinfo import ZoneInfo

            value = value.astimezone(ZoneInfo("Asia/Shanghai")).replace(tzinfo=None)
        return value


class Transition(BaseModel):
    status: Literal["running", "cancelled"]


class CheckIn(BaseModel):
    checked_in: bool = True


def locked(db, sid):
    match = db.scalar(
        select(MatchSession).where(MatchSession.id == sid).with_for_update()
    )
    if not match:
        raise HTTPException(404, "场次不存在")
    return match


def projection(db, match, user_id=None):
    count = db.scalar(
        select(func.count())
        .select_from(Enrollment)
        .where(Enrollment.session_id == match.id, Enrollment.status != "withdrawn")
    )
    own = (
        db.scalar(
            select(Enrollment).where(
                Enrollment.session_id == match.id, Enrollment.user_id == user_id
            )
        )
        if user_id
        else None
    )
    return {
        "id": match.id,
        "name": match.name,
        "type": match.type,
        "starts_at": match.starts_at,
        "capacity": match.capacity,
        "status": match.status,
        "enrolled_count": count,
        "my_status": own.status if own else None,
        "competition_id": match.competition_id,
    }


def for_day(db, day):
    start = datetime.combine(day, time.min)
    return db.scalars(
        select(MatchSession)
        .where(
            MatchSession.starts_at >= start,
            MatchSession.starts_at < start + timedelta(days=1),
        )
        .order_by(MatchSession.starts_at, MatchSession.id)
    ).all()


@router.post("/sessions")
def create(body: CreateSession, db=Depends(session), a=Depends(admin)):
    if body.starts_at.date() < business_today():
        raise HTTPException(422, "不能创建过去日期的场次")
    match = MatchSession(**body.model_dump(), created_by=a.id)
    db.add(match)
    db.commit()
    return projection(db, match)


@router.get("/sessions")
def list_admin(day: date | None = None, db=Depends(session), a=Depends(admin)):
    return [projection(db, match) for match in for_day(db, day or business_today())]


@router.get("/sessions/{sid}")
def detail(sid: int, db=Depends(session), a=Depends(admin)):
    match = db.get(MatchSession, sid)
    if not match:
        raise HTTPException(404, "场次不存在")
    roster = db.execute(
        select(Enrollment, User)
        .join(User, User.id == Enrollment.user_id)
        .where(Enrollment.session_id == sid)
        .order_by(Enrollment.joined_at, Enrollment.id)
    ).all()
    return {
        **projection(db, match),
        "roster": [
            {
                "user_id": u.id,
                "nickname": u.nickname,
                "member_code": u.member_code,
                "status": e.status,
                "joined_at": e.joined_at,
                "checked_in_at": e.checked_in_at,
            }
            for e, u in roster
        ],
    }


@router.post("/sessions/{sid}/status")
def transition(sid: int, body: Transition, db=Depends(session), a=Depends(admin)):
    match = locked(db, sid)
    if match.status == body.status:
        db.commit()
        return projection(db, match)
    allowed = {"open": {"running", "cancelled"}, "running": {"cancelled"}}
    if body.status not in allowed.get(match.status, set()):
        raise HTTPException(409, "场次状态不能执行此操作")
    if body.status == "running" and match.starts_at.date() != business_today():
        raise HTTPException(409, "只能开始当日场次")
    match.status = body.status
    db.commit()
    return projection(db, match)


@router.post("/sessions/{sid}/participants/{uid}/check-in")
def check_in(sid: int, uid: int, body: CheckIn, db=Depends(session), a=Depends(admin)):
    match = locked(db, sid)
    if match.status not in ["open", "running"]:
        raise HTTPException(409, "场次已结束或取消，不能修改到场状态")
    enrollment = db.scalar(
        select(Enrollment)
        .where(Enrollment.session_id == sid, Enrollment.user_id == uid)
        .with_for_update()
    )
    if not enrollment or enrollment.status == "withdrawn":
        raise HTTPException(404, "玩家未报名本场比赛")
    enrollment.status = "checked_in" if body.checked_in else "joined"
    enrollment.checked_in_at = now() if body.checked_in else None
    enrollment.checked_in_by = a.id if body.checked_in else None
    db.commit()
    return {"status": enrollment.status}


@router.get("/mini/sessions")
def list_public(db=Depends(session)):
    return [projection(db, match) for match in for_day(db, business_today())]


@router.get("/mini/my-sessions")
def list_mine(db=Depends(session), user=Depends(player)):
    return [projection(db, match, user.id) for match in for_day(db, business_today())]


@router.post("/mini/sessions/{sid}/join")
def join(sid: int, db=Depends(session), user=Depends(player)):
    match = locked(db, sid)
    if match.status != "open" or match.starts_at.date() != business_today():
        raise HTTPException(409, "仅当日报名中的场次可以加入")
    enrollment = db.scalar(
        select(Enrollment)
        .where(Enrollment.session_id == sid, Enrollment.user_id == user.id)
        .with_for_update()
    )
    if enrollment and enrollment.status != "withdrawn":
        db.commit()
        return projection(db, match, user.id)
    active = db.scalars(
        select(Enrollment.id)
        .where(Enrollment.session_id == sid, Enrollment.status != "withdrawn")
        .with_for_update()
    ).all()
    if len(active) >= match.capacity:
        raise HTTPException(409, "本场人数已满")
    if enrollment:
        enrollment.status = "joined"
        enrollment.joined_at = now()
        enrollment.checked_in_at = None
        enrollment.checked_in_by = None
    else:
        db.add(Enrollment(session_id=sid, user_id=user.id))
    db.commit()
    return projection(db, match, user.id)


@router.post("/mini/sessions/{sid}/leave")
def leave(sid: int, db=Depends(session), user=Depends(player)):
    match = locked(db, sid)
    if match.status != "open" or match.starts_at.date() != business_today():
        raise HTTPException(409, "开赛后不能退出，请联系店员")
    enrollment = db.scalar(
        select(Enrollment)
        .where(Enrollment.session_id == sid, Enrollment.user_id == user.id)
        .with_for_update()
    )
    if enrollment:
        enrollment.status = "withdrawn"
        enrollment.checked_in_at = None
        enrollment.checked_in_by = None
    db.commit()
    return projection(db, match, user.id)
