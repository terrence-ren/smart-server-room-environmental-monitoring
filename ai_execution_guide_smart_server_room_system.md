# คู่มือสรุปการพัฒนา Roomwatch

เอกสารนี้เป็น **Execution Guide แบบย่อสำหรับ AI Coding Agent** ใช้คู่กับโค้ดและ [README.md](README.md) เพื่อทำงาน ตรวจสอบ และทดสอบระบบที่มีอยู่จริงใน workspace โดยไม่เริ่มสร้างสถาปัตยกรรมใหม่ซ้ำอีกชุด

## 1. แหล่งอ้างอิงและสถาปัตยกรรมปัจจุบัน

ให้ยึดโค้ดปัจจุบันและ `README.md` เป็นแหล่งอ้างอิงการทำงานหลัก:

```text
M5Stack / Sensor Simulator
          |
          | HTTP POST หรือ MQTT
          v
Express API + MQTT Subscriber + Socket.IO / WebSocket
          |
          v
SQLite
          |
          +----> React Dashboard ผ่าน Nginx
          +----> Alert Feed และ Telegram (เมื่อกำหนดค่า)
```

- **Firmware:** Arduino บน M5Stack ใน `M5_Server_Monitor/`
- **Backend:** Node.js + Express ใน `backend/`
- **Database:** SQLite จัดเก็บใน `backend-data` volume เมื่อใช้ Docker Compose
- **Messaging:** MQTT ผ่าน Mosquitto; topic เริ่มต้น `serverroom/sensors/data`
- **Frontend:** React + Vite ใน `frontend/`, เสิร์ฟผ่าน Nginx ใน Compose
- **Simulator:** `simulator/sensor_sim.mjs`

> `AI_PROJECT_GUIDE_Smart_Server_Room.md` ปัจจุบันอธิบาย PHP/MySQL และ data contract คนละแบบ จึงยังไม่ใช่ข้อกำหนดที่สอดคล้องกับ implementation นี้ ต้องปรับเอกสารหลักให้ตรงกับโค้ดในงานเอกสารแยกต่างหาก

## 2. แผนผังไฟล์

| ส่วน | ไฟล์/โฟลเดอร์หลัก | หน้าที่ |
|---|---|---|
| Backend | `backend/src/app.js`, `backend/src/routes/`, `backend/src/services/` | REST API, MQTT, telemetry และ alerts |
| Database | `backend/src/database.js`, `backend/data/` | schema และไฟล์ SQLite |
| Frontend | `frontend/src/` | Dashboard, charts, settings และ alert feed |
| Firmware | `M5_Server_Monitor/M5_Server_Monitor.ino` | อ่านเซนเซอร์และส่ง telemetry ผ่าน HTTP |
| Simulator | `simulator/sensor_sim.mjs` | ส่งข้อมูลจำลองเพื่อทดสอบ REST API |
| Local orchestration | `docker-compose.yml`, `mosquitto/config/` | Backend, frontend และ MQTT broker |
| Setup/usage | `README.md`, `.env.example` | วิธีตั้งค่า รัน และตรวจระบบ |

ก่อนแก้ไข ให้ตรวจไฟล์และรูปแบบที่มีอยู่ก่อน ใช้ helper และ conventions เดิม ห้ามสร้างไฟล์ซ้ำหรือเขียนทับการเปลี่ยนแปลงที่ผู้ใช้มีอยู่

## 3. สัญญาข้อมูล

REST endpoint สำหรับรับข้อมูลคือ `POST /api/v1/sensors/data`; firmware เดิมใช้ `POST /api/telemetry` ซึ่งยังรองรับไว้ ส่วน MQTT ใช้ topic ที่ตั้งใน `MQTT_TOPIC`

ตัวอย่าง payload ที่ระบบรองรับ:

```json
{
  "sensor_id": "rack-01",
  "temperature": 23.4,
  "humidity": 48.0,
  "pressure": 1012,
  "smoke_detected": false,
  "water_leak": false,
  "presence": true,
  "motion": false,
  "status": "NORMAL",
  "timestamp": "2026-10-13T10:00:00.000Z"
}
```

- `sensor_id` ไม่บังคับ; หากไม่มี Backend ใช้ `unknown`
- ค่า sensor ที่ไม่มีหรืออ่านไม่ได้ให้ละ field หรือส่ง `null`; อย่าส่งค่าเริ่มต้นที่ทำให้ดูเหมือนอ่านสำเร็จ
- Boolean รองรับ `true`/`false` หรือ `0`/`1`
- `timestamp` ไม่บังคับ; หากไม่มี Backend ใช้เวลาปัจจุบัน
- เกณฑ์ temperature/humidity อยู่ใน environment settings และแก้ได้ผ่าน Settings API/UI
- `status` จาก client เป็นข้อมูลประกอบ; Alert Service ประเมิน threshold จากค่า telemetry และค่าตั้งค่าฝั่ง Backend

ตรวจ payload และ validation จาก `backend/src/services/telemetryService.js` ก่อนเปลี่ยนรูปแบบ ห้ามทำให้ firmware, simulator, API, MQTT และ Dashboard ใช้ชื่อ field ไม่ตรงกัน

## 4. ลำดับการทำงาน

### ขั้นที่ 1 — ตรวจสอบก่อนแก้

- ตรวจโครงสร้างโปรเจกต์, README, environment example และ tests ที่เกี่ยวข้อง
- ระบุขอบเขตไฟล์ที่จะเปลี่ยน ห้ามแตะข้อมูลใน named volumes เพื่อให้ test ผ่าน
- หากงานต้องเปลี่ยน data contract, API route หรือ schema ให้ตรวจ caller และ consumer ทุกส่วนก่อน

### ขั้นที่ 2 — Backend และ Database

- รักษา API prefix `/api/v1` และ response envelope ที่มีอยู่
- ใช้ parameterized SQL; validate request inputs และจำกัดขนาดผลลัพธ์
- รักษาเส้นทาง telemetry และ event types ที่ใช้อยู่ เช่น `sensor:updated`, `alert:new`, `alert:resolved`
- เพิ่ม/แก้ tests สำหรับกรณีสำเร็จ, input ไม่ถูกต้อง และ error path

### ขั้นที่ 3 — Dashboard

- ใช้ API client และ hooks/components เดิมใน `frontend/src/`
- แสดงสถานะการเชื่อมต่อ, ไม่มี telemetry, loading และ error อย่างชัดเจน
- แยกข้อมูลจำลองออกจากข้อมูลอุปกรณ์จริง; ห้ามแสดง mock ว่าเป็นข้อมูลจริง
- รักษาการแสดง history, alert feed และการแก้ threshold ให้ตรงกับ API

### ขั้นที่ 4 — Simulator และการทดสอบ

ใช้ simulator ทดสอบระบบโดยไม่ต้องต่อ hardware:

```powershell
node simulator/sensor_sim.mjs --mode cycle --interval 3000 --count 9
```

โหมดเดี่ยว:

```powershell
node simulator/sensor_sim.mjs --mode normal --count 1
node simulator/sensor_sim.mjs --mode warning --count 1
node simulator/sensor_sim.mjs --mode critical --count 1
```

### ขั้นที่ 5 — Firmware และ Hardware

- ตรวจ board, library และ API ของเซนเซอร์จากแหล่งที่เชื่อถือได้ก่อนแก้
- URL ในอุปกรณ์ต้องชี้ไปยัง host/IP ที่อุปกรณ์เข้าถึงได้; ห้ามใช้ `localhost` แทนเครื่อง Backend
- ทดสอบการอ่าน sensor, Wi-Fi reconnect และการส่ง HTTP แยกจากกัน
- หากไม่ได้ต่ออุปกรณ์จริง ให้รายงานผลเป็น `NOT TESTED` สำหรับ hardware; ห้ามอ้างว่า compile หรืออ่านค่าได้หากยังไม่ได้ตรวจจริง
- ย้าย Wi-Fi credentials และค่าลับออกจาก source ที่จะ commit; ห้ามแสดงค่าเหล่านั้นใน log หรือคำตอบ

### ขั้นที่ 6 — ตรวจรับและส่งมอบ

รันเฉพาะ checks ที่เกี่ยวกับการเปลี่ยนแปลง:

```powershell
Push-Location backend
npm test
Pop-Location

Push-Location frontend
npm run lint
npm run build
Pop-Location
```

เมื่อเปลี่ยน Docker configuration ให้ตรวจผลด้วย Docker Compose ตาม README และตรวจ health endpoint:

```powershell
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://localhost:8080/health
```

หยุดบริการโดยเก็บข้อมูลไว้:

```powershell
docker compose down
```

อย่าใช้ `docker compose down -v` เว้นแต่ผู้ใช้สั่งให้ลบข้อมูลใน volumes อย่างชัดเจน

## 5. ความปลอดภัยและข้อจำกัด

- เก็บ credentials และ tokens ใน environment/secret store ไม่ commit ลง repository
- Backend API ปัจจุบันยังไม่มี authentication; ใช้เฉพาะ trusted network และจำกัดการเข้าถึงด้วย firewall จนกว่าจะเพิ่ม authentication/TLS
- อย่าเปิด MQTT broker สู่ LAN/Internet โดยไม่มี authentication, TLS และ firewall ที่เหมาะสม
- ห้ามลบ database, ตาราง, volumes หรือข้อมูลเดิมเพื่อให้การทดสอบผ่าน
- ระบบต้นแบบไม่ใช่ระบบ safety control; หากใช้ป้องกันความเสียหายจริง ต้องมีระบบเตือน/ควบคุมอิสระที่เหมาะสม

## 6. Checklist รายงานงาน

- [ ] สรุปไฟล์ที่สร้างหรือแก้ไข และเหตุผล
- [ ] รัน tests/lint/build ที่เกี่ยวข้อง พร้อมผลจริง
- [ ] แยกผล `PASS`, `FAIL`, `NOT TESTED`; ห้ามระบุ `PASS` หากไม่ได้รัน
- [ ] ระบุการทดสอบที่ยังต้องทำบน hardware หรือเครือข่ายจริง
- [ ] รายงานข้อจำกัด ความเสี่ยง และค่าที่ผู้ใช้ต้องตั้งเอง
- [ ] ไม่เปิดเผย credentials, tokens หรือข้อมูลลับ
