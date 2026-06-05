"""Merge 2 remaining near-dupes and refresh all buckets with updated logic."""
import os, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
sys.path.insert(0, os.getcwd())

from datetime import date
from database import SessionLocal
from models import Refill, StatusHistory
from business_logic import compute_bucket

db = SessionLocal()
today = date.today()

# ── 1. Merge near-dupes by PTSN pairs ────────────────────────────────────────
near_dupes = [
    ("13322", "238512"),   # ANGELL, KANE ALEXANDER vs ANGELL, KANE
    ("13365", "225276"),   # GENTILE, JAKOB NEIL vs GENTILE, JAKOB
]

STATUS_RANK = {"SHIPPED": 0, "SCHEDULED": 1, "NO ATTEMPTS": 2,
               "DISCONTINUED": 3, "DISCHARGED": 4}

merged = 0
for keep_ptsn, drop_ptsn in near_dupes:
    keep = db.query(Refill).filter(Refill.ptsn == keep_ptsn).first()
    drop = db.query(Refill).filter(Refill.ptsn == drop_ptsn).first()
    if not keep or not drop:
        print(f"  Skipping {keep_ptsn}/{drop_ptsn} — not found")
        continue

    # Pick the better status
    keep_rank = STATUS_RANK.get(keep.current_status or "NO ATTEMPTS", 2)
    drop_rank = STATUS_RANK.get(drop.current_status or "NO ATTEMPTS", 2)
    if drop_rank < keep_rank:
        keep.current_status = drop.current_status
        keep.ship_date = drop.ship_date or keep.ship_date
        keep.next_call_date = drop.next_call_date or keep.next_call_date

    db.query(StatusHistory).filter(StatusHistory.ptsn == drop_ptsn).delete()
    db.delete(drop)
    print(f"  Merged {drop_ptsn} into {keep_ptsn} ({keep.patient})")
    merged += 1

db.commit()

# ── 2. Refresh all buckets with updated compute_bucket logic ──────────────────
all_refills = db.query(Refill).all()
for r in all_refills:
    new_bucket = compute_bucket(r.next_call_date, r.current_status or "NO ATTEMPTS", today)
    r.bucket = new_bucket

db.commit()
db.close()

# ── 3. Summary ────────────────────────────────────────────────────────────────
import sqlite3
con = sqlite3.connect("osiris.db")
cur = con.cursor()
cur.execute("SELECT COUNT(*) FROM refill"); print(f"\nTotal patients: {cur.fetchone()[0]}")
cur.execute("SELECT bucket, COUNT(*) FROM refill GROUP BY bucket ORDER BY COUNT(*) DESC")
print("Bucket breakdown:")
for row in cur.fetchall(): print(f"  {row[0]}: {row[1]}")
active = ["PAST DUE","THIS WEEK","NEXT WEEK","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","SCHEDULED"]
cur.execute(f"SELECT COUNT(*) FROM refill WHERE bucket IN ({','.join('?'*len(active))})", active)
print(f"\nActive (need outreach): {cur.fetchone()[0]}")
con.close()
