import { useCallback, useEffect, useState } from "react";
import api from "../api";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface ShippingRecord {
  id: number;
  refill_id: number;
  ptsn: string;
  patient: string | null;
  drug: string | null;
  shipping_date: string | null;
  delivery_date: string | null;
  rx_number: string | null;
  fill_number: number | null;
  fill_for_month: string | null;
  location: string | null;
  patient_type: string | null;
  medication: string | null;
  quantity: number | null;
  dose_units_dispensed_pct: string | null;
  supply_list_needed: string | null;
  qty_ancillary_meds: number | null;
  charging_copay: number | null;
  copay_explanation: string | null;
  confirmed_shipping_address: string | null;
  total_paid: number | null;
  cost: number | null;
  billing_type: string | null;
  shipping_notes: string | null;
  status: string | null;
  ordered_date: string | null;
}

interface Summary {
  total_orders: number;
  total_tp: number;
  shipped_count: number;
  pending_count: number;
}

interface ShippingPatch {
  delivery_date?: string | null;
  quantity?: number | null;
  dose_units_dispensed_pct?: string | null;
  supply_list_needed?: string | null;
  qty_ancillary_meds?: number | null;
  charging_copay?: number | null;
  copay_explanation?: string | null;
  confirmed_shipping_address?: string | null;
  billing_type?: string | null;
  shipping_notes?: string | null;
  status?: string | null;
  shipping_date?: string | null;
}

const BILLING_TYPES = ["PBM", "MEDICAL", "OMNYSIS", "SUPPLY PLAN", "TPA", "TRS", "CASH"];
const SHIPPING_STATUSES = ["PENDING", "SHIPPED", "DELAYED", "CANCELLED"];
const PHARMACIES = ["BLUEBIRD-FL", "BLUESKY-SC", "BLUEBIRD-SC", "BLUESKY-AL"];

function fmt(v: number | null) {
  if (v == null) return "â€”";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function statusBadge(status: string | null) {
  switch (status) {
    case "SHIPPED":   return "bg-green-100 text-green-700";
    case "PENDING":   return "bg-blue-100 text-blue-700";
    case "DELAYED":   return "bg-yellow-100 text-yellow-700";
    case "CANCELLED": return "bg-red-100 text-red-700";
    default:          return "bg-gray-100 text-gray-500";
  }
}

// â”€â”€ ShippingPage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function ShippingPage() {
  const [records, setRecords] = useState<ShippingRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");

  // per-row state
  const [pending, setPending] = useState<Record<number, ShippingPatch>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (location) params.location = location;
      if (status) params.status = status;

      const { data } = await api.get("/shipping", { params });
      setRecords(data.records);
      setSummary(data.summary);
      setError(null);
    } catch {
      setError("Failed to load shipping records. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, location, status]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function change(id: number, field: keyof ShippingPatch, value: string | number | null) {
    setPending(p => ({ ...p, [id]: { ...p[id], [field]: value } }));
  }

  function effective<K extends keyof ShippingRecord>(row: ShippingRecord, field: K): ShippingRecord[K] {
    const patch = pending[row.id];
    if (patch && field in patch) return (patch as Record<string, unknown>)[field as string] as ShippingRecord[K];
    return row[field];
  }

  async function save(row: ShippingRecord) {
    const patch = pending[row.id];
    if (!patch || Object.keys(patch).length === 0) return;

    setSaving(s => ({ ...s, [row.id]: true }));
    try {
      const { data } = await api.patch<ShippingRecord>(`/shipping/${row.id}`, patch);
      setRecords(prev => prev.map(r => r.id === row.id ? data : r));
      setPending(p => { const n = { ...p }; delete n[row.id]; return n; });
      setSaved(s => ({ ...s, [row.id]: true }));
      setTimeout(() => setSaved(s => { const n = { ...s }; delete n[row.id]; return n; }), 2000);

      if (patch.status === "SHIPPED") {
        showToast(`${row.patient} marked as SHIPPED â€” refill status updated`);
        fetchData(); // refresh summary counts
      }
    } catch {
      showToast("Save failed. Please try again.");
    } finally {
      setSaving(s => ({ ...s, [row.id]: false }));
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  const isDirty = (id: number) => !!pending[id] && Object.keys(pending[id]).length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#1a3a6b] text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
          {toast}
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard label="Total Orders" value={summary.total_orders} color="navy" />
            <SummaryCard label="Total TP" value={fmt(summary.total_tp)} color="blue" />
            <SummaryCard label="Shipped" value={summary.shipped_count} color="green" />
            <SummaryCard label="Pending" value={summary.pending_count} color="purple" />
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap gap-3 items-center">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wide">From</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wide">To</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wide">Location</span>
          <select value={location} onChange={e => setLocation(e.target.value)}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white">
            <option value="">All Locations</option>
            {PHARMACIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wide">Status</span>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white">
            <option value="">All Statuses</option>
            {SHIPPING_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <button onClick={fetchData}
          className="mt-4 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">
          â†» Refresh
        </button>
        {(dateFrom || dateTo || location || status) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); setLocation(""); setStatus(""); }}
            className="mt-4 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600">
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && <div className="flex items-center justify-center h-40 text-gray-400">Loadingâ€¦</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>}

        {!loading && !error && records.length === 0 && (
          <div className="flex flex-col items-center justify-center h-56 text-gray-400 gap-2">
            <p className="text-base font-medium">No shipping records yet</p>
            <p className="text-sm">Shipping records are created automatically when a refill is set to <span className="font-semibold">SCHEDULED</span></p>
          </div>
        )}

        {!loading && !error && records.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto shadow-sm">
            <table className="min-w-full text-sm divide-y divide-gray-100">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <Th>Ship Date</Th>
                  <Th>Delivery Date</Th>
                  <Th>Patient</Th>
                  <Th>Medication</Th>
                  <Th>Rx#</Th>
                  <Th>Fill #</Th>
                  <Th>Fill For</Th>
                  <Th>Location</Th>
                  <Th>Type</Th>
                  <Th right>Qty</Th>
                  <Th>Dose Units %</Th>
                  <Th>Supply List</Th>
                  <Th right>Ancillary Qty</Th>
                  <Th right>Copay</Th>
                  <Th>Copay Note</Th>
                  <Th>Ship Address</Th>
                  <Th right>Total Paid</Th>
                  <Th right>Cost</Th>
                  <Th>Billing</Th>
                  <Th>Notes</Th>
                  <Th>Status</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map(row => {
                  const dirty = isDirty(row.id);
                  const isSaving = saving[row.id];
                  const wasSaved = saved[row.id];

                  return (
                    <tr key={row.id} className={`transition-colors ${dirty ? "bg-yellow-50" : "hover:bg-gray-50"}`}>
                      {/* Ship Date (auto, editable) */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        <input type="date" value={effective(row, "shipping_date") ?? ""}
                          onChange={e => change(row.id, "shipping_date", e.target.value || null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
                      </td>

                      {/* Delivery Date (manual) */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        <input type="date" value={effective(row, "delivery_date") ?? ""}
                          onChange={e => change(row.id, "delivery_date", e.target.value || null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
                      </td>

                      {/* Patient (auto) */}
                      <td className="px-2 py-2 font-medium text-gray-800 whitespace-nowrap max-w-[140px] truncate">{row.patient ?? "â€”"}</td>

                      {/* Medication (auto) */}
                      <td className="px-2 py-2 text-gray-600 max-w-[160px] truncate" title={row.medication ?? ""}>{row.medication ?? "â€”"}</td>

                      {/* Rx# */}
                      <td className="px-2 py-2 text-gray-500 whitespace-nowrap text-xs">{row.rx_number ?? "â€”"}</td>

                      {/* Fill # */}
                      <td className="px-2 py-2 text-gray-500 whitespace-nowrap text-center">{row.fill_number ?? "â€”"}</td>

                      {/* Fill For Month */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{row.fill_for_month ?? "â€”"}</span>
                      </td>

                      {/* Location */}
                      <td className="px-2 py-2 text-gray-500 text-xs whitespace-nowrap">{row.location ?? "â€”"}</td>

                      {/* Patient Type */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          row.patient_type === "IVIG" ? "bg-blue-100 text-blue-700"
                          : row.patient_type === "HEME" ? "bg-red-100 text-red-700"
                          : "bg-green-100 text-green-700"
                        }`}>{row.patient_type ?? "â€”"}</span>
                      </td>

                      {/* Qty (editable) */}
                      <td className="px-2 py-2 text-right">
                        <input type="number" value={effective(row, "quantity") ?? ""}
                          onChange={e => change(row.id, "quantity", e.target.value ? parseFloat(e.target.value) : null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs w-16 text-right focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
                      </td>

                      {/* Dose Units % */}
                      <td className="px-2 py-2">
                        <input type="text" value={effective(row, "dose_units_dispensed_pct") ?? ""}
                          onChange={e => change(row.id, "dose_units_dispensed_pct", e.target.value || null)}
                          placeholder="e.g. 100%"
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
                      </td>

                      {/* Supply List Needed */}
                      <td className="px-2 py-2">
                        <select value={effective(row, "supply_list_needed") ?? ""}
                          onChange={e => change(row.id, "supply_list_needed", e.target.value || null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white">
                          <option value="">â€”</option>
                          <option>Yes</option>
                          <option>No</option>
                        </select>
                      </td>

                      {/* Ancillary Qty */}
                      <td className="px-2 py-2 text-right">
                        <input type="number" value={effective(row, "qty_ancillary_meds") ?? ""}
                          onChange={e => change(row.id, "qty_ancillary_meds", e.target.value ? parseFloat(e.target.value) : null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs w-14 text-right focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
                      </td>

                      {/* Copay (editable) */}
                      <td className="px-2 py-2 text-right">
                        <input type="number" step="0.01" value={effective(row, "charging_copay") ?? ""}
                          onChange={e => change(row.id, "charging_copay", e.target.value ? parseFloat(e.target.value) : null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs w-20 text-right focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
                      </td>

                      {/* Copay Explanation */}
                      <td className="px-2 py-2">
                        <input type="text" value={effective(row, "copay_explanation") ?? ""}
                          onChange={e => change(row.id, "copay_explanation", e.target.value || null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
                      </td>

                      {/* Shipping Address */}
                      <td className="px-2 py-2">
                        <input type="text" value={effective(row, "confirmed_shipping_address") ?? ""}
                          onChange={e => change(row.id, "confirmed_shipping_address", e.target.value || null)}
                          placeholder="Addressâ€¦"
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
                      </td>

                      {/* Total Paid (auto) */}
                      <td className="px-2 py-2 text-right font-medium text-gray-800 whitespace-nowrap">{fmt(row.total_paid)}</td>

                      {/* Cost (auto) */}
                      <td className="px-2 py-2 text-right text-gray-500 whitespace-nowrap">{fmt(row.cost)}</td>

                      {/* Billing Type */}
                      <td className="px-2 py-2">
                        <select value={effective(row, "billing_type") ?? ""}
                          onChange={e => change(row.id, "billing_type", e.target.value || null)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white">
                          <option value="">â€”</option>
                          {BILLING_TYPES.map(b => <option key={b}>{b}</option>)}
                        </select>
                      </td>

                      {/* Shipping Notes */}
                      <td className="px-2 py-2">
                        <input type="text" value={effective(row, "shipping_notes") ?? ""}
                          onChange={e => change(row.id, "shipping_notes", e.target.value || null)}
                          placeholder="Notesâ€¦"
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
                      </td>

                      {/* Status */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        <select value={effective(row, "status") ?? ""}
                          onChange={e => change(row.id, "status", e.target.value)}
                          className={`border rounded px-1.5 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] ${statusBadge(effective(row, "status"))}`}>
                          {SHIPPING_STATUSES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>

                      {/* Save */}
                      <td className="px-2 py-2 whitespace-nowrap">
                        {wasSaved ? (
                          <span className="text-green-600 text-xs font-medium">Saved âœ“</span>
                        ) : (
                          <button onClick={() => save(row)} disabled={!dirty || isSaving}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                              !dirty ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                              : isSaving ? "bg-[#4a7fd4] text-white opacity-60 cursor-wait"
                              : "bg-[#4a7fd4] text-white hover:bg-[#1a3a6b]"
                            }`}>
                            {isSaving ? "Savingâ€¦" : "Save"}
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
          <p className="text-xs text-gray-400 mt-2">{records.length} record{records.length !== 1 ? "s" : ""}</p>
        )}
      </div>
    </div>
  );
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-2 py-2 font-semibold whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const left: Record<string, string> = {
    navy: "border-l-[#1a3a6b]", blue: "border-l-[#4a7fd4]",
    green: "border-l-green-500", purple: "border-l-purple-500",
  };
  const text: Record<string, string> = {
    navy: "text-[#1a3a6b]", blue: "text-[#4a7fd4]",
    green: "text-green-600", purple: "text-purple-600",
  };
  return (
    <div className={`bg-white rounded-lg border border-gray-100 border-l-4 ${left[color]} px-4 py-3 shadow-sm`}>
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${text[color]}`}>{value}</p>
    </div>
  );
}

