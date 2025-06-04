"use client";

import React, { createContext, useContext, ReactNode } from "react";

interface CurrencyContextType {
  currency: string;
  // In the future, we might add a setter: setCurrency: (currency: string) => void;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(
  undefined
);

export const CurrencyProvider = ({ children }: { children: ReactNode }) => {
  // For now, a fixed currency. This could later come from user settings, localStorage, etc.
  const currency = "USD"; // Default currency

  return (
    <CurrencyContext.Provider value={{ currency }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = (): string => {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context.currency;
};
