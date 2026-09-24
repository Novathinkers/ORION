import { useState, useRef, useEffect } from "react";
import { useSOS } from "../../hooks/useSOS";

const EMERGENCY_TYPES = [
  { value: "Landslide", label: "🏔 Landslide / Rockfall", icon: "🏔" },
  { value: "Flood", label: "🌊 Flood / Submerged Road", icon: "🌊" },
  { value: "Road Blocked", label: "🚧 Road Blocked / Tree Fall", icon: "🚧" },
  { value: "Accident", label: "💥 Vehicle Accident", icon: "💥" },
  { value: "Vehicle Breakdown", label: "🔧 Vehicle Breakdown", icon: "🔧" },
  { value: "Medical Emergency", label: "🚑 Medical Emergency", icon: "🚑" },
  { value: "Other Emergency", label: "⚠️ Other Danger / Emergency", icon: "⚠️" },
];

export default function SOSButton({ shipment = null, vehicle = null, compact = false }) {
  const { triggerSOS, triggerQuickSOS, sosStatus, isOffline, connectionStatus, syncNotice } = useSOS();

  const [holdProgress, setHoldProgress] = useState(0); // 0 to 100
  const [selectedType, setSelectedType] = useState("Other Emergency");
  const [customNotes, setCustomNotes] = useState("");
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [activatedNotice, setActivatedNotice] = useState(false);

  const holdTimerRef = useRef(null);
  const startTimeRef = useRef(null);

  const startHold = () => {
    setHoldProgress(0);
    startTimeRef.current = Date.now();

    // Trigger haptic vibration if supported
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(80);
    }

    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const progress = Math.min(100, Math.floor((elapsed / 3000) * 100));
      setHoldProgress(progress);

      if (progress >= 100) {
        clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;

        // Final vibration feedback
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([100, 50, 100, 50, 200]);
        }

        executeTrigger();
      }
    }, 40);
  };

  const cancelHold = () => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldProgress(0);
  };

  const executeTrigger = async () => {
    setActivatedNotice(true);
    await triggerSOS({
      emergencyType: selectedType,
      message: customNotes || `🚨 EMERGENCY ALERT: ${selectedType} reported by driver`,
      shipment,
      vehicle,
    });
    setShowTypeModal(false);
    setTimeout(() => setActivatedNotice(false), 5000);
  };

  const handleQuickSOSClick = async () => {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
    setActivatedNotice(true);
    await triggerQuickSOS({ shipment, vehicle });
    setTimeout(() => setActivatedNotice(false), 5000);
  };

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    };
  }, []);

  return (
    <div className="space-y-3">
      {/* Network Connectivity Emergency Banner */}
      {isOffline && (
        <div className="p-3 rounded-lg border border-risk-veryhigh/60 bg-risk-veryhigh/10 text-risk-veryhigh text-xs font-mono font-bold flex items-center justify-between gap-2 shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-base animate-pulse">⚠️</span>
            <span>Internet connection lost. Offline emergency mode is active.</span>
          </div>
          <span className="px-2 py-0.5 rounded bg-risk-veryhigh/20 uppercase text-[10px]">OFFLINE SOS</span>
        </div>
      )}

      {syncNotice && (
        <div className="p-3 rounded-lg border border-signal/50 bg-signal/15 text-signal text-xs font-mono font-bold flex items-center gap-2">
          <span>⚡</span>
          <span>{syncNotice}</span>
        </div>
      )}

      {/* Main SOS Trigger Card */}
      <div className={`panel p-4 space-y-3 border-2 ${isOffline ? "border-risk-veryhigh shadow-2xl bg-base-panel/90" : "border-risk-veryhigh/40"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🚨</span>
            <div>
              <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                <span>{isOffline ? "OFFLINE EMERGENCY MODE" : "EMERGENCY SOS SYSTEM"}</span>
              </h3>
              <p className="text-[11px] text-ink-muted font-mono">
                {isOffline ? "No internet connection detected — Satellite & Offline Queue active." : "Direct Realtime Emergency Alert to ORION Command Center."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowTypeModal(true)}
            className="text-xs text-signal hover:underline font-mono font-bold"
          >
            Type: {selectedType} ✏️
          </button>
        </div>

        {/* 3-Second Hold SOS Button */}
        <div className="relative pt-2">
          <button
            type="button"
            onMouseDown={startHold}
            onMouseUp={cancelHold}
            onMouseLeave={cancelHold}
            onTouchStart={startHold}
            onTouchEnd={cancelHold}
            className={`w-full py-4 rounded-xl font-bold uppercase tracking-wider text-sm transition-all select-none shadow-xl flex flex-col items-center justify-center gap-1 cursor-pointer overflow-hidden ${
              activatedNotice
                ? "bg-signal text-base-panel"
                : holdProgress > 0
                ? "bg-risk-veryhigh text-white"
                : "bg-risk-veryhigh/90 hover:bg-risk-veryhigh text-white active:scale-[0.99]"
            }`}
          >
            {/* Progress Fill Background Overlay */}
            {holdProgress > 0 && (
              <div
                className="absolute inset-0 bg-risk-critical transition-all duration-75 ease-linear opacity-80"
                style={{ width: `${holdProgress}%` }}
              />
            )}

            <div className="relative z-10 flex items-center gap-2 text-base">
              <span>🆘</span>
              <span>
                {activatedNotice
                  ? "🚨 SOS ACTIVATED & BROADCASTED!"
                  : holdProgress > 0
                  ? `HOLD SOS (${holdProgress}%)`
                  : "HOLD SOS FOR 3 SECONDS"}
              </span>
            </div>

            <p className="relative z-10 text-[10px] font-mono opacity-90">
              {holdProgress > 0 ? "Keep holding..." : "Press and hold for 3 sec to prevent accidental triggers"}
            </p>
          </button>
        </div>

        {/* Quick SOS Option */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-base-border">
          <p className="text-[11px] text-ink-muted">Need instant alert without choosing type?</p>
          <button
            type="button"
            onClick={handleQuickSOSClick}
            className="px-3 py-1.5 rounded-lg bg-risk-high/20 hover:bg-risk-high/30 text-risk-high text-xs font-bold font-mono tracking-wide border border-risk-high/40 shrink-0"
          >
            ⚡ QUICK SOS (INSTANT)
          </button>
        </div>
      </div>

      {/* Emergency Type & Details Selection Modal */}
      {showTypeModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel max-w-md w-full p-6 space-y-4 border-risk-veryhigh/50 shadow-2xl">
            <div className="flex items-center justify-between border-b border-base-border pb-3">
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                <span>🚨</span>
                <span>Select Emergency Type</span>
              </h3>
              <button onClick={() => setShowTypeModal(false)} className="text-ink-muted hover:text-ink text-base">✕</button>
            </div>

            <p className="text-xs text-ink-muted">Choose the category of emergency encountered on your route:</p>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {EMERGENCY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setSelectedType(t.value)}
                  className={`w-full p-3 rounded-lg border text-left transition-colors flex items-center justify-between text-xs font-semibold ${
                    selectedType === t.value
                      ? "border-risk-veryhigh bg-risk-veryhigh/15 text-ink"
                      : "border-base-border hover:bg-base-raised text-ink-muted"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base">{t.icon}</span>
                    <span>{t.label}</span>
                  </span>
                  {selectedType === t.value && <span className="text-risk-veryhigh font-bold">✓ Selected</span>}
                </button>
              ))}
            </div>

            <div>
              <label className="label text-xs">Optional Description / Landmark</label>
              <textarea
                rows={2}
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                placeholder="e.g. Near Km 42 bridge, road blocked by landslide..."
                className="input text-xs"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowTypeModal(false)} className="btn-secondary flex-1 text-xs">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTypeModal(false);
                }}
                className="btn-primary flex-1 font-bold text-xs bg-risk-veryhigh text-white"
              >
                Save Choice ✓
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
