"""restore delivery_logs connector_id index for FK deletes

Revision ID: 20260804_0062
Revises: 20260630_0061
Create Date: 2026-08-04

FK checks on DELETE /connectors scanned every delivery_logs partition
without an index on connector_id (dropped by 38c714bcd7dd), causing
multi-second to multi-minute deletes that starved the lab HTTP worker.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260804_0062"
down_revision = "20260630_0061"
branch_labels = None
depends_on = None


def _partition_children(bind) -> list[str]:
    rows = bind.execute(
        sa.text(
            """
            SELECT c.relname
            FROM pg_inherits i
            JOIN pg_class c ON c.oid = i.inhrelid
            JOIN pg_class p ON p.oid = i.inhparent
            WHERE p.relname = 'delivery_logs'
            ORDER BY c.relname
            """
        )
    ).fetchall()
    return [str(r[0]) for r in rows]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    parent_indexes = {i["name"] for i in inspector.get_indexes("delivery_logs")}
    if "ix_delivery_logs_connector_id" not in parent_indexes:
        # Parent partition index (ON ONLY); children attached below.
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_delivery_logs_connector_id "
                "ON ONLY delivery_logs (connector_id)"
            )
        )

    for child in _partition_children(bind):
        child_idx = f"{child}_connector_id_idx"
        child_indexes = {i["name"] for i in inspector.get_indexes(child)}
        if child_idx not in child_indexes:
            op.execute(
                sa.text(f"CREATE INDEX IF NOT EXISTS {child_idx} ON {child} (connector_id)")
            )
        # Attach when not already a partition of the parent index.
        op.execute(
            sa.text(
                f"""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1
                    FROM pg_inherits i
                    JOIN pg_class c ON c.oid = i.inhrelid
                    JOIN pg_class p ON p.oid = i.inhparent
                    WHERE c.relname = '{child_idx}'
                      AND p.relname = 'ix_delivery_logs_connector_id'
                  ) THEN
                    ALTER INDEX ix_delivery_logs_connector_id ATTACH PARTITION {child_idx};
                  END IF;
                END $$;
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    for child in _partition_children(bind):
        child_idx = f"{child}_connector_id_idx"
        op.execute(sa.text(f"DROP INDEX IF EXISTS {child_idx}"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_delivery_logs_connector_id"))
