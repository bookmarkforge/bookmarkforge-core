import React, { ReactNode, ErrorInfo } from "react";
import { logger } from "../utils/logger";
import { errorReporter } from "../telemetry/errorReporter";
import i18n from "../i18n";

// Inline SVG copies of the lucide icons this component rendered. The error
// boundary MUST stay eagerly imported (it is the crash net for the entire
// app shell, including lazy chunk loading), so importing lucide-react here
// would statically drag the ui-runtime vendor chunk (lucide + motion,
// ~280 kB gzip) into the entry critical path on every load even though
// these icons only paint when an error is caught. Hand-rolled SVG avoids
// that while keeping the exact lucide geometry (stroke 2, round caps).
function IconAlertTriangle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function IconRefreshCw(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function IconCopy(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundaryWrapper extends React.Component<
  { children: ReactNode },
  State
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("[ErrorBoundary] Caught error", {
      error,
      component: "ErrorBoundaryWrapper",
    });
    errorReporter.reportError(error, {
      component: "ErrorBoundaryWrapper",
      errorInfo: errorInfo.componentStack ?? "unknown",
    });
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--bg-primary)] text-white p-4 md:p-8 flex flex-col items-center justify-center">
          <div
            className="max-w-2xl w-full bg-[var(--bg-primary)] border border-[var(--danger-soft-border)]/20 rounded-3xl p-6 md:p-10 shadow-[0_0_50px_-12px_var(--danger-soft-border)]"
            role="alert"
            aria-live="assertive"
          >
            <div className="flex items-center gap-5 mb-8">
              <div className="p-4 bg-[var(--color-danger)]/10 rounded-2xl ring-1 ring-[var(--color-danger)]/20">
                <IconAlertTriangle
                  className="size-10 ds-text-danger"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white uppercase">
                  {i18n.t("app_somethingWentWrong", "Something went wrong")}
                </h1>
                <p className="text-[var(--text-muted)] text-sm mt-1 font-medium">
                  {i18n.t(
                    "app_errorDesc",
                    "BookmarkForge encountered an unexpected error.",
                  )}
                </p>
              </div>
            </div>

            <div className="p-6 rounded-2xl border border-[var(--divider)] mb-8 overflow-auto max-h-48 group relative ds-bg-secondary">
              <p className="ds-text-danger font-mono text-xs leading-relaxed break-all selection:bg-[var(--color-danger)]/30">
                {this.state.error?.message ||
                  i18n.t("unknownError", "Unknown error")}
              </p>
              {import.meta.env.DEV && (
                <details className="mt-2">
                  <summary className="text-[var(--text-muted)] text-xs cursor-pointer hover:text-[var(--text-secondary)]">
                    {i18n.t("app_stackTrace", "Stack trace")}
                  </summary>
                  <pre className="text-[var(--text-muted)] font-mono text-xs mt-2 whitespace-pre-wrap">
                    {this.state.error?.stack || ""}
                  </pre>
                </details>
              )}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    this.state.error?.stack || this.state.error?.message || "",
                  );
                }}
                className="absolute top-4 right-4 p-2 bg-[var(--bg-card)] hover:bg-[var(--state-hover-bg)] rounded-lg opacity-0 group-hover:opacity-100 transition-all border border-[var(--divider)]"
                title={i18n.t("app_copy", "Copy")}
                aria-label={i18n.t("app_copy", "Copy")}
              >
                <IconCopy className="size-4 text-[var(--text-muted)]" />
              </button>
            </div>

            <div className="flex flex-wrap gap-3 justify-end">
              <button
                onClick={() => window.location.reload()}
                className="truncate flex items-center gap-3 px-6 py-3 bg-white text-[var(--text-primary)] hover:bg-[var(--state-hover-bg)] rounded-2xl transition-all font-bold shadow-lg active:scale-95"
              >
                <IconRefreshCw className="size-5" />
                {i18n.t("app_reload", "Reload Application")}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
