#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// RC522 wiring for Arduino Uno:
// SDA/SS -> D10, RST -> D9, MOSI -> D11, MISO -> D12, SCK -> D13,
// 3.3V -> 3.3V, GND -> GND. Do not power the RC522 from 5V.
#define SS_PIN 10
#define RST_PIN 9

MFRC522 rfid(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);

String lastUid = "";
unsigned long lastReadAt = 0;
// A closed Goodbye/HOLD transaction can start a new trip after 5 seconds.
// The backend separately protects active trips with its 10-second guard.
const unsigned long repeatCooldownMs = 5000;
String responseLine = "";

void showReady() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("RASD SYSTEM");
  lcd.setCursor(0, 1);
  lcd.print("Scan Your Card");
}

void showMessage(const char *line1, const char *line2, unsigned long durationMs) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
  if (durationMs > 0) delay(durationMs);
}

String uidToHex() {
  String uid;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (i > 0) uid += ":";
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

// The Python bridge sends only decisions returned by the RASD backend.
void handleServerResponse(const String &decision) {
  if (decision == "TRIP_ACTIVE") {
    showMessage("Welcome", "Trip Active", 1800);
  } else if (decision == "EXIT_ALLOWED") {
    showMessage("Good Bye", "", 2200);
  } else if (decision == "HOLD") {
    showMessage("Refer to Staff", "", 2200);
  } else {
    showMessage("Scan Error", "Try Again", 2200);
  }
  showReady();
}

// Non-blocking line parser for bridge responses.
void readServerResponses() {
  while (Serial.available() > 0) {
    const char incoming = (char)Serial.read();
    if (incoming == '\n' || incoming == '\r') {
      responseLine.trim();
      if (responseLine.startsWith("RASD_RESULT=")) {
        handleServerResponse(responseLine.substring(12));
      }
      responseLine = "";
    } else if (responseLine.length() < 48) {
      responseLine += incoming;
    } else {
      responseLine = ""; // discard unexpectedly long input
    }
  }
}

void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();

  lcd.init();
  lcd.backlight();
  showMessage("RASD SYSTEM", "Initializing...", 1500);

  byte version = rfid.PCD_ReadRegister(rfid.VersionReg);
  Serial.print("RFID Reader Version: 0x");
  Serial.println(version, HEX);
  Serial.println("RASD System Ready");
  showReady();
}

void loop() {
  readServerResponses();

  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  const String uid = uidToHex();
  const unsigned long now = millis();
  const bool duplicateTap = (uid == lastUid && now - lastReadAt < repeatCooldownMs);

  if (!duplicateTap) {
    lastUid = uid;
    lastReadAt = now;

    showMessage("Card Detected!", "Reading UID...", 250);
    // Keep this exact line format: the local Python bridge depends on it.
    Serial.print("RFID_UID=");
    Serial.println(uid);

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Reading Card");
    lcd.setCursor(0, 1);
    lcd.print("Waiting Result");
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(100);
}
