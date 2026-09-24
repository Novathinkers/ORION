import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { useDriverHeartbeat } from "../../hooks/useDriverHeartbeat";
import LanguageSwitcher from "../shared/LanguageSwitcher";
import ThemeToggle from "../shared/ThemeToggle";

const NAV = {
  primary: [
    { to: "/primary", key: "nav.overview", end: true },
    { to: "/primary/inactivity", label: "📡 Inactivity Alerts" },
    { to: "/primary/routeshield", label: "🛡️ RouteShield AI" },
    { to: "/primary/sos", label: "🚨 SOS Emergency Center" },
    { to: "/primary/shipments", key: "nav.shipments" },
    { to: "/primary/shipments/new", key: "nav.newShipment" },
    { to: "/primary/fleet", key: "nav.fleet" },
    { to: "/primary/alerts", key: "nav.alerts" },
    { to: "/primary/hazard-reports", key: "nav.hazardReports" },
  ],
  secondary: [
    { to: "/driver", key: "nav.myJourney", end: true },
    { to: "/driver/report-hazard", key: "nav.reportHazard" },
    { to: "/driver/hazard-reports", key: "nav.hazardReports" },
  ],
  admin: [
    { to: "/admin", key: "nav.commandCenter", end: true },
    { to: "/admin/inactivity", label: "📡 Inactivity Alerts" },
    { to: "/admin/routeshield", label: "🛡️ RouteShield AI" },
    { to: "/admin/sos", label: "🚨 SOS Emergency Center" },
    { to: "/admin/map", key: "nav.liveMap" },
    { to: "/admin/users", key: "nav.userManagement" },
    { to: "/admin/alerts", key: "nav.alertsIncidents" },
    { to: "/admin/hazard-reports", key: "nav.hazardReports" },
  ],
};

const ROLE_LABEL = { primary: "Transport Manager", secondary: "Driver", admin: "System Administrator" };

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-xs text-ink-muted tabular-nums">
      {now.toLocaleTimeString("en-IN", { hour12: false })} IST
    </span>
  );
}

export default function AppShell({ children }) {
  const { profile, role, signOut } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const items = NAV[role] || [];
  const [online, setOnline] = useState(navigator.onLine);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Global heartbeat tracking for logged in drivers
  useDriverHeartbeat();

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const handleSignOut = async () => {
    setMobileMenuOpen(false);
    await signOut();
    navigate("/login");
  };

  const SidebarContent = (
    <div className="flex flex-col h-full bg-base-panel">
      <div className="px-5 py-5 border-b border-base-border flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="live-dot" />
            <span className="font-display font-semibold text-sm tracking-tight">ORION</span>
          </div>
          <p className="eyebrow mt-1">Accessibility Intelligence</p>
        </div>
        <button
          onClick={() => setMobileMenuOpen(false)}
          className="md:hidden text-ink-muted hover:text-ink text-lg p-1"
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileMenuOpen(false)}
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-signal/10 text-signal border border-signal/30"
                  : "text-ink-muted hover:text-ink hover:bg-base-raised border border-transparent"
              }`
            }
          >
            {item.label || t(item.key)}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-base-border space-y-2">
        <NavLink
          to="/profile"
          onClick={() => setMobileMenuOpen(false)}
          className="flex items-center gap-3 p-2 rounded-lg bg-base-raised/60 border border-base-border/70 hover:border-signal/40 transition-all group"
        >
          <div className="h-8 w-8 rounded-full overflow-hidden bg-base-border border border-base-border flex items-center justify-center shrink-0">
            {profile?.photo_url ? (
              <img src={profile.photo_url} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm">👤</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink truncate group-hover:text-signal">{profile?.full_name || "User"}</p>
            <p className="text-[10px] text-ink-faint">{ROLE_LABEL[role]}</p>
          </div>
        </NavLink>

        <div className="grid grid-cols-2 gap-2">
          <NavLink
            to="/profile"
            onClick={() => setMobileMenuOpen(false)}
            className="btn-secondary text-[11px] py-1.5 text-center"
          >
            👤 Profile
          </NavLink>
          <button onClick={handleSignOut} className="btn-secondary text-[11px] py-1.5">
            {t("common.signOut")}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-base text-ink">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-base-border bg-base-panel flex-col transition-colors duration-200">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop & Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[80vw] z-50 h-full shadow-2xl">
            {SidebarContent}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-base-border bg-base-panel/80 backdrop-blur flex items-center justify-between px-3 md:px-6 shrink-0 transition-colors duration-200">
          <div className="flex items-center gap-2 md:gap-3">
            {/* Mobile Hamburger Toggle Button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 rounded-lg border border-base-border bg-base-raised text-ink hover:text-signal transition-colors text-base"
              aria-label="Open Navigation Menu"
            >
              ☰
            </button>

            <span
              className={`inline-flex items-center gap-1.5 text-[11px] md:text-xs font-mono ${online ? "text-risk-low" : "text-risk-veryhigh"}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              <span className="hidden sm:inline">{online ? "SYSTEM ONLINE" : "OFFLINE"}</span>
              <span className="sm:hidden">{online ? "ONLINE" : "OFFLINE"}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
            <ThemeToggle />
            <LanguageSwitcher />
            <div className="hidden sm:block">
              <Clock />
            </div>
            <NavLink
              to="/profile"
              className="flex items-center gap-2 px-2 py-1 rounded-full border border-base-border bg-base-raised/60 text-xs font-medium hover:border-signal/40 transition-colors"
            >
              <div className="h-6 w-6 rounded-full overflow-hidden bg-base-border flex items-center justify-center shrink-0">
                {profile?.photo_url ? (
                  <img src={profile.photo_url} alt="User" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs">👤</span>
                )}
              </div>
              <span className="hidden md:inline text-ink">{profile?.full_name || "Profile"}</span>
            </NavLink>
          </div>
        </header>

        {/* Page Main Content with responsive padding */}
        <main className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
