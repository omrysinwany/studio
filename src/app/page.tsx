// src/app/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { Package, FileText as FileTextIcon, BarChart2, ScanLine, Loader2, TrendingUp, TrendingDown, DollarSign, HandCoins, ShoppingCart, CreditCard, Banknote, Settings as SettingsIcon, Briefcase, AlertTriangle, BellRing, History, PlusCircle, PackagePlus, Info, ListChecks, FileWarning, UserPlus } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getProductsService, InvoiceHistoryItem, getInvoicesService, SupplierSummary, getSupplierSummariesService, Product as BackendProduct, OtherExpense, OTHER_EXPENSES_STORAGE_KEY_BASE, UserSettings, getUserSettingsService, MONTHLY_BUDGET_STORAGE_KEY_BASE, createSupplierService, getStoredData } from '@/services/backend';
import {
  calculateInventoryValue,
  calculateTotalItems,
  getLowStockItems,
  calculateTotalPotentialGrossProfit,
  calculateAverageOrderValue
} from '@/lib/kpi-calculations';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import GuestHomePage from '@/components/GuestHomePage';
import { isValid, parseISO, startOfMonth, endOfMonth, isSameMonth, subDays, format as formatDateFns } from 'date-fns';
import { Timestamp } from 'firebase/firestore'; // Import Timestamp
import { he as heLocale, enUS as enUSLocale } from 'date-fns/locale';
import { useTranslation } from '@/hooks/useTranslation';
import KpiCustomizationSheet from '@/components/KpiCustomizationSheet';
import styles from "./page.module.scss";
import { Skeleton } from "@/components/ui/skeleton";
import CreateSupplierSheet from '@/components/create-supplier-sheet';
import { Progress } from "@/components/ui/progress";


const KPI_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_kpiPreferences_v2';
const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_quickActionsPreferences_v1';


interface KpiData {
  totalItems: number;
  inventoryValue: number;
  lowStockItemsCount: number;
  criticalLowStockProducts: BackendProduct[];
  nextPaymentDueInvoice: InvoiceHistoryItem | null;
  recentActivity: { descriptionKey: string; params?: Record<string, string | number>; time: string; link?: string }[];
  latestDocName?: string;
  grossProfit: number;
  amountRemainingToPay: number;
  currentMonthTotalExpenses?: number;
  documentsProcessed30d?: number;
  averageInvoiceValue?: number;
  suppliersCount?: number;
  inventoryValueHistory?: { date: string; value: number }[];
}

export interface ItemConfig {
  id: string;
  titleKey: string;
  icon: React.ElementType;
  getValue?: (data: KpiData | null, t: (key: string, params?: Record<string, string | number>) => string) => string;
  descriptionKey?: string;
  link?: string;
  showTrend?: boolean;
  showProgress?: boolean;
  progressValue?: (data: KpiData | null) => number;
  iconColor?: string;
  defaultVisible?: boolean;
  onClick?: () => void;
}

const formatLargeNumber = (
    num: number | undefined | null,
    t: (key: string, params?: Record<string, string | number>) => string,
    decimals = 0,
    isCurrency = false,
    isInteger = false
  ): string => {
    if (num === undefined || num === null || isNaN(num)) {
      return isCurrency ? `${t('currency_symbol')}-` : '-';
    }

    const prefix = isCurrency ? `${t('currency_symbol')}` : '';
    const absNum = Math.abs(num);
    const localeCode = t('locale_code_for_number_formatting') as string | undefined;

    if (isCurrency || absNum < 10000 || (isInteger && absNum < 1000 && decimals === 0)) {
        return prefix + num.toLocaleString(localeCode || undefined, {
            minimumFractionDigits: 0, // Always 0 for currency and whole numbers
            maximumFractionDigits: 0
        });
    }

    const si = [
      { value: 1, symbol: "" },
      { value: 1E3, symbol: t('number_suffix_thousand') },
      { value: 1E6, symbol: t('number_suffix_million') },
      { value: 1E9, symbol: t('number_suffix_billion') },
      { value: 1E12, symbol: t('number_suffix_trillion') }
    ];
    const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    let i;
    for (i = si.length - 1; i > 0; i--) {
      if (absNum >= si[i].value) {
        break;
      }
    }
    
    const formattedNum = (num / si[i].value).toFixed(decimals === 0 ? 0 : 1).replace(rx, "$1");
    return prefix + formattedNum + si[i].symbol;
  };

const allKpiConfigurations: ItemConfig[] = [
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
    getValue: (data, t) => formatLargeNumber(data?.inventoryValue, t, 0, true),
    descriptionKey: 'home_kpi_inventory_value_desc',
    link: '/reports',
    showTrend: false, // Sparkline was removed
    iconColor: 'text-green-500 dark:text-green-400',
    defaultVisible: true,
  },
  {
    id: 'grossProfit',
    titleKey: 'home_kpi_gross_profit_title',
    icon: HandCoins,
    getValue: (data, t) => formatLargeNumber(data?.grossProfit, t, 0, true),
    descriptionKey: 'home_kpi_gross_profit_desc',
    link: '/reports',
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    defaultVisible: true,
  },
  {
    id: 'currentMonthExpenses',
    titleKey: 'home_kpi_current_month_expenses_title',
    icon: CreditCard,
    getValue: (data, t) => formatLargeNumber(data?.currentMonthTotalExpenses, t, 0, true),
    descriptionKey: 'home_kpi_current_month_expenses_desc',
    link: '/accounts',
    iconColor: 'text-red-500 dark:text-red-400',
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
    getValue: (data, t) => formatLargeNumber(data?.amountRemainingToPay, t, 0, true),
    descriptionKey: 'home_kpi_amount_to_pay_desc',
    link: '/invoices?tab=scanned-docs&filterPaymentStatus=unpaid',
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
    defaultVisible: false,
  },
  {
    id: 'averageInvoiceValue',
    titleKey: 'home_kpi_average_invoice_value_title',
    icon: BarChart2,
    getValue: (data, t) => formatLargeNumber(data?.averageInvoiceValue, t, 0, true),
    descriptionKey: 'home_kpi_average_invoice_value_desc',
    link: '/reports',
    iconColor: 'text-purple-500 dark:text-purple-400',
    defaultVisible: false,
  },
  {
    id: 'suppliersCount',
    titleKey: 'home_kpi_suppliers_count_title',
    icon: Briefcase,
    getValue: (data, t) => formatLargeNumber(data?.suppliersCount, t, 0, false, true),
    descriptionKey: 'home_kpi_suppliers_count_desc',
    link: '/suppliers',
    iconColor: 'text-teal-500 dark:text-teal-400',
    defaultVisible: false,
  },
];

const getKpiPreferences = (userId?: string): { visibleKpiIds: string[], kpiOrder: string[] } => {
  if (typeof window === 'undefined' || !userId) {
    const defaultVisible = allKpiConfigurations.filter(kpi => kpi.defaultVisible !== false);
    return {
        visibleKpiIds: defaultVisible.map(kpi => kpi.id),
        kpiOrder: defaultVisible.map(kpi => kpi.id),
    };
  }
  const key = getStorageKey(KPI_PREFERENCES_STORAGE_KEY_BASE, userId);
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const allKpiIdsSet = new Set(allKpiConfigurations.map(kpi => kpi.id));
      const validVisibleKpiIds = Array.isArray(parsed.visibleKpiIds) ? parsed.visibleKpiIds.filter((id: string) => allKpiIdsSet.has(id)) : [];
      const validKpiOrder = Array.isArray(parsed.kpiOrder) ? parsed.kpiOrder.filter((id: string) => allKpiIdsSet.has(id)) : [];

      allKpiConfigurations.forEach(kpi => {
        if (kpi.defaultVisible && !validVisibleKpiIds.includes(kpi.id)) {
          validVisibleKpiIds.push(kpi.id);
        }
        if (!validKpiOrder.includes(kpi.id)) {
           validKpiOrder.push(kpi.id);
        }
      });

      return { visibleKpiIds: validVisibleKpiIds, kpiOrder: validKpiOrder };
    } catch (e) {
      console.error("Error parsing KPI preferences from localStorage:", e);
    }
  }
  const defaultVisible = allKpiConfigurations.filter(kpi => kpi.defaultVisible !== false);
  return {
    visibleKpiIds: defaultVisible.map(kpi => kpi.id),
    kpiOrder: allKpiConfigurations.map(kpi => kpi.id),
  };
};


const saveKpiPreferences = (preferences: { visibleKpiIds: string[], kpiOrder: string[] }, userId?: string) => {
  if (typeof window === 'undefined' || !userId) return;
  const key = getStorageKey(KPI_PREFERENCES_STORAGE_KEY_BASE, userId);
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch (e) {
    console.error("Error saving KPI preferences to localStorage:", e);
  }
};

const getQuickActionPreferences = (userId?: string, allQuickActions: ItemConfig[] = []): { visibleQuickActionIds: string[], quickActionOrder: string[] } => {
  if (typeof window === 'undefined' || !userId) {
    const defaultVisible = allQuickActions.filter(qa => qa.defaultVisible !== false);
    return {
        visibleQuickActionIds: defaultVisible.map(qa => qa.id),
        quickActionOrder: defaultVisible.map(qa => qa.id),
    };
  }
  const key = getStorageKey(QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE, userId);
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const allQaIdsSet = new Set(allQuickActions.map(qa => qa.id));
      const validVisibleQaIds = Array.isArray(parsed.visibleQuickActionIds) ? parsed.visibleQuickActionIds.filter((id: string) => allQaIdsSet.has(id)) : [];
      const validQaOrder = Array.isArray(parsed.quickActionOrder) ? parsed.quickActionOrder.filter((id: string) => allQaIdsSet.has(id)) : [];

      allQuickActions.forEach(qa => {
        if (qa.defaultVisible && !validVisibleQaIds.includes(qa.id)) {
          validVisibleQaIds.push(qa.id);
        }
        if (!validQaOrder.includes(qa.id)) {
           validQaOrder.push(qa.id);
        }
      });
      return { visibleQuickActionIds: validVisibleQaIds, quickActionOrder: validQaOrder };
    } catch (e) {
      console.error("Error parsing Quick Action preferences from localStorage:", e);
    }
  }
  const defaultVisible = allQuickActions.filter(qa => qa.defaultVisible !== false);
  return {
    visibleQuickActionIds: defaultVisible.map(qa => qa.id),
    quickActionOrder: allQuickActions.map(qa => qa.id),
  };
};

const saveQuickActionPreferences = (preferences: { visibleQuickActionIds: string[], quickActionOrder: string[] }, userId?: string) => {
  if (typeof window === 'undefined' || !userId) return;
  const key = getStorageKey(QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE, userId);
  localStorage.setItem(key, JSON.stringify(preferences));
};


export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useTranslation();

  const [kpiData, setKpiData] = useState<KpiData | null>(null);
  const [isLoadingKpis, setIsLoadingKpis] = useState(true);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [isCreateSupplierSheetOpen, setIsCreateSupplierSheetOpen] = useState(false);

  const allQuickActionConfigurations: ItemConfig[] = useMemo(() => [
    {
      id: 'openInvoices',
      titleKey: 'home_open_invoices',
      icon: FileWarning,
      link: '/invoices?tab=scanned-docs&filterPaymentStatus=unpaid',
      defaultVisible: true,
    },
    {
      id: 'latestDocument',
      titleKey: 'home_quick_action_latest_document',
      icon: History,
      link: '/invoices?tab=scanned-docs&sortBy=uploadTime&sortDir=desc',
      defaultVisible: true,
    },
    {
      id: 'addSupplier',
      titleKey: 'home_quick_action_add_supplier',
      icon: UserPlus,
      onClick: () => setIsCreateSupplierSheetOpen(true),
      defaultVisible: false, // Hidden by default
    },
     {
      id: 'addExpense',
      titleKey: 'home_quick_action_add_expense',
      icon: DollarSign,
      link: '/accounts/other-expenses',
      defaultVisible: true,
    },
    {
      id: 'addProduct',
      titleKey: 'home_quick_action_add_product',
      icon: PackagePlus,
      link: '/inventory',
      defaultVisible: true,
    },
  ], [t, setIsCreateSupplierSheetOpen]);


  const [userKpiPreferences, setUserKpiPreferences] = useState<{ visibleKpiIds: string[], kpiOrder: string[] }>(
    { visibleKpiIds: [], kpiOrder: [] }
  );

  const [userQuickActionPreferences, setUserQuickActionPreferences] = useState<{ visibleQuickActionIds: string[], quickActionOrder: string[] }>(
    getQuickActionPreferences(user?.id, allQuickActionConfigurations)
  );

  const [isCustomizeKpiSheetOpen, setIsCustomizeKpiSheetOpen] = useState(false);
  const [isCustomizeQuickActionsSheetOpen, setIsCustomizeQuickActionsSheetOpen] = useState(false);


  const visibleKpiConfigs = useMemo(() => {
    return userKpiPreferences.kpiOrder
      .map(id => allKpiConfigurations.find(config => config.id === id))
      .filter(config => config !== undefined && userKpiPreferences.visibleKpiIds.includes(config.id)) as ItemConfig[];
  }, [userKpiPreferences]);

  const visibleQuickActions = useMemo(() => {
    return userQuickActionPreferences.quickActionOrder
      .map(id => allQuickActionConfigurations.find(config => config.id === id))
      .filter(config => config !== undefined && userQuickActionPreferences.visibleQuickActionIds.includes(config.id)) as ItemConfig[];
  }, [userQuickActionPreferences, allQuickActionConfigurations]);

  useEffect(() => {
    if (user && user.id) { // Ensure user.id is available
      setUserKpiPreferences(getKpiPreferences(user.id));
      setUserQuickActionPreferences(getQuickActionPreferences(user.id, allQuickActionConfigurations));
    } else if (!authLoading) {
        setUserKpiPreferences(getKpiPreferences()); // For guest or loading state, use defaults
        setUserQuickActionPreferences(getQuickActionPreferences(undefined, allQuickActionConfigurations));
    }
  }, [user, authLoading, allQuickActionConfigurations]);


  const fetchKpiData = useCallback(async () => {
    if (!user || !user.id || authLoading) {
      setIsLoadingKpis(false); // Stop loading if no user or still in auth loading
      return;
    }

    setIsLoadingKpis(true);
    setKpiError(null);
    console.log("[HomePage] fetchKpiData called for user:", user.id);
    try {
      const [products, invoicesData, suppliers, userSettings, otherExpensesData] = await Promise.all([
        getProductsService(user.id),
        getInvoicesService(user.id),
        getSupplierSummariesService(user.id),
        getUserSettingsService(user.id),
        getStoredData<OtherExpense>(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id, []) // Fetch other expenses
      ]);
      console.log("[HomePage] Data fetched: Products:", products.length, "Invoices:", invoicesData.length, "Suppliers:", suppliers.length);


      const invoices = invoicesData.map(inv => ({
        ...inv,
        uploadTime: inv.uploadTime
      }));

      const totalItems = calculateTotalItems(products);
      const inventoryValue = calculateInventoryValue(products);

      const allLowStockItems = getLowStockItems(products);
      const lowStockItemsCount = allLowStockItems.length;
      const criticalLowStockProducts = allLowStockItems
        .sort((a,b) => (a.quantity ?? 0) - (b.quantity ?? 0) || (a.shortName || a.description || '').localeCompare(b.shortName || b.description || '') )
        .slice(0,2);

      const unpaidInvoices = invoices.filter(
        invoice => (invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'pending_payment') && invoice.paymentDueDate && isValid(invoice.paymentDueDate instanceof Timestamp ? invoice.paymentDueDate.toDate() : parseISO(invoice.paymentDueDate as string))
      ).sort((a, b) => {
          const dateA = a.paymentDueDate instanceof Timestamp ? a.paymentDueDate.toDate() : parseISO(a.paymentDueDate as string);
          const dateB = b.paymentDueDate instanceof Timestamp ? b.paymentDueDate.toDate() : parseISO(b.paymentDueDate as string);
          return dateA.getTime() - dateB.getTime();
      });
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
          if (invoice.status !== 'completed') return;
          let relevantDateForExpense: Date | null = null;
          let paymentDateTs: Date | null = null;
          let uploadDateTs: Date | null = null;

          if (invoice.paymentDueDate) {
              if (invoice.paymentDueDate instanceof Timestamp) paymentDateTs = invoice.paymentDueDate.toDate();
              else if (typeof invoice.paymentDueDate === 'string' && isValid(parseISO(invoice.paymentDueDate))) paymentDateTs = parseISO(invoice.paymentDueDate);
          }
          if (invoice.uploadTime) {
              if (invoice.uploadTime instanceof Timestamp) uploadDateTs = invoice.uploadTime.toDate();
              else if (typeof invoice.uploadTime === 'string' && isValid(parseISO(invoice.uploadTime))) uploadDateTs = parseISO(invoice.uploadTime);
          }

          if (paymentDateTs && paymentDateTs >= currentMonthStart && paymentDateTs <= currentMonthEnd) {
                relevantDateForExpense = paymentDateTs;
          }
          if (!relevantDateForExpense && uploadDateTs && uploadDateTs >= currentMonthStart && uploadDateTs <= currentMonthEnd) {
                  relevantDateForExpense = uploadDateTs;
          }

          if (relevantDateForExpense && (invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'pending_payment' || invoice.paymentStatus === 'paid')) {
             totalExpensesFromInvoices += (invoice.totalAmount || 0);
          }
      });

      const totalOtherExpensesForMonth = otherExpensesData.reduce((sum, exp) => {
          if (!exp.date) return sum;
          let expenseDate: Date | null = null;
          if (exp.date instanceof Timestamp) expenseDate = exp.date.toDate();
          else if (typeof exp.date === 'string' && isValid(parseISO(exp.date))) expenseDate = parseISO(exp.date);
          
          if (expenseDate && isSameMonth(expenseDate, new Date())) {
                  let amountToAdd = exp.amount;
                  const internalKey = exp._internalCategoryKey?.toLowerCase();
                  const categoryString = exp.category?.toLowerCase();
                  const biMonthlyKeys = ['electricity', 'water', 'property_tax', 'rent',
                                         t('accounts_other_expenses_tab_electricity').toLowerCase(),
                                         t('accounts_other_expenses_tab_water').toLowerCase(),
                                         t('accounts_other_expenses_tab_property_tax').toLowerCase(),
                                         t('accounts_other_expenses_tab_rent').toLowerCase()];

                  if ((internalKey && biMonthlyKeys.includes(internalKey)) || (categoryString && !internalKey && biMonthlyKeys.includes(categoryString))){
                      // Bi-monthly expenses are typically recorded for the month they are paid/due.
                      // If they represent two months' worth, the user should enter the full amount,
                      // and any proration for monthly views would happen in the display/calculation logic for that specific view.
                      // For "This Month's Expenses" KPI, we sum the recorded amounts for the current month.
                  }
                  return sum + amountToAdd;
              }
              return sum;
      }, 0);
      const calculatedCurrentMonthTotalExpenses = totalExpensesFromInvoices + totalOtherExpensesForMonth;
      const thirtyDaysAgo = subDays(new Date(), 30);
      const documentsProcessed30d = invoices.filter(inv => {
          if (inv.status !== 'completed' || !inv.uploadTime) return false;
          let uploadDate: Date | null = null;
          if (inv.uploadTime instanceof Timestamp) uploadDate = inv.uploadTime.toDate();
          else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) uploadDate = parseISO(inv.uploadTime);
          return uploadDate && uploadDate >= thirtyDaysAgo;
      }).length;

      const completedInvoices = invoices.filter(inv => inv.status === 'completed' && inv.totalAmount !== undefined);
      const totalInvoiceValue = completedInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
      const averageInvoiceValueData = completedInvoices.length > 0 ? totalInvoiceValue / completedInvoices.length : 0;
      const suppliersCountData = suppliers.length;

      const recentInvoices = invoices.sort((a,b) => {
          const timeA = a.uploadTime ? (a.uploadTime instanceof Timestamp ? a.uploadTime.toDate() : parseISO(a.uploadTime as string)).getTime() : 0;
          const timeB = b.uploadTime ? (b.uploadTime instanceof Timestamp ? b.uploadTime.toDate() : parseISO(b.uploadTime as string)).getTime() : 0;
          return timeB - timeA;
      }).slice(0,3);

      const localeToUse = t('locale_code_for_date_fns') === 'he' ? heLocale : enUSLocale;
      const mockRecentActivity = recentInvoices.map(inv => {
        let dateToFormat: Date | null = null;
        if (inv.uploadTime) {
          if (typeof inv.uploadTime === 'string') {
            const parsed = parseISO(inv.uploadTime);
            if (isValid(parsed)) {
              dateToFormat = parsed;
            }
          } else if (inv.uploadTime instanceof Timestamp) { // Check for Firestore Timestamp
            dateToFormat = inv.uploadTime.toDate();
          } else if (inv.uploadTime instanceof Date) { // Check if it's already a Date object
            // This case might not be strictly necessary if all Timestamps are converted to Dates upon fetch
            // but it's good for robustness if Date objects can appear.
            dateToFormat = inv.uploadTime;
          }
        }
      
        return {
          descriptionKey: 'home_recent_activity_mock_invoice_added',
          params: { supplier: inv.supplierName || t('invoices_unknown_supplier') },
          time: dateToFormat ? formatDateFns(dateToFormat, 'PPp', { locale: localeToUse }) : t('home_unknown_date'),
          link: `/invoices?tab=scanned-docs&viewInvoiceId=${inv.id}`
        };
      });


      setKpiData({
        totalItems,
        inventoryValue,
        lowStockItemsCount,
        criticalLowStockProducts,
        nextPaymentDueInvoice,
        recentActivity: mockRecentActivity,
        latestDocName: invoices.length > 0 && invoices[0].fileName ? invoices[0].fileName : undefined,
        grossProfit,
        amountRemainingToPay,
        currentMonthTotalExpenses: calculatedCurrentMonthTotalExpenses,
        documentsProcessed30d,
        averageInvoiceValue: averageInvoiceValueData,
        suppliersCount: suppliersCountData,
      });
      console.log("[HomePage] KPIs processed. CurrentMonthExpenses:", calculatedCurrentMonthTotalExpenses);

    } catch (error: any) {
      console.error("[HomePage] Failed to fetch KPI data:", error);
      const translatedError = t('home_kpi_toast_error_load_failed_desc');
      const finalErrorMessage = (translatedError === 'home_kpi_toast_error_load_failed_desc' ? "Failed to load dashboard data." : translatedError) + (error.message ? ` (${error.message})` : '');
      setKpiError(finalErrorMessage);
      toast({
        title: t('error_title'),
        description: finalErrorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoadingKpis(false);
    }
  }, [user, authLoading, t, toast, locale]); // Added locale to dependencies

  useEffect(() => {
    if (user && user.id) {
      fetchKpiData();
    } else if (!authLoading && !user) {
      setIsLoadingKpis(false); // Ensure loading stops for guests
    }
  }, [user, authLoading, fetchKpiData]);


  const handleScanClick = () => {
    router.push('/upload');
  };

  const renderKpiValueDisplay = (valueString: string) => {
    if (isLoadingKpis && user) {
      return <Skeleton className="h-7 w-1/2 mt-1" />;
    }
    if (kpiError && user) return <span className="text-destructive text-lg">-</span>;
    return valueString;
  };


  const handleSaveKpiPreferences = (newPreferences: { visibleKpiIds: string[], kpiOrder: string[] }) => {
    if (user && user.id) { // Ensure user.id is available
        saveKpiPreferences(newPreferences, user.id);
        setUserKpiPreferences(newPreferences);
        toast({ title: t('home_kpi_prefs_saved_title'), description: t('home_kpi_prefs_saved_desc')});
    }
  };

  const handleSaveQuickActionPreferences = (newPreferences: { visibleQuickActionIds: string[], quickActionOrder: string[] }) => {
    if (user && user.id) { // Ensure user.id is available
      saveQuickActionPreferences(newPreferences, user.id);
      setUserQuickActionPreferences(newPreferences);
      toast({ title: t('home_qa_prefs_saved_title'), description: t('home_qa_prefs_saved_desc')});
    }
  };

  const handleCreateSupplier = async (name: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }) => {
    if (!user || !user.id) return;
    try {
      await createSupplierService(name, contactInfo, user.id);
      toast({ title: t('suppliers_toast_created_title'), description: t('suppliers_toast_created_desc', { supplierName: name }) });
      setIsCreateSupplierSheetOpen(false);
      fetchKpiData(); // Refetch KPIs to update supplier count
    } catch (error: any) {
      console.error("Failed to create supplier from home page:", error);
      toast({ title: t('suppliers_toast_create_fail_title'), description: t('suppliers_toast_create_fail_desc', { message: error.message }), variant: "destructive" });
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
    <div className={cn("flex flex-col items-center min-h-[calc(100vh-var(--header-height,4rem)-env(safe-area-inset-bottom))] p-4 sm:p-6 md:p-8", styles.homeContainerGradient)}>
      <TooltipProvider>
        <div className="w-full max-w-5xl">
           <div className="text-center mb-6 md:mb-10">
             <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-primary scale-fade-in">
               {t('home_welcome_title')}
             </h1>
             <p className="text-lg sm:text-xl text-muted-foreground mt-2 scale-fade-in delay-100">
               {t('home_greeting', { username: user?.username || t('user_fallback_name') })}
             </p>
              <p className="text-sm text-muted-foreground mt-1 scale-fade-in delay-200">
                {t('home_sub_greeting')}
              </p>
           </div>

           <div className="mb-6 md:mb-8 flex flex-col items-center gap-3 scale-fade-in delay-200">
              <Button
                size="lg"
                className="w-full max-w-xs sm:max-w-sm bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base sm:text-lg transform hover:-translate-y-1 py-3 sm:py-4"
                onClick={handleScanClick}
              >
                <ScanLine className="mr-2 h-5 w-5" /> {t('home_scan_button')}
              </Button>
               <div className="flex gap-3">
                 <Button variant="secondary" asChild className="hover:bg-secondary/80 transform hover:scale-[1.02] transition-all py-3 sm:py-4 text-xs sm:text-sm h-auto">
                    <Link href="/inventory">
                        <Package className="mr-1.5 h-4 w-4 sm:mr-2 sm:h-5 sm:w-5" /> {t('nav_inventory')}
                    </Link>
                 </Button>
                 <Button variant="secondary" asChild className="hover:bg-secondary/80 transform hover:scale-[1.02] transition-all py-3 sm:py-4 text-xs sm:text-sm h-auto">
                    <Link href="/invoices">
                        <FileTextIcon className="mr-1.5 h-4 w-4 sm:mr-2 sm:h-5 sm:w-5" /> {t('nav_documents')}
                    </Link>
                 </Button>
               </div>
          </div>

          {/* Quick Actions Section */}
           <div className="mb-6 md:mb-8 text-left">
            <div className="flex justify-between items-center mb-3 px-1 sm:px-0">
                <h2 className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                    <PlusCircle className="mr-2 h-5 w-5" /> {t('home_quick_actions_title')}
                </h2>
                <Button variant="ghost" size="icon" onClick={() => setIsCustomizeQuickActionsSheetOpen(true)} className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <SettingsIcon className="h-4 w-4" />
                    <span className="sr-only">{t('home_customize_qa_button')}</span>
                </Button>
            </div>
            <div className={cn("grid grid-cols-2 sm:grid-cols-3 gap-3 pt-0 bg-card/80 backdrop-blur-sm border border-border/50 shadow-lg rounded-lg p-3 sm:p-4", styles.kpiCard)}>
                    {visibleQuickActions.map((action, index) => {
                        const ActionIcon = action.icon;
                        const buttonContent = (
                             <>
                                <ActionIcon className="mr-1.5 h-4 w-4 sm:h-5 sm:w-5" />
                                <span className="text-xs sm:text-sm">{t(action.titleKey)}</span>
                             </>
                        );
                        return (
                            <Tooltip key={action.id}>
                                <TooltipTrigger asChild>
                                     {action.link ? (
                                        <Button variant="outline" asChild className="h-auto py-2.5 sm:py-3 flex-col sm:flex-row items-center justify-center hover:bg-accent/10 hover:border-accent transform hover:scale-[1.02] transition-all scale-fade-in" style={{animationDelay: `${0.05 * index}s`}}>
                                            <Link href={action.link} className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 text-center sm:text-left">
                                                {buttonContent}
                                            </Link>
                                        </Button>
                                     ) : action.onClick ? (
                                        <Button variant="outline" onClick={action.onClick} className="h-auto py-2.5 sm:py-3 flex-col sm:flex-row items-center justify-center hover:bg-accent/10 hover:border-accent transform hover:scale-[1.02] transition-all scale-fade-in" style={{animationDelay: `${0.05 * index}s`}}>
                                             {buttonContent}
                                        </Button>
                                     ) : null}
                                </TooltipTrigger>
                                {action.descriptionKey && <TooltipContent><p>{t(action.descriptionKey)}</p></TooltipContent>}
                            </Tooltip>
                        );
                    })}
                    {(isLoadingKpis && user && visibleQuickActions.length === 0) && Array.from({length: 3}).map((_, idx) => <Skeleton key={`qa-skeleton-${idx}`} className="h-12 sm:h-14 w-full rounded-md bg-muted/50" />)}
                    {(!isLoadingKpis || !user) && visibleQuickActions.length === 0 && (
                        <div className="col-span-full text-center py-4 text-muted-foreground">
                            <p className="text-sm">{t('home_no_quick_actions_selected')}</p>
                            <Button variant="link" onClick={() => setIsCustomizeQuickActionsSheetOpen(true)} className="text-sm text-primary">{t('home_no_quick_actions_action')}</Button>
                        </div>
                    )}
            </div>
          </div>

         {/* Quick Overview (KPIs) Section */}
          <div className="mb-6 md:mb-8 text-left">
            <div className="flex justify-between items-center mb-3 px-1 sm:px-0">
                <h2 className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                    <ListChecks className="mr-2 h-5 w-5" /> {t('home_quick_overview_title')}
                </h2>
                 <Button variant="ghost" size="icon" onClick={() => setIsCustomizeKpiSheetOpen(true)} className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <SettingsIcon className="h-4 w-4" />
                    <span className="sr-only">{t('home_customize_dashboard_button')}</span>
                </Button>
            </div>
            <p className="text-sm text-muted-foreground mb-4 px-1 sm:px-0 text-center">{t('home_quick_overview_desc')}</p>

            {kpiError && !isLoadingKpis && user && (
            <Alert variant="destructive" className="mb-4 text-left">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{kpiError}</AlertDescription>
            </Alert>
            )}
             <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {(isLoadingKpis && user) ? (
                    Array.from({length: Math.min(visibleKpiConfigs.length || 4, 6)}).map((_, idx) => (
                         <div key={`skeleton-${idx}`} className="bg-card/80 backdrop-blur-sm border border-border/50 shadow-lg rounded-lg p-3 sm:p-4 h-[150px] sm:h-[160px]">
                             <div className="pb-1 pt-0 px-0"><Skeleton className="h-4 w-2/3"/></div>
                             <div className="pt-1 pb-0 px-0"><Skeleton className="h-8 w-1/2 mb-1"/><Skeleton className="h-3 w-3/4"/></div>
                         </div>
                    ))
                ) : !kpiError && (!kpiData || visibleKpiConfigs.length === 0) ? (
                    <div className="col-span-full text-center py-8 bg-card/80 backdrop-blur-sm border border-border/50 shadow-lg rounded-lg p-4">
                        <SettingsIcon className="mx-auto h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">{t('home_no_kpis_selected_title')}</p>
                        <Button variant="link" onClick={() => setIsCustomizeKpiSheetOpen(true)} className="text-sm text-primary">{t('home_no_kpis_selected_action')}</Button>
                    </div>
                ) : (
                    visibleKpiConfigs.map((kpi, index) => {
                        const Icon = kpi.icon;
                        const valueString = kpi.getValue ? kpi.getValue(kpiData, t) : '-';
                        const progress = kpi.showProgress && kpi.progressValue && kpiData ? kpi.progressValue(kpiData) : 0;
                        return (
                        <div key={kpi.id} className={cn("bg-card/80 backdrop-blur-sm border border-border/50 shadow-lg rounded-lg flex flex-col text-left transform transition-all duration-300 ease-in-out hover:scale-[1.02] hover:-translate-y-0.5", styles.kpiCard, "scale-fade-in p-3 sm:p-4")} style={{animationDelay: `${0.05 * index}s`}}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Link href={kpi.link || "#"} className={cn("block hover:no-underline h-full flex flex-col", !kpi.link && "pointer-events-none")}>
                                        <div className="flex flex-row items-center justify-between space-y-0 pb-1">
                                            <h3 className="text-xs sm:text-sm font-semibold text-muted-foreground">{t(kpi.titleKey)}</h3>
                                            <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", kpi.iconColor || "text-primary")} />
                                        </div>
                                        <div className="pt-1 flex-grow flex flex-col justify-center">
                                            <div className="text-xl sm:text-2xl md:text-3xl font-extrabold text-foreground flex items-baseline">
                                                {renderKpiValueDisplay(valueString)}
                                            </div>
                                            {kpi.descriptionKey && <p className="text-[10px] sm:text-xs text-muted-foreground pt-0.5 sm:pt-1 h-7 sm:h-auto overflow-hidden text-ellipsis">{t(kpi.descriptionKey)}</p>}

                                            {kpi.showProgress && kpiData && (
                                                <Progress
                                                    value={progress}
                                                    className="h-1.5 sm:h-2 mt-1.5 sm:mt-2 bg-muted/40"
                                                    indicatorClassName={cn(
                                                        "transition-all duration-500 ease-out",
                                                        progress > 75 ? "bg-destructive" :
                                                        progress > 50 ? "bg-yellow-500" :
                                                        "bg-primary"
                                                    )}
                                                />
                                            )}
                                        </div>
                                    </Link>
                                </TooltipTrigger>
                                {kpi.descriptionKey && <TooltipContent><p>{t(kpi.descriptionKey)}</p></TooltipContent>}
                            </Tooltip>
                        </div>
                        );
                    })
                )}
            </div>
        </div>

        {/* Actionable Insights & Recent Activity Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-8 md:mb-12 text-left">
            <Card className={cn("scale-fade-in delay-500 bg-card/80 backdrop-blur-sm border-border/50 shadow-lg", styles.kpiCard)}>
                <CardHeader className="pb-3">
                <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                    <Info className="mr-2 h-5 w-5" /> {t('home_actionable_insights_title')}
                </CardTitle>
                 <CardDescription>{t('home_actionable_insights_desc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm pt-0">
                    <div>
                        <h3 className="text-base font-semibold text-foreground flex items-center">
                            <AlertTriangle className="mr-2 h-4 w-4 text-destructive" />
                            {t('home_critical_low_stock_title')}
                        </h3>
                        {isLoadingKpis ? <Skeleton className="h-5 w-2/3 my-2 rounded-md bg-muted/50" /> :
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
                        {isLoadingKpis ? <Skeleton className="h-5 w-3/4 my-2 rounded-md bg-muted/50" /> :
                        kpiData?.nextPaymentDueInvoice ? (
                            <p className="text-muted-foreground mt-1">
                                <Link href={`/invoices?tab=scanned-docs&viewInvoiceId=${kpiData.nextPaymentDueInvoice.id}`} className="hover:underline text-primary">
                                    {kpiData.nextPaymentDueInvoice.supplierName || t('invoices_unknown_supplier')} - {formatLargeNumber(kpiData.nextPaymentDueInvoice.totalAmount, t, 0, true)}
                                </Link>
                                {' '}{t('home_due_on_label')} {kpiData.nextPaymentDueInvoice.paymentDueDate ? formatDateFns(kpiData.nextPaymentDueInvoice.paymentDueDate instanceof Timestamp ? kpiData.nextPaymentDueInvoice.paymentDueDate.toDate() : parseISO(kpiData.nextPaymentDueInvoice.paymentDueDate as string), 'PP', { locale: t('locale_code_for_date_fns') === 'he' ? heLocale : enUSLocale }) : t('home_unknown_date')}
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

            <Card className={cn("scale-fade-in delay-600 bg-card/80 backdrop-blur-sm border-border/50 shadow-lg", styles.kpiCard)}>
                <CardHeader className="pb-3">
                <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                    <History className="mr-2 h-5 w-5" /> {t('home_recent_activity_title')}
                </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    {isLoadingKpis ?
                        <div className="space-y-2">
                            <Skeleton className="h-5 w-full rounded-md bg-muted/50" />
                            <Skeleton className="h-5 w-5/6 rounded-md bg-muted/50" />
                            <Skeleton className="h-5 w-3/4 rounded-md bg-muted/50" />
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
        </div>
      </TooltipProvider>
      <KpiCustomizationSheet
        isOpen={isCustomizeKpiSheetOpen}
        onOpenChange={setIsCustomizeKpiSheetOpen}
        items={allKpiConfigurations}
        currentVisibleItemIds={userKpiPreferences.visibleKpiIds}
        currentItemOrder={userKpiPreferences.kpiOrder}
        onSavePreferences={handleSaveKpiPreferences}
        sheetTitleKey="home_kpi_customize_sheet_title"
        sheetDescriptionKey="home_kpi_customize_sheet_desc_reorder"
      />
      <KpiCustomizationSheet
        isOpen={isCustomizeQuickActionsSheetOpen}
        onOpenChange={setIsCustomizeQuickActionsSheetOpen}
        items={allQuickActionConfigurations}
        currentVisibleItemIds={userQuickActionPreferences.visibleQuickActionIds}
        currentItemOrder={userQuickActionPreferences.quickActionOrder}
        onSavePreferences={handleSaveQuickActionPreferences}
        sheetTitleKey="home_qa_customize_sheet_title"
        sheetDescriptionKey="home_qa_customize_sheet_desc"
      />
       <CreateSupplierSheet
        isOpen={isCreateSupplierSheetOpen}
        onOpenChange={setIsCreateSupplierSheetOpen}
        onCreateSupplier={handleCreateSupplier}
      />
    </div>
  );
}

