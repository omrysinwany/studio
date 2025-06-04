// src/app/suppliers/page.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  getSupplierSummariesService,
  SupplierSummary,
  InvoiceHistoryItem,
  getInvoicesService,
  updateSupplierContactInfoService,
  deleteSupplierService,
  createSupplierService,
  DOCUMENTS_COLLECTION,
} from "@/services/backend";
import {
  Briefcase,
  Search,
  DollarSign,
  FileText as FileTextIcon,
  Loader2,
  Info,
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  BarChart3,
  ListChecks,
  Edit,
  Save,
  X,
  PlusCircle,
  CalendarDays as CalendarIconLucide,
  BarChartHorizontalBig,
  Clock,
  Trash2,
  Filter,
  Columns,
  Grid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  eachMonthOfInterval,
  subMonths,
  isValid,
} from "date-fns";
import {
  Timestamp,
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend as RechartsLegend,
} from "recharts";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import CreateSupplierSheet from "@/components/create-supplier-sheet";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/context/AuthContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const ITEMS_PER_PAGE = 4;

type SortKey =
  | keyof Pick<SupplierSummary, "name" | "invoiceCount" | "lastActivityDate">
  | "totalSpent";
type SortDirection = "asc" | "desc";

const formatDateDisplay = (
  date: Date | string | Timestamp | undefined,
  t: (key: string, params?: any) => string,
  f: string = "PP"
) => {
  if (!date) return t("suppliers_na");
  try {
    let dateObj: Date;
    if (date instanceof Timestamp) {
      dateObj = date.toDate();
    } else if (typeof date === "string") {
      dateObj = parseISO(date);
    } else if (date instanceof Date) {
      dateObj = date;
    } else {
      return t("suppliers_invalid_date");
    }

    if (isNaN(dateObj.getTime()) || !isValid(dateObj))
      return t("suppliers_invalid_date");
    return format(dateObj, f);
  } catch (e) {
    console.error("Error formatting date:", e, "Input:", date);
    return t("suppliers_invalid_date");
  }
};

const formatCurrencyDisplay = (
  value: number | undefined | null,
  t: (key: string, params?: any) => string
): string => {
  if (value === undefined || value === null || isNaN(value))
    return `${t("currency_symbol")}0.00`;
  return `${t("currency_symbol")}${value.toLocaleString(
    t("locale_code_for_number_formatting") || undefined,
    { minimumFractionDigits: 0, maximumFractionDigits: 0 }
  )}`;
};

const getDisplayPaymentTerm = (
  termValue: string | null | undefined,
  t: (key: string, params?: any) => string
): string => {
  if (!termValue || termValue.trim() === "") return t("suppliers_na");

  const predefinedOptionKeys: PaymentTermOption[] = [
    "immediate",
    "net30",
    "net60",
    "eom",
  ];

  // Check if termValue is one of the direct option keys (e.g., 'net30')
  if (predefinedOptionKeys.includes(termValue as PaymentTermOption)) {
    return t(`payment_terms_option_${termValue}`);
  }

  // Check if termValue is an old full translation key (e.g., 'payment_terms_option_net30')
  for (const optKey of predefinedOptionKeys) {
    if (termValue === `payment_terms_option_${optKey}`) {
      return t(`payment_terms_option_${optKey}`);
    }
  }

  // Check if termValue is already a translated predefined term (e.g., "Net 30")
  for (const optKey of predefinedOptionKeys) {
    if (termValue === t(`payment_terms_option_${optKey}`)) {
      return termValue; // Already translated, return as is
    }
  }

  // If none of the above, assume it's a custom term (or a value that doesn't match known patterns)
  return termValue;
};

const renderStatusBadge = (
  status: InvoiceHistoryItem["status"],
  t: (key: string, params?: any) => string
) => {
  let variant: "default" | "secondary" | "destructive" | "outline" = "default";
  let className = "";
  let icon = null;

  switch (status) {
    case "completed":
      variant = "secondary";
      className =
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80";
      icon = <Info className="mr-1 h-3 w-3" />;
      break;
    case "processing":
      variant = "secondary";
      className =
        "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse hover:bg-blue-100/80";
      icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />;
      break;
    case "pending":
      variant = "secondary";
      className =
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80";
      icon = <Info className="mr-1 h-3 w-3" />;
      break;
    case "error":
      variant = "destructive";
      icon = <Info className="mr-1 h-3 w-3" />;
      break;
    default:
      variant = "outline";
      icon = null;
      break;
  }
  return (
    <Badge
      variant={variant}
      className={cn(
        "text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5",
        className
      )}
    >
      {icon}
      {t(`invoice_status_${status}` as any) ||
        (typeof status === "string"
          ? status.charAt(0).toUpperCase() + status.slice(1)
          : "")}
    </Badge>
  );
};

interface MonthlySpendingData {
  month: string;
  total: number;
}

const supplierChartConfig = {
  totalAmount: {
    labelKey: "accounts_total_amount_spent_short",
    color: "hsl(var(--chart-1))",
  },
} satisfies React.ComponentProps<typeof ChartContainer>["config"];

type PaymentTermOption = "immediate" | "net30" | "net60" | "eom" | "custom";

export default function SuppliersPage() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const isMobile = useIsMobile();

  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [allInvoices, setAllInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSupplier, setSelectedSupplier] =
    useState<SupplierSummary | null>(null);
  const [selectedSupplierInvoices, setSelectedSupplierInvoices] = useState<
    InvoiceHistoryItem[]
  >([]);
  const [monthlySpendingData, setMonthlySpendingData] = useState<
    MonthlySpendingData[]
  >([]);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);

  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editedContactInfo, setEditedContactInfo] = useState<{
    phone?: string;
    email?: string;
  }>({});

  const [isEditingPaymentTerms, setIsEditingPaymentTerms] = useState(false);
  const [editedPaymentTermsOption, setEditedPaymentTermsOption] =
    useState<PaymentTermOption>("custom");
  const [customPaymentTerm, setCustomPaymentTerm] = useState("");

  const [isSavingContact, setIsSavingContact] = useState(false);
  const [isDeletingSupplier, setIsDeletingSupplier] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const fetchData = useCallback(async () => {
    if (!user || !user.id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [summaries, invoicesData] = await Promise.all([
        getSupplierSummariesService(user.id),
        getInvoicesService(user.id),
      ]);
      setSuppliers(summaries);
      setAllInvoices(invoicesData);
    } catch (error) {
      console.error("Failed to fetch supplier data:", error);
      toast({
        title: t("suppliers_toast_error_load_title"),
        description: `${t("suppliers_toast_error_load_desc")} ${
          (error as Error).message
        }`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, t, toast]);

  useEffect(() => {
    if (user && user.id) {
      fetchData();
    }
  }, [user, fetchData]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const filteredAndSortedSuppliers = useMemo(() => {
    let result = [...suppliers];
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter((s) =>
        (s.name || "").toLowerCase().includes(lowerSearchTerm)
      );
    }

    if (sortKey) {
      result.sort((a, b) => {
        let valA = a[sortKey as keyof SupplierSummary];
        let valB = b[sortKey as keyof SupplierSummary];

        if (sortKey === "lastActivityDate") {
          let dateA = 0;
          const aDateVal = a.lastActivityDate;
          if (aDateVal) {
            const dateValForCheck = aDateVal as any;
            if (dateValForCheck instanceof Timestamp)
              dateA = dateValForCheck.toDate().getTime();
            else if (
              typeof dateValForCheck === "string" &&
              isValid(parseISO(dateValForCheck))
            )
              dateA = parseISO(dateValForCheck).getTime();
            else if (
              dateValForCheck instanceof Date &&
              isValid(dateValForCheck)
            )
              dateA = dateValForCheck.getTime();
          }
          let dateB = 0;
          const bDateVal = b.lastActivityDate;
          if (bDateVal) {
            const dateValForCheck = bDateVal as any;
            if (dateValForCheck instanceof Timestamp)
              dateB = dateValForCheck.toDate().getTime();
            else if (
              typeof dateValForCheck === "string" &&
              isValid(parseISO(dateValForCheck))
            )
              dateB = parseISO(dateValForCheck).getTime();
            else if (
              dateValForCheck instanceof Date &&
              isValid(dateValForCheck)
            )
              dateB = dateValForCheck.getTime();
          }
          valA = dateA as any;
          valB = dateB as any;
        }

        let comparison = 0;
        if (typeof valA === "number" && typeof valB === "number") {
          comparison = valA - valB;
        } else if (typeof valA === "string" && typeof valB === "string") {
          comparison = (valA || "").localeCompare(valB || "");
        } else {
          if (
            (valA === undefined || valA === null) &&
            valB !== undefined &&
            valB !== null
          )
            comparison = 1;
          else if (
            valA !== undefined &&
            valA !== null &&
            (valB === undefined || valB === null)
          )
            comparison = -1;
          else comparison = 0;
        }
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }
    return result;
  }, [suppliers, searchTerm, sortKey, sortDirection]);

  const totalItems = filteredAndSortedSuppliers.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const paginatedSuppliers = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedSuppliers.slice(
      startIndex,
      startIndex + ITEMS_PER_PAGE
    );
  }, [filteredAndSortedSuppliers, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleViewSupplierDetails = (supplier: SupplierSummary) => {
    setSelectedSupplier(supplier);
    setEditedContactInfo({
      phone: supplier.phone || "",
      email: supplier.email || "",
    });

    const terms = supplier.paymentTerms || "";
    const predefinedOptionKeys: PaymentTermOption[] = [
      "immediate",
      "net30",
      "net60",
      "eom",
    ];
    let identifiedOptionKey: PaymentTermOption | undefined = undefined;

    // Try to identify the option key from the stored 'terms'
    if (terms) {
      // 1. Check if 'terms' is one of the raw option keys (e.g., 'net30')
      if (predefinedOptionKeys.includes(terms as PaymentTermOption)) {
        identifiedOptionKey = terms as PaymentTermOption;
      } else {
        // 2. Check if 'terms' matches a translated predefined option (e.g., "Net 30")
        identifiedOptionKey = predefinedOptionKeys.find(
          (optKey) => terms === t(`payment_terms_option_${optKey}`)
        );
        if (!identifiedOptionKey) {
          // 3. Check if 'terms' matches an old style full key (e.g., "payment_terms_option_net30") - less likely if save is correct
          identifiedOptionKey = predefinedOptionKeys.find(
            (optKey) => terms === `payment_terms_option_${optKey}`
          );
        }
      }
    }

    if (identifiedOptionKey) {
      setEditedPaymentTermsOption(identifiedOptionKey);
      setCustomPaymentTerm("");
    } else if (terms) {
      // If it's not any known predefined option (key or translated), it must be custom text
      setEditedPaymentTermsOption("custom");
      setCustomPaymentTerm(terms); // Store the original custom text
    } else {
      // No terms set, default to 'custom' or your preferred default
      setEditedPaymentTermsOption("custom"); // Consider a specific default like 'net30' if appropriate
      setCustomPaymentTerm("");
    }

    setIsEditingContact(false);
    setIsEditingPaymentTerms(false);

    const invoicesForSupplier = allInvoices
      .filter(
        (inv) =>
          inv.supplierName === supplier.name && inv.status === "completed"
      )
      .sort((a, b) => {
        let dateA = 0;
        let dateB = 0;
        const aDate = a.uploadTime;
        const bDate = b.uploadTime;

        if (aDate instanceof Timestamp) dateA = aDate.toDate().getTime();
        else if (typeof aDate === "string" && isValid(parseISO(aDate)))
          dateA = parseISO(aDate).getTime();
        else if (aDate instanceof Date && isValid(aDate))
          dateA = aDate.getTime();

        if (bDate instanceof Timestamp) dateB = bDate.toDate().getTime();
        else if (typeof bDate === "string" && isValid(parseISO(bDate)))
          dateB = parseISO(bDate).getTime();
        else if (bDate instanceof Date && isValid(bDate))
          dateB = bDate.getTime();

        return dateB - dateA;
      });
    setSelectedSupplierInvoices(invoicesForSupplier);

    const last12Months = eachMonthOfInterval({
      start: subMonths(new Date(), 11),
      end: new Date(),
    });

    const spendingByMonth: Record<string, number> = {};
    last12Months.forEach((monthDate) => {
      const monthYear = formatDateDisplay(monthDate, t, "MMM yyyy");
      spendingByMonth[monthYear] = 0;
    });

    invoicesForSupplier.forEach((invoice) => {
      if (invoice.totalAmount && invoice.status === "completed") {
        let uploadTimeDate: Date | null = null;
        if (invoice.uploadTime instanceof Timestamp)
          uploadTimeDate = invoice.uploadTime.toDate();
        else if (
          typeof invoice.uploadTime === "string" &&
          isValid(parseISO(invoice.uploadTime))
        )
          uploadTimeDate = parseISO(invoice.uploadTime);
        else if (
          invoice.uploadTime instanceof Date &&
          isValid(invoice.uploadTime)
        )
          uploadTimeDate = invoice.uploadTime;

        if (uploadTimeDate && isValid(uploadTimeDate)) {
          const monthYear = formatDateDisplay(uploadTimeDate, t, "MMM yyyy");
          if (spendingByMonth.hasOwnProperty(monthYear)) {
            spendingByMonth[monthYear] =
              (spendingByMonth[monthYear] || 0) + invoice.totalAmount;
          }
        }
      }
    });
    const chartData = Object.entries(spendingByMonth)
      .map(([month, total]) => ({ month, total }))
      .sort(
        (a, b) => parseISO(a.month).getTime() - parseISO(b.month).getTime()
      );
    setMonthlySpendingData(chartData);

    setIsDetailSheetOpen(true);
  };

  const navigateToInvoiceDetails = (invoiceId: string) => {
    router.push(`/invoices?tab=scanned-docs&viewInvoiceId=${invoiceId}`);
    setIsDetailSheetOpen(false);
  };

  const handleSaveContactInfo = async () => {
    if (!selectedSupplier || !user || !user.id) return;
    setIsSavingContact(true);
    try {
      await updateSupplierContactInfoService(
        selectedSupplier.id,
        {
          phone: editedContactInfo.phone?.trim() || null,
          email: editedContactInfo.email?.trim() || null,
        },
        user.id
      );

      await fetchData();
      setSelectedSupplier((prev) =>
        prev
          ? {
              ...prev,
              phone: editedContactInfo.phone?.trim() || null,
              email: editedContactInfo.email?.trim() || null,
            }
          : null
      );

      toast({
        title: t("suppliers_toast_contact_updated_title"),
        description: t("suppliers_toast_contact_updated_desc", {
          supplierName: selectedSupplier.name,
        }),
      });
      setIsEditingContact(false);
    } catch (error: any) {
      console.error("Failed to update contact info:", error);
      toast({
        title: t("suppliers_toast_update_fail_title"),
        description: `${t("suppliers_toast_update_fail_desc")} ${
          error.message
        }`,
        variant: "destructive",
      });
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleSavePaymentTerms = async () => {
    if (!selectedSupplier || !user || !user.id) return;
    setIsSavingContact(true);
    let finalPaymentTerm: string | null;
    if (editedPaymentTermsOption === "custom") {
      if (!customPaymentTerm.trim()) {
        toast({
          title: t("error_title"),
          description: t("suppliers_payment_terms_custom_empty_error"),
          variant: "destructive",
        });
        setIsSavingContact(false);
        return;
      }
      finalPaymentTerm = customPaymentTerm.trim();
    } else {
      finalPaymentTerm = t(
        `suppliers_payment_terms_option_${editedPaymentTermsOption}`
      );
    }

    try {
      await updateSupplierContactInfoService(
        selectedSupplier.id,
        { paymentTerms: finalPaymentTerm },
        user.id
      );
      await fetchData();
      setSelectedSupplier((prev) =>
        prev ? { ...prev, paymentTerms: finalPaymentTerm } : null
      );
      toast({
        title: t("suppliers_toast_payment_terms_updated_title"),
        description: t("suppliers_toast_payment_terms_updated_desc", {
          supplierName: selectedSupplier.name,
        }),
      });
      setIsEditingPaymentTerms(false);
    } catch (error: any) {
      console.error("Failed to update payment terms:", error);
      toast({
        title: t("suppliers_toast_update_fail_title"),
        description: `${t("suppliers_toast_update_fail_desc")} ${
          error.message
        }`,
        variant: "destructive",
      });
    } finally {
      setIsSavingContact(false);
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
      setIsCreateSheetOpen(false);
      fetchData();
    } catch (error: any) {
      console.error("Failed to create supplier:", error);
      toast({
        title: t("suppliers_toast_create_fail_title"),
        description: `${t("suppliers_toast_create_fail_desc", {
          message: (error as Error).message,
        })}`,
        variant: "destructive",
      });
    }
  };

  const handleDeleteSupplier = async (supplierId: string) => {
    if (!user || !user.id) return;
    setIsDeletingSupplier(true);
    try {
      await deleteSupplierService(supplierId, user.id);
      toast({
        title: t("suppliers_toast_deleted_title"),
        description: t("suppliers_toast_deleted_desc", {
          supplierName: selectedSupplier?.name || supplierId,
        }),
      });
      fetchData();
      if (selectedSupplier?.id === supplierId) {
        setIsDetailSheetOpen(false);
        setSelectedSupplier(null);
      }
    } catch (error: any) {
      console.error("Failed to delete supplier:", error);
      toast({
        title: t("suppliers_toast_delete_fail_title"),
        description: `${t("suppliers_toast_delete_fail_desc")} ${
          (error as Error).message
        }`,
        variant: "destructive",
      });
    } finally {
      setIsDeletingSupplier(false);
    }
  };

  const supplierSpendingData = useMemo(() => {
    const spendingMap = new Map<string, number>();
    const filteredPeriodInvoices = allInvoices.filter((invoice) => {
      if (!dateRange?.from || !invoice.uploadTime) return true;

      let uploadTimeDate: Date | null = null;
      if (invoice.uploadTime instanceof Timestamp) {
        uploadTimeDate = invoice.uploadTime.toDate();
      } else if (typeof invoice.uploadTime === "string") {
        uploadTimeDate = parseISO(invoice.uploadTime);
      } else if (invoice.uploadTime instanceof Date) {
        uploadTimeDate = invoice.uploadTime;
      }

      if (!uploadTimeDate || !isValid(uploadTimeDate)) return false;

      const startDate = new Date(dateRange.from);
      startDate.setHours(0, 0, 0, 0);
      const endDate = dateRange.to ? new Date(dateRange.to) : new Date();
      endDate.setHours(23, 59, 59, 999);
      return (
        uploadTimeDate >= startDate &&
        uploadTimeDate <= endDate &&
        invoice.status === "completed"
      );
    });

    filteredPeriodInvoices.forEach((invoice) => {
      if (
        invoice.supplierName &&
        typeof invoice.supplierName === "string" &&
        invoice.totalAmount !== undefined &&
        typeof invoice.totalAmount === "number"
      ) {
        spendingMap.set(
          invoice.supplierName,
          (spendingMap.get(invoice.supplierName) || 0) + invoice.totalAmount
        );
      }
    });
    return Array.from(spendingMap.entries())
      .map(([name, totalAmount]) => ({ name, totalAmount }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }, [allInvoices, dateRange]);

  if (authLoading || (isLoading && !user)) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t("loading_data")}</p>
      </div>
    );
  }
  if (!user && !authLoading) return null;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader className="p-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <Briefcase className="mr-2 h-5 sm:h-6 w-5 sm:w-6" />{" "}
                {t("suppliers_title")}
              </CardTitle>
              <CardDescription>{t("suppliers_description")}</CardDescription>
            </div>
            <Button
              onClick={() => setIsCreateSheetOpen(true)}
              className="w-full sm:w-auto"
            >
              <PlusCircle className="mr-2 h-4 w-4" />{" "}
              {t("suppliers_add_new_button")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6">
            <div className="relative w-full md:max-w-xs lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("suppliers_search_placeholder")}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10"
                aria-label={t("suppliers_search_aria")}
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="supplierDateRange"
                  variant={"outline"}
                  className={cn(
                    "w-full md:w-auto md:min-w-[260px] justify-start text-left font-normal",
                    !dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIconLucide className="mr-2 h-4 w-4" />
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
                  numberOfMonths={isMobile ? 1 : 2}
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
          {isMobile ? (
            paginatedSuppliers.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Briefcase className="mx-auto h-12 w-12 mb-2 opacity-50" />
                <p>{t("suppliers_no_suppliers_found")}</p>
                <Button
                  variant="link"
                  onClick={() => setIsCreateSheetOpen(true)}
                  className="mt-1 text-primary"
                >
                  {t("suppliers_add_new_button")}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {paginatedSuppliers.map((supplier) => (
                  <Card
                    key={supplier.id}
                    className="hover:shadow-md transition-shadow"
                  >
                    <CardHeader className="pb-2 pt-3 px-3">
                      <div className="flex justify-between items-start">
                        <CardTitle
                          className="text-base font-semibold truncate"
                          title={supplier.name}
                        >
                          {supplier.name}
                        </CardTitle>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewSupplierDetails(supplier)}
                          className="h-7 w-7 text-primary hover:text-primary/80 flex-shrink-0"
                        >
                          <Info className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="text-xs space-y-1 pt-1 pb-3 px-3">
                      {supplier.phone && (
                        <a
                          href={`tel:${supplier.phone}`}
                          className="flex items-center text-muted-foreground hover:text-primary"
                        >
                          <Phone className="mr-1.5 h-3 w-3" /> {supplier.phone}
                        </a>
                      )}
                      {supplier.email && (
                        <a
                          href={`mailto:${supplier.email}`}
                          className="flex items-center text-muted-foreground hover:text-primary truncate"
                        >
                          <Mail className="mr-1.5 h-3 w-3" /> {supplier.email}
                        </a>
                      )}
                      <p>
                        {t("suppliers_col_orders")}: {supplier.invoiceCount}
                      </p>
                      <p>
                        {t("suppliers_col_last_activity")}:{" "}
                        {supplier.lastActivityDate
                          ? formatDateDisplay(
                              supplier.lastActivityDate,
                              t,
                              "PP"
                            )
                          : t("suppliers_na")}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          ) : (
            <div className="overflow-x-auto relative">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort("name")}
                    >
                      {t("suppliers_col_name")}{" "}
                      {sortKey === "name" &&
                        (sortDirection === "asc" ? (
                          <ChevronUp className="inline h-4 w-4" />
                        ) : (
                          <ChevronDown className="inline h-4 w-4" />
                        ))}
                    </TableHead>
                    <TableHead
                      className="text-center cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort("invoiceCount")}
                    >
                      {t("suppliers_col_orders")}{" "}
                      {sortKey === "invoiceCount" &&
                        (sortDirection === "asc" ? (
                          <ChevronUp className="inline h-4 w-4" />
                        ) : (
                          <ChevronDown className="inline h-4 w-4" />
                        ))}
                    </TableHead>
                    <TableHead
                      className="text-center cursor-pointer hover:bg-muted/50 hidden md:table-cell"
                      onClick={() => handleSort("lastActivityDate")}
                    >
                      {t("suppliers_col_last_activity")}{" "}
                      {sortKey === "lastActivityDate" &&
                        (sortDirection === "asc" ? (
                          <ChevronUp className="inline h-4 w-4" />
                        ) : (
                          <ChevronDown className="inline h-4 w-4" />
                        ))}
                    </TableHead>
                    <TableHead className="text-center">
                      {t("suppliers_col_actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSuppliers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={isMobile ? 3 : 4}
                        className="h-24 text-center"
                      >
                        <div className="text-center py-10 text-muted-foreground">
                          <Briefcase className="mx-auto h-12 w-12 mb-2 opacity-50" />
                          <p>{t("suppliers_no_suppliers_found")}</p>
                          <Button
                            variant="link"
                            onClick={() => setIsCreateSheetOpen(true)}
                            className="mt-1 text-primary"
                          >
                            {t("suppliers_add_new_button")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedSuppliers.map((supplier) => (
                      <TableRow key={supplier.id} className="hover:bg-muted/50">
                        <TableCell className="font-medium">
                          {supplier.name}
                        </TableCell>
                        <TableCell className="text-center">
                          {supplier.invoiceCount}
                        </TableCell>
                        <TableCell className="text-center hidden md:table-cell">
                          {supplier.lastActivityDate
                            ? formatDateDisplay(
                                supplier.lastActivityDate,
                                t,
                                "PP"
                              )
                            : t("suppliers_na")}
                        </TableCell>
                        <TableCell className="text-center space-x-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleViewSupplierDetails(supplier)}
                            title={t("suppliers_view_details_title", {
                              supplierName: supplier.name,
                            })}
                          >
                            <Info className="h-4 w-4 text-primary" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-end space-x-2 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                {t("inventory_pagination_previous")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t("inventory_pagination_page_info_simple", {
                  currentPage: currentPage,
                  totalPages: totalPages,
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                {t("inventory_pagination_next")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-md scale-fade-in delay-100">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary flex items-center">
            <BarChartHorizontalBig className="mr-2 h-5 w-5" />{" "}
            {t("accounts_supplier_spending_title")}
          </CardTitle>
          <CardDescription>
            {t("accounts_supplier_spending_desc_period")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-2 text-muted-foreground">{t("loading_data")}</p>
            </div>
          ) : supplierSpendingData.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">
              {t("accounts_no_spending_data_period")}
            </p>
          ) : (
            <div
              className={cn(
                "grid grid-cols-1 items-center",
                supplierSpendingData.length > 0 && "md:grid-cols-2 gap-6"
              )}
            >
              <ScrollArea
                className={cn(
                  "overflow-x-auto",
                  isMobile ? "max-h-[250px]" : "max-h-[350px]",
                  supplierSpendingData.length === 0 && "hidden md:block"
                )}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("invoice_details_supplier_label")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("invoice_details_total_amount_label")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplierSpendingData.slice(0, 10).map((item) => (
                      <TableRow key={item.name}>
                        <TableCell className="font-medium">
                          {item.name}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrencyDisplay(item.totalAmount, t)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              <div
                className={cn(
                  "h-[250px] md:h-[350px] w-full overflow-hidden",
                  isMobile && supplierSpendingData.length > 0 && "mt-4",
                  supplierSpendingData.length === 0 &&
                    "md:col-span-2 flex items-center justify-center"
                )}
              >
                {supplierSpendingData.length > 0 ? (
                  <ChartContainer
                    config={supplierChartConfig}
                    className="w-full h-full"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={supplierSpendingData.slice(0, 10)}
                        layout="vertical"
                        margin={{
                          top: 5,
                          right: isMobile ? 0 : 30,
                          left: isMobile ? 5 : 10,
                          bottom: isMobile ? 40 : 20,
                        }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          horizontal={false}
                          stroke="hsl(var(--border) / 0.5)"
                        />
                        <RechartsXAxis
                          type="number"
                          tickFormatter={(value) =>
                            `${t("currency_symbol")}${value / 1000}k`
                          }
                          fontSize={isMobile ? 8 : 10}
                        />
                        <RechartsYAxis
                          dataKey="name"
                          type="category"
                          width={isMobile ? 60 : 80}
                          tick={
                            {
                              fontSize: isMobile ? 8 : 10,
                              dy: 5,
                              textAnchor: isMobile ? "end" : "end",
                            } as any
                          }
                          interval={0}
                        />
                        <RechartsTooltip
                          content={
                            <ChartTooltipContent indicator="dot" hideLabel />
                          }
                          formatter={(
                            value: number,
                            name: string,
                            props: any
                          ) => [
                            formatCurrencyDisplay(value, t),
                            t(supplierChartConfig.totalAmount.labelKey as any),
                          ]}
                        />
                        <RechartsLegend
                          verticalAlign="top"
                          content={({ payload }) => (
                            <ul className="flex flex-wrap justify-center gap-x-4 text-xs text-muted-foreground">
                              {payload?.map((entry, index) => (
                                <li
                                  key={`item-${index}`}
                                  className="flex items-center gap-1.5"
                                >
                                  <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: entry.color }}
                                  />
                                  {t(
                                    supplierChartConfig.totalAmount
                                      .labelKey as any
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        />
                        <Bar
                          dataKey="totalAmount"
                          fill="var(--color-totalAmount)"
                          radius={[0, 4, 4, 0]}
                          barSize={isMobile ? 10 : 15}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <p className="text-muted-foreground text-center py-6">
                    {t("accounts_no_spending_data_period")}
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={isDetailSheetOpen} onOpenChange={setIsDetailSheetOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg flex flex-col p-0 overflow-hidden"
        >
          <SheetHeader className="p-4 sm:p-6 border-b shrink-0 flex flex-row justify-between items-center">
            <div>
              <SheetTitle className="text-lg sm:text-xl">
                {selectedSupplier?.name || t("suppliers_details_title_generic")}
              </SheetTitle>
              <SheetDescription>
                {t("suppliers_details_desc", {
                  supplierName: selectedSupplier?.name || "",
                })}
              </SheetDescription>
            </div>
            {selectedSupplier && (
              <div className="flex items-center">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      title={t("suppliers_delete_title", {
                        supplierName: selectedSupplier.name,
                      })}
                      disabled={isDeletingSupplier}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("suppliers_delete_confirm_title")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("suppliers_delete_confirm_desc", {
                          supplierName: selectedSupplier.name,
                        })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isDeletingSupplier}>
                        {t("cancel_button")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          handleDeleteSupplier(selectedSupplier.id)
                        }
                        disabled={isDeletingSupplier}
                        className={cn(
                          buttonVariants({ variant: "destructive" }),
                          isDeletingSupplier && "opacity-50"
                        )}
                      >
                        {isDeletingSupplier && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        {t("suppliers_delete_confirm_action")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </SheetHeader>
          {selectedSupplier && (
            <ScrollArea className="flex-grow">
              <div className="p-4 sm:p-6 space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center">
                      <DollarSign className="mr-2 h-4 w-4 text-primary" />{" "}
                      {t("suppliers_total_spending")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-primary">
                      {formatCurrencyDisplay(selectedSupplier.totalSpent, t)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("suppliers_across_orders", {
                        count: selectedSupplier.invoiceCount,
                      })}
                    </p>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 h-auto mt-1 text-xs"
                      onClick={() =>
                        router.push(
                          `/invoices?tab=scanned-docs&supplier=${encodeURIComponent(
                            selectedSupplier.name
                          )}`
                        )
                      }
                    >
                      {t("suppliers_view_all_documents_button")}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base flex items-center">
                      <Info className="mr-2 h-4 w-4 text-primary" />{" "}
                      {t("suppliers_contact_info")}
                    </CardTitle>
                    {!isEditingContact && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsEditingContact(true)}
                        className="h-8 w-8"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="text-sm space-y-2">
                    {isEditingContact ? (
                      <>
                        <div>
                          <Label htmlFor="supplierPhone" className="text-xs">
                            {t("suppliers_phone_label")}
                          </Label>
                          <Input
                            id="supplierPhone"
                            type="tel"
                            value={editedContactInfo.phone || ""}
                            onChange={(e) =>
                              setEditedContactInfo((prev) => ({
                                ...prev,
                                phone: e.target.value,
                              }))
                            }
                            placeholder={t("suppliers_phone_placeholder")}
                            className="h-9 mt-1"
                            disabled={isSavingContact}
                          />
                        </div>
                        <div>
                          <Label htmlFor="supplierEmail" className="text-xs">
                            {t("suppliers_email_label")}
                          </Label>
                          <Input
                            id="supplierEmail"
                            type="email"
                            value={editedContactInfo.email || ""}
                            onChange={(e) =>
                              setEditedContactInfo((prev) => ({
                                ...prev,
                                email: e.target.value,
                              }))
                            }
                            placeholder={t("suppliers_email_placeholder")}
                            className="h-9 mt-1"
                            disabled={isSavingContact}
                          />
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setIsEditingContact(false);
                              setEditedContactInfo({
                                phone: selectedSupplier.phone || "",
                                email: selectedSupplier.email || "",
                              });
                            }}
                            variant="outline"
                            disabled={isSavingContact}
                          >
                            <X className="mr-1 h-4 w-4" /> {t("cancel_button")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSaveContactInfo}
                            disabled={isSavingContact}
                          >
                            {isSavingContact ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="mr-1 h-4 w-4" />
                            )}
                            {t("suppliers_save_contact_button")}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="flex items-center">
                          <Phone className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                          {selectedSupplier.phone ? (
                            <a
                              href={`tel:${selectedSupplier.phone}`}
                              className="hover:underline"
                            >
                              {selectedSupplier.phone}
                            </a>
                          ) : (
                            t("suppliers_na")
                          )}
                        </p>
                        <p className="flex items-center">
                          <Mail className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                          {selectedSupplier.email ? (
                            <a
                              href={`mailto:${selectedSupplier.email}`}
                              className="hover:underline truncate"
                            >
                              {selectedSupplier.email}
                            </a>
                          ) : (
                            t("suppliers_na")
                          )}
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base flex items-center">
                      <Clock className="mr-2 h-4 w-4 text-primary" />{" "}
                      {t("suppliers_payment_terms_title")}
                    </CardTitle>
                    {!isEditingPaymentTerms && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsEditingPaymentTerms(true)}
                        className="h-8 w-8"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="text-sm">
                    {isEditingPaymentTerms ? (
                      <div className="space-y-2">
                        <Select
                          value={editedPaymentTermsOption}
                          onValueChange={(value) =>
                            setEditedPaymentTermsOption(
                              value as PaymentTermOption
                            )
                          }
                        >
                          <SelectTrigger className="h-9 mt-1">
                            <SelectValue
                              placeholder={t(
                                "suppliers_payment_terms_select_placeholder"
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              [
                                "immediate",
                                "net30",
                                "net60",
                                "eom",
                                "custom",
                              ] as PaymentTermOption[]
                            ).map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {t(`suppliers_payment_terms_option_${opt}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {editedPaymentTermsOption === "custom" && (
                          <Input
                            value={customPaymentTerm}
                            onChange={(e) =>
                              setCustomPaymentTerm(e.target.value)
                            }
                            placeholder={t(
                              "suppliers_payment_terms_custom_placeholder"
                            )}
                            className="h-9 mt-1"
                            disabled={isSavingContact}
                          />
                        )}
                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setIsEditingPaymentTerms(false);
                              const terms = selectedSupplier.paymentTerms || "";
                              const pO: PaymentTermOption[] = [
                                "immediate",
                                "net30",
                                "net60",
                                "eom",
                              ];
                              const mO = pO.find(
                                (opt) =>
                                  t(`suppliers_payment_terms_option_${opt}`) ===
                                  terms
                              );
                              if (mO) {
                                setEditedPaymentTermsOption(mO);
                                setCustomPaymentTerm("");
                              } else if (terms) {
                                setEditedPaymentTermsOption("custom");
                                setCustomPaymentTerm(terms);
                              } else {
                                setEditedPaymentTermsOption("custom");
                                setCustomPaymentTerm("");
                              }
                            }}
                            variant="outline"
                            disabled={isSavingContact}
                          >
                            <X className="mr-1 h-4 w-4" /> {t("cancel_button")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSavePaymentTerms}
                            disabled={isSavingContact}
                          >
                            {isSavingContact ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="mr-1 h-4 w-4" />
                            )}
                            {t("save_button")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p>
                        {getDisplayPaymentTerm(
                          selectedSupplier.paymentTerms,
                          t
                        )}
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="overflow-hidden">
                  <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base flex items-center">
                      <BarChart3 className="mr-2 h-4 w-4 text-primary" />{" "}
                      {t("suppliers_monthly_spending_title")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent
                    className={cn(
                      "min-h-[200px] p-0 sm:pb-2",
                      isMobile && "overflow-x-auto"
                    )}
                  >
                    {monthlySpendingData.length > 0 &&
                    monthlySpendingData.some((d) => d.total > 0) ? (
                      <div
                        className={cn(
                          "w-full",
                          isMobile
                            ? "min-w-[calc(100vw-8rem)]"
                            : "sm:w-11/12 mx-auto"
                        )}
                      >
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart
                            data={monthlySpendingData}
                            margin={{
                              top: 5,
                              right: isMobile ? 0 : 5,
                              left: isMobile ? -30 : -25,
                              bottom: isMobile ? 40 : 20,
                            }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              vertical={false}
                            />
                            <RechartsXAxis
                              dataKey="month"
                              fontSize={isMobile ? 8 : 10}
                              tickLine={false}
                              axisLine={false}
                              tick={
                                {
                                  angle: isMobile ? -45 : 0,
                                  textAnchor: isMobile ? "end" : "middle",
                                } as any
                              }
                              height={isMobile ? 40 : 20}
                              interval={
                                isMobile
                                  ? Math.max(
                                      0,
                                      Math.floor(
                                        monthlySpendingData.length / 3
                                      ) - 1
                                    )
                                  : "preserveStartEnd"
                              }
                            />
                            <RechartsYAxis
                              fontSize={isMobile ? 8 : 10}
                              tickFormatter={(value) =>
                                `${t("currency_symbol")}${value / 1000}k`
                              }
                              tickLine={false}
                              axisLine={false}
                              width={isMobile ? 30 : 50}
                            />
                            <RechartsTooltip
                              formatter={(
                                value: number,
                                name: string,
                                props: any
                              ) => [
                                formatCurrencyDisplay(value, t),
                                t("suppliers_tooltip_total_spent"),
                              ]}
                            />
                            <RechartsLegend
                              wrapperStyle={{
                                fontSize: isMobile ? "10px" : "12px",
                              }}
                            />
                            <Bar
                              dataKey="total"
                              fill="hsl(var(--primary))"
                              radius={[4, 4, 0, 0]}
                              name={t("suppliers_bar_name_spending")}
                              barSize={isMobile ? 8 : undefined}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        {t("suppliers_no_spending_data")}
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center">
                      <ListChecks className="mr-2 h-4 w-4 text-primary" />{" "}
                      {t("suppliers_activity_timeline_title")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedSupplierInvoices.length > 0 ? (
                      <ScrollArea className="space-y-3 max-h-60 pr-2">
                        {selectedSupplierInvoices
                          .slice(0, 10)
                          .map((invoice, index) => (
                            <React.Fragment key={invoice.id}>
                              <div className="flex items-start space-x-3">
                                <div className="flex flex-col items-center">
                                  <div
                                    className={cn(
                                      "mt-1 h-3 w-3 rounded-full",
                                      invoice.status === "completed"
                                        ? "bg-green-500"
                                        : invoice.status === "error"
                                        ? "bg-destructive"
                                        : "bg-yellow-500"
                                    )}
                                  />
                                  {index <
                                    selectedSupplierInvoices.slice(0, 10)
                                      .length -
                                      1 && (
                                    <div className="h-full w-px bg-border" />
                                  )}
                                </div>
                                <div className="pb-3 flex-1">
                                  <p className="text-xs text-muted-foreground">
                                    {formatDateDisplay(
                                      invoice.uploadTime as
                                        | string
                                        | Timestamp
                                        | Date
                                        | undefined,
                                      t,
                                      "PPp"
                                    )}
                                  </p>
                                  <p className="text-sm font-medium">
                                    <Button
                                      variant="link"
                                      className="p-0 h-auto text-sm"
                                      onClick={() =>
                                        navigateToInvoiceDetails(invoice.id)
                                      }
                                    >
                                      {invoice.generatedFileName ||
                                        invoice.originalFileName}{" "}
                                      {invoice.invoiceNumber &&
                                        `(#${invoice.invoiceNumber})`}
                                    </Button>
                                  </p>
                                  <div className="text-xs text-muted-foreground">
                                    {t("suppliers_invoice_total")}:{" "}
                                    {formatCurrencyDisplay(
                                      invoice.totalAmount,
                                      t
                                    )}{" "}
                                    - {t("upload_history_col_status")}:{" "}
                                    {renderStatusBadge(invoice.status, t)}
                                  </div>
                                </div>
                              </div>
                            </React.Fragment>
                          ))}
                      </ScrollArea>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        {t("suppliers_no_invoices_found_for_supplier")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          )}
          <SheetFooter className="p-4 sm:p-6 border-t shrink-0">
            <SheetClose asChild>
              <Button variant="outline">{t("invoices_close_button")}</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <CreateSupplierSheet
        isOpen={isCreateSheetOpen}
        onOpenChange={setIsCreateSheetOpen}
        onCreateSupplier={handleCreateSupplier}
      />
    </div>
  );
}
