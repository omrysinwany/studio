// src/app/accounts/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import {
  format,
  parseISO,
  differenceInCalendarDays,
  isBefore,
  startOfMonth,
  endOfMonth,
  isValid,
  isSameMonth,
  getMonth,
  getYear,
} from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  CreditCard,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  TrendingDown as TrendingDownIcon,
  Landmark,
  BarChart3,
  ArrowRightCircle,
  Edit2,
  Save,
  Target,
  ChevronLeft,
  ChevronRight,
  Banknote,
  Bell,
  TrendingUp,
  DollarSign,
  Info,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import {
  getInvoicesService,
  getOtherExpensesService,
  getUserSettingsService,
  saveUserSettingsService,
} from "@/services/backend";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Timestamp } from "firebase/firestore";
import type {
  InvoiceHistoryItem,
  UserSettings,
  OtherExpense,
} from "@/services/types";

const ITEMS_PER_PAGE_OPEN_INVOICES = 4;

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
  const [tempBudget, setTempBudget] = useState<string>("");
  const [currentOpenInvoicePage, setCurrentOpenInvoicePage] = useState(1);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);

  const fetchAccountData = useCallback(async () => {
    if (!user || !user.id) {
      setIsLoadingData(false);
      return;
    }
    setIsLoadingData(true);
    console.log("[AccountsPage] fetchAccountData called for user:", user.id);
    try {
      const [invoicesData, fetchedOtherExpensesData, settingsData] =
        await Promise.all([
          getInvoicesService(user.id),
          getOtherExpensesService(user.id),
          getUserSettingsService(user.id),
        ]);
      console.log(
        "[AccountsPage] Data fetched: Invoices:",
        invoicesData.length,
        "Other Expenses:",
        fetchedOtherExpensesData.length,
        "Settings:",
        settingsData
      );

      setAllInvoices(invoicesData);
      setOtherExpenses(fetchedOtherExpensesData);
      setUserSettings(settingsData);

      if (
        settingsData &&
        settingsData.monthlyBudget !== undefined &&
        settingsData.monthlyBudget !== null
      ) {
        setMonthlyBudget(settingsData.monthlyBudget);
        setTempBudget(String(settingsData.monthlyBudget));
      } else {
        setMonthlyBudget(0);
        setTempBudget("0");
      }
    } catch (error) {
      console.error("Failed to fetch account data:", error);
      toast({
        title: t("error_title"),
        description: t("reports_toast_error_fetch_desc"),
        variant: "destructive",
      });
    } finally {
      setIsLoadingData(false);
      console.log(
        "[AccountsPage] fetchAccountData finished. isLoadingData set to false."
      );
    }
  }, [user, toast, t]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    } else if (user && user.id) {
      fetchAccountData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router]);

  const filteredInvoicesByDateRange = useMemo(() => {
    if (!dateRange?.from) return allInvoices;
    const startDate = new Date(dateRange.from);
    startDate.setHours(0, 0, 0, 0);
    const endDate = dateRange.to ? new Date(dateRange.to) : new Date();
    endDate.setHours(23, 59, 59, 999);

    return allInvoices.filter((invoice) => {
      if (!invoice.uploadTime) return false;
      try {
        const invoiceDate =
          invoice.uploadTime instanceof Timestamp
            ? invoice.uploadTime.toDate()
            : parseISO(invoice.uploadTime as string);
        return (
          isValid(invoiceDate) &&
          invoiceDate >= startDate &&
          invoiceDate <= endDate
        );
      } catch (e) {
        console.error(
          "Invalid date encountered in filteredInvoicesByDateRange:",
          invoice.uploadTime
        );
        return false;
      }
    });
  }, [allInvoices, dateRange]);

  const openInvoices = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return filteredInvoicesByDateRange
      .filter(
        (invoice) =>
          invoice.paymentStatus === "unpaid" ||
          invoice.paymentStatus === "pending_payment"
      )
      .sort((a, b) => {
        try {
          const dateA = a.dueDate
            ? a.dueDate instanceof Timestamp
              ? a.dueDate.toDate()
              : parseISO(a.dueDate as string)
            : null;
          const dateB = b.dueDate
            ? b.dueDate instanceof Timestamp
              ? b.dueDate.toDate()
              : parseISO(b.dueDate as string)
            : null;

          if (!dateA && !dateB) return 0;
          if (!dateA) return 1;
          if (!dateB) return -1;

          if (!isValid(dateA) && !isValid(dateB)) return 0;
          if (!isValid(dateA)) return 1;
          if (!isValid(dateB)) return -1;

          const isAOverdue = isBefore(dateA, today);
          const isBOverdue = isBefore(dateB, today);

          if (isAOverdue && !isBOverdue) return -1;
          if (!isAOverdue && isBOverdue) return 1;

          return dateA.getTime() - dateB.getTime();
        } catch (e) {
          console.error(
            "Error sorting open invoices by due date:",
            e,
            "A:",
            a.dueDate,
            "B:",
            b.dueDate
          );
          return 0;
        }
      });
  }, [filteredInvoicesByDateRange]);

  const totalOpenInvoicePages = Math.ceil(
    openInvoices.length / ITEMS_PER_PAGE_OPEN_INVOICES
  );
  const displayedOpenInvoices = useMemo(() => {
    const startIndex =
      (currentOpenInvoicePage - 1) * ITEMS_PER_PAGE_OPEN_INVOICES;
    return openInvoices.slice(
      startIndex,
      startIndex + ITEMS_PER_PAGE_OPEN_INVOICES
    );
  }, [openInvoices, currentOpenInvoicePage]);

  const handleOpenInvoicePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalOpenInvoicePages) {
      setCurrentOpenInvoicePage(newPage);
    }
  };

  const currentMonthTotalExpenses = useMemo(() => {
    const currentMonthStart = startOfMonth(new Date());
    const currentMonthEnd = endOfMonth(new Date());
    let totalInvoiceExpenses = 0;

    allInvoices.forEach((invoice) => {
      if (invoice.status !== "completed") return;

      let relevantDateForExpense: Date | null = null;
      let paymentDateTs: Date | null = null;
      let uploadDateTs: Date | null = null;

      if (invoice.dueDate) {
        if (invoice.dueDate instanceof Timestamp)
          paymentDateTs = invoice.dueDate.toDate();
        else if (
          typeof invoice.dueDate === "string" &&
          isValid(parseISO(invoice.dueDate))
        )
          paymentDateTs = parseISO(invoice.dueDate);
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
        // Consider a payment as an expense only if it's *for* the current month's goods/services
        // OR if it's a payment for an invoice that itself was for the current month (e.g. paymentDueDate is this month).
        // This logic might need refinement based on how you define "current month expenses" from invoices.
        // For now, if payment due date is this month and it's paid/unpaid, we count it.
        if (
          invoice.paymentStatus === "paid" ||
          invoice.paymentStatus === "unpaid" ||
          invoice.paymentStatus === "pending_payment"
        ) {
          relevantDateForExpense = paymentDateTs;
        }
      } else if (
        uploadDateTs &&
        uploadDateTs >= currentMonthStart &&
        uploadDateTs <= currentMonthEnd
      ) {
        // If an invoice was uploaded this month (and is completed), it's likely an expense for this month
        // unless its payment due date implies otherwise.
        if (
          invoice.paymentStatus === "paid" ||
          invoice.paymentStatus === "unpaid" ||
          invoice.paymentStatus === "pending_payment"
        ) {
          relevantDateForExpense = uploadDateTs;
        }
      }

      if (relevantDateForExpense) {
        totalInvoiceExpenses += invoice.totalAmount || 0;
      }
    });

    const totalOtherExpensesForMonth = otherExpenses.reduce((sum, exp) => {
      if (!exp.date) return sum;
      try {
        const expenseDate =
          exp.date instanceof Timestamp
            ? exp.date.toDate()
            : parseISO(exp.date as string);
        if (isValid(expenseDate) && isSameMonth(expenseDate, new Date())) {
          const amountToAdd = exp.amount;
          const internalKey = exp.categoryId?.toLowerCase();
          const categoryString = exp.categoryId?.toLowerCase();
          const biMonthlyKeys = [
            "property_tax",
            "rent",
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
      } catch (e) {
        console.error(
          "Invalid date for other expense in current month calculation:",
          exp.date,
          e
        );
        return sum;
      }
    }, 0);

    return totalInvoiceExpenses + totalOtherExpensesForMonth;
  }, [allInvoices, otherExpenses, t]);

  const financialSummaries = useMemo(() => {
    const startDate = dateRange?.from
      ? new Date(dateRange.from)
      : startOfMonth(new Date());
    const endDate = dateRange?.to
      ? new Date(dateRange.to)
      : endOfMonth(new Date());
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const invoiceCosts = allInvoices
      .filter((inv) => {
        if (!inv.uploadTime) return false;
        const invDate =
          inv.uploadTime instanceof Timestamp
            ? inv.uploadTime.toDate()
            : parseISO(inv.uploadTime as string);
        // Count all invoices within the period as a cost/liability, regardless of paymentStatus for this summary
        return isValid(invDate) && invDate >= startDate && invDate <= endDate;
      })
      .reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

    const otherExpensesInRange = otherExpenses
      .filter((exp) => {
        if (!exp.date) return false;
        const expenseDate =
          exp.date instanceof Timestamp
            ? exp.date.toDate()
            : parseISO(exp.date as string);
        return (
          isValid(expenseDate) &&
          expenseDate >= startDate &&
          expenseDate <= endDate
        );
      })
      .reduce((sum, exp) => {
        const amountToAdd = exp.amount;
        const internalKey = exp.categoryId?.toLowerCase();
        const categoryString = exp.categoryId?.toLowerCase();
        const biMonthlyKeys = [
          "property_tax",
          "rent",
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
      }, 0);

    const totalRecordedExpenses = invoiceCosts + otherExpensesInRange;

    return { invoiceCosts, otherExpensesInRange, totalRecordedExpenses };
  }, [allInvoices, otherExpenses, dateRange, t]);

  const topExpenseCategories = useMemo(() => {
    const startDate = dateRange?.from
      ? new Date(dateRange.from)
      : startOfMonth(new Date());
    const endDate = dateRange?.to
      ? new Date(dateRange.to)
      : endOfMonth(new Date());
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const categoryMap: Record<string, number> = {};
    otherExpenses
      .filter((exp) => {
        if (!exp.date) return false;
        const expenseDate =
          exp.date instanceof Timestamp
            ? exp.date.toDate()
            : parseISO(exp.date as string);
        return (
          isValid(expenseDate) &&
          expenseDate >= startDate &&
          expenseDate <= endDate
        );
      })
      .forEach((exp) => {
        const categoryKey =
          exp.categoryId ||
          exp.categoryId?.toLowerCase().replace(/\s+/g, "_") ||
          "unknown";
        categoryMap[categoryKey] = (categoryMap[categoryKey] || 0) + exp.amount;
      });

    return Object.entries(categoryMap)
      .map(([key, amount]) => ({
        name: t(`accounts_other_expenses_tab_${key}` as any, {
          defaultValue:
            key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " "),
        }),
        amount,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [otherExpenses, dateRange, t]);

  const getDueDateStatus = (
    dueDateStr: string | Timestamp | undefined | null,
    paymentStatus: InvoiceHistoryItem["paymentStatus"],
    reminderDays?: number | null
  ): {
    textKey: string;
    params?: Record<string, any>;
    variant: "default" | "secondary" | "destructive" | "outline";
    icon?: React.ElementType;
    isReminderActive?: boolean;
  } | null => {
    if (!dueDateStr || paymentStatus === "paid") return null;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDateObj =
        dueDateStr instanceof Timestamp
          ? dueDateStr.toDate()
          : parseISO(dueDateStr as string);
      dueDateObj.setHours(0, 0, 0, 0);

      if (!isValid(dueDateObj)) return null;

      let isReminderActive = false;
      const daysUntilDue = differenceInCalendarDays(dueDateObj, today);

      if (
        reminderDays !== undefined &&
        reminderDays !== null &&
        reminderDays >= 0 &&
        (paymentStatus === "unpaid" || paymentStatus === "pending_payment")
      ) {
        if (daysUntilDue >= 0 && daysUntilDue <= reminderDays) {
          isReminderActive = true;
        }
      }

      if (isBefore(dueDateObj, today)) {
        return {
          textKey: "accounts_due_date_overdue",
          variant: "destructive",
          icon: AlertTriangle,
          isReminderActive,
        };
      }
      if (daysUntilDue === 0) {
        return {
          textKey: "accounts_due_date_due_today",
          variant: "destructive",
          icon: AlertTriangle,
          isReminderActive,
        };
      }
      if (daysUntilDue > 0 && daysUntilDue <= 7) {
        return {
          textKey: "accounts_due_date_upcoming_soon",
          params: { days: daysUntilDue },
          variant: "secondary",
          icon: CalendarClock,
          isReminderActive,
        };
      }
      if (isReminderActive) {
        return {
          textKey: "accounts_due_date_reminder_active",
          params: { days: daysUntilDue },
          variant: "outline",
          icon: Bell,
          isReminderActive,
        };
      }

      return null;
    } catch (e) {
      console.error("Error in getDueDateStatus:", e);
      return null;
    }
  };

  const formatDateDisplay = (
    dateInput: string | Date | Timestamp | undefined,
    formatStr: string = "PP"
  ) => {
    if (!dateInput) return t("invoices_na");
    try {
      const dateObj =
        dateInput instanceof Timestamp
          ? dateInput.toDate()
          : typeof dateInput === "string"
          ? parseISO(dateInput)
          : dateInput;
      if (!isValid(dateObj)) return t("invoices_invalid_date");
      return format(dateObj, formatStr);
    } catch (e) {
      console.error(
        "Error formatting date for display:",
        e,
        "Input:",
        dateInput
      );
      return t("invoices_invalid_date");
    }
  };

  const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value))
      return t("invoices_na");
    return `${t("currency_symbol")}${value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  };

  const handleSaveBudget = async () => {
    if (!user || !user.id) return;
    const newBudget = parseFloat(tempBudget);
    if (isNaN(newBudget) || newBudget < 0) {
      toast({
        title: t("error_title"),
        description: t("accounts_budget_invalid_amount"),
        variant: "destructive",
      });
      return;
    }
    // Save through UserSettings
    const currentSettings = await getUserSettingsService(user.id);
    const settingsToSave: Partial<UserSettings> = { monthlyBudget: newBudget };
    await saveUserSettingsService(settingsToSave, user.id);

    setMonthlyBudget(newBudget);
    setUserSettings((prev) =>
      prev
        ? { ...prev, monthlyBudget: newBudget }
        : { userId: user.id!, monthlyBudget: newBudget }
    );
    setIsEditingBudget(false);
    toast({
      title: t("accounts_budget_saved_title"),
      description: t("accounts_budget_saved_desc"),
    });
  };

  const budgetProgress =
    monthlyBudget && monthlyBudget > 0
      ? (currentMonthTotalExpenses / monthlyBudget) * 100
      : 0;

  if (authLoading || isLoadingData || !user) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t("loading_data")}</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <Card className="shadow-md scale-fade-in">
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="text-2xl font-semibold text-primary flex items-center">
                  <CreditCard className="mr-2 h-6 w-6" />{" "}
                  {t("accounts_page_title")}
                </CardTitle>
                <CardDescription>
                  {t("accounts_page_description")}
                </CardDescription>
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
                          {format(dateRange.from, "PP")} -{" "}
                          {format(dateRange.to, "PP")}
                        </>
                      ) : (
                        format(dateRange.from, "PP")
                      )
                    ) : (
                      <span>{t("reports_date_range_placeholder")}</span>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDateRange(undefined)}
                      >
                        {t("reports_date_range_clear")}
                      </Button>
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
                <Banknote className="mr-2 h-5 w-5 text-red-500" />{" "}
                {t("accounts_current_month_expenses_title_with_budget")}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditingBudget(!isEditingBudget)}
                className="h-8 w-8"
              >
                {isEditingBudget ? (
                  <Save className="h-4 w-4 text-primary" />
                ) : (
                  <Edit2 className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            <CardDescription>
              {t("accounts_current_month_expenses_desc_with_budget")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingData ? (
              <div className="flex justify-center items-center py-6">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-3xl font-bold">
                  {formatCurrency(currentMonthTotalExpenses)}
                </p>
                {isEditingBudget ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={tempBudget}
                      onChange={(e) => setTempBudget(e.target.value)}
                      placeholder={t("accounts_budget_placeholder")}
                      className="h-9 max-w-xs"
                      min="0"
                    />
                    <Button size="sm" onClick={handleSaveBudget}>
                      <Save className="mr-1 h-4 w-4" /> {t("save_button")}
                    </Button>
                  </div>
                ) : (
                  monthlyBudget !== null && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Target className="h-4 w-4 text-primary" />
                      <span>
                        {t("accounts_budget_of")}{" "}
                        {formatCurrency(monthlyBudget)}
                      </span>
                    </div>
                  )
                )}
                {monthlyBudget !== null && monthlyBudget > 0 && (
                  <div className="mt-2">
                    <Progress
                      value={Math.min(budgetProgress, 100)}
                      className="h-2"
                      indicatorClassName={
                        budgetProgress > 100
                          ? "bg-destructive"
                          : budgetProgress > 75
                          ? "bg-yellow-500"
                          : "bg-primary"
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {budgetProgress > 100
                        ? t("accounts_budget_exceeded_by", {
                            amount: formatCurrency(
                              currentMonthTotalExpenses - monthlyBudget
                            ),
                          })
                        : t("accounts_budget_remaining", {
                            amount: formatCurrency(
                              monthlyBudget - currentMonthTotalExpenses
                            ),
                          })}
                    </p>
                  </div>
                )}
                {monthlyBudget === null && !isEditingBudget && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("accounts_budget_not_set")}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-md scale-fade-in delay-300">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
              <DollarSign className="mr-2 h-5 w-5 text-primary" />{" "}
              {t("accounts_financial_summary_title")}
            </CardTitle>
            <CardDescription>
              {t("accounts_financial_summary_desc_period")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-3 border rounded-md bg-muted/30">
                <p className="text-sm text-muted-foreground flex items-center">
                  <TrendingDownIcon className="mr-1 h-4 w-4 text-red-500" />
                  {t("accounts_total_invoice_costs_label")}
                </p>
                <p className="text-2xl font-semibold">
                  {formatCurrency(financialSummaries.invoiceCosts)}
                </p>
              </div>
              <div className="p-3 border rounded-md bg-muted/30">
                <p className="text-sm text-muted-foreground flex items-center">
                  <TrendingDownIcon className="mr-1 h-4 w-4 text-red-500" />
                  {t("accounts_total_other_expenses_label")}
                </p>
                <p className="text-2xl font-semibold">
                  {formatCurrency(financialSummaries.otherExpensesInRange)}
                </p>
              </div>
              <div className="p-3 border rounded-md bg-muted/30">
                <p className="text-sm text-muted-foreground flex items-center">
                  <Banknote className="mr-1 h-4 w-4 text-destructive" />
                  {t("accounts_total_recorded_expenses_label")}
                </p>
                <p className="text-2xl font-semibold text-destructive">
                  {formatCurrency(financialSummaries.totalRecordedExpenses)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-md scale-fade-in delay-100">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
              <AlertTriangle className="mr-2 h-5 w-5 text-amber-500" />{" "}
              {t("accounts_open_invoices_title")}
            </CardTitle>
            <CardDescription>
              {t("accounts_open_invoices_desc_period")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingData ? (
              <div className="flex justify-center items-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2 text-muted-foreground">
                  {t("loading_data")}
                </p>
              </div>
            ) : openInvoices.length === 0 ? (
              <p className="text-muted-foreground text-center py-6">
                {t("accounts_no_open_invoices_period")}
              </p>
            ) : (
              <>
                <ScrollArea className="whitespace-nowrap rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("invoice_details_supplier_label")}
                        </TableHead>
                        <TableHead>
                          {t("invoice_details_invoice_number_label")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("invoice_details_total_amount_label")}
                        </TableHead>
                        <TableHead className="text-center">
                          {t("payment_due_date_dialog_title")}
                        </TableHead>
                        <TableHead className="text-center">
                          {t("accounts_due_date_alert_column")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedOpenInvoices.map((invoice) => {
                        const dueDateStatus = getDueDateStatus(
                          invoice.dueDate as string,
                          invoice.paymentStatus,
                          userSettings?.reminderDaysBefore
                        );
                        const IconComponent = dueDateStatus?.icon;
                        return (
                          <TableRow
                            key={invoice.id}
                            className={cn(
                              dueDateStatus?.variant === "destructive" &&
                                "bg-destructive/10 hover:bg-destructive/20"
                            )}
                          >
                            <TableCell className="font-medium">
                              {invoice.supplierName || t("invoices_na")}
                            </TableCell>
                            <TableCell>
                              {invoice.invoiceNumber || t("invoices_na")}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(invoice.totalAmount)}
                            </TableCell>
                            <TableCell className="text-center">
                              {formatDateDisplay(invoice.dueDate as string)}
                            </TableCell>
                            <TableCell className="text-center">
                              {dueDateStatus && (
                                <div className="flex items-center justify-center gap-1">
                                  {dueDateStatus.isReminderActive &&
                                    !IconComponent && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Bell className="h-3.5 w-3.5 text-blue-500" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>
                                            {t(
                                              "accounts_tooltip_reminder_active",
                                              {
                                                days: differenceInCalendarDays(
                                                  invoice.dueDate instanceof
                                                    Timestamp
                                                    ? invoice.dueDate.toDate()
                                                    : parseISO(
                                                        invoice.dueDate as string
                                                      ),
                                                  new Date()
                                                ),
                                              }
                                            )}
                                          </p>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                  <Badge
                                    variant={dueDateStatus.variant}
                                    className="text-xs"
                                  >
                                    {IconComponent && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <IconComponent
                                            className={cn(
                                              "mr-1 h-3.5 w-3.5",
                                              dueDateStatus.isReminderActive &&
                                                IconComponent !== Bell &&
                                                "text-blue-500"
                                            )}
                                          />
                                        </TooltipTrigger>
                                        {dueDateStatus.isReminderActive &&
                                          IconComponent !== Bell && (
                                            <TooltipContent>
                                              <p>
                                                {t(
                                                  "accounts_tooltip_reminder_active_with_status"
                                                )}
                                              </p>
                                            </TooltipContent>
                                          )}
                                      </Tooltip>
                                    )}
                                    {t(
                                      dueDateStatus.textKey as any,
                                      dueDateStatus.params
                                    )}
                                  </Badge>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
                {totalOpenInvoicePages > 1 && (
                  <div className="flex items-center justify-end space-x-2 py-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleOpenInvoicePageChange(currentOpenInvoicePage - 1)
                      }
                      disabled={currentOpenInvoicePage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="sr-only">
                        {t("inventory_pagination_previous")}
                      </span>
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {t("inventory_pagination_page_info_simple", {
                        currentPage: currentOpenInvoicePage,
                        totalPages: totalOpenInvoicePages,
                      })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleOpenInvoicePageChange(currentOpenInvoicePage + 1)
                      }
                      disabled={
                        currentOpenInvoicePage === totalOpenInvoicePages
                      }
                    >
                      <span className="sr-only">
                        {t("inventory_pagination_next")}
                      </span>
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
                  <Landmark className="mr-2 h-5 w-5" />{" "}
                  {t("accounts_other_expenses_title")}
                </CardTitle>
                <ArrowRightCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              <CardDescription>
                {t("accounts_other_expenses_summary_desc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingData ? (
                <div className="flex justify-center items-center py-6">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <p className="text-2xl font-bold">
                  {formatCurrency(
                    otherExpenses
                      .filter((exp) => {
                        try {
                          const expDate =
                            exp.date instanceof Timestamp
                              ? exp.date.toDate()
                              : parseISO(exp.date as string);
                          return (
                            isValid(expDate) && isSameMonth(expDate, new Date())
                          );
                        } catch {
                          return false;
                        }
                      })
                      .reduce((sum, exp) => sum + exp.amount, 0)
                  )}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {t("accounts_other_expenses_total_for_current_month")}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card className="shadow-md scale-fade-in delay-500">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
              <BarChart3 className="mr-2 h-5 w-5" />{" "}
              {t("accounts_top_expense_categories_title")}
            </CardTitle>
            <CardDescription>
              {t("accounts_top_expense_categories_desc_period")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topExpenseCategories.length === 0 ? (
              <p className="text-muted-foreground text-center py-6">
                {t("accounts_no_top_categories_period")}
              </p>
            ) : (
              <ul className="space-y-2">
                {topExpenseCategories.map((cat) => (
                  <li
                    key={cat.name}
                    className="flex justify-between items-center p-2 border-b last:border-b-0"
                  >
                    <span className="font-medium">{cat.name}</span>
                    <span className="text-primary font-semibold">
                      {formatCurrency(cat.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-md scale-fade-in delay-600">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
              <Info className="mr-2 h-5 w-5" />{" "}
              {t("accounts_cash_flow_profitability_title")}
            </CardTitle>
            <CardDescription>
              {t("accounts_cash_flow_profitability_desc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-md font-semibold text-muted-foreground">
                {t("accounts_cash_flow_analysis_title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("settings_more_coming_soon")}
              </p>
            </div>
            <Separator />
            <div>
              <h3 className="text-md font-semibold text-muted-foreground">
                {t("accounts_predictive_balance_title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("settings_more_coming_soon")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
