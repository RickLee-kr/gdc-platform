"""Route HTTP routes — placeholder responses only."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_routes() -> dict[str, str]:
    return {"message": "placeholder list routes"}


@router.post("/")
async def create_route() -> dict[str, str]:
    return {"message": "placeholder create route"}


@router.get("/{route_id}")
async def get_route(route_id: int) -> dict[str, str]:
    return {"message": f"placeholder get route {route_id}"}


@router.put("/{route_id}")
async def update_route(route_id: int) -> dict[str, str]:
    return {"message": f"placeholder update route {route_id}"}


@router.delete("/{route_id}")
async def delete_route(route_id: int) -> dict[str, str]:
    return {"message": f"placeholder delete route {route_id}"}
