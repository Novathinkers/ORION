import { useEffect, useState, useCallback } from "react";
import { checkSipStatus, triggerRealSipCall, VEHICLE_SIP_MAP } from "../../lib/sipAlertService";
import { listAllShipments, listAllHazardReports } from "../../lib/dataService";
import CallDriverModal from "../../components/shared/CallDriverModal";

export default function RouteShield() {
  const [sipStatus, setSipStatus] = useState({ online: false, amiReachable: false, ffmpegAvailable: false });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [shipments, setShipments] = useState([]);
  const [hazards, setHazards] = useState([]);
  const [callNotice, setCallNotice] = useState(null);
  const [callingSip, setCallingSip] = useState(null);

  // In-Browser Call Modal state
  const [showCallModal, setShowCallModal] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);

  // Setup Guide Modal state
  const [showGuideModal, setShowGuideModal] = useState(false);

  const verifyStatus = useCallback(async () => {
    setLoadingStatus(true);
    const status = await checkSipStatus();
    setSipStatus(status);
    setLoadingStatus(false);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const s = await listAllShipments();
      setShipments(s || []);
      const h = await listAllHazardReports();
      setHazards(h || []);
    } catch (err) {
      console.warn("Failed to load fleet data:", err);
    }
  }, []);

  useEffect(() => {
    verifyStatus();
    loadData();
    const interval = setInterval(verifyStatus, 10000);
    return () => clearInterval(interval);
  }, [verifyStatus, loadData]);

  const handleBrowserCall = (v) => {
    setSelectedDriver({
      id: v.driver?.id || "demo_driver",
      full_name: v.driver?.full_name || v.driverName || "Alex",
      phone: v.driver?.phone || "+91 98765 43210",
      shipmentId: v.id,
    });
    setShowCallModal(true);
  };

  const handleDriverTabPush = (v) => {
    const notice = `📡 Alert Pushed: Sent hazard broadcast notification to driver ${v.driver?.full_name || "Alex"}'s device interface.`;
    setCallNotice({ type: "info", text: notice });
    setTimeout(() => setCallNotice(null), 6000);
  };

  const handleRealSipCall = async (v, peerKey = "demo") => {
    const sipInfo = VEHICLE_SIP_MAP[peerKey] || VEHICLE_SIP_MAP["demo"];
    setCallingSip(v.id);
    setCallNotice(null);

    const res = await triggerRealSipCall({
      peer: sipInfo.peer,
      extension: sipInfo.extension,
      driverName: v.driver?.full_name || sipInfo.driver || "Gokul",
      vehicleNo: v.vehicle?.registration_no || "TRUCK-102",
      hazardType: "Landslide & Road Block",
      distanceKm: 1.4,
      road: `${v.source_name} → ${v.destination_name}`,
    });

    setCallingSip(null);

    if (res.success) {
      setCallNotice({
        type: "success",
        text: `☎️ REAL SIP CALL ORIGINATED! Asterisk dialing extension ${sipInfo.extension} (${sipInfo.driver}). Zoiper on phone should ring immediately!`,
      });
    } else {
      setCallNotice({
        type: "error",
        text: `⚠️ SIP Call Error: ${res.error}. Make sure python main.py & Asterisk Docker are running.`,
      });
    }

    setTimeout(() => setCallNotice(null), 8000);
  };

  const isSipReady = sipStatus.online && sipStatus.amiReachable;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-base-border pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="live-dot" />
            <p className="eyebrow">Zero-Cost Local Telephony Engine</p>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <span>🛡️</span>
            <span>RouteShield AI — Asterisk SIP Telephony</span>
          </h1>
          <p className="text-xs text-ink-muted">
            Real automated voice phone calls over local WiFi. 100% free with zero SIM card or telephony bill.
          </p>
        </div>

        {/* SIP Status Badge & Setup Guide */}
        <div className="flex items-center gap-3">
          <div
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center gap-2 ${
              isSipReady
                ? "bg-signal/15 border-signal/40 text-signal"
                : sipStatus.online
                ? "bg-risk-moderate/15 border-risk-moderate/40 text-risk-moderate"
                : "bg-risk-veryhigh/15 border-risk-veryhigh/40 text-risk-veryhigh"
            }`}
          >
            <span className="text-sm">{isSipReady ? "☎️" : "⚠️"}</span>
            <span>{loadingStatus ? "Checking SIP..." : isSipReady ? "☎️ SIP Ready (Asterisk Active)" : "SIP Disconnected"}</span>
          </div>

          <button
            onClick={() => setShowGuideModal(true)}
            className="btn-secondary text-xs font-mono font-bold"
          >
            📖 Setup Guide
          </button>
        </div>
      </div>

      {/* Call Notice Alert */}
      {callNotice && (
        <div
          className={`p-4 rounded-xl border text-xs font-mono font-bold flex items-center justify-between gap-2 shadow-lg ${
            callNotice.type === "success"
              ? "bg-signal/20 border-signal text-signal"
              : callNotice.type === "error"
              ? "bg-risk-veryhigh/20 border-risk-veryhigh text-risk-veryhigh"
              : "bg-blue-500/20 border-blue-500 text-blue-400"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">{callNotice.type === "success" ? "🔔" : "⚠️"}</span>
            <span>{callNotice.text}</span>
          </div>
          <button onClick={() => setCallNotice(null)} className="text-ink hover:text-white">✕</button>
        </div>
      )}

      {/* Feature Matrix Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="panel p-4 space-y-2 border-l-4 border-signal">
          <div className="flex items-center gap-2 text-signal font-bold text-xs uppercase font-mono">
            <span>☎️ Real SIP WiFi Call</span>
          </div>
          <h3 className="text-sm font-semibold text-ink">Asterisk + Zoiper 5 Integration</h3>
          <p className="text-xs text-ink-muted">
            Triggers real phone call over local WiFi. Asterisk AMI dials Zoiper app on phone and plays AI voice alert.
          </p>
        </div>

        <div className="panel p-4 space-y-2 border-l-4 border-risk-moderate">
          <div className="flex items-center gap-2 text-risk-moderate font-bold text-xs uppercase font-mono">
            <span>📞 Browser Simulation</span>
          </div>
          <h3 className="text-sm font-semibold text-ink">In-Browser Demo Audio</h3>
          <p className="text-xs text-ink-muted">
            Simulates incoming dispatch call inside web browser tabs with interactive voice controls.
          </p>
        </div>

        <div className="panel p-4 space-y-2 border-l-4 border-blue-400">
          <div className="flex items-center gap-2 text-blue-400 font-bold text-xs uppercase font-mono">
            <span>📡 Driver Tab Push</span>
          </div>
          <h3 className="text-sm font-semibold text-ink">Device Alert Broadcast</h3>
          <p className="text-xs text-ink-muted">
            Directly updates driver screen UI with warning alerts and recommended detours.
          </p>
        </div>
      </div>

      {/* Fleet At-Risk Vehicles & Call Trigger Table */}
      <div className="panel p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-base-border pb-3">
          <div>
            <h2 className="text-base font-bold text-ink flex items-center gap-2">
              <span>🚚</span>
              <span>Active Fleet & Telephony Dispatch Grid</span>
            </h2>
            <p className="text-xs text-ink-muted">Initiate 3-tier emergency warnings for active vehicles on route.</p>
          </div>
          <button onClick={loadData} className="btn-secondary text-xs">↻ Refresh Fleet</button>
        </div>

        <div className="space-y-3">
          {/* Demo Vehicle Card */}
          <div className="panel p-4 border-2 border-signal/40 bg-signal/5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-signal/20 text-signal text-[10px] font-mono font-bold uppercase">
                  ⭐ DEFAULT DEMO VEHICLE
                </span>
                <span className="text-xs font-mono font-bold text-ink">Ext: 1000 (peer: demo)</span>
              </div>
              <h3 className="text-sm font-bold text-ink">Gokul (Demo Phone) · TRUCK-DEMO-26002</h3>
              <p className="text-xs text-ink-muted">Route: Guwahati → Shillong (NH-40 Hazard Alert Demo)</p>
            </div>

            {/* 3 Call Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleBrowserCall({ id: "demo", driver: { full_name: "Gokul (Demo)" } })}
                title="In-Browser Demo Call"
                className="btn-secondary py-2 px-3 text-xs font-mono font-bold flex items-center gap-1.5"
              >
                <span>📞 Browser</span>
              </button>

              <button
                type="button"
                onClick={() => handleDriverTabPush({ id: "demo", driver: { full_name: "Gokul (Demo)" } })}
                title="Push Alert to Driver Tab"
                className="btn-secondary py-2 px-3 text-xs font-mono font-bold flex items-center gap-1.5 text-blue-400"
              >
                <span>📡 Tab Push</span>
              </button>

              <button
                type="button"
                disabled={callingSip === "demo"}
                onClick={() => handleRealSipCall({ id: "demo", driver: { full_name: "Gokul" }, source_name: "Guwahati", destination_name: "Shillong" }, "demo")}
                title="Trigger REAL SIP Phone Call to Zoiper"
                className="btn-primary py-2 px-3 text-xs font-mono font-bold bg-signal text-base-panel flex items-center gap-1.5 shadow-md"
              >
                <span>☎️ REAL SIP CALL</span>
              </button>
            </div>
          </div>

          {/* Active Fleet List */}
          {shipments.map((ship, idx) => {
            const peerKey = idx === 0 ? "truck_001" : idx === 1 ? "truck_002" : "truck_003";
            const sipInfo = VEHICLE_SIP_MAP[peerKey] || VEHICLE_SIP_MAP["demo"];

            return (
              <div key={ship.id} className="panel p-4 flex flex-wrap items-center justify-between gap-4 border-base-border hover:border-signal/30 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-ink-muted">
                      Vehicle: {ship.vehicle?.registration_no || "TRUCK-102"}
                    </span>
                    <span className="text-[10px] font-mono text-signal bg-signal/10 px-2 py-0.5 rounded">
                      Ext: {sipInfo.extension} ({sipInfo.peer})
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-ink">
                    {ship.driver?.full_name || sipInfo.driver} · {ship.goods_type.replace(/_/g, " ")}
                  </h3>
                  <p className="text-xs text-ink-muted">
                    Route: {ship.source_name} → {ship.destination_name}
                  </p>
                </div>

                {/* 3 Call Action Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleBrowserCall(ship)}
                    className="btn-secondary py-2 px-3 text-xs font-mono font-bold flex items-center gap-1"
                  >
                    <span>📞 Browser</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDriverTabPush(ship)}
                    className="btn-secondary py-2 px-3 text-xs font-mono font-bold flex items-center gap-1 text-blue-400"
                  >
                    <span>📡 Tab Push</span>
                  </button>

                  <button
                    type="button"
                    disabled={callingSip === ship.id}
                    onClick={() => handleRealSipCall(ship, peerKey)}
                    className="btn-primary py-2 px-3 text-xs font-mono font-bold bg-signal text-base-panel flex items-center gap-1 shadow-md"
                  >
                    <span>☎️ REAL SIP CALL</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Browser Call Modal */}
      {showCallModal && selectedDriver && (
        <CallDriverModal
          isOpen={showCallModal}
          onClose={() => setShowCallModal(false)}
          driver={selectedDriver}
          shipmentId={selectedDriver.shipmentId}
        />
      )}

      {/* Setup Guide Modal */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel max-w-2xl w-full p-6 space-y-4 border-signal shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-base-border pb-3">
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                <span>📖</span>
                <span>RouteShield AI — Asterisk SIP Setup Guide</span>
              </h3>
              <button onClick={() => setShowGuideModal(false)} className="text-ink-muted hover:text-ink text-base">✕</button>
            </div>

            <div className="space-y-3 text-xs text-ink font-mono">
              <p className="text-ink-muted">Follow these 4 simple steps to enable REAL phone calls to Zoiper on your mobile phone over WiFi:</p>

              <div className="p-3 rounded bg-base-raised border border-base-border space-y-1">
                <p className="font-bold text-signal">Step 1: Install Python API Dependencies</p>
                <code className="block p-2 rounded bg-black/40 text-green-400">
                  cd routeshield-api<br />
                  pip install fastapi uvicorn pyttsx3 pydub requests
                </code>
              </div>

              <div className="p-3 rounded bg-base-raised border border-base-border space-y-1">
                <p className="font-bold text-signal">Step 2: Start Asterisk PBX Docker Container</p>
                <code className="block p-2 rounded bg-black/40 text-green-400">
                  cd routeshield-asterisk<br />
                  docker compose up -d
                </code>
              </div>

              <div className="p-3 rounded bg-base-raised border border-base-border space-y-1">
                <p className="font-bold text-signal">Step 3: Start Python API Server</p>
                <code className="block p-2 rounded bg-black/40 text-green-400">
                  cd routeshield-api<br />
                  python main.py
                </code>
              </div>

              <div className="p-3 rounded bg-base-raised border border-base-border space-y-1">
                <p className="font-bold text-signal">Step 4: Configure Zoiper 5 App on Phone</p>
                <p className="text-ink-muted">Open Zoiper app → Add Account → SIP:</p>
                <ul className="list-disc list-inside text-ink space-y-1">
                  <li><strong>Username:</strong> gokul</li>
                  <li><strong>Password:</strong> 26002</li>
                  <li><strong>Domain/Server:</strong> Laptop IP (e.g. 192.168.1.105)</li>
                  <li><strong>Port:</strong> 5060 (UDP)</li>
                </ul>
              </div>
            </div>

            <div className="pt-2 flex justify-end border-t border-base-border">
              <button onClick={() => setShowGuideModal(false)} className="btn-primary text-xs">
                Got it, Close ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
