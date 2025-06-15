"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Search,
  Filter,
  Loader2,
  XCircle,
  Clock,
  Trash2,
  Edit,
  Save,
  Eye,
  FileText as FileTextIcon,
  CalendarDays,
  Grid,
  ListChecks,
  Briefcase,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  MoreHorizontal,
  PlusCircle,
  FileDown,
  Archive,
  AlertCircle,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Timestamp, FieldValue, serverTimestamp } from "firebase/firestore";
import {
  format,
  parseISO,
  isValid,
  isSameDay,
  isAfter,
  isBefore,
} from "date-fns";
import { enUS, he } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  getInvoicesService,
  deleteInvoiceService,
  updateInvoiceService,
  getSuppliersService,
  getUserSettingsService,
  updateInvoicePaymentStatusService,
} from "@/services/backend";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import NextImage from "next/image";
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
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/contexts/AuthContext";
import { Checkbox } from "@/components/ui/checkbox";
import PaymentReceiptUploadDialog from "@/components/PaymentReceiptUploadDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { Skeleton } from "@/components/ui/skeleton";
import { generateAndEmailInvoicesAction } from "@/actions/invoice-export-actions";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import type { Invoice, InvoiceHistoryItem, Supplier } from "@/services/types";

const ITEMS_PER_PAGE = 8;

type SortKeyDocuments =
  | keyof Pick<
      Invoice,
      | "originalFileName"
      | "uploadTime"
      | "supplierName"
      | "invoiceDate"
      | "paymentDate"
      | "totalAmount"
      | "paymentMethod"
      | "paymentStatus"
      | "documentType"
    >
  | "paymentReceiptImageUri"
  | "";

type DisplayInvoice = InvoiceHistoryItem & {
  _displayContext?: "new-upload" | "error-upload";
};

const isValidImageSrc = (src: string | undefined | null): src is string => {
  if (!src || typeof src !== "string") return false;
  return (
    src.startsWith("data:image") ||
    src.startsWith("http://") ||
    src.startsWith("https://")
  );
};

const getStatusInfo = (
  status: DisplayInvoice["status"],
  t: (key: string) => string
) => {
  switch (status) {
    case "completed":
      return {
        label: t("invoices_status_completed"),
        icon: CheckCircle,
        color: "text-green-500",
      };
    case "pending":
      return {
        label: t("invoices_status_pending"),
        icon: Clock,
        color: "text-yellow-500",
      };
    case "processing":
      return {
        label: t("invoices_status_processing"),
        icon: Loader2,
        color: "text-blue-500 animate-spin",
      };
    case "error":
      return {
        label: t("invoices_status_error"),
        icon: XCircle,
        color: "text-red-500",
      };
    case "archived":
      return {
        label: t("invoices_status_archived"),
        icon: Archive,
        color: "text-gray-500",
      };
    default:
      return {
        label: t("invoices_status_unknown"),
        icon: AlertCircle,
        color: "text-gray-400",
      };
  }
};

const getPaymentStatusInfo = (
  status: DisplayInvoice["paymentStatus"],
  t: (key: string) => string
) => {
  switch (status) {
    case "paid":
      return {
        label: t("invoices_payment_status_paid"),
        variant: "success",
      };
    case "unpaid":
      return {
        label: t("invoices_payment_status_unpaid"),
        variant: "destructive",
      };
    case "pending_payment":
    default:
      return {
        label: t("invoices_payment_status_pending"),
        variant: "secondary",
      };
  }
};

export default function DocumentsPage() {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useTranslation();
  const router = useRouter();
  const searchParamsHook = useSearchParams();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [allUserInvoices, setAllUserInvoices] = useState<DisplayInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [filterDocumentType, setFilterDocumentType] = useState<
    "deliveryNote" | "invoice" | "paymentReceipt" | ""
  >("");
  const [filterSupplier, setFilterSupplier] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const [filterPaymentStatus, setFilterPaymentStatus] = useState<
    DisplayInvoice["paymentStatus"] | ""
  >("");
  const [sortKey, setSortKey] = useState<SortKeyDocuments>("uploadTime");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [showDetailsSheet, setShowDetailsSheet] = useState(false);
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] =
    useState<DisplayInvoice | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedInvoiceData, setEditedInvoiceData] = useState<
    Partial<DisplayInvoice>
  >({});
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  const [selectedInvoiceForEdit, setSelectedInvoiceForEdit] =
    useState<DisplayInvoice | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("grid");
  const [isExporting, setIsExporting] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const [existingSuppliers, setExistingSuppliers] = useState<Supplier[]>([]);
  const [showReceiptUploadDialog, setShowReceiptUploadDialog] = useState(false);
  const [invoiceForReceiptUpload, setInvoiceForReceiptUpload] =
    useState<DisplayInvoice | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedForBulkAction, setSelectedForBulkAction] = useState<string[]>(
    []
  );
  const [accountantEmail, setAccountantEmail] = useState("");
  const [emailNote, setEmailNote] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [fetchInvoicesTrigger, setFetchInvoicesTrigger] = useState(0);

  const documentColumnDefinitions: Array<{
    key: string;
    labelKey: string;
    sortable: boolean;
    className?: string;
    mobileHidden?: boolean;
    headerClassName?: string;
  }> = useMemo(
    () => [
      {
        key: "selection",
        labelKey: "invoice_export_select_column_header",
        sortable: false,
        className: "w-[4%] text-center px-1 sticky left-0 bg-card z-20",
        headerClassName: "sticky left-0 bg-card z-20",
      },
      {
        key: "actions",
        labelKey: "edit_invoice_th_actions",
        sortable: false,
        className:
          "w-[6%] text-center px-1 sm:px-2 sticky left-10 bg-card z-10",
        headerClassName: "sticky left-10 bg-card z-10",
      },
      {
        key: "originalImagePreviewUri",
        labelKey: "inventory_col_image",
        sortable: false,
        className: "w-12 text-center px-1 sm:px-2 py-1",
        headerClassName: "text-center px-1 sm:px-2 py-1",
      },
      {
        key: "generatedFileName",
        labelKey: "upload_history_col_file_name",
        sortable: true,
        className: "w-[20%] sm:w-[25%] min-w-[80px] sm:min-w-[100px] truncate",
      },
      {
        key: "uploadTime",
        labelKey: "upload_history_col_upload_time",
        sortable: true,
        className: "min-w-[130px] sm:min-w-[150px]",
        mobileHidden: true,
      },
      {
        key: "paymentStatus",
        labelKey: "invoice_payment_status_label",
        sortable: true,
        className: "min-w-[100px] sm:min-w-[120px]",
      },
      {
        key: "paymentDueDate",
        labelKey: "payment_due_date_dialog_title",
        sortable: true,
        className: "min-w-[100px] sm:min-w-[120px]",
        mobileHidden: true,
      },
      {
        key: "invoiceNumber",
        labelKey: "invoices_col_inv_number",
        sortable: true,
        className: "min-w-[100px] sm:min-w-[120px]",
        mobileHidden: true,
      },
      {
        key: "supplierName",
        labelKey: "invoice_details_supplier_label",
        sortable: true,
        className: "min-w-[120px] sm:min-w-[150px]",
        mobileHidden: true,
      },
      {
        key: "totalAmount",
        labelKey: "invoices_col_total_currency",
        sortable: true,
        className: "text-right min-w-[100px] sm:min-w-[120px]",
      },
      {
        key: "paymentMethod",
        labelKey: "invoice_details_payment_method_label",
        sortable: true,
        className: "min-w-[100px] sm:min-w-[120px]",
        mobileHidden: true,
      },
      {
        key: "paymentReceiptImageUri",
        labelKey: "paid_invoices_receipt_image_label",
        sortable: false,
        className: "text-center",
        mobileHidden: true,
      },
    ],
    [t]
  );

  const defaultDocumentColumns: Record<string, boolean> = useMemo(
    () => ({
      selection: true,
      actions: true,
      originalImagePreviewUri: true,
      generatedFileName: true,
      uploadTime: !isMobile,
      paymentStatus: true,
      paymentDate: !isMobile,
      invoiceNumber: !isMobile,
      supplierName: !isMobile,
      totalAmount: true,
      paymentMethod: false,
      paymentReceiptImageUri: false,
    }),
    [isMobile]
  );

  const [visibleDocumentColumns, setVisibleDocumentColumns] = useState(
    defaultDocumentColumns
  );

  const formatDateForDisplay = useCallback(
    (
      dateInput: string | Date | Timestamp | undefined | null,
      formatStr: string = "PPp"
    ) => {
      if (!dateInput) return t("invoices_na");
      try {
        let dateObj: Date | null = null;
        if (dateInput instanceof Timestamp) dateObj = dateInput.toDate();
        else if (typeof dateInput === "string" && isValid(parseISO(dateInput)))
          dateObj = parseISO(dateInput);
        else if (dateInput instanceof Date && isValid(dateInput))
          dateObj = dateInput;

        if (!dateObj || !isValid(dateObj)) {
          return t("invoices_invalid_date");
        }
        const dateLocale = locale === "he" ? he : enUS;
        return window.innerWidth < 640
          ? format(dateObj, "dd/MM/yy HH:mm", { locale: dateLocale })
          : format(dateObj, formatStr, { locale: dateLocale });
      } catch (e) {
        return t("invoices_invalid_date");
      }
    },
    [locale, t]
  );

  const formatCurrencyDisplay = useCallback(
    (
      value: number | undefined | null,
      options?: { decimals?: number; useGrouping?: boolean }
    ): string => {
      const { decimals = 2, useGrouping = true } = options || {};
      if (value === null || value === undefined || isNaN(value)) {
        const zeroFormatted = (0).toLocaleString(
          t("locale_code_for_number_formatting") || undefined,
          {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
          }
        );
        return `${t("currency_symbol")}${zeroFormatted}`;
      }
      const formattedValue = value.toLocaleString(
        t("locale_code_for_number_formatting") || undefined,
        {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: useGrouping,
        }
      );
      return `${t("currency_symbol")}${formattedValue}`;
    },
    [t]
  );

  const renderPaymentStatusBadge = (
    status: DisplayInvoice["paymentStatus"],
    dueDate?: string | Timestamp | null | FieldValue
  ) => {
    let variant: "default" | "secondary" | "destructive" | "outline" =
      "default";
    let className = "";
    let icon: React.ReactNode = null;
    let labelKey = "";
    let currentStatus = status;

    if (status === "pending_payment" && dueDate) {
      let dueDateObj: Date | null = null;
      if (dueDate instanceof Timestamp) dueDateObj = dueDate.toDate();
      else if (typeof dueDate === "string" && isValid(parseISO(dueDate)))
        dueDateObj = parseISO(dueDate);

      if (
        dueDateObj &&
        isValid(dueDateObj) &&
        isBefore(dueDateObj, new Date()) &&
        !isSameDay(dueDateObj, new Date())
      ) {
        currentStatus = "unpaid";
      }
    }

    switch (currentStatus) {
      case "paid":
        variant = "secondary";
        className =
          "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80";
        icon = <CreditCard className="mr-1 h-3 w-3" />;
        labelKey = "invoice_payment_status_paid";
        break;
      case "unpaid":
        variant = "destructive";
        className =
          "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-100/80";
        icon = <Clock className="mr-1 h-3 w-3" />;
        labelKey = "invoice_payment_status_unpaid";
        break;
      case "pending_payment":
        variant = "secondary";
        className =
          "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80";
        icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />;
        labelKey = "invoice_payment_status_pending_payment";
        break;
      default:
        variant = "outline";
        icon = null;
        labelKey = String(status);
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
        {t(labelKey as any) ||
          (typeof status === "string"
            ? status.charAt(0).toUpperCase() + status.slice(1)
            : "")}
      </Badge>
    );
  };

  const triggerInvoiceFetch = useCallback(() => {
    setFetchInvoicesTrigger((prev) => prev + 1);
  }, []);

  const fetchUserData = useCallback(async () => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [invoicesData, suppliersData, settingsData] = await Promise.all([
        getInvoicesService(user.id),
        getSuppliersService(user.id),
        getUserSettingsService(user.id),
      ]);
      setAllUserInvoices(invoicesData);
      setExistingSuppliers(suppliersData);
      if (settingsData?.accountantSettings?.email) {
        setAccountantEmail(settingsData.accountantSettings.email);
      }
    } catch (error) {
      toast({
        title: t("invoices_toast_error_fetch_invoices_title"),
        description: `${t("invoices_toast_error_fetch_invoices_desc")} (${
          (error as Error).message
        })`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [
    user,
    toast,
    t,
    getInvoicesService,
    getSuppliersService,
    getUserSettingsService,
  ]);

  useEffect(() => {
    if (user?.id) {
      fetchUserData();
    } else if (!authLoading && !user) {
      router.push("/login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router, fetchInvoicesTrigger]);

  const handleViewDetails = useCallback((invoice: DisplayInvoice) => {
    if (invoice) {
      setSelectedInvoiceDetails({ ...invoice });
      setEditedInvoiceData({ ...invoice });
      setIsEditingDetails(false);
      setShowDetailsSheet(true);
    }
  }, []);

  useEffect(() => {
    const viewInvoiceId = searchParamsHook.get("viewInvoiceId");
    if (viewInvoiceId && allUserInvoices.length > 0 && !showDetailsSheet) {
      const invoiceToView = allUserInvoices.find(
        (inv) => inv.id === viewInvoiceId
      );
      if (invoiceToView) {
        handleViewDetails(invoiceToView);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsHook, allUserInvoices, showDetailsSheet]);

  const filteredAndSortedInvoices = useMemo(() => {
    let result = [...allUserInvoices];

    if (filterDocumentType)
      result = result.filter((inv) => inv.documentType === filterDocumentType);
    if (filterSupplier)
      result = result.filter((inv) => inv.supplierName === filterSupplier);
    if (dateRange?.from) {
      const startDate = new Date(dateRange.from);
      startDate.setHours(0, 0, 0, 0);
      result = result.filter((inv) => {
        if (!inv.uploadTime) return false;
        let invDate = (inv.uploadTime as Timestamp).toDate();
        return isAfter(invDate, startDate) || isSameDay(invDate, startDate);
      });
    }
    if (dateRange?.to) {
      const endDate = new Date(dateRange.to);
      endDate.setHours(23, 59, 59, 999);
      result = result.filter((inv) => {
        if (!inv.uploadTime) return false;
        let invDate = (inv.uploadTime as Timestamp).toDate();
        return isBefore(invDate, endDate) || isSameDay(invDate, endDate);
      });
    }
    if (filterPaymentStatus) {
      result = result.filter((inv) => {
        let currentStatus = inv.paymentStatus;
        if (inv.paymentStatus === "pending_payment" && inv.paymentDate) {
          let dueDateObj = (inv.paymentDate as Timestamp).toDate();
          if (
            isValid(dueDateObj) &&
            isBefore(dueDateObj, new Date()) &&
            !isSameDay(dueDateObj, new Date())
          ) {
            currentStatus = "unpaid";
          }
        }
        return currentStatus === filterPaymentStatus;
      });
    }
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(
        (item) =>
          (item.originalFileName || "")
            .toLowerCase()
            .includes(lowerSearchTerm) ||
          (item.invoiceNumber &&
            item.invoiceNumber.toLowerCase().includes(lowerSearchTerm)) ||
          (item.supplierName &&
            item.supplierName.toLowerCase().includes(lowerSearchTerm))
      );
    }
    if (sortKey) {
      result.sort((a, b) => {
        const valA = a[sortKey as keyof DisplayInvoice];
        const valB = b[sortKey as keyof DisplayInvoice];
        let comparison = 0;
        if (
          sortKey === "uploadTime" ||
          sortKey === "paymentDate" ||
          sortKey === "invoiceDate"
        ) {
          let dateA = 0;
          let dateB = 0;
          const aDateVal = valA as Timestamp | Date | string | null | undefined;
          const bDateVal = valB as Timestamp | Date | string | null | undefined;

          if (aDateVal) {
            if (aDateVal instanceof Timestamp)
              dateA = aDateVal.toDate().getTime();
            else if (
              typeof aDateVal === "string" &&
              isValid(parseISO(aDateVal))
            )
              dateA = parseISO(aDateVal).getTime();
            else if (aDateVal instanceof Date && isValid(aDateVal))
              dateA = aDateVal.getTime();
          }
          if (bDateVal) {
            if (bDateVal instanceof Timestamp)
              dateB = bDateVal.toDate().getTime();
            else if (
              typeof bDateVal === "string" &&
              isValid(parseISO(bDateVal))
            )
              dateB = parseISO(bDateVal).getTime();
            else if (bDateVal instanceof Date && isValid(bDateVal))
              dateB = bDateVal.getTime();
          }
          comparison = dateA - dateB;
        } else if (typeof valA === "number" && typeof valB === "number") {
          comparison = (valA || 0) - (valB || 0);
        } else if (typeof valA === "string" && typeof valB === "string") {
          comparison = (valA || "").localeCompare(valB || "", locale);
        }
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }
    return result;
  }, [
    allUserInvoices,
    filterDocumentType,
    filterSupplier,
    dateRange,
    searchTerm,
    filterPaymentStatus,
    sortKey,
    sortDirection,
    locale,
  ]);

  const totalPages = Math.ceil(
    filteredAndSortedInvoices.length / ITEMS_PER_PAGE
  );
  const paginatedInvoices = filteredAndSortedInvoices.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleEditScannedDoc = (
    invoiceId: string,
    docType: "deliveryNote" | "invoice",
    fileName: string
  ) => {
    const queryParams = new URLSearchParams({
      tempInvoiceId: invoiceId,
      docType: docType,
      originalFileName: encodeURIComponent(fileName || "unknown_doc"),
    });
    router.push(`/edit-invoice?${queryParams.toString()}`);
  };

  const handleDeleteInvoice = async (invoiceIdOrIds: string | string[]) => {
    if (!user?.id) return;
    setIsDeleting(true);
    try {
      const idsToDelete = Array.isArray(invoiceIdOrIds)
        ? invoiceIdOrIds
        : [invoiceIdOrIds];
      await Promise.all(
        idsToDelete.map((id) => deleteInvoiceService(id, user.id))
      );
      toast({
        title:
          idsToDelete.length > 1
            ? t("invoices_toast_bulk_delete_success_title", {
                count: idsToDelete.length,
              })
            : t("invoices_toast_delete_success_title"),
      });
      triggerInvoiceFetch();
      setShowDetailsSheet(false);
      setSelectedInvoiceDetails(null);
      setSelectedForBulkAction([]);
    } catch (error) {
      toast({
        title: t("invoices_toast_delete_fail_title"),
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEditDetailsInputChange = (
    field: keyof DisplayInvoice,
    value: string | number | Date | undefined | null | Timestamp
  ) => {
    setEditedInvoiceData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveInvoiceDetails = async () => {
    if (!selectedInvoiceDetails?.id || !user?.id) return;
    setIsSavingDetails(true);
    try {
      const updatedInvoice = await updateInvoiceService(
        selectedInvoiceDetails.id,
        editedInvoiceData as any,
        user.id
      );
      triggerInvoiceFetch();
      setSelectedInvoiceDetails(updatedInvoice);
      setIsEditingDetails(false);
      toast({ title: t("invoices_toast_save_success_title") });
    } catch (error) {
      toast({
        title: t("invoices_toast_save_fail_title"),
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handlePaymentReceiptUploaded = async (
    invoiceId: string,
    receiptUri: string
  ) => {
    if (!user?.id) return;
    try {
      await updateInvoicePaymentStatusService(
        invoiceId,
        "paid",
        user.id,
        receiptUri
      );
      triggerInvoiceFetch();
      setShowReceiptUploadDialog(false);
      toast({ title: t("paid_invoices_receipt_upload_success_title") });
    } catch (error) {
      toast({
        title: t("paid_invoices_receipt_upload_fail_title"),
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const handleSelectInvoiceForBulkAction = (
    invoiceId: string,
    checked: boolean
  ) => {
    if (invoiceId === "all-current-view") {
      setSelectedForBulkAction(
        checked ? paginatedInvoices.map((inv) => inv.id) : []
      );
    } else {
      setSelectedForBulkAction((prev) =>
        checked ? [...prev, invoiceId] : prev.filter((id) => id !== invoiceId)
      );
    }
  };

  const handleOpenExportDialog = async () => {
    if (selectedForBulkAction.length === 0) {
      toast({
        title: t("invoice_export_error_no_selection_title"),
        description: t("invoice_export_error_no_selection_desc"),
        variant: "destructive",
      });
      return;
    }
    setShowExportDialog(true);
  };

  const handleExportSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !user?.id ||
      !accountantEmail.trim() ||
      selectedForBulkAction.length === 0
    ) {
      toast({
        title: t("invoice_export_error_invalid_email_title"),
        variant: "destructive",
      });
      return;
    }
    setIsExporting(true);
    try {
      const result = await generateAndEmailInvoicesAction(
        selectedForBulkAction,
        accountantEmail,
        emailNote,
        user.id
      );
      if (result.success) {
        toast({
          title: t("invoice_export_success_title"),
          description: result.message,
        });
        setShowExportDialog(false);
        setSelectedForBulkAction([]);
        setEmailNote("");
      } else {
        toast({
          title: t("invoice_export_error_title"),
          description: result.message,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: t("invoice_export_error_unexpected_title"),
        description: t("invoice_export_error_unexpected_desc", {
          message: error.message,
        }),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
              <FileTextIcon className="mr-2 h-5 sm:h-6 w-5 sm:w-6" />{" "}
              {t("documents_page_title")}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
                className={cn(
                  "h-9 w-9 sm:h-10 sm:w-10",
                  showAdvancedFilters && "bg-accent text-accent-foreground"
                )}
                aria-label={t("filter_options_button_aria")}
              >
                <Filter className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const newMode = viewMode === "list" ? "grid" : "list";
                  setViewMode(newMode);
                }}
                className="h-9 sm:h-10 px-3"
                aria-label={t("invoices_toggle_view_mode_aria")}
              >
                {viewMode === "list" ? (
                  <Grid className="h-4 w-4 sm:h-5 sm:w-5" />
                ) : (
                  <ListChecks className="h-4 w-4 sm:h-5 sm:w-5" />
                )}
              </Button>
            </div>
          </div>
          <CardDescription>{t("documents_page_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative w-full md:max-w-xs lg:max-w-sm mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("inventory_search_placeholder")}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-10 h-10 w-full"
              aria-label={t("invoices_search_aria")}
            />
          </div>

          {showAdvancedFilters && (
            <div className="mb-4 flex flex-wrap items-center gap-3 p-3 border rounded-md bg-muted/50">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="relative">
                    <CalendarDays className="mr-2 h-4 w-4" />
                    <span>{t("filter_label_dates")}</span>
                    {dateRange && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute -top-2 -right-2 h-5 w-5"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDateRange(undefined);
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={isMobile ? 1 : 2}
                  />
                </PopoverContent>
              </Popover>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="relative">
                    <Briefcase className="mr-2 h-4 w-4" />
                    <span>
                      {filterSupplier || t("invoices_filter_supplier_all")}
                    </span>
                    {filterSupplier && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute -top-2 -right-2 h-5 w-5"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilterSupplier("");
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>
                    {t("invoices_filter_supplier_label")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={!filterSupplier}
                    onCheckedChange={() => setFilterSupplier("")}
                  >
                    {t("invoices_filter_supplier_all")}
                  </DropdownMenuCheckboxItem>
                  {existingSuppliers.map((supplier) => (
                    <DropdownMenuCheckboxItem
                      key={supplier.id}
                      checked={filterSupplier === supplier.name}
                      onCheckedChange={() => setFilterSupplier(supplier.name)}
                    >
                      {supplier.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="relative">
                    <CreditCard className="mr-2 h-4 w-4" />
                    <span>
                      {filterPaymentStatus
                        ? t(`invoice_payment_status_${filterPaymentStatus}`)
                        : t("invoices_filter_payment_status_all")}
                    </span>
                    {filterPaymentStatus && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute -top-2 -right-2 h-5 w-5"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilterPaymentStatus("");
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>
                    {t("filter_label_payment_status")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={!filterPaymentStatus}
                    onCheckedChange={() => setFilterPaymentStatus("")}
                  >
                    {t("invoices_filter_payment_status_all")}
                  </DropdownMenuCheckboxItem>
                  {(["pending_payment", "unpaid", "paid"] as const).map(
                    (status) => (
                      <DropdownMenuCheckboxItem
                        key={status}
                        checked={filterPaymentStatus === status}
                        onCheckedChange={() => setFilterPaymentStatus(status)}
                      >
                        {t(`invoice_payment_status_${status}`)}
                      </DropdownMenuCheckboxItem>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : viewMode === "list" ? (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-card z-20 w-[4%]">
                      <Checkbox
                        checked={
                          selectedForBulkAction.length ===
                            paginatedInvoices.length &&
                          paginatedInvoices.length > 0
                        }
                        onCheckedChange={(checked) =>
                          handleSelectInvoiceForBulkAction(
                            "all-current-view",
                            checked as boolean
                          )
                        }
                      />
                    </TableHead>
                    {documentColumnDefinitions
                      .filter(
                        (c) =>
                          c.key !== "selection" &&
                          (!c.mobileHidden || !isMobile) &&
                          visibleDocumentColumns[c.key]
                      )
                      .map((col) => (
                        <TableHead
                          key={col.key}
                          className={cn(col.headerClassName)}
                        >
                          <Button
                            variant="ghost"
                            onClick={() =>
                              col.sortable &&
                              setSortKey(col.key as SortKeyDocuments)
                            }
                          >
                            {t(col.labelKey as any)}
                          </Button>
                        </TableHead>
                      ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedInvoices.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={documentColumnDefinitions.length}
                        className="h-24 text-center"
                      >
                        {t("invoices_no_results_found")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="sticky left-0 bg-card z-20 w-[4%]">
                          <Checkbox
                            checked={selectedForBulkAction.includes(invoice.id)}
                            onCheckedChange={(checked) =>
                              handleSelectInvoiceForBulkAction(
                                invoice.id,
                                checked as boolean
                              )
                            }
                          />
                        </TableCell>
                        {documentColumnDefinitions
                          .filter(
                            (c) =>
                              c.key !== "selection" &&
                              (!c.mobileHidden || !isMobile) &&
                              visibleDocumentColumns[c.key]
                          )
                          .map((col) => (
                            <TableCell
                              key={col.key}
                              className={cn(col.className)}
                            >
                              {col.key === "actions" ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleViewDetails(invoice)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              ) : col.key === "originalImagePreviewUri" ? (
                                <div className="flex justify-center items-center h-10 w-10">
                                  {isValidImageSrc(
                                    invoice.originalImagePreviewUri
                                  ) ? (
                                    <NextImage
                                      src={invoice.originalImagePreviewUri}
                                      alt="Preview"
                                      width={40}
                                      height={40}
                                      className="rounded-md object-cover cursor-pointer"
                                      onClick={() => handleViewDetails(invoice)}
                                    />
                                  ) : (
                                    <FileTextIcon className="h-6 w-6 text-muted-foreground" />
                                  )}
                                </div>
                              ) : col.key === "uploadTime" ||
                                col.key === "invoiceDate" ||
                                col.key === "paymentDueDate" ? (
                                formatDateForDisplay(
                                  invoice[col.key as keyof DisplayInvoice] as
                                    | Timestamp
                                    | string
                                    | Date
                                    | null
                                    | undefined,
                                  "PP"
                                )
                              ) : col.key === "totalAmount" ? (
                                formatCurrencyDisplay(invoice.totalAmount)
                              ) : col.key === "paymentStatus" ? (
                                renderPaymentStatusBadge(
                                  invoice.paymentStatus,
                                  invoice.paymentDate
                                )
                              ) : (
                                <span className="truncate">
                                  {(invoice[
                                    col.key as keyof DisplayInvoice
                                  ] as string) || t("invoices_na")}
                                </span>
                              )}
                            </TableCell>
                          ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            // Grid View
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {paginatedInvoices.length === 0 ? (
                <p>{t("invoices_no_results_found")}</p>
              ) : (
                paginatedInvoices.map((invoice) => (
                  <Card
                    key={invoice.id}
                    className="flex flex-col cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => handleViewDetails(invoice)}
                  >
                    <CardHeader className="p-0">
                      <div className="relative w-full h-40">
                        {isValidImageSrc(invoice.originalImagePreviewUri) ? (
                          <NextImage
                            src={invoice.originalImagePreviewUri}
                            alt={invoice.originalFileName || "Invoice"}
                            layout="fill"
                            className="object-cover rounded-t-lg"
                          />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center rounded-t-lg">
                            <FileTextIcon className="w-16 h-16 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="flex-grow p-4">
                      <p className="font-semibold truncate">
                        {invoice.generatedFileName || invoice.originalFileName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {invoice.supplierName || t("invoices_na")}
                      </p>
                      <p className="text-lg font-bold">
                        {formatCurrencyDisplay(invoice.totalAmount)}
                      </p>
                    </CardContent>
                    <CardFooter className="flex justify-between items-center p-4">
                      <div className="flex items-center mt-1">
                        <strong className="mr-1">
                          {t("invoice_payment_status_label")}:
                        </strong>
                        {renderPaymentStatusBadge(
                          invoice.paymentStatus,
                          invoice.paymentDate
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDateForDisplay(
                          invoice.uploadTime as Timestamp,
                          "PP"
                        )}
                      </p>
                    </CardFooter>
                  </Card>
                ))
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {t("pagination_showing_label", {
                start: Math.min(
                  filteredAndSortedInvoices.length > 0
                    ? (currentPage - 1) * ITEMS_PER_PAGE + 1
                    : 0,
                  filteredAndSortedInvoices.length
                ),
                end: Math.min(
                  currentPage * ITEMS_PER_PAGE,
                  filteredAndSortedInvoices.length
                ),
                total: filteredAndSortedInvoices.length,
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span>
                {t("pagination_page_indicator", { currentPage, totalPages })}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages || totalPages === 0}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {selectedForBulkAction.length > 0 && (
            <div className="mt-4 p-3 bg-muted rounded-lg flex items-center justify-between">
              <p className="text-sm font-medium">
                {t("bulk_action_selected_count", {
                  count: selectedForBulkAction.length,
                })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenExportDialog}
                >
                  {t("invoice_export_button_text")}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      {t("bulk_action_delete_button")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("bulk_delete_confirm_title")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("bulk_delete_confirm_message", {
                          count: selectedForBulkAction.length,
                        })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("cancel_button")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          handleDeleteInvoice(selectedForBulkAction)
                        }
                      >
                        {isDeleting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        {t("delete_button")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Sheet */}
      <Sheet open={showDetailsSheet} onOpenChange={setShowDetailsSheet}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("invoice_details_title")}</SheetTitle>
            <SheetDescription>
              {selectedInvoiceDetails?.generatedFileName ||
                selectedInvoiceDetails?.originalFileName}
            </SheetDescription>
          </SheetHeader>
          <div className="py-4 space-y-4">
            {isEditingDetails ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="supplierName">
                    {t("invoice_details_supplier_label")}
                  </Label>
                  <Input
                    id="supplierName"
                    value={editedInvoiceData.supplierName || ""}
                    onChange={(e) =>
                      handleEditDetailsInputChange(
                        "supplierName",
                        e.target.value
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoiceNumber">
                    {t("invoices_col_inv_number")}
                  </Label>
                  <Input
                    id="invoiceNumber"
                    value={editedInvoiceData.invoiceNumber || ""}
                    onChange={(e) =>
                      handleEditDetailsInputChange(
                        "invoiceNumber",
                        e.target.value
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="totalAmount">
                    {t("invoices_col_total_currency")}
                  </Label>
                  <Input
                    id="totalAmount"
                    type="number"
                    value={editedInvoiceData.totalAmount?.toString() || ""}
                    onChange={(e) =>
                      handleEditDetailsInputChange(
                        "totalAmount",
                        e.target.value ? parseFloat(e.target.value) : null
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoiceDate">
                    {t("invoice_details_invoice_date_label")}
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                      >
                        <CalendarDays className="mr-2 h-4 w-4" />
                        {editedInvoiceData.invoiceDate ? (
                          formatDateForDisplay(
                            editedInvoiceData.invoiceDate as Timestamp,
                            "PP"
                          )
                        ) : (
                          <span>{t("select_date_placeholder")}</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={
                          editedInvoiceData.invoiceDate instanceof Timestamp
                            ? editedInvoiceData.invoiceDate.toDate()
                            : (editedInvoiceData.invoiceDate as
                                | Date
                                | undefined)
                        }
                        onSelect={(date) =>
                          handleEditDetailsInputChange("invoiceDate", date)
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </>
            ) : (
              <>
                <div className="relative w-full h-64 mb-4">
                  {isValidImageSrc(
                    selectedInvoiceDetails?.originalImagePreviewUri
                  ) ? (
                    <NextImage
                      src={selectedInvoiceDetails!.originalImagePreviewUri!}
                      alt="Invoice"
                      layout="fill"
                      className="object-contain rounded-md border"
                    />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center rounded-md border">
                      <FileTextIcon className="w-24 h-24 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <Separator />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <p>
                      <strong>{t("invoice_details_file_name_label")}:</strong>{" "}
                      {selectedInvoiceDetails?.originalFileName}
                    </p>
                    <p>
                      <strong>{t("invoice_details_upload_time_label")}:</strong>{" "}
                      {formatDateForDisplay(
                        selectedInvoiceDetails?.uploadTime as Timestamp,
                        "PP"
                      )}
                    </p>
                    <div className="flex items-center">
                      <strong className="mr-1">
                        {t("invoice_details_status_label")}:
                      </strong>{" "}
                      {renderPaymentStatusBadge(
                        selectedInvoiceDetails?.paymentStatus as DisplayInvoice["paymentStatus"],
                        selectedInvoiceDetails?.paymentDate
                      )}
                    </div>
                    <div className="flex items-center mt-1">
                      <strong className="mr-1">
                        {t("invoice_payment_status_label")}:
                      </strong>
                      {renderPaymentStatusBadge(
                        selectedInvoiceDetails?.paymentStatus as DisplayInvoice["paymentStatus"],
                        selectedInvoiceDetails?.paymentDate
                      )}
                    </div>
                  </div>
                  <div>
                    <p>
                      <strong>{t("invoice_details_supplier_label")}:</strong>{" "}
                      {selectedInvoiceDetails?.supplierName || t("invoices_na")}
                    </p>
                    <p>
                      <strong>{t("invoices_col_inv_number")}:</strong>{" "}
                      {selectedInvoiceDetails?.invoiceNumber ||
                        t("invoices_na")}
                    </p>
                    <p>
                      <strong>{t("invoices_col_total_currency")}:</strong>{" "}
                      {formatCurrencyDisplay(
                        selectedInvoiceDetails?.totalAmount
                      )}
                    </p>
                    <p>
                      <strong>
                        {t("invoice_details_invoice_date_label")}:
                      </strong>{" "}
                      {formatDateForDisplay(
                        selectedInvoiceDetails?.invoiceDate as Timestamp,
                        "PP"
                      )}
                    </p>
                    <p>
                      <strong>{t("upload_history_col_upload_time")}:</strong>{" "}
                      {formatDateForDisplay(
                        selectedInvoiceDetails?.uploadTime as Timestamp
                      )}
                    </p>
                    <p>
                      <strong>
                        {t("invoice_details_payment_method_label")}:
                      </strong>{" "}
                      {selectedInvoiceDetails?.paymentMethod
                        ? t(
                            `payment_method_${selectedInvoiceDetails.paymentMethod
                              .toLowerCase()
                              .replace(/\s+/g, "_")}` as any,
                            {
                              defaultValue:
                                selectedInvoiceDetails.paymentMethod,
                            }
                          )
                        : t("invoices_na")}
                    </p>
                    {selectedInvoiceDetails?.paymentStatus === "paid" && (
                      <div className="col-span-2">
                        <strong>
                          {t("paid_invoices_receipt_image_label")}:
                        </strong>
                        {isValidImageSrc(
                          selectedInvoiceDetails?.paymentReceiptImageUri
                        ) ? (
                          <a
                            href={
                              selectedInvoiceDetails!.paymentReceiptImageUri!
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline ml-2"
                          >
                            {t("view_receipt_link")}
                          </a>
                        ) : selectedInvoiceDetails?.paymentReceiptImageUri ? (
                          <span className="ml-2">
                            {t("receipt_available_no_preview")}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-2"
                            onClick={() => {
                              setInvoiceForReceiptUpload(
                                selectedInvoiceDetails
                              );
                              setShowReceiptUploadDialog(true);
                            }}
                          >
                            {t("upload_receipt_button")}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <SheetFooter>
            {isEditingDetails ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setIsEditingDetails(false)}
                >
                  {t("cancel_button")}
                </Button>
                <Button
                  onClick={handleSaveInvoiceDetails}
                  disabled={isSavingDetails}
                >
                  {isSavingDetails && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t("save_button")}
                </Button>
              </>
            ) : (
              <>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="mr-auto">
                      <Trash2 className="mr-2 h-4 w-4" /> {t("delete_button")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("delete_invoice_confirm_title")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("delete_invoice_confirm_message")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("cancel_button")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          handleDeleteInvoice(selectedInvoiceDetails!.id)
                        }
                      >
                        {isDeleting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        {t("delete_button")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Button
                  variant="outline"
                  onClick={() => setIsEditingDetails(true)}
                >
                  <Edit className="mr-2 h-4 w-4" /> {t("edit_button")}
                </Button>
                <SheetClose asChild>
                  <Button>{t("close_button")}</Button>
                </SheetClose>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Export Dialog */}
      <AlertDialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("invoice_export_dialog_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("invoice_export_dialog_description", {
                count: selectedForBulkAction.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form onSubmit={handleExportSubmit}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="accountant-email">
                  {t("invoice_export_email_label")}
                </Label>
                <Input
                  id="accountant-email"
                  type="email"
                  value={accountantEmail}
                  onChange={(e) => setAccountantEmail(e.target.value)}
                  placeholder={t("invoice_export_email_placeholder")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-note">
                  {t("invoice_export_note_label")}
                </Label>
                <Textarea
                  id="email-note"
                  value={emailNote}
                  onChange={(e) => setEmailNote(e.target.value)}
                  placeholder={t("invoice_export_note_placeholder")}
                />
              </div>
            </div>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel>{t("cancel_button")}</AlertDialogCancel>
              <Button type="submit" disabled={isExporting}>
                {isExporting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("invoice_export_button_text")}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      {invoiceForReceiptUpload && (
        <PaymentReceiptUploadDialog
          isOpen={showReceiptUploadDialog}
          onOpenChange={(open) => {
            if (!open) {
              setShowReceiptUploadDialog(false);
              setInvoiceForReceiptUpload(null);
            }
          }}
          invoiceFileName={
            invoiceForReceiptUpload.generatedFileName ||
            invoiceForReceiptUpload.originalFileName ||
            "Invoice"
          }
          onConfirmUpload={(receiptUri) =>
            handlePaymentReceiptUploaded(invoiceForReceiptUpload.id, receiptUri)
          }
        />
      )}
    </div>
  );
}
