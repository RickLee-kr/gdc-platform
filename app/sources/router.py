"""Source HTTP routes — placeholder responses only."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_sources() -> dict[str, str]:
    return {"message": "placeholder list sources"}


@router.post("/")
async def create_source() -> dict[str, str]:
    return {"message": "placeholder create source"}


@router.get("/{source_id}")
async def get_source(source_id: int) -> dict[str, str]:
    return {"message": f"placeholder get source {source_id}"}


@router.put("/{source_id}")
async def update_source(source_id: int) -> dict[str, str]:
    return {"message": f"placeholder update source {source_id}"}


@router.delete("/{source_id}")
async def delete_source(source_id: int) -> dict[str, str]:
    return {"message": f"placeholder delete source {source_id}"}
