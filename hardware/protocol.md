# RASD Arduino/LCD integration protocol

## Hardware and serial contract

- Arduino Uno + MFRC522 + I2C LCD 16x2.
- LCD I2C address in the merged sketch: `0x27` (confirm on the physical device).
- Serial speed: `115200` baud.
- Arduino -> bridge: `RFID_UID=<UID>\n` (uppercase hexadecimal UID).
- Bridge -> Arduino: `RASD_RESULT=<DECISION>\n`.

## Backend-authoritative LCD messages

The local Python bridge sends the UID to the authenticated HTTPS endpoint `POST /api/rfid/trips`. It returns only the backend decision to the Arduino:

| Backend decision | LCD display |
|---|---|
| `TRIP_ACTIVE` | Scan Your Card |
| `EXIT_ALLOWED` | Good Bye, then Scan Your Card |
| `HOLD` | Refer to Staff, then Scan Your Card |
| Invalid decision or HTTP 4xx | Scan Error, then Scan Your Card |

The Arduino does not calculate passenger status. Network/server errors are retried by the bridge and do not generate a fake passenger result.

## Connection architecture

The website does not directly access the USB serial port. The supported architecture is a local Python USB-Serial bridge running on the computer connected to the Arduino. It stores `RSD_BRIDGE_API_KEY` locally and sends HTTPS requests to the website. Never place this key in Arduino firmware or browser JavaScript.

A single reader cannot infer entry versus exit. Set `RSD_SCAN_DIRECTION=entry` or `RSD_SCAN_DIRECTION=exit` according to the physical reader role. Entry is the default; only an explicitly configured exit reader requests trip completion.

## Upload and test

1. Back up the currently working sketch.
2. Install `MFRC522` and `LiquidCrystal_I2C` libraries.
3. Confirm LCD I2C address `0x27`; change the constructor only if your scanner reports a different address.
4. Upload `arduino_rfid_rc522.ino`.
5. Close Arduino IDE Serial Monitor so it releases the COM port.
6. Start the Python bridge with the correct COM port, site URL, and bridge key.
7. Scan a test card. Verify that `Reading Card / Waiting Result` remains until the backend response is received and that the LCD then displays the corresponding real decision.

The Arduino ignores a repeated scan of the same UID for 5 seconds. The backend also
uses `RSD_RESCAN_GUARD_MS` (default `5000`) as its server-side guard; these values
must remain aligned.
