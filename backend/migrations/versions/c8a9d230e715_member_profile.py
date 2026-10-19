"""Persist member avatars and profile consent without replacing existing users."""

from alembic import op
import sqlalchemy as sa

revision = "c8a9d230e715"
down_revision = "fddde23ab76f"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("avatar_url", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("profile_consented_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("users", "profile_consented_at")
    op.drop_column("users", "avatar_url")
