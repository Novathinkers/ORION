import { useState, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { uploadProfilePhoto } from "../../lib/imageAnalysisService";
import { updateUserProfile } from "../../lib/dataService";

const ROLE_LABEL = {
  admin: "System Administrator",
  primary: "Transport Manager",
  secondary: "Driver",
};

export default function UserProfile() {
  const { user, profile, refreshProfile } = useAuth();
  const fileInputRef = useRef(null);

  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [photoUrl, setPhotoUrl] = useState(profile?.photo_url || "");
  const [previewUrl, setPreviewUrl] = useState(profile?.photo_url || "");
  const [pendingFile, setPendingFile] = useState(null);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadingPhoto(true);
    setError(null);
    try {
      const url = await uploadProfilePhoto(file, { userId: user?.id });
      setPhotoUrl(url);
      setMessage("✓ Avatar image uploaded to Supabase Storage! Click 'Save Profile Changes' to commit to Database.");
    } catch (err) {
      setError("Failed to upload profile photo to Supabase: " + err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      let finalPhotoUrl = photoUrl;
      if (pendingFile && !photoUrl) {
        finalPhotoUrl = await uploadProfilePhoto(pendingFile, { userId: user.id });
      }

      await updateUserProfile(user.id, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        photoUrl: finalPhotoUrl || previewUrl,
      });

      if (refreshProfile) {
        await refreshProfile();
      }

      setMessage(" Saved Successfully! Your profile has been updated.");
    } catch (err) {
      setError("Failed to update profile in Supabase: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <p className="eyebrow mb-1">Account & Settings</p>
        <h1 className="text-2xl font-semibold">User Profile & Identity</h1>
        <p className="text-sm text-ink-muted">View and update your personal details, contact number, and avatar photo.</p>
      </div>

      {message && (
        <div className="panel p-4 border-risk-low/40 bg-risk-low/10 text-risk-low text-sm font-semibold rounded-xl flex items-center gap-2">
          <span>✔</span>
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="panel p-4 border-risk-critical/40 bg-risk-critical/10 text-risk-critical text-sm font-semibold rounded-xl flex items-center gap-2">
          <span>❌</span>
          <span>{error}</span>
        </div>
      )}

      <div className="panel p-6 space-y-6 shadow-panel">
        {/* Profile Avatar Header */}
        <div className="flex items-center gap-5 border-b border-base-border pb-6">
          <div className="relative group shrink-0">
            <div className="h-20 w-20 rounded-full overflow-hidden bg-base-raised border-2 border-signal/40 flex items-center justify-center shadow-md">
              {previewUrl ? (
                <img src={previewUrl} alt="User Avatar" className="h-full w-full object-cover" />
              ) : (
                <span className="text-3xl">👤</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="absolute bottom-0 right-0 bg-signal text-base-panel rounded-full p-1.5 shadow-lg border border-base-panel hover:scale-105 transition-transform"
              title="Upload New Photo"
            >
              <span>📷</span>
            </button>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-bold text-ink">{profile?.full_name || "User"}</h2>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase bg-signal/15 text-signal border border-signal/30">
                {ROLE_LABEL[profile?.role] || profile?.role}
              </span>
              {profile?.organizations?.name && (
                <span className="text-xs font-mono text-ink-muted">
                  · {profile.organizations.name}
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-ink-faint">{user?.email || "No email bound"}</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoSelect}
            className="hidden"
          />
        </div>

        {/* Editable Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-ink-muted mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="Enter full name"
                className="w-full bg-base-raised border border-base-border rounded-lg px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-signal/50"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-ink-muted mb-1.5">
                Phone Number
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full bg-base-raised border border-base-border rounded-lg px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-signal/50 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-ink-muted mb-1.5">
                Account Role (Read-only)
              </label>
              <input
                type="text"
                value={ROLE_LABEL[profile?.role] || profile?.role || "User"}
                disabled
                className="w-full bg-base-raised/50 border border-base-border/50 rounded-lg px-3.5 py-2 text-sm text-ink-muted font-mono cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-ink-muted mb-1.5">
                Organization / Company (Read-only)
              </label>
              <input
                type="text"
                value={profile?.organizations?.name || "ORION Logistics Platform"}
                disabled
                className="w-full bg-base-raised/50 border border-base-border/50 rounded-lg px-3.5 py-2 text-sm text-ink-muted cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-muted mb-1.5">
              Avatar Image URL
            </label>
            <input
              type="text"
              value={photoUrl}
              onChange={(e) => {
                setPhotoUrl(e.target.value);
                setPreviewUrl(e.target.value);
              }}
              placeholder="https://..."
              className="w-full bg-base-raised border border-base-border rounded-lg px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-signal/50 font-mono text-xs"
            />
          </div>

          <div className="pt-4 border-t border-base-border flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="btn-secondary text-xs px-4 py-2.5"
            >
              {uploadingPhoto ? "Uploading Photo..." : "📷 Upload New Photo"}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary text-xs px-6 py-2.5 font-bold"
            >
              {saving ? "Saving Changes..." : "Save Profile Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
