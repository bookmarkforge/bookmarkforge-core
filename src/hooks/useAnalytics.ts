import { useEffect, useCallback, useRef } from 'react';
import { analyticsService, type AnalyticsEventType } from '../services/AnalyticsService';

/**
 * React hook for tracking analytics events.
 * Automatically tracks page views and session activity.
 *
 * @example
 * const { trackFeatureUse, trackAction } = useAnalytics();
 * trackFeatureUse('bookmark', 'create');
 * trackAction('export_started', { format: 'json' });
 */
export function useAnalytics() {
  const lastActivityRef = useRef<number>(Date.now());

  // Keep session alive on any user interaction
  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
    for (const event of events) {
      document.addEventListener(event, handleActivity, { passive: true, capture: true });
    }

    return () => {
      for (const event of events) {
        document.removeEventListener(event, handleActivity, { capture: true });
      }
    };
  }, []);

  const trackFeatureUse = useCallback(
    (feature: string, action: string, meta?: Record<string, unknown>) => {
      analyticsService.track('bookmark_created', { feature, action, ...meta } as Record<string, string | number | boolean>);
    },
    []
  );

  const trackAction = useCallback(
    (event: string, data?: Record<string, unknown>) => {
      analyticsService.track(event as AnalyticsEventType, data as Record<string, string | number | boolean> | undefined);
    },
    []
  );

  const trackError = useCallback(
    (error: string, component?: string, meta?: Record<string, unknown>) => {
      analyticsService.track('session_end', { error, component, ...meta } as Record<string, string | number | boolean>);
    },
    []
  );

  return { trackFeatureUse, trackAction, trackError };
}
