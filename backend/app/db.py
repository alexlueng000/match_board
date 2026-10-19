from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import (
    create_engine,
    String,
    Integer,
    DateTime,
    Date,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "mysql+pymysql://nuts:nuts@localhost:3306/nuts"
    jwt_secret: str
    admin_username: str = "admin"
    admin_password: str
    wechat_app_id: str = ""
    wechat_app_secret: str = ""
    cors_origins: str = "http://localhost:3000"
    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
engine = create_engine(settings.database_url, pool_pre_ping=True)
Session = sessionmaker(engine)


class Base(DeclarativeBase):
    pass


def now():
    return datetime.now(ZoneInfo("Asia/Shanghai")).replace(tzinfo=None)


def business_today():
    return now().date()


class Admin(Base):
    __tablename__ = "admins"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    member_code: Mapped[str] = mapped_column(String(32), unique=True)
    nickname: Mapped[str] = mapped_column(String(80))
    avatar_url: Mapped[str | None] = mapped_column(String(255))
    profile_consented_at: Mapped[datetime | None] = mapped_column(DateTime)
    openid: Mapped[str | None] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Competition(Base):
    __tablename__ = "competitions"
    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), unique=True)
    request_payload: Mapped[str] = mapped_column(String(2000))
    type: Mapped[str] = mapped_column(String(20))
    date: Mapped[datetime] = mapped_column(Date)
    month_key: Mapped[str] = mapped_column(String(7), index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("admins.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Result(Base):
    __tablename__ = "competition_results"
    __table_args__ = (UniqueConstraint("competition_id", "result_type"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    result_type: Mapped[str] = mapped_column(String(20))
    points: Mapped[int]
    reward_choice: Mapped[str | None] = mapped_column(String(20))


class MatchSession(Base):
    __tablename__ = "match_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(20))
    starts_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    capacity: Mapped[int]
    status: Mapped[str] = mapped_column(String(20), default="open")
    created_by: Mapped[int] = mapped_column(ForeignKey("admins.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    competition_id: Mapped[int | None] = mapped_column(
        ForeignKey("competitions.id"), unique=True
    )


class Enrollment(Base):
    __tablename__ = "session_enrollments"
    __table_args__ = (
        UniqueConstraint("session_id", "user_id", name="uq_session_user"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("match_sessions.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), default="joined")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime)
    checked_in_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))


class PointLog(Base):
    __tablename__ = "point_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    competition_id: Mapped[int | None] = mapped_column(ForeignKey("competitions.id"))
    month_key: Mapped[str] = mapped_column(String(7), index=True)
    points_change: Mapped[int]
    source_type: Mapped[str] = mapped_column(String(40))
    remark: Mapped[str] = mapped_column(String(500), default="")
    operator_id: Mapped[int] = mapped_column(ForeignKey("admins.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Reward(Base):
    __tablename__ = "rewards"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    competition_id: Mapped[int | None] = mapped_column(ForeignKey("competitions.id"))
    reward_type: Mapped[str] = mapped_column(String(40))
    reward_name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    redeem_code: Mapped[str] = mapped_column(String(12), unique=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime)
    redeemed_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))
    cancellation_reason: Mapped[str | None] = mapped_column(String(500))
    operated_by: Mapped[int] = mapped_column(ForeignKey("admins.id"))
    remark: Mapped[str] = mapped_column(String(500), default="")
    stock_reserved: Mapped[bool] = mapped_column(default=False, server_default="0")


class Prize(Base):
    __tablename__ = "prizes"
    code: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    enabled: Mapped[bool] = mapped_column(default=True)
    stock: Mapped[int | None]
    version: Mapped[int] = mapped_column(default=0)


class PrizeRule(Base):
    __tablename__ = "prize_rules"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    prize_code: Mapped[str] = mapped_column(ForeignKey("prizes.code"))
    quantity: Mapped[int]


class InventoryLog(Base):
    __tablename__ = "inventory_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    prize_code: Mapped[str] = mapped_column(ForeignKey("prizes.code"), index=True)
    change: Mapped[int | None]
    balance: Mapped[int | None]
    reason: Mapped[str] = mapped_column(String(500))
    reward_id: Mapped[int | None] = mapped_column(ForeignKey("rewards.id"))
    operator_id: Mapped[int] = mapped_column(ForeignKey("admins.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Config(Base):
    __tablename__ = "config"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(100))
