import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "test-secret-that-is-at-least-32-characters")
os.environ.setdefault("ADMIN_PASSWORD", "test-password-123456")
from sqlalchemy import create_engine, select, func
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from app import db, main
import pytest


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


def players(c):
    return [
        c.post("/users", json={"nickname": n}).json()["id"]
        for n in ["玩家甲", "玩家乙", "玩家丙"]
    ]


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
