
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
    "currency_symbol": "₪", 
    "reports_kpi_total_value": "Total Inventory Value",
    "reports_kpi_vs_last_period": "vs last period",
    "reports_kpi_total_items": "Total Items",
    "reports_kpi_unique_skus": "Unique SKUs in stock",
    "kpi_gross_profit": "Potential Gross Profit",
    "reports_kpi_potential_from_stock": "Est. from current stock",
    "reports_kpi_gross_profit_margin": "Gross Profit Margin",
    "reports_kpi_estimate": "Industry estimate",
    "reports_kpi_inventory_turnover": "Inventory Turnover",
    "reports_kpi_times_per_period": "Times this period",
    "reports_kpi_avg_order_value": "Avg. Invoice Value",
    "reports_kpi_from_invoices": "From completed invoices",
    "reports_chart_value_over_time_title": "Inventory Value Over Time",
    "reports_chart_value_over_time_desc": "Tracks the estimated total value of your inventory over the selected period.",
    "reports_chart_no_value_trend_data": "No inventory value trend data for selected period.",
    "reports_chart_docs_processed_title": "Documents Processed",
    "reports_chart_docs_processed_desc": "Number of invoices and delivery notes processed over time.",
    "reports_chart_no_processing_volume_data": "No document processing data for selected period.",
    "reports_expenses_by_category_title": "Expenses by Category",
    "reports_chart_no_expenses_by_category_data": "No expense data by category for selected period.",
    "reports_col_category": "Category",
    "reports_col_total_amount": "Total Amount",
    "reports_table_top_selling_title": "Top Selling Products (Mock Data)",
    "reports_table_top_selling_desc": "Based on simulated sales data for illustration.",
    "reports_table_no_top_selling_data": "No sales data available for top products.",
    "reports_table_col_product": "Product",
    "reports_table_col_qty_sold": "Qty Sold",
    "reports_table_col_total_value": "Total Value",
    "reports_table_stock_alert_title": "Stock Alerts",
    "reports_table_stock_alert_desc": "Products requiring attention based on stock levels.",
    "reports_table_no_stock_alerts": "No stock alerts to display.",
    "reports_table_col_catalog": "Catalog #",
    "reports_table_col_current_qty": "Current Qty",
    "reports_table_col_min_stock": "Min Stock",
    "reports_table_col_max_stock": "Max Stock",
    "reports_table_col_status": "Status",
    "reports_default_min_stock_suffix": "default",
    "reports_stock_status_low_stock": "Low Stock",
    "reports_stock_status_out_of_stock": "Out of Stock",
    "reports_stock_status_over_stock": "Over Stock",
    "reports_chart_label_value": "Value",
    "reports_chart_label_count": "Count",
    "reports_chart_label_sales": "Sales",
    "reports_chart_label_qty_sold": "Quantity Sold",
    "reports_chart_label_documents": "Documents",
    "reports_chart_label_expenses": "Expenses",
    "reports_date_range_placeholder": "Select date range",
    "reports_date_range_clear": "Clear",
    "reports_date_preset_7d": "Last 7 Days",
    "reports_date_preset_30d": "Last 30 Days",
    "reports_date_preset_currentMonth": "This Month",
    "reports_date_preset_currentQuarter": "This Quarter",
    "reports_toast_no_data_to_export_title": "No Data to Export",
    "reports_toast_no_data_to_export_desc": "There is no data in the table to export.",
    "reports_export_csv_button": "Export CSV",
    "reports_toast_export_success_title": "Export Successful",
    "reports_toast_export_success_desc": "File {{filename}} has been downloaded.",
    "reports_pnl_summary_title": "Profit & Loss Summary (Est.)",
    "reports_pnl_summary_desc": "Estimated financial health based on recorded income and expenses for the period.",
    "reports_pnl_income": "Income (from Paid Invoices)",
    "reports_pnl_operating_expenses": "Operating Expenses",
    "reports_pnl_open_liabilities": "Open Invoice Liabilities",
    "reports_pnl_net_profit_loss": "Net Profit/Loss (Est.)",
    "reports_pnl_no_data": "No P&L data for the selected period.",
    "reports_supplier_liabilities_title": "Supplier Liabilities",
    "reports_no_supplier_liabilities_data": "No open liabilities to suppliers for the selected period.",
    "reports_col_supplier": "Supplier",
    "reports_col_total_due": "Total Due",
    "reports_col_invoice_count": "Invoice Count",
  };

  return translations[key] || key; 
};

export const useTranslation = () => {
  return { t, locale: 'en' as Locale };
};
