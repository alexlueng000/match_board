"""Admin account operations performed by the deployment owner."""

import argparse
import getpass
from sqlalchemy import select
from pwdlib import PasswordHash
from .db import Admin, Session


def main():
    parser = argparse.ArgumentParser(description="管理后台账号维护")
    parser.add_argument("action", choices=["create-admin", "reset-password"])
    parser.add_argument("username")
    args = parser.parse_args()
    if not 1 <= len(args.username) <= 80:
        parser.error("账号长度须为1至80个字符")
    password = getpass.getpass("新密码（1至256位）: ")
    if not 1 <= len(password) <= 256:
        parser.error("密码长度须为1至256位")
    if password != getpass.getpass("再次输入新密码: "):
        parser.error("两次密码不一致")
    with Session.begin() as db:
        account = db.scalar(
            select(Admin).where(Admin.username == args.username).with_for_update()
        )
        if args.action == "create-admin":
            if account:
                parser.error("账号已存在")
            db.add(
                Admin(
                    username=args.username,
                    password_hash=PasswordHash.recommended().hash(password),
                )
            )
        else:
            if not account:
                parser.error("账号不存在")
            account.password_hash = PasswordHash.recommended().hash(password)
            account.token_version += 1
            account.failed_attempts = 0
            account.locked_until = None
    print("账号已更新。密码重置后原有登录令牌失效。")


if __name__ == "__main__":
    main()
