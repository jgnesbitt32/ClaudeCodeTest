import { FormEvent, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../api";

const NAV_ITEMS = [
  { to: "/refills", label: "Refills", icon: ClipboardIcon },
  { to: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { to: "/shipping", label: "Shipping", icon: TruckIcon },
  { to: "/patients", label: "Patients", icon: UsersIcon },
  { to: "/projections", label: "Projections", icon: ChartIcon },
  { to: "/reports", label: "Reports", icon: DocumentIcon },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="flex flex-col w-56 shrink-0 bg-[#1a3a6b] text-white">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10">
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-bold tracking-wide">Osiris</span>
            <span className="text-xs text-blue-300 tracking-wide">by BlueBird</span>
          </div>
        </div>

        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[#4a7fd4] text-white"
                    : "text-blue-100 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-white/10 text-xs text-blue-300">
          Osiris v0.1
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between h-14 px-6 bg-white border-b border-gray-200 shrink-0">
          <PageTitle />

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-[#1a3a6b] text-white text-xs font-bold flex items-center justify-center">
                {user?.full_name?.[0]?.toUpperCase()}
              </div>
              <span className="text-sm text-gray-700 font-medium">{user?.full_name}</span>
              <span className="text-xs text-gray-400 uppercase tracking-wide bg-gray-100 px-2 py-0.5 rounded">{user?.role}</span>
              <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${menuOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                <button
                  onClick={() => { setMenuOpen(false); setShowChangePw(true); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5"
                >
                  <KeyIcon className="w-4 h-4 text-gray-400" />
                  Change Password
                </button>
                <div className="border-t border-gray-100 my-1" />
                <button
                  onClick={() => { setMenuOpen(false); logout("manual"); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5"
                >
                  <LogoutIcon className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Change Password Modal */}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </div>
  );
}

// ── Change Password Modal ─────────────────────────────────────────────────────
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent]   = useState("");
  const [next, setNext]         = useState("");
  const [confirm, setConfirm]   = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setError("Passwords do not match."); return; }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      setSuccess(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Change Password</h2>
        <p className="text-sm text-gray-500 mb-5">Enter your current password then choose a new one.</p>

        {success ? (
          <div className="text-center py-4">
            <div className="text-green-600 text-3xl mb-2">✓</div>
            <p className="text-sm font-medium text-gray-800 mb-1">Password changed successfully</p>
            <p className="text-xs text-gray-500 mb-4">Use your new password next time you sign in.</p>
            <button onClick={onClose} className="px-4 py-2 bg-[#1a3a6b] text-white rounded-lg text-sm font-medium hover:bg-[#4a7fd4]">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
            )}

            <Field label="Current Password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
            <Field label="New Password" type="password" value={next} onChange={setNext} autoComplete="new-password" hint="Minimum 8 characters" />
            <Field label="Confirm New Password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm font-medium bg-[#1a3a6b] text-white rounded-lg hover:bg-[#4a7fd4] disabled:opacity-60 disabled:cursor-wait"
              >
                {saving ? "Saving…" : "Update Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, type, value, onChange, autoComplete, hint }: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; autoComplete?: string; hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      <input
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={e => onChange(e.target.value)}
        required
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7fd4] focus:border-transparent"
      />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function PageTitle() {
  const { pathname } = useLocation();
  const item = NAV_ITEMS.find((n) => pathname.startsWith(n.to));
  return <h1 className="text-base font-semibold text-gray-800">{item?.label ?? "Osiris"}</h1>;
}

// Icons
function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}
function TruckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
    </svg>
  );
}
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}
function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}
function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
  );
}
function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}
