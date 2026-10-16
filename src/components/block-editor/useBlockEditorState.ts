import { useState, useRef } from "react";
import type { PartialBlock } from "@blocknote/core";

export interface BlockEditorState {
  initialContent: "loading" | "empty" | PartialBlock[];
  setInitialContent: (v: "loading" | "empty" | PartialBlock[]) => void;
  docTitle: string;
  setDocTitle: (v: string) => void;
  editorText: string;
  setEditorText: (v: string) => void;
  saveStatus: "saved" | "unsaved" | "saving";
  setSaveStatus: (v: "saved" | "unsaved" | "saving") => void;
  theme: "light" | "dark";
  setTheme: (v: "light" | "dark") => void;
  showChat: boolean;
  setShowChat: (v: boolean) => void;
  showHistory: boolean;
  setShowHistory: (v: boolean) => void;
  showPreview: boolean;
  setShowPreview: (v: boolean) => void;
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  showCopilot: boolean;
  setShowCopilot: (v: boolean) => void;
  showExpertAgents: boolean;
  setShowExpertAgents: (v: boolean) => void;
  suggestions: string[];
  setSuggestions: (v: string[]) => void;
  lastEmbeddingSavedAt: number | null;
  setLastEmbeddingSavedAt: (v: number | null) => void;
  lastVersionSavedAt: number | null;
  setLastVersionSavedAt: (v: number | null) => void;
  isZenMode: boolean;
  setIsZenMode: (v: boolean) => void;
  isPrivate: boolean;
  setIsPrivate: (v: boolean) => void;
  error: string | null;
  setError: (v: string | null) => void;
  editorRef: { current: HTMLElement | null };
  isRemoteUpdateRef: { current: boolean };
  isWarmedUpRef: { current: boolean };
  handleSuggestionClickRef: { current: ((suggestion: string) => void) | null };
}

export function useBlockEditorState(): BlockEditorState {
  const [initialContent, setInitialContent] = useState<
    "loading" | "empty" | PartialBlock[]
  >("empty");
  const [docTitle, setDocTitle] = useState("");
  const [editorText, setEditorText] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "unsaved" | "saving">(
    "saved",
  );
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [showChat, setShowChat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [showExpertAgents, setShowExpertAgents] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [lastEmbeddingSavedAt, setLastEmbeddingSavedAt] = useState<
    number | null
  >(null);
  const [lastVersionSavedAt, setLastVersionSavedAt] = useState<number | null>(
    null,
  );
  const [isZenMode, setIsZenMode] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorRef = useRef<HTMLElement | null>(null);
  const isRemoteUpdateRef = useRef(false);
  const isWarmedUpRef = useRef(false);
  const handleSuggestionClickRef = useRef<
    ((suggestion: string) => void) | null
  >(null);

  return {
    initialContent,
    setInitialContent,
    docTitle,
    setDocTitle,
    editorText,
    setEditorText,
    saveStatus,
    setSaveStatus,
    theme,
    setTheme,
    showChat,
    setShowChat,
    showHistory,
    setShowHistory,
    showPreview,
    setShowPreview,
    showSuggestions,
    setShowSuggestions,
    showCopilot,
    setShowCopilot,
    showExpertAgents,
    setShowExpertAgents,
    suggestions,
    setSuggestions,
    lastEmbeddingSavedAt,
    setLastEmbeddingSavedAt,
    lastVersionSavedAt,
    setLastVersionSavedAt,
    isZenMode,
    setIsZenMode,
    isPrivate,
    setIsPrivate,
    error,
    setError,
    editorRef,
    isRemoteUpdateRef,
    isWarmedUpRef,
    handleSuggestionClickRef,
  };
}
