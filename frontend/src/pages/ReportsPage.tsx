import { useEffect, useRef, useState } from "react";
import api from "../api";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
interface MonthlyTrend { month: string; tp: number; dispenses: number }
interface CategoryBreakdown { category: string; tp: number; dispenses: number; pct: number }
interface RepBreakdown { rep: string; tp: number; dispenses: number }
interface Summary {
  total_tp: number;
  total_dispenses: number;
  unique_patients: number;
  avg_tp: number;
  monthly_trend: MonthlyTrend[];
  by_category: CategoryBreakdown[];
  by_rep: RepBreakdown[];
}
interface DispenseRow {
  id: number;
  date_completed: string | null;
  patient: string | null;
  ptsn: string | null;
  drug: string | null;
  category: string | null;
  pharmacy: string | null;
  rep: string | null;
  rx_number: string | null;
  refill_no: number | null;
  days_supply: number | null;
  disp_qty: number | null;
  tp: number | null;
  gp: number | null;
  plan_type: string | null;
  prescriber: string | null;
  bill_month: string | null;
}
interface DispensePage { total: number; page: number; page_size: number; items: DispenseRow[] }
interface FilterOptions { reps: string[]; pharmacies: string[]; categories: string[] }

// ── Constants ─────────────────────────────────────────────────────────────────
const CLS_COLOR: Record<string, string> = {
  IVIG: "#4a7fd4", HEME: "#e94560", ANC_BILLED: "#22c55e",
};

function fmt(v: number | null, decimals = 0) {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: decimals });
}
function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return fmt(v);
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

const PAGE_SIZE = 50;

// ── ReportsPage ───────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [filterOpts, setFilterOpts] = useState<FilterOptions>({ reps: [], pharmacies: [], categories: [] });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pharmacy, setPharmacy] = useState("");
  const [category, setCategory] = useState("");
  const [rep, setRep] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [page, setPage] = useState<DispensePage | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Load filter options once
  useEffect(() => {
    axios.get<FilterOptions>("/api/reports/filter-options").then(r => setFilterOpts(r.data));
  }, []);

  // Reload summary + table when any filter or page changes
  useEffect(() => {
    const params = buildParams();
    setLoading(true);
    Promise.all([
      axios.get<Summary>("/api/reports/summary", { params }),
      axios.get<DispensePage>("/api/reports/dispenses", { params: { ...params, page: currentPage, page_size: PAGE_SIZE } }),
    ])
      .then(([s, d]) => { setSummary(s.data); setPage(d.data); setError(null); })
      .catch(() => setError("Failed to load reports. Is the backend running?"))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, pharmacy, category, rep, search, currentPage]);

  function buildParams() {
    const p: Record<string, string> = {};
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (pharmacy) p.pharmacy = pharmacy;
    if (category) p.category = category;
    if (rep) p.rep = rep;
    if (search) p.search = search;
    return p;
  }

  function handleSearchChange(v: string) {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(v); setCurrentPage(1); }, 300);
  }

  function resetFilters() {
    setDateFrom(""); setDateTo(""); setPharmacy(""); setCategory(""); setRep("");
    setSearch(""); setSearchInput(""); setCurrentPage(1);
  }

  function handleFilterChange(setter: (v: string) => void, value: string) {
    setter(value);
    setCurrentPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = buildParams();
      const qs = new URLSearchParams(params).toString();
      const url = `/api/reports/export${qs ? `?${qs}` : ""}`;
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename="(.+?)"/);
      a.download = match ? match[1] : "osiris_dispenses_export.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = page ? Math.ceil(page.total / PAGE_SIZE) : 1;
  const hasFilters = !!(dateFrom || dateTo || pharmacy || category || rep || search);

  if (error) return (
    <div className="m-6 bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
  );

  return (
    <div className="p-6 space-y-5">
      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-400 uppercase font-medium">From</span>
            <input type="date" value={dateFrom} onChange={e => handleFilterChange(setDateFrom, e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-400 uppercase font-medium">To</span>
            <input type="date" value={dateTo} onChange={e => handleFilterChange(setDateTo, e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-400 uppercase font-medium">Pharmacy</span>
            <select value={pharmacy} onChange={e => handleFilterChange(setPharmacy, e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white min-w-[160px]">
              <option value="">All Pharmacies</option>
              {filterOpts.pharmacies.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-400 uppercase font-medium">Category</span>
            <select value={category} onChange={e => handleFilterChange(setCategory, e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white">
              <option value="">All Categories</option>
              {filterOpts.categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-400 uppercase font-medium">Rep</span>
            <select value={rep} onChange={e => handleFilterChange(setRep, e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white min-w-[160px]">
              <option value="">All Reps</option>
              {filterOpts.reps.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-[10px] text-gray-400 uppercase font-medium">Search</span>
            <input type="text" placeholder="Patient, drug, PTSN…" value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]" />
          </label>
          <div className="flex gap-2 items-end">
            {hasFilters && (
              <button onClick={resetFilters}
                className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
                Clear
              </button>
            )}
            <button onClick={handleExport} disabled={exporting}
              className={`px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
                exporting ? "bg-[#4a7fd4] text-white opacity-60" : "bg-[#4a7fd4] text-white hover:bg-[#1a3a6b]"
              }`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
      </div>

      {loading && !summary ? (
        <div className="flex items-center justify-center h-48 text-gray-400">Loading…</div>
      ) : summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total TP" value={fmtK(summary.total_tp)} color="navy" />
            <StatCard label="Dispenses" value={summary.total_dispenses.toLocaleString()} color="blue" />
            <StatCard label="Unique Patients" value={summary.unique_patients.toLocaleString()} color="green" />
            <StatCard label="Avg TP / Dispense" value={fmtK(summary.avg_tp)} color="purple" />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Monthly trend bar chart */}
            <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly TP Trend</h3>
              {summary.monthly_trend.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={summary.monthly_trend} margin={{ left: 10, right: 10, top: 4 }}>
                    <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={60} />
                    <Tooltip
                      formatter={(v: number) => [fmt(v), "TP"]}
                      labelFormatter={(l: string) => {
                        const [y, m] = l.split("-").map(Number);
                        return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
                      }}
                    />
                    <Bar dataKey="tp" radius={[4, 4, 0, 0]}>
                      {summary.monthly_trend.map((_, i) => (
                        <Cell key={i} fill="#4a7fd4" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Category + Rep breakdowns */}
            <div className="space-y-4">
              {/* By Category */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">By Category</h3>
                <div className="space-y-2">
                  {summary.by_category.map(c => (
                    <div key={c.category}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="font-medium text-gray-700">{c.category}</span>
                        <span className="text-gray-500">{fmtK(c.tp)} · {c.pct}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full" style={{
                          width: `${c.pct}%`,
                          background: CLS_COLOR[c.category] ?? "#94a3b8",
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* By Rep (top 5) */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Reps</h3>
                <div className="space-y-1.5">
                  {summary.by_rep.slice(0, 6).map(r => (
                    <div key={r.rep} className="flex justify-between text-xs">
                      <span className="text-gray-700 font-medium truncate pr-2" title={r.rep}>{r.rep}</span>
                      <span className="text-gray-500 whitespace-nowrap">{fmtK(r.tp)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Dispense table */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                Dispense History
                {page && <span className="ml-2 text-gray-400 font-normal">({page.total.toLocaleString()} records)</span>}
              </h3>
              {page && totalPages > 1 && (
                <div className="flex items-center gap-2 text-sm">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">‹</button>
                  <span className="text-gray-500 text-xs">Page {currentPage} of {totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">›</button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              {tableLoading ? (
                <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Loading…</div>
              ) : (
                <table className="min-w-full text-sm divide-y divide-gray-100">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Date</th>
                      <th className="px-3 py-2 text-left font-semibold">Patient</th>
                      <th className="px-3 py-2 text-left font-semibold">PTSN</th>
                      <th className="px-3 py-2 text-left font-semibold">Drug</th>
                      <th className="px-3 py-2 text-left font-semibold">Category</th>
                      <th className="px-3 py-2 text-left font-semibold">Pharmacy</th>
                      <th className="px-3 py-2 text-left font-semibold">Rep</th>
                      <th className="px-3 py-2 text-left font-semibold">RX #</th>
                      <th className="px-3 py-2 text-right font-semibold">Fill #</th>
                      <th className="px-3 py-2 text-right font-semibold">Days</th>
                      <th className="px-3 py-2 text-right font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">TP</th>
                      <th className="px-3 py-2 text-right font-semibold">GP</th>
                      <th className="px-3 py-2 text-left font-semibold">Plan Type</th>
                      <th className="px-3 py-2 text-left font-semibold">Bill Month</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {page?.items.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="px-4 py-8 text-center text-gray-400 text-sm">
                          No dispense records match the current filters.
                        </td>
                      </tr>
                    ) : page?.items.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{row.date_completed ?? "—"}</td>
                        <td className="px-3 py-2 font-medium text-gray-800 max-w-[160px] truncate" title={row.patient ?? ""}>{row.patient ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.ptsn ?? "—"}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={row.drug ?? ""}>{row.drug ?? "—"}</td>
                        <td className="px-3 py-2">
                          {row.category ? (
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                              row.category === "IVIG" ? "bg-blue-100 text-blue-700"
                              : row.category === "HEME" ? "bg-red-100 text-red-700"
                              : row.category === "ANC_BILLED" ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                            }`}>{row.category}</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{row.pharmacy ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 max-w-[140px] truncate" title={row.rep ?? ""}>{row.rep ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.rx_number ?? "—"}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{row.refill_no ?? "—"}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{row.days_supply ?? "—"}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{row.disp_qty != null ? row.disp_qty.toFixed(1) : "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800">{fmt(row.tp)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{fmt(row.gp)}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{row.plan_type ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{row.bill_month ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {page && totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                <span>Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, page.total)} of {page.total.toLocaleString()}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                    className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">«</button>
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">‹ Prev</button>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Next ›</button>
                  <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                    className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">»</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const border: Record<string, string> = {
    navy: "border-l-[#1a3a6b]", blue: "border-l-[#4a7fd4]",
    green: "border-l-green-500", purple: "border-l-purple-500",
  };
  const text: Record<string, string> = {
    navy: "text-[#1a3a6b]", blue: "text-[#4a7fd4]",
    green: "text-green-600", purple: "text-purple-600",
  };
  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${border[color]} px-4 py-3 shadow-sm`}>
      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">{label}</p>
      <p className={`text-xl font-bold leading-tight ${text[color]}`}>{value}</p>
    </div>
  );
}
