
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"; // Added CardFooter
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/context/AuthContext";
import { Package, FileText, BarChart2, ScanLine, Loader2, AlertTriangle, TrendingUp, TrendingDown, DollarSign, HandCoins, ShoppingCart, CreditCard, Banknote } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getProductsService, InvoiceHistoryItem, getInvoicesService, getStorageKey } from '@/services/backend';
import {
  calculateInventoryValue,
  calculateTotalItems,
  getLowStockItems,
  calculateTotalPotentialGrossProfit,
} from '@/lib/kpi-calculations';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import GuestHomePage from '@/components/GuestHomePage';
import styles from "./page.module.scss"; // Assuming you have this for specific styles
import { isValid, parseISO, startOfMonth, endOfMonth, isSameMonth } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';

export interface OtherExpense {
  id: string;
  category: string;
  _internalCategoryKey?: string;
  description: string;
  amount: number;
  date: string;
}
const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses';

interface KpiData {
  totalItems: number;
  inventoryValue: number;
  lowStockItemsCount: number;
  latestDocName?: string;
  inventoryValueTrend?: { name: string; value: number }[];
  inventoryValuePrevious?: number;
  grossProfit: number;
  amountRemainingToPay: number;
  currentMonthTotalExpenses?: number;
}

interface KpiConfig {
  id: string;
  titleKey: string; // Key for translation
  icon: React.ElementType;
  getValue: (data: KpiData | null) => number | undefined;
  descriptionKey: string; // Key for translation
  link: string;
  isCurrency?: boolean;
  isInteger?: boolean;
  showTrend?: boolean;
  showProgress?: boolean;
  progressValue?: (data: KpiData | null) => number;
  iconColor?: string; // Tailwind color class for the icon
}

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
          labelFormatter={() => ''}
        />
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

  // Define KPI configurations
  const kpiConfigurations: KpiConfig[] = [
    {
      id: 'totalItems',
      titleKey: 'home_kpi_total_items_title',
      icon: Package,
      getValue: (data) => data?.totalItems,
      descriptionKey: 'home_kpi_total_items_desc',
      link: '/inventory',
      isInteger: true,
      iconColor: 'text-accent',
    },
    {
      id: 'inventoryValue',
      titleKey: 'home_kpi_inventory_value_title',
      icon: DollarSign,
      getValue: (data) => data?.inventoryValue,
      descriptionKey: 'home_kpi_inventory_value_desc',
      link: '/reports',
      isCurrency: true,
      showTrend: true,
      iconColor: 'text-accent',
    },
    {
      id: 'grossProfit',
      titleKey: 'home_kpi_gross_profit_title',
      icon: HandCoins,
      getValue: (data) => data?.grossProfit,
      descriptionKey: 'home_kpi_gross_profit_desc',
      link: '/reports',
      isCurrency: true,
      iconColor: 'text-accent',
    },
    {
      id: 'currentMonthExpenses',
      titleKey: 'home_kpi_current_month_expenses_title',
      icon: CreditCard, // Changed from TrendingDown
      getValue: (data) => data?.currentMonthTotalExpenses,
      descriptionKey: 'home_kpi_current_month_expenses_desc',
      link: '/accounts',
      isCurrency: true,
      iconColor: 'text-destructive', // Changed to destructive for expenses
    },
    {
      id: 'lowStock',
      titleKey: 'home_kpi_low_stock_title',
      icon: AlertTriangle,
      getValue: (data) => data?.lowStockItemsCount,
      descriptionKey: 'home_kpi_low_stock_desc',
      link: '/inventory?filter=low',
      isInteger: true,
      showProgress: true,
      progressValue: (data) => data && data.totalItems > 0 && data.lowStockItemsCount >= 0 ? (data.lowStockItemsCount / data.totalItems) * 100 : 0,
      iconColor: 'text-yellow-500 dark:text-yellow-400',
    },
    {
      id: 'amountToPay',
      titleKey: 'home_kpi_amount_to_pay_title',
      icon: Banknote,
      getValue: (data) => data?.amountRemainingToPay,
      descriptionKey: 'home_kpi_amount_to_pay_desc',
      link: '/accounts?filter=unpaid',
      isCurrency: true,
      iconColor: 'text-accent',
    },
  ];


  useEffect(() => {
    async function fetchKpiData() {
      if (!user || authLoading) return;

      setIsLoadingKpis(true);
      setKpiError(null);
      try {
        const [products, invoices] = await Promise.all([
          getProductsService(user.id),
          getInvoicesService(user.id)
        ]);

        const otherExpensesStorageKey = getStorageKey(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id);
        const storedOtherExpenses = typeof window !== 'undefined' ? localStorage.getItem(otherExpensesStorageKey) : null;
        const otherExpensesData: OtherExpense[] = storedOtherExpenses ? JSON.parse(storedOtherExpenses) : [];

        const totalItems = calculateTotalItems(products);
        const inventoryValue = calculateInventoryValue(products);
        const lowStockItemsCount = getLowStockItems(products).length;
        const grossProfit = calculateTotalPotentialGrossProfit(products);

        const unpaidInvoices = invoices.filter(
          invoice => invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'pending_payment'
        );
        const amountRemainingToPay = unpaidInvoices.reduce(
          (sum, invoice) => sum + (invoice.totalAmount || 0),
          0
        );

        const currentMonthStart = startOfMonth(new Date());
        const currentMonthEnd = endOfMonth(new Date());
        let totalExpensesFromInvoices = 0;

        invoices.forEach(invoice => {
            if (invoice.status !== 'completed') return;
            let relevantDateForExpense: Date | null = null;
            if (invoice.uploadTime) { // Prioritize uploadTime for expense recognition
                try {
                    const upTime = parseISO(invoice.uploadTime as string);
                    if (isValid(upTime)) relevantDateForExpense = upTime;
                } catch (e) {/* ignore */ }
            } else if (invoice.paymentDueDate) { // Fallback to paymentDueDate
                try {
                    const dueDate = parseISO(invoice.paymentDueDate as string);
                    if (isValid(dueDate)) relevantDateForExpense = dueDate;
                } catch (e) {/* ignore */ }
            }

            if (relevantDateForExpense) {
                if (relevantDateForExpense >= currentMonthStart && relevantDateForExpense <= currentMonthEnd) {
                    totalExpensesFromInvoices += (invoice.totalAmount || 0);
                }
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
                    const biMonthlyKeys = ['electricity', 'water', 'property_tax', t('accounts_other_expenses_tab_electricity').toLowerCase(), t('accounts_other_expenses_tab_water').toLowerCase(), t('accounts_other_expenses_tab_property_tax').toLowerCase()];
                    if ((internalKey && biMonthlyKeys.includes(internalKey)) || (categoryString && !internalKey && biMonthlyKeys.includes(categoryString))){
                         amountToAdd /= 2;
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

        const mockInventoryValueTrend = [
          { name: 'Day 1', value: inventoryValue * 0.95 + Math.random() * 1000 - 500 },
          { name: 'Day 2', value: inventoryValue * 0.98 + Math.random() * 1000 - 500 },
          { name: 'Day 3', value: inventoryValue * 0.96 + Math.random() * 1000 - 500 },
          { name: 'Day 4', value: inventoryValue * 1.02 + Math.random() * 1000 - 500 },
          { name: 'Day 5', value: inventoryValue + Math.random() * 1000 - 500 },
        ].map(d => ({...d, value: Math.max(0, d.value)}));

        setKpiData({
          totalItems,
          inventoryValue,
          lowStockItemsCount,
          inventoryValueTrend: mockInventoryValueTrend,
          inventoryValuePrevious: mockInventoryValueTrend.length > 1 ? mockInventoryValueTrend[mockInventoryValueTrend.length - 2].value : inventoryValue,
          grossProfit,
          amountRemainingToPay,
          currentMonthTotalExpenses: calculatedCurrentMonthTotalExpenses,
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
    }
    if (user) {
      fetchKpiData();
    } else if (!authLoading) { 
      setIsLoadingKpis(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, toast, t]);


  const handleScanClick = () => {
    router.push('/upload');
  };

  const handleInventoryClick = () => {
    router.push('/inventory');
  };

  const handleReportsClick = () => {
    router.push('/reports');
  };

  const formatLargeNumber = (num: number | undefined, decimals = 1, isCurrency = false, isInteger = false): string => {
    if (num === undefined || num === null || isNaN(num)) {
      return isCurrency ? `${t('currency_symbol')}-` : '-';
    }
  
    const prefix = isCurrency ? `${t('currency_symbol')}` : '';
    const absNum = Math.abs(num);
  
    if (absNum < 1000) {
      return prefix + num.toLocaleString(undefined, {
        minimumFractionDigits: isCurrency ? 2 : (isInteger ? 0 : decimals),
        maximumFractionDigits: isCurrency ? 2 : (isInteger ? 0 : decimals)
      });
    }
  
    const si = [
      { value: 1, symbol: "" },
      { value: 1E3, symbol: "K" },
      { value: 1E6, symbol: "M" },
      { value: 1E9, symbol: "B" },
      { value: 1E12, symbol: "T" }
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
      numDecimals = (valAfterSuffix % 1 === 0 && si[i].value !== 1) ? 0 : 2;
    } else {
      numDecimals = (isInteger ? 0 : (valAfterSuffix % 1 === 0 && si[i].value !== 1) ? 0 : decimals);
    }
     if (si[i].value === 1) numDecimals = isCurrency ? 2 : (isInteger ? 0 : decimals) ;

    const formattedNum = valAfterSuffix.toFixed(numDecimals).replace(rx, "$1");
    return prefix + formattedNum + si[i].symbol;
  };
  

  const renderKpiValue = (value: number | undefined, isCurrency: boolean = false, isInteger: boolean = false) => {
    if (isLoadingKpis && user) {
      return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
    }
    if (kpiError && user) return <span className="text-destructive text-lg">-</span>;
    if (value === undefined || value === null || isNaN(value)) return isCurrency ? `${t('currency_symbol')}-` : '-';

    return formatLargeNumber(value, isInteger ? 0 : (isCurrency ? 2 : 1), isCurrency, isInteger);
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
    <div className={cn(styles.homeContainer, "flex flex-col items-center justify-start min-h-[calc(100vh-var(--header-height,4rem))] p-4 sm:p-6 md:p-8")}>
      <TooltipProvider>
        <div className="w-full max-w-4xl text-center">
           <p className="text-base sm:text-lg text-muted-foreground mb-2 scale-fade-in delay-100">
           {t('home_greeting', { username: user?.username || 'User' })}
          </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6 md:mb-8 text-primary scale-fade-in">
             {t('home_welcome_title')}
          </h1>
          
           <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-8 md:mb-12 scale-fade-in delay-200">
            <Button
              size="lg"
              className="w-full bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base transform hover:-translate-y-1 py-6 sm:py-7"
              onClick={handleScanClick}
            >
              <ScanLine className="mr-2 h-5 w-5" /> {t('home_scan_button')}
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full border-primary text-primary hover:bg-primary/5 shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base transform hover:-translate-y-1 py-6 sm:py-7"
              onClick={handleInventoryClick}
            >
              <Package className="mr-2 h-5 w-5" /> {t('home_inventory_button')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="w-full bg-gradient-to-br from-secondary to-muted text-secondary-foreground shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base transform hover:-translate-y-1 py-6 sm:py-7"
              onClick={handleReportsClick}
            >
              <BarChart2 className="mr-2 h-5 w-5" /> {t('home_reports_button')}
            </Button>
          </div>


           {kpiError && !isLoadingKpis && user && (
            <Alert variant="destructive" className="mb-6 md:mb-8 text-left scale-fade-in delay-400">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{kpiError}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 scale-fade-in delay-300">
             {kpiConfigurations.map((kpi, index) => {
                const Icon = kpi.icon;
                const value = kpi.getValue(kpiData);
                const progress = kpi.showProgress && kpi.progressValue ? kpi.progressValue(kpiData) : 0;
                return (
                  <Tooltip key={kpi.id}>
                    <TooltipTrigger asChild>
                      <Link href={kpi.link} className="block hover:no-underline">
                        <Card className={cn(styles.kpiCard, "shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left transform hover:-translate-y-1 bg-background/80 backdrop-blur-sm border-border/50")} style={{animationDelay: `${0.1 * index}s`}}>
                          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
                            <CardTitle className="text-sm font-medium text-muted-foreground">{t(kpi.titleKey)}</CardTitle>
                            <Icon className={cn("h-5 w-5", kpi.iconColor || "text-accent")} />
                          </CardHeader>
                          <CardContent className="pt-1 pb-2 px-4">
                            <div className="text-2xl sm:text-3xl font-bold text-primary flex items-baseline">
                                {renderKpiValue(value, kpi.isCurrency, kpi.isInteger)}
                                {kpi.id === 'inventoryValue' && kpiData && kpiData.inventoryValueTrend && kpiData.inventoryValueTrend.length > 1 && kpiData.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && (
                                    kpiData.inventoryValue > kpiData.inventoryValuePrevious ?
                                    <TrendingUp className="h-4 w-4 text-green-500 ml-1.5 shrink-0" /> :
                                    <TrendingDown className="h-4 w-4 text-red-500 ml-1.5 shrink-0" />
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground pt-1">{t(kpi.descriptionKey)}</p>
                            {kpi.showTrend && (
                                <div className="mt-1">
                                    <SparkLineChart data={kpiData?.inventoryValueTrend || []} dataKey="value" strokeColor="hsl(var(--accent))" />
                                </div>
                            )}
                            {kpi.showProgress && kpiData && (
                                <Progress
                                    value={progress}
                                    className="h-2 mt-2 bg-muted/50"
                                    indicatorClassName={cn(
                                        "transition-all duration-500 ease-out",
                                        progress > 75 ? "bg-destructive" :
                                        progress > 50 ? "bg-yellow-500" :
                                        "bg-accent"
                                    )}
                                />
                            )}
                          </CardContent>
                           {kpi.id === 'inventoryValue' && kpiData?.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && (
                            <CardFooter className="text-xs px-4 pb-3 pt-0">
                                <p className={cn("text-muted-foreground", kpiData.inventoryValue > kpiData.inventoryValuePrevious ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                                    {t('home_kpi_vs_last_period_prefix')} {formatLargeNumber(kpiData.inventoryValuePrevious, 2, true)}
                                </p>
                            </CardFooter>
                           )}
                        </Card>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t(kpi.titleKey)}: {renderKpiValue(value, kpi.isCurrency, kpi.isInteger)}</p>
                      <p className="text-xs">{t(kpi.descriptionKey)}</p>
                    </TooltipContent>
                  </Tooltip>
                );
             })}
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
