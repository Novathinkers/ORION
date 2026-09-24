import { useEffect, useState } from "react";
import { callDriver } from "../../lib/callService";
import { useLanguage } from "../../contexts/LanguageContext";
import { LANGUAGES } from "../../lib/i18n";

/**
 * Trigger the call and show the result. Used both:
 *  - on the dispatcher/admin side, to notify a driver (fires the call, shows status)
 *  - could be reused driver-side for an "incoming call" style banner
 */
export default function CallDriverModal({ shipmentId, driver, initiatedBy, reason, detail, onClose }) {
  const { t } = useLanguage();
  const [state, setState] = useState("ringing"); // ringing | connected | failed
  const [result, setResult] = useState(null);
  const [language, setLanguage] = useState(driver?.preferred_language || "en");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await callDriver({ shipmentId, driver: { ...driver, preferred_language: language }, initiatedBy, reason, detail });
        if (!cancelled) {
          setResult(r);
          setState("connected");
        }
      } catch {
        if (!cancelled) setState("failed");
      }
    }, 1400); // brief "ringing" delay for realism
    return () => { cancelled = true; clearTimeout(timer); };
  }, [shipmentId, driver, initiatedBy, reason, detail, language]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4">
      <div className="panel w-full max-w-sm p-6 text-center">
        <p className="eyebrow mb-1">{t("call.incoming")}</p>
        <h2 className="text-lg font-display font-semibold mb-1">{driver?.full_name || "Driver"}</h2>
        <p className="text-xs text-ink-faint mb-4">{t("call.from")}</p>

        {state === "ringing" && (
          <div className="py-4">
            <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-signal/15 border border-signal/40 flex items-center justify-center animate-pulse-ring">
              <span className="text-signal text-xl">📞</span>
            </div>
            <p className="text-sm text-ink-muted">{t("call.ringing")}</p>
          </div>
        )}

        {state === "connected" && result && (
          <div className="py-2 text-left space-y-3">
            <div className="rounded-lg border border-base-border bg-base-raised p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">
                {result.source === "real" ? "Live call placed" : "Simulated message"}
              </p>
              <p className="text-sm text-ink">{result.message}</p>
            </div>
            {result.source !== "real" && (
              <p className="text-[11px] text-ink-faint">{t("call.simulateNote")}</p>
            )}
          </div>
        )}

        {state === "failed" && (
          <p className="text-sm text-risk-veryhigh py-4">Could not place or log this call.</p>
        )}

        <div className="mt-5 flex items-center justify-center gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={state !== "ringing"}
            className="bg-base-raised border border-base-border rounded-md text-xs font-mono px-2 py-1 text-ink-muted"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.nativeLabel}</option>
            ))}
          </select>
        </div>

        <button onClick={onClose} className="btn-secondary w-full mt-4">
          {state === "ringing" ? t("call.decline") : "Close"}
        </button>
      </div>
    </div>
  );
}
