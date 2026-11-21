import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { onEmbeddingProgress } from "../services/ai/RAGEngine";

export function EmbeddingProgressIndicator() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsub = onEmbeddingProgress((status, msg) => {
      if (status === "loading") {
        setMessage(msg || "Downloading model...");
        setVisible(true);
      } else {
        setVisible(false);
        setMessage("");
      }
    });
    return unsub;
  }, []);

  if (!visible) {return null;}

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase tracking-widest"
    >
      <Loader2 className="size-3 animate-spin" />
      <span className="truncate max-w-[200px]">{message}</span>
    </motion.div>
  );
}
