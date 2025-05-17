// src/app/invoices/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardDescription, CardHeader, CardFooter, CardTitle } from '@/components/ui/card';
import {
    Search,
    Filter,
    ChevronDown,
    Loader2,
    XCircle,
    Clock,
    Info,
    Download,
    Trash2,
    Edit,
    Save,
    Eye,
    FileText as FileTextIconLucide,
    ImageIcon as ImageIconLucide,
    CalendarDays,
    ListFilter,
    Columns,
    CreditCard,
    Mail as MailIcon,
    CheckSquare,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Grid,
    ListChecks,
    Briefcase,
    Receipt,
 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Timestamp } from 'firebase/firestore';
import { format, parseISO, subDays, startOfMonth, endOfMonth, isValid, isSameDay, isAfter, isBefore } from 'date-fns';
import { enUS, he } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon } from 'lucide-react';
import {
    InvoiceHistoryItem,
    getInvoicesService,
    deleteInvoiceService,
    updateInvoiceService,
    SupplierSummary,
    getSupplierSummariesService,
    getUserSettingsService,
    updateInvoicePaymentStatusService,
} from '@/services/backend';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
    SheetClose,
} from '@/components/ui/sheet';
import NextImage from 'next/image';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent as AlertDialogContentComponent,
  AlertDialogDescription as AlertDialogDescriptionComponent,
  AlertDialogFooter as AlertDialogFooterComponent,
  AlertDialogHeader as AlertDialogHeaderComponent,
  AlertDialogTitle as AlertDialogTitleComponent,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSmartTouch } from '@/hooks/useSmartTouch';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { Checkbox } from '@/components/ui/checkbox'; // Added Checkbox import
import PaymentReceiptUploadDialog from '@/components/PaymentReceiptUploadDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateAndEmailInvoicesAction } from '@/actions/invoice-export-actions';


const isValidImageSrc = (src: string | undefined | null): src is string => {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://');
};

type ViewMode = 'grid' | 'list';

const ITEMS_PER_PAGE = 8;

type SortKeyDocuments = keyof Pick<InvoiceHistoryItem, 'originalFileName' | 'uploadTime' | 'supplierName' | 'invoiceDate' | 'totalAmount' | 'paymentMethod' | 'paymentStatus' | 'documentType'> | 'paymentReceiptImageUri' | '';


export default function DocumentsPage() {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useTranslation();
  const router = useRouter();
  const searchParamsHook = useSearchParams();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [allUserInvoices, setAllUserInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [filterDocumentType, setFilterDocumentType] = useState<'deliveryNote' | 'invoice' | 'paymentReceipt' | ''>('');
  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<InvoiceHistoryItem['paymentStatus'] | ''>('');


  const [sortKey, setSortKey] = useState<SortKeyDocuments>('uploadTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<InvoiceHistoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedInvoiceData, setEditedInvoiceData] = useState<Partial<InvoiceHistoryItem>>({});
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  const defaultViewMode = isMobile ? 'grid' : 'list';
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [showReceiptUploadDialog, setShowReceiptUploadDialog] = useState(false);
  const [invoiceForReceiptUpload, setInvoiceForReceiptUpload] = useState<InvoiceHistoryItem | null>(null);

  const [currentPage, setCurrentPage] = useState(1);

  const [selectedForBulkAction, setSelectedForBulkAction] = useState<string[]>([]);

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [accountantEmail, setAccountantEmail] = useState('');
  const [emailNote, setEmailNote] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false); 
  const [fetchInvoicesTrigger, setFetchInvoicesTrigger] = useState(0);

  const documentColumnDefinitions: Array<{ key: string; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean, headerClassName?: string }> = useMemo(() => [
    { key: 'selection', labelKey: 'invoice_export_select_column_header', sortable: false, className: 'w-[3%] sm:w-[3%] text-center px-1 sticky left-0 bg-card z-20', headerClassName: 'sticky left-0 bg-card z-20'},
    { key: 'actions', labelKey: 'edit_invoice_th_actions', sortable: false, className: 'w-[10%] sm:w-[10%] text-center px-1 sm:px-2 sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10', headerClassName: 'sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10'},
    { key: 'originalImagePreviewUri', labelKey: 'inventory_col_image', sortable: false, className: 'w-12 text-center px-1 sm:px-2 py-1', headerClassName: 'text-center px-1 sm:px-2 py-1'},
    { key: 'generatedFileName', labelKey: 'upload_history_col_file_name', sortable: true, className: 'w-[20%] sm:w-[25%] min-w-[80px] sm:min-w-[100px] truncate' },
    { key: 'uploadTime', labelKey: 'upload_history_col_upload_time', sortable: true, className: 'min-w-[130px] sm:min-w-[150px]', mobileHidden: true },
    { key: 'paymentStatus', labelKey: 'invoice_payment_status_label', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]' },
    { key: 'paymentDueDate', labelKey: 'payment_due_date_dialog_title', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true},
    { key: 'invoiceNumber', labelKey: 'invoices_col_inv_number', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
    { key: 'supplierName', labelKey: 'invoice_details_supplier_label', sortable: true, className: 'min-w-[120px] sm:min-w-[150px]', mobileHidden: true },
    { key: 'totalAmount', labelKey: 'invoices_col_total_currency', sortable: true, className: 'text-right min-w-[100px] sm:min-w-[120px]' },
    { key: 'paymentMethod', labelKey: 'invoice_details_payment_method_label', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
    { key: 'paymentReceiptImageUri', labelKey: 'paid_invoices_receipt_image_label', sortable: false, className: 'text-center', mobileHidden: true },
  ], [t]);

  const defaultDocumentColumns: Record<string, boolean> = useMemo(() => ({
    selection: true, actions: true, originalImagePreviewUri: true, generatedFileName: true, uploadTime: !isMobile, 
    paymentStatus: true, paymentDueDate: !isMobile, invoiceNumber: !isMobile, supplierName: !isMobile, totalAmount: true,
    paymentMethod: false, paymentReceiptImageUri: false,
  }), [isMobile]);

  const [visibleDocumentColumns, setVisibleDocumentColumns] = useState(defaultDocumentColumns);

  const toggleDocumentColumnVisibility = useCallback((key: string) => {
    setVisibleDocumentColumns(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);


  const formatDateForDisplay = useCallback((dateInput: string | Date | Timestamp | undefined, formatStr: string = 'PPp') => {
    if (!dateInput) return t('invoices_na');
    try {
        let dateObj: Date | null = null;
        if (dateInput instanceof Timestamp) dateObj = dateInput.toDate();
        else if (typeof dateInput === 'string' && isValid(parseISO(dateInput))) dateObj = parseISO(dateInput);
        else if (dateInput instanceof Date && isValid(dateInput)) dateObj = dateInput;

        if (!dateObj || !isValid(dateObj)) {
            console.warn("[DocumentsPage formatDateForDisplay] Invalid date object for input:", dateInput);
            return t('invoices_invalid_date');
        }
        const dateLocale = locale === 'he' ? he : enUS;
        return window.innerWidth < 640 
            ? format(dateObj, 'dd/MM/yy HH:mm', { locale: dateLocale })
            : format(dateObj, formatStr, { locale: dateLocale });
    } catch (e) {
      console.error("[DocumentsPage formatDateForDisplay] Error formatting date:", e);
      return t('invoices_invalid_date');
    }
  }, [locale, t]);

  const formatCurrencyDisplay = useCallback((
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
  ): string => {
      const { decimals = 0, useGrouping = true } = options || {};
      if (value === null || value === undefined || isNaN(value)) {
          const zeroFormatted = (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
              useGrouping: useGrouping,
          });
          return `${t('currency_symbol')}${zeroFormatted}`;
      }
      const formattedValue = value.toLocaleString(t('locale_code_for_number_formatting') || undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: useGrouping,
      });
      return `${t('currency_symbol')}${formattedValue}`;
  }, [t]);

  const renderPaymentStatusBadge = (status: InvoiceHistoryItem['paymentStatus'], dueDate?: string | Timestamp | null | FieldValue ) => {
    let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
    let className = '';
    let icon: React.ReactNode = null;
    let labelKey = '';
    let currentStatus = status;

    if (status === 'pending_payment' && dueDate) {
        let dueDateObj: Date | null = null;
        if (dueDate instanceof Timestamp) dueDateObj = dueDate.toDate();
        else if (typeof dueDate === 'string' && isValid(parseISO(dueDate))) dueDateObj = parseISO(dueDate);
        
        if (dueDateObj && isValid(dueDateObj) && isBefore(dueDateObj, new Date()) && !isSameDay(dueDateObj, new Date())) {
            currentStatus = 'unpaid';
        }
    }

    switch (currentStatus) {
        case 'paid': variant = 'secondary'; className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80'; icon = <CreditCard className="mr-1 h-3 w-3" />; labelKey = 'invoice_payment_status_paid'; break;
        case 'unpaid': variant = 'destructive'; className = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-100/80'; icon = <Clock className="mr-1 h-3 w-3" />; labelKey = 'invoice_payment_status_unpaid'; break;
        case 'pending_payment': variant = 'secondary'; className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80'; icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />; labelKey = 'invoice_payment_status_pending_payment'; break;
        default: variant = 'outline'; icon = null; labelKey = String(status); break;
    }
    return (<Badge variant={variant} className={cn("text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5", className)}>{icon}{t(labelKey as any) || (typeof status === 'string' ? status.charAt(0).toUpperCase() + status.slice(1) : '')}</Badge>);
  };

  const triggerInvoiceFetch = useCallback(() => {
    console.log("[InvoicesPage] Triggering invoice fetch.");
    setFetchInvoicesTrigger(prev => prev + 1);
  }, []);

  const handleViewDetails = useCallback((invoice: InvoiceHistoryItem, context?: 'image_only' | 'full_details') => {
    console.log("[InvoicesPage] handleViewDetails called with context:", context, "for invoice:", invoice?.id);
    if (invoice) {
        const detailsToSet: InvoiceHistoryItem = {...invoice, _displayContext: context || 'full_details'};
        setSelectedInvoiceDetails(detailsToSet);
        setEditedInvoiceData({ ...invoice });
        setIsEditingDetails(false);
        setShowDetailsSheet(true);
        console.log("[InvoicesPage] Details sheet should be open for:", invoice.id, "Context:", context);
    } else {
        setSelectedInvoiceDetails(null);
        setShowDetailsSheet(false);
    }
  }, []);

  const fetchUserData = useCallback(async () => {
    if (!user?.id) {
        setIsLoading(false);
        setAllUserInvoices([]);
        setExistingSuppliers([]);
        return;
    }
    setIsLoading(true);
    try {
      console.log("[InvoicesPage] Fetching data for user:", user.id);
      const [invoicesData, suppliersData, settingsData] = await Promise.all([
        getInvoicesService(user.id),
        getSupplierSummariesService(user.id),
        getUserSettingsService(user.id)
      ]);
      console.log(`[InvoicesPage] Fetched ${invoicesData.length} invoices and ${suppliersData.length} suppliers.`);
      const completedInvoices = invoicesData.filter(inv => inv.status === 'completed');
      setAllUserInvoices(completedInvoices);
      setExistingSuppliers(suppliersData);
      if (settingsData?.accountantSettings?.email) {
        setAccountantEmail(settingsData.accountantSettings.email);
      }
    } catch (error) {
      console.error("[InvoicesPage] Failed to fetch user data for invoices page:", error);
      toast({
        title: t('invoices_toast_error_fetch_invoices_title'),
        description: `${t('invoices_toast_error_fetch_invoices_desc')} (${(error as Error).message})`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      console.log("[InvoicesPage] Fetch user data finished. isLoading set to false.");
    }
  }, [user, toast, t]);

  useEffect(() => {
    if (user?.id) {
      console.log("[InvoicesPage] User identified, calling fetchUserData. Fetch trigger:", fetchInvoicesTrigger);
      fetchUserData();
    } else if (!authLoading && !user) {
      console.log("[InvoicesPage] No user and not auth loading, redirecting to login.");
      router.push('/login');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router, fetchInvoicesTrigger]);


  useEffect(() => {
    const view = searchParamsHook.get('viewMode') as ViewMode | null;
    if (view && ['grid', 'list'].includes(view)) {
        setViewMode(view);
    } else if (isMobile) {
        setViewMode('grid');
    } else {
        setViewMode('list');
    }

    const supplierQuery = searchParamsHook.get('supplier');
    if (supplierQuery) setFilterSupplier(decodeURIComponent(supplierQuery));

    const paymentStatusQuery = searchParamsHook.get('filterPaymentStatus') as InvoiceHistoryItem['paymentStatus'] | null;
    if (paymentStatusQuery) setFilterPaymentStatus(paymentStatusQuery);

     const viewInvoiceId = searchParamsHook.get('viewInvoiceId');
     if (viewInvoiceId && allUserInvoices.length > 0 && !showDetailsSheet) {
        const invoiceToView = allUserInvoices.find(inv => inv.id === viewInvoiceId);
        if (invoiceToView) {
            console.log("[InvoicesPage] Found invoice to view from URL param:", viewInvoiceId);
            handleViewDetails(invoiceToView, 'full_details');
        } else {
            console.warn("[InvoicesPage] Invoice ID from URL param not found in current list:", viewInvoiceId);
        }
     } else if (viewInvoiceId && allUserInvoices.length === 0 && !isLoading) {
         console.warn("[InvoicesPage] viewInvoiceId in URL, but allUserInvoices is empty and not loading. Might be stale data.");
     }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsHook, isMobile, allUserInvoices, showDetailsSheet, isLoading]);

  useEffect(() => {
    const currentRefreshParam = searchParamsHook.get('refresh');
    if (currentRefreshParam === 'true') {
      triggerInvoiceFetch();
      const params = new URLSearchParams(searchParamsHook.toString());
      params.delete('refresh');
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [searchParamsHook, router, triggerInvoiceFetch]);


  const handleSortInternal = useCallback((key: string) => {
    if (!key) return;
    const sortableKey = key as SortKeyDocuments;
    if (sortKey === sortableKey) {
        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
        setSortKey(sortableKey);
        setSortDirection('desc');
    }
    setCurrentPage(1);
  }, [sortKey, sortDirection]);

  const filteredDocuments = useMemo(() => {
    let result = allUserInvoices.filter(inv => inv.status === 'completed');
    
    if (filterDocumentType) result = result.filter(inv => inv.documentType === filterDocumentType);
    if (filterSupplier) result = result.filter(inv => inv.supplierName === filterSupplier);
    if (dateRange?.from) {
        const startDate = new Date(dateRange.from); startDate.setHours(0,0,0,0);
        result = result.filter(inv => {
            if (!inv.uploadTime) return false;
            let invDate: Date | null = null;
            if (inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
            else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
            else if (inv.uploadTime instanceof Date && isValid(inv.uploadTime)) invDate = inv.uploadTime;
            
            if(!invDate || !isValid(invDate)) return false;
            return isAfter(invDate, startDate) || isSameDay(invDate, startDate);
        });
    }
    if (dateRange?.to) {
        const endDate = new Date(dateRange.to); endDate.setHours(23,59,59,999);
        result = result.filter(inv => {
            if (!inv.uploadTime) return false;
            let invDate: Date | null = null;
            if (inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
            else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
            else if (inv.uploadTime instanceof Date && isValid(inv.uploadTime)) invDate = inv.uploadTime;

            if(!invDate || !isValid(invDate)) return false;
            return isBefore(invDate, endDate) || isSameDay(invDate, endDate);
        });
    }
    if (filterPaymentStatus) {
      result = result.filter(inv => {
         let currentStatus = inv.paymentStatus;
         if (inv.paymentStatus === 'pending_payment' && inv.paymentDueDate) {
            let dueDateObj: Date | null = null;
            if (inv.paymentDueDate instanceof Timestamp) dueDateObj = inv.paymentDueDate.toDate();
            else if (typeof inv.paymentDueDate === 'string' && isValid(parseISO(inv.paymentDueDate))) dueDateObj = parseISO(inv.paymentDueDate);
            if (dueDateObj && isValid(dueDateObj) && isBefore(dueDateObj, new Date()) && !isSameDay(dueDateObj, new Date())) {
                currentStatus = 'unpaid';
            }
         }
         return currentStatus === filterPaymentStatus;
      });
    }
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(item =>
        (item.originalFileName || item.generatedFileName || '').toLowerCase().includes(lowerSearchTerm) ||
        (item.invoiceNumber && item.invoiceNumber.toLowerCase().includes(lowerSearchTerm)) ||
        (item.supplierName && item.supplierName.toLowerCase().includes(lowerSearchTerm))
      );
    }
    if (sortKey) {
         result.sort((a, b) => {
             const valA = a[sortKey as keyof InvoiceHistoryItem];
             const valB = b[sortKey as keyof InvoiceHistoryItem];
             let comparison = 0;
             if (sortKey === 'uploadTime' || sortKey === 'paymentDueDate' || sortKey === 'invoiceDate') {
                let dateA = 0; let dateB = 0;
                const aDateVal = valA; const bDateVal = valB;
                if (aDateVal) { if (aDateVal instanceof Timestamp) dateA = aDateVal.toDate().getTime(); else if (typeof aDateVal === 'string' && isValid(parseISO(aDateVal))) dateA = parseISO(aDateVal).getTime(); else if (aDateVal instanceof Date && isValid(aDateVal)) dateA = aDateVal.getTime(); }
                if (bDateVal) { if (bDateVal instanceof Timestamp) dateB = bDateVal.toDate().getTime(); else if (typeof bDateVal === 'string' && isValid(parseISO(bDateVal))) dateB = parseISO(bDateVal).getTime(); else if (bDateVal instanceof Date && isValid(bDateVal)) dateB = bDateVal.getTime(); }
                comparison = dateA - dateB;
             } else if (typeof valA === 'number' && typeof valB === 'number') {
                 comparison = valA - valB;
             } else if (typeof valA === 'string' && typeof valB === 'string') {
                 comparison = (valA || "").localeCompare(valB || "", locale);
             } else {
                if ((valA === undefined || valA === null) && (valB !== undefined && valB !== null)) comparison = 1;
                else if ((valA !== undefined && valA !== null) && (valB === undefined || valB === null)) comparison = -1;
                else comparison = 0;
             }
             return sortDirection === 'asc' ? comparison : comparison * -1;
         });
     }
    return result;
  }, [allUserInvoices, filterDocumentType, filterSupplier, dateRange, searchTerm, filterPaymentStatus, sortKey, sortDirection, locale]);

  const paginatedDocuments = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredDocuments.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredDocuments, currentPage]);

  const totalPages = useMemo(() => {
      return Math.ceil(filteredDocuments.length / ITEMS_PER_PAGE);
  }, [filteredDocuments]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
        setCurrentPage(newPage);
    }
  };

  const handleEditScannedDoc = (invoiceId: string, docType: 'deliveryNote' | 'invoice', fileName: string) => {
    if (!invoiceId) {
        toast({title: t('upload_retry_unavailable_title'), description: t('upload_retry_unavailable_desc'), variant: "destructive"});
        return;
    }
    const queryParams = new URLSearchParams({
        tempInvoiceId: invoiceId,
        docType: docType,
        originalFileName: encodeURIComponent(fileName || 'unknown_doc'),
    });
    router.push(`/edit-invoice?${queryParams.toString()}`);
  };

  const handleDeleteInvoice = async (invoiceIdOrIds: string | string[]) => {
    if (!user?.id) return;
    setIsDeleting(true);
    try {
      const idsToDelete = Array.isArray(invoiceIdOrIds) ? invoiceIdOrIds : [invoiceIdOrIds];
      if (idsToDelete.length === 0) {
        toast({ title: t('invoices_toast_no_selection_delete_title'), variant: 'destructive' });
        setIsDeleting(false);
        return;
      }
      for (const id of idsToDelete) {
        await deleteInvoiceService(id, user.id);
      }
      toast({
          title: idsToDelete.length > 1 ? t('invoices_toast_bulk_deleted_title') : t('invoices_toast_deleted_title'),
          description: idsToDelete.length > 1 ? t('invoices_toast_bulk_deleted_desc', { count: idsToDelete.length }) : t('invoices_toast_deleted_desc'),
      });
      triggerInvoiceFetch();
      setShowDetailsSheet(false);
      setSelectedInvoiceDetails(null);
      setSelectedForBulkAction([]);
    } catch (error) {
      console.error("[InvoicesPage] Failed to delete invoice(s):", error);
      toast({
          title: t('invoices_toast_delete_fail_title'),
          description: t('invoices_toast_delete_fail_desc'),
          variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEditDetailsInputChange = (field: keyof InvoiceHistoryItem, value: string | number | Date | undefined | null | Timestamp ) => {
     if (field === 'uploadTime' || field === 'status') return;
    setEditedInvoiceData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveInvoiceDetails = async () => {
    if (!selectedInvoiceDetails || !selectedInvoiceDetails.id || !user?.id) return;
    setIsSavingDetails(true);
    try {
        const updatedInvoiceData: Partial<InvoiceHistoryItem> = {
            originalFileName: editedInvoiceData.originalFileName || selectedInvoiceDetails.originalFileName,
            generatedFileName: editedInvoiceData.generatedFileName || selectedInvoiceDetails.generatedFileName,
            invoiceNumber: editedInvoiceData.invoiceNumber || null,
            supplierName: editedInvoiceData.supplierName || null,
            totalAmount: typeof editedInvoiceData.totalAmount === 'number' ? editedInvoiceData.totalAmount : null,
            paymentStatus: editedInvoiceData.paymentStatus || selectedInvoiceDetails.paymentStatus,
            paymentDueDate: editedInvoiceData.paymentDueDate,
            documentType: editedInvoiceData.documentType || selectedInvoiceDetails.documentType,
            invoiceDate: editedInvoiceData.invoiceDate,
            paymentMethod: editedInvoiceData.paymentMethod || null,
        };

        await updateInvoiceService(selectedInvoiceDetails.id, updatedInvoiceData, user.id);
        toast({
            title: t('invoices_toast_updated_title'),
            description: t('invoices_toast_updated_desc'),
        });
        setIsEditingDetails(false);
        triggerInvoiceFetch();
        const refreshedInvoice = allUserInvoices.find(inv => inv.id === selectedInvoiceDetails!.id);
        if (refreshedInvoice) {
            setSelectedInvoiceDetails({
                ...refreshedInvoice,
                uploadTime: refreshedInvoice.uploadTime,
                invoiceDate: refreshedInvoice.invoiceDate,
                paymentDueDate: refreshedInvoice.paymentDueDate,
            });
        } else {
           setShowDetailsSheet(false);
        }

    } catch (error) {
        console.error("[InvoicesPage] Failed to save invoice details:", error);
        toast({
            title: t('invoices_toast_save_fail_title'),
            description: t('invoices_toast_save_fail_desc'),
            variant: "destructive",
            duration: 6000,
        });
    } finally {
        setIsSavingDetails(false);
    }
  };

 const handlePaymentStatusUpdate = async (invoiceId: string, newStatus: InvoiceHistoryItem['paymentStatus'], receiptImageUri?: string | null) => {
    if (!user?.id || !selectedInvoiceDetails) return;

    if (newStatus === 'paid' && receiptImageUri === undefined && selectedInvoiceDetails.documentType !== 'paymentReceipt') {
        setInvoiceForReceiptUpload(selectedInvoiceDetails);
        setShowReceiptUploadDialog(true);
        return;
    }
    
    const originalInvoice = allUserInvoices.find(inv => inv.id === invoiceId);
    if (!originalInvoice) return;

    setSelectedInvoiceDetails(prev => prev ? {...prev, paymentStatus: newStatus, paymentReceiptImageUri: receiptImageUri === undefined ? prev.paymentReceiptImageUri : receiptImageUri } : null);
    setEditedInvoiceData(prev => ({...prev, paymentStatus: newStatus, paymentReceiptImageUri: receiptImageUri === undefined ? prev.paymentReceiptImageUri : receiptImageUri }));
        
    try {
        await updateInvoicePaymentStatusService(invoiceId, newStatus, user.id, receiptImageUri);
        toast({
            title: t('toast_invoice_payment_status_updated_title'),
            description: t('toast_invoice_payment_status_updated_desc', { fileName: originalInvoice.originalFileName || originalInvoice.generatedFileName || '', status: t(`invoice_payment_status_${newStatus}` as any) || newStatus }),
        });
        triggerInvoiceFetch();
    } catch (error) {
        console.error("[InvoicesPage] Failed to update payment status:", error);
        setSelectedInvoiceDetails(prev => prev ? {...prev, paymentStatus: originalInvoice.paymentStatus, paymentReceiptImageUri: originalInvoice.paymentReceiptImageUri } : null);
        setEditedInvoiceData(prev => ({...prev, paymentStatus: originalInvoice.paymentStatus, paymentReceiptImageUri: originalInvoice.paymentReceiptImageUri }));
        toast({
            title: t('toast_invoice_payment_status_update_fail_title'),
            description: t('toast_invoice_payment_status_update_fail_desc'),
            variant: "destructive",
        });
    }
};

const handlePaymentReceiptUploaded = async (invoiceId: string, receiptUri: string) => {
    if (!invoiceForReceiptUpload || !user?.id || invoiceForReceiptUpload.id !== invoiceId) return;
    setShowReceiptUploadDialog(false);
    setInvoiceForReceiptUpload(null);
    await handlePaymentStatusUpdate(invoiceId, 'paid', receiptUri);
};

  const handleSelectInvoiceForBulkAction = (invoiceId: string, checked: boolean) => {
     if (invoiceId === 'all-current-view') {
        setSelectedForBulkAction(checked ? paginatedDocuments.map(inv => inv.id) : []);
     } else {
        setSelectedForBulkAction(prev =>
            checked ? [...prev, invoiceId] : prev.filter(id => id !== invoiceId)
        );
     }
  };

  const handleOpenExportDialog = async () => {
    if (selectedForBulkAction.length === 0) {
      toast({
        title: t('invoice_export_error_no_selection_title'),
        description: t('invoice_export_error_no_selection_desc'),
        variant: "destructive",
      });
      return;
    }
    if (user?.id) {
        const settings = await getUserSettingsService(user.id);
        if (settings && settings.accountantSettings?.email) {
            setAccountantEmail(settings.accountantSettings.email);
        } else {
            setAccountantEmail('');
            toast({
                title: t('settings_accountant_toast_email_required_title'),
                description: t('settings_accountant_toast_email_required_desc_export'),
                variant: "destructive"
            })
        }
    }
    setShowExportDialog(true);
  };

 const handleExportSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id) {
        toast({ title: t("settings_login_required"), variant: "destructive" });
        return;
    }
    if (!accountantEmail.trim()) {
        toast({ title: t('invoice_export_error_invalid_email_title'), description: t('invoice_export_error_invalid_email_desc'), variant: "destructive" });
        return;
    }
     if (accountantEmail.trim() && !/\S+@\S+\.\S+/.test(accountantEmail)) {
        toast({
            title: t('error_title'),
            description: t('settings_accountant_toast_invalid_email_desc'),
            variant: "destructive",
        });
        return;
    }

    if (selectedForBulkAction.length === 0) {
      toast({ title: t('invoice_export_error_no_selection_title'), variant: 'destructive' });
      return;
    }

    setIsExporting(true);
    try {
        const result = await generateAndEmailInvoicesAction(selectedForBulkAction, accountantEmail, emailNote, user.id);
        if (result.success) {
            toast({ title: t('invoice_export_success_title'), description: result.message });
            setShowExportDialog(false);
            setSelectedForBulkAction([]);
            setEmailNote('');
        } else {
            toast({ title: t('invoice_export_error_title'), description: result.message, variant: "destructive" });
        }
    } catch (error: any) {
        toast({ title: t('invoice_export_error_unexpected_title'), description: t('invoice_export_error_unexpected_desc', { message: error.message }), variant: "destructive"});
    } finally {
        setIsExporting(false);
    }
 };

   const visibleColumnHeaders = useMemo(() => {
     return documentColumnDefinitions.filter(h => visibleDocumentColumns[h.key as keyof typeof visibleDocumentColumns]);
   }, [visibleDocumentColumns, documentColumnDefinitions]);

   const dropdownTriggerRef = useRef<HTMLButtonElement>(null);

   const { onClick: smartFilterBtnClick } = useSmartTouch({
        onTap: (e) => {
          if (dropdownTriggerRef.current && dropdownTriggerRef.current.contains(e.target as Node)) {
            console.log("Smart tap on filter trigger, Radix might handle.");
          } else {
             setShowAdvancedFilters(prev => !prev);
          }
        },
        moveThreshold: 15,
        timeThreshold: 300
    });


   if (authLoading || (!user && !isLoading)) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="ml-2 text-muted-foreground">{t('invoices_loading')}</p>
       </div>
     );
   }
   if (!user && !authLoading) return null;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <div className="flex justify-between items-center">
             <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <FileTextIconLucide className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('documents_page_title')}
            </CardTitle>
            <div className="flex items-center gap-2">
                 <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => setShowAdvancedFilters(prev => !prev)}
                    className={cn("h-9 w-9 sm:h-10 sm:w-10", showAdvancedFilters && "bg-accent text-accent-foreground")}
                    aria-label={t('filter_options_button_aria')}
                  >
                    <Filter className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                 <Button
                    variant="outline"
                    onClick={() => {
                        const newMode = viewMode === 'list' ? 'grid' : 'list';
                        setViewMode(newMode);
                    }}
                    className="h-9 sm:h-10 px-3"
                    aria-label={t('invoices_toggle_view_mode_aria')}
                    >
                    {viewMode === 'list' ? <Grid className="h-4 w-4 sm:h-5 sm:w-5" /> : <ListChecks className="h-4 w-4 sm:h-5 sm:w-5" />}
                </Button>
            </div>
          </div>
          <CardDescription>{t('documents_page_description')}</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
                <Button size="sm" variant={filterDocumentType === '' ? 'default' : 'outline'} onClick={() => setFilterDocumentType('')} className="text-xs h-8 px-3">{t('invoices_filter_doc_type_all_button')}</Button>
                <Button size="sm" variant={filterDocumentType === 'deliveryNote' ? 'default' : 'outline'} onClick={() => setFilterDocumentType('deliveryNote')} className="text-xs h-8 px-3">{t('upload_doc_type_delivery_note')}</Button>
                <Button size="sm" variant={filterDocumentType === 'invoice' ? 'default' : 'outline'} onClick={() => setFilterDocumentType('invoice')} className="text-xs h-8 px-3">{t('upload_doc_type_invoice')}</Button>
                <Button size="sm" variant={filterDocumentType === 'paymentReceipt' ? 'default' : 'outline'} onClick={() => setFilterDocumentType('paymentReceipt')} className="text-xs h-8 px-3">{t('invoices_filter_doc_type_receipt_button')}</Button>
            </div>
             <div className="relative w-full md:max-w-xs lg:max-w-sm mb-4">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                 <Input
                     placeholder={t('inventory_search_placeholder')}
                     value={searchTerm}
                     onChange={(e) => {setSearchTerm(e.target.value); setCurrentPage(1);}}
                     className="pl-10 h-10 w-full"
                     aria-label={t('invoices_search_aria')}
                 />
             </div>

            {showAdvancedFilters && (
                 <div className="mb-4 flex flex-wrap items-stretch justify-center sm:justify-start gap-2 sm:gap-3 p-3 border rounded-md bg-muted/50 animate-in fade-in-0 duration-300">
                     <Popover>
                         <PopoverTrigger asChild>
                             <Button variant="outline" className="rounded-full flex flex-col items-center justify-center h-16 w-16 sm:h-20 sm:w-20 p-1 text-center hover:bg-accent/10 relative" aria-label={t('filter_label_dates')}>
                                 <CalendarDays className="h-5 w-5 sm:h-6 sm:w-6 mb-1" />
                                 <span className="text-[10px] sm:text-xs">{t('filter_label_dates')}</span>
                                 {dateRange && <Button variant="ghost" size="icon" className="absolute -top-1 -right-1 h-5 w-5 text-muted-foreground hover:text-destructive p-0.5 bg-background rounded-full shadow" onClick={(e)=>{e.stopPropagation();setDateRange(undefined)}}><XCircle className="h-3.5 w-3.5"/></Button>}
                             </Button>
                         </PopoverTrigger>
                         <PopoverContent className="w-auto p-0" align="start">
                             <Calendar initialFocus mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={isMobile ? 1 : 2} />
                              {dateRange && (<div className="p-2 border-t flex justify-end"><Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>{t('reports_date_range_clear')}</Button></div>)}
                         </PopoverContent>
                     </Popover>
                     <DropdownMenu>
                         <DropdownMenuTrigger asChild>
                             <Button variant="outline" className="rounded-full flex flex-col items-center justify-center h-16 w-16 sm:h-20 sm:w-20 p-1 text-center hover:bg-accent/10 relative" aria-label={t('invoices_filter_supplier_aria', { filterSupplier: filterSupplier || t('invoices_filter_supplier_all')})} >
                                 <Briefcase className="h-5 w-5 sm:h-6 sm:w-6 mb-1" />
                                 <span className="text-[10px] sm:text-xs">{t('filter_label_supplier')}</span>
                                 {filterSupplier && <Button variant="ghost" size="icon" className="absolute -top-1 -right-1 h-5 w-5 text-muted-foreground hover:text-destructive p-0.5 bg-background rounded-full shadow" onClick={(e)=>{e.stopPropagation();setFilterSupplier('')}}><XCircle className="h-3.5 w-3.5"/></Button>}
                             </Button>
                         </DropdownMenuTrigger>
                         <DropdownMenuContent align="start"><DropdownMenuLabel>{t('invoices_filter_supplier_label')}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuCheckboxItem checked={!filterSupplier} onCheckedChange={() => setFilterSupplier('')}>{t('invoices_filter_supplier_all')}</DropdownMenuCheckboxItem>{existingSuppliers.map((supplier) => (<DropdownMenuCheckboxItem key={supplier.id} checked={filterSupplier === supplier.name} onCheckedChange={() => setFilterSupplier(supplier.name)}>{supplier.name}</DropdownMenuCheckboxItem>))}</DropdownMenuContent>
                     </DropdownMenu>
                      <>
                         <DropdownMenu>
                             <DropdownMenuTrigger asChild>
                                 <Button variant="outline" className="rounded-full flex flex-col items-center justify-center h-16 w-16 sm:h-20 sm:w-20 p-1 text-center hover:bg-accent/10 relative" aria-label={t('filter_label_payment_status')}>
                                     <CreditCard className="h-5 w-5 sm:h-6 sm:w-6 mb-1" />
                                     <span className="text-[10px] sm:text-xs">{t('filter_label_payment_status')}</span>
                                      {filterPaymentStatus && <Button variant="ghost" size="icon" className="absolute -top-1 -right-1 h-5 w-5 text-muted-foreground hover:text-destructive p-0.5 bg-background rounded-full shadow" onClick={(e)=>{e.stopPropagation();setFilterPaymentStatus('')}}><XCircle className="h-3.5 w-3.5"/></Button>}
                                 </Button>
                             </DropdownMenuTrigger>
                             <DropdownMenuContent align="start"><DropdownMenuLabel>{t('invoices_filter_payment_status_label')}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuCheckboxItem checked={!filterPaymentStatus} onCheckedChange={() => setFilterPaymentStatus('')}>{t('invoices_filter_payment_status_all')}</DropdownMenuCheckboxItem>{(['unpaid', 'pending_payment', 'paid'] as InvoiceHistoryItem['paymentStatus'][]).map((pStatus) => (<DropdownMenuCheckboxItem key={pStatus} checked={filterPaymentStatus === pStatus} onCheckedChange={() => setFilterPaymentStatus(pStatus)}>{t(`invoice_payment_status_${pStatus}` as any)}</DropdownMenuCheckboxItem>))}</DropdownMenuContent>
                         </DropdownMenu>
                      </>
                     <DropdownMenu>
                         <DropdownMenuTrigger asChild>
                             <Button variant="outline" className="rounded-full flex flex-col items-center justify-center h-16 w-16 sm:h-20 sm:w-20 p-1 text-center hover:bg-accent/10" aria-label={t('filter_label_columns')}>
                                 <Columns className="h-5 w-5 sm:h-6 sm:w-6 mb-1" />
                                 <span className="text-[10px] sm:text-xs">{t('filter_label_columns')}</span>
                             </Button>
                         </DropdownMenuTrigger>
                         <DropdownMenuContent align="end" className="w-56">
                             <DropdownMenuLabel>{t('inventory_toggle_columns_label')}</DropdownMenuLabel>
                             <DropdownMenuSeparator />
                             {documentColumnDefinitions
                                .filter(h => h.key !== 'id' && h.key !== 'actions' && h.key !== 'selection' && h.key !== 'errorMessage' && h.key !== 'originalImagePreviewUri' && h.key !== 'compressedImageForFinalRecordUri')
                                .map((header) => (
                                 <DropdownMenuCheckboxItem
                                     key={header.key}
                                     className="capitalize"
                                     checked={!!visibleDocumentColumns[header.key as keyof typeof visibleDocumentColumns]}
                                     onCheckedChange={() => toggleDocumentColumnVisibility(header.key)}
                                 >
                                     {t(header.labelKey as any, { currency_symbol: t('currency_symbol') })}
                                 </DropdownMenuCheckboxItem>
                             ))}
                         </DropdownMenuContent>
                     </DropdownMenu>
                 </div>
            )}
            <>
            {viewMode === 'list' ? (
                <div className="overflow-x-auto relative">
                    <Table className="min-w-[600px]">
                        <TableHeader>
                            <TableRow>
                                {visibleColumnHeaders.map((header) => (
                                    <TableHead
                                        key={header.key}
                                        className={cn(
                                            "text-center", 
                                            header.className,
                                            header.sortable && "cursor-pointer hover:bg-muted/50",
                                            header.mobileHidden && "hidden sm:table-cell", 
                                            'px-2 sm:px-4 py-2',
                                            header.key === 'actions' ? 'sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10' : (header.key === 'selection' ? 'sticky left-0 bg-card z-20' : '')
                                        )}
                                        onClick={() => header.sortable && handleSortInternal(header.key)}
                                        aria-sort={header.sortable ? (sortKey === header.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                                    >
                                        <div className="flex items-center gap-1 whitespace-nowrap justify-center">
                                            {header.key === 'selection' ? (
                                                <Checkbox
                                                    checked={selectedForBulkAction.length > 0 && selectedForBulkAction.length === paginatedDocuments.length && paginatedDocuments.length > 0}
                                                    onCheckedChange={(checked) => handleSelectInvoiceForBulkAction('all-current-view', !!checked)}
                                                    aria-label={t('invoice_export_select_all_aria')}
                                                    className="mx-auto"
                                                />
                                            ) : (
                                                t(header.labelKey as any, { currency_symbol: t('currency_symbol') })
                                            )}
                                            {header.sortable && sortKey === header.key && (
                                                <span className="text-xs" aria-hidden="true">
                                                    {sortDirection === 'asc' ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />}
                                                </span>
                                            )}
                                        </div>
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center"><div className="flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /><span className="ml-2">{t('invoices_loading')}</span></div></TableCell></TableRow>
                            ) : paginatedDocuments.length === 0 ? (
                                <TableRow><TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center">{t('invoices_no_invoices_found')}</TableCell></TableRow>
                            ) : (
                                paginatedDocuments.map((item) => (
                                    <TableRow key={item.id} className="hover:bg-muted/50" data-testid={`invoice-item-${item.id}`}>
                                        {visibleDocumentColumns.selection && (
                                            <TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-0 bg-card z-20", documentColumnDefinitions.find(h => h.key === 'selection')?.className)}>
                                                <Checkbox checked={selectedForBulkAction.includes(item.id)} onCheckedChange={(checked) => handleSelectInvoiceForBulkAction(item.id, !!checked)} aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || item.generatedFileName || '' })} />
                                            </TableCell>
                                        )}
                                        {visibleDocumentColumns.actions && (
                                            <TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10", documentColumnDefinitions.find(h => h.key === 'actions')?.className)}>
                                                <Button variant="ghost" size="icon" className="text-primary hover:text-primary/80 h-7 w-7" onClick={() => handleViewDetails(item)} title={t('invoices_view_details_title', { fileName: item.originalFileName || item.generatedFileName || '' })} aria-label={t('invoices_view_details_aria', { fileName: item.originalFileName || item.generatedFileName || '' })}><Info className="h-4 w-4" /></Button>
                                                {(item.status === 'pending' || item.status === 'error') && item.id && (<Button variant="ghost" size="icon" className="text-amber-600 hover:text-amber-500 h-7 w-7" onClick={() => handleEditScannedDoc(item.id!, item.documentType, item.originalFileName || item.generatedFileName || '')} title={t('upload_history_retry_upload_title')} aria-label={t('upload_history_retry_upload_aria', { fileName: item.originalFileName || item.generatedFileName || '' })}><Edit className="h-4 w-4" /></Button>)}
                                                {(item.paymentStatus === 'unpaid' || item.paymentStatus === 'pending_payment') && item.status === 'completed' && item.documentType !== 'paymentReceipt' && (
                                                    <Button variant="ghost" size="icon" className="text-green-600 hover:text-green-500 h-7 w-7" onClick={() => { setInvoiceForReceiptUpload(item); setShowReceiptUploadDialog(true); }} title={t('paid_invoices_mark_as_paid_button')} aria-label={t('paid_invoices_mark_as_paid_button')}>
                                                        <CheckSquare className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                 {item.paymentStatus === 'paid' && item.documentType !== 'paymentReceipt' && (
                                                    <Button variant="ghost" size="icon" className="text-blue-600 hover:text-blue-500 h-7 w-7" onClick={() => { setInvoiceForReceiptUpload(item); setShowReceiptUploadDialog(true); }} title={t('paid_invoices_update_receipt_button')} aria-label={t('paid_invoices_update_receipt_button')}>
                                                         <Receipt className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive/80 h-7 w-7" title={t('invoices_delete_button')} aria-label={t('invoices_delete_button')} disabled={isDeleting}><Trash2 className="h-4 w-4"/></Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContentComponent>
                                                        <AlertDialogHeaderComponent><AlertDialogTitleComponent>{t('invoices_delete_confirm_title')}</AlertDialogTitleComponent><AlertDialogDescriptionComponent>{t('invoices_delete_confirm_desc', {fileName: item.originalFileName || item.generatedFileName || '' })}</AlertDialogDescriptionComponent></AlertDialogHeaderComponent>
                                                        <AlertDialogFooterComponent><AlertDialogCancel disabled={isDeleting}>{t('cancel_button')}</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteInvoice(item.id)} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>{isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('invoices_delete_confirm_action')}</AlertDialogAction></AlertDialogFooterComponent>
                                                    </AlertDialogContentComponent>
                                                </AlertDialog>
                                            </TableCell>
                                        )}
                                        {visibleDocumentColumns.originalImagePreviewUri && (
                                            <TableCell className={cn('text-center px-1 sm:px-2 py-1', documentColumnDefinitions.find(h => h.key === 'originalImagePreviewUri')?.className)}>
                                                {isValidImageSrc(item.paymentStatus === 'paid' && item.paymentReceiptImageUri ? item.paymentReceiptImageUri : (item.originalImagePreviewUri || item.compressedImageForFinalRecordUri)) ? (
                                                    <button onClick={() => handleViewDetails(item, 'image_only')} className="w-10 h-10 mx-auto rounded overflow-hidden border hover:opacity-80 transition-opacity" title={t('invoices_view_details_title', { fileName: item.originalFileName || item.generatedFileName || '' })}>
                                                        <NextImage src={(item.paymentStatus === 'paid' && item.paymentReceiptImageUri) ? item.paymentReceiptImageUri : (item.originalImagePreviewUri || item.compressedImageForFinalRecordUri)!} alt={t('invoices_preview_alt', { fileName: item.originalFileName || item.generatedFileName || ''})} width={40} height={40} className="object-cover" data-ai-hint="invoice document" />
                                                    </button>
                                                ) : (
                                                     <div className="h-10 w-10 mx-auto rounded bg-muted flex items-center justify-center border">
                                                        {item.documentType === 'invoice' ? <FileTextIconLucide className="h-5 w-5 text-blue-500/70" /> : item.documentType === 'paymentReceipt' ? <Receipt className="h-5 w-5 text-purple-500/70" /> : <FileTextIconLucide className="h-5 w-5 text-green-500/70" />}
                                                    </div>
                                                )}
                                            </TableCell>
                                        )}
                                        {visibleDocumentColumns.generatedFileName && (<TableCell className={cn("font-medium px-2 sm:px-4 py-2", documentColumnDefinitions.find(h => h.key === 'generatedFileName')?.className)}><Button variant="link" className="p-0 h-auto text-left font-medium cursor-pointer hover:underline truncate" onClick={() => handleViewDetails(item, 'full_details')} title={t('invoices_view_details_title', { fileName: item.generatedFileName || item.originalFileName || '' })}>{item.generatedFileName || item.originalFileName}</Button></TableCell>)}
                                        {visibleDocumentColumns.uploadTime && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', documentColumnDefinitions.find(h => h.key === 'uploadTime')?.mobileHidden && 'hidden sm:table-cell')}>{formatDateForDisplay(item.uploadTime)}</TableCell>}
                                        {visibleDocumentColumns.paymentStatus && (<TableCell className="px-2 sm:px-4 py-2 text-center">{renderPaymentStatusBadge(item.paymentStatus, item.paymentDueDate)}</TableCell>)}
                                        {visibleDocumentColumns.paymentDueDate && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', documentColumnDefinitions.find(h => h.key === 'paymentDueDate')?.mobileHidden && 'hidden sm:table-cell')}>{item.paymentDueDate ? formatDateForDisplay(item.paymentDueDate, 'PP') : t('invoices_na')}</TableCell>}
                                        {visibleDocumentColumns.invoiceNumber && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', documentColumnDefinitions.find(h => h.key === 'invoiceNumber')?.mobileHidden && 'hidden sm:table-cell')}>{item.invoiceNumber || t('invoices_na')}</TableCell>}
                                        {visibleDocumentColumns.supplierName && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', documentColumnDefinitions.find(h => h.key === 'supplierName')?.mobileHidden && 'hidden sm:table-cell')}>{item.supplierName || t('invoices_na')}</TableCell>}
                                        {visibleDocumentColumns.totalAmount && (<TableCell className="text-right px-2 sm:px-4 py-2 whitespace-nowrap">{item.totalAmount !== undefined && item.totalAmount !== null ? formatCurrencyDisplay(item.totalAmount, {decimals:0}) : t('invoices_na')}</TableCell>)}
                                        {visibleDocumentColumns.paymentMethod && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', documentColumnDefinitions.find(h => h.key === 'paymentMethod')?.mobileHidden && 'hidden sm:table-cell')}>{item.paymentMethod ? t(`payment_method_${item.paymentMethod.toLowerCase().replace(/\s+/g, '_')}` as any, {defaultValue: item.paymentMethod}) : t('invoices_na')}</TableCell>}
                                        {visibleDocumentColumns.paymentReceiptImageUri && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', documentColumnDefinitions.find(h => h.key === 'paymentReceiptImageUri')?.mobileHidden && 'hidden sm:table-cell')}>{ item.paymentReceiptImageUri ? <Button variant="link" size="sm" onClick={() => handleViewDetails(item, 'image_only')} className="p-0 h-auto text-xs">{t('paid_invoices_view_receipt_link')}</Button> : t('invoices_na')}</TableCell>}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            ) : (
                 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4" style={{ gridAutoRows: 'minmax(150px, auto)' }}>
                    {isLoading ? (Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (<Card key={index} className="animate-pulse"><CardHeader className="p-0 relative aspect-[4/3] bg-muted rounded-t-lg" /><CardContent className="p-3 space-y-1"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-1/4" /></CardContent><CardFooter className="p-3 border-t"><Skeleton className="h-7 w-full" /></CardFooter></Card>)))
                        : paginatedDocuments.length === 0 ? (<p className="col-span-full text-center text-muted-foreground py-10">{t('invoices_no_invoices_found')}</p>)
                            : (paginatedDocuments.map((item: InvoiceHistoryItem) => (
                                <Card key={item.id} className="flex flex-col overflow-hidden cursor-pointer hover:shadow-lg transition-shadow scale-fade-in">
                                     <div className="p-2 absolute top-0 left-0 z-10">
                                         <Checkbox checked={selectedForBulkAction.includes(item.id)} onCheckedChange={(checked) => handleSelectInvoiceForBulkAction(item.id, !!checked)} aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || item.generatedFileName || '' })} className="bg-background/70 hover:bg-background border-primary" />
                                     </div>
                                    <CardHeader className="p-0 relative aspect-[4/3]" onClick={() => handleViewDetails(item, 'image_only')}>
                                        {isValidImageSrc(item.paymentStatus === 'paid' && item.paymentReceiptImageUri ? item.paymentReceiptImageUri : (item.originalImagePreviewUri || item.compressedImageForFinalRecordUri)) ? (
                                            <NextImage src={ (item.paymentStatus === 'paid' && item.paymentReceiptImageUri) ? item.paymentReceiptImageUri : (item.originalImagePreviewUri || item.compressedImageForFinalRecordUri)!} alt={t('invoices_preview_alt', { fileName: item.originalFileName || item.generatedFileName || '' })} layout="fill" objectFit="cover" className="rounded-t-lg" data-ai-hint="invoice document" />
                                        ) : (
                                            <div className="w-full h-full bg-muted rounded-t-lg flex items-center justify-center">
                                                {item.documentType === 'invoice' ? <FileTextIconLucide className="h-12 w-12 text-blue-500/50" /> : item.documentType === 'paymentReceipt' ? <Receipt className="h-12 w-12 text-purple-500/50" /> : <FileTextIconLucide className="h-12 w-12 text-green-500/50" />}
                                            </div>
                                        )}
                                         <div className="absolute top-2 right-2 flex flex-col gap-1">
                                            {renderPaymentStatusBadge(item.paymentStatus, item.paymentDueDate)}
                                         </div>
                                    </CardHeader>
                                    <CardContent className="p-3 flex-grow" onClick={() => handleViewDetails(item, 'full_details')}>
                                        <CardTitle className="text-sm font-semibold truncate" title={item.generatedFileName || item.originalFileName}>{item.generatedFileName || item.originalFileName}</CardTitle>
                                        <p className="text-xs text-muted-foreground">{formatDateForDisplay(item.uploadTime)}</p>
                                         {item.supplierName && <p className="text-xs text-muted-foreground">{t('invoice_details_supplier_label')}: {item.supplierName}</p>}
                                         {item.invoiceNumber && <p className="text-xs text-muted-foreground">{t('invoice_details_invoice_number_label')}: {item.invoiceNumber}</p>}
                                         {item.totalAmount !== undefined && <p className="text-xs font-medium">{t('invoices_col_total')}: {formatCurrencyDisplay(item.totalAmount, {decimals:0})}</p>}
                                         {item.errorMessage && item.status === 'error' && <p className="text-xs text-destructive truncate" title={item.errorMessage}>{t('invoice_details_error_message_label')}: {item.errorMessage}</p>}
                                    </CardContent>
                                     <CardFooter className="p-3 border-t flex gap-1">
                                        <Button variant="ghost" size="sm" className="flex-1 justify-start text-xs" onClick={(e) => { e.stopPropagation(); handleViewDetails(item, 'full_details'); }}><Info className="mr-1.5 h-3.5 w-3.5"/> {t('invoices_view_details_button')}</Button>
                                        {(item.status === 'pending' || item.status === 'error') && item.id && (<Button variant="ghost" size="sm" className="flex-1 justify-start text-xs text-amber-600 hover:text-amber-500" onClick={(e) => { e.stopPropagation(); handleEditScannedDoc(item.id!, item.documentType, item.originalFileName || item.generatedFileName || '');}}><Edit className="mr-1.5 h-3.5 w-3.5"/> {t('upload_history_retry_upload_title')}</Button>)}
                                         {(item.paymentStatus === 'unpaid' || item.paymentStatus === 'pending_payment') && item.status === 'completed' && item.documentType !== 'paymentReceipt' && (
                                            <Button variant="ghost" size="sm" className="flex-1 justify-start text-xs text-green-600 hover:text-green-500" onClick={(e) => { e.stopPropagation(); setInvoiceForReceiptUpload(item); setShowReceiptUploadDialog(true);}}><CheckSquare className="mr-1.5 h-3.5 w-3.5"/> {t('paid_invoices_mark_as_paid_button')}</Button>
                                         )}
                                          {item.paymentStatus === 'paid' && item.documentType !== 'paymentReceipt' && (
                                            <Button variant="ghost" size="sm" className="flex-1 justify-start text-xs text-blue-600 hover:text-blue-500" onClick={(e) => { e.stopPropagation(); setInvoiceForReceiptUpload(item); setShowReceiptUploadDialog(true);}}><Receipt className="mr-1.5 h-3.5 w-3.5"/> {t('paid_invoices_update_receipt_button')}</Button>
                                         )}
                                    </CardFooter>
                                </Card>
                            ))
                        )}
                </div>
            )}
            {totalPages > 1 && (
                <div className="flex items-center justify-end space-x-2 py-4 mt-4">
                    <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4" /><span className="sr-only">{t('inventory_pagination_previous')}</span></Button>
                    <span className="text-sm text-muted-foreground">{t('inventory_pagination_page_info_simple', { currentPage: currentPage, totalPages: totalPages })}</span>
                    <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}><span className="sr-only">{t('inventory_pagination_next')}</span><ChevronRight className="h-4 w-4" /></Button>
                </div>
            )}
             {selectedForBulkAction.length > 0 && (
                <div className="mt-4 flex flex-col sm:flex-row justify-end gap-2">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" className="w-full sm:w-auto">
                                <Trash2 className="mr-2 h-4 w-4"/>
                                {t('invoices_bulk_delete_button', {count: selectedForBulkAction.length})}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContentComponent>
                            <AlertDialogHeaderComponent>
                                <AlertDialogTitleComponent>{t('invoices_delete_confirm_title')}</AlertDialogTitleComponent>
                                <AlertDialogDescriptionComponent>{t('invoices_delete_confirm_desc', {fileName: `${selectedForBulkAction.length} ${t('documents_plural_for_delete_message')}`})}</AlertDialogDescriptionComponent>
                            </AlertDialogHeaderComponent>
                            <AlertDialogFooterComponent><AlertDialogCancel>{t('cancel_button')}</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteInvoice(selectedForBulkAction)} className={cn(buttonVariants({variant: "destructive"}))} disabled={isDeleting}>{isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('invoices_delete_confirm_action')}</AlertDialogAction></AlertDialogFooterComponent>
                        </AlertDialogContentComponent>
                    </AlertDialog>
                     <Button
                          onClick={handleOpenExportDialog}
                          disabled={isExporting}
                          className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                      >
                          {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailIcon className="mr-2 h-4 w-4" />}
                          {t('invoice_export_selected_button')}
                      </Button>
                </div>
            )}
        </>
        </CardContent>
      </Card>

      <Sheet open={showDetailsSheet} onOpenChange={(open) => {
          setShowDetailsSheet(open);
          if (!open) {
            setIsEditingDetails(false);
            setSelectedInvoiceDetails(null);
            const params = new URLSearchParams(searchParamsHook.toString());
            params.delete('viewInvoiceId');
            router.replace(`?${params.toString()}`, { scroll: false });
          }
      }}>
        <SheetContent side="bottom" className="h-auto max-h-[85vh] sm:h-[90vh] flex flex-col p-0 rounded-t-lg">
          <SheetHeader className="p-4 sm:p-6 border-b shrink-0 sticky top-0 bg-background z-10">
             <SheetTitle className="flex items-center text-lg sm:text-xl">{isEditingDetails ? <Edit className="mr-2 h-5 w-5"/> : <Info className="mr-2 h-5 w-5"/>}{isEditingDetails ? t('invoices_edit_details_title') : (selectedInvoiceDetails?._displayContext === 'image_only' ? t('upload_history_image_preview_title') : t('invoice_details_title'))}</SheetTitle>
             {selectedInvoiceDetails?._displayContext !== 'image_only' && (
                <SheetDescription className="text-xs sm:text-sm">
                    {isEditingDetails ? t('invoices_edit_details_desc', { fileName: selectedInvoiceDetails?.originalFileName || selectedInvoiceDetails?.generatedFileName || '' }) : t('invoice_details_description', { fileName: selectedInvoiceDetails?.originalFileName || selectedInvoiceDetails?.generatedFileName || '' })}
                </SheetDescription>
             )}
          </SheetHeader>
          {selectedInvoiceDetails && (
            <ScrollArea className="flex-grow">
              <div className="p-4 sm:p-6 space-y-4">
              {isEditingDetails && selectedInvoiceDetails._displayContext !== 'image_only' ? (
                <div className="space-y-3">
                    <div><Label htmlFor="editOriginalFileName">{t('invoice_details_file_name_label')}</Label><Input id="editOriginalFileName" value={editedInvoiceData.originalFileName || ''} onChange={(e) => handleEditDetailsInputChange('originalFileName', e.target.value)} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editDocumentType">{t('invoices_document_type_label')}</Label>
                        <Select value={editedInvoiceData.documentType || selectedInvoiceDetails.documentType} onValueChange={(value) => handleEditDetailsInputChange('documentType', value as 'deliveryNote' | 'invoice' | 'paymentReceipt')} disabled={isSavingDetails}>
                            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="deliveryNote">{t('upload_doc_type_delivery_note')}</SelectItem>
                                <SelectItem value="invoice">{t('upload_doc_type_invoice')}</SelectItem>
                                <SelectItem value="paymentReceipt">{t('invoices_filter_doc_type_receipt_button')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div><Label htmlFor="editInvoiceNumber">{t('invoice_details_invoice_number_label')}</Label><Input id="editInvoiceNumber" value={editedInvoiceData.invoiceNumber || ''} onChange={(e) => handleEditDetailsInputChange('invoiceNumber', e.target.value)} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editSupplierName">{t('invoice_details_supplier_label')}</Label><Input id="editSupplierName" value={editedInvoiceData.supplierName || ''} onChange={(e) => handleEditDetailsInputChange('supplierName', e.target.value)} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editTotalAmount">{t('invoices_col_total_currency', { currency_symbol: t('currency_symbol') })}</Label><Input id="editTotalAmount" type="number" value={editedInvoiceData.totalAmount ?? ''} onChange={(e) => handleEditDetailsInputChange('totalAmount', parseFloat(e.target.value))} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editInvoiceDate">{t('invoice_details_invoice_date_label')}</Label><Input id="editInvoiceDate" type="date" value={editedInvoiceData.invoiceDate ? (editedInvoiceData.invoiceDate instanceof Timestamp ? format(editedInvoiceData.invoiceDate.toDate(), 'yyyy-MM-dd') : (typeof editedInvoiceData.invoiceDate === 'string' && isValid(parseISO(editedInvoiceData.invoiceDate)) ? format(parseISO(editedInvoiceData.invoiceDate), 'yyyy-MM-dd') : (editedInvoiceData.invoiceDate instanceof Date && isValid(editedInvoiceData.invoiceDate) ? format(editedInvoiceData.invoiceDate, 'yyyy-MM-dd') : ''))) : ''} onChange={(e) => handleEditDetailsInputChange('invoiceDate', e.target.value ? parseISO(e.target.value) : undefined)} disabled={isSavingDetails}/></div>
                    <div><Label htmlFor="editPaymentMethod">{t('invoice_details_payment_method_label')}</Label><Select value={editedInvoiceData.paymentMethod || ''} onValueChange={(value) => handleEditDetailsInputChange('paymentMethod', value)}><SelectTrigger className="mt-1"><SelectValue placeholder={t('invoice_details_payment_method_placeholder')}/></SelectTrigger><SelectContent><SelectItem value="cash">{t('payment_method_cash')}</SelectItem><SelectItem value="credit_card">{t('payment_method_credit_card')}</SelectItem><SelectItem value="bank_transfer">{t('payment_method_bank_transfer')}</SelectItem><SelectItem value="check">{t('payment_method_check')}</SelectItem><SelectItem value="other">{t('payment_method_other')}</SelectItem></SelectContent></Select></div>
                    <div><Label htmlFor="editPaymentDueDate">{t('payment_due_date_dialog_title')}</Label><Input id="editPaymentDueDate" type="date" value={editedInvoiceData.paymentDueDate ? (editedInvoiceData.paymentDueDate instanceof Timestamp ? format(editedInvoiceData.paymentDueDate.toDate(), 'yyyy-MM-dd') : (typeof editedInvoiceData.paymentDueDate === 'string' && isValid(parseISO(editedInvoiceData.paymentDueDate)) ? format(parseISO(editedInvoiceData.paymentDueDate), 'yyyy-MM-dd') : (editedInvoiceData.paymentDueDate instanceof Date && isValid(editedInvoiceData.paymentDueDate) ? format(editedInvoiceData.paymentDueDate, 'yyyy-MM-dd') : ''))) : ''} onChange={(e) => handleEditDetailsInputChange('paymentDueDate', e.target.value ? parseISO(e.target.value) : undefined)} disabled={isSavingDetails}/></div>
                    {selectedInvoiceDetails.status === 'error' && (<div><Label htmlFor="editErrorMessage">{t('invoice_details_error_message_label')}</Label><Textarea id="editErrorMessage" value={editedInvoiceData.errorMessage || ''} readOnly disabled className="mt-1 bg-muted/50"/></div>)}
                     {(selectedInvoiceDetails.paymentStatus === 'unpaid' || selectedInvoiceDetails.paymentStatus === 'pending_payment') && selectedInvoiceDetails.documentType !== 'paymentReceipt' && (
                         <div>
                            <Label>{t('invoice_payment_status_label')}</Label>
                                <div className="flex gap-2 mt-1">
                                    <Button variant={editedInvoiceData.paymentStatus === 'unpaid' || (editedInvoiceData.paymentStatus === 'pending_payment' && selectedInvoiceDetails.paymentDueDate && isBefore(selectedInvoiceDetails.paymentDueDate instanceof Timestamp ? selectedInvoiceDetails.paymentDueDate.toDate() : parseISO(selectedInvoiceDetails.paymentDueDate as string), new Date()) && !isSameDay(selectedInvoiceDetails.paymentDueDate instanceof Timestamp ? selectedInvoiceDetails.paymentDueDate.toDate() : parseISO(selectedInvoiceDetails.paymentDueDate as string), new Date())) ? 'destructive' : 'outline'} size="sm" onClick={() => handlePaymentStatusUpdate(selectedInvoiceDetails!.id, 'unpaid')} disabled={isSavingDetails}>{t('invoice_payment_status_unpaid')}</Button>
                                    <Button variant={editedInvoiceData.paymentStatus === 'pending_payment' && !(selectedInvoiceDetails.paymentDueDate && isBefore(selectedInvoiceDetails.paymentDueDate instanceof Timestamp ? selectedInvoiceDetails.paymentDueDate.toDate() : parseISO(selectedInvoiceDetails.paymentDueDate as string), new Date()) && !isSameDay(selectedInvoiceDetails.paymentDueDate instanceof Timestamp ? selectedInvoiceDetails.paymentDueDate.toDate() : parseISO(selectedInvoiceDetails.paymentDueDate as string), new Date())) ? 'secondary' : 'outline'} size="sm" onClick={() => handlePaymentStatusUpdate(selectedInvoiceDetails!.id, 'pending_payment')} disabled={isSavingDetails}>{t('invoice_payment_status_pending_payment')}</Button>
                                    <Button variant={editedInvoiceData.paymentStatus === 'paid' ? 'default' : 'outline'} size="sm" onClick={() => handlePaymentStatusUpdate(selectedInvoiceDetails!.id, 'paid')} disabled={isSavingDetails}>{t('invoice_payment_status_paid')}</Button>
                                </div>
                         </div>
                     )}
                     {selectedInvoiceDetails.paymentStatus === 'paid' && selectedInvoiceDetails.documentType !== 'paymentReceipt' && (
                          <div>
                            <Label>{t('paid_invoices_receipt_image_label')}</Label>
                            {editedInvoiceData.paymentReceiptImageUri ? (
                                <div className="mt-1 space-y-2">
                                     <NextImage src={editedInvoiceData.paymentReceiptImageUri} alt={t('paid_invoices_receipt_image_alt', {fileName: editedInvoiceData.originalFileName || ''})} width={200} height={280} className="rounded-md object-contain border"/>
                                     <Button variant="outline" size="sm" onClick={() => { setInvoiceForReceiptUpload(selectedInvoiceDetails); setShowReceiptUploadDialog(true); }} disabled={isSavingDetails}>{t('paid_invoices_update_receipt_button')}</Button>
                                </div>
                            ) : (
                                 <Button variant="secondary" size="sm" className="mt-1" onClick={() => { setInvoiceForReceiptUpload(selectedInvoiceDetails); setShowReceiptUploadDialog(true); }} disabled={isSavingDetails}>{t('paid_invoices_add_receipt_button')}</Button>
                            )}
                          </div>
                     )}
                </div>
              ) : (
                <>
                 <div className="space-y-2"><h3 className="text-md font-semibold text-primary border-b pb-1">{t('invoice_details_document_section_title')}</h3>
                      <p><strong>{t('invoice_details_file_name_label')}:</strong> {selectedInvoiceDetails.generatedFileName || selectedInvoiceDetails.originalFileName}</p>
                      <p><strong>{t('invoice_details_upload_time_label')}:</strong> {formatDateForDisplay(selectedInvoiceDetails.uploadTime)}</p>
                      <p><strong>{t('invoices_document_type_label')}:</strong> {t(`upload_doc_type_${selectedInvoiceDetails.documentType}` as any) || selectedInvoiceDetails.documentType}</p>
                      {selectedInvoiceDetails.documentType !== 'paymentReceipt' && (
                         <div className="flex items-center"><strong className="mr-1">{t('invoice_payment_status_label')}:</strong> {renderPaymentStatusBadge(selectedInvoiceDetails.paymentStatus, selectedInvoiceDetails.paymentDueDate)}</div>
                      )}
                  </div>
                  <Separator className="my-3"/>
                   <div className="space-y-2"><h3 className="text-md font-semibold text-primary border-b pb-1">{t('invoice_details_financial_section_title')}</h3>
                      <p><strong>{t('invoice_details_invoice_number_label')}:</strong> {selectedInvoiceDetails.invoiceNumber || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_supplier_label')}:</strong> {selectedInvoiceDetails.supplierName || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_total_amount_label')}:</strong> {selectedInvoiceDetails.totalAmount !== undefined ? formatCurrencyDisplay(selectedInvoiceDetails.totalAmount, {decimals:0}) : t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_invoice_date_label')}:</strong> {selectedInvoiceDetails.invoiceDate ? formatDateForDisplay(selectedInvoiceDetails.invoiceDate, 'PP') : t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_payment_method_label')}:</strong> {selectedInvoiceDetails.paymentMethod ? t(`payment_method_${selectedInvoiceDetails.paymentMethod.toLowerCase().replace(/\s+/g, '_')}` as any, {defaultValue: selectedInvoiceDetails.paymentMethod}) : t('invoices_na')}</p>
                      {selectedInvoiceDetails.paymentDueDate && (<p><strong>{t('payment_due_date_dialog_title')}:</strong> {formatDateForDisplay(selectedInvoiceDetails.paymentDueDate, 'PP')}</p>)}
                   </div>
                  {selectedInvoiceDetails.errorMessage && selectedInvoiceDetails.status === 'error' && (<><Separator className="my-3"/><div className="space-y-1"><h3 className="text-md font-semibold text-destructive border-b pb-1">{t('invoice_details_error_message_label')}</h3><p className="text-destructive text-xs">{selectedInvoiceDetails.errorMessage}</p></div></>)}
                  <Separator className="my-3"/>
                  <div className="space-y-2">
                     <h3 className="text-md font-semibold text-primary border-b pb-1">{selectedInvoiceDetails.paymentStatus === 'paid' && selectedInvoiceDetails.paymentReceiptImageUri ? t('paid_invoices_receipt_image_label') : t('invoice_details_image_label')}</h3>
                      {isValidImageSrc(selectedInvoiceDetails._displayContext === 'image_only' ? (selectedInvoiceDetails.paymentReceiptImageUri || selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri) : (selectedInvoiceDetails.paymentStatus === 'paid' && selectedInvoiceDetails.paymentReceiptImageUri ? selectedInvoiceDetails.paymentReceiptImageUri : (selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri))) ? (
                        <NextImage src={selectedInvoiceDetails._displayContext === 'image_only' ? (selectedInvoiceDetails.paymentReceiptImageUri || selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri)! : (selectedInvoiceDetails.paymentStatus === 'paid' && selectedInvoiceDetails.paymentReceiptImageUri ? selectedInvoiceDetails.paymentReceiptImageUri! : (selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri)!)} alt={t('invoice_details_image_alt', { fileName: selectedInvoiceDetails.originalFileName || selectedInvoiceDetails.generatedFileName || '' })} width={800} height={1100} className="rounded-md object-contain mx-auto" data-ai-hint="invoice document" />
                        ) : (<div className="text-muted-foreground text-center py-4 flex flex-col items-center"><ImageIconLucide className="h-10 w-10 mb-2"/><p>{selectedInvoiceDetails.paymentStatus === 'paid' ? t('paid_invoices_no_receipt_image_available') : t('invoice_details_no_image_available')}</p></div>)}
                  </div>
                </>
              )}
              </div>
            </ScrollArea>
          )}
          <SheetFooter className="p-4 sm:p-6 border-t flex flex-col sm:flex-row gap-2 shrink-0 sticky bottom-0 bg-background z-10">
            {selectedInvoiceDetails && selectedInvoiceDetails._displayContext !== 'image_only' && (<>
                {isEditingDetails ? (<><Button variant="outline" onClick={() => setIsEditingDetails(false)} disabled={isSavingDetails}>{t('cancel_button')}</Button><Button onClick={handleSaveInvoiceDetails} disabled={isSavingDetails}>{isSavingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{isSavingDetails ? t('saving_button') : t('save_changes_button')}</Button></>)
                : (<Button variant="outline" onClick={() => setIsEditingDetails(true)}><Edit className="mr-2 h-4 w-4" /> {t('invoices_edit_details_button')}</Button>)}
                 {(selectedInvoiceDetails.paymentStatus === 'unpaid' || selectedInvoiceDetails.paymentStatus === 'pending_payment') && selectedInvoiceDetails.documentType !== 'paymentReceipt' && (<Button variant="outline" onClick={() => {if(selectedInvoiceDetails) { setInvoiceForReceiptUpload(selectedInvoiceDetails); setShowReceiptUploadDialog(true);}}}><CheckSquare className="mr-2 h-4 w-4" /> {t('paid_invoices_mark_as_paid_button')}</Button>)}
                 {selectedInvoiceDetails.paymentStatus === 'paid' && selectedInvoiceDetails.documentType !== 'paymentReceipt' && (<Button variant="outline" onClick={() => {if(selectedInvoiceDetails) { setInvoiceForReceiptUpload(selectedInvoiceDetails); setShowReceiptUploadDialog(true);}}}><Receipt className="mr-2 h-4 w-4" /> {t('paid_invoices_update_receipt_button')}</Button>)}
                 <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={isDeleting} className="sm:ml-auto">
                            {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                            {t('invoices_delete_button')}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContentComponent>
                        <AlertDialogHeaderComponent><AlertDialogTitleComponent>{t('invoices_delete_confirm_title')}</AlertDialogTitleComponent><AlertDialogDescriptionComponent>{t('invoices_delete_confirm_desc', { fileName: selectedInvoiceDetails.originalFileName || selectedInvoiceDetails.generatedFileName || '' })}</AlertDialogDescriptionComponent></AlertDialogHeaderComponent>
                        <AlertDialogFooterComponent><AlertDialogCancel disabled={isDeleting}>{t('cancel_button')}</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteInvoice(selectedInvoiceDetails!.id)} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>{isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('invoices_delete_confirm_action')}</AlertDialogAction></AlertDialogFooterComponent>
                    </AlertDialogContentComponent>
                 </AlertDialog>
            </>)}
            <SheetClose asChild><Button variant="outline" className={cn(selectedInvoiceDetails && selectedInvoiceDetails._displayContext === 'image_only' && "w-full sm:w-auto")}>{t('invoices_close_button')}</Button></SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

    <AlertDialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <AlertDialogContentComponent>
            <AlertDialogHeaderComponent>
                <AlertDialogTitleComponent>{t('invoice_export_dialog_title')}</AlertDialogTitleComponent>
                <AlertDialogDescriptionComponent>
                    {t('invoice_export_dialog_desc', { count: selectedForBulkAction.length })}
                </AlertDialogDescriptionComponent>
            </AlertDialogHeaderComponent>
            <form onSubmit={handleExportSubmit} className="space-y-4">
                <div><Label htmlFor="accountantEmail" className="text-sm font-medium">{t('invoice_export_email_label')} <span className="text-destructive">*</span></Label><Input id="accountantEmail" type="email" value={accountantEmail} onChange={(e) => setAccountantEmail(e.target.value)} placeholder={t('invoice_export_email_placeholder')} required className="mt-1"/></div>
                <div><Label htmlFor="emailNote" className="text-sm font-medium">{t('invoice_export_note_label')}</Label><Textarea id="emailNote" value={emailNote} onChange={(e) => setEmailNote(e.target.value)} placeholder={t('invoice_export_note_placeholder')} className="mt-1"/></div>
                <AlertDialogFooterComponent><AlertDialogCancel onClick={() => setShowExportDialog(false)} disabled={isExporting}>{t('cancel_button')}</AlertDialogCancel><Button type="submit" disabled={isExporting} className="bg-primary hover:bg-primary/90">{isExporting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('sending')}</>) : (<><MailIcon className="mr-2 h-4 w-4" />{t('invoice_export_send_email_button')}</>)}</Button></AlertDialogFooterComponent>
            </form>
        </AlertDialogContentComponent>
    </AlertDialog>

    {showReceiptUploadDialog && invoiceForReceiptUpload && (
        <PaymentReceiptUploadDialog
            isOpen={showReceiptUploadDialog}
            onOpenChange={(isOpen) => { setShowReceiptUploadDialog(isOpen); if (!isOpen) setInvoiceForReceiptUpload(null); }}
            invoiceFileName={invoiceForReceiptUpload.originalFileName || invoiceForReceiptUpload.generatedFileName || ''}
            onConfirmUpload={async (receiptUri) => {
                await handlePaymentReceiptUploaded(invoiceForReceiptUpload.id, receiptUri);
            }}
        />
    )}
    </div>
  );
}
