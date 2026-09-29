from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from dtat import __version__
from dtat.audit.router import router as audit_router
from dtat.auth.deps import DbSession
from dtat.auth.router import router as auth_router
from dtat.config import get_settings
from dtat.errors import DomainError
from dtat.inventory.excel_router import router as excel_router
from dtat.inventory.router import router as inventory_router
from dtat.kpi.router import router as kpi_router
from dtat.maps.router import router as maps_router


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="DT Analysis Tool",
        version=__version__,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )

    @app.exception_handler(DomainError)
    def handle_domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content={"detail": exc.message, "field": exc.field}
        )

    api = APIRouter(prefix="/api/v1")
    api.include_router(auth_router)
    api.include_router(inventory_router)
    api.include_router(excel_router)
    api.include_router(maps_router)
    api.include_router(audit_router)
    api.include_router(kpi_router)
    app.include_router(api)

    @app.get("/api/health", tags=["system"])
    def health(session: DbSession) -> dict[str, str]:
        session.execute(text("SELECT 1"))
        return {"status": "ok", "version": __version__, "build": settings.build}

    # In production nginx serves /tiles; this is for local development without nginx.
    if settings.serve_tiles and settings.tiles_dir.is_dir():
        app.mount("/tiles", StaticFiles(directory=settings.tiles_dir), name="tiles")

    return app


app = create_app()
