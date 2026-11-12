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
  createConversation,
  deleteConversation,
  fetchConversationDetail,
  fetchConversations,
  fetchHealth,
  renameConversation,
  sendConversationMessage,
  type ChatMessage,
  type ConversationSummary,
  type HealthCheckResult,
} from "@/lib/api";

export function ChatWorkspace() {
  const [activeTab, setActiveTab] = useState<"chat" | "diagnostics">("chat");

  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modelName, setModelName] = useState<string>("qwen2.5:3b");
  const [temperature, setTemperature] = useState<number>(0.7);

  const [loadingConversations, setLoadingConversations] =
    useState<boolean>(true);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [creatingConversation, setCreatingConversation] =
    useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<string>("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const selectConversation = useCallback(async (conversationId: string) => {
    setActiveConversationId(conversationId);
    activeIdRef.current = conversationId;
    setLoadingMessages(true);
    setError(null);

    try {
      const detail = await fetchConversationDetail(conversationId);
      if (activeIdRef.current !== conversationId) return;
      setMessages(detail.messages);
      setModelName(detail.model);
      setTemperature(detail.temperature);
    } catch (err) {
      if (activeIdRef.current !== conversationId) return;
      setMessages([]);
      setError(
        err instanceof Error ? err.message : "Failed to load conversation"
      );
    } finally {
      if (activeIdRef.current === conversationId) {
        setLoadingMessages(false);
      }
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoadingConversations(true);
    setError(null);

    const [healthOutcome, conversationsOutcome] = await Promise.allSettled([
      fetchHealth(),
      fetchConversations(),
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

    if (conversationsOutcome.status === "fulfilled") {
      const list = conversationsOutcome.value;
      setConversations(list);
      if (list.length > 0) {
        await selectConversation(list[0]._id);
      } else {
        setActiveConversationId(null);
        setMessages([]);
      }
    } else {
      setError(
        conversationsOutcome.reason instanceof Error
          ? conversationsOutcome.reason.message
          : "Failed to load conversations"
      );
    }

    setLoadingConversations(false);
  }, [selectConversation]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function handleNewChat() {
    if (sending || creatingConversation) return;
    setCreatingConversation(true);
    setError(null);
    setEditingId(null);

    try {
      const created = await createConversation("New Chat");
      setConversations((prev) => [created, ...prev]);
      setActiveConversationId(created._id);
      activeIdRef.current = created._id;
      setMessages([]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create conversation"
      );
    } finally {
      setCreatingConversation(false);
    }
  }

  async function handleSelectConversation(conversationId: string) {
    if (sending || conversationId === activeConversationId) return;
    setEditingId(null);
    await selectConversation(conversationId);
  }

  function startRenaming(conv: ConversationSummary) {
    setEditingId(conv._id);
    setEditingTitle(conv.title);
  }

  async function submitRename(conversationId: string) {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setError("Conversation title cannot be empty.");
      return;
    }

    try {
      const updated = await renameConversation(conversationId, trimmed);
      setConversations((prev) =>
        prev.map((c) => (c._id === conversationId ? updated : c))
      );
      setEditingId(null);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to rename conversation"
      );
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    if (sending) return;
    setError(null);
    if (editingId === conversationId) {
      setEditingId(null);
    }

    try {
      await deleteConversation(conversationId);
      const remaining = conversations.filter((c) => c._id !== conversationId);
      setConversations(remaining);

      if (activeConversationId === conversationId) {
        if (remaining.length > 0) {
          await selectConversation(remaining[0]._id);
        } else {
          setActiveConversationId(null);
          activeIdRef.current = null;
          setMessages([]);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete conversation"
      );
    }
  }

  async function submitMessage() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);
    setInput("");

    let targetConversationId = activeConversationId;
    let createdOnSend: ConversationSummary | null = null;

    try {
      if (!targetConversationId) {
        createdOnSend = await createConversation("New Chat");
        targetConversationId = createdOnSend._id;
        setConversations((prev) => [createdOnSend!, ...prev]);
        setActiveConversationId(targetConversationId);
        activeIdRef.current = targetConversationId;
      }

      const optimisticId = `pending-${Date.now()}`;
      const optimisticUserMessage: ChatMessage = {
        _id: optimisticId,
        conversationId: targetConversationId,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimisticUserMessage]);

      try {
        const { result } = await sendConversationMessage(
          targetConversationId,
          trimmed,
          temperature
        );

        setConversations((prev) => {
          const filtered = prev.filter(
            (c) => c._id !== result.conversation._id
          );
          return [result.conversation, ...filtered];
        });

        if (activeIdRef.current === targetConversationId) {
          setMessages((prev) => [
            ...prev.filter((msg) => msg._id !== optimisticId),
            result.userMessage,
            result.assistantMessage,
          ]);
        }
      } catch (err) {
        setMessages((prev) => prev.filter((msg) => msg._id !== optimisticId));
        setInput(trimmed);
        setError(
          err instanceof Error ? err.message : "Failed to get LLM reply"
        );
      }
    } catch (err) {
      setInput(trimmed);
      setError(
        err instanceof Error ? err.message : "Failed to start conversation"
      );
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

  const isHealthy = health?.data.status === "ok";
  const activeConversation =
    conversations.find((c) => c._id === activeConversationId) ?? null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-left">
          {activeTab === "chat" && (
            <button
              type="button"
              className="btn-secondary sidebar-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="Toggle conversations sidebar"
            >
              {sidebarOpen ? "Hide Chats" : "Chats"}
            </button>
          )}
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
        <div className="workspace-layout">
          {sidebarOpen && (
            <aside className="sidebar" aria-label="Conversations">
              <div className="sidebar-header">
                <button
                  type="button"
                  onClick={() => void handleNewChat()}
                  disabled={sending || creatingConversation}
                  className="btn-primary new-chat-btn"
                >
                  {creatingConversation ? "Creating..." : "+ New Chat"}
                </button>
              </div>

              <div className="sidebar-list">
                {loadingConversations ? (
                  <p className="muted sidebar-empty">Loading chats...</p>
                ) : conversations.length === 0 ? (
                  <p className="muted sidebar-empty">
                    No conversations yet. Click <strong>+ New Chat</strong> or
                    send a message below.
                  </p>
                ) : (
                  conversations.map((conv) => {
                    const isActive = conv._id === activeConversationId;
                    const isEditing = editingId === conv._id;

                    return (
                      <div
                        key={conv._id}
                        className={`sidebar-item ${
                          isActive ? "sidebar-item-active" : ""
                        }`}
                      >
                        {isEditing ? (
                          <form
                            className="rename-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void submitRename(conv._id);
                            }}
                          >
                            <input
                              type="text"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  setEditingId(null);
                                }
                              }}
                              maxLength={120}
                              autoFocus
                              aria-label="Conversation title"
                            />
                            <div className="rename-actions">
                              <button type="submit" className="link-btn">
                                Save
                              </button>
                              <button
                                type="button"
                                className="link-btn"
                                onClick={() => setEditingId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="sidebar-select"
                              onClick={() =>
                                void handleSelectConversation(conv._id)
                              }
                              disabled={sending}
                            >
                              <span className="sidebar-title">{conv.title}</span>
                              <span className="sidebar-sub">
                                {conv.lastMessagePreview
                                  ? conv.lastMessagePreview
                                  : `${conv.messageCount} messages`}
                              </span>
                            </button>
                            <div className="sidebar-actions">
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() => startRenaming(conv)}
                                disabled={sending}
                                title="Rename conversation"
                                aria-label={`Rename ${conv.title}`}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                className="icon-btn icon-btn-danger"
                                onClick={() =>
                                  void handleDeleteConversation(conv._id)
                                }
                                disabled={sending}
                                title="Delete conversation"
                                aria-label={`Delete ${conv.title}`}
                              >
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </aside>
          )}

          <main className="chat-container">
            <div className="chat-toolbar">
              <div className="active-chat-heading">
                <strong>
                  {activeConversation ? activeConversation.title : "New Chat"}
                </strong>
                {activeConversation && (
                  <span className="muted">
                    {activeConversation.messageCount} messages
                  </span>
                )}
              </div>

              <div className="toolbar-controls">
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

                {activeConversation && (
                  <button
                    type="button"
                    onClick={() =>
                      void handleDeleteConversation(activeConversation._id)
                    }
                    disabled={sending}
                    className="btn-secondary"
                  >
                    Delete Chat
                  </button>
                )}
              </div>
            </div>

            <section className="chat-feed" aria-live="polite">
              {loadingMessages ? (
                <div className="chat-empty">
                  <p className="muted">Loading conversation from MongoDB...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="chat-empty">
                  <h2>
                    {activeConversation
                      ? activeConversation.title
                      : "Start a new conversation"}
                  </h2>
                  <p className="muted">
                    Each conversation keeps its own isolated context window and
                    history in MongoDB, powered by <code>{modelName}</code>.
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
        </div>
      )}
    </div>
  );
}
