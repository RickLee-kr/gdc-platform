"""Logs HTTP routes — placeholder list."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_logs() -> dict[str, str]:
    return {"message": "placeholder list logs"}
