"""Configurable award rules and transactional inventory reservations."""

import secrets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from .db import Prize, PrizeRule, InventoryLog, Reward
from .main import session, admin, RULES, REWARDS

router = APIRouter(tags=["奖品设置"])
DEFAULT_RULES = {
    f"{typ}_{role}": (code, 1)
    for typ, roles in RULES.items()
    for role, (_, code, _) in roles.items()
    if not (typ == "gto" and role == "champion")
}
DEFAULT_RULES.update(
    {"gto_champion_tickets": ("GTO_TICKET", 2), "gto_champion_gift": ("GIFT", 1)}
)


def initialize(db):
    for code, name in REWARDS.items():
        if not db.get(Prize, code):
            db.add(Prize(code=code, name=name, stock=None, enabled=True, version=0))
    db.flush()
    for key, (code, quantity) in DEFAULT_RULES.items():
        if not db.get(PrizeRule, key):
            db.add(PrizeRule(key=key, prize_code=code, quantity=quantity))


def award_rules(db):
    return {
        r.key: r
        for r in db.scalars(
            select(PrizeRule).order_by(PrizeRule.key).with_for_update()
        ).all()
    }


def reserve(db, uid, code, operator, competition=None, remark=""):
    prize = db.scalar(select(Prize).where(Prize.code == code).with_for_update())
    if not prize or not prize.enabled or prize.deleted:
        raise HTTPException(422, "奖品不存在或已停用，请调整奖品设置")
    finite = prize.stock is not None
    if finite:
        if prize.stock <= 0:
            raise HTTPException(
                409, f"“{prize.name}”库存不足，本次积分与奖励未提交，请先补充库存"
            )
        prize.stock -= 1
        prize.version += 1
    reward = Reward(
        user_id=uid,
        competition_id=competition,
        reward_type=code,
        reward_name=prize.name,
        redeem_code=secrets.token_hex(5).upper(),
        operated_by=operator,
        remark=remark,
        stock_reserved=finite,
    )
    db.add(reward)
    db.flush()
    if finite:
        db.add(
            InventoryLog(
                prize_code=code,
                change=-1,
                balance=prize.stock,
                reason="奖励发放预占库存",
                reward_id=reward.id,
                operator_id=operator,
            )
        )
    return reward


def release(db, reward, operator):
    if not reward.stock_reserved:
        return
    prize = db.scalar(
        select(Prize).where(Prize.code == reward.reward_type).with_for_update()
    )
    if not prize:
        raise HTTPException(409, "奖品库存档案缺失，请联系管理员")
    if prize.stock is not None:
        prize.stock += 1
    prize.version += 1
    reward.stock_reserved = False
    db.add(
        InventoryLog(
            prize_code=prize.code,
            change=1,
            balance=prize.stock,
            reason="撤销未使用奖励退回库存",
            reward_id=reward.id,
            operator_id=operator,
        )
    )


class PrizeInput(BaseModel):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Z0-9_]+$")
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    stock: int | None = Field(default=None, ge=0, le=1000000)
    version: int = Field(default=0, ge=0)
    exchange_points: int | None = Field(default=None, ge=1, le=1000000)

    @field_validator("name")
    @classmethod
    def clean(cls, v):
        if not v.strip():
            raise ValueError("奖品名称不能为空")
        return v.strip()


class RuleInput(BaseModel):
    key: str
    prize_code: str
    quantity: int = Field(ge=0, le=20)


class SaveSettings(BaseModel):
    prizes: list[PrizeInput] = Field(max_length=100)
    rules: list[RuleInput] = Field(min_length=9, max_length=9)
    reason: str = Field(min_length=1, max_length=500)


def view(db):
    return {
        "prizes": db.scalars(select(Prize).where(Prize.deleted == False).order_by(Prize.code)).all(),
        "rules": db.scalars(select(PrizeRule).order_by(PrizeRule.key)).all(),
    }


@router.get("/prize-settings")
def get_settings(db=Depends(session), a=Depends(admin)):
    return view(db)


@router.post("/prize-settings")
def save(body: SaveSettings, db=Depends(session), a=Depends(admin)):
    if not body.reason.strip():
        raise HTTPException(422, "请填写设置或库存调整原因")
    if len({p.code for p in body.prizes}) != len(body.prizes):
        raise HTTPException(422, "奖品编码重复")
    if {r.key for r in body.rules} != set(DEFAULT_RULES):
        raise HTTPException(422, "发放规则缺失或重复")
    supplied = {p.code: p for p in body.prizes}
    rules = award_rules(db)
    existing = {
        p.code: p
        for p in db.scalars(select(Prize).order_by(Prize.code).with_for_update()).all()
    }
    for r in body.rules:
        if r.prize_code not in supplied:
            old = existing.get(r.prize_code)
            if r.quantity or not old or not old.deleted:
                raise HTTPException(422, "发放规则必须选择有效奖品，已删除奖品的发放数量须为0")
        elif r.quantity and not supplied[r.prize_code].enabled:
            raise HTTPException(422, "发放规则必须选择启用的奖品；停用前请先更换规则")
    if {code for code, prize in existing.items() if not prize.deleted} - set(supplied):
        raise HTTPException(422, "请使用奖品行的删除操作，不能直接移除已保存的奖品")
    for p in body.prizes:
        old = existing.get(p.code)
        if old and old.deleted:
            raise HTTPException(409, "奖品已删除，请刷新设置，不能用旧页面恢复")
        if old and old.version != p.version:
            raise HTTPException(
                409, "库存或设置已变化，请刷新后重新调整，避免覆盖最新库存"
            )
    rules_changed = any(
        rules[r.key].prize_code != r.prize_code or rules[r.key].quantity != r.quantity
        for r in body.rules
    )
    for p in body.prizes:
        old = existing.get(p.code)
        before = old.stock if old else None
        changed = (
            not old
            or old.name != p.name
            or old.enabled != p.enabled
            or before != p.stock
            or old.exchange_points != p.exchange_points
            or rules_changed
        )
        if not old:
            old = Prize(
                code=p.code, name=p.name, enabled=p.enabled, stock=p.stock, version=0, exchange_points=p.exchange_points
            )
            db.add(old)
        else:
            old.name = p.name
            old.enabled = p.enabled
            old.stock = p.stock
            old.exchange_points = p.exchange_points
            old.version += 1
        db.flush()
        if changed:
            db.add(
                InventoryLog(
                    prize_code=p.code,
                    change=(
                        p.stock - before
                        if before is not None and p.stock is not None
                        else None
                    ),
                    balance=p.stock,
                    reason=body.reason.strip(),
                    operator_id=a.id,
                )
            )
    for r in body.rules:
        rules[r.key].prize_code = r.prize_code
        rules[r.key].quantity = r.quantity
    db.commit()
    return view(db)


class DeletePrize(BaseModel):
    version: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=480)


@router.post("/prizes/{code}/delete")
def delete_prize(code: str, body: DeletePrize, db=Depends(session), a=Depends(admin)):
    if not body.reason.strip():
        raise HTTPException(422, "请填写删除原因")
    rules = award_rules(db)
    prize = db.scalar(select(Prize).where(Prize.code == code).with_for_update())
    if not prize or prize.deleted:
        raise HTTPException(404, "奖品不存在或已删除，请刷新")
    if prize.version != body.version:
        raise HTTPException(409, "库存或设置已变化，请刷新后再删除")
    if any(rule.prize_code == code and rule.quantity > 0 for rule in rules.values()):
        raise HTTPException(409, "该奖品仍用于比赛发奖，请先替换对应奖品或将发放数量设为0并保存，再删除")
    prize.deleted = True
    prize.enabled = False
    prize.exchange_points = None
    prize.version += 1
    db.add(InventoryLog(prize_code=code, change=0, balance=prize.stock, reason="删除奖品：" + body.reason.strip(), operator_id=a.id))
    db.commit()
    return {"ok": True}


@router.get("/inventory-logs")
def logs(db=Depends(session), a=Depends(admin)):
    return [
        {
            "id": log.id,
            "prize_code": log.prize_code,
            "prize_name": name,
            "change": log.change,
            "balance": log.balance,
            "reason": log.reason,
            "reward_id": log.reward_id,
            "operator_id": log.operator_id,
            "created_at": log.created_at,
        }
        for log, name in db.execute(
            select(InventoryLog, Prize.name)
            .join(Prize, Prize.code == InventoryLog.prize_code)
            .order_by(InventoryLog.id.desc())
            .limit(100)
        ).all()
    ]
