import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { getSocketIoUrl, loadDashboardData } from "../services/api.js";

export function useMonitoringData(range) {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [thresholds, setThresholds] = useState(null);
  const [roomUsage, setRoomUsage] = useState(null);
  const [connection, setConnection] = useState("connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let socket;
    let pollTimer;
    let disposed = false;

    async function refresh() {
      try {
        const snapshot = await loadDashboardData(range, controller.signal);
        if (disposed) return;
        setLatest(snapshot.latest);
        setHistory(snapshot.history || []);
        setAlerts(snapshot.alerts || []);
        setThresholds(snapshot.thresholds);
        setRoomUsage(snapshot.roomUsage);
        setError("");
      } catch (refreshError) {
        if (refreshError.name !== "AbortError" && !disposed) {
          setError(refreshError.message || "Unable to load monitoring data");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    function connect() {
      if (disposed) return;
      setConnection("connecting");
      socket = io(getSocketIoUrl(), {
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 15_000,
      });

      socket.on("connect", () => {
        setConnection("connected");
        void refresh();
      });

      socket.on("sensor:updated", (reading) => {
        if (!reading) return;
        setLatest(reading);
        setHistory((current) =>
          [...current.filter((row) => row.id !== reading.id), reading].slice(
            -500,
          ),
        );
      });

      socket.on("room:usage-updated", (state) => {
        if (state) setRoomUsage(state);
      });

      socket.on("alert:new", (alert) => {
        if (!alert) return;
        setAlerts((current) =>
          [alert, ...current.filter((item) => item.id !== alert.id)].slice(
            0,
            100,
          ),
        );
      });

      socket.on("alert:resolved", (alert) => {
        if (!alert) return;
        setAlerts((current) =>
          current.map((item) => (item.id === alert.id ? alert : item)),
        );
      });

      socket.on("disconnect", () => {
        if (disposed) return;
        setConnection("disconnected");
      });

      socket.on("connect_error", () => {
        setConnection("disconnected");
      });
    }

    void refresh();
    connect();
    pollTimer = window.setInterval(refresh, 30_000);

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(pollTimer);
      socket?.disconnect();
    };
  }, [range, reloadKey]);

  return {
    latest,
    history,
    alerts,
    thresholds,
    roomUsage,
    connection,
    loading,
    error,
    refresh: () => setReloadKey((current) => current + 1),
    setAlerts,
    setThresholds,
  };
}
