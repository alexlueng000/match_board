"""Bind WeChat members to revocable administrator identities."""
from alembic import op
import sqlalchemy as sa
revision = "f96dc14a832b"
down_revision = "e85cb03f721a"
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("admin_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("admin_granted_by", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("admin_changed_at", sa.DateTime(), nullable=True))
        batch.create_foreign_key("fk_users_admin_id", "admins", ["admin_id"], ["id"])
        batch.create_foreign_key("fk_users_admin_granted_by", "admins", ["admin_granted_by"], ["id"])
        batch.create_unique_constraint("uq_users_admin_id", ["admin_id"])

def downgrade():
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_users_admin_id", type_="unique")
        batch.drop_constraint("fk_users_admin_granted_by", type_="foreignkey")
        batch.drop_constraint("fk_users_admin_id", type_="foreignkey")
        batch.drop_column("admin_changed_at")
        batch.drop_column("admin_granted_by")
        batch.drop_column("admin_id")
