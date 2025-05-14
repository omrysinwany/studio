
// src/app/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/context/AuthContext";
import { Package, FileText as FileTextIcon, BarChart2, ScanLine, Loader2, TrendingUp, TrendingDown, DollarSign, HandCoins, ShoppingCart, CreditCard, Banknote, Settings as SettingsIcon, Briefcase, AlertTriangle, BellRing, History, PlusCircle, PackagePlus, Info, ListChecks, FileWarning, UserPlus } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getProductsService, InvoiceHistoryItem, getInvoicesService, getStorageKey, SupplierSummary, getSupplierSummariesService, Product as BackendProduct, OtherExpense, OTHER_EXPENSES_STORAGE_KEY_BASE, UserSettings, getUserSettingsService, MONTHLY_BUDGET_STORAGE_KEY_BASE, createSupplierService } from '@/services/backend';
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
import { isValid, parseISO, startOfMonth, endOfMonth, isSameMonth, subDays, format as formatDateFns } from 'date-fns';
import { he as heLocale, enUS as enUSLocale } from 'date-fns/locale';
import { useTranslation } from '@/hooks/useTranslation';
import KpiCustomizationSheet from '@/components/KpiCustomizationSheet';
import styles from "./page.module.scss"; // Assuming this is for the gradient background
import { Skeleton } from "@/components/ui/skeleton";
import CreateSupplierSheet from '@/components/create-supplier-sheet';


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
  inventoryValueTrend?: { name: string; value: number }[];
  inventoryValuePrevious?: number;
  grossProfit: number;
  amountRemainingToPay: number;
  currentMonthTotalExpenses?: number;
  documentsProcessed30d?: number;
  averageInvoiceValue?: number;
  suppliersCount?: number;
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
    const localeCode = t('locale_code_for_number_formatting') as string | undefined;

    if (absNum < 10000 || (isInteger && absNum < 1000)) {
        return prefix + num.toLocaleString(localeCode || undefined, {
            minimumFractionDigits: isCurrency ? 2 : (isInteger ? 0 : decimals),
            maximumFractionDigits: isCurrency ? 2 : (isInteger ? 0 : decimals)
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
    showTrend: true,
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


const SparkLineChart = ({ data, dataKey, strokeColor }: { data: any[], dataKey: string, strokeColor: string }) => {
  const { t } = useTranslation();
  if (!data || data.length === 0) {
    return <div className="h-10 w-full bg-muted/50 rounded-md flex items-center justify-center text-xs text-muted-foreground">{t('home_kpi_no_trend_data')}</div>;
  }
  const localeCode = t('locale_code_for_number_formatting') as string | undefined;
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
             if (name === 'value') return [`${t('currency_symbol')}${value.toLocaleString(localeCode || undefined, {minimumFractionDigits:0, maximumFractionDigits: 0})}`, t('reports_chart_label_value')];
             return [value.toLocaleString(localeCode || undefined), name];
          }}
          labelFormatter={() => ''}
        />
        <XAxis dataKey="name" hide />
        <YAxis domain={['dataMin - 100', 'dataMax + 100']} hide />
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
  const { t, locale } = useTranslation();

  const [kpiData, setKpiData] = useState<KpiData | null>(null);
  const [isLoadingKpis, setIsLoadingKpis] = useState(true);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [isCreateSupplierSheetOpen, setIsCreateSupplierSheetOpen] = useState(false);

  const [userKpiPreferences, setUserKpiPreferences] = useState<{ visibleKpiIds: string[], kpiOrder: string[] }>(
    { visibleKpiIds: [], kpiOrder: [] }
  );
   const allQuickActionConfigurations: ItemConfig[] = useMemo(() => [
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
      defaultVisible: false,
    },
  ], [t]); // Re-memoize if t changes (language change)


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
    if (user) {
      setUserKpiPreferences(getKpiPreferences(user.id));
      setUserQuickActionPreferences(getQuickActionPreferences(user.id, allQuickActionConfigurations));
    } else if (!authLoading) {
        setUserKpiPreferences(getKpiPreferences());
        setUserQuickActionPreferences(getQuickActionPreferences(undefined, allQuickActionConfigurations));
    }
  }, [user, authLoading, allQuickActionConfigurations]);


  const fetchKpiData = useCallback(async () => {
    if (!user || authLoading) return;

    setIsLoadingKpis(true);
    setKpiError(null);
    try {
      const [products, invoicesData, suppliers, userSettings] = await Promise.all([
        getProductsService(user.id),
        getInvoicesService(user.id),
        getSupplierSummariesService(user.id),
        getUserSettingsService(user.id)
      ]);

      const invoices = invoicesData.map(inv => ({
        ...inv,
        uploadTime: inv.uploadTime
      }));

      const otherExpensesStorageKey = getStorageKey(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id);
      const storedOtherExpenses = typeof window !== 'undefined' ? localStorage.getItem(otherExpensesStorageKey) : null;
      const otherExpensesData: OtherExpense[] = storedOtherExpenses ? JSON.parse(storedOtherExpenses) : [];

      const totalItems = calculateTotalItems(products);
      const inventoryValue = calculateInventoryValue(products);

      const allLowStockItems = getLowStockItems(products);
      const lowStockItemsCount = allLowStockItems.length;
      const criticalLowStockProducts = allLowStockItems
        .sort((a,b) => (a.quantity ?? 0) - (b.quantity ?? 0) || (a.shortName || a.description || '').localeCompare(b.shortName || b.description || '') )
        .slice(0,2);

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
          if (invoice.status !== 'completed') return;
          let relevantDateForExpense: Date | null = null;

          if (invoice.paymentDueDate && isValid(parseISO(invoice.paymentDueDate as string))) {
            const paymentDate = parseISO(invoice.paymentDueDate as string);
            if (paymentDate >= currentMonthStart && paymentDate <= currentMonthEnd) {
                relevantDateForExpense = paymentDate;
            }
          }
          if (!relevantDateForExpense && invoice.uploadTime && isValid(parseISO(invoice.uploadTime as string))) {
              const uploadDate = parseISO(invoice.uploadTime as string);
               if (uploadDate >= currentMonthStart && uploadDate <= currentMonthEnd) {
                  relevantDateForExpense = uploadDate;
              }
          }

          if (relevantDateForExpense && (invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'pending_payment' || invoice.paymentStatus === 'paid')) {
             totalExpensesFromInvoices += (invoice.totalAmount || 0);
          }
      });

      const totalOtherExpensesForMonth = otherExpensesData.reduce((sum, exp) => {
          if (!exp.date || !isValid(parseISO(exp.date))) return sum;
          try {
              const expenseDate = parseISO(exp.date);
              if (isSameMonth(expenseDate, new Date())) {
                  let amountToAdd = exp.amount;
                  const internalKey = exp._internalCategoryKey?.toLowerCase();
                  const categoryString = exp.category?.toLowerCase();
                  const biMonthlyKeys = ['electricity', 'water', 'property_tax', 'rent',
                                         t('accounts_other_expenses_tab_electricity').toLowerCase(),
                                         t('accounts_other_expenses_tab_water').toLowerCase(),
                                         t('accounts_other_expenses_tab_property_tax').toLowerCase(),
                                         t('accounts_other_expenses_tab_rent').toLowerCase()];

                  if ((internalKey && biMonthlyKeys.includes(internalKey)) || (categoryString && !internalKey && biMonthlyKeys.includes(categoryString))){
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
      const thirtyDaysAgo = subDays(new Date(), 30);
      const documentsProcessed30d = invoices.filter(inv =>
          inv.status === 'completed' &&
          inv.uploadTime &&
          parseISO(inv.uploadTime as string) >= thirtyDaysAgo
      ).length;
      const completedInvoices = invoices.filter(inv => inv.status === 'completed' && inv.totalAmount !== undefined);
      const totalInvoiceValue = completedInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
      const averageInvoiceValue = completedInvoices.length > 0 ? totalInvoiceValue / completedInvoices.length : 0;
      const suppliersCount = suppliers.length;

      const mockInventoryValueTrend = [
        { name: 'Day 1', value: inventoryValue * 0.95 + Math.random() * 1000 - 500 },
        { name: 'Day 2', value: inventoryValue * 0.98 + Math.random() * 1000 - 500 },
        { name: 'Day 3', value: inventoryValue * 0.96 + Math.random() * 1000 - 500 },
        { name: 'Day 4', value: inventoryValue * 1.02 + Math.random() * 1000 - 500 },
        { name: 'Day 5', value: inventoryValue + Math.random() * 1000 - 500 },
      ].map(d => ({...d, value: Math.max(0, Math.round(d.value))}));

      const recentInvoices = invoices.sort((a,b) => new Date(b.uploadTime as string).getTime() - new Date(a.uploadTime as string).getTime()).slice(0,3);
      const mockRecentActivity = recentInvoices.map(inv => ({
        descriptionKey: 'home_recent_activity_mock_invoice_added',
        params: { supplier: inv.supplier || t('invoices_unknown_supplier') },
        time: formatDateFns(parseISO(inv.uploadTime as string), 'PPp', { locale: t('locale_code_for_date_fns') === 'he' ? heLocale : enUSLocale }),
        link: `/invoices?tab=scanned-docs&viewInvoiceId=${inv.id}`
      }));


      setKpiData({
        totalItems,
        inventoryValue,
        lowStockItemsCount,
        criticalLowStockProducts,
        nextPaymentDueInvoice,
        recentActivity: mockRecentActivity,
        latestDocName: invoices.length > 0 ? invoices[0].fileName : undefined,
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
  }, [user, authLoading, t, toast, locale, allQuickActionConfigurations]);

  useEffect(() => {
    if (user) {
      fetchKpiData();
    } else if (!authLoading) {
      setIsLoadingKpis(false);
    }
  }, [user, authLoading, fetchKpiData]);


  const handleScanClick = () => {
    router.push('/upload');
  };

  const renderKpiValueDisplay = (valueString: string) => {
    if (isLoadingKpis && user) {
      return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
    }
    if (kpiError && user) return <span className="text-destructive text-lg">-</span>;
    return valueString;
  };


  const handleSaveKpiPreferences = (newPreferences: { visibleKpiIds: string[], kpiOrder: string[] }) => {
    if (user) {
        saveKpiPreferences(newPreferences, user.id);
        setUserKpiPreferences(newPreferences);
        toast({ title: t('home_kpi_prefs_saved_title'), description: t('home_kpi_prefs_saved_desc')});
    }
  };

  const handleSaveQuickActionPreferences = (newPreferences: { visibleQuickActionIds: string[], quickActionOrder: string[] }) => {
    if (user) {
      saveQuickActionPreferences(newPreferences, user.id);
      setUserQuickActionPreferences(newPreferences);
      toast({ title: t('home_qa_prefs_saved_title'), description: t('home_qa_prefs_saved_desc')});
    }
  };

  const handleCreateSupplier = async (name: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }) => {
    if (!user) return;
    try {
      await createSupplierService(name, contactInfo, user.id);
      toast({ title: t('suppliers_toast_created_title'), description: t('suppliers_toast_created_desc', { supplierName: name }) });
      setIsCreateSupplierSheetOpen(false);
      fetchKpiData(); // Re-fetch KPIs which might include supplier count
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
    <div className={cn("flex flex-col items-start min-h-[calc(100vh-var(--header-height,4rem))] p-4 sm:p-6 md:p-8", styles.homeContainerGradient)}>
      <TooltipProvider>
        <div className="w-full max-w-5xl text-left">
           <p className="text-base sm:text-lg text-muted-foreground mb-2 scale-fade-in delay-100">
             {t('home_greeting', { username: user?.username || t('user_fallback_name') })}
           </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6 md:mb-8 text-primary scale-fade-in">
             {t('home_welcome_title')}
          </h1>

          <div className="mb-6 md:mb-10 scale-fade-in delay-200 flex flex-col items-center gap-3">
              <Button
                size="lg"
                className="w-full max-w-md bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-lg transform hover:-translate-y-1 py-3 sm:py-4"
                onClick={handleScanClick}
              >
                <ScanLine className="mr-2 h-5 w-5" /> {t('home_scan_button')}
              </Button>
              <div className="w-full max-w-md grid grid-cols-2 gap-3">
                  <Button variant="outline" asChild className="hover:bg-accent/10 hover:border-accent transform hover:scale-[1.02] transition-all py-3 sm:py-4 text-sm sm:text-base h-auto">
                      <Link href="/inventory">
                          <Package className="mr-1.5 h-4 w-4 sm:mr-2 sm:h-5 sm:w-5" /> {t('nav_inventory')}
                      </Link>
                  </Button>
                   <Button variant="outline" asChild className="hover:bg-accent/10 hover:border-accent transform hover:scale-[1.02] transition-all py-3 sm:py-4 text-sm sm:text-base h-auto">
                      <Link href="/invoices">
                          <FileTextIcon className="mr-1.5 h-4 w-4 sm:mr-2 sm:h-5 sm:w-5" /> {t('nav_documents')}
                      </Link>
                  </Button>
              </div>
          </div>

          <div className="mb-6 md:mb-8 scale-fade-in delay-300">
            <div className="flex justify-between items-center mb-3 px-1 sm:px-0">
                <h2 className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                    <PlusCircle className="mr-2 h-5 w-5" /> {t('home_quick_actions_title')}
                </h2>
                <Button variant="ghost" size="icon" onClick={() => setIsCustomizeQuickActionsSheetOpen(true)} className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <SettingsIcon className="h-4 w-4" />
                    <span className="sr-only">{t('home_customize_qa_button')}</span>
                </Button>
            </div>
             <Card className="bg-card/80 backdrop-blur-sm border-border/50 shadow-lg">
                <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4">
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
                                        <Button variant="outline" asChild className="h-auto py-2.5 sm:py-3 flex-col sm:flex-row items-center justify-center hover:bg-accent/10 hover:border-accent transform hover:scale-[1.02] transition-all" style={{animationDelay: `${0.05 * index}s`}}>
                                            <Link href={action.link} className="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5 text-center sm:text-left">
                                                {buttonContent}
                                            </Link>
                                        </Button>
                                     ) : action.onClick ? (
                                        <Button variant="outline" onClick={action.onClick} className="h-auto py-2.5 sm:py-3 flex-col sm:flex-row items-center justify-center hover:bg-accent/10 hover:border-accent transform hover:scale-[1.02] transition-all" style={{animationDelay: `${0.05 * index}s`}}>
                                             {buttonContent}
                                        </Button>
                                     ) : null}
                                </TooltipTrigger>
                                {action.descriptionKey && <TooltipContent><p>{t(action.descriptionKey)}</p></TooltipContent>}
                            </Tooltip>
                        );
                    })}
                    {(isLoadingKpis && user && visibleQuickActions.length === 0) && Array.from({length: 3}).map((_, idx) => <Skeleton key={`qa-skeleton-${idx}`} className="h-12 sm:h-14 w-full rounded-md" />)}
                    {(!isLoadingKpis || !user) && visibleQuickActions.length === 0 && (
                        <div className="col-span-full text-center py-4 text-muted-foreground">
                            <p className="text-sm">{t('home_no_quick_actions_selected')}</p>
                            <Button variant="link" onClick={() => setIsCustomizeQuickActionsSheetOpen(true)} className="text-sm text-primary">{t('home_no_quick_actions_action')}</Button>
                        </div>
                    )}
                </CardContent>
            </Card>
          </div>

          <div className="mb-6 md:mb-8 scale-fade-in delay-400">
            <div className="flex justify-between items-center mb-4 px-1 sm:px-0">
                <h2 className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                    <ListChecks className="mr-2 h-5 w-5" /> {t('home_quick_overview_title')}
                </h2>
                <Button variant="ghost" size="icon" onClick={() => setIsCustomizeKpiSheetOpen(true)} className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <SettingsIcon className="h-4 w-4" />
                    <span className="sr-only">{t('home_customize_dashboard_button')}</span>
                </Button>
            </div>
            <p className="text-sm text-muted-foreground mb-6 px-1 sm:px-0">{t('home_quick_overview_desc')}</p>

            {kpiError && !isLoadingKpis && user && (
            <Alert variant="destructive" className="mb-4 text-left">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{kpiError}</AlertDescription>
            </Alert>
            )}
            {(isLoadingKpis && user) ? (
                <div className="grid grid-cols-2 gap-4">
                {Array.from({length: Math.min(visibleKpiConfigs.length || 4, 6)}).map((_, idx) => (
                    <Card key={`skeleton-${idx}`} className="shadow-md bg-card/80 backdrop-blur-sm border-border/50 h-[150px] sm:h-[160px]">
                        <CardHeader className="pb-1 pt-3 px-3 sm:px-4"><Skeleton className="h-4 w-2/3 rounded-md"/></CardHeader>
                        <CardContent className="pt-1 pb-2 px-3 sm:px-4"><Skeleton className="h-8 w-1/2 mb-1 rounded-md"/><Skeleton className="h-3 w-3/4 rounded-md"/></CardContent>
                    </Card>
                ))}
                </div>
            ) : !kpiError && (!kpiData || visibleKpiConfigs.length === 0) ? (
                <div className="text-center py-8 text-muted-foreground">
                <SettingsIcon className="mx-auto h-12 w-12 mb-2 opacity-50" />
                <p className="text-sm">{t('home_no_kpis_selected_title')}</p>
                <Button variant="link" onClick={() => setIsCustomizeKpiSheetOpen(true)} className="text-sm text-primary">{t('home_no_kpis_selected_action')}</Button>
            </div>
            ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {visibleKpiConfigs.map((kpi, index) => {
                    const Icon = kpi.icon;
                    const valueString = kpi.getValue ? kpi.getValue(kpiData, t) : '-';
                    const progress = kpi.showProgress && kpi.progressValue && kpiData ? kpi.progressValue(kpiData) : 0;
                    return (
                    <Tooltip key={kpi.id}>
                        <TooltipTrigger asChild>
                        <Link href={kpi.link || "#"} className={cn("block hover:no-underline h-full", !kpi.link && "pointer-events-none")}>
                            <div className={cn("shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-[1.02] h-full text-left transform hover:-translate-y-0.5 bg-card/80 backdrop-blur-sm border border-border/50 rounded-lg p-3 sm:p-4 flex flex-col", styles.kpiCard, "kpiCard")} style={{animationDelay: `${0.05 * index}s`}}>
                            <div className="flex flex-row items-center justify-between space-y-0 pb-1">
                                <h3 className="text-sm sm:text-base font-semibold text-muted-foreground">{t(kpi.titleKey)}</h3>
                                <Icon className={cn("h-5 w-5 sm:h-6 sm:w-6", kpi.iconColor || "text-primary")} />
                            </div>
                            <div className="pt-1 flex-grow flex flex-col justify-center">
                                <div className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-foreground flex items-baseline">
                                    {renderKpiValueDisplay(valueString)}
                                    {kpi.id === 'inventoryValue' && kpiData && kpiData.inventoryValueTrend && kpiData.inventoryValueTrend.length > 1 && kpiData.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && (
                                        kpiData.inventoryValue > kpiData.inventoryValuePrevious ?
                                        <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-500 ml-1.5 shrink-0" /> :
                                        <TrendingDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-red-500 ml-1.5 shrink-0" />
                                    )}
                                </div>
                                {kpi.descriptionKey && <p className="text-xs sm:text-sm text-muted-foreground pt-0.5 sm:pt-1 h-8 sm:h-auto overflow-hidden text-ellipsis">{t(kpi.descriptionKey)}</p>}
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
                            </div>
                            {kpi.id === 'inventoryValue' && kpiData?.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && kpiData.inventoryValue !== undefined && (
                                <div className="text-xs sm:text-sm mt-auto pt-1">
                                    <p className={cn("text-muted-foreground", kpiData.inventoryValue > kpiData.inventoryValuePrevious ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                                        {t('home_kpi_vs_last_period_prefix')} {formatLargeNumber(kpiData.inventoryValuePrevious, t, 0, true)}
                                    </p>
                                </div>
                            )}
                            </div>
                        </Link>
                        </TooltipTrigger>
                        {kpi.descriptionKey && <TooltipContent><p>{t(kpi.titleKey)}: {valueString}</p><p className="text-xs">{t(kpi.descriptionKey)}</p></TooltipContent>}
                    </Tooltip>
                    );
                })}
            </div>
            )}
            {(kpiData && visibleKpiConfigs.length === 0 && !isLoadingKpis) && (
                <div className="text-center py-8 text-muted-foreground">
                    <SettingsIcon className="mx-auto h-12 w-12 mb-2 opacity-50" />
                    <p className="text-sm">{t('home_no_kpis_selected_title')}</p>
                    <Button variant="link" onClick={() => setIsCustomizeKpiSheetOpen(true)} className="text-sm text-primary">{t('home_no_kpis_selected_action')}</Button>
                </div>
            )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-8 md:mb-12">
            <Card className="scale-fade-in delay-500 bg-card/80 backdrop-blur-sm border-border/50 shadow-lg">
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
                        {isLoadingKpis ? <Skeleton className="h-5 w-2/3 my-2 rounded-md" /> :
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
                        {isLoadingKpis ? <Skeleton className="h-5 w-3/4 my-2 rounded-md" /> :
                        kpiData?.nextPaymentDueInvoice ? (
                            <p className="text-muted-foreground mt-1">
                                <Link href={`/invoices?tab=scanned-docs&viewInvoiceId=${kpiData.nextPaymentDueInvoice.id}`} className="hover:underline text-primary">
                                    {kpiData.nextPaymentDueInvoice.supplier || t('invoices_unknown_supplier')} - {formatLargeNumber(kpiData.nextPaymentDueInvoice.totalAmount, t, 0, true)}
                                </Link>
                                {' '}{t('home_due_on_label')} {kpiData.nextPaymentDueInvoice.paymentDueDate ? formatDateFns(parseISO(kpiData.nextPaymentDueInvoice.paymentDueDate as string), 'PP', { locale: t('locale_code_for_date_fns') === 'he' ? heLocale : enUSLocale }) : t('home_unknown_date')}
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

            <Card className="scale-fade-in delay-600 bg-card/80 backdrop-blur-sm border-border/50 shadow-lg">
                <CardHeader className="pb-3">
                <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                    <History className="mr-2 h-5 w-5" /> {t('home_recent_activity_title')}
                </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    {isLoadingKpis ?
                        <div className="space-y-2">
                            <Skeleton className="h-5 w-full rounded-md" />
                            <Skeleton className="h-5 w-5/6 rounded-md" />
                            <Skeleton className="h-5 w-3/4 rounded-md" />
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
