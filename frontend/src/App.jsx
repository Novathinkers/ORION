import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { MapProvider } from "./components/maps/MapProvider";
import { LanguageProvider } from "./contexts/LanguageContext";
import ProtectedRoute from "./components/ProtectedRoute";
import AppShell from "./components/layout/AppShell";

import Login from "./pages/auth/Login";
import SignupPrimary from "./pages/auth/SignupPrimary";
import SignupDriver from "./pages/auth/SignupDriver";
import RoleRedirect from "./pages/auth/RoleRedirect";

import PrimaryDashboard from "./pages/primary/Dashboard";
import CreateShipment from "./pages/primary/CreateShipment";
import Shipments from "./pages/primary/Shipments";
import ShipmentDetail from "./pages/primary/ShipmentDetail";
import Fleet from "./pages/primary/Fleet";
import PrimaryAlerts from "./pages/primary/Alerts";

import DriverDashboard from "./pages/driver/Dashboard";
import ReportHazard from "./pages/driver/ReportHazard";

import AdminDashboard from "./pages/admin/Dashboard";
import LiveMap from "./pages/admin/LiveMap";
import UserManagement from "./pages/admin/UserManagement";
import AdminAlerts from "./pages/admin/AdminAlerts";
import HazardReports from "./pages/admin/HazardReports";
import SOSEmergencyCenter from "./pages/admin/SOSEmergencyCenter";
import RouteShield from "./pages/admin/RouteShield";
import InactivityAlertCenter from "./pages/admin/InactivityAlertCenter";
import UserProfile from "./pages/shared/UserProfile";
import PublicNavigation from "./pages/shared/PublicNavigation";

function Shell({ children }) {
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <LanguageProvider>
          <MapProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/signup/primary" element={<SignupPrimary />} />
                <Route path="/signup/driver" element={<SignupDriver />} />
                <Route path="/navigate" element={<PublicNavigation />} />
                <Route path="/public-navigation" element={<PublicNavigation />} />
                <Route path="/routeshield" element={<ProtectedRoute allow={["primary", "admin"]}><Shell><RouteShield /></Shell></ProtectedRoute>} />
                <Route path="/redirect" element={<RoleRedirect />} />
                <Route path="/" element={<RoleRedirect />} />

                {/* Profile & Logged-In Navigation Routes */}
                <Route path="/profile" element={<ProtectedRoute allow={["primary", "secondary", "admin"]}><Shell><UserProfile /></Shell></ProtectedRoute>} />
                <Route path="/navigation" element={<ProtectedRoute allow={["primary", "secondary", "admin"]}><Shell><PublicNavigation /></Shell></ProtectedRoute>} />

                {/* Primary User / Transport Manager */}
                <Route path="/primary" element={<ProtectedRoute allow={["primary"]}><Shell><PrimaryDashboard /></Shell></ProtectedRoute>} />
                <Route path="/primary/inactivity" element={<ProtectedRoute allow={["primary"]}><Shell><InactivityAlertCenter /></Shell></ProtectedRoute>} />
                <Route path="/primary/routeshield" element={<ProtectedRoute allow={["primary"]}><Shell><RouteShield /></Shell></ProtectedRoute>} />
                <Route path="/primary/sos" element={<ProtectedRoute allow={["primary"]}><Shell><SOSEmergencyCenter /></Shell></ProtectedRoute>} />
                <Route path="/primary/navigation" element={<ProtectedRoute allow={["primary"]}><Shell><PublicNavigation /></Shell></ProtectedRoute>} />
                <Route path="/primary/shipments" element={<ProtectedRoute allow={["primary"]}><Shell><Shipments /></Shell></ProtectedRoute>} />
                <Route path="/primary/shipments/new" element={<ProtectedRoute allow={["primary"]}><Shell><CreateShipment /></Shell></ProtectedRoute>} />
                <Route path="/primary/shipments/:id" element={<ProtectedRoute allow={["primary", "admin"]}><Shell><ShipmentDetail /></Shell></ProtectedRoute>} />
                <Route path="/primary/fleet" element={<ProtectedRoute allow={["primary"]}><Shell><Fleet /></Shell></ProtectedRoute>} />
                <Route path="/primary/alerts" element={<ProtectedRoute allow={["primary"]}><Shell><PrimaryAlerts /></Shell></ProtectedRoute>} />
                <Route path="/primary/hazard-reports" element={<ProtectedRoute allow={["primary"]}><Shell><HazardReports /></Shell></ProtectedRoute>} />

                {/* Secondary User / Driver */}
                <Route path="/driver" element={<ProtectedRoute allow={["secondary"]}><Shell><DriverDashboard /></Shell></ProtectedRoute>} />
                <Route path="/driver/navigation" element={<ProtectedRoute allow={["secondary"]}><Shell><PublicNavigation /></Shell></ProtectedRoute>} />
                <Route path="/driver/report-hazard" element={<ProtectedRoute allow={["secondary"]}><Shell><ReportHazard /></Shell></ProtectedRoute>} />
                <Route path="/driver/hazard-reports" element={<ProtectedRoute allow={["secondary"]}><Shell><HazardReports /></Shell></ProtectedRoute>} />

                {/* Admin */}
                <Route path="/admin" element={<ProtectedRoute allow={["admin"]}><Shell><AdminDashboard /></Shell></ProtectedRoute>} />
                <Route path="/admin/inactivity" element={<ProtectedRoute allow={["admin"]}><Shell><InactivityAlertCenter /></Shell></ProtectedRoute>} />
                <Route path="/admin/routeshield" element={<ProtectedRoute allow={["admin"]}><Shell><RouteShield /></Shell></ProtectedRoute>} />
                <Route path="/admin/sos" element={<ProtectedRoute allow={["admin"]}><Shell><SOSEmergencyCenter /></Shell></ProtectedRoute>} />
                <Route path="/admin/navigation" element={<ProtectedRoute allow={["admin"]}><Shell><PublicNavigation /></Shell></ProtectedRoute>} />
                <Route path="/admin/map" element={<ProtectedRoute allow={["admin"]}><Shell><LiveMap /></Shell></ProtectedRoute>} />
                <Route path="/admin/users" element={<ProtectedRoute allow={["admin"]}><Shell><UserManagement /></Shell></ProtectedRoute>} />
                <Route path="/admin/alerts" element={<ProtectedRoute allow={["admin"]}><Shell><AdminAlerts /></Shell></ProtectedRoute>} />
                <Route path="/admin/hazard-reports" element={<ProtectedRoute allow={["admin"]}><Shell><HazardReports /></Shell></ProtectedRoute>} />

                <Route path="*" element={<RoleRedirect />} />
              </Routes>
            </BrowserRouter>
          </MapProvider>
        </LanguageProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
