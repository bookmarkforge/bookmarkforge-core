import { Sparkles } from "lucide-react";

interface StreamPreviewProps {
  /** Raw tokens accumulated so far from the streaming LLM call. */
  text: string;
  /** Optional short label shown above the live text. */
  label?: string;
}

/**
 * Live preview of streamed tokens while a local-AI structured response
 * (JSON-parsing knowledge cards) is being generated. Renders nothing until
 * the first chunk arrives, so tests/quiet providers see no extra DOM.
 */
export const StreamPreview: React.FC<StreamPreviewProps> = ({ text, label }) => {
  if (!text) {return null;}
  return (
    <div className="mt-3 p-3 rounded-xl ds-bg-accent-soft ds-border-accent flex items-start gap-2">
      <Sparkles
        className="size-3.5 ds-text-accent animate-pulse shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        {label && (
          <p className="text-[10px] font-bold uppercase tracking-widest ds-text-accent mb-1">
            {label}
          </p>
        )}
        <pre
          className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono ds-text-secondary max-h-40 overflow-y-auto"
          aria-hidden="true"
        >
          {text}
          <span
            className="inline-block w-1.5 h-3 bg-current align-middle animate-pulse ms-0.5"
            aria-hidden="true"
          />
        </pre>
      </div>
    </div>
  );
};
