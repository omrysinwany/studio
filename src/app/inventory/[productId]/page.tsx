'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { ArrowLeft, Package, Tag, Hash, Layers, Calendar, Loader2, AlertTriangle, Save, X, DollarSign, Trash2, Pencil, Barcode, Camera, TrendingUp, TrendingDown } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import BarcodeScanner from '@/components/barcode-scanner';
import { useTranslation } from '@/hooks/useTranslation';


// Helper to format numbers for display
const formatDisplayNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = true } = options || {};

    if (value === null || value === undefined || isNaN(value)) {
        return (0).toLocaleString(undefined, { 
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
        });
    }

    return value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping,
    });
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
    return String(value); 
};


const formatIntegerQuantity = (
    value: number | undefined | null
): string => {
    if (value === null || value === undefined || isNaN(value)) {
        return formatDisplayNumber(0, { decimals: 0, useGrouping: false });
    }
    return formatDisplayNumber(Math.round(value), { decimals: 0, useGrouping: true });
};

export default function ProductDetailPage() {
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
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productId = params.productId as string;

   const loadProduct = useCallback(async () => {
    if (!productId) return;

    setIsLoading(true);
    setError(null);
    try {
      const data = await getProductByIdService(productId);
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
  }, [productId, toast, t]);


  useEffect(() => {
     loadProduct();
  }, [loadProduct]);

  const handleInputChange = (field: keyof Product, value: string | number) => {
    setEditedProduct(prev => {
      let numericValue: number | string | null | undefined = value; 
      if (field === 'quantity' || field === 'unitPrice' || field === 'salePrice' || field === 'lineTotal' || field === 'minStockLevel' || field === 'maxStockLevel') {
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

      const updated = { ...prev, [field]: numericValue };


      if (field === 'quantity' || field === 'unitPrice') {
          const quantity = Number(updated.quantity) || 0;
          const unitPrice = Number(updated.unitPrice) || 0;
          updated.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
      }

      return updated;
    });
  };

  const handleSave = async () => {
    if (!product || !product.id) return;

    if (editedProduct.salePrice === undefined || editedProduct.salePrice === null || isNaN(Number(editedProduct.salePrice)) || Number(editedProduct.salePrice) <=0) {
        toast({
            title: t('product_detail_toast_invalid_sale_price_title'),
            description: t('product_detail_toast_invalid_sale_price_desc'),
            variant: "destructive"
        });
        return;
    }
    if (editedProduct.minStockLevel !== undefined && editedProduct.minStockLevel !== null && (isNaN(Number(editedProduct.minStockLevel)) || Number(editedProduct.minStockLevel) < 0)) {
      toast({ title: t('product_detail_toast_invalid_min_stock_title'), description: t('product_detail_toast_invalid_min_stock_desc'), variant: "destructive" });
      return;
    }
    if (editedProduct.maxStockLevel !== undefined && editedProduct.maxStockLevel !== null && (isNaN(Number(editedProduct.maxStockLevel)) || Number(editedProduct.maxStockLevel) < 0)) {
      toast({ title: t('product_detail_toast_invalid_max_stock_title'), description: t('product_detail_toast_invalid_max_stock_desc'), variant: "destructive" });
      return;
    }
    if (editedProduct.minStockLevel !== undefined && editedProduct.maxStockLevel !== undefined && Number(editedProduct.minStockLevel) > Number(editedProduct.maxStockLevel)) {
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
        salePrice: Number(editedProduct.salePrice), 
        lineTotal: parseFloat(((Number(editedProduct.quantity) ?? product.quantity) * (Number(editedProduct.unitPrice) ?? product.unitPrice)).toFixed(2)),
        minStockLevel: editedProduct.minStockLevel === undefined ? undefined : Number(editedProduct.minStockLevel),
        maxStockLevel: editedProduct.maxStockLevel === undefined ? undefined : Number(editedProduct.maxStockLevel),
      };

      await updateProductService(product.id, productToSave);
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
    if (!product || !product.id) return;
    setIsDeleting(true);
    try {
      await deleteProductService(product.id);
      toast({
        title: t('product_detail_toast_deleted_title'),
        description: t('product_detail_toast_deleted_desc', { productName: product.shortName || product.description }),
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
      router.back();
   };

   const handleScanBarcode = () => {
       setIsScanning(true);
   };

   const handleBarcodeDetected = (barcodeValue: string) => {
       handleInputChange('barcode', barcodeValue);
       setIsScanning(false);
       toast({
           title: t('product_detail_toast_barcode_scanned_title'),
           description: t('product_detail_toast_barcode_scanned_desc', { barcode: barcodeValue }),
       });
   };


   const renderViewItem = (icon: React.ElementType, labelKey: string, value: string | number | undefined | null, isCurrency: boolean = false, isQuantity: boolean = false, isBarcode: boolean = false, isStockLevel: boolean = false) => {
     const IconComponent = icon;
     let displayValue: string | React.ReactNode = '-';

     if (value !== null && value !== undefined && String(value).trim() !== '') {
        if (typeof value === 'number') {
            if (isCurrency) displayValue = `₪${formatDisplayNumber(value, { decimals: 2, useGrouping: true })}`;
            else if (isQuantity || isStockLevel) displayValue = formatIntegerQuantity(value);
            else displayValue = formatDisplayNumber(value, { decimals: 2, useGrouping: true });
        } else {
            displayValue = value || (isBarcode || isStockLevel ? t('product_detail_not_set') : '-');
        }
     } else {
        displayValue = (isBarcode || isStockLevel || (labelKey === "product_detail_label_sale_price" && isCurrency) || (labelKey === "product_detail_label_unit_price_cost" && isCurrency)) ? t('product_detail_not_set') : '-';
     }


     return (
       <div className="flex items-start space-x-3 py-2">
         <IconComponent className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
         <div className="flex-grow">
           <p className="text-sm font-medium text-muted-foreground">{t(labelKey)}</p>
           <p className="text-base font-semibold">{displayValue}</p>
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

        const isSalePriceField = fieldKey === 'salePrice';


        return (
          <div className="flex items-start space-x-3 py-2">
            <IconComponent className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
            <div className="flex-grow">
              <Label htmlFor={fieldKey} className="text-sm font-medium text-muted-foreground">
                {t(labelKey)} {isSalePriceField && <span className="text-destructive">*</span>}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                    id={fieldKey}
                    type={inputType}
                    value={inputValue}
                    onChange={(e) => handleInputChange(fieldKey, e.target.value)}
                    className="mt-1 h-9 flex-grow"
                    step={inputType === 'number' ? (isCurrency ? '0.01' : '1') : undefined}
                    min={inputType === 'number' ? (isSalePriceField ? '0.01' : (isStockLevel ? "0" : "0")) : undefined}
                    disabled={fieldKey === 'lineTotal' || isSaving || isDeleting}
                    placeholder={isStockLevel ? t('optional_placeholder') : (isSalePriceField ? t('required_placeholder') : "")}
                    required={isSalePriceField}
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


  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 md:p-8 text-center">
         <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <p className="text-xl text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> {t('go_back_button')}
        </Button>
      </div>
    );
  }

  if (!product) {
     return (
       <div className="container mx-auto p-4 md:p-8 text-center">
         <p>{t('product_not_found')}</p>
         <Button variant="outline" onClick={handleBack} className="mt-4">
           <ArrowLeft className="mr-2 h-4 w-4" /> {t('go_back_button')}
         </Button>
       </div>
     );
   }


  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
       <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
         <Button variant="outline" onClick={handleBack} disabled={isSaving || isDeleting}>
           <ArrowLeft className="mr-2 h-4 w-4" /> {t('back_button')}
         </Button>
         <div className="flex gap-2">
             {isEditing ? (
                 <>
                     <Button variant="outline" onClick={handleCancelEdit} disabled={isSaving || isDeleting}>
                         <X className="mr-2 h-4 w-4" /> {t('cancel_button')}
                     </Button>
                     <Button onClick={handleSave} disabled={isSaving || isDeleting}>
                         {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                         {isSaving ? t('saving_button') : t('save_changes_button')}
                     </Button>
                 </>
             ) : (
                 <>
                      <AlertDialog>
                         <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={isDeleting}>
                                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                {isDeleting ? t('deleting_button') : t('delete_button')}
                            </Button>
                         </AlertDialogTrigger>
                         <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>{t('product_detail_delete_confirm_title')}</AlertDialogTitle>
                            <AlertDialogDescription>
                               {t('product_detail_delete_confirm_desc', { productName: product.shortName || product.description })}
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

                     <Button onClick={handleEdit}>
                         <Pencil className="mr-2 h-4 w-4" /> {t('edit_button')}
                     </Button>
                 </>
             )}
        </div>
       </div>

      <Card className="shadow-lg scale-fade-in">
        <CardHeader>
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
                <Label htmlFor="description" className="text-sm font-medium text-muted-foreground pt-2">{t('product_detail_label_full_description')}</Label>
                <Input
                    id="description"
                    value={editedProduct.description || ''}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    className="text-sm h-auto p-0 border-0 shadow-none focus-visible:ring-0 text-muted-foreground"
                    disabled={isSaving || isDeleting}
                  />
                 <Label htmlFor="catalogNumber" className="text-sm font-medium text-muted-foreground pt-2">{t('product_detail_label_catalog_number')}</Label>
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
                 <CardTitle className="text-2xl sm:text-3xl font-bold text-primary">{product.shortName || product.description}</CardTitle>
                 <CardDescription className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground"/>
                    {product.catalogNumber}
                 </CardDescription>
                  {product.shortName && product.description !== product.shortName && (
                     <p className="text-sm text-muted-foreground mt-1">{product.description}</p>
                  )}
               </>
           )}

           {product.quantity <= (product.minStockLevel ?? 10) && product.quantity > 0 && !isEditing && (
                <span className={`mt-2 inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200`}>
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    {t('product_detail_low_stock_badge')}
                </span>
            )}
            {product.quantity === 0 && !isEditing && (
                 <span className={`mt-2 inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`}>
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    {t('product_detail_out_of_stock_badge')}
                </span>
            )}
             {product.maxStockLevel !== undefined && product.quantity > product.maxStockLevel && !isEditing && (
                <span className={`mt-2 inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200`}>
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    {t('product_detail_over_stock_badge')}
                </span>
            )}
        </CardHeader>
        <CardContent className="space-y-1 sm:space-y-2">
           <Separator className="my-4" />

           <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">
             {isEditing ? (
                 <>
                    {renderEditItem(Barcode, "product_detail_label_barcode", editedProduct.barcode, 'barcode', false, false, true)}
                    {renderEditItem(Layers, "product_detail_label_quantity", editedProduct.quantity, 'quantity', false, true)}
                    {renderEditItem(Tag, "product_detail_label_unit_price_cost", editedProduct.unitPrice, 'unitPrice', true)}
                    {renderEditItem(DollarSign, "product_detail_label_sale_price", editedProduct.salePrice, 'salePrice', true)}
                    {renderEditItem(DollarSign, "product_detail_label_line_total_cost", editedProduct.lineTotal, 'lineTotal', true)}
                    {renderEditItem(TrendingDown, "product_detail_label_min_stock", editedProduct.minStockLevel, 'minStockLevel', false, false, false, true)}
                    {renderEditItem(TrendingUp, "product_detail_label_max_stock", editedProduct.maxStockLevel, 'maxStockLevel', false, false, false, true)}
                 </>
             ) : (
                 <>
                    {renderViewItem(Barcode, "product_detail_label_barcode", product.barcode, false, false, true)}
                    {renderViewItem(Layers, "product_detail_label_quantity", product.quantity, false, true)}
                    {renderViewItem(Tag, "product_detail_label_unit_price_cost", product.unitPrice, true)}
                    {renderViewItem(DollarSign, "product_detail_label_sale_price", product.salePrice, true)}
                    {renderViewItem(DollarSign, "product_detail_label_line_total_cost", product.lineTotal, true)}
                    {renderViewItem(TrendingDown, "product_detail_label_min_stock", product.minStockLevel, false, false, false, true)}
                    {renderViewItem(TrendingUp, "product_detail_label_max_stock", product.maxStockLevel, false, false, false, true)}
                 </>
             )}
          </div>
        </CardContent>
      </Card>

      {isScanning && (
        <BarcodeScanner
          onBarcodeDetected={handleBarcodeDetected}
          onClose={() => setIsScanning(false)}
        />
      )}
    </div>
  );
}
