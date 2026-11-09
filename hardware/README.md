# RSD RFID bridge for Windows

This folder connects an Arduino Uno + RC522 over USB Serial to the RSD backend.

## Data flow

`RC522 card scan -> Arduino Serial -> rfid_bridge.py -> POST /api/rfid/trips -> trips table -> Operations dashboard`

The backend normalizes the card UID, stores it with a SHA-256 hash for lookup, and the Operations dashboard shows the stored UID alongside the Trip ID. The bridge never prints the raw UID. A generated event ID is reused during retries, so the same request cannot create duplicate trips.

## 1. Arduino and RC522 setup

Install the `MFRC522` library in Arduino IDE, open `arduino_rfid_rc522.ino`, select **Arduino Uno**, choose the correct board port, and upload it.

RC522 wiring:

- SDA/SS -> D10
- RST -> D9
- MOSI -> D11
- MISO -> D12
- SCK -> D13
- 3.3V -> 3.3V
- GND -> GND

The RC522 must use 3.3V, not 5V. The checked-in sketch includes the supplied I2C LCD setup and listens for backend result lines from the local Python bridge. Back up your working sketch before uploading this merged version.

The sketch emits the UID line and receives the backend decision over the same USB serial connection. It emits:

```text
RSD_RFID_READY
RFID_UID=AA:BB:CC:DD
```

## 2. Configure the RSD backend

Set a long random `RSD_BRIDGE_API_KEY` in the server environment. Also make sure `DATABASE_URL` is configured. The API refuses requests when the bridge key is missing and returns 401 for an incorrect key.

The endpoint is:

```text
POST /api/rfid/trips
Header: X-RSD-Bridge-Key: <server-configured-key>
Body: { "uid": "AA:BB:CC:DD", "eventId": "arduino-unique-event-id", "direction": "entry" }
```

`direction` is `entry` by default for the single-reader setup. The first scan starts the trip; a second scan within 10 seconds is treated as an accidental double-tap. A later scan of the same active card is treated as exit automatically. A separately configured exit reader (`RSD_SCAN_DIRECTION=exit`) also requests exit immediately after the guard window.

The endpoint is not intended to be called from the browser. Never place the bridge key in Arduino firmware or frontend code.

## 3. Windows installation

Install Python 3.10 or newer from [python.org](https://www.python.org/downloads/windows/). During installation, enable **Add Python to PATH**.

Open PowerShell in the RSD project folder and install the only bridge dependency:

```powershell
python -m pip install -r hardware\requirements.txt
```

You can also run this from the project root:

```powershell
python -m pip install pyserial
```

## 4. Find the Arduino COM port

1. Connect the Arduino Uno by USB.
2. Open **Device Manager**.
3. Expand **Ports (COM & LPT)**.
4. Find **Arduino Uno (COMx)** or **USB-SERIAL CH340 (COMx)**.
5. Replace `COM3` below with the port shown on your computer.
6. Close Arduino IDE's **Serial Monitor** before starting the bridge; only one program can own the COM port at a time.

The Arduino sketch uses **115200 baud**. The bridge must use the same speed.

## 5. Configure and start the Windows bridge

In the same PowerShell window, set the hosted RSD URL and the same bridge key configured on the backend:

```powershell
$env:RSD_API_URL = "https://your-rsd-host.example"
$env:RSD_BRIDGE_API_KEY = "paste-the-server-bridge-key-here"
$env:RSD_SERIAL_PORT = "COM3"
$env:RSD_SERIAL_BAUD = "115200"
python hardware\rfid_bridge.py
```

The script also supports direct port arguments:

```powershell
python hardware\rfid_bridge.py --port COM7 --baud 115200 --api-url https://your-rsd-host.example
```

The API key is deliberately read only from `RSD_BRIDGE_API_KEY`, not from a command-line argument, to avoid exposing it in shell history.

For a one-click launcher, set the environment variables in PowerShell first, then run:

```powershell
hardware\run_rfid_bridge.bat
```

Expected startup output:

```text
RSD RFID bridge listening on COM3 at 115200 baud
```

## 6. Test the complete journey

1. Start the RSD website and sign in to an operator account.
2. Open **Operations** and keep the **RFID trip intake** panel visible.
3. Connect the Arduino Uno and confirm its COM port in Device Manager.
4. Upload the RSD Arduino sketch.
5. Start the Python bridge.
6. Pass one RFID card over the RC522.
7. The Arduino emits `RFID_UID=...` over USB Serial. After the API responds, the bridge sends `RASD_RESULT=...` back to Arduino and the LCD displays the actual backend decision.
8. The Python bridge sends the UID over HTTPS to `/api/rfid/trips`.
9. The backend hashes the UID, creates a new database row, and generates a separate Trip ID such as `T000001`.
10. The Operations panel refreshes within five seconds and shows the Trip ID, start time, `ACTIVE` state, and `RFID / USB` source.
11. Keep the bridge running and temporarily disconnect the network, scan once, then restore the network. The bridge retries the same event ID; it must still create only one trip.
10. A repeat scan within the 10-second guard window keeps the same trip active. A later scan on the default single reader, or any scan from a configured exit reader, looks up the active trip by UID hash, checks confirmed incidents linked to that Trip ID, and returns one of these decisions:
    - `EXIT_ALLOWED` with `Goodbye` when no confirmed violation exists. The trip becomes `completed`.
    - `HOLD` with `Please proceed to the ticket counter.` when a confirmed violation exists. The trip becomes `hold`.
11. If the second request is retried with the same event ID, the backend returns the same decision without changing the trip again.
12. `EXIT_ALLOWED` completes the trip. `HOLD` closes the current gate transaction while preserving the confirmed incident and returns the passenger to staff. After the hardware's 5-second repeat guard, a new tap starts a new Trip ID. The same event ID returns the same stored decision on retry.
13. A second tap of the same card within `RSD_RESCAN_GUARD_MS` (default 10 seconds) after the previous scan is ignored as an accidental double-tap. A later scan exits the active trip.
14. Dashboard counters reflect stored records. Retention defaults to 30 days (`RSD_RETENTION_DAYS`) and runs at startup and every 24 hours. It removes old orphan detections and completed trips without linked incidents; it preserves every incident/review decision and all active or held trips.

## Troubleshooting

- **`Missing required configuration`**: set `RSD_API_URL` and `RSD_BRIDGE_API_KEY` in the same PowerShell window where Python runs.
- **`Unable to open COM3`**: check Device Manager, replace the port, install the Arduino/CH340 driver if required, and close Serial Monitor.
- **No `RFID_UID` output**: verify RC522 wiring, 3.3V power, the MFRC522 library, and that the sketch was uploaded to the correct board.
- **HTTP 401**: the local key does not match the server's `RSD_BRIDGE_API_KEY`.
- **HTTP 503**: the server has no `RSD_BRIDGE_API_KEY` configured.
- **HTTP 500**: check the backend `DATABASE_URL` and server logs.
- **Unexpected new Trip ID on exit**: make sure the first trip is still `active`; a completed or held trip intentionally starts a new journey on the next scan.

## Testing limitation

The cloud environment does not have access to your physical Arduino, RC522, USB cable, or COM port. The Python syntax, backend validation, database migration, and application build were checked here, but the final physical scan must be tested on your Windows computer with the hardware connected.


## 7. تشغيل تلقائي بالكامل على Windows

توجد ملفات التشغيل التلقائي التالية:

- `setup_rsd_autostart.ps1` — إعداد لمرة واحدة.
- `start_rsd_bridge.ps1` — المشغل الذي تستخدمه Task Scheduler.
- `Start RASD.bat` — تشغيل يدوي عند الحاجة.
- `remove_rsd_autostart.ps1` — إزالة مهمة التشغيل التلقائي فقط.

### الإعداد لمرة واحدة

1. انسخ مجلد المشروع إلى مكان ثابت لا تغيّر اسمه بعد الإعداد، مثل `C:\RSD\rased-metro`.
2. ثبّت Python وpyserial مرة واحدة:

```powershell
py -m pip install -r hardware\requirements.txt
```

3. افتح PowerShell داخل مجلد المشروع وشغّل:

```powershell
powershell -ExecutionPolicy Bypass -File .\hardware\setup_rsd_autostart.ps1
```

4. الصق مفتاح `RSD_BRIDGE_API_KEY` الحالي عند الطلب. الإدخال مخفي ولن يظهر في الشاشة.
5. اترك سؤال COM فارغًا ليكتشف البرنامج Arduino أو CH340 تلقائيًا. اكتب `COM5` فقط إذا أردت تثبيت منفذ محدد.
6. اترك الاتجاه `entry` لقارئ الدخول. لقارئ خروج منفصل شغّل إعدادًا منفصلًا باتجاه `exit` ومهمة مختلفة.

يحفظ الإعداد في `%LOCALAPPDATA%\RSD\rfid_bridge.config.json`. قيمة المفتاح داخل هذا الملف مشفرة باستخدام Windows DPAPI ومربوطة بحساب Windows الحالي؛ لا تضع الملف في GitHub ولا ترسله لأي شخص. ملف السجل `%LOCALAPPDATA%\RSD\rfid_bridge.log` لا يكتب UID الخام.

بعد الإعداد، تنشئ Task Scheduler مهمة باسم `RSD RFID Bridge` تعمل عند تسجيل الدخول، وتستخدم `MultipleInstances=Ignore` لمنع تشغيل نسختين. إذا لم يكن Arduino موصولًا، تنتظر المهمة وتعيد اكتشافه كل بضع ثوانٍ. إذا فصل الكابل، يعيد الجسر الاتصال تلقائيًا عند عودته.

### تشغيل يدوي

انقر مرتين على:

```text
hardware\Start RASD.bat
```

ولا تحتاج إلى كتابة `RSD_API_URL` أو المفتاح في CMD بعد الإعداد. لإيقاف التشغيل التلقائي فقط، شغّل:

```powershell
powershell -ExecutionPolicy Bypass -File .\hardware\remove_rsd_autostart.ps1
```

هذا لا يحذف إعداد المفتاح ولا بيانات RSD.

### ما الذي يبقى كما هو

- الرابط السحابي هو `https://rasd-metro-be5rjq3l.manus.space`.
- سرعة Arduino تبقى `115200`.
- قرارات `TRIP_ACTIVE` و`EXIT_ALLOWED` و`HOLD` تُرسل إلى LCD عبر `RASD_RESULT=...` كما في الجسر السابق.
- لا يتصل Arduino مباشرة بقاعدة البيانات ولا يحتوي على مفتاح Backend.
- الموقع وBackend لا يحتاجان إلى تشغيل محلي؛ المطلوب محليًا هو الجسر فقط لأن USB Serial موجود على جهاز Windows.

### التحقق بعد الإعداد

1. سجّل الخروج من Windows ثم سجّل الدخول، أو افتح `Start RASD.bat` للاختبار الفوري.
2. تأكد من وجود عملية Python واحدة فقط، ومن ظهور `Waiting for Arduino/CH340 USB device...` في `%LOCALAPPDATA%\RSD\rfid_bridge.log` عند عدم التوصيل.
3. أوصل Arduino: يجب أن يظهر `RSD RFID bridge connected to COMx at 115200 baud`.
4. مرر البطاقة: يجب أن يرسل الجسر القراءة إلى HTTPS، ثم يرسل قرار Backend إلى LCD وتظهر الرحلة في Operations بعد التحديث.
5. افصل Arduino وأعد توصيله: يجب أن يعود الجسر للعمل دون تشغيله مرة ثانية.

لم يتم اختبار Task Scheduler أو COM أو LCD أو RC522 فعليًا داخل بيئة السحابة؛ تم اختبار كود Python والبحث المنطقي عن المنافذ وبروتوكول LCD فقط. نجاح التوصيل التلقائي النهائي يحتاج تنفيذ الخطوات على جهاز Windows الحقيقي.
