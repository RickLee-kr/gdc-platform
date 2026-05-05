"""Stream HTTP routes — includes start/stop (execution is always stream-scoped)."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_streams() -> dict[str, str]:
    return {"message": "placeholder list streams"}


@router.post("/")
async def create_stream() -> dict[str, str]:
    return {"message": "placeholder create stream"}


@router.get("/{stream_id}")
async def get_stream(stream_id: int) -> dict[str, str]:
    return {"message": f"placeholder get stream {stream_id}"}


@router.put("/{stream_id}")
async def update_stream(stream_id: int) -> dict[str, str]:
    return {"message": f"placeholder update stream {stream_id}"}


@router.delete("/{stream_id}")
async def delete_stream(stream_id: int) -> dict[str, str]:
    return {"message": f"placeholder delete stream {stream_id}"}


@router.post("/{stream_id}/start")
async def start_stream(stream_id: int) -> dict[str, str]:
    return {"message": f"placeholder start stream {stream_id}"}


@router.post("/{stream_id}/stop")
async def stop_stream(stream_id: int) -> dict[str, str]:
    return {"message": f"placeholder stop stream {stream_id}"}
