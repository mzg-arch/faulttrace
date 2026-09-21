"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import equipment, health, team
from app.settings import get_settings


logger = logging.getLogger("faulttrace.startup")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.validate_backend()
    logger.info("FaultTrace backend configuration validated")
    yield


app = FastAPI(title="FaultTrace API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(health.router)
app.include_router(team.router)
app.include_router(equipment.router)
