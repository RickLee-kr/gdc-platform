"""Auth HTTP routes — no real authentication in skeleton phase."""

from fastapi import APIRouter

router = APIRouter()


@router.post("/login")
async def login() -> dict[str, str]:
    """Placeholder: exchange credentials for JWT."""

    return {"message": "placeholder login"}
