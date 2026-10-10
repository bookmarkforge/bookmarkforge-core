import { useState, useCallback, useRef } from "react";

interface DragDropState {
  isDragging: boolean;
  isOver: boolean;
  files: File[];
}

export function useDragAndDrop(
  onDrop: (files: File[]) => void,
  acceptedTypes?: string[],
): {
  state: DragDropState;
  handlers: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
} {
  const [state, setState] = useState<DragDropState>({
    isDragging: false,
    isOver: false,
    files: [],
  });
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setState((prev) => ({ ...prev, isOver: true }));
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0)
      {setState((prev) => ({ ...prev, isOver: false }));}
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      const files = Array.from(e.dataTransfer.files);
      const filteredFiles = acceptedTypes
        ? files.filter((f) =>
            acceptedTypes.some((type) => {
              // Exact MIME match
              if (f.type === type) {return true;}
              // Wildcard match: "image/*" matches any image MIME
              if (type.endsWith("/*")) {
                const category = type.slice(0, -1);
                return f.type.startsWith(category);
              }
              // Extension fallback
              const ext = type.startsWith(".") ? type : "." + type;
              return f.name.toLowerCase().endsWith(ext.toLowerCase());
            }),
          )
        : files;
      setState({ isDragging: false, isOver: false, files: filteredFiles });
      onDrop(filteredFiles);
    },
    [onDrop, acceptedTypes],
  );

  return {
    state,
    handlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
