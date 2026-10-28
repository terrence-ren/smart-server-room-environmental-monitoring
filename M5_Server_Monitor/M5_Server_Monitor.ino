#include <M5Stack.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include "M5UnitENV.h"
#include "secrets.h"

// ==========================================
// 1. ตั้งค่า Wi-Fi และ API Endpoint
// ==========================================
const char* WIFI_SSID     = ROOMWATCH_WIFI_SSID;
const char* WIFI_PASSWORD = ROOMWATCH_WIFI_PASSWORD;
const char* SENSOR_ID     = "m5stack-core-01";
const char* SERVER_URL    = "http://192.168.1.112:5000/api/telemetry";

// ==========================================
// 2. ประกาศตัวแปรและออบเจกต์
// ==========================================
SHT3X sht30;
QMP6988 qmp;

#define TMOS_PIR_I2C_ADDR 0x5A

float temperature = 0.0;
float humidity    = 0.0;
float pressure    = 0.0;
bool temperatureValid = false;
bool humidityValid    = false;
bool pressureValid    = false;

bool presenceDetected = false;
bool motionDetected   = false;
bool tmosStatusValid   = false;
bool tmosStatusLogged  = false;
bool tmosInitialized   = false;
uint8_t lastTmosStatus = 0;
unsigned long nextTmosInitAt = 0;

const float TEMP_WARNING_HIGH_C  = 27.0;
const float TEMP_WARNING_LOW_C   = 18.0;
const float TEMP_CRITICAL_HIGH_C = 32.0;
const float TEMP_CRITICAL_LOW_C  = 15.0;

String systemStatus    = "NO DATA";
uint16_t statusBgColor = 0x8410; // Gray until a temperature reading is available
uint16_t statusTextColor = BLACK;
String lastDrawnStatus = "";

unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL = 5000;
int queueCount = 0;

const unsigned long WIFI_RETRY_INITIAL_MS = 1000;
const unsigned long WIFI_RETRY_MAX_MS = 30000;
const unsigned long WIFI_TEST_DISCONNECT_MS = 1500;
unsigned long wifiRetryDelayMs = WIFI_RETRY_INITIAL_MS;
unsigned long nextWiFiAttemptAt = 0;
unsigned long wifiTestReconnectAt = 0;
bool wifiWasConnected = false;
bool wifiStarted = false;
bool wifiTestDisconnectActive = false;
bool wifiTestSawDisconnect = false;

// ==========================================
// 3. อ่านสถานะ presence/motion จาก STHS34PF80
// ==========================================
bool readTmosRegister(uint8_t reg, uint8_t& value) {
  Wire.beginTransmission(TMOS_PIR_I2C_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  const uint8_t received =
      Wire.requestFrom(static_cast<uint8_t>(TMOS_PIR_I2C_ADDR),
                       static_cast<uint8_t>(1));
  if (received != 1 || !Wire.available()) {
    return false;
  }

  value = Wire.read();
  return true;
}

bool writeTmosRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(TMOS_PIR_I2C_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool resetTmosAlgorithm() {
  uint8_t ctrl2 = 0;
  if (!readTmosRegister(0x21, ctrl2)) {
    return false;
  }
  if (!writeTmosRegister(0x21, ctrl2 | 0x10)) {
    writeTmosRegister(0x21, ctrl2 & static_cast<uint8_t>(~0x10));
    return false;
  }

  bool resetWritten =
      writeTmosRegister(0x11, 0x40) &&
      writeTmosRegister(0x08, 0x2A) &&
      writeTmosRegister(0x09, 0x01);
  const bool pageClosed = writeTmosRegister(0x11, 0x00);
  const bool bankRestored =
      writeTmosRegister(0x21, ctrl2 & static_cast<uint8_t>(~0x10));
  return resetWritten && pageClosed && bankRestored;
}

bool initializeTMOSPIR() {
  uint8_t value = 0;
  if (!readTmosRegister(0x0F, value) || value != 0xD3) {
    Serial.printf("STHS34PF80 WHO_AM_I check failed (0x%02X).\n", value);
    return false;
  }

  uint8_t ctrl1 = 0;
  if (!readTmosRegister(0x20, ctrl1)) {
    Serial.println("STHS34PF80 CTRL1 read failed.");
    return false;
  }

  if ((ctrl1 & 0x0F) != 0) {
    uint8_t funcStatus = 0;
    if (!readTmosRegister(0x25, funcStatus)) {
      Serial.println("STHS34PF80 FUNC_STATUS read failed during shutdown.");
      return false;
    }

    bool dataReady = false;
    const unsigned long readyTimeoutAt = millis() + 5000;
    while (millis() < readyTimeoutAt) {
      if (!readTmosRegister(0x23, value)) {
        Serial.println("STHS34PF80 STATUS read failed during shutdown.");
        return false;
      }
      if ((value & 0x04) != 0) {
        dataReady = true;
        break;
      }
      delay(1);
    }
    if (!dataReady) {
      Serial.println("STHS34PF80 data-ready timeout during shutdown.");
      return false;
    }

    ctrl1 &= 0xF0;
    if (!writeTmosRegister(0x20, ctrl1) ||
        !readTmosRegister(0x25, funcStatus)) {
      Serial.println("STHS34PF80 shutdown failed.");
      return false;
    }
  }

  if (!readTmosRegister(0x10, value)) {
    Serial.println("STHS34PF80 AVG_TRIM read failed.");
    return false;
  }
  value = (value & static_cast<uint8_t>(~0x37)) | 0x02; // TMOS 32, ambient 8
  if (!writeTmosRegister(0x10, value)) {
    Serial.println("STHS34PF80 AVG_TRIM configuration failed.");
    return false;
  }

  if (!resetTmosAlgorithm()) {
    Serial.println("STHS34PF80 algorithm reset failed.");
    return false;
  }

  if (!readTmosRegister(0x20, ctrl1) ||
      !writeTmosRegister(0x20, (ctrl1 & 0xE0) | 0x16)) {
    Serial.println("STHS34PF80 ODR configuration failed.");
    return false;
  }

  delay(250);
  Serial.println("STHS34PF80 initialized (WHO_AM_I=0xD3, ODR=8 Hz).");
  return true;
}

void readTMOSPIR() {
  uint8_t statusByte = 0;
  if (readTmosRegister(0x25, statusByte)) {
    presenceDetected = ((statusByte & 0x04) != 0);
    motionDetected   = ((statusByte & 0x02) != 0);
    tmosStatusValid = true;
    if (!tmosStatusLogged || statusByte != lastTmosStatus) {
      Serial.printf("STHS34PF80 FUNC_STATUS=0x%02X presence=%s motion=%s\n",
                    statusByte, presenceDetected ? "YES" : "NO",
                    motionDetected ? "YES" : "NO");
      lastTmosStatus = statusByte;
      tmosStatusLogged = true;
    }
    return;
  }

  tmosStatusValid = false;
  if (tmosStatusLogged) {
    Serial.println("STHS34PF80 status unavailable.");
    tmosStatusLogged = false;
  }
}

// ==========================================
// 4. การประเมินสถานะระบบ
// ==========================================
void evaluateStatus() {
  if (!temperatureValid) {
    systemStatus    = "NO DATA";
    statusBgColor   = 0x8410; // GRAY
    statusTextColor = WHITE;
  }
  else if (temperature > TEMP_CRITICAL_HIGH_C ||
           temperature < TEMP_CRITICAL_LOW_C) {
    systemStatus    = "CRITICAL";
    statusBgColor   = 0xF800; // RED
    statusTextColor = WHITE;
  } 
  else if (temperature > TEMP_WARNING_HIGH_C ||
           temperature < TEMP_WARNING_LOW_C) {
    systemStatus    = "WARNING";
    statusBgColor   = 0xFDA0; // ORANGE / YELLOW
    statusTextColor = BLACK;
  } 
  else {
    systemStatus    = "NORMAL";
    statusBgColor   = 0x07E0; // GREEN
    statusTextColor = BLACK;
  }
}

// ==========================================
// 5. การวาด UI สไตล์ Clean Light Theme (พื้นขาว)
// ==========================================
void drawNetworkStatus() {
  M5.Lcd.fillRect(0, 32, 320, 18, 0xEF7D); // Light Gray
  M5.Lcd.setTextColor(BLACK, 0xEF7D);
  M5.Lcd.setTextSize(1);
  M5.Lcd.setCursor(10, 37);
  if (WiFi.status() == WL_CONNECTED) {
    M5.Lcd.printf("SVR: 192.168.1.112  |  IP: %s",
                  WiFi.localIP().toString().c_str());
  } else {
    M5.Lcd.printf("SVR: 192.168.1.112  |  Wi-Fi reconnecting (%d)",
                  WiFi.status());
  }
}

void drawDashboardUI() {
  M5.Lcd.fillScreen(WHITE);
  
  // Header แถบสีน้ำเงินเข้ม
  M5.Lcd.fillRect(0, 0, 320, 32, 0x0013); // Navy Blue
  M5.Lcd.setTextColor(WHITE, 0x0013);
  M5.Lcd.setTextSize(2);
  M5.Lcd.setCursor(10, 8);
  M5.Lcd.print("SERVER ROOM MONITOR");

  // แถบข้อมูลเครือข่าย
  drawNetworkStatus();

  // กรอบ Temperature
  M5.Lcd.drawRoundRect(10, 56, 300, 68, 6, 0xC618);
  M5.Lcd.fillRoundRect(11, 57, 298, 66, 6, 0xF7FE);

  // กรอบ Humidity
  M5.Lcd.drawRoundRect(10, 130, 145, 50, 6, 0xC618);
  M5.Lcd.fillRoundRect(11, 131, 143, 48, 6, 0xF7FE);

  // กรอบ Pressure
  M5.Lcd.drawRoundRect(165, 130, 145, 50, 6, 0xC618);
  M5.Lcd.fillRoundRect(166, 131, 143, 48, 6, 0xF7FE);

  // กรอบ TMOS PIR Presence & Motion
  M5.Lcd.drawRoundRect(10, 186, 175, 48, 6, 0xC618);
  M5.Lcd.fillRoundRect(11, 187, 173, 46, 6, 0xF7FE);
}

void updateLCDDisplay() {
  // --- อุณหภูมิ ---
  M5.Lcd.setTextColor(0x4208, 0xF7FE);
  M5.Lcd.setTextSize(1);
  M5.Lcd.setCursor(20, 62);
  M5.Lcd.print("TEMPERATURE (Target: 18.0-27.0 C)");

  M5.Lcd.setTextColor(BLACK, 0xF7FE);
  M5.Lcd.setTextSize(3);
  M5.Lcd.setCursor(20, 82);
  if (temperatureValid) {
    M5.Lcd.printf("%6.2f C", temperature);
  } else {
    M5.Lcd.print(" --.-- C");
  }

  // --- ความชื้น ---
  M5.Lcd.setTextColor(0x4208, 0xF7FE);
  M5.Lcd.setTextSize(1);
  M5.Lcd.setCursor(20, 136);
  M5.Lcd.print("HUMIDITY");

  M5.Lcd.setTextColor(BLACK, 0xF7FE);
  M5.Lcd.setTextSize(2);
  M5.Lcd.setCursor(20, 154);
  if (humidityValid) {
    M5.Lcd.printf("%5.1f %%RH", humidity);
  } else {
    M5.Lcd.print(" --.- %RH");
  }

  // --- ความดัน ---
  M5.Lcd.setTextColor(0x4208, 0xF7FE);
  M5.Lcd.setTextSize(1);
  M5.Lcd.setCursor(175, 136);
  M5.Lcd.print("PRESSURE");

  M5.Lcd.setTextColor(BLACK, 0xF7FE);
  M5.Lcd.setTextSize(2);
  M5.Lcd.setCursor(175, 154);
  if (pressureValid) {
    M5.Lcd.printf("%5.0f hPa", pressure);
  } else {
    M5.Lcd.print(" ---- hPa");
  }

  // --- TMOS PIR Status ---
  M5.Lcd.setTextColor(0x4208, 0xF7FE);
  M5.Lcd.setTextSize(1);
  M5.Lcd.setCursor(18, 192);
  M5.Lcd.printf("PRESENCE: %s",
                !tmosStatusValid ? "N/A" : presenceDetected ? "YES" : "NO ");
  M5.Lcd.setCursor(18, 212);
  M5.Lcd.printf("MOTION  : %s",
                !tmosStatusValid ? "N/A" : motionDetected ? "YES" : "NO ");

  // --- แถบแสดง STATUS รวม ---
  if (lastDrawnStatus != systemStatus) {
    M5.Lcd.fillRoundRect(193, 186, 117, 48, 6, statusBgColor);
    M5.Lcd.setTextColor(statusTextColor, statusBgColor);
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(200, 201);
    M5.Lcd.print(systemStatus);
    lastDrawnStatus = systemStatus;
  }
}

// ==========================================
// 6. การจัดการ Wi-Fi แบบไม่บล็อก พร้อม exponential backoff
// ==========================================
bool deadlineReached(unsigned long now, unsigned long deadline) {
  return static_cast<long>(now - deadline) >= 0;
}

void serviceWiFi() {
  const unsigned long now = millis();
  const int wifiStatus = WiFi.status();

  if (wifiStatus == WL_CONNECTED) {
    if (!wifiWasConnected) {
      Serial.printf("Wi-Fi connected, IP: %s\n",
                    WiFi.localIP().toString().c_str());
      drawNetworkStatus();
    }
    wifiWasConnected = true;
    wifiRetryDelayMs = WIFI_RETRY_INITIAL_MS;
    nextWiFiAttemptAt = now + wifiRetryDelayMs;

    if (wifiTestDisconnectActive && wifiTestSawDisconnect) {
      Serial.println("Wi-Fi test reconnect complete; normal operation resumed.");
      wifiTestDisconnectActive = false;
      wifiTestSawDisconnect = false;
    }
    return;
  }

  if (wifiWasConnected) {
    Serial.printf("Wi-Fi disconnected (status=%d); recovery will retry.\n",
                  wifiStatus);
    wifiWasConnected = false;
    nextWiFiAttemptAt = now;
    drawNetworkStatus();
  }
  if (wifiTestDisconnectActive) {
    wifiTestSawDisconnect = true;
    if (!deadlineReached(now, wifiTestReconnectAt)) {
      return;
    }
  }
  if (!deadlineReached(now, nextWiFiAttemptAt)) {
    return;
  }

  Serial.printf("Wi-Fi reconnect attempt (status=%d, next backoff=%lu ms).\n",
                wifiStatus, wifiRetryDelayMs);
  if (!wifiStarted) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    wifiStarted = true;
  } else if (!WiFi.reconnect()) {
    Serial.println("Wi-Fi reconnect request unavailable; restarting association.");
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
  nextWiFiAttemptAt = now + wifiRetryDelayMs;
  if (wifiRetryDelayMs < WIFI_RETRY_MAX_MS) {
    wifiRetryDelayMs *= 2;
    if (wifiRetryDelayMs > WIFI_RETRY_MAX_MS) {
      wifiRetryDelayMs = WIFI_RETRY_MAX_MS;
    }
  }
}

void triggerWiFiTest() {
  if (WiFi.status() != WL_CONNECTED || wifiTestDisconnectActive) {
    Serial.println("Wi-Fi test skipped; device is not connected or a test is active.");
    return;
  }

  wifiTestDisconnectActive = true;
  wifiTestSawDisconnect = false;
  wifiTestReconnectAt = millis() + WIFI_TEST_DISCONNECT_MS;
  Serial.println("Wi-Fi test: button A requested a local disconnect; reconnecting in 1500 ms.");
  WiFi.disconnect(false, false);
}

// ==========================================
// 7. ฟังก์ชันส่งข้อมูล HTTP POST
// ==========================================
void sendDataToDashboard() {
  if (WiFi.status() != WL_CONNECTED) {
    queueCount++;
    return;
  }

  HTTPClient http;
  http.setTimeout(3000);
  if (!http.begin(SERVER_URL)) {
    Serial.println("Telemetry POST failed: unable to initialize HTTP client.");
    queueCount++;
    return;
  }
  http.addHeader("Content-Type", "application/json");

  String jsonPayload = "{\"sensor_id\":\"" + String(SENSOR_ID) + "\"";
  if (temperatureValid) {
    jsonPayload += ",\"temperature\":" + String(temperature, 2);
  }
  if (humidityValid) {
    jsonPayload += ",\"humidity\":" + String(humidity, 2);
  }
  if (pressureValid) {
    jsonPayload += ",\"pressure\":" + String(pressure, 2);
  }
  if (tmosStatusValid) {
    jsonPayload += ",\"presence\":" + String(presenceDetected ? 1 : 0);
    jsonPayload += ",\"motion\":" + String(motionDetected ? 1 : 0);
  }
  jsonPayload += ",\"status\":\"" + systemStatus + "\"}";

  int httpCode = http.POST(jsonPayload);
  String responseBody = http.getString();
  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf(
        "Telemetry HTTP %d: temperature=%s humidity=%s pressure=%s status=%s response=%s\n",
        httpCode,
        temperatureValid ? String(temperature, 2).c_str() : "unavailable",
        humidityValid ? String(humidity, 2).c_str() : "unavailable",
        pressureValid ? String(pressure, 2).c_str() : "unavailable",
        systemStatus.c_str(), responseBody.c_str());
    queueCount = 0;
  } else {
    Serial.printf("Telemetry POST failed (HTTP %d): %s response=%s\n",
                  httpCode, http.errorToString(httpCode).c_str(),
                  responseBody.c_str());
    queueCount++;
  }
  http.end();
}

// ==========================================
// 7. Setup & Loop
// ==========================================
void setup() {
  M5.begin();
  Serial.begin(115200);
  Wire.begin(21, 22);

  if (WIFI_SSID[0] == '\0' || WIFI_PASSWORD[0] == '\0') {
    Serial.println("Configure Wi-Fi credentials in M5_Server_Monitor/secrets.h.");
    while (true) delay(1000);
  }

  sht30.begin(&Wire, SHT3X_I2C_ADDR, 21, 22, 400000U);
  qmp.begin(&Wire, QMP6988_SLAVE_ADDRESS_L, 21, 22, 400000U);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  Serial.println("Wi-Fi recovery enabled (1-30 s exponential backoff; credentials are never logged).");
  Serial.println("Press M5 button A to test a brief local Wi-Fi disconnect/reconnect.");
  nextWiFiAttemptAt = millis();

  drawDashboardUI();
}

void loop() {
  M5.update();

  if (sht30.update()) {
    temperature = sht30.cTemp;
    humidity    = sht30.humidity;
    temperatureValid = true;
    humidityValid = true;
  }
  if (qmp.update()) {
    pressure = qmp.pressure / 100.0;
    pressureValid = true;
  }

  if (!tmosInitialized && millis() >= nextTmosInitAt) {
    tmosInitialized = initializeTMOSPIR();
    nextTmosInitAt = millis() + 5000;
  }
  if (tmosInitialized) {
    readTMOSPIR();
  } else {
    tmosStatusValid = false;
  }
  evaluateStatus();
  updateLCDDisplay();
  serviceWiFi();

  if (M5.BtnA.wasPressed()) {
    triggerWiFiTest();
  }

  if (millis() - lastSendTime >= SEND_INTERVAL) {
    sendDataToDashboard();
    lastSendTime = millis();
  }

  delay(1000);
}
