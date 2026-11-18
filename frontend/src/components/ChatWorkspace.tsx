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
  copyTextToClipboard,
  MarkdownMessage,
} from "@/components/MarkdownMessage";
import {
  createConversation,
  deleteConversation,
  deleteDocument,
  fetchAvailableModels,
  fetchConversationDetail,
  fetchConversationDocuments,
  fetchConversations,
  fetchDocumentChunks,
  fetchHealth,
  regenerateConversationTitle,
  renameConversation,
  streamConversationMessage,
  updateConversation,
  uploadConversationDocument,
  type AvailableModel,
  type ChatMessage,
  type ConversationSummary,
  type DocumentChunkItem,
  type HealthCheckResult,
  type UploadedDocument,
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
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelName, setModelName] = useState<string>("qwen2.5:3b");
  const [temperature, setTemperature] = useState<number>(0.7);
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "You are GenZBot, a helpful, concise, and friendly AI assistant."
  );
  const [showPromptModal, setShowPromptModal] = useState<boolean>(false);
  const [promptDraft, setPromptDraft] = useState<string>("");

  const [loadingConversations, setLoadingConversations] =
    useState<boolean>(true);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [creatingConversation, setCreatingConversation] =
    useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [titling, setTitling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<string>("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [editingHeaderTitle, setEditingHeaderTitle] = useState<boolean>(false);
  const [headerTitleDraft, setHeaderTitleDraft] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState<boolean>(false);
  const [selectedDocForChunks, setSelectedDocForChunks] =
    useState<UploadedDocument | null>(null);
  const [chunksList, setChunksList] = useState<DocumentChunkItem[]>([]);
  const [loadingChunks, setLoadingChunks] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    activeIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const activeConversation =
    conversations.find((c) => c._id === activeConversationId) ?? null;

  useEffect(() => {
    document.title = activeConversation
      ? `${activeConversation.title} — GenZBot`
      : "GenZBot — AI Chatbot";
  }, [activeConversation]);

  const selectConversation = useCallback(async (conversationId: string) => {
    setActiveConversationId(conversationId);
    activeIdRef.current = conversationId;
    setEditingHeaderTitle(false);
    setLoadingMessages(true);
    setError(null);

    try {
      const [detail, docs] = await Promise.all([
        fetchConversationDetail(conversationId),
        fetchConversationDocuments(conversationId).catch(() => []),
      ]);
      if (activeIdRef.current !== conversationId) return;
      setMessages(detail.messages);
      setDocuments(docs);
      setModelName(detail.model);
      setTemperature(detail.temperature);
      setSystemPrompt(
        detail.conversation.systemPrompt ||
          "You are GenZBot, a helpful, concise, and friendly AI assistant."
      );
    } catch (err) {
      if (activeIdRef.current !== conversationId) return;
      setMessages([]);
      setDocuments([]);
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

    const [healthOutcome, conversationsOutcome, modelsOutcome] =
      await Promise.allSettled([
        fetchHealth(),
        fetchConversations(),
        fetchAvailableModels(),
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

    if (modelsOutcome.status === "fulfilled") {
      setAvailableModels(modelsOutcome.value.models);
      if (modelsOutcome.value.defaultModel) {
        setModelName((prev) => prev || modelsOutcome.value.defaultModel);
      }
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
  }, [messages, sending, streamingContent]);

  async function handleNewChat() {
    if (sending || titling || creatingConversation) return;
    setCreatingConversation(true);
    setError(null);
    setEditingId(null);
    setEditingHeaderTitle(false);

    try {
      const created = await createConversation({
        title: "New Chat",
        model: modelName,
      });
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
    if (sending || titling || conversationId === activeConversationId) return;
    setEditingId(null);
    setEditingHeaderTitle(false);
    await selectConversation(conversationId);
  }

  function startRenaming(conv: ConversationSummary) {
    setEditingHeaderTitle(false);
    setEditingId(conv._id);
    setEditingTitle(conv.title);
  }

  async function submitRename(conversationId: string, rawTitle: string) {
    const trimmed = rawTitle.trim();
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
      setEditingHeaderTitle(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to rename conversation"
      );
    }
  }

  function startHeaderRename() {
    if (!activeConversation || sending || titling) return;
    setEditingId(null);
    setHeaderTitleDraft(activeConversation.title);
    setEditingHeaderTitle(true);
  }

  async function handleRegenerateTitle() {
    if (!activeConversation || sending || titling || messages.length === 0) {
      return;
    }

    setTitling(true);
    setError(null);

    try {
      const updated = await regenerateConversationTitle(activeConversation._id);
      setConversations((prev) =>
        prev.map((c) => (c._id === updated._id ? updated : c))
      );
      if (editingHeaderTitle && activeIdRef.current === updated._id) {
        setEditingHeaderTitle(false);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate title"
      );
    } finally {
      setTitling(false);
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    if (sending || titling) return;
    setError(null);
    if (editingId === conversationId) {
      setEditingId(null);
    }
    if (activeConversationId === conversationId) {
      setEditingHeaderTitle(false);
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
          setDocuments([]);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete conversation"
      );
    }
  }

  function handleStopStreaming() {
    streamAbortRef.current?.abort();
  }

  async function handleCopyMessage(messageId: string, content: string) {
    const ok = await copyTextToClipboard(content);
    if (ok) {
      setCopiedMessageId(messageId);
      setTimeout(() => {
        setCopiedMessageId((prev) => (prev === messageId ? null : prev));
      }, 1800);
    }
  }

  async function handleModelChange(nextModel: string) {
    setModelName(nextModel);
    if (!activeConversationId) return;

    try {
      const updated = await updateConversation(activeConversationId, {
        model: nextModel,
      });
      setConversations((prev) =>
        prev.map((c) => (c._id === updated._id ? updated : c))
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to switch conversation model"
      );
    }
  }

  async function handleSaveSystemPrompt(newPrompt: string) {
    const trimmed = newPrompt.trim();
    if (!activeConversationId) return;

    try {
      const updated = await updateConversation(activeConversationId, {
        systemPrompt: trimmed,
      });
      setConversations((prev) =>
        prev.map((c) => (c._id === updated._id ? updated : c))
      );
      setSystemPrompt(
        updated.systemPrompt ||
          "You are GenZBot, a helpful, concise, and friendly AI assistant."
      );
      setShowPromptModal(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update system prompt"
      );
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = "";
    setUploadingDoc(true);
    setError(null);

    let targetConvId = activeConversationId;
    try {
      if (!targetConvId) {
        const created = await createConversation({
          title: `Doc: ${file.name.slice(0, 30)}`,
          model: modelName,
        });
        targetConvId = created._id;
        setConversations((prev) => [created, ...prev]);
        setActiveConversationId(targetConvId);
        activeIdRef.current = targetConvId;
      }

      const res = await uploadConversationDocument(targetConvId, file);
      setDocuments((prev) => [
        res.document,
        ...prev.filter((d) => d._id !== res.document._id),
      ]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to upload document"
      );
    } finally {
      setUploadingDoc(false);
    }
  }

  async function handleDeleteDoc(documentId: string) {
    try {
      await deleteDocument(documentId);
      setDocuments((prev) => prev.filter((d) => d._id !== documentId));
      if (selectedDocForChunks?._id === documentId) {
        setSelectedDocForChunks(null);
        setChunksList([]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete document"
      );
    }
  }

  async function handleInspectChunks(doc: UploadedDocument) {
    setSelectedDocForChunks(doc);
    setLoadingChunks(true);
    try {
      const res = await fetchDocumentChunks(doc._id);
      setChunksList(res.chunks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chunks");
    } finally {
      setLoadingChunks(false);
    }
  }

  async function submitMessage(explicitText?: string) {
    const trimmed = (explicitText !== undefined ? explicitText : input).trim();
    if (!trimmed || sending || titling) return;

    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    setSending(true);
    setStreamingContent("");
    setError(null);
    if (explicitText === undefined) {
      setInput("");
    }

    let targetConversationId = activeConversationId;
    let createdOnSend: ConversationSummary | null = null;

    try {
      if (!targetConversationId) {
        createdOnSend = await createConversation({
          title: "New Chat",
          model: modelName,
        });
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
        const { result } = await streamConversationMessage(
          targetConversationId,
          trimmed,
          {
            temperature,
            model: modelName,
            signal: abortController.signal,
            onStart: (meta) => {
              if (meta.model) {
                setModelName(meta.model);
              }
            },
            onToken: (token) => {
              setStreamingContent((prev) => prev + token);
            },
          }
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
        if (explicitText === undefined) {
          setInput(trimmed);
        }

        if (
          err instanceof DOMException &&
          err.name === "AbortError"
        ) {
          setError("Generation stopped.");
        } else {
          setError(
            err instanceof Error ? err.message : "Failed to get LLM reply"
          );
        }
      }
    } catch (err) {
      if (explicitText === undefined) {
        setInput(trimmed);
      }
      setError(
        err instanceof Error ? err.message : "Failed to start conversation"
      );
    } finally {
      streamAbortRef.current = null;
      setStreamingContent("");
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
                  disabled={sending || titling || creatingConversation}
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
                              void submitRename(conv._id, editingTitle);
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
                              disabled={sending || titling}
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
                                disabled={sending || titling}
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
                                disabled={sending || titling}
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
                {activeConversation && editingHeaderTitle ? (
                  <form
                    className="toolbar-rename-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitRename(
                        activeConversation._id,
                        headerTitleDraft
                      );
                    }}
                  >
                    <input
                      type="text"
                      value={headerTitleDraft}
                      onChange={(e) => setHeaderTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setEditingHeaderTitle(false);
                        }
                      }}
                      maxLength={120}
                      autoFocus
                      aria-label="Edit active conversation title"
                    />
                    <button type="submit" className="link-btn">
                      Save
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setEditingHeaderTitle(false)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    {activeConversation ? (
                      <button
                        type="button"
                        className="toolbar-title-btn"
                        onClick={startHeaderRename}
                        disabled={sending || titling}
                        title="Click to rename conversation"
                      >
                        {activeConversation.title}
                      </button>
                    ) : (
                      <strong>New Chat</strong>
                    )}
                    {activeConversation && (
                      <span className="muted">
                        {activeConversation.messageCount} messages
                        {activeConversation.titleSource &&
                          activeConversation.titleSource !== "default" && (
                            <>
                              {" "}
                              &middot;{" "}
                              {activeConversation.titleSource === "auto"
                                ? "auto-titled"
                                : "custom title"}
                            </>
                          )}
                      </span>
                    )}
                  </>
                )}
              </div>

              <div className="toolbar-controls">
                <div className="temp-control">
                  <label htmlFor="model-select">Model</label>
                  <select
                    id="model-select"
                    value={modelName}
                    onChange={(e) => void handleModelChange(e.target.value)}
                    disabled={sending || titling}
                  >
                    {(availableModels.some((m) => m.name === modelName)
                      ? availableModels
                      : [{ name: modelName }, ...availableModels]
                    ).map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.parameterSize
                          ? `${m.name} (${m.parameterSize})`
                          : m.name}
                      </option>
                    ))}
                  </select>
                </div>

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

                {activeConversation && messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleRegenerateTitle()}
                    disabled={sending || titling}
                    className="btn-secondary"
                    title="Generate a concise title from conversation messages"
                  >
                    {titling ? "Titling..." : "Auto-title"}
                  </button>
                )}

                {activeConversation && (
                  <button
                    type="button"
                    onClick={() => {
                      setPromptDraft(systemPrompt);
                      setShowPromptModal(true);
                    }}
                    disabled={sending || titling}
                    className="btn-secondary"
                    title="Customize system instructions for this conversation"
                  >
                    System Prompt
                  </button>
                )}

                {activeConversation && (
                  <button
                    type="button"
                    onClick={() =>
                      void handleDeleteConversation(activeConversation._id)
                    }
                    disabled={sending || titling}
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
                    Responses stream live token-by-token from{" "}
                    <code>{modelName}</code> via Server-Sent Events and persist
                    to MongoDB.
                  </p>
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isLatestAssistant =
                    msg.role === "assistant" &&
                    index === messages.length - 1;

                  return (
                    <article
                      key={msg._id}
                      className={`bubble-row ${
                        msg.role === "user"
                          ? "bubble-row-user"
                          : "bubble-row-bot"
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
                          <div className="bubble-header-actions">
                            {msg.role === "assistant" && (
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() =>
                                  void handleCopyMessage(msg._id, msg.content)
                                }
                              >
                                {copiedMessageId === msg._id
                                  ? "Copied!"
                                  : "Copy"}
                              </button>
                            )}
                            <span>
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                        <div className="bubble-content">
                          {msg.role === "assistant" ? (
                            <MarkdownMessage content={msg.content} />
                          ) : (
                            msg.content
                          )}
                        </div>
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

                        {isLatestAssistant &&
                          msg.suggestedQuestions &&
                          msg.suggestedQuestions.length > 0 &&
                          !sending && (
                            <div className="followup-container">
                              <div className="followup-header">
                                <span className="followup-sparkle">✦</span>
                                <span className="followup-title">
                                  Suggested follow-ups
                                </span>
                              </div>
                              <div className="followup-chips">
                                {msg.suggestedQuestions.map((q, qIdx) => (
                                  <button
                                    key={qIdx}
                                    type="button"
                                    className="followup-chip"
                                    disabled={sending || titling}
                                    onClick={() => void submitMessage(q)}
                                  >
                                    <span>{q}</span>
                                    <span className="followup-arrow">&rarr;</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                      </div>
                    </article>
                  );
                })
              )}

              {sending && (
                <article className="bubble-row bubble-row-bot">
                  <div className="bubble bubble-bot">
                    <div className="bubble-header">
                      <strong>GenZBot</strong>
                      <span>streaming...</span>
                    </div>
                    <div className="bubble-content">
                      {streamingContent ? (
                        <>
                          <MarkdownMessage content={streamingContent} />
                          <span className="stream-cursor" aria-hidden="true">
                            &#9610;
                          </span>
                        </>
                      ) : (
                        <span className="bubble-thinking">
                          Connecting to {modelName}...
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              )}

              <div ref={messagesEndRef} />
            </section>

            {error && <div className="alert-error">{error}</div>}

            {(documents.length > 0 || uploadingDoc) && (
              <div className="doc-tray">
                <div className="doc-tray-header">
                  <span className="doc-tray-title">
                    Attached Documents ({documents.length})
                  </span>
                  <span className="doc-tray-hint">
                    Click a document to inspect its chunks
                  </span>
                </div>
                <div className="doc-chips">
                  {documents.map((doc) => (
                    <div key={doc._id} className="doc-chip">
                      <button
                        type="button"
                        className="doc-chip-btn"
                        onClick={() => void handleInspectChunks(doc)}
                        title="Click to view generated chunks"
                      >
                        <span className="doc-icon">📄</span>
                        <span className="doc-name">{doc.fileName}</span>
                        <span
                          className={`doc-badge ${
                            doc.status === "ready"
                              ? "doc-badge-ready"
                              : doc.status === "failed"
                              ? "doc-badge-failed"
                              : "doc-badge-pending"
                          }`}
                        >
                          {doc.status === "ready"
                            ? doc.embeddingDimensions
                              ? `${doc.chunkCount} chunks · ${doc.embeddingDimensions}d`
                              : `${doc.chunkCount} chunks`
                            : doc.status === "failed"
                            ? "Failed"
                            : "Processing..."}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="doc-delete-btn"
                        onClick={() => void handleDeleteDoc(doc._id)}
                        title="Remove document"
                        aria-label={`Remove ${doc.fileName}`}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                  {uploadingDoc && (
                    <div className="doc-chip doc-chip-loading">
                      <span className="doc-icon">⏳</span>
                      <span className="doc-name">
                        Chunking &amp; Embedding...
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="chat-composer">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".pdf,.txt,.md,.json,.csv"
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="btn-attach"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingDoc || sending}
                title="Upload PDF or Text document"
                aria-label="Upload document"
              >
                📎
              </button>
              <textarea
                rows={2}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  documents.length > 0
                    ? `Ask questions about ${documents
                        .map((d) => d.fileName)
                        .join(", ")}...`
                    : "Ask GenZBot anything or upload a document... (Enter to send)"
                }
                maxLength={4000}
                disabled={sending}
                aria-label="Chat message"
              />
              {sending ? (
                <button
                  type="button"
                  onClick={handleStopStreaming}
                  className="btn-stop"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="btn-primary"
                >
                  Send
                </button>
              )}
            </form>
          </main>
        </div>
      )}

      {showPromptModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowPromptModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-modal-title"
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="prompt-modal-title">Custom System Prompt</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowPromptModal(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <p className="muted modal-subtitle">
              Steer how GenZBot behaves in this conversation (sets the AI’s
              personality, rules, and boundaries).
            </p>

            <div className="prompt-presets">
              <span className="preset-label">Presets:</span>
              <button
                type="button"
                className="preset-chip"
                onClick={() =>
                  setPromptDraft(
                    "You are GenZBot, a helpful, concise, and friendly AI assistant."
                  )
                }
              >
                Default Assistant
              </button>
              <button
                type="button"
                className="preset-chip"
                onClick={() =>
                  setPromptDraft(
                    "You are an expert software engineer and code mentor. Write clean, idiomatic TypeScript and explain step-by-step."
                  )
                }
              >
                Code Mentor
              </button>
              <button
                type="button"
                className="preset-chip"
                onClick={() =>
                  setPromptDraft(
                    "Be extremely concise, direct, and factual. Answer in 1 to 3 sentences without conversational filler."
                  )
                }
              >
                Concise & Direct
              </button>
              <button
                type="button"
                className="preset-chip"
                onClick={() =>
                  setPromptDraft(
                    "You are a Socratic tutor. Guide the user to the answer by asking thoughtful, probing questions."
                  )
                }
              >
                Socratic Tutor
              </button>
            </div>

            <textarea
              className="prompt-textarea"
              rows={5}
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              maxLength={2000}
              placeholder="e.g. You are a senior frontend developer who speaks in pirate slang..."
              aria-label="System prompt text"
            />

            <div className="modal-footer">
              <span className="muted prompt-count">
                {promptDraft.length} / 2000
              </span>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setPromptDraft(
                      "You are GenZBot, a helpful, concise, and friendly AI assistant."
                    )
                  }
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleSaveSystemPrompt(promptDraft)}
                >
                  Save Prompt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedDocForChunks && (
        <div
          className="modal-overlay"
          onClick={() => setSelectedDocForChunks(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="chunks-modal-title"
        >
          <div
            className="modal-card doc-chunks-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="chunks-modal-title">
                  📄 {selectedDocForChunks.fileName}
                </h2>
                <p className="muted modal-subtitle">
                  {selectedDocForChunks.chunkCount} chunks &bull;{" "}
                  {selectedDocForChunks.extractedCharacterCount} chars
                  {selectedDocForChunks.embeddingDimensions
                    ? ` • ${selectedDocForChunks.embeddingDimensions}d vectors (${selectedDocForChunks.embeddingModel ?? "embedded"})`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelectedDocForChunks(null)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="chunks-list">
              {loadingChunks ? (
                <p className="muted">Loading chunks from MongoDB...</p>
              ) : chunksList.length === 0 ? (
                <p className="muted">No chunks found for this document.</p>
              ) : (
                chunksList.map((chunk) => (
                  <div key={chunk._id} className="chunk-card">
                    <div className="chunk-card-header">
                      <span className="chunk-badge">
                        Chunk #{chunk.chunkIndex + 1}
                      </span>
                      <span className="muted chunk-chars">
                        {chunk.characterCount} chars
                        {chunk.embeddingDimensions
                          ? ` · ${chunk.embeddingDimensions}d vector`
                          : ""}
                      </span>
                    </div>
                    <pre className="chunk-text">{chunk.text}</pre>
                  </div>
                ))
              )}
            </div>

            <div className="modal-footer">
              <span className="muted prompt-count">
                {selectedDocForChunks.embeddingDimensions
                  ? `Embedded with ${selectedDocForChunks.embeddingModel} (${selectedDocForChunks.embeddingDimensions} dimensions)`
                  : "Chunks stored in MongoDB"}
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedDocForChunks(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
