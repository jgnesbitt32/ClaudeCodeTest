from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from models import Dispense, Refill, Shipping, StatusHistory

TERMINAL_STATUSES = {"SHIPPED", "DISCHARGED", "DISCONTINUED", "SCHEDULED"}

BUCKET_ORDER = {
    "PAST DUE": 0,
    "THIS WEEK": 1,
    "NEXT WEEK": 2,
    "SCHEDULED": 3,
    "SHIPPED": 4,
    "DISCHARGED": 5,
    "DISCONTINUED": 6,
}


def compute_next_call_date(date_completed: date, days_supply: int) -> date:
    return date_completed + timedelta(days=int(days_supply) - 7)


def compute_bucket(next_call_date: date, current_status: str, today: date | None = None) -> str:
    if today is None:
        today = date.today()
    if current_status in TERMINAL_STATUSES:
        return current_status
    if next_call_date < today:
        return "PAST DUE"
    if next_call_date <= today + timedelta(days=7):
        return "THIS WEEK"
    if next_call_date <= today + timedelta(days=14):
        return "NEXT WEEK"
    return next_call_date.strftime("%B").upper()


def bucket_sort_key(bucket: str) -> tuple:
    if bucket in BUCKET_ORDER:
        return (BUCKET_ORDER[bucket], "")
    # Future month names — sort alphabetically after NEXT WEEK
    return (10, bucket)


def detect_fill_for_month(db: Session, ptsn: str, drug: str, ship_month: date) -> str:
    prior = (
        db.query(Dispense)
        .filter(Dispense.ptsn == ptsn, Dispense.drug == drug)
        .order_by(Dispense.date_completed.desc())
        .first()
    )
    if prior is None:
        return "New Patient"
    if prior.date_completed.year == ship_month.year and prior.date_completed.month == ship_month.month:
        return "2nd"
    return "1st"


def handle_scheduled_trigger(db: Session, refill: Refill, ship_date: date) -> Shipping:
    latest_dispense = (
        db.query(Dispense)
        .filter(Dispense.ptsn == refill.ptsn, Dispense.drug == refill.drug)
        .order_by(Dispense.date_completed.desc())
        .first()
    )

    fill_for_month = detect_fill_for_month(db, refill.ptsn, refill.drug, ship_date)

    shipping = Shipping(
        refill_id=refill.id,
        ptsn=refill.ptsn,
        patient=refill.patient,
        drug=refill.drug,
        shipping_date=ship_date,
        rx_number=latest_dispense.rx_number if latest_dispense else None,
        fill_number=latest_dispense.refill_no if latest_dispense else None,
        fill_for_month=fill_for_month,
        location=refill.pharmacy,
        patient_type=refill.category,
        medication=refill.drug,
        quantity=latest_dispense.disp_qty if latest_dispense else None,
        charging_copay=latest_dispense.primary_copay if latest_dispense else None,
        total_paid=latest_dispense.tp if latest_dispense else None,
        cost=latest_dispense.acq_cost if latest_dispense else None,
        status="PENDING",
        ordered_date=date.today(),
    )
    db.add(shipping)
    return shipping


def handle_shipped_sync(db: Session, shipping: Shipping) -> None:
    refill = db.query(Refill).filter(Refill.id == shipping.refill_id).first()
    if refill:
        refill.current_status = "SHIPPED"
        refill.bucket = "SHIPPED"
        refill.updated_at = datetime.utcnow()


def log_status_change(
    db: Session,
    ptsn: str,
    drug: str,
    old_status: str | None,
    new_status: str,
    changed_by: str = "system",
) -> None:
    entry = StatusHistory(
        ptsn=ptsn,
        drug=drug,
        old_status=old_status,
        new_status=new_status,
        changed_by=changed_by,
        changed_at=datetime.utcnow(),
    )
    db.add(entry)
