import type { BookmarkDocType } from "../../db/schema";
import type { BookmarkForgeDB } from "../../db/types";
import type { RxDocument } from "rxdb";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Brain,
  MessageSquare,
  Send,
  Sparkles,
  Trash2,
  Bot,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { safeGet, safeSet, safeRemove } from "../../store/safeStorage";
import { CardProps } from "./shared-props";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { logRateLimited } from "../../utils/boundedLog";

interface Props extends CardProps {
  t: TFunction;
}

interface Avatar {
  id: string;
  name: string;
  topic: string;
  createdAt: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

const AVATARS_KEY = "bookmarkforge_knowledge_avatars";

function chatKey(id: string): string {
  return `bookmarkforge_chat_${id}`;
}

function loadAvatars(): Avatar[] {
  try {
    const raw = safeGet(AVATARS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {return [];}
    return parsed.filter((item): item is Avatar => {
      if (!item || typeof item !== "object") {return false;}
      const value = item as Partial<Avatar>;
      return typeof value.id === "string" &&
        typeof value.name === "string" &&
        typeof value.topic === "string" &&
        typeof value.createdAt === "string";
    });
  } catch {
    logRateLimited(
      "warn",
      "avatars-cache-parse",
      "Stored knowledge avatars are corrupted; starting empty",
    );
    return [];
  }
}

function saveAvatars(avatars: Avatar[]) {
  safeSet(AVATARS_KEY, JSON.stringify(avatars));
}

function loadChat(avatarId: string): ChatMessage[] {
  try {
    const raw = safeGet(chatKey(avatarId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {return [];}
    return parsed.filter((item): item is ChatMessage => {
      if (!item || typeof item !== "object") {return false;}
      const value = item as Partial<ChatMessage>;
      return (value.role === "user" || value.role === "assistant") &&
        typeof value.text === "string";
    });
  } catch {
    logRateLimited(
      "warn",
      "avatars-chat-cache-parse",
      "Stored avatar chat history is corrupted; starting empty",
      { avatarId },
    );
    return [];
  }
}

function saveChat(avatarId: string, messages: ChatMessage[]) {
  safeSet(chatKey(avatarId), JSON.stringify(messages));
}

export const KnowledgeAvatars: React.FC<Props> = ({ cardVariants, t: _t }) => {
  const { t } = useTranslation();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [avatars, setAvatars] = useState<Avatar[]>(loadAvatars);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [streamingReply, setStreamingReply] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newAvatarName, setNewAvatarName] = useState("");
  const [newAvatarTopic, setNewAvatarTopic] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkDocType[]>([]);
  const {
    loading: _bookmarksLoading,
  } = useGuardedDataLoad<BookmarkDocType[]>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const docs = await db.bookmarks
        .find({ selector: { isDeleted: false, isPrivate: false } })
        .exec();
      if (signal.aborted) {return [];}
      return docs.map(
        (d: RxDocument<BookmarkDocType>) =>
          d.toJSON() as unknown as BookmarkDocType,
      );
    },
    {
      onSuccess: (bookmarks) => setBookmarks(bookmarks),
      // db unavailable — keep the empty list
    },
  );
  const {
    runWithSignal: runSend,
    isRunning: isSending,
    cancel: cancelSend,
  } = useGuardedAction<ChatMessage>({
    blockReentry: false,
    onStart: () => setStreamingReply(""),
    onSuccess: (assistantMessage) => {
      setStreamingReply("");
      const final = [...assistantMessagesRef.current, assistantMessage];
      setChatMessages(final);
      if (selectedAvatarId) {
        saveChat(selectedAvatarId, final);
      }
    },
    onError: (error) => {
      setStreamingReply("");
      if (error instanceof Error && error.name === "AbortError") {return;}
      const errorMessage: ChatMessage = {
        role: "assistant",
        text: t("app_errorOccurred", "An error occurred. Please try again."),
      };
      const final = [...assistantMessagesRef.current, errorMessage];
      setChatMessages(final);
      if (selectedAvatarId) {
        saveChat(selectedAvatarId, final);
      }
    },
  });
  // The user message + prior history at call time: onSuccess/onError resolve
  // asynchronously and would otherwise read the LATEST chatMessages.
  const assistantMessagesRef = useRef<ChatMessage[]>([]);
  assistantMessagesRef.current = chatMessages;

  useEffect(() => {
    saveAvatars(avatars);
  }, [avatars]);

  useEffect(() => {
    cancelSend();
    if (selectedAvatarId) {
      setChatMessages(loadChat(selectedAvatarId));
    } else {
      setChatMessages([]);
    }
    // Drop any in-flight stream when switching avatars so a previous reply
    // never renders into a different avatar's chat. cancelSend() also
    // resets isRunning (the fixed helper cancel), clearing the sending flag.
    setStreamingReply("");
  }, [cancelSend, selectedAvatarId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleCreate = () => {
    if (!newAvatarName.trim() || !newAvatarTopic.trim()) {return;}
    const avatar: Avatar = {
      id: crypto.randomUUID(),
      name: newAvatarName.trim(),
      topic: newAvatarTopic.trim(),
      createdAt: new Date().toISOString(),
    };
    setAvatars((prev) => [...prev, avatar]);
    setNewAvatarName("");
    setNewAvatarTopic("");
    setShowCreateForm(false);
    setIsCreating(false);
  };

  const handleDelete = (id: string) => {
    setAvatars((prev) => prev.filter((a) => a.id !== id));
    safeRemove(chatKey(id));
    if (selectedAvatarId === id) {
      setSelectedAvatarId(null);
    }
  };

  const handleSend = () => {
    const input = chatInput.trim();
    if (!input || !selectedAvatarId || isSending) {return;}

    const avatar = avatars.find((a) => a.id === selectedAvatarId);
    if (!avatar) {return;}

    const userMessage: ChatMessage = { role: "user", text: input };
    const updated = [...chatMessages, userMessage];
    setChatMessages(updated);
    setChatInput("");
    assistantMessagesRef.current = updated;

    const filtered = bookmarks
      .filter((b: BookmarkDocType) => {
        const text = `${b.title} ${(b.tags || []).join(" ")}`.toLowerCase();
        return text.includes(avatar.topic.toLowerCase());
      })
      .slice(0, 10);

    const contextStr = filtered
      .map(
        (b: BookmarkDocType, i: number) =>
          `${i + 1}. ${b.title || "Untitled"}${b.tags?.length ? ` (tags: ${b.tags.join(", ")})` : ""}${b.content ? `\n   ${b.content.substring(0, 200)}` : ""}`,
      )
      .join("\n\n");

    const prompt = `You are a knowledge expert on ${avatar.topic}. You ONLY know what is in the following bookmarks. If the answer isn't in the bookmarks, say 'I don't have enough knowledge about that in my library.' Bookmark context:\n${contextStr}\n\nUser question: ${input}`;

    void runSend(async (signal) => {
      const { agentService } = await import("../../services/ai/AgentService");
      // Stream real tokens live into a transient assistant bubble; the final
      // response.text then replaces it as a persisted message.
      const res = await agentService.globalChat(
        prompt,
        undefined,
        false,
        undefined,
        (chunk) => {
          if (!signal.aborted) {
            setStreamingReply((prev) => prev + chunk);
          }
        },
        undefined,
        undefined,
        signal,
      );
      if (signal.aborted) {return { role: "assistant", text: "" };}
      return { role: "assistant", text: res.text } as ChatMessage;
    });
  };

  const selectedAvatar = avatars.find((a) => a.id === selectedAvatarId);

  return (
    <motion.div
      variants={cardVariants}
      className="bento-item p-5 flex flex-col h-full"
    >
      <div className="flex items-center gap-5 mb-6">
        <div className="p-4 rounded-[1.5rem] shadow-2xl ds-bg-accent-primary ds-shadow-accent-hero text-white">
          <Brain className="size-7" />
        </div>
        <div className="flex-1">
          <h2 className="ds-h2">
            {t("app_knowledgeAvatars", "Knowledge Avatars")}
          </h2>
          <p className="ds-label-section mt-1 ds-text-muted">
            {t(
              "app_avatarSubtitle",
              "AI personas that speak from your library",
            )}
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="p-3 rounded-xl ds-bg-accent-soft hover:ds-bg-accent-primary hover:text-white transition-all"
          title={t("app_createAvatar", "Create Avatar")}
        >
          <Sparkles className="size-5" />
        </button>
      </div>

      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="p-4 rounded-2xl ds-bg-card ds-border space-y-3">
              <input
                value={newAvatarName}
                onChange={(e) => setNewAvatarName(e.target.value)}
                aria-label={t("app_avatarNamePlaceholder", "Avatar name")}
                placeholder={t(
                  "app_avatarNamePlaceholder",
                  "e.g. Rust Expert, ML Guide",
                )}
                className="w-full p-3 rounded-xl ds-bg-secondary ds-border text-sm outline-none focus:ds-border-accent transition-colors"
              />
              <input
                value={newAvatarTopic}
                onChange={(e) => setNewAvatarTopic(e.target.value)}
                aria-label={t("app_avatarTopicPlaceholder", "Avatar topic")}
                placeholder={t(
                  "app_avatarTopicPlaceholder",
                  "e.g. Rust programming, machine learning",
                )}
                className="w-full p-3 rounded-xl ds-bg-secondary ds-border text-sm outline-none focus:ds-border-accent transition-colors"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewAvatarName("");
                    setNewAvatarTopic("");
                  }}
                  className="truncate flex-1 py-3 rounded-xl ds-bg-secondary ds-border text-sm font-bold hover:opacity-90 transition-all"
                >
                  {t("app_cancel", "Cancel")}
                </button>
                <button
                  onClick={handleCreate}
                  disabled={
                    !newAvatarName.trim() ||
                    !newAvatarTopic.trim() ||
                    isCreating
                  }
                  className="truncate flex-1 py-3 rounded-xl ds-bg-accent-primary ds-text-on-accent text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {isCreating
                    ? t("app_creating", "Creating...")
                    : t("app_saveAvatar", "Save Avatar")}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {avatars.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-thin">
          {avatars.map((avatar) => (
            <button
              key={avatar.id}
              onClick={() => setSelectedAvatarId(avatar.id)}
              className={`shrink-0 max-w-[12rem] truncate flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold whitespace-nowrap transition-all ${
                selectedAvatarId === avatar.id
                  ? "ds-bg-accent-primary ds-text-on-accent"
                  : "ds-bg-accent-soft ds-text-accent hover:ds-bg-accent-primary hover:ds-text-on-accent"
              }`}
            >
              <Bot className="size-3.5" />
              {avatar.name}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(avatar.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    handleDelete(avatar.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className="text-red-400 hover:text-red-600 transition-colors"
              >
                <Trash2 className="size-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedAvatar && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 max-h-[400px] overflow-y-auto space-y-3 p-2 mb-4 scrollbar-thin">
            {chatMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <MessageSquare className="size-8 ds-text-muted mb-3" />
                <p className="text-xs ds-text-muted max-w-[240px]">
                  {t("app_avatarChatEmpty", "Ask anything about {{topic}}", {
                    topic: selectedAvatar.topic,
                  })}
                </p>
              </div>
            )}
            {chatMessages.map((msg, i) =>
              msg.role === "user" ? (
                <div
                  key={i}
                  className="ds-bg-accent-primary ds-text-on-accent rounded-2xl rounded-br-sm p-3 ms-12 text-sm leading-relaxed"
                >
                  {msg.text}
                </div>
              ) : (
                <div
                  key={i}
                  className="ds-bg-secondary rounded-2xl rounded-bl-sm p-3 me-12 text-sm leading-relaxed flex items-start gap-2"
                >
                  <div className="shrink-0 mt-0.5">
                    <Bot className="size-5 ds-text-muted" />
                  </div>
                  <span>{msg.text}</span>
                </div>
              ),
            )}
            {isSending && (
              <div className="ds-bg-secondary rounded-2xl rounded-bl-sm p-3 me-12 flex items-start gap-2">
                <div className="shrink-0 mt-0.5">
                  <Bot className="size-5 ds-text-muted" />
                </div>
                {streamingReply ? (
                  <span className="whitespace-pre-wrap text-sm leading-relaxed">
                    {streamingReply}
                  </span>
                ) : (
                  <div className="flex gap-1">
                    <span className="size-2 rounded-full ds-bg-muted animate-bounce" />
                    <span className="size-2 rounded-full ds-bg-muted animate-bounce [animation-delay:0.1s]" />
                    <span className="size-2 rounded-full ds-bg-muted animate-bounce [animation-delay:0.2s]" />
                  </div>
                )}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="flex gap-2 mt-3">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              aria-label={t("app_avatarChatPlaceholder", "Chat input")}
              placeholder={t(
                "app_avatarChatPlaceholder",
                "Ask about {{topic}}...",
                {
                  topic: selectedAvatar.topic,
                },
              )}
              className="flex-1 p-3 rounded-xl ds-bg-card ds-border text-sm outline-none focus:ds-border-accent transition-colors"
              disabled={isSending}
            />
            <button
              onClick={handleSend}
              disabled={!chatInput.trim() || isSending}
              className="p-3 rounded-xl ds-bg-accent-primary ds-text-on-accent hover:opacity-90 transition-all disabled:opacity-50"
            >
              <Send className="size-5" />
            </button>
          </div>
        </div>
      )}

      {!selectedAvatar && avatars.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center py-8 flex-1">
          <Brain className="size-10 ds-text-muted mb-3" />
          <p className="text-xs ds-text-muted max-w-[260px] mb-4">
            {t(
              "app_noAvatarsYet",
              "Create AI personas that answer questions strictly from your bookmarked knowledge.",
            )}
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="truncate flex items-center gap-2 px-5 py-3 rounded-xl ds-bg-accent-primary ds-text-on-accent text-xs font-bold hover:opacity-90 transition-all"
          >
            <Sparkles className="size-4" />
            {t("app_createFirstAvatar", "Create Your First Avatar")}
          </button>
        </div>
      )}
    </motion.div>
  );
};
