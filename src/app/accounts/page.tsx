// src/app/accounts/page.tsx
'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import { format, parseISO, differenceInCalendarDays, isPast, isToday, startOfMonth, endOfMonth, isValid, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link'; // Import Link
import { Loader2, CreditCard, AlertTriangle, CalendarClock, CalendarDays, TrendingDown as TrendingDownIcon, DollarSign, Info, Landmark, BarChart3, ArrowRightCircle, Edit2, Save, Target, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getInvoicesService, type InvoiceHistoryItem } from '@/services/backend';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';


export interface OtherExpense {
  id: string;
  category: string;
  _internalCategoryKey?: string;
  description: string;
  amount: number;
  date: string; // ISO date string
}

export interface ExpenseTemplate {
  id: string; // Unique ID for the template
  name: string; // User-defined name for the template
  category: string;
  description: string;
  amount: number;
}

const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses';
const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget';
const ITEMS_PER_PAGE_OPEN_INVOICES = 4;


const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(`[getStorageKey AccountsPage] Attempted to get storage key for base "${baseKey}" without a userId.`);
    return baseKey;
  }
  return `${baseKey}_${userId}`;
};


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

  const [otherExpenses, setOtherExpenses] = useState<OtherExpense[]>([]);
  const [monthlyBudget, setMonthlyBudget] = useState<number | null>(null);
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [tempBudget, setTempBudget] = useState<string>('');
  const [currentOpenInvoicePage, setCurrentOpenInvoicePage] = useState(1);


  useEffect(() => {
    if (typeof window !== 'undefined' && user) {
      const expensesStorageKey = getStorageKey(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id);
      const storedExpenses = localStorage.getItem(expensesStorageKey);
      if (storedExpenses) {
        setOtherExpenses(JSON.parse(storedExpenses));
      }

      const budgetStorageKey = getStorageKey(MONTHLY_BUDGET_STORAGE_KEY_BASE, user.id);
      const storedBudget = localStorage.getItem(budgetStorageKey);
      if (storedBudget) {
        setMonthlyBudget(parseFloat(storedBudget));
        setTempBudget(storedBudget);
      }
    }
  }, [user]);


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
    if (authLoading) return; // Wait until auth state is determined
    if (!user) {
      router.push('/login'); // Redirect if not authenticated
    } else {
      fetchAccountData(); // Fetch data if authenticated
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
      try {
        const invoiceDate = parseISO(invoice.uploadTime as string);
        return invoiceDate >= startDate && invoiceDate <= endDate;
      } catch (e) {
        console.error("Invalid date encountered in filteredInvoices:", invoice.uploadTime);
        return false;
      }
    });
  }, [allInvoices, dateRange]);


  const openInvoices = useMemo(() => {
    return filteredInvoices
      .filter(invoice => invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'pending_payment')
      .sort((a, b) => {
        try {
            const dateA = a.paymentDueDate ? parseISO(a.paymentDueDate as string).getTime() : Infinity;
            const dateB = b.paymentDueDate ? parseISO(b.paymentDueDate as string).getTime() : Infinity;
            return dateA - dateB;
        } catch (e) {
            console.error("Error sorting open invoices by due date:", e);
            return 0;
        }
      });
  }, [filteredInvoices]);

  const totalOpenInvoicePages = Math.ceil(openInvoices.length / ITEMS_PER_PAGE_OPEN_INVOICES);
  const displayedOpenInvoices = useMemo(() => {
    const startIndex = (currentOpenInvoicePage - 1) * ITEMS_PER_PAGE_OPEN_INVOICES;
    return openInvoices.slice(startIndex, startIndex + ITEMS_PER_PAGE_OPEN_INVOICES);
  }, [openInvoices, currentOpenInvoicePage]);

  const handleOpenInvoicePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalOpenInvoicePages) {
        setCurrentOpenInvoicePage(newPage);
    }
  };


  const currentMonthTotalExpensesFromInvoices = useMemo(() => {
    const currentMonth = new Date();
    let totalExpenses = 0;
    allInvoices.forEach(invoice => {
        if (!invoice.uploadTime) return;
        try {
            const invoiceDate = parseISO(invoice.uploadTime as string);
            if (isSameMonth(invoiceDate, currentMonth) && invoice.status === 'completed') {
                totalExpenses += (invoice.totalAmount || 0);
            }
        } catch (e) {
            console.error("Invalid date in currentMonthExpenses (invoices):", invoice.uploadTime);
        }
    });
    return totalExpenses;
  }, [allInvoices]);

  const totalOtherExpensesForCurrentMonth = useMemo(() => {
    const currentMonthDate = new Date();
    return otherExpenses.reduce((sum, exp) => {
        if (!exp.date || !isValid(parseISO(exp.date))) return sum;
        try {
            const expenseDate = parseISO(exp.date);
            if (isSameMonth(expenseDate, currentMonthDate)) {
                let amountToAdd = exp.amount;
                // Use internal keys if available, otherwise fallback to category string (lowercase for matching)
                const internalKey = exp._internalCategoryKey?.toLowerCase();
                const categoryString = exp.category.toLowerCase();
                
                const biMonthlyKeys = [
                    'electricity', 
                    'water', 
                    'property_tax', 
                    t('accounts_other_expenses_tab_electricity').toLowerCase(),
                    t('accounts_other_expenses_tab_water').toLowerCase(),
                    t('accounts_other_expenses_tab_property_tax').toLowerCase()
                ];

                if (internalKey && biMonthlyKeys.includes(internalKey)) {
                    amountToAdd /= 2;
                } else if (!internalKey && biMonthlyKeys.includes(categoryString)){
                     amountToAdd /= 2;
                }
                return sum + amountToAdd;
            }
            return sum;
        } catch (e) {
            console.error("Invalid date for other expense in current month calculation:", exp.date, e);
            return sum;
        }
    }, 0);
}, [otherExpenses, t]);


  const currentMonthTotalExpenses = useMemo(() => {
    return currentMonthTotalExpensesFromInvoices + totalOtherExpensesForCurrentMonth;
  }, [currentMonthTotalExpensesFromInvoices, totalOtherExpensesForCurrentMonth]);


  const getDueDateStatus = (dueDate: string | Date | undefined): { textKey: string; params?: Record<string, any>; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon?: React.ElementType } | null => {
    if (!dueDate) return null;
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueDateObj = parseISO(dueDate as string);
        dueDateObj.setHours(0,0,0,0);

        if (isPast(dueDateObj) && !isToday(dueDateObj)) {
        return { textKey: 'accounts_due_date_overdue', variant: 'destructive', icon: AlertTriangle };
        }

        const daysUntilDue = differenceInCalendarDays(dueDateObj, today);

        if (daysUntilDue <= 0) { // Includes today
            return { textKey: 'accounts_due_date_due_today', variant: 'destructive', icon: AlertTriangle };
        }
        if (daysUntilDue <= 7) {
        return { textKey: 'accounts_due_date_upcoming_soon', params: { days: daysUntilDue }, variant: 'secondary', icon: CalendarClock };
        }
        return null;
    } catch(e) {
        console.error("Error in getDueDateStatus:", e);
        return null;
    }
  };

  const formatDateDisplay = (dateString: string | Date | undefined, formatStr: string = 'PP') => {
    if (!dateString) return t('invoices_na');
    try {
      const dateObj = typeof dateString === 'string' ? parseISO(dateString) : dateString;
      return format(dateObj, formatStr);
    } catch (e) {
      console.error("Error formatting date for display:", e, "Input:", dateString);
      return t('invoices_invalid_date');
    }
  };

  const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null) return t('invoices_na');
    return `${t('currency_symbol')}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const handleSaveBudget = () => {
    if (!user) return;
    const newBudget = parseFloat(tempBudget);
    if (isNaN(newBudget) || newBudget < 0) {
      toast({ title: t('error_title'), description: t('accounts_budget_invalid_amount'), variant: 'destructive' });
      return;
    }
    setMonthlyBudget(newBudget);
    localStorage.setItem(getStorageKey(MONTHLY_BUDGET_STORAGE_KEY_BASE, user.id), String(newBudget));
    setIsEditingBudget(false);
    toast({ title: t('accounts_budget_saved_title'), description: t('accounts_budget_saved_desc') });
  };

  const budgetProgress = monthlyBudget && monthlyBudget > 0 ? (currentMonthTotalExpenses / monthlyBudget) * 100 : 0;


  if (authLoading || isLoadingData) { 
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }
  if (!user && !authLoading) return null; 


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
            <div className="flex justify-between items-center">
                <CardTitle className="text-xl font-semibold text-primary flex items-center">
                    <TrendingDownIcon className="mr-2 h-5 w-5 text-red-500" /> {t('accounts_current_month_expenses_title')}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setIsEditingBudget(!isEditingBudget)} className="h-8 w-8">
                    {isEditingBudget ? <Save className="h-4 w-4 text-primary" /> : <Edit2 className="h-4 w-4 text-muted-foreground" />}
                </Button>
            </div>
            <CardDescription>{t('accounts_current_month_expenses_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
            {isLoadingData ? (
                <div className="flex justify-center items-center py-6">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-3xl font-bold">{formatCurrency(currentMonthTotalExpenses)}</p>
                    {isEditingBudget ? (
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                value={tempBudget}
                                onChange={(e) => setTempBudget(e.target.value)}
                                placeholder={t('accounts_budget_placeholder')}
                                className="h-9 max-w-xs"
                            />
                            <Button size="sm" onClick={handleSaveBudget}><Save className="mr-1 h-4 w-4" /> {t('save_button')}</Button>
                        </div>
                    ) : (
                        monthlyBudget !== null && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Target className="h-4 w-4 text-primary"/>
                                <span>{t('accounts_budget_of')} {formatCurrency(monthlyBudget)}</span>
                            </div>
                        )
                    )}
                    {monthlyBudget !== null && monthlyBudget > 0 && (
                      <div className="mt-2">
                        <Progress value={budgetProgress} className="h-2" indicatorClassName={budgetProgress > 100 ? "bg-destructive" : (budgetProgress > 75 ? "bg-yellow-500" : "bg-primary")} />
                        <p className="text-xs text-muted-foreground mt-1">
                           {budgetProgress > 100 ? t('accounts_budget_exceeded_by', {amount: formatCurrency(currentMonthTotalExpenses - monthlyBudget)}) : 
                           t('accounts_budget_remaining', {amount: formatCurrency(monthlyBudget - currentMonthTotalExpenses)})}
                        </p>
                      </div>
                    )}
                </div>
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
            <>
            <div className="overflow-x-auto relative border rounded-md">
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
                  {displayedOpenInvoices.map((invoice) => {
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
                              {t(dueDateStatus.textKey as any, dueDateStatus.params)}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {totalOpenInvoicePages > 1 && (
                <div className="flex items-center justify-end space-x-2 py-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenInvoicePageChange(currentOpenInvoicePage - 1)}
                        disabled={currentOpenInvoicePage === 1}
                    >
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">{t('inventory_pagination_previous')}</span>
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        {t('inventory_pagination_page_info_simple', { currentPage: currentOpenInvoicePage, totalPages: totalOpenInvoicePages})}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenInvoicePageChange(currentOpenInvoicePage + 1)}
                        disabled={currentOpenInvoicePage === totalOpenInvoicePages}
                    >
                         <span className="sr-only">{t('inventory_pagination_next')}</span>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
            </>
          )}
        </CardContent>
      </Card>

      <Link href="/accounts/other-expenses" passHref>
        <Card className="shadow-md scale-fade-in delay-400 cursor-pointer hover:shadow-lg transition-shadow">
            <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle className="text-xl font-semibold text-primary flex items-center">
                        <Landmark className="mr-2 h-5 w-5" /> {t('accounts_other_expenses_title')}
                    </CardTitle>
                    <ArrowRightCircle className="h-5 w-5 text-muted-foreground" />
                </div>
                <CardDescription>{t('accounts_other_expenses_summary_desc')}</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoadingData ? (
                     <div className="flex justify-center items-center py-6">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : (
                    <p className="text-2xl font-bold">{formatCurrency(totalOtherExpensesForCurrentMonth)}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                    {t('accounts_other_expenses_total_for_current_month')}
                </p>
            </CardContent>
        </Card>
      </Link>


      <Card className="shadow-md scale-fade-in delay-500">
          <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center">
                <BarChart3 className="mr-2 h-5 w-5" /> {t('accounts_cash_flow_profitability_title')}
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

