import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { PHARMACIES, CATEGORIES } from "../types";

interface PatientSummary {
  ptsn: string;
  patient: string;
  pharmacy: string | null;
  category: string | null;
  last_fill_date: string | null;
  current_status: string | null;
  drug_count: number;
  total_tp: number;
}

function fmt(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function categoryBadge(cat: string | null) {
  switch (cat) {
    case "IVIG": return "bg-blue-100 text-blue-700";
    case "HEME": return "bg-red-100 text-red-700";
    case "ANC_BILLED": return "bg-green-100 text-green-700";
    default: return "bg-gray-100 text-gray-500";
  }
}

function statusColor(status: string | null) {
  switch (status) {
    case "SHIPPED":      return "text-green-600";
    case "SCHEDULED":   return "text-purple-600";
    case "PAST DUE":    return "text-red-500";
    case "DISCHARGED":
    case "DISCONTINUED": return "text-gray-400";
    default:            return "text-gray-600";
  }
}

export default function PatientsPage() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pharmacy, setPharmacy] = useState("");
  const [category, setCategory] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer.current);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (pharmacy) params.pharmacy = pharmacy;
    if (category) params.category = category;

    axios.get<PatientSummary[]>("/api/patients", { params })
      .then(r => { setPatients(r.data); setError(null); })
      .catch(() => setError("Failed to load patients. Is the backend running?"))
      .finally(() => setLoading(false));
  }, [debouncedSearch, pharmacy, category]);

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or PTSN…"
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] w-56"
        />
        <select value={pharmacy} onChange={e => setPharmacy(e.target.value)}
          className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white">
          <option value="">All Pharmacies</option>
          {PHARMACIES.map(p => <option key={p}>{p}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <span className="ml-auto text-xs text-gray-400">{patients.length} patients</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && <div className="flex items-center justify-center h-40 text-gray-400">Loading…</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>}

        {!loading && !error && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <table className="min-w-full text-sm divide-y divide-gray-100">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Patient</th>
                  <th className="px-4 py-3 text-left font-semibold">PTSN</th>
                  <th className="px-4 py-3 text-left font-semibold">Pharmacy</th>
                  <th className="px-4 py-3 text-left font-semibold">Category</th>
                  <th className="px-4 py-3 text-left font-semibold">Last Fill</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-center font-semibold">Drugs</th>
                  <th className="px-4 py-3 text-right font-semibold">Total TP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {patients.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-400">No patients match the current filters.</td>
                  </tr>
                )}
                {patients.map(p => (
                  <tr
                    key={p.ptsn}
                    onClick={() => navigate(`/patients/${p.ptsn}`)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-[#1a3a6b]">{p.patient}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.ptsn}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{p.pharmacy ?? "—"}</td>
                    <td className="px-4 py-3">
                      {p.category ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryBadge(p.category)}`}>
                          {p.category}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.last_fill_date ?? "—"}</td>
                    <td className={`px-4 py-3 text-xs font-medium ${statusColor(p.current_status)}`}>
                      {p.current_status ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{p.drug_count}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(p.total_tp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
