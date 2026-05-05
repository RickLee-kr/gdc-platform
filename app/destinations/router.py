"""Destination HTTP routes — placeholder responses only."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_destinations() -> dict[str, str]:
    return {"message": "placeholder list destinations"}


@router.post("/")
async def create_destination() -> dict[str, str]:
    return {"message": "placeholder create destination"}


@router.get("/{destination_id}")
async def get_destination(destination_id: int) -> dict[str, str]:
    return {"message": f"placeholder get destination {destination_id}"}


@router.put("/{destination_id}")
async def update_destination(destination_id: int) -> dict[str, str]:
    return {"message": f"placeholder update destination {destination_id}"}


@router.delete("/{destination_id}")
async def delete_destination(destination_id: int) -> dict[str, str]:
    return {"message": f"placeholder delete destination {destination_id}"}
