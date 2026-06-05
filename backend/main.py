from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from database import create_all, engine
from routers import refills, dashboard, shipping, patients, projections, reports

app = FastAPI(title="Osiris by BlueBird API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(refills.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(shipping.router, prefix="/api")
app.include_router(patients.router, prefix="/api")
app.include_router(projections.router, prefix="/api")
app.include_router(reports.router, prefix="/api")


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


@app.get("/api/health")
def health():
    return {"status": "ok"}
