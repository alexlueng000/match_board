"""Read-only deployment smoke checks. Never prints passwords or access tokens."""

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import httpx
from dotenv import dotenv_values

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://localhost:3000/api")
args = parser.parse_args()
config = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
with httpx.Client(base_url=args.base_url, timeout=15, trust_env=False) as client:
    response = client.get("/health")
    assert (
        response.status_code == 200 and response.json()["status"] == "ok"
    ), "API健康检查失败"
    response = client.get("/users")
    assert response.status_code in (401, 403), "未登录请求未被拒绝"
    response = client.post(
        "/auth/login",
        json={
            "username": config.get("ADMIN_USERNAME", "admin"),
            "password": config["ADMIN_PASSWORD"],
        },
    )
    assert response.status_code == 200, "初始管理员登录失败"
    client.headers["Authorization"] = "Bearer " + response.json()["access_token"]
    for path in [
        "/users",
        "competitions",
        "sessions",
        "mini/sessions",
        "rewards",
        "rankings",
        "dashboard",
        "settings",
        "reward-types",
        "prize-settings",
        "inventory-logs",
    ]:
        response = client.get(path)
        assert response.status_code == 200, f"{path} 访问失败: {response.status_code}"
        response.json()
        print(f"PASS {path}")
    print("PASS health, authentication and authenticated API through Next.js proxy")
