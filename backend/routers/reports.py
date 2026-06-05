"""
Reports: historical dispense data with summary stats, trend chart, and CSV export.
"""
import csv
import io
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Dispense

router = APIRouter(prefix="/reports", tags=["reports"])


# ── Pydantic models ───────────────────────────────────────────────────────────
class MonthlyTrendPoint(BaseModel):
    month: str
    tp: float
    dispenses: int


class CategoryBreakdown(BaseModel):
    category: str
    tp: float
    dispenses: int
    pct: float


class RepBreakdown(BaseModel):
    rep: str
    tp: float
    dispenses: int


class ReportSummary(BaseModel):
    total_tp: float
    total_dispenses: int
    unique_patients: int
    avg_tp: float
    monthly_trend: list[MonthlyTrendPoint]
    by_category: list[CategoryBreakdown]
    by_rep: list[RepBreakdown]


class DispenseRow(BaseModel):
    id: int
    date_completed: Optional[date]
    patient: Optional[str]
    ptsn: Optional[str]
    drug: Optional[str]
    category: Optional[str]
    pharmacy: Optional[str]
    rep: Optional[str]
    rx_number: Optional[str]
    refill_no: Optional[int]
    days_supply: Optional[int]
    disp_qty: Optional[float]
    tp: Optional[float]
    gp: Optional[float]
    plan_type: Optional[str]
    prescriber: Optional[str]
    bill_month: Optional[str]


class DispensePage(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[DispenseRow]


# ── Shared filter helper ──────────────────────────────────────────────────────
def _apply_filters(q, date_from, date_to, pharmacy, category, rep, search):
    if date_from:
        q = q.filter(Dispense.date_completed >= date_from)
    if date_to:
        q = q.filter(Dispense.date_completed <= date_to)
    if pharmacy:
        q = q.filter(Dispense.pharmacy == pharmacy)
    if category:
        q = q.filter(Dispense.category == category)
    if rep:
        q = q.filter(Dispense.rep == rep)
    if search:
        like = f"%{search}%"
        q = q.filter(
            Dispense.patient.ilike(like) | Dispense.drug.ilike(like) | Dispense.ptsn.ilike(like)
        )
    return q


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/summary", response_model=ReportSummary)
def get_summary(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    pharmacy: Optional[str] = None,
    category: Optional[str] = None,
    rep: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    base = _apply_filters(db.query(Dispense), date_from, date_to, pharmacy, category, rep, search)

    agg = base.with_entities(
        func.count(Dispense.id),
        func.sum(Dispense.tp),
        func.count(func.distinct(Dispense.ptsn)),
    ).first()

    total_disp = agg[0] or 0
    total_tp = float(agg[1] or 0)
    unique_pts = agg[2] or 0
    avg_tp = (total_tp / total_disp) if total_disp > 0 else 0.0

    # Monthly trend
    trend_rows = (
        _apply_filters(db.query(Dispense), date_from, date_to, pharmacy, category, rep, search)
        .with_entities(
            func.strftime("%Y-%m", Dispense.date_completed).label("month"),
            func.sum(Dispense.tp),
            func.count(Dispense.id),
        )
        .group_by("month")
        .order_by("month")
        .all()
    )
    monthly_trend = [
        MonthlyTrendPoint(month=r[0] or "", tp=float(r[1] or 0), dispenses=r[2] or 0)
        for r in trend_rows if r[0]
    ]

    # By category
    cat_rows = (
        _apply_filters(db.query(Dispense), date_from, date_to, pharmacy, category, rep, search)
        .with_entities(
            Dispense.category,
            func.sum(Dispense.tp),
            func.count(Dispense.id),
        )
        .group_by(Dispense.category)
        .order_by(func.sum(Dispense.tp).desc())
        .all()
    )
    by_category = [
        CategoryBreakdown(
            category=r[0] or "UNKNOWN",
            tp=float(r[1] or 0),
            dispenses=r[2] or 0,
            pct=round(float(r[1] or 0) / total_tp * 100, 1) if total_tp > 0 else 0.0,
        )
        for r in cat_rows
    ]

    # By rep
    rep_rows = (
        _apply_filters(db.query(Dispense), date_from, date_to, pharmacy, category, rep, search)
        .with_entities(
            Dispense.rep,
            func.sum(Dispense.tp),
            func.count(Dispense.id),
        )
        .group_by(Dispense.rep)
        .order_by(func.sum(Dispense.tp).desc())
        .all()
    )
    by_rep = [
        RepBreakdown(rep=r[0] or "UNKNOWN", tp=float(r[1] or 0), dispenses=r[2] or 0)
        for r in rep_rows
    ]

    return ReportSummary(
        total_tp=total_tp,
        total_dispenses=total_disp,
        unique_patients=unique_pts,
        avg_tp=avg_tp,
        monthly_trend=monthly_trend,
        by_category=by_category,
        by_rep=by_rep,
    )


@router.get("/dispenses", response_model=DispensePage)
def get_dispenses(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    pharmacy: Optional[str] = None,
    category: Optional[str] = None,
    rep: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    base = _apply_filters(db.query(Dispense), date_from, date_to, pharmacy, category, rep, search)
    base = base.order_by(Dispense.date_completed.desc(), Dispense.patient)

    total = base.count()
    items = base.offset((page - 1) * page_size).limit(page_size).all()

    return DispensePage(
        total=total,
        page=page,
        page_size=page_size,
        items=[DispenseRow.model_validate(r, from_attributes=True) for r in items],
    )


@router.get("/export")
def export_dispenses(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    pharmacy: Optional[str] = None,
    category: Optional[str] = None,
    rep: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    base = _apply_filters(db.query(Dispense), date_from, date_to, pharmacy, category, rep, search)
    rows = base.order_by(Dispense.date_completed.desc(), Dispense.patient).all()

    COLS = [
        "date_completed", "patient", "ptsn", "drug", "category", "pharmacy",
        "rep", "rx_number", "refill_no", "days_supply", "disp_qty",
        "tp", "gp", "acq_cost", "primary_copay", "plan_type", "prescriber", "bill_month",
    ]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(COLS)
    for r in rows:
        writer.writerow([getattr(r, c, "") for c in COLS])

    filename = "osiris_dispenses_export.csv"
    if date_from and date_to:
        filename = f"osiris_dispenses_{date_from}_{date_to}.csv"

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/filter-options")
def get_filter_options(db: Session = Depends(get_db)):
    reps = [r[0] for r in db.query(Dispense.rep).distinct().order_by(Dispense.rep).all() if r[0]]
    pharmacies = [r[0] for r in db.query(Dispense.pharmacy).distinct().order_by(Dispense.pharmacy).all() if r[0]]
    categories = [r[0] for r in db.query(Dispense.category).distinct().order_by(Dispense.category).all() if r[0]]
    return {"reps": reps, "pharmacies": pharmacies, "categories": categories}
