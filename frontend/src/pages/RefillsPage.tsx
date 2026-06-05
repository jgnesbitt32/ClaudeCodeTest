import { memo, useCallback, useEffect, useRef, useState } from "react";
import { getBuckets, getRefills, patchRefill } from "../api";
import type { BucketCount, Refill, RefillPatch } from "../types";
import { COACHES, PHARMACIES, CATEGORIES, REFILL_STATUSES } from "../types";

const PAGE_SIZE = 100;

// ── Styling helpers ───────────────────────────────────────────────────────────
function bucketBadge(b: string | null) {
  switch (b) {
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
function catBadge(c: string | null) {
  switch (c) {
    case "IVIG": return "bg-blue-100 text-blue-700";
    case "HEME": return "bg-red-100 text-red-700";
    case "ANC_BILLED": return "bg-green-100 text-green-700";
    default: return "bg-gray-100 text-gray-600";
  }
}
function fmt(v: number | null) {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ── Memoized row — only re-renders when ITS OWN state changes ─────────────────
const RefillRow = memo(function RefillRow({ row, rowPending, rowSaving, rowSaved, onChange, onSave }: {
  row: Refill;
  rowPending: RefillPatch | undefined;
  rowSaving: boolean | undefined;
  rowSaved: boolean | undefined;
  onChange: (id: number, field: keyof RefillPatch, value: string | null) => void;
  onSave: (row: Refill, patch: RefillPatch) => void;
}) {
  const dirty = !!rowPending && Object.keys(rowPending).length > 0;

  // Resolve effective value: pending overrides original
  function eff<K extends keyof Refill>(field: K): Refill[K] {
    if (rowPending && field in rowPending)
      return (rowPending as Record<string, unknown>)[field as string] as Refill[K];
    return row[field];
  }

  const status = eff("current_status");
  const shipDate = eff("ship_date");
  const missingDate = status === "SCHEDULED" && !shipDate;

  return (
    <tr className={`transition-colors ${dirty ? "bg-yellow-50" : "hover:bg-gray-50"}`}>
      {/* Bucket */}
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${bucketBadge(eff("bucket"))}`}>
          {eff("bucket") ?? "—"}
        </span>
      </td>

      {/* Patient */}
      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 max-w-[160px] truncate" title={row.patient}>
        {row.patient}
      </td>

      {/* PTSN */}
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 text-xs">{row.ptsn}</td>

      {/* Drug */}
      <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate text-xs" title={row.drug}>{row.drug}</td>

      {/* Category */}
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${catBadge(row.category)}`}>
          {row.category ?? "—"}
        </span>
      </td>

      {/* Pharmacy */}
      <td className="px-3 py-2 whitespace-nowrap text-gray-600 text-xs">{row.pharmacy ?? "—"}</td>

      {/* Next Call */}
      <td className="px-3 py-2 whitespace-nowrap text-gray-600 text-xs">{row.next_call_date ?? "—"}</td>

      {/* TP */}
      <td className="px-3 py-2 whitespace-nowrap text-right font-medium text-gray-800 text-xs">{fmt(row.tp)}</td>

      {/* Coach */}
      <td className="px-3 py-2">
        <select
          value={eff("coach") ?? ""}
          onChange={e => onChange(row.id, "coach", e.target.value || null)}
          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white"
        >
          <option value="">—</option>
          {COACHES.map(c => <option key={c}>{c}</option>)}
        </select>
      </td>

      {/* Status */}
      <td className="px-3 py-2">
        <select
          value={eff("current_status") ?? ""}
          onChange={e => onChange(row.id, "current_status", e.target.value)}
          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white"
        >
          {REFILL_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </td>

      {/* Ship Date */}
      <td className="px-3 py-2">
        <input
          type="date"
          value={eff("ship_date") ?? ""}
          onChange={e => onChange(row.id, "ship_date", e.target.value || null)}
          className={`border rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] ${
            missingDate ? "border-red-400 ring-1 ring-red-400 bg-red-50" : "border-gray-200"
          }`}
        />
        {missingDate && <p className="text-red-500 text-[10px] mt-0.5">Required</p>}
      </td>

      {/* Follow-up */}
      <td className="px-3 py-2">
        <input
          type="date"
          value={eff("follow_up_date") ?? ""}
          onChange={e => onChange(row.id, "follow_up_date", e.target.value || null)}
          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]"
        />
      </td>

      {/* Notes */}
      <td className="px-3 py-2 min-w-[160px]">
        <textarea
          rows={1}
          value={eff("notes") ?? ""}
          onChange={e => onChange(row.id, "notes", e.target.value || null)}
          placeholder="Add note…"
          className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]"
          onFocus={e => { e.target.rows = 3; }}
          onBlur={e => { e.target.rows = 1; }}
        />
      </td>

      {/* Save */}
      <td className="px-3 py-2 whitespace-nowrap">
        {rowSaved ? (
          <span className="text-green-600 text-xs font-medium">Saved ✓</span>
        ) : (
          <button
            onClick={() => rowPending && onSave(row, rowPending)}
            disabled={!dirty || rowSaving || missingDate}
            title={missingDate ? "Ship date required" : undefined}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              !dirty || missingDate
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : rowSaving
                ? "bg-[#4a7fd4] text-white opacity-60 cursor-wait"
                : "bg-[#4a7fd4] text-white hover:bg-[#1a3a6b]"
            }`}
          >
            {rowSaving ? "Saving…" : "Save"}
          </button>
        )}
      </td>
    </tr>
  );
});

// ── RefillsPage ───────────────────────────────────────────────────────────────
export default function RefillsPage() {
  const [total, setTotal] = useState(0);
  const [refills, setRefills] = useState<Refill[]>([]);
  const [buckets, setBuckets] = useState<BucketCount[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeBucket, setActiveBucket] = useState("ALL");
  const [coach, setCoach] = useState("");
  const [pharmacy, setPharmacy] = useState("");
  const [category, setCategory] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  // per-row editing state
  const [pending, setPending] = useState<Record<number, RefillPatch>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  // keep a stable ref to the latest fetch function for use inside callbacks
  const doFetchRef = useRef<() => Promise<void>>(async () => {});

  // ── Data fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const isFirstLoad = !total && loading;

    if (!isFirstLoad) setTableLoading(true);

    const run = async () => {
      try {
        const [pageData, b] = await Promise.all([
          getRefills({ bucket: activeBucket, coach, pharmacy, category, search, page: currentPage, page_size: PAGE_SIZE }),
          getBuckets(),
        ]);
        if (!cancelled) {
          setTotal(pageData.total);
          setRefills(pageData.items);
          setBuckets(b);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Failed to load refills. Is the backend running?");
      } finally {
        if (!cancelled) { setLoading(false); setTableLoading(false); }
      }
    };

    doFetchRef.current = run;
    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBucket, coach, pharmacy, category, search, currentPage]);

  // ── Filter helpers ─────────────────────────────────────────────────────────
  function changeBucket(b: string) { setActiveBucket(b); setCurrentPage(1); }
  function changeFilter(setter: (v: string) => void, v: string) { setter(v); setCurrentPage(1); }

  function handleSearchInput(v: string) {
    setSearchInput(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(v); setCurrentPage(1); }, 300);
  }

  // ── Stable callbacks (don't change on every render → memo works) ───────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const onChange = useCallback((id: number, field: keyof RefillPatch, value: string | null) => {
    setPending(p => ({ ...p, [id]: { ...p[id], [field]: value } }));
  }, []);

  const onSave = useCallback(async (row: Refill, patch: RefillPatch) => {
    if (!patch || Object.keys(patch).length === 0) return;
    const status = patch.current_status ?? row.current_status;
    const shipDate = patch.ship_date ?? row.ship_date;
    if (status === "SCHEDULED" && !shipDate) return;

    setSaving(s => ({ ...s, [row.id]: true }));
    try {
      const res = await patchRefill(row.id, { ...patch, updated_by: "user" });
      setRefills(prev => prev.map(r => r.id === row.id ? res.refill : r));
      setPending(p => { const next = { ...p }; delete next[row.id]; return next; });
      setSaved(s => ({ ...s, [row.id]: true }));
      setTimeout(() => setSaved(s => { const n = { ...s }; delete n[row.id]; return n; }), 2000);
      if (res.shipping_id) {
        showToast(`Shipping record created for ${row.patient}`);
        await doFetchRef.current();
      }
    } catch {
      showToast("Save failed. Please try again.");
    } finally {
      setSaving(s => ({ ...s, [row.id]: false }));
    }
  }, [showToast]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const allBuckets: BucketCount[] = [{ bucket: "ALL", count: total }, ...buckets];

  return (
    <div className="flex flex-col h-full">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#1a3a6b] text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
          {toast}
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 space-y-2.5 shrink-0">
        {/* Bucket pills */}
        <div className="flex flex-wrap gap-2">
          {allBuckets.map(({ bucket, count }) => (
            <button
              key={bucket}
              onClick={() => changeBucket(bucket)}
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
          <FSelect value={coach} onChange={v => changeFilter(setCoach, v)} placeholder="All Coaches" options={COACHES} />
          <FSelect value={pharmacy} onChange={v => changeFilter(setPharmacy, v)} placeholder="All Pharmacies" options={PHARMACIES} />
          <FSelect value={category} onChange={v => changeFilter(setCategory, v)} placeholder="All Categories" options={CATEGORIES} />
          <input
            type="text"
            value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="Search patient or drug…"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] w-52"
          />
          <button
            onClick={() => doFetchRef.current()}
            className="ml-auto px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Table area */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && (
          <div className="flex items-center justify-center h-40 text-gray-400">Loading…</div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
        )}

        {!loading && !error && (
          <>
            <div className={`bg-white rounded-lg border border-gray-200 overflow-x-auto shadow-sm transition-opacity ${tableLoading ? "opacity-50 pointer-events-none" : ""}`}>
              {refills.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                  No refills match the current filters.
                </div>
              ) : (
                <table className="min-w-full text-sm divide-y divide-gray-100">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide sticky top-0">
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
                    {refills.map(row => (
                      <RefillRow
                        key={row.id}
                        row={row}
                        rowPending={pending[row.id]}
                        rowSaving={saving[row.id]}
                        rowSaved={saved[row.id]}
                        onChange={onChange}
                        onSave={onSave}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-gray-400">
                {total === 0 ? "0 records" : `Showing ${((currentPage - 1) * PAGE_SIZE) + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total} records`}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <PageBtn onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>«</PageBtn>
                  <PageBtn onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>‹ Prev</PageBtn>
                  <span className="px-3 py-1 text-xs text-gray-500">Page {currentPage} of {totalPages}</span>
                  <PageBtn onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages}>Next ›</PageBtn>
                  <PageBtn onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>»</PageBtn>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-semibold whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function FSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: string[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white text-gray-700">
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  );
}

function PageBtn({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="px-2.5 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-gray-600">
      {children}
    </button>
  );
}
