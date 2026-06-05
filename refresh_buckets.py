import os, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
sys.path.insert(0, os.getcwd())

from datetime import date
from database import SessionLocal
from models import Refill
from business_logic import compute_bucket

db = SessionLocal()
today = date.today()
for r in db.query(Refill).all():
    r.bucket = compute_bucket(r.next_call_date, r.current_status or "NO ATTEMPTS", today)
db.commit()
db.close()

import sqlite3
con = sqlite3.connect("osiris.db")
cur = con.cursor()
cur.execute("SELECT COUNT(*) FROM refill"); print(f"Total patients: {cur.fetchone()[0]}")
cur.execute("SELECT bucket, COUNT(*) FROM refill GROUP BY bucket ORDER BY COUNT(*) DESC")
print("Bucket breakdown:")
for row in cur.fetchall(): print(f"  {row[0]}: {row[1]}")
cur.execute("SELECT COUNT(*) FROM refill WHERE bucket NOT IN ('DISCHARGED','DISCONTINUED')")
print(f"\nActive (excl. DISCHARGED/DISCONTINUED): {cur.fetchone()[0]}")
con.close()
