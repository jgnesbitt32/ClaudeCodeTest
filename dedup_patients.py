"""
Merge same-name patients who have different PTSNs (different pharmacy locations).
Keeps the record with the most active status; deletes duplicates.
Run from repo root: python dedup_patients.py
"""
import sys, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
sys.path.insert(0, os.getcwd())

from database import SessionLocal
from models import Refill, Shipping, StatusHistory

STATUS_RANK = {
    "SHIPPED": 0,
    "SCHEDULED": 1,
    "NO ATTEMPTS": 2,
    "ATTEMPT 1": 2,
    "ATTEMPT 2": 2,
    "ATTEMPT 3": 2,
    "REFILL POSTPONED": 3,
    "PUSHED": 3,
    "DISCHARGED": 4,
    "DISCONTINUED": 5,
}

def rank(r):
    s = (r.current_status or "NO ATTEMPTS").upper()
    sr = STATUS_RANK.get(s, 3)
    ncd = r.next_call_date.toordinal() if r.next_call_date else 0
    return (sr, -ncd)   # lower rank number = better; more recent date = better

db = SessionLocal()

refills = db.query(Refill).all()

# Group by normalized name
from collections import defaultdict
by_name = defaultdict(list)
for r in refills:
    key = (r.patient or "").upper().strip()
    by_name[key].append(r)

merged = 0
deleted = 0

for name, group in by_name.items():
    if len(group) == 1:
        continue

    # Sort: best record first
    group.sort(key=rank)
    keep = group[0]
    dupes = group[1:]

    # Merge: take better date/ship_date from any duplicate
    for d in dupes:
        if d.ship_date and (not keep.ship_date or d.ship_date > keep.ship_date):
            keep.ship_date = d.ship_date
        if d.notes and not keep.notes:
            keep.notes = d.notes
        if d.coach and not keep.coach:
            keep.coach = d.coach

        # Reassign shipping records to the keeper
        for s in d.shipping_records:
            s.refill_id = keep.id
            s.ptsn = keep.ptsn

        # Delete status history for dupes
        db.query(StatusHistory).filter(StatusHistory.ptsn == d.ptsn).delete()

        db.delete(d)
        deleted += 1

    merged += 1

db.commit()
db.close()

print(f"Merged {merged} patient groups, removed {deleted} duplicate records.")

# Final count
import sqlite3
con = sqlite3.connect("osiris.db")
cur = con.cursor()
cur.execute("SELECT COUNT(*) FROM refill"); print(f"Refill rows now: {cur.fetchone()[0]}")
cur.execute("SELECT current_status, COUNT(*) FROM refill GROUP BY current_status ORDER BY COUNT(*) DESC")
for row in cur.fetchall(): print(f"  {row[0]}: {row[1]}")
con.close()
