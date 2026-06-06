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
from sqlalchemy import and_, func
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


@router.get("/forecast")
def get_forecast(month: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Returns individual forecast lines (1st Fill, 2nd Fill, Prior Month Postpone)
    and actual dispenses for the selected month — powers the dark-theme dashboard.

    fillDate = date_completed + days_supply, pushed to next business day.
    Postpones: patients whose prior-prior-month fill was expected in prior month
               but who had no prior-month dispense.
    """
    today = date.today()
    if not month:
        month = today.strftime("%Y-%m")

    year, month_num = map(int, month.split("-"))
    _, last_day = monthrange(year, month_num)
    month_start = date(year, month_num, 1)
    month_end = date(year, month_num, last_day)

    def next_bday(d: date) -> date:
        while d.weekday() >= 5:
            d += timedelta(days=1)
        return d

    ACTIVE_CATS = ["IVIG", "HEME", "ANC_BILLED"]
    EX_STATUSES = {"DISCONTINUED", "DISCHARGED"}

    # Available months
    disp_months = db.query(func.strftime("%Y-%m", Dispense.date_completed)).distinct().all()
    rfill_months = db.query(func.strftime("%Y-%m", Refill.next_call_date)).distinct().all()
    available = sorted(set(m[0] for m in disp_months + rfill_months if m[0]), reverse=True)

    # Refill statuses for exclusion check
    refill_statuses = {
        (r.ptsn, r.drug): r.current_status
        for r in db.query(Refill.ptsn, Refill.drug, Refill.current_status).all()
    }

    # Latest dispense per (ptsn, drug) strictly before month_start
    subq = (
        db.query(
            Dispense.ptsn,
            Dispense.drug,
            func.max(Dispense.date_completed).label("max_date"),
        )
        .filter(
            Dispense.date_completed < month_start,
            Dispense.category.in_(ACTIVE_CATS),
            Dispense.days_supply > 7,
        )
        .group_by(Dispense.ptsn, Dispense.drug)
        .subquery()
    )
    latest = (
        db.query(Dispense)
        .join(subq, and_(
            Dispense.ptsn == subq.c.ptsn,
            Dispense.drug == subq.c.drug,
            Dispense.date_completed == subq.c.max_date,
        ))
        .all()
    )

    def _to_line(d, line_type, fill_date):
        return {
            "cat": d.category,
            "patient": d.patient,
            "ptsn": d.ptsn,
            "drug": d.drug,
            "ndc": d.ndc,
            "tp": float(d.tp or 0),
            "gp": float(d.gp or 0),
            "acq": float(d.acq_cost or 0),
            "copay": float(d.primary_copay or 0),
            "line_type": line_type,
            "date_completed": d.date_completed.isoformat() if d.date_completed else None,
            "fill_date": fill_date.isoformat(),
            "rep": d.rep,
            "plan_type": d.plan_type,
            "pharmacy": d.pharmacy,
            "days_supply": int(d.days_supply) if d.days_supply else 0,
        }

    forecast_lines = []
    seen_keys = set()

    for d in latest:
        key = (d.ptsn, d.drug)
        if refill_statuses.get(key, "") in EX_STATUSES:
            continue
        if not d.date_completed or not d.days_supply:
            continue

        fill1 = next_bday(d.date_completed + timedelta(days=int(d.days_supply)))
        if month_start <= fill1 <= month_end:
            forecast_lines.append(_to_line(d, "1st Fill", fill1))
            seen_keys.add(key)

            # 2nd fill
            if int(d.days_supply) <= 28:
                fill2 = next_bday(fill1 + timedelta(days=int(d.days_supply)))
                if month_start <= fill2 <= month_end:
                    forecast_lines.append(_to_line(d, "2nd Fill", fill2))

    # Prior-month postpones
    prior_end = month_start - timedelta(days=1)
    prior_start = date(prior_end.year, prior_end.month, 1)
    pp_end = prior_start - timedelta(days=1)
    pp_start = date(pp_end.year, pp_end.month, 1)
    prior_month_name = prior_end.strftime("%B")  # e.g. "May"

    pp_subq = (
        db.query(
            Dispense.ptsn, Dispense.drug,
            func.max(Dispense.date_completed).label("max_date"),
        )
        .filter(
            Dispense.date_completed >= pp_start,
            Dispense.date_completed <= pp_end,
            Dispense.category.in_(ACTIVE_CATS),
            Dispense.days_supply > 7,
        )
        .group_by(Dispense.ptsn, Dispense.drug)
        .subquery()
    )
    pp_latest = (
        db.query(Dispense)
        .join(pp_subq, and_(
            Dispense.ptsn == pp_subq.c.ptsn,
            Dispense.drug == pp_subq.c.drug,
            Dispense.date_completed == pp_subq.c.max_date,
        ))
        .all()
    )

    prior_fills = set(
        (d.ptsn, d.drug)
        for d in db.query(Dispense.ptsn, Dispense.drug)
        .filter(
            Dispense.date_completed >= prior_start,
            Dispense.date_completed <= prior_end,
        )
        .all()
    )

    for d in pp_latest:
        key = (d.ptsn, d.drug)
        if key in prior_fills or key in seen_keys:
            continue
        if refill_statuses.get(key, "") in EX_STATUSES:
            continue
        if not d.date_completed or not d.days_supply:
            continue

        expected = next_bday(d.date_completed + timedelta(days=int(d.days_supply)))
        if prior_start <= expected <= prior_end:
            forecast_lines.append(_to_line(d, f"{prior_month_name} Postpone", month_start))
            seen_keys.add(key)

    # Actuals
    actual_rows = (
        db.query(Dispense)
        .filter(
            Dispense.date_completed >= month_start,
            Dispense.date_completed <= month_end,
            Dispense.category.in_(ACTIVE_CATS),
        )
        .all()
    )
    actuals = [
        {
            "cat": d.category,
            "patient": d.patient,
            "ptsn": d.ptsn,
            "drug": d.drug,
            "tp": float(d.tp or 0),
            "gp": float(d.gp or 0),
            "date_completed": d.date_completed.isoformat() if d.date_completed else None,
            "rep": d.rep,
            "plan_type": d.plan_type,
            "pharmacy": d.pharmacy,
        }
        for d in actual_rows
    ]

    return {
        "month": month,
        "available_months": available,
        "forecast_lines": forecast_lines,
        "actuals": actuals,
    }


@router.get("/annual")
def get_annual_forecast(db: Session = Depends(get_db)):
    """
    Current-month revenue forecast.

    Uses the refill table as primary source (one row per active patient),
    joined to the latest dispense for that patient's primary category.
    ship_date = date_completed + days_supply
    Revenue = SUM(tp) of all vials in patient+category's most recent complete month.
    """
    from collections import defaultdict
    from sqlalchemy import text

    today = date.today()
    current_ym = today.strftime("%Y-%m")
    year, month_num = map(int, current_ym.split("-"))
    _, last_day = monthrange(year, month_num)
    month_start = date(year, month_num, 1)
    month_end   = date(year, month_num, last_day)

    ACTIVE_CATS = ["IVIG", "HEME", "ANC_BILLED"]

    # Per-patient-per-category monthly TP (most recent complete month before current)
    tp_rows = db.execute(text("""
        SELECT ptsn, category, strftime('%Y-%m', date_completed) ym, SUM(tp) total_tp
        FROM dispense
        WHERE tp > 0 AND days_supply > 7
        GROUP BY ptsn, category, strftime('%Y-%m', date_completed)
    """)).fetchall()

    cat_monthly: dict = defaultdict(list)
    for ptsn, cat, ym, tp in tp_rows:
        if ym:
            cat_monthly[(ptsn, cat)].append((ym, float(tp or 0)))

    def best_tp(ptsn: str, cat: str) -> float:
        months = sorted(
            [(ym, tp) for ym, tp in cat_monthly[(ptsn, cat)] if ym < current_ym],
            reverse=True,
        )
        return months[0][1] if months else 0.0

    # Active patients with latest dispense per their primary refill category.
    # Uses refill table as primary driver (matches analysis script logic exactly).
    rows = db.execute(text("""
        SELECT r.ptsn, r.category, r.current_status, d.date_completed, d.days_supply
        FROM refill r
        INNER JOIN (
            SELECT ptsn, category, MAX(date_completed) max_date
            FROM dispense WHERE days_supply > 7
            GROUP BY ptsn, category
        ) lx ON r.ptsn = lx.ptsn AND r.category = lx.category
        INNER JOIN dispense d
            ON d.ptsn = r.ptsn AND d.category = r.category
            AND d.date_completed = lx.max_date AND d.days_supply > 7
        WHERE r.current_status NOT IN ('DISCHARGED','DISCONTINUED')
    """)).fetchall()

    fills: dict = {cat: {"1st_fill": 0.0, "2nd_fill": 0.0, "new_start": 0.0,
                         "total": 0.0, "pts_1st": 0, "pts_2nd": 0, "pts_new": 0}
                   for cat in ACTIVE_CATS}

    for ptsn, cat, status, dc_str, ds_val in rows:
        cat = (cat or "").upper()
        if cat not in ACTIVE_CATS:
            continue
        if not dc_str or not ds_val:
            continue
        ds = int(ds_val)
        if ds <= 7:
            continue

        dc = date.fromisoformat(dc_str)
        ship1 = dc + timedelta(days=ds)

        if not (month_start <= ship1 <= month_end):
            continue

        monthly_tp = best_tp(ptsn, cat)
        if not monthly_tp:
            row = db.execute(text(
                "SELECT SUM(tp) FROM dispense WHERE ptsn=:p AND category=:c AND date_completed=:d"
            ), {"p": ptsn, "c": cat, "d": dc_str}).fetchone()
            monthly_tp = float(row[0] or 0) if row else 0.0
        if not monthly_tp:
            continue

        fills[cat]["1st_fill"] += monthly_tp
        fills[cat]["pts_1st"] += 1

        if ds <= 28:
            ship2 = ship1 + timedelta(days=ds)
            if month_start <= ship2 <= month_end:
                fills[cat]["2nd_fill"] += monthly_tp
                fills[cat]["pts_2nd"] += 1

    for cat in ACTIVE_CATS:
        fills[cat]["total"] = round(fills[cat]["1st_fill"] + fills[cat]["2nd_fill"])
        fills[cat]["1st_fill"] = round(fills[cat]["1st_fill"])
        fills[cat]["2nd_fill"] = round(fills[cat]["2nd_fill"])

    grand_total = sum(fills[c]["total"] for c in ACTIVE_CATS)

    cur_month_entry = {
        "month": current_ym,
        "categories": fills,
        "total": grand_total,
    }

    annual: dict = {}
    for cat in ACTIVE_CATS:
        annual[cat] = {
            "1st_fill": fills[cat]["1st_fill"],
            "2nd_fill": fills[cat]["2nd_fill"],
            "new_start": 0,
            "total": fills[cat]["total"],
        }

    return {
        "months": [cur_month_entry],
        "annual": annual,
        "generated": today.isoformat(),
    }


@router.get("/detail")
def get_projection_detail(db: Session = Depends(get_db)):
    """
    Excel-style projection breakdown for the current month:
    Actual + Scheduled + Weekly 1st-fill Opps + 2nd Fills + New Starts - Postpones
    Matches the structure of the June Goals Summary spreadsheet.
    """
    from collections import defaultdict
    from sqlalchemy import text

    today = date.today()
    current_ym = today.strftime("%Y-%m")
    year, month_num = map(int, current_ym.split("-"))
    _, last_day = monthrange(year, month_num)
    month_start = date(year, month_num, 1)
    month_end   = date(year, month_num, last_day)

    CATS = ["IVIG", "HEME", "ANC_BILLED"]

    # Hardcoded monthly goals (matches Excel June Goals)
    GOALS = {"IVIG": 2_462_304.0, "HEME": 2_350_000.0, "ANC_BILLED": 0.0}

    # Week boundaries for the current month
    boundaries = [1, 8, 15, 22, 29, last_day + 1]
    weeks: list[tuple[date, date]] = []
    for i in range(len(boundaries) - 1):
        ws = date(year, month_num, boundaries[i])
        we = date(year, month_num, min(boundaries[i + 1] - 1, last_day))
        if ws <= we:
            weeks.append((ws, we))

    def wlabel(ws: date, we: date) -> str:
        return f"{ws.strftime('%b')} {ws.day}-{we.day}"

    week_labels = [wlabel(ws, we) for ws, we in weeks]

    # Per-patient-per-category monthly TP (best prior month)
    tp_rows = db.execute(text("""
        SELECT ptsn, category, strftime('%Y-%m', date_completed) ym, SUM(tp) total_tp
        FROM dispense
        WHERE tp > 0 AND days_supply > 7
        GROUP BY ptsn, category, strftime('%Y-%m', date_completed)
    """)).fetchall()
    cat_monthly: dict = defaultdict(list)
    for ptsn, cat, ym, tp in tp_rows:
        if ym:
            cat_monthly[(ptsn, cat)].append((ym, float(tp or 0)))

    def best_tp(ptsn: str, cat: str) -> float:
        months = sorted(
            [(ym, tp) for ym, tp in cat_monthly[(ptsn, cat)] if ym < current_ym],
            reverse=True,
        )
        if months:
            return months[0][1]
        # fallback: any month including current
        all_m = sorted(cat_monthly[(ptsn, cat)], reverse=True)
        return all_m[0][1] if all_m else 0.0

    def norm_cat(raw: str | None) -> str | None:
        if not raw:
            return None
        r = raw.strip().upper()
        if r == "IVIG":
            return "IVIG"
        if r == "HEME":
            return "HEME"
        if r in ("ALPHA1", "ANC_BILLED", "ALPHA-1"):
            return "ANC_BILLED"
        return None

    # ── 1. Actuals (already shipped this month) ───────────────────────────────
    actual_rows = db.execute(text("""
        SELECT category, SUM(tp) total_tp, COUNT(DISTINCT ptsn) pts
        FROM dispense
        WHERE strftime('%Y-%m', date_completed) = :ym AND tp > 0
        GROUP BY category
    """), {"ym": current_ym}).fetchall()

    actuals: dict[str, float] = {c: 0.0 for c in CATS}
    actuals_pts: dict[str, int] = {c: 0 for c in CATS}
    for cat, tp, pts in actual_rows:
        nc = norm_cat(cat)
        if nc:
            actuals[nc] += float(tp or 0)
            actuals_pts[nc] += int(pts or 0)

    # ── 2. Scheduled (SCHEDULED status, use best monthly TP) ──────────────────
    sched_rows = db.execute(text("""
        SELECT r.ptsn, r.category
        FROM refill r
        WHERE r.current_status = 'SCHEDULED'
        AND r.category IN ('IVIG','HEME','ANC_BILLED')
    """)).fetchall()

    scheduled: dict[str, float] = {c: 0.0 for c in CATS}
    sched_pts: dict[str, int] = {c: 0 for c in CATS}
    for ptsn, cat in sched_rows:
        nc = norm_cat(cat)
        if not nc:
            continue
        tp = best_tp(ptsn, nc)
        if not tp:
            row = db.execute(text(
                "SELECT SUM(tp) FROM dispense WHERE ptsn=:p AND category=:c AND tp>0"
            ), {"p": ptsn, "c": cat}).fetchone()
            tp = float(row[0] or 0) if row else 0.0
        scheduled[nc] += tp
        sched_pts[nc] += 1

    # ── 3. 1st fill opps by week + 2nd fill opps ─────────────────────────────
    # Active patients (not SCHEDULED/SHIPPED/DISCHARGED/DISCONTINUED)
    active_rows = db.execute(text("""
        SELECT r.ptsn, r.category, r.current_status, d.date_completed, d.days_supply
        FROM refill r
        INNER JOIN (
            SELECT ptsn, category, MAX(date_completed) max_date
            FROM dispense WHERE days_supply > 7
            GROUP BY ptsn, category
        ) lx ON r.ptsn = lx.ptsn AND r.category = lx.category
        INNER JOIN dispense d
            ON d.ptsn = r.ptsn AND d.category = r.category
            AND d.date_completed = lx.max_date AND d.days_supply > 7
        WHERE r.current_status NOT IN (
            'DISCHARGED','DISCONTINUED','SCHEDULED','SHIPPED'
        )
    """)).fetchall()

    opps_by_week: dict[str, list[float]] = {c: [0.0] * len(weeks) for c in CATS}
    opps_pts_by_week: dict[str, list[int]] = {c: [0] * len(weeks) for c in CATS}
    second_fill: dict[str, float] = {c: 0.0 for c in CATS}
    second_pts: dict[str, int] = {c: 0 for c in CATS}

    for ptsn, cat, status, dc_str, ds_val in active_rows:
        nc = norm_cat(cat)
        if not nc or not dc_str or not ds_val:
            continue
        ds = int(ds_val)
        if ds <= 7:
            continue
        dc = date.fromisoformat(dc_str)
        ship1 = dc + timedelta(days=ds)

        if not (month_start <= ship1 <= month_end):
            continue

        tp = best_tp(ptsn, nc)
        if not tp:
            row = db.execute(text(
                "SELECT SUM(tp) FROM dispense WHERE ptsn=:p AND category=:c AND date_completed=:d"
            ), {"p": ptsn, "c": cat, "d": dc_str}).fetchone()
            tp = float(row[0] or 0) if row else 0.0
        if not tp:
            continue

        for wi, (ws, we) in enumerate(weeks):
            if ws <= ship1 <= we:
                opps_by_week[nc][wi] += tp
                opps_pts_by_week[nc][wi] += 1
                break

        if ds <= 28:
            ship2 = ship1 + timedelta(days=ds)
            if month_start <= ship2 <= month_end:
                second_fill[nc] += tp
                second_pts[nc] += 1

    # ── 4. New starts (first ever dispense in current month) ──────────────────
    new_start_rows = db.execute(text("""
        SELECT category, SUM(tp) total_tp, COUNT(DISTINCT ptsn) pts
        FROM dispense
        WHERE strftime('%Y-%m', date_completed) = :ym AND tp > 0
        AND ptsn NOT IN (
            SELECT DISTINCT ptsn FROM dispense
            WHERE strftime('%Y-%m', date_completed) < :ym AND tp > 0
        )
        GROUP BY category
    """), {"ym": current_ym}).fetchall()

    new_starts: dict[str, float] = {c: 0.0 for c in CATS}
    new_starts_pts: dict[str, int] = {c: 0 for c in CATS}
    for cat, tp, pts in new_start_rows:
        nc = norm_cat(cat)
        if nc:
            new_starts[nc] += float(tp or 0)
            new_starts_pts[nc] += int(pts or 0)

    # ── 5. Postpones (REFILL POSTPONED / PUSHED with June ship date) ──────────
    postpone_active = db.execute(text("""
        SELECT r.ptsn, r.category, d.date_completed, d.days_supply
        FROM refill r
        INNER JOIN (
            SELECT ptsn, category, MAX(date_completed) max_date
            FROM dispense WHERE days_supply > 7
            GROUP BY ptsn, category
        ) lx ON r.ptsn = lx.ptsn AND r.category = lx.category
        INNER JOIN dispense d
            ON d.ptsn = r.ptsn AND d.category = r.category
            AND d.date_completed = lx.max_date AND d.days_supply > 7
        WHERE r.current_status IN ('REFILL POSTPONED','PUSHED')
        AND r.category IN ('IVIG','HEME','ANC_BILLED')
    """)).fetchall()

    postpones: dict[str, float] = {c: 0.0 for c in CATS}
    postpone_pts: dict[str, int] = {c: 0 for c in CATS}
    for ptsn, cat, dc_str, ds_val in postpone_active:
        nc = norm_cat(cat)
        if not nc or not dc_str or not ds_val:
            continue
        ds = int(ds_val)
        dc = date.fromisoformat(dc_str)
        ship1 = dc + timedelta(days=ds)
        if month_start <= ship1 <= month_end:
            tp = best_tp(ptsn, nc)
            if tp:
                postpones[nc] += tp
                postpone_pts[nc] += 1

    # ── Build per-category result ─────────────────────────────────────────────
    categories: dict = {}
    for cat in CATS:
        total_opps = sum(opps_by_week[cat])
        # Projection = forward-looking total: opps (all patients whose supply
        # schedule lands in this month) + 2nd fills (patients with short supply
        # who could fill twice this month).  Actuals, scheduled, and new_starts
        # are shown as informational rows but are subsets of opps, not additive.
        projection = total_opps + second_fill[cat] - postpones[cat]
        categories[cat] = {
            "goal": GOALS.get(cat, 0.0),
            "actual": round(actuals[cat]),
            "actual_pts": actuals_pts[cat],
            "scheduled": round(scheduled[cat]),
            "scheduled_pts": sched_pts[cat],
            "opps_by_week": [round(x) for x in opps_by_week[cat]],
            "opps_pts_by_week": opps_pts_by_week[cat],
            "second_fill": round(second_fill[cat]),
            "second_pts": second_pts[cat],
            "new_starts": round(new_starts[cat]),
            "new_starts_pts": new_starts_pts[cat],
            "postpones": round(postpones[cat]),
            "postpone_pts": postpone_pts[cat],
            "projection": round(projection),
            "gap": round(GOALS.get(cat, 0.0) - projection),
        }

    combined_proj = sum(categories[c]["projection"] for c in CATS)
    combined_goal = sum(GOALS.values())

    return {
        "month": current_ym,
        "month_label": date(year, month_num, 1).strftime("%B %Y"),
        "week_labels": week_labels,
        "categories": categories,
        "combined": {
            "goal": combined_goal,
            "actual": sum(categories[c]["actual"] for c in CATS),
            "scheduled": sum(categories[c]["scheduled"] for c in CATS),
            "opps_by_week": [
                sum(categories[c]["opps_by_week"][wi] for c in CATS)
                for wi in range(len(weeks))
            ],
            "second_fill": sum(categories[c]["second_fill"] for c in CATS),
            "new_starts": sum(categories[c]["new_starts"] for c in CATS),
            "postpones": sum(categories[c]["postpones"] for c in CATS),
            "projection": combined_proj,
            "gap": round(combined_goal - combined_proj),
        },
        "generated": today.isoformat(),
    }


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
