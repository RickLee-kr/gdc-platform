"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment / .env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "Generic Data Connector Platform API"
    APP_ENV: str = "development"
    API_PREFIX: str = "/api/v1"
    DATABASE_URL: str = "postgresql://gdc:gdc@localhost:5432/gdc"
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ENCRYPTION_KEY: str = "replace-with-fernet-or-aes-key-placeholder"
    DEFAULT_COLLECTOR_NAME: str = "generic-connector-01"


settings = Settings()
