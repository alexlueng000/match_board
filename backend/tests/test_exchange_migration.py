"""Exercise the upgrade against a disposable database containing old data."""
import os
import subprocess
import sys
from pathlib import Path
from sqlalchemy import create_engine, text, inspect, MetaData


def test_exchange_migration_preserves_existing_members_points_and_stock(tmp_path):
    url = "sqlite:///" + str(tmp_path / "migration.sqlite3").replace("\\", "/")
    env = {**os.environ, "DATABASE_URL": url, "JWT_SECRET": "migration-test-secret-at-least-32-characters", "ADMIN_PASSWORD": "migration-password"}
    root = Path(__file__).resolve().parents[1]
    def migrate(action, revision):
        result = subprocess.run([sys.executable, "-m", "alembic", action, revision], cwd=root, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    engine = create_engine(url)
    # Historical migrations target MySQL ALTER CONSTRAINT. Recreate the previous
    # schema in this disposable SQLite database, then exercise the new upgrade.
    from app.db import Base
    legacy = MetaData()
    for table in Base.metadata.sorted_tables:
        if table.name != "exchange_orders":
            table.to_metadata(legacy)
    legacy.tables["prizes"]._columns.remove(legacy.tables["prizes"].c.exchange_points)
    legacy.tables["prizes"]._columns.remove(legacy.tables["prizes"].c.deleted)
    legacy.tables["rewards"].c.operated_by.nullable = False
    legacy.tables["inventory_logs"].c.operator_id.nullable = False
    legacy.create_all(engine)
    migrate("stamp", "c8a9d230e715")
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO admins (id,username,password_hash,token_version,failed_attempts) VALUES (1,'migration-admin','test-hash',0,0)"))
        connection.execute(text("INSERT INTO users (id,member_code,nickname,created_at) VALUES (1,'OLD001','existing-member','2026-10-01 12:00:00')"))
        connection.execute(text("INSERT INTO prizes (code,name,enabled,stock,version) VALUES ('REGULAR_TICKET','old-ticket',1,7,2)"))
        connection.execute(text("INSERT INTO point_logs (user_id,month_key,points_change,source_type,remark,operator_id,created_at) VALUES (1,'2026-10',12,'manual_adjust','old-points',1,'2026-10-01 12:00:00')"))
    engine.dispose()
    migrate("upgrade", "head")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT nickname FROM users WHERE id=1")).scalar() == "existing-member"
        assert connection.execute(text("SELECT SUM(points_change) FROM point_logs WHERE user_id=1")).scalar() == 12
        assert tuple(connection.execute(text("SELECT stock,version,exchange_points FROM prizes WHERE code='REGULAR_TICKET'")).one()) == (7, 2, 5)
    assert "exchange_orders" in inspect(engine).get_table_names()
    engine.dispose()
