from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Refill, Shipping
from schemas import ShippingOut
from business_logic import handle_shipped_sync, log_status_change

router = APIRouter(prefix="/shipping", tags=["shipping"])


class ShippingPatch(BaseModel):
    delivery_date: Optional[date] = None
    quantity: Optional[float] = None
    dose_units_dispensed_pct: Optional[str] = None
    supply_list_needed: Optional[str] = None
    qty_ancillary_meds: Optional[float] = None
    charging_copay: Optional[float] = None
    copay_explanation: Optional[str] = None
    confirmed_shipping_address: Optional[str] = None
    billing_type: Optional[str] = None
    shipping_notes: Optional[str] = None
    status: Optional[str] = None
    shipping_date: Optional[date] = None


class ShippingSummary(BaseModel):
    total_orders: int
    total_tp: float
    shipped_count: int
    pending_count: int


class ShippingListResponse(BaseModel):
    summary: ShippingSummary
    records: list[ShippingOut]


@router.get("", response_model=ShippingListResponse)
def get_shipping(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    location: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Shipping)

    if date_from:
        q = q.filter(Shipping.shipping_date >= date_from)
    if date_to:
        q = q.filter(Shipping.shipping_date <= date_to)
    if location:
        q = q.filter(Shipping.location == location)
    if status:
        q = q.filter(Shipping.status == status)

    records = q.order_by(Shipping.shipping_date.asc()).all()

    total_tp = sum(r.total_paid or 0 for r in records)
    shipped_count = sum(1 for r in records if r.status == "SHIPPED")
    pending_count = sum(1 for r in records if r.status == "PENDING")

    return ShippingListResponse(
        summary=ShippingSummary(
            total_orders=len(records),
            total_tp=total_tp,
            shipped_count=shipped_count,
            pending_count=pending_count,
        ),
        records=[ShippingOut.model_validate(r) for r in records],
    )


@router.patch("/{shipping_id}", response_model=ShippingOut)
def patch_shipping(
    shipping_id: int,
    payload: ShippingPatch,
    db: Session = Depends(get_db),
):
    shipping = db.query(Shipping).filter(Shipping.id == shipping_id).first()
    if not shipping:
        raise HTTPException(status_code=404, detail="Shipping record not found")

    old_status = shipping.status

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(shipping, field, value)

    # SHIPPED sync: when status changes to SHIPPED, update the parent refill
    if payload.status == "SHIPPED" and old_status != "SHIPPED":
        handle_shipped_sync(db, shipping)

        # Also log in status_history via the refill
        refill = db.query(Refill).filter(Refill.id == shipping.refill_id).first()
        if refill:
            log_status_change(db, refill.ptsn, refill.drug, "SCHEDULED", "SHIPPED", changed_by="user")

    db.commit()
    db.refresh(shipping)
    return ShippingOut.model_validate(shipping)
