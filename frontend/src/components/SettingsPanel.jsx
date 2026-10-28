import { useState } from "react";
import { Check, Save, SlidersHorizontal } from "lucide-react";
import { updateThresholds } from "../services/api.js";

function ThresholdFields({ title, unit, minimum, maximum, onChange }) {
  return (
    <fieldset className="threshold-group">
      <legend>{title}</legend>
      <label>
        <span>Minimum ({unit})</span>
        <input
          type="number"
          step="0.1"
          value={minimum}
          onChange={(event) => onChange("min", event.target.value)}
          required
        />
      </label>
      <label>
        <span>Maximum ({unit})</span>
        <input
          type="number"
          step="0.1"
          value={maximum}
          onChange={(event) => onChange("max", event.target.value)}
          required
        />
      </label>
    </fieldset>
  );
}

export function SettingsPanel({ thresholds, onSaved }) {
  const [form, setForm] = useState(() => ({
    temperatureMin: String(thresholds.temperature.min),
    temperatureMax: String(thresholds.temperature.max),
    humidityMin: String(thresholds.humidity.min),
    humidityMax: String(thresholds.humidity.max),
  }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function updateField(metric, bound, value) {
    const key = `${metric}${bound[0].toUpperCase()}${bound.slice(1)}`;
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await updateThresholds({
        temperature: {
          min: Number(form.temperatureMin),
          max: Number(form.temperatureMax),
        },
        humidity: {
          min: Number(form.humidityMin),
          max: Number(form.humidityMax),
        },
      });
      onSaved(saved);
      setMessage("Thresholds saved");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section-panel settings-panel">
      <header className="section-heading">
        <div>
          <div className="eyebrow">ALARM CONFIGURATION</div>
          <h2>
            <SlidersHorizontal size={18} /> Operating thresholds
          </h2>
        </div>
        <span className="settings-sync">SAVED TO BACKEND</span>
      </header>
      <form onSubmit={submit}>
        <ThresholdFields
          title="Temperature"
          unit="°C"
          minimum={form.temperatureMin}
          maximum={form.temperatureMax}
          onChange={(bound, value) => updateField("temperature", bound, value)}
        />
        <ThresholdFields
          title="Relative humidity"
          unit="%"
          minimum={form.humidityMin}
          maximum={form.humidityMax}
          onChange={(bound, value) => updateField("humidity", bound, value)}
        />
        <footer className="settings-actions">
          <span
            className={error ? "form-feedback is-error" : "form-feedback"}
            aria-live="polite"
          >
            {error || message}
          </span>
          <button className="primary-button" type="submit" disabled={saving}>
            {message && !saving ? <Check size={16} /> : <Save size={16} />}
            {saving ? "Saving…" : "Save thresholds"}
          </button>
        </footer>
      </form>
    </section>
  );
}
