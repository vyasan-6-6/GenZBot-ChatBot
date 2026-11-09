export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface DatabaseHealth {
  ok: boolean;
  status: string;
  readyState: number;
  pingMs: number | null;
  databaseName: string | null;
  host: string | null;
  error?: string;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  database: DatabaseHealth;
}

export interface HealthCheckResult {
  httpStatus: number;
  roundTripMs: number;
  data: HealthResponse;
}

export interface EchoItem {
  _id: string;
  message: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchHealth(): Promise<HealthCheckResult> {
  const startedAt = performance.now();
  const response = await fetch(`${API_BASE_URL}/api/health`, {
    method: "GET",
    cache: "no-store",
  });
  const roundTripMs = Number((performance.now() - startedAt).toFixed(2));
  const data = (await response.json()) as HealthResponse;

  return {
    httpStatus: response.status,
    roundTripMs,
    data,
  };
}

export async function fetchEchoEntries(): Promise<EchoItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/echo`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch echo entries (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as {
    ok: boolean;
    items: EchoItem[];
  };
  return payload.items;
}

export async function createEchoEntry(message: string): Promise<{
  item: EchoItem;
  roundTripMs: number;
}> {
  const startedAt = performance.now();
  const response = await fetch(`${API_BASE_URL}/api/echo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  const roundTripMs = Number((performance.now() - startedAt).toFixed(2));

  const payload = (await response.json()) as {
    ok: boolean;
    item?: EchoItem;
    error?: string;
  };

  if (!response.ok || !payload.item) {
    throw new Error(payload.error ?? `Request failed (HTTP ${response.status})`);
  }

  return {
    item: payload.item,
    roundTripMs,
  };
}

