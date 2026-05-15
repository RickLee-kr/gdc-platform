"""Delivery subsystem introspection — optional health/debug endpoints."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def delivery_root() -> dict[str, str]:
    """Placeholder for delivery subsystem status."""

    return {"message": "placeholder delivery subsystem"}
