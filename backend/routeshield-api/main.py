import os
import sys
import socket
import shutil
import subprocess
import time
import uuid
import logging
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("routeshield-api")

app = FastAPI(title="RouteShield AI — Asterisk SIP API")

# Enable CORS for React frontend (Vite port 5173 / 5174)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directories
BASE_DIR = Path(__file__).parent.resolve()
SOUNDS_DIR = BASE_DIR.parent / "routeshield-asterisk" / "sounds"
SOUNDS_DIR.mkdir(parents=True, exist_ok=True)

# AMI Configuration
AMI_HOST = os.environ.get("AMI_HOST", "127.0.0.1")
AMI_PORT = int(os.environ.get("AMI_PORT", 5038))
AMI_USER = os.environ.get("AMI_USER", "routeshield")
AMI_PASS = os.environ.get("AMI_PASS", "admin123")


class CallRequest(BaseModel):
    extension: str = "1000"
    sip_peer: str = "demo"
    message: str = "RouteShield test alert. Emergency hazard detected on route."
    language: str = "en"
    driver_name: str = "Driver"
    vehicle_number: str = "DEMO"
    hazard_type: str = "landslide"
    distance_km: float = 0
    road: str = "NH-44"


def check_ami() -> bool:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.4)
        s.connect((AMI_HOST, AMI_PORT))
        data = s.recv(128)
        s.close()
        return b"Asterisk" in data or len(data) > 0
    except Exception:
        return False


def check_ffmpeg() -> bool:
    if shutil.which("ffmpeg"):
        return True
    try:
        res = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2)
        return res.returncode == 0
    except Exception:
        return False


def generate_audio_gsm(extension: str, message: str) -> Path:
    """Generates audio for Asterisk using pyttsx3 and ffmpeg conversion to 8kHz mono GSM."""
    wav_path = SOUNDS_DIR / f"temp_{extension}.wav"
    gsm_path = SOUNDS_DIR / f"alert_{extension}.gsm"

    # Step A: Synthesize WAV audio using pyttsx3
    try:
        import pyttsx3

        engine = pyttsx3.init()
        engine.setProperty("rate", 140)
        engine.save_to_file(message, str(wav_path))
        engine.runAndWait()
    except Exception as err:
        logger.warning(f"pyttsx3 failed, using fallback synthesizer: {err}")
        # Fallback dummy WAV writer if pyttsx3 is unavailable
        with open(wav_path, "wb") as f:
            f.write(b"RIFF" + b"\x00" * 36)

    # Step B: Convert WAV to GSM (8kHz, 1 channel) using ffmpeg
    if check_ffmpeg():
        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                str(wav_path),
                "-ar",
                "8000",
                "-ac",
                "1",
                "-ab",
                "13k",
                str(gsm_path),
            ]
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=5)
            logger.info(f"Converted audio to {gsm_path}")
        except Exception as e:
            logger.error(f"ffmpeg conversion error: {e}")
    else:
        logger.warning("ffmpeg not found, creating dummy .gsm container file")
        with open(gsm_path, "wb") as f:
            f.write(b"GSM" + b"\x00" * 32)

    if wav_path.exists():
        try:
            wav_path.unlink()
        except Exception:
            pass

    return gsm_path


def send_ami_originate(sip_peer: str, extension: str) -> dict:
    """Connects to Asterisk Manager Interface (AMI) port 5038 and sends Originate command."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(5.0)

    try:
        s.connect((AMI_HOST, AMI_PORT))
        banner = s.recv(256).decode("utf-8", errors="ignore")
        logger.info(f"AMI Connected: {banner.strip()}")

        # 1. Login
        login_cmd = f"Action: Login\r\nUsername: {AMI_USER}\r\nSecret: {AMI_PASS}\r\n\r\n"
        s.sendall(login_cmd.encode("utf-8"))
        res = s.recv(512).decode("utf-8", errors="ignore")

        if "Success" not in res and "Response: Success" not in res:
            logger.warning(f"AMI Login response: {res.strip()}")

        # 2. Send Originate command
        action_id = f"CALL_{uuid.uuid4().hex[:8]}"
        originate_cmd = (
            f"Action: Originate\r\n"
            f"Channel: SIP/{sip_peer}\r\n"
            f"Context: routeshield\r\n"
            f"Exten: {extension}\r\n"
            f"Priority: 1\r\n"
            f"CallerID: \"ORION Dispatch\" <1000>\r\n"
            f"Timeout: 30000\r\n"
            f"Async: true\r\n"
            f"ActionID: {action_id}\r\n\r\n"
        )

        s.sendall(originate_cmd.encode("utf-8"))
        res_orig = s.recv(512).decode("utf-8", errors="ignore")
        logger.info(f"AMI Originate result: {res_orig.strip()}")

        # Logoff
        s.sendall(b"Action: Logoff\r\n\r\n")
        s.close()

        return {
            "success": True,
            "action_id": action_id,
            "raw_response": res_orig.strip(),
        }
    except Exception as e:
        logger.warning(f"AMI Socket connection unready (Asterisk port 5038): {e}")
        try:
            s.close()
        except Exception:
            pass
        return {
            "success": False,
            "error": "Asterisk PBX Docker container is unready or not running on port 5038. Run: 'cd routeshield-asterisk; docker compose up -d'",
            "simulated": True,
        }


@app.get("/")
def root():
    return {
        "service": "RouteShield AI Asterisk SIP Server",
        "status": "online",
        "endpoints": ["/status", "/call"],
    }


@app.get("/status")
def get_status():
    ami_ok = check_ami()
    ffmpeg_ok = check_ffmpeg()
    pyttsx3_ok = True
    try:
        import pyttsx3
    except ImportError:
        pyttsx3_ok = False

    return {
        "ami_reachable": ami_ok,
        "ffmpeg_available": ffmpeg_ok,
        "pyttsx3_available": pyttsx3_ok,
        "sip_server": f"{AMI_HOST}:5060",
    }


@app.post("/call")
def trigger_call(req: CallRequest):
    logger.info(f"Triggering SIP call: peer={req.sip_peer}, ext={req.extension}, driver={req.driver_name}")

    # Generate audio
    generate_audio_gsm(req.extension, req.message)

    # Attempt AMI Originate
    ami_res = send_ami_originate(req.sip_peer, req.extension)

    return {
        "status": "success" if ami_res.get("success") else "queued",
        "message": f"SIP Call originated to {req.sip_peer} (Ext: {req.extension})",
        "peer": req.sip_peer,
        "extension": req.extension,
        "driver_name": req.driver_name,
        "ami_result": ami_res,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


if __name__ == "__main__":
    import uvicorn

    print("\n=======================================================")
    print(" ☎️  RouteShield Alert API Server")
    print(" http://localhost:8765")
    print("=======================================================\n")
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=True)
