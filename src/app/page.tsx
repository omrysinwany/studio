// src/app/page.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import {
  Package,
  FileText as FileTextIcon,
  BarChart2,
  ScanLine,
  Loader2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  HandCoins,
  ShoppingCart,
  CreditCard,
  Banknote,
  Settings as SettingsIcon,
  Briefcase,
  AlertTriangle,
  BellRing,
  History,
  PlusCircle,
  PackagePlus,
  Info,
  ListChecks,
  FileWarning,
  UserPlus,
  LayoutDashboard,
  Edit3,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  getProductsService,
  Invoice,
  getInvoicesService,
  Supplier,
  getSuppliersService,
  Product as BackendProduct,
  OtherExpense,
  UserSettings,
  getUserSettingsService,
  createSupplierService,
  getOtherExpensesService,
} from "@/services/backend";
import {
  calculateInventoryValue,
  calculateTotalItems,
  getLowStockItems,
  calculateTotalPotentialGrossProfit,
  calculateAverageOrderValue,
} from "@/lib/kpi-calculations";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import GuestHomePage from "@/components/GuestHomePage";
import {
  isValid,
  parseISO,
  startOfMonth,
  endOfMonth,
  isSameMonth,
  subDays,
  format as formatDateFns,
} from "date-fns";
import { Timestamp } from "firebase/firestore";
import { he as heLocale, enUS as enUSLocale } from "date-fns/locale";
import { useTranslation } from "@/hooks/useTranslation";
import KpiCustomizationSheet from "@/components/KpiCustomizationSheet";
import { Skeleton } from "@/components/ui/skeleton";
import CreateSupplierSheet from "@/components/create-supplier-sheet";
import { Progress } from "@/components/ui/progress";

const KPI_PREFERENCES_STORAGE_KEY_BASE = "invoTrack_kpiPreferences_v3";
const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE =
  "invoTrack_quickActionsPreferences_v2";

// Local implementation of getStorageKey as it was removed from backend services
const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    // console.warn("getStorageKey called without userId, using generic key for unauthenticated users.");
    return `${baseKey}_global_unauthenticated`; // Make it more specific for unauthenticated cases
  }
  return `${baseKey}_${userId}`;
};

interface KpiData {
  totalItems: number;
  inventoryValue: number;
  lowStockItemsCount: number;
  criticalLowStockProducts: BackendProduct[];
  nextPaymentDueInvoice: Invoice | null;
  recentActivity: {
    descriptionKey: string;
    params?: Record<string, string | number>;
    time: string;
    link?: string;
    icon?: React.ElementType;
  }[];
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
  getValue?: (
    data: KpiData | null,
    t: (key: string, params?: Record<string, string | number>) => string
  ) => string;
  descriptionKey?: string;
  link?: string;
  showTrend?: boolean;
  showProgress?: boolean;
  progressValue?: (data: KpiData | null) => number;
  iconColor?: string;
  defaultVisible?: boolean;
  onClick?: () => void;
  tagKey?: string;
  gradientFrom?: string;
  gradientTo?: string;
}

const formatLargeNumber = (
  num: number | undefined | null,
  t: (key: string, params?: Record<string, string | number>) => string,
  isCurrency = false,
  decimals = 0
): string => {
  if (num === undefined || num === null || isNaN(num)) {
    return isCurrency ? `${t("currency_symbol")}-` : "–";
  }

  const prefix = isCurrency ? `${t("currency_symbol")}` : "";
  const translationKeyForLocale = "locale_code_for_number_formatting";
  const localeCodeFromT = t(translationKeyForLocale);

  // Safeguard: If t() returns the key itself or an empty/falsy value,
  // it means the translation isn't ready. Fallback to undefined (system locale).
  const effectiveLocale =
    localeCodeFromT && localeCodeFromT !== translationKeyForLocale
      ? localeCodeFromT
      : undefined;

  const effectiveDecimals = isCurrency ? 0 : decimals;

  try {
    return (
      prefix +
      num.toLocaleString(effectiveLocale, {
        minimumFractionDigits: effectiveDecimals,
        maximumFractionDigits: effectiveDecimals,
      })
    );
  } catch (error) {
    console.warn(
      `Error in formatLargeNumber with locale '${effectiveLocale}':`,
      error
    );
    // Fallback to default locale if specific one fails for some other reason
    return (
      prefix +
      num.toLocaleString(undefined, {
        minimumFractionDigits: effectiveDecimals,
        maximumFractionDigits: effectiveDecimals,
      })
    );
  }
};

const allKpiConfigurations: ItemConfig[] = [
  {
    id: "totalItems",
    titleKey: "home_kpi_total_items_title",
    icon: Package,
    getValue: (data, t) => formatLargeNumber(data?.totalItems, t, false, 0),
    descriptionKey: "home_kpi_total_items_desc",
    link: "/inventory",
    iconColor: "text-blue-500",
    defaultVisible: true,
    tagKey: "home_kpi_tag_inventory",
    gradientFrom: "from-blue-500",
    gradientTo: "to-cyan-400",
  },
  {
    id: "inventoryValue",
    titleKey: "home_kpi_inventory_value_title",
    icon: DollarSign,
    getValue: (data, t) => formatLargeNumber(data?.inventoryValue, t, true, 0),
    descriptionKey: "home_kpi_inventory_value_desc",
    link: "/reports",
    iconColor: "text-green-500",
    defaultVisible: true,
    tagKey: "home_kpi_tag_finance",
    gradientFrom: "from-green-500",
    gradientTo: "to-emerald-400",
  },
  {
    id: "grossProfit",
    titleKey: "home_kpi_gross_profit_title",
    icon: HandCoins,
    getValue: (data, t) => formatLargeNumber(data?.grossProfit, t, true, 0),
    descriptionKey: "home_kpi_gross_profit_desc",
    link: "/reports",
    iconColor: "text-teal-500",
    defaultVisible: true,
    tagKey: "home_kpi_tag_profit",
    gradientFrom: "from-teal-500",
    gradientTo: "to-cyan-500",
  },
  {
    id: "currentMonthExpenses",
    titleKey: "home_kpi_current_month_expenses_title",
    icon: CreditCard,
    getValue: (data, t) =>
      formatLargeNumber(data?.currentMonthTotalExpenses, t, true, 0),
    descriptionKey: "home_kpi_current_month_expenses_desc",
    link: "/accounts",
    iconColor: "text-red-500",
    defaultVisible: true,
    tagKey: "home_kpi_tag_expenses",
    gradientFrom: "from-red-500",
    gradientTo: "to-rose-400",
  },
  {
    id: "lowStock",
    titleKey: "home_kpi_low_stock_title",
    icon: AlertTriangle,
    getValue: (data, t) =>
      formatLargeNumber(data?.lowStockItemsCount, t, false, 0),
    descriptionKey: "home_kpi_low_stock_desc",
    link: "/inventory?filter=low",
    showProgress: true,
    progressValue: (data) =>
      data && data.totalItems > 0 && data.lowStockItemsCount >= 0
        ? (data.lowStockItemsCount / data.totalItems) * 100
        : 0,
    iconColor: "text-yellow-500",
    defaultVisible: true,
    tagKey: "home_kpi_tag_alerts",
    gradientFrom: "from-yellow-500",
    gradientTo: "to-amber-400",
  },
  {
    id: "amountToPay",
    titleKey: "home_kpi_amount_to_pay_title",
    icon: Banknote,
    getValue: (data, t) =>
      formatLargeNumber(data?.amountRemainingToPay, t, true, 0),
    descriptionKey: "home_kpi_amount_to_pay_desc",
    link: "/invoices?tab=scanned-docs&filterPaymentStatus=unpaid",
    iconColor: "text-orange-500",
    defaultVisible: true,
    tagKey: "home_kpi_tag_payments",
    gradientFrom: "from-orange-500",
    gradientTo: "to-amber-500",
  },
  {
    id: "documentsProcessed30d",
    titleKey: "home_kpi_documents_processed_30d_title",
    icon: FileTextIcon,
    getValue: (data, t) =>
      formatLargeNumber(data?.documentsProcessed30d, t, false, 0),
    descriptionKey: "home_kpi_documents_processed_30d_desc",
    link: "/invoices",
    iconColor: "text-indigo-500",
    defaultVisible: false,
    tagKey: "home_kpi_tag_activity",
    gradientFrom: "from-indigo-500",
    gradientTo: "to-purple-500",
  },
  {
    id: "averageInvoiceValue",
    titleKey: "home_kpi_average_invoice_value_title",
    icon: BarChart2,
    getValue: (data, t) =>
      formatLargeNumber(data?.averageInvoiceValue, t, true, 0),
    descriptionKey: "home_kpi_average_invoice_value_desc",
    link: "/reports",
    iconColor: "text-purple-500",
    defaultVisible: false,
    tagKey: "home_kpi_tag_analytics",
    gradientFrom: "from-purple-500",
    gradientTo: "to-pink-500",
  },
  {
    id: "suppliersCount",
    titleKey: "home_kpi_suppliers_count_title",
    icon: Briefcase,
    getValue: (data, t) => formatLargeNumber(data?.suppliersCount, t, false, 0),
    descriptionKey: "home_kpi_suppliers_count_desc",
    link: "/suppliers",
    iconColor: "text-sky-500",
    defaultVisible: false,
    tagKey: "home_kpi_tag_management",
    gradientFrom: "from-sky-500",
    gradientTo: "to-blue-500",
  },
];

const getKpiPreferences = (
  userId?: string
): { visibleKpiIds: string[]; kpiOrder: string[] } => {
  if (typeof window === "undefined" || !userId) {
    const defaultVisible = allKpiConfigurations.filter(
      (kpi) => kpi.defaultVisible !== false
    );
    return {
      visibleKpiIds: defaultVisible.map((kpi) => kpi.id),
      kpiOrder: defaultVisible.map((kpi) => kpi.id),
    };
  }
  const key = getStorageKey(KPI_PREFERENCES_STORAGE_KEY_BASE, userId);
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const allKpiIdsSet = new Set(allKpiConfigurations.map((kpi) => kpi.id));
      const validVisibleKpiIds = Array.isArray(parsed.visibleKpiIds)
        ? parsed.visibleKpiIds.filter((id: string) => allKpiIdsSet.has(id))
        : [];
      const validKpiOrder = Array.isArray(parsed.kpiOrder)
        ? parsed.kpiOrder.filter((id: string) => allKpiIdsSet.has(id))
        : [];

      allKpiConfigurations.forEach((kpi) => {
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
  const defaultVisible = allKpiConfigurations.filter(
    (kpi) => kpi.defaultVisible !== false
  );
  return {
    visibleKpiIds: defaultVisible.map((kpi) => kpi.id),
    kpiOrder: allKpiConfigurations.map((kpi) => kpi.id),
  };
};

const saveKpiPreferences = (
  preferences: { visibleKpiIds: string[]; kpiOrder: string[] },
  userId?: string
) => {
  if (typeof window === "undefined" || !userId) return;
  const key = getStorageKey(KPI_PREFERENCES_STORAGE_KEY_BASE, userId);
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch (e) {
    console.error("Error saving KPI preferences to localStorage:", e);
  }
};

const getQuickActionPreferences = (
  userId?: string,
  allQuickActions: ItemConfig[] = []
): { visibleQuickActionIds: string[]; quickActionOrder: string[] } => {
  if (typeof window === "undefined" || !userId) {
    const defaultVisible = allQuickActions.filter(
      (qa) => qa.defaultVisible !== false
    );
    return {
      visibleQuickActionIds: defaultVisible.map((qa) => qa.id),
      quickActionOrder: defaultVisible.map((qa) => qa.id),
    };
  }
  const key = getStorageKey(QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE, userId);
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const allQaIdsSet = new Set(allQuickActions.map((qa) => qa.id));
      const validVisibleQaIds = Array.isArray(parsed.visibleQuickActionIds)
        ? parsed.visibleQuickActionIds.filter((id: string) =>
            allQaIdsSet.has(id)
          )
        : [];
      const validQaOrder = Array.isArray(parsed.quickActionOrder)
        ? parsed.quickActionOrder.filter((id: string) => allQaIdsSet.has(id))
        : [];

      allQuickActions.forEach((qa) => {
        if (qa.defaultVisible && !validVisibleQaIds.includes(qa.id)) {
          validVisibleQaIds.push(qa.id);
        }
        if (!validQaOrder.includes(qa.id)) {
          validQaOrder.push(qa.id);
        }
      });
      return {
        visibleQuickActionIds: validVisibleQaIds,
        quickActionOrder: validQaOrder,
      };
    } catch (e) {
      console.error(
        "Error parsing Quick Action preferences from localStorage:",
        e
      );
    }
  }
  const defaultVisible = allQuickActions.filter(
    (qa) => qa.defaultVisible !== false
  );
  return {
    visibleQuickActionIds: defaultVisible.map((qa) => qa.id),
    quickActionOrder: allQuickActions.map((qa) => qa.id),
  };
};

const saveQuickActionPreferences = (
  preferences: { visibleQuickActionIds: string[]; quickActionOrder: string[] },
  userId?: string
) => {
  if (typeof window === "undefined" || !userId) return;
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
  const [isCreateSupplierSheetOpen, setIsCreateSupplierSheetOpen] =
    useState(false);

  const allQuickActionConfigurations: ItemConfig[] = useMemo(
    () => [
      {
        id: "scanDocument",
        titleKey: "home_scan_button",
        icon: ScanLine,
        onClick: () => router.push("/upload"),
        defaultVisible: true,
        iconColor: "text-primary",
      },
      {
        id: "addExpense",
        titleKey: "home_quick_action_add_expense",
        icon: DollarSign,
        link: "/accounts/other-expenses",
        defaultVisible: true,
        iconColor: "text-green-500",
      },
      {
        id: "addProduct",
        titleKey: "home_quick_action_add_product",
        icon: PackagePlus,
        link: "/inventory",
        defaultVisible: true,
        iconColor: "text-blue-500",
      },
      {
        id: "openInvoices",
        titleKey: "home_open_invoices",
        icon: FileWarning,
        link: "/invoices?tab=scanned-docs&filterPaymentStatus=unpaid",
        defaultVisible: true,
        iconColor: "text-orange-500",
      },
      {
        id: "latestDocument",
        titleKey: "home_quick_action_latest_document",
        icon: History,
        link: "/invoices?tab=scanned-docs&sortBy=uploadTime&sortDir=desc",
        defaultVisible: false,
        iconColor: "text-purple-500",
      },
      {
        id: "addSupplier",
        titleKey: "home_quick_action_add_supplier",
        icon: UserPlus,
        onClick: () => setIsCreateSupplierSheetOpen(true),
        defaultVisible: false,
        iconColor: "text-teal-500",
      },
    ],
    [t, setIsCreateSupplierSheetOpen, router]
  );

  const [userKpiPreferences, setUserKpiPreferences] = useState<{
    visibleKpiIds: string[];
    kpiOrder: string[];
  }>({ visibleKpiIds: [], kpiOrder: [] });

  const [userQuickActionPreferences, setUserQuickActionPreferences] = useState<{
    visibleQuickActionIds: string[];
    quickActionOrder: string[];
  }>(() => getQuickActionPreferences(user?.id, allQuickActionConfigurations));

  const [isCustomizeKpiSheetOpen, setIsCustomizeKpiSheetOpen] = useState(false);
  const [
    isCustomizeQuickActionsSheetOpen,
    setIsCustomizeQuickActionsSheetOpen,
  ] = useState(false);

  const visibleKpiConfigs = useMemo(() => {
    return userKpiPreferences.kpiOrder
      .map((id) => allKpiConfigurations.find((config) => config.id === id))
      .filter(
        (config) =>
          config !== undefined &&
          userKpiPreferences.visibleKpiIds.includes(config.id)
      ) as ItemConfig[];
  }, [userKpiPreferences]);

  const visibleQuickActions = useMemo(() => {
    return userQuickActionPreferences.quickActionOrder
      .map((id) =>
        allQuickActionConfigurations.find((config) => config.id === id)
      )
      .filter(
        (config) =>
          config !== undefined &&
          userQuickActionPreferences.visibleQuickActionIds.includes(config.id)
      ) as ItemConfig[];
  }, [userQuickActionPreferences, allQuickActionConfigurations]);

  useEffect(() => {
    if (user && user.id) {
      setUserKpiPreferences(getKpiPreferences(user.id));
      setUserQuickActionPreferences(
        getQuickActionPreferences(user.id, allQuickActionConfigurations)
      );
    } else if (!authLoading) {
      setUserKpiPreferences(getKpiPreferences());
      setUserQuickActionPreferences(
        getQuickActionPreferences(undefined, allQuickActionConfigurations)
      );
    }
  }, [user, authLoading, allQuickActionConfigurations]);

  const fetchKpiData = useCallback(async () => {
    if (!user || !user.id || authLoading) {
      setIsLoadingKpis(false);
      return;
    }

    setIsLoadingKpis(true);
    setKpiError(null);
    console.log("[HomePage] fetchKpiData called for user:", user.id);
    try {
      const [
        productsData,
        invoicesData,
        suppliersData,
        otherExpensesData,
        settingsData,
      ] = await Promise.all([
        getProductsService(user.id),
        getInvoicesService(user.id),
        getSuppliersService(user.id),
        getOtherExpensesService(user.id),
        getUserSettingsService(user.id),
      ]);
      console.log(
        "[HomePage] Data fetched: Products:",
        productsData.length,
        "Invoices:",
        invoicesData.length,
        "Suppliers:",
        suppliersData.length,
        "Other Expenses:",
        otherExpensesData.length
      );

      const activeProducts = productsData.filter((p) => p.isActive !== false);

      const totalItems = calculateTotalItems(activeProducts);
      const inventoryValue = calculateInventoryValue(activeProducts);

      const allLowStockItems = getLowStockItems(activeProducts);
      const lowStockItemsCount = allLowStockItems.length;
      const criticalLowStockProducts = allLowStockItems
        .sort(
          (a, b) =>
            (a.quantity ?? 0) - (b.quantity ?? 0) ||
            (a.shortName || a.description || "").localeCompare(
              b.shortName || b.description || ""
            )
        )
        .slice(0, 2);

      const unpaidInvoices = invoicesData.filter(
        (invoice) => invoice.paymentStatus !== "paid"
      );
      const nextPaymentDueInvoice =
        unpaidInvoices.length > 0 ? unpaidInvoices[0] : null;

      const amountRemainingToPay = unpaidInvoices.reduce(
        (sum, invoice) => sum + (invoice.totalAmount || 0),
        0
      );
      const grossProfit = calculateTotalPotentialGrossProfit(activeProducts);

      const currentMonthStart = startOfMonth(new Date());
      const currentMonthEnd = endOfMonth(new Date());
      let totalExpensesFromInvoices = 0;

      invoicesData.forEach((invoice) => {
        if (invoice.status !== "completed") return;
        let relevantDateForExpense: Date | null = null;
        let paymentDateTs: Date | null = null;
        let uploadDateTs: Date | null = null;

        if (invoice.paymentDate) {
          if (invoice.paymentDate instanceof Timestamp)
            paymentDateTs = invoice.paymentDate.toDate();
          else if (
            typeof invoice.paymentDate === "string" &&
            isValid(parseISO(invoice.paymentDate))
          )
            paymentDateTs = parseISO(invoice.paymentDate);
        }
        if (invoice.uploadTime) {
          if (invoice.uploadTime instanceof Timestamp)
            uploadDateTs = invoice.uploadTime.toDate();
          else if (
            typeof invoice.uploadTime === "string" &&
            isValid(parseISO(invoice.uploadTime))
          )
            uploadDateTs = parseISO(invoice.uploadTime);
        }

        if (
          paymentDateTs &&
          paymentDateTs >= currentMonthStart &&
          paymentDateTs <= currentMonthEnd
        ) {
          relevantDateForExpense = paymentDateTs;
        }
        if (
          !relevantDateForExpense &&
          uploadDateTs &&
          uploadDateTs >= currentMonthStart &&
          uploadDateTs <= currentMonthEnd
        ) {
          relevantDateForExpense = uploadDateTs;
        }

        if (
          relevantDateForExpense &&
          (invoice.paymentStatus === "unpaid" ||
            invoice.paymentStatus === "pending_payment" ||
            invoice.paymentStatus === "paid")
        ) {
          totalExpensesFromInvoices += invoice.totalAmount || 0;
        }
      });

      const totalOtherExpensesForMonth = otherExpensesData.reduce(
        (sum, exp) => {
          if (!exp.date) return sum;
          let expenseDate: Date | null = null;
          if (exp.date instanceof Timestamp) expenseDate = exp.date.toDate();
          else if (typeof exp.date === "string" && isValid(parseISO(exp.date)))
            expenseDate = parseISO(exp.date);

          if (expenseDate && isSameMonth(expenseDate, new Date())) {
            const amountToAdd = exp.amount;
            const internalKey = exp.categoryId?.toLowerCase();
            const categoryString = exp.categoryId?.toLowerCase();
            const biMonthlyKeys = [
              "electricity",
              "water",
              "property_tax",
              "rent",
              t("accounts_other_expenses_tab_electricity").toLowerCase(),
              t("accounts_other_expenses_tab_water").toLowerCase(),
              t("accounts_other_expenses_tab_property_tax").toLowerCase(),
              t("accounts_other_expenses_tab_rent").toLowerCase(),
            ];

            if (
              (internalKey && biMonthlyKeys.includes(internalKey)) ||
              (categoryString &&
                !internalKey &&
                biMonthlyKeys.includes(categoryString))
            ) {
            }
            return sum + amountToAdd;
          }
          return sum;
        },
        0
      );
      const calculatedCurrentMonthTotalExpenses =
        totalExpensesFromInvoices + totalOtherExpensesForMonth;
      const thirtyDaysAgo = subDays(new Date(), 30);
      const documentsProcessed30d = invoicesData.filter((inv) => {
        if (inv.status !== "completed" || !inv.uploadTime) return false;
        let uploadDate: Date | null = null;
        if (inv.uploadTime instanceof Timestamp)
          uploadDate = inv.uploadTime.toDate();
        else if (
          typeof inv.uploadTime === "string" &&
          isValid(parseISO(inv.uploadTime))
        )
          uploadDate = parseISO(inv.uploadTime);
        return uploadDate && uploadDate >= thirtyDaysAgo;
      }).length;

      const completedInvoices = invoicesData.filter(
        (inv) => inv.status === "completed" && inv.totalAmount !== undefined
      );
      const totalInvoiceValue = completedInvoices.reduce(
        (sum, inv) => sum + (inv.totalAmount || 0),
        0
      );
      const averageInvoiceValueData =
        completedInvoices.length > 0
          ? totalInvoiceValue / completedInvoices.length
          : 0;
      const suppliersCountData = suppliersData.length;

      const recentInvoices = invoicesData
        .sort((a, b) => {
          const timeA = a.uploadTime
            ? (a.uploadTime instanceof Timestamp
                ? a.uploadTime.toDate()
                : parseISO(a.uploadTime as string)
              ).getTime()
            : 0;
          const timeB = b.uploadTime
            ? (b.uploadTime instanceof Timestamp
                ? b.uploadTime.toDate()
                : parseISO(b.uploadTime as string)
              ).getTime()
            : 0;
          return timeB - timeA;
        })
        .slice(0, 3);

      const localeToUse =
        t("locale_code_for_date_fns") === "he" ? heLocale : enUSLocale;

      const mockRecentActivity = recentInvoices.map((inv) => {
        let dateToFormat: Date | string | null = null;
        if (inv.uploadTime) {
          if (inv.uploadTime instanceof Timestamp) {
            dateToFormat = inv.uploadTime.toDate();
          } else if (typeof inv.uploadTime === "string") {
            dateToFormat = inv.uploadTime;
          } else if (inv.uploadTime instanceof Date) {
            dateToFormat = inv.uploadTime;
          }
        }
        const IconForActivity = inv.totalAmount
          ? inv.totalAmount > 0
            ? TrendingUp
            : TrendingDown
          : FileTextIcon;

        return {
          descriptionKey: "home_recent_activity_mock_invoice_added",
          params: {
            supplier: inv.supplierName || t("invoices_unknown_supplier"),
          },
          time:
            dateToFormat &&
            isValid(
              typeof dateToFormat === "string"
                ? parseISO(dateToFormat)
                : dateToFormat
            )
              ? formatDateFns(
                  typeof dateToFormat === "string"
                    ? parseISO(dateToFormat)
                    : dateToFormat,
                  "PPp",
                  { locale: localeToUse }
                )
              : t("home_unknown_date"),
          link: `/invoices?tab=scanned-docs&viewInvoiceId=${inv.id}`,
          icon: IconForActivity,
        };
      });

      setKpiData({
        totalItems,
        inventoryValue,
        lowStockItemsCount,
        criticalLowStockProducts,
        nextPaymentDueInvoice: nextPaymentDueInvoice as Invoice | null,
        recentActivity: mockRecentActivity,
        latestDocName:
          invoicesData.length > 0 && invoicesData[0].originalFileName
            ? invoicesData[0].originalFileName
            : undefined,
        grossProfit,
        amountRemainingToPay,
        currentMonthTotalExpenses: calculatedCurrentMonthTotalExpenses,
        documentsProcessed30d,
        averageInvoiceValue: averageInvoiceValueData,
        suppliersCount: suppliersCountData,
      });
      console.log(
        "[HomePage] KPIs processed. CurrentMonthExpenses:",
        calculatedCurrentMonthTotalExpenses
      );
    } catch (error: any) {
      console.error("[HomePage] Failed to fetch KPI data:", error);
      let errorMessage = t("home_kpi_toast_error_load_failed_desc");
      if (errorMessage === "home_kpi_toast_error_load_failed_desc") {
        errorMessage = "Failed to load dashboard data. Please try again later.";
      }
      if (error.message) {
        errorMessage += ` (Error: ${error.message})`;
      }
      setKpiError(errorMessage);
      toast({
        title: t("error_title"),
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoadingKpis(false);
    }
  }, [user, authLoading, t, toast, locale]);

  useEffect(() => {
    if (user && user.id) {
      fetchKpiData();
    } else if (!authLoading && !user) {
      setIsLoadingKpis(false);
    }
  }, [user, authLoading, fetchKpiData]);

  const handleScanClick = () => {
    router.push("/upload");
  };

  const renderKpiValueDisplay = (valueString: string) => {
    return (
      <div className="text-2xl font-bold text-foreground text-right rtl:text-right">
        {valueString}
      </div>
    );
  };

  const handleSaveKpiPreferences = (preferences: {
    visibleItemIds: string[];
    itemOrder: string[];
  }) => {
    if (user && user.id) {
      const prefsToSave = {
        visibleKpiIds: preferences.visibleItemIds,
        kpiOrder: preferences.itemOrder,
      };
      saveKpiPreferences(prefsToSave, user.id);
      setUserKpiPreferences(prefsToSave);
      toast({
        title: t("home_kpi_prefs_saved_title"),
        description: t("home_kpi_prefs_saved_desc"),
      });
    }
  };

  const handleSaveQuickActionPreferences = (preferences: {
    visibleItemIds: string[];
    itemOrder: string[];
  }) => {
    if (user && user.id) {
      const prefsToSave = {
        visibleQuickActionIds: preferences.visibleItemIds,
        quickActionOrder: preferences.itemOrder,
      };
      saveQuickActionPreferences(prefsToSave, user.id);
      setUserQuickActionPreferences(prefsToSave);
      toast({
        title: t("home_qa_prefs_saved_title"),
        description: t("home_qa_prefs_saved_desc"),
      });
    }
  };

  const handleCreateSupplier = async (
    name: string,
    contactInfo: { phone?: string; email?: string; paymentTerms?: string }
  ) => {
    if (!user || !user.id) return;
    try {
      await createSupplierService(name, contactInfo, user.id);
      toast({
        title: t("suppliers_toast_created_title"),
        description: t("suppliers_toast_created_desc", { supplierName: name }),
      });
      setIsCreateSupplierSheetOpen(false);
      fetchKpiData();
    } catch (error: any) {
      console.error("Failed to create supplier from home page:", error);
      toast({
        title: t("suppliers_toast_create_fail_title"),
        description: t("suppliers_toast_create_fail_desc", {
          message: error.message,
        }),
        variant: "destructive",
      });
    }
  };

  const renderRecentActivityItem = (
    item: KpiData["recentActivity"][0],
    index: number
  ) => (
    <Card
      key={index}
      className="group flex transform items-center space-x-3 rounded-lg border border-border bg-card p-3 shadow-sm transition-all duration-200 ease-in-out hover:scale-[1.02] hover:border-primary hover:bg-transparent hover:shadow-md rtl:space-x-reverse"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {item.icon ? (
          <item.icon className="h-5 w-5" />
        ) : (
          <History className="h-5 w-5" />
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">
          {t(item.descriptionKey, item.params)}
        </p>
        <p className="text-xs text-muted-foreground">{item.time}</p>
      </div>
      {item.link && (
        <Link href={item.link} passHref legacyBehavior>
          <a
            aria-label={t("home_recent_activity_view_details")}
            className="p-1 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          >
            <ChevronRight className="h-5 w-5" />
          </a>
        </Link>
      )}
    </Card>
  );

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-6 animate-fade-in">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">{t("loading_data")}</p>
      </div>
    );
  }

  if (!user && !authLoading) {
    return <GuestHomePage />;
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center min-h-[calc(100vh-var(--header-height,4rem)-env(safe-area-inset-bottom))] p-4 sm:p-6 md:p-8 homeContainerGradient animate-fade-in-up"
      )}
    >
      <TooltipProvider>
        <div className="w-full max-w-6xl">
          <header className="text-center mb-8 md:mb-12 animate-fade-in-down">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-primary">
              {t("home_welcome_title")}
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground mt-3 max-w-2xl mx-auto">
              {t("home_greeting", {
                username: user?.username || t("user_fallback_name"),
              })}
              <br />
              {t("home_sub_greeting")}
            </p>
          </header>

          <section className="mb-8 md:mb-12 flex flex-col items-center gap-4 animate-scale-in stagger-1">
            <Button
              size="lg"
              className="w-full max-w-md sm:max-w-lg transform hover:scale-105 py-3.5 sm:py-4 text-lg sm:text-xl \
                         bg-gradient-to-br from-[hsl(235_62%_25%)] to-[hsl(174_100%_22%)] text-primary-foreground \
                         hover:from-[hsl(235_62%_22%)] hover:to-[hsl(174_100%_19%)]"
              onClick={handleScanClick}
              isLoading={isLoadingKpis}
              loadingText={t("home_scan_button_loading")}
            >
              <ScanLine className="mr-2.5" /> {t("home_scan_button")}
            </Button>
            <div className="flex gap-3 sm:gap-4">
              <Button
                variant="outline"
                size="sm"
                asChild
                className="transform hover:scale-105 transition-all hover:bg-transparent hover:text-primary hover:border-primary"
              >
                <Link href="/inventory">
                  <Package className="mr-1.5" /> {t("nav_inventory")}
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                asChild
                className="transform hover:scale-105 transition-all hover:bg-transparent hover:text-primary hover:border-primary"
              >
                <Link href="/invoices">
                  <FileTextIcon className="mr-1.5" /> {t("nav_documents")}
                </Link>
              </Button>
            </div>
          </section>

          <section className="mb-8 md:mb-12 animate-fade-in-up stagger-2">
            <div className="flex justify-between items-center mb-4 px-1">
              <h2 className="text-2xl font-semibold text-foreground flex items-center">
                <PlusCircle className="mr-2.5 text-primary" />{" "}
                {t("home_quick_actions_title")}
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsCustomizeQuickActionsSheetOpen(true)}
                className="text-muted-foreground hover:text-primary"
              >
                <Edit3 />
                <span className="sr-only">{t("home_customize_qa_button")}</span>
              </Button>
            </div>
            <div className="p-4 sm:p-5">
              {isLoadingKpis && user && visibleQuickActions.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <Skeleton
                      key={`qa-skeleton-${idx}`}
                      className="h-20 sm:h-24 w-full rounded-lg"
                    />
                  ))}
                </div>
              ) : !isLoadingKpis && visibleQuickActions.length === 0 ? (
                <div className="col-span-full text-center py-6">
                  <LayoutDashboard className="mx-auto h-10 w-10 mb-2 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground">
                    {t("home_no_quick_actions_selected")}
                  </p>
                  <Button
                    variant="link"
                    onClick={() => setIsCustomizeQuickActionsSheetOpen(true)}
                    className="text-primary"
                  >
                    {t("home_no_quick_actions_action")}
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                  {visibleQuickActions.map((action, index) => {
                    const ActionIcon = action.icon;
                    const buttonContent = (
                      <>
                        <ActionIcon
                          className={cn(
                            "mb-1.5 h-6 w-6 sm:h-7 sm:w-7 group-hover:scale-110 transition-transform",
                            action.iconColor || "text-primary"
                          )}
                        />
                        <span className="text-xs sm:text-sm font-medium text-center leading-tight">
                          {t(action.titleKey)}
                        </span>
                      </>
                    );
                    const commonButtonClasses =
                      "h-auto py-4 px-2 flex-col items-center justify-center transform transition-all duration-300 group rounded-lg focus-visible:ring-offset-0 focus-visible:ring-primary/50 \
   bg-white/25 dark:bg-white/10 backdrop-blur-md border border-white/40 dark:border-white/20 hover:border-primary hover:bg-white/35 dark:hover:bg-white/20 hover:shadow-xl shadow-lg ring-1 ring-white/10 dark:ring-white/5";
                    const animationStyle = {
                      animationDelay: `${0.05 * index}s`,
                    };

                    return (
                      <Tooltip key={action.id} delayDuration={150}>
                        <TooltipTrigger asChild>
                          {action.link ? (
                            <Button
                              variant="outline"
                              asChild
                              className={cn(
                                commonButtonClasses,
                                "animate-scale-in"
                              )}
                              style={animationStyle}
                            >
                              <Link
                                href={action.link}
                                className="flex flex-col items-center justify-center w-full h-full"
                              >
                                {buttonContent}
                              </Link>
                            </Button>
                          ) : action.onClick ? (
                            <Button
                              variant="outline"
                              onClick={action.onClick}
                              className={cn(
                                commonButtonClasses,
                                "animate-scale-in"
                              )}
                              style={animationStyle}
                            >
                              {buttonContent}
                            </Button>
                          ) : null}
                        </TooltipTrigger>
                        {action.descriptionKey && (
                          <TooltipContent>
                            <p>{t(action.descriptionKey)}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="mb-8 md:mb-12 animate-fade-in-up stagger-3">
            <div className="flex justify-between items-center mb-4 px-1">
              <h2 className="text-2xl font-semibold text-foreground flex items-center">
                <LayoutDashboard className="mr-2.5 text-primary" />{" "}
                {t("home_quick_overview_title")}
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsCustomizeKpiSheetOpen(true)}
                className="text-muted-foreground hover:text-primary"
              >
                <Edit3 />
                <span className="sr-only">
                  {t("home_customize_dashboard_button")}
                </span>
              </Button>
            </div>

            {kpiError && !isLoadingKpis && user && (
              <Alert variant="destructive" className="mb-6 animate-fade-in">
                <AlertTriangle className="h-5 w-5" />
                <AlertDescription className="ml-2 text-base">
                  {kpiError}
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleKpiConfigs.map((kpi) => (
                <Card
                  key={kpi.id}
                  className={cn(
                    "group transform border border-border bg-card shadow-md transition-all duration-200 ease-in-out hover:border-primary/50 hover:shadow-lg rounded-xl flex flex-col justify-between"
                  )}
                  onClick={
                    kpi.link ? () => router.push(kpi.link!) : kpi.onClick
                  }
                >
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                    <div className="flex flex-col items-start w-full">
                      <CardTitle className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                        {t(kpi.titleKey)}
                      </CardTitle>
                      {kpi.tagKey && (
                        <span className="mt-1 text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-primary/10">
                          {t(kpi.tagKey)}
                        </span>
                      )}
                    </div>
                    {kpi.icon && (
                      <kpi.icon
                        className={cn(
                          "h-6 w-6 flex-shrink-0",
                          kpi.iconColor || "text-primary"
                        )}
                      />
                    )}
                  </CardHeader>
                  <CardContent className="text-right flex-grow flex flex-col justify-center">
                    {kpi.getValue &&
                      renderKpiValueDisplay(kpi.getValue(kpiData, t))}

                    {kpi.showProgress && kpiData && kpi.progressValue && (
                      <Progress
                        value={isLoadingKpis ? 60 : kpi.progressValue(kpiData)}
                        className={cn(
                          "h-1.5 sm:h-2 w-full mt-auto rounded-full",
                          isLoadingKpis && "animate-pulse",
                          "bg-primary/20 dark:bg-primary/30"
                        )}
                        indicatorClassName={"bg-primary"}
                      />
                    )}
                    {kpi.descriptionKey && (
                      <p className="text-xs text-muted-foreground mb-2 text-right rtl:text-right">
                        {t(kpi.descriptionKey)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 mb-8 md:mb-12">
            <Card variant="glass" className="animate-fade-in-up stagger-4">
              <CardHeader className="pb-3 flex-row items-center justify-between">
                <div className="flex items-center">
                  <Info className="mr-2.5 h-6 w-6 text-primary" />
                  <CardTitle className="text-xl font-semibold text-foreground">
                    {t("home_actionable_insights_title")}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm pt-2">
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center mb-1.5">
                    <AlertTriangle className="mr-2 h-5 w-5 text-destructive" />
                    {t("home_critical_low_stock_title")}
                  </h3>
                  {isLoadingKpis ? (
                    <Skeleton className="h-16 w-full rounded-md" />
                  ) : kpiData?.criticalLowStockProducts &&
                    kpiData.criticalLowStockProducts.length > 0 ? (
                    <ul className="space-y-1 text-muted-foreground">
                      {kpiData.criticalLowStockProducts.map((product) => (
                        <li
                          key={product.id}
                          className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors"
                        >
                          <div>
                            <Link
                              href={`/inventory/${product.id}`}
                              className="font-medium text-foreground hover:underline"
                            >
                              {product.shortName || product.description}
                            </Link>
                            <span className="text-xs ml-1">
                              ({t("home_stock_level_label")}: {product.quantity}
                              )
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            asChild
                            className="h-auto py-1 px-2 text-xs hover:bg-transparent hover:text-primary hover:border-primary"
                          >
                            <Link href={`/inventory/${product.id}`}>
                              {t("view_details_button")}
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-muted-foreground text-center py-6">
                      <Package className="mx-auto h-10 w-10 mb-2 opacity-50" />
                      <p>{t("home_empty_state_low_stock")}</p>
                    </div>
                  )}
                </div>
                <hr className="border-border/30" />
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center mb-1.5">
                    <BellRing className="mr-2 h-5 w-5 text-primary" />
                    {t("home_next_payment_due_title")}
                  </h3>
                  {isLoadingKpis ? (
                    <Skeleton className="h-10 w-full rounded-md" />
                  ) : kpiData?.nextPaymentDueInvoice ? (
                    <div className="p-2 rounded-md hover:bg-muted/50 transition-colors flex items-center justify-between">
                      <div>
                        <Link
                          href={`/invoices?tab=scanned-docs&viewInvoiceId=${kpiData.nextPaymentDueInvoice.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {kpiData.nextPaymentDueInvoice.supplierName ||
                            t("invoices_unknown_supplier")}{" "}
                          -{" "}
                          {formatLargeNumber(
                            kpiData.nextPaymentDueInvoice.totalAmount,
                            t,
                            true,
                            0
                          )}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {t("home_due_on_label")}{" "}
                          {kpiData.nextPaymentDueInvoice.paymentDate
                            ? typeof kpiData.nextPaymentDueInvoice
                                .paymentDate === "string"
                              ? formatDateFns(
                                  parseISO(
                                    kpiData.nextPaymentDueInvoice.paymentDate
                                  ),
                                  "PP",
                                  {
                                    locale:
                                      t("locale_code_for_date_fns") === "he"
                                        ? heLocale
                                        : enUSLocale,
                                  }
                                )
                              : kpiData.nextPaymentDueInvoice
                                  .paymentDate instanceof Timestamp
                              ? formatDateFns(
                                  kpiData.nextPaymentDueInvoice.paymentDate.toDate(),
                                  "PP",
                                  {
                                    locale:
                                      t("locale_code_for_date_fns") === "he"
                                        ? heLocale
                                        : enUSLocale,
                                  }
                                )
                              : t("home_unknown_date")
                            : t("home_unknown_date")}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className="h-auto py-1 px-2 text-xs hover:bg-transparent hover:text-primary hover:border-primary"
                      >
                        <Link
                          href={`/invoices?tab=scanned-docs&viewInvoiceId=${kpiData.nextPaymentDueInvoice.id}`}
                        >
                          {t("view_invoice_button")}
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-center py-6">
                      <CreditCard className="mx-auto h-10 w-10 mb-2 opacity-50" />
                      <p>{t("home_empty_state_upcoming_payments")}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="animate-fade-in-up stagger-5">
              <CardHeader className="pb-3 flex-row items-center justify-between px-0">
                <div className="flex items-center">
                  <History className="mr-2.5 h-6 w-6 text-primary" />
                  <CardTitle className="text-xl font-semibold text-foreground">
                    {t("home_recent_activity_title")}
                  </CardTitle>
                </div>
                {kpiData?.recentActivity &&
                  kpiData.recentActivity.length > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="text-xs text-primary"
                    >
                      <Link href="/invoices?tab=scanned-docs&sortBy=uploadTime&sortDir=desc">
                        {t("view_all_button")}
                      </Link>
                    </Button>
                  )}
              </CardHeader>
              <div className="pt-2">
                {isLoadingKpis ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full rounded-lg" />
                    ))}
                  </div>
                ) : kpiData?.recentActivity &&
                  kpiData.recentActivity.length > 0 ? (
                  <div className="space-y-3">
                    {kpiData.recentActivity
                      .slice(0, 5)
                      .map(renderRecentActivityItem)}
                  </div>
                ) : (
                  <div className="text-muted-foreground text-center py-10 border rounded-lg bg-card shadow-sm">
                    <FileTextIcon className="mx-auto h-10 w-10 mb-2 opacity-50" />
                    <p>{t("home_empty_state_recent_activity_title")}</p>
                    <p className="text-xs">
                      {t("home_empty_state_recent_activity_desc")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
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
