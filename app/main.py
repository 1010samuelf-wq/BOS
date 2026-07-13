import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app import __version__
from app.api.v1.router import api_router
from app.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import RequestLogMiddleware, configure_logging
from app.core.ratelimit import RateLimitMiddleware
from app.core.realtime import broadcaster


class ProxyFormPathNormalizer:
    """Accept HTTP requests whose target is in *absolute form*.

    A client configured to use a proxy (e.g. the shop tablets behind their
    content-filter, whose Android proxy/VPN forwards some requests untouched)
    sends ``GET http://host:port/path`` instead of the normal ``GET /path``.
    ASGI then reports ``scope["path"]`` as the whole URL, and routing 404s on
    the literal string. Strip the scheme + authority so the app routes on the
    real path. No-op for normal (origin-form) requests, so it's inert in prod
    for well-behaved clients — it only rewrites paths that start with a scheme.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            path = scope.get("path", "")
            if path.startswith(("http://", "https://")):
                after_scheme = path.split("://", 1)[1]
                slash = after_scheme.find("/")
                new_path = after_scheme[slash:] if slash != -1 else "/"
                scope = dict(scope)
                scope["path"] = new_path
                scope["raw_path"] = new_path.encode("latin-1")
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Capture the running loop so sync request threads can schedule WS pushes.
    broadcaster.set_loop(asyncio.get_running_loop())
    yield


def create_app() -> FastAPI:
    configure_logging()
    settings = get_settings()

    app = FastAPI(
        title="Bakery Operations System API",
        version=__version__,
        description="Backend for the Bakery Operations System (BOS).",
        lifespan=lifespan,
    )

    app.add_middleware(RequestLogMiddleware)
    app.add_middleware(RateLimitMiddleware)
    # CORS added last → outermost, so browser preflight (OPTIONS) is answered
    # before auth/rate-limit. Lets the web dashboard call the API cross-origin;
    # the React Native tablet isn't subject to CORS. (spec §1 — same API, both
    # clients.)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    register_error_handlers(app)

    @app.get("/", include_in_schema=False)
    def root():
        # Land on the interactive docs instead of a bare 404.
        return RedirectResponse(url="/docs")

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


# Wrap outermost so absolute-form request targets are normalised before anything
# else (routing, logging, rate limit) sees them.
app = ProxyFormPathNormalizer(create_app())
