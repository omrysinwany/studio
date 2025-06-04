"use client";

import React, {
  createContext,
  useContext,
  ReactNode,
  useCallback,
} from "react";

interface AnalyticsContextType {
  trackEvent: (
    eventName: string,
    eventProperties?: Record<string, any>
  ) => void;
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(
  undefined
);

export const AnalyticsProvider = ({ children }: { children: ReactNode }) => {
  const trackEvent = useCallback(
    (eventName: string, eventProperties?: Record<string, any>) => {
      // In a real app, this would integrate with an analytics service (e.g., Google Analytics, Mixpanel, etc.)
      console.log(
        `[Analytics] Event: ${eventName}`,
        eventProperties || "(no properties)"
      );
    },
    []
  );

  return (
    <AnalyticsContext.Provider value={{ trackEvent }}>
      {children}
    </AnalyticsContext.Provider>
  );
};

export const useAnalytics = (): AnalyticsContextType => {
  const context = useContext(AnalyticsContext);
  if (context === undefined) {
    throw new Error("useAnalytics must be used within an AnalyticsProvider");
  }
  return context;
};
