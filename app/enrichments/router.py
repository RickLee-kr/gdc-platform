"""Enrichment HTTP routes — placeholder responses only."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_enrichments() -> dict[str, str]:
    return {"message": "placeholder list enrichments"}


@router.post("/")
async def create_enrichment() -> dict[str, str]:
    return {"message": "placeholder create enrichment"}


@router.get("/{enrichment_id}")
async def get_enrichment(enrichment_id: int) -> dict[str, str]:
    return {"message": f"placeholder get enrichment {enrichment_id}"}


@router.put("/{enrichment_id}")
async def update_enrichment(enrichment_id: int) -> dict[str, str]:
    return {"message": f"placeholder update enrichment {enrichment_id}"}


@router.delete("/{enrichment_id}")
async def delete_enrichment(enrichment_id: int) -> dict[str, str]:
    return {"message": f"placeholder delete enrichment {enrichment_id}"}
