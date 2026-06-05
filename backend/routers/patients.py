from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Dispense, Refill, Shipping
from schemas import RefillOut, ShippingOut

router = APIRouter(prefix="/patients", tags=["patients"])


class PatientSummary(BaseModel):
    ptsn: str
    patient: str
    pharmacy: str | None
    category: str | None
    last_fill_date: date | None
    current_status: str | None
    drug_count: int
    total_tp: float


class PatientProfile(BaseModel):
    ptsn: str
    patient: str
    pharmacy: str | None
    category: str | None
    prescriber: str | None
    rep: str | None
    plan_type: str | None
    total_fills: int
    first_fill_date: date | None
    last_fill_date: date | None
    total_tp: float


class PatientDetail(BaseModel):
    profile: PatientProfile
    refills: list[RefillOut]
    shipping: list[ShippingOut]
    notes: list[dict]


@router.get("", response_model=list[PatientSummary])
def list_patients(
    search: Optional[str] = None,
    pharmacy: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # Build from refill table (one row per patient+drug) joined with latest dispense
    # Group by ptsn to get one row per patient
    subq = (
        db.query(
            Refill.ptsn,
            func.max(Refill.patient).label("patient"),
            func.max(Refill.pharmacy).label("pharmacy"),
            func.max(Refill.category).label("category"),
            func.max(Refill.current_status).label("current_status"),
            func.count(Refill.id).label("drug_count"),
            func.sum(Refill.tp).label("total_tp"),
        )
        .group_by(Refill.ptsn)
        .subquery()
    )

    # Get last fill date from dispense table
    disp_subq = (
        db.query(
            Dispense.ptsn,
            func.max(Dispense.date_completed).label("last_fill_date"),
        )
        .group_by(Dispense.ptsn)
        .subquery()
    )

    rows = db.query(subq, disp_subq.c.last_fill_date).outerjoin(
        disp_subq, subq.c.ptsn == disp_subq.c.ptsn
    ).all()

    results = []
    for row in rows:
        ptsn = row.ptsn
        patient = row.patient or ""
        pharm = row.pharmacy
        cat = row.category

        if search:
            term = search.lower()
            if term not in patient.lower() and term not in ptsn.lower():
                continue
        if pharmacy and pharm != pharmacy:
            continue
        if category and cat != category:
            continue

        results.append(PatientSummary(
            ptsn=ptsn,
            patient=patient,
            pharmacy=pharm,
            category=cat,
            last_fill_date=row.last_fill_date,
            current_status=row.current_status,
            drug_count=row.drug_count or 0,
            total_tp=float(row.total_tp or 0),
        ))

    results.sort(key=lambda r: r.patient)
    return results


@router.get("/{ptsn}", response_model=PatientDetail)
def get_patient(ptsn: str, db: Session = Depends(get_db)):
    refills = db.query(Refill).filter(Refill.ptsn == ptsn).order_by(Refill.next_call_date).all()
    if not refills:
        raise HTTPException(status_code=404, detail="Patient not found")

    shipping = (
        db.query(Shipping)
        .filter(Shipping.ptsn == ptsn)
        .order_by(Shipping.shipping_date.desc())
        .all()
    )

    # Profile from dispense table
    dispenses = db.query(Dispense).filter(Dispense.ptsn == ptsn).all()
    latest = max(dispenses, key=lambda d: d.date_completed or date.min) if dispenses else None

    profile = PatientProfile(
        ptsn=ptsn,
        patient=refills[0].patient,
        pharmacy=refills[0].pharmacy,
        category=latest.category if latest else refills[0].category,
        prescriber=latest.prescriber if latest else None,
        rep=latest.rep if latest else None,
        plan_type=latest.plan_type if latest else None,
        total_fills=len(dispenses),
        first_fill_date=min((d.date_completed for d in dispenses if d.date_completed), default=None),
        last_fill_date=max((d.date_completed for d in dispenses if d.date_completed), default=None),
        total_tp=float(sum(d.tp or 0 for d in dispenses)),
    )

    # Notes: collect non-empty notes from refill records
    notes = [
        {"drug": r.drug, "note": r.notes, "updated_at": r.updated_at.isoformat() if r.updated_at else None}
        for r in refills
        if r.notes
    ]

    return PatientDetail(
        profile=profile,
        refills=[RefillOut.model_validate(r) for r in refills],
        shipping=[ShippingOut.model_validate(s) for s in shipping],
        notes=notes,
    )
