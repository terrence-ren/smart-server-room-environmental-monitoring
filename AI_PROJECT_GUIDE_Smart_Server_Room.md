# คู่มือให้ AI พัฒนาระบบ Smart Server Room Environmental Monitoring ตั้งแต่เริ่มต้นจนทดสอบใช้งานได้

> เอกสารนี้เป็น **Project Brief + ขั้นตอนปฏิบัติงานสำหรับ AI Coding Agent ใน VS
> Code** ใช้เป็นแหล่งอ้างอิงหลักระหว่างสร้าง ตรวจสอบ และทดสอบระบบ\
> ชื่อโครงงาน: **ระบบเฝ้าระวังและแจ้งเตือนสภาพแวดล้อมห้องเซิร์ฟเวอร์อัจฉริยะ (Smart
> Server Room Environmental Monitoring and Alert System)**

---

## 1. บทบาทและเป้าหมายของ AI

คุณคือ AI Software Engineer ที่ทำงานภายใน Visual Studio Code
โดยต้องช่วยพัฒนาระบบให้ครบวงจร ไม่ใช่เพียงเขียนตัวอย่างโค้ดแยกส่วน
เป้าหมายคือสร้างโค้ดและเอกสารที่ผู้ใช้สามารถติดตั้ง ตั้งค่า ทดสอบ
และนำไปใช้งานบนเครือข่ายภายในได้

ทำงานเป็นขั้นตอนดังนี้:

1.  ตรวจสอบไฟล์และโครงสร้างโปรเจกต์ที่มีอยู่ก่อน ห้ามเขียนทับไฟล์เดิมโดยไม่ตรวจสอบ
2.  ตรวจสอบสภาพแวดล้อมและเวอร์ชันของเครื่องมือที่ติดตั้งได้
3.  วางโครงสร้างโปรเจกต์และกำหนดสัญญาข้อมูล (data contract) ให้ตรงกันทุกส่วน
4.  พัฒนาฐานข้อมูล MySQL และ PHP API
5.  พัฒนาเฟิร์มแวร์ Arduino สำหรับ M5Stack Basic v2.6
6.  พัฒนาหน้า Dashboard สำหรับดูข้อมูลล่าสุด ประวัติ และสถานะ
7.  เพิ่มระบบแจ้งเตือนตามขอบเขตที่ตกลงกัน โดยถ้ายังไม่มีผู้ให้บริการแจ้งเตือน
    ให้ทำระบบแจ้งเตือนใน Dashboard ก่อนและระบุว่ายังไม่ได้เชื่อมต่อ Messaging
    service
8.  สร้างไฟล์ `.env.example` หรือไฟล์ตั้งค่าตัวอย่าง โดยห้ามฝังรหัสผ่านจริงหรือ API Key
    จริงใน source control
9.  ทดสอบแต่ละส่วนและการเชื่อมต่อระหว่างส่วน
10. เขียนคู่มือติดตั้ง/ใช้งาน/แก้ปัญหา และสรุปสิ่งที่ทดสอบผ่านหรือยังไม่ผ่าน
11. อย่าอ้างว่าระบบทำงานจริงจนกว่าจะมีผลทดสอบที่ยืนยันได้จากสภาพแวดล้อมของผู้ใช้
12. หากขาดข้อมูลสำคัญ ให้ตรวจสอบจากไฟล์โปรเจกต์และโค้ดเดิมก่อน ถ้ายังขาด
    ให้ถามเฉพาะคำถามที่จำเป็น ห้ามเดาค่ารหัสผ่าน IP หรือ API Key

### หลักการทำงานใน VS Code

- ใช้ Terminal ใน VS Code สำหรับคำสั่งที่เกี่ยวข้องกับโปรเจกต์
- อ่านไฟล์ก่อนแก้ไข และทำการเปลี่ยนแปลงทีละส่วน
- ใช้ชื่อไฟล์และโครงสร้างที่อ่านเข้าใจง่าย
- หลังแก้โค้ด ให้รัน formatter/linter/test ที่มีอยู่จริงในโปรเจกต์
- หากคำสั่งต้องใช้สิทธิ์ผู้ดูแลหรือมีผลต่อฐานข้อมูลจริง ให้แจ้งผู้ใช้ก่อน
- ห้ามลบฐานข้อมูล ตาราง หรือข้อมูลเดิมเพื่อให้การทดสอบผ่าน
- แยกค่าความลับออกจากโค้ด และไม่แสดงความลับใน log
- หากไม่มีสิทธิ์เข้าถึงอุปกรณ์จริง ให้ทำ static checks และ mock tests
  แล้วบอกชัดเจนว่าต้องทดสอบบนฮาร์ดแวร์จริงอีกครั้ง

---

## 2. เป้าหมายของระบบ

ระบบต้องเฝ้าระวังสภาพแวดล้อมห้องเซิร์ฟเวอร์อย่างต่อเนื่อง โดยใช้:

- **M5Stack Basic v2.6 (ESP32)** เป็นหน่วยควบคุม ประมวลผล และแสดงข้อมูลบนจอ
- **Unit ENV-III** ประกอบด้วย SHT30 สำหรับอุณหภูมิ/ความชื้น และ QMP6988
  สำหรับความดันบรรยากาศ
- **Unit TMOS PIR** ซึ่งใช้ STHS34PF80 สำหรับตรวจจับ presence และ motion
- **Wi-Fi** สำหรับเชื่อมต่อกับเครื่องเซิร์ฟเวอร์ภายในเครือข่ายเดียวกัน
- **PHP API** เป็นจุดรับข้อมูลจาก M5Stack
- **MySQL Server** เป็นฐานข้อมูล
- **HeidiSQL** เป็นโปรแกรม GUI สำหรับดูแลฐานข้อมูล ไม่ใช่ตัวรับข้อมูลจากเซนเซอร์
- **Web Dashboard** สำหรับดูข้อมูลล่าสุด ประวัติ และสถานะ
- **ระบบแจ้งเตือน** เมื่อข้อมูลเข้าเกณฑ์ WARNING หรือ CRITICAL

### ลำดับการไหลของข้อมูล

```text
ENV-III + TMOS PIR
        |
        | I2C
        v
M5Stack Basic v2.6 / ESP32
  - อ่านและตรวจสอบข้อมูล
  - คำนวณสถานะ NORMAL/WARNING/CRITICAL
  - แสดงผลบนจอ
        |
        | Wi-Fi + HTTP POST + JSON + X-API-Key
        v
PHP API บนเครื่องเดียวกับ MySQL Server
  - ตรวจสอบ API Key
  - ตรวจสอบ JSON และชนิดข้อมูล
  - ปฏิเสธข้อมูลไม่ถูกต้อง
        |
        | PDO prepared statement
        v
MySQL: smart_server_room.sensor_data
        |
        +----> Dashboard / ประวัติข้อมูล
        |
        +----> การแจ้งเตือนใน Dashboard
```

**ข้อจำกัดของเครือข่าย:** M5Stack ต้องเรียก URL ด้วย IP หรือ hostname
ที่เข้าถึงเครื่องเซิร์ฟเวอร์ได้ ห้ามใช้ `localhost` ในเฟิร์มแวร์ เพราะ `localhost`
จะหมายถึงตัว M5Stack เอง ไม่ใช่เครื่อง PHP/MySQL

---

## 3. สัญญาข้อมูล (Data Contract) --- ทุกส่วนต้องใช้ให้ตรงกัน

ใช้ชื่อฟิลด์เหล่านี้เหมือนกันใน Arduino JSON, PHP validation, MySQL และ Dashboard:

ฟิลด์ ชนิด/หน่วย ตัวอย่าง เงื่อนไข

---

`temperature` number, °C `24.75` -40 ถึง 120
`humidity` number, %RH `48.20` 0 ถึง 100
`pressure` number, hPa `1008.40` 300 ถึง 1100
`presence` integer 0/1 `1` 0 = ไม่พบ, 1 = พบ
`motion` integer 0/1 `0` 0 = ไม่พบ, 1 = พบ
`status` string `"NORMAL"` `NORMAL`, `WARNING`, `CRITICAL`

ตัวอย่าง JSON:

```json
{
  "temperature": 24.75,
  "humidity": 48.2,
  "pressure": 1008.4,
  "presence": 1,
  "motion": 0,
  "status": "NORMAL"
}
```

ข้อกำหนดเพิ่มเติม:

- PHP เป็นผู้กำหนด `recorded_at` ด้วยเวลาเซิร์ฟเวอร์เมื่อบันทึกข้อมูล เพื่อให้ทุกแถวมี
  timestamp จากแหล่งเดียวกัน
- ตั้ง timezone ของ PHP/MySQL ให้ชัดเจน เช่น `Asia/Bangkok`
  และตรวจสอบเวลาของระบบปฏิบัติการเซิร์ฟเวอร์
- `pressure` ต้องส่งเป็น **hPa** หากค่าจากไลบรารีเป็น Pa ให้หาร 100 ก่อนส่ง
- `presence` และ `motion` ต้องเป็นเลขจำนวนเต็ม `0` หรือ `1` ไม่ใช่ข้อความ
  `"true"`/`"false"`
- หากเซนเซอร์อ่านไม่ได้ อย่าส่งค่าเริ่มต้น `0` เป็นค่าจริงโดยไม่ระบุ
  เพราะจะทำให้ข้อมูลดูเหมือนถูกต้องทั้งที่อ่านไม่สำเร็จ
- ห้ามให้ Dashboard แสดงข้อมูลจำลองเป็นข้อมูลจริงโดยไม่ติดป้าย `DEMO` หรือ `MOCK`

---

## 4. เกณฑ์สถานะและการแจ้งเตือน

ให้เก็บเกณฑ์ไว้ในไฟล์ตั้งค่าหรือส่วน configuration เดียว ไม่กระจายตัวเลขไว้หลายไฟล์

เกณฑ์เริ่มต้นสำหรับ **ต้นแบบของโครงงาน**:

- `NORMAL`: อุณหภูมิ 18--27 °C
- `WARNING`: อุณหภูมิต่ำกว่า 18 °C หรือสูงกว่า 27 °C แต่ยังไม่ถึงเกณฑ์ CRITICAL
- `CRITICAL`: อุณหภูมิต่ำกว่า 15 °C หรือสูงกว่า 32 °C

สำหรับความชื้น อาจกำหนดเกณฑ์ต้นแบบเพิ่มเติม: - WARNING เมื่อความชื้นสูงกว่า 60% RH -
CRITICAL เมื่อความชื้นสูงกว่า 80% RH

ควรคำนวณสถานะจาก **ทั้งอุณหภูมิและความชื้น** โดยให้ระดับที่รุนแรงที่สุดเป็นสถานะรวม:
`CRITICAL` มีลำดับสูงกว่า `WARNING` และ `WARNING` สูงกว่า `NORMAL`

ตัวอย่างตรรกะ:

1.  ถ้าอุณหภูมิ `< 15` หรือ `> 32` หรือความชื้น `> 80` → `CRITICAL`
2.  มิฉะนั้น ถ้าอุณหภูมิ `< 18` หรือ `> 27` หรือความชื้น `> 60` → `WARNING`
3.  มิฉะนั้น → `NORMAL`

**หมายเหตุสำคัญ:** ตัวเลขข้างต้นเป็นเกณฑ์ต้นแบบสำหรับการพัฒนา
ไม่ใช่คำยืนยันว่าเหมาะกับเซิร์ฟเวอร์ทุกชนิดหรือเป็นเกณฑ์แจ้งเตือนอย่างเป็นทางการของ ASHRAE
โดยตรง ต้องตรวจสอบข้อกำหนดอุปกรณ์และนโยบายของสถานที่ก่อนใช้งานจริง

ระบบควรแจ้งเตือนเมื่อสถานะเปลี่ยนเข้าสู่ WARNING/CRITICAL และควรมี cooldown หรือ
deduplication เพื่อไม่ส่งแจ้งเตือนซ้ำถี่เกินไป ส่วนการส่ง LINE/Telegram/Email
ต้องถือว่าเป็นงานที่ยังไม่เสร็จจนกว่าจะมี credentials และทดสอบกับผู้ให้บริการจริง

---

## 5. โครงสร้างโฟลเดอร์ที่แนะนำ

หากยังไม่มีโครงสร้างเดิม ให้สร้างดังนี้:

```text
smart-server-room/
├── README.md
├── AI_PROJECT_GUIDE.md
├── .gitignore
├── .env.example
├── database/
│   ├── schema.sql
│   └── sample_queries.sql
├── server/
│   ├── config/
│   │   └── config.example.php
│   ├── public/
│   │   ├── receive.php
│   │   ├── latest.php
│   │   ├── history.php
│   │   └── index.php
│   ├── src/
│   │   ├── db.php
│   │   ├── validation.php
│   │   └── status.php
│   └── tests/
│       └── api_test.md
├── firmware/
│   └── SmartServerRoom/
│       └── SmartServerRoom.ino
├── docs/
│   ├── INSTALL.md
│   ├── TEST_PLAN.md
│   ├── TROUBLESHOOTING.md
│   └── SYSTEM_FLOW.md
└── .vscode/
    ├── extensions.json
    └── tasks.json
```

ปรับตามโครงสร้างเดิมได้ อย่าสร้างไฟล์ซ้ำหรือย้ายไฟล์โดยไม่จำเป็น หากใช้ XAMPP ให้
`server/public` อาจถูกตั้งเป็น document root หรือคัดลอกเฉพาะ public files
ไปยังโฟลเดอร์เว็บของ XAMPP ตามคู่มือติดตั้ง

---

## 6. ขั้นตอนที่ 1 --- ตรวจสอบและเตรียมเครื่องมือ

AI ต้องตรวจสอบก่อนว่าเครื่องมีอะไรแล้ว:

- Visual Studio Code
- Git (ถ้าจะใช้ version control)
- PHP ที่มี PDO MySQL driver
- MySQL Server ที่ทำงานได้
- HeidiSQL (สำหรับจัดการฐานข้อมูล)
- Arduino IDE 2.x หรือ toolchain ที่ผู้ใช้เลือก
- บอร์ด M5Stack Basic v2.6 และสาย USB ที่ส่งข้อมูลได้
- Wi-Fi 2.4 GHz ที่ M5Stack เข้าถึงได้
- ENV-III และ TMOS PIR พร้อมสาย/Hub ที่เหมาะสม

### สิ่งที่ AI ควรตรวจใน Terminal

คำสั่งอาจต่างกันตามระบบปฏิบัติการ ให้รันเฉพาะคำสั่งที่รองรับ:

```bash
php -v
php -m
git --version
```

ตรวจว่ามี `PDO` และ `pdo_mysql` ในผล `php -m` หากไม่มี ให้ติดตั้ง/เปิดใช้งาน
extension ก่อน

หาก PHP อยู่ใน XAMPP ให้ตรวจเวอร์ชัน PHP จาก XAMPP Control Panel หรือเรียก
executable ของ PHP ที่มากับ XAMPP โดยตรง

**ห้าม** ให้ AI ติดตั้งโปรแกรม เปลี่ยน firewall หรือแก้ configuration
ระบบปฏิบัติการโดยไม่แจ้งผู้ใช้ก่อน

---

## 7. ขั้นตอนที่ 2 --- สร้างฐานข้อมูล MySQL

ใช้ HeidiSQL เชื่อมต่อกับ MySQL Server ด้วยบัญชีที่มีสิทธิ์สร้างฐานข้อมูลและตาราง
จากนั้นเปิด Query tab และรัน SQL นี้ หากมีฐานข้อมูลเดิม ให้ตรวจสอบก่อนและห้ามลบข้อมูล:

```sql
CREATE DATABASE IF NOT EXISTS smart_server_room
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE smart_server_room;

CREATE TABLE IF NOT EXISTS sensor_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    temperature DECIMAL(5,2) NOT NULL,
    humidity DECIMAL(5,2) NOT NULL,
    pressure DECIMAL(7,2) NOT NULL,
    presence TINYINT(1) NOT NULL,
    motion TINYINT(1) NOT NULL,
    status ENUM('NORMAL', 'WARNING', 'CRITICAL') NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_recorded_at (recorded_at),
    INDEX idx_status_recorded_at (status, recorded_at)
) ENGINE=InnoDB;
```

สร้างไฟล์ `database/schema.sql` เก็บ SQL ชุดนี้ไว้ในโปรเจกต์เพื่อให้ทำซ้ำได้

### ตรวจสอบผล

```sql
USE smart_server_room;

SHOW TABLES;

DESCRIBE sensor_data;

SELECT id, recorded_at, temperature, humidity, pressure,
       presence, motion, status
FROM sensor_data
ORDER BY id DESC
LIMIT 20;
```

อย่าลบหรือ reset ตารางจริงเพื่อทดสอบ หากต้องการทดสอบ insert
ให้ใช้แถวทดสอบที่ระบุชัดเจน หรือฐานข้อมูลทดสอบแยกต่างหาก

---

## 8. ขั้นตอนที่ 3 --- สร้าง PHP API

PHP API เป็นตัวกลางรับ HTTP POST จาก ESP32 แล้วบันทึกข้อมูลลง MySQL

### 8.1 การตั้งค่า

สร้างไฟล์ตั้งค่าจาก template โดยมีตัวแปรอย่างน้อย:

- Host และ port ของ MySQL
- Database name: `smart_server_room`
- Username/password ของ MySQL
- API Key แบบสุ่มและยาว
- Timezone: `Asia/Bangkok`

ห้าม commit รหัสผ่านจริงหรือ API Key จริงลง Git ให้เพิ่มไฟล์ที่มี secrets ลง
`.gitignore` และเก็บเฉพาะไฟล์ตัวอย่างที่ไม่มีความลับ เช่น `config.example.php` หรือ
`.env.example`

ถ้า PHP และ MySQL อยู่เครื่องเดียวกัน อาจใช้ host `127.0.0.1` และ port `3306`
ได้เมื่อ MySQL ฟังอยู่ที่ค่านั้นจริง แต่ถ้าใช้พอร์ตหรือ socket ต่างออกไป ให้ปรับตามการติดตั้ง

### 8.2 ข้อกำหนดของ `receive.php`

ต้องมีคุณสมบัติดังนี้:

1.  รับเฉพาะ HTTP `POST`
2.  ตรวจ `Content-Type: application/json`
3.  ตรวจ header `X-API-Key` ด้วยการเปรียบเทียบที่ปลอดภัย
4.  อ่าน JSON และปฏิเสธ JSON ที่ผิดรูปแบบ
5.  ตรวจว่ามีทุกฟิลด์ที่จำเป็นและชนิดข้อมูลถูกต้อง
6.  ตรวจช่วงค่า temperature, humidity, pressure และ presence/motion
7.  ตรวจ status ว่าเป็น `NORMAL`, `WARNING` หรือ `CRITICAL`
8.  ใช้ PDO prepared statements เท่านั้น ห้ามต่อ SQL ด้วย string จาก request
9.  บันทึกลง `sensor_data`
10. ตอบกลับ JSON ที่อ่านเข้าใจง่าย
11. ใช้ HTTP status ที่เหมาะสม เช่น 200/201 เมื่อสำเร็จ, 400 เมื่อข้อมูลผิด, 401 เมื่อ
    API Key ไม่ถูกต้อง, 405 เมื่อ method ไม่รองรับ และ 500
    เมื่อเกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์
12. ห้ามส่งรายละเอียดรหัสผ่านหรือ stack trace กลับไปยัง client
13. เขียน error log ฝั่งเซิร์ฟเวอร์โดยไม่บันทึก API Key
14. กำหนด timezone อย่างชัดเจน

ตัวอย่าง response เมื่อสำเร็จ:

```json
{
  "success": true,
  "message": "Data saved",
  "id": 123
}
```

**สัญญาระหว่าง ESP32 กับ PHP ต้องตรงกัน:** header คือ `X-API-Key`; body ใช้
`temperature`, `humidity`, `pressure`, `presence`, `motion`, `status`
ตามตารางในหัวข้อ 3

### 8.3 API สำหรับ Dashboard

สร้าง endpoint แบบ read-only เพิ่มเติม:

- `GET /latest.php` --- คืนค่ารายการล่าสุดหนึ่งรายการ
- `GET /history.php?limit=100` --- คืนค่าประวัติตามจำนวนที่จำกัด
- ถ้าต้องกรองตามวันหรือ status ให้ validate query parameters และใช้ prepared
  statements

อย่าเปิด endpoint ที่อ่านข้อมูลหรือแก้ไขฐานข้อมูลโดยไม่มีการควบคุมสิทธิ์ตามความจำเป็น

---

## 9. ขั้นตอนที่ 4 --- ทดสอบ PHP API ก่อนต่อฮาร์ดแวร์

ก่อนใช้ M5Stack ต้องทดสอบ API แยกให้ผ่านก่อน โดยใช้ `curl`, REST Client
extension ใน VS Code หรือเครื่องมือ HTTP ที่มีอยู่

ตัวอย่างคำสั่ง (แทน URL และ API Key ให้เป็นค่าจริงในเครื่องของผู้ใช้):

```bash
curl -i -X POST "http://127.0.0.1/server-room-api/receive.php" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_REAL_API_KEY" \
  -d "{\"temperature\":24.75,\"humidity\":48.20,\"pressure\":1008.40,\"presence\":1,\"motion\":0,\"status\":\"NORMAL\"}"
```

หากทดสอบจากเครื่องอื่นใน LAN ให้เปลี่ยน `127.0.0.1` เป็น IP ของเครื่องเซิร์ฟเวอร์
และตรวจ firewall/เว็บเซิร์ฟเวอร์

หลัง POST สำเร็จ ให้ตรวจใน HeidiSQL ว่ามี row ใหม่เกิดขึ้นจริง หาก API
ตอบสำเร็จแต่ไม่มีข้อมูล ให้ตรวจ database name, credentials, PHP error log และ
transaction/insert code

### กรณีทดสอบที่ต้องมี

- POST JSON ที่ถูกต้อง → บันทึกข้อมูลสำเร็จ
- API Key ผิดหรือไม่มี → 401
- method ไม่ใช่ POST → 405
- JSON เสียรูปแบบ → 400
- ฟิลด์หายหรือชนิดข้อมูลผิด → 400
- temperature/humidity/pressure เกินช่วง → 400
- status ไม่อยู่ในรายการที่อนุญาต → 400
- MySQL ปิดหรือ credentials ผิด → API ตอบ 500 โดยไม่เปิดเผย secret

---

## 10. ขั้นตอนที่ 5 --- พัฒนา Firmware สำหรับ M5Stack Basic v2.6

### 10.1 Libraries

ตรวจสอบเอกสารผู้ผลิตและเวอร์ชันไลบรารีก่อนเขียนโค้ดจริง ไลบรารีที่อาจเกี่ยวข้อง ได้แก่:

- M5Stack / M5Unified ตามแนวทางที่ใช้กับ Core Basic v2.6
- M5Unit-ENV สำหรับ Unit ENV-III
- ไลบรารีที่รองรับ Unit TMOS PIR / STHS34PF80
- ArduinoJson
- WiFi และ HTTPClient ซึ่งมากับ ESP32 Arduino core

AI ต้องยืนยันชื่อ header, method, enum และ API ของไลบรารีที่ติดตั้งจริง ห้ามสมมติว่า
method จากตัวอย่างต่างเวอร์ชันใช้ได้เหมือนกันทั้งหมด หาก compile error ให้ตรวจ
README/example ของเวอร์ชันนั้นและปรับโค้ดตาม API จริง

### 10.2 การเชื่อมต่อฮาร์ดแวร์

- M5Stack Basic v2.6 เป็น ESP32 controller
- ENV-III ใช้ SHT30 และ QMP6988 ผ่าน I²C
- TMOS PIR ใช้ STHS34PF80 ผ่าน I²C
- I²C address ที่คาดหมาย: SHT30 `0x44`, QMP6988 `0x70`, TMOS PIR `0x5A`
- บน M5Stack Basic โดยทั่วไป I²C ใช้ SDA GPIO 21 และ SCL GPIO 22
  แต่ต้องตรวจเอกสารและการต่อจริงของอุปกรณ์
- ใช้ I²C hub/สายแยกที่เหมาะสมเมื่อต้องต่อ Unit มากกว่าหนึ่งตัว
  และตรวจแรงดัน/ขั้วสายก่อนจ่ายไฟ

ให้ทำ I²C scanner หรือใช้ตัวอย่างผู้ผลิตเพื่อตรวจพบ address ก่อนพัฒนา logic เต็มรูปแบบ

### 10.3 Firmware ต้องมีพฤติกรรมดังนี้

1.  เริ่ม serial logging และจอ M5Stack
2.  เชื่อม Wi-Fi และแสดง IP address เมื่อเชื่อมต่อสำเร็จ
3.  อ่าน SHT30, QMP6988 และ TMOS PIR ตามช่วงเวลาที่กำหนด
4.  ตรวจสอบค่าที่อ่านได้ก่อนใช้ และไม่ส่งค่าที่อ่านล้มเหลวเป็นศูนย์
5.  แปลงความดันเป็น hPa ให้ตรงกับ API
6.  คำนวณ status โดยใช้กติกาเดียวกับที่ประกาศใน config/API
7.  สร้าง JSON ตาม data contract
8.  ส่ง HTTP POST ไปยัง `receive.php` พร้อม
    `Content-Type: application/json` และ `X-API-Key`
9.  ตรวจ HTTP response และแสดงผล status code/ข้อความที่ปลอดภัยใน Serial
    Monitor
10. เมื่อ Wi-Fi หรือ API ล้มเหลว ให้ลองใหม่ด้วย interval ที่จำกัด ไม่วนส่งรัว
11. เก็บคิวข้อมูลรอส่งได้ตามขนาดที่กำหนด และกำหนดนโยบายเมื่อคิวเต็ม
12. หลีกเลี่ยงการใช้ `delay()` ยาว ๆ ที่ทำให้การอ่าน sensor
    และการกู้คืนเครือข่ายหยุดชะงัก
13. ไม่แสดง API Key ใน Serial Monitor หรือจอ
14. แสดงอุณหภูมิ ความชื้น ความดัน Presence, Motion, Status, Wi-Fi
    และจำนวนคิวบนจอ
15. หากอุปกรณ์ sensor ใดไม่พร้อม ให้แสดง error แยกเป็นรายตัวและ retry
    initialization ตามช่วงเวลา

### 10.4 การออกแบบ retry และ queue

- แยก timer สำหรับอ่าน sensor, ส่งข้อมูล, retry Wi-Fi และ retry
  initialization ของ sensor
- ไม่ใช้ timer ตัวเดียวร่วมหลายงาน
- ลบรายการออกจากคิวเมื่อ API ตอบว่าสำเร็จเท่านั้น
- หากคิวเต็ม ต้อง log ว่ามีการทิ้งข้อมูล ไม่ควรทำเหมือนไม่มีปัญหา
- การเก็บคิวใน RAM จะหายเมื่อไฟดับหรือรีสตาร์ต หากต้องการคงข้อมูลหลังไฟดับให้พิจารณา
  NVS/LittleFS/SD card และออกแบบเพิ่มอย่างชัดเจน
- ระวังการส่งซ้ำเมื่อ server บันทึกสำเร็จแล้วแต่ response หาย หากต้องการ
  exactly-once semantics ต้องเพิ่ม event ID/unique key ฝั่งฐานข้อมูลและ API

### 10.5 ข้อกำหนดเรื่องสถานะ

ควรให้ firmware และ API มีแหล่งอ้างอิงเกณฑ์เดียวกัน หรือให้ API คำนวณ status
เองจากค่าดิบเพื่อป้องกัน client ส่ง status ที่ไม่ตรงกับค่าจริง หากเลือกให้ API คำนวณ
ให้แก้ data contract และ firmware ให้สอดคล้องกันก่อนทดสอบ

---

## 11. ขั้นตอนที่ 6 --- พัฒนา Dashboard

Dashboard ขั้นต่ำควรมี:

- ค่าอุณหภูมิ ความชื้น และความดันล่าสุด
- Presence และ Motion ล่าสุด
- Status badge NORMAL/WARNING/CRITICAL
- เวลาอัปเดตล่าสุด
- ตารางข้อมูลย้อนหลัง โดยแสดง `recorded_at`
- ตัวกรองช่วงเวลาและ status (ถ้าทำได้)
- แจ้งเตือนบนหน้าเว็บเมื่อสถานะเป็น WARNING/CRITICAL
- แสดงสถานะ offline หากไม่มีข้อมูลใหม่เกิน timeout ที่กำหนด
- ข้อความ error ที่เข้าใจได้ หาก API/ฐานข้อมูลใช้งานไม่ได้

### ข้อกำหนดความปลอดภัย

- Escape ข้อมูลก่อนแสดงใน HTML
- ใช้ prepared statements สำหรับ query
- จำกัดจำนวนแถว history ที่ดึงกลับ
- อย่าใส่ MySQL credentials หรือ API Key ใน JavaScript ฝั่ง browser
- ถ้า Dashboard เข้าถึงจากนอก LAN ให้เพิ่ม authentication, HTTPS
  และการป้องกันตามความเหมาะสม
- หากยังไม่ได้สร้าง dashboard จริง ให้ระบุว่าเป็น TODO ห้ามอ้างว่ามีหน้าใช้งานแล้ว

---

## 12. ขั้นตอนที่ 7 --- ตั้งค่าใน VS Code

แนะนำ extensions ตามงานจริง:

- PHP Intelephense สำหรับ PHP
- PHP Debug หากมีการตั้งค่า Xdebug
- Arduino หรือ PlatformIO extension หากผู้ใช้เลือกใช้ toolchain นั้น
- REST Client สำหรับทดสอบ API (ไม่จำเป็นถ้าใช้ curl)
- SQLTools หรือส่วนเสริม MySQL เฉพาะเมื่อจำเป็น ทั้งนี้ HeidiSQL ยังคงใช้จัดการ
  MySQL ได้

AI ควรสร้าง `.vscode/extensions.json` เฉพาะ extension ที่ต้องการแนะนำ
และสร้าง `tasks.json` เฉพาะเมื่อรู้ path/คำสั่งที่ถูกต้องบนเครื่องนั้น ห้ามฝัง path
เฉพาะเครื่องหรือรหัสผ่านใน task

### `.gitignore` ขั้นต่ำ

```gitignore
.env
.env.*
!.env.example
server/config/config.php
server/config/config.local.php
*.log
.DS_Store
.vscode/settings.local.json
```

ตรวจให้แน่ใจว่าไฟล์ config ที่มี credentials ไม่ได้ถูก track อยู่แล้ว หากถูก track
ให้หยุดและแจ้งผู้ใช้ก่อนจัดการประวัติ Git

---

## 13. ขั้นตอนที่ 8 --- ทดสอบระบบครบวงจร

ทำตามลำดับ อย่าทดสอบทุกส่วนพร้อมกันตั้งแต่ครั้งแรก:

### Test A: ฐานข้อมูล

- MySQL Server ทำงาน
- ฐานข้อมูลและตารางมีอยู่
- PHP account เชื่อมต่อและ insert ได้

### Test B: PHP API

- POST ด้วย JSON ทดสอบสำเร็จ
- API Key ผิดถูกปฏิเสธ
- JSON/ค่าที่ผิดถูกปฏิเสธ
- row ใหม่ปรากฏใน HeidiSQL

### Test C: Sensor hardware

- I²C scan พบ address ที่คาดหมาย
- ENV-III อ่าน temperature/humidity/pressure ได้
- TMOS PIR อ่าน presence/motion ได้
- ค่าอ่านได้สมเหตุสมผลและไม่ค้าง

### Test D: Wi-Fi และ firmware

- M5Stack เชื่อม Wi-Fi และได้ IP
- M5Stack เข้าถึง URL ของ PHP API ผ่าน LAN ได้
- HTTP response สำเร็จ
- เมื่อปิด Wi-Fi ชั่วคราว ระบบยังทำงานโดยไม่ reset loop
  และกลับมาส่งข้อมูลได้เมื่อเชื่อมต่อใหม่

### Test E: Dashboard

- ค่า latest ตรงกับแถวล่าสุดใน MySQL
- history เรียงตามเวลา
- สถานะตรงกับเกณฑ์
- กรณีไม่มีข้อมูลใหม่ แสดง offline/stale data

### Test F: Alert

- เปลี่ยนค่าทดสอบให้เข้าสู่ WARNING และ CRITICAL ในสภาพแวดล้อมทดสอบ
- ตรวจว่าแจ้งเตือนเกิดขึ้นตามที่กำหนด
- ตรวจ cooldown/deduplication
- อย่าทำให้ห้องเซิร์ฟเวอร์จริงร้อนหรือชื้นเกินเกณฑ์เพื่อทดสอบ ให้ใช้ mock/test data

---

## 14. เกณฑ์รับมอบ (Definition of Done)

ถือว่าระบบพร้อมสำหรับการทดสอบใช้งานเมื่อครบทุกข้อที่เกี่ยวข้อง:

- [ ] โครงสร้างโปรเจกต์และเอกสารอธิบายได้
- [ ] `database/schema.sql` สร้างตารางได้โดยไม่ทำลายข้อมูลเดิม
- [ ] PHP API เชื่อม MySQL ได้และใช้ prepared statements
- [ ] API Key validation ทำงาน
- [ ] API ปฏิเสธ JSON และค่าที่ไม่ถูกต้อง
- [ ] Arduino firmware compile ผ่านด้วยไลบรารี/บอร์ดที่ระบุ
- [ ] ENV-III อ่านค่าจริงได้
- [ ] TMOS PIR อ่าน presence/motion ได้
- [ ] M5Stack ส่ง JSON เข้า PHP API ได้
- [ ] มีแถวใหม่ใน MySQL หลังส่งข้อมูล
- [ ] Wi-Fi/API error ไม่ทำให้ระบบ crash loop
- [ ] Dashboard แสดงข้อมูลล่าสุดและประวัติได้
- [ ] สถานะ WARNING/CRITICAL ทำงานตามเกณฑ์
- [ ] มีผลทดสอบและข้อจำกัดที่บันทึกไว้
- [ ] ไม่มี credentials หรือ API Key จริงใน repository

แยกผลเป็น `PASS`, `FAIL`, `NOT TESTED` ห้ามใช้ `PASS` หากไม่ได้รันการทดสอบจริง

---

## 15. คู่มือแก้ปัญหาเบื้องต้น

---

อาการ สิ่งที่ควรตรวจ

---

M5Stack ต่อ Wi-Fi ไม่ได้ SSID/password, ใช้ Wi-Fi 2.4 GHz,
สัญญาณ, captive portal

M5Stack ติดต่อ API ไม่ได้ URL ใช้ IP server ไม่ใช่ localhost,
firewall, web server, port,
เส้นทางไฟล์

HTTP 401 `X-API-Key` ต้องตรงกับค่าฝั่ง PHP
และไม่มีช่องว่างเกิน

HTTP 400 JSON field, ชนิดข้อมูล, ช่วงค่า, ชื่อฟิลด์

HTTP 404 document root, path ของ
`receive.php`, URL

HTTP 405 endpoint รับ POST แต่กำลังเรียกด้วย GET

HTTP 500 PHP error log, PDO connection,
credentials, database/table

MySQL ไม่บันทึกข้อมูล ตรวจ response API และ query ล่าสุดใน
HeidiSQL

อ่าน ENV-III ไม่ได้ สาย/Hub, SDA/SCL, I²C address,
ไลบรารีและ API version

TMOS PIR ไม่ทำงาน ตรวจ address `0x5A`,
initialization, data-ready/status
API ของไลบรารีที่ติดตั้ง

ค่า pressure ผิดมาก ตรวจหน่วย Pa เทียบกับ hPa และสูตรแปลง
`/ 100`

ข้อมูลซ้ำหลัง retry ออกแบบ event ID/idempotency
หากต้องป้องกัน duplicate อย่างเข้มงวด

Dashboard แสดงเวลาไม่ตรง timezone ของ OS/PHP/MySQL
และการแปลงเวลาใน frontend

---

---

## 16. ข้อกำหนดด้านความปลอดภัยและความน่าเชื่อถือ

- อย่าเปิด MySQL port `3306` สู่อินเทอร์เน็ตเพื่อให้ M5Stack ส่งข้อมูล
  ให้เปิดเฉพาะบริการเว็บ/API ที่จำเป็นภายใน LAN
- ใช้บัญชี MySQL ที่มีสิทธิ์เท่าที่จำเป็น หลีกเลี่ยง root ในการทำงานประจำ
- API Key ต้องสุ่ม ยาว และไม่ใส่ใน repository
- HTTP ภายใน LAN ใช้ได้เฉพาะการทดลองในเครือข่ายที่เชื่อถือได้; การใช้งานจริงควรใช้
  HTTPS หรือมาตรการป้องกันเครือข่ายที่เหมาะสม
- ข้อมูล presence/motion อาจสะท้อนรูปแบบการเข้าใช้งานพื้นที่
  ควรกำหนดผู้เข้าถึงและระยะเวลาเก็บข้อมูล
- ต้องมีการตรวจความถูกต้องของ sensor readings และสถานะ stale/offline
- หากต้องใช้ระบบนี้เพื่อป้องกันความเสียหายจริง ให้มีระบบเตือน/ควบคุมอิสระที่เหมาะสม
  อย่าพึ่งพาโครงงานต้นแบบนี้เพียงระบบเดียว

---

## 17. งานที่ AI ต้องส่งมอบ

เมื่อทำงานเสร็จ ให้ส่งมอบ:

1.  ไฟล์ SQL สำหรับสร้างฐานข้อมูลและ query ตรวจสอบ
2.  PHP API สำหรับรับข้อมูลและ endpoint สำหรับ Dashboard
3.  Firmware `.ino` ที่ตรงกับไลบรารีที่ตรวจสอบแล้ว
4.  Dashboard ที่ทำงานได้จริงตามขอบเขต
5.  ไฟล์ตัวอย่าง config ที่ไม่มี secrets
6.  `README.md` พร้อมวิธีติดตั้งและเปิดระบบ
7.  `docs/TEST_PLAN.md` พร้อมผลทดสอบ
8.  `docs/TROUBLESHOOTING.md`
9.  สรุปไฟล์ที่สร้าง/แก้ไข
10. รายการทดสอบที่ผ่าน ไม่ผ่าน และยังไม่ได้ทดสอบ
11. ค่าที่ผู้ใช้ยังต้องกรอกเอง เช่น Wi-Fi, IP/URL, MySQL account, API Key และ
    credentials ของระบบแจ้งเตือน

---

## 18. Prompt สำหรับสั่ง AI Coding Agent ใน VS Code

คัดลอกข้อความด้านล่างไปใช้กับ AI Coding Agent ที่ทำงานใน workspace นี้:

> อ่านไฟล์ `AI_PROJECT_GUIDE.md` ทั้งหมดก่อนเริ่มทำงาน แล้วตรวจสอบไฟล์ที่มีอยู่จริงใน
> workspace ห้ามเดาโครงสร้างหรือเขียนทับไฟล์โดยไม่ตรวจสอบ
>
> พัฒนาระบบ Smart Server Room Environmental Monitoring and Alert System
> ให้ครบตาม Definition of Done ในคู่มือ โดยทำทีละ phase:
>
> **Phase 1:** ตรวจสอบสภาพแวดล้อมและสรุปแผน/ไฟล์ที่ต้องสร้าง\
> **Phase 2:** สร้าง SQL schema และทดสอบโครงสร้างฐานข้อมูล\
> **Phase 3:** สร้าง PHP API, validation, API Key authentication, PDO
> prepared statements และ endpoint อ่านข้อมูลสำหรับ Dashboard\
> **Phase 4:** ทดสอบ API ด้วย request ที่ถูกต้องและผิดรูปแบบ
> โดยใช้ฐานข้อมูลทดสอบหากเป็นไปได้\
> **Phase 5:** สร้าง Arduino firmware สำหรับ M5Stack Basic v2.6, ENV-III
> และ TMOS PIR ตรวจสอบ API ของไลบรารีจากตัวอย่าง/เอกสารจริง และแก้จน compile
> ผ่านถ้า toolchain เข้าถึงได้\
> **Phase 6:** สร้าง Dashboard สำหรับข้อมูลล่าสุด ประวัติ สถานะ และ
> stale/offline indicator\
> **Phase 7:** ทดสอบ end-to-end เท่าที่เครื่องมือและฮาร์ดแวร์อนุญาต\
> **Phase 8:** เขียน README, install guide, test plan และ troubleshooting
>
> ใช้ data contract ในคู่มือเป็นมาตรฐานเดียวกันทุกส่วน ห้ามฝัง secrets ห้ามเปิด MySQL
> ให้เข้าถึงจากอินเทอร์เน็ต ห้ามลบข้อมูลเดิม ห้ามแสดง mock data ว่าเป็นข้อมูลจริง
> และห้ามอ้างว่าการทดสอบผ่านหากยังไม่ได้รันจริง
>
> หลังแต่ละ phase ให้สรุปสิ่งที่เปลี่ยนแปลง คำสั่งที่รัน ผลลัพธ์ ข้อผิดพลาดที่พบ และขั้นตอนถัดไป
> หากต้องใช้ข้อมูลที่มีเพียงเจ้าของเครื่องทราบ ให้สร้าง placeholder
> และบอกผู้ใช้ว่าต้องกรอกค่าใด อย่าหยุดเพียงแค่ให้ตัวอย่างโค้ด ให้ดำเนินการกับไฟล์ใน
> workspace จริงเมื่อมีสิทธิ์และเครื่องมือรองรับ

---

## 19. แหล่งอ้างอิงหลักของฮาร์ดแวร์และเกณฑ์

ใช้เอกสารผู้ผลิตและแหล่งอ้างอิงต่อไปนี้เพื่อตรวจสอบ API
ของไลบรารีและข้อกำหนดอุปกรณ์ก่อนสรุป:

- M5Stack Basic v2.6: https://docs.m5stack.com/en/core/Basic_v2.6
- M5Stack Unit ENV-III:
  https://docs.m5stack.switch-science.com/en/unit/Unit_ENV-III
- M5Stack Unit TMOS PIR:
  https://docs.m5stack.switch-science.com/en/unit/UNIT-TMOS%20PIR
- ASHRAE Thermal Guidelines reference card:
  https://www.ashrae.org/file%20library/technical%20resources/bookstore/supplemental%20files/therm-gdlns-5th-r-e-refcard.pdf
- ASHRAE Gaseous and Particulate Contamination Guidelines:
  https://www.ashrae.org/file%20library/technical%20resources/publication%20errata%20and%20updates/2011-gaseous-and-particulate-guidelines.pdf

**หลักสำคัญ:** AI ควรทำให้ระบบตรวจสอบได้ ทำซ้ำได้ และบอกข้อจำกัดตามจริง การ
"ทำงานได้ด้วยตัวเอง" หมายถึงระบบสามารถอ่านเซนเซอร์ ส่งข้อมูล บันทึกข้อมูล แสดงผล
และจัดการการเชื่อมต่อหลุดได้ตามที่ทดสอบแล้ว ไม่ได้หมายความว่า AI สามารถเข้าถึง Wi-Fi,
MySQL, เครื่องเซิร์ฟเวอร์ หรือฮาร์ดแวร์จริงได้โดยไม่ต้องมีสิทธิ์และการตั้งค่าจากผู้ใช้
