import React, { useState, useMemo, useEffect, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  X,
  Loader2,
  ChevronRight,
  BrainCircuit,
  SearchIcon,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import { ProRequiredState } from "../ProRequiredState";
import {
  agentsConfig,
  categories,
  resolveAgentAction,
  ProUnavailableError,
  AgentConfig,
} from "./agentsConfig";
import { logger } from "../../utils/logger";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { useRef } from "react";

interface ExpertAgentsPanelProps {
  content: string;
  isPrivate?: boolean;
}

const ExpertAgentsPanel: React.FC<ExpertAgentsPanelProps> = ({
  content,
  // Missing privacy metadata fails closed to the local provider.
  isPrivate = true,
}) => {
  const { t, i18n } = useTranslation();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  // Set when the Pro registry is rejected (Free plan / Open Core build): the
  // results area then renders the shared "requires Pro" state instead of the
  // analysis card.
  const [proRequired, setProRequired] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<
    "all" | AgentConfig["category"]
  >("all");
  const [, startTransition] = useTransition();
  // agentIdRef captures the agent at call time: onStart/onError resolve
  // asynchronously (via ref) and must report the clicked agent, not the one
  // selected in a later render.
  const agentIdRef = useRef<string | null>(null);
  const {
    runWithSignal,
    isRunning: isLoading,
    cancel,
  } = useGuardedAction<string>({
    onStart: () => {
      setSelectedAgent(agentIdRef.current);
      setAnalysis(null);
      setProRequired(false);
    },
    onSuccess: (result) => setAnalysis(result),
    onError: (error) => {
      const agentId = agentIdRef.current ?? "unknown";
      // A Pro-gated registry (Free plan, or an Open Core export) surfaces as
      // the reusable "requires Pro" state instead of a generic failure: the
      // panel renders the upgrade block with the real price.
      if (error instanceof ProUnavailableError) {
        setProRequired(true);
        return;
      }
      logger.error(
        `[ExpertAgentsPanel] Analysis failed for ${agentId}:`,
        error,
      );
      setAnalysis(t("app_somethingWentWrong"));
    },
  });

  useEffect(() => {
    // cancel resets the loading flag too (the fixed cancel), so the manual
    // setIsLoading(false) of the original is covered.
    cancel();
    setSelectedAgent(null);
    setAnalysis(null);
    setProRequired(false);
  }, [content, isPrivate, cancel]);

  const filteredAgents = useMemo(() => {
    return agentsConfig.filter((agent) => {
      const matchesSearch =
        t(agent.nameKey).toLowerCase().includes(searchQuery.toLowerCase()) ||
        t(agent.descKey).toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        activeCategory === "all" || agent.category === activeCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, activeCategory, t]);

  const handleRunAnalysis = (agent: AgentConfig) => {
    if (!content) {
      return;
    }
    agentIdRef.current = agent.id;
    void runWithSignal(async (signal) => {
      // Resolve the Pro action behind the gate right before running: the
      // registry chunk is only fetched when the user actually runs an
      // analysis with an active license.
      const action = await resolveAgentAction(agent);
      return action(content, i18n.language, isPrivate, signal);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl ds-bg-accent-soft ds-text-accent">
            <BrainCircuit className="size-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-[var(--text-primary)] dark:text-white">
              {t("app_expertAgents")}
            </h3>
            <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-tighter">
              {t("poweredByAgencyAgents", "Powered by Agency Agents")}
            </p>
          </div>
        </div>

        <div className="relative group max-w-xs w-full">
          <SearchIcon className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--text-muted)] group-focus-within:transition-colors ds-text-muted" />
          <input
            type="text"
            aria-label={t("app_searchAgents")}
            placeholder={t("app_searchAgents")}
            value={searchQuery}
            onChange={(e) => startTransition(() => setSearchQuery(e.target.value))}
            className="w-full ps-10 pe-4 py-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/50 rounded-xl text-xs outline-none border ds-border-transparent ds-transition-colors"
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = "var(--accent-primary)")
            }
            onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id === "all" ? "all" : cat.id)}
            className={`truncate flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-200 border
              ${
                activeCategory === cat.id
                  ? "bg-cyan-500 border-cyan-500 text-white shadow-lg shadow-cyan-500/20"
                  : "ds-ghost-bg bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)]/30 border-transparent text-[var(--text-muted)]"
              }
            `}
          >
            <cat.icon className="size-3" />
            {t(cat.labelKey)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <AnimatePresence mode="popLayout">
          {filteredAgents.map((agent) => (
            <motion.button
              key={agent.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleRunAnalysis(agent)}
              disabled={isLoading}
              className={`truncate flex flex-col items-start p-4 rounded-2xl border text-start transition-[background-color,border-color,box-shadow] relative overflow-hidden group h-full
                ${
                  selectedAgent === agent.id
                    ? "bg-white dark:bg-[var(--bg-primary)] border-cyan-500 shadow-lg shadow-cyan-500/10"
                    : "ds-ghost-bg bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 border-[var(--divider)] dark:border-[var(--divider)] hover:border-cyan-300 dark:hover:border-cyan-700"
                }
                ${isLoading && selectedAgent !== agent.id ? "opacity-50 grayscale" : ""}
              `}
            >
              <div className={`p-2 rounded-xl mb-3 ${agent.color}`}>
                <agent.icon className="size-5" />
              </div>
              <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)] dark:text-white mb-1">
                {t(agent.nameKey)}
              </span>
              <span className="text-[10px] font-medium text-[var(--text-muted)] dark:text-[var(--text-muted)] leading-tight">
                {t(agent.descKey)}
              </span>

              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="rtl-flip size-4 ds-text-accent" />
              </div>

              {isLoading && selectedAgent === agent.id && (
                <div className="absolute inset-0 flex items-center justify-center ds-bg-overlay">
                  <Loader2 className="size-6 animate-spin ds-text-accent" />
                </div>
              )}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {filteredAgents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="p-4 rounded-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mb-4">
            <Search className="size-8 text-[var(--text-muted)]" />
          </div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] dark:text-white mb-1">
            {t("app_noAgentsFound")}
          </h4>
          <p className="text-xs text-[var(--text-muted)]">
            {t("app_tryDifferentSearch")}
          </p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {proRequired && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mt-6"
          >
            <ProRequiredState
              feature="Expert agents"
              reason="license"
              variant="card"
              onSeePro={() => {
                setProRequired(false);
                window.dispatchEvent(new CustomEvent("forge:open-settings"));
              }}
            />
          </motion.div>
        )}

        {!proRequired && analysis && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mt-6 p-6 rounded-3xl bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] shadow-xl relative"
          >
            <button
              onClick={() => {
                setAnalysis(null);
                setSelectedAgent(null);
              }}
              className="absolute top-4 right-4 p-2 hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] rounded-full transition-colors"
            >
              <X className="size-4 text-[var(--text-muted)]" />
            </button>

            <div className="flex items-center gap-2 mb-6">
              <div
                className={`p-1.5 rounded-lg ${agentsConfig.find((a) => a.id === selectedAgent)?.color}`}
              >
                <Sparkles className="size-4" />
              </div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                {t("app_expertAnalysis")}
              </h4>
            </div>

            <div className="prose prose-sm dark:prose-invert max-w-none">
              <div className="markdown-body">
                <Markdown>{analysis}</Markdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ExpertAgentsPanel;
