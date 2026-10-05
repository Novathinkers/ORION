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

export default function ReportHazard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const geo = useGeolocation({ onUpdate: () => {} });

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [description, setDescription] = useState("");
  const [userPos, setUserPos] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(true);

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

  // Cleanup on unmount
  useEffect(() => {
    let unmounted = false;
    geo
      .requestOnce()
      .then((pos) => {
        if (!unmounted) {
          setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGpsLoading(false);
        }
      })
      .catch(() => {
        if (!unmounted) {
          setUserPos({ lat: 26.1445, lng: 91.7362 });
          setGpsLoading(false);
        }
      });

    return () => {
      unmounted = true;
      stopCamera();
      stopAudioTracks();
      clearTimer();
    };
  }, []); // eslint-disable-line

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

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraActive]);

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

  // --- END-TO-END VOICE RECORDING LOGIC & ACCURATE TIMER ---
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

      mediaRecorder.start(250); // Collect data chunks every 250ms
      setRecording(true);
      setRecordSeconds(0);

      clearTimer();
      timerRef.current = setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);

      // Web Speech API transcription fallback if available
      if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
        try {
          const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = false;
          recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
              .map((r) => r[0].transcript)
              .join(" ");
            if (transcript) {
              setDescription((prev) => (prev ? `${prev} ${transcript}` : transcript));
            }
          };
          recognition.start();
        } catch {
          // Ignore speech recognition errors
        }
      }
    } catch (err) {
      setError("🎙 Microphone access is required to record a voice report: " + err.message);
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
      // 1. Upload Photograph
      let imageUrl = null;
      try {
        imageUrl = await uploadHazardImage(file, { userId: user.id });
      } catch {
        imageUrl = previewUrl;
      }

      // 2. Upload Voice Recording (if present)
      let voiceUrl = null;
      if (audioBlob && audioBlob.size > 0) {
        try {
          voiceUrl = await uploadHazardAudio(audioBlob, { userId: user.id });
        } catch (err) {
          setAudioUploadError(err.message || "Voice recording upload failed.");
          setSubmitting(false);
          return; // Stop submission if voice upload fails explicitly as requested
        }
      }

      // 3. Finalize Hazard Submission
      await reportHazard({
        reportedBy: user.id,
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
    } catch (err) {
      setError(err.message || "Failed to submit hazard report.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">{t("hazard.uploadTitle")}</h1>
        <p className="text-sm text-ink-muted">{t("hazard.uploadHint")}</p>
      </div>

      <div className="panel p-5 space-y-4">
        {/* GPS Capture Indicator */}
        <div className="rounded-lg border border-base-border bg-base-raised p-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${userPos ? "bg-risk-low" : "bg-risk-moderate animate-pulse"}`} />
            <span className="text-ink-muted font-mono">
              {gpsLoading
                ? "Capturing current GPS location..."
                : userPos
                ? `GPS Location Captured: ${userPos.lat.toFixed(4)}°, ${userPos.lng.toFixed(4)}°`
                : "GPS Unavailable (Fallback Location)"}
            </span>
          </div>
        </div>

        {/* Hidden inputs for native camera & file picker */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChange}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="hidden"
        />

        {/* Dual Input Buttons: Camera & File Upload */}
        {!cameraActive && (
          <div className="space-y-2">
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-muted mb-1.5">
              1. Select Capture Method
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={startLiveCamera}
                className="btn-secondary py-3 flex items-center justify-center gap-2 text-sm border-signal/40 text-signal bg-signal/5 hover:bg-signal/15"
              >
                <span>📷</span> Take Photo (Camera)
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary py-3 flex items-center justify-center gap-2 text-sm"
              >
                <span>📁</span> Upload Image (Gallery)
              </button>
            </div>
            {cameraError && <p className="text-xs text-risk-moderate">{cameraError}</p>}
          </div>
        )}

        {/* Live Camera Viewfinder */}
        {cameraActive && (
          <div className="space-y-3 rounded-lg border border-signal/40 bg-black p-3 text-center">
            <div className="relative w-full rounded-md overflow-hidden bg-black max-h-72 flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline className="w-full max-h-72 object-cover rounded-md" />
            </div>
            <div className="flex items-center justify-center gap-3">
              <button type="button" onClick={snapPhoto} className="btn-primary px-6 py-2 text-sm">
                📸 Snap Photo
              </button>
              <button type="button" onClick={stopCamera} className="btn-secondary px-4 py-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Preview of Selected/Snapped Image */}
        {previewUrl && !cameraActive && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase text-ink-muted">Photo Preview</span>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setPreviewUrl(null);
                  setAnalysis(null);
                }}
                className="text-xs text-risk-veryhigh hover:underline"
              >
                Remove / Retake
              </button>
            </div>
            <img src={previewUrl} alt="Hazard preview" className="w-full max-h-72 object-cover rounded-lg border border-base-border" />
          </div>
        )}

        {/* END-TO-END VOICE HAZARD RECORDING SECTION */}
        <div className="space-y-3 pt-3 border-t border-base-border">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-muted flex items-center gap-2">
              <span>🎙 Driver Voice Report</span>
            </label>
            <span className="text-[10px] font-mono text-ink-faint">Optional Audio Evidence for Admin</span>
          </div>

          <div className="p-4 rounded-xl border border-base-border bg-base-raised/70 space-y-3">
            {recording ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-risk-critical animate-ping" />
                  <div>
                    <p className="text-xs font-bold text-risk-critical font-mono uppercase tracking-wider">● Recording Voice...</p>
                    <p className="text-lg font-mono font-bold text-ink">{formatTimer(recordSeconds)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={stopRecordingVoice}
                  className="btn-danger text-xs px-4 py-2 flex items-center gap-1.5 shadow-sm"
                >
                  <span>⏹</span> Stop Recording
                </button>
              </div>
            ) : audioUrl ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-signal flex items-center gap-1.5">
                    <span>🎙</span> Voice Report Ready ({formatTimer(recordSeconds)})
                  </span>
                  <span className="text-[10px] font-mono text-risk-low bg-risk-low/10 px-2 py-0.5 rounded border border-risk-low/30">
                    Audio Recorded
                  </span>
                </div>

                <audio
                  ref={audioPlayerRef}
                  src={audioUrl}
                  onEnded={() => setAudioPlaying(false)}
                  className="hidden"
                />

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={toggleAudioPlayback}
                    className="btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5"
                  >
                    <span>{audioPlaying ? "❚❚ Pause" : "▶ Play Preview"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={startRecordingVoice}
                    className="btn-secondary text-xs px-3 py-1.5"
                  >
                    Record Again
                  </button>
                  <button
                    type="button"
                    onClick={deleteRecording}
                    className="btn-secondary text-xs px-3 py-1.5 text-risk-veryhigh border-risk-veryhigh/30 hover:bg-risk-veryhigh/10"
                  >
                    🗑 Delete Audio
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-ink">Record Audio Explanation</p>
                  <p className="text-[11px] text-ink-faint">Speak road conditions, blockage details, or detour issues.</p>
                </div>
                <button
                  type="button"
                  onClick={startRecordingVoice}
                  className="btn-secondary text-xs px-4 py-2 border-signal/40 text-signal bg-signal/5 hover:bg-signal/15 flex items-center gap-2 font-semibold shrink-0"
                >
                  <span>🎙</span> Start Recording
                </button>
              </div>
            )}
          </div>

          {audioUploadError && (
            <div className="p-3 rounded-lg border border-risk-critical/40 bg-risk-critical/10 flex items-center justify-between text-xs">
              <span className="text-risk-critical font-medium">{audioUploadError}</span>
              <button type="button" onClick={submitReport} className="btn-secondary text-xs px-3 py-1 text-risk-critical">
                Retry Upload
              </button>
            </div>
          )}
        </div>

        {/* Optional Description */}
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-ink-muted mb-1.5">
            Type Description / Notes
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Type any additional context, landmarks, or hazard details..."
            className="w-full rounded-md border border-base-border bg-base-raised px-3 py-2 text-sm text-ink focus:outline-none focus:border-signal/50"
          />
        </div>

        {/* Analyze Button */}
        {file && !analysis && (
          <button onClick={runAnalysis} disabled={analyzing} className="btn-primary w-full text-base py-3">
            {analyzing ? t("hazard.analyzing") : t("hazard.analyze")}
          </button>
        )}

        {/* AI Analysis Review & Submit */}
        {analysis && !submitted && (
          <div className="space-y-4 pt-2 border-t border-base-border">
            <p className="eyebrow">AI Hazard Classification</p>
            <div className="rounded-lg border border-base-border bg-base-raised p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">Detected Hazard</span>
                <span className="font-semibold text-ink capitalize">
                  {analysis.hazard || (analysis.category && analysis.category.replace(/_/g, " "))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">Confidence Level</span>
                <span className="font-mono text-signal">
                  {analysis.confidence != null
                    ? `${analysis.confidence > 1 ? analysis.confidence : Math.round(analysis.confidence * 100)}%`
                    : "90%"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">Severity / Risk</span>
                <span className={`font-mono uppercase ${SEVERITY_COLOR[analysis.severity] || "text-risk-high"}`}>
                  {analysis.severity}
                </span>
              </div>
              {analysis.recommended_action && (
                <div className="flex items-center justify-between pt-1 border-t border-base-border/50">
                  <span className="text-ink-muted">Recommended Action</span>
                  <span className="text-xs font-mono text-ink-muted">{analysis.recommended_action}</span>
                </div>
              )}
              <div className="pt-2 border-t border-base-border text-xs text-ink">
                <p className="font-medium text-ink-faint uppercase text-[10px] tracking-wider mb-1">Explanation</p>
                <p>{analysis.explanation || analysis.description}</p>
              </div>
            </div>

            {audioUrl && (
              <div className="p-3 rounded-lg border border-signal/30 bg-signal/5 flex items-center justify-between text-xs">
                <span className="text-signal font-mono font-medium flex items-center gap-1.5">
                  <span>✓</span> Voice Report Attached ({formatTimer(recordSeconds)})
                </span>
                <button type="button" onClick={toggleAudioPlayback} className="text-xs text-signal font-bold hover:underline">
                  {audioPlaying ? "Pause" : "Play Preview"}
                </button>
              </div>
            )}

            <p className="text-xs text-ink-faint italic">
              ℹ Report will be sent to Admin for review. It will not create an active danger zone until reviewed.
            </p>

            <button onClick={submitReport} disabled={submitting} className="btn-primary w-full text-base py-3">
              {submitting ? "Uploading Evidence & Submitting..." : t("hazard.submit")}
            </button>
          </div>
        )}

        {submitted && (
          <div className="rounded-lg border border-risk-low/40 bg-risk-low/10 p-4 text-center space-y-1">
            <p className="text-risk-low font-semibold text-sm">✓ {t("hazard.submitted")}</p>
            <p className="text-xs text-ink-muted">Your photo, voice recording, and location have been submitted to Admin for review.</p>
          </div>
        )}

        {error && <p className="text-xs text-risk-veryhigh">{error}</p>}
      </div>
    </div>
  );
}
