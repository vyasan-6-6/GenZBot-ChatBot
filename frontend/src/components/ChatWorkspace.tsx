"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { FoundationDashboard } from "@/components/FoundationDashboard";
import {
  clearChatHistory,
  fetchChatHistory,
  fetchHealth,
  sendChatMessage,
  type ChatMessage,
  type HealthCheckResult,
} from "@/lib/api";

export function ChatWorkspace() {
  const [activeTab, setActiveTab] = useState<"chat" | "diagnostics">("chat");

  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modelName, setModelName] = useState<string>("qwen2.5:3b");
  const [temperature, setTemperature] = useState<number>(0.7);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<string>("");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadInitialData = useCallback(async () => {
    setLoadingHistory(true);
    setError(null);

    const [healthOutcome, historyOutcome] = await Promise.allSettled([
      fetchHealth(),
      fetchChatHistory(),
    ]);

    if (healthOutcome.status === "fulfilled") {
      setHealth(healthOutcome.value);
      setHealthError(null);
      if (healthOutcome.value.data.llm?.model) {
        setModelName(healthOutcome.value.data.llm.model);
      }
    } else {
      setHealth(null);
      setHealthError(
        healthOutcome.reason instanceof Error
          ? healthOutcome.reason.message
          : "Backend unreachable"
      );
    }

    if (historyOutcome.status === "fulfilled") {
      setMessages(historyOutcome.value.messages);
      setModelName(historyOutcome.value.model);
      setTemperature(historyOutcome.value.temperature);
    } else {
      setError(
        historyOutcome.reason instanceof Error
          ? historyOutcome.reason.message
          : "Failed to load conversation history"
      );
    }

    setLoadingHistory(false);
  }, []);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function submitMessage() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const optimisticId = `pending-${Date.now()}`;
    const optimisticUserMessage: ChatMessage = {
      _id: optimisticId,
      conversationId: "pending",
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setSending(true);
    setError(null);
    setInput("");
    setMessages((prev) => [...prev, optimisticUserMessage]);

    try {
      const { result } = await sendChatMessage(trimmed, temperature);
      setMessages((prev) => [
        ...prev.filter((msg) => msg._id !== optimisticId),
        result.userMessage,
        result.assistantMessage,
      ]);
    } catch (err) {
      setMessages((prev) => prev.filter((msg) => msg._id !== optimisticId));
      setInput(trimmed);
      setError(err instanceof Error ? err.message : "Failed to get LLM reply");
    } finally {
      setSending(false);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  async function handleClear() {
    if (sending || clearing) return;
    setClearing(true);
    setError(null);
    try {
      await clearChatHistory();
      setMessages([]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to clear chat history"
      );
    } finally {
      setClearing(false);
    }
  }

  const isHealthy = health?.data.status === "ok";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="brand">GenZBot</h1>
          <span
            className={`pill ${
              healthError
                ? "pill-error"
                : isHealthy
                  ? "pill-ok"
                  : "pill-pending"
            }`}
          >
            {healthError
              ? "Backend Offline"
              : isHealthy
                ? `Connected • ${modelName}`
                : "Connecting..."}
          </span>
        </div>

        <nav className="tabs" aria-label="Workspace view">
          <button
            type="button"
            className={`tab-btn ${activeTab === "chat" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className={`tab-btn ${
              activeTab === "diagnostics" ? "tab-active" : ""
            }`}
            onClick={() => setActiveTab("diagnostics")}
          >
            Diagnostics
          </button>
        </nav>
      </header>

      {activeTab === "diagnostics" ? (
        <FoundationDashboard />
      ) : (
        <main className="chat-container">
          <div className="chat-toolbar">
            <div className="temp-control">
              <label htmlFor="temp-select">Temperature</label>
              <select
                id="temp-select"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                disabled={sending}
              >
                <option value={0.2}>0.2 (Focused)</option>
                <option value={0.7}>0.7 (Balanced)</option>
                <option value={1.1}>1.1 (Creative)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => void handleClear()}
              disabled={sending || clearing || messages.length === 0}
              className="btn-secondary"
            >
              {clearing ? "Clearing..." : "Clear Chat"}
            </button>
          </div>

          <section className="chat-feed" aria-live="polite">
            {loadingHistory ? (
              <div className="chat-empty">
                <p className="muted">Loading conversation from MongoDB...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="chat-empty">
                <h2>Start a conversation with GenZBot</h2>
                <p className="muted">
                  Messages travel from Next.js → Express → Ollama (
                  <code>{modelName}</code>) and persist in MongoDB.
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <article
                  key={msg._id}
                  className={`bubble-row ${
                    msg.role === "user" ? "bubble-row-user" : "bubble-row-bot"
                  }`}
                >
                  <div
                    className={`bubble ${
                      msg.role === "user" ? "bubble-user" : "bubble-bot"
                    }`}
                  >
                    <div className="bubble-header">
                      <strong>
                        {msg.role === "user" ? "You" : "GenZBot"}
                      </strong>
                      <span>
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="bubble-content">{msg.content}</div>
                    {msg.role === "assistant" &&
                      (msg.usage || msg.durationMs !== undefined) && (
                        <div className="bubble-meta">
                          {msg.model && <span>{msg.model}</span>}
                          {msg.usage?.promptTokens !== undefined && (
                            <span>in: {msg.usage.promptTokens} tok</span>
                          )}
                          {msg.usage?.completionTokens !== undefined && (
                            <span>out: {msg.usage.completionTokens} tok</span>
                          )}
                          {msg.durationMs !== undefined && (
                            <span>
                              {(msg.durationMs / 1000).toFixed(2)}s
                            </span>
                          )}
                        </div>
                      )}
                  </div>
                </article>
              ))
            )}

            {sending && (
              <article className="bubble-row bubble-row-bot">
                <div className="bubble bubble-bot bubble-thinking">
                  <div className="bubble-header">
                    <strong>GenZBot</strong>
                  </div>
                  <div className="bubble-content">
                    Generating response via {modelName}...
                  </div>
                </div>
              </article>
            )}

            <div ref={messagesEndRef} />
          </section>

          {error && <div className="alert-error">{error}</div>}

          <form onSubmit={handleFormSubmit} className="chat-composer">
            <textarea
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask GenZBot anything... (Enter to send, Shift+Enter for newline)"
              maxLength={4000}
              disabled={sending}
              aria-label="Chat message"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="btn-primary"
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </form>
        </main>
      )}
    </div>
  );
}

