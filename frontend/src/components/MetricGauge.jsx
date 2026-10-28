export function MetricGauge({
  title,
  value,
  unit,
  minimum,
  maximum,
  icon: Icon,
  tone,
  status,
  decimals = 1,
}) {
  const hasValue = Number.isFinite(value);
  const isHigh = hasValue && Number.isFinite(maximum) && value > maximum;
  const isLow = hasValue && Number.isFinite(minimum) && value < minimum;
  const readingStatus = !hasValue
    ? "NO DATA"
    : isHigh
      ? "ABOVE LIMIT"
      : isLow
        ? "BELOW LIMIT"
        : "IN RANGE";
  const statusLabel = status || readingStatus;
  const displayValue = hasValue ? Number(value).toFixed(decimals) : "--.-";
  const start = Number.isFinite(minimum) ? minimum : 0;
  const end = Number.isFinite(maximum) ? maximum : Math.max(start + 1, 100);
  const position = hasValue
    ? Math.max(0, Math.min(100, ((value - start) / (end - start)) * 100))
    : 0;

  return (
    <article className={`metric-panel metric-${tone}`}>
      <header className="metric-panel__heading">
        <span className="metric-panel__icon">
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <span>{title}</span>
        <span
          className={`metric-panel__state ${isHigh || isLow ? "metric-panel__state--alert" : ""} ${status ? `metric-panel__state--${status.toLowerCase()}` : ""}`}
        >
          {statusLabel}
        </span>
      </header>
      <div className="metric-panel__reading">
        <strong>{displayValue}</strong>
        <span>{unit}</span>
      </div>
      <div
        className="metric-track"
        aria-label={`${title} ${displayValue} ${unit}`}
      >
        <div className="metric-track__fill" style={{ width: `${position}%` }} />
        {Number.isFinite(maximum) && (
          <span className="metric-track__limit" style={{ left: "100%" }} />
        )}
      </div>
      <footer className="metric-panel__limits">
        <span>
          {Number.isFinite(minimum) ? `MIN ${minimum}${unit}` : "MIN —"}
        </span>
        <span>
          {Number.isFinite(maximum) ? `MAX ${maximum}${unit}` : "MAX —"}
        </span>
      </footer>
    </article>
  );
}
