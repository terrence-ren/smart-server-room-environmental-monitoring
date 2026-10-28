# Phase 5 handoff — live validation

## Verified status

The repository has no formal phase ledger; these labels summarize the current implementation, not an assertion that every phase has passed end-to-end.

| Phase | Current status |
|---|---|
| 1 — Project/environment assessment and architecture alignment | Completed as an assessment; the active repository uses Node.js/Express, SQLite, MQTT, and React/Vite. |
| 2 — Backend and database | Backend/API behavior and SQLite persistence were reviewed; the alert-resolution realtime gap was fixed and regression-tested. Backend tests pass. |
| 3 — Frontend integration | Frontend build/lint and live API/Socket.IO dashboard behavior were verified. |
| 4 — API request validation | Live valid telemetry and invalid telemetry/threshold requests were checked; invalid requests returned HTTP 400. |
| 5 — MQTT, firmware and hardware | **PASS** for Docker Compose, synthetic MQTT alert lifecycle, M5Stack Core ESP32 compile/upload/flash verification, ENV readings, STHS34PF80 presence/motion response, Wi-Fi association/reconnect, and physical HTTP telemetry. No smoke/gas or water-leak sensor modules are installed, so those hardware paths remain **NOT TESTED**. |
| 6 — Final acceptance and handoff | **PASS** for backend tests, frontend lint/build, Docker Compose build/start, health checks, real device telemetry persistence, physical STHS34PF80 presence/motion response, and synthetic critical temperature escalation/recovery. A real-device CRITICAL temperature reading was not induced. |

Evidence collected:

- `Push-Location backend; npm test; Pop-Location` — **PASS**, 7 tests, 0 failures.
- `Push-Location frontend; npm run lint; Pop-Location` — **PASS**.
- `Push-Location frontend; npm run build; Pop-Location` — **PASS**.
- `node simulator/sensor_sim.mjs --help` — **PASS** (usage only; no telemetry).
- Docker Desktop Engine and Compose became available; `docker compose config --quiet` passed.
- `.\phase5-live-validation.ps1` — **PASS**. The script published a unique MQTT message to Mosquitto, and `GET /api/v1/sensors/latest` returned the same unique sensor ID and expected telemetry values.
- Extended MQTT lifecycle test — **PASS**. Unique synthetic sensor readings in NORMAL → WARNING → CRITICAL (smoke + high temperature) → NORMAL order were received through Mosquitto; the backend persisted each reading, created WARNING and CRITICAL alerts, then marked both alerts resolved after recovery.
- Compose status — backend healthy, frontend healthy, Mosquitto running.
- HTTP smoke checks — backend `/health` returned `ok`; frontend on port 8080 returned HTTP 200 and the dashboard title.
- Backend tests after the container compatibility fix — **PASS**, 7 tests, 0 failures.
- The test stack was stopped afterward with `docker compose down`; both named volumes (`backend-data`, `mqtt-data`) were verified retained.
- Final acceptance rerun — **PASS**. `docker compose up --build -d` started backend, frontend, and Mosquitto; backend `/health` returned `ok`; frontend-proxied `/health` returned HTTP 200; `docker compose down` stopped the services without removing the named volumes.
- Backend tests — **PASS**, 7 tests, 0 failures. Frontend ESLint and production Vite build — **PASS**.
- Firmware credential source scan — credentials are no longer embedded in the `.ino`; firmware now requires a local ignored `M5_Server_Monitor/secrets.h` created from `secrets.example.h`.
- Firmware compile — **PASS** for `esp32:esp32:m5stack-core-esp32` using ESP32 core 2.0.17 and the installed M5Stack/ENV dependencies. The Arduino IDE's bundled CLI was used; Unicode library paths under OneDrive required Windows short paths.
- Latest firmware recovery build — **PASS**. Compile, upload, and flash hash verification succeeded after adding non-blocking Wi-Fi recovery with exponential backoff, sensor validity reporting, and a button-A reconnect test.
- Physical device — **PASS**. The user-confirmed M5Stack Core ESP32 on COM3 compiled, uploaded, and passed flash hash verification. Serial output confirmed Wi-Fi association and repeated HTTP 201 responses containing live temperature, humidity, pressure, presence, and motion values.
- Device telemetry persistence — **PASS**. A stable `m5stack-core-01` sensor ID was added; API response and a direct GET through the backend's Wi-Fi host port returned the same fresh readings and backend record IDs.
- Wi-Fi recovery — **PASS**. After user pressed button A, Serial showed the deliberate disconnect, a failed POST during the brief outage, reconnect attempt, Wi-Fi connected, recovery complete, and subsequent HTTP 201 telemetry. Credentials were not logged.
- Temperature critical handling — backend/API integration test and unit test passed for WARNING at 30°C → CRITICAL at 33°C → WARNING at 30°C → resolved at 24°C. These readings were synthetic; actual M5Stack temperature remained around 30.5°C and produced WARNING. No environmental heating was used to force a CRITICAL condition.
- Smoke/water pipeline — backend tests now cover synthetic `smoke_detected` and `water_leak` telemetry and CRITICAL alerts. Physical detection remains **NOT TESTED** because the user confirmed those sensor modules are not installed.
- Port routing correction — host port `5000` was occupied by a separate Node process, so LAN device requests reached a different backend than the Compose dashboard. Compose, the firmware, the simulator, and the live validation script now use host port `5001` (container port `5000`) by default; the existing process was left untouched.
- Live device reading — temperature about `30.6°C`, humidity about `71.8%`, pressure about `993.8 hPa`, with presence/motion detected. The backend persisted these readings and generated active temperature/humidity WARNING alerts against configured limits; investigate the room conditions.
- STHS34PF80 driver correction — the prior firmware read `0x0F` (WHO_AM_I) and treated its low bits as detections. The corrected firmware checks WHO_AM_I=`0xD3`, configures TMOS/ambient averaging, resets the embedded algorithm, enables block-data update and 8 Hz ODR, then reads `FUNC_STATUS` at `0x25` (motion bit 1, presence bit 2). It omits both telemetry fields when reads fail and displays `N/A` in that case. The firmware compiled, uploaded to COM3, and passed flash hash verification. A physical warm-target test produced status transitions `0x06` (presence+motion) ↔ `0x04` (presence only); matching HTTP 201 telemetry changed to presence=1/motion=1 and presence=1/motion=0.
- Final post-correction checks — **PASS**. Compose config/build/start and backend/frontend health checks passed on the new port; backend tests passed 8/8; frontend lint/build passed; the MQTT lifecycle script passed. Compose is intentionally left running at `http://localhost:8080` so the physical device can continue sending data. Named volumes remain in place.

## What the live script actually verifies

The script checks Docker Compose state, starts the stack only if none of its services are already running, polls `http://localhost:5001/health`, publishes a unique-per-run MQTT scenario through `mqtt-broker` on `serverroom/sensors/data`, and verifies each reading plus warning/critical alert creation and recovery resolution through the API. A previously running complete stack is reused and left running; a stack started by the script is stopped on completion while named volumes are retained. Partial running stacks are not modified. Frontend HTTP/health was separately verified during this run.

The first Docker build exposed a native-module compatibility issue: the downloaded `sqlite3` prebuilt addon required `GLIBC_2.38`, which is not present in `node:24-bookworm-slim`. The backend Dockerfile now builds `sqlite3` from source in the dependencies stage so it links against the same base image runtime. The live stack then started healthy and the MQTT-to-API check passed. The validation script also filters the empty service-list output returned by Compose when no services are running and base64-encodes JSON before piping it to `mosquitto_pub`, avoiding PowerShell/native-command quote loss.

The firmware reads Wi-Fi credentials from the local ignored `M5_Server_Monitor/secrets.h`; the tracked `secrets.example.h` is intentionally blank. The firmware uses sensor ID `m5stack-core-01`, prints Wi-Fi/HTTP diagnostics to Serial without printing credentials, and posts to the configured backend host IP on port `5001`. Pressing button A triggers an approximately 1.5-second local Wi-Fi disconnect; the firmware then reconnects and resumes telemetry.

The broker is included in Compose and is not an external prerequisite. Without Docker/Compose, neither that broker nor the script can be exercised. Compose exposes the backend on host port `5001` by default (container port `5000`) to avoid an existing host service on port `5000`; the device firmware and validation script target port `5001`. Keep the default MQTT topic for this test.

## Re-running live validation

Run from the repository root in PowerShell. These steps retain existing named-volume data.

1. Start Docker Desktop/Engine and confirm ports `5001` and `8080` are available. Review any existing `.env`; do not add real credentials for this validation. Check Compose configuration:

   ```powershell
   docker compose config --quiet
   ```

2. Run the validation script from the repository root:

   ```powershell
   .\phase5-live-validation.ps1
   ```

   The script starts the complete stack if no service is already running. If it detects a partial Compose stack, it exits without changing it. If health is not `ok`, inspect `docker compose ps` and `docker compose logs backend mqtt-broker`.

3. Confirm the script reports `RESULT: PASS` and the returned reading has the generated `phase5-...` sensor ID plus temperature `24.5`, humidity `45`, pressure `1012`, and status `NORMAL`. These values are checked by the script against a unique per-run ID, avoiding a stale-record false pass.

4. A stack started by the script is stopped automatically with `docker compose down`; an already-running stack is left running. If the script fails, it reports failure and retains named volumes. Inspect logs before any manual cleanup:

   ```powershell
   docker compose down
   ```

   **Do not add `-v`**: that would remove the persistent SQLite and Mosquitto data volumes. If any check fails, report it as failed/not verified; do not describe it as a live MQTT pass.
