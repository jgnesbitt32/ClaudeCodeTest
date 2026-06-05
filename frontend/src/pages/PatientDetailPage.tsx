import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api";
import type { Refill } from "../types";
import type { } from "../types";

interface Profile {
  ptsn: string;
  patient: string;
  pharmacy: string | null;
  category: string | null;
  prescriber: string | null;
  rep: string | null;
  plan_type: string | null;
  total_fills: number;
  first_fill_date: string | null;
  last_fill_date: string | null;
  total_tp: number;
}

interface ShippingRecord {
  id: number;
  shipping_date: string | null;
  medication: string | null;
  fill_for_month: string | null;
  total_paid: number | null;
  status: string | null;
  location: string | null;
}

interface NoteEntry {
  drug: string | null;
  note: string | null;
  updated_at: string | null;
}

interface PatientDetail {
  profile: Profile;
  refills: Refill[];
  shipping: ShippingRecord[];
  notes: NoteEntry[];
}

type Tab = "profile" | "refills" | "shipping" | "notes";

function fmt(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function bucketBadge(bucket: string | null) {
  switch (bucket) {
    case "PAST DUE":  return "bg-red-100 text-red-700";
    case "THIS WEEK": return "bg-blue-100 text-blue-700";
    case "NEXT WEEK": return "bg-green-100 text-green-700";
    case "SCHEDULED": return "bg-purple-100 text-purple-700";
    case "SHIPPED":   return "bg-gray-200 text-gray-600";
    default:          return "bg-orange-100 text-orange-700";
  }
}

function categoryBadge(cat: string | null) {
  switch (cat) {
    case "IVIG": return "bg-blue-100 text-blue-700";
    case "HEME": return "bg-red-100 text-red-700";
    case "ANC_BILLED": return "bg-green-100 text-green-700";
    default: return "bg-gray-100 text-gray-500";
  }
}

export default function PatientDetailPage() {
  const { ptsn } = useParams<{ ptsn: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("profile");

  useEffect(() => {
    if (!ptsn) return;
    api.get<PatientDetail>(`/patients/${ptsn}`)
      .then(r => { setData(r.data); setError(null); })
      .catch(() => setError("Patient not found."))
      .finally(() => setLoading(false));
  }, [ptsn]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loadingâ€¦</div>;
  if (error || !data) return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error ?? "Not found"}</div>
    </div>
  );

  const { profile, refills, shipping, notes } = data;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <button onClick={() => navigate("/patients")}
          className="text-xs text-[#4a7fd4] hover:underline mb-2 flex items-center gap-1">
          â† Back to Patients
        </button>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-[#1a3a6b] flex items-center justify-center text-white font-bold text-lg shrink-0">
            {profile.patient.charAt(0)}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900">{profile.patient}</h2>
            <div className="flex flex-wrap gap-3 mt-1 text-sm text-gray-500 items-center">
              <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">PTSN {profile.ptsn}</span>
              <span>{profile.pharmacy ?? "â€”"}</span>
              {profile.category && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryBadge(profile.category)}`}>
                  {profile.category}
                </span>
              )}
              <span className="text-gray-400">Â·</span>
              <span>{profile.total_fills} total fills</span>
              <span className="text-gray-400">Â·</span>
              <span className="font-semibold text-gray-700">{fmt(profile.total_tp)} lifetime TP</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mt-4 border-b border-gray-100 -mb-4">
          {(["profile", "refills", "shipping", "notes"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t
                  ? "border-[#4a7fd4] text-[#4a7fd4]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "refills" ? `Refills (${refills.length})` :
               t === "shipping" ? `Shipping (${shipping.length})` :
               t === "notes" ? `Notes (${notes.length})` : "Profile"}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {tab === "profile" && <ProfileTab profile={profile} />}
        {tab === "refills" && <RefillsTab refills={refills} />}
        {tab === "shipping" && <ShippingTab shipping={shipping} />}
        {tab === "notes" && <NotesTab notes={notes} />}
      </div>
    </div>
  );
}

// â”€â”€ Profile Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ProfileTab({ profile }: { profile: Profile }) {
  const rows = [
    ["PTSN", profile.ptsn],
    ["Patient Name", profile.patient],
    ["Pharmacy", profile.pharmacy ?? "â€”"],
    ["Category", profile.category ?? "â€”"],
    ["Prescriber", profile.prescriber ?? "â€”"],
    ["Rep", profile.rep ?? "â€”"],
    ["Plan Type", profile.plan_type ?? "â€”"],
    ["First Fill Date", profile.first_fill_date ?? "â€”"],
    ["Last Fill Date", profile.last_fill_date ?? "â€”"],
    ["Total Fills", String(profile.total_fills)],
    ["Lifetime TP", profile.total_tp.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })],
  ];

  return (
    <div className="max-w-lg bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-[#1a3a6b] px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Patient Profile</h3>
      </div>
      <dl className="divide-y divide-gray-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex px-4 py-3 gap-4">
            <dt className="w-40 shrink-0 text-xs text-gray-400 uppercase tracking-wide font-medium pt-0.5">{label}</dt>
            <dd className="text-sm text-gray-800 font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// â”€â”€ Refills Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function RefillsTab({ refills }: { refills: Refill[] }) {
  if (refills.length === 0)
    return <p className="text-gray-400 text-sm">No refill records for this patient.</p>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
      <table className="min-w-full text-sm divide-y divide-gray-100">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Drug</th>
            <th className="px-4 py-2 text-left font-semibold">Bucket</th>
            <th className="px-4 py-2 text-left font-semibold">Next Call</th>
            <th className="px-4 py-2 text-left font-semibold">Status</th>
            <th className="px-4 py-2 text-left font-semibold">Coach</th>
            <th className="px-4 py-2 text-left font-semibold">Ship Date</th>
            <th className="px-4 py-2 text-right font-semibold">TP</th>
            <th className="px-4 py-2 text-left font-semibold">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {refills.map(r => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 font-medium text-gray-800 max-w-[200px] truncate" title={r.drug}>{r.drug}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${bucketBadge(r.bucket)}`}>{r.bucket ?? "â€”"}</span>
              </td>
              <td className="px-4 py-2 text-gray-500 text-xs">{r.next_call_date ?? "â€”"}</td>
              <td className="px-4 py-2 text-gray-600 text-xs">{r.current_status ?? "â€”"}</td>
              <td className="px-4 py-2 text-gray-500 text-xs">{r.coach ?? "â€”"}</td>
              <td className="px-4 py-2 text-gray-500 text-xs">{r.ship_date ?? "â€”"}</td>
              <td className="px-4 py-2 text-right font-semibold text-gray-800">
                {r.tp != null ? r.tp.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "â€”"}
              </td>
              <td className="px-4 py-2 text-gray-400 text-xs max-w-[180px] truncate" title={r.notes ?? ""}>{r.notes ?? "â€”"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// â”€â”€ Shipping Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ShippingTab({ shipping }: { shipping: ShippingRecord[] }) {
  if (shipping.length === 0)
    return <p className="text-gray-400 text-sm">No shipping records for this patient.</p>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
      <table className="min-w-full text-sm divide-y divide-gray-100">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Ship Date</th>
            <th className="px-4 py-2 text-left font-semibold">Medication</th>
            <th className="px-4 py-2 text-left font-semibold">Fill For</th>
            <th className="px-4 py-2 text-left font-semibold">Location</th>
            <th className="px-4 py-2 text-right font-semibold">Total Paid</th>
            <th className="px-4 py-2 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {shipping.map(s => (
            <tr key={s.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 text-gray-600">{s.shipping_date ?? "â€”"}</td>
              <td className="px-4 py-2 font-medium text-gray-800 max-w-[200px] truncate" title={s.medication ?? ""}>{s.medication ?? "â€”"}</td>
              <td className="px-4 py-2">
                <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{s.fill_for_month ?? "â€”"}</span>
              </td>
              <td className="px-4 py-2 text-gray-500 text-xs">{s.location ?? "â€”"}</td>
              <td className="px-4 py-2 text-right font-semibold text-gray-800">{fmt(s.total_paid ?? 0)}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  s.status === "SHIPPED" ? "bg-green-100 text-green-700"
                  : s.status === "PENDING" ? "bg-blue-100 text-blue-700"
                  : s.status === "DELAYED" ? "bg-yellow-100 text-yellow-700"
                  : "bg-gray-100 text-gray-500"
                }`}>{s.status ?? "â€”"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// â”€â”€ Notes Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function NotesTab({ notes }: { notes: NoteEntry[] }) {
  if (notes.length === 0)
    return <p className="text-gray-400 text-sm">No notes recorded for this patient yet. Add notes from the Refills page.</p>;

  return (
    <div className="space-y-3 max-w-2xl">
      {notes.map((n, i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{n.drug ?? "General"}</span>
            {n.updated_at && (
              <span className="text-xs text-gray-400">{new Date(n.updated_at).toLocaleDateString()}</span>
            )}
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.note}</p>
        </div>
      ))}
    </div>
  );
}

