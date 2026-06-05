from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from models import Dispense, Refill, Shipping, MonthlyGoal
from schemas import RefillOut, ShippingOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class SummaryCard(BaseModel):
    call_today: int
    past_due: int
    scheduled_this_week: int
    shipped_this_month: int
    mtd_revenue: float
    monthly_goal: float
    pct_to_goal: float


class OpportunityByClass(BaseModel):
    category: str
    tp: float


class StatusGroup(BaseModel):
    group: str
    count: int


class DashboardResponse(BaseModel):
    summary: SummaryCard
    opportunities_by_class: list[OpportunityByClass]
    status_distribution: list[StatusGroup]
    needs_attention: list[RefillOut]
    shipping_today: list[ShippingOut]


@router.get("", response_model=DashboardResponse)
def get_dashboard(db: Session = Depends(get_db)):
    today = date.today()
    this_month = today.strftime("%Y-%m")

    # ── Summary counts ────────────────────────────────────────────────────────
    call_today = db.query(func.count(Refill.id)).filter(Refill.bucket == "THIS WEEK").scalar() or 0
    past_due = db.query(func.count(Refill.id)).filter(Refill.bucket == "PAST DUE").scalar() or 0
    scheduled_this_week = db.query(func.count(Refill.id)).filter(Refill.bucket == "SCHEDULED").scalar() or 0

    shipped_this_month = (
        db.query(func.count(Shipping.id))
        .filter(
            Shipping.status == "SHIPPED",
            func.strftime("%Y-%m", Shipping.shipping_date) == this_month,
        )
        .scalar() or 0
    )

    # MTD revenue: sum TP from dispense where date_completed is this month
    mtd_revenue = (
        db.query(func.sum(Dispense.tp))
        .filter(func.strftime("%Y-%m", Dispense.date_completed) == this_month)
        .scalar() or 0.0
    )

    # Monthly goal for this period
    goal_row = (
        db.query(func.sum(MonthlyGoal.goal_tp))
        .filter(MonthlyGoal.period_month == this_month)
        .scalar()
    )
    monthly_goal = float(goal_row) if goal_row else 0.0
    pct_to_goal = (mtd_revenue / monthly_goal * 100) if monthly_goal > 0 else 0.0

    # ── Opportunities by class (THIS WEEK bucket) ─────────────────────────────
    opp_rows = (
        db.query(Refill.category, func.sum(Refill.tp))
        .filter(Refill.bucket == "THIS WEEK", Refill.category != None)
        .group_by(Refill.category)
        .all()
    )
    opportunities_by_class = [
        OpportunityByClass(category=cat, tp=float(tp or 0))
        for cat, tp in opp_rows
    ]

    # ── Status distribution ───────────────────────────────────────────────────
    status_map = {
        "NO ATTEMPTS": "No Attempts",
        "ATTEMPT 1": "Attempt 1-3",
        "ATTEMPT 2": "Attempt 1-3",
        "ATTEMPT 3": "Attempt 1-3",
        "SCHEDULED": "Scheduled",
        "SHIPPED": "Shipped",
        "REFILL POSTPONED": "Other",
        "PUSHED": "Other",
        "DISCONTINUED": "Other",
        "DISCHARGED": "Other",
    }
    status_rows = (
        db.query(Refill.current_status, func.count(Refill.id))
        .group_by(Refill.current_status)
        .all()
    )
    group_counts: dict[str, int] = {}
    for status, count in status_rows:
        group = status_map.get(status or "NO ATTEMPTS", "Other")
        group_counts[group] = group_counts.get(group, 0) + count

    status_order = ["No Attempts", "Attempt 1-3", "Scheduled", "Shipped", "Other"]
    status_distribution = [
        StatusGroup(group=g, count=group_counts.get(g, 0))
        for g in status_order
        if group_counts.get(g, 0) > 0
    ]

    # ── Needs attention: PAST DUE sorted by TP desc (top 15) ─────────────────
    needs_attention = (
        db.query(Refill)
        .filter(Refill.bucket == "PAST DUE")
        .order_by(Refill.tp.desc())
        .limit(15)
        .all()
    )

    # ── Shipping today ────────────────────────────────────────────────────────
    shipping_today = (
        db.query(Shipping)
        .filter(Shipping.shipping_date == today)
        .all()
    )

    return DashboardResponse(
        summary=SummaryCard(
            call_today=call_today,
            past_due=past_due,
            scheduled_this_week=scheduled_this_week,
            shipped_this_month=shipped_this_month,
            mtd_revenue=mtd_revenue,
            monthly_goal=monthly_goal,
            pct_to_goal=pct_to_goal,
        ),
        opportunities_by_class=opportunities_by_class,
        status_distribution=status_distribution,
        needs_attention=[RefillOut.model_validate(r) for r in needs_attention],
        shipping_today=[ShippingOut.model_validate(s) for s in shipping_today],
    )
