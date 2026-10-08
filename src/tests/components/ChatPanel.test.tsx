import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

Element.prototype.scrollIntoView = vi.fn();

const mockAgentService = vi.hoisted(() => ({
  globalChat: vi.fn(),
  ensureMemoryInitialized: vi.fn().mockResolvedValue(undefined),
  getActiveSessionId: vi.fn().mockResolvedValue(null),
  getOrCreateSession: vi.fn().mockResolvedValue("session-1"),
}));
vi.mock("../../services/ai/AgentService", () => ({
  agentService: mockAgentService,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { ChatPanel } from "../../components/ChatPanel";

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders input and send button", () => {
    render(<ChatPanel />);
    expect(screen.getByLabelText("Type a message")).toBeTruthy();
    expect(screen.getByText("Send")).toBeTruthy();
  });

  it("shows the initial welcome message", () => {
    render(<ChatPanel />);
    expect(
      screen.getByText(
        "Start a conversation. I'll remember context across sessions.",
      ),
    ).toBeTruthy();
  });

  it("send button disabled if input is empty", () => {
    render(<ChatPanel />);
    const btn = screen.getByText("Send").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("send button enabled if there is text", async () => {
    render(<ChatPanel />);
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "Hola");
    const btn = screen.getByText("Send").closest("button");
    expect(btn?.disabled).toBe(false);
  });

  it("sends message when clicking Send", async () => {
    mockAgentService.globalChat.mockResolvedValue({
      text: "Respuesta del asistente",
      sources: [],
    });
    render(<ChatPanel />);
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByText("Send"));
    await waitFor(() => {
      expect(mockAgentService.globalChat).toHaveBeenCalled();
    });
  });

  it("sends message with Enter", async () => {
    mockAgentService.globalChat.mockResolvedValue({ text: "Respuesta", sources: [] });
    render(<ChatPanel />);
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "Mensaje");
    input.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(mockAgentService.globalChat).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        undefined,
        expect.any(String),
        expect.any(Function),
        undefined,
        undefined,
        expect.any(AbortSignal),
      );
    });
  });

  it("streaming: shows live tokens via onChunk before the final resolution", async () => {
    let resolveChat: (v: unknown) => void;
    mockAgentService.globalChat.mockImplementation(
      (_q: string, _l?: string, _p?: boolean, _s?: string, onChunk?: (c: string) => void) => {
        onChunk?.("Hola ");
        onChunk?.("mundo");
        return new Promise((resolve) => {
          resolveChat = resolve;
        });
      },
    );
    render(<ChatPanel />);
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByText("Send"));
    // The partial text appears in the live bubble BEFORE the
    // promise resolves — this proves real streaming, not just the final render.
    await waitFor(() => {
      expect(screen.getByText("Hola mundo")).toBeTruthy();
    });
    resolveChat!({ text: "Hola mundo", sources: [] });
    // The final response is persisted as a message (no duplicated bubble)
    await waitFor(() => {
      expect(screen.getAllByText("Hola mundo").length).toBe(1);
    });
  });

  it("passes documentId and textContent as document context to globalChat", async () => {
    mockAgentService.globalChat.mockResolvedValue({ text: "Respuesta", sources: [] });
    render(
      <ChatPanel
        documentId="doc-123"
        textContent="The complete content of the current document."
      />,
    );
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "What is the document about?");
    await userEvent.click(screen.getByText("Send"));
    await waitFor(() => {
      expect(mockAgentService.globalChat).toHaveBeenCalledWith(
        "What is the document about?",
        undefined,
        undefined,
        expect.any(String),
        expect.any(Function),
        {
          id: "doc-123",
          isPublic: true,
          text: "The complete content of the current document.",
        },
        undefined,
        expect.any(AbortSignal),
      );
    });
  });

  it("does not pass document context if textContent is empty", async () => {
    mockAgentService.globalChat.mockResolvedValue({ text: "Respuesta", sources: [] });
    render(<ChatPanel documentId="doc-123" textContent="   " />);
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByText("Send"));
    await waitFor(() => {
      expect(mockAgentService.globalChat).toHaveBeenCalledWith(
        "Hola",
        undefined,
        undefined,
        expect.any(String),
        expect.any(Function),
        undefined,
        undefined,
        expect.any(AbortSignal),
      );
    });
  });

  it("shows the user message and assistant response", async () => {
    mockAgentService.globalChat.mockResolvedValue({
      text: "Respuesta del asistente",
      sources: [],
    });
    render(<ChatPanel />);
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByText("Send"));
    await waitFor(() => {
      expect(screen.getByText("Hola")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("Respuesta del asistente")).toBeTruthy();
    });
  });

  it("ignores streaming when the contextual document changes", async () => {
    let resolveChat!: (value: { text: string; sources: never[] }) => void;
    let onChunk!: (chunk: string) => void;
    mockAgentService.globalChat.mockImplementation(
      (
        _query: string,
        _lang?: string,
        _private?: boolean,
        _session?: string,
        chunkHandler?: (chunk: string) => void,
      ) => {
        onChunk = chunkHandler!;
        return new Promise<{ text: string; sources: never[] }>((resolve) => {
          resolveChat = resolve;
        });
      },
    );
    const { rerender } = render(
      <ChatPanel documentId="doc-1" textContent="First document" />,
    );
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "Question");
    await userEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(mockAgentService.globalChat).toHaveBeenCalledTimes(1));

    const signal = mockAgentService.globalChat.mock.calls[0]![7] as AbortSignal;
    rerender(<ChatPanel documentId="doc-2" textContent="Second document" />);
    expect(signal.aborted).toBe(true);

    await act(async () => {
      onChunk("Stale response");
      resolveChat({ text: "Stale final response", sources: [] });
      await Promise.resolve();
    });
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
  });

  it("shows error if the chat fails", async () => {
    mockAgentService.globalChat.mockRejectedValue(new Error("Error"));
    render(<ChatPanel />);
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByText("Send"));
    await waitFor(() => {
      expect(
        screen.getByText("Sorry, I encountered an error. Please try again."),
      ).toBeTruthy();
    });
  });

  it("creates a session if none is active", async () => {
    mockAgentService.getActiveSessionId.mockResolvedValue(null);
    mockAgentService.globalChat.mockResolvedValue({ text: "Response", sources: [] });
    render(<ChatPanel />);
    const input = screen.getByLabelText("Type a message") as HTMLInputElement;
    await userEvent.type(input, "New session");
    await userEvent.click(screen.getByText("Send"));
    await waitFor(() => {
      expect(mockAgentService.ensureMemoryInitialized).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockAgentService.getOrCreateSession).toHaveBeenCalledWith(
        "New session",
      );
    });
  });
});
