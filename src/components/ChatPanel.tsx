import React, { useState, useEffect, useRef } from "react";
import { agentService } from "../services/ai/AgentService";
import { useTranslation } from "react-i18next";
import { useGuardedAction } from "../hooks/useGuardedAction";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  sources?: unknown[];
}

interface ChatPanelProps {
  documentId?: string;
  textContent?: string;
  isPrivate?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  documentId,
  textContent,
  isPrivate,
}) => {
  const { t } = useTranslation();
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Single streaming chat action — useGuardedAction + runWithSignal: the
  // guard's signal aborts the in-flight globalChat on a newer send, content
  // switch or unmount; chunk streaming gates on !signal.aborted; the user
  // message append stays in the handler (it must not run when reentry is
  // blocked), gated by the same isLoading check as before.
  const chat = useGuardedAction<{ text: string; sources: unknown[] }>({
    onSuccess: (result) => {
      setStreamingText("");
      setMessages((m) => [
        ...m,
        { role: "assistant", text: result.text, sources: result.sources },
      ]);
    },
    onError: (error) => {
      setStreamingText("");
      if (error instanceof Error && error.name === "AbortError") {return;}
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: t(
            "app_chatError",
            "Sorry, I encountered an error. Please try again.",
          ),
        },
      ]);
    },
  });
  const isLoading = chat.isRunning;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    // I1 (audit 2026-08-13): memory access routed through AgentService so
    // the UI never imports the memory subsystem directly.
    const initMemory = async () => {
      await agentService.ensureMemoryInitialized();
      const activeSession = await agentService.getActiveSessionId();
      if (!cancelled && activeSession) {
        setSessionId(activeSession);
      }
    };
    void initMemory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    chat.cancel();
    setStreamingText("");
  }, [chat.cancel, documentId, textContent, isPrivate]);

  const send = async () => {
    const text = input.trim();
    if (!text || isLoading) {return;}

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setStreamingText("");

    await chat.runWithSignal(async (signal) => {
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        currentSessionId = await agentService.getOrCreateSession(
          text.substring(0, 50),
        );
        if (signal.aborted) {
          throw new DOMException("Chat aborted", "AbortError");
        }
        if (currentSessionId) {
          setSessionId(currentSessionId);
        }
      }

      if (signal.aborted) {
        throw new DOMException("Chat aborted", "AbortError");
      }

      // Pass the current document as context so the assistant can answer
      // about what the user is viewing. `documentId` lets globalChat exclude
      // that document from the RAG search — its full text is already
      // provided inline as CURRENT DOCUMENT CONTEXT.
      const documentContext = textContent?.trim()
        ? {
            id: documentId,
            text: textContent,
            // The privacy of the document itself: a private doc must never
            // reach a cloud provider even in a "public" chat (AgentService
            // only injects context for private chats or isPublic docs).
            isPublic: isPrivate !== true,
          }
        : undefined;

      // Stream real tokens live through onChunk (local providers deliver
      // tokens incrementally; the assistant bubble below renders them as
      // they arrive). The final response.text replaces the transient bubble.
      const response = await agentService.globalChat(
        text,
        undefined,
        isPrivate,
        currentSessionId ?? undefined,
        (chunk) => {
          if (!signal.aborted) {
            setStreamingText((prev) => prev + chunk);
          }
        },
        documentContext,
        undefined,
        signal,
      );

      return { text: response.text, sources: response.sources };
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div data-testid="chat-panel" className="flex flex-col h-full">
      <div
        className="flex-1 overflow-y-auto p-4 space-y-3"
        aria-label={t("aria_chat_history", "Chat history")}
        role="log"
      >
        {messages.length === 0 && (
          <div className="text-center mt-8 ds-text-muted">
            <p className="text-sm">
              {t(
                "startConversation",
                "Start a conversation. I'll remember context across sessions.",
              )}
            </p>
          </div>
        )}
        {messages.map((m, idx) => (
          <div
            key={idx}
            data-testid={`msg-${idx}`}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm`}
              style={{
                background:
                  m.role === "user"
                    ? "var(--accent-primary)"
                    : "var(--bg-secondary)",
                color: m.role === "user" ? "white" : "var(--text-primary)",
              }}
            >
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 text-sm ds-bg-secondary">
              {streamingText ? (
                <p className="whitespace-pre-wrap">{streamingText}</p>
              ) : (
                <div className="flex space-x-2">
                  <div className="size-2 rounded-full animate-bounce ds-bg-text-muted" />
                  <div
                    className="size-2 rounded-full animate-bounce ds-bg-text-muted"
                    style={{ animationDelay: "0.1s" }}
                  />
                  <div
                    className="size-2 rounded-full animate-bounce ds-bg-text-muted"
                    style={{ animationDelay: "0.2s" }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-3 ds-divider-t">
        <div className="flex gap-2">
          {" "}
          <input
            className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
            style={
              {
                border: "1px solid var(--state-inactive-border)",
                background: "var(--input-bg)",
                color: "var(--text-primary)",
                "--tw-ring-color": "var(--accent-primary)",
              } as React.CSSProperties
            }
            aria-label={t("app_typeMessage", "Type a message")}
            placeholder={t("app_typeMessage", "Type a message")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            className="truncate px-4 py-2 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed ds-bg-accent-primary ds-shadow-accent-strong"
            onClick={send}
            disabled={isLoading || !input.trim()}
          >
            {t("app_send", "Send")}
          </button>
        </div>
      </div>
    </div>
  );
};
