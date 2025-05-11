// src/app/accounts/page.tsx
'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button'; 
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'; 
import { Calendar } from '@/components/ui/calendar'; 
import type { DateRange } from 'react-day-picker'; 
import { format, parseISO, differenceInCalendarDays, isPast, isToday, startOfMonth, endOfMonth } from 'date-fns'; 
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2, CreditCard, AlertTriangle, CalendarClock, BarChartHorizontalBig, CalendarDays, TrendingDown as TrendingDownIcon } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getInvoicesService, type InvoiceHistoryItem } from '@/services/backend';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend as RechartsLegend } from 'recharts';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { useToast } from '@/hooks/use-toast';


interface SupplierSpending {
  name: string;
  totalAmount: number;
}

const supplierChartConfig = {
  totalAmount: {
    labelKey: 'accounts_total_amount_spent_short', 
    color: "hsl(var(--chart-1))",
  },
} satisfies React.ComponentProps<typeof ChartContainer>["config"];


export default function AccountsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [allInvoices, setAllInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

  const fetchAccountData = async () => {
    if (!user) return;
    setIsLoadingData(true);
    try {
      const invoices = await getInvoicesService(user.id);
      setAllInvoices(invoices);
    } catch (error) {
      console.error("Failed to fetch account data:", error);
      toast({
          title: t('error_title'),
          description: t('reports_toast_error_fetch_desc'), 
          variant: "destructive"
      });
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    } else if (user) {
      fetchAccountData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router]);

  const filteredInvoices = useMemo(() => {
    if (!dateRange?.from) return allInvoices; 
    const startDate = new Date(dateRange.from);
    startDate.setHours(0, 0, 0, 0);
    const endDate = dateRange.to ? new Date(dateRange.to) : new Date();
    endDate.setHours(23, 59, 59, 999);

    return allInvoices.filter(invoice => {
      if (!invoice.uploadTime) return false;
      const invoiceDate = parseISO(invoice.uploadTime as string);
      return invoiceDate >= startDate && invoiceDate <= endDate;
    });
  }, [allInvoices, dateRange]);


  const openInvoices = useMemo(() => {
    return filteredInvoices
      .filter(invoice => invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'pending_payment')
      .sort((a, b) => {
        const dateA = a.paymentDueDate ? parseISO(a.paymentDueDate as string).getTime() : Infinity;
        const dateB = b.paymentDueDate ? parseISO(b.paymentDueDate as string).getTime() : Infinity;
        return dateA - dateB;
      });
  }, [filteredInvoices]);

  const supplierSpendingData = useMemo(() => {
    const spendingMap = new Map<string, number>();
    filteredInvoices.forEach(invoice => {
      if (invoice.supplier && typeof invoice.supplier === 'string' && invoice.totalAmount !== undefined && typeof invoice.totalAmount === 'number') {
        spendingMap.set(
          invoice.supplier,
          (spendingMap.get(invoice.supplier) || 0) + invoice.totalAmount
        );
      }
    });
    return Array.from(spendingMap.entries())
      .map(([name, totalAmount]) => ({ name, totalAmount }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredInvoices]);

  const currentMonthExpenses = useMemo(() => {
    const currentMonthStart = startOfMonth(new Date());
    const currentMonthEnd = endOfMonth(new Date());

    return allInvoices
        .filter(invoice => {
            if (!invoice.uploadTime) return false;
            const invoiceDate = parseISO(invoice.uploadTime as string);
            return invoiceDate >= currentMonthStart && invoiceDate <= currentMonthEnd;
        })
        .reduce((sum, invoice) => sum + (invoice.totalAmount || 0), 0);
  }, [allInvoices]);


  const getDueDateStatus = (dueDate: string | Date | undefined): { textKey: string; params?: Record<string, any>; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon?: React.ElementType } | null => {
    if (!dueDate) return null;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDateObj = parseISO(dueDate as string);
     dueDateObj.setHours(0,0,0,0);

    if (isPast(dueDateObj) && !isToday(dueDateObj)) {
      return { textKey: 'accounts_due_date_overdue', variant: 'destructive', icon: AlertTriangle };
    }
    
    const daysUntilDue = differenceInCalendarDays(dueDateObj, today);

    if (daysUntilDue <= 0) { 
         return { textKey: 'accounts_due_date_due_today', variant: 'destructive', icon: AlertTriangle };
    }
    if (daysUntilDue <= 7) {
      return { textKey: 'accounts_due_date_upcoming_soon', params: { days: daysUntilDue }, variant: 'secondary', icon: CalendarClock };
    }
    
    return null; 
  };
  
  const formatDateDisplay = (dateString: string | Date | undefined, formatStr: string = 'PP') => {
    if (!dateString) return t('invoices_na');
    try {
      return format(parseISO(dateString as string), formatStr);
    } catch (e) {
      return t('invoices_invalid_date');
    }
  };

  const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null) return t('invoices_na');
    return `${t('currency_symbol')}${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  };

  if (authLoading || (!user && !authLoading)) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }
  if (!user) return null;


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md scale-fade-in">
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
                <CardTitle className="text-2xl font-semibold text-primary flex items-center">
                    <CreditCard className="mr-2 h-6 w-6" /> {t('accounts_page_title')}
                </CardTitle>
                <CardDescription>{t('accounts_page_description')}</CardDescription>
            </div>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                        "w-full sm:w-auto sm:min-w-[260px] justify-start text-left font-normal",
                        !dateRange && "text-muted-foreground"
                        )}
                    >
                        <CalendarDays className="mr-2 h-4 w-4" />
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
                        numberOfMonths={2}
                    />
                     {dateRange && (
                        <div className="p-2 border-t flex justify-end">
                            <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>{t('reports_date_range_clear')}</Button>
                        </div>
                     )}
                </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
      </Card>

      <Card className="shadow-md scale-fade-in delay-100">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary flex items-center">
            <AlertTriangle className="mr-2 h-5 w-5 text-amber-500" /> {t('accounts_open_invoices_title')}
          </CardTitle>
          <CardDescription>{t('accounts_open_invoices_desc_period')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingData ? (
            <div className="flex justify-center items-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
            </div>
          ) : openInvoices.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">{t('accounts_no_open_invoices_period')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('invoice_details_supplier_label')}</TableHead>
                    <TableHead>{t('invoice_details_invoice_number_label')}</TableHead>
                    <TableHead className="text-right">{t('invoice_details_total_amount_label')}</TableHead>
                    <TableHead className="text-center">{t('payment_due_date_dialog_title')}</TableHead>
                    <TableHead className="text-center">{t('accounts_due_date_alert_column')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openInvoices.map((invoice) => {
                    const dueDateStatus = getDueDateStatus(invoice.paymentDueDate);
                    const IconComponent = dueDateStatus?.icon;
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{invoice.supplier || t('invoices_na')}</TableCell>
                        <TableCell>{invoice.invoiceNumber || t('invoices_na')}</TableCell>
                        <TableCell className="text-right">{formatCurrency(invoice.totalAmount)}</TableCell>
                        <TableCell className="text-center">{formatDateDisplay(invoice.paymentDueDate)}</TableCell>
                        <TableCell className="text-center">
                          {dueDateStatus && (
                            <Badge variant={dueDateStatus.variant} className="text-xs">
                              {IconComponent && <IconComponent className="mr-1 h-3.5 w-3.5" />}
                              {t(dueDateStatus.textKey, dueDateStatus.params)}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      
      <Card className="shadow-md scale-fade-in delay-200">
        <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
                <TrendingDownIcon className="mr-2 h-5 w-5 text-red-500" /> {t('accounts_current_month_expenses_title')}
            </CardTitle>
            <CardDescription>{t('accounts_current_month_expenses_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
            {isLoadingData ? (
                 <div className="flex justify-center items-center py-6">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                 </div>
            ) : (
                <p className="text-3xl font-bold">{formatCurrency(currentMonthExpenses)}</p>
            )}
        </CardContent>
      </Card>

      <Card className="shadow-md scale-fade-in delay-300">
        <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
                <BarChartHorizontalBig className="mr-2 h-5 w-5" /> {t('accounts_supplier_spending_title')}
            </CardTitle>
            <CardDescription>{t('accounts_supplier_spending_desc_period')}</CardDescription>
        </CardHeader>
        <CardContent>
            {isLoadingData ? (
                <div className="flex justify-center items-center py-10">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
                </div>
            ) : supplierSpendingData.length === 0 ? (
                <p className="text-muted-foreground text-center py-6">{t('accounts_no_spending_data_period')}</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="overflow-x-auto max-h-[350px]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('invoice_details_supplier_label')}</TableHead>
                                    <TableHead className="text-right">{t('invoice_details_total_amount_label')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {supplierSpendingData.slice(0, 10).map(item => ( 
                                    <TableRow key={item.name}>
                                        <TableCell className="font-medium">{item.name}</TableCell>
                                        <TableCell className="text-right">{formatCurrency(item.totalAmount)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="h-[300px] md:h-[350px]"> 
                        <ChartContainer config={supplierChartConfig} className="w-full h-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={supplierSpendingData.slice(0, 10)} layout="vertical" margin={{top: 5, right: 30, left: 20, bottom: 20}}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                    <XAxis type="number" tickFormatter={(value) => `${t('currency_symbol')}${value/1000}k`} fontSize={10} />
                                    <YAxis dataKey="name" type="category" width={80} tick={{fontSize: 10, dy: 5 }} interval={0} />
                                    <RechartsTooltip
                                        content={<ChartTooltipContent indicator="dot" hideLabel />}
                                        formatter={(value: number) => [formatCurrency(value), t(supplierChartConfig.totalAmount.labelKey) ]}
                                    />
                                     <RechartsLegend verticalAlign="top" content={({ payload }) => (
                                        <ul className="flex flex-wrap justify-center gap-x-4 text-xs text-muted-foreground">
                                            {payload?.map((entry, index) => (
                                                <li key={`item-${index}`} className="flex items-center gap-1.5">
                                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                                                    {t(supplierChartConfig.totalAmount.labelKey)}
                                                </li>
                                            ))}
                                        </ul>
                                    )}/>
                                    <Bar dataKey="totalAmount" fill="var(--color-totalAmount)" radius={[0, 4, 4, 0]} barSize={15}/>
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartContainer>
                    </div>
                </div>
            )}
        </CardContent>
      </Card>

      <Card className="shadow-md scale-fade-in delay-400">
          <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center">
                  {t('accounts_cash_flow_title')}
              </CardTitle>
              <CardDescription>{t('accounts_cash_flow_desc_period_placeholder')}</CardDescription>
          </CardHeader>
          <CardContent>
              <p className="text-muted-foreground text-center py-10">{t('settings_more_coming_soon')}</p>
          </CardContent>
      </Card>
    </div>
  );
}

