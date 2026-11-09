#!/usr/bin/env python3
"""RSD Arduino Uno + RC522 USB Serial bridge.

The bridge reads RFID_UID=... lines and forwards scans to RSD over HTTPS.
It can auto-discover Arduino/CH340 serial ports, wait while the board is
unplugged, reconnect after a disconnect, and prevent a second bridge process
from using the same installation. The API key is read only from the process
environment and is never written to logs or sent to the Arduino.
"""

import argparse
import json
import os
import sys
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import serial
    from serial import SerialException
    from serial.tools import list_ports
except ImportError:
    print("Missing dependency: pyserial. Run: python -m pip install -r hardware/requirements.txt", file=sys.stderr)
    raise


ARDUINO_IDENTIFIERS = ("arduino", "ch340", "usb-serial", "usb serial", "wch", "cp210", "ftdi")
ARDUINO_USB_IDS = {(0x2341, 0x0043), (0x2341, 0x0042), (0x2341, 0x0001), (0x1A86, 0x7523), (0x10C4, 0xEA60)}
ALLOWED_DECISIONS = {"TRIP_ACTIVE", "EXIT_ALLOWED", "HOLD", "SCAN_ERROR"}


def parse_args():
    parser = argparse.ArgumentParser(description="Forward Arduino RC522 RFID scans to RSD")
    parser.add_argument("--port", default=os.environ.get("RSD_SERIAL_PORT", ""), help="Arduino port; omit to auto-detect Arduino/CH340")
    parser.add_argument("--baud", type=int, default=int(os.environ.get("RSD_SERIAL_BAUD", "115200")), help="Serial speed; must match Arduino sketch")
    parser.add_argument("--api-url", default=os.environ.get("RSD_API_URL", ""), help="RSD site base URL, without /api/rfid/trips")
    return parser.parse_args()


def is_arduino_port(info) -> bool:
    description = " ".join(str(value or "") for value in (info.description, info.manufacturer, info.product)).lower()
    return (info.vid, info.pid) in ARDUINO_USB_IDS or any(marker in description for marker in ARDUINO_IDENTIFIERS)


def discover_port(requested_port: str = "") -> str | None:
    """Return the requested port when configured, otherwise detect a likely Arduino port."""
    if requested_port:
        return requested_port
    candidates = [info.device for info in list_ports.comports() if is_arduino_port(info)]
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        # Prefer a real Arduino description over generic USB serial adapters.
        preferred = [port for port in list_ports.comports() if port.device in candidates and "arduino" in str(port.description or "").lower()]
        if len(preferred) == 1:
            return preferred[0].device
    return None


def post_trip(api_url: str, bridge_key: str, uid: str, event_id: str, direction: str):
    endpoint = api_url.rstrip("/") + "/api/rfid/trips"
    payload = json.dumps({"uid": uid, "eventId": event_id, "startedAt": int(time.time() * 1000), "direction": direction}).encode("utf-8")
    request = Request(endpoint, data=payload, method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-RSD-Bridge-Key": bridge_key,
        "User-Agent": "RSD-RFID-Bridge/1.1",
    })
    with urlopen(request, timeout=10) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def lcd_result_for_decision(decision) -> str:
    return decision if isinstance(decision, str) and decision in ALLOWED_DECISIONS else "SCAN_ERROR"


def send_lcd_result(device, decision: str):
    device.write(f"RASD_RESULT={lcd_result_for_decision(decision)}\n".encode("ascii"))
    device.flush()


def send_until_ack(device, api_url: str, bridge_key: str, uid: str, event_id: str, retry_seconds: float, direction: str):
    while True:
        try:
            _, result = post_trip(api_url, bridge_key, uid, event_id, direction)
            decision = result.get("decision", "SCAN_ERROR")
            send_lcd_result(device, decision)
            trip = result.get("trip") or {}
            message = result.get("message", "")
            print(f"Trip {trip.get('tripId', 'not available')} · {decision}{' · ' + message if message else ''}{' (duplicate retry)' if result.get('duplicate') else ''}", flush=True)
            return True
        except HTTPError as error:
            if 400 <= error.code < 500:
                print(f"RSD API rejected the scan with HTTP {error.code}; check the bridge key and payload.", file=sys.stderr, flush=True)
                send_lcd_result(device, "SCAN_ERROR")
                return False
            print(f"RSD API server error ({error.code}); retrying in {retry_seconds:g}s", file=sys.stderr, flush=True)
            time.sleep(retry_seconds)
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
            print(f"RSD API unavailable or invalid response ({error}); retrying in {retry_seconds:g}s", file=sys.stderr, flush=True)
            time.sleep(retry_seconds)


def acquire_single_instance_lock():
    """Keep one lock handle open for the lifetime of the bridge process."""
    lock_path = os.environ.get("RSD_LOCK_PATH", os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "RSD", "rfid_bridge.lock"))
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    handle = open(lock_path, "a+")
    handle.seek(0)
    handle.write("1")
    handle.flush()
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, ImportError):
        handle.close()
        raise SystemExit("Another RSD RFID bridge instance is already running.")
    return handle


def run_forever(args, bridge_key: str, direction: str, retry_seconds: float):
    last_wait_log = 0.0
    while True:
        port = discover_port(args.port)
        if not port:
            now = time.time()
            if now - last_wait_log >= 15:
                print("Waiting for Arduino/CH340 USB device...", flush=True)
                last_wait_log = now
            time.sleep(3)
            continue
        try:
            print(f"RSD RFID bridge connected to {port} at {args.baud} baud", flush=True)
            with serial.Serial(port, args.baud, timeout=0.2, write_timeout=2) as device:
                time.sleep(2)
                device.reset_input_buffer()
                while True:
                    raw_line = device.readline().decode("utf-8", errors="ignore").strip()
                    if not raw_line.startswith("RFID_UID="):
                        continue
                    uid = raw_line.split("=", 1)[1].strip().upper()
                    if not uid:
                        continue
                    event_id = f"arduino-{uuid.uuid4()}"
                    send_until_ack(device, args.api_url, bridge_key, uid, event_id, retry_seconds, direction)
        except (SerialException, OSError) as error:
            print(f"Arduino disconnected ({error}); waiting to reconnect...", file=sys.stderr, flush=True)
            time.sleep(3)


def main():
    args = parse_args()
    bridge_key = os.environ.get("RSD_BRIDGE_API_KEY", "")
    if not args.api_url or not bridge_key:
        missing = []
        if not args.api_url:
            missing.append("RSD_API_URL or --api-url")
        if not bridge_key:
            missing.append("RSD_BRIDGE_API_KEY")
        raise SystemExit("Missing required configuration: " + ", ".join(missing))
    if args.baud <= 0:
        raise SystemExit("Baud rate must be a positive integer")
    retry_seconds = float(os.environ.get("RSD_RETRY_SECONDS", "2"))
    direction = os.environ.get("RSD_SCAN_DIRECTION", "entry").strip().lower()
    if direction not in ("entry", "exit"):
        raise SystemExit("RSD_SCAN_DIRECTION must be 'entry' or 'exit'")
    lock_handle = acquire_single_instance_lock()
    print("RSD RFID bridge auto-start mode enabled; raw UID values are never logged.", flush=True)
    _ = lock_handle
    run_forever(args, bridge_key, direction, retry_seconds)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nRSD RFID bridge stopped")
