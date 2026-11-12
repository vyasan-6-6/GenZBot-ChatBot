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
  llm?: {
    provider: string;
    model: string;
    baseUrl: string;
  };
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

export type ChatRole = "user" | "assistant";

export interface ChatTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatMessage {
  _id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  model?: string;
  usage?: ChatTokenUsage;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary {
  _id: string;
  sessionKey: string;
  title: string;
  titleSource?: "default" | "auto" | "manual";
  systemPrompt?: string;
  lastMessagePreview?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetailResponse {
  ok: boolean;
  conversation: ConversationSummary;
  messages: ChatMessage[];
  model: string;
  temperature: number;
}

export interface SendChatResponse {
  ok: boolean;
  conversationId: string;
  conversation: ConversationSummary;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  meta: {
    model: string;
    temperature: number;
    contextMessagesSent: number;
  };
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

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/conversations`, {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    ok: boolean;
    conversations?: ConversationSummary[];
    error?: string;
  };

  if (!response.ok || !payload.ok || !payload.conversations) {
    throw new Error(
      payload.error ?? `Failed to load conversations (HTTP ${response.status})`
    );
  }

  return payload.conversations;
}

export async function createConversation(
  title?: string
): Promise<ConversationSummary> {
  const response = await fetch(`${API_BASE_URL}/api/conversations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(title ? { title } : {}),
  });

  const payload = (await response.json()) as {
    ok: boolean;
    conversation?: ConversationSummary;
    error?: string;
  };

  if (!response.ok || !payload.ok || !payload.conversation) {
    throw new Error(
      payload.error ?? `Failed to create conversation (HTTP ${response.status})`
    );
  }

  return payload.conversation;
}

export async function fetchConversationDetail(
  conversationId: string
): Promise<ConversationDetailResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  const payload = (await response.json()) as ConversationDetailResponse & {
    error?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.error ?? `Failed to load conversation (HTTP ${response.status})`
    );
  }

  return payload;
}

export async function renameConversation(
  conversationId: string,
  title: string
): Promise<ConversationSummary> {
  const response = await fetch(
    `${API_BASE_URL}/api/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title }),
    }
  );

  const payload = (await response.json()) as {
    ok: boolean;
    conversation?: ConversationSummary;
    error?: string;
  };

  if (!response.ok || !payload.ok || !payload.conversation) {
    throw new Error(
      payload.error ?? `Failed to rename conversation (HTTP ${response.status})`
    );
  }

  return payload.conversation;
}

export async function regenerateConversationTitle(
  conversationId: string
): Promise<ConversationSummary> {
  const response = await fetch(
    `${API_BASE_URL}/api/conversations/${encodeURIComponent(conversationId)}/title`,
    {
      method: "POST",
    }
  );

  const payload = (await response.json()) as {
    ok: boolean;
    conversation?: ConversationSummary;
    error?: string;
  };

  if (!response.ok || !payload.ok || !payload.conversation) {
    throw new Error(
      payload.error ?? `Failed to generate title (HTTP ${response.status})`
    );
  }

  return payload.conversation;
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "DELETE",
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ?? `Failed to delete conversation (HTTP ${response.status})`
    );
  }
}

export async function sendConversationMessage(
  conversationId: string,
  message: string,
  temperature?: number
): Promise<{ result: SendChatResponse; roundTripMs: number }> {
  const startedAt = performance.now();
  const response = await fetch(
    `${API_BASE_URL}/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, temperature }),
    }
  );
  const roundTripMs = Number((performance.now() - startedAt).toFixed(2));

  const payload = (await response.json()) as SendChatResponse & {
    error?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.error ?? `Chat request failed (HTTP ${response.status})`
    );
  }

  return {
    result: payload,
    roundTripMs,
  };
}
