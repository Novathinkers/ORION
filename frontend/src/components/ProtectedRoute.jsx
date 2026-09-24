import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const HOME_BY_ROLE = { primary: "/primary", secondary: "/driver", admin: "/admin" };

export default function ProtectedRoute({ allow, children }) {
  const { user, role, loading, profile } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-ink-muted text-sm font-mono">Loading session…</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (profile?.status === "inactive") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="panel p-6 max-w-sm text-center">
          <p className="text-risk-veryhigh font-semibold mb-2">Account deactivated</p>
          <p className="text-sm text-ink-muted">
            Your account has been deactivated by an administrator. Contact your organization or system admin.
          </p>
        </div>
      </div>
    );
  }

  if (allow && role && !allow.includes(role)) {
    return <Navigate to={HOME_BY_ROLE[role] || "/login"} replace />;
  }

  return children;
}
