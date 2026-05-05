"""Connector HTTP routes — placeholder responses only."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_connectors() -> dict[str, str]:
    return {"message": "placeholder list connectors"}


@router.post("/")
async def create_connector() -> dict[str, str]:
    return {"message": "placeholder create connector"}


@router.get("/{connector_id}")
async def get_connector(connector_id: int) -> dict[str, str]:
    return {"message": f"placeholder get connector {connector_id}"}


@router.put("/{connector_id}")
async def update_connector(connector_id: int) -> dict[str, str]:
    return {"message": f"placeholder update connector {connector_id}"}


@router.delete("/{connector_id}")
async def delete_connector(connector_id: int) -> dict[str, str]:
    return {"message": f"placeholder delete connector {connector_id}"}
