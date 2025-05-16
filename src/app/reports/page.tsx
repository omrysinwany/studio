// src/app/reports/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Package, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Loader2, Repeat, ShoppingCart, FileTextIcon, HandCoins, BarChart3, Download, Banknote, Info, Briefcase, ListChecks, FileWarning } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Bar, BarChart, Line, LineChart, Pie, Cell, ResponsiveContainer, XAxis as RechartsXAxis, YAxis as RechartsYAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend as RechartsLegend, PieChart as RechartsPieChart } from 'recharts';
import { Button } from '@/components/ui/button';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, subMonths, startOfMonth, endOfMonth, subDays, startOfQuarter, endOfQuarter, parseISO, isValid, isWithinInterval, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getProductsService, Product, InvoiceHistoryItem, getInvoicesService, OtherExpense, getOtherExpensesService, getStorageKey, SupplierSummary, getSupplierSummariesService, UserSettings, getUserSettingsService } from '@/services/backend';
import {
    calculateInventoryValue,
    calculateTotalItems,
    getLowStockItems,
    calculateAverageOrderValue,
    calculateTotalPotentialGrossProfit
} from '@/lib/kpi-calculations';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Timestamp } from 'firebase/firestore';


const formatNumber = (
    value: number | undefined | null,
    t: (key: string, params?: Record<string, string | number>) => string,
    options?: { decimals?: number, useGrouping?: boolean, currency?: boolean }
): string => {
    const { decimals = 0, useGrouping = true, currency = false } = options || {};

    if (value === null || value === undefined || isNaN(value)) {
        const zeroFormatted = (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, {
            minimumFractionDigits: currency ? (decimals === 0 ? 0 : 2) : decimals,
            maximumFractionDigits: currency ? (decimals === 0 ? 0 : 2) : decimals,
            useGrouping: useGrouping,
        });
        return currency ? `${t('currency_symbol')}${zeroFormatted}` : zeroFormatted;
    }

    const formattedValue = value.toLocaleString(t('locale_code_for_number_formatting') || undefined, {
        minimumFractionDigits: currency ? (decimals === 0 ? 0 : 2) : decimals,
        maximumFractionDigits: currency ? (decimals === 0 ? 0 : 2) : decimals,
        useGrouping: useGrouping,
    });
    return currency ? `${t('currency_symbol')}${formattedValue}` : formattedValue;
};


const chartConfig = {
  value: { labelKey: 'reports_chart_label_value', color: 'hsl(var(--chart-1))' },
  count: { labelKey: 'reports_chart_label_count', color: 'hsl(var(--chart-2))' },
  sales: { labelKey: 'reports_chart_label_sales', color: 'hsl(var(--chart-3))' },
  quantitySold: { labelKey: 'reports_chart_label_qty_sold', color: 'hsl(var(--chart-4))'},
  documents: { labelKey: 'reports_chart_label_documents', color: 'hsl(var(--chart-5))' },
  expenses: { labelKey: 'reports_chart_label_expenses', color: 'hsl(var(--chart-1))'},
  profit: { labelKey: 'reports_profitability_profit', color: 'hsl(var(--chart-2))' },
} satisfies Omit<React.ComponentProps<typeof ChartContainer>["config"], string>;


const PIE_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
    'hsl(var(--primary))',
    'hsl(var(--accent))',
];

interface StockAlert {
  id: string;
  name: string;
  catalogNumber: string;
  quantity: number;
  status: 'Low Stock' | 'Out of Stock' | 'Over Stock';
  minStock?: number | null;
  maxStock?: number | null;
  isDefaultMinStock?: boolean;
}

interface ExpenseByCategory {
    category: string;
    totalAmount: number;
    expenses: OtherExpense[];
}
interface SupplierLiability {
    supplierName: string;
    totalDue: number;
    invoiceCount: number;
}
interface ProductProfitability {
    id: string;
    name: string;
    catalogNumber: string;
    unitPrice: number;
    salePrice?: number | null;
    potentialProfitPerUnit?: number;
    profitMarginPercent?: number;
}

export default function ReportsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();

  const [kpis, setKpis] = useState<any | null>(null);
  const [valueOverTime, setValueOverTime] = useState<any[]>([]);
  const [processingVolume, setProcessingVolume] = useState<any[]>([]);
  const [topSellingProducts, setTopSellingProducts] = useState<any[]>([]);
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);
  const [otherExpenses, setOtherExpenses] = useState<OtherExpense[]>([]);
  const [expensesByCategoryData, setExpensesByCategoryData] = useState<ExpenseByCategory[]>([]);
  const [supplierLiabilitiesData, setSupplierLiabilitiesData] = useState<SupplierLiability[]>([]);
  const [profitAndLossData, setProfitAndLossData] = useState<{income: number; expenses: number; liabilities: number; net: number} | null>(null);
  const [productProfitabilityData, setProductProfitabilityData] = useState<ProductProfitability[]>([]);
  const [isDrillDownDialogOpen, setIsDrillDownDialogOpen] = useState(false);
  const [drillDownDialogTitle, setDrillDownDialogTitle] = useState('');
  const [drillDownDialogData, setDrillDownDialogData] = useState<OtherExpense[]>([]);


  const [inventory, setInventory] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<InvoiceHistoryItem[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const { toast } = useToast();
  const isMobile = useIsMobile();


  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);


    const fetchInitialData = useCallback(async () => {
        if(!user || !user.id) return;
        setIsLoading(true);
        try {
            const [inventoryData, invoicesData, otherExpensesDataFromDb, suppliersData] = await Promise.all([
                getProductsService(user.id),
                getInvoicesService(user.id),
                getOtherExpensesService(user.id), // Fetch from Firestore
                getSupplierSummariesService(user.id)
            ]);
            setInventory(inventoryData);
            setInvoices(invoicesData);
            setOtherExpenses(otherExpensesDataFromDb);

        } catch (error) {
            console.error("Failed to fetch initial data for reports:", error);
            toast({
                title: t('reports_toast_error_fetch_title'),
                description: t('reports_toast_error_fetch_desc'),
                variant: "destructive",
            });
            setInventory([]);
            setInvoices([]);
            setOtherExpenses([]);
        } finally {
            setIsLoading(false);
        }
    }, [toast, t, user]);

    useEffect(() => {
        if(user && user.id) {
            fetchInitialData();
        }
    }, [fetchInitialData, user]);


   useEffect(() => {
     const generateReports = () => {
       if (isLoading || !user) return;

       const filteredInvoicesByDate = invoices.filter(invoice => {
         if (!invoice.uploadTime) return false;
         let invoiceDate: Date | null = null;
         if (invoice.uploadTime instanceof Timestamp) invoiceDate = invoice.uploadTime.toDate();
         else if (typeof invoice.uploadTime === 'string' && isValid(parseISO(invoice.uploadTime))) invoiceDate = parseISO(invoice.uploadTime);
         else if (invoice.uploadTime instanceof Date && isValid(invoice.uploadTime)) invoiceDate = invoice.uploadTime;
         
         if(!invoiceDate || !isValid(invoiceDate)) return false;
         return isWithinInterval(invoiceDate, {
            start: dateRange?.from || new Date(0),
            end: dateRange?.to || new Date()
         });
       });

       const filteredOtherExpensesByDate = otherExpenses.filter(expense => {
          if (!expense.date) return false;
          let expenseDate: Date | null = null;
          if (expense.date instanceof Timestamp) expenseDate = expense.date.toDate();
          else if (typeof expense.date === 'string' && isValid(parseISO(expense.date))) expenseDate = parseISO(expense.date);
          else if (expense.date instanceof Date && isValid(expense.date)) expenseDate = expense.date;

          if(!expenseDate || !isValid(expenseDate)) return false;
          return isWithinInterval(expenseDate, {
            start: dateRange?.from || new Date(0),
            end: dateRange?.to || new Date()
          });
       });


       // KPIs
       const totalValue = calculateInventoryValue(inventory);
       const totalItemsCount = calculateTotalItems(inventory);
       const lowStockItemsCount = getLowStockItems(inventory).length;
       const totalPotentialGrossProfit = calculateTotalPotentialGrossProfit(inventory);
       const averageInvoiceValue = calculateAverageOrderValue(filteredInvoicesByDate.filter(inv => inv.status === 'completed'));
       const activeSuppliers = new Set(filteredInvoicesByDate.map(inv => inv.supplierName).filter(Boolean));

       const totalInvoiceCostsPeriod = filteredInvoicesByDate
            .reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
       const totalOtherExpensesPeriod = filteredOtherExpensesByDate
            .reduce((sum, exp) => sum + exp.amount, 0);
       const totalRecordedExpensesPeriod = totalInvoiceCostsPeriod + totalOtherExpensesPeriod;

       const openInvoicesPeriod = filteredInvoicesByDate
            .filter(inv => inv.paymentStatus === 'unpaid' || inv.paymentStatus === 'pending_payment');
       const numberOfOpenInvoices = openInvoicesPeriod.length;
       const totalAmountDueFromOpenInvoices = openInvoicesPeriod
            .reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);


       setKpis({
         totalValue,
         totalItems: totalItemsCount,
         lowStockItems: lowStockItemsCount,
         totalPotentialGrossProfit,
         averageInvoiceValue,
         totalActiveSuppliers: activeSuppliers.size,
         totalInvoiceCostsPeriod,
         totalOtherExpensesPeriod,
         totalRecordedExpensesPeriod,
         numberOfOpenInvoices,
         totalAmountDueFromOpenInvoices,
       });

       // Inventory Value Over Time Chart
       const votData = [];
       let currentDateForVOT = dateRange?.from ? new Date(dateRange.from) : subMonths(new Date(), 6);
       const endDateForVOT = dateRange?.to || new Date();
       const numPointsVOT = isMobile ? 5 : 10;
       const stepDurationVOT = (endDateForVOT.getTime() - currentDateForVOT.getTime()) / Math.max(1, numPointsVOT -1);

       for(let i=0; i < numPointsVOT; i++) {
           const pointDate = new Date(currentDateForVOT.getTime() + i * stepDurationVOT);
           const monthStr = format(pointDate, "MMM dd");
           // This is a mock value for VOT as true historical inventory value is complex to track
           const invoicesUpToPointDate = invoices.filter(inv => {
               if(!inv.uploadTime) return false;
               let invDate: Date | null = null;
               if(inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
               else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
               else if (inv.uploadTime instanceof Date && isValid(inv.uploadTime)) invDate = inv.uploadTime;
               return invDate && invDate <= pointDate && inv.documentType === 'deliveryNote';
           });
           const simulatedValue = invoicesUpToPointDate.reduce((sum, inv) => sum + (inv.totalAmount || 0),0) * (0.8 + Math.random() * 0.4);
           votData.push({
               date: monthStr,
               value: simulatedValue,
           });
       }
       setValueOverTime(votData);

       // Expenses by Category Chart
       const categories = Array.from(new Set(filteredOtherExpensesByDate.map(exp => exp._internalCategoryKey || exp.category?.toLowerCase().replace(/\s+/g, '_') || 'unknown')));
        const catDistData = categories.map(catKey => {
            const categoryExpenses = filteredOtherExpensesByDate.filter(exp => (exp._internalCategoryKey || exp.category?.toLowerCase().replace(/\s+/g, '_') || 'unknown') === catKey);
            const categoryLabel = t(`accounts_other_expenses_tab_${catKey}` as any, {defaultValue: catKey.charAt(0).toUpperCase() + catKey.slice(1).replace(/_/g, ' ')});
            return {
                category: categoryLabel,
                totalAmount: categoryExpenses.reduce((sum, exp) => sum + exp.amount, 0),
                expenses: categoryExpenses
            };
        }).filter(c => c.totalAmount > 0).sort((a,b) => b.totalAmount - a.totalAmount);
       setExpensesByCategoryData(catDistData);

       // Documents Processed Chart
       const procVolData = [];
       let currentDateForProcVol = dateRange?.from ? new Date(dateRange.from) : subMonths(new Date(), 6);
       const endDateForProcVol = dateRange?.to || new Date();
       const procVolNumPoints = isMobile ? 3 : 5;
       const procVolStepDuration = (endDateForProcVol.getTime() - currentDateForProcVol.getTime()) / Math.max(1, procVolNumPoints -1);

        for(let i=0; i< procVolNumPoints; i++) {
           const pointDate = new Date(currentDateForProcVol.getTime() + i * procVolStepDuration);
           const monthStr = format(pointDate, "MMM yy");
           const count = filteredInvoicesByDate.filter(inv => {
               if(!inv.uploadTime || inv.status !== 'completed') return false;
               let invDate : Date | null = null;
               if (inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
               else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
               else if (inv.uploadTime instanceof Date && isValid(inv.uploadTime)) invDate = inv.uploadTime;
               return invDate && format(invDate, "MMM yy") === monthStr;
            }).length;
           if(!procVolData.find(d => d.period === monthStr)) {
             procVolData.push({ period: monthStr, documents: count });
           }
       }
       setProcessingVolume(procVolData);

        const topProducts = inventory
            .filter(p => p.salePrice !== undefined && p.salePrice !== null && p.salePrice > 0)
            .map(p => ({
                id: p.id,
                name: p.shortName || p.description.slice(0,25) + (p.description.length > 25 ? '...' : ''),
                quantitySold: Math.floor(Math.random() * (p.quantity > 0 ? p.quantity/2 : 5)) + 1, // Mock sales data
                totalValue: (p.salePrice || 0) * (Math.floor(Math.random() * (p.quantity > 0 ? p.quantity/2 : 5)) + 1) // Mock sales data
            }))
            .sort((a,b) => b.totalValue - a.totalValue)
            .slice(0, 5);
       setTopSellingProducts(topProducts);

       // Stock Alerts Table
        const alerts: StockAlert[] = inventory.reduce((acc, p) => {
            const minStockLevelOrDefault = p.minStockLevel ?? 10;
            const isDefaultMin = p.minStockLevel === undefined;
            const currentQuantity = p.quantity || 0;

            if (currentQuantity === 0) {
                acc.push({ id: p.id, name: p.shortName || p.description, catalogNumber: p.catalogNumber, quantity: currentQuantity, status: 'Out of Stock', minStock: p.minStockLevel, maxStock: p.maxStockLevel });
            } else if (p.maxStockLevel !== undefined && currentQuantity > p.maxStockLevel) {
                acc.push({ id: p.id, name: p.shortName || p.description, catalogNumber: p.catalogNumber, quantity: currentQuantity, status: 'Over Stock', minStock: p.minStockLevel, maxStock: p.maxStockLevel });
            } else if (currentQuantity <= minStockLevelOrDefault) {
                acc.push({ id: p.id, name: p.shortName || p.description, catalogNumber: p.catalogNumber, quantity: currentQuantity, status: 'Low Stock', minStock: p.minStockLevel, maxStock: p.maxStockLevel, isDefaultMinStock: isDefaultMin });
            }
            return acc;
        }, [] as StockAlert[]);
        setStockAlerts(alerts.sort((a, b) => {
            const statusOrder = { 'Out of Stock': 1, 'Low Stock': 2, 'Over Stock': 3 };
            return statusOrder[a.status] - statusOrder[b.status];
        }));

        // P&L Summary
        const pnlIncome = filteredInvoicesByDate
            .filter(inv => inv.paymentStatus === 'paid')
            .reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

        const pnlOperatingExpenses = filteredOtherExpensesByDate
            .reduce((sum, exp) => sum + exp.amount, 0);

        const pnlOpenLiabilities = filteredInvoicesByDate
            .filter(inv => inv.paymentStatus === 'unpaid' || inv.paymentStatus === 'pending_payment')
            .reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

        setProfitAndLossData({
            income: pnlIncome,
            expenses: pnlOperatingExpenses,
            liabilities: pnlOpenLiabilities,
            net: pnlIncome - pnlOperatingExpenses
        });

        // Supplier Liabilities
        const liabilitiesMap = new Map<string, { totalDue: number; invoiceCount: number }>();
        filteredInvoicesByDate
            .filter(inv => inv.paymentStatus === 'unpaid' || inv.paymentStatus === 'pending_payment')
            .forEach(inv => {
                if (inv.supplierName && typeof inv.supplierName === 'string') {
                    const current = liabilitiesMap.get(inv.supplierName) || { totalDue: 0, invoiceCount: 0 };
                    current.totalDue += (inv.totalAmount || 0);
                    current.invoiceCount += 1;
                    liabilitiesMap.set(inv.supplierName, current);
                }
            });
        setSupplierLiabilitiesData(
            Array.from(liabilitiesMap.entries()).map(([supplierName, data]) => ({
                supplierName,
                ...data,
            })).sort((a,b) => b.totalDue - a.totalDue)
        );

        const profitability = inventory.map(p => {
            const cost = p.unitPrice || 0;
            const sale = p.salePrice;
            let profitPerUnit: number | undefined = undefined;
            let marginPercent: number | undefined = undefined;
            if (sale !== undefined && sale !== null && sale > 0 && cost >= 0) {
                profitPerUnit = sale - cost;
                if (sale > 0) {
                  marginPercent = (profitPerUnit / sale) * 100;
                }
            }
            return {
                id: p.id,
                name: p.shortName || p.description,
                catalogNumber: p.catalogNumber,
                unitPrice: cost,
                salePrice: sale,
                potentialProfitPerUnit: profitPerUnit,
                profitMarginPercent: marginPercent
            };
        }).filter(p => p.potentialProfitPerUnit !== undefined && p.potentialProfitPerUnit >= 0);
        setProductProfitabilityData(profitability);


     };

     if (user && !isLoading) {
        generateReports();
     }
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [dateRange, inventory, invoices, otherExpenses, isLoading, isMobile, t, user]);


   const handleDatePreset = (preset: '7d' | '30d' | 'currentMonth' | 'currentQuarter') => {
        const today = new Date();
        let fromDate, toDate = today;
        switch(preset) {
            case '7d': fromDate = subDays(today, 6); break;
            case '30d': fromDate = subDays(today, 29); break;
            case 'currentMonth': fromDate = startOfMonth(today); toDate = endOfMonth(today); break;
            case 'currentQuarter': fromDate = startOfQuarter(today); toDate = endOfQuarter(today); break;
            default: fromDate = subMonths(today, 1);
        }
        setDateRange({ from: fromDate, to: toDate });
   };

   const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'number') return String(value);
        let stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          stringValue = stringValue.replace(/"/g, '""');
          return `"${stringValue}"`;
        }
        return stringValue;
    };

    const exportToCsv = (data: any[], headers: {key: string, label: string}[], filename: string) => {
        if (data.length === 0) {
            toast({ title: t('reports_toast_no_data_to_export_title'), description: t('reports_toast_no_data_to_export_desc') });
            return;
        }
        const headerRow = headers.map(h => escapeCsvValue(h.label)).join(',');
        const rows = data.map(item =>
            headers.map(h => {
                if (h.key === 'potentialProfitPerUnit' || h.key === 'profitMarginPercent' || h.key === 'unitPrice' || h.key === 'salePrice') {
                    return item[h.key] !== undefined ? formatNumber(item[h.key], t, {decimals: h.key === 'profitMarginPercent' ? 1 : 0 , currency: h.key !== 'profitMarginPercent'}) : '-';
                }
                if (h.key === 'totalDue' || h.key === 'totalAmount') {
                    return formatNumber(item[h.key], t, {currency: true, decimals: 0});
                }
                return escapeCsvValue(item[h.key]);
            }).join(',')
        );
        const csvContent = [headerRow, ...rows].join('\n');
        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast({ title: t('reports_toast_export_success_title'), description: t('reports_toast_export_success_desc', { filename: `${filename}.csv` }) });
    };

    const handlePieChartClick = (data: any) => {
        if (data && data.activePayload && data.activePayload.length > 0) {
            const clickedCategoryName = data.activePayload[0].payload.category;
            const categoryData = expensesByCategoryData.find(cat => cat.category === clickedCategoryName);
            if (categoryData) {
                setDrillDownDialogTitle(t('reports_drilldown_title_expenses_for_category', { category: clickedCategoryName }));
                setDrillDownDialogData(categoryData.expenses);
                setIsDrillDownDialogOpen(true);
            }
        }
    };


   if (authLoading || (isLoading && !kpis) || !user) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
       </div>
     );
   }


  return (
    <TooltipProvider>
    <div className="container mx-auto p-2 sm:p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-primary shrink-0 flex items-center">
            <BarChart3 className="mr-2 h-6 w-6" />
            {t('reports_title')}
        </h1>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="date"
              variant={"outline"}
              className={cn(
                "w-full md:w-auto md:min-w-[240px] justify-start text-left font-normal text-xs sm:text-sm",
                !dateRange && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "PP")} - {format(dateRange.to, "PP")}
                  </>
                ) : (
                  format(dateRange.from, "PP")
                )
              ) : (
                <span>{t('reports_date_range_placeholder')}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
             <Calendar
               initialFocus
               mode="range"
               defaultMonth={dateRange?.from}
               selected={dateRange}
               onSelect={setDateRange}
               numberOfMonths={isMobile ? 1 : 2}
             />
            {dateRange && (
                <div className="p-2 border-t flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>{t('reports_date_range_clear')}</Button>
                </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
          {(['7d', '30d', 'currentMonth', 'currentQuarter'] as const).map(preset => (
              <Button key={preset} variant="outline" size="sm" onClick={() => handleDatePreset(preset)}>
                  {t(`reports_date_preset_${preset}`)}
              </Button>
          ))}
      </div>

       {/* Main KPIs Grid */}
        <div className="grid gap-2 sm:gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {[
                { titleKey: 'reports_kpi_total_value', value: kpis?.totalValue, Icon: DollarSign, currency: true, decimals: 0 },
                { titleKey: 'reports_kpi_total_items', value: kpis?.totalItems, Icon: Package, decimals: 0 },
                { titleKey: 'reports_kpi_low_stock_items', value: kpis?.lowStockItems, Icon: AlertTriangle, decimals: 0 },
                { titleKey: 'reports_kpi_potential_gross_profit_short', value: kpis?.totalPotentialGrossProfit, Icon: HandCoins, currency: true, decimals: 0 },
                { titleKey: 'reports_kpi_avg_invoice_value_short', value: kpis?.averageInvoiceValue, Icon: FileTextIcon, currency: true, decimals: 0 },
                { titleKey: 'reports_kpi_active_suppliers_short', value: kpis?.totalActiveSuppliers, Icon: Briefcase, decimals: 0 },
                { titleKey: 'reports_kpi_total_invoice_costs_period', value: kpis?.totalInvoiceCostsPeriod, Icon: Banknote, currency: true, decimals: 0 },
                { titleKey: 'reports_kpi_total_other_expenses_period', value: kpis?.totalOtherExpensesPeriod, Icon: ListChecks, currency: true, decimals: 0 },
                { titleKey: 'reports_kpi_total_recorded_expenses_period', value: kpis?.totalRecordedExpensesPeriod, Icon: DollarSign, currency: true, decimals: 0, iconColor: "text-destructive" },
                { titleKey: 'reports_kpi_open_invoices_count_period', value: kpis?.numberOfOpenInvoices, Icon: FileWarning, decimals: 0 },
                { titleKey: 'reports_kpi_open_invoices_amount_period', value: kpis?.totalAmountDueFromOpenInvoices, Icon: Banknote, currency: true, decimals: 0, iconColor: "text-orange-500" },
            ].map((kpi, index) => (
                <Card key={index} className={cn("xl:col-span-1", index >= 9 && "lg:col-span-2 xl:col-span-3")}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-1.5 pt-2.5 px-3">
                        <CardTitle className="text-[11px] sm:text-xs font-medium">{t(kpi.titleKey)}</CardTitle>
                         <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-5 w-5 -mt-1 -mr-1 opacity-70 hover:opacity-100">
                                  <kpi.Icon className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground", kpi.iconColor)} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="end" className="max-w-xs">
                                <p className="text-xs">{t(`${kpi.titleKey}_desc` as any, {defaultValue: t('reports_kpi_default_desc')})}</p>
                            </TooltipContent>
                        </Tooltip>
                    </CardHeader>
                    <CardContent className="pb-2 sm:pb-3 px-3">
                        <div className="text-lg sm:text-xl font-bold">{formatNumber(kpi.value, t, { currency: kpi.currency, decimals: kpi.decimals })}</div>
                    </CardContent>
                </Card>
            ))}
        </div>


        {/* Product Profitability Report */}
        <Card className="w-full overflow-hidden scale-fade-in md:col-span-full" style={{animationDelay: '0.05s'}}>
            <CardHeader className="pb-2 sm:pb-4 flex flex-row items-center justify-between">
                <div className="flex items-center">
                    <CardTitle className="text-base sm:text-lg">{t('reports_profitability_title')}</CardTitle>
                    <Tooltip>
                        <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-5 w-5 ml-1.5"><Info className="h-3.5 w-3.5 text-muted-foreground"/></Button></TooltipTrigger>
                        <TooltipContent><p>{t('reports_profitability_tooltip')}</p></TooltipContent>
                    </Tooltip>
                </div>
                <Button variant="ghost" size="sm" onClick={() => exportToCsv(
                    productProfitabilityData,
                    [
                        {key: 'name', label: t('reports_col_product')},
                        {key: 'catalogNumber', label: t('reports_col_catalog')},
                        {key: 'unitPrice', label: t('reports_col_unit_price_cost')},
                        {key: 'salePrice', label: t('reports_col_sale_price')},
                        {key: 'potentialProfitPerUnit', label: t('reports_col_profit_per_unit')},
                        {key: 'profitMarginPercent', label: t('reports_col_profit_margin_percent')},
                    ],
                    'product_profitability_report'
                )} disabled={productProfitabilityData.length === 0} className="text-xs">
                    <Download className="mr-1 h-3 w-3" /> {t('reports_export_csv_button')}
                </Button>
            </CardHeader>
            <CardContent className="p-0">
                {productProfitabilityData.length > 0 ? (
                    <div className="overflow-x-auto">
                        <Table className="min-w-full">
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_product')}</TableHead>
                                    <TableHead className="text-[10px] sm:text-xs hidden md:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_catalog')}</TableHead>
                                    <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_unit_price_cost')}</TableHead>
                                    <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_sale_price')}</TableHead>
                                    <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_profit_per_unit')}</TableHead>
                                    <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_profit_margin_percent')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {productProfitabilityData.slice(0, isMobile ? 5 : 10).map((p) => (
                                    <TableRow key={p.id}>
                                        <TableCell className="font-medium text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5 truncate max-w-[100px] sm:max-w-xs">{p.name}</TableCell>
                                        <TableCell className="text-[10px] sm:text-xs hidden md:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{p.catalogNumber}</TableCell>
                                        <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(p.unitPrice, t, {currency: true, decimals: 0})}</TableCell>
                                        <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{p.salePrice !== undefined && p.salePrice !== null ? formatNumber(p.salePrice, t, {currency: true, decimals: 0}) : '-'}</TableCell>
                                        <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{p.potentialProfitPerUnit !== undefined ? formatNumber(p.potentialProfitPerUnit, t, {currency: true, decimals: 0}) : '-'}</TableCell>
                                        <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{p.profitMarginPercent !== undefined ? `${formatNumber(p.profitMarginPercent, t, {decimals:1})}%` : '-'}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_profitability_no_data')}</p>
                )}
            </CardContent>
        </Card>


        <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.1s'}}>
                <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base sm:text-lg">{t('reports_chart_value_over_time_title')}</CardTitle>
                     <CardDescription>{t('reports_chart_value_over_time_desc')}</CardDescription>
                </CardHeader>
                <CardContent className="p-0 sm:p-0">
                    {valueOverTime.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[180px] sm:h-[220px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={valueOverTime} margin={{ top: 5, right: isMobile ? 5 : 15, left: isMobile ? -25 : -10, bottom: isMobile ? 30 : 20 }}>
                                     <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                                     <RechartsXAxis
                                        dataKey="date"
                                        stroke="hsl(var(--muted-foreground))"
                                        fontSize={isMobile ? 8 : 10}
                                        tickLine={false}
                                        axisLine={false}
                                        angle={isMobile ? -60 : -45}
                                        textAnchor="end"
                                        height={isMobile ? 40 : 30}
                                        interval={isMobile ? Math.max(0, Math.floor(valueOverTime.length / 3) -1) : "preserveStartEnd"}
                                     />
                                     <RechartsYAxis
                                        stroke="hsl(var(--muted-foreground))"
                                        fontSize={isMobile ? 8 : 10}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => `${t('currency_symbol')}${formatNumber(value / 1000, t, { decimals: 0})}k`}
                                        width={isMobile ? 30 : 40}
                                     />
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="line" />}
                                        formatter={(value: number) => formatNumber(value, t, { currency: true, decimals: 0 })}
                                    />
                                    <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name={t(chartConfig.value.labelKey)}/>
                                </LineChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                    ) : (
                       <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_chart_no_value_trend_data')}</p>
                    )}
                </CardContent>
            </Card>

            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.2s'}}>
                 <CardHeader className="pb-2 sm:pb-4">
                     <CardTitle className="text-base sm:text-lg">{t('reports_chart_docs_processed_title')}</CardTitle>
                     <CardDescription>{t('reports_chart_docs_processed_desc')}</CardDescription>
                 </CardHeader>
                 <CardContent className="p-0 sm:p-0">
                      {processingVolume.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[180px] sm:h-[220px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={processingVolume} margin={{ top: 5, right: isMobile ? 0 : 5, left: isMobile ? -20 : -15, bottom: isMobile ? 30 : 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                                    <RechartsXAxis
                                        dataKey="period"
                                        stroke="hsl(var(--muted-foreground))"
                                        fontSize={isMobile ? 8 : 10}
                                        tickLine={false}
                                        axisLine={false}
                                        angle={isMobile ? -60 : -45}
                                        textAnchor="end"
                                        height={isMobile ? 40 : 30}
                                        interval={isMobile ? Math.max(0, Math.floor(processingVolume.length / 2) -1) : "preserveStartEnd"}
                                    />
                                     <RechartsYAxis
                                        stroke="hsl(var(--muted-foreground))"
                                        fontSize={isMobile ? 8 : 10}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => formatNumber(value, t, { decimals: 0, useGrouping: true })}
                                        width={isMobile ? 25 : 30}
                                     />
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="dot" hideLabel />}
                                        formatter={(value: number) => formatNumber(value, t, { decimals: 0, useGrouping: true })}
                                     />
                                    <Bar dataKey="documents" fill="var(--color-documents)" radius={isMobile ? 2 : 3} barSize={isMobile ? 10 : undefined} name={t(chartConfig.documents.labelKey)}/>
                                </BarChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                     ) : (
                        <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_chart_no_processing_volume_data')}</p>
                     )}
                 </CardContent>
            </Card>

            <Card className="w-full overflow-hidden scale-fade-in md:col-span-full lg:col-span-2" style={{animationDelay: '0.3s'}}>
                 <CardHeader className="pb-2 sm:pb-4 flex flex-row items-center justify-between">
                     <div className="flex items-center">
                        <CardTitle className="text-base sm:text-lg">{t('reports_expenses_by_category_title')}</CardTitle>
                        <Tooltip>
                            <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-5 w-5 ml-1.5"><Info className="h-3.5 w-3.5 text-muted-foreground"/></Button></TooltipTrigger>
                            <TooltipContent><p>{t('reports_expenses_by_category_tooltip')}</p></TooltipContent>
                        </Tooltip>
                    </div>
                     <Button
                        variant="ghost" size="sm"
                        onClick={() => exportToCsv(
                            expensesByCategoryData,
                            [{key: 'category', label: t('reports_col_category')}, {key: 'totalAmount', label: t('reports_col_total_amount')}],
                            'expenses_by_category'
                        )}
                        disabled={expensesByCategoryData.length === 0}
                        className="text-xs"
                    >
                         <Download className="mr-1 h-3 w-3" /> {t('reports_export_csv_button')}
                     </Button>
                 </CardHeader>
                 <CardContent className="p-0 sm:p-0">
                     {expensesByCategoryData.length > 0 ? (
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-4 items-center">
                             <div className={cn("md:col-span-1 max-h-[280px] overflow-y-auto px-2 py-2 md:py-0", isMobile && "w-full")}>
                                 <Table>
                                     <TableHeader>
                                         <TableRow>
                                             <TableHead className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_category')}</TableHead>
                                             <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_total_amount')}</TableHead>
                                         </TableRow>
                                     </TableHeader>
                                     <TableBody>
                                         {expensesByCategoryData.map(item => (
                                             <TableRow key={item.category}>
                                                 <TableCell className="font-medium text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{item.category}</TableCell>
                                                 <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(item.totalAmount, t, {currency: true, decimals: 0})}</TableCell>
                                             </TableRow>
                                         ))}
                                     </TableBody>
                                 </Table>
                             </div>
                             <div className={cn("md:col-span-1 flex items-center justify-center p-0 sm:pb-2 h-[180px] sm:h-[220px]", isMobile && expensesByCategoryData.length > 0 && "mt-2", expensesByCategoryData.length === 0 && "md:col-span-2 flex items-center justify-center")}>
                                  <ChartContainer config={chartConfig} className="mx-auto aspect-square h-full w-full">
                                       <ResponsiveContainer width="100%" height="100%">
                                            <RechartsPieChart onClick={handlePieChartClick}>
                                                 <RechartsTooltip
                                                     cursor={true}
                                                     content={<ChartTooltipContent hideLabel indicator="dot" />}
                                                     formatter={(value: number, name) => [`${name}: ${formatNumber(value, t, { currency: true, decimals: 0 })}`]}
                                                 />
                                                 <Pie
                                                     data={expensesByCategoryData}
                                                     dataKey="totalAmount"
                                                     nameKey="category"
                                                     cx="50%"
                                                     cy="50%"
                                                     outerRadius={isMobile ? "70%" : "80%"}
                                                     innerRadius={isMobile ? "45%" : "50%"}
                                                     paddingAngle={1}
                                                     labelLine={false}
                                                     label={isMobile ? undefined : ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }) => {
                                                         const RADIAN = Math.PI / 180;
                                                         const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                                                         const x = cx + radius * Math.cos(-midAngle * RADIAN);
                                                         const y = cy + radius * Math.sin(-midAngle * RADIAN);
                                                         return (percent * 100) > 5 ? (
                                                             <text x={x} y={y} fill="hsl(var(--primary-foreground))" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize="10px">
                                                                 {`${(percent * 100).toFixed(0)}%`}
                                                             </text>
                                                         ) : null;
                                                     }}
                                                 >
                                                     {expensesByCategoryData.map((entry, index) => (
                                                         <Cell key={`cell-expense-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                      ))}
                                                  </Pie>
                                                 <RechartsLegend
                                                     content={({ payload }) => (
                                                         <ul className="flex flex-wrap justify-center gap-x-1.5 gap-y-0.5 mt-1 text-[9px] sm:text-[10px]">
                                                             {payload?.map((entry, index) => (
                                                                 <li key={`item-expense-${index}`} className="flex items-center gap-1.5">
                                                                     <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                                     {entry.value}
                                                                 </li>
                                                             ))}
                                                         </ul>
                                                     )}
                                                      verticalAlign="bottom"
                                                      align="center"
                                                      wrapperStyle={{ fontSize: isMobile ? '8px' : '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: '5px', paddingRight: '5px' }}
                                                  />
                                              </RechartsPieChart>
                                       </ResponsiveContainer>
                                   </ChartContainer>
                             </div>
                         </div>
                     ) : (
                         <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_chart_no_expenses_by_category_data')}</p>
                     )}
                 </CardContent>
            </Card>

            <Card className="md:col-span-full lg:col-span-1 w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.4s'}}>
                 <CardHeader className="pb-2 sm:pb-4 flex flex-row items-center justify-between">
                     <CardTitle className="text-base sm:text-lg">{t('reports_table_top_selling_title')}</CardTitle>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => exportToCsv(
                            topSellingProducts,
                            [{key: 'name', label: t('reports_table_col_product')}, {key: 'quantitySold', label: t('reports_table_col_qty_sold')}, {key: 'totalValue', label: t('reports_table_col_total_value')}],
                            'top_selling_products'
                        )}
                        disabled={topSellingProducts.length === 0}
                        className="text-xs"
                    >
                         <Download className="mr-1 h-3 w-3" /> {t('reports_export_csv_button')}
                     </Button>
                 </CardHeader>
                 <CardContent className="p-0">
                     {topSellingProducts.length > 0 ? (
                          <div className="overflow-x-auto">
                             <Table className="min-w-full">
                                 <TableHeader>
                                     <TableRow>
                                         <TableHead className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_product')}</TableHead>
                                         <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_qty_sold')}</TableHead>
                                         <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_total_value')}</TableHead>
                                     </TableRow>
                                 </TableHeader>
                                 <TableBody>
                                     {topSellingProducts.map((product, index) => (
                                         <TableRow key={product.id || index}>
                                             <TableCell className="font-medium text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5 truncate max-w-[100px] sm:max-w-xs">{product.name}</TableCell>
                                             <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(product.quantitySold, t, { decimals: 0 })}</TableCell>
                                             <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(product.totalValue, t, { currency: true, decimals: 0 })}</TableCell>
                                         </TableRow>
                                     ))}
                                 </TableBody>
                             </Table>
                         </div>
                     ) : (
                         <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_table_no_top_selling_data')}</p>
                     )}
                 </CardContent>
            </Card>

            <Card className="md:col-span-full lg:col-span-1 w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.5s'}}>
                 <CardHeader className="pb-2 sm:pb-4 flex flex-col">
                     <div className="flex items-center justify-between">
                        <CardTitle className="text-base sm:text-lg">{t('reports_pnl_summary_title')}</CardTitle>
                        <Tooltip>
                            <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-5 w-5"><Info className="h-3.5 w-3.5 text-muted-foreground"/></Button></TooltipTrigger>
                            <TooltipContent><p>{t('reports_pnl_summary_tooltip')}</p></TooltipContent>
                        </Tooltip>
                    </div>
                    <CardDescription className="text-xs text-muted-foreground">{t('reports_pnl_summary_desc')}</CardDescription>
                 </CardHeader>
                 <CardContent className="space-y-2">
                     {profitAndLossData ? (
                         <>
                            <div className="flex justify-between text-sm items-center py-1 border-b">
                                <span className="text-muted-foreground">{t('reports_pnl_income')}</span>
                                <span className="font-semibold">{formatNumber(profitAndLossData.income, t, {currency: true, decimals: 0})}</span>
                            </div>
                            <div className="flex justify-between text-sm items-center py-1 border-b">
                                <span className="text-muted-foreground">{t('reports_pnl_operating_expenses')}</span>
                                <span className="font-semibold">{formatNumber(profitAndLossData.expenses, t, {currency: true, decimals: 0})}</span>
                            </div>
                            <div className="flex justify-between text-sm items-center py-1 border-b">
                                <span className="text-muted-foreground">{t('reports_pnl_open_liabilities')}</span>
                                <span className="font-semibold">{formatNumber(profitAndLossData.liabilities, t, {currency: true, decimals: 0})}</span>
                            </div>
                            <div className={cn("flex justify-between text-base font-semibold items-center py-1.5", profitAndLossData.net < 0 && "text-destructive")}>
                                <span>{t('reports_pnl_net_profit_loss')}</span>
                                <span>{formatNumber(profitAndLossData.net, t, {currency: true, decimals: 0})}</span>
                            </div>
                         </>
                     ) : (
                        <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_pnl_no_data')}</p>
                     )}
                 </CardContent>
            </Card>

            <Card className="md:col-span-full lg:col-span-1 w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.6s'}}>
                <CardHeader className="pb-2 sm:pb-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-base sm:text-lg">{t('reports_supplier_liabilities_title')}</CardTitle>
                     <Button
                        variant="ghost" size="sm"
                        onClick={() => exportToCsv(
                            supplierLiabilitiesData,
                            [{key: 'supplierName', label: t('reports_col_supplier')}, {key: 'totalDue', label: t('reports_col_total_due')}, {key: 'invoiceCount', label: t('reports_col_invoice_count')}],
                            'supplier_liabilities'
                        )}
                        disabled={supplierLiabilitiesData.length === 0}
                        className="text-xs"
                    >
                         <Download className="mr-1 h-3 w-3" /> {t('reports_export_csv_button')}
                     </Button>
                </CardHeader>
                <CardContent className="p-0 max-h-[280px] overflow-y-auto">
                    {supplierLiabilitiesData.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_supplier')}</TableHead>
                                    <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_total_due')}</TableHead>
                                    <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_col_invoice_count')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {supplierLiabilitiesData.map(item => (
                                    <TableRow key={item.supplierName}>
                                        <TableCell className="font-medium text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{item.supplierName}</TableCell>
                                        <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(item.totalDue, t, {currency: true, decimals: 0})}</TableCell>
                                        <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{item.invoiceCount}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_no_supplier_liabilities_data')}</p>
                    )}
                </CardContent>
            </Card>

            <Card className="md:col-span-full lg:col-span-2 w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.7s'}}>
                <CardHeader className="pb-2 sm:pb-4 flex flex-row items-center justify-between">
                    <div className="flex items-center">
                        <CardTitle className="text-base sm:text-lg">{t('reports_table_stock_alert_title')}</CardTitle>
                         <Tooltip>
                            <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-5 w-5 ml-1.5"><Info className="h-3.5 w-3.5 text-muted-foreground"/></Button></TooltipTrigger>
                            <TooltipContent><p>{t('reports_stock_alerts_tooltip')}</p></TooltipContent>
                        </Tooltip>
                    </div>
                     <Button
                        variant="ghost" size="sm"
                        onClick={() => exportToCsv(
                            stockAlerts,
                            [
                                {key: 'name', label: t('reports_table_col_product')},
                                {key: 'catalogNumber', label: t('reports_table_col_catalog')},
                                {key: 'quantity', label: t('reports_table_col_current_qty')},
                                {key: 'minStock', label: t('reports_table_col_min_stock')},
                                {key: 'maxStock', label: t('reports_table_col_max_stock')},
                                {key: 'status', label: t('reports_table_col_status')},
                            ],
                            'stock_alerts'
                        )}
                        disabled={stockAlerts.length === 0}
                        className="text-xs"
                    >
                         <Download className="mr-1 h-3 w-3" /> {t('reports_export_csv_button')}
                     </Button>
                </CardHeader>
                <CardContent className="p-0 max-h-[320px] overflow-y-auto">
                    {stockAlerts.length > 0 ? (
                        <div className="overflow-x-auto">
                            <Table className="min-w-full">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_product')}</TableHead>
                                        <TableHead className="text-[10px] sm:text-xs hidden md:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_catalog')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_current_qty')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_min_stock')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_max_stock')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_status')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {stockAlerts.map((alert) => (
                                        <TableRow key={alert.id}>
                                            <TableCell className="font-medium text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5 truncate max-w-[100px] sm:max-w-xs">{alert.name}</TableCell>
                                            <TableCell className="text-[10px] sm:text-xs hidden md:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{alert.catalogNumber}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(alert.quantity, t, { decimals: 0 })}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">
                                                {alert.isDefaultMinStock && alert.status === 'Low Stock'
                                                    ? `${formatNumber(10, t, { decimals: 0 })} (${t('reports_default_min_stock_suffix')})`
                                                    : (alert.minStock !== undefined && alert.minStock !== null ? formatNumber(alert.minStock, t, { decimals: 0 }) : '-')}
                                            </TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{alert.maxStock !== undefined && alert.maxStock !== null ? formatNumber(alert.maxStock, t, { decimals: 0 }) : '-'}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">
                                                <Badge variant={alert.status === 'Out of Stock' ? 'destructive' : (alert.status === 'Over Stock' ? 'default' : 'secondary')}
                                                    className={cn(
                                                        "whitespace-nowrap text-[8px] sm:text-[10px] px-1 sm:px-1.5 py-0.5",
                                                        alert.status === 'Low Stock' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80',
                                                        alert.status === 'Over Stock' && 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 hover:bg-orange-100/80'
                                                    )}
                                                >
                                                    <AlertTriangle className="mr-0.5 sm:mr-1 h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                                    {t(`reports_stock_status_${alert.status.toLowerCase().replace(/ /g, '_')}` as any) || alert.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                         <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_table_no_stock_alerts')}</p>
                    )}
                </CardContent>
            </Card>
        </div>
         <Dialog open={isDrillDownDialogOpen} onOpenChange={setIsDrillDownDialogOpen}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{drillDownDialogTitle}</DialogTitle>
                    <DialogDescription>{t('reports_drilldown_desc_expenses_list')}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh]">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('reports_drilldown_col_description')}</TableHead>
                                <TableHead>{t('reports_drilldown_col_date')}</TableHead>
                                <TableHead className="text-right">{t('reports_drilldown_col_amount')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {drillDownDialogData.map((expense) => (
                                <TableRow key={expense.id}>
                                    <TableCell>{expense.description}</TableCell>
                                    <TableCell>{expense.date instanceof Timestamp ? format(expense.date.toDate(), 'PP') : (typeof expense.date === 'string' && isValid(parseISO(expense.date)) ? format(parseISO(expense.date), 'PP') : t('invoices_invalid_date'))}</TableCell>
                                    <TableCell className="text-right">{formatNumber(expense.amount, t, {currency: true, decimals: 0})}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    </div>
    </TooltipProvider>
  );
}

