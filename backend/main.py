from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import create_all
from routers import refills, dashboard, shipping, patients, projections

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


@app.on_event("startup")
def startup():
    create_all()


@app.get("/api/health")
def health():
    return {"status": "ok"}
