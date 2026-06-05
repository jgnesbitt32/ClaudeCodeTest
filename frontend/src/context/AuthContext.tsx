import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import api from "../api";

interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  timedOut: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: (reason?: "manual" | "timeout") => void;
}

const AuthContext = createContext<AuthContextType>(null!);

const TOKEN_KEY = "osiris_token";
const USER_KEY  = "osiris_user";
const INACTIVITY_MS = 15 * 60 * 1000; // 15 minutes

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? "null"); } catch { return null; }
  });
  const [loading, setLoading]   = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const lastActivityRef = useRef(Date.now());

  // Update activity timestamp on user interaction
  useEffect(() => {
    if (!user) return;
    const bump = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener("mousemove", bump);
    window.addEventListener("keydown", bump);
    window.addEventListener("click", bump);

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > INACTIVITY_MS) {
        logout("timeout");
      }
    }, 30_000);

    return () => {
      window.removeEventListener("mousemove", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("click", bump);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { username, password });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      lastActivityRef.current = Date.now();
      setTimedOut(false);
      setUser(data.user);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback((reason: "manual" | "timeout" = "manual") => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      api.post("/auth/logout").catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    if (reason === "timeout") setTimedOut(true);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, timedOut, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export { TOKEN_KEY };
