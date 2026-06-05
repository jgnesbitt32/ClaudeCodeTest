import { useCallback, useEffect, useRef, useState } from "react";
import { getBuckets, getRefills, patchRefill } from "../api";
import type { BucketCount, Refill, RefillPatch } from "../types";
import { COACHES, PHARMACIES, CATEGORIES, REFILL_STATUSES } from "../types";

// ── Bucket badge styling ─────────────────────────────────────────────────────
function bucketBadge(bucket: string | null): string {
  switch (bucket) {
    case "PAST DUE":    return "bg-red-100 text-red-700 border border-red-200";
    case "THIS WEEK":   return "bg-blue-100 text-blue-700 border border-blue-200";
    case "NEXT WEEK":   return "bg-green-100 text-green-700 border border-green-200";
    case "SCHEDULED":   return "bg-purple-100 text-purple-700 border border-purple-200";
    case "SHIPPED":     return "bg-gray-200 text-gray-600 border border-gray-300";
    case "DISCONTINUED":
    case "DISCHARGED":  return "bg-gray-100 text-gray-500 border border-gray-200";
    default:            return "bg-orange-100 text-orange-700 border border-orange-200";
  }
}

function categoryBadge(cat: string | null): string {
  switch (cat) {
    case "IVIG": return "bg-blue-100 text-blue-700";
    case "HEME": return "bg-red-100 text-red-700";
    case "ANC_BILLED": return "bg-green-100 text-green-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

function fmt(val: number | null): string {
  if (val == null) return "—";
  return val.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ── RefillsPage ───────────────────────────────────────────────────────────────
export default function RefillsPage() {
  const [refills, setRefills] = useState<Refill[]>([]);
  const [buckets, setBuckets] = useState<BucketCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeBucket, setActiveBucket] = useState("ALL");
  const [coach, setCoach] = useState("");
  const [pharmacy, setPharmacy] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // per-row pending changes: rowId → partial patch
  const [pending, setPending] = useState<Record<number, RefillPatch>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const fetchData = useCallback(async () => {
    try {
      const [r, b] = await Promise.all([
        getRefills({ bucket: activeBucket, coach, pharmacy, category, search: debouncedSearch }),
        getBuckets(),
      ]);
      setRefills(r);
      setBuckets(b);
      setError(null);
    } catch {
      setError("Failed to load refills. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, [activeBucket, coach, pharmacy, category, debouncedSearch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounce search
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  function change(id: number, field: keyof RefillPatch, value: string | null) {
    setPending((p) => ({ ...p, [id]: { ...p[id], [field]: value } }));
  }

  function effectiveValue<K extends keyof Refill>(row: Refill, field: K): Refill[K] {
    const patch = pending[row.id];
    if (patch && field in patch) return (patch as Record<string, unknown>)[field as string] as Refill[K];
    return row[field];
  }

  async function save(row: Refill) {
    const patch = pending[row.id];
    if (!patch || Object.keys(patch).length === 0) return;

    const status = patch.current_status ?? row.current_status;
    const shipDate = patch.ship_date ?? row.ship_date;
    if (status === "SCHEDULED" && !shipDate) return; // blocked by UI

    setSaving((s) => ({ ...s, [row.id]: true }));
    try {
      const res = await patchRefill(row.id, { ...patch, updated_by: "user" });
      setRefills((prev) => prev.map((r) => (r.id === row.id ? res.refill : r)));
      setPending((p) => { const next = { ...p }; delete next[row.id]; return next; });
      setSaved((s) => ({ ...s, [row.id]: true }));
      setTimeout(() => setSaved((s) => { const n = { ...s }; delete n[row.id]; return n; }), 2000);

      if (res.shipping_id) {
        showToast(`Shipping record created for ${row.patient}`);
        await fetchData(); // refresh buckets
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      showToast(`Error: ${msg}`);
    } finally {
      setSaving((s) => ({ ...s, [row.id]: false }));
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  const isDirty = (id: number) => !!pending[id] && Object.keys(pending[id]).length > 0;

  const scheduledMissingDate = (row: Refill) => {
    const status = effectiveValue(row, "current_status");
    const ship = effectiveValue(row, "ship_date");
    return status === "SCHEDULED" && !ship;
  };

  const allBuckets: BucketCount[] = [{ bucket: "ALL", count: refills.length }, ...buckets];

  return (
    <div className="flex flex-col h-full">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#1a3a6b] text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
          {toast}
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 space-y-3">
        {/* Bucket pills */}
        <div className="flex flex-wrap gap-2">
          {allBuckets.map(({ bucket, count }) => (
            <button
              key={bucket}
              onClick={() => setActiveBucket(bucket)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                activeBucket === bucket
                  ? "bg-[#4a7fd4] text-white border-[#4a7fd4]"
                  : "bg-white text-gray-600 border-gray-300 hover:border-[#4a7fd4] hover:text-[#4a7fd4]"
              }`}
            >
              {bucket} ({count})
            </button>
          ))}
        </div>

        {/* Dropdowns + search */}
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={coach} onChange={setCoach} placeholder="All Coaches" options={COACHES} />
          <Select value={pharmacy} onChange={setPharmacy} placeholder="All Pharmacies" options={PHARMACIES} />
          <Select value={category} onChange={setCategory} placeholder="All Categories" options={CATEGORIES} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient or drug…"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] w-52"
          />
          <button
            onClick={fetchData}
            className="ml-auto px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && (
          <div className="flex items-center justify-center h-40 text-gray-400">Loading…</div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
        )}
        {!loading && !error && refills.length === 0 && (
          <div className="flex items-center justify-center h-40 text-gray-400">No refills match the current filters.</div>
        )}
        {!loading && !error && refills.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto shadow-sm">
            <table className="min-w-full text-sm divide-y divide-gray-100">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <Th>Bucket</Th>
                  <Th>Patient</Th>
                  <Th>PTSN</Th>
                  <Th>Drug</Th>
                  <Th>Category</Th>
                  <Th>Pharmacy</Th>
                  <Th>Next Call</Th>
                  <Th right>TP</Th>
                  <Th>Coach</Th>
                  <Th>Status</Th>
                  <Th>Ship Date</Th>
                  <Th>Follow-up</Th>
                  <Th>Notes</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {refills.map((row) => {
                  const dirty = isDirty(row.id);
                  const isSaving = saving[row.id];
                  const wasSaved = saved[row.id];
                  const missingDate = scheduledMissingDate(row);

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${dirty ? "bg-yellow-50" : "hover:bg-gray-50"}`}
                    >
                      {/* Bucket */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${bucketBadge(effectiveValue(row, "bucket"))}`}>
                          {effectiveValue(row, "bucket") ?? "—"}
                        </span>
                      </td>

                      {/* Patient */}
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 max-w-[160px] truncate">
                        {row.patient}
                      </td>

                      {/* PTSN */}
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{row.ptsn}</td>

                      {/* Drug */}
                      <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={row.drug}>
                        {row.drug}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${categoryBadge(row.category)}`}>
                          {row.category ?? "—"}
                        </span>
                      </td>

                      {/* Pharmacy */}
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 text-xs">{row.pharmacy ?? "—"}</td>

                      {/* Next Call Date */}
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{row.next_call_date ?? "—"}</td>

                      {/* TP */}
                      <td className="px-3 py-2 whitespace-nowrap text-right font-medium text-gray-800">
                        {fmt(row.tp)}
                      </td>

                      {/* Coach */}
                      <td className="px-3 py-2">
                        <select
                          value={effectiveValue(row, "coach") ?? ""}
                          onChange={(e) => change(row.id, "coach", e.target.value || null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white"
                        >
                          <option value="">—</option>
                          {COACHES.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2">
                        <select
                          value={effectiveValue(row, "current_status") ?? ""}
                          onChange={(e) => change(row.id, "current_status", e.target.value)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white"
                        >
                          {REFILL_STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>

                      {/* Ship Date */}
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={effectiveValue(row, "ship_date") ?? ""}
                          onChange={(e) => change(row.id, "ship_date", e.target.value || null)}
                          className={`border rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] ${
                            missingDate ? "border-red-400 ring-1 ring-red-400 bg-red-50" : "border-gray-200"
                          }`}
                        />
                        {missingDate && (
                          <p className="text-red-500 text-[10px] mt-0.5">Required</p>
                        )}
                      </td>

                      {/* Follow-up Date */}
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={effectiveValue(row, "follow_up_date") ?? ""}
                          onChange={(e) => change(row.id, "follow_up_date", e.target.value || null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]"
                        />
                      </td>

                      {/* Notes */}
                      <td className="px-3 py-2 min-w-[160px]">
                        <textarea
                          rows={1}
                          value={effectiveValue(row, "notes") ?? ""}
                          onChange={(e) => change(row.id, "notes", e.target.value || null)}
                          placeholder="Add note…"
                          className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] focus:rows-3"
                          onFocus={(e) => { e.target.rows = 3; }}
                          onBlur={(e) => { e.target.rows = 1; }}
                        />
                      </td>

                      {/* Save */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        {wasSaved ? (
                          <span className="text-green-600 text-xs font-medium">Saved ✓</span>
                        ) : (
                          <button
                            onClick={() => save(row)}
                            disabled={!dirty || isSaving || missingDate}
                            title={missingDate ? "Ship date required" : undefined}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                              !dirty || missingDate
                                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                : isSaving
                                ? "bg-[#4a7fd4] text-white opacity-60 cursor-wait"
                                : "bg-[#4a7fd4] text-white hover:bg-[#1a3a6b]"
                            }`}
                          >
                            {isSaving ? "Saving…" : "Save"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && (
          <p className="text-xs text-gray-400 mt-2">{refills.length} records</p>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-semibold ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Select({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white text-gray-700"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}
