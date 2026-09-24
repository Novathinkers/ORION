import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export default function SignupPrimary() {
  const { signUpPrimary } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ orgName: "", fullName: "", phone: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signUpPrimary({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        phone: form.phone,
        organizationName: form.orgName,
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
          <span className="font-display font-semibold tracking-tight">ORION LOGISTICS</span>
        </div>
        <div className="panel p-6">
          <h1 className="font-display text-xl font-semibold mb-1">Register your organization</h1>
          <p className="text-sm text-ink-muted mb-6">Primary User — Transport Manager / Fleet Owner</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Organization name</label>
              <input className="input" required value={form.orgName} onChange={set("orgName")} placeholder="e.g. Brahmaputra Freight Co." />
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
              {loading ? "Creating account…" : "Create organization account"}
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
