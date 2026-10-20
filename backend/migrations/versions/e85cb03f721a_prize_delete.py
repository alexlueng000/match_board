"""Allow prizes to be removed while retaining reward and inventory history."""
from alembic import op
import sqlalchemy as sa
revision = "e85cb03f721a"
down_revision = "d74ba92e610f"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("prizes", sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade():
    op.drop_column("prizes", "deleted")
