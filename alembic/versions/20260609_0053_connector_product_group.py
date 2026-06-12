"""M31.1 — connector.product_group metadata + heuristic backfill."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.connectors.product_group import infer_product_group_from_connector_name

revision = "20260609_0053_product_group"
down_revision = "20260609_0052_replay_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("connectors", sa.Column("product_group", sa.String(length=128), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, name FROM connectors ORDER BY id ASC")).fetchall()
    for row in rows:
        product_group = infer_product_group_from_connector_name(str(row.name or ""))
        if not product_group:
            continue
        conn.execute(
            sa.text("UPDATE connectors SET product_group = :product_group WHERE id = :id"),
            {"product_group": product_group, "id": int(row.id)},
        )


def downgrade() -> None:
    op.drop_column("connectors", "product_group")
