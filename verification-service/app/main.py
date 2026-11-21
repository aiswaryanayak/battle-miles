from fastapi import FastAPI

from .routes import router

app = FastAPI(
    title="BATTLE MILES Screenshot Analysis",
    description="Local-only heuristic screenshot analysis for future admin verification.",
    version="1.0.0",
)
app.include_router(router)
