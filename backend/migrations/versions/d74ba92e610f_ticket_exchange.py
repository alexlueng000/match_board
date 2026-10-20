"""Add ticket exchange prices and immutable member exchange history."""
from alembic import op
import sqlalchemy as sa

revision = "d74ba92e610f"
down_revision = "c8a9d230e715"
branch_labels = None
depends_on = None

PRICES = {"REGULAR_TICKET": 5, "REGULAR_50_OFF": 3, "REGULAR_70_OFF": 1, "GTO_TICKET": 6, "GTO_50_OFF": 2}

def upgrade():
    op.add_column("prizes", sa.Column("exchange_points", sa.Integer(), nullable=True))
    for code, points in PRICES.items():
        op.execute(sa.text("UPDATE prizes SET exchange_points = :points WHERE code = :code").bindparams(points=points, code=code))
    with op.batch_alter_table("rewards") as batch:
        batch.alter_column("operated_by", existing_type=sa.Integer(), nullable=True)
    with op.batch_alter_table("inventory_logs") as batch:
        batch.alter_column("operator_id", existing_type=sa.Integer(), nullable=True)
    op.create_table("exchange_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", sa.String(80), nullable=False),
        sa.Column("prize_code", sa.String(40), sa.ForeignKey("prizes.code"), nullable=False),
        sa.Column("reward_id", sa.Integer(), sa.ForeignKey("rewards.id"), nullable=False, unique=True),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("refunded_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "request_id", name="uq_exchange_request"))
    op.create_index("ix_exchange_orders_user_id", "exchange_orders", ["user_id"])

def downgrade():
    op.drop_table("exchange_orders")
    # Keep nullable operators: historical member exchanges have no admin operator.
    op.drop_column("prizes", "exchange_points")
