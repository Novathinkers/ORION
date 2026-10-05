import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";

export default function SignupDriver() {
  const { signUpSecondary } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ managerEmail: "", fullName: "", phone: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [managerPreview, setManagerPreview] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const lookupManager = async () => {
    setError("");
    setManagerPreview(null);
    if (!form.managerEmail) return;
    const { data, error: rpcError } = await supabase.rpc("get_primary_user_by_email", { p_email: form.managerEmail });
    if (rpcError || !data || data.length === 0) {
      setError("No transport manager found with that email. Double-check the address they gave you.");
      return;
    }
    setManagerPreview(data[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!managerPreview) {
      setError("Look up your transport manager's email first, so we can link your account to their organization.");
      return;
    }
    setLoading(true);
    try {
      await signUpSecondary({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        phone: form.phone,
        primaryUserId: managerPreview.id,
      });
      setDone(true);
    } catch (err) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="panel p-6 max-w-sm text-center">
          <p className="text-signal font-semibold mb-2">Check your email</p>
          <p className="text-sm text-ink-muted mb-4">
            We sent a confirmation link to <span className="text-ink">{form.email}</span>. Confirm it, then sign in.
          </p>
          <button onClick={() => navigate("/login")} className="btn-primary w-full">
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <span className="live-dot" />
          <span className="font-display font-semibold tracking-tight">ORION</span>
        </div>
        <div className="panel p-6">
          <h1 className="font-display text-xl font-semibold mb-1">Driver account</h1>
          <p className="text-sm text-ink-muted mb-6">Secondary User — Transport Personnel</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Your transport manager's email</label>
              <div className="flex gap-2">
                <input className="input" type="email" required value={form.managerEmail} onChange={set("managerEmail")} placeholder="manager@organization.com" />
                <button type="button" onClick={lookupManager} className="btn-secondary shrink-0 text-xs px-3">
                  Verify
                </button>
              </div>
              {managerPreview && (
                <p className="text-xs text-risk-low mt-1.5">
                  Linked to {managerPreview.full_name} · {managerPreview.organization_name}
                </p>
              )}
            </div>
            <div>
              <label className="label">Your full name</label>
              <input className="input" required value={form.fullName} onChange={set("fullName")} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={set("phone")} placeholder="+91" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" required value={form.email} onChange={set("email")} />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" required minLength={6} value={form.password} onChange={set("password")} />
            </div>
            {error && <p className="text-xs text-risk-veryhigh">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Creating account…" : "Create driver account"}
            </button>
          </form>
        </div>
        <p className="text-center text-sm text-ink-muted mt-5">
          Already have an account? <Link to="/login" className="text-signal hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
