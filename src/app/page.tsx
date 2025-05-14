
'use client';

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { Package, FileText, BarChart2, ScanLine, Loader2, AlertTriangle, TrendingUp, TrendingDown, Info, DollarSign, HandCoins, ShoppingCart, CreditCard, Banknote } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getProductsService, InvoiceHistoryItem, getInvoicesService, getStorageKey } from '@/services/backend';
import {
  calculateInventoryValue,
  calculateTotalItems,
  getLowStockItems,
  calculateTotalPotentialGrossProfit,
  // calculateAverageOrderValue // No longer used directly on this page
} from '@/lib/kpi-calculations';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import GuestHomePage from '@/components/GuestHomePage';
import styles from "./page.module.scss";
import { isValid, parseISO, startOfMonth, endOfMonth, isSameMonth } from 'date-fns';

// Copied from accounts/other-expenses/page.tsx - ideally should be in a shared location
export interface OtherExpense {
  id: string;
  category: string;
  _internalCategoryKey?: string;
  description: string;
  amount: number;
  date: string;
}
const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses';
// End of copied types/constants

interface KpiData {
  totalItems: number;
  inventoryValue: number;
  // docsProcessedLast30Days: number; // Removed
  lowStockItemsCount: number;
  latestDocName?: string;
  inventoryValueTrend?: { name: string; value: number }[];
  inventoryValuePrevious?: number;
  grossProfit: number;
  // averageOrderValue: number; // Removed
  amountRemainingToPay: number;
  currentMonthTotalExpenses?: number; // Added
}

const SparkLineChart = ({ data, dataKey, strokeColor }: { data: any[], dataKey: string, strokeColor: string }) => {
  if (!data || data.length === 0) {
    return <div className="h-10 w-full bg-muted/50 rounded-md flex items-center justify-center text-xs text-muted-foreground">No value trend data</div>;
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
             if (name === 'value') return [`₪${value.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits: 0})}`, 'Value'];
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

  const [kpiData, setKpiData] = useState<KpiData | null>(null);
  const [isLoadingKpis, setIsLoadingKpis] = useState(true);
  const [kpiError, setKpiError] = useState<string | null>(null);

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
        // const averageOrderValueData = calculateAverageOrderValue(invoices.filter(inv => inv.status === 'completed')); // Kept calculation for potential future use if needed elsewhere

        const unpaidInvoices = invoices.filter(
          invoice => invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'pending_payment'
        );
        const amountRemainingToPay = unpaidInvoices.reduce(
          (sum, invoice) => sum + (invoice.totalAmount || 0),
          0
        );

        // Calculate current month's expenses
        const currentMonthStart = startOfMonth(new Date());
        const currentMonthEnd = endOfMonth(new Date());
        let totalExpensesFromInvoices = 0;

        invoices.forEach(invoice => {
            if (invoice.status !== 'completed') return;
            let relevantDateForExpense: Date | null = null;
            if (invoice.paymentDueDate) {
                try {
                    const dueDate = parseISO(invoice.paymentDueDate as string);
                    if (isValid(dueDate)) relevantDateForExpense = dueDate;
                } catch (e) {/* ignore */ }
            }
            if (!relevantDateForExpense && invoice.uploadTime) {
                 try {
                    const upTime = parseISO(invoice.uploadTime as string);
                    if (isValid(upTime)) relevantDateForExpense = upTime;
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
                    const categoryString = exp.category?.toLowerCase(); // Ensure category exists
                    const biMonthlyKeys = ['electricity', 'water', 'property_tax', 'חשמל', 'מים', 'ארנונה'];
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
        setKpiError("Failed to load key performance indicators.");
        toast({
          title: "Error Fetching Data",
          description: "Could not load key performance indicators.",
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
  }, [user, authLoading, toast]);


  const handleScanClick = () => {
    router.push('/upload');
  };

  const handleInventoryClick = () => {
    router.push('/inventory');
  };

  const handleReportsClick = () => {
    router.push('/reports');
  };

  const formatLargeNumber = (num: number | undefined, decimals = 1, isCurrency = false): string => {
    if (num === undefined || num === null || isNaN(num)) {
      return isCurrency ? `₪-` : '-';
    }
  
    const prefix = isCurrency ? `₪` : '';
  
    const absNum = Math.abs(num);
  
    if (absNum < 1000) {
      return prefix + num.toLocaleString(undefined, {
        minimumFractionDigits: isCurrency ? 2 : (Number.isInteger(num) ? 0 : decimals),
        maximumFractionDigits: isCurrency ? 2 : decimals
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
      numDecimals = (valAfterSuffix % 1 === 0 && si[i].value !== 1) ? 0 : decimals;
    }
     if (si[i].value === 1) numDecimals = isCurrency ? 2 : (Number.isInteger(num) ? 0 : decimals) ;


    const formattedNum = valAfterSuffix.toFixed(numDecimals).replace(rx, "$1");
    return prefix + formattedNum + si[i].symbol;
  };
  

  const renderKpiValue = (value: number | undefined, isCurrency: boolean = false, isInteger: boolean = false) => {
    if (isLoadingKpis && user) {
      return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
    }
    if (kpiError && user) return <span className="text-destructive text-lg">-</span>;
    if (value === undefined || value === null || isNaN(value)) return isCurrency ? `₪-` : '-';

    return formatLargeNumber(value, isInteger ? 0 : (isCurrency ? 2 : 1), isCurrency);
  };
  
   if (authLoading) {
     return (
       <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-4 md:p-8">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="mt-4 text-muted-foreground">Loading InvoTrack...</p>
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
            Hello, {user?.username || 'User'}! Manage your inventory efficiently.
          </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6 md:mb-8 text-primary scale-fade-in">
            Welcome to InvoTrack
          </h1>
          
           <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-8 md:mb-12 scale-fade-in delay-200">
            <Button
              size="lg"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base transform hover:-translate-y-1 py-6 sm:py-7"
              onClick={handleScanClick}
            >
              <ScanLine className="mr-2 h-5 w-5" /> Scan Document
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full border-primary text-primary hover:bg-primary/10 shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base transform hover:-translate-y-1 py-6 sm:py-7"
              onClick={handleInventoryClick}
            >
              <Package className="mr-2 h-5 w-5" /> View Inventory
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="w-full bg-secondary hover:bg-secondary/80 text-secondary-foreground shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base transform hover:-translate-y-1 py-6 sm:py-7"
              onClick={handleReportsClick}
            >
              <BarChart2 className="mr-2 h-5 w-5" /> View Reports
            </Button>
          </div>


           {kpiError && !isLoadingKpis && user && (
            <Alert variant="destructive" className="mb-6 md:mb-8 text-left scale-fade-in delay-400">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{kpiError}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 scale-fade-in delay-300">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/inventory" className="block hover:no-underline">
                    <Card className={cn(styles.kpiCard, "shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left transform hover:-translate-y-1 bg-background/80 backdrop-blur-sm border-border/50")}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
                        <Package className="h-5 w-5 text-accent" />
                      </CardHeader>
                      <CardContent className="pb-4 px-4">
                        <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.totalItems, false, true)}</div>
                        <p className="text-xs text-muted-foreground pt-1">Currently in stock</p>
                      </CardContent>
                    </Card>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Total number of individual items currently in your inventory.</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                  <TooltipTrigger asChild>
                      <Link href="/reports" className="block hover:no-underline">
                      <Card className={cn(styles.kpiCard, "shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left transform hover:-translate-y-1 bg-background/80 backdrop-blur-sm border-border/50")}>
                          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
                          <CardTitle className="text-sm font-medium text-muted-foreground">Inventory Value</CardTitle>
                          <DollarSign className="h-5 w-5 text-accent" />
                          </CardHeader>
                          <CardContent className="pt-1 pb-2 px-4">
                            <div className="text-2xl sm:text-3xl font-bold text-primary flex items-baseline">
                                {renderKpiValue(kpiData?.inventoryValue, true)}
                                {kpiData && kpiData.inventoryValueTrend && kpiData.inventoryValueTrend.length > 1 && kpiData.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && (
                                    kpiData.inventoryValue > kpiData.inventoryValuePrevious ?
                                    <TrendingUp className="h-4 w-4 text-green-500 ml-1.5 shrink-0" /> :
                                    <TrendingDown className="h-4 w-4 text-red-500 ml-1.5 shrink-0" />
                                )}
                            </div>
                            <div className="mt-1">
                                <SparkLineChart data={kpiData?.inventoryValueTrend || []} dataKey="value" strokeColor="hsl(var(--accent))" />
                            </div>
                          </CardContent>
                      </Card>
                      </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                      <p>Total monetary value of your current inventory (cost price).</p>
                      {kpiData?.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && (
                          <p className={cn("text-xs", kpiData.inventoryValue > kpiData.inventoryValuePrevious ? "text-green-500" : "text-red-500")}>
                              vs. {formatLargeNumber(kpiData.inventoryValuePrevious, 2, true)}
                          </p>
                      )}
                  </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/reports" className="block hover:no-underline">
                    <Card className={cn(styles.kpiCard, "shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left transform hover:-translate-y-1 bg-background/80 backdrop-blur-sm border-border/50")}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Gross Profit</CardTitle>
                        <HandCoins className="h-5 w-5 text-accent" />
                      </CardHeader>
                      <CardContent className="pb-4 px-4">
                        <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.grossProfit, true)}</div>
                        <p className="text-xs text-muted-foreground pt-1">Potential from current stock</p>
                      </CardContent>
                    </Card>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Total potential gross profit if all current inventory is sold at its sale price.</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/accounts" className="block hover:no-underline">
                    <Card className={cn(styles.kpiCard, "shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left transform hover:-translate-y-1 bg-background/80 backdrop-blur-sm border-border/50")}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">This Month's Expenses</CardTitle>
                        <CreditCard className="h-5 w-5 text-destructive" />
                      </CardHeader>
                      <CardContent className="pb-4 px-4">
                        <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.currentMonthTotalExpenses, true)}</div>
                        <p className="text-xs text-muted-foreground pt-1">Total expenses this month</p>
                      </CardContent>
                    </Card>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Total expenses from invoices and other recorded business expenses for the current calendar month.</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                  <TooltipTrigger asChild>
                      <Link href="/inventory?filter=low" className="block hover:no-underline">
                          <Card className={cn(styles.kpiCard, "shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left transform hover:-translate-y-1 bg-background/80 backdrop-blur-sm border-border/50")}>
                          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                              <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock</CardTitle>
                              <AlertTriangle className="h-5 w-5 text-yellow-500 dark:text-yellow-400" />
                          </CardHeader>
                          <CardContent className="pb-4 px-4">
                              <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.lowStockItemsCount, false, true)}</div>
                              <p className="text-xs text-muted-foreground pt-1">Items needing attention</p>
                              {kpiData && typeof kpiData.totalItems === 'number' && kpiData.totalItems > 0 && typeof kpiData.lowStockItemsCount === 'number' && kpiData.lowStockItemsCount >= 0 && (
                                  <Progress
                                      value={(kpiData.lowStockItemsCount / kpiData.totalItems) * 100}
                                      className="h-2 mt-2 bg-muted/50"
                                      indicatorClassName={cn(
                                          "transition-all duration-500 ease-out",
                                          (kpiData.lowStockItemsCount / kpiData.totalItems) * 100 > 50 ? "bg-destructive" :
                                          (kpiData.lowStockItemsCount / kpiData.totalItems) * 100 > 20 ? "bg-yellow-500" :
                                          "bg-accent"
                                      )}
                                  />
                              )}
                          </CardContent>
                          </Card>
                      </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                      <p>Number of items at or below their minimum stock level.</p>
                      {kpiData && typeof kpiData.totalItems === 'number' && kpiData.totalItems > 0 && typeof kpiData.lowStockItemsCount === 'number' && kpiData.lowStockItemsCount >= 0 && (
                          <p className="text-xs">
                              {((kpiData.lowStockItemsCount / kpiData.totalItems) * 100).toFixed(1)}% of total items are low on stock.
                          </p>
                      )}
                  </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/accounts?filter=unpaid" className="block hover:no-underline">
                    <Card className={cn(styles.kpiCard, "shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left transform hover:-translate-y-1 bg-background/80 backdrop-blur-sm border-border/50")}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Amount to Pay</CardTitle>
                        <Banknote className="h-5 w-5 text-accent" />
                      </CardHeader>
                      <CardContent className="pb-4 px-4">
                        <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.amountRemainingToPay, true)}</div>
                        <p className="text-xs text-muted-foreground pt-1">Total outstanding on invoices</p>
                      </CardContent>
                    </Card>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sum of all unpaid and pending payment invoices.</p>
                </TooltipContent>
              </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
