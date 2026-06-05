# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**Osiris by BlueBird** — a professional CRM-like web application for a specialty infusion pharmacy that manages the full patient refill lifecycle: identifying patients due for refills, outreach and scheduling, and shipping medication. Replaces three manual Excel spreadsheets with a single polished interface.

## Tech Stack

- **Frontend:** React with TypeScript, Tailwind CSS, Vite
- **Backend:** Python (FastAPI)
- **Database:** SQLite for local dev (SQLAlchemy ORM, PostgreSQL-ready via env var)
- **Charts:** Recharts for projections visuals

## Brand

- App name: **Osiris by BlueBird**
- Primary color: `#1a3a6b` (dark navy)
- Accent color: `#4a7fd4` (medium blue)
- Logo: "Osiris" white bold + "by BlueBird" light blue (`text-blue-300`)
- Fonts: Segoe UI / system-ui stack

## Running the App

**Backend:**
```powershell
cd backend
pip install -r requirements.txt
python seed.py "C:\path\to\NEW BLUEBIRD FLIGHT STATUS 6.3.26.xlsx"
uvicorn main:app --reload
```

**Frontend:**
```powershell
cd frontend
npm install
npm run dev
```

Seed command accepts any path to the flight status Excel file. The SALES DATA sheet is used.

---

## Application Structure

### Layout
- **Left sidebar** (collapsible): dark navy (`#1a3a6b`), navigation icons + labels
- **Top bar**: app logo, user name, search, notifications
- **Main content area**: white/gray-50 background, card-based layouts

### Navigation (sidebar)
1. **Refills** — daily call worklist (PRIMARY view, default landing page)
2. **Dashboard** — overview with key metrics and alerts
3. **Shipping** — orders ready to ship (auto-created from Refills)
4. **Patients** — patient directory with individual profiles
5. **Projections** — monthly revenue forecast with charts
6. **Reports** — historical data, exportable

---

## Project Layout

```
backend/
├── main.py              # FastAPI app, CORS, router mounting
├── database.py          # SQLAlchemy engine + session factory
├── models.py            # ORM: Dispense, Refill, Shipping, StatusHistory, MonthlyGoal
├── schemas.py           # Pydantic request/response models
├── business_logic.py    # next_call_date, bucket engine, SCHEDULED trigger, SHIPPED sync
├── seed.py              # CLI: Excel → dispense rows → refill worklist
├── requirements.txt
└── routers/
    └── refills.py       # GET /api/refills, PATCH /api/refills/{id}, GET /api/refills/buckets

frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx          # React Router v6: / redirects to /refills
│   ├── types.ts         # TypeScript interfaces
│   ├── api.ts           # Axios wrapper
│   ├── components/
│   │   └── Layout.tsx
│   └── pages/
│       └── RefillsPage.tsx
├── vite.config.ts       # proxy /api → http://localhost:8000
└── tailwind.config.js
```

---

## Data Model

### dispense (append-only, from data warehouse)
```
id, rx_number, refill_no, ptsn, patient, drug, ndc, category, pharmacy,
date_completed, days_supply, disp_qty, tp, gp, acq_cost, primary_copay,
plan_type, prescriber, rep, bill_month, source_load_date
UNIQUE(rx_number, refill_no, date_completed)
```

### refill (one row per patient+drug, the worklist)
```
id, ptsn, patient, drug, ndc, category, pharmacy, tp,
next_call_date (computed), bucket (computed),
coach, current_status, ship_date, follow_up_date, notes,
two_fills, updated_by, updated_at
UNIQUE(ptsn, drug)
```

### shipping (auto-created from SCHEDULED trigger)
```
id, refill_id (FK), ptsn, patient, drug,
shipping_date, delivery_date, rx_number, fill_number,
fill_for_month, location, patient_type, medication,
quantity, dose_units_dispensed_pct, supply_list_needed,
qty_ancillary_meds, charging_copay, copay_explanation,
confirmed_shipping_address, total_paid, cost,
billing_type, shipping_notes, status, ordered_date
```

### status_history (audit trail)
```
id, ptsn, drug, old_status, new_status, changed_by, changed_at, reason
```

### monthly_goal
```
period_month, cls, goal_tp    PK(period_month, cls)
```

---

## Business Logic

### Next Call Date
`NEXT_CALL_DATE = DATE_COMPLETED + DAYS_SUPPLY - 7`
Flat 7-day global lead time. Exclude CATEGORY="OTHER" and DAYS_SUPPLY ≤ 7 (PRN).
Only the latest dispense per (PTSN, DRUG) drives the worklist.

### Bucket Engine
```
if status in (SHIPPED, DISCHARGED, DISCONTINUED, SCHEDULED) → bucket = status
elif next_call_date < today → PAST DUE
elif next_call_date ≤ today + 7 → THIS WEEK
elif next_call_date ≤ today + 14 → NEXT WEEK
else → future month name (e.g., "JULY")
```

### SCHEDULED Trigger
When current_status changes to SCHEDULED:
1. Require ship_date (422 if missing)
2. Pull latest dispense for ptsn+drug
3. Auto-detect fill_for_month: no prior dispense → "New Patient"; prior but not this month → "1st"; prior this month → "2nd"
4. Create shipping record with auto-filled fields
5. Log to status_history

### SHIPPED Sync
When shipping status → SHIPPED: update refill current_status to SHIPPED.

### Data Refresh (daily)
Ingest dispense data, recompute next_call_date and bucket.
NEVER overwrite human-entered fields (coach, status, notes, ship_date, follow_up_date).
Idempotent: re-ingesting the same data changes nothing.

---

## Dropdown Values

- **Coach:** JEAN, HANNAH, ROSS, LARRY, AMELIA
- **Pharmacy:** BLUEBIRD-FL, BLUESKY-SC, BLUEBIRD-SC, BLUESKY-AL
- **Billing Type:** PBM, MEDICAL, OMNYSIS, SUPPLY PLAN, TPA, TRS, CASH
- **Shipping Status:** PENDING, SHIPPED, DELAYED, CANCELLED
- **Fill For Month:** New Patient, 1st, 2nd
- **Refill Status:** NO ATTEMPTS, ATTEMPT 1, ATTEMPT 2, ATTEMPT 3, SCHEDULED, SHIPPED, REFILL POSTPONED, PUSHED, DISCONTINUED, DISCHARGED
- **Category:** IVIG, HEME, ANC_BILLED

---

## Seed Data

Source: `NEW BLUEBIRD FLIGHT STATUS 6.3.26.xlsx`, sheet: SALES DATA.

Column mapping (Excel → dispense table):
RX NUMBER→rx_number, RF→refill_no, PTSN→ptsn, PATIENT→patient, DRUG→drug,
NDC→ndc, CATEGORY→category, PHARMACY→pharmacy, DATE COMPLETED→date_completed,
DAYS SUPPLY→days_supply, DISP QTY→disp_qty, TP→tp, GP→gp, ACQ COST→acq_cost,
PRIMARY COPAY→primary_copay, PRIMARY PLAN TYPE→plan_type, PRESCRIBER→prescriber,
REP→rep, MONTH→bill_month

LATEST ROW column (bool) flags most-recent dispense per (ptsn, drug) — used when building the refill worklist.

---

## Key Principles

1. **Refills-first:** the worklist is the landing page. Everything else supports it.
2. **One action, full cascade:** status → SCHEDULED auto-creates shipping. No double entry.
3. **Human layer survives refresh:** daily data reload never wipes tech-entered fields.
4. **Every status change is logged** in status_history for audit/compliance.
5. **Spreadsheet speed, CRM polish:** inline editing, instant saves. Techs should feel like they're working in Excel but with superpowers.

---

## Git / GitHub

- Remote: `https://github.com/jgnesbitt32/ClaudeCodeTest`
- Branch: `master`
- Git identity configured locally: `jgnesbitt32` / `johngarland@bluebirdpharm.com`

**Commit and push after every meaningful unit of work.** Never batch multiple unrelated changes into one commit.

Commit message format:
- First line: short imperative summary
- Co-author trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

After every commit, run `git push` immediately.
