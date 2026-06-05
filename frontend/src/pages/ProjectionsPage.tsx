import { useEffect, useMemo, useState } from "react";
import api from "../api";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell,
  PieChart, Pie,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ForecastLine {
  cat: string; patient: string; ptsn: string; drug: string; ndc: string;
  tp: number; gp: number; acq: number; copay: number;
  line_type: string; date_completed: string | null; fill_date: string;
  rep: string | null; plan_type: string | null; pharmacy: string | null; days_supply: number;
}
interface ActualLine {
  cat: string; patient: string; ptsn: string; drug: string;
  tp: number; gp: number; date_completed: string | null;
  rep: string | null; plan_type: string | null; pharmacy: string | null;
}
interface ForecastData {
  month: string;
  available_months: string[];
  forecast_lines: ForecastLine[];
  actuals: ActualLine[];
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const BG = "#0f1923";
const CARD = "#1a2736";
const BORDER = "#2a3a4a";
const TEXT = "#e2e8f0";
const MUTED = "#94a3b8";
const BLUE = "#3b82f6";
const GREEN = "#10b981";
const AMBER = "#f59e0b";
const PURPLE = "#8b5cf6";
const LAVENDER = "#a78bfa";
const RED = "#ef4444";

const CAT_COLOR: Record<string, string> = { IVIG: BLUE, HEME: PURPLE, ANC_BILLED: AMBER };
const PIE_COLORS = [BLUE, GREEN, AMBER, PURPLE, RED, "#06b6d4", "#f97316", "#ec4899", "#14b8a6", "#a855f7", "#475569"];
const CATS = ["HEME", "IVIG", "ANC_BILLED"];

function ltColor(lt: string) {
  if (lt === "1st Fill") return BLUE;
  if (lt === "2nd Fill") return AMBER;
  return LAVENDER;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => "$" + Math.round(n).toLocaleString();
const fmtM = (n: number) =>
  Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : fmt(n);

function monthWeeks(year: number, month: number) {
  const last = new Date(year, month, 0).getDate();
  const ws = [{ l: "W1", s: 1, e: 7 }, { l: "W2", s: 8, e: 14 }, { l: "W3", s: 15, e: 21 }, { l: "W4", s: 22, e: 28 }];
  if (last > 28) ws.push({ l: "W5", s: 29, e: last });
  return ws;
}

function normDrug(d: string) {
  return d.replace(/\s+/g, " ").trim().split(/\s+\d+\s*(g|mg|ml|unit|mcg)/i)[0].trim();
}

function monthTitle(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function dom(iso: string) { return new Date(iso + "T00:00:00").getDate(); }

// ── Sub-components ────────────────────────────────────────────────────────────
function DCard({ title, children, style }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, ...style }}>
      {title && (
        <h3 style={{ fontSize: 12, color: MUTED, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 16, fontWeight: 600 }}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function KPI({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 12, color: MUTED, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

const tickStyle = { fill: MUTED, fontSize: 11 };
const ttStyle = { backgroundColor: CARD, border: `1px solid ${BORDER}`, color: TEXT, fontSize: 12 };

// ── ProjectionsPage ───────────────────────────────────────────────────────────
export default function ProjectionsPage() {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  function load(month?: string) {
    setLoading(true);
    const qs = month ? `?month=${month}` : "";
    api.get<ForecastData>(`/api/projections/forecast${qs}`)
      .then(r => { setData(r.data); setSelectedMonth(r.data.month); setError(null); })
      .catch(() => setError("Failed to load forecast. Is the backend running?"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const lines = data?.forecast_lines ?? [];
  const actuals = data?.actuals ?? [];
  const [yr, mo] = selectedMonth ? selectedMonth.split("-").map(Number) : [0, 0];
  const weeks = useMemo(() => (yr ? monthWeeks(yr, mo) : []), [yr, mo]);
  const lineTypes = useMemo(() => [...new Set(lines.map(d => d.line_type))], [lines]);

  // Summary
  const summary = useMemo(() => {
    const totalTP = lines.reduce((s, d) => s + d.tp, 0);
    const totalGP = lines.reduce((s, d) => s + d.gp, 0);
    const f1 = lines.filter(d => d.line_type === "1st Fill");
    const f2 = lines.filter(d => d.line_type === "2nd Fill");
    const pp = lines.filter(d => d.line_type !== "1st Fill" && d.line_type !== "2nd Fill");
    return {
      totalTP, totalGP, margin: totalTP > 0 ? (totalGP / totalTP * 100) : 0,
      firstTP: f1.reduce((s, d) => s + d.tp, 0), firstN: f1.length,
      secondTP: f2.reduce((s, d) => s + d.tp, 0), secondN: f2.length,
      postponeTP: pp.reduce((s, d) => s + d.tp, 0), postponeN: pp.length,
      activePts: new Set(lines.map(d => d.ptsn)).size,
      postponeLabel: pp.length > 0 ? pp[0].line_type : "Prior Month Postpones",
    };
  }, [lines]);

  // Revenue build chart: X = line types, stacked by cat
  const buildChartData = useMemo(() => lineTypes.map(lt => {
    const row: Record<string, string | number> = { lineType: lt };
    CATS.forEach(cat => { row[cat] = Math.round(lines.filter(d => d.line_type === lt && d.cat === cat).reduce((s, d) => s + d.tp, 0)); });
    return row;
  }), [lines, lineTypes]);

  // Category donut
  const catDonut = useMemo(() =>
    CATS.map(c => ({ name: c, value: lines.filter(d => d.cat === c).reduce((s, d) => s + d.tp, 0) })).filter(d => d.value > 0),
    [lines]);

  // Week data
  const weekData = useMemo(() => weeks.map(w => {
    const fLines = lines.filter(d => { const day = dom(d.fill_date); return day >= w.s && day <= w.e; });
    const aLines = actuals.filter(d => d.date_completed && (() => { const day = dom(d.date_completed!); return day >= w.s && day <= w.e; })());
    return { ...w, tp: fLines.reduce((s, d) => s + d.tp, 0), fills: fLines.length, actualTP: aLines.reduce((s, d) => s + d.tp, 0) };
  }), [lines, actuals, weeks]);

  // Payer mix
  const payerData = useMemo(() => {
    const m: Record<string, number> = {};
    lines.forEach(d => { const k = d.plan_type || "UNKNOWN"; m[k] = (m[k] || 0) + d.tp; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));
  }, [lines]);

  // Rep data
  const repData = useMemo(() => {
    const m: Record<string, number> = {};
    lines.forEach(d => { const k = d.rep || "UNKNOWN"; m[k] = (m[k] || 0) + d.tp; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [lines]);

  // Top drugs by TP
  const drugTPData = useMemo(() => {
    const m: Record<string, number> = {};
    lines.forEach(d => { const k = normDrug(d.drug); m[k] = (m[k] || 0) + d.tp; });
    const sorted = Object.entries(m).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 10).map(([name, value]) => ({ name, value: Math.round(value) }));
    const other = sorted.slice(10).reduce((s, [, v]) => s + v, 0);
    if (other > 0) top.push({ name: "Other", value: Math.round(other) });
    return top;
  }, [lines]);

  // Top drugs by GP%
  const drugGPData = useMemo(() => {
    const m: Record<string, { tp: number; gp: number }> = {};
    lines.forEach(d => { const k = normDrug(d.drug); if (!m[k]) m[k] = { tp: 0, gp: 0 }; m[k].tp += d.tp; m[k].gp += d.gp; });
    return Object.entries(m)
      .filter(([, v]) => v.tp > 5000)
      .map(([name, v]) => ({ name: name.length > 28 ? name.slice(0, 26) + "…" : name, pct: +(v.gp / v.tp * 100).toFixed(1) }))
      .sort((a, b) => b.pct - a.pct).slice(0, 10);
  }, [lines]);

  // Margin by cat
  const marginData = useMemo(() => CATS.map(cat => {
    const ls = lines.filter(d => d.cat === cat);
    const tp = ls.reduce((s, d) => s + d.tp, 0);
    const gp = ls.reduce((s, d) => s + d.gp, 0);
    return { cat, margin: tp > 0 ? +(gp / tp * 100).toFixed(1) : 0 };
  }), [lines]);

  // FVA
  const fcstByCat = useMemo(() => {
    const m: Record<string, number> = {};
    CATS.forEach(c => { m[c] = lines.filter(d => d.cat === c).reduce((s, d) => s + d.tp, 0); });
    return m;
  }, [lines]);
  const actByCat = useMemo(() => {
    const m: Record<string, number> = {};
    CATS.forEach(c => { m[c] = actuals.filter(d => d.cat === c).reduce((s, d) => s + d.tp, 0); });
    return m;
  }, [actuals]);

  const fvaCatData = useMemo(() =>
    CATS.map(c => ({ cat: c, forecast: Math.round(fcstByCat[c] || 0), actual: Math.round(actByCat[c] || 0) })),
    [fcstByCat, actByCat]);

  const fvaWeekData = useMemo(() => {
    const fw: Record<string, number> = {}; const aw: Record<string, number> = {};
    weeks.forEach(w => { fw[w.l] = 0; aw[w.l] = 0; });
    lines.forEach(d => { const w = weeks.find(w => { const day = dom(d.fill_date); return day >= w.s && day <= w.e; }); if (w) fw[w.l] += d.tp; });
    actuals.forEach(d => { if (!d.date_completed) return; const w = weeks.find(w => { const day = dom(d.date_completed!); return day >= w.s && day <= w.e; }); if (w) aw[w.l] += d.tp; });
    return weeks.map(w => ({ week: w.l, forecast: Math.round(fw[w.l]), actual: Math.round(aw[w.l]) }));
  }, [lines, actuals, weeks]);

  // Revenue build table
  const buildTable = useMemo(() => {
    const t: Record<string, Record<string, number>> = {};
    lineTypes.forEach(lt => { t[lt] = {}; CATS.forEach(c => { t[lt][c] = 0; }); });
    lines.forEach(d => { if (t[d.line_type]) t[d.line_type][d.cat] += d.tp; });
    return t;
  }, [lines, lineTypes]);

  // Progress
  const today = new Date();
  const isCurrentMonth = selectedMonth === today.toISOString().slice(0, 7);
  const daysInMonth = yr ? new Date(yr, mo, 0).getDate() : 30;
  const monthProgress = isCurrentMonth ? Math.min(today.getDate() / daysInMonth * 100, 100) : 100;
  const totalActTP = actuals.reduce((s, d) => s + d.tp, 0);

  if (error) return (
    <div style={{ background: BG, minHeight: "100%", padding: 24, color: RED }}>
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>{error}</div>
    </div>
  );
  if (loading || !data) return (
    <div style={{ background: BG, minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontSize: 14 }}>
      Loading forecast…
    </div>
  );

  const priorMonthName = summary.postponeLabel.replace(" Postpone", "");

  return (
    <div style={{ background: BG, margin: "-1.5rem", padding: "1.5rem", minHeight: "calc(100% + 3rem)", color: TEXT, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1e3a5f 0%,#0f1923 100%)", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>
            <span style={{ color: BLUE }}>BlueBird</span> Infusion — {monthTitle(selectedMonth)} Forecast
          </h1>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
            Revenue = TP recognized on Date Completed &bull; {lines.length} forecast lines
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <select value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); load(e.target.value); }}
            style={{ background: CARD, border: `1px solid ${BORDER}`, color: TEXT, borderRadius: 8, padding: "6px 10px", fontSize: 13, cursor: "pointer" }}>
            {(data.available_months).map(m => <option key={m} value={m}>{monthTitle(m)}</option>)}
          </select>
          <div style={{ textAlign: "right" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(16,185,129,0.15)", color: GREEN, padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, background: GREEN, borderRadius: "50%", display: "inline-block" }} />
              LIVE
            </div>
            <div style={{ fontSize: 12, color: MUTED }}>
              {clock.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 24 }}>
        <KPI label="Total TP" value={fmtM(summary.totalTP)} sub={`${lines.length} forecast lines`} color={BLUE} />
        <KPI label="1st Fills" value={fmtM(summary.firstTP)} sub={`${summary.firstN} lines`} color={BLUE} />
        <KPI label="2nd Fills" value={fmtM(summary.secondTP)} sub={`${summary.secondN} lines`} color={AMBER} />
        <KPI label={`${priorMonthName} Postpones`} value={fmtM(summary.postponeTP)} sub={`${summary.postponeN} lines`} color={LAVENDER} />
        <KPI label="Active Patients" value={String(summary.activePts)} sub={`GP margin ${summary.margin.toFixed(1)}%`} color={TEXT} />
      </div>

      {/* Revenue Build + Category Donut */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <DCard title="Revenue Build — HEME vs IVIG by Line Type">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={buildChartData} margin={{ left: 10, right: 10, top: 8 }}>
              <XAxis dataKey="lineType" tick={tickStyle} />
              <YAxis tickFormatter={fmtM} tick={tickStyle} width={70} />
              <Tooltip contentStyle={ttStyle} formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ color: MUTED, fontSize: 12 }} />
              {CATS.map((cat, i) => (
                <Bar key={cat} dataKey={cat} stackId="a" fill={CAT_COLOR[cat]} radius={i === CATS.length - 1 ? [4, 4, 0, 0] : undefined} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </DCard>
        <DCard title="Revenue by Category">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={catDonut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={65} outerRadius={100} paddingAngle={2}>
                {catDonut.map((d, i) => <Cell key={i} fill={CAT_COLOR[d.name] ?? PIE_COLORS[i]} />)}
              </Pie>
              <Tooltip contentStyle={ttStyle} formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ color: MUTED, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </DCard>
      </div>

      {/* Weekly Schedule */}
      <DCard title={`Weekly Completion Schedule — ${monthTitle(selectedMonth)}`} style={{ marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${weeks.length},1fr)`, gap: 8 }}>
          {weekData.map(w => (
            <div key={w.l} style={{ background: "rgba(59,130,246,0.1)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{w.l} &bull; {w.s}–{w.e}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: BLUE }}>{fmtM(w.tp)}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{w.fills} forecast lines</div>
              {w.actualTP > 0 && <div style={{ fontSize: 11, color: GREEN, marginTop: 2 }}>{fmtM(w.actualTP)} actual</div>}
            </div>
          ))}
        </div>
      </DCard>

      {/* Payer Mix + TP by Rep */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <DCard title="Payer Mix — TP Share">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={payerData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} paddingAngle={2}>
                {payerData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={ttStyle} formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ color: MUTED, fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </DCard>
        <DCard title="TP by Sales Rep">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={repData} margin={{ left: 10, right: 10, top: 8, bottom: 40 }}>
              <XAxis dataKey="name" tick={{ ...tickStyle, fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={tickStyle} width={55} />
              <Tooltip contentStyle={ttStyle} formatter={(v: number) => fmt(v)} />
              <Bar dataKey="value" name="TP" radius={[4, 4, 0, 0]}>
                {repData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </DCard>
      </div>

      {/* Top Drugs TP + GP% */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <DCard title="Top Drugs by TP">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={drugTPData} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={90} paddingAngle={2}>
                {drugTPData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={ttStyle} formatter={(v: number) => fmt(v)} />
              <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ color: MUTED, fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </DCard>
        <DCard title="Top Drugs by GP% to TP">
          {drugGPData.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 280, color: MUTED, fontSize: 13 }}>No drugs with TP &gt; $5k</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart layout="vertical" data={drugGPData} margin={{ left: 10, right: 30, top: 4 }}>
                <XAxis type="number" tickFormatter={v => `${v}%`} tick={tickStyle} />
                <YAxis type="category" dataKey="name" tick={{ ...tickStyle, fontSize: 9 }} width={130} />
                <Tooltip contentStyle={ttStyle} formatter={(v: number) => `${v}%`} />
                <Bar dataKey="pct" name="GP %" radius={[0, 4, 4, 0]}>
                  {drugGPData.map((d, i) => <Cell key={i} fill={d.pct >= 30 ? GREEN : d.pct >= 15 ? AMBER : RED} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </DCard>
      </div>

      {/* Forecast vs Actual */}
      <DCard title={`Forecast vs Actual — ${monthTitle(selectedMonth)}`} style={{ marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={fvaCatData} margin={{ left: 10, right: 10, top: 16 }}>
              <XAxis dataKey="cat" tick={tickStyle} />
              <YAxis tickFormatter={fmtM} tick={tickStyle} width={70} />
              <Tooltip contentStyle={ttStyle} formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ color: MUTED, fontSize: 12 }} />
              <Bar dataKey="forecast" name="Forecast" fill="rgba(59,130,246,0.3)" stroke={BLUE} strokeWidth={2} radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Actual" fill="rgba(16,185,129,0.7)" stroke={GREEN} strokeWidth={2} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={fvaWeekData} margin={{ left: 10, right: 10, top: 16 }}>
              <XAxis dataKey="week" tick={tickStyle} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={tickStyle} width={60} />
              <Tooltip contentStyle={ttStyle} formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ color: MUTED, fontSize: 12 }} />
              <Bar dataKey="forecast" name="Forecast" fill="rgba(59,130,246,0.3)" stroke={BLUE} strokeWidth={2} radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Actual" fill="rgba(16,185,129,0.7)" stroke={GREEN} strokeWidth={2} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
              {["", "Forecast", "Actual", "Variance", "% Attained", "Progress"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: h === "" ? "left" : "right", color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...CATS, "TOTAL"].map(cat => {
              const fcst = cat === "TOTAL" ? summary.totalTP : (fcstByCat[cat] || 0);
              const act = cat === "TOTAL" ? totalActTP : (actByCat[cat] || 0);
              const variance = act - fcst;
              const pct = fcst > 0 ? (act / fcst * 100) : 0;
              const barColor = pct >= monthProgress ? GREEN : pct >= monthProgress * 0.7 ? AMBER : RED;
              const isTotal = cat === "TOTAL";
              return (
                <tr key={cat} style={{ borderBottom: `1px solid ${BORDER}`, ...(isTotal ? { borderTop: `2px solid ${BORDER}` } : {}) }}>
                  <td style={{ padding: "10px 12px", fontWeight: isTotal ? 700 : 600, color: isTotal ? TEXT : (CAT_COLOR[cat] || TEXT) }}>{cat}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(fcst)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: GREEN, fontVariantNumeric: "tabular-nums" }}>{fmt(act)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: variance >= 0 ? GREEN : RED, fontVariantNumeric: "tabular-nums" }}>
                    {variance >= 0 ? "+" : ""}{fmt(variance)}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: barColor, fontWeight: 600 }}>{pct.toFixed(1)}%</td>
                  <td style={{ padding: "10px 12px", minWidth: 120 }}>
                    <div style={{ height: 8, background: BORDER, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: barColor, borderRadius: 4, transition: "width 1s ease" }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 10, fontSize: 12, color: MUTED }}>
          {isCurrentMonth
            ? `${monthTitle(selectedMonth).split(" ")[0]} progress: Day ${today.getDate()} of ${daysInMonth} (${monthProgress.toFixed(0)}% of month elapsed)`
            : `Showing full month: ${monthTitle(selectedMonth)}`}
        </div>
      </DCard>

      {/* Revenue Build Table */}
      <DCard title="Revenue Build — TP by Category & Line Type" style={{ marginBottom: 24 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
              <th style={{ padding: "10px 12px", textAlign: "left", color: MUTED, fontSize: 11, textTransform: "uppercase" }}>Line Type</th>
              {CATS.map(c => (
                <th key={c} style={{ padding: "10px 12px", textAlign: "right", color: CAT_COLOR[c], fontSize: 11, textTransform: "uppercase" }}>{c}</th>
              ))}
              <th style={{ padding: "10px 12px", textAlign: "right", color: MUTED, fontSize: 11, textTransform: "uppercase" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lineTypes.map(lt => {
              const rowTotal = CATS.reduce((s, c) => s + (buildTable[lt]?.[c] || 0), 0);
              return (
                <tr key={lt} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: `${ltColor(lt)}22`, color: ltColor(lt) }}>{lt}</span>
                  </td>
                  {CATS.map(c => (
                    <td key={c} style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(buildTable[lt]?.[c] || 0)}</td>
                  ))}
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(rowTotal)}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: `2px solid ${BORDER}` }}>
              <td style={{ padding: "10px 12px", fontWeight: 700 }}>TOTAL</td>
              {CATS.map(c => (
                <td key={c} style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: CAT_COLOR[c], fontVariantNumeric: "tabular-nums" }}>
                  {fmt(lineTypes.reduce((s, lt) => s + (buildTable[lt]?.[c] || 0), 0))}
                </td>
              ))}
              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: BLUE, fontVariantNumeric: "tabular-nums" }}>{fmt(summary.totalTP)}</td>
            </tr>
          </tbody>
        </table>
      </DCard>

      {/* Margin % by Category */}
      <DCard title="Margin % by Category" style={{ marginBottom: 24 }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={marginData} margin={{ left: 10, right: 30, top: 8 }}>
            <XAxis dataKey="cat" tick={tickStyle} />
            <YAxis tickFormatter={v => `${v}%`} tick={tickStyle} width={50} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => `${v}%`} />
            <Bar dataKey="margin" name="Margin %" radius={[4, 4, 0, 0]}>
              {marginData.map((d, i) => <Cell key={i} fill={CAT_COLOR[d.cat] ?? PIE_COLORS[i]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DCard>

      {/* Methodology */}
      <div style={{ background: "rgba(59,130,246,0.05)", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>
        <h3 style={{ color: BLUE, marginBottom: 12, fontSize: 14, fontWeight: 600 }}>Forecast Methodology</h3>
        {[
          ["Revenue metric", "TP (Third Party payment) recognized on Date Completed."],
          ["1st Fills", "For each active patient+drug, the last Date Completed is rolled forward by Days Supply (adjusted to next business day). If that date falls within the selected month, it is a 1st Fill."],
          ["2nd Fills", "If the 1st Fill date + Days Supply also lands in the selected month (Days Supply ≤ 28), a 2nd Fill line is added."],
          ["Prior Month Postpones", "Patients with a dispense in month−2 whose expected fill (date + supply) was in month−1 but had no month−1 completion — carried into the current month as deferred revenue."],
          ["Exclusions", "Patients marked Discontinued or Discharged are excluded. Categories OTHER and PRN (Days Supply ≤ 7) are excluded."],
        ].map(([label, text]) => (
          <p key={label} style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, marginBottom: 8 }}>
            <strong style={{ color: TEXT }}>{label}:</strong> {text}
          </p>
        ))}
      </div>
    </div>
  );
}
