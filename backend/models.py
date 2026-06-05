from datetime import date, datetime
from sqlalchemy import (
    Column, Integer, String, Float, Date, DateTime, Boolean,
    ForeignKey, UniqueConstraint, Text,
)
from sqlalchemy.orm import relationship
from database import Base


class Dispense(Base):
    __tablename__ = "dispense"

    id = Column(Integer, primary_key=True)
    rx_number = Column(String, nullable=False)
    refill_no = Column(Integer, nullable=False)
    ptsn = Column(String, nullable=False)
    patient = Column(String, nullable=False)
    drug = Column(String, nullable=False)
    ndc = Column(String)
    category = Column(String)
    pharmacy = Column(String)
    date_completed = Column(Date)
    days_supply = Column(Integer)
    disp_qty = Column(Float)
    tp = Column(Float)
    gp = Column(Float)
    acq_cost = Column(Float)
    primary_copay = Column(Float)
    plan_type = Column(String)
    prescriber = Column(String)
    rep = Column(String)
    bill_month = Column(String)
    source_load_date = Column(Date, default=date.today)

    __table_args__ = (
        UniqueConstraint("rx_number", "refill_no", "date_completed", name="uq_dispense"),
    )


class Refill(Base):
    __tablename__ = "refill"

    id = Column(Integer, primary_key=True)
    ptsn = Column(String, nullable=False)
    patient = Column(String, nullable=False)
    drug = Column(String, nullable=False)
    ndc = Column(String)
    category = Column(String)
    pharmacy = Column(String)
    tp = Column(Float)
    next_call_date = Column(Date)
    bucket = Column(String)
    coach = Column(String)
    current_status = Column(String, default="NO ATTEMPTS")
    ship_date = Column(Date)
    follow_up_date = Column(Date)
    notes = Column(Text)
    two_fills = Column(Boolean, default=False)
    updated_by = Column(String)
    updated_at = Column(DateTime)

    shipping_records = relationship("Shipping", back_populates="refill")

    __table_args__ = (
        UniqueConstraint("ptsn", "drug", name="uq_refill"),
    )


class Shipping(Base):
    __tablename__ = "shipping"

    id = Column(Integer, primary_key=True)
    refill_id = Column(Integer, ForeignKey("refill.id"), nullable=False)
    ptsn = Column(String, nullable=False)
    patient = Column(String)
    drug = Column(String)
    shipping_date = Column(Date)
    delivery_date = Column(Date)
    rx_number = Column(String)
    fill_number = Column(Integer)
    fill_for_month = Column(String)
    location = Column(String)
    patient_type = Column(String)
    medication = Column(String)
    quantity = Column(Float)
    dose_units_dispensed_pct = Column(String)
    supply_list_needed = Column(String)
    qty_ancillary_meds = Column(Float)
    charging_copay = Column(Float)
    copay_explanation = Column(String)
    confirmed_shipping_address = Column(String)
    total_paid = Column(Float)
    cost = Column(Float)
    billing_type = Column(String)
    shipping_notes = Column(Text)
    status = Column(String, default="PENDING")
    ordered_date = Column(Date)

    refill = relationship("Refill", back_populates="shipping_records")


class StatusHistory(Base):
    __tablename__ = "status_history"

    id = Column(Integer, primary_key=True)
    ptsn = Column(String, nullable=False)
    drug = Column(String, nullable=False)
    old_status = Column(String)
    new_status = Column(String)
    changed_by = Column(String)
    changed_at = Column(DateTime, default=datetime.utcnow)
    reason = Column(String)


class MonthlyGoal(Base):
    __tablename__ = "monthly_goal"

    period_month = Column(String, primary_key=True)
    cls = Column(String, primary_key=True)
    goal_tp = Column(Float, nullable=False)
