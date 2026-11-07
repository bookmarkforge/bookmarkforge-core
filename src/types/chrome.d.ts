interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare const SpeechRecognition: new () => SpeechRecognition;
declare let webkitSpeechRecognition: new () => SpeechRecognition;

interface Window {
  bookmarkForgeInjected?: boolean;
  DOMPurify?: {
    sanitize(dirty: string, options?: Record<string, unknown>): string;
  };
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}

declare namespace chrome {
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
      currentWindow?: boolean;
    }
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
    function query(
      queryInfo: { active?: boolean; currentWindow?: boolean },
      callback: (tabs: Tab[]) => void,
    ): void;
    function sendMessage(
      tabId: number,
      message: unknown,
      callback?: (response: unknown) => void,
    ): void;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
    function captureVisibleTab(
      windowId: number | null,
      options: { format: string; quality: number },
    ): Promise<string>;
    function captureVisibleTab(
      windowId: number | null,
      options: { format: string; quality: number },
      callback: (dataUrl: string) => void,
    ): void;
    function create(createProperties: { url?: string; active?: boolean }): void;
  }
  namespace runtime {
    interface MessageSender {
      tab?: tabs.Tab;
      id?: string;
      url?: string;
    }
    interface ExtensionMessageEvent {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | undefined,
      ): void;
    }
    const onMessage: ExtensionMessageEvent;
    interface ExtensionInstalledEvent {
      addListener(callback: () => void): void;
    }
    const onInstalled: ExtensionInstalledEvent;
    interface ExtensionCommandEvent {
      addListener(callback: (command: string) => void): void;
    }
    const onCommand: ExtensionCommandEvent;
    function getManifest(): { content_scripts?: { js?: string[] }[] };
    function getMessage(key: string): string | undefined;
    function sendMessage(
      message: unknown,
      callback?: (response: unknown) => void,
    ): void;
    function sendMessage(message: unknown): Promise<unknown>;
  }
  namespace i18n {
    function getMessage(key: string): string | undefined;
  }
  namespace scripting {
    function executeScript(injection: {
      target: { tabId: number };
      files: string[];
    }): Promise<void>;
    function executeScript(
      injection: { target: { tabId: number }; files: string[] },
      callback?: () => void,
    ): void;
  }
  namespace contextMenus {
    interface OnClickData {
      menuItemId: number | string;
      pageUrl?: string;
      linkUrl?: string;
      selectionText?: string;
    }
    interface ContextMenuClickedEvent {
      addListener(callback: (info: OnClickData, tab: tabs.Tab) => void): void;
    }
    const onClicked: ContextMenuClickedEvent;
    function create(createProperties: {
      id?: string;
      title?: string;
      contexts?: string[];
    }): void;
  }
  namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
      periodInMinutes?: number;
    }
    interface AlarmEvent {
      addListener(callback: (alarm: Alarm) => void): void;
    }
    const onAlarm: AlarmEvent;
    function create(name: string, alarmInfo: { periodInMinutes: number }): void;
  }
  namespace webRequest {
    interface WebRequestCompletedEvent {
      addListener(callback: () => void, filter: { urls: string[] }): void;
    }
    const onCompleted: WebRequestCompletedEvent;
  }
  namespace omnibox {
    interface OmniboxInputEnteredEvent {
      addListener(callback: (text: string) => void): void;
    }
    const onInputEntered: OmniboxInputEnteredEvent;
  }
  namespace commands {
    interface CommandEvent {
      addListener(callback: (command: string) => void): void;
    }
    const onCommand: CommandEvent;
  }
  namespace storage {
    interface StorageArea {
      get(
        keys: string | string[] | Record<string, unknown>,
        callback: (items: Record<string, unknown>) => void,
      ): void;
      set(items: Record<string, unknown>): Promise<void>;
      set(items: Record<string, unknown>, callback?: () => void): void;
      remove(keys: string | string[]): Promise<void>;
      remove(keys: string | string[], callback?: () => void): void;
    }
    const local: StorageArea;
    const sync: StorageArea;
  }
}
