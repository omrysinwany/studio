
// src/app/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/context/AuthContext";
import { Package, FileText as FileTextIcon, BarChart2, ScanLine, Loader2, TrendingUp, TrendingDown, DollarSign, HandCoins, ShoppingCart, CreditCard, Banknote, Settings as SettingsIcon, Briefcase, AlertTriangle, BellRing, History, PlusCircle, PackagePlus, Info, ListChecks, Link as LinkIcon, UserCircle } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getProductsService, InvoiceHistoryItem, getInvoicesService, getStorageKey, SupplierSummary, getSupplierSummariesService, Product as BackendProduct, OtherExpense, OTHER_EXPENSES_STORAGE_KEY_BASE } from '@/services/backend';
import {
  calculateInventoryValue,
  calculateTotalItems,
  getLowStockItems,
  calculateTotalPotentialGrossProfit,
} from '@/lib/kpi-calculations';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import GuestHomePage from '@/components/GuestHomePage';
import { isValid, parseISO, startOfMonth, endOfMonth, isSameMonth, subDays, isBefore, format as formatDateFns } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';
import KpiCustomizationSheet from '@/components/KpiCustomizationSheet';
import styles from "./page.module.scss"; // Assuming styles are defined here
import { Skeleton } from "@/components/ui/skeleton";


const KPI_PREFERENCES_STORAGE_KEY = 'invoTrack_kpiPreferences_v2';


interface KpiData {
  totalItems: number;
  inventoryValue: number;
  lowStockItemsCount: number;
  criticalLowStockProducts: BackendProduct[];
  nextPaymentDueInvoice: InvoiceHistoryItem | null;
  recentActivity: { descriptionKey: string; params?: Record<string, string | number>; time: string; link?: string }[];
  latestDocName?: string;
  inventoryValueTrend?: { name: string; value: number }[];
  inventoryValuePrevious?: number;
  grossProfit: number;
  amountRemainingToPay: number;
  currentMonthTotalExpenses?: number;
  documentsProcessed30d?: number;
  averageInvoiceValue?: number;
  suppliersCount?: number;
}

export interface KpiConfig {
  id: string;
  titleKey: string;
  icon: React.ElementType;
  getValue: (data: KpiData | null, t: (key: string) => string) => string; // Value is now a string for formatted display
  descriptionKey: string;
  link: string;
  showTrend?: boolean;
  showProgress?: boolean;
  progressValue?: (data: KpiData | null) => number;
  iconColor?: string;
  defaultVisible?: boolean;
}

const formatLargeNumber = (
    num: number | undefined,
    t: (key: string, params?: Record<string, string | number>) => string,
    decimals = 1,
    isCurrency = false,
    isInteger = false
  ): string => {
    if (num === undefined || num === null || isNaN(num)) {
      return isCurrency ? `${t('currency_symbol')}-` : '-';
    }

    const prefix = isCurrency ? `${t('currency_symbol')}` : '';
    const absNum = Math.abs(num);

    if (absNum < 10000 || isInteger && absNum < 1000) { // Display full number for integers below 1000 or any number below 10000
        return prefix + num.toLocaleString(undefined, {
            minimumFractionDigits: isCurrency ? 2 : (isInteger ? 0 : decimals),
            maximumFractionDigits: isCurrency ? 2 : (isInteger ? 0 : decimals)
        });
    }


    const si = [
      { value: 1, symbol: "" },
      { value: 1E3, symbol: t('number_suffix_thousand') }, // K
      { value: 1E6, symbol: t('number_suffix_million') }, // M
      { value: 1E9, symbol: t('number_suffix_billion') }, // B
      { value: 1E12, symbol: t('number_suffix_trillion') } // T
    ];
    const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    let i;
    for (i = si.length - 1; i > 0; i--) {
      if (absNum >= si[i].value) {
        break;
      }
    }

    let numDecimals;
    const valAfterSuffix = num / si[i].value;

    if (isCurrency) {
        numDecimals = (valAfterSuffix % 1 === 0 && si[i].value !== 1) ? 0 : (absNum < 1000 ? 2 : decimals);
    } else {
        numDecimals = (isInteger ? 0 : (valAfterSuffix % 1 === 0 && si[i].value !== 1) ? 0 : decimals);
    }
    if (si[i].value === 1) numDecimals = isCurrency ? 2 : (isInteger ? 0 : decimals) ;

    const formattedNum = valAfterSuffix.toFixed(numDecimals).replace(rx, "$1");
    return prefix + formattedNum + si[i].symbol;
  };

const allKpiConfigurations: KpiConfig[] = [
  {
    id: 'totalItems',
    titleKey: 'home_kpi_total_items_title',
    icon: Package,
    getValue: (data, t) => formatLargeNumber(data?.totalItems, t, 0, false, true),
    descriptionKey: 'home_kpi_total_items_desc',
    link: '/inventory',
    iconColor: 'text-accent',
    defaultVisible: true,
  },
  {
    id: 'inventoryValue',
    titleKey: 'home_kpi_inventory_value_title',
    icon: DollarSign,
    getValue: (data, t) => formatLargeNumber(data?.inventoryValue, t, 2, true),
    descriptionKey: 'home_kpi_inventory_value_desc',
    link: '/reports',
    showTrend: true,
    iconColor: 'text-accent',
    defaultVisible: true,
  },
  {
    id: 'grossProfit',
    titleKey: 'home_kpi_gross_profit_title',
    icon: HandCoins,
    getValue: (data, t) => formatLargeNumber(data?.grossProfit, t, 2, true),
    descriptionKey: 'home_kpi_gross_profit_desc',
    link: '/reports',
    iconColor: 'text-green-500 dark:text-green-400',
    defaultVisible: true,
  },
  {
    id: 'currentMonthExpenses',
    titleKey: 'home_kpi_current_month_expenses_title',
    icon: CreditCard,
    getValue: (data, t) => formatLargeNumber(data?.currentMonthTotalExpenses, t, 2, true),
    descriptionKey: 'home_kpi_current_month_expenses_desc',
    link: '/accounts',
    iconColor: 'text-destructive',
    defaultVisible: true,
  },
  {
    id: 'lowStock',
    titleKey: 'home_kpi_low_stock_title',
    icon: AlertTriangle,
    getValue: (data, t) => formatLargeNumber(data?.lowStockItemsCount, t, 0, false, true),
    descriptionKey: 'home_kpi_low_stock_desc',
    link: '/inventory?filter=low',
    showProgress: true,
    progressValue: (data) => data && data.totalItems > 0 && data.lowStockItemsCount >= 0 ? (data.lowStockItemsCount / data.totalItems) * 100 : 0,
    iconColor: 'text-yellow-500 dark:text-yellow-400',
    defaultVisible: true,
  },
  {
    id: 'amountToPay',
    titleKey: 'home_kpi_amount_to_pay_title',
    icon: Banknote,
    getValue: (data, t) => formatLargeNumber(data?.amountRemainingToPay, t, 2, true),
    descriptionKey: 'home_kpi_amount_to_pay_desc',
    link: '/accounts?filter=unpaid', // Assuming unpaid filter exists or will be added
    iconColor: 'text-orange-500 dark:text-orange-400',
    defaultVisible: true,
  },
  {
    id: 'documentsProcessed30d',
    titleKey: 'home_kpi_documents_processed_30d_title',
    icon: FileTextIcon,
    getValue: (data, t) => formatLargeNumber(data?.documentsProcessed30d, t, 0, false, true),
    descriptionKey: 'home_kpi_documents_processed_30d_desc',
    link: '/invoices',
    iconColor: 'text-blue-500 dark:text-blue-400',
    defaultVisible: false, // Hidden by default
  },
  {
    id: 'averageInvoiceValue',
    titleKey: 'home_kpi_average_invoice_value_title',
    icon: BarChart2,
    getValue: (data, t) => formatLargeNumber(data?.averageInvoiceValue, t, 2, true),
    descriptionKey: 'home_kpi_average_invoice_value_desc',
    link: '/reports',
    iconColor: 'text-purple-500 dark:text-purple-400',
    defaultVisible: false, // Hidden by default
  },
  {
    id: 'suppliersCount',
    titleKey: 'home_kpi_suppliers_count_title',
    icon: Briefcase,
    getValue: (data, t) => formatLargeNumber(data?.suppliersCount, t, 0, false, true),
    descriptionKey: 'home_kpi_suppliers_count_desc',
    link: '/suppliers',
    iconColor: 'text-teal-500 dark:text-teal-400',
    defaultVisible: false, // Hidden by default
  },
];

const getKpiPreferences = (userId?: string): { visibleKpiIds: string[], kpiOrder: string[] } => {
  if (typeof window === 'undefined' || !userId) {
    const defaultVisible = allKpiConfigurations.filter(kpi => kpi.defaultVisible !== false);
    return {
        visibleKpiIds: defaultVisible.map(kpi => kpi.id),
        kpiOrder: defaultVisible.map(kpi => kpi.id), // Default order is the order in allKpiConfigurations
    };
  }
  const key = `${KPI_PREFERENCES_STORAGE_KEY}_${userId}`;
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const allKpiIdsSet = new Set(allKpiConfigurations.map(kpi => kpi.id));
      // Filter out any IDs that are no longer valid KPIs
      const validVisibleKpiIds = Array.isArray(parsed.visibleKpiIds) ? parsed.visibleKpiIds.filter((id: string) => allKpiIdsSet.has(id)) : [];
      const validKpiOrder = Array.isArray(parsed.kpiOrder) ? parsed.kpiOrder.filter((id: string) => allKpiIdsSet.has(id)) : [];

      // Ensure all default visible KPIs are included if not present
      allKpiConfigurations.forEach(kpi => {
        if (kpi.defaultVisible && !validVisibleKpiIds.includes(kpi.id)) {
          validVisibleKpiIds.push(kpi.id);
        }
        // Ensure all KPIs are in the order list, add new ones to the end
        if (!validKpiOrder.includes(kpi.id)) {
           validKpiOrder.push(kpi.id); // Add new KPIs to the end of the order
        }
      });
      
      return { visibleKpiIds: validVisibleKpiIds, kpiOrder: validKpiOrder };
    } catch (e) {
      console.error("Error parsing KPI preferences from localStorage:", e);
      // Fallback to default if parsing fails
    }
  }
  // Default preferences if nothing stored or parsing failed
  const defaultVisible = allKpiConfigurations.filter(kpi => kpi.defaultVisible !== false);
  return {
    visibleKpiIds: defaultVisible.map(kpi => kpi.id),
    kpiOrder: allKpiConfigurations.map(kpi => kpi.id), // Full order
  };
};


const saveKpiPreferences = (preferences: { visibleKpiIds: string[], kpiOrder: string[] }, userId?: string) => {
  if (typeof window === 'undefined' || !userId) return;
  const key = `${KPI_PREFERENCES_STORAGE_KEY}_${userId}`;
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch (e) {
    console.error("Error saving KPI preferences to localStorage:", e);
  }
};


const SparkLineChart = ({ data, dataKey, strokeColor }: { data: any[], dataKey: string, strokeColor: string }) => {
  const { t } = useTranslation();
  if (!data || data.length === 0) {
    return <div className="h-10 w-full bg-muted/50 rounded-md flex items-center justify-center text-xs text-muted-foreground">{t('home_kpi_no_trend_data')}</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={data}>
        <RechartsTooltip
          contentStyle={{
            background: "hsl(var(--background))",
            borderColor: "hsl(var(--border))",
            borderRadius: "0.5rem",
            fontSize: "0.75rem",
            padding: "0.25rem 0.5rem",
          }}
          formatter={(value: number, name: string) => {
             if (name === 'value') return [`${t('currency_symbol')}${value.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits: 0})}`, t('reports_chart_label_value')];
             return [value.toLocaleString(), name];
          }}
          labelFormatter={() => ''} // No label on the tooltip itself
        />
        <XAxis dataKey="name" hide />
        <YAxis domain={['dataMin - 100', 'dataMax + 100']} hide /> {/* Adjusted domain for better visualization */}
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={strokeColor}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};


export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [kpiData, setKpiData] = useState<KpiData | null>(null);
  const [isLoadingKpis, setIsLoadingKpis] = useState(true);
  const [kpiError, setKpiError] = useState<string | null>(null);

  const [userKpiPreferences, setUserKpiPreferences] = useState<{ visibleKpiIds: string[], kpiOrder: string[] }>(
    { visibleKpiIds: [], kpiOrder: [] }
  );
  const [isCustomizeSheetOpen, setIsCustomizeSheetOpen] = useState(false);

  const visibleKpiConfigs = useMemo(() => {
    // Ensure kpiOrder is used to sort, and then filter by visibleKpiIds
    return userKpiPreferences.kpiOrder
      .map(id => allKpiConfigurations.find(config => config.id === id)) // Map to full config objects
      .filter(config => config !== undefined && userKpiPreferences.visibleKpiIds.includes(config.id)) as KpiConfig[]; // Filter out undefined and non-visible
  }, [userKpiPreferences]);

  useEffect(() => {
    if (user) {
      setUserKpiPreferences(getKpiPreferences(user.id));
    } else if (!authLoading) {
        // For guests, load default preferences (not tied to a user ID)
        const defaultGuestPrefs = getKpiPreferences(); // Call without userId to get defaults
        setUserKpiPreferences(defaultGuestPrefs);
    }
  }, [user, authLoading]);


  const fetchKpiData = useCallback(async () => {
    if (!user || authLoading) return;

    setIsLoadingKpis(true);
    setKpiError(null);
    try {
      // Simulate fetching data
      // In a real app, these would be API calls or service calls
      const [products, invoicesData, suppliers] = await Promise.all([
        getProductsService(user.id),
        getInvoicesService(user.id),
        getSupplierSummariesService(user.id) // Assuming you have this service
      ]);
      
      // Ensure uploadTime is a string for consistent sorting and processing
      const invoices = invoicesData.map(inv => ({
        ...inv,
        uploadTime: inv.uploadTime // Assuming uploadTime is already a string (ISO format)
      }));


      const otherExpensesStorageKey = getStorageKey(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id);
      const storedOtherExpenses = typeof window !== 'undefined' ? localStorage.getItem(otherExpensesStorageKey) : null;
      const otherExpensesData: OtherExpense[] = storedOtherExpenses ? JSON.parse(storedOtherExpenses) : [];


      // Calculate KPIs
      const totalItems = calculateTotalItems(products);
      const inventoryValue = calculateInventoryValue(products);

      const allLowStockItems = getLowStockItems(products);
      const lowStockItemsCount = allLowStockItems.length;
      // Get top 2 critical low stock items (sorted by quantity ascending, then by name)
      const criticalLowStockProducts = allLowStockItems
        .sort((a,b) => (a.quantity ?? 0) - (b.quantity ?? 0) || (a.shortName || a.description).localeCompare(b.shortName || b.description) )
        .slice(0,2);


      // Find next payment due
      const unpaidInvoices = invoices.filter(
        invoice => (invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'pending_payment') && invoice.paymentDueDate && isValid(parseISO(invoice.paymentDueDate as string))
      ).sort((a, b) => new Date(a.paymentDueDate as string).getTime() - new Date(b.paymentDueDate as string).getTime());
      const nextPaymentDueInvoice = unpaidInvoices.length > 0 ? unpaidInvoices[0] : null;


      const amountRemainingToPay = unpaidInvoices.reduce(
        (sum, invoice) => sum + (invoice.totalAmount || 0),
        0
      );
      const grossProfit = calculateTotalPotentialGrossProfit(products);

      const currentMonthStart = startOfMonth(new Date());
      const currentMonthEnd = endOfMonth(new Date());
      let totalExpensesFromInvoices = 0;

      invoices.forEach(invoice => {
          if (invoice.status !== 'completed') return; // Only consider completed invoices for expense calculation
          // Determine the relevant date for expense allocation
          let relevantDateForExpense: Date | null = null;
          if (invoice.paymentDueDate && isValid(parseISO(invoice.paymentDueDate as string))) {
              relevantDateForExpense = parseISO(invoice.paymentDueDate as string);
          } else if (invoice.uploadTime && isValid(parseISO(invoice.uploadTime as string))) {
              // Fallback to uploadTime if paymentDueDate is not available/valid
              relevantDateForExpense = parseISO(invoice.uploadTime as string);
          }

          if (relevantDateForExpense) {
              // Check if the relevant date falls within the current month
              if (relevantDateForExpense >= currentMonthStart && relevantDateForExpense <= currentMonthEnd) {
                  totalExpensesFromInvoices += (invoice.totalAmount || 0);
              }
          }
      });

      // Calculate 'Other Expenses' for the current month
      const totalOtherExpensesForMonth = otherExpensesData.reduce((sum, exp) => {
          if (!exp.date || !isValid(parseISO(exp.date))) return sum; // Skip if date is invalid
          try {
              const expenseDate = parseISO(exp.date);
              if (isSameMonth(expenseDate, new Date())) {
                  let amountToAdd = exp.amount;
                  // Adjust for bi-monthly expenses (e.g., electricity, water, property_tax)
                  const internalKey = exp._internalCategoryKey?.toLowerCase();
                  const categoryString = exp.category?.toLowerCase(); // Ensure category exists before toLowerCase
                  const biMonthlyKeys = ['electricity', 'water', 'property_tax', t('accounts_other_expenses_tab_electricity').toLowerCase(), t('accounts_other_expenses_tab_water').toLowerCase(), t('accounts_other_expenses_tab_property_tax').toLowerCase()];
                  if ((internalKey && biMonthlyKeys.includes(internalKey)) || (categoryString && !internalKey && biMonthlyKeys.includes(categoryString))){
                       amountToAdd /= 2; // Assuming the recorded amount is for 2 months
                  }
                  return sum + amountToAdd;
              }
              return sum;
          } catch (e) {
              console.error("Invalid date for other expense in current month calculation (Home Page):", exp.date, e);
              return sum;
          }
      }, 0);
      const calculatedCurrentMonthTotalExpenses = totalExpensesFromInvoices + totalOtherExpensesForMonth;
      // Documents processed in the last 30 days
      const thirtyDaysAgo = subDays(new Date(), 30);
      const documentsProcessed30d = invoices.filter(inv =>
          inv.status === 'completed' && // Only count completed documents
          inv.uploadTime && // Ensure uploadTime exists
          parseISO(inv.uploadTime as string) >= thirtyDaysAgo
      ).length;
      // Average Invoice Value
      const completedInvoices = invoices.filter(inv => inv.status === 'completed' && inv.totalAmount !== undefined);
      const totalInvoiceValue = completedInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
      const averageInvoiceValue = completedInvoices.length > 0 ? totalInvoiceValue / completedInvoices.length : 0;
      // Suppliers Count
      const suppliersCount = suppliers.length; // Assuming getSupplierSummariesService returns an array

      // Mock trend data for inventory value (replace with real data if available)
      const mockInventoryValueTrend = [
        { name: 'Day 1', value: inventoryValue * 0.95 + Math.random() * 1000 - 500 },
        { name: 'Day 2', value: inventoryValue * 0.98 + Math.random() * 1000 - 500 },
        { name: 'Day 3', value: inventoryValue * 0.96 + Math.random() * 1000 - 500 },
        { name: 'Day 4', value: inventoryValue * 1.02 + Math.random() * 1000 - 500 },
        { name: 'Day 5', value: inventoryValue + Math.random() * 1000 - 500 },
      ].map(d => ({...d, value: Math.max(0, Math.round(d.value))})); // Ensure value is not negative and is rounded

      // Mock recent activity
      const recentInvoices = invoices.sort((a,b) => new Date(b.uploadTime as string).getTime() - new Date(a.uploadTime as string).getTime()).slice(0,3);
      const mockRecentActivity = recentInvoices.map(inv => ({
        descriptionKey: 'home_recent_activity_mock_invoice_added',
        params: { supplier: inv.supplier || t('invoices_unknown_supplier') }, // Use t for unknown supplier
        time: formatDateFns(parseISO(inv.uploadTime as string), 'PPp'), // Use date-fns for formatting
        link: `/invoices?tab=scanned-docs&viewInvoiceId=${inv.id}`
      }));


      setKpiData({
        totalItems,
        inventoryValue,
        lowStockItemsCount,
        criticalLowStockProducts,
        nextPaymentDueInvoice,
        recentActivity: mockRecentActivity, // Use mock activity
        latestDocName: invoices.length > 0 ? invoices[0].fileName : undefined, // Example for latest doc
        inventoryValueTrend: mockInventoryValueTrend,
        inventoryValuePrevious: mockInventoryValueTrend.length > 1 ? mockInventoryValueTrend[mockInventoryValueTrend.length - 2].value : inventoryValue,
        grossProfit,
        amountRemainingToPay,
        currentMonthTotalExpenses: calculatedCurrentMonthTotalExpenses,
        documentsProcessed30d,
        averageInvoiceValue,
        suppliersCount,
      });

    } catch (error) {
      console.error("Failed to fetch KPI data:", error);
      setKpiError(t('home_kpi_error_load_failed'));
      toast({
        title: t('error_title'),
        description: t('home_kpi_toast_error_load_failed_desc'),
        variant: "destructive",
      });
    } finally {
      setIsLoadingKpis(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, t]); // Added t to dependency array

  useEffect(() => {
    if (user) {
      fetchKpiData();
    } else if (!authLoading) {
      // If not loading and no user (guest), set loading KPIs to false
      setIsLoadingKpis(false);
    }
  }, [user, authLoading, fetchKpiData]);


  const handleScanClick = () => {
    router.push('/upload');
  };

  const handleInventoryClick = () => {
    router.push('/inventory');
  };

  const handleAccountsClick = () => {
    router.push('/accounts');
  };

  const renderKpiValueDisplay = (valueString: string) => {
    if (isLoadingKpis && user) {
      return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
    }
    if (kpiError && user) return <span className="text-destructive text-lg">-</span>;
    return valueString;
  };


  const handleSavePreferences = (newPreferences: { visibleKpiIds: string[], kpiOrder: string[] }) => {
    if (user) { // Only save for logged-in users
        saveKpiPreferences(newPreferences, user.id);
        setUserKpiPreferences(newPreferences); // Update local state to re-render
        toast({ title: t('home_kpi_prefs_saved_title'), description: t('home_kpi_prefs_saved_desc')});
    }
  };


   if (authLoading) {
     return (
       <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-4 md:p-8">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="mt-4 text-muted-foreground">{t('loading_data')}</p>
       </div>
     );
   }

  if (!user && !authLoading) {
    return <GuestHomePage />;
  }

  return (
    <div className={cn("flex flex-col items-center justify-start min-h-[calc(100vh-var(--header-height,4rem))] p-4 sm:p-6 md:p-8", styles.homeContainerGradient)}>
      <TooltipProvider>
        <div className="w-full max-w-5xl text-center">
           <p className="text-base sm:text-lg text-muted-foreground mb-2 scale-fade-in delay-100">
             {t('home_greeting', { username: user?.username || t('user_fallback_name') })}
           </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6 md:mb-8 text-primary scale-fade-in">
             {t('home_welcome_title')}
          </h1>

          <div className="mb-8 md:mb-12 scale-fade-in delay-200 text-center">
                <Button
                  size="lg"
                  className="w-full max-w-xs mx-auto bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-lg transform hover:-translate-y-1 py-3 sm:py-4"
                  onClick={handleScanClick}
                >
                  <ScanLine className="mr-2 h-5 w-5" /> {t('home_scan_button')}
                </Button>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 max-w-xs mx-auto">
                     <Button
                        variant="outline"
                        size="default"
                        className="w-full border-primary text-primary hover:bg-primary/5 shadow-md hover:shadow-lg transition-all duration-300 ease-in-out hover:scale-105 text-sm transform hover:-translate-y-0.5 py-2.5 sm:py-3"
                        onClick={handleInventoryClick}
                        >
                        <Package className="mr-2 h-4 w-4" /> {t('home_inventory_button')}
                    </Button>
                    <Button
                        variant="outline"
                        size="default"
                        className="w-full border-primary text-primary hover:bg-primary/5 shadow-md hover:shadow-lg transition-all duration-300 ease-in-out hover:scale-105 text-sm transform hover:-translate-y-0.5 py-2.5 sm:py-3"
                        onClick={handleAccountsClick}
                        >
                        <CreditCard className="mr-2 h-4 w-4" /> {t('nav_accounts')}
                    </Button>
                </div>
          </div>


          <Card className="mb-6 md:mb-8 scale-fade-in delay-300 bg-card/90 backdrop-blur-sm border-border/50 shadow-xl">
            <CardHeader className="pb-4">
              <div className="flex justify-between items-center">
                <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                    <ListChecks className="mr-2 h-5 w-5" /> {t('home_quick_overview_title')}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setIsCustomizeSheetOpen(true)} className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <SettingsIcon className="h-4 w-4" />
                    <span className="sr-only">{t('home_customize_dashboard_button')}</span>
                </Button>
              </div>
               <CardDescription>{t('home_quick_overview_desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {kpiError && !isLoadingKpis && user && (
                <Alert variant="destructive" className="mb-4 text-left">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{kpiError}</AlertDescription>
                </Alert>
              )}
              {(isLoadingKpis && user) ? (
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {Array.from({length: Math.min(visibleKpiConfigs.length || 3, 6)}).map((_, idx) => (
                        <Card key={`skeleton-${idx}`} className="shadow-md bg-background/80 h-[150px] sm:h-[160px]">
                            <CardHeader className="pb-1 pt-3 px-3 sm:px-4"><Skeleton className="h-4 w-2/3"/></CardHeader>
                            <CardContent className="pt-1 pb-2 px-3 sm:px-4"><Skeleton className="h-8 w-1/2 mb-1"/><Skeleton className="h-3 w-3/4"/></CardContent>
                        </Card>
                    ))}
                 </div>
              ) : !kpiError && (!kpiData || visibleKpiConfigs.length === 0) ? (
                 <div className="text-center py-8 text-muted-foreground">
                    <SettingsIcon className="mx-auto h-12 w-12 mb-2 opacity-50" />
                    <p className="text-sm">{t('home_empty_state_kpis_title')}</p>
                    <Button variant="link" onClick={() => setIsCustomizeSheetOpen(true)} className="text-sm text-primary">{t('home_empty_state_kpis_action')}</Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {visibleKpiConfigs.map((kpi, index) => {
                        const Icon = kpi.icon;
                        const valueString = kpi.getValue(kpiData, t);
                        const progress = kpi.showProgress && kpi.progressValue ? kpi.progressValue(kpiData) : 0;
                        return (
                        <Tooltip key={kpi.id}>
                            <TooltipTrigger asChild>
                            <Link href={kpi.link} className="block hover:no-underline h-full">
                                <Card className={cn("shadow-md hover:shadow-lg transition-all duration-300 ease-in-out hover:scale-[1.03] h-full text-left transform hover:-translate-y-0.5 bg-background/90 backdrop-blur-sm border-border/50 flex flex-col", styles.kpiCard)} style={{animationDelay: `${0.05 * index}s`}}>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-3 sm:px-4">
                                    <CardTitle className="text-sm sm:text-base font-semibold text-muted-foreground">{t(kpi.titleKey)}</CardTitle>
                                    <Icon className={cn("h-5 w-5 sm:h-6 sm:w-6", kpi.iconColor || "text-primary")} />
                                </CardHeader>
                                <CardContent className="pt-1 pb-2 px-3 sm:px-4 flex-grow flex flex-col justify-center">
                                    <div className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground flex items-baseline">
                                        {renderKpiValueDisplay(valueString)}
                                        {kpi.id === 'inventoryValue' && kpiData && kpiData.inventoryValueTrend && kpiData.inventoryValueTrend.length > 1 && kpiData.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && (
                                            kpiData.inventoryValue > kpiData.inventoryValuePrevious ?
                                            <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-500 ml-1.5 shrink-0" /> :
                                            <TrendingDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-red-500 ml-1.5 shrink-0" />
                                        )}
                                    </div>
                                    <p className="text-xs sm:text-sm text-muted-foreground pt-0.5 sm:pt-1 h-8 sm:h-auto overflow-hidden text-ellipsis">{t(kpi.descriptionKey)}</p>
                                    {kpi.id === 'inventoryValue' && kpiData?.inventoryValueTrend && (
                                        <div className="mt-1.5 h-8">
                                            <SparkLineChart data={kpiData.inventoryValueTrend || []} dataKey="value" strokeColor="hsl(var(--primary))" />
                                        </div>
                                    )}
                                    {kpi.showProgress && kpiData && (
                                        <Progress
                                            value={progress}
                                            className="h-2 sm:h-2.5 mt-2 sm:mt-2.5 bg-muted/40"
                                            indicatorClassName={cn(
                                                "transition-all duration-500 ease-out",
                                                progress > 75 ? "bg-destructive" :
                                                progress > 50 ? "bg-yellow-500" :
                                                "bg-primary"
                                            )}
                                        />
                                    )}
                                </CardContent>
                                {kpi.id === 'inventoryValue' && kpiData?.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && kpiData.inventoryValue !== undefined && (
                                    <CardFooter className="text-xs sm:text-sm px-3 sm:px-4 pb-2 pt-0 mt-auto">
                                        <p className={cn("text-muted-foreground", kpiData.inventoryValue > kpiData.inventoryValuePrevious ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                                            {t('home_kpi_vs_last_period_prefix')} {formatLargeNumber(kpiData.inventoryValuePrevious, t, 2, true)}
                                        </p>
                                    </CardFooter>
                                )}
                                </Card>
                            </Link>
                            </TooltipTrigger>
                            <TooltipContent>
                            <p>{t(kpi.titleKey)}: {valueString}</p>
                            <p className="text-xs">{t(kpi.descriptionKey)}</p>
                            </TooltipContent>
                        </Tooltip>
                        );
                    })}
                </div>
              )}
               {(kpiData && visibleKpiConfigs.length === 0 && !isLoadingKpis) && (
                    <div className="text-center py-8 text-muted-foreground">
                        <SettingsIcon className="mx-auto h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">{t('home_no_kpis_selected_title')}</p>
                        <Button variant="link" onClick={() => setIsCustomizeSheetOpen(true)} className="text-sm text-primary">{t('home_no_kpis_selected_action')}</Button>
                    </div>
                )}
            </CardContent>
          </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-8 md:mb-12">
                <Card className="scale-fade-in delay-400 bg-card/90 backdrop-blur-sm border-border/50 shadow-xl">
                    <CardHeader className="pb-3">
                    <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                        <Info className="mr-2 h-5 w-5" /> {t('home_actionable_insights_title')}
                    </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm pt-0">
                        <div>
                            <h3 className="text-base font-semibold text-foreground flex items-center">
                                <AlertTriangle className="mr-2 h-4 w-4 text-destructive" />
                                {t('home_critical_low_stock_title')}
                            </h3>
                            {isLoadingKpis ? <Skeleton className="h-5 w-2/3 my-2" /> :
                            kpiData?.criticalLowStockProducts && kpiData.criticalLowStockProducts.length > 0 ? (
                                <ul className="list-disc pl-5 text-muted-foreground mt-1 space-y-0.5">
                                {kpiData.criticalLowStockProducts.map(product => (
                                    <li key={product.id}>
                                    <Link href={`/inventory/${product.id}`} className="hover:underline text-primary">
                                        {product.shortName || product.description}
                                    </Link> ({t('home_stock_level_label')}: {product.quantity})
                                    </li>
                                ))}
                                </ul>
                            ) : (
                                <div className="text-muted-foreground mt-1 text-center py-4">
                                    <Package className="mx-auto h-8 w-8 mb-1 opacity-40" />
                                    <p>{t('home_empty_state_low_stock')}</p>
                                </div>
                            )}
                        </div>
                        <hr className="my-2 border-border/50"/>
                        <div>
                            <h3 className="text-base font-semibold text-foreground flex items-center">
                                <BellRing className="mr-2 h-4 w-4 text-primary" />
                                {t('home_next_payment_due_title')}
                            </h3>
                            {isLoadingKpis ? <Skeleton className="h-5 w-3/4 my-2" /> :
                            kpiData?.nextPaymentDueInvoice ? (
                                <p className="text-muted-foreground mt-1">
                                    <Link href={`/invoices?tab=scanned-docs&viewInvoiceId=${kpiData.nextPaymentDueInvoice.id}`} className="hover:underline text-primary">
                                        {kpiData.nextPaymentDueInvoice.supplier || t('invoices_unknown_supplier')} - {formatLargeNumber(kpiData.nextPaymentDueInvoice.totalAmount, t, 2, true)}
                                    </Link>
                                    {' '}{t('home_due_on_label')} {kpiData.nextPaymentDueInvoice.paymentDueDate ? formatDateFns(parseISO(kpiData.nextPaymentDueInvoice.paymentDueDate as string), 'PP') : t('home_unknown_date')}
                                </p>
                            ) : (
                                 <div className="text-muted-foreground mt-1 text-center py-4">
                                    <CreditCard className="mx-auto h-8 w-8 mb-1 opacity-40" />
                                    <p>{t('home_empty_state_upcoming_payments')}</p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="scale-fade-in delay-500 bg-card/90 backdrop-blur-sm border-border/50 shadow-xl">
                    <CardHeader className="pb-3">
                    <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                        <History className="mr-2 h-5 w-5" /> {t('home_recent_activity_title')}
                    </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {isLoadingKpis ? 
                            <div className="space-y-2">
                                <Skeleton className="h-5 w-full" />
                                <Skeleton className="h-5 w-5/6" />
                                <Skeleton className="h-5 w-3/4" />
                            </div>
                            :
                        kpiData?.recentActivity && kpiData.recentActivity.length > 0 ? (
                            <ul className="space-y-1.5 text-sm">
                            {kpiData.recentActivity.map((activity, index) => (
                                <li key={index} className="text-muted-foreground flex justify-between items-center py-1 border-b border-border/30 last:border-b-0">
                                    <span className="truncate max-w-[70%]">
                                        {activity.link ? (
                                            <Link href={activity.link} className="hover:underline text-primary">{t(activity.descriptionKey, activity.params)}</Link>
                                        ) : (
                                            t(activity.descriptionKey, activity.params)
                                        )}
                                    </span>
                                    <span className="text-xs whitespace-nowrap">{activity.time}</span>
                                </li>
                            ))}
                            </ul>
                        ) : (
                            <div className="text-muted-foreground mt-1 text-center py-10">
                                <FileTextIcon className="mx-auto h-8 w-8 mb-1 opacity-40" />
                                <p>{t('home_empty_state_recent_activity_title')}</p>
                                <p className="text-xs">{t('home_empty_state_recent_activity_desc')}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Card className="mb-6 md:mb-8 scale-fade-in delay-300 bg-card/90 backdrop-blur-sm border-border/50 shadow-xl">
                <CardHeader className="pb-3">
                <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                    <PlusCircle className="mr-2 h-5 w-5" /> {t('home_quick_actions_title')}
                </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-0">
                <Button variant="outline" asChild className="hover:bg-accent/10 hover:border-accent transform hover:scale-[1.02] transition-all">
                    <Link href="/accounts/other-expenses">
                    <DollarSign className="mr-2 h-4 w-4" /> {t('home_quick_action_add_expense')}
                    </Link>
                </Button>
                <Button variant="outline" asChild className="hover:bg-accent/10 hover:border-accent transform hover:scale-[1.02] transition-all">
                    <Link href="/inventory"> {/* Assuming direct link to inventory for now, can be specific add product page later */}
                    <PackagePlus className="mr-2 h-4 w-4" /> {t('home_quick_action_add_product')}
                    </Link>
                </Button>
                </CardContent>
            </Card>
        </div>
      </TooltipProvider>
      <KpiCustomizationSheet
        isOpen={isCustomizeSheetOpen}
        onOpenChange={setIsCustomizeSheetOpen}
        allKpis={allKpiConfigurations}
        currentVisibleKpiIds={userKpiPreferences.visibleKpiIds}
        currentKpiOrder={userKpiPreferences.kpiOrder}
        onSavePreferences={handleSavePreferences}
      />
    </div>
  );
}
