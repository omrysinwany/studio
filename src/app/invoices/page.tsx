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
 } from '@/components/ui/dropdown-menu';
 import { Card, CardContent, CardDescription, CardHeader, CardFooter, CardTitle } from '@/components/ui/card';
 import { Search, Filter, ChevronDown, Loader2, CheckCircle, XCircle, Clock, Info, Download, Trash2, Edit, Save, ListChecks, Grid, Receipt, Eye, Briefcase, CreditCard, Mail as MailIcon, CheckSquare, ChevronLeft, ChevronRight, FileText as FileTextIconLucide, Image as ImageIconLucide, Link as LinkIcon, CalendarDays } from 'lucide-react';
 import { useRouter, useSearchParams } from 'next/navigation';
 import { useToast } from '@/hooks/use-toast';
 import type { DateRange } from 'react-day-picker';
 import { Calendar } from '@/components/ui/calendar';
 import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
 import { format, parseISO, subDays, startOfMonth, endOfMonth, isValid } from 'date-fns';
 import { enUS, he } from 'date-fns/locale';
 import { cn } from '@/lib/utils';
 import { InvoiceHistoryItem, getInvoicesService, deleteInvoiceService, updateInvoiceService, SupplierSummary, getSupplierSummariesService, getUserSettingsService, updateInvoicePaymentStatusService } from '@/services/backend';
 import { Badge } from '@/components/ui/badge';
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
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { Checkbox } from '@/components/ui/checkbox';
import { generateAndEmailInvoicesAction } from '@/actions/invoice-export-actions';
import PaymentReceiptUploadDialog from '@/components/PaymentReceiptUploadDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PaidInvoicesTabView from '@/components/PaidInvoicesTabView';


const isValidImageSrc = (src: string | undefined | null): src is string => {
  if (!src || typeof src !== 'string') return false;
  // Allow data URIs, http, https, and relative paths (for local placeholders)
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/') || src.startsWith('blob:');
};

type SortKey = keyof InvoiceHistoryItem | '';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';

const ITEMS_PER_PAGE_SCANNED_DOCS = 8;


// Scanned Documents View Component
const ScannedDocsView = ({ filterDocumentType }: { filterDocumentType: 'deliveryNote' | 'invoice' | '' }) => {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useTranslation();
  const router = useRouter();
  const { toast } = useToast();

  const [invoices, setInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof InvoiceHistoryItem | 'actions' | 'selection', boolean>>({
    selection: true,
    actions: true,
    id: false,
    originalFileName: true,
    generatedFileName: false,
    uploadTime: true,
    status: true,
    invoiceNumber: false,
    supplierName: true,
    totalAmount: true,
    errorMessage: false,
    originalImagePreviewUri: true,
    compressedImageForFinalRecordUri: false,
    paymentReceiptImageUri: false,
    paymentStatus: true,
    paymentDueDate: false,
    documentType: false,
    invoiceDate: false,
    paymentMethod: false,
    linkedDeliveryNoteId: false,
    rawScanResultJson: false,
    _displayContext: false,
  });
  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<InvoiceHistoryItem['status'] | ''>('');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<InvoiceHistoryItem['paymentStatus'] | ''>('');

  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [sortKey, setSortKey] = useState<SortKey>('uploadTime');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<InvoiceHistoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedInvoiceData, setEditedInvoiceData] = useState<Partial<InvoiceHistoryItem>>({});
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [existingSuppliers, setExistingSuppliers] = useState<SupplierSummary[]>([]);
  const [showReceiptUploadDialog, setShowReceiptUploadDialog] = useState(false);
  const [invoiceForReceiptUpload, setInvoiceForReceiptUpload] = useState<InvoiceHistoryItem | null>(null);
  const [currentScannedDocsPage, setCurrentScannedDocsPage] = useState(1);
  const [selectedForBulkDelete, setSelectedForBulkDelete] = useState<string[]>([]);


  const dropdownTriggerRef = useRef<HTMLButtonElement>(null);


  const fetchSuppliers = useCallback(async () => {
    if (!user?.id) return;
    try {
      const managedSuppliers = await getSupplierSummariesService(user.id);
      setExistingSuppliers(managedSuppliers);
    } catch (error) {
      console.error("Failed to fetch suppliers for filter:", error);
      toast({
        title: t('invoices_toast_error_fetch_suppliers_title'),
        description: t('invoices_toast_error_fetch_suppliers_desc'),
        variant: "destructive",
      });
    }
  }, [toast, t, user]);

  const fetchInvoices = useCallback(async () => {
      if(!user?.id) return;
      setIsLoading(true);
      try {
        let fetchedData = await getInvoicesService(user.id);
        let uniqueInvoicesMap = new Map<string, InvoiceHistoryItem>();
        
        fetchedData.forEach(invoice => {
            const existing = uniqueInvoicesMap.get(invoice.id);
            if (existing) {
                if ((invoice.originalImagePreviewUri && !existing.originalImagePreviewUri) ||
                    (invoice.originalImagePreviewUri && new Date(invoice.uploadTime as string).getTime() > new Date(existing.uploadTime as string).getTime())) {
                    uniqueInvoicesMap.set(invoice.id, invoice);
                } else if (!invoice.originalImagePreviewUri && existing.originalImagePreviewUri) {
                   // Keep existing if it has image and new one doesn't (unless new one is more recent)
                } else if (new Date(invoice.uploadTime as string).getTime() > new Date(existing.uploadTime as string).getTime()){
                     uniqueInvoicesMap.set(invoice.id, invoice);
                }
            } else {
                uniqueInvoicesMap.set(invoice.id, invoice);
            }
        });

        let filteredData = Array.from(uniqueInvoicesMap.values());
        // Filter out 'paid' invoices from this tab
        filteredData = filteredData.filter(inv => inv.paymentStatus !== 'paid');


        if (filterSupplier) {
           filteredData = filteredData.filter(inv => inv.supplierName === filterSupplier);
        }
        if (filterStatus) {
           filteredData = filteredData.filter(inv => inv.status === filterStatus);
        }
        if (filterPaymentStatus) {
            filteredData = filteredData.filter(inv => inv.paymentStatus === filterPaymentStatus);
        }
         if (dateRange?.from) {
            const startDate = new Date(dateRange.from);
            startDate.setHours(0, 0, 0, 0);
            filteredData = filteredData.filter(inv => {
                if (!inv.uploadTime) return false;
                let invDate: Date | null = null;
                if (inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
                else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
                return invDate ? invDate >= startDate : false;
            });
         }
         if (dateRange?.to) {
            const endDate = new Date(dateRange.to);
            endDate.setHours(23, 59, 59, 999);
            filteredData = filteredData.filter(inv => {
                 if (!inv.uploadTime) return false;
                let invDate: Date | null = null;
                if (inv.uploadTime instanceof Timestamp) invDate = inv.uploadTime.toDate();
                else if (typeof inv.uploadTime === 'string' && isValid(parseISO(inv.uploadTime))) invDate = parseISO(inv.uploadTime);
                return invDate ? invDate <= endDate : false;
            });
         }
         if (filterDocumentType) {
            filteredData = filteredData.filter(inv => inv.documentType === filterDocumentType);
         }


         if (sortKey) {
             filteredData.sort((a, b) => {
                 const valA = a[sortKey as keyof InvoiceHistoryItem];
                 const valB = b[sortKey as keyof InvoiceHistoryItem];
                 let comparison = 0;
                 if (sortKey === 'uploadTime' || sortKey === 'paymentDueDate' || sortKey === 'invoiceDate') {
                    let dateA = 0;
                    let dateB = 0;
                    if (valA) dateA = (valA instanceof Timestamp ? valA.toDate() : new Date(valA as string)).getTime();
                    if (valB) dateB = (valB instanceof Timestamp ? valB.toDate() : new Date(valB as string)).getTime();
                    comparison = dateA - dateB;
                 } else if (typeof valA === 'number' && typeof valB === 'number') {
                     comparison = valA - valB;
                 } else if (typeof valA === 'string' && typeof valB === 'string') {
                     comparison = valA.localeCompare(valB);
                 } else {
                    if (valA == null && valB != null) comparison = 1;
                    else if (valA != null && valB == null) comparison = -1;
                    else comparison = 0;
                 }
                 return sortDirection === 'asc' ? comparison : comparison * -1;
             });
         }
        setInvoices(filteredData);
      } catch (error) {
        console.error("Failed to fetch invoices:", error);
        toast({
          title: t('invoices_toast_error_fetch_invoices_title'),
          description: t('invoices_toast_error_fetch_invoices_desc'),
          variant: "destructive",
        });
        setInvoices([]);
      } finally {
        setIsLoading(false);
      }
    }, [filterSupplier, filterStatus, filterPaymentStatus, dateRange, toast, sortKey, sortDirection, t, user, filterDocumentType]);

  useEffect(() => {
    if(user?.id) {
     fetchInvoices();
     fetchSuppliers();
    }
   }, [fetchInvoices, fetchSuppliers, user]);


  const handleSort = (key: SortKey) => {
    if (!key) return;
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setCurrentScannedDocsPage(1);
  };

   const filteredAndSortedInvoices = useMemo(() => {
    let result = [...invoices];
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(item =>
        (item.originalFileName || '').toLowerCase().includes(lowerSearchTerm) ||
        (item.invoiceNumber && item.invoiceNumber.toLowerCase().includes(lowerSearchTerm)) ||
        (item.supplierName && item.supplierName.toLowerCase().includes(lowerSearchTerm))
      );
    }
    return result;
  }, [invoices, searchTerm]);

  const totalScannedDocs = filteredAndSortedInvoices.length;
  const totalScannedDocsPages = Math.ceil(totalScannedDocs / ITEMS_PER_PAGE_SCANNED_DOCS);
  const displayedScannedInvoices = useMemo(() => {
    const startIndex = (currentScannedDocsPage - 1) * ITEMS_PER_PAGE_SCANNED_DOCS;
    return filteredAndSortedInvoices.slice(startIndex, startIndex + ITEMS_PER_PAGE_SCANNED_DOCS);
  }, [filteredAndSortedInvoices, currentScannedDocsPage]);

  const handleScannedDocsPageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalScannedDocsPages) {
        setCurrentScannedDocsPage(newPage);
    }
  };


   const columnDefinitions: { key: keyof InvoiceHistoryItem | 'actions' | 'selection'; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean }[] = [
      { key: 'selection', labelKey: 'invoice_export_select_column_header', sortable: false, className: 'w-[3%] sm:w-[3%] text-center px-1 sticky left-0 bg-card z-20' },
      { key: 'actions', labelKey: 'edit_invoice_th_actions', sortable: false, className: 'w-[5%] sm:w-[5%] text-center px-1 sm:px-2 sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10' },
      { key: 'id', labelKey: 'inventory_col_id', sortable: true, className: "hidden" },
      { key: 'originalFileName', labelKey: 'upload_history_col_file_name', sortable: true, className: 'w-[20%] sm:w-[25%] min-w-[80px] sm:min-w-[100px] truncate' },
      { key: 'uploadTime', labelKey: 'upload_history_col_upload_time', sortable: true, className: 'min-w-[130px] sm:min-w-[150px]', mobileHidden: true },
      { key: 'status', labelKey: 'upload_history_col_status', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]' },
      { key: 'paymentStatus', labelKey: 'invoice_payment_status_label', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]' },
      { key: 'paymentDueDate', labelKey: 'payment_due_date_dialog_title', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true},
      { key: 'invoiceNumber', labelKey: 'invoices_col_inv_number', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
      { key: 'supplierName', labelKey: 'invoice_details_supplier_label', sortable: true, className: 'min-w-[120px] sm:min-w-[150px]', mobileHidden: true },
      { key: 'totalAmount', labelKey: 'invoices_col_total_currency', sortable: true, className: 'text-right min-w-[100px] sm:min-w-[120px]' },
      { key: 'errorMessage', labelKey: 'invoice_details_error_message_label', sortable: false, className: 'text-xs text-destructive max-w-xs truncate hidden' },
      { key: 'originalImagePreviewUri', labelKey: 'invoices_col_preview_uri', sortable: false, className: 'hidden' },
      { key: 'compressedImageForFinalRecordUri', labelKey: 'invoices_col_compressed_uri', sortable: false, className: 'hidden' },
      { key: 'paymentReceiptImageUri', labelKey: 'paid_invoices_receipt_image_label', sortable: false, className: 'hidden' },
      { key: 'documentType', labelKey: 'invoices_document_type_label', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
      { key: 'invoiceDate', labelKey: 'invoice_details_invoice_date_label', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
      { key: 'paymentMethod', labelKey: 'invoice_details_payment_method_label', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true },
      { key: 'linkedDeliveryNoteId', labelKey: 'invoices_linked_delivery_note_id_label', sortable: false, className: 'hidden' }, // Added for completeness
      { key: 'rawScanResultJson', labelKey: 'invoices_raw_scan_result_label', sortable: false, className: 'hidden' }, // Added for completeness
      { key: '_displayContext', labelKey: 'invoices_display_context_label', sortable: false, className: 'hidden' }, // Added for completeness

   ];

    const visibleColumnHeaders = columnDefinitions.filter(h => visibleColumns[h.key as keyof typeof visibleColumns] && h.key !== 'id' && h.key !== 'errorMessage' && h.key !== 'originalImagePreviewUri' && h.key !== 'actions' && h.key !== 'compressedImageForFinalRecordUri' && h.key !== 'paymentReceiptImageUri' && h.key !== 'documentType' && h.key !== 'invoiceDate' && h.key !== 'paymentMethod' && h.key !== 'selection' && h.key !== 'linkedDeliveryNoteId' && h.key !== 'rawScanResultJson' && h.key !== '_displayContext');

   const formatDate = (dateInput: string | Date | Timestamp | undefined) => {
     if (!dateInput) return t('invoices_na');
     try {
        let dateObj: Date | null = null;
        if (dateInput instanceof Timestamp) {
            dateObj = dateInput.toDate();
        } else if (typeof dateInput === 'string') {
            const parsed = parseISO(dateInput);
            if (isValid(parsed)) dateObj = parsed;
        } else if (dateInput instanceof Date && isValid(dateInput)) {
            dateObj = dateInput;
        }

        if (!dateObj || !isValid(dateObj)) {
            console.warn(`[InvoicesPage formatDate] Invalid date object for input:`, dateInput);
            return t('invoices_invalid_date');
        }
        const dateLocale = locale === 'he' ? he : enUS;
        return window.innerWidth < 640
             ? format(dateObj, 'dd/MM/yy HH:mm', { locale: dateLocale })
             : format(dateObj, 'PPp', { locale: dateLocale });
     } catch (e) {
       console.error("[InvoicesPage formatDate] Error formatting date:", e, "Input:", dateInput);
       return t('invoices_invalid_date');
     }
   };

    const formatCurrency = (value: number | undefined | null): string => {
        if (value === undefined || value === null || isNaN(value)) return `${t('currency_symbol')}0.00`;
        return `${t('currency_symbol')}${value.toLocaleString(t('locale_code_for_number_formatting') || undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };


   const toggleColumnVisibility = (key: keyof InvoiceHistoryItem | 'actions' | 'selection') => {
       setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
   };

   const handleViewDetails = (invoice: InvoiceHistoryItem | null) => {
    if (invoice) {
        const detailsToSet: InvoiceHistoryItem = {...invoice, _displayContext: 'full_details'};
        setSelectedInvoiceDetails(detailsToSet);
        setEditedInvoiceData({ ...invoice });
        setIsEditingDetails(false);
        setShowDetailsSheet(true);
    } else {
        setSelectedInvoiceDetails(null);
        setShowDetailsSheet(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string | string[]) => {
    if (!user?.id) return;
    setIsDeleting(true);
    try {
      const idsToDelete = Array.isArray(invoiceId) ? invoiceId : [invoiceId];
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
      fetchInvoices();
      setShowDetailsSheet(false);
      setSelectedInvoiceDetails(null);
      setSelectedForBulkDelete([]);
    } catch (error) {
      console.error("Failed to delete invoice(s):", error);
      toast({
          title: t('invoices_toast_delete_fail_title'),
          description: t('invoices_toast_delete_fail_desc'),
          variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };


  const handleEditDetailsInputChange = (field: keyof InvoiceHistoryItem, value: string | number | Date | undefined | null ) => {
     if (field === 'uploadTime' || field === 'status') return;
    setEditedInvoiceData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveInvoiceDetails = async () => {
    if (!selectedInvoiceDetails || !selectedInvoiceDetails.id || !user?.id) return;
    setIsSavingDetails(true);
    try {
        const updatedInvoiceData: Partial<InvoiceHistoryItem> = {
            originalFileName: editedInvoiceData.originalFileName || selectedInvoiceDetails.originalFileName,
            invoiceNumber: editedInvoiceData.invoiceNumber || undefined,
            supplierName: editedInvoiceData.supplierName || undefined,
            totalAmount: typeof editedInvoiceData.totalAmount === 'number' ? editedInvoiceData.totalAmount : undefined,
            errorMessage: editedInvoiceData.errorMessage || undefined,
            paymentStatus: editedInvoiceData.paymentStatus || selectedInvoiceDetails.paymentStatus,
            paymentDueDate: editedInvoiceData.paymentDueDate,
            documentType: editedInvoiceData.documentType || selectedInvoiceDetails.documentType,
            invoiceDate: editedInvoiceData.invoiceDate,
            paymentMethod: editedInvoiceData.paymentMethod,
        };

        await updateInvoiceService(selectedInvoiceDetails.id, updatedInvoiceData, user.id);
        toast({
            title: t('invoices_toast_updated_title'),
            description: t('invoices_toast_updated_desc'),
        });
        setIsEditingDetails(false);
        const refreshedInvoice = await getInvoicesService(user.id).then(all => all.find(inv => inv.id === selectedInvoiceDetails!.id));
        if (refreshedInvoice) {
            setSelectedInvoiceDetails(refreshedInvoice);
             fetchInvoices();
        } else {
           setShowDetailsSheet(false);
           fetchInvoices();
        }

    } catch (error) {
        console.error("Failed to save invoice details:", error);
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

 const handlePaymentStatusChange = async (invoiceId: string, newStatus: InvoiceHistoryItem['paymentStatus']) => {
    if (!user?.id || !selectedInvoiceDetails) return;

    if (newStatus === 'paid') {
        setInvoiceForReceiptUpload(selectedInvoiceDetails);
        setShowReceiptUploadDialog(true);
    } else {
        const originalInvoice = invoices.find(inv => inv.id === invoiceId);
        if (!originalInvoice) return;

        setSelectedInvoiceDetails(prev => prev ? {...prev, paymentStatus: newStatus, paymentReceiptImageUri: undefined } : null);
        setInvoices(prevInvoices => prevInvoices.map(inv => inv.id === invoiceId ? {...inv, paymentStatus: newStatus, paymentReceiptImageUri: undefined } : inv));

        try {
            await updateInvoicePaymentStatusService(invoiceId, newStatus, user.id, undefined);
            toast({
                title: t('toast_invoice_payment_status_updated_title'),
                description: t('toast_invoice_payment_status_updated_desc', { fileName: originalInvoice.originalFileName || '', status: t(`invoice_payment_status_${newStatus}` as any) || newStatus }),
            });
            fetchInvoices();
        } catch (error) {
            console.error("Failed to update payment status:", error);
            setSelectedInvoiceDetails(prev => prev ? {...prev, paymentStatus: originalInvoice.paymentStatus, paymentReceiptImageUri: originalInvoice.paymentReceiptImageUri } : null);
            setInvoices(prevInvoices => prevInvoices.map(inv => inv.id === invoiceId ? {...inv, paymentStatus: originalInvoice.paymentStatus, paymentReceiptImageUri: originalInvoice.paymentReceiptImageUri } : inv));
            toast({
                title: t('toast_invoice_payment_status_update_fail_title'),
                description: t('toast_invoice_payment_status_update_fail_desc'),
                variant: "destructive",
            });
        }
    }
};

const handleConfirmReceiptUpload = async (receiptImageUriParam: string) => {
    if (!invoiceForReceiptUpload || !user?.id) return;
    const invoiceId = invoiceForReceiptUpload.id;

    try {
        await updateInvoicePaymentStatusService(invoiceId, 'paid', user.id, receiptImageUriParam);
        toast({
            title: t('paid_invoices_toast_receipt_uploaded_title'),
            description: t('paid_invoices_toast_receipt_uploaded_desc', { fileName: invoiceForReceiptUpload.originalFileName || '' }),
        });
        setShowReceiptUploadDialog(false);
        setInvoiceForReceiptUpload(null);
        fetchInvoices();
        if (selectedInvoiceDetails && selectedInvoiceDetails.id === invoiceId) {
             setSelectedInvoiceDetails(prev => prev ? {...prev, paymentStatus: 'paid', paymentReceiptImageUri: receiptImageUriParam } : null);
        }
    } catch (error) {
        console.error("Failed to confirm receipt upload and update status:", error);
        toast({
            title: t('toast_invoice_payment_status_update_fail_title'),
            description: t('paid_invoices_error_processing_receipt'),
            variant: "destructive",
        });
    }
};

  const handleSelectInvoiceForBulkDelete = (invoiceId: string, checked: boolean) => {
    setSelectedForBulkDelete(prev =>
      checked ? [...prev, invoiceId] : prev.filter(id => id !== invoiceId)
    );
  };

  const handleSelectAllForBulkDelete = (checked: boolean) => {
    if (checked) {
      setSelectedForBulkDelete(displayedScannedInvoices.map(inv => inv.id));
    } else {
      setSelectedForBulkDelete([]);
    }
  };

  const handleViewImage = (invoice: InvoiceHistoryItem) => {
    const detailsToSet: InvoiceHistoryItem = {...invoice, _displayContext: 'image_only'};
    setSelectedInvoiceDetails(detailsToSet);
    setShowDetailsSheet(true);
  };

  if (authLoading || (isLoading && !user)) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="ml-2 text-muted-foreground">{t('invoices_loading')}</p>
       </div>
     );
   }
   if (!user && !authLoading) {
    return null;
   }

   const renderStatusBadge = (status: InvoiceHistoryItem['status'] | InvoiceHistoryItem['paymentStatus'], type: 'scan' | 'payment') => {
     let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
     let className = '';
     let icon = null;
     let labelKey = '';

     if (type === 'scan') {
        switch (status as InvoiceHistoryItem['status']) {
            case 'completed':
                variant = 'secondary';
                className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80';
                icon = <CheckCircle className="mr-1 h-3 w-3" />;
                labelKey = 'invoice_status_completed';
                break;
            case 'processing':
                variant = 'secondary';
                className = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse hover:bg-blue-100/80';
                icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />;
                labelKey = 'invoice_status_processing';
                break;
            case 'pending':
                variant = 'secondary';
                className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80';
                icon = <Clock className="mr-1 h-3 w-3" />;
                labelKey = 'invoice_status_pending';
                break;
            case 'error':
                variant = 'destructive';
                icon = <XCircle className="mr-1 h-3 w-3" />;
                labelKey = 'invoice_status_error';
                break;
            default:
                variant = 'outline';
                icon = null;
                labelKey = String(status);
                break;
        }
     } else if (type === 'payment') {
         switch (status as InvoiceHistoryItem['paymentStatus']) {
            case 'paid':
                variant = 'secondary';
                className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80';
                icon = <CreditCard className="mr-1 h-3 w-3" />;
                labelKey = 'invoice_payment_status_paid';
                break;
            case 'unpaid':
                variant = 'secondary';
                className = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-100/80';
                icon = <CreditCard className="mr-1 h-3 w-3" />;
                labelKey = 'invoice_payment_status_unpaid';
                break;
            case 'pending_payment':
                variant = 'secondary';
                className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80';
                icon = <Clock className="mr-1 h-3 w-3" />;
                labelKey = 'invoice_payment_status_pending_payment';
                break;
            default:
                variant = 'outline';
                icon = null;
                labelKey = String(status);
         }
     }
     return (
        <Badge variant={variant} className={cn("text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5", className)}>
            {icon}
            {t(labelKey as any) || (typeof status === 'string' ? status.charAt(0).toUpperCase() + status.slice(1) : '')}
        </Badge>
     );
  };


   return (
     <>
        {/* Filter Controls - Now rendered as pills */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className="rounded-full text-xs h-8 px-3 py-1 border bg-background hover:bg-muted"
                    >
                        <CalendarDays className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                        {dateRange?.from ? (
                            dateRange.to ? `${format(dateRange.from, "PP")} - ${format(dateRange.to, "PP")}` : format(dateRange.from, "PP")
                        ) : (
                            t('reports_date_range_placeholder')
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar initialFocus mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={1} />
                    {dateRange && (
                        <div className="p-2 border-t flex justify-end">
                            <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>{t('reports_date_range_clear')}</Button>
                        </div>
                    )}
                </PopoverContent>
            </Popover>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="rounded-full text-xs h-8 px-3 py-1 border bg-background hover:bg-muted">
                        <Briefcase className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                        {existingSuppliers.find(s => s.name === filterSupplier)?.name || t('invoices_filter_supplier_all')}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuLabel>{t('invoices_filter_supplier_label')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={!filterSupplier} onCheckedChange={() => setFilterSupplier('')}>
                        {t('invoices_filter_supplier_all')}
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
                    <Button variant="outline" className="rounded-full text-xs h-8 px-3 py-1 border bg-background hover:bg-muted">
                        <Filter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                        {filterStatus ? t(`invoice_status_${filterStatus}` as any) : t('invoices_filter_status_all')}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuLabel>{t('invoices_filter_status_label')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={!filterStatus} onCheckedChange={() => setFilterStatus('')}>{t('invoices_filter_status_all')}</DropdownMenuCheckboxItem>
                    {(['completed', 'processing', 'pending', 'error'] as InvoiceHistoryItem['status'][]).map((status) => (
                        <DropdownMenuCheckboxItem
                            key={status}
                            checked={filterStatus === status}
                            onCheckedChange={() => setFilterStatus(status)}
                        >
                            {t(`invoice_status_${status}` as any)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

             {/* Payment Status Filter - Only for ScannedDocsView, not for PaidInvoicesTabView */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="rounded-full text-xs h-8 px-3 py-1 border bg-background hover:bg-muted">
                        <CreditCard className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                        {filterPaymentStatus ? t(`invoice_payment_status_${filterPaymentStatus}` as any) : t('invoices_filter_payment_status_all')}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuLabel>{t('invoices_filter_payment_status_label')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={!filterPaymentStatus} onCheckedChange={() => setFilterPaymentStatus('')}>{t('invoices_filter_payment_status_all')}</DropdownMenuCheckboxItem>
                    {(['unpaid', 'pending_payment'] as InvoiceHistoryItem['paymentStatus'][]).map((pStatus) => (
                        <DropdownMenuCheckboxItem
                            key={pStatus}
                            checked={filterPaymentStatus === pStatus}
                            onCheckedChange={() => setFilterPaymentStatus(pStatus)}
                        >
                            {t(`invoice_payment_status_${pStatus}` as any)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>


        {viewMode === 'list' ? (
          <div className="overflow-x-auto relative">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow>
                  {visibleColumnHeaders.map((header) => (
                    <TableHead
                      key={header.key}
                      className={cn(
                          header.className,
                          header.sortable && "cursor-pointer hover:bg-muted/50",
                          header.mobileHidden ? 'hidden sm:table-cell' : 'table-cell',
                          'px-2 sm:px-4 py-2',
                           header.key === 'actions' ? 'sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10' : (header.key === 'selection' ? 'sticky left-0 bg-card z-20' : '')
                      )}
                      onClick={() => header.sortable && handleSort(header.key as SortKey)}
                      aria-sort={header.sortable ? (sortKey === header.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                    >
                      <div className="flex items-center gap-1 whitespace-nowrap">
                         {header.key === 'selection' ? (
                              <Checkbox
                                  checked={selectedForBulkDelete.length > 0 && selectedForBulkDelete.length === displayedScannedInvoices.length && displayedScannedInvoices.length > 0}
                                  onCheckedChange={(checked) => handleSelectAllForBulkDelete(!!checked)}
                                  aria-label={t('invoice_export_select_all_aria')}
                                  className="mx-auto"
                              />
                         ) : (
                          t(header.labelKey as any, { currency_symbol: t('currency_symbol') })
                         )}
                         {header.sortable && sortKey === header.key && (
                            <span className="text-xs" aria-hidden="true">
                               {sortDirection === 'asc' ? '▲' : '▼'}
                            </span>
                         )}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center px-2 sm:px-4 py-2">
                      <div className="flex justify-center items-center">
                         <Loader2 className="h-6 w-6 animate-spin text-primary" />
                         <span className="ml-2">{t('invoices_loading')}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : displayedScannedInvoices.length === 0 ? (
                  <TableRow>
                     <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center px-2 sm:px-4 py-2">
                       {t('invoices_no_invoices_found')}
                     </TableCell>
                  </TableRow>
                ) : (
                  displayedScannedInvoices.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/50" data-testid={`invoice-item-${item.id}`}>
                        {visibleColumns.selection && (
                           <TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-0 bg-card z-20", columnDefinitions.find(h => h.key === 'selection')?.className)}>
                              <Checkbox
                                checked={selectedForBulkDelete.includes(item.id)}
                                onCheckedChange={(checked) => handleSelectInvoiceForBulkDelete(item.id, !!checked)}
                                aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || ''})}
                              />
                           </TableCell>
                        )}
                        {visibleColumns.actions && (
                           <TableCell className={cn("text-center px-1 sm:px-2 py-2 sticky left-[calc(var(--checkbox-width,3%)+0.25rem)] bg-card z-10", columnDefinitions.find(h => h.key === 'actions')?.className)}>
                               <Button
                                   variant="ghost"
                                   size="icon"
                                   className="text-primary hover:text-primary/80 h-7 w-7"
                                   onClick={() => handleViewDetails(item)}
                                   title={t('invoices_view_details_title', { fileName: item.originalFileName || '' })}
                                   aria-label={t('invoices_view_details_aria', { fileName: item.originalFileName || '' })}
                               >
                                   <Info className="h-4 w-4" />
                               </Button>
                           </TableCell>
                       )}
                       {visibleColumns.originalFileName && (
                          <TableCell className={cn("font-medium px-2 sm:px-4 py-2", columnDefinitions.find(h => h.key === 'originalFileName')?.className)}>
                             <Button
                                variant="link"
                                className="p-0 h-auto text-left font-medium cursor-pointer hover:underline truncate"
                                onClick={() => handleViewImage(item)}
                                title={t('upload_history_view_image_title', {fileName: item.originalFileName || item.generatedFileName || ''})}
                              >
                                {(item.originalImagePreviewUri || item.compressedImageForFinalRecordUri) && <ImageIconLucide className="inline-block mr-1.5 h-3.5 w-3.5 text-muted-foreground" />}
                                {item.generatedFileName || item.originalFileName}
                            </Button>
                          </TableCell>
                       )}
                       {visibleColumns.uploadTime && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'uploadTime')?.mobileHidden && 'hidden sm:table-cell')}>{formatDate(item.uploadTime)}</TableCell>}
                       {visibleColumns.status && (
                         <TableCell className="px-2 sm:px-4 py-2">
                            {renderStatusBadge(item.status, 'scan')}
                         </TableCell>
                       )}
                        {visibleColumns.paymentStatus && (
                         <TableCell className="px-2 sm:px-4 py-2">
                            {renderStatusBadge(item.paymentStatus, 'payment')}
                         </TableCell>
                       )}
                       {visibleColumns.paymentDueDate && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'paymentDueDate')?.mobileHidden && 'hidden sm:table-cell')}>{item.paymentDueDate ? formatDate(item.paymentDueDate) : t('invoices_na')}</TableCell>}
                       {visibleColumns.invoiceNumber && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'invoiceNumber')?.mobileHidden && 'hidden sm:table-cell')}>{item.invoiceNumber || t('invoices_na')}</TableCell>}
                       {visibleColumns.supplierName && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'supplierName')?.mobileHidden && 'hidden sm:table-cell')}>{item.supplierName || t('invoices_na')}</TableCell>}
                       {visibleColumns.totalAmount && (
                         <TableCell className="text-right px-2 sm:px-4 py-2 whitespace-nowrap">
                            {item.totalAmount !== undefined && item.totalAmount !== null ? formatCurrency(item.totalAmount) : t('invoices_na')}
                         </TableCell>
                       )}
                       {visibleColumns.errorMessage && (
                         <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'errorMessage')?.className)}>
                             {item.status === 'error' ? item.errorMessage : t('invoices_na')}
                         </TableCell>
                       )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
             {totalScannedDocsPages > 1 && (
                <div className="flex items-center justify-end space-x-2 py-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleScannedDocsPageChange(currentScannedDocsPage - 1)}
                        disabled={currentScannedDocsPage === 1}
                    >
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">{t('inventory_pagination_previous')}</span>
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        {t('inventory_pagination_page_info_simple', { currentPage: currentScannedDocsPage, totalPages: totalScannedDocsPages})}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleScannedDocsPageChange(currentScannedDocsPage + 1)}
                        disabled={currentScannedDocsPage === totalScannedDocsPages}
                    >
                         <span className="sr-only">{t('inventory_pagination_next')}</span>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" style={{ gridAutoRows: 'minmax(150px, auto)' }}>
            {isLoading ? (
               Array.from({ length: ITEMS_PER_PAGE_SCANNED_DOCS }).map((_, index) => (
                  <Card key={index} className="animate-pulse">
                      <CardHeader className="h-32 bg-muted rounded-t-lg" />
                      <CardContent className="p-4 space-y-2">
                          <div className="h-4 bg-muted rounded w-3/4" />
                          <div className="h-3 bg-muted rounded w-1/2" />
                          <div className="h-3 bg-muted rounded w-1/4" />
                      </CardContent>
                  </Card>
               ))
            ) : displayedScannedInvoices.length === 0 ? (
              <p className="col-span-full text-center text-muted-foreground py-10">{t('invoices_no_invoices_found')}</p>
            ) : (
              displayedScannedInvoices.map((item) => (
                <Card key={item.id} className="flex flex-col overflow-hidden cursor-pointer hover:shadow-lg transition-shadow scale-fade-in">
                   <div className="p-2 absolute top-0 left-0 z-10">
                       <Checkbox
                          checked={selectedForBulkDelete.includes(item.id)}
                          onCheckedChange={(checked) => handleSelectInvoiceForBulkDelete(item.id, !!checked)}
                          aria-label={t('invoice_export_select_aria', { fileName: item.originalFileName || ''})}
                          className="bg-background/70 hover:bg-background border-primary"
                      />
                  </div>
                  <CardHeader className="p-0 relative aspect-[4/3]" onClick={() => handleViewImage(item)}>
                    {isValidImageSrc(item.originalImagePreviewUri || item.compressedImageForFinalRecordUri) ? (
                      <NextImage
                        src={item.originalImagePreviewUri || item.compressedImageForFinalRecordUri!}
                        alt={t('invoices_preview_alt', { fileName: item.originalFileName || '' })}
                        layout="fill"
                        objectFit="cover"
                        className="rounded-t-lg"
                        data-ai-hint="invoice document"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted rounded-t-lg flex items-center justify-center">
                        {item.documentType === 'invoice' ? <FileTextIconLucide className="h-12 w-12 text-blue-500/50" /> : <FileTextIconLucide className="h-12 w-12 text-green-500/50" />}
                      </div>
                    )}
                     <div className="absolute top-2 right-2 flex flex-col gap-1">
                        {renderStatusBadge(item.status, 'scan')}
                        {renderStatusBadge(item.paymentStatus, 'payment')}
                     </div>
                  </CardHeader>
                  <CardContent className="p-3 flex-grow" onClick={() => handleViewDetails(item)}>
                    <CardTitle className="text-sm font-semibold truncate" title={item.originalFileName}>
                       {item.documentType === 'invoice' ? <FileTextIconLucide className="inline-block mr-1.5 h-3.5 w-3.5 text-blue-500" /> : <FileTextIconLucide className="inline-block mr-1.5 h-3.5 w-3.5 text-green-500" /> }
                      {item.generatedFileName || item.originalFileName}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{formatDate(item.uploadTime)}</p>
                     {item.supplierName && <p className="text-xs text-muted-foreground">{t('invoice_details_supplier_label')}: {item.supplierName}</p>}
                     {item.invoiceNumber && <p className="text-xs text-muted-foreground">{t('invoice_details_invoice_number_label')}: {item.invoiceNumber}</p>}
                     {item.totalAmount !== undefined && <p className="text-xs font-medium">{t('invoices_col_total')}: {formatCurrency(item.totalAmount)}</p>}
                     {item.status === 'error' && item.errorMessage && (
                         <p className="text-xs text-destructive truncate" title={item.errorMessage}>{t('invoice_status_error')}: {item.errorMessage.substring(0,30)}...</p>
                     )}
                  </CardContent>
                   <CardFooter className="p-3 border-t">
                      <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={(e) => { e.stopPropagation(); handleViewDetails(item); }}>
                          <Info className="mr-1.5 h-3.5 w-3.5"/> {t('invoices_view_details_button')}
                      </Button>
                      {(item.status === 'pending' || item.status === 'error') && user && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start text-xs text-amber-600 hover:text-amber-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            const uniqueScanId = item.id.startsWith(`pending-inv-${user.id}_`) ? item.id.replace(`pending-inv-${user.id}_`, '') : item.id;

                             const queryParams = new URLSearchParams({
                                tempInvoiceId: item.id, 
                                docType: item.documentType,
                                originalFileName: encodeURIComponent(item.originalFileName || 'unknown_doc'),
                            });
                            
                            router.push(`/edit-invoice?${queryParams.toString()}`);
                          }}
                        >
                          <Edit className="mr-1.5 h-3.5 w-3.5" /> {t('edit_button')}
                        </Button>
                      )}
                   </CardFooter>
                </Card>
              ))
            )}
          </div>
        )}
         {viewMode === 'grid' && totalScannedDocsPages > 1 && (
            <div className="flex items-center justify-end space-x-2 py-4 mt-4">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleScannedDocsPageChange(currentScannedDocsPage - 1)}
                    disabled={currentScannedDocsPage === 1}
                >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="sr-only">{t('inventory_pagination_previous')}</span>
                </Button>
                <span className="text-sm text-muted-foreground">
                    {t('inventory_pagination_page_info_simple', { currentPage: currentScannedDocsPage, totalPages: totalScannedDocsPages})}
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleScannedDocsPageChange(currentScannedDocsPage + 1)}
                    disabled={currentScannedDocsPage === totalScannedDocsPages}
                >
                     <span className="sr-only">{t('inventory_pagination_next')}</span>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        )}
      <Sheet open={showDetailsSheet} onOpenChange={(open) => {
          setShowDetailsSheet(open);
          if (!open) {
            setIsEditingDetails(false);
            setSelectedInvoiceDetails(null);
          }
      }}>
        <SheetContent side="bottom" className="h-[85vh] sm:h-[90vh] flex flex-col p-0 rounded-t-lg">
          <SheetHeader className="p-4 sm:p-6 border-b shrink-0 sticky top-0 bg-background z-10">
             <SheetTitle className="flex items-center text-lg sm:text-xl">{isEditingDetails ? <Edit className="mr-2 h-5 w-5"/> : <Info className="mr-2 h-5 w-5"/>}{isEditingDetails ? t('invoices_edit_details_title') : t('invoice_details_title')}</SheetTitle>
             <SheetDescription className="text-xs sm:text-sm">
                {isEditingDetails ? t('invoices_edit_details_desc', { fileName: selectedInvoiceDetails?.originalFileName || '' }) : t('invoice_details_description', { fileName: selectedInvoiceDetails?.originalFileName || '' })}
             </SheetDescription>
          </SheetHeader>
          {selectedInvoiceDetails && (
            <ScrollArea className="flex-grow p-0">
              <div className="p-4 sm:p-6 space-y-4">
              {isEditingDetails ? (
                <div className="space-y-3">
                    <div>
                        <Label htmlFor="editFileName">{t('invoice_details_file_name_label')}</Label>
                        <Input id="editFileName" value={editedInvoiceData.originalFileName || ''} onChange={(e) => handleEditDetailsInputChange('originalFileName', e.target.value)} disabled={isSavingDetails}/>
                    </div>
                     <div>
                        <Label htmlFor="editDocumentType">{t('invoices_document_type_label')}</Label>
                         <Select
                            value={editedInvoiceData.documentType || selectedInvoiceDetails.documentType}
                            onValueChange={(value) => handleEditDetailsInputChange('documentType', value as 'deliveryNote' | 'invoice')}
                            disabled={isSavingDetails}
                         >
                            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="deliveryNote">{t('upload_doc_type_delivery_note')}</SelectItem>
                                <SelectItem value="invoice">{t('upload_doc_type_invoice')}</SelectItem>
                            </SelectContent>
                         </Select>
                    </div>
                    <div>
                        <Label htmlFor="editInvoiceNumber">{t('invoice_details_invoice_number_label')}</Label>
                        <Input id="editInvoiceNumber" value={editedInvoiceData.invoiceNumber || ''} onChange={(e) => handleEditDetailsInputChange('invoiceNumber', e.target.value)} disabled={isSavingDetails}/>
                    </div>
                    <div>
                        <Label htmlFor="editSupplier">{t('invoice_details_supplier_label')}</Label>
                        <Input id="editSupplier" value={editedInvoiceData.supplierName || ''} onChange={(e) => handleEditDetailsInputChange('supplierName', e.target.value)} disabled={isSavingDetails}/>
                    </div>
                    <div>
                        <Label htmlFor="editTotalAmount">{t('invoices_col_total_currency', { currency_symbol: t('currency_symbol') })}</Label>
                        <Input id="editTotalAmount" type="number" value={editedInvoiceData.totalAmount ?? ''} onChange={(e) => handleEditDetailsInputChange('totalAmount', parseFloat(e.target.value))} disabled={isSavingDetails}/>
                    </div>
                    <div>
                        <Label htmlFor="editInvoiceDate">{t('invoice_details_invoice_date_label')}</Label>
                        <Input id="editInvoiceDate" type="date" value={editedInvoiceData.invoiceDate ? format(parseISO(editedInvoiceData.invoiceDate as string), 'yyyy-MM-dd') : ''} onChange={(e) => handleEditDetailsInputChange('invoiceDate', e.target.value ? parseISO(e.target.value).toISOString() : undefined)} disabled={isSavingDetails}/>
                    </div>
                     <div>
                        <Label htmlFor="editPaymentMethod">{t('invoice_details_payment_method_label')}</Label>
                        <Input id="editPaymentMethod" value={editedInvoiceData.paymentMethod || ''} onChange={(e) => handleEditDetailsInputChange('paymentMethod', e.target.value)} disabled={isSavingDetails}/>
                    </div>
                    <div>
                        <Label htmlFor="editPaymentDueDate">{t('payment_due_date_dialog_title')}</Label>
                        <Input id="editPaymentDueDate" type="date" value={editedInvoiceData.paymentDueDate ? format(parseISO(editedInvoiceData.paymentDueDate as string), 'yyyy-MM-dd') : ''} onChange={(e) => handleEditDetailsInputChange('paymentDueDate', e.target.value ? parseISO(e.target.value).toISOString() : undefined)} disabled={isSavingDetails}/>
                    </div>
                    {selectedInvoiceDetails.status === 'error' && (
                        <div>
                            <Label htmlFor="editErrorMessage">{t('invoice_details_error_message_label')}</Label>
                            <Textarea id="editErrorMessage" value={editedInvoiceData.errorMessage || ''} onChange={(e) => handleEditDetailsInputChange('errorMessage', e.target.value as string)} disabled={isSavingDetails}/>
                        </div>
                    )}
                     <div>
                        <Label>{t('invoice_payment_status_label')}</Label>
                            <div className="flex gap-2 mt-1">
                                {(['unpaid', 'pending_payment', 'paid'] as InvoiceHistoryItem['paymentStatus'][]).map(pStatus => (
                                    <Button
                                        key={pStatus}
                                        variant={editedInvoiceData.paymentStatus === pStatus ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => {
                                             if (pStatus === 'paid' && selectedInvoiceDetails) {
                                                setInvoiceForReceiptUpload(selectedInvoiceDetails);
                                                setEditedInvoiceData(prev => ({...prev, paymentStatus: pStatus })); // Tentatively set status
                                                setShowReceiptUploadDialog(true); // Open dialog to get receipt
                                            } else {
                                               handleEditDetailsInputChange('paymentStatus', pStatus);
                                            }
                                        }}
                                        disabled={isSavingDetails}
                                    >
                                      {t(`invoice_payment_status_${pStatus}` as any)}
                                    </Button>
                                ))}
                            </div>
                     </div>

                </div>
              ) : (
                <>
                 <div className="space-y-2">
                     <h3 className="text-md font-semibold text-primary border-b pb-1">{t('invoice_details_document_section_title')}</h3>
                      <p><strong>{t('invoice_details_file_name_label')}:</strong> {selectedInvoiceDetails.generatedFileName || selectedInvoiceDetails.originalFileName}</p>
                      <p><strong>{t('invoice_details_upload_time_label')}:</strong> {formatDate(selectedInvoiceDetails.uploadTime)}</p>
                      <p><strong>{t('invoices_document_type_label')}:</strong> {t(`upload_doc_type_${selectedInvoiceDetails.documentType}` as any) || selectedInvoiceDetails.documentType}</p>
                       <div className="flex items-center">
                        <strong className="mr-1">{t('invoice_details_status_label')}:</strong> {renderStatusBadge(selectedInvoiceDetails.status, 'scan')}
                      </div>
                  </div>
                  <Separator className="my-3"/>
                   <div className="space-y-2">
                     <h3 className="text-md font-semibold text-primary border-b pb-1">{t('invoice_details_financial_section_title')}</h3>
                      <p><strong>{t('invoice_details_invoice_number_label')}:</strong> {selectedInvoiceDetails.invoiceNumber || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_supplier_label')}:</strong> {selectedInvoiceDetails.supplierName || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_total_amount_label')}:</strong> {selectedInvoiceDetails.totalAmount !== undefined ? formatCurrency(selectedInvoiceDetails.totalAmount) : t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_invoice_date_label')}:</strong> {selectedInvoiceDetails.invoiceDate ? formatDate(selectedInvoiceDetails.invoiceDate) : t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_payment_method_label')}:</strong> {selectedInvoiceDetails.paymentMethod || t('invoices_na')}</p>
                      <div className="flex items-center mt-1">
                        <strong className="mr-1">{t('invoice_payment_status_label')}:</strong> {renderStatusBadge(selectedInvoiceDetails.paymentStatus, 'payment')}
                       </div>
                       {selectedInvoiceDetails.paymentDueDate && (
                         <p><strong>{t('payment_due_date_dialog_title')}:</strong> {formatDate(selectedInvoiceDetails.paymentDueDate)}</p>
                       )}
                   </div>

                  {selectedInvoiceDetails.errorMessage && selectedInvoiceDetails.status === 'error' && (
                    <>
                    <Separator className="my-3"/>
                    <div className="space-y-1">
                      <h3 className="text-md font-semibold text-destructive border-b pb-1">{t('invoice_details_error_message_label')}</h3>
                      <p className="text-destructive text-xs">{selectedInvoiceDetails.errorMessage}</p>
                    </div>
                    </>
                  )}
                  <Separator className="my-3"/>
                  <div className="space-y-2">
                     <h3 className="text-md font-semibold text-primary border-b pb-1">
                        {selectedInvoiceDetails.paymentStatus === 'paid' && selectedInvoiceDetails.paymentReceiptImageUri ? t('paid_invoices_receipt_image_label') : t('invoice_details_image_label')}
                     </h3>
                      {isValidImageSrc(selectedInvoiceDetails.paymentStatus === 'paid' ? selectedInvoiceDetails.paymentReceiptImageUri : (selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri)) ? (
                        <NextImage
                            src={selectedInvoiceDetails.paymentStatus === 'paid' ? selectedInvoiceDetails.paymentReceiptImageUri! : (selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri)!}
                            alt={t('invoice_details_image_alt', { fileName: selectedInvoiceDetails.originalFileName || '' })}
                            width={800}
                            height={1100}
                            className="rounded-md object-contain mx-auto"
                            data-ai-hint="invoice document"
                        />
                        ) : (
                        <div className="text-muted-foreground text-center py-4 flex flex-col items-center">
                            <ImageIconLucide className="h-10 w-10 mb-2"/>
                            <p>{selectedInvoiceDetails.paymentStatus === 'paid' ? t('paid_invoices_no_receipt_image_available') : t('invoice_details_no_image_available')}</p>
                        </div>
                        )}
                  </div>
                </>
              )}
              </div>
            </ScrollArea>
          )}
          <SheetFooter className="p-4 sm:p-6 border-t flex flex-col sm:flex-row gap-2 shrink-0 sticky bottom-0 bg-background z-10">
            {selectedInvoiceDetails && (
                <>
                    {isEditingDetails ? (
                        <>
                            <Button variant="outline" onClick={() => setIsEditingDetails(false)} disabled={isSavingDetails}>{t('cancel_button')}</Button>
                            <Button onClick={handleSaveInvoiceDetails} disabled={isSavingDetails}>
                                {isSavingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                {isSavingDetails ? t('saving_button') : t('save_changes_button')}
                            </Button>
                        </>
                    ) : (
                        <Button variant="outline" onClick={() => setIsEditingDetails(true)}>
                            <Edit className="mr-2 h-4 w-4" /> {t('invoices_edit_details_button')}
                        </Button>
                    )}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={isDeleting || isSavingDetails}>
                                <Trash2 className="mr-2 h-4 w-4" /> {t('invoices_delete_button')}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContentComponent>
                            <AlertDialogHeaderComponent>
                                <AlertDialogTitleComponent>{t('invoices_delete_confirm_title')}</AlertDialogTitleComponent>
                                <AlertDialogDescriptionComponent>
                                    {t('invoices_delete_confirm_desc', { fileName: selectedInvoiceDetails.originalFileName || '' })}
                                </AlertDialogDescriptionComponent>
                            </AlertDialogHeaderComponent>
                            <AlertDialogFooterComponent>
                                <AlertDialogCancel disabled={isDeleting}>{t('cancel_button')}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => selectedInvoiceDetails && handleDeleteInvoice(selectedInvoiceDetails.id)} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>
                                    {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {t('invoices_delete_confirm_action')}
                                </AlertDialogAction>
                            </AlertDialogFooterComponent>
                        </AlertDialogContentComponent>
                    </AlertDialog>
                     {selectedInvoiceDetails.paymentStatus !== 'paid' && ( 
                         <Button
                            variant="outline"
                            onClick={() => {
                                if(selectedInvoiceDetails) {
                                    setInvoiceForReceiptUpload(selectedInvoiceDetails);
                                    setShowReceiptUploadDialog(true);
                                }
                            }}
                         >
                           <Receipt className="mr-2 h-4 w-4" /> {t('paid_invoices_mark_as_paid_button')}
                         </Button>
                     )}
                </>
            )}
            <SheetClose asChild>
                 <Button variant="outline" className="sm:ml-auto">{t('invoices_close_button')}</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

        {showReceiptUploadDialog && invoiceForReceiptUpload && (
            <PaymentReceiptUploadDialog
                isOpen={showReceiptUploadDialog}
                onOpenChange={(isOpen) => {
                    setShowReceiptUploadDialog(isOpen);
                    if (!isOpen) setInvoiceForReceiptUpload(null);
                }}
                invoiceFileName={invoiceForReceiptUpload.originalFileName || ''}
                onConfirmUpload={async (receiptUri) => {
                    if(selectedInvoiceDetails && editedInvoiceData.paymentStatus === 'paid' && isEditingDetails){
                        await handleConfirmReceiptUpload(receiptUri); 
                        setEditedInvoiceData(prev => ({...prev, paymentReceiptImageUri: receiptUri })); 
                    } else if (selectedInvoiceDetails){
                        await handleConfirmReceiptUpload(receiptUri);
                    }
                }}
            />
        )}
    </>
   );
};


export default function DocumentsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [filterDocumentType, setFilterDocumentType] = useState<'deliveryNote' | 'invoice' | ''>('');


  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <FileTextIconLucide className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('documents_page_title')}
            </CardTitle>
          </div>
          <CardDescription>{t('documents_page_description')}</CardDescription>
        </CardHeader>
        <CardContent>
         <div className="mb-4">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full sm:w-auto">
                        <Filter className="mr-2 h-4 w-4" />
                        {filterDocumentType === 'deliveryNote' ? t('upload_doc_type_delivery_note') :
                         filterDocumentType === 'invoice' ? t('upload_doc_type_invoice') :
                         t('invoices_filter_doc_type_all')}
                        <ChevronDown className="ml-auto h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuLabel>{t('invoices_filter_doc_type_label')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                        checked={filterDocumentType === ''}
                        onCheckedChange={() => setFilterDocumentType('')}
                    >
                        {t('invoices_filter_doc_type_all')}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={filterDocumentType === 'deliveryNote'}
                        onCheckedChange={() => setFilterDocumentType('deliveryNote')}
                    >
                        {t('upload_doc_type_delivery_note')}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={filterDocumentType === 'invoice'}
                        onCheckedChange={() => setFilterDocumentType('invoice')}
                    >
                        {t('upload_doc_type_invoice')}
                    </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Tabs defaultValue="scanned-docs" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="scanned-docs">{t('invoices_tab_scanned_docs')}</TabsTrigger>
              <TabsTrigger value="paid-invoices">{t('invoices_tab_paid_invoices')}</TabsTrigger>
            </TabsList>
            <TabsContent value="scanned-docs">
              <ScannedDocsView filterDocumentType={filterDocumentType} />
            </TabsContent>
            <TabsContent value="paid-invoices">
              <PaidInvoicesTabView filterDocumentType={filterDocumentType} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

