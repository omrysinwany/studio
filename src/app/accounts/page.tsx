// src/app/accounts/page.tsx
'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import { format, parseISO, differenceInCalendarDays, isPast, isToday, startOfMonth, endOfMonth, isValid, isSameMonth } from 'date-fns';
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
import AddCategoryDialog from '@/components/accounts/AddCategoryDialog';
import AddExpenseDialog from '@/components/accounts/AddExpenseDialog';


export interface OtherExpense {
  id: string;
  category: string;
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

const EXPENSE_CATEGORIES_STORAGE_KEY_BASE = 'invoTrack_expenseCategories';
const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses';
const EXPENSE_TEMPLATES_STORAGE_KEY_BASE = 'invoTrack_expenseTemplates';


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

  const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
  const [otherExpenses, setOtherExpenses] = useState<OtherExpense[]>([]);
  const [expenseTemplates, setExpenseTemplates] = useState<ExpenseTemplate[]>([]);
  const [activeExpenseTab, setActiveExpenseTab] = useState<string>('');

  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [showAddExpenseDialog, setShowAddExpenseDialog] = useState(false);

  // Load categories, expenses, and templates from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined' && user) {
      const categoriesStorageKey = getStorageKey(EXPENSE_CATEGORIES_STORAGE_KEY_BASE, user.id);
      const expensesStorageKey = getStorageKey(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id);
      const templatesStorageKey = getStorageKey(EXPENSE_TEMPLATES_STORAGE_KEY_BASE, user.id);

      const storedCategories = localStorage.getItem(categoriesStorageKey);
      const defaultCategories = ['electricity', 'water', 'arnona'];
      if (storedCategories) {
        const parsedCategories = JSON.parse(storedCategories);
        const finalCategories = Array.from(new Set([...defaultCategories, ...parsedCategories]));
        setExpenseCategories(finalCategories);
        if (finalCategories.length > 0 && !activeExpenseTab) {
          setActiveExpenseTab(finalCategories[0]);
        }
      } else {
        setExpenseCategories(defaultCategories);
        if (defaultCategories.length > 0 && !activeExpenseTab) {
          setActiveExpenseTab(defaultCategories[0]);
        }
      }

      const storedExpenses = localStorage.getItem(expensesStorageKey);
      if (storedExpenses) {
        setOtherExpenses(JSON.parse(storedExpenses));
      }
      
      const storedTemplates = localStorage.getItem(templatesStorageKey);
      if (storedTemplates) {
        setExpenseTemplates(JSON.parse(storedTemplates));
      }
    }
  }, [user, activeExpenseTab]);

  const saveExpenseCategories = (categories: string[]) => {
    if (typeof window !== 'undefined' && user) {
      const categoriesStorageKey = getStorageKey(EXPENSE_CATEGORIES_STORAGE_KEY_BASE, user.id);
      localStorage.setItem(categoriesStorageKey, JSON.stringify(categories));
    }
  };

  const saveOtherExpenses = (expenses: OtherExpense[]) => {
    if (typeof window !== 'undefined' && user) {
      const expensesStorageKey = getStorageKey(OTHER_EXPENSES_STORAGE_KEY_BASE, user.id);
      localStorage.setItem(expensesStorageKey, JSON.stringify(expenses));
    }
  };
  
  const saveExpenseTemplates = (templates: ExpenseTemplate[]) => {
    if (typeof window !== 'undefined' && user) {
      const templatesStorageKey = getStorageKey(EXPENSE_TEMPLATES_STORAGE_KEY_BASE, user.id);
      localStorage.setItem(templatesStorageKey, JSON.stringify(templates));
    }
  };

  const handleAddCategory = (newCategoryName: string) => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) {
      toast({ title: t('error_title'), description: t('accounts_toast_category_name_empty_desc'), variant: "destructive" });
      return;
    }
    if (expenseCategories.some(cat => cat.toLowerCase() === trimmedName.toLowerCase())) {
      toast({ title: t('accounts_toast_category_exists_title'), description: t('accounts_toast_category_exists_desc', { categoryName: trimmedName }), variant: "destructive" });
      return;
    }
    const updatedCategories = [...expenseCategories, trimmedName];
    setExpenseCategories(updatedCategories);
    saveExpenseCategories(updatedCategories);
    setActiveExpenseTab(trimmedName); 
    toast({ title: t('accounts_toast_category_added_title'), description: t('accounts_toast_category_added_desc', { categoryName: trimmedName }) });
    setShowAddCategoryDialog(false);
  };

  const handleAddExpense = (
    expenseData: Omit<OtherExpense, 'id'>,
    templateDetails?: { saveAsTemplate: boolean; templateName?: string }
  ) => {
    if (!expenseData.description.trim()) {
      toast({ title: t('error_title'), description: t('accounts_toast_expense_desc_empty_desc'), variant: "destructive" });
      return;
    }
    if (expenseData.amount <= 0) {
      toast({ title: t('accounts_toast_expense_invalid_amount_title'), description: t('accounts_toast_expense_invalid_amount_desc'), variant: "destructive" });
      return;
    }
    if (!expenseData.category) {
        toast({ title: t('error_title'), description: t('accounts_toast_expense_category_empty_desc'), variant: "destructive"});
        return;
    }
     if (!expenseData.date || !isValid(parseISO(expenseData.date))) {
        toast({ title: t('error_title'), description: t('accounts_toast_expense_invalid_date_desc'), variant: "destructive"});
        return;
    }

    // Save the actual expense
    const newExpense: OtherExpense = {
      id: `exp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      ...expenseData,
    };
    const updatedExpenses = [...otherExpenses, newExpense];
    setOtherExpenses(updatedExpenses);
    saveOtherExpenses(updatedExpenses);
    toast({ title: t('accounts_toast_expense_added_title'), description: t('accounts_toast_expense_added_desc', { description: newExpense.description }) });
    setShowAddExpenseDialog(false);

    // If requested, save as a template
    if (templateDetails?.saveAsTemplate) {
      const newTemplate: ExpenseTemplate = {
        id: `tmpl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: templateDetails.templateName || `${expenseData.description.substring(0, 20)} Template`,
        category: expenseData.category,
        description: expenseData.description,
        amount: expenseData.amount,
      };
      const updatedTemplates = [...expenseTemplates, newTemplate];
      setExpenseTemplates(updatedTemplates);
      saveExpenseTemplates(updatedTemplates);
      toast({ title: t('accounts_toast_template_saved_title'), description: t('accounts_toast_template_saved_desc', { templateName: newTemplate.name }) });
    }
  };


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
  }, [user, authLoading, router]);

  useEffect(() => {
    if (expenseCategories.length > 0 && !activeExpenseTab && !authLoading && user) {
      setActiveExpenseTab(expenseCategories[0]);
    }
  }, [expenseCategories, activeExpenseTab, authLoading, user]);

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

  const currentMonthExpenses = useMemo(() => {
    const currentMonth = new Date();
    let totalExpenses = 0;

    // Add invoice expenses
    allInvoices.forEach(invoice => {
        if (!invoice.uploadTime) return;
        try {
            const invoiceDate = parseISO(invoice.uploadTime as string);
            if (isSameMonth(invoiceDate, currentMonth)) {
                totalExpenses += (invoice.totalAmount || 0);
            }
        } catch (e) {
            console.error("Invalid date in currentMonthExpenses (invoices):", invoice.uploadTime);
        }
    });

    // Add other expenses
    const biMonthlyCategories = ['electricity', 'water', 'arnona']; 
    otherExpenses.forEach(expense => {
        if (!expense.date) return;
        try {
            const expenseDate = parseISO(expense.date);
            if (isSameMonth(expenseDate, currentMonth)) {
                if (biMonthlyCategories.includes(expense.category.toLowerCase())) {
                    totalExpenses += (expense.amount / 2); // For bi-monthly, take half for the current month's display
                } else {
                    totalExpenses += expense.amount; // For other (assumed monthly) categories, take full amount
                }
            }
        } catch (e) {
            console.error("Invalid date in currentMonthExpenses (otherExpenses):", expense.date);
        }
    });

    return totalExpenses;
  }, [allInvoices, otherExpenses]);


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

        if (daysUntilDue <= 0) {
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
      return format(parseISO(dateString as string), formatStr);
    } catch (e) {
      console.error("Error formatting date for display:", e, "Input:", dateString);
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
            <Tabs value={activeExpenseTab} onValueChange={setActiveExpenseTab} className="w-full">
              <div className="flex items-center gap-2">
                  <TabsList className="inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
                    {expenseCategories.map(category => (
                        <TabsTrigger
                            key={category}
                            value={category}
                            className="data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-3 py-1.5 text-sm font-medium transition-all flex-1 sm:flex-none whitespace-nowrap"
                        >
                          {t(`accounts_other_expenses_tab_${category.toLowerCase().replace(/\s+/g, '_')}` as any) || category.charAt(0).toUpperCase() + category.slice(1)}
                        </TabsTrigger>
                    ))}
                  </TabsList>
                <Button variant="outline" size="icon" onClick={() => setShowAddCategoryDialog(true)} className="ml-2 flex-shrink-0">
                  <PlusCircle className="h-4 w-4" />
                  <span className="sr-only">{t('accounts_add_category_button')}</span>
                </Button>
              </div>
              {expenseCategories.map(category => (
                <TabsContent key={category} value={category} className="mt-4">
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
            </Tabs>
            <div className="flex flex-col sm:flex-row justify-end pt-2 gap-2">
              <Button variant="outline" onClick={() => setShowAddExpenseDialog(true)} className="w-full sm:w-auto">
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

      <AddCategoryDialog
        isOpen={showAddCategoryDialog}
        onOpenChange={setShowAddCategoryDialog}
        onAddCategory={handleAddCategory}
      />
      <AddExpenseDialog
        isOpen={showAddExpenseDialog}
        onOpenChange={setShowAddExpenseDialog}
        categories={expenseCategories}
        onAddExpense={handleAddExpense}
      />
    </div>
  );
}
