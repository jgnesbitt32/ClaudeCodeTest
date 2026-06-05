"""
One-time migration: reads ORDERS_MASTER_2026.xlsx and reconciles refill statuses.

For each patient-PTSN found in the orders file:
  - If their most recent ship + days_supply is still in the future → mark SHIPPED
  - If their supply has run out → roll next_call_date forward to current cycle
    so they show as THIS WEEK / JUNE / etc. instead of years-old PAST DUE

Run: python migrate_orders.py
"""
import sys
from datetime import date, timedelta

import pandas as pd

sys.path.insert(0, ".")
from database import SessionLocal, create_all
from models import Dispense, Refill
from business_logic import compute_next_call_date, compute_bucket

ORDERS_PATH = r"C:\Users\jgnes\OneDrive\Desktop\ClaudeCodeTest\ORDERS_MASTER_2026.xlsx"


def parse_orders() -> dict[str, date]:
    """Return {ptsn: latest_ship_date} from all weekly sheets."""
    xl = pd.ExcelFile(ORDERS_PATH)
    latest: dict[str, date] = {}

    for sheet in xl.sheet_names:
        if not sheet.startswith("202"):
            continue
        try:
            df = xl.parse(sheet, header=None)
        except Exception:
            continue

        # Data rows start at index 13 (row 12 = 0-indexed header)
        for _, row in df.iloc[13:].iterrows():
            raw_date = row.iloc[0]
            raw_ptsn = row.iloc[3]

            if pd.isna(raw_date) or pd.isna(raw_ptsn):
                continue

            # Parse ship date
            if hasattr(raw_date, "date"):
                ship_date = raw_date.date()
            elif isinstance(raw_date, date):
                ship_date = raw_date
            else:
                continue

            # Normalise PTSN (strip ".0" from floats)
            ptsn = str(raw_ptsn).strip()
            if "." in ptsn:
                ptsn = ptsn.split(".")[0]
            if not ptsn or ptsn.lower() in ("nan", ""):
                continue

            if ptsn not in latest or ship_date > latest[ptsn]:
                latest[ptsn] = ship_date

    return latest


def advance_to_current_cycle(ncd: date, days_supply: int, today: date) -> date:
    """Roll ncd forward by days_supply until within the current supply window."""
    ds = timedelta(days=days_supply)
    while ncd + ds < today:
        ncd += ds
    return ncd


def main():
    create_all()
    db = SessionLocal()
    today = date.today()

    print("Parsing ORDERS_MASTER_2026.xlsx…")
    latest_ship = parse_orders()
    print(f"  Found {len(latest_ship)} unique PTSNs with ship records")

    updated_shipped = 0
    updated_rolled = 0
    skipped = 0

    # ── 1. Update patients found in the orders file ───────────────────────────
    for ptsn, ship_date in latest_ship.items():
        refills = db.query(Refill).filter(Refill.ptsn == ptsn).all()
        for refill in refills:
            if refill.current_status in ("DISCONTINUED", "DISCHARGED"):
                skipped += 1
                continue

            latest_disp = (
                db.query(Dispense)
                .filter(Dispense.ptsn == ptsn, Dispense.drug == refill.drug)
                .order_by(Dispense.date_completed.desc())
                .first()
            )
            ds = latest_disp.days_supply if latest_disp and latest_disp.days_supply else 28
            supply_end = ship_date + timedelta(days=ds)

            if supply_end >= today:
                # Supply still active → mark SHIPPED
                refill.ship_date = ship_date
                refill.current_status = "SHIPPED"
                refill.next_call_date = compute_next_call_date(ship_date, ds)
                refill.bucket = "SHIPPED"
                updated_shipped += 1
            else:
                # Supply exhausted → roll forward to current cycle
                ncd = compute_next_call_date(ship_date, ds)
                ncd = advance_to_current_cycle(ncd, ds, today)
                refill.next_call_date = ncd
                refill.bucket = compute_bucket(ncd, refill.current_status or "NO ATTEMPTS", today)
                updated_rolled += 1

    db.commit()

    # ── 2. Roll forward any remaining PAST DUE with very stale dates ──────────
    stale_refills = (
        db.query(Refill)
        .filter(Refill.bucket == "PAST DUE")
        .all()
    )

    rolled_stale = 0
    for refill in stale_refills:
        if refill.current_status in ("DISCONTINUED", "DISCHARGED"):
            continue
        if not refill.next_call_date:
            continue

        latest_disp = (
            db.query(Dispense)
            .filter(Dispense.ptsn == refill.ptsn, Dispense.drug == refill.drug)
            .order_by(Dispense.date_completed.desc())
            .first()
        )
        ds = latest_disp.days_supply if latest_disp and latest_disp.days_supply else 28

        # Only roll if more than one full cycle past due
        if refill.next_call_date + timedelta(days=ds) < today:
            ncd = advance_to_current_cycle(refill.next_call_date, ds, today)
            refill.next_call_date = ncd
            refill.bucket = compute_bucket(ncd, refill.current_status or "NO ATTEMPTS", today)
            rolled_stale += 1

    db.commit()
    db.close()

    print(f"\nResults:")
    print(f"  Marked SHIPPED (supply still active):    {updated_shipped}")
    print(f"  Rolled forward (supply expired):         {updated_rolled}")
    print(f"  Stale PAST DUE rolled to current cycle: {rolled_stale}")
    print(f"  Skipped (DISCONTINUED/DISCHARGED):      {skipped}")
    print(f"\nMigration complete.")


if __name__ == "__main__":
    main()
