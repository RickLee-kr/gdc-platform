"""FastAPI application entry — Generic Data Connector Platform API."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.config import settings
from app.connectors.router import router as connectors_router
from app.delivery.router import router as delivery_router
from app.destinations.router import router as destinations_router
from app.enrichments.router import router as enrichments_router
from app.logs.router import router as logs_router
from app.mappings.router import router as mappings_router
from app.routes.router import router as routes_router
from app.runtime.router import router as runtime_router
from app.sources.router import router as sources_router
from app.streams.router import router as streams_router

app = FastAPI(
    title="Generic Data Connector Platform API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_prefix = settings.API_PREFIX

app.include_router(auth_router, prefix=f"{_prefix}/auth", tags=["auth"])
app.include_router(connectors_router, prefix=f"{_prefix}/connectors", tags=["connectors"])
app.include_router(sources_router, prefix=f"{_prefix}/sources", tags=["sources"])
app.include_router(streams_router, prefix=f"{_prefix}/streams", tags=["streams"])
app.include_router(mappings_router, prefix=f"{_prefix}/mappings", tags=["mappings"])
app.include_router(enrichments_router, prefix=f"{_prefix}/enrichments", tags=["enrichments"])
app.include_router(destinations_router, prefix=f"{_prefix}/destinations", tags=["destinations"])
app.include_router(routes_router, prefix=f"{_prefix}/routes", tags=["routes"])
app.include_router(logs_router, prefix=f"{_prefix}/logs", tags=["logs"])
app.include_router(runtime_router, prefix=f"{_prefix}/runtime", tags=["runtime"])
app.include_router(delivery_router, prefix=f"{_prefix}/delivery", tags=["delivery"])


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness/readiness probe for reverse proxies and orchestrators."""

    return {"status": "ok"}
