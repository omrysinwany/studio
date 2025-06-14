// /src/app/inventory/page.tsx
"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
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
  ChevronDown,
  Loader2,
  Eye,
  Package,
  AlertTriangle,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ImageIcon as ImageIconLucide,
  ListChecks,
  Grid,
  DollarSign,
  Phone,
  Mail,
  Info,
  Settings as SettingsIcon,
  Minus,
  Plus,
  RefreshCw,
  PowerOff,
  Power,
} from "lucide-react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  getProductsService,
  clearInventoryService,
  updateProductService,
  reactivateProductService,
  deleteProductService,
} from "@/services/backend";
import { Badge } from "@/components/ui/badge";
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
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/contexts/AuthContext";
import NextImage from "next/image";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { Separator } from "@/components/ui/separator";
import {
  calculateInventoryValue,
  getLowStockItems,
} from "@/lib/kpi-calculations";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Product } from "@/services/types";

const ITEMS_PER_PAGE = 10;

type SortKey = keyof Product | "calculatedGrossProfit" | "";
type SortDirection = "asc" | "desc";

const formatDisplayNumberWithTranslation = (
  value: number | undefined | null,
  t: (key: string, params?: Record<string, string | number>) => string,
  options?: { decimals?: number; useGrouping?: boolean; currency?: boolean }
): string => {
  const { decimals = 0, useGrouping = true, currency = false } = options || {};
  const shekelSymbol = t("currency_symbol");

  if (value === null || value === undefined || isNaN(value)) {
    const zeroFormatted = (0).toLocaleString(
      t("locale_code_for_number_formatting") || undefined,
      {
        minimumFractionDigits: currency ? 0 : decimals,
        maximumFractionDigits: currency ? 0 : decimals,
        useGrouping: useGrouping,
      }
    );
    return currency ? `${shekelSymbol}${zeroFormatted}` : zeroFormatted;
  }

  const formattedValue = value.toLocaleString(
    t("locale_code_for_number_formatting") || undefined,
    {
      minimumFractionDigits: currency ? 0 : decimals,
      maximumFractionDigits: currency ? 0 : decimals,
      useGrouping: useGrouping,
    }
  );
  return currency ? `${shekelSymbol}${formattedValue}` : formattedValue;
};

const formatIntegerQuantityWithTranslation = (
  value: number | undefined | null,
  t: (key: string) => string
): string => {
  if (value === null || value === undefined || isNaN(value)) {
    return (0).toLocaleString(
      t("locale_code_for_number_formatting") || undefined,
      { useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: 0 }
    );
  }
  return Math.round(value).toLocaleString(
    t("locale_code_for_number_formatting") || undefined,
    { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 0 }
  );
};

export default function InventoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParamsHook = useSearchParams();
  const { toast } = useToast();
  const { t, locale } = useTranslation();
  const isMobileView = useIsMobile();

  const [inventory, setInventory] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const defaultVisibleColumns: Record<
    | keyof Product
    | "actions"
    | "imageUrl"
    | "name"
    | "supplier"
    | "category"
    | "lastPurchasedAt",
    boolean
  > = useMemo(
    () => ({
      actions: true,
      imageUrl: false,
      id: false,
      shortName: true,
      description: false,
      catalogNumber: false,
      barcode: false,
      quantity: true,
      unitPrice: false,
      salePrice: true,
      lineTotal: false,
      minStockLevel: false,
      maxStockLevel: false,
      lastUpdated: false,
      userId: false,
      _originalId: false,
      isActive: false,
      caspitProductId: false,
      dateCreated: false,
      name: false,
      supplier: false,
      category: false,
      lastPurchasedAt: false,
    }),
    []
  );

  const [visibleColumns, setVisibleColumns] = useState(defaultVisibleColumns);
  const [filterStockLevel, setFilterStockLevel] = useState<
    "all" | "low" | "inStock" | "out" | "over"
  >("all");
  const [sortKey, setSortKey] = useState<SortKey>("shortName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [showInactive, setShowInactive] = useState(false);

  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  const [showAdvancedInventoryFilters, setShowAdvancedInventoryFilters] =
    useState(false);
  const [isUpdatingQuantity, setIsUpdatingQuantity] = useState<
    Record<string, boolean>
  >({});
  const [isReactivating, setIsReactivating] = useState<Record<string, boolean>>(
    {}
  );

  const fetchInventory = useCallback(
    async (options: { includeInactive?: boolean } = {}) => {
      if (!user || !user.id) {
        setIsLoading(false);
        setInventory([]);
        return;
      }
      setIsLoading(true);
      try {
        const data = await getProductsService(user.id, {
          includeInactive: options.includeInactive,
        });
        const inventoryWithCorrectTotals = data.map((item) => {
          const quantity = Number(item.quantity) || 0;
          const unitPrice = Number(item.unitPrice) || 0;
          return {
            ...item,
            quantity: quantity,
            unitPrice: unitPrice,
            salePrice:
              item.salePrice === undefined ? null : item.salePrice ?? null,
            lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
          };
        });
        setInventory(inventoryWithCorrectTotals);
      } catch (error) {
        console.error("Failed to fetch inventory:", error);
        toast({
          title: t("inventory_toast_error_fetch_title"),
          description: `${t("inventory_toast_error_fetch_desc")} (${
            (error as Error).message
          })`,
          variant: "destructive",
        });
        setInventory([]);
      } finally {
        setIsLoading(false);
      }
    },
    [toast, t, user]
  );

  useEffect(() => {
    const initialFilter = searchParamsHook.get("filter") as
      | "all"
      | "low"
      | "inStock"
      | "out"
      | "over"
      | null;
    const shouldRefresh = searchParamsHook.get("refresh");
    const urlViewMode = searchParamsHook.get("mobileView") as
      | "cards"
      | "table"
      | null;

    if (user && user.id) {
      fetchInventory({ includeInactive: showInactive });
    } else if (!user && !authLoading) {
      router.push("/login");
    }

    if (urlViewMode && (urlViewMode === "cards" || urlViewMode === "table")) {
      setViewMode(urlViewMode);
    } else {
      setViewMode("table");
    }

    if (
      initialFilter &&
      ["all", "low", "inStock", "out", "over"].includes(initialFilter)
    ) {
      setFilterStockLevel(initialFilter);
    }

    if (shouldRefresh === "true") {
      const current = new URLSearchParams(
        Array.from(searchParamsHook.entries())
      );
      current.delete("refresh");
      current.delete("mobileView");
      const search = current.toString();
      const query = search ? `?${search}` : "";
      router.replace(`${pathname}${query}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router, searchParamsHook, pathname, showInactive]);

  const handleSort = (key: SortKey) => {
    if (!key) return;
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const inventoryValue = useMemo(
    () => calculateInventoryValue(inventory),
    [inventory]
  );
  const stockAlerts = useMemo(() => getLowStockItems(inventory), [inventory]);
  const stockAlertsCount = stockAlerts.length;

  const filteredAndSortedInventory = useMemo(() => {
    let result = [...inventory];

    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(
        (item) =>
          (item.description?.toLowerCase() || "").includes(lowerSearchTerm) ||
          (item.shortName?.toLowerCase() || "").includes(lowerSearchTerm) ||
          (item.catalogNumber?.toLowerCase() || "").includes(lowerSearchTerm) ||
          (item.barcode?.toLowerCase() || "").includes(lowerSearchTerm)
      );
    }
    if (filterStockLevel === "low") {
      result = result.filter(
        (item) =>
          (Number(item.quantity) || 0) > 0 &&
          item.minStockLevel !== undefined &&
          item.minStockLevel !== null &&
          (Number(item.quantity) || 0) <= item.minStockLevel
      );
    } else if (filterStockLevel === "inStock") {
      result = result.filter((item) => (Number(item.quantity) || 0) > 0);
    } else if (filterStockLevel === "out") {
      result = result.filter((item) => (Number(item.quantity) || 0) === 0);
    } else if (filterStockLevel === "over") {
      result = result.filter(
        (item) =>
          item.maxStockLevel !== undefined &&
          item.maxStockLevel !== null &&
          (Number(item.quantity) || 0) > item.maxStockLevel
      );
    }

    if (sortKey) {
      result.sort((a, b) => {
        let valA = a[sortKey as keyof Product];
        let valB = b[sortKey as keyof Product];

        if (sortKey === "calculatedGrossProfit") {
          valA = (Number(a.salePrice) || 0) - (Number(a.unitPrice) || 0);
          valB = (Number(b.salePrice) || 0) - (Number(b.unitPrice) || 0);
        }

        let comparison = 0;
        if (typeof valA === "number" && typeof valB === "number") {
          comparison = valA - valB;
        } else if (typeof valA === "string" && typeof valB === "string") {
          const collator = new Intl.Collator(
            locale === "he" ? "he-IL-u-co-standard" : "en-US",
            { sensitivity: "base" }
          );
          comparison = collator.compare(valA || "", valB || "");
        } else {
          if (valA == null && valB != null) comparison = -1;
          else if (valA != null && valB == null) comparison = 1;
          else comparison = 0;
        }

        return sortDirection === "asc" ? comparison : comparison * -1;
      });
    }

    result = result.map((item) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      return {
        ...item,
        quantity: quantity,
        unitPrice: unitPrice,
        salePrice: item.salePrice === undefined ? null : item.salePrice ?? null,
        lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
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

  const toggleColumnVisibility = (
    key: keyof Product | "actions" | "imageUrl"
  ) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const columnDefinitions: {
    key: keyof Product | "actions" | "imageUrl";
    labelKey: string;
    sortable: boolean;
    className?: string;
    mobileHidden?: boolean;
    headerClassName?: string;
    isNumeric?: boolean;
  }[] = useMemo(
    () => [
      {
        key: "actions",
        labelKey: "inventory_col_actions",
        sortable: false,
        className: "text-center sticky left-0 bg-card z-10 px-2 sm:px-4 py-2",
        headerClassName:
          "text-center px-2 sm:px-4 py-2 sticky left-0 bg-card z-10",
      },
      {
        key: "imageUrl",
        labelKey: "inventory_col_image",
        sortable: false,
        className: "w-12 text-center px-1 sm:px-2 py-1",
        headerClassName: "text-center px-1 sm:px-2 py-1",
      },
      {
        key: "shortName",
        labelKey: "inventory_col_product",
        sortable: true,
        className:
          "min-w-[100px] sm:min-w-[150px] px-2 sm:px-4 py-2 text-center",
        headerClassName: "text-center px-2 sm:px-4 py-2",
      },
      {
        key: "description",
        labelKey: "inventory_col_description",
        sortable: true,
        className:
          "min-w-[150px] sm:min-w-[200px] px-2 sm:px-4 py-2 text-center",
        mobileHidden: true,
        headerClassName: "text-center px-2 sm:px-4 py-2",
      },
      {
        key: "catalogNumber",
        labelKey: "inventory_col_catalog",
        sortable: true,
        className:
          "min-w-[100px] sm:min-w-[120px] px-2 sm:px-4 py-2 text-center",
        mobileHidden: true,
        headerClassName: "text-center px-2 sm:px-4 py-2",
      },
      {
        key: "barcode",
        labelKey: "inventory_col_barcode",
        sortable: true,
        className:
          "min-w-[100px] sm:min-w-[120px] px-2 sm:px-4 py-2 text-center",
        mobileHidden: true,
        headerClassName: "text-center px-2 sm:px-4 py-2",
      },
      {
        key: "quantity",
        labelKey: "inventory_col_qty",
        sortable: true,
        className: "text-center min-w-[60px] sm:min-w-[80px] px-2 sm:px-4 py-2",
        headerClassName: "text-center px-2 sm:px-4 py-2",
        isNumeric: true,
      },
      {
        key: "unitPrice",
        labelKey: "inventory_col_unit_price",
        sortable: true,
        className:
          "text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2",
        mobileHidden: true,
        headerClassName: "text-center px-2 sm:px-4 py-2",
        isNumeric: true,
      },
      {
        key: "salePrice",
        labelKey: "inventory_col_sale_price",
        sortable: true,
        className:
          "text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2",
        mobileHidden: false,
        headerClassName: "text-center px-2 sm:px-4 py-2",
        isNumeric: true,
      },
      {
        key: "lineTotal",
        labelKey: "inventory_col_total",
        sortable: false,
        className:
          "text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2",
        mobileHidden: true,
        headerClassName: "text-center px-2 sm:px-4 py-2",
        isNumeric: true,
      },
    ],
    [locale]
  );

  const visibleColumnHeaders = columnDefinitions.filter(
    (h) => visibleColumns[h.key as keyof typeof visibleColumns]
  );

  const escapeCsvValue = (value: any): string => {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "number") {
      return formatDisplayNumberWithTranslation(value, t, {
        decimals: 2,
        useGrouping: false,
      });
    }
    let stringValue = String(value);
    if (
      stringValue.includes(",") ||
      stringValue.includes('"') ||
      stringValue.includes("\n")
    ) {
      stringValue = stringValue.replace(/"/g, '""');
      return `"${stringValue}"`;
    }
    return stringValue;
  };

  const handleExportInventory = () => {
    if (filteredAndSortedInventory.length === 0) {
      toast({
        title: t("inventory_toast_no_data_export_title"),
        description: t("inventory_toast_no_data_export_desc"),
      });
      return;
    }

    const exportColumns: (keyof Product)[] = [
      "catalogNumber",
      "barcode",
      "shortName",
      "description",
      "quantity",
      "unitPrice",
      "salePrice",
      "lineTotal",
      "minStockLevel",
      "maxStockLevel",
      "imageUrl",
    ];

    const headers = exportColumns
      .map((key) =>
        t(columnDefinitions.find((col) => col.key === key)?.labelKey || key, {
          currency_symbol: t("currency_symbol"),
        })
      )
      .map(escapeCsvValue)
      .join(",");

    const rows = filteredAndSortedInventory.map((item) => {
      return exportColumns
        .map((key) => escapeCsvValue(item[key as keyof Product]))
        .join(",");
    });

    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([`\uFEFF${csvContent}`], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute("download", "inventory_export.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: t("inventory_toast_export_started_title"),
      description: t("inventory_toast_export_started_desc"),
    });
  };

  const handleDeleteAllInventory = async () => {
    if (!user || !user.id) return;
    setIsDeleting(true);
    try {
      await clearInventoryService(user.id);
      await fetchInventory({ includeInactive: showInactive });
      setCurrentPage(1);
      toast({
        title: t("inventory_toast_cleared_title"),
        description: t("inventory_toast_cleared_desc"),
      });
    } catch (error) {
      console.error("Failed to clear inventory:", error);
      toast({
        title: t("inventory_toast_clear_error_title"),
        description: t("inventory_toast_clear_error_desc"),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const getStockLevelIndicator = (item: Product) => {
    const quantity = Number(item.quantity) || 0;
    const minStock = item.minStockLevel;
    const maxStock = item.maxStockLevel;

    if (quantity === 0) return "bg-red-500 dark:bg-red-700";
    if (maxStock !== undefined && maxStock !== null && quantity > maxStock)
      return "bg-orange-400 dark:bg-orange-600";
    if (minStock !== undefined && minStock !== null && quantity <= minStock)
      return "bg-yellow-400 dark:bg-yellow-600";
    return "bg-green-500 dark:bg-green-700";
  };

  const handleReactivateProduct = async (productId: string) => {
    if (!user || !user.id) return;
    setIsReactivating((prev) => ({ ...prev, [productId]: true }));
    try {
      await reactivateProductService(productId, user.id);
      toast({
        title: t("inventory_toast_reactivated_title"),
        description: t("inventory_toast_reactivated_desc"),
      });
      fetchInventory({ includeInactive: showInactive });
    } catch (error) {
      console.error("Failed to reactivate product:", error);
      toast({
        title: t("inventory_toast_reactivate_error_title"),
        description: `${t("inventory_toast_reactivate_error_desc")} (${
          (error as Error).message
        })`,
        variant: "destructive",
      });
    } finally {
      setIsReactivating((prev) => ({ ...prev, [productId]: false }));
    }
  };

  const handleToggleShowInactive = (checked: boolean) => {
    setShowInactive(checked);
    // fetchInventory will be called automatically by useEffect due to showInactive dependency
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!user || !user.id) return;
    // Assuming you want a loading state for delete as well, similar to reactivate
    // setIsDeletingProduct(prev => ({ ...prev, [productId]: true }));
    // You might need to add a new state like isDeletingProduct if you want per-item delete loading
    try {
      await deleteProductService(productId, user.id); // This now deactivates
      toast({
        title: t("inventory_toast_deactivated_title"), // New translation
        description: t("inventory_toast_deactivated_desc"), // New translation
      });
      fetchInventory({ includeInactive: showInactive }); // Refresh list
    } catch (error) {
      console.error("Failed to deactivate product:", error);
      toast({
        title: t("inventory_toast_deactivate_error_title"), // New translation
        description: `${t("inventory_toast_deactivate_error_desc")} (${
          (error as Error).message
        })`, // New translation
        variant: "destructive",
      });
    } finally {
      // setIsDeletingProduct(prev => ({ ...prev, [productId]: false }));
    }
  };

  if (authLoading || (!user && !isLoading)) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t("loading_data")}</p>
      </div>
    );
  }
  if (!user && !authLoading) return null;

  return (
    <div className="container mx-auto p-2 sm:p-4 md:p-6 space-y-4">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 p-4">
          <div className="flex-1 min-w-0">
            {" "}
            {/* Added for title/desc wrapper */}
            <div className="flex justify-between items-center mb-1">
              {" "}
              {/* Title and Icons row */}
              <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <Package className="mr-2 h-5 sm:h-6 w-5 sm:w-6" />{" "}
                {t("inventory_title")}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setShowAdvancedInventoryFilters((prev) => !prev)
                  }
                  className={cn(
                    "h-9 w-9 sm:h-10 sm:w-10",
                    showAdvancedInventoryFilters &&
                      "bg-accent text-accent-foreground"
                  )}
                  aria-label={t("inventory_filter_button_aria")}
                >
                  <Filter className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const newMode = viewMode === "table" ? "cards" : "table";
                    setViewMode(newMode);
                    const params = new URLSearchParams(
                      searchParamsHook.toString()
                    );
                    params.set("mobileView", newMode);
                    router.replace(`${pathname}?${params.toString()}`, {
                      scroll: false,
                    });
                  }}
                  className="h-9 sm:h-10 px-3"
                  aria-label={t("inventory_toggle_view_mode_aria")}
                >
                  {viewMode === "table" ? (
                    <Grid className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : (
                    <ListChecks className="h-4 w-4 sm:h-5 sm:w-5" />
                  )}
                </Button>
              </div>
            </div>
            <CardDescription>{t("inventory_description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {/* Inventory Value Display */}
          <div className="mb-4 text-sm text-muted-foreground p-3 bg-muted/30 rounded-md shadow-sm">
            {t("inventory_total_value_display_label")}{" "}
            <span className="font-semibold text-primary">
              {formatDisplayNumberWithTranslation(inventoryValue, t, {
                currency: true,
                decimals: 0,
              })}
            </span>
          </div>

          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-4">
            <div className="relative w-full md:max-w-xs lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("inventory_search_placeholder")}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10 h-10"
                aria-label={t("inventory_search_aria")}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="show-inactive-switch"
                checked={showInactive}
                onCheckedChange={handleToggleShowInactive}
                aria-label={t("inventory_toggle_inactive_aria")}
              />
              <Label
                htmlFor="show-inactive-switch"
                className="cursor-pointer text-sm"
              >
                {t("inventory_show_inactive_label")}
              </Label>
            </div>
          </div>

          {showAdvancedInventoryFilters && (
            <div className="mb-4 flex flex-wrap items-center gap-2 animate-in fade-in-0 duration-300">
              <div className="flex gap-2">
                {" "}
                {/* Wrapper for the two dropdowns */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="rounded-full text-xs h-8 px-3 py-1 border bg-background hover:bg-muted"
                    >
                      <Package className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                      {t(
                        filterStockLevel === "all"
                          ? "inventory_filter_all"
                          : `inventory_filter_${filterStockLevel}`
                      )}
                      <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>
                      {t("inventory_filter_by_stock_level")}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={filterStockLevel === "all"}
                      onCheckedChange={() => {
                        setFilterStockLevel("all");
                        setCurrentPage(1);
                      }}
                    >
                      {t("inventory_filter_all")}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={filterStockLevel === "inStock"}
                      onCheckedChange={() => {
                        setFilterStockLevel("inStock");
                        setCurrentPage(1);
                      }}
                    >
                      {t("inventory_filter_in_stock")}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={filterStockLevel === "low"}
                      onCheckedChange={() => {
                        setFilterStockLevel("low");
                        setCurrentPage(1);
                      }}
                    >
                      {t("inventory_filter_low")}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={filterStockLevel === "out"}
                      onCheckedChange={() => {
                        setFilterStockLevel("out");
                        setCurrentPage(1);
                      }}
                    >
                      {t("inventory_filter_out_of_stock")}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={filterStockLevel === "over"}
                      onCheckedChange={() => {
                        setFilterStockLevel("over");
                        setCurrentPage(1);
                      }}
                    >
                      {t("inventory_filter_over_stock")}
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="rounded-full text-xs h-8 px-3 py-1 border bg-background hover:bg-muted"
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                      {t("inventory_filter_pill_columns")}
                      <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      {t("inventory_toggle_columns_label")}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {columnDefinitions
                      .filter((h) => h.key !== "actions" && h.key !== "id")
                      .map((header) => (
                        <DropdownMenuCheckboxItem
                          key={header.key}
                          className="capitalize"
                          checked={
                            visibleColumns[
                              header.key as keyof typeof visibleColumns
                            ]
                          }
                          onCheckedChange={() =>
                            toggleColumnVisibility(
                              header.key as keyof typeof visibleColumns
                            )
                          }
                        >
                          {t(header.labelKey, {
                            currency_symbol: t("currency_symbol"),
                          })}
                        </DropdownMenuCheckboxItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}

          {viewMode === "cards" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
              {isLoading && paginatedInventory.length === 0 ? (
                Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (
                  <Card
                    key={index}
                    className="animate-pulse bg-card/30 backdrop-blur-sm border-border/50 shadow"
                  >
                    <CardHeader className="pb-2 pt-3 px-3">
                      <Skeleton className="h-5 w-3/4" />
                    </CardHeader>
                    <CardContent className="space-y-2 pt-1 pb-3 px-3">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-1/4" />
                    </CardContent>
                    <CardFooter className="p-2 border-t flex items-center justify-end">
                      <Skeleton className="h-7 w-7 rounded-full" />
                    </CardFooter>
                  </Card>
                ))
              ) : paginatedInventory.length === 0 ? (
                <div className="col-span-full text-center py-10 text-muted-foreground">
                  <Package className="mx-auto h-12 w-12 mb-2 opacity-50" />
                  <p>{t("inventory_no_items_found")}</p>
                  <Button
                    variant="link"
                    onClick={() => router.push("/upload")}
                    className="mt-1 text-primary whitespace-normal h-auto"
                  >
                    {t("inventory_try_adjusting_filters_or_upload")}
                  </Button>
                </div>
              ) : (
                paginatedInventory.map((item) => (
                  <Card
                    key={item.id || item.catalogNumber}
                    className={cn(
                      "hover:shadow-lg transition-shadow flex flex-col bg-card/70 backdrop-blur-sm border-border/50 shadow",
                      !item.isActive && "opacity-60"
                    )}
                  >
                    <CardHeader className="pb-2 pt-3 px-3">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2 flex-grow min-w-0">
                          <span
                            className={cn(
                              "w-3 h-3 rounded-full flex-shrink-0",
                              getStockLevelIndicator(item)
                            )}
                          ></span>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="link"
                                className="p-0 h-auto text-left font-semibold text-base truncate cursor-pointer hover:underline decoration-dashed decoration-muted-foreground/50 underline-offset-2 text-foreground flex-1 min-w-0"
                              >
                                <span
                                  className="truncate"
                                  title={item.shortName || item.description}
                                >
                                  {item.shortName ||
                                    item.description
                                      ?.split(" ")
                                      .slice(0, 3)
                                      .join(" ") ||
                                    t("invoices_na")}
                                </span>
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              side="top"
                              align="start"
                              className="w-auto max-w-[300px] break-words p-3 text-sm shadow-lg space-y-1 bg-background border rounded-md"
                            >
                              {item.description && (
                                <p>
                                  <strong className="font-medium">
                                    {t("inventory_popover_description")}:
                                  </strong>{" "}
                                  {item.description}
                                </p>
                              )}
                              {item.catalogNumber &&
                                item.catalogNumber !== "N/A" && (
                                  <p>
                                    <strong className="font-medium">
                                      {t("inventory_popover_catalog")}:
                                    </strong>{" "}
                                    {item.catalogNumber}
                                  </p>
                                )}
                              {item.barcode && (
                                <p>
                                  <strong className="font-medium">
                                    {t("inventory_popover_barcode")}:
                                  </strong>{" "}
                                  {item.barcode}
                                </p>
                              )}
                              {item.unitPrice !== undefined && (
                                <p>
                                  <strong className="font-medium">
                                    {t("inventory_col_unit_price")}:
                                  </strong>{" "}
                                  {formatDisplayNumberWithTranslation(
                                    item.unitPrice,
                                    t,
                                    { currency: true, decimals: 2 }
                                  )}
                                </p>
                              )}
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                      {item.imageUrl && visibleColumns.imageUrl ? (
                        <div
                          className="mt-2 relative h-24 w-full rounded overflow-hidden border"
                          data-ai-hint="product photo"
                        >
                          <NextImage
                            src={item.imageUrl}
                            alt={item.shortName || item.description || ""}
                            layout="fill"
                            objectFit="cover"
                          />
                        </div>
                      ) : visibleColumns.imageUrl ? (
                        <div className="mt-2 h-24 w-full rounded bg-muted flex items-center justify-center border">
                          <ImageIconLucide className="h-8 w-8 text-muted-foreground" />
                        </div>
                      ) : null}
                    </CardHeader>
                    <CardContent className="text-xs space-y-1 pt-1 pb-3 px-3 flex-grow">
                      <p>
                        <strong>{t("inventory_col_qty")}:</strong>{" "}
                        {formatIntegerQuantityWithTranslation(item.quantity, t)}
                      </p>
                      {visibleColumns.salePrice && (
                        <p>
                          <strong>
                            {t("inventory_col_sale_price", {
                              currency_symbol: t("currency_symbol"),
                            })}
                            :
                          </strong>{" "}
                          {item.salePrice !== undefined &&
                          item.salePrice !== null
                            ? formatDisplayNumberWithTranslation(
                                item.salePrice,
                                t,
                                { currency: true }
                              )
                            : "-"}
                        </p>
                      )}
                    </CardContent>
                    <CardFooter className="p-2 border-t flex items-center justify-end">
                      <div className="flex items-center justify-center space-x-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            item.id && router.push(`/inventory/${item.id}`)
                          }
                          disabled={!item.id || isReactivating[item.id || ""]}
                          aria-label={t("inventory_view_details_aria", {
                            productName:
                              item.shortName || item.description || "",
                          })}
                          className="h-8 w-8 text-primary hover:text-primary/80"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {item.isActive === false ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              item.id && handleReactivateProduct(item.id)
                            }
                            disabled={!item.id || isReactivating[item.id || ""]}
                            aria-label={t("inventory_reactivate_button_aria", {
                              productName:
                                item.shortName || item.description || "",
                            })}
                            className="h-8 w-8 text-green-600 hover:text-green-500"
                            title={t("inventory_reactivate_button_label")}
                          >
                            {isReactivating[item.id || ""] ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Power className="h-4 w-4" />
                            )}
                          </Button>
                        ) : (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={
                                  !item.id || isReactivating[item.id || ""]
                                }
                                aria-label={t(
                                  "inventory_deactivate_button_aria",
                                  {
                                    productName:
                                      item.shortName || item.description || "",
                                  }
                                )}
                                className="h-8 w-8 text-destructive hover:text-destructive/80"
                                title={t("inventory_deactivate_button_label")}
                              >
                                <PowerOff className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  {t("inventory_deactivate_confirm_title")}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("inventory_deactivate_confirm_desc", {
                                    productName:
                                      item.shortName || item.description || "",
                                  })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>
                                  {t("cancel_button")}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() =>
                                    item.id && handleDeleteProduct(item.id)
                                  }
                                  className={cn(
                                    buttonVariants({ variant: "destructive" })
                                  )}
                                >
                                  {t("inventory_deactivate_confirm_action")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </CardFooter>
                  </Card>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto relative -mx-4 sm:-mx-6">
                <Table className="text-xs sm:text-sm">
                  <TableHeader>
                    <TableRow>
                      {visibleColumnHeaders.map((header) => (
                        <TableHead
                          key={header.key}
                          className={cn(
                            "text-center text-xs sm:text-sm px-1 sm:px-3 py-1 sm:py-2",
                            header.headerClassName,
                            header.sortable &&
                              "cursor-pointer hover:bg-muted/50",
                            header.mobileHidden
                              ? "hidden sm:table-cell"
                              : "table-cell"
                          )}
                          onClick={() =>
                            header.sortable && handleSort(header.key as SortKey)
                          }
                          aria-sort={
                            header.sortable
                              ? sortKey === header.key
                                ? sortDirection === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                              : undefined
                          }
                        >
                          <div className="flex items-center justify-center gap-1">
                            {t(header.labelKey, {
                              currency_symbol: t("currency_symbol"),
                            })}
                            {header.sortable && sortKey === header.key && (
                              <span className="text-xs" aria-hidden="true">
                                {sortDirection === "asc" ? (
                                  <ChevronUp className="inline h-3 w-3" />
                                ) : (
                                  <ChevronDown className="inline h-3 w-3" />
                                )}
                              </span>
                            )}
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && paginatedInventory.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={visibleColumnHeaders.length}
                          className="h-24 text-center"
                        >
                          <div className="flex justify-center items-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            <span className="ml-2">
                              {t("inventory_loading_inventory")}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : paginatedInventory.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={visibleColumnHeaders.length}
                          className="h-24 text-center"
                        >
                          <p>{t("inventory_no_items_found")}</p>
                          <Button
                            variant="link"
                            onClick={() => router.push("/upload")}
                            className="mt-1 text-primary whitespace-normal h-auto"
                          >
                            {t("inventory_try_adjusting_filters_or_upload")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedInventory.map((item) => (
                        <TableRow
                          key={item.id || item.catalogNumber}
                          className={cn(
                            "hover:bg-muted/50",
                            !item.isActive && "opacity-60"
                          )}
                          data-testid={`inventory-item-${item.id}`}
                        >
                          {visibleColumns.actions && (
                            <TableCell
                              className={cn(
                                "text-center sticky left-0 bg-card z-10 px-1 sm:px-2 py-1 text-xs sm:text-sm",
                                !item.isActive && "opacity-60"
                              )}
                            >
                              <div className="flex items-center justify-center space-x-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() =>
                                    item.id &&
                                    router.push(`/inventory/${item.id}`)
                                  }
                                  disabled={
                                    !item.id || isReactivating[item.id || ""]
                                  }
                                  aria-label={t("inventory_view_details_aria", {
                                    productName:
                                      item.shortName || item.description || "",
                                  })}
                                  className="h-6 w-6 sm:h-7 sm:w-7 text-primary hover:text-primary/80"
                                >
                                  <Eye className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                                </Button>
                                {item.isActive === false ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      item.id &&
                                      handleReactivateProduct(item.id)
                                    }
                                    disabled={
                                      !item.id || isReactivating[item.id || ""]
                                    }
                                    aria-label={t(
                                      "inventory_reactivate_button_aria",
                                      {
                                        productName:
                                          item.shortName ||
                                          item.description ||
                                          "",
                                      }
                                    )}
                                    className="h-8 w-8 text-green-600 hover:text-green-500"
                                    title={t(
                                      "inventory_reactivate_button_label"
                                    )}
                                  >
                                    {isReactivating[item.id || ""] ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Power className="h-4 w-4" />
                                    )}
                                  </Button>
                                ) : (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        disabled={
                                          !item.id ||
                                          isReactivating[item.id || ""]
                                        }
                                        aria-label={t(
                                          "inventory_deactivate_button_aria",
                                          {
                                            productName:
                                              item.shortName ||
                                              item.description ||
                                              "",
                                          }
                                        )}
                                        className="h-8 w-8 text-destructive hover:text-destructive/80"
                                        title={t(
                                          "inventory_deactivate_button_label"
                                        )}
                                      >
                                        <PowerOff className="h-4 w-4" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          {t(
                                            "inventory_deactivate_confirm_title"
                                          )}
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          {t(
                                            "inventory_deactivate_confirm_desc",
                                            {
                                              productName:
                                                item.shortName ||
                                                item.description ||
                                                "",
                                            }
                                          )}
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>
                                          {t("cancel_button")}
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() =>
                                            item.id &&
                                            handleDeleteProduct(item.id)
                                          }
                                          className={cn(
                                            buttonVariants({
                                              variant: "destructive",
                                            })
                                          )}
                                        >
                                          {t(
                                            "inventory_deactivate_confirm_action"
                                          )}
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                              </div>
                            </TableCell>
                          )}
                          {visibleColumns.imageUrl && (
                            <TableCell
                              className={cn(
                                "text-center px-1 sm:px-2 py-1",
                                columnDefinitions.find(
                                  (h) => h.key === "imageUrl"
                                )?.className,
                                !item.isActive && "opacity-60"
                              )}
                            >
                              {item.imageUrl ? (
                                <div
                                  className="relative h-10 w-10 mx-auto rounded overflow-hidden border"
                                  data-ai-hint="product photo"
                                >
                                  <NextImage
                                    src={item.imageUrl}
                                    alt={
                                      item.shortName || item.description || ""
                                    }
                                    layout="fill"
                                    objectFit="cover"
                                  />
                                </div>
                              ) : (
                                <div className="h-10 w-10 mx-auto rounded bg-muted flex items-center justify-center border">
                                  <ImageIconLucide className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                            </TableCell>
                          )}
                          {visibleColumns.shortName && (
                            <TableCell
                              className={cn(
                                "px-2 sm:px-4 py-2 text-center min-w-[100px] sm:min-w-[150px]",
                                !item.isActive && "opacity-60"
                              )}
                            >
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="link"
                                    className="p-0 h-auto text-center font-medium cursor-pointer hover:underline decoration-dashed decoration-muted-foreground/50 underline-offset-2 text-foreground"
                                  >
                                    {item.shortName ||
                                      item.description
                                        ?.split(" ")
                                        .slice(0, 3)
                                        .join(" ") ||
                                      t("invoices_na")}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  side="top"
                                  align="start"
                                  className="w-auto max-w-[300px] break-words p-3 text-sm shadow-lg space-y-1 bg-background border rounded-md"
                                >
                                  {item.description && (
                                    <p>
                                      <strong className="font-medium">
                                        {t("inventory_popover_description")}:
                                      </strong>{" "}
                                      {item.description}
                                    </p>
                                  )}
                                  {item.catalogNumber &&
                                    item.catalogNumber !== "N/A" && (
                                      <p>
                                        <strong className="font-medium">
                                          {t("inventory_popover_catalog")}:
                                        </strong>{" "}
                                        {item.catalogNumber}
                                      </p>
                                    )}
                                  {item.barcode && (
                                    <p>
                                      <strong className="font-medium">
                                        {t("inventory_popover_barcode")}:
                                      </strong>{" "}
                                      {item.barcode}
                                    </p>
                                  )}
                                  {item.unitPrice !== undefined && (
                                    <p>
                                      <strong className="font-medium">
                                        {t("inventory_col_unit_price")}:
                                      </strong>{" "}
                                      {formatDisplayNumberWithTranslation(
                                        item.unitPrice,
                                        t,
                                        { currency: true, decimals: 2 }
                                      )}
                                    </p>
                                  )}
                                </PopoverContent>
                              </Popover>
                            </TableCell>
                          )}
                          {visibleColumns.description && (
                            <TableCell
                              className={cn(
                                "px-2 sm:px-4 py-2 text-center",
                                columnDefinitions.find(
                                  (h) => h.key === "description"
                                )?.mobileHidden && "hidden sm:table-cell",
                                "truncate max-w-[150px] sm:max-w-md",
                                !item.isActive && "opacity-60"
                              )}
                            >
                              {item.description || t("invoices_na")}
                            </TableCell>
                          )}
                          {visibleColumns.catalogNumber && (
                            <TableCell
                              className={cn(
                                "px-2 sm:px-4 py-2 text-center",
                                columnDefinitions.find(
                                  (h) => h.key === "catalogNumber"
                                )?.mobileHidden && "hidden sm:table-cell",
                                !item.isActive && "opacity-60"
                              )}
                            >
                              {item.catalogNumber || t("invoices_na")}
                            </TableCell>
                          )}
                          {visibleColumns.barcode && (
                            <TableCell
                              className={cn(
                                "px-2 sm:px-4 py-2 text-center",
                                columnDefinitions.find(
                                  (h) => h.key === "barcode"
                                )?.mobileHidden && "hidden sm:table-cell",
                                !item.isActive && "opacity-60"
                              )}
                            >
                              {item.barcode || t("invoices_na")}
                            </TableCell>
                          )}
                          {visibleColumns.quantity && (
                            <TableCell
                              className={cn(
                                "text-center px-2 sm:px-4 py-2",
                                columnDefinitions.find(
                                  (h) => h.key === "quantity"
                                )?.className,
                                !item.isActive && "opacity-60"
                              )}
                            >
                              <div className="flex items-center justify-center gap-1 sm:gap-2">
                                <span className="min-w-[20px] sm:min-w-[30px] text-center font-semibold">
                                  {formatIntegerQuantityWithTranslation(
                                    item.quantity,
                                    t
                                  )}
                                </span>
                                <span
                                  className={cn(
                                    "w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ml-1 sm:ml-2 flex-shrink-0",
                                    getStockLevelIndicator(item)
                                  )}
                                ></span>
                              </div>
                            </TableCell>
                          )}
                          {visibleColumns.unitPrice && (
                            <TableCell
                              className={cn(
                                "text-center px-2 sm:px-4 py-2",
                                columnDefinitions.find(
                                  (h) => h.key === "unitPrice"
                                )?.mobileHidden && "hidden sm:table-cell",
                                !item.isActive && "opacity-60"
                              )}
                            >
                              {formatDisplayNumberWithTranslation(
                                item.unitPrice,
                                t,
                                { currency: true, decimals: 2 }
                              )}
                            </TableCell>
                          )}
                          {visibleColumns.salePrice && (
                            <TableCell
                              className={cn(
                                "text-center px-2 sm:px-4 py-2",
                                columnDefinitions.find(
                                  (h) => h.key === "salePrice"
                                )?.mobileHidden && "hidden sm:table-cell",
                                !item.isActive && "opacity-60"
                              )}
                            >
                              {item.salePrice !== undefined &&
                              item.salePrice !== null
                                ? formatDisplayNumberWithTranslation(
                                    item.salePrice,
                                    t,
                                    { currency: true }
                                  )
                                : "-"}
                            </TableCell>
                          )}
                          {visibleColumns.lineTotal && (
                            <TableCell
                              className={cn(
                                "text-center px-2 sm:px-4 py-2",
                                columnDefinitions.find(
                                  (h) => h.key === "lineTotal"
                                )?.mobileHidden && "hidden sm:table-cell",
                                !item.isActive && "opacity-60"
                              )}
                            >
                              {formatDisplayNumberWithTranslation(
                                item.lineTotal,
                                t,
                                { currency: true, decimals: 0 }
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row justify-between items-center gap-2 p-4 border-t">
          {totalPages > 1 && (
            <div className="flex items-center justify-center sm:justify-start space-x-2 py-2 w-full sm:w-auto">
              <span className="text-sm text-muted-foreground hidden sm:block">
                {t("inventory_pagination_page_info", {
                  currentPage: currentPage,
                  totalPages: totalPages,
                  totalItems: totalItems,
                })}
              </span>
              <div className="flex space-x-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-8 px-2"
                >
                  <ChevronLeft className="h-4 w-4" />{" "}
                  <span className="hidden sm:inline">
                    {t("inventory_pagination_previous")}
                  </span>
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
                  <span className="hidden sm:inline">
                    {t("inventory_pagination_next")}
                  </span>{" "}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row justify-end gap-2 w-full sm:w-auto mt-2 sm:mt-0">
            <Button
              variant="outline"
              onClick={handleExportInventory}
              className="w-full sm:w-auto"
            >
              <Download className="mr-2 h-4 w-4" />{" "}
              {t("inventory_export_csv_button")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={isDeleting || inventory.length === 0}
                  className="w-full sm:w-auto"
                >
                  {isDeleting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  {t("inventory_delete_all_button")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("inventory_delete_all_confirm_title")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("inventory_delete_all_confirm_desc")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>
                    {t("cancel_button")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAllInventory}
                    disabled={isDeleting}
                    className={cn(buttonVariants({ variant: "destructive" }))}
                  >
                    {isDeleting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {t("inventory_delete_all_confirm_action")}
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
