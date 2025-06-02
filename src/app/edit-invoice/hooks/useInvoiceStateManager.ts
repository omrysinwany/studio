import { useState, useEffect, useCallback } from 'react';
import type { EditableProduct, EditableTaxInvoiceDetails } from '../types';
import { useToast } from '@/hooks/use-toast'; // For local save notifications
import { Timestamp } from 'firebase/firestore';

interface UseInvoiceStateManagerProps {
  initialProducts?: EditableProduct[];
  initialTaxDetails?: EditableTaxInvoiceDetails;
  isViewModeInitially: boolean; // To set initial edit states
  t: (key: string, params?: Record<string, string | number>) => string;
}

export interface UseInvoiceStateManagerReturn {
  products: EditableProduct[];
  setProducts: React.Dispatch<React.SetStateAction<EditableProduct[]>>;
  editableTaxInvoiceDetails: EditableTaxInvoiceDetails;
  setEditableTaxInvoiceDetails: React.Dispatch<React.SetStateAction<EditableTaxInvoiceDetails>>;
  initialScannedProducts: EditableProduct[]; // For cancel edit products
  initialScannedTaxDetails: EditableTaxInvoiceDetails; // For cancel edit tax details

  handleInputChange: (id: string, field: keyof EditableProduct, value: string | number) => void;
  handleTaxInvoiceDetailsChange: (field: keyof EditableTaxInvoiceDetails, value: string | number | undefined | Date | Timestamp) => void; // Timestamp added

  isViewMode: boolean;
  setIsViewMode: React.Dispatch<React.SetStateAction<boolean>>;
  isEditingTaxDetails: boolean;
  toggleEditTaxDetails: () => void; // Handles save/cancel internally for section
  isEditingDeliveryNoteProducts: boolean;
  toggleEditDeliveryNoteProducts: () => void; // Handles save/cancel internally for section

  // For dialogs that modify products before main save
  productsForNextStep: EditableProduct[];
  setProductsForNextStep: React.Dispatch<React.SetStateAction<EditableProduct[]>>;
  scanProcessError: string | null; // General error from scan or processing steps not related to initial load
  setScanProcessError: React.Dispatch<React.SetStateAction<string | null>>;
}
// Helper for formatting input values, can be moved to a utils file if used elsewhere
const formatInputValue = (value: number | undefined | null, fieldType: 'currency' | 'quantity' | 'stockLevel'): string => {
    if ((fieldType === 'currency' || fieldType === 'stockLevel') && (value === undefined || value === null)) {
        return '';
    }
    if (value === null || value === undefined || isNaN(value)) {
        return fieldType === 'currency' ? `0.00` : '0';
    }
    if (fieldType === 'currency') {
    return parseFloat(String(value)).toFixed(2);
    }
    return String(Math.round(value));
};


export function useInvoiceStateManager({
  initialProducts = [],
  initialTaxDetails = {},
  isViewModeInitially,
  t,
}: UseInvoiceStateManagerProps): UseInvoiceStateManagerReturn {
  const { toast } = useToast();
  const [products, setProducts] = useState<EditableProduct[]>(initialProducts);
  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] = useState<EditableTaxInvoiceDetails>(initialTaxDetails);
  // These store the state "as loaded" or "as last saved in section" for cancellation
  const [initialScannedProducts, setInitialScannedProducts] = useState<EditableProduct[]>(initialProducts);
  const [initialScannedTaxDetails, setInitialScannedTaxDetails] = useState<EditableTaxInvoiceDetails>(initialTaxDetails);

  const [isViewMode, setIsViewMode] = useState(isViewModeInitially);
  const [isEditingTaxDetails, setIsEditingTaxDetails] = useState(false);
  const [isEditingDeliveryNoteProducts, setIsEditingDeliveryNoteProducts] = useState(false);

  const [productsForNextStep, setProductsForNextStep] = useState<EditableProduct[]>(initialProducts);
  const [scanProcessError, setScanProcessError] = useState<string | null>(null);


  useEffect(() => {
    setProducts(initialProducts);
    setInitialScannedProducts(initialProducts);
    setProductsForNextStep(initialProducts);
  }, [initialProducts]);

  useEffect(() => {
    setEditableTaxInvoiceDetails(initialTaxDetails);
    setInitialScannedTaxDetails(initialTaxDetails);
  }, [initialTaxDetails]);

  useEffect(() => {
    setIsViewMode(isViewModeInitially);
    // When view mode changes, ensure edit states are reset
    if (isViewModeInitially) {
        setIsEditingTaxDetails(false);
        setIsEditingDeliveryNoteProducts(false);
    }
  }, [isViewModeInitially]);


  const handleInputChange = useCallback((id: string, field: keyof EditableProduct, value: string | number) => {
    setProducts(prevProducts =>
      prevProducts.map(p => {
        if (p.id === id) {
          const updatedProduct = { ...p };
          let numericValue: number | string | null | undefined = value;
          if (['quantity', 'unitPrice', 'lineTotal', 'minStockLevel', 'maxStockLevel', 'salePrice'].includes(field as string)) {
            const stringValue = String(value);
            if ((field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice') && stringValue.trim() === '') numericValue = undefined;
            else {
              numericValue = parseFloat(stringValue.replace(/,/g, ''));
              if (isNaN(numericValue as number)) numericValue = (field === 'minStockLevel' || field === 'maxStockLevel' || field === 'salePrice') ? undefined : 0;
            }
            (updatedProduct as any)[field] = numericValue;
          } else (updatedProduct as any)[field] = value;

          const currentQuantity = Number(updatedProduct.quantity) || 0;
          let currentUnitPrice = (updatedProduct.unitPrice !== undefined && updatedProduct.unitPrice !== null && !isNaN(Number(updatedProduct.unitPrice))) ? Number(updatedProduct.unitPrice) : 0;
          let currentLineTotal = Number(updatedProduct.lineTotal) || 0;

          if (field === 'quantity' || field === 'unitPrice') {
              if (currentQuantity > 0 && currentUnitPrice >= 0 ) currentLineTotal = parseFloat((currentQuantity * currentUnitPrice).toFixed(2));
              else if ((field === 'unitPrice' && currentUnitPrice === 0 && currentQuantity > 0) || (field === 'quantity' && currentQuantity === 0) ) currentLineTotal = 0;
            updatedProduct.lineTotal = currentLineTotal;
          } else if (field === 'lineTotal') {
            if (currentQuantity > 0 && currentLineTotal >= 0) { currentUnitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2)); updatedProduct.unitPrice = currentUnitPrice; }
            else if (currentLineTotal === 0) updatedProduct.unitPrice = 0;
          }
          if (currentQuantity === 0 || currentUnitPrice === 0) updatedProduct.lineTotal = 0;
          if (currentQuantity > 0 && currentLineTotal > 0 && field !== 'unitPrice' && currentUnitPrice === 0) updatedProduct.unitPrice = parseFloat((currentLineTotal / currentQuantity).toFixed(2));
          return updatedProduct;
        }
        return p;
      })
    );
    // Also update productsForNextStep if it's meant to be in sync during editing
    setProductsForNextStep(prev => prev.map(p => p.id === id ? ({...p, [field]: value}) : p )); // Simplified, ensure it matches logic above
  }, []);

  const handleTaxInvoiceDetailsChange = useCallback((field: keyof EditableTaxInvoiceDetails, value: string | number | undefined | Date | Timestamp) => { // Timestamp added
    setEditableTaxInvoiceDetails(prev => ({ ...prev, [field]: value === '' ? null : value }));
  }, []);

  const toggleEditTaxDetails = useCallback(() => {
    if (isEditingTaxDetails) { // Means "Save Section" was clicked
      setInitialScannedTaxDetails({...editableTaxInvoiceDetails}); // Persist changes to the "initial" for this section
      setIsEditingTaxDetails(false);
      toast({ title: t('edit_invoice_toast_section_updated_title'), description: t('edit_invoice_toast_section_updated_desc') });
    } else { // Means "Edit Section" was clicked
      setEditableTaxInvoiceDetails({...initialScannedTaxDetails}); // Restore from last "saved" state for this section
      setIsEditingTaxDetails(true);
      if (isViewMode) setIsViewMode(false);
    }
  }, [isEditingTaxDetails, editableTaxInvoiceDetails, initialScannedTaxDetails, isViewMode, t, toast]);

  const toggleEditDeliveryNoteProducts = useCallback(() => {
    if (isEditingDeliveryNoteProducts) { // "Save Section"
      setInitialScannedProducts([...products]); // Persist current products list
      setProductsForNextStep([...products]);
      setIsEditingDeliveryNoteProducts(false);
      toast({ title: t('edit_invoice_toast_products_updated_title_section'), description: t('edit_invoice_toast_section_updated_desc') });
    } else { // "Edit Section"
      setProducts([...initialScannedProducts]); // Restore from last "saved" state for this section
      setProductsForNextStep([...initialScannedProducts]);
      setIsEditingDeliveryNoteProducts(true);
      if (isViewMode) setIsViewMode(false);
    }
  }, [isEditingDeliveryNoteProducts, products, initialScannedProducts, isViewMode, t, toast]);


  return {
    products,
    setProducts,
    editableTaxInvoiceDetails,
    setEditableTaxInvoiceDetails,
    initialScannedProducts,
    initialScannedTaxDetails,
    handleInputChange,
    handleTaxInvoiceDetailsChange,
    isViewMode,
    setIsViewMode,
    isEditingTaxDetails,
    toggleEditTaxDetails,
    isEditingDeliveryNoteProducts,
    toggleEditDeliveryNoteProducts,
    productsForNextStep,
    setProductsForNextStep,
    scanProcessError,
    setScanProcessError,
  };
}