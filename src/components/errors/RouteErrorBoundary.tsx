/**
 * RouteErrorBoundary - Lightweight error boundary for individual routes
 *
 * Unlike the global ErrorBoundary, this is designed to be used per-route
 * so that a single feature failure doesn't crash the entire app.
 *
 * Based on bulletproof-react error handling patterns.
 */

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import i18n from "../../i18n";
import { logger } from "../../utils/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showReset?: boolean;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("[RouteErrorBoundary]", {
      error: error.message,
      componentStack: errorInfo.componentStack,
    });

    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleGoBack = () => {
    window.history.back();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // `fallback={null}` means "render nothing" (silent swallow for
    // fire-and-forget/background components). Only fall back to the default
    // error card when no fallback prop was provided at all.
    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    return (
      <div className="flex min-h-[200px] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-[var(--danger-soft-border)]/20 bg-[var(--bg-primary)]/80 p-6 shadow-lg">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-danger)]/10 p-2">
              <AlertTriangle className="size-5 ds-text-danger" />
            </div>
            <h3 className="text-lg font-semibold ds-text-danger">
              {i18n.t("componentError", "Component Error")}
            </h3>
          </div>

          <p className="mb-4 text-sm text-[var(--text-muted)]">
            {i18n.t(
              "sectionError",
              "This section encountered an error and could not be displayed.",
            )}
          </p>

          {this.state.error && (
            <div className="mb-4 max-h-32 overflow-auto rounded-lg p-3 font-mono text-xs ds-text-danger ds-bg-secondary">
              {this.state.error.message}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            {this.props.showReset && (
              <button
                onClick={this.handleReset}
                className="truncate flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <RefreshCw className="size-4" />
                {i18n.t("reset", "Reset")}
              </button>
            )}
            <button
              onClick={this.handleGoBack}
              className="truncate flex items-center gap-2 rounded-lg bg-[var(--bg-secondary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--state-hover-bg)] transition-colors"
            >
              <ArrowLeft className="rtl-flip size-4" />
              {i18n.t("goBack", "Go Back")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * withErrorBoundary HOC - Wrap any component with error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  boundaryProps?: Omit<Props, "children">,
): React.FC<P> {
  return function WithErrorBoundary(props: P) {
    return (
      <RouteErrorBoundary {...boundaryProps}>
        <Component {...(props as P)} />
      </RouteErrorBoundary>
    );
  };
}
