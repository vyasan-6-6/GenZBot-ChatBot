"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  API_BASE_URL,
  createEchoEntry,
  fetchEchoEntries,
  fetchHealth,
  type EchoItem,
  type HealthCheckResult,
} from "@/lib/api";

export function FoundationDashboard() {
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState<boolean>(true);

  const [entries, setEntries] = useState<EchoItem[]>([]);
  const [messageInput, setMessageInput] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [echoError, setEchoError] = useState<string | null>(null);
  const [lastPostMs, setLastPostMs] = useState<number | null>(null);

  const runHealthCheck = useCallback(async () => {
    setCheckingHealth(true);
    setHealthError(null);
    try {
      const result = await fetchHealth();
      setHealth(result);
    } catch (error) {
      setHealth(null);
      setHealthError(
        error instanceof Error
          ? error.message
          : "Unable to reach Express backend"
      );
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  const loadEntries = useCallback(async () => {
    try {
      const items = await fetchEchoEntries();
      setEntries(items);
    } catch (error) {
      setEchoError(
        error instanceof Error
          ? error.message
          : "Failed to load entries from MongoDB"
      );
    }
  }, []);

  useEffect(() => {
    void runHealthCheck();
    void loadEntries();
  }, [runHealthCheck, loadEntries]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = messageInput.trim();
    if (!trimmed) {
      setEchoError("Enter a message before sending.");
      return;
    }

    setSubmitting(true);
    setEchoError(null);

    try {
      const { item, roundTripMs } = await createEchoEntry(trimmed);
      setLastPostMs(roundTripMs);
      setEntries((prev) => [item, ...prev].slice(0, 10));
      setMessageInput("");
    } catch (error) {
      setEchoError(
        error instanceof Error ? error.message : "Failed to send message"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isHealthy = health?.data.status === "ok";
  const statusTone = healthError
    ? "error"
    : isHealthy
      ? "ok"
      : checkingHealth
        ? "pending"
        : "degraded";

  return (
    <main className="page">
      <header className="hero">
        <div className="badge-row">
          <span className={`pill pill-${statusTone}`}>
            {healthError
              ? "Backend Unreachable"
              : checkingHealth && !health
                ? "Checking Connection..."
                : isHealthy
                  ? "System Healthy"
                  : "Database Degraded"}
          </span>
          <span className="pill pill-neutral">API: {API_BASE_URL}</span>
        </div>
        <h1>GenBot Project Foundation</h1>
        <p className="subtitle">
          Next.js App Router frontend communicating with an Express TypeScript
          API backed by MongoDB.
        </p>

        <div className="pipeline" aria-label="Request flow">
          <div className="node">
            <strong>Next.js Frontend</strong>
            <span>Browser (localhost:3000)</span>
          </div>
          <span className="arrow" aria-hidden="true">
            HTTP / JSON + CORS &rarr;
          </span>
          <div className="node">
            <strong>Express Backend</strong>
            <span>Node.js API (localhost:4000)</span>
          </div>
          <span className="arrow" aria-hidden="true">
            Mongoose / Wire Protocol &rarr;
          </span>
          <div className="node">
            <strong>MongoDB</strong>
            <span>genbot_foundation (127.0.0.1:27017)</span>
          </div>
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>1. Health Check</h2>
              <p className="muted">
                <code>GET /api/health</code> &rarr; <code>db.admin().ping()</code>
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runHealthCheck()}
              disabled={checkingHealth}
              className="btn-secondary"
            >
              {checkingHealth ? "Checking..." : "Re-check"}
            </button>
          </div>

          {healthError ? (
            <div className="alert-error">
              <strong>Connection failed:</strong> {healthError}
              <p className="muted">
                Make sure Express is running on <code>{API_BASE_URL}</code>.
              </p>
            </div>
          ) : health ? (
            <>
              <dl className="metrics">
                <div>
                  <dt>HTTP Status</dt>
                  <dd>{health.httpStatus}</dd>
                </div>
                <div>
                  <dt>Browser &harr; Express</dt>
                  <dd>{health.roundTripMs} ms</dd>
                </div>
                <div>
                  <dt>Express &harr; MongoDB Ping</dt>
                  <dd>
                    {health.data.database.pingMs !== null
                      ? `${health.data.database.pingMs} ms`
                      : "N/A"}
                  </dd>
                </div>
                <div>
                  <dt>MongoDB State</dt>
                  <dd>
                    {health.data.database.status} (readyState:{" "}
                    {health.data.database.readyState})
                  </dd>
                </div>
                <div>
                  <dt>Database Name</dt>
                  <dd>{health.data.database.databaseName ?? "N/A"}</dd>
                </div>
                <div>
                  <dt>Express Uptime</dt>
                  <dd>{health.data.uptimeSeconds}s</dd>
                </div>
              </dl>

              <details className="raw-json">
                <summary>Inspect raw JSON response</summary>
                <pre>{JSON.stringify(health.data, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p className="muted">Running initial health check...</p>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>2. End-to-End DB Round-Trip</h2>
              <p className="muted">
                <code>POST /api/echo</code> &amp; <code>GET /api/echo</code>
              </p>
            </div>
            {lastPostMs !== null && (
              <span className="pill pill-ok">Saved in {lastPostMs} ms</span>
            )}
          </div>

          <form onSubmit={handleSubmit} className="echo-form">
            <input
              type="text"
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              placeholder="Type a test message to persist in MongoDB..."
              maxLength={280}
              disabled={submitting}
              aria-label="Test message"
            />
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? "Sending..." : "Send"}
            </button>
          </form>

          {echoError && <div className="alert-error">{echoError}</div>}

          <div className="entries-header">
            <span>Recent MongoDB documents ({entries.length})</span>
            <button
              type="button"
              onClick={() => void loadEntries()}
              className="link-btn"
            >
              Refresh
            </button>
          </div>

          {entries.length === 0 ? (
            <p className="muted empty-state">
              No test entries yet. Send a message above to verify writing to and
              reading from MongoDB.
            </p>
          ) : (
            <ul className="entry-list">
              {entries.map((item) => (
                <li key={item._id} className="entry-item">
                  <div className="entry-message">{item.message}</div>
                  <div className="entry-meta">
                    <code>_id: {item._id}</code>
                    <span>
                      {new Date(item.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

