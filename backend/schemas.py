from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


class RefillOut(BaseModel):
    id: int
    ptsn: str
    patient: str
    drug: str
    ndc: Optional[str]
    category: Optional[str]
    pharmacy: Optional[str]
    tp: Optional[float]
    next_call_date: Optional[date]
    bucket: Optional[str]
    coach: Optional[str]
    current_status: Optional[str]
    ship_date: Optional[date]
    follow_up_date: Optional[date]
    notes: Optional[str]
    two_fills: Optional[bool]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class RefillPatch(BaseModel):
    coach: Optional[str] = None
    current_status: Optional[str] = None
    ship_date: Optional[date] = None
    follow_up_date: Optional[date] = None
    notes: Optional[str] = None
    updated_by: Optional[str] = None


class RefillPatchResponse(BaseModel):
    refill: RefillOut
    shipping_id: Optional[int] = None


class BucketCount(BaseModel):
    bucket: str
    count: int


class ShippingOut(BaseModel):
    id: int
    refill_id: int
    ptsn: str
    patient: Optional[str]
    drug: Optional[str]
    shipping_date: Optional[date]
    delivery_date: Optional[date]
    rx_number: Optional[str]
    fill_number: Optional[int]
    fill_for_month: Optional[str]
    location: Optional[str]
    patient_type: Optional[str]
    medication: Optional[str]
    quantity: Optional[float]
    dose_units_dispensed_pct: Optional[str]
    supply_list_needed: Optional[str]
    qty_ancillary_meds: Optional[float]
    charging_copay: Optional[float]
    copay_explanation: Optional[str]
    confirmed_shipping_address: Optional[str]
    total_paid: Optional[float]
    cost: Optional[float]
    billing_type: Optional[str]
    shipping_notes: Optional[str]
    status: Optional[str]
    ordered_date: Optional[date]

    model_config = {"from_attributes": True}
