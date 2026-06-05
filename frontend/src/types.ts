export interface Refill {
  id: number;
  ptsn: string;
  patient: string;
  drug: string;
  ndc: string | null;
  category: string | null;
  pharmacy: string | null;
  tp: number | null;
  next_call_date: string | null;
  bucket: string | null;
  coach: string | null;
  current_status: string | null;
  ship_date: string | null;
  follow_up_date: string | null;
  notes: string | null;
  two_fills: boolean | null;
  updated_at: string | null;
}

export interface BucketCount {
  bucket: string;
  count: number;
}

export interface RefillPatch {
  coach?: string | null;
  current_status?: string | null;
  ship_date?: string | null;
  follow_up_date?: string | null;
  notes?: string | null;
  updated_by?: string;
}

export interface RefillPatchResponse {
  refill: Refill;
  shipping_id: number | null;
}

export const COACHES = ["JEAN", "HANNAH", "ROSS", "LARRY", "AMELIA"];
export const PHARMACIES = ["BLUEBIRD-FL", "BLUESKY-SC", "BLUEBIRD-SC", "BLUESKY-AL"];
export const CATEGORIES = ["IVIG", "HEME", "ANC_BILLED"];
export const REFILL_STATUSES = [
  "NO ATTEMPTS",
  "ATTEMPT 1",
  "ATTEMPT 2",
  "ATTEMPT 3",
  "SCHEDULED",
  "SHIPPED",
  "REFILL POSTPONED",
  "PUSHED",
  "DISCONTINUED",
  "DISCHARGED",
];
