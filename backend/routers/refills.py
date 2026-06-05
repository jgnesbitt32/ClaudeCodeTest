from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Refill
from schemas import BucketCount, RefillOut, RefillPatch, RefillPatchResponse
from business_logic import (
    compute_bucket,
    handle_scheduled_trigger,
    log_status_change,
    bucket_sort_key,
)

router = APIRouter(prefix="/refills", tags=["refills"])

BUCKET_PRIORITY = {
    "PAST DUE": 0,
    "THIS WEEK": 1,
    "NEXT WEEK": 2,
    "SCHEDULED": 3,
    "SHIPPED": 4,
    "DISCHARGED": 5,
    "DISCONTINUED": 6,
}


def _sort_key(r: Refill):
    bucket = r.bucket or ""
    priority = BUCKET_PRIORITY.get(bucket, 10)
    ncd = r.next_call_date.isoformat() if r.next_call_date else "9999-12-31"
    return (priority, bucket, ncd)


@router.get("/buckets", response_model=list[BucketCount])
def get_buckets(db: Session = Depends(get_db)):
    rows = (
        db.query(Refill.bucket, func.count(Refill.id))
        .group_by(Refill.bucket)
        .all()
    )
    result = [BucketCount(bucket=b or "UNKNOWN", count=c) for b, c in rows if b]
    result.sort(key=lambda x: BUCKET_PRIORITY.get(x.bucket, 10))
    return result


@router.get("", response_model=list[RefillOut])
def get_refills(
    bucket: Optional[str] = None,
    coach: Optional[str] = None,
    pharmacy: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Refill)

    if bucket and bucket != "ALL":
        q = q.filter(Refill.bucket == bucket)
    if coach:
        q = q.filter(Refill.coach == coach)
    if pharmacy:
        q = q.filter(Refill.pharmacy == pharmacy)
    if category:
        q = q.filter(Refill.category == category)
    if search:
        term = f"%{search}%"
        q = q.filter(
            (Refill.patient.ilike(term)) | (Refill.drug.ilike(term))
        )

    refills = q.all()
    refills.sort(key=_sort_key)
    return refills


@router.patch("/{refill_id}", response_model=RefillPatchResponse)
def patch_refill(
    refill_id: int,
    payload: RefillPatch,
    db: Session = Depends(get_db),
):
    refill = db.query(Refill).filter(Refill.id == refill_id).first()
    if not refill:
        raise HTTPException(status_code=404, detail="Refill not found")

    # SCHEDULED requires ship_date
    if payload.current_status == "SCHEDULED" and not (payload.ship_date or refill.ship_date):
        raise HTTPException(status_code=422, detail="ship_date is required when status is SCHEDULED")

    old_status = refill.current_status
    shipping_id: Optional[int] = None

    # Apply non-status fields
    if payload.coach is not None:
        refill.coach = payload.coach
    if payload.ship_date is not None:
        refill.ship_date = payload.ship_date
    if payload.follow_up_date is not None:
        refill.follow_up_date = payload.follow_up_date
    if payload.notes is not None:
        refill.notes = payload.notes

    # Apply status change
    if payload.current_status is not None and payload.current_status != old_status:
        log_status_change(
            db,
            refill.ptsn,
            refill.drug,
            old_status,
            payload.current_status,
            changed_by=payload.updated_by or "user",
        )
        refill.current_status = payload.current_status

        if payload.current_status == "SCHEDULED":
            ship_date = payload.ship_date or refill.ship_date
            shipping = handle_scheduled_trigger(db, refill, ship_date)
            db.flush()
            shipping_id = shipping.id

    # Recompute bucket
    if refill.next_call_date:
        refill.bucket = compute_bucket(refill.next_call_date, refill.current_status)

    refill.updated_at = datetime.utcnow()
    refill.updated_by = payload.updated_by or "user"

    db.commit()
    db.refresh(refill)

    return RefillPatchResponse(refill=RefillOut.model_validate(refill), shipping_id=shipping_id)
