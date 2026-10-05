import { Navigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

const HOME_BY_ROLE = { primary: "/primary", secondary: "/driver", admin: "/admin" };

export default function RoleRedirect() {
  const { role, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-ink-muted text-sm font-mono">Loading session…</p>
      </div>
    );
  }
  return <Navigate to={HOME_BY_ROLE[role] || "/login"} replace />;
}
