// src/hooks/useTranslation.ts
'use client';

export type Locale = 'en' | 'he';

// Fallback t function that returns the key itself or a default string
const t = (key: string, params?: Record<string, string | number>): string => {
  if (params) {
    let translation = key;
    Object.keys(params).forEach((paramKey) => {
      translation = translation.replace(`{{${paramKey}}}`, String(params[paramKey]));
    });
    return translation;
  }
  // Add new keys here for translation
  const translations: Record<string, string> = {
    "accounts_financial_summary_title": "Key Financial Summaries",
    "accounts_financial_summary_desc_period": "Overview of income, liabilities, and net balance for the selected period.",
    "accounts_total_income_label": "Total Estimated Income",
    "accounts_total_liabilities_label": "Total Liabilities",
    "accounts_net_balance_label": "Net Estimated Balance",
    "accounts_top_expense_categories_title": "Top Expense Categories",
    "accounts_top_expense_categories_desc_period": "Highest spending categories from other business expenses in the selected period.",
    "accounts_no_top_categories_period": "No expense category data for the selected period.",
    "accounts_no_spending_data_period": "No spending data recorded for the selected period.",
    "accounts_supplier_spending_title": "Supplier Spending",
    "accounts_supplier_spending_desc_period": "Spending breakdown by supplier for the selected period.",
    "currency_symbol": "₪" // Default currency symbol, can be overridden by specific locale files if needed
  };

  return translations[key] || key; // Return the key itself if no translation is found
};

export const useTranslation = () => {
  return { t, locale: 'en' as Locale };
};
