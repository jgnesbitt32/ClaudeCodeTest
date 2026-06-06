import os
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from database import create_all, engine, get_db
from routers import refills, dashboard, shipping, patients, projections, reports
from routers.auth import get_current_user, router as auth_router, seed_default_users

app = FastAPI(title="Osiris by BlueBird API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth routes are public (login doesn't require a token)
app.include_router(auth_router, prefix="/api")

# All other routes require a valid JWT
_protected = {"dependencies": [Depends(get_current_user)]}
app.include_router(refills.router,     prefix="/api", **_protected)
app.include_router(dashboard.router,   prefix="/api", **_protected)
app.include_router(shipping.router,    prefix="/api", **_protected)
app.include_router(patients.router,    prefix="/api", **_protected)
app.include_router(projections.router, prefix="/api", **_protected)
app.include_router(reports.router,     prefix="/api", **_protected)


@app.on_event("startup")
def startup():
    create_all()
    with engine.connect() as conn:
        for ddl in [
            "CREATE INDEX IF NOT EXISTS ix_disp_date ON dispense(date_completed)",
            "CREATE INDEX IF NOT EXISTS ix_disp_date_cat ON dispense(date_completed, category)",
            "CREATE INDEX IF NOT EXISTS ix_disp_ptsn_drug ON dispense(ptsn, drug)",
            "CREATE INDEX IF NOT EXISTS ix_disp_cat ON dispense(category)",
            "CREATE INDEX IF NOT EXISTS ix_refill_bucket ON refill(bucket)",
            "CREATE INDEX IF NOT EXISTS ix_refill_ncd ON refill(next_call_date)",
        ]:
            conn.execute(text(ddl))
        conn.commit()
    # Seed default users if none exist
    db = next(get_db())
    try:
        seed_default_users(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve built React frontend (production only — skipped in local dev when dist/ doesn't exist)
_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_dist):
    # Serve static assets (JS, CSS, images) from /assets/
    app.mount("/assets", StaticFiles(directory=os.path.join(_dist, "assets")), name="assets")

    # SPA catch-all: serve index.html for any non-API path so React Router handles routing
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        index = os.path.join(_dist, "index.html")
        return FileResponse(index)
