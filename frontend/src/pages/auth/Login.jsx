import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { saveNavigationUser } from "../../lib/dataService";

export default function Login() {
  const { signIn, isSupabaseConfigured } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Guest navigation modal state
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      navigate("/redirect");
    } catch (err) {
      setError(err.message || "Sign in failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartGuestNavigation = async (e) => {
    e.preventDefault();
    const finalName = guestName.trim() || "Traveler";
    const finalPhone = guestPhone.trim() || "";
    localStorage.setItem("orion_public_guest_name", finalName);
    localStorage.setItem("orion_public_guest_phone", finalPhone);
    // Persist navigation user to SQL Database table
    await saveNavigationUser({ name: finalName, phone: finalPhone }).catch(() => {});
    navigate(`/navigate?name=${encodeURIComponent(finalName)}&phone=${encodeURIComponent(finalPhone)}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-8 bg-base text-ink">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center gap-2 justify-center">
          <span className="live-dot" />
          <span className="font-display font-semibold tracking-tight text-lg">ORION LOGISTICS</span>
        </div>

        {/* Public GPS Navigation Action Banner */}
        <div className="panel p-4 border-signal/40 bg-signal/10 space-y-2 text-center shadow-lg">
          <div className="flex items-center justify-center gap-2">
            <span className="text-xl">🗺️</span>
            <span className="font-bold text-sm text-signal">Public GPS Navigation</span>
          </div>
          <button
            onClick={() => setShowGuestModal(true)}
            className="btn-primary w-full py-2.5 text-xs font-bold uppercase tracking-wider bg-signal text-base-panel hover:bg-signal/90"
          >
            🧭 Start Navigation Map
          </button>
        </div>

        {!isSupabaseConfigured && (
          <div className="panel p-3 border-risk-moderate/40 bg-risk-moderate/10">
            <p className="text-xs text-risk-moderate">
              Supabase isn't configured yet. Copy <code>.env.example</code> to <code>.env</code> and add your project
              credentials before signing in.
            </p>
          </div>
        )}

        <div className="panel p-6">
          <h1 className="font-display text-xl font-semibold mb-1">Sign in</h1>
          <p className="text-sm text-ink-muted mb-6">Transport Manager, Driver, or Admin</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@organization.com"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-xs text-risk-veryhigh">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-ink-muted">
          New transport manager?{" "}
          <Link to="/signup/primary" className="text-signal hover:underline">
            Register your organization
          </Link>
        </p>
        <p className="text-center text-sm text-ink-muted">
          Invited as a driver?{" "}
          <Link to="/signup/driver" className="text-signal hover:underline">
            Create your driver account
          </Link>
        </p>
        
      </div>

      {/* Guest Name Input Modal */}
      {showGuestModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel max-w-sm w-full p-6 space-y-4 border-signal/40 shadow-2xl">
            <div className="flex items-center justify-between border-b border-base-border pb-3">
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>🧭</span>
                <span>Enter Name & Phone Number</span>
              </h2>
              <button onClick={() => setShowGuestModal(false)} className="text-ink-muted hover:text-ink text-base">✕</button>
            </div>

            <p className="text-xs text-ink-muted">Please enter your name and contact phone number to start using live GPS navigation and hazard reporting.</p>

            <form onSubmit={handleStartGuestNavigation} className="space-y-3">
              <div>
                <label className="label text-xs">Your Full Name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Alex, Rahul, Sarah..."
                  className="input font-medium text-xs"
                />
              </div>

              <div>
                <label className="label text-xs">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="e.g. +91 98765 43210"
                  className="input font-medium text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowGuestModal(false)} className="btn-secondary flex-1 text-xs">
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1 font-bold text-xs">
                  Start Navigation 🚀
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
