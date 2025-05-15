
// src/app/inventory/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Search, Filter, ChevronDown, Loader2, Eye, Package, AlertTriangle, Download, Trash2, ChevronLeft, ChevronRight, ChevronUp, Image as ImageIconLucide, ListChecks, Grid, Plus, Minus } from 'lucide-react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn } from "@/lib/utils";
import { Product, getProductsService, clearInventoryService, updateProductService, deleteProductService } from '@/services/backend';
import { Badge } from '@/components/ui/badge';
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
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import NextImage from 'next/image';
import { Skeleton } from "@/components/ui/skeleton";


const ITEMS_PER_PAGE = 10;

type SortKey = keyof Product | 'calculatedGrossProfit' | '';
type SortDirection = 'asc' | 'desc';

const formatDisplayNumberWithTranslation = (
    value: number | undefined | null,
    t: (key: string, params?: Record<string, string | number>) => string,
    options?: { decimals?: number, useGrouping?: boolean, currency?: boolean }
): string => {
    const { decimals = 0, useGrouping = true, currency = false } = options || {};
    const shekelSymbol = t('currency_symbol');

    if (value === null || value === undefined || isNaN(value)) {
        const zeroFormatted = (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, {
            minimumFractionDigits: currency && decimals !==0 ? 2 : decimals,
            maximumFractionDigits: currency && decimals !==0 ? 2 : decimals,
            useGrouping: useGrouping,
        });
        return currency ? `${shekelSymbol}${zeroFormatted}` : zeroFormatted;
    }

    const formatted = value.toLocaleString(t('locale_code_for_number_formatting') || undefined, {
        minimumFractionDigits: currency && decimals !==0 ? 2 : decimals,
        maximumFractionDigits: currency && decimals !==0 ? 2 : decimals,
        useGrouping: useGrouping,
    });
    return currency ? `${shekelSymbol}${formatted}` : formatted;
};

const formatIntegerQuantityWithTranslation = (
    value: number | undefined | null,
    t: (key: string) => string // Removed unused params argument
): string => {
    if (value === null || value === undefined || isNaN(value)) {
        return (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, { useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    return Math.round(value).toLocaleString(t('locale_code_for_number_formatting') || undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 0 });
};


export default function InventoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { toast } = useToast();
  const { t, locale } = useTranslation();

  const [inventory, setInventory] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof Product | 'actions' | 'imageUrl' , boolean>>({
    actions: true,
    imageUrl: true,
    id: false, // Usually hidden in UI, but good for keying
    shortName: true,
    description: false, // Keep default false
    catalogNumber: true, // Show catalog by default
    barcode: false, // Keep default false
    quantity: true,
    unitPrice: false, // Default hidden
    salePrice: true,
    lineTotal: false, // Default hidden
    minStockLevel: false, // Keep default false
    maxStockLevel: false, // Keep default false
    lastUpdated: false,
    userId: false,
    _originalId: false,
  });
  const [filterStockLevel, setFilterStockLevel] = useState<'all' | 'low' | 'inStock' | 'out' | 'over'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('shortName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [isMobileView, setIsMobileView] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'cards' | 'table'>('cards');
  const [updatingQuantityProductId, setUpdatingQuantityProductId] = useState<string | null>(null);


  const inventoryValue = useMemo(() => {
    return inventory.reduce((acc, product) => acc + ((product.unitPrice || 0) * (product.quantity || 0)), 0);
  }, [inventory]);

  const stockAlerts = useMemo(() => {
    return inventory.filter(item => (item.quantity || 0) <= (item.minStockLevel ?? 10) || (item.quantity || 0) === 0 || (item.maxStockLevel !== undefined && (item.quantity || 0) > item.maxStockLevel));
  }, [inventory]);

  const shouldRefresh = searchParams.get('refresh');
  const initialFilter = searchParams.get('filter');

  const fetchInventory = useCallback(async () => {
      if (!user || !user.id) { // Check for user.id
          setIsLoading(false);
          setInventory([]);
          return;
      }
      setIsLoading(true);
      try {
        const data = await getProductsService(user.id); // Pass userId
        const inventoryWithCorrectTotals = data.map(item => {
            const quantity = Number(item.quantity) || 0;
            const unitPrice = Number(item.unitPrice) || 0;
             return {
                 ...item,
                 quantity: quantity,
                 unitPrice: unitPrice,
                 salePrice: item.salePrice,
                 lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
                 minStockLevel: item.minStockLevel,
                 maxStockLevel: item.maxStockLevel,
                 imageUrl: item.imageUrl,
             };
        });
        setInventory(inventoryWithCorrectTotals);
      } catch (error) {
        console.error("Failed to fetch inventory:", error);
        toast({
          title: t('inventory_toast_error_fetch_title'),
          description: t('inventory_toast_error_fetch_desc'),
          variant: "destructive",
        });
        setInventory([]);
      } finally {
        setIsLoading(false);
      }
    }, [toast, t, user]);

  useEffect(() => {
    if (authLoading) {
        return;
    }
    if (!user && !authLoading) {
        router.push('/login');
        return;
    }

    if (user && user.id) { // Ensure user.id is present before fetching
      fetchInventory();
    }


    if (initialFilter === 'low' && filterStockLevel === 'all') {
        setFilterStockLevel('low');
    }

    if (shouldRefresh) {
        const current = new URLSearchParams(Array.from(searchParams.entries()));
        current.delete('refresh');
        const searchString = current.toString();
        const query = searchString ? `?${searchString}` : "";
        router.replace(`${pathname}${query}`, { scroll: false });
    }
   }, [authLoading, user, fetchInventory, shouldRefresh, initialFilter, filterStockLevel, router, searchParams, pathname]);

  useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    if (typeof window !== 'undefined') {
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);


  const handleSort = (key: SortKey) => {
     if (!key) return;
     if (sortKey === key) {
       setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
     } else {
       setSortKey(key);
       setSortDirection('asc');
     }
     setCurrentPage(1);
   };


   const filteredAndSortedInventory = useMemo(() => {
     let result = [...inventory];

     if (searchTerm) {
       const lowerSearchTerm = searchTerm.toLowerCase();
       result = result.filter(item =>
         (item.description?.toLowerCase() || '').includes(lowerSearchTerm) ||
         (item.shortName?.toLowerCase() || '').includes(lowerSearchTerm) ||
         (item.catalogNumber?.toLowerCase() || '').includes(lowerSearchTerm) ||
         (item.barcode?.toLowerCase() || '').includes(lowerSearchTerm)
       );
     }
      if (filterStockLevel === 'low') {
        result = result.filter(item => (item.quantity || 0) > 0 && (item.quantity || 0) <= (item.minStockLevel ?? 10));
      } else if (filterStockLevel === 'inStock') {
        result = result.filter(item => (item.quantity || 0) > 0);
      } else if (filterStockLevel === 'out') {
        result = result.filter(item => (item.quantity || 0) === 0);
      } else if (filterStockLevel === 'over') {
        result = result.filter(item => item.maxStockLevel !== undefined && (item.quantity || 0) > item.maxStockLevel);
      }


      if (sortKey) {
        result.sort((a, b) => {
          let valA = a[sortKey as keyof Product];
          let valB = b[sortKey as keyof Product];

          if (sortKey === 'calculatedGrossProfit') { // This KPI seems to be removed or not yet implemented
            valA = (a.salePrice || 0) - (a.unitPrice || 0);
            valB = (b.salePrice || 0) - (b.unitPrice || 0);
          }

           let comparison = 0;
           if (typeof valA === 'number' && typeof valB === 'number') {
             comparison = valA - valB;
           } else if (typeof valA === 'string' && typeof valB === 'string') {
                comparison = valA.localeCompare(valB, locale);
           } else {
              if (valA == null && valB != null) comparison = -1;
              else if (valA != null && valB == null) comparison = 1;
              else comparison = 0;
           }

          return sortDirection === 'asc' ? comparison : comparison * -1;
        });
      }

     result = result.map(item => {
         const quantity = Number(item.quantity) || 0;
         const unitPrice = Number(item.unitPrice) || 0;
         return {
            ...item,
             quantity: quantity,
             unitPrice: unitPrice,
            lineTotal: parseFloat((quantity * unitPrice).toFixed(2))
         };
     });

     return result;
      }, [inventory, searchTerm, filterStockLevel, sortKey, sortDirection, locale]);

    const totalItems = filteredAndSortedInventory.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    const paginatedInventory = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        return filteredAndSortedInventory.slice(startIndex, endIndex);
    }, [filteredAndSortedInventory, currentPage]);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
        }
    };

    const toggleColumnVisibility = (key: keyof Product | 'actions' | 'imageUrl') => {
        setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const columnDefinitions: { key: keyof Product | 'actions' | 'imageUrl'; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean, headerClassName?: string, isNumeric?: boolean }[] = [
        { key: 'actions', labelKey: 'inventory_col_actions', sortable: false, className: 'text-center sticky left-0 bg-card z-10 px-2 sm:px-4 py-2', headerClassName: 'text-center sticky left-0 bg-card z-10' },
        { key: 'imageUrl', labelKey: 'inventory_col_image', sortable: false, className: 'w-12 text-center px-1 sm:px-2 py-1', headerClassName: 'text-center px-1 sm:px-2 py-1'},
        { key: 'shortName', labelKey: 'inventory_col_product', sortable: true, className: 'min-w-[100px] sm:min-w-[150px] px-2 sm:px-4 py-2', headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'description', labelKey: 'inventory_col_description', sortable: true, className: 'min-w-[150px] sm:min-w-[200px] hidden md:table-cell px-2 sm:px-4 py-2', headerClassName: 'text-center hidden md:table-cell px-2 sm:px-4 py-2' },
        { key: 'id', labelKey: 'inventory_col_id', sortable: true, mobileHidden: true, className: 'px-2 sm:px-4 py-2 hidden', headerClassName: 'text-center px-2 sm:px-4 py-2 hidden' },
        { key: 'catalogNumber', labelKey: 'inventory_col_catalog', sortable: true, className: 'min-w-[100px] sm:min-w-[120px] px-2 sm:px-4 py-2', headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'barcode', labelKey: 'inventory_col_barcode', sortable: true, className: 'min-w-[100px] sm:min-w-[120px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'quantity', labelKey: 'inventory_col_qty', sortable: true, className: 'text-center min-w-[60px] sm:min-w-[80px] px-2 sm:px-4 py-2', headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'unitPrice', labelKey: 'inventory_col_unit_price', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: false, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'salePrice', labelKey: 'inventory_col_sale_price', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: false, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'lineTotal', labelKey: 'inventory_col_total', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'minStockLevel', labelKey: 'inventory_col_min_stock', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'maxStockLevel', labelKey: 'inventory_col_max_stock', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
    ];

    const visibleColumnHeaders = columnDefinitions.filter(h => visibleColumns[h.key as keyof typeof visibleColumns]);


    const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) {
          return '';
        }
        if (typeof value === 'number') {
            return formatDisplayNumberWithTranslation(value, t, { decimals: 2, useGrouping: false });
        }
        let stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          stringValue = stringValue.replace(/"/g, '""');
          return `"${stringValue}"`;
        }
        return stringValue;
      };

    const handleExportInventory = () => {
        if (filteredAndSortedInventory.length === 0) {
            toast({ title: t('inventory_toast_no_data_export_title'), description: t('inventory_toast_no_data_export_desc') });
            return;
        }

        const exportColumns: (keyof Product)[] = [ // Removed 'id' as it's typically internal
            'catalogNumber', 'barcode', 'shortName', 'description', 'quantity', 'unitPrice', 'salePrice', 'lineTotal', 'minStockLevel', 'maxStockLevel', 'imageUrl'
        ];

        const headers = exportColumns
            .map(key => t(columnDefinitions.find(col => col.key === key)?.labelKey || key, { currency_symbol: t('currency_symbol') }))
            .map(escapeCsvValue)
            .join(',');

        const rows = filteredAndSortedInventory.map(item => {
            return exportColumns
                .map(key => escapeCsvValue(item[key as keyof Product]))
                .join(',');
        });

        const csvContent = [headers, ...rows].join('\n');
        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', 'inventory_export.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({ title: t('inventory_toast_export_started_title'), description: t('inventory_toast_export_started_desc') });
    };

    const handleDeleteAllInventory = async () => {
        if (!user || !user.id) return;
        setIsDeleting(true);
        try {
            await clearInventoryService(user.id); // Pass userId
            await fetchInventory();
            setCurrentPage(1);
            toast({
                title: t('inventory_toast_cleared_title'),
                description: t('inventory_toast_cleared_desc'),
            });
        } catch (error) {
            console.error("Failed to clear inventory:", error);
            toast({
                title: t('inventory_toast_clear_error_title'),
                description: t('inventory_toast_clear_error_desc'),
                variant: "destructive",
            });
        } finally {
            setIsDeleting(false);
        }
    };

     const handleQuantityChange = async (productId: string, change: number) => {
        if (!user || !user.id) return; // Ensure user and user.id are present
        setUpdatingQuantityProductId(productId);
        const productToUpdate = inventory.find(p => p.id === productId);
        if (!productToUpdate) return;

        const newQuantity = (productToUpdate.quantity || 0) + change;
        if (newQuantity < 0) {
            toast({ title: t('inventory_toast_invalid_quantity_title'), description: t('inventory_toast_invalid_quantity_desc_negative'), variant: "destructive" });
            setUpdatingQuantityProductId(null);
            return;
        }

        try {
            await updateProductService(productId, { quantity: newQuantity }, user.id); // Pass userId
            setInventory(prev =>
                prev.map(p =>
                    p.id === productId ? { ...p, quantity: newQuantity, lineTotal: newQuantity * (p.unitPrice || 0) } : p
                )
            );
        } catch (error) {
            console.error("Failed to update quantity:", error);
            toast({ title: t('inventory_toast_quantity_update_fail_title'), description: t('inventory_toast_quantity_update_fail_desc'), variant: "destructive" });
        } finally {
            setUpdatingQuantityProductId(null);
        }
    };

    const getStockLevelIndicator = (item: Product) => {
        const quantity = item.quantity || 0;
        const minStock = item.minStockLevel ?? 10; // Default min stock if not set
        const maxStock = item.maxStockLevel;

        if (quantity === 0) return "bg-red-500";
        if (maxStock !== undefined && quantity > maxStock) return "bg-orange-400";
        if (quantity <= minStock) return "bg-yellow-400";
        return "bg-green-500";
    };


   if (authLoading || (isLoading && !user)) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
       </div>
     );
   }

   if (!user && !authLoading) {
    return null; // Or a login prompt
   }

  return (
      <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
       <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
         <CardHeader>
           <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
             <Package className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('inventory_title')}
           </CardTitle>
           <CardDescription>{t('inventory_description')}</CardDescription>
         </CardHeader>
         <CardContent>
           <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6 flex-wrap">
             <div className="relative w-full md:max-w-xs lg:max-w-sm">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
               <Input
                 placeholder={t('inventory_search_placeholder')}
                 value={searchTerm}
                 onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                 className="pl-10"
                 aria-label={t('inventory_search_aria')}
               />
             </div>
             <div className="flex gap-2 flex-wrap justify-start md:justify-end">
               <DropdownMenu>
                 <DropdownMenuTrigger asChild>
                   <Button variant="outline" className="flex-1 md:flex-initial">
                     <Filter className="mr-2 h-4 w-4" />
                     {filterStockLevel === 'low' ? t('inventory_filter_low') :
                       filterStockLevel === 'inStock' ? t('inventory_filter_in_stock') :
                       filterStockLevel === 'out' ? t('inventory_filter_out_of_stock') :
                       filterStockLevel === 'over' ? t('inventory_filter_over_stock') :
                       t('inventory_filter_stock_label')}
                     <ChevronDown className="ml-auto md:ml-2 h-4 w-4" />
                   </Button>
                 </DropdownMenuTrigger>
                 <DropdownMenuContent align="end">
                   <DropdownMenuLabel>{t('inventory_filter_by_stock_level')}</DropdownMenuLabel>
                   <DropdownMenuSeparator />
                   <DropdownMenuCheckboxItem
                     checked={filterStockLevel === 'all'}
                     onCheckedChange={() => { setFilterStockLevel('all'); setCurrentPage(1); }}
                   >
                     {t('inventory_filter_all')}
                   </DropdownMenuCheckboxItem>
                   <DropdownMenuCheckboxItem
                     checked={filterStockLevel === 'inStock'}
                     onCheckedChange={() => { setFilterStockLevel('inStock'); setCurrentPage(1); }}
                   >
                     {t('inventory_filter_in_stock')}
                   </DropdownMenuCheckboxItem>
                   <DropdownMenuCheckboxItem
                     checked={filterStockLevel === 'low'}
                     onCheckedChange={() => { setFilterStockLevel('low'); setCurrentPage(1); }}
                   >
                     {t('inventory_filter_low')}
                   </DropdownMenuCheckboxItem>
                   <DropdownMenuCheckboxItem
                     checked={filterStockLevel === 'out'}
                     onCheckedChange={() => { setFilterStockLevel('out'); setCurrentPage(1); }}
                   >
                     {t('inventory_filter_out_of_stock')}
                   </DropdownMenuCheckboxItem>
                   <DropdownMenuCheckboxItem
                     checked={filterStockLevel === 'over'}
                     onCheckedChange={() => { setFilterStockLevel('over'); setCurrentPage(1); }}
                   >
                     {t('inventory_filter_over_stock')}
                   </DropdownMenuCheckboxItem>
                 </DropdownMenuContent>
               </DropdownMenu>

               <DropdownMenu>
                 <DropdownMenuTrigger asChild>
                   <Button variant="outline" className="flex-1 md:flex-initial">
                     <Eye className="mr-2 h-4 w-4" /> {t('inventory_view_button')}
                     <ChevronDown className="ml-auto md:ml-2 h-4 w-4" />
                   </Button>
                 </DropdownMenuTrigger>
                 <DropdownMenuContent align="end">
                   <DropdownMenuLabel>{t('inventory_toggle_columns_label')}</DropdownMenuLabel>
                   <DropdownMenuSeparator />
                   {columnDefinitions.filter(h => h.key !== 'actions' && h.key !== 'id').map((header) => (
                     <DropdownMenuCheckboxItem
                       key={header.key}
                       className="capitalize"
                       checked={visibleColumns[header.key as keyof typeof visibleColumns]}
                       onCheckedChange={() => toggleColumnVisibility(header.key as keyof typeof visibleColumns)}
                     >
                       {t(header.labelKey, { currency_symbol: t('currency_symbol') })}
                     </DropdownMenuCheckboxItem>
                   ))}
                 </DropdownMenuContent>
               </DropdownMenu>
               {isMobileView && (
                  <Button
                    variant="outline"
                    onClick={() => setMobileViewMode(prev => prev === 'cards' ? 'table' : 'cards')}
                    className="flex-1 md:flex-initial"
                    aria-label={t('inventory_toggle_view_mode_aria')}
                    >
                    {mobileViewMode === 'cards' ? <ListChecks className="mr-2 h-4 w-4" /> : <Grid className="mr-2 h-4 w-4" />}
                    {mobileViewMode === 'cards' ? t('inventory_view_mode_table') : t('inventory_view_mode_cards')}
                </Button>
               )}
             </div>
           </div>

           <Card className="mb-6">
             <CardHeader>
                 <CardTitle className="text-lg font-semibold text-primary">{t('inventory_total_value_title')}</CardTitle>
             </CardHeader>
             <CardContent>
                 <p className="text-2xl font-bold">
                     {formatDisplayNumberWithTranslation(inventoryValue, t, { currency: true })}
                 </p>
             </CardContent>
           </Card>

           <Card>
             <CardHeader>
                 <CardTitle className="text-lg font-semibold text-primary">{t('inventory_stock_alerts_title')}</CardTitle>
                  <CardDescription>{t('inventory_stock_alerts_desc')}</CardDescription>
             </CardHeader>
             <CardContent>
                 {isLoading ? (
                     <div className="flex justify-center items-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                 ) : (
                     stockAlerts.length === 0 ? (
                         <p className="text-muted-foreground text-center py-4">{t('inventory_no_stock_alerts')}</p>
                     ) : (
                         <div className="space-y-2">
                             {stockAlerts
                               .sort((a,b) => (a.quantity || 0) - (b.quantity || 0) || (a.shortName || a.description || '').localeCompare(b.shortName || b.description || '') )
                               .map(item => (
                                 <div key={item.id} className={cn("p-2 border rounded-md flex justify-between items-center text-sm",
                                     (item.quantity || 0) === 0 ? "bg-destructive/10 border-destructive/30" :
                                     (item.maxStockLevel !== undefined && (item.quantity || 0) > item.maxStockLevel) ? "bg-orange-400/10 border-orange-400/30" :
                                     "bg-yellow-400/10 border-yellow-400/30"
                                 )}>
                                     <div>
                                         <span className="font-medium">{item.shortName || item.description}</span>
                                         <span className="text-xs text-muted-foreground"> ({t('inventory_col_catalog')}: {item.catalogNumber || t('invoices_na')})</span>
                                     </div>
                                     <Badge variant={
                                         (item.quantity || 0) === 0 ? "destructive" :
                                         (item.maxStockLevel !== undefined && (item.quantity || 0) > item.maxStockLevel) ? "default" :
                                         "secondary"
                                     } className={cn(
                                         (item.maxStockLevel !== undefined && (item.quantity || 0) > item.maxStockLevel) && "bg-orange-500 text-white dark:bg-orange-600 dark:text-white"
                                     )}>
                                         {(item.quantity || 0) === 0 ? t('inventory_badge_out_of_stock') :
                                          (item.maxStockLevel !== undefined && (item.quantity || 0) > item.maxStockLevel) ? `${t('inventory_badge_over_stock')} (${formatIntegerQuantityWithTranslation(item.quantity, t)})` :
                                          `${t('inventory_badge_low_stock')} (${formatIntegerQuantityWithTranslation(item.quantity, t)})`}
                                     </Badge>
                                 </div>
                             ))}
                         </div>
                     )
                 )}
             </CardContent>
           </Card>

           {(isMobileView && mobileViewMode === 'cards') ? (
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
               {isLoading ? (
                 Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (
                   <Card key={index} className="animate-pulse">
                     <CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader>
                     <CardContent className="space-y-2">
                       <Skeleton className="h-4 w-1/2" />
                       <Skeleton className="h-4 w-1/4" />
                       <div className="flex justify-center mt-2"><Skeleton className="h-8 w-20" /></div>
                     </CardContent>
                   </Card>
                 ))
               ) : paginatedInventory.length === 0 ? (
                 <div className="col-span-full text-center py-10 text-muted-foreground">
                   <Package className="mx-auto h-12 w-12 mb-2 opacity-50" />
                   <p>{t('inventory_no_items_found')}</p>
                   <p className="text-xs">{t('inventory_try_adjusting_filters_or_upload')}</p>
                 </div>
               ) : (
                 paginatedInventory.map((item) => (
                   <Card key={item.id || item.catalogNumber} className="hover:shadow-lg transition-shadow flex flex-col">
                     <CardHeader className="pb-2">
                         <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2">
                               <span className={cn("w-3 h-3 rounded-full flex-shrink-0", getStockLevelIndicator(item))}></span>
                               <CardTitle className="text-base font-semibold truncate" title={item.shortName || item.description}>
                                   {item.shortName || item.description?.split(' ').slice(0,3).join(' ') || t('invoices_na')}
                               </CardTitle>
                            </div>
                              <Button
                                 variant="ghost"
                                 size="icon"
                                 onClick={() => item.id && router.push(`/inventory/${item.id}`)}
                                 disabled={!item.id}
                                 aria-label={t('inventory_view_details_aria', { productName: item.shortName || item.description || '' })}
                                 className="h-7 w-7 text-primary hover:text-primary/80 flex-shrink-0"
                             >
                                 <Eye className="h-4 w-4" />
                             </Button>
                         </div>
                         {item.imageUrl && visibleColumns.imageUrl ? (
                             <div className="mt-2 relative h-24 w-full rounded overflow-hidden border" data-ai-hint="product photo">
                                 <NextImage src={item.imageUrl} alt={item.shortName || item.description || ''} layout="fill" objectFit="cover" />
                             </div>
                         ) : visibleColumns.imageUrl ? (
                             <div className="mt-2 h-24 w-full rounded bg-muted flex items-center justify-center border">
                                 <ImageIconLucide className="h-8 w-8 text-muted-foreground" />
                             </div>
                         ) : null}
                     </CardHeader>
                     <CardContent className="text-xs space-y-1 pt-1 flex-grow">
                         {visibleColumns.catalogNumber && <p><strong>{t('inventory_col_catalog')}:</strong> {item.catalogNumber || t('invoices_na')}</p>}
                         <div className="flex items-center gap-2">
                            <p className="flex items-center">
                                <strong>{t('inventory_col_qty')}:</strong>
                                <Button variant="outline" size="icon" className="h-6 w-6 mx-1" onClick={() => item.id && handleQuantityChange(item.id, -1)} disabled={updatingQuantityProductId === item.id}>
                                    <Minus className="h-3 w-3" />
                                </Button>
                                <span>{formatIntegerQuantityWithTranslation(item.quantity, t)}</span>
                                <Button variant="outline" size="icon" className="h-6 w-6 mx-1" onClick={() => item.id && handleQuantityChange(item.id, 1)} disabled={updatingQuantityProductId === item.id}>
                                    <Plus className="h-3 w-3" />
                                </Button>
                            </p>
                         </div>
                         {item.quantity === 0 && <Badge variant="destructive" className="mt-1 text-[9px] px-1 py-0">{t('inventory_badge_out_of_stock')}</Badge>}
                         {item.quantity > 0 && item.minStockLevel !== undefined && item.quantity <= item.minStockLevel && <Badge variant="secondary" className="mt-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-[9px] px-1 py-0">{t('inventory_badge_low_stock')}</Badge>}
                         {item.maxStockLevel !== undefined && item.quantity > item.maxStockLevel && <Badge variant="default" className="mt-1 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-[9px] px-1 py-0">{t('inventory_badge_over_stock')}</Badge>}

                         {visibleColumns.salePrice && <p><strong>{t('inventory_col_sale_price', { currency_symbol: t('currency_symbol')})}:</strong> {item.salePrice !== undefined ? formatDisplayNumberWithTranslation(item.salePrice, t, { currency: true }) : '-'}</p>}
                         {visibleColumns.unitPrice && <p><strong>{t('inventory_col_unit_price', { currency_symbol: t('currency_symbol')})}:</strong> {item.unitPrice !== undefined ? formatDisplayNumberWithTranslation(item.unitPrice, t, { currency: true }) : '-'}</p>}

                     </CardContent>
                   </Card>
                 ))
               )}
             </div>
           ) : (
             <div className="overflow-x-auto relative mt-6">
               <Table>
                 <TableHeader>
                   <TableRow>
                     {visibleColumnHeaders.map((header) => (
                       <TableHead
                         key={header.key}
                         className={cn(
                           "text-center px-2 sm:px-4 py-2",
                           header.headerClassName,
                           header.sortable && "cursor-pointer hover:bg-muted/50",
                           header.mobileHidden ? 'hidden sm:table-cell' : 'table-cell'
                         )}
                         onClick={() => header.sortable && handleSort(header.key as SortKey)}
                         aria-sort={header.sortable ? (sortKey === header.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                       >
                         <div className="flex items-center justify-center gap-1">
                           {t(header.labelKey, { currency_symbol: t('currency_symbol')})}
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
                      <TableRow><TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center"><div className="flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /><span className="ml-2">{t('inventory_loading_inventory')}</span></div></TableCell></TableRow>
                   ) : paginatedInventory.length === 0 ? (
                     <TableRow>
                       <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center">
                         <p>{t('inventory_no_items_found')}</p>
                         <p className="text-xs text-muted-foreground">{t('inventory_try_adjusting_filters_or_upload')}</p>
                       </TableCell>
                     </TableRow>
                   ) : (
                     paginatedInventory.map((item) => (
                       <TableRow key={item.id || item.catalogNumber} className="hover:bg-muted/50" data-testid={`inventory-item-${item.id}`}>
                         {visibleColumns.actions && (
                           <TableCell className={cn('text-center sticky left-0 bg-card z-10 px-2 sm:px-4 py-2')}>
                              <Button
                                 variant="ghost"
                                 size="icon"
                                 onClick={() => item.id && router.push(`/inventory/${item.id}`)}
                                 disabled={!item.id}
                                 aria-label={t('inventory_view_details_aria', { productName: item.shortName || item.description || '' })}
                                 className="h-8 w-8 text-primary hover:text-primary/80"
                               >
                                 <Eye className="h-4 w-4" />
                               </Button>
                           </TableCell>
                         )}
                         {visibleColumns.imageUrl && (
                             <TableCell className={cn('text-center px-1 sm:px-2 py-1', columnDefinitions.find(h => h.key === 'imageUrl')?.className)}>
                                 {item.imageUrl ? (
                                     <div className="relative h-10 w-10 mx-auto rounded overflow-hidden border" data-ai-hint="product photo">
                                         <NextImage src={item.imageUrl} alt={item.shortName || item.description || ''} layout="fill" objectFit="cover" />
                                     </div>
                                 ) : (
                                     <div className="h-10 w-10 mx-auto rounded bg-muted flex items-center justify-center border">
                                         <ImageIconLucide className="h-5 w-5 text-muted-foreground" />
                                     </div>
                                 )}
                             </TableCell>
                         )}
                         {visibleColumns.shortName && (
                           <TableCell className="font-medium px-2 sm:px-4 py-2 truncate max-w-[100px] sm:max-w-[150px]">
                             <Popover>
                               <PopoverTrigger asChild>
                                 <Button variant="link" className="p-0 h-auto text-left font-medium cursor-pointer hover:underline decoration-dashed decoration-muted-foreground/50 underline-offset-2 text-foreground">
                                   {item.shortName || item.description?.split(' ').slice(0,3).join(' ') || t('invoices_na')}
                                 </Button>
                               </PopoverTrigger>
                               <PopoverContent side="top" align="start" className="w-auto max-w-[300px] break-words p-3 text-sm shadow-lg space-y-1">
                                 {item.description && (
                                   <>
                                     <p className="font-semibold">{t('inventory_popover_description')}:</p>
                                     <p>{item.description}</p>
                                   </>
                                 )}
                                 {item.catalogNumber && item.catalogNumber !== "N/A" && (
                                   <>
                                     <p className="font-semibold mt-2">{t('inventory_popover_catalog')}:</p>
                                     <p>{item.catalogNumber}</p>
                                   </>
                                 )}
                                 {item.barcode && (
                                   <>
                                     <p className="font-semibold mt-2">{t('inventory_popover_barcode')}:</p>
                                     <p>{item.barcode}</p>
                                   </>
                                 )}
                                  <>
                                   <p className="font-semibold mt-2">{t('inventory_col_unit_price', { currency_symbol: t('currency_symbol')})}:</p>
                                   <p>{formatDisplayNumberWithTranslation(item.unitPrice, t, { currency: true })}</p>
                                  </>
                               </PopoverContent>
                             </Popover>
                           </TableCell>
                         )}
                         {visibleColumns.description && <TableCell className={cn('font-medium px-2 sm:px-4 py-2 truncate max-w-[150px] sm:max-w-none', columnDefinitions.find(h => h.key === 'description')?.mobileHidden && 'hidden sm:table-cell')}>{item.description || t('invoices_na')}</TableCell>}
                         {visibleColumns.catalogNumber && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'catalogNumber')?.mobileHidden && 'hidden sm:table-cell')}>{item.catalogNumber || t('invoices_na')}</TableCell>}
                         {visibleColumns.barcode && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'barcode')?.mobileHidden && 'hidden sm:table-cell')}>{item.barcode || t('invoices_na')}</TableCell>}
                         {visibleColumns.quantity && (
                           <TableCell className={cn("text-center px-2 sm:px-4 py-2", columnDefinitions.find(h => h.key === 'quantity')?.className)}>
                             <div className="flex items-center justify-center gap-1 sm:gap-2">
                                <Button variant="outline" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" onClick={() => item.id && handleQuantityChange(item.id, -1)} disabled={updatingQuantityProductId === item.id}>
                                    <Minus className="h-3 w-3 sm:h-4 sm:w-4" />
                                </Button>
                                <span className="min-w-[20px] sm:min-w-[30px] text-center">{formatIntegerQuantityWithTranslation(item.quantity, t)}</span>
                                <Button variant="outline" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" onClick={() => item.id && handleQuantityChange(item.id, 1)} disabled={updatingQuantityProductId === item.id}>
                                    <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
                                </Button>
                                <span className={cn("w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ml-1 sm:ml-2 flex-shrink-0", getStockLevelIndicator(item))}></span>
                             </div>
                           </TableCell>
                         )}
                         {visibleColumns.unitPrice && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'unitPrice')?.mobileHidden && 'hidden sm:table-cell')}>{formatDisplayNumberWithTranslation(item.unitPrice, t, { currency: true })}</TableCell>}
                         {visibleColumns.salePrice && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'salePrice')?.mobileHidden && 'hidden sm:table-cell')}>{item.salePrice !== undefined ? formatDisplayNumberWithTranslation(item.salePrice, t, { currency: true }) : '-'}</TableCell>}
                         {visibleColumns.lineTotal && <TableCell className={cn("text-center px-2 sm:px-4 py-2", columnDefinitions.find(h=>h.key === 'lineTotal')?.mobileHidden && 'hidden sm:table-cell')}>{formatDisplayNumberWithTranslation(item.lineTotal, t, { currency: true })}</TableCell>}
                         {visibleColumns.minStockLevel && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'minStockLevel')?.mobileHidden && 'hidden sm:table-cell')}>{item.minStockLevel !== undefined ? formatIntegerQuantityWithTranslation(item.minStockLevel, t) : '-'}</TableCell>}
                         {visibleColumns.maxStockLevel && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'maxStockLevel')?.mobileHidden && 'hidden sm:table-cell')}>{item.maxStockLevel !== undefined ? formatIntegerQuantityWithTranslation(item.maxStockLevel, t) : '-'}</TableCell>}
                       </TableRow>
                     ))
                   )}
                 </TableBody>
               </Table>
             </div>
           )}
         </CardContent>
         <CardFooter className="flex flex-col sm:flex-row justify-between items-center gap-2 p-4 border-t">
          {totalPages > 1 && (
             <div className="flex items-center justify-center sm:justify-start space-x-2 py-2 w-full sm:w-auto">
               <span className="text-sm text-muted-foreground hidden sm:block">
                 {t('inventory_pagination_page_info', { currentPage: currentPage, totalPages: totalPages, totalItems: totalItems })}
               </span>
               <div className="flex space-x-1">
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={() => handlePageChange(currentPage - 1)}
                   disabled={currentPage === 1}
                   className="h-8 px-2"
                 >
                   <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">{t('inventory_pagination_previous')}</span>
                 </Button>
                 <span className="text-sm text-muted-foreground sm:hidden px-2 flex items-center">
                   {currentPage}/{totalPages}
                 </span>
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={() => handlePageChange(currentPage + 1)}
                   disabled={currentPage === totalPages}
                   className="h-8 px-2"
                 >
                   <span className="hidden sm:inline">{t('inventory_pagination_next')}</span> <ChevronRight className="h-4 w-4" />
                 </Button>
               </div>
             </div>
           )}
           <div className="flex flex-col sm:flex-row justify-end gap-2 w-full sm:w-auto mt-2 sm:mt-0">
               <Button variant="outline" onClick={handleExportInventory} className="w-full sm:w-auto">
                 <Download className="mr-2 h-4 w-4" /> {t('inventory_export_csv_button')}
               </Button>
               <AlertDialog>
                 <AlertDialogTrigger asChild>
                   <Button variant="destructive" disabled={isDeleting} className="w-full sm:w-auto">
                     {isDeleting ? (
                       <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                     ) : (
                       <Trash2 className="mr-2 h-4 w-4" />
                     )}
                     {t('inventory_delete_all_button')}
                   </Button>
                 </AlertDialogTrigger>
                 <AlertDialogContent>
                   <AlertDialogHeader>
                     <AlertDialogTitle>{t('inventory_delete_all_confirm_title')}</AlertDialogTitle>
                     <AlertDialogDescription>
                       {t('inventory_delete_all_confirm_desc')}
                     </AlertDialogDescription>
                   </AlertDialogHeader>
                   <AlertDialogFooter>
                     <AlertDialogCancel disabled={isDeleting}>{t('cancel_button')}</AlertDialogCancel>
                     <AlertDialogAction onClick={handleDeleteAllInventory} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>
                       {isDeleting ? (
                         <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                       ) : null}
                       {t('inventory_delete_all_confirm_action')}
                     </AlertDialogAction>
                   </AlertDialogFooter>
                 </AlertDialogContent>
               </AlertDialog>
           </div>
         </CardFooter>
       </Card>
     </div>
   );
}
