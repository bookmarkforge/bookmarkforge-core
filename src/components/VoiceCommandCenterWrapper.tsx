import VoiceCommandCenter from "./VoiceCommandCenter";
import { analyticsService } from "../services/AnalyticsService";

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
    analyticsService.track("voice_command_used", { action });
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
