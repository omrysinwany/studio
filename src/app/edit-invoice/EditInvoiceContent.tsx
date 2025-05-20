// src/app/edit-invoice/EditInvoiceContent.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';

import { Loader2, AlertCircle, Edit, Save, PackageIcon, Info as InfoIcon, FileText as FileTextIconLucide } from 'lucide-react'; // הוסרו אייקונים שלא בשימוש ישיר כאן
import { Alert, AlertDescription, AlertTitle as AlertTitleComponent } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Hooks
import { useInvoiceLoader } from './hooks/useInvoiceLoader';
import { useInvoiceStateManager } from './hooks/useInvoiceStateManager';
import { useDialogFlow } from './hooks/useDialogFlow';
import { useInvoiceSaver } from './hooks/useInvoiceSaver';
import { useProductHandlers } from './hooks/useProductHandlers';

// Components
import { InvoiceHeaderCard } from './components/InvoiceHeaderCard';
import { InvoiceImagePreview } from './components/InvoiceImagePreview';
import { InvoiceDetailsForm } from './components/InvoiceDetailsForm';
import { InvoiceDetailsView } from './components/InvoiceDetailsView';
import { ProductsTable } from './components/ProductsTable';
import { PageActionButtons } from './components/PageActionButtons';
import { ManualEntryPrompt } from './components/ManualEntryPrompt';

// Dialog Components
import SupplierConfirmationDialog from '@/components/supplier-confirmation-dialog'; // ודא שהנתיב נכון
import PaymentDueDateDialog from '@/components/payment-due-date-dialog';     // ודא שהנתיב נכון
import BarcodePromptDialog from '@/components/barcode-prompt-dialog';         // ודא שהנתיב נכון
import UnitPriceConfirmationDialog from '@/components/unit-price-confirmation-dialog'; // ודא שהנתיב נכון
import type { InvoiceHistoryItem, EditableProduct } from './types'; // הוספתי EditableProduct

export default function EditInvoiceContent() {
    const { user, loading: authLoading } = useAuth();
    const searchParams = useSearchParams();
    const router = useRouter();
    const { t } = useTranslation();

    const docType = useMemo(() => searchParams.get('docType') as 'deliveryNote' | 'invoice' | null, [searchParams]);

    const loader = useInvoiceLoader({});
    const {
        initialProducts, initialTaxDetails, originalFileName,
        displayedOriginalImageUrl, displayedCompressedImageUrl,
        isNewScan: isNewScanFromLoader, isViewModeInitially,
        isLoading: dataIsLoading, dataError, scanProcessErrorFromLoad,
        initialTempInvoiceId, initialInvoiceIdParam, cleanupTemporaryData,
        aiScannedSupplierNameFromStorage, initialSelectedPaymentDueDate,
        initialDataLoaded
    } = loader;

    const [currentOriginalFileName, setCurrentOriginalFileName] = useState(originalFileName);
    const [currentDisplayedOriginalImageUrl, setCurrentDisplayedOriginalImageUrl] = useState(displayedOriginalImageUrl);
    const [currentDisplayedCompressedImageUrl, setCurrentDisplayedCompressedImageUrl] = useState(displayedCompressedImageUrl);

    useEffect(() => {
        setCurrentOriginalFileName(originalFileName);
    }, [originalFileName]);
    useEffect(() => {
        setCurrentDisplayedOriginalImageUrl(displayedOriginalImageUrl);
    }, [displayedOriginalImageUrl]);
    useEffect(() => {
        setCurrentDisplayedCompressedImageUrl(displayedCompressedImageUrl);
    }, [displayedCompressedImageUrl]);

    const stateManager = useInvoiceStateManager({
        initialProducts,
        initialTaxDetails,
        isViewModeInitially,
        t,
    });
    const {
        products, setProducts, editableTaxInvoiceDetails, setEditableTaxInvoiceDetails,
        handleInputChange, handleTaxInvoiceDetailsChange, isViewMode, setIsViewMode,
        isEditingTaxDetails, toggleEditTaxDetails,
        isEditingDeliveryNoteProducts, toggleEditDeliveryNoteProducts,
        productsForNextStep, setProductsForNextStep,
        scanProcessError: generalScanErrorState,
        setScanProcessError
    } = stateManager;

    const productHandlers = useProductHandlers({
        setProducts,
        setProductsForNextStep,
        t,
        user
    });

    const dialogFlow = useDialogFlow({
        isNewScan: isNewScanFromLoader,
        user,
        docType,
        productsForNextStep: productsForNextStep,
        initialScannedTaxDetails: initialTaxDetails,
        aiScannedSupplierNameFromStorage,
        initialSelectedPaymentDueDate,
        onSupplierConfirmed: (name, _isNew) => {
            setEditableTaxInvoiceDetails(prev => ({ ...prev, supplierName: name }));
        },
        onPaymentDueDateChanged: (date, _option) => {
            setEditableTaxInvoiceDetails(prev => ({ ...prev, paymentDueDate: date }));
        },
        onProductsUpdatedFromDialog: (updatedProducts) => {
            if (updatedProducts) {
                setProducts(updatedProducts);
                setProductsForNextStep(updatedProducts);
            }
        },
        onDialogError: (errorMessage) => setScanProcessError(errorMessage),
        t,
    });

    const saver = useInvoiceSaver({
        user, docType, productsToSave: productsForNextStep.length > 0 ? productsForNextStep : products,
        taxDetailsToSave: editableTaxInvoiceDetails,
        originalFileName: currentOriginalFileName,
        initialTempInvoiceId, initialInvoiceIdParam,
        displayedOriginalImageUrl: currentDisplayedOriginalImageUrl,
        displayedCompressedImageUrl: currentDisplayedCompressedImageUrl,
        isNewScan: isNewScanFromLoader,
        paymentDueDateForSave: dialogFlow.finalizedPaymentDueDate,
        currentDocumentPaymentTermOption: dialogFlow.finalizedPaymentTermOption,
        cleanupTemporaryData, t,
        onSaveSuccess: (savedInvoice: InvoiceHistoryItem) => {
            setIsViewMode(true);
            setProducts(savedInvoice.products?.map(p => ({...p, _originalId: p.id } as EditableProduct)) || []);
            setEditableTaxInvoiceDetails({
                supplierName: savedInvoice.supplierName,
                invoiceNumber: savedInvoice.invoiceNumber,
                totalAmount: savedInvoice.totalAmount,
                invoiceDate: savedInvoice.invoiceDate,
                paymentMethod: savedInvoice.paymentMethod,
                paymentDueDate: savedInvoice.paymentDueDate,
            });
            setCurrentOriginalFileName(savedInvoice.generatedFileName || savedInvoice.originalFileName);
            setCurrentDisplayedOriginalImageUrl(savedInvoice.originalImagePreviewUri || null);
            setCurrentDisplayedCompressedImageUrl(savedInvoice.compressedImageForFinalRecordUri || null);
            setScanProcessError(savedInvoice.errorMessage || null);

            setTimeout(() => {
                if (docType === 'deliveryNote') router.push('/inventory?refresh=true');
                else if (docType === 'invoice') router.push('/invoices?tab=scanned-docs&refresh=true');
            }, 100);
        },
        onSaveError: (errorMsg) => {
            setScanProcessError(errorMsg);
        },
    });

    useEffect(() => {
        if (!authLoading && !user && initialDataLoaded) {
            router.push('/login');
        }
    }, [user, authLoading, router, initialDataLoaded]);

    useEffect(() => {
        console.log('[EditInvoiceContent] useEffect for startInitialDialogFlow. Deps:', {
            initialDataLoaded, dataIsLoading, isNewScanFromLoader: isNewScanFromLoader, userPresent: !!user, currentDialogStep: dialogFlow.currentDialogStep
        });
        if (initialDataLoaded && !dataIsLoading && isNewScanFromLoader && user && dialogFlow.currentDialogStep === 'idle') {
            dialogFlow.startInitialDialogFlow();
        }
    }, [initialDataLoaded, dataIsLoading, isNewScanFromLoader, user, dialogFlow.currentDialogStep, dialogFlow.startInitialDialogFlow]);

    const handleGoBack = () => {
        if (isNewScanFromLoader && !initialInvoiceIdParam) cleanupTemporaryData();
        router.push( (docType === 'invoice' || (initialInvoiceIdParam && docType !== 'deliveryNote')) ? '/invoices?tab=scanned-docs' : '/inventory');
    };

    const effectiveScanError = generalScanErrorState || scanProcessErrorFromLoad || dialogFlow.dialogFlowError;

    console.log('[EditInvoiceContent] PageActionButtons PROPS (before render):', {
        isSaving: saver.isSaving,
        isViewMode: isViewMode,
        isNewScan: isNewScanFromLoader,
        currentDialogStep: dialogFlow.currentDialogStep,
    });

    if (authLoading || (dataIsLoading && !initialDataLoaded) || (!user && !initialDataLoaded)) {
        return (
            <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2">{t('loading_editor')}...</span>
            </div>
        );
    }

    if (dataError && !dataIsLoading) {
        return (
            <div className="container mx-auto p-4 md:p-8 space-y-4">
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitleComponent>{t('edit_invoice_error_loading_title')}</AlertTitleComponent>
                    <AlertDescription>{dataError || "An unknown error occurred."}</AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleGoBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> {t('edit_invoice_go_back_button')}
                </Button>
            </div>
        );
    }

    const showManualEntryCard = !isNewScanFromLoader && !dataIsLoading && !initialInvoiceIdParam && !initialTempInvoiceId && products.length === 0 && Object.values(editableTaxInvoiceDetails).every(v=>!v);
    if (showManualEntryCard) {
        return <ManualEntryPrompt
                    originalFileName={currentOriginalFileName}
                    docType={docType}
                    scanProcessErrorState={effectiveScanError}
                    productsCount={products.length}
                    t={t}
                />;
    }

    return (
        <div className="container mx-auto p-4 md:p-8 space-y-6">
            <Card className="shadow-md overflow-hidden">
                <InvoiceHeaderCard
                    originalFileName={currentOriginalFileName}
                    docType={docType}
                    isViewMode={isViewMode}
                    isEditingSection={isEditingTaxDetails}
                    onToggleEdit={toggleEditTaxDetails}
                    t={t}
                />
                <CardContent className="p-4 pt-2 space-y-4">
                    {effectiveScanError && !saver.isSaving && (
                        <Alert variant="destructive" className="mt-2">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitleComponent>{t('edit_invoice_scan_process_error_title')}</AlertTitleComponent>
                            <AlertDescription>{effectiveScanError}</AlertDescription>
                        </Alert>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <InvoiceImagePreview
                            displayedOriginalImageUrl={currentDisplayedOriginalImageUrl}
                            displayedCompressedImageUrl={currentDisplayedCompressedImageUrl}
                            t={t}
                        />
                        <div className="md:col-span-1 space-y-3">
                             <Card className="shadow-sm">
                                <CardHeader className="p-3 sm:p-4 flex justify-between items-center">
                                    <CardTitle className="text-base sm:text-lg flex items-center">
                                        <InfoIcon className="mr-2 h-5 w-5 text-primary"/>
                                        {docType === 'deliveryNote' ? t('edit_invoice_delivery_note_details_title') : t('edit_invoice_invoice_details_title')}
                                    </CardTitle>
                                    {!isViewMode && (
                                      <Button variant="ghost" size="icon" onClick={toggleEditTaxDetails} className="h-7 w-7 text-muted-foreground hover:text-primary">
                                        {isEditingTaxDetails ? <Save className="h-4 w-4 text-green-500" /> : <Edit className="h-4 w-4" />}
                                      </Button>
                                    )}
                                </CardHeader>
                                <CardContent className="p-3 sm:p-4">
                                    {isEditingTaxDetails ? (
                                        <InvoiceDetailsForm
                                            editableTaxInvoiceDetails={editableTaxInvoiceDetails}
                                            handleTaxInvoiceDetailsChange={handleTaxInvoiceDetailsChange}
                                            isSaving={saver.isSaving}
                                            selectedPaymentDueDate={dialogFlow.finalizedPaymentDueDate}
                                            onSelectedPaymentDueDateChange={(date) => {
                                                setEditableTaxInvoiceDetails(prev => ({...prev, paymentDueDate: date}));
                                            }}
                                            t={t}
                                        />
                                    ) : (
                                        <InvoiceDetailsView
                                            detailsToDisplay={editableTaxInvoiceDetails}
                                            selectedPaymentDueDate={dialogFlow.finalizedPaymentDueDate}
                                            t={t}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {docType === 'deliveryNote' && (
                <Card className="shadow-md overflow-hidden">
                    <CardHeader className="p-4 flex flex-row items-center justify-between">
                        <div className="flex-1 min-w-0">
                            <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
                                <PackageIcon className="mr-2 h-5 w-5"/>
                                {t('edit_invoice_extracted_products_title')} ({products.length})
                            </CardTitle>
                        </div>
                         {!isViewMode && (
                            <Button variant="ghost" size="icon" onClick={toggleEditDeliveryNoteProducts} className="h-8 w-8 text-muted-foreground hover:text-primary flex-shrink-0">
                                {isEditingDeliveryNoteProducts ? <Save className="h-4 w-4 text-green-600" /> : <Edit className="h-4 w-4" />}
                            </Button>
                        )}
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <ProductsTable
                            products={products}
                            handleInputChange={handleInputChange}
                            isSaving={saver.isSaving}
                            isEditingDeliveryNoteProducts={isEditingDeliveryNoteProducts}
                            onAddRow={productHandlers.handleAddRow}
                            onRemoveRow={productHandlers.handleRemoveRow}
                            t={t}
                        />
                    </CardContent>
                </Card>
            )}

            <PageActionButtons
                isSaving={saver.isSaving}
                isViewMode={isViewMode}
                isNewScan={isNewScanFromLoader}
                currentDialogStep={dialogFlow.currentDialogStep}
                onSave={() => { // ✅ פישוט הלוגיקה של onSave
                    console.log('[EditInvoiceContent] onSave clicked. Current state:', {
                        isSaving: saver.isSaving,
                        isNewScan: isNewScanFromLoader,
                        currentDialogStep: dialogFlow.currentDialogStep,
                        isDialogFlowActive: dialogFlow.isDialogFlowActive
                    });
                    if (!saver.isSaving) { // הכפתור לא אמור להיות לחיץ אם isSaving, אבל זו בדיקה נוספת
                        saver.handleSaveChecks();
                    }
                }}
                onGoBack={handleGoBack}
                docType={docType}
                t={t}
            />

            {/* Dialogs - תיקון שם ה-prop עבור SupplierConfirmationDialog */}
            {dialogFlow.currentDialogStep === 'supplier_confirmation' && dialogFlow.supplierDialogProps && (
                <SupplierConfirmationDialog
                    isOpen={true} // ✅ תוקן ל-isOpen, בהתאם להגדרת הפרופס של הקומפוננטה ששלחת
                    onOpenChange={(isSheetOpen) => {
                        if (!isSheetOpen) {
                            if (dialogFlow.currentDialogStep === 'supplier_confirmation' && dialogFlow.supplierDialogProps) {
                                console.log("[EditInvoiceContent] SupplierConfirmationDialog onOpenChange(false) detected, calling its onCancel.");
                                dialogFlow.supplierDialogProps.onCancel();
                            }
                        }
                    }}
                    potentialSupplierName={dialogFlow.supplierDialogProps.potentialSupplierName}
                    existingSuppliers={dialogFlow.supplierDialogProps.existingSuppliers}
                    onConfirm={dialogFlow.supplierDialogProps.onConfirm}
                    onCancel={dialogFlow.supplierDialogProps.onCancel}
                />
            )}
             {dialogFlow.currentDialogStep === 'supplier_confirmation' && dialogFlow.supplierDialogProps && (
                <SupplierConfirmationDialog
                    isOpen={true} // ✅ תואם ל-SupplierConfirmationDialogProps שהגדרת
                    onOpenChange={(isSheetOpen) => {
                        if (!isSheetOpen) {
                            if (dialogFlow.currentDialogStep === 'supplier_confirmation' && dialogFlow.supplierDialogProps) {
                                dialogFlow.supplierDialogProps.onCancel();
                            }
                        }
                    }}
                    potentialSupplierName={dialogFlow.supplierDialogProps.potentialSupplierName}
                    existingSuppliers={dialogFlow.supplierDialogProps.existingSuppliers}
                    onConfirm={dialogFlow.supplierDialogProps.onConfirm}
                    onCancel={dialogFlow.supplierDialogProps.onCancel}
                />
            )}
            {dialogFlow.currentDialogStep === 'payment_due_date' && dialogFlow.paymentDueDateDialogProps && (
                <PaymentDueDateDialog
                    // 🔴 חשוב מאוד: בדוק מה שם ה-prop שהקומפוננטה הזו מצפה לו (open או isOpen)
                    // שנה בהתאם להגדרת ה-props של PaymentDueDateDialog.tsx
                    isOpen={true} // זו הנחה. אם זה גורם לשגיאה, שנה ל-isOpen או לשם הנכון.
                    onOpenChange={(openState) => { if(!openState && dialogFlow.currentDialogStep === 'payment_due_date') dialogFlow.paymentDueDateDialogProps?.onCancel();}}
                    {...dialogFlow.paymentDueDateDialogProps}
                />
            )}

            {dialogFlow.currentDialogStep === 'new_product_details' && dialogFlow.newProductDetailsDialogProps && (
                <BarcodePromptDialog
                    isOpen={true} // ✅ שינוי נסיוני ל-isOpen. אם זה לא עובד, הקומפוננטה צריכה עדכון.
                    onOpenChange={(openState) => { if(!openState && dialogFlow.currentDialogStep === 'new_product_details') dialogFlow.newProductDetailsDialogProps?.onComplete(null);}}
                    {...dialogFlow.newProductDetailsDialogProps}
                />
            )}

            {saver.priceDiscrepanciesForDialog && saver.productsForPriceDiscrepancyDialog && (
                 <UnitPriceConfirmationDialog
                    isOpen={true} // ✅ ההורה שולט בנראות
                    onOpenChange={(isNowOpen) => { // isNowOpen מגיע מה-Sheet הפנימי של הדיאלוג
                        if (!isNowOpen) {
                            // אם הדיאלוג נסגר (לא דרך כפתורי Confirm/Cancel שלנו),
                            // נתייחס לזה כאל ביטול ונקרא ל-clearPriceDiscrepancies.
                            console.log("[EditInvoiceContent] UnitPriceConfirmationDialog onOpenChange(false) detected, calling saver.clearPriceDiscrepancies.");
                            saver.clearPriceDiscrepancies();
                        }
                        // אין צורך לעדכן כאן את המצב של ההורה (ששולט ב-isOpen),
                        // כי ההורה הוא זה שמחליט מתי הדיאלוג צריך להיות פתוח או סגור.
                        // onOpenChange נועד בעיקר להודיע להורה על אינטראקציית סגירה מהמשתמש.
                    }}
                    discrepancies={saver.priceDiscrepanciesForDialog} // ודא שזה לא null
                    onComplete={saver.resolvePriceDiscrepancies} // onComplete יטפל בלוגיקה של מה לעשות עם התוצאות
                 />
            )}
        </div>
    );
}