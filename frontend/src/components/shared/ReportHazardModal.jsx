import { useEffect, useState, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { useGeolocation } from "../../hooks/useGeolocation";
import { analyzeHazardImage, uploadHazardImage, uploadHazardAudio } from "../../lib/imageAnalysisService";
import { reportHazard } from "../../lib/dataService";

const SEVERITY_COLOR = {
  LOW: "text-risk-low",
  MODERATE: "text-risk-moderate",
  HIGH: "text-risk-high",
  CRITICAL: "text-risk-critical",
  low: "text-risk-low",
  moderate: "text-risk-moderate",
  high: "text-risk-high",
  very_high: "text-risk-veryhigh",
  critical: "text-risk-critical",
};

export default function ReportHazardModal({ isOpen, onClose, defaultPos = null, onSuccess }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const geo = useGeolocation({ onUpdate: () => {} });

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [description, setDescription] = useState("");
  const [userPos, setUserPos] = useState(defaultPos);
  const [gpsLoading, setGpsLoading] = useState(!defaultPos);

  // Camera stream state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Audio / Voice Recording state & Timer
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioPlayerRef = useRef(null);

  // File input refs
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [audioUploadError, setAudioUploadError] = useState("");

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const stopAudioTracks = () => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
  };

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopRecordingVoice = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    clearTimer();
  };

  const deleteRecording = () => {
    stopRecordingVoice();
    clearTimer();
    stopAudioTracks();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordSeconds(0);
    setAudioPlaying(false);
  };

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      stopAudioTracks();
      clearTimer();
      setFile(null);
      setPreviewUrl(null);
      setDescription("");
      setAnalysis(null);
      setSubmitted(false);
      setError("");
      deleteRecording();
    } else {
      if (defaultPos) {
        setUserPos(defaultPos);
        setGpsLoading(false);
      } else {
        geo
          .requestOnce()
          .then((pos) => {
            setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            setGpsLoading(false);
          })
          .catch(() => {
            setUserPos({ lat: 26.1445, lng: 91.7362 });
            setGpsLoading(false);
          });
      }
    }
  }, [isOpen]); // eslint-disable-line

  if (!isOpen) return null;

  const startLiveCamera = async () => {
    setCameraError("");
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (cameraInputRef.current) cameraInputRef.current.click();
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setCameraError("Live camera access unavailable. Triggering device camera...");
      if (cameraInputRef.current) cameraInputRef.current.click();
    }
  };

  const snapPhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const capturedFile = new File([blob], `hazard_${Date.now()}.jpg`, { type: "image/jpeg" });
            setFile(capturedFile);
            setPreviewUrl(URL.createObjectURL(blob));
            setAnalysis(null);
            setSubmitted(false);
            stopCamera();
          }
        },
        "image/jpeg",
        0.88
      );
    }
  };

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setAnalysis(null);
    setSubmitted(false);
    stopCamera();
  };

  // Voice recording handlers
  const startRecordingVoice = async () => {
    setError("");
    setAudioUploadError("");
    deleteRecording();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("🎙 Microphone access is not supported in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const options = MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        clearTimer();
        stopAudioTracks();

        const blobType = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: blobType });

        if (blob.size > 0) {
          setAudioBlob(blob);
          setAudioUrl(URL.createObjectURL(blob));
        } else {
          setError("❌ Recording yielded no audio data. Please try again.");
        }
        setRecording(false);
      };

      mediaRecorder.start(250);
      setRecording(true);
      setRecordSeconds(0);

      clearTimer();
      timerRef.current = setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setError("🎙 Microphone access is required to record a voice report: " + err.message);
    }
  };



  const toggleAudioPlayback = () => {
    if (!audioPlayerRef.current) return;
    if (audioPlaying) {
      audioPlayerRef.current.pause();
      setAudioPlaying(false);
    } else {
      audioPlayerRef.current.play();
      setAudioPlaying(true);
    }
  };

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const runAnalysis = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError("");
    try {
      const result = await analyzeHazardImage(file);
      setAnalysis(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const submitReport = async () => {
    if (!file || !analysis) return;
    setSubmitting(true);
    setError("");
    setAudioUploadError("");

    try {
      let imageUrl = null;
      try {
        imageUrl = await uploadHazardImage(file, { userId: user?.id || "guest" });
      } catch {
        imageUrl = previewUrl;
      }

      let voiceUrl = null;
      if (audioBlob && audioBlob.size > 0) {
        try {
          voiceUrl = await uploadHazardAudio(audioBlob, { userId: user?.id || "guest" });
        } catch (err) {
          setAudioUploadError(err.message || "Voice recording upload failed.");
          setSubmitting(false);
          return;
        }
      }

      await reportHazard({
        reportedBy: user?.id || "guest_public",
        lat: userPos?.lat ?? 26.1445,
        lng: userPos?.lng ?? 91.7362,
        imageUrl,
        voiceUrl,
        aiAnalysis: {
          ...analysis,
          voice_duration_seconds: recordSeconds,
          driver_description: description.trim(),
        },
      });

      setSubmitted(true);
      onSuccess?.();
    } catch (err) {
      setError(err.message || "Failed to submit hazard report.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="panel max-w-lg w-full p-5 space-y-4 border-risk-veryhigh/40 shadow-2xl my-8">
        <div className="flex items-center justify-between border-b border-base-border pb-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2 text-ink">
              <span>⚠️</span>
              <span>Report Road Hazard (AI Vision & Voice)</span>
            </h2>
            <p className="text-xs text-ink-muted">Upload or capture photo evidence to analyze and broadcast hazard alerts.</p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink font-mono text-base p-1"
          >
            ✕
          </button>
        </div>

        {/* GPS Capture Indicator */}
        <div className="rounded-lg border border-base-border bg-base-raised p-2.5 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${userPos ? "bg-risk-low" : "bg-risk-moderate animate-pulse"}`} />
            <span className="text-ink-muted">
              {gpsLoading
                ? "Capturing current GPS location..."
                : userPos
                ? `GPS Location Tagged: ${userPos.lat.toFixed(4)}°N, ${userPos.lng.toFixed(4)}°E`
                : "GPS Unavailable"}
            </span>
          </div>
        </div>

        {/* Hidden File Inputs */}
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="hidden" />
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />

        {/* Capture Buttons */}
        {!cameraActive && (
          <div className="space-y-1.5">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-ink-muted">
              1. Photo Evidence (Required for AI Scan)
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={startLiveCamera}
                className="btn-secondary py-2.5 flex items-center justify-center gap-2 text-xs border-signal/40 text-signal bg-signal/5 hover:bg-signal/15 font-semibold"
              >
                <span>📷</span> Take Photo
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary py-2.5 flex items-center justify-center gap-2 text-xs font-semibold"
              >
                <span>📁</span> Upload Image
              </button>
            </div>
            {cameraError && <p className="text-[10px] text-risk-moderate">{cameraError}</p>}
          </div>
        )}

        {/* Live Camera Viewfinder */}
        {cameraActive && (
          <div className="space-y-3 rounded-lg border border-signal/40 bg-black p-3 text-center">
            <div className="relative w-full rounded-md overflow-hidden bg-black max-h-60 flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline className="w-full max-h-60 object-cover rounded-md" />
            </div>
            <div className="flex items-center justify-center gap-3">
              <button type="button" onClick={snapPhoto} className="btn-primary px-5 py-2 text-xs font-bold">
                📸 Snap Photo
              </button>
              <button type="button" onClick={stopCamera} className="btn-secondary px-4 py-2 text-xs">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Preview of Snapped/Selected Image */}
        {previewUrl && !cameraActive && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-[10px] uppercase text-ink-muted">Photo Preview</span>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setPreviewUrl(null);
                  setAnalysis(null);
                }}
                className="text-risk-veryhigh hover:underline font-mono text-[10px]"
              >
                Remove / Retake
              </button>
            </div>
            <img src={previewUrl} alt="Hazard preview" className="w-full max-h-56 object-cover rounded-lg border border-base-border" />
          </div>
        )}

        {/* Voice Report Section */}
        <div className="space-y-2 pt-2 border-t border-base-border">
          <div className="flex items-center justify-between">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-ink-muted">
              2. Voice Report (Optional Audio Evidence)
            </label>
          </div>

          <div className="p-3 rounded-lg border border-base-border bg-base-raised/70 text-xs">
            {recording ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-risk-critical animate-ping" />
                  <div>
                    <p className="font-bold text-risk-critical font-mono uppercase">● Recording Voice...</p>
                    <p className="text-base font-mono font-bold text-ink">{formatTimer(recordSeconds)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={stopRecordingVoice}
                  className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1 shadow-sm"
                >
                  <span>⏹</span> Stop Recording
                </button>
              </div>
            ) : audioUrl ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-signal flex items-center gap-1">
                    <span>🎙</span> Audio Ready ({formatTimer(recordSeconds)})
                  </span>
                  <span className="text-[9px] font-mono text-risk-low bg-risk-low/10 px-2 py-0.5 rounded border border-risk-low/30">
                    Audio Recorded
                  </span>
                </div>

                <audio ref={audioPlayerRef} src={audioUrl} onEnded={() => setAudioPlaying(false)} className="hidden" />

                <div className="flex items-center gap-2">
                  <button type="button" onClick={toggleAudioPlayback} className="btn-primary text-xs px-3 py-1">
                    {audioPlaying ? "❚❚ Pause" : "▶ Play Preview"}
                  </button>
                  <button type="button" onClick={startRecordingVoice} className="btn-secondary text-xs px-2.5 py-1">
                    Re-record
                  </button>
                  <button type="button" onClick={deleteRecording} className="btn-secondary text-xs px-2.5 py-1 text-risk-veryhigh border-risk-veryhigh/30">
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">Record Audio Note</p>
                  <p className="text-[10px] text-ink-faint">Speak blockage details or detour hazards.</p>
                </div>
                <button
                  type="button"
                  onClick={startRecordingVoice}
                  className="btn-secondary text-xs px-3 py-1.5 border-signal/40 text-signal bg-signal/5 hover:bg-signal/15 flex items-center gap-1 font-semibold shrink-0"
                >
                  <span>🎙</span> Record Audio
                </button>
              </div>
            )}
          </div>

          {audioUploadError && <p className="text-xs text-risk-critical font-mono">{audioUploadError}</p>}
        </div>

        {/* Text Notes */}
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-1">
            3. Hazard Description / Notes
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Type any additional road hazard details..."
            className="w-full rounded-md border border-base-border bg-base-raised px-3 py-1.5 text-xs text-ink focus:outline-none focus:border-signal/50"
          />
        </div>

        {/* Analyze Button */}
        {file && !analysis && (
          <button onClick={runAnalysis} disabled={analyzing} className="btn-primary w-full text-xs py-2.5 font-bold uppercase tracking-wider">
            {analyzing ? t("hazard.analyzing") : `🧠 Analyze Hazard Photo (AI Scan)`}
          </button>
        )}

        {/* AI Analysis Result & Submission */}
        {analysis && !submitted && (
          <div className="space-y-3 pt-2 border-t border-base-border">
            <p className="eyebrow text-signal">AI Hazard Classification Result</p>
            <div className="rounded-lg border border-base-border bg-base-raised p-3 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">Detected Hazard:</span>
                <span className="font-bold text-ink capitalize">
                  {analysis.hazard || (analysis.category && analysis.category.replace(/_/g, " "))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">Severity Risk:</span>
                <span className={`font-bold uppercase ${SEVERITY_COLOR[analysis.severity] || "text-risk-high"}`}>
                  {analysis.severity}
                </span>
              </div>
              {analysis.recommended_action && (
                <div className="pt-1 border-t border-base-border/50 text-[11px]">
                  <span className="text-ink-muted font-bold">Action: </span>
                  <span className="text-ink">{analysis.recommended_action}</span>
                </div>
              )}
            </div>

            <button onClick={submitReport} disabled={submitting} className="btn-primary w-full text-xs py-2.5 font-bold uppercase tracking-wider bg-risk-veryhigh">
              {submitting ? "Uploading Evidence & Submitting..." : t("hazard.submit")}
            </button>
          </div>
        )}

        {submitted && (
          <div className="rounded-lg border border-risk-low/40 bg-risk-low/10 p-3 text-center space-y-2">
            <p className="text-risk-low font-bold text-xs">✓ Hazard Report Submitted to Admin</p>
            <p className="text-[10px] text-ink-muted">Photo, audio evidence, and GPS location have been logged.</p>
            <button onClick={onClose} className="btn-secondary text-xs py-1 px-4 mt-1">
              Close Modal
            </button>
          </div>
        )}

        {error && <p className="text-xs text-risk-veryhigh font-mono">{error}</p>}
      </div>
    </div>
  );
}
