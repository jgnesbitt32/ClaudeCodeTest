import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login, loading, timedOut } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(username, password);
      navigate("/refills", { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Login failed. Please try again.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f1923]">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex flex-col leading-tight">
            <span className="text-4xl font-bold text-white tracking-wide">Osiris</span>
            <span className="text-sm text-blue-300 tracking-widest">by BlueBird</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-[#1a2736] rounded-xl border border-[#2a3a4a] shadow-2xl p-8">
          <h2 className="text-lg font-semibold text-white mb-1">Sign in</h2>
          <p className="text-sm text-[#94a3b8] mb-6">
            {timedOut
              ? "You were signed out due to inactivity."
              : "Enter your credentials to access Osiris."}
          </p>

          {timedOut && (
            <div className="mb-4 px-3 py-2 bg-amber-900/40 border border-amber-600/40 rounded text-amber-300 text-sm">
              Session expired after 15 minutes of inactivity.
            </div>
          )}

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-900/40 border border-red-600/40 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#94a3b8] mb-1.5 uppercase tracking-wide">
                Username
              </label>
              <input
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                className="w-full bg-[#0f1923] border border-[#2a3a4a] rounded-lg px-3 py-2.5 text-white placeholder-[#4a5a6a] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent"
                placeholder="username"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#94a3b8] mb-1.5 uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-[#0f1923] border border-[#2a3a4a] rounded-lg px-3 py-2.5 text-white placeholder-[#4a5a6a] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-60 disabled:cursor-wait text-white font-semibold py-2.5 rounded-lg transition-colors text-sm mt-2"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#4a5a6a] mt-6">
          Protected health information — authorized users only
        </p>
      </div>
    </div>
  );
}
