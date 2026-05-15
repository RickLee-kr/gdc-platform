"""Mapping HTTP routes — placeholder responses only."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_mappings() -> dict[str, str]:
    return {"message": "placeholder list mappings"}


@router.post("/")
async def create_mapping() -> dict[str, str]:
    return {"message": "placeholder create mapping"}


@router.get("/{mapping_id}")
async def get_mapping(mapping_id: int) -> dict[str, str]:
    return {"message": f"placeholder get mapping {mapping_id}"}


@router.put("/{mapping_id}")
async def update_mapping(mapping_id: int) -> dict[str, str]:
    return {"message": f"placeholder update mapping {mapping_id}"}


@router.delete("/{mapping_id}")
async def delete_mapping(mapping_id: int) -> dict[str, str]:
    return {"message": f"placeholder delete mapping {mapping_id}"}
