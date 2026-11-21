import VoiceCommandCenter from "./VoiceCommandCenter";

interface VoiceCommandCenterWrapperProps {
  onSearch: (query: string) => void;
  onNavigate: (page: string) => void;
  onAction: (action: string, params: Record<string, unknown>) => Promise<void>;
}

export function VoiceCommandCenterWrapper({
  onSearch,
  onNavigate,
  onAction,
}: VoiceCommandCenterWrapperProps) {
  const handleAction = (action: string, params?: Record<string, unknown>) => {
    void onAction(action, params ?? {});
  };
  return (
    <VoiceCommandCenter
      onSearch={onSearch}
      onNavigate={onNavigate}
      onAction={handleAction}
      showFloatingButton={false}
    />
  );
}
