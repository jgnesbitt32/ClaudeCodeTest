"""
Projections: monthly revenue forecast with week-by-week breakdown.

1st fill  = patients whose next_call_date falls in the selected month
            (from refill table, exclude SHIPPED/DISCONTINUED/DISCHARGED)
2nd fill  = patients dispensed in the selected month where
            days_supply <= 28 AND date_completed + days_supply <= last day of month
            (they'll need a 2nd refill within the same month)
Actual    = TP from dispense table where date_completed is in the selected month
"""
from calendar import monthrange
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Dispense, MonthlyGoal, Refill

router = APIRouter(prefix="/projections", tags=["projections"])

CATEGORIES = ["IVIG", "HEME", "ANC_BILLED"]
EXCLUDE_STATUSES = {"SHIPPED", "DISCONTINUED", "DISCHARGED"}


# ── Pydantic models ───────────────────────────────────────────────────────────
class WeekRow(BaseModel):
    label: str
    start: date
    end: date
    is_past: bool
    first_fill_pts: int
    first_fill_tp: float
    second_fill_pts: int
    second_fill_tp: float
    total_opp: float
    actual: float
    missed: Optional[float]


class ClassSummary(BaseModel):
    cls: str
    actual: float
    first_fill_tp: float
    second_fill_tp: float
    forecast: float
    goal: float
    gap: float
    weeks: list[WeekRow]


class ProjectionSummary(BaseModel):
    goal: float
    actual: float
    first_fill_pipeline: float
    second_fill_projected: float
    forecast: float
    gap: float
    pct_to_goal: float


class ProjectionResponse(BaseModel):
    month: str
    available_months: list[str]
    summary: ProjectionSummary
    weeks: list[WeekRow]
    by_class: list[ClassSummary]
    goals: dict[str, float]


class GoalPayload(BaseModel):
    period_month: str
    goals: dict[str, float]


# ── Helpers ───────────────────────────────────────────────────────────────────
def month_weeks(month_str: str) -> list[tuple[date, date]]:
    year, month = map(int, month_str.split("-"))
    _, last_day = monthrange(year, month)
    boundaries = [1, 8, 15, 22, last_day + 1]
    weeks = []
    for i in range(len(boundaries) - 1):
        start = date(year, month, boundaries[i])
        end = date(year, month, min(boundaries[i + 1] - 1, last_day))
        if start <= end:
            weeks.append((start, end))
    return weeks


def week_label(start: date, end: date) -> str:
    if start.month == end.month:
        return f"{start.strftime('%b')} {start.day}–{end.day}"
    return f"{start.strftime('%b %d')}–{end.strftime('%b %d')}"


def compute_weeks(
    month_str: str,
    refills_in_month: list,
    dispenses_in_month: list,
    actuals_by_date: dict,
    today: date,
    cls_filter: Optional[str] = None,
) -> list[WeekRow]:
    weeks = month_weeks(month_str)
    year, month_num = map(int, month_str.split("-"))
    _, last_day_num = monthrange(year, month_num)
    last_day = date(year, month_num, last_day_num)

    rows = []
    for w_start, w_end in weeks:
        is_past = w_end < today

        # 1st fills: next_call_date in this week
        first = [
            r for r in refills_in_month
            if r.next_call_date and w_start <= r.next_call_date <= w_end
            and (cls_filter is None or r.category == cls_filter)
        ]
        first_tp = sum(r.tp or 0 for r in first)

        # 2nd fills: dispense in month, days_supply <= 28,
        # date_completed + days_supply <= last_day,
        # 2nd call date (date_completed + days_supply - 7) falls in this week
        second = []
        for d in dispenses_in_month:
            if cls_filter and d.category != cls_filter:
                continue
            if not d.days_supply or d.days_supply > 28:
                continue
            if not d.date_completed:
                continue
            supply_end = d.date_completed + timedelta(days=int(d.days_supply))
            if supply_end > last_day:
                continue
            call_2 = supply_end - timedelta(days=7)
            if w_start <= call_2 <= w_end:
                second.append(d)

        second_tp = sum(d.tp or 0 for d in second)
        total_opp = first_tp + second_tp

        # Actual: sum TP from dispenses where date_completed in this week
        actual = sum(
            tp for dt, tp in actuals_by_date.items()
            if w_start <= dt <= w_end
            and (cls_filter is None or True)  # actuals_by_date already filtered by cls if needed
        )

        missed = (total_opp - actual) if is_past else None

        rows.append(WeekRow(
            label=week_label(w_start, w_end),
            start=w_start,
            end=w_end,
            is_past=is_past,
            first_fill_pts=len(first),
            first_fill_tp=first_tp,
            second_fill_pts=len(second),
            second_fill_tp=second_tp,
            total_opp=total_opp,
            actual=actual,
            missed=missed,
        ))
    return rows


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("", response_model=ProjectionResponse)
def get_projections(month: Optional[str] = None, db: Session = Depends(get_db)):
    today = date.today()
    if not month:
        month = today.strftime("%Y-%m")

    year, month_num = map(int, month.split("-"))
    _, last_day_num = monthrange(year, month_num)
    month_start = date(year, month_num, 1)
    month_end = date(year, month_num, last_day_num)

    # ── Available months (from dispense + refill data) ─────────────────────
    disp_months = db.query(func.strftime("%Y-%m", Dispense.date_completed)).distinct().all()
    refill_months = db.query(func.strftime("%Y-%m", Refill.next_call_date)).distinct().all()
    all_months = sorted(set(
        m[0] for m in disp_months + refill_months if m[0]
    ), reverse=True)

    # ── 1st fill pipeline: refills with next_call_date in month ───────────
    refills_in_month = (
        db.query(Refill)
        .filter(
            Refill.next_call_date >= month_start,
            Refill.next_call_date <= month_end,
            Refill.current_status.notin_(list(EXCLUDE_STATUSES)),
        )
        .all()
    )

    # ── Dispenses in month (for 2nd fill logic) ────────────────────────────
    dispenses_in_month = (
        db.query(Dispense)
        .filter(
            Dispense.date_completed >= month_start,
            Dispense.date_completed <= month_end,
        )
        .all()
    )

    # ── Actuals: dispense TP by date_completed for the month ──────────────
    actual_rows = (
        db.query(Dispense.date_completed, func.sum(Dispense.tp))
        .filter(
            Dispense.date_completed >= month_start,
            Dispense.date_completed <= month_end,
        )
        .group_by(Dispense.date_completed)
        .all()
    )
    actuals_by_date: dict[date, float] = {dt: float(tp or 0) for dt, tp in actual_rows if dt}

    # ── Goals ─────────────────────────────────────────────────────────────
    goal_rows = db.query(MonthlyGoal).filter(MonthlyGoal.period_month == month).all()
    goals = {g.cls: float(g.goal_tp) for g in goal_rows}
    total_goal = sum(goals.values())

    # ── Overall summary ────────────────────────────────────────────────────
    total_actual = sum(actuals_by_date.values())
    total_first = sum(r.tp or 0 for r in refills_in_month)

    # 2nd fill totals
    second_fills_all = []
    for d in dispenses_in_month:
        if not d.days_supply or d.days_supply > 28 or not d.date_completed:
            continue
        supply_end = d.date_completed + timedelta(days=int(d.days_supply))
        if supply_end <= month_end:
            second_fills_all.append(d)
    total_second = sum(d.tp or 0 for d in second_fills_all)

    forecast = total_actual + total_first + total_second
    gap = total_goal - forecast if total_goal else 0.0
    pct_to_goal = (total_actual / total_goal * 100) if total_goal > 0 else 0.0

    # ── Overall week breakdown ─────────────────────────────────────────────
    overall_weeks = compute_weeks(month, refills_in_month, dispenses_in_month, actuals_by_date, today)

    # ── Per-class breakdown ────────────────────────────────────────────────
    by_class = []
    for cls in CATEGORIES:
        cls_actual_rows = (
            db.query(Dispense.date_completed, func.sum(Dispense.tp))
            .filter(
                Dispense.date_completed >= month_start,
                Dispense.date_completed <= month_end,
                Dispense.category == cls,
            )
            .group_by(Dispense.date_completed)
            .all()
        )
        cls_actuals: dict[date, float] = {dt: float(tp or 0) for dt, tp in cls_actual_rows if dt}

        cls_refills = [r for r in refills_in_month if r.category == cls]
        cls_dispenses = [d for d in dispenses_in_month if d.category == cls]

        cls_weeks = compute_weeks(month, cls_refills, cls_dispenses, cls_actuals, today, cls_filter=cls)
        # Fix: use cls_actuals for actual computation in compute_weeks per class
        cls_weeks = _recompute_weeks_with_cls_actuals(month, cls_refills, cls_dispenses, cls_actuals, today, month_end)

        cls_actual_total = sum(cls_actuals.values())
        cls_first_tp = sum(r.tp or 0 for r in cls_refills)
        cls_second = [d for d in cls_dispenses if d.days_supply and d.days_supply <= 28 and d.date_completed and d.date_completed + timedelta(days=int(d.days_supply)) <= month_end]
        cls_second_tp = sum(d.tp or 0 for d in cls_second)
        cls_forecast = cls_actual_total + cls_first_tp + cls_second_tp
        cls_goal = goals.get(cls, 0.0)
        cls_gap = cls_goal - cls_forecast

        by_class.append(ClassSummary(
            cls=cls,
            actual=cls_actual_total,
            first_fill_tp=cls_first_tp,
            second_fill_tp=cls_second_tp,
            forecast=cls_forecast,
            goal=cls_goal,
            gap=cls_gap,
            weeks=cls_weeks,
        ))

    return ProjectionResponse(
        month=month,
        available_months=all_months,
        summary=ProjectionSummary(
            goal=total_goal,
            actual=total_actual,
            first_fill_pipeline=total_first,
            second_fill_projected=total_second,
            forecast=forecast,
            gap=gap,
            pct_to_goal=pct_to_goal,
        ),
        weeks=overall_weeks,
        by_class=by_class,
        goals=goals,
    )


def _recompute_weeks_with_cls_actuals(
    month_str, refills, dispenses, actuals_by_date, today, month_end
) -> list[WeekRow]:
    weeks = month_weeks(month_str)
    rows = []
    for w_start, w_end in weeks:
        is_past = w_end < today
        first = [r for r in refills if r.next_call_date and w_start <= r.next_call_date <= w_end]
        first_tp = sum(r.tp or 0 for r in first)

        second = []
        for d in dispenses:
            if not d.days_supply or d.days_supply > 28 or not d.date_completed:
                continue
            supply_end = d.date_completed + timedelta(days=int(d.days_supply))
            if supply_end > month_end:
                continue
            call_2 = supply_end - timedelta(days=7)
            if w_start <= call_2 <= w_end:
                second.append(d)

        second_tp = sum(d.tp or 0 for d in second)
        total_opp = first_tp + second_tp
        actual = sum(tp for dt, tp in actuals_by_date.items() if w_start <= dt <= w_end)
        missed = (total_opp - actual) if is_past else None

        rows.append(WeekRow(
            label=week_label(w_start, w_end),
            start=w_start,
            end=w_end,
            is_past=is_past,
            first_fill_pts=len(first),
            first_fill_tp=first_tp,
            second_fill_pts=len(second),
            second_fill_tp=second_tp,
            total_opp=total_opp,
            actual=actual,
            missed=missed,
        ))
    return rows


@router.post("/goals")
def set_goals(payload: GoalPayload, db: Session = Depends(get_db)):
    for cls, goal_tp in payload.goals.items():
        existing = db.query(MonthlyGoal).filter(
            MonthlyGoal.period_month == payload.period_month,
            MonthlyGoal.cls == cls,
        ).first()
        if existing:
            existing.goal_tp = goal_tp
        else:
            db.add(MonthlyGoal(period_month=payload.period_month, cls=cls, goal_tp=goal_tp))
    db.commit()
    return {"status": "ok"}
