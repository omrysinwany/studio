import { useState, useEffect, useCallback } from "react";
import type { EditableProduct, EditableTaxInvoiceDetails } from "../types";
import { useToast } from "@/hooks/use-toast"; // For local save notifications
import { Timestamp } from "firebase/firestore";

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
  setEditableTaxInvoiceDetails: React.Dispatch<
    React.SetStateAction<EditableTaxInvoiceDetails>
  >;
  initialScannedProducts: EditableProduct[]; // For cancel edit products
  initialScannedTaxDetails: EditableTaxInvoiceDetails; // For cancel edit tax details

  handleInputChange: (
    id: string,
    field: keyof EditableProduct,
    value: string | number
  ) => void;
  handleTaxInvoiceDetailsChange: (
    field: keyof EditableTaxInvoiceDetails,
    value: string | number | undefined | Date | Timestamp
  ) => void; // Timestamp added

  isViewMode: boolean;
  setIsViewMode: React.Dispatch<React.SetStateAction<boolean>>;

  // For dialogs that modify products before main save
  productsForNextStep: EditableProduct[];
  setProductsForNextStep: React.Dispatch<
    React.SetStateAction<EditableProduct[]>
  >;
  scanProcessError: string | null; // General error from scan or processing steps not related to initial load
  setScanProcessError: React.Dispatch<React.SetStateAction<string | null>>;
  handleCancelEdit: () => void; // Added handleCancelEdit
}
// Helper for formatting input values, can be moved to a utils file if used elsewhere
const formatInputValue = (
  value: number | undefined | null,
  fieldType: "currency" | "quantity" | "stockLevel"
): string => {
  if (
    (fieldType === "currency" || fieldType === "stockLevel") &&
    (value === undefined || value === null)
  ) {
    return "";
  }
  if (value === null || value === undefined || isNaN(value)) {
    return fieldType === "currency" ? `0.00` : "0";
  }
  if (fieldType === "currency") {
    return parseFloat(String(value)).toFixed(2);
  }
  if (fieldType === "quantity") {
    // Preserve decimals for quantity
    return String(value);
  }
  // For stockLevel, rounding is fine
  return String(Math.round(value));
};

export function useInvoiceStateManager({
  initialProducts = [],
  initialTaxDetails = {},
  isViewModeInitially,
  t,
}: UseInvoiceStateManagerProps): UseInvoiceStateManagerReturn {
  console.log(
    "[useInvoiceStateManager] Initializing. isViewModeInitially:",
    isViewModeInitially
  );
  const { toast } = useToast();
  const [products, setProducts] = useState<EditableProduct[]>(initialProducts);
  const [editableTaxInvoiceDetails, setEditableTaxInvoiceDetails] =
    useState<EditableTaxInvoiceDetails>(initialTaxDetails);
  // These store the state "as loaded" or "as last saved in section" for cancellation
  const [initialScannedProducts, setInitialScannedProducts] =
    useState<EditableProduct[]>(initialProducts);
  const [initialScannedTaxDetails, setInitialScannedTaxDetails] =
    useState<EditableTaxInvoiceDetails>(initialTaxDetails);

  const [isViewMode, setIsViewMode] = useState(isViewModeInitially);

  const [productsForNextStep, setProductsForNextStep] =
    useState<EditableProduct[]>(initialProducts);
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
    console.log(
      "[useInvoiceStateManager] isViewMode state changed to:",
      isViewMode
    );
  }, [isViewMode]);

  useEffect(() => {
    console.log(
      "[useInvoiceStateManager] isViewModeInitially prop changed or initial setup. New value:",
      isViewModeInitially,
      "Setting isViewMode."
    );
    setIsViewMode(isViewModeInitially);
    // When global view mode changes (e.g. initial load, after save, after cancel),
    // individual section edit states are implicitly handled by isViewMode.
  }, [isViewModeInitially]);

  const handleInputChange = useCallback(
    (id: string, field: keyof EditableProduct, value: string | number) => {
      setProducts((prevProducts) =>
        prevProducts.map((p) => {
          if (p.id === id) {
            const updatedProduct = { ...p };
            let numericValue: number | string | null | undefined = value;
            if (
              [
                "quantity",
                "unitPrice",
                "lineTotal",
                "minStockLevel",
                "maxStockLevel",
                "salePrice",
              ].includes(field as string)
            ) {
              const stringValue = String(value);
              if (
                (field === "minStockLevel" ||
                  field === "maxStockLevel" ||
                  field === "salePrice") &&
                stringValue.trim() === ""
              )
                numericValue = undefined;
              else {
                numericValue = parseFloat(stringValue.replace(/,/g, ""));
                if (isNaN(numericValue as number))
                  numericValue =
                    field === "minStockLevel" ||
                    field === "maxStockLevel" ||
                    field === "salePrice"
                      ? undefined
                      : 0;
              }
              (updatedProduct as any)[field] = numericValue;
            } else (updatedProduct as any)[field] = value;

            const currentQuantity = Number(updatedProduct.quantity) || 0;
            let currentUnitPrice =
              updatedProduct.unitPrice !== undefined &&
              updatedProduct.unitPrice !== null &&
              !isNaN(Number(updatedProduct.unitPrice))
                ? Number(updatedProduct.unitPrice)
                : 0;
            let currentLineTotal = Number(updatedProduct.lineTotal) || 0;

            if (field === "quantity" || field === "unitPrice") {
              if (currentQuantity > 0 && currentUnitPrice >= 0)
                currentLineTotal = parseFloat(
                  (currentQuantity * currentUnitPrice).toFixed(2)
                );
              else if (
                (field === "unitPrice" &&
                  currentUnitPrice === 0 &&
                  currentQuantity > 0) ||
                (field === "quantity" && currentQuantity === 0)
              )
                currentLineTotal = 0;
              updatedProduct.lineTotal = currentLineTotal;
            } else if (field === "lineTotal") {
              if (currentQuantity > 0 && currentLineTotal >= 0) {
                currentUnitPrice = parseFloat(
                  (currentLineTotal / currentQuantity).toFixed(2)
                );
                updatedProduct.unitPrice = currentUnitPrice;
              } else if (currentLineTotal === 0) updatedProduct.unitPrice = 0;
            }
            if (currentQuantity === 0 || currentUnitPrice === 0)
              updatedProduct.lineTotal = 0;
            if (
              currentQuantity > 0 &&
              currentLineTotal > 0 &&
              field !== "unitPrice" &&
              currentUnitPrice === 0
            )
              updatedProduct.unitPrice = parseFloat(
                (currentLineTotal / currentQuantity).toFixed(2)
              );
            return updatedProduct;
          }
          return p;
        })
      );
      // Also update productsForNextStep if it's meant to be in sync during editing
      // This might need more careful consideration if productsForNextStep is used by dialogs
      // while main product list is also being edited. For now, a simple sync:
      setProductsForNextStep((prev) =>
        prev.map((p) => {
          if (p.id === id) {
            const changedProduct = { ...p, [field]: value };
            // Re-calculate lineTotal/unitPrice if quantity/unitPrice/lineTotal changed, similar to above logic
            // This is a simplified version, ensure it covers all cases if complex interactions are needed
            if (
              ["quantity", "unitPrice", "lineTotal"].includes(field as string)
            ) {
              const cq = Number(changedProduct.quantity) || 0;
              let cup =
                changedProduct.unitPrice !== undefined &&
                changedProduct.unitPrice !== null &&
                !isNaN(Number(changedProduct.unitPrice))
                  ? Number(changedProduct.unitPrice)
                  : 0;
              let clt = Number(changedProduct.lineTotal) || 0;

              if (field === "quantity" || field === "unitPrice") {
                if (cq > 0 && cup >= 0) clt = parseFloat((cq * cup).toFixed(2));
                else if (
                  (field === "unitPrice" && cup === 0 && cq > 0) ||
                  (field === "quantity" && cq === 0)
                )
                  clt = 0;
                (changedProduct as any).lineTotal = clt;
              } else if (field === "lineTotal") {
                if (cq > 0 && clt >= 0) {
                  cup = parseFloat((clt / cq).toFixed(2));
                  (changedProduct as any).unitPrice = cup;
                } else if (clt === 0) (changedProduct as any).unitPrice = 0;
              }
              if (cq === 0 || cup === 0) (changedProduct as any).lineTotal = 0;
              if (cq > 0 && clt > 0 && field !== "unitPrice" && cup === 0)
                (changedProduct as any).unitPrice = parseFloat(
                  (clt / cq).toFixed(2)
                );
            }
            return changedProduct;
          }
          return p;
        })
      );
    },
    []
  );

  const handleTaxInvoiceDetailsChange = useCallback(
    (
      field: keyof EditableTaxInvoiceDetails,
      value: string | number | undefined | Date | Timestamp
    ) => {
      // Timestamp added
      setEditableTaxInvoiceDetails((prev) => ({
        ...prev,
        [field]: value === "" ? null : value,
      }));
    },
    []
  );

  const handleCancelEdit = useCallback(() => {
    setEditableTaxInvoiceDetails({ ...initialScannedTaxDetails });
    setProducts([...initialScannedProducts]);
    setProductsForNextStep([...initialScannedProducts]); // Also reset products for dialog flow
    setIsViewMode(true);
    toast({
      title: t("edit_cancelled_title", { defaultValue: "Edit Cancelled" }),
      description: t("edit_changes_discarded_desc", {
        defaultValue: "Your changes have been discarded.",
      }),
      variant: "default",
    });
  }, [initialScannedTaxDetails, initialScannedProducts, t, toast]);

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
    productsForNextStep,
    setProductsForNextStep,
    scanProcessError,
    setScanProcessError,
    handleCancelEdit,
  };
}
