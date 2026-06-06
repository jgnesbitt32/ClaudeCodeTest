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
    12-month rolling revenue forecast using actual per-patient monthly TP.

    Each active patient's expected monthly revenue = sum of TP across all their
    dispenses in their most recent complete month (captures all vials, not just one).
    Fills are classified:
      new_start  — patient has ≤ 2 total dispenses (just started)
      2nd_fill   — patient.two_fills == True
      1st_fill   — all others
    Roll each patient's next_call_date forward by days_supply for 12 months.
    """
    from collections import defaultdict
    from calendar import monthrange

    today = date.today()
    current_ym = today.strftime("%Y-%m")
    horizon_months = 12
    # Build list of future month strings
    future_months = []
    y, m = today.year, today.month
    for _ in range(horizon_months):
        future_months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1

    # ── Per-patient most-recent complete-month TP ─────────────────────────────
    rows = (
        db.query(
            Dispense.ptsn,
            func.strftime("%Y-%m", Dispense.date_completed).label("ym"),
            func.sum(Dispense.tp).label("total_tp"),
            func.count(Dispense.id).label("fill_count"),
        )
        .filter(Dispense.tp > 0, Dispense.days_supply > 7)
        .group_by(Dispense.ptsn, func.strftime("%Y-%m", Dispense.date_completed))
        .all()
    )

    # ptsn -> list of (ym, total_tp)
    by_ptsn: dict[str, list] = defaultdict(list)
    for ptsn, ym, tp, cnt in rows:
        if ym:
            by_ptsn[ptsn].append((ym, float(tp or 0)))

    # Pick most recent complete month (exclude current partial month)
    patient_monthly_tp: dict[str, float] = {}
    for ptsn, months in by_ptsn.items():
        past = sorted([(ym, tp) for ym, tp in months if ym < current_ym], reverse=True)
        if past:
            patient_monthly_tp[ptsn] = past[0][1]

    # Total historical dispense count per patient (to identify new starts)
    dispense_counts = dict(
        db.query(Dispense.ptsn, func.count(Dispense.id))
        .group_by(Dispense.ptsn)
        .all()
    )

    # ── Latest days_supply per patient from dispense ─────────────────────────
    ds_subq = (
        db.query(
            Dispense.ptsn,
            func.max(Dispense.date_completed).label("max_date"),
        )
        .filter(Dispense.days_supply > 7)
        .group_by(Dispense.ptsn)
        .subquery()
    )
    ds_rows = (
        db.query(Dispense.ptsn, Dispense.days_supply)
        .join(ds_subq, and_(
            Dispense.ptsn == ds_subq.c.ptsn,
            Dispense.date_completed == ds_subq.c.max_date,
        ))
        .all()
    )
    patient_ds: dict[str, int] = {ptsn: int(ds or 28) for ptsn, ds in ds_rows}

    # ── Active patients ───────────────────────────────────────────────────────
    active = (
        db.query(Refill)
        .filter(Refill.current_status.notin_(["DISCHARGED", "DISCONTINUED"]))
        .all()
    )

    # result[ym][cat][fill_type] = total_tp
    result: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    patient_counts: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))

    for r in active:
        cat = (r.category or "").upper()
        if cat not in ("IVIG", "HEME", "ANC_BILLED"):
            continue
        if not r.next_call_date:
            continue

        monthly_tp = patient_monthly_tp.get(r.ptsn) or float(r.tp or 0)
        if not monthly_tp:
            continue

        ds = patient_ds.get(r.ptsn, 28)
        if ds <= 7:
            continue

        total_fills = dispense_counts.get(r.ptsn, 0)
        if total_fills <= 2:
            fill_type = "new_start"
        elif r.two_fills:
            fill_type = "2nd_fill"
        else:
            fill_type = "1st_fill"

        # Roll forward
        ncd = r.next_call_date
        projected_months = set()
        for _ in range(14):  # max 14 fill cycles to cover 12 months
            ym = ncd.strftime("%Y-%m")
            if ym > future_months[-1]:
                break
            if ym >= current_ym and ym not in projected_months:
                result[ym][cat][fill_type] += monthly_tp
                patient_counts[ym][cat][fill_type] += 1
                projected_months.add(ym)
                # For two_fills patients project the second fill in the same month
                if r.two_fills and fill_type != "new_start":
                    second_ncd = ncd + timedelta(days=ds)
                    ym2 = second_ncd.strftime("%Y-%m")
                    if ym2 == ym and ym2 not in {f"{ym}_2"}:
                        result[ym][cat]["2nd_fill"] += monthly_tp
                        patient_counts[ym][cat]["2nd_fill"] += 1
            ncd = ncd + timedelta(days=ds)

    # ── Build response ────────────────────────────────────────────────────────
    months_out = []
    for ym in future_months:
        entry: dict = {"month": ym, "categories": {}}
        for cat in ("IVIG", "HEME", "ANC_BILLED"):
            entry["categories"][cat] = {
                "1st_fill":  round(result[ym][cat].get("1st_fill", 0)),
                "2nd_fill":  round(result[ym][cat].get("2nd_fill", 0)),
                "new_start": round(result[ym][cat].get("new_start", 0)),
                "total":     round(sum(result[ym][cat].values())),
                "pts_1st":   patient_counts[ym][cat].get("1st_fill", 0),
                "pts_2nd":   patient_counts[ym][cat].get("2nd_fill", 0),
                "pts_new":   patient_counts[ym][cat].get("new_start", 0),
            }
        entry["total"] = round(sum(
            entry["categories"][c]["total"] for c in entry["categories"]
        ))
        months_out.append(entry)

    # Annual totals
    annual: dict = {}
    for cat in ("IVIG", "HEME", "ANC_BILLED"):
        annual[cat] = {
            "1st_fill":  round(sum(result[ym][cat].get("1st_fill", 0) for ym in future_months)),
            "2nd_fill":  round(sum(result[ym][cat].get("2nd_fill", 0) for ym in future_months)),
            "new_start": round(sum(result[ym][cat].get("new_start", 0) for ym in future_months)),
        }
        annual[cat]["total"] = sum(annual[cat].values())

    return {
        "months": months_out,
        "annual": annual,
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
