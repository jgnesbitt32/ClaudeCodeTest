import { useEffect, useState } from "react";
import api from "../api";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import type { Refill } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Summary {
  call_today: number;
  past_due: number;
  scheduled_this_week: number;
  shipped_this_month: number;
  mtd_revenue: number;
  monthly_goal: number;
  pct_to_goal: number;
}
interface OppByClass { category: string; tp: number }
interface StatusGroup { group: string; count: number }
interface ShippingRecord {
  id: number; patient: string | null; medication: string | null;
  shipping_date: string | null; total_paid: number | null; status: string | null;
}
interface DashboardData {
  summary: Summary;
  opportunities_by_class: OppByClass[];
  status_distribution: StatusGroup[];
  needs_attention: Refill[];
  shipping_today: ShippingRecord[];
}

// ── Colours ───────────────────────────────────────────────────────────────────
const CLASS_COLORS: Record<string, string> = {
  IVIG: "#4a7fd4", HEME: "#e94560", ANC_BILLED: "#22c55e",
};
const STATUS_COLORS: Record<string, string> = {
  "No Attempts": "#94a3b8", "Attempt 1-3": "#f59e0b",
  Scheduled: "#8b5cf6", Shipped: "#22c55e", Other: "#e2e8f0",
};

function fmt(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    axios.get<DashboardData>("/api/dashboard")
      .then(r => setData(r.data))
      .catch(() => setError("Failed to load dashboard. Is the backend running?"));
  }, []);

  if (error) return <ErrorBanner msg={error} />;
  if (!data) return <LoadingSpinner />;

  const { summary, opportunities_by_class, status_distribution, needs_attention, shipping_today } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Row 1 — Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Call Today" value={summary.call_today} color="blue" />
        <StatCard label="Past Due" value={summary.past_due} color={summary.past_due > 0 ? "red" : "gray"} />
        <StatCard label="Scheduled" value={summary.scheduled_this_week} color="purple" />
        <StatCard label="Shipped This Month" value={summary.shipped_this_month} color="green" />
        <StatCard label="MTD Revenue" value={fmt(summary.mtd_revenue)} color="navy" />
        <GoalCard pct={summary.pct_to_goal} goal={summary.monthly_goal} actual={summary.mtd_revenue} />
      </div>

      {/* Row 2 — Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="This Week's Opportunities by Class">
          {opportunities_by_class.length === 0 ? (
            <Empty msg="No THIS WEEK opportunities" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={opportunities_by_class} margin={{ left: 10, right: 10, top: 8 }}>
                <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="tp" radius={[4, 4, 0, 0]}>
                  {opportunities_by_class.map((d) => (
                    <Cell key={d.category} fill={CLASS_COLORS[d.category] ?? "#4a7fd4"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Pipeline Status Distribution">
          {status_distribution.length === 0 ? (
            <Empty msg="No data" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={status_distribution}
                  dataKey="count"
                  nameKey="group"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {status_distribution.map((d) => (
                    <Cell key={d.group} fill={STATUS_COLORS[d.group] ?? "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `${v} refills`} />
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 3 — Action lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Needs Attention */}
        <ActionCard title="Needs Attention" subtitle="Past Due — highest value first">
          {needs_attention.length === 0 ? (
            <Empty msg="No past-due refills 🎉" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b">
                  <th className="pb-2 text-left font-medium">Patient</th>
                  <th className="pb-2 text-left font-medium">Drug</th>
                  <th className="pb-2 text-left font-medium">Next Call</th>
                  <th className="pb-2 text-right font-medium">TP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {needs_attention.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-800 max-w-[130px] truncate">{r.patient}</td>
                    <td className="py-2 text-gray-500 max-w-[140px] truncate" title={r.drug ?? ""}>{r.drug}</td>
                    <td className="py-2 text-red-500 whitespace-nowrap text-xs">{r.next_call_date ?? "—"}</td>
                    <td className="py-2 text-right font-semibold text-gray-800">{fmt(r.tp ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ActionCard>

        {/* Shipping Today */}
        <ActionCard title="Shipping Today" subtitle={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}>
          {shipping_today.length === 0 ? (
            <Empty msg="No shipments scheduled for today" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b">
                  <th className="pb-2 text-left font-medium">Patient</th>
                  <th className="pb-2 text-left font-medium">Medication</th>
                  <th className="pb-2 text-right font-medium">Total Paid</th>
                  <th className="pb-2 text-left font-medium pl-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shipping_today.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-800 max-w-[130px] truncate">{s.patient ?? "—"}</td>
                    <td className="py-2 text-gray-500 max-w-[150px] truncate" title={s.medication ?? ""}>{s.medication}</td>
                    <td className="py-2 text-right font-semibold text-gray-800">{fmt(s.total_paid ?? 0)}</td>
                    <td className="py-2 pl-3">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">{s.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ActionCard>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const ring: Record<string, string> = {
    blue: "border-l-[#4a7fd4]", red: "border-l-red-500", purple: "border-l-purple-500",
    green: "border-l-green-500", navy: "border-l-[#1a3a6b]", gray: "border-l-gray-300",
  };
  const text: Record<string, string> = {
    blue: "text-[#4a7fd4]", red: "text-red-500", purple: "text-purple-600",
    green: "text-green-600", navy: "text-[#1a3a6b]", gray: "text-gray-400",
  };
  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${ring[color]} p-4 shadow-sm`}>
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold ${text[color]}`}>{value}</p>
    </div>
  );
}

function GoalCard({ pct, goal, actual }: { pct: number; goal: number; actual: number }) {
  const clamped = Math.min(pct, 100);
  return (
    <div className="bg-white rounded-lg border border-gray-200 border-l-4 border-l-[#1a3a6b] p-4 shadow-sm col-span-2 md:col-span-1">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">% to Goal</p>
      <p className="text-2xl font-bold text-[#1a3a6b] mb-2">{pct.toFixed(1)}%</p>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div
          className="h-2 rounded-full bg-[#4a7fd4] transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {goal > 0 && (
        <p className="text-[10px] text-gray-400 mt-1">{fmt(actual)} of {fmt(goal)} goal</p>
      )}
      {goal === 0 && <p className="text-[10px] text-gray-400 mt-1">No goal set for this month</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ActionCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="text-xs text-gray-400">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-sm text-gray-400 py-6 text-center">{msg}</p>;
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
      Loading dashboard…
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="m-6 bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{msg}</div>
  );
}
