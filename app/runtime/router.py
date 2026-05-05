"""Runtime status API placeholders."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/status")
async def get_runtime_status() -> dict[str, str]:
    """Placeholder: aggregate scheduler/runner status for UI."""

    return {"message": "placeholder runtime status"}
