from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, read from environment variables with the DTAT_ prefix."""

    model_config = SettingsConfigDict(env_prefix="DTAT_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://dtat:dtat@localhost:5432/dtat"

    # JWT signing key. Must be overridden in production (see deploy/.env.example).
    secret_key: str = Field(default="dev-insecure-secret-change-me", min_length=16)
    access_token_ttl_minutes: int = 12 * 60
    # Set to false only for plain-HTTP development setups.
    cookie_secure: bool = True

    # Directory with .pmtiles basemaps. Served by nginx in production, by the API in development.
    tiles_dir: Path = Path("/srv/tiles")
    serve_tiles: bool = False

    # Optional bootstrap admin, created by `dtat bootstrap` if no users exist yet.
    initial_admin_username: str = "admin"
    initial_admin_password: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
