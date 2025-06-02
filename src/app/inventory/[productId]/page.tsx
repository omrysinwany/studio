
// src/app/inventory/[productId]/page.tsx
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { ArrowLeft, Package, Tag, Hash, Layers, CalendarDays as CalendarIconLucide, Loader2, AlertTriangle, Save, X, DollarSign, Trash2, Pencil, Barcode, Camera, TrendingUp, TrendingDown, ImageIcon as ImageIconLucide, Minus, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { getProductByIdService, updateProductService, deleteProductService, Product } from '@/services/backend';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle as DialogTitleComponent, DialogDescription as DialogDescriptionComponent, DialogFooter as DialogFooterComponent } from "@/components/ui/dialog";
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import NextImage from 'next/image';
import { Timestamp } from 'firebase/firestore';
import { format, parseISO, isValid } from 'date-fns';

// Helper to format numbers for display
const formatDisplayNumberWithTranslation = (
    value: number | undefined | null,
    t: (key: string, params?: Record<string, string | number>) => string,
    options?: { decimals?: number, useGrouping?: boolean, currency?: boolean }
): string => {
    const { decimals = 0, useGrouping = true, currency = false } = options || {};
    const shekelSymbol = t('currency_symbol');

    if (value === null || value === undefined || isNaN(value)) {
        const zeroFormatted = (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, {
            minimumFractionDigits: currency ? 0 : decimals,
            maximumFractionDigits: currency ? 0 : decimals,
            useGrouping: useGrouping,
        });
        return currency ? `${shekelSymbol}${zeroFormatted}` : zeroFormatted;
    }

    const formattedValue = value.toLocaleString(t('locale_code_for_number_formatting') || undefined, {
        minimumFractionDigits: currency ? 0 : decimals,
        maximumFractionDigits: currency ? 0 : decimals,
        useGrouping: useGrouping,
    });
    return currency ? `${shekelSymbol}${formattedValue}` : formattedValue;
};

// Helper to format numbers for input fields
const formatInputValue = (value: number | undefined | null, fieldType: 'currency' | 'quantity' | 'stockLevel'): string => {
    if ((fieldType === 'currency' || fieldType === 'stockLevel') && (value === undefined || value === null)) {
        return '';
    }
    if (value === null || value === undefined || isNaN(value)) {
        return fieldType === 'currency' ? '0.00' : '0';
    }
    if (fieldType === 'currency') {
      return parseFloat(String(value)).toFixed(2);
    }
    return String(Math.round(value));
};


const formatIntegerQuantityWithTranslation = (
    value: number | undefined | null,
    t: (key: string) => string
): string => {
    if (value === null || value === undefined || isNaN(value)) {
        return "0";
    }
    return Math.round(value).toLocaleString(t('locale_code_for_number_formatting') || undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

export default function ProductDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [product, setProduct] = useState<Product | null>(null);
  const [editedProduct, setEditedProduct] = useState<Partial<Product>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingQuantityDetail, setIsUpdatingQuantityDetail] = useState(false);
  const [isUpdatingMinMaxStock, setIsUpdatingMinMaxStock] = useState(false);


  const [showCameraModal, setShowCameraModal] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const productId = params.productId as string;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

   const loadProduct = useCallback(async () => {
    if (!productId || !user || !user.id) return;

    setIsLoading(true);
    setError(null);
    try {
      const data = await getProductByIdService(productId, user.id);
      if (data) {
        setProduct(data);
        setEditedProduct({ ...data });
      } else {
        setError(t('product_detail_error_not_found'));
         toast({
           title: t('error_title'),
           description: t('product_detail_toast_error_not_found_desc'),
           variant: "destructive",
         });
      }
    } catch (err) {
      console.error("Failed to fetch product details:", err);
      setError(t('product_detail_error_load_failed'));
      toast({
        title: t('error_title'),
        description: t('product_detail_toast_error_load_failed_desc'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [productId, toast, t, user]);


  useEffect(() => {
    if(user && user.id){
        loadProduct();
    }
  }, [loadProduct, user]);

  const handleInputChange = (field: keyof Product, value: string | number) => {
    setEditedProduct(prev => {
      let numericValue: number | string | null | undefined = value;
      if (['quantity', 'unitPrice', 'salePrice', 'lineTotal', 'minStockLevel', 'maxStockLevel'].includes(field)) {
          const stringValue = String(value);
          if (stringValue.trim() === '' && (field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice')) {
              numericValue = undefined;
          } else {
            numericValue = parseFloat(stringValue.replace(/,/g, ''));
            if (isNaN(numericValue as number)) {
               numericValue = (field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice') ? undefined : 0;
            }
          }
      }

      const updated = { ...prev, [field]: numericValue } as Partial<Product>;

      if (field === 'quantity' || field === 'unitPrice') {
          const quantity = Number(updated.quantity) || 0;
          const unitPrice = Number(updated.unitPrice) || 0;
          updated.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
      }

      return updated;
    });
  };

  const handleSave = async () => {
    if (!product || !product.id || !user || !user.id) return;

    if (editedProduct.salePrice === undefined || editedProduct.salePrice === null || isNaN(Number(editedProduct.salePrice)) || Number(editedProduct.salePrice) <=0) {
        // Sale price is optional.
    }
    if (editedProduct.minStockLevel !== undefined && editedProduct.minStockLevel !== null && (isNaN(Number(editedProduct.minStockLevel)) || Number(editedProduct.minStockLevel) < 0)) {
      toast({ title: t('product_detail_toast_invalid_min_stock_title'), description: t('product_detail_toast_invalid_min_stock_desc'), variant: "destructive" });
      return;
    }
    if (editedProduct.maxStockLevel !== undefined && editedProduct.maxStockLevel !== null && (isNaN(Number(editedProduct.maxStockLevel)) || Number(editedProduct.maxStockLevel) < 0)) {
      toast({ title: t('product_detail_toast_invalid_max_stock_title'), description: t('product_detail_toast_invalid_max_stock_desc'), variant: "destructive" });
      return;
    }
    if (editedProduct.minStockLevel !== undefined && editedProduct.maxStockLevel !== undefined && editedProduct.minStockLevel !== null && editedProduct.maxStockLevel !== null && Number(editedProduct.minStockLevel) > Number(editedProduct.maxStockLevel)) {
        toast({ title: t('product_detail_toast_invalid_stock_levels_title'), description: t('product_detail_toast_invalid_stock_levels_desc'), variant: "destructive" });
        return;
    }

    setIsSaving(true);
    try {
      const productToSave: Partial<Product> = {
        catalogNumber: editedProduct.catalogNumber || product.catalogNumber,
        description: editedProduct.description || product.description,
        shortName: editedProduct.shortName || product.shortName,
        barcode: editedProduct.barcode || undefined,
        quantity: Number(editedProduct.quantity) ?? product.quantity,
        unitPrice: Number(editedProduct.unitPrice) ?? product.unitPrice,
        salePrice: editedProduct.salePrice === undefined ? null : (Number(editedProduct.salePrice) ?? null),
        lineTotal: parseFloat(((Number(editedProduct.quantity) ?? product.quantity) * (Number(editedProduct.unitPrice) ?? product.unitPrice)).toFixed(2)),
        minStockLevel: editedProduct.minStockLevel === undefined || editedProduct.minStockLevel === null ? null : Number(editedProduct.minStockLevel),
        maxStockLevel: editedProduct.maxStockLevel === undefined || editedProduct.maxStockLevel === null ? null : Number(editedProduct.maxStockLevel),
        imageUrl: editedProduct.imageUrl || product.imageUrl,
      };

      await updateProductService(product.id, productToSave, user.id);
      toast({
        title: t('product_detail_toast_updated_title'),
        description: t('product_detail_toast_updated_desc'),
      });
      setIsEditing(false);
      await loadProduct();
    } catch (err) {
      console.error("Failed to save product:", err);
      toast({
        title: t('product_detail_toast_save_failed_title'),
        description: t('product_detail_toast_save_failed_desc'),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

   const handleDelete = async () => {
    if (!product || !product.id || !user || !user.id) return;
    setIsDeleting(true);
    try {
      await deleteProductService(product.id, user.id);
      toast({
        title: t('product_detail_toast_deleted_title'),
        description: t('product_detail_toast_deleted_desc', { productName: product.shortName || product.description || "" }),
      });
      router.push('/inventory?refresh=true');
    } catch (err) {
      console.error("Failed to delete product:", err);
      toast({
        title: t('product_detail_toast_delete_failed_title'),
        description: t('product_detail_toast_delete_failed_desc'),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = () => {
    if (product) {
        setEditedProduct({ ...product });
        setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    if (product) {
        setEditedProduct({ ...product });
        setIsEditing(false);
        toast({
            title: t('product_detail_toast_edit_cancelled_title'),
            description: t('product_detail_toast_edit_cancelled_desc'),
            variant: "default",
        });
    }
  };

   const handleBack = () => {
      router.push('/inventory');
   };

   const handleScanBarcode = () => {
       toast({ title: "Scanner Not Implemented", description: "Barcode scanning functionality will be added soon." });
   };

   const enableCamera = async () => {
    console.log("[ProductDetail] enableCamera called");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setHasCameraPermission(false);
      toast({
        variant: 'destructive',
        title: t('barcode_scanner_toast_not_supported_title'),
        description: t('barcode_scanner_error_not_supported_browser'),
      });
      setShowCameraModal(false);
      return;
    }
    try {
      console.log("[ProductDetail] Requesting camera permission...");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      console.log("[ProductDetail] Camera permission granted, stream obtained.");
      setHasCameraPermission(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        console.log("[ProductDetail] Stream assigned to videoRef.");
      }
    } catch (error: any) {
      console.error('[ProductDetail] Error accessing camera:', error);
      setHasCameraPermission(false);
      let userMsg = t('barcode_scanner_toast_camera_error_desc', { message: error.name || error.message });
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        userMsg = t('barcode_scanner_error_permission_denied_settings');
      }
      toast({
        variant: 'destructive',
        title: t('barcode_scanner_toast_camera_error_title'),
        description: userMsg,
      });
      setShowCameraModal(false);
    }
  };

  const handleOpenCameraModal = () => {
    console.log("[ProductDetail] handleOpenCameraModal called");
    setShowCameraModal(true);
    if (hasCameraPermission === null || !hasCameraPermission) {
        enableCamera();
    } else if (hasCameraPermission && videoRef.current && !videoRef.current.srcObject) {
        enableCamera();
    }
  };

  const captureImage = () => {
    console.log("[ProductDetail] captureImage called");
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setEditedProduct(prev => ({ ...prev, imageUrl: dataUrl }));
        if (!isEditing) setIsEditing(true); 
        console.log("[ProductDetail] Image captured, imageUrl in editedProduct set.");
        toast({ title: t('product_image_captured_title'), description: t('product_image_captured_desc') });
      } else {
        console.error("[ProductDetail] Failed to get 2D context from canvas.");
        toast({ title: t('error_title'), description: t('product_image_capture_fail_desc_context'), variant: "destructive" });
      }
    } else {
        console.error("[ProductDetail] videoRef or canvasRef is null.");
        toast({ title: t('error_title'), description: t('product_image_capture_fail_desc_refs'), variant: "destructive" });
    }
    stopCameraStream();
    setShowCameraModal(false);
  };

  const stopCameraStream = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      console.log("[ProductDetail] Camera stream stopped.");
    }
  }, []);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);


   const handleQuantityUpdateOnDetailPage = async (change: number) => {
     if (!product || !product.id || !user || !user.id || isEditing) return;
     setIsUpdatingQuantityDetail(true);
     const currentQty = product.quantity ?? 0;
     const newQuantity = currentQty + change;
     if (newQuantity < 0) {
       toast({ title: t('inventory_toast_invalid_quantity_title'), description: t('inventory_toast_invalid_quantity_desc_negative'), variant: "destructive" });
       setIsUpdatingQuantityDetail(false);
       return;
     }
     
     const productDataToUpdate = { quantity: newQuantity, lineTotal: parseFloat((newQuantity * (Number(product.unitPrice) || 0)).toFixed(2)) };
        try {
           await updateProductService(product.id, productDataToUpdate, user.id);
           setProduct(prev => prev ? { ...prev, ...productDataToUpdate } : null);
           setEditedProduct(prev => ({...prev, ...productDataToUpdate }));
           toast({
             title: t('inventory_toast_quantity_updated_title'),
             description: t('inventory_toast_quantity_updated_desc', { productName: product.shortName || product.description || "", quantity: newQuantity })
           });
         } catch (error) {
           console.error("Failed to update quantity on detail page:", error);
           toast({ title: t('inventory_toast_quantity_update_fail_title'), description: t('inventory_toast_quantity_update_fail_desc'), variant: "destructive" });
         }
     setIsUpdatingQuantityDetail(false);
   };

   const handleMinMaxStockUpdate = async (field: 'minStockLevel' | 'maxStockLevel', change: number) => {
       if (!product || !product.id || !user || !user.id || isEditing) return;
       setIsUpdatingMinMaxStock(true);
       const currentValue = product[field] ?? 0;
       let newValue = (currentValue || 0) + change;
       if (newValue < 0) newValue = 0;

       const updateData: Partial<Product> = { [field]: newValue };

        if (field === 'minStockLevel' && product.maxStockLevel !== null && product.maxStockLevel !== undefined && newValue > product.maxStockLevel) {
            toast({ title: t('product_detail_toast_invalid_min_max_range_title'), description: t('product_detail_toast_invalid_min_max_range_desc_min_gt_max'), variant: "destructive"});
            setIsUpdatingMinMaxStock(false);
            return;
        }
        if (field === 'maxStockLevel' && product.minStockLevel !== null && product.minStockLevel !== undefined && newValue < product.minStockLevel) {
             toast({ title: t('product_detail_toast_invalid_min_max_range_title'), description: t('product_detail_toast_invalid_min_max_range_desc_max_lt_min'), variant: "destructive"});
             setIsUpdatingMinMaxStock(false);
             return;
        }

       try {
           await updateProductService(product.id, updateData, user.id);
           setProduct(prev => prev ? { ...prev, ...updateData } : null);
           setEditedProduct(prev => ({ ...prev, ...updateData }));
           toast({
               title: field === 'minStockLevel' ? t('product_detail_toast_min_stock_updated_title') : t('product_detail_toast_max_stock_updated_title'),
               description: t(field === 'minStockLevel' ? 'product_detail_toast_min_stock_updated_desc' : 'product_detail_toast_max_stock_updated_desc', {productName: product.shortName || product.description || "", value: newValue})
           });
       } catch (error) {
           console.error(`Failed to update ${field}:`, error);
           toast({ title: t('product_detail_toast_min_max_stock_update_fail_title'), description: t('product_detail_toast_min_max_stock_update_fail_desc'), variant: "destructive" });
       }
       setIsUpdatingMinMaxStock(false);
   };


   const renderViewItem = (icon: React.ElementType, labelKey: string, value: string | number | undefined | null, fieldKey?: keyof Product, isCurrency: boolean = false, isQuantity: boolean = false, isBarcode: boolean = false, isStockLevel: boolean = false) => {
     const IconComponent = icon;
     let displayValue: string | React.ReactNode = '-';

     if (value !== null && value !== undefined && String(value).trim() !== '') {
        if (typeof value === 'number') {
            if (isCurrency) displayValue = formatDisplayNumberWithTranslation(value, t, { decimals: 0, useGrouping: true, currency: true });
            else if (isQuantity || isStockLevel) displayValue = formatIntegerQuantityWithTranslation(value, t);
            else displayValue = formatDisplayNumberWithTranslation(value, t, { decimals: 0, useGrouping: true, currency: false });
        } else {
            displayValue = value || (isBarcode || isStockLevel ? t('product_detail_not_set') : '-');
        }
     } else {
        displayValue = (isBarcode || isStockLevel || (labelKey === "product_detail_label_sale_price" && isCurrency) || (labelKey === "product_detail_label_unit_price_cost" && isCurrency)) ? t('product_detail_not_set') : '-';
     }

     return (
       <div className="flex items-start space-x-3 py-1.5">
         <IconComponent className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
         <div className="flex-grow">
           <p className="text-sm font-medium text-muted-foreground">{t(labelKey)}</p>
            <div className="flex items-center gap-2 mt-0.5">
            {fieldKey && (fieldKey === 'minStockLevel' || fieldKey === 'maxStockLevel') && !isEditing ? (
                <>
                    <Button
                        variant="outline" size="icon" className="h-6 w-6"
                        onClick={() => handleMinMaxStockUpdate(fieldKey, -1)}
                        disabled={isUpdatingMinMaxStock || isEditing || isSaving || isDeleting || (product?.[fieldKey] ?? 0) <= 0}
                        aria-label={t(fieldKey === 'minStockLevel' ? 'decrease_min_stock_aria_label' : 'decrease_max_stock_aria_label', { productName: product?.shortName || product?.description || ""})}
                    > <Minus className="h-3 w-3" /> </Button>
                     <p className="text-base font-semibold min-w-[20px] text-center">
                        {isUpdatingMinMaxStock && editedProduct[fieldKey] === product?.[fieldKey] ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : displayValue}
                    </p>
                    <Button
                        variant="outline" size="icon" className="h-6 w-6"
                        onClick={() => handleMinMaxStockUpdate(fieldKey, 1)}
                        disabled={isUpdatingMinMaxStock || isEditing || isSaving || isDeleting}
                         aria-label={t(fieldKey === 'minStockLevel' ? 'increase_min_stock_aria_label' : 'increase_max_stock_aria_label', { productName: product?.shortName || product?.description || ""})}
                    > <Plus className="h-3 w-3" /> </Button>
                </>
            ) : fieldKey === 'quantity' && !isEditing ? (
                 <>
                    <Button
                        variant="outline" size="icon" className="h-7 w-7"
                        onClick={() => handleQuantityUpdateOnDetailPage(-1)}
                        disabled={isUpdatingQuantityDetail || isEditing || isSaving || isDeleting || (product?.quantity ?? 0) <= 0}
                        aria-label={t('decrease_quantity_aria_label', { productName: product?.shortName || product?.description || "" })}
                    >
                        <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <p className="text-base font-semibold min-w-[30px] text-center">
                        {isUpdatingQuantityDetail ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : formatIntegerQuantityWithTranslation(product?.quantity, t)}
                    </p>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleQuantityUpdateOnDetailPage(1)}
                        disabled={isUpdatingQuantityDetail || isEditing || isSaving || isDeleting}
                        aria-label={t('increase_quantity_aria_label', { productName: product?.shortName || product?.description || "" })}
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </Button>
                </>
            ) : (
                 <p className="text-base font-semibold">{displayValue}</p>
            )}
            </div>
         </div>
       </div>
     );
   };

    const renderEditItem = (icon: React.ElementType, labelKey: string, value: string | number | undefined | null, fieldKey: keyof Product, isCurrency: boolean = false, isQuantity: boolean = false, isBarcode: boolean = false, isStockLevel: boolean = false) => {
        const IconComponent = icon;
        const inputType =
          fieldKey === 'quantity' || fieldKey === 'unitPrice' || fieldKey === 'salePrice' || fieldKey === 'lineTotal' || fieldKey === 'minStockLevel' || fieldKey === 'maxStockLevel'
            ? 'number'
            : 'text';

         const inputValue =
           inputType === 'number'
             ? formatInputValue(value as number | undefined | null, isCurrency ? 'currency' : (isStockLevel ? 'stockLevel' : 'quantity'))
             : (value as string) || '';
        
        return (
          <div className="flex items-start space-x-3 py-1.5">
            <IconComponent className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
            <div className="flex-grow">
              <Label htmlFor={fieldKey} className="text-sm font-medium text-muted-foreground">
                {t(labelKey)}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                    id={fieldKey}
                    type={inputType}
                    value={inputValue}
                    onChange={(e) => handleInputChange(fieldKey, e.target.value)}
                    className="mt-1 h-9 flex-grow"
                    step={inputType === 'number' ? (isCurrency ? '0.01' : '1') : undefined}
                    min={inputType === 'number' ? ((isStockLevel || isQuantity) ? "0" : "0.01") : undefined}
                    disabled={fieldKey === 'lineTotal' || isSaving || isDeleting}
                    placeholder={isStockLevel ? t('optional_placeholder') : ""}
                  />
                  {isBarcode && (
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="mt-1 h-9 w-9 flex-shrink-0"
                        onClick={handleScanBarcode}
                        disabled={isSaving || isDeleting}
                        aria-label={t('product_detail_scan_barcode_button_aria')}
                    >
                        <Camera className="h-4 w-4" />
                    </Button>
                  )}
                </div>
            </div>
          </div>
        );
      };


  if (authLoading || isLoading || !user) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 md:p-8 text-center">
         <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <p className="text-xl text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> {t('back_button')}
        </Button>
      </div>
    );
  }

  if (!product) {
     return (
       <div className="container mx-auto p-4 md:p-8 text-center">
         <p>{t('product_not_found')}</p>
         <Button variant="outline" onClick={handleBack} className="mt-4">
           <ArrowLeft className="mr-2 h-4 w-4" /> {t('back_button')}
         </Button>
       </div>
     );
   }


  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
       <div className="mb-4">
         <Button variant="outline" onClick={handleBack} disabled={isSaving || isDeleting || isUpdatingQuantityDetail || isUpdatingMinMaxStock} size="sm">
           <ArrowLeft className="mr-2 h-4 w-4" /> {t('back_button')}
         </Button>
       </div>

      <Card className="shadow-lg scale-fade-in">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
           {isEditing ? (
             <>
                <Label htmlFor="shortName" className="text-sm font-medium text-muted-foreground">{t('product_detail_label_product_name')}</Label>
                <Input
                    id="shortName"
                    value={editedProduct.shortName || ''}
                    onChange={(e) => handleInputChange('shortName', e.target.value)}
                    className="text-2xl sm:text-3xl font-bold h-auto p-0 border-0 shadow-none focus-visible:ring-0"
                    disabled={isSaving || isDeleting}
                    />
                <Label htmlFor="description" className="text-sm font-medium text-muted-foreground pt-2 block">{t('product_detail_label_full_description')}</Label>
                <Input
                    id="description"
                    value={editedProduct.description || ''}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    className="text-sm h-auto p-0 border-0 shadow-none focus-visible:ring-0 text-muted-foreground"
                    disabled={isSaving || isDeleting}
                  />
                 <Label htmlFor="catalogNumber" className="text-sm font-medium text-muted-foreground pt-2 block">{t('product_detail_label_catalog_number')}</Label>
                 <Input
                    id="catalogNumber"
                    value={editedProduct.catalogNumber || ''}
                    onChange={(e) => handleInputChange('catalogNumber', e.target.value)}
                    className="text-sm h-auto p-0 border-0 shadow-none focus-visible:ring-0 text-muted-foreground"
                    disabled={isSaving || isDeleting}
                  />
              </>
           ) : (
               <>
                 <CardTitle className="text-2xl sm:text-3xl font-bold text-primary truncate" title={product.shortName || product.description}>{product.shortName || product.description}</CardTitle>
                 <CardDescription className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground"/>
                    {product.catalogNumber}
                 </CardDescription>
                  {product.shortName && product.description !== product.shortName && (
                     <p className="text-sm text-muted-foreground mt-1">{product.description}</p>
                  )}
               </>
           )}
          </div>
           <div className="flex gap-1 sm:gap-2 flex-shrink-0">
             {isEditing ? (
                 <>
                     <Button variant="outline" size="icon" onClick={handleCancelEdit} disabled={isSaving || isDeleting} aria-label={t('cancel_button')}>
                         <X className="h-4 w-4" />
                     </Button>
                     <Button size="icon" onClick={handleSave} disabled={isSaving || isDeleting} aria-label={t('save_changes_button')}>
                         {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                     </Button>
                 </>
             ) : (
                 <>
                      <AlertDialog>
                         <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" disabled={isDeleting} aria-label={t('delete_button')}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                         </AlertDialogTrigger>
                         <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>{t('product_detail_delete_confirm_title')}</AlertDialogTitle>
                            <AlertDialogDescription>
                               {t('product_detail_delete_confirm_desc', { productName: product.shortName || product.description || "" })}
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel disabled={isDeleting}>{t('cancel_button')}</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>
                               {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                               {t('product_detail_delete_confirm_action')}
                            </AlertDialogAction>
                            </AlertDialogFooter>
                         </AlertDialogContent>
                      </AlertDialog>

                     <Button variant="ghost" size="icon" onClick={handleEdit} aria-label={t('edit_button')}>
                         <Pencil className="h-4 w-4" />
                     </Button>
                 </>
             )}
            </div>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4 pt-4">
            {!isEditing && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {product.quantity <= (product.minStockLevel ?? 0) && product.quantity > 0 && (
                        <span className={`inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200`}>
                            <AlertTriangle className="mr-1 h-4 w-4" />{t('product_detail_low_stock_badge')}
                        </span>
                    )}
                    {product.quantity === 0 && (
                        <span className={`inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`}>
                            <AlertTriangle className="mr-1 h-4 w-4" />{t('product_detail_out_of_stock_badge')}
                        </span>
                    )}
                    {product.maxStockLevel !== undefined && product.maxStockLevel !== null && product.quantity > product.maxStockLevel && (
                        <span className={`inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200`}>
                            <AlertTriangle className="mr-1 h-4 w-4" />{t('product_detail_over_stock_badge')}
                        </span>
                    )}
                    {((product.quantity > 0 && (product.minStockLevel === undefined || product.minStockLevel === null || product.quantity > product.minStockLevel)) && (product.maxStockLevel === undefined || product.maxStockLevel === null || product.quantity <= product.maxStockLevel)) && (
                        <span className={`inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`}>
                            <Package className="mr-1 h-4 w-4" />{t('inventory_filter_in_stock')}
                        </span>
                    )}
                </div>
            )}
             <Separator className="my-3 sm:my-4" />

           <div className="space-y-1">
             {isEditing ? (
                 <>
                    {renderEditItem(Barcode, "product_detail_label_barcode", editedProduct.barcode, 'barcode', false, false, true)}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {renderEditItem(Layers, "product_detail_label_quantity", editedProduct.quantity, 'quantity', false, true)}
                        {renderEditItem(DollarSign, "product_detail_label_line_total_cost", editedProduct.lineTotal, 'lineTotal', true, false, false, false)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {renderEditItem(Tag, "product_detail_label_unit_price_cost", editedProduct.unitPrice, 'unitPrice', true)}
                        {renderEditItem(DollarSign, "product_detail_label_sale_price", editedProduct.salePrice, 'salePrice', true)}
                    </div>
                     <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {renderEditItem(TrendingDown, "product_detail_label_min_stock", editedProduct.minStockLevel, 'minStockLevel', false, false, false, true)}
                        {renderEditItem(TrendingUp, "product_detail_label_max_stock", editedProduct.maxStockLevel, 'maxStockLevel', false, false, false, true)}
                    </div>
                 </>
             ) : (
                 <>
                    {renderViewItem(Barcode, "product_detail_label_barcode", product.barcode, undefined, false, false, true)}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                         {renderViewItem(Layers, "product_detail_label_quantity", product.quantity, 'quantity', false, true)}
                         {renderViewItem(DollarSign, "product_detail_label_line_total_cost", product.lineTotal, undefined, true, false, false, false)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {renderViewItem(Tag, "product_detail_label_unit_price_cost", product.unitPrice, undefined, true)}
                        {renderViewItem(DollarSign, "product_detail_label_sale_price", product.salePrice, undefined, true)}
                    </div>
                     <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {renderViewItem(TrendingDown, t("product_detail_label_min_stock"), product.minStockLevel, 'minStockLevel', false, false, false, true)}
                        {renderViewItem(TrendingUp, t("product_detail_label_max_stock"), product.maxStockLevel, 'maxStockLevel', false, false, false, true)}
                    </div>
                 </>
             )}
            </div>
             <div className="mt-4">
                 <Label className="text-sm font-medium text-muted-foreground">{t('product_detail_label_image_url')}</Label>
                {isEditing ? (
                    <div className="flex items-center gap-2 mt-1">
                        <Input
                            id="imageUrl"
                            value={editedProduct.imageUrl || ''}
                            onChange={(e) => handleInputChange('imageUrl', e.target.value)}
                            placeholder={t('product_detail_image_url_placeholder')}
                            className="h-9 flex-grow"
                            disabled={isSaving || isDeleting}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            onClick={handleOpenCameraModal}
                            disabled={isSaving || isDeleting}
                            aria-label={t('product_capture_image_button_aria')}
                        >
                            <Camera className="h-4 w-4" />
                        </Button>
                    </div>
                ) : null}

                {(!isEditing && (!product.imageUrl || product.imageUrl.trim() === '')) ? (
                     <div
                        className="mt-2 h-48 w-full sm:h-60 md:h-72 rounded border-2 border-dashed border-muted-foreground/50 bg-muted/30 flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary cursor-pointer transition-colors"
                        onClick={() => {setIsEditing(true); handleOpenCameraModal();}}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') {setIsEditing(true); handleOpenCameraModal();} }}
                        role="button"
                        tabIndex={0}
                        aria-label={t('product_add_capture_image_aria')}
                        data-ai-hint="product photography"
                    >
                        <ImageIconLucide className="h-10 w-10 sm:h-12 sm:w-12 mb-2 text-primary" />
                        <p className="text-xs sm:text-sm font-medium text-primary">{t('product_add_capture_image_text')}</p>
                    </div>
                ) : (!isEditing && product.imageUrl) ? (
                     <div className="mt-2 relative h-48 w-full sm:h-60 md:h-72 rounded overflow-hidden border bg-muted/20" data-ai-hint="product photo">
                        <NextImage src={product.imageUrl} alt={product.shortName || product.description || ''} layout="fill" objectFit="contain" />
                    </div>
                ): null }
                 {isEditing && editedProduct.imageUrl && (
                     <div className="mt-2 relative h-32 w-32 rounded overflow-hidden border bg-muted/20">
                        <NextImage src={editedProduct.imageUrl} alt={t('product_image_preview_alt')} layout="fill" objectFit="contain" />
                    </div>
                 )}
            </div>
        </CardContent>
      </Card>

      <Dialog open={showCameraModal} onOpenChange={(open) => {
            setShowCameraModal(open);
            if (!open) stopCameraStream();
        }}>
            <DialogContent className="sm:max-w-lg p-0">
                <DialogHeader className="p-4 border-b">
                    <DialogTitleComponent>{t('product_capture_image_dialog_title')}</DialogTitleComponent>
                    <DialogDescriptionComponent>{t('product_capture_image_dialog_desc')}</DialogDescriptionComponent>
                </DialogHeader>
                <div className="p-4">
                    {hasCameraPermission === false && (
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <DialogTitleComponent>{t('barcode_scanner_toast_camera_error_title')}</DialogTitleComponent>
                            <DialogDescriptionComponent>
                                {t('barcode_scanner_error_permission_denied_settings')}
                            </DialogDescriptionComponent>
                        </Alert>
                    )}
                    <video ref={videoRef} className={cn("w-full aspect-video rounded-md bg-gray-900", hasCameraPermission === false && "hidden")} playsInline muted autoPlay />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>
                <DialogFooterComponent className="p-4 border-t">
                    <Button variant="outline" onClick={() => { stopCameraStream(); setShowCameraModal(false); }}>{t('cancel_button')}</Button>
                    <Button onClick={captureImage} disabled={!hasCameraPermission || !videoRef.current?.srcObject}>
                        <Camera className="mr-2 h-4 w-4" /> {t('product_capture_image_button')}
                    </Button>
                </DialogFooterComponent>
            </DialogContent>
        </Dialog>
    </div>
  );
}
