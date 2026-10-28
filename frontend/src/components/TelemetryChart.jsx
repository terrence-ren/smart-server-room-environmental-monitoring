import { Activity } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const ranges = [
  { label: "1H", value: "1h" },
  { label: "24H", value: "24h" },
  { label: "7D", value: "7d" },
];

function formatTick(value) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTooltip(value, name) {
  const unit = name === "Temperature" ? "°C" : "%";
  return [`${Number(value).toFixed(1)}${unit}`, name];
}

export function TelemetryChart({ data, range, onRangeChange }) {
  return (
    <section className="section-panel chart-panel">
      <header className="section-heading">
        <div>
          <div className="eyebrow">SENSOR HISTORY</div>
          <h2>
            <Activity size={18} /> Environmental trend
          </h2>
        </div>
        <div
          className="segmented-control"
          role="group"
          aria-label="History range"
        >
          {ranges.map((option) => (
            <button
              key={option.value}
              type="button"
              className={range === option.value ? "is-selected" : ""}
              aria-pressed={range === option.value}
              onClick={() => onRangeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {data.length === 0 ? (
        <div className="chart-empty">
          <Activity size={26} strokeWidth={1.5} />
          <span>No readings in this period</span>
        </div>
      ) : (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 12, right: 8, left: -18, bottom: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="#e6e9e4"
                strokeDasharray="3 5"
              />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTick}
                tick={{ fill: "#7a827b", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={36}
              />
              <YAxis
                yAxisId="temperature"
                tick={{ fill: "#7a827b", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={42}
              />
              <YAxis
                yAxisId="humidity"
                orientation="right"
                domain={[0, 100]}
                tick={{ fill: "#7a827b", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                labelFormatter={(value) => new Date(value).toLocaleString()}
                formatter={formatTooltip}
                contentStyle={{
                  border: "1px solid #dfe4dd",
                  borderRadius: 4,
                  boxShadow: "0 8px 22px #14251a12",
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                height={30}
                iconType="plainline"
              />
              <Line
                yAxisId="temperature"
                type="monotone"
                dataKey="temperature"
                name="Temperature"
                stroke="#d15b3f"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls
              />
              <Line
                yAxisId="humidity"
                type="monotone"
                dataKey="humidity"
                name="Humidity"
                stroke="#1684b8"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
