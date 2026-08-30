from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolved from this file rather than the process CWD: the dev server and the
# test runner are launched from different directories, and a CWD-relative
# ".env" is silently ignored from the wrong one.
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


INSECURE_JWT_SECRET = "dev-only-insecure-secret-change-me-in-production"


class Settings(BaseSettings):
    """Runtime configuration, read from environment / .env (prefix ``BOS_``)."""

    model_config = SettingsConfigDict(
        env_prefix="BOS_", env_file=ENV_FILE, extra="ignore"
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

    # --- assistant ---
    # Empty key disables the assistant entirely (every endpoint 503s) so the
    # feature is opt-in and the rest of the API is unaffected when it is unset.
    anthropic_api_key: str = ""
    assistant_model: str = "claude-opus-5"
    assistant_effort: str = "medium"   # low | medium | high | xhigh | max
    assistant_max_tokens: int = 16000

    def validate_for_runtime(self) -> None:
        if self.env.lower() in {"prod", "production"}:
            if self.jwt_secret == INSECURE_JWT_SECRET or len(self.jwt_secret.encode()) < 32:
                raise ValueError("BOS_JWT_SECRET must be a unique value of at least 32 bytes in production.")
            if not self.database_url.startswith(("postgresql://", "postgresql+psycopg://")):
                raise ValueError("BOS_DATABASE_URL must use PostgreSQL in production.")
            if any(origin.startswith(("http://localhost", "http://127.0.0.1")) for origin in self.cors_origin_list):
                raise ValueError("BOS_CORS_ORIGINS must not include local development origins in production.")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
