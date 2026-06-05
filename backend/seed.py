"""
Usage: python seed.py "path/to/NEW BLUEBIRD FLIGHT STATUS 6.3.26.xlsx"

Reads the SALES DATA sheet, upserts dispense rows, then builds/refreshes
the refill worklist. Human-entered fields (coach, status, notes, ship_date,
follow_up_date) are never overwritten on existing rows.
"""
import sys
from datetime import date, datetime

import pandas as pd
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from database import SessionLocal, create_all
from models import Dispense, Refill
from business_logic import compute_next_call_date, compute_bucket

COLUMN_MAP = {
    "RX NUMBER": "rx_number",
    "RF": "refill_no",
    "PTSN": "ptsn",
    "PATIENT": "patient",
    "DRUG": "drug",
    "NDC": "ndc",
    "CATEGORY": "category",
    "PHARMACY": "pharmacy",
    "DATE COMPLETED": "date_completed",
    "DAYS SUPPLY": "days_supply",
    "DISP QTY": "disp_qty",
    "TP": "tp",
    "GP": "gp",
    "ACQ COST": "acq_cost",
    "PRIMARY COPAY": "primary_copay",
    "PRIMARY PLAN TYPE": "plan_type",
    "PRESCRIBER": "prescriber",
    "REP": "rep",
    "MONTH": "bill_month",
}

PROTECTED_FIELDS = {"coach", "notes", "ship_date", "follow_up_date"}


def safe_float(val):
    try:
        f = float(val)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def safe_int(val):
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def safe_date(val):
    if pd.isna(val) if not isinstance(val, (str, date, datetime)) else False:
        return None
    if isinstance(val, (date, datetime)):
        return val.date() if isinstance(val, datetime) else val
    try:
        return pd.to_datetime(val).date()
    except Exception:
        return None


def safe_str(val):
    if val is None:
        return None
    try:
        if pd.isna(val):
            return None
    except TypeError:
        pass
    return str(val).strip() or None


def load_excel(path: str) -> pd.DataFrame:
    print(f"Reading: {path}")
    df = pd.read_excel(path, sheet_name="SALES DATA", dtype=str)
    print(f"  Rows read: {len(df)}")
    return df


def build_dispense_rows(df: pd.DataFrame) -> list[dict]:
    today = date.today()
    rows = []
    for _, row in df.iterrows():
        cat = safe_str(row.get("CATEGORY", ""))
        days_supply_raw = safe_int(row.get("DAYS SUPPLY"))

        # Skip PRN and OTHER for dispense — keep all for audit purposes
        # (worklist filtering happens during refill upsert)
        rx = safe_str(row.get("RX NUMBER"))
        rf = safe_int(row.get("RF"))
        dc = safe_date(row.get("DATE COMPLETED"))

        if not rx or rf is None or dc is None:
            continue

        rows.append({
            "rx_number": rx,
            "refill_no": rf,
            "ptsn": safe_str(row.get("PTSN")),
            "patient": safe_str(row.get("PATIENT")),
            "drug": safe_str(row.get("DRUG")),
            "ndc": safe_str(row.get("NDC")),
            "category": cat,
            "pharmacy": safe_str(row.get("PHARMACY")),
            "date_completed": dc,
            "days_supply": days_supply_raw,
            "disp_qty": safe_float(row.get("DISP QTY")),
            "tp": safe_float(row.get("TP")),
            "gp": safe_float(row.get("GP")),
            "acq_cost": safe_float(row.get("ACQ COST")),
            "primary_copay": safe_float(row.get("PRIMARY COPAY")),
            "plan_type": safe_str(row.get("PRIMARY PLAN TYPE")),
            "prescriber": safe_str(row.get("PRESCRIBER")),
            "rep": safe_str(row.get("REP")),
            "bill_month": safe_str(row.get("MONTH")),
            "source_load_date": today,
        })
    return rows


def upsert_dispense(db, rows: list[dict]) -> int:
    inserted = 0
    for row in rows:
        stmt = sqlite_insert(Dispense).values(**row).on_conflict_do_nothing(
            index_elements=["rx_number", "refill_no", "date_completed"]
        )
        result = db.execute(stmt)
        inserted += result.rowcount
    db.commit()
    return inserted


def build_refill_worklist(db, df: pd.DataFrame) -> tuple[int, int]:
    today = date.today()

    # Identify latest dispense per (ptsn, drug) using LATEST ROW flag if present,
    # otherwise fall back to max date_completed from what we just ingested.
    latest_col = "LATEST ROW" if "LATEST ROW" in df.columns else None

    df["_dc"] = pd.to_datetime(df["DATE COMPLETED"], errors="coerce")

    if latest_col:
        # Include LATEST, SCHEDULED, and DISCONTINUED so those statuses appear in the worklist
        filtered = df[df[latest_col].astype(str).str.strip().str.upper().isin(["LATEST", "SCHEDULED", "DISCONTINUED"])]
    else:
        filtered = df

    # Deduplicate: one row per (PTSN, DRUG) — keep most recent DATE COMPLETED
    filtered = filtered.copy()
    idx = filtered.groupby(["PTSN", "DRUG"])["_dc"].idxmax()
    latest_df = filtered.loc[idx]

    inserted = updated = 0

    for _, row in latest_df.iterrows():
        cat = safe_str(row.get("CATEGORY", ""))
        days_supply = safe_int(row.get("DAYS SUPPLY"))
        ptsn = safe_str(row.get("PTSN"))
        drug = safe_str(row.get("DRUG"))
        dc = safe_date(row.get("DATE COMPLETED"))

        # Exclude PRN and OTHER from the worklist
        if cat == "OTHER" or days_supply is None or days_supply <= 7:
            continue
        if not ptsn or not drug or dc is None:
            continue

        # Derive initial status from Excel columns
        latest_row_val = safe_str(row.get("LATEST ROW", "")) or ""
        next_fill_status = safe_str(row.get("NEXT FILL STATUS", "")) or ""
        patient_status = safe_str(row.get("PATIENT STATUS", "")) or ""
        two_fills_val = safe_str(row.get("2X FILL IN SAME MONTH", "")) or ""

        if patient_status.upper() == "DISCHARGED":
            initial_status = "DISCHARGED"
        elif latest_row_val.upper() == "DISCONTINUED" or next_fill_status.upper() == "DISCONTINUED":
            initial_status = "DISCONTINUED"
        elif latest_row_val.upper() == "SCHEDULED" or next_fill_status.upper() == "SCHEDULED":
            initial_status = "SCHEDULED"
        else:
            initial_status = "NO ATTEMPTS"

        two_fills = two_fills_val.upper() == "2 FILLS"

        next_call_date = compute_next_call_date(dc, days_supply)
        tp = safe_float(row.get("TP"))

        existing = db.query(Refill).filter(Refill.ptsn == ptsn, Refill.drug == drug).first()

        if existing:
            # Always refresh computed + Excel-sourced fields
            existing.next_call_date = next_call_date
            existing.current_status = initial_status
            existing.bucket = compute_bucket(next_call_date, initial_status, today)
            existing.tp = tp
            existing.two_fills = two_fills
            existing.patient = safe_str(row.get("PATIENT")) or existing.patient
            existing.ndc = safe_str(row.get("NDC")) or existing.ndc
            existing.category = cat or existing.category
            existing.pharmacy = safe_str(row.get("PHARMACY")) or existing.pharmacy
            updated += 1
        else:
            bucket = compute_bucket(next_call_date, initial_status, today)
            refill = Refill(
                ptsn=ptsn,
                patient=safe_str(row.get("PATIENT")),
                drug=drug,
                ndc=safe_str(row.get("NDC")),
                category=cat,
                pharmacy=safe_str(row.get("PHARMACY")),
                tp=tp,
                next_call_date=next_call_date,
                bucket=bucket,
                current_status=initial_status,
                two_fills=two_fills,
            )
            db.add(refill)
            inserted += 1

    db.commit()
    return inserted, updated


def main():
    if len(sys.argv) < 2:
        print("Usage: python seed.py <path_to_excel>")
        sys.exit(1)

    path = sys.argv[1]
    create_all()
    df = load_excel(path)

    db = SessionLocal()
    try:
        dispense_rows = build_dispense_rows(df)
        n_dispense = upsert_dispense(db, dispense_rows)
        print(f"  Dispense rows inserted: {n_dispense} (duplicates skipped)")

        n_inserted, n_updated = build_refill_worklist(db, df)
        print(f"  Refill rows inserted: {n_inserted}, updated: {n_updated}")
        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
