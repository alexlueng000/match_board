"""Add optional unique WeChat identity without changing existing players."""

from alembic import op
import sqlalchemy as sa

revision = "b2917a6c4d10"
down_revision = "a3286ea6485e"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("openid", sa.String(128), nullable=True))
    op.create_unique_constraint("uq_users_openid", "users", ["openid"])


def downgrade():
    op.drop_constraint("uq_users_openid", "users", type_="unique")
    op.drop_column("users", "openid")
