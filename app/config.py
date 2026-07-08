from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment / .env (prefix ``BOS_``)."""

    model_config = SettingsConfigDict(
        env_prefix="BOS_", env_file=".env", extra="ignore"
    )

    database_url: str = "postgresql+psycopg://bos:bos@localhost:5432/bos"
    env: str = "dev"
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"
    rate_limit_per_minute: int = 120
    low_stock_renotify: bool = False

    # --- auth (Phase 2) ---
    # MUST be overridden in production via BOS_JWT_SECRET (>=32 bytes).
    jwt_secret: str = "dev-only-insecure-secret-change-me-in-production"
    jwt_algorithm: str = "HS256"
    # Shared shift device: token lasts a shift by default (12h).
    jwt_expire_minutes: int = 720
    pin_min_length: int = 4
    pin_max_length: int = 8

    # First-login setup code (admin-issued) lifetime, and brute-force lockout.
    setup_code_ttl_hours: int = 72
    login_max_attempts: int = 5
    login_lockout_minutes: int = 15

    # Browser origins allowed to call the API (the web dashboard). CSV. The
    # tablet app is React Native and not subject to CORS. Set to the deployed
    # dashboard origin in production.
    cors_origins: str = "http://localhost:5173,http://localhost:4173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
