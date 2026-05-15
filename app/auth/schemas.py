"""Auth request/response schemas — login/token placeholders."""

from pydantic import BaseModel, Field


class Token(BaseModel):
    """JWT access token placeholder."""

    access_token: str = Field(description="Bearer token")
    token_type: str = Field(default="bearer")


class LoginRequest(BaseModel):
    """Admin login payload placeholder."""

    username: str
    password: str
