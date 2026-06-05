import { useEffect, useState } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
interface WeekRow {
  label: string;
  start: string;
  end: string;
  is_past: boolean;
  first_fill_pts: number;
  first_fill_tp: number;
  second_fill_pts: number;
  second_fill_tp: number;
  total_opp: number;
  actual: number;
  missed: number | null;
}

interface ClassSummary {
  cls: string;
  actual: number;
  first_fill_tp: number;
  second_fill_tp: number;
  forecast: number;
  goal: number;
  gap: number;
  weeks: WeekRow[];
}

interface Summary {
  goal: number;
  actual: number;
  first_fill_pipeline: number;
  second_fill_projected: number;
  forecast: number;
  gap: number;
  pct_to_goal: number;
}

interface ProjectionData {
  month: string;
  available_months: string[];
  summary: Summary;
  weeks: WeekRow[];
  by_class: ClassSummary[];
  goals: Record<string, number>;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CLS_COLOR: Record<string, string> = {
  IVIG: "#4a7fd4",
  HEME: "#e94560",
  ANC_BILLED: "#22c55e",
};
const CLS_LABEL: Record<string, string> = {
  IVIG: "IG (IVIG)",
  HEME: "BD (HEME)",
  ANC_BILLED: "ANC",
};

function fmt(v: number, decimals = 0) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: decimals });
}
function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return fmt(v);
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

// ── ProjectionsPage ───────────────────────────────────────────────────────────
export default function ProjectionsPage() {
  const [data, setData] = useState<ProjectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [goalInputs, setGoalInputs] = useState<Record<string, string>>({});
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalSaved, setGoalSaved] = useState(false);

  function load(month?: string) {
    setLoading(true);
    const params = month ? `?month=${month}` : "";
    axios.get<ProjectionData>(`/api/projections${params}`)
      .then(r => {
        setData(r.data);
        setSelectedMonth(r.data.month);
        setGoalInputs(Object.fromEntries(
          Object.entries(r.data.goals).map(([k, v]) => [k, String(v)])
        ));
        setError(null);
      })
      .catch(() => setError("Failed to load projections. Is the backend running?"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function saveGoals() {
    if (!data) return;
    setGoalSaving(true);
    const goals: Record<string, number> = {};
    for (const [cls, val] of Object.entries(goalInputs)) {
      const n = parseFloat(val.replace(/[^0-9.]/g, ""));
      if (!isNaN(n)) goals[cls] = n;
    }
    await axios.post("/api/projections/goals", { period_month: selectedMonth, goals });
    setGoalSaving(false);
    setGoalSaved(true);
    setTimeout(() => setGoalSaved(false), 2000);
    load(selectedMonth);
  }

  if (error) return <div className="m-6 bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>;
  if (loading || !data) return <div className="flex items-center justify-center h-64 text-gray-400">Loading projections…</div>;

  const { summary, weeks, by_class, available_months } = data;

  // Chart data
  const barData = weeks.map(w => ({
    name: w.label,
    IVIG: by_class.find(c => c.cls === "IVIG")?.weeks.find(x => x.label === w.label)?.first_fill_tp ?? 0,
    HEME: by_class.find(c => c.cls === "HEME")?.weeks.find(x => x.label === w.label)?.first_fill_tp ?? 0,
    ANC_BILLED: by_class.find(c => c.cls === "ANC_BILLED")?.weeks.find(x => x.label === w.label)?.first_fill_tp ?? 0,
    Actual: by_class.reduce((sum, c) => sum + (c.weeks.find(x => x.label === w.label)?.actual ?? 0), 0),
  }));

  const pieData = by_class
    .filter(c => c.actual + c.first_fill_tp + c.second_fill_tp > 0)
    .map(c => ({ name: CLS_LABEL[c.cls] ?? c.cls, value: c.actual + c.first_fill_tp + c.second_fill_tp }));

  return (
    <div className="p-6 space-y-6">
      {/* Header with month selector */}
      <div className="flex items-center gap-4">
        <h2 className="text-base font-semibold text-gray-800">Monthly Projections</h2>
        <select
          value={selectedMonth}
          onChange={e => { setSelectedMonth(e.target.value); load(e.target.value); }}
          className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#4a7fd4] bg-white"
        >
          {available_months.map(m => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>

      {/* Row 1 — Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <SummaryCard label="Goal" value={fmtK(summary.goal)} color="navy" />
        <SummaryCard label="Actual (MTD)" value={fmtK(summary.actual)} color="green" />
        <SummaryCard label="1st Fill Pipeline" value={fmtK(summary.first_fill_pipeline)} color="blue" />
        <SummaryCard label="2nd Fill Projected" value={fmtK(summary.second_fill_projected)} color="purple" />
        <SummaryCard label="Forecast" value={fmtK(summary.forecast)} color="blue" />
        <SummaryCard label="Gap" value={fmtK(summary.gap)} color={summary.gap > 0 ? "red" : "green"} />
        <GoalPctCard pct={summary.pct_to_goal} />
      </div>

      {/* Row 2 — Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Weekly 1st Fill Opportunity by Class</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ left: 10, right: 10, top: 8 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={60} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              {["IVIG", "HEME", "ANC_BILLED"].map(cls => (
                <Bar key={cls} dataKey={cls} name={CLS_LABEL[cls]} stackId="opp" fill={CLS_COLOR[cls]} radius={cls === "ANC_BILLED" ? [4, 4, 0, 0] : undefined} />
              ))}
              <Bar dataKey="Actual" fill="#22c55e" opacity={0.35} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Revenue Share by Class</h3>
          {pieData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No data for this month</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {pieData.map((d, i) => (
                    <Cell key={i} fill={Object.values(CLS_COLOR)[i] ?? "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Row 3 — Overall week-by-week table */}
      <Section title="Week-by-Week Overview">
        <WeekTable weeks={weeks} showPts={false} />
      </Section>

      {/* Row 4 — Per-class sections */}
      {by_class.map(cls => (
        <Section key={cls.cls} title={`${CLS_LABEL[cls.cls] ?? cls.cls} — Detail`}
          accent={CLS_COLOR[cls.cls]}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <MiniCard label="Actual" value={fmtK(cls.actual)} />
            <MiniCard label="1st Fill" value={fmtK(cls.first_fill_tp)} />
            <MiniCard label="2nd Fill" value={fmtK(cls.second_fill_tp)} />
            <MiniCard label="Forecast" value={fmtK(cls.forecast)} />
          </div>
          <WeekTable weeks={cls.weeks} showPts />
        </Section>
      ))}

      {/* Row 5 — Class summary table */}
      <Section title="Class Summary">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm divide-y divide-gray-100">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Class</th>
                <th className="px-4 py-2 text-right font-semibold">Actual</th>
                <th className="px-4 py-2 text-right font-semibold">1st Fill</th>
                <th className="px-4 py-2 text-right font-semibold">2nd Fill</th>
                <th className="px-4 py-2 text-right font-semibold">Forecast</th>
                <th className="px-4 py-2 text-right font-semibold">Goal</th>
                <th className="px-4 py-2 text-right font-semibold">Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {by_class.map(c => (
                <tr key={c.cls} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: CLS_COLOR[c.cls] }} />
                      <span className="font-medium text-gray-800">{CLS_LABEL[c.cls] ?? c.cls}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-green-600 font-medium">{fmtK(c.actual)}</td>
                  <td className="px-4 py-2 text-right text-blue-600">{fmtK(c.first_fill_tp)}</td>
                  <td className="px-4 py-2 text-right text-purple-600">{fmtK(c.second_fill_tp)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-800">{fmtK(c.forecast)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{c.goal > 0 ? fmtK(c.goal) : "—"}</td>
                  <td className={`px-4 py-2 text-right font-medium ${c.gap > 0 ? "text-red-500" : "text-green-600"}`}>
                    {c.goal > 0 ? fmtK(c.gap) : "—"}
                  </td>
                </tr>
              ))}
              {/* Totals */}
              <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                <td className="px-4 py-2 text-gray-700">Total</td>
                <td className="px-4 py-2 text-right text-green-600">{fmtK(summary.actual)}</td>
                <td className="px-4 py-2 text-right text-blue-600">{fmtK(summary.first_fill_pipeline)}</td>
                <td className="px-4 py-2 text-right text-purple-600">{fmtK(summary.second_fill_projected)}</td>
                <td className="px-4 py-2 text-right text-gray-800">{fmtK(summary.forecast)}</td>
                <td className="px-4 py-2 text-right text-gray-500">{summary.goal > 0 ? fmtK(summary.goal) : "—"}</td>
                <td className={`px-4 py-2 text-right ${summary.gap > 0 ? "text-red-500" : "text-green-600"}`}>
                  {summary.goal > 0 ? fmtK(summary.gap) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Row 6 — Goal setting */}
      <Section title={`Set Monthly Goals — ${monthLabel(selectedMonth)}`}>
        <div className="flex flex-wrap gap-4 items-end">
          {["IVIG", "HEME", "ANC_BILLED"].map(cls => (
            <label key={cls} className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: CLS_COLOR[cls] }} />
                {CLS_LABEL[cls]}
              </span>
              <div className="flex items-center">
                <span className="border border-r-0 border-gray-300 rounded-l-md px-2 py-1.5 text-sm bg-gray-50 text-gray-400">$</span>
                <input
                  type="text"
                  value={goalInputs[cls] ?? ""}
                  onChange={e => setGoalInputs(g => ({ ...g, [cls]: e.target.value }))}
                  placeholder="0"
                  className="border border-gray-300 rounded-r-md px-2.5 py-1.5 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-[#4a7fd4]"
                />
              </div>
            </label>
          ))}
          <button
            onClick={saveGoals}
            disabled={goalSaving}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              goalSaved ? "bg-green-500 text-white"
              : goalSaving ? "bg-[#4a7fd4] text-white opacity-60"
              : "bg-[#4a7fd4] text-white hover:bg-[#1a3a6b]"
            }`}
          >
            {goalSaved ? "Saved ✓" : goalSaving ? "Saving…" : "Save Goals"}
          </button>
        </div>
      </Section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function WeekTable({ weeks, showPts }: { weeks: WeekRow[]; showPts: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm divide-y divide-gray-100">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Week</th>
            {showPts && <th className="px-4 py-2 text-right font-semibold">1st Pts</th>}
            <th className="px-4 py-2 text-right font-semibold">1st Fill TP</th>
            {showPts && <th className="px-4 py-2 text-right font-semibold">2nd Pts</th>}
            <th className="px-4 py-2 text-right font-semibold">2nd Fill TP</th>
            <th className="px-4 py-2 text-right font-semibold">Total Opp</th>
            <th className="px-4 py-2 text-right font-semibold">Actual</th>
            <th className="px-4 py-2 text-right font-semibold">Missed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {weeks.map(w => (
            <tr key={w.label} className={`hover:bg-gray-50 ${w.is_past ? "opacity-80" : ""}`}>
              <td className="px-4 py-2 font-medium text-gray-700 whitespace-nowrap">
                {w.label}
                {w.is_past && <span className="ml-1.5 text-[10px] text-gray-400 uppercase">past</span>}
              </td>
              {showPts && <td className="px-4 py-2 text-right text-gray-500">{w.first_fill_pts}</td>}
              <td className="px-4 py-2 text-right text-blue-600">{fmtK(w.first_fill_tp)}</td>
              {showPts && <td className="px-4 py-2 text-right text-gray-500">{w.second_fill_pts}</td>}
              <td className="px-4 py-2 text-right text-purple-600">{fmtK(w.second_fill_tp)}</td>
              <td className="px-4 py-2 text-right font-semibold text-gray-800">{fmtK(w.total_opp)}</td>
              <td className="px-4 py-2 text-right text-green-600 font-medium">{fmtK(w.actual)}</td>
              <td className="px-4 py-2 text-right">
                {w.missed != null
                  ? <span className={w.missed > 0 ? "text-red-500 font-medium" : "text-green-600 font-medium"}>{fmtK(w.missed)}</span>
                  : <span className="text-gray-300">—</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        {accent && <span className="w-3 h-3 rounded-full" style={{ background: accent }} />}
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  const border: Record<string, string> = {
    navy: "border-l-[#1a3a6b]", blue: "border-l-[#4a7fd4]", green: "border-l-green-500",
    purple: "border-l-purple-500", red: "border-l-red-500",
  };
  const text: Record<string, string> = {
    navy: "text-[#1a3a6b]", blue: "text-[#4a7fd4]", green: "text-green-600",
    purple: "text-purple-600", red: "text-red-500",
  };
  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${border[color]} px-3 py-3 shadow-sm`}>
      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">{label}</p>
      <p className={`text-lg font-bold leading-tight ${text[color]}`}>{value}</p>
    </div>
  );
}

function GoalPctCard({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 100);
  return (
    <div className="bg-white rounded-lg border border-gray-200 border-l-4 border-l-[#1a3a6b] px-3 py-3 shadow-sm">
      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">% to Goal</p>
      <p className="text-lg font-bold text-[#1a3a6b] leading-tight">{pct.toFixed(1)}%</p>
      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1.5">
        <div className="h-1.5 rounded-full bg-[#4a7fd4]" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-100 px-3 py-2.5">
      <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-bold text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}
