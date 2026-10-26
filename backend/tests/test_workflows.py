import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "test-secret-that-is-at-least-32-characters")
os.environ.setdefault("ADMIN_PASSWORD", "test-password-123456")
from sqlalchemy import create_engine, select, func
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from app import db, main
import pytest
from io import BytesIO
from PIL import Image


def avatar_file(color="gold"):
    data = BytesIO()
    Image.new("RGB", (32, 48), color).save(data, format="PNG")
    return ("avatar.png", data.getvalue(), "image/png")


def test_member_registration_profile_and_repeat_login(client, monkeypatch, tmp_path):
    from app import mini, avatars

    monkeypatch.setattr(mini, "exchange_code", lambda code: "profile-" + code)
    monkeypatch.setattr(avatars, "AVATAR_DIR", tmp_path)
    before = len(client.get("/users").json())
    response = client.post("/mini/auth/register", data={"code": "alice", "nickname": " 小明 ", "agreed": "true"}, files={"avatar": avatar_file()})
    assert response.status_code == 200
    registered = response.json()
    headers = {"Authorization": "Bearer " + registered["access_token"]}
    member = client.get("/mini/me", headers=headers).json()
    assert member["nickname"] == "小明"
    assert member["profile_complete"] is True
    assert member["avatar_url"].startswith("/assets/avatars/")
    with Image.open(tmp_path / member["avatar_url"].rsplit("/", 1)[-1]) as image:
        assert image.size == (256, 256) and image.format == "JPEG"
    admin_member = next(u for u in client.get("/users").json() if u["member_code"] == member["member_code"])
    assert admin_member["avatar_url"] == member["avatar_url"]
    for scope in ("monthly", "total"):
        board = client.get("/mini/rankings?scope=" + scope).json()
        ranked_member = next(row for row in board["rows"] if row["member_code"] == member["member_code"])
        assert ranked_member["avatar_url"] == member["avatar_url"]
    with main.Session() as session:
        assert session.get(db.User, member["id"]).profile_consented_at is not None
    login = client.post("/mini/auth", json={"code": "alice", "existing_only": True})
    assert login.status_code == 200 and login.json()["member_code"] == registered["member_code"]
    repeated = client.post("/mini/auth/register", data={"code": "alice", "nickname": "小明新昵称", "agreed": "true"}, files={"avatar": avatar_file("blue")})
    assert repeated.status_code == 200 and repeated.json()["member_code"] == registered["member_code"]
    assert len(client.get("/users").json()) == before + 1
    assert client.get("/mini/me", headers=headers).json()["nickname"] == "小明新昵称"


def test_registration_rejects_missing_consent_bad_avatar_and_wechat_failure(client, monkeypatch, tmp_path):
    from app import mini, avatars

    monkeypatch.setattr(avatars, "AVATAR_DIR", tmp_path)
    monkeypatch.setattr(mini, "exchange_code", lambda code: "profile-" + code)
    assert client.post("/mini/auth", json={"code": "unknown", "existing_only": True}).status_code == 404
    base = {"code": "alice", "nickname": "小明", "agreed": "true"}
    assert client.post("/mini/auth/register", data={**base, "agreed": "false"}, files={"avatar": avatar_file()}).status_code == 422
    assert client.post("/mini/auth/register", data={**base, "nickname": "   "}, files={"avatar": avatar_file()}).status_code == 422
    assert client.post("/mini/auth/register", data=base, files={"avatar": ("avatar.png", b"not an image", "image/png")}).status_code == 422
    assert client.post("/mini/auth/register", data=base, files={"avatar": ("big.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")}).status_code == 422
    def unavailable(code):
        from fastapi import HTTPException
        raise HTTPException(503, "微信登录尚未配置，请联系门店")
    monkeypatch.setattr(mini, "exchange_code", unavailable)
    assert client.post("/mini/auth/register", data=base, files={"avatar": avatar_file()}).status_code == 503
    assert client.get("/users").json() == []
    assert list(tmp_path.iterdir()) == []


def test_avatar_update_requires_player_and_preserves_other_members(client, monkeypatch, tmp_path):
    from app import mini, avatars

    monkeypatch.setattr(avatars, "AVATAR_DIR", tmp_path)
    monkeypatch.setattr(mini, "exchange_code", lambda code: "profile-" + code)
    alice = client.post("/mini/auth", json={"code": "alice", "nickname": "小明"}).json()
    bob = client.post("/mini/auth", json={"code": "bob", "nickname": "小红"}).json()
    data = {"nickname": "新昵称"}
    assert client.post("/mini/profile/avatar", data=data, files={"avatar": avatar_file()}).status_code == 401
    response = client.post("/mini/profile/avatar", headers={"Authorization": "Bearer " + alice["access_token"]}, data=data, files={"avatar": avatar_file()})
    assert response.status_code == 200
    member = client.get("/mini/me", headers={"Authorization": "Bearer " + alice["access_token"]}).json()
    assert member["nickname"] == "新昵称" and member["profile_complete"] is True
    other = client.get("/mini/me", headers={"Authorization": "Bearer " + bob["access_token"]}).json()
    assert other["nickname"] == "小红" and other["avatar_url"] is None


@pytest.fixture()
def client():
    engine = create_engine(
        os.environ.get("TEST_DATABASE_URL", "sqlite://"),
        connect_args=(
            {"check_same_thread": False}
            if not os.environ.get("TEST_DATABASE_URL")
            else {}
        ),
        poolclass=StaticPool if not os.environ.get("TEST_DATABASE_URL") else None,
    )
    db.Base.metadata.drop_all(engine)
    db.Base.metadata.create_all(engine)
    main.engine = engine
    main.Session = db.sessionmaker(engine)
    with TestClient(main.app) as c:
        response = c.post(
            "/auth/login",
            json={"username": "admin", "password": "test-password-123456"},
        )
        assert response.status_code == 200
        c.headers["Authorization"] = "Bearer " + response.json()["access_token"]
        yield c
    engine.dispose()


def test_create_admin_with_short_password(client, monkeypatch):
    from app import manage

    monkeypatch.setattr(manage, "Session", main.Session)
    monkeypatch.setattr("sys.argv", ["manage", "create-admin", "zq"])
    monkeypatch.setattr(manage.getpass, "getpass", lambda prompt: "123456")
    manage.main()
    response = client.post(
        "/auth/login", json={"username": "zq", "password": "123456"}
    )
    assert response.status_code == 200
    with main.Session() as session:
        account = session.scalar(select(db.Admin).where(db.Admin.username == "zq"))
        assert account.password_hash != "123456"
        assert main.passwords.verify("123456", account.password_hash)


def test_bootstrap_admin_with_short_password(client, monkeypatch):
    monkeypatch.setattr(main.settings, "admin_username", "short-password-admin")
    monkeypatch.setattr(main.settings, "admin_password", "123456")
    with TestClient(main.app) as c:
        response = c.post(
            "/auth/login",
            json={"username": "short-password-admin", "password": "123456"},
        )
        assert response.status_code == 200


def players(c):
    return [
        c.post("/users", json={"nickname": n}).json()["id"]
        for n in ["玩家甲", "玩家乙", "玩家丙"]
    ]


def exchange_member(client, monkeypatch, name="exchange-member", points=10):
    from app import mini
    monkeypatch.setattr(mini, "exchange_code", lambda code: "exchange-" + code)
    result = client.post("/mini/auth", json={"code": name, "nickname": name}).json()
    headers = {"Authorization": "Bearer " + result["access_token"]}
    uid = client.get("/mini/me", headers=headers).json()["id"]
    if points:
        assert client.post(f"/users/{uid}/points", json={"points": points, "month": "2026-10", "reason": "历史积分"}).status_code == 200
    return uid, headers


def test_ticket_exchange_separate_balance_stock_idempotency_and_ownership(client, monkeypatch):
    uid, headers = exchange_member(client, monkeypatch)
    with main.Session.begin() as session:
        session.get(db.Prize, "REGULAR_TICKET").stock = 2
    before = client.get(f"/users/{uid}").json()["user"]
    catalog = client.get("/mini/exchange", headers=headers).json()
    assert {p["code"]: p["points"] for p in catalog["items"]} == {"REGULAR_TICKET": 5, "REGULAR_50_OFF": 3, "REGULAR_70_OFF": 1, "GTO_TICKET": 6, "GTO_50_OFF": 2}
    assert catalog["available_points"] == 10
    body = {"request_id": "purchase-request-1", "prize_code": "REGULAR_TICKET", "expected_points": 5}
    response = client.post("/mini/exchange", json=body, headers=headers)
    assert response.status_code == 200
    rid = response.json()["reward_id"]
    assert client.post("/mini/exchange", json=body, headers=headers).json() == {"reward_id": rid, "duplicate": True}
    assert client.post("/mini/exchange", json={**body, "prize_code": "GTO_TICKET"}, headers=headers).status_code == 409
    after = client.get(f"/users/{uid}").json()
    assert after["user"]["total_score"] == before["total_score"]
    assert after["user"]["monthly_score"] == before["monthly_score"]
    assert after["user"]["available_points"] == 5
    assert len(after["exchanges"]) == len(after["rewards"]) == 1
    with main.Session() as session:
        assert session.get(db.Prize, "REGULAR_TICKET").stock == 1
        reward = session.get(db.Reward, rid)
        assert reward.operated_by is None and reward.stock_reserved
    reward = client.get(f"/mini/rewards/{rid}", headers=headers).json()
    assert reward["source_label"] == "积分兑换" and reward["member_code"]
    _, other = exchange_member(client, monkeypatch, "another-member", points=0)
    assert client.get(f"/mini/rewards/{rid}", headers=other).status_code == 404
    assert client.get("/mini/exchange", headers={"Authorization": ""}).status_code in (401, 403)
    assert client.post("/mini/exchange", json=body).status_code == 401


def test_ticket_exchange_failure_has_no_partial_debit_or_reward(client, monkeypatch):
    uid, headers = exchange_member(client, monkeypatch, points=4)
    body = {"request_id": "purchase-failure-1", "prize_code": "REGULAR_TICKET", "expected_points": 5}
    assert client.post("/mini/exchange", json=body, headers=headers).status_code == 409
    assert client.get(f"/users/{uid}").json()["rewards"] == []
    client.post(f"/users/{uid}/points", json={"points": 10, "month": "2026-10", "reason": "补录"})
    with main.Session.begin() as session:
        session.get(db.Prize, "REGULAR_TICKET").stock = 0
    assert client.post("/mini/exchange", json=body, headers=headers).status_code == 409
    with main.Session.begin() as session:
        session.get(db.Prize, "REGULAR_TICKET").stock = 3
        session.get(db.Prize, "REGULAR_TICKET").exchange_points = 6
    assert client.post("/mini/exchange", json=body, headers=headers).status_code == 409
    with main.Session.begin() as session:
        session.get(db.Prize, "REGULAR_TICKET").exchange_points = None
    assert client.post("/mini/exchange", json={**body, "expected_points": 6}, headers=headers).status_code == 409
    assert client.get("/mini/exchange", headers=headers).json()["available_points"] == 14
    with main.Session() as session:
        assert session.scalar(select(func.count()).select_from(db.ExchangeOrder)) == 0
        assert session.scalar(select(func.count()).select_from(db.Reward)) == 0
        assert session.get(db.Prize, "REGULAR_TICKET").stock == 3


def test_cancel_exchange_refunds_only_unused_ticket(client, monkeypatch):
    uid, headers = exchange_member(client, monkeypatch)
    with main.Session.begin() as session:
        session.get(db.Prize, "REGULAR_TICKET").stock = 2
    body = {"request_id": "exchange-refund-1", "prize_code": "REGULAR_TICKET", "expected_points": 5}
    rid = client.post("/mini/exchange", json=body, headers=headers).json()["reward_id"]
    assert client.post(f"/rewards/{rid}/cancel", json={"reason": "退回未使用门票"}).status_code == 200
    assert client.post(f"/rewards/{rid}/cancel", json={"reason": "重复撤销"}).status_code == 409
    wallet = client.get("/mini/exchange", headers=headers).json()
    assert wallet["available_points"] == 10 and wallet["spent_points"] == 0
    assert wallet["history"][0]["refunded_at"]
    assert client.post("/mini/exchange", json=body, headers=headers).json()["duplicate"] is True
    rid2 = client.post("/mini/exchange", json={**body, "request_id": "exchange-refund-2"}, headers=headers).json()["reward_id"]
    assert client.post(f"/rewards/{rid2}/redeem", json={}).status_code == 200
    assert client.post(f"/rewards/{rid2}/cancel", json={"reason": "不能退已使用票"}).status_code == 409
    assert client.get("/mini/exchange", headers=headers).json()["available_points"] == 5
    with main.Session() as session:
        assert session.get(db.Prize, "REGULAR_TICKET").stock == 1


def test_batch_redemption_validates_owner_and_is_atomic(client):
    a, b, _ = players(client)
    client.post("/rewards", json={"user_id": a, "reward_type": "GTO_TICKET", "quantity": 2, "reason": "发票"})
    client.post("/rewards", json={"user_id": b, "reward_type": "GTO_TICKET", "reason": "发票"})
    alice = client.get(f"/rewards?user_id={a}&status=pending").json()
    bob = client.get(f"/rewards?user_id={b}&status=pending").json()
    assert len(alice) == 2 and all(r["user_id"] == a for r in alice)
    payload = {"user_id": a, "reward_ids": [alice[0]["id"], bob[0]["id"]]}
    assert client.post("/rewards/redeem-batch", json=payload).status_code == 409
    assert len(client.get(f"/rewards?user_id={a}&status=pending").json()) == 2
    assert client.post("/rewards/redeem-batch", json={"user_id": a, "reward_ids": [alice[0]["id"]]*2}).status_code == 422
    payload["reward_ids"] = [r["id"] for r in alice]
    response = client.post("/rewards/redeem-batch", json=payload)
    assert response.json() == {"ok": True, "count": 2}
    assert client.post("/rewards/redeem-batch", json=payload).status_code == 409
    assert len(client.get(f"/rewards?user_id={b}&status=pending").json()) == 1
    assert client.post("/rewards/redeem-batch", json=payload, headers={"Authorization": ""}).status_code in (401, 403)
    with main.Session() as session:
        assert all(session.get(db.Reward, r["id"]).redeemed_by is not None for r in alice)


def test_delete_prize_preserves_rewards_refunds_stock_and_rejects_stale_restore(client, monkeypatch):
    uid, headers = exchange_member(client, monkeypatch)
    with main.Session.begin() as session:
        session.add(db.Prize(code="CUSTOM_DELETE", name="删除测试票", enabled=True, stock=2, version=0, exchange_points=1))
    assert client.post("/rewards", json={"user_id": uid, "reward_type": "CUSTOM_DELETE", "reason": "历史奖励"}).status_code == 200
    old = client.get("/prize-settings").json()
    prize = next(p for p in old["prizes"] if p["code"] == "CUSTOM_DELETE")
    assert client.post("/prizes/CUSTOM_DELETE/delete", json={"version": 0, "reason": "旧页面"}).status_code == 409
    assert client.post("/prizes/CUSTOM_DELETE/delete", json={"version": prize["version"], "reason": "  不再提供  "}).status_code == 200
    assert "CUSTOM_DELETE" not in client.get("/reward-types").json()
    assert all(p["code"] != "CUSTOM_DELETE" for p in client.get("/prize-settings").json()["prizes"])
    assert all(p["code"] != "CUSTOM_DELETE" for p in client.get("/mini/exchange", headers=headers).json()["items"])
    assert client.post("/prize-settings", json={**old, "reason": "旧页面保存"}).status_code == 409
    assert client.post("/rewards", json={"user_id": uid, "reward_type": "CUSTOM_DELETE", "reason": "不能继续发放"}).status_code == 422
    historical = client.get(f"/rewards?user_id={uid}").json()
    assert len(historical) == 1 and historical[0]["reward_name"] == "删除测试票"
    assert client.post(f"/rewards/{historical[0]['id']}/cancel", json={"reason": "历史票退款"}).status_code == 200
    with main.Session() as session:
        saved = session.get(db.Prize, "CUSTOM_DELETE")
        assert saved.deleted and saved.stock == 2 and not saved.enabled
    logs = client.get("/inventory-logs").json()
    assert any(log["reason"] == "删除奖品：不再提供" for log in logs)


def test_delete_prize_requires_stopped_award_rules_and_survives_initialization(client):
    from app.prizes import initialize
    settings = client.get("/prize-settings").json()
    gift = next(p for p in settings["prizes"] if p["code"] == "GIFT")
    assert client.post("/prizes/GIFT/delete", json={"version": gift["version"], "reason": "仍在使用"}).status_code == 409
    for rule in settings["rules"]:
        if rule["prize_code"] == "GIFT":
            rule["quantity"] = 0
    saved = client.post("/prize-settings", json={**settings, "reason": "停止礼品发放"}).json()
    gift = next(p for p in saved["prizes"] if p["code"] == "GIFT")
    assert client.post("/prizes/GIFT/delete", json={"version": gift["version"], "reason": "删除礼品"}).status_code == 200
    after = client.get("/prize-settings").json()
    assert client.post("/prize-settings", json={**after, "reason": "保存其余设置"}).status_code == 200
    with main.Session.begin() as session:
        initialize(session)
    assert all(p["code"] != "GIFT" for p in client.get("/prize-settings").json()["prizes"])
    assert client.post("/prizes/GIFT/delete", json={"version": 0, "reason": "重复"}).status_code == 404
    assert client.post("/prizes/REGULAR_TICKET/delete", json={"version": 0, "reason": "未登录"}, headers={"Authorization": ""}).status_code in (401, 403)


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="requires a dedicated MySQL test database")
def test_mysql_parallel_exchange_cannot_overspend(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    uid, headers = exchange_member(client, monkeypatch, points=10)
    def purchase(index):
        return client.post("/mini/exchange", headers=headers, json={"request_id": f"parallel-exchange-{index}", "prize_code": "GTO_TICKET", "expected_points": 6}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(purchase, range(2)))
    assert sorted(statuses) == [200, 409]
    with main.Session() as session:
        assert session.scalar(select(func.count()).select_from(db.ExchangeOrder).where(db.ExchangeOrder.user_id == uid)) == 1
    assert client.get("/mini/exchange", headers=headers).json()["available_points"] == 4


def test_transaction_idempotency_month_and_rewards(client):
    a, b, c = players(client)
    payload = {
        "request_id": "unique-request-123",
        "type": "gto",
        "date": "2026-09-30",
        "champion": a,
        "second": b,
        "third": c,
        "champion_reward": "tickets",
    }
    assert client.post("/competitions", json=payload).status_code == 200
    assert client.post("/competitions", json=payload).json()["duplicate"] is True
    client.post("/settings/month", json={"month": "2026-10"})
    user = client.get(f"/users/{a}").json()
    assert user["user"]["monthly_score"] == 0
    assert user["user"]["total_score"] == 10
    assert len(user["points"]) == 1
    assert len(user["rewards"]) == 2
    rid = user["rewards"][0]["id"]
    assert client.post(f"/rewards/{rid}/redeem", json={}).status_code == 200
    assert client.post(f"/rewards/{rid}/redeem", json={}).status_code == 409
    assert (
        client.post(f"/rewards/{rid}/cancel", json={"reason": "录错"}).status_code
        == 409
    )
    assert client.get(f"/users/{a}").json()["rewards"][1]["status"] == "pending"
    client.post("/settings/month", json={"month": "2026-09"})
    assert client.get(f"/users/{a}").json()["user"]["monthly_score"] == 10


def test_validation_and_manual_operations(client):
    a, b, c = players(client)
    payload = {
        "request_id": "unique-request-456",
        "type": "regular",
        "date": "2026-10-04",
        "champion": a,
        "second": a,
        "third": c,
    }
    assert client.post("/competitions", json=payload).status_code == 422
    assert client.get("/competitions").json() == []
    assert (
        client.post(
            f"/users/{a}/points",
            json={"month": "2026-10", "points": 5, "reason": "补录"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/users/{a}/points",
            json={"month": "2026-10", "points": -2, "reason": "更正"},
        ).status_code
        == 200
    )
    assert client.get(f"/users/{a}").json()["user"]["total_score"] == 3
    assert (
        client.post(
            f"/users/{a}/points",
            json={"month": "2026-10", "points": 0, "reason": "空调整"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/rewards", json={"user_id": a, "reward_type": "GIFT", "reason": "补发"}
        ).status_code
        == 200
    )
    rid = client.get("/rewards").json()[0]["id"]
    assert (
        client.post(f"/rewards/{rid}/cancel", json={"reason": "错误补发"}).status_code
        == 200
    )
    assert client.post(f"/rewards/{rid}/redeem", json={}).status_code == 409


def test_authentication(client):
    client.headers.pop("Authorization")
    assert client.get("/users").status_code in [401, 403]
    assert (
        client.post(
            "/auth/login", json={"username": "admin", "password": "wrong"}
        ).status_code
        == 401
    )


def test_regular_rules_and_pool_overlap(client):
    a, b, c = players(client)
    response = client.post(
        "/competitions",
        json={
            "request_id": "regular-request-789",
            "type": "regular",
            "date": "2026-10-04",
            "champion": a,
            "second": b,
            "third": c,
            "pool27": a,
        },
    )
    assert response.status_code == 200
    client.post("/settings/month", json={"month": "2026-10"})
    assert [
        client.get(f"/users/{uid}").json()["user"]["total_score"] for uid in [a, b, c]
    ] == [5, 3, 1]
    assert len(client.get(f"/users/{a}").json()["rewards"]) == 2
    assert len(client.get("/rewards").json()) == 4


def test_missing_user_rolls_back(client):
    a, b, c = players(client)
    response = client.post(
        "/competitions",
        json={
            "request_id": "missing-request-123",
            "type": "regular",
            "date": "2026-10-04",
            "champion": a,
            "second": b,
            "third": 99999,
        },
    )
    assert response.status_code == 404
    assert client.get("/competitions").json() == []
    assert client.get("/rewards").json() == []
    assert client.get(f"/users/{a}").json()["points"] == []


def test_concurrent_redemption(client):
    if main.engine.dialect.name != "mysql":
        pytest.skip("并发核销在专用 MySQL 数据库验证")
    from concurrent.futures import ThreadPoolExecutor

    a, b, c = players(client)
    client.post(
        "/rewards", json={"user_id": a, "reward_type": "GIFT", "reason": "并发测试"}
    )
    rid = client.get("/rewards").json()[0]["id"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: client.post(f"/rewards/{rid}/redeem", json={}).status_code,
                range(2),
            )
        )
    assert sorted(responses) == [200, 409]


def test_idempotency_key_cannot_mask_changed_results(client):
    a, b, c = players(client)
    body = {
        "request_id": "same-request-123",
        "type": "regular",
        "date": "2026-10-04",
        "champion": a,
        "second": b,
        "third": c,
    }
    assert client.post("/competitions", json=body).status_code == 200
    body["date"] = "2026-10-05"
    assert client.post("/competitions", json=body).status_code == 409
    assert len(client.get("/competitions").json()) == 1


def test_account_lockout_and_token_revocation(client):
    for _ in range(5):
        assert (
            client.post(
                "/auth/login", json={"username": "admin", "password": "wrong"}
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/auth/login",
            json={"username": "admin", "password": "test-password-123456"},
        ).status_code
        == 429
    )
    with main.Session.begin() as session:
        account = session.scalar(select(db.Admin).where(db.Admin.username == "admin"))
        account.token_version += 1
    assert client.get("/users").status_code == 401


def test_cancel_preserves_issue_audit(client):
    a, b, c = players(client)
    client.post(
        "/rewards", json={"user_id": a, "reward_type": "GIFT", "reason": "补发原因"}
    )
    rid = client.get("/rewards").json()[0]["id"]
    client.post(f"/rewards/{rid}/cancel", json={"reason": "撤销原因"})
    reward = client.get("/rewards").json()[0]
    assert reward["remark"] == "补发原因"
    assert reward["cancellation_reason"] == "撤销原因"
    assert reward["cancelled_by"] is not None


def test_point_balances_are_traceable(client):
    a, b, c = players(client)
    for month, points in [("2026-09", 5), ("2026-10", 3), ("2026-09", -2)]:
        assert (
            client.post(
                f"/users/{a}/points",
                json={"month": month, "points": points, "reason": "流水测试"},
            ).status_code
            == 200
        )
    logs = client.get(f"/users/{a}").json()["points"]
    assert [(p["monthly_score_after"], p["total_score_after"]) for p in logs] == [
        (3, 6),
        (3, 8),
        (5, 5),
    ]
    client.post("/settings/month", json={"month": "2026-09"})
    assert client.get("/dashboard").json()["month_points"] == 5


def test_gto_gift_choice_is_recorded(client):
    a, b, c = players(client)
    response = client.post(
        "/competitions",
        json={
            "request_id": "gift-request-123",
            "type": "gto",
            "date": "2026-10-04",
            "champion": a,
            "second": b,
            "third": c,
            "champion_reward": "gift",
        },
    )
    assert response.status_code == 200
    record = client.get(f"/users/{a}").json()
    assert record["user"]["total_score"] == 10
    assert len(record["rewards"]) == 1
    assert record["rewards"][0]["reward_type"] == "GIFT"
    result = client.get(f'/competitions/{response.json()["id"]}').json()
    assert (
        next(r for r in result["results"] if r["result_type"] == "champion")[
            "reward_choice"
        ]
        == "gift"
    )


def test_monthly_tie_uses_earning_time(client):
    a, b, c = players(client)
    client.post("/settings/month", json={"month": "2026-10"})
    for uid in [b, a]:
        client.post(
            f"/users/{uid}/points",
            json={"month": "2026-10", "points": 5, "reason": "同分排序"},
        )
    ranks = client.get("/rankings?scope=monthly").json()
    assert [r["id"] for r in ranks[:2]] == [b, a]
    assert [r["id"] for r in client.get("/rankings?scope=total").json()[:2]] == [a, b]


def test_gto_requires_champion_reward(client):
    a, b, c = players(client)
    response = client.post(
        "/competitions",
        json={
            "request_id": "no-choice-request",
            "type": "gto",
            "date": "2026-10-04",
            "champion": a,
            "second": b,
            "third": c,
        },
    )
    assert response.status_code == 422
    assert client.get("/competitions").json() == []
    assert client.get("/rewards").json() == []


def test_mini_identity_permissions_and_rewards(client, monkeypatch):
    from app import mini

    monkeypatch.setattr(mini, "exchange_code", lambda code: "openid-" + code)
    first = client.post("/mini/auth", json={"code": "alice", "nickname": "小明"}).json()
    repeated = client.post("/mini/auth", json={"code": "alice"}).json()
    assert first["member_code"] == repeated["member_code"]
    assert "openid" not in first
    alice = {"Authorization": "Bearer " + first["access_token"]}
    bob_token = client.post("/mini/auth", json={"code": "bob"}).json()["access_token"]
    bob = {"Authorization": "Bearer " + bob_token}
    assert client.get("/users", headers=alice).status_code == 401
    assert client.get("/mini/me").status_code == 401
    me = client.get("/mini/me", headers=alice).json()
    assert me["nickname"] == "小明"
    uid = next(
        u["id"]
        for u in client.get("/users").json()
        if u["member_code"] == first["member_code"]
    )
    assert (
        client.post(
            "/rewards",
            json={"user_id": uid, "reward_type": "GIFT", "reason": "测试补发"},
        ).status_code
        == 200
    )
    reward = client.get("/mini/rewards", headers=alice).json()[0]
    assert reward["redeem_code"]
    rid = reward["id"]
    assert client.get(f"/mini/rewards/{rid}", headers=bob).status_code == 404
    assert client.get("/mini/rewards", headers=bob).json() == []
    assert (
        client.post(f"/rewards/{rid}/redeem", json={}, headers=alice).status_code == 401
    )
    assert client.post(f"/rewards/{rid}/redeem", json={}).status_code == 200
    assert (
        client.get(f"/mini/rewards/{rid}", headers=alice).json()["redeem_code"] is None
    )
    assert (
        client.post(
            "/mini/profile", json={"nickname": "新昵称"}, headers=alice
        ).status_code
        == 200
    )
    assert client.get("/mini/me", headers=alice).json()["nickname"] == "新昵称"
    board = client.get("/mini/rankings", headers={"Authorization": ""}).json()
    assert all("openid" not in row and "id" not in row for row in board["rows"])


def mini_players(client, monkeypatch, count=4):
    from app import mini

    monkeypatch.setattr(mini, "exchange_code", lambda code: "session-openid-" + code)
    result = []
    for i in range(count):
        token = client.post(
            "/mini/auth", json={"code": str(i), "nickname": f"参赛者{i}"}
        ).json()["access_token"]
        headers = {"Authorization": "Bearer " + token}
        uid = client.get("/mini/me", headers=headers).json()["id"]
        result.append((uid, headers))
    return result


def create_match(client, capacity=3, day=None):
    day = day or db.business_today()
    response = client.post(
        "/sessions",
        json={
            "name": "晚间常规赛",
            "type": "regular",
            "starts_at": f"{day}T19:30:00+08:00",
            "capacity": capacity,
        },
    )
    assert response.status_code == 200
    return response.json()["id"]


def test_session_full_workflow(client, monkeypatch):
    entrants = mini_players(client, monkeypatch)
    sid = create_match(client)
    for _, headers in entrants[:3]:
        assert (
            client.post(
                f"/mini/sessions/{sid}/join", json={}, headers=headers
            ).status_code
            == 200
        )
    # Duplicate joins do not occupy a second seat, and leaving frees a seat.
    assert (
        client.post(
            f"/mini/sessions/{sid}/join", json={}, headers=entrants[0][1]
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/mini/sessions/{sid}/join", json={}, headers=entrants[3][1]
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/mini/sessions/{sid}/leave", json={}, headers=entrants[0][1]
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/mini/sessions/{sid}/join", json={}, headers=entrants[3][1]
        ).status_code
        == 200
    )
    uid = entrants[0][0]
    assert (
        client.post(f"/sessions/{sid}/participants/{uid}/check-in", json={}).status_code
        == 404
    )
    assert (
        client.post(
            f"/mini/sessions/{sid}/leave", json={}, headers=entrants[3][1]
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/mini/sessions/{sid}/join", json={}, headers=entrants[0][1]
        ).status_code
        == 200
    )
    body = {
        "request_id": "session-result-123",
        "session_id": sid,
        "type": "regular",
        "date": str(db.business_today()),
        "champion": entrants[0][0],
        "second": entrants[1][0],
        "third": entrants[2][0],
    }
    assert client.post("/competitions", json=body).status_code == 409
    assert (
        client.post(f"/sessions/{sid}/status", json={"status": "running"}).status_code
        == 200
    )
    assert (
        client.post(
            f"/mini/sessions/{sid}/leave", json={}, headers=entrants[0][1]
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/mini/sessions/{sid}/join", json={}, headers=entrants[3][1]
        ).status_code
        == 409
    )
    assert client.post("/competitions", json=body).status_code == 422
    for uid, _ in entrants[:3]:
        assert (
            client.post(
                f"/sessions/{sid}/participants/{uid}/check-in", json={}
            ).status_code
            == 200
        )
    assert (
        client.post(
            "/competitions", json={**body, "type": "gto", "champion_reward": "gift"}
        ).status_code
        == 422
    )
    assert (
        client.post("/competitions", json={**body, "third": entrants[3][0]}).status_code
        == 422
    )
    assert client.post("/competitions", json=body).status_code == 200
    assert client.post("/competitions", json=body).json()["duplicate"] is True
    assert (
        client.post(
            "/competitions", json={**body, "request_id": "another-session-result"}
        ).status_code
        == 409
    )
    result = client.get(f"/sessions/{sid}").json()
    assert result["status"] == "finished"
    assert result["competition_id"]
    assert client.get("/mini/me", headers=entrants[0][1]).json()["monthly_score"] == 5
    assert len(client.get("/mini/rewards", headers=entrants[0][1]).json()) == 1
    assert (
        client.post(f"/sessions/{sid}/status", json={"status": "cancelled"}).status_code
        == 409
    )
    assert (
        client.post(
            f"/sessions/{sid}/participants/{entrants[0][0]}/check-in",
            json={"checked_in": False},
        ).status_code
        == 409
    )


def test_session_visibility_cancel_and_access(client, monkeypatch):
    from datetime import timedelta

    entrants = mini_players(client, monkeypatch, 1)
    sid = create_match(client)
    future = create_match(client, day=db.business_today() + timedelta(days=1))
    public = client.get("/mini/sessions", headers={"Authorization": ""}).json()
    assert [r["id"] for r in public] == [sid]
    assert "roster" not in public[0]
    h = entrants[0][1]
    assert client.get(f"/sessions/{sid}", headers=h).status_code == 401
    assert (
        client.post(
            f"/sessions/{sid}/status", json={"status": "running"}, headers=h
        ).status_code
        == 401
    )
    assert client.post(f"/mini/sessions/{sid}/join", json={}).status_code == 401
    assert (
        client.post(f"/mini/sessions/{future}/join", json={}, headers=h).status_code
        == 409
    )
    assert (
        client.post(
            f"/sessions/{future}/status", json={"status": "running"}
        ).status_code
        == 409
    )
    assert (
        client.post(f"/mini/sessions/{sid}/join", json={}, headers=h).status_code == 200
    )
    own = client.get("/mini/my-sessions", headers=h).json()[0]
    assert own["my_status"] == "joined"
    assert (
        client.post(f"/sessions/{sid}/status", json={"status": "cancelled"}).status_code
        == 200
    )
    assert (
        client.post(f"/mini/sessions/{sid}/join", json={}, headers=h).status_code == 409
    )
    assert (
        client.post(f"/sessions/{sid}/status", json={"status": "running"}).status_code
        == 409
    )


@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="MySQL row-lock concurrency test"
)
def test_concurrent_session_capacity_and_result(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    entrants = mini_players(client, monkeypatch, 8)
    sid = create_match(client)
    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(
            pool.map(
                lambda entrant: client.post(
                    f"/mini/sessions/{sid}/join", json={}, headers=entrant[1]
                ).status_code,
                entrants,
            )
        )
    assert statuses.count(200) == 3
    assert statuses.count(409) == 5
    roster = client.get(f"/sessions/{sid}").json()["roster"]
    assert len(roster) == 3
    for row in roster:
        client.post(f"/sessions/{sid}/participants/{row['user_id']}/check-in", json={})
    client.post(f"/sessions/{sid}/status", json={"status": "running"})
    base = {
        "session_id": sid,
        "type": "regular",
        "date": str(db.business_today()),
        "champion": roster[0]["user_id"],
        "second": roster[1]["user_id"],
        "third": roster[2]["user_id"],
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(
            pool.map(
                lambda i: client.post(
                    "/competitions",
                    json={**base, "request_id": f"concurrent-session-{i}"},
                ).status_code,
                range(2),
            )
        )
    assert sorted(statuses) == [200, 409]
    assert len(client.get("/competitions").json()) == 1
    assert len(client.get("/rewards").json()) == 3


@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="MySQL row-lock concurrency test"
)
def test_concurrent_duplicate_join_and_scoring_retry(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    entrants = mini_players(client, monkeypatch, 3)
    sid = create_match(client)
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(
            pool.map(
                lambda _: client.post(
                    f"/mini/sessions/{sid}/join", json={}, headers=entrants[0][1]
                ),
                range(4),
            )
        )
    assert all(r.status_code == 200 for r in responses)
    assert len(client.get(f"/sessions/{sid}").json()["roster"]) == 1
    for uid, headers in entrants:
        client.post(f"/mini/sessions/{sid}/join", json={}, headers=headers)
        client.post(f"/sessions/{sid}/participants/{uid}/check-in", json={})
    client.post(f"/sessions/{sid}/status", json={"status": "running"})
    body = {
        "request_id": "same-session-result-retry",
        "session_id": sid,
        "type": "regular",
        "date": str(db.business_today()),
        "champion": entrants[0][0],
        "second": entrants[1][0],
        "third": entrants[2][0],
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda _: client.post("/competitions", json=body), range(2))
        )
    assert all(r.status_code == 200 for r in responses)
    assert sorted(r.json()["duplicate"] for r in responses) == [False, True]
    assert len(client.get("/competitions").json()) == 1


def prize_settings(client):
    body = client.get("/prize-settings").json()
    body["reason"] = "补充奖品库存并调整发放规则"
    return body


def test_configurable_prizes_quantities_and_inventory(client):
    a, b, c = players(client)
    config = prize_settings(client)
    config["prizes"].append(
        {
            "code": "CUSTOM_MUG",
            "name": "冠军纪念杯",
            "enabled": True,
            "stock": 3,
            "version": 0,
        }
    )
    for rule in config["rules"]:
        if rule["key"] == "regular_champion":
            rule.update(prize_code="CUSTOM_MUG", quantity=2)
        elif rule["key"] in ["regular_second", "regular_third"]:
            rule["quantity"] = 0
    assert client.post("/prize-settings", json=config).status_code == 200
    body = {
        "request_id": "custom-prize-results",
        "type": "regular",
        "date": str(db.business_today()),
        "champion": a,
        "second": b,
        "third": c,
    }
    assert client.post("/competitions", json=body).status_code == 200
    assert client.post("/competitions", json=body).json()["duplicate"]
    rewards = client.get("/rewards").json()
    assert len(rewards) == 2
    assert all(r["reward_name"] == "冠军纪念杯" for r in rewards)
    assert len({r["redeem_code"] for r in rewards}) == 2
    catalog = client.get("/prize-settings").json()
    assert next(p for p in catalog["prizes"] if p["code"] == "CUSTOM_MUG")["stock"] == 1
    assert client.get(f"/users/{b}").json()["user"]["monthly_score"] == 3
    # Old names are snapshots; future configuration changes do not rename rewards.
    catalog["reason"] = "更新奖品名称"
    next(p for p in catalog["prizes"] if p["code"] == "CUSTOM_MUG")[
        "name"
    ] = "新版纪念杯"
    assert client.post("/prize-settings", json=catalog).status_code == 200
    assert all(r["reward_name"] == "冠军纪念杯" for r in client.get("/rewards").json())
    rid = rewards[0]["id"]
    assert (
        client.post(f"/rewards/{rid}/cancel", json={"reason": "撤销误发"}).status_code
        == 200
    )
    assert (
        client.post(f"/rewards/{rid}/cancel", json={"reason": "重复撤销"}).status_code
        == 409
    )
    assert (
        next(
            p
            for p in client.get("/prize-settings").json()["prizes"]
            if p["code"] == "CUSTOM_MUG"
        )["stock"]
        == 2
    )
    assert (
        client.post(f"/rewards/{rewards[1]['id']}/redeem", json={}).status_code == 200
    )
    assert (
        next(
            p
            for p in client.get("/prize-settings").json()["prizes"]
            if p["code"] == "CUSTOM_MUG"
        )["stock"]
        == 2
    )
    logs = client.get("/inventory-logs").json()
    assert len([l for l in logs if l["change"] == -1]) == 2
    assert len([l for l in logs if l["reward_id"] == rid and l["change"] == 1]) == 1


def test_insufficient_stock_rolls_back_everything_and_stale_settings(client):
    a, b, c = players(client)
    config = prize_settings(client)
    next(p for p in config["prizes"] if p["code"] == "GTO_TICKET")["stock"] = 2
    assert client.post("/prize-settings", json=config).status_code == 200
    body = {
        "request_id": "low-stock-gto-result",
        "type": "gto",
        "date": str(db.business_today()),
        "champion": a,
        "second": b,
        "third": c,
        "champion_reward": "tickets",
    }
    assert client.post("/competitions", json=body).status_code == 409
    assert client.get("/competitions").json() == []
    assert client.get("/rewards").json() == []
    assert client.get(f"/users/{a}").json()["user"]["total_score"] == 0
    config = prize_settings(client)
    assert next(p for p in config["prizes"] if p["code"] == "GTO_TICKET")["stock"] == 2
    assert (
        client.post(
            "/rewards",
            json={
                "user_id": a,
                "reward_type": "GTO_TICKET",
                "quantity": 3,
                "reason": "库存不足测试",
            },
        ).status_code
        == 409
    )
    assert client.get("/rewards").json() == []
    assert (
        client.post(
            "/rewards",
            json={
                "user_id": a,
                "reward_type": "GTO_TICKET",
                "quantity": 2,
                "reason": "批量补发",
            },
        ).status_code
        == 200
    )
    # The older settings snapshot must not overwrite the newly consumed stock.
    assert client.post("/prize-settings", json=config).status_code == 409
    assert (
        next(
            p
            for p in client.get("/prize-settings").json()["prizes"]
            if p["code"] == "GTO_TICKET"
        )["stock"]
        == 0
    )


def test_prize_configuration_validation_and_player_access(client, monkeypatch):
    config = prize_settings(client)
    next(p for p in config["prizes"] if p["code"] == "REGULAR_TICKET")[
        "enabled"
    ] = False
    assert client.post("/prize-settings", json=config).status_code == 422
    config = prize_settings(client)
    config["rules"][0]["quantity"] = 21
    assert client.post("/prize-settings", json=config).status_code == 422
    h = mini_players(client, monkeypatch, 1)[0][1]
    assert client.get("/prize-settings", headers=h).status_code == 401
    assert client.get("/inventory-logs", headers=h).status_code == 401
    assert (
        client.post(
            "/prize-settings", json=prize_settings(client), headers=h
        ).status_code
        == 401
    )


@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="MySQL inventory concurrency test"
)
def test_concurrent_stock_reservation_and_cancellation(client):
    from concurrent.futures import ThreadPoolExecutor

    uid = players(client)[0]
    config = prize_settings(client)
    next(p for p in config["prizes"] if p["code"] == "GIFT")["stock"] = 1
    assert client.post("/prize-settings", json=config).status_code == 200
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(
            pool.map(
                lambda _: client.post(
                    "/rewards",
                    json={"user_id": uid, "reward_type": "GIFT", "reason": "并发发放"},
                ).status_code,
                range(2),
            )
        )
    assert sorted(statuses) == [200, 409]
    rewards = client.get("/rewards").json()
    assert len(rewards) == 1
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(
            pool.map(
                lambda _: client.post(
                    f"/rewards/{rewards[0]['id']}/cancel", json={"reason": "并发撤销"}
                ).status_code,
                range(2),
            )
        )
    assert sorted(statuses) == [200, 409]
    assert (
        next(
            p
            for p in client.get("/prize-settings").json()["prizes"]
            if p["code"] == "GIFT"
        )["stock"]
        == 1
    )


def test_ticket_qr_staff_redemption_and_permissions(client, monkeypatch):
    from app import mini
    import qrcode

    monkeypatch.setattr(mini, "exchange_code", lambda code: "scan-" + code)
    member = client.post("/mini/auth", json={"code": "alice"}).json()
    other = client.post("/mini/auth", json={"code": "bob"}).json()
    alice = {"Authorization": "Bearer " + member["access_token"]}
    bob = {"Authorization": "Bearer " + other["access_token"]}
    uid = client.get("/mini/me", headers=alice).json()["id"]
    assert client.post("/rewards", json={"user_id": uid, "reward_type": "GTO_TICKET", "quantity": 2, "reason": "扫码测试"}).status_code == 200
    rewards = client.get("/mini/rewards", headers=alice).json()
    first, second = rewards
    path = f"/mini/rewards/{first['id']}"
    detail = client.get(path, headers=alice).json()
    qr = qrcode.QRCode(box_size=1, border=4)
    qr.add_data("NUTS:TICKET:" + detail["redeem_code"])
    qr.make(fit=True)
    assert detail["qr_matrix"] == qr.get_matrix()
    assert client.get(path, headers=bob).status_code == 404
    assert client.get(path).status_code == 401
    code_path = "/rewards?code=" + first["redeem_code"]
    redeem_path = f"/rewards/{first['id']}/redeem"
    assert client.get(code_path, headers=alice).status_code == 401
    assert client.post(redeem_path, json={}, headers=alice).status_code == 401
    scanned = client.get(code_path).json()
    assert len(scanned) == 1 and scanned[0]["user_id"] == uid
    assert scanned[0]["status"] == "pending"
    assert client.post(redeem_path, json={}).status_code == 200
    assert client.post(redeem_path, json={}).status_code == 409
    used = client.get(path, headers=alice).json()
    assert used["redeem_code"] is None and "qr_matrix" not in used
    assert client.get(f"/mini/rewards/{second['id']}", headers=alice).json()["status"] == "pending"
    assert client.post(f"/rewards/{second['id']}/cancel", json={"reason": "撤销测试"}).status_code == 200
    cancelled = client.get(f"/mini/rewards/{second['id']}", headers=alice).json()
    assert cancelled["redeem_code"] is None and "qr_matrix" not in cancelled
    assert client.post(f"/rewards/{second['id']}/redeem", json={}).status_code == 409
    with main.Session() as session:
        saved = session.get(db.Reward, first["id"])
        assert saved.redeemed_by is not None and saved.redeemed_at is not None
