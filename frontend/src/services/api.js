const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
const useSameOriginApi = configuredBaseUrl === "same-origin";
export const API_BASE_URL = useSameOriginApi
  ? ""
  : (
      configuredBaseUrl ||
      `${window.location.protocol}//${window.location.hostname}:5000`
    ).replace(/\/+$/, "");

export function getWebSocketUrl() {
  const url = new URL(useSameOriginApi ? window.location.href : API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

export function getSocketIoUrl() {
  return useSameOriginApi ? window.location.origin : API_BASE_URL;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      result.error || `Request failed with status ${response.status}`,
    );
  }
  return result.data;
}

export function loadDashboardData(range, signal) {
  return Promise.all([
    request("/api/v1/sensors/latest", { signal }),
    request(
      `/api/v1/sensors/history?range=${encodeURIComponent(range)}&limit=500`,
      { signal },
    ),
    request("/api/v1/alerts?limit=100", { signal }),
    request("/api/v1/settings/thresholds", { signal }),
    request("/api/v1/room-usage", { signal }),
  ]).then(([latest, history, alerts, thresholds, roomUsage]) => ({
    latest,
    history,
    alerts,
    thresholds,
    roomUsage,
  }));
}

export function updateThresholds(thresholds) {
  return request("/api/v1/settings/thresholds", {
    method: "PUT",
    body: JSON.stringify(thresholds),
  });
}

export function resolveAlert(alertId) {
  return request(`/api/v1/alerts/${alertId}/resolve`, { method: "PUT" });
}
