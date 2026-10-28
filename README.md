# Roomwatch: Smart Server Room Monitor

ระบบติดตามสภาพแวดล้อมห้องเซิร์ฟเวอร์ ประกอบด้วย REST API, MQTT ingestion, SQLite, Socket.IO dashboard (พร้อม raw WebSocket compatibility) และ sensor simulator

## ความต้องการ

- Docker Desktop หรือ Docker Engine ที่มี Docker Compose plugin สำหรับรันระบบทั้งหมด
- Node.js 24+ สำหรับรัน simulator หรือพัฒนา backend/frontend แบบ local
- PowerShell บน Windows ใช้คำสั่งตัวอย่างด้านล่างได้โดยตรง

## เริ่มระบบด้วย Docker Compose

1. สร้างไฟล์ environment สำหรับ Compose แล้วแก้ค่าตามต้องการ:

   ```powershell
   Copy-Item .env.example .env
   ```

   ค่าเริ่มต้นใช้ frontend ที่พอร์ต `8080`, backend ที่ `5001` (port `5000` ภายใน container), MQTT topic `serverroom/sensors/data` และ thresholds ตามค่าตัวอย่าง ไม่จำเป็นต้องใส่ Telegram token หากยังไม่ใช้การแจ้งเตือน Telegram

2. สร้าง image และเริ่มบริการ:

   ```powershell
   docker compose up --build -d
   ```

3. ตรวจสถานะบริการ:

   ```powershell
   docker compose ps
   Invoke-RestMethod http://localhost:8080/health
   ```

4. เปิด dashboard ที่ <http://localhost:8080> ระบบควรแสดงสถานะ API Connected; เมื่อยังไม่มี sensor ส่งข้อมูล สถานะห้องจะแสดง Waiting for telemetry

บริการใน Compose:

- `frontend`: Nginx เสิร์ฟ React dashboard และ proxy `/api/*`, `/socket.io/`, `/ws` และ `/health` ไป backend
- `backend`: Express REST API, Socket.IO server, legacy WebSocket endpoint และ MQTT subscriber
- `mqtt-broker`: Eclipse Mosquitto ใช้ topic `serverroom/sensors/data`
- `backend-data`: named volume สำหรับ SQLite database
- `mqtt-data`: named volume สำหรับ Mosquitto persistence

SQLite ทำงานภายใน backend จึงไม่ต้องใช้ container database แยก ข้อมูล telemetry ยังคงอยู่ใน volume หลัง recreate container ตามปกติ

## ทดสอบด้วย Simulator

ติดตั้ง Node.js 24+ แล้วส่ง telemetry วนทั้ง NORMAL, WARNING และ CRITICAL:

```powershell
node simulator/sensor_sim.mjs --mode cycle --interval 3000
```

หยุดด้วย `Ctrl+C` หรือจำกัดจำนวน readings ด้วย `--count`:

```powershell
node simulator/sensor_sim.mjs --mode normal --count 1
node simulator/sensor_sim.mjs --mode warning --count 1
node simulator/sensor_sim.mjs --mode critical --count 1
```

ค่า warning สูงกว่า 28°C เพื่อให้ผ่าน backend threshold เริ่มต้น ส่วน critical สูงกว่า 32°C และตั้ง `smoke_detected=true` เพื่อทดสอบ critical alert/notification path ของ backend และ dashboard ด้วย สามารถเปลี่ยน backend URL และ sensor ID ได้:

```powershell
node simulator/sensor_sim.mjs --base-url http://localhost:5001 --sensor-id rack-test-01 --mode cycle --interval 2000 --count 9
```

เมื่อรัน backend โดยตรงนอก Compose ให้ระบุ URL ของ backend local เอง (ค่าเริ่มต้นของ backend local คือ `http://localhost:5000`) เช่น `node simulator/sensor_sim.mjs --base-url http://localhost:5000 --mode cycle`.

## การตั้งค่า

Compose อ่านค่าจาก `.env` ที่ root directory โดยดูตัวอย่างจาก [.env.example](.env.example):

- `FRONTEND_PORT`, `BACKEND_PORT`: host ports สำหรับ dashboard และ API (ค่าเริ่มต้น `8080` และ `5001`)
- `MQTT_BROKER_URL`, `MQTT_TOPIC`: broker URL และ topic ที่ backend subscribe
- `TEMP_THRESHOLD_MIN`, `TEMP_THRESHOLD_MAX`, `HUMIDITY_THRESHOLD_MIN`, `HUMIDITY_THRESHOLD_MAX`: เกณฑ์การแจ้งเตือน
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: ไม่บังคับ ใช้ส่ง Telegram alert

สำหรับรัน backend โดยตรง ให้ตั้งค่าที่ [backend/.env.example](backend/.env.example) แล้วคัดลอกเป็น `backend/.env` โดย `MQTT_BROKER_URL` ต้องชี้ไปยัง broker ที่เข้าถึงได้จากเครื่อง backend เช่น `mqtt://localhost:1883`; เว้นค่าว่างได้หากทดสอบ REST อย่างเดียว

Telegram ต้องกำหนดทั้ง `TELEGRAM_BOT_TOKEN` และ `TELEGRAM_CHAT_ID` (สร้าง bot ผ่าน BotFather และให้ bot เข้าถึงห้องแชตที่จะรับแจ้งเตือน) เมื่อเกิด WARNING/CRITICAL ใหม่หรือ severity เพิ่มขึ้น backend จะส่งรายงานภาษาไทยจากข้อมูลในฐานข้อมูลทันที โดยแสดง metric/value/threshold, snapshot อุณหภูมิ/ความชื้น/ความดัน, เวลาไทย (Asia/Bangkok), สถิติ min/avg/max ย้อนหลัง 24 ชั่วโมง และจำนวน alert แยก severity หากค่าเดิมยังผิดปกติ จะส่งรายงานซ้ำได้ไม่ถี่กว่า 5 นาทีต่อ alert/sensor; ระยะนี้บันทึกในฐานข้อมูลจึงคงอยู่หลัง backend restart ส่วน escalation และการ resolve จะแจ้งทันที; alert row เดิมจะไม่ถูกทำซ้ำ นอกจากนี้ backend ส่งรายงานจากฐานข้อมูลทุกวันเวลา 08:00 น. เวลาไทย รายงานของวันเดียวกันจะไม่ส่งซ้ำหลัง backend restart; หากส่งไม่สำเร็จจะลองใหม่ในรอบตรวจถัดไปประมาณ 30 วินาที

การใช้ห้องแสดง `PRESENCE DETECTED` เมื่อ `presence=true`; `motion=true` มี precedence และเป็น `MOTION DETECTED`; dashboard แสดง `NO PRESENCE` เมื่อ telemetry ระบุทั้ง `presence=false` และ `motion=false` ต่อเนื่องครบ 1 นาที โดยเริ่มนับจากเวลาที่ backend รับ reading ครั้งแรก การขาด field ใด field หนึ่งจะไม่เริ่ม/ดำเนินการยืนยันการไม่อยู่และ dashboard แสดง `OCCUPANCY UNKNOWN` เมื่อไม่มีข้อมูล occupancy ที่สด สถานะและเวลาเริ่มนับถูกเก็บใน SQLite จึงกู้ timer หลัง backend restart ได้ สถานะห้องปัจจุบันจะแนบในรายงาน Telegram ของ WARNING/CRITICAL แทนการส่งข้อความสถานะห้องแยก หากไม่มีข้อมูล occupancy ใหม่จะแสดง `UNKNOWN`; การยืนยัน NO PRESENCE ที่ยังนับเวลาอยู่จะแสดงกำกับในรายงานด้วย หากไม่ได้กำหนด Telegram ครบ ระบบจะปิดการส่งและบันทึกคำเตือน โดยไม่ขัดขวางการรับ telemetry; ความล้มเหลวหรือ timeout จาก Telegram จะไม่ทำให้ ingest ล้มเหลว เก็บ token ใน environment ของ deployment เท่านั้น ห้าม commit token หรือ chat ID จริงลง repository.

### ตั้งค่า M5Stack firmware

คัดลอก `M5_Server_Monitor/secrets.example.h` เป็น `M5_Server_Monitor/secrets.h` แล้วกรอก Wi-Fi SSID/password ในไฟล์ local นี้ก่อน build firmware:

```powershell
Copy-Item M5_Server_Monitor/secrets.example.h M5_Server_Monitor/secrets.h
```

ไฟล์ `secrets.h` ถูก ignore โดย Git และห้าม commit credentials ลง source control หากยังเป็นค่าว่าง firmware จะแจ้งข้อความทาง Serial และไม่เริ่มพยายามเชื่อม Wi-Fi
ค่า `SERVER_URL` ใน firmware ต้องชี้ไปยัง IP ของเครื่อง backend ที่ M5Stack เข้าถึงได้ โดย Compose ใช้ host port `5001` เป็นค่าเริ่มต้น (port `5000` ภายใน container)

Firmware อ่าน temperature/humidity/pressure จาก ENV unit และอ่าน presence/motion จาก STHS34PF80 ใน TMOS PIR ที่ register `FUNC_STATUS` (`0x25`); ถ้าอ่านสถานะไม่ได้จะไม่ส่งค่า presence/motion เพื่อแยกข้อมูลที่ขาดออกจากค่า "ไม่พบ". สถานะ temperature `CRITICAL` ใช้ค่าต่ำกว่า `15°C` หรือสูงกว่า `32°C` ส่วนค่า warning ใช้ threshold ที่ตั้งใน backend. Backend รองรับ field `smoke_detected` และ `water_leak` แต่บอร์ดชุดปัจจุบันยังไม่มี sensor สองชนิดนี้ จึงยังไม่ส่ง/ทดสอบค่าจาก hardware จริง

ทดสอบ Wi-Fi reconnect บนอุปกรณ์ได้โดยเปิด Serial Monitor ที่ `115200` baud แล้วกดปุ่ม A บน M5Stack หนึ่งครั้ง Firmware จะตัด Wi-Fi ชั่วคราวประมาณ 1.5 วินาที จากนั้น reconnect และส่ง telemetry ต่อ ควรเห็น log ว่า disconnected, reconnected และ HTTP `201` กลับมา โดยไม่แสดง credentials

สำหรับทดสอบ TMOS PIR ให้ดูบรรทัด `STHS34PF80 FUNC_STATUS` ใน Serial Monitor แล้วขยับมือหรือวัตถุอุ่นเข้า-ออกบริเวณตรวจจับ ค่าควรเปลี่ยนระหว่าง presence+motion และ presence-only; เมื่อ I²C อ่านไม่ได้ firmware จะแสดง `N/A` และละ field เหล่านี้ใน telemetry

## API และ Real-time Events

- `GET /health`: health check
- `POST /api/v1/sensors/data`: รับข้อมูล sensor; firmware เดิมรองรับผ่าน `POST /api/telemetry`
- `GET /api/v1/sensors/latest`: reading ล่าสุด
- `GET /api/v1/room-usage`: สถานะห้อง `NO PRESENCE`, `PRESENCE DETECTED`, `MOTION DETECTED` หรือ `UNKNOWN` พร้อมข้อมูล absence confirmation ล่าสุด
- `GET /api/v1/sensors/history?range=24h`: history สำหรับกราฟ (`range` รองรับ `m`, `h`, `d` สูงสุด 30 วัน)
- `GET /api/v1/alerts`: alert history; ใช้ `?resolved=false` เพื่อกรอง active alerts
- `PUT /api/v1/alerts/:id/resolve`: acknowledge/resolve alert
- `GET /api/v1/settings/thresholds` และ `PUT /api/v1/settings/thresholds`: อ่าน/แก้ thresholds
- Socket.IO: ส่ง named events `sensor:updated`, `alert:new` และ `alert:resolved` โดย payload คือข้อมูล event โดยตรง
- Socket.IO ส่ง `room:usage-updated` เมื่อข้อมูล occupancy หรือสถานะเปลี่ยน
- Legacy WebSocket `/ws`: คงรูปแบบ event envelope `{ type, data }` สำหรับ client เดิม

ตัวอย่างส่งข้อมูล:

```powershell
$body = @{
  sensor_id = "rack-01"
  temperature = 23.4
  humidity = 48.0
  pressure = 1012
  smoke_detected = $false
  water_leak = $false
  status = "NORMAL"
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:5001/api/v1/sensors/data -Method Post -ContentType "application/json" -Body $body
```

## พัฒนาแบบ Local

เปิด PowerShell แยก 2 หน้าต่าง จาก root ของ repository:

```powershell
Push-Location backend
Copy-Item .env.example .env
npm ci
npm run dev
```

```powershell
Push-Location frontend
npm ci
npm run dev -- --host 0.0.0.0
```

เปิด Vite URL ที่แสดงใน terminal โดย frontend dev mode จะเชื่อม backend ที่พอร์ต `5000` ค่าเริ่มต้น ตรวจ frontend ได้ด้วย `npm run lint` และ `npm run build`; backend tests รันด้วย `npm test` จากโฟลเดอร์ `backend`

## Logs และหยุดระบบ

ดู logs:

```powershell
docker compose logs -f backend frontend mqtt-broker
```

หยุดและลบ containers/network โดยคงข้อมูล named volumes ไว้:

```powershell
docker compose down
```

อย่าเพิ่ม `-v` เว้นแต่ตั้งใจลบ SQLite telemetry และ MQTT persistence ที่เก็บใน named volumes ควรสำรองข้อมูลก่อนทำ maintenance หรือเปลี่ยนระบบ

## ความปลอดภัยก่อนใช้งานจริง

Mosquitto ใน Compose นี้เปิด anonymous access เฉพาะ network ภายใน Compose และไม่ได้ publish port `1883` ออก host โดยค่าเริ่มต้น อย่าเปิด broker นี้สู่ LAN/Internet โดยไม่ตั้ง username/password, TLS และ firewall ก่อน เก็บ token/credentials ไว้ใน `.env` หรือ secret manager เท่านั้น และเปลี่ยนค่าตัวอย่างทั้งหมดก่อน production deployment

Backend API ยังไม่มี authentication และ Compose publish API port เพื่อรองรับ simulator/อุปกรณ์ IoT ดังนั้นให้ใช้เฉพาะ trusted network และกำหนด firewall; ก่อนเปิดใช้งานบนเครือข่ายที่ไม่เชื่อถือ ควรเพิ่ม authentication และ TLS หรือวาง API หลัง gateway ที่ควบคุมการเข้าถึง
