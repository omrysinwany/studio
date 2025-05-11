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
import { Loader2, CreditCard, AlertTriangle, CalendarClock, CalendarDays, TrendingDown as TrendingDownIcon, DollarSign, Info, Landmark, PlusCircle, BarChart3 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getInvoicesService, type InvoiceHistoryItem } from '@/services/backend';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


interface OtherExpense {
  id: string;
  category: string; // Changed to string to support dynamic categories
  description: string;
  amount: number;
  date: string; // ISO date string
}

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

  // Initialize with default categories, but no static expenses
  const [expenseCategories, setExpenseCategories] = useState<string[]>([
    'electricity', 'water', 'arnona'
  ]);
  const [otherExpenses, setOtherExpenses] = useState<OtherExpense[]>([]); // No static expenses
  const [activeExpenseTab, setActiveExpenseTab] = useState<string>(expenseCategories[0]);


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
    if (authLoading) return;
    if (!user) {
      router.push('/login');
    } else {
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

      <Card className="shadow-md scale-fade-in delay-400">
          <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center">
                <Landmark className="mr-2 h-5 w-5" /> {t('accounts_other_expenses_title')}
              </CardTitle>
              <CardDescription>{t('accounts_other_expenses_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Tabs defaultValue={activeExpenseTab} onValueChange={setActiveExpenseTab} className="w-full sm:w-auto">
                <TabsList className="inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
                  {expenseCategories.map(category => (
                      <TabsTrigger
                          key={category}
                          value={category}
                          className="data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-3 py-1.5 text-sm font-medium transition-all flex-1 sm:flex-none whitespace-nowrap"
                      >
                        {t(`accounts_other_expenses_tab_${category}` as any) || category.charAt(0).toUpperCase() + category.slice(1)}
                      </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Button variant="outline" size="icon" disabled className="ml-2 flex-shrink-0">
                <PlusCircle className="h-4 w-4" />
                <span className="sr-only">{t('accounts_add_category_button')}</span>
              </Button>
            </div>
            {expenseCategories.map(category => (
              <TabsContent key={category} value={category} className={cn(activeExpenseTab === category ? "block" : "hidden", "mt-4")}>
                <div className="space-y-2">
                  {otherExpenses.filter(exp => exp.category === category).length > 0 ? (
                    otherExpenses.filter(exp => exp.category === category)
                      .sort((a,b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())
                      .map(expense => (
                        <div key={expense.id} className="flex justify-between items-center p-3 border rounded-md bg-background shadow-sm hover:shadow-md transition-shadow">
                          <div>
                            <p className="text-sm font-medium">{expense.description}</p>
                            <p className="text-xs text-muted-foreground">{formatDateDisplay(expense.date)}</p>
                          </div>
                          <p className="text-sm font-semibold">{formatCurrency(expense.amount)}</p>
                        </div>
                      ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('accounts_other_expenses_no_expenses_in_category')}</p>
                  )}
                </div>
              </TabsContent>
            ))}
            <div className="flex flex-col sm:flex-row justify-end pt-2 gap-2">
              <Button variant="outline" disabled className="w-full sm:w-auto">
                  <PlusCircle className="mr-2 h-4 w-4" /> {t('accounts_add_expense_button')}
              </Button>
            </div>
          </CardContent>
      </Card>

      <Card className="shadow-md scale-fade-in delay-500">
          <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center">
                <DollarSign className="mr-2 h-5 w-5" /> {t('accounts_cash_flow_profitability_title')}
              </CardTitle>
              <CardDescription>{t('accounts_cash_flow_profitability_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <div>
                <h3 className="text-md font-semibold text-muted-foreground">{t('accounts_cash_flow_analysis_title')}</h3>
                <p className="text-sm text-muted-foreground">{t('settings_more_coming_soon')}</p>
              </div>
              <Separator />
              <div>
                <h3 className="text-md font-semibold text-muted-foreground">{t('accounts_predictive_balance_title')}</h3>
                <p className="text-sm text-muted-foreground">{t('settings_more_coming_soon')}</p>
              </div>
          </CardContent>
      </Card>
    </div>
  );
}
