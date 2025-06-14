"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Camera,
  Save,
  X,
  CheckCircle,
  Percent,
  PackagePlus,
  Trash2,
} from "lucide-react";
import BarcodeScanner from "@/components/barcode-scanner";
import type { Product } from "@/services/types";
import { toast } from "@/hooks/use-toast";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

export interface BarcodePromptDialogProps {
  products: Product[]; // These are products identified as NEW or needing sale price
  onComplete: (updatedProducts: Product[] | null) => void; // Returns all initial products, updated, or null if cancelled
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

type SalePriceMethod = "manual" | "percentage";

interface ProductInputState {
  barcode: string;
  salePrice?: number;
  salePriceMethod: SalePriceMethod;
  profitPercentage: string;
}

const BarcodePromptDialog: React.FC<BarcodePromptDialogProps> = ({
  products: initialProductsFromProps,
  onComplete,
  isOpen,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  // Holds the products that are currently being displayed and worked on in the dialog
  const [productsToDisplay, setProductsToDisplay] = useState<Product[]>([]);
  // Holds the input state for each product (barcode, sale price method, sale price, profit percentage)
  const [productInputStates, setProductInputStates] = useState<
    Record<string, ProductInputState>
  >({});
  const [currentScanningProductId, setCurrentScanningProductId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (isOpen) {
      console.log(
        "[BarcodePromptDialog] Opening. Initial products from props:",
        initialProductsFromProps
      );
      // Deep copy to avoid mutating props, ensure unique IDs for internal state
      const uniqueInitialProducts = initialProductsFromProps.map((p) => ({
        ...p,
        id:
          p.id ||
          `temp-dialog-${Date.now()}-${Math.random()
            .toString(36)
            .substring(2, 7)}`,
      }));
      setProductsToDisplay(uniqueInitialProducts);

      setProductInputStates(
        uniqueInitialProducts.reduce((acc, p) => {
          acc[p.id] = {
            barcode: p.barcode || "",
            salePrice: p.salePrice === null ? undefined : p.salePrice,
            salePriceMethod:
              p.salePrice !== undefined ? "manual" : "percentage",
            profitPercentage: "",
          };
          return acc;
        }, {} as Record<string, ProductInputState>)
      );
    } else {
      // Reset when dialog is closed
      setProductsToDisplay([]);
      setProductInputStates({});
      setCurrentScanningProductId(null);
    }
  }, [initialProductsFromProps, isOpen]);

  const handleInputChange = useCallback(
    (
      productId: string,
      field: keyof ProductInputState,
      value: string | number | SalePriceMethod
    ) => {
      setProductInputStates((prevStates) => {
        const product = productsToDisplay.find((p) => p.id === productId); // Use productsToDisplay for current product context
        if (!product) return prevStates;

        const currentState = {
          ...(prevStates[productId] || {
            barcode: product.barcode || "",
            salePrice: product.salePrice,
            salePriceMethod:
              product.salePrice !== undefined ? "manual" : "percentage",
            profitPercentage: "",
          }),
        };

        if (field === "salePrice") {
          const numericValue = parseFloat(String(value));
          currentState.salePrice =
            String(value).trim() === ""
              ? undefined
              : isNaN(numericValue) || numericValue <= 0
              ? undefined
              : numericValue;
        } else if (field === "barcode" || field === "profitPercentage") {
          currentState[field as "barcode" | "profitPercentage"] = String(value);
        } else if (field === "salePriceMethod") {
          currentState.salePriceMethod = value as SalePriceMethod;
        }

        if (currentState.salePriceMethod === "percentage") {
          const percentageStr = currentState.profitPercentage;
          if (product.unitPrice && percentageStr) {
            const percentage = parseFloat(percentageStr);
            if (!isNaN(percentage) && percentage >= 0) {
              currentState.salePrice = parseFloat(
                (product.unitPrice * (1 + percentage / 100)).toFixed(2)
              );
            } else if (percentageStr.trim() === "") {
              currentState.salePrice = undefined; // Clear if percentage is empty
            }
          } else {
            currentState.salePrice = undefined;
          }
        }
        return { ...prevStates, [productId]: currentState };
      });
    },
    [productsToDisplay]
  );

  const handleSalePriceMethodChange = useCallback(
    (productId: string, method: SalePriceMethod) => {
      handleInputChange(productId, "salePriceMethod", method);
    },
    [handleInputChange]
  );

  const handleScanClick = (productId: string) =>
    setCurrentScanningProductId(productId);
  const handleScannerClose = () => setCurrentScanningProductId(null);

  const handleBarcodeDetected = useCallback(
    (barcodeValue: string) => {
      if (currentScanningProductId) {
        handleInputChange(currentScanningProductId, "barcode", barcodeValue);
        toast({
          title: t("barcode_prompt_scan_success_title"),
          description: t("barcode_prompt_scan_success_desc", {
            barcode: barcodeValue,
          }),
        });
      }
      setCurrentScanningProductId(null);
    },
    [currentScanningProductId, handleInputChange, t]
  );

  const validateProductInputs = (productId: string): boolean => {
    const state = productInputStates[productId];
    const product = productsToDisplay.find((p) => p.id === productId);

    if (!state || !product) return false;

    if (
      state.salePrice === undefined ||
      state.salePrice === null ||
      isNaN(Number(state.salePrice)) ||
      Number(state.salePrice) <= 0
    ) {
      toast({
        title: t("barcode_prompt_invalid_sale_price_title"),
        description: t("barcode_prompt_invalid_sale_price_desc", {
          productName: product.shortName || product.description || "",
        }),
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const handleConfirmProduct = useCallback(
    (productId: string) => {
      if (!validateProductInputs(productId)) return;

      setProductsToDisplay((prev) => prev.filter((p) => p.id !== productId));
      const product = productsToDisplay.find((p) => p.id === productId);
      toast({
        title: t("barcode_prompt_details_set_title"),
        description: t("barcode_prompt_details_set_desc", {
          productName: product?.shortName || product?.description || "",
        }),
        variant: "default",
      });
    },
    [productInputStates, productsToDisplay, t]
  );

  const handleSaveAllAndContinue = () => {
    console.log("[BarcodePromptDialog] 'Confirm & Save All' clicked.");

    // First, validate all products currently in display (those not yet confirmed/skipped)
    for (const product of productsToDisplay) {
      if (!validateProductInputs(product.id)) {
        console.warn(
          `[BarcodePromptDialog] Validation failed for product (still in display list): ${
            product.shortName || product.id
          }. Aborting save all.`
        );
        // No need to return all products if one fails validation here. User needs to fix it.
        return;
      }
    }

    // If all currently displayed products are valid (or if productsToDisplay is empty), proceed to build the final list
    const productsToReturn: Product[] = initialProductsFromProps.map(
      (initialProd) => {
        const pId =
          initialProd.id ||
          `temp-dialog-${Date.now()}-${Math.random()
            .toString(36)
            .substring(2, 7)}`; // Ensure pId
        const inputs = productInputStates[pId];
        if (inputs) {
          return {
            ...initialProd,
            id: pId, // Ensure the ID is consistent
            barcode: inputs.barcode || undefined,
            salePrice:
              inputs.salePrice !== undefined &&
              !isNaN(Number(inputs.salePrice)) &&
              Number(inputs.salePrice) > 0
                ? Number(inputs.salePrice)
                : undefined,
          } as Product;
        }
        // If somehow inputs are missing for an initial product, return it as is (should not happen if useEffect initializes correctly)
        return { ...initialProd, id: pId } as Product;
      }
    );

    console.log(
      "[BarcodePromptDialog] productsToReturn BEFORE onComplete:",
      JSON.stringify(productsToReturn, null, 2)
    ); // Added for debugging salePrice
    const productsWithSalePriceCount = productsToReturn.filter(
      (p) => p.salePrice !== undefined
    ).length;

    if (productsWithSalePriceCount === 0 && productsToReturn.length > 0) {
      toast({
        title: t("barcode_prompt_incomplete_details_title"),
        description: t("barcode_prompt_no_valid_prices_to_save_desc"),
        variant: "default",
        duration: 5000,
      });
    } else if (
      productsWithSalePriceCount < productsToReturn.length &&
      productsToReturn.length > 0
    ) {
      toast({
        title: t("barcode_prompt_summary_toast_title"),
        description: t("barcode_prompt_summary_toast_desc_some_set", {
          setCount: productsWithSalePriceCount,
          totalCount: productsToReturn.length,
          skippedCount: productsToReturn.length - productsWithSalePriceCount,
        }),
        variant: "default",
        duration: 5000,
      });
    } else if (
      productsWithSalePriceCount === productsToReturn.length &&
      productsToReturn.length > 0
    ) {
      toast({
        title: t("barcode_prompt_summary_toast_title"),
        description: t("barcode_prompt_summary_toast_desc_all_set", {
          count: productsWithSalePriceCount,
        }),
        variant: "default",
        duration: 5000,
      });
    }

    console.log(
      "[BarcodePromptDialog] Final productsToReturn to onComplete:",
      productsToReturn
    );
    onComplete(productsToReturn);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onComplete(null);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleCancel(); // Treat external close as cancel
        else onOpenChange(open);
      }}
    >
      <SheetContent
        side="bottom"
        className="h-[85vh] sm:h-[90vh] flex flex-col p-0 rounded-t-lg"
      >
        <SheetHeader className="p-4 sm:p-6 border-b shrink-0 sticky top-0 bg-background z-10">
          <SheetTitle className="flex items-center text-lg sm:text-xl">
            <PackagePlus className="mr-2 h-5 w-5 text-primary" />
            {t("barcode_prompt_title")}
          </SheetTitle>
          <SheetDescription className="text-xs sm:text-sm">
            {t("barcode_prompt_description")}
            {productsToDisplay.length > 0
              ? ` (${t("barcode_prompt_remaining", {
                  count: productsToDisplay.length,
                })}).`
              : ` ${t("barcode_prompt_all_reviewed")}`}
          </SheetDescription>
        </SheetHeader>

        {productsToDisplay.length === 0 &&
        initialProductsFromProps.length > 0 ? (
          <div className="flex-grow flex flex-col items-center justify-center p-6 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
            <p className="text-lg font-medium">
              {t("barcode_prompt_all_new_reviewed")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("barcode_prompt_click_save_all")}
            </p>
          </div>
        ) : initialProductsFromProps.length === 0 ? (
          <div className="flex-grow flex flex-col items-center justify-center p-6 text-center">
            <p className="text-lg font-medium">
              {t("barcode_prompt_no_new_products")}
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-grow border-b flex-shrink min-h-0">
            <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {productsToDisplay.map((product) => {
                const state = productInputStates[product.id];
                if (!state) return null; // Should not happen if initialized correctly

                return (
                  <Card
                    key={product.id}
                    className="bg-card shadow-sm rounded-md flex flex-col"
                  >
                    <CardHeader className="p-3 sm:p-4 pb-2 sm:pb-3">
                      <CardTitle className="text-base sm:text-lg font-semibold leading-tight">
                        {product.shortName || product.description}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t("barcode_prompt_product_catalog")}:{" "}
                        {product.catalogNumber || "N/A"} |{" "}
                        {t("barcode_prompt_product_qty")}: {product.quantity} |{" "}
                        {t("barcode_prompt_product_cost")}:{" "}
                        {product.unitPrice !== undefined
                          ? `${t("currency_symbol")}${product.unitPrice.toFixed(
                              2
                            )}`
                          : "N/A"}
                      </p>
                    </CardHeader>
                    <CardContent className="p-3 sm:p-4 pt-0 space-y-3 flex-grow">
                      <Separator className="my-2" />
                      <div>
                        <Label
                          htmlFor={`barcode-${product.id}`}
                          className="text-xs sm:text-sm font-medium"
                        >
                          {t("barcode_prompt_barcode_label")}
                        </Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            id={`barcode-${product.id}`}
                            value={state.barcode}
                            onChange={(e) =>
                              handleInputChange(
                                product.id,
                                "barcode",
                                e.target.value
                              )
                            }
                            placeholder={t(
                              "barcode_prompt_barcode_placeholder"
                            )}
                            className="h-9 text-sm"
                            aria-label={t("barcode_prompt_barcode_aria", {
                              productName:
                                product.shortName || product.description || "",
                            })}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => handleScanClick(product.id)}
                            className="h-9 w-9 shrink-0"
                            aria-label={t("barcode_prompt_scan_aria", {
                              productName:
                                product.shortName || product.description || "",
                            })}
                          >
                            <Camera className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs sm:text-sm font-medium">
                          {t("barcode_prompt_sale_price_method_label")}{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <RadioGroup
                          value={state.salePriceMethod}
                          onValueChange={(value) =>
                            handleSalePriceMethodChange(
                              product.id,
                              value as SalePriceMethod
                            )
                          }
                          className="flex gap-3 sm:gap-4 pt-1"
                        >
                          <div className="flex items-center space-x-1.5">
                            <RadioGroupItem
                              value="manual"
                              id={`manual-${product.id}`}
                            />
                            <Label
                              htmlFor={`manual-${product.id}`}
                              className="text-xs sm:text-sm font-normal cursor-pointer"
                            >
                              {t("barcode_prompt_manual_entry")}
                            </Label>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <RadioGroupItem
                              value="percentage"
                              id={`percentage-${product.id}`}
                            />
                            <Label
                              htmlFor={`percentage-${product.id}`}
                              className="text-xs sm:text-sm font-normal cursor-pointer"
                            >
                              {t("barcode_prompt_profit_percentage")}
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>

                      {state.salePriceMethod === "manual" && (
                        <div>
                          <Label
                            htmlFor={`salePrice-${product.id}`}
                            className="text-xs sm:text-sm font-medium"
                          >
                            {t("barcode_prompt_sale_price_label")}{" "}
                            <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id={`salePrice-${product.id}`}
                            type="number"
                            value={
                              state.salePrice === undefined ||
                              state.salePrice === null
                                ? ""
                                : String(state.salePrice)
                            }
                            onChange={(e) =>
                              handleInputChange(
                                product.id,
                                "salePrice",
                                e.target.value
                              )
                            }
                            placeholder={t(
                              "barcode_prompt_sale_price_placeholder"
                            )}
                            min="0.01"
                            step="0.01"
                            className="h-9 text-sm mt-1"
                            aria-label={t("barcode_prompt_sale_price_aria", {
                              productName:
                                product.shortName || product.description || "",
                            })}
                            required
                          />
                        </div>
                      )}

                      {state.salePriceMethod === "percentage" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 items-end">
                          <div>
                            <Label
                              htmlFor={`profitPercentage-${product.id}`}
                              className="text-xs sm:text-sm font-medium"
                            >
                              {t("barcode_prompt_profit_margin_label")}{" "}
                              <span className="text-destructive">*</span>
                            </Label>
                            <div className="relative mt-1">
                              <Input
                                id={`profitPercentage-${product.id}`}
                                type="number"
                                value={state.profitPercentage}
                                onChange={(e) =>
                                  handleInputChange(
                                    product.id,
                                    "profitPercentage",
                                    e.target.value
                                  )
                                }
                                placeholder={t(
                                  "barcode_prompt_profit_margin_placeholder"
                                )}
                                min="0"
                                step="0.1"
                                className="h-9 text-sm pl-3 pr-7"
                                aria-label={t(
                                  "barcode_prompt_profit_margin_aria",
                                  {
                                    productName:
                                      product.shortName ||
                                      product.description ||
                                      "",
                                  }
                                )}
                                required
                              />
                              <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs sm:text-sm font-medium">
                              {t("barcode_prompt_calculated_sale_price_label")}
                            </Label>
                            <Input
                              type="text"
                              value={
                                state.salePrice === undefined
                                  ? t("invoices_na")
                                  : `${t(
                                      "currency_symbol"
                                    )}${state.salePrice.toFixed(2)}`
                              }
                              readOnly
                              disabled
                              className="h-9 text-sm mt-1 bg-muted/50"
                              aria-label={t(
                                "barcode_prompt_calculated_sale_price_aria",
                                {
                                  productName:
                                    product.shortName ||
                                    product.description ||
                                    "",
                                }
                              )}
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                    <div className="p-3 sm:p-4 pt-2 border-t">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => handleConfirmProduct(product.id)}
                        className="w-full text-xs sm:text-sm h-9 bg-primary hover:bg-primary/90"
                        disabled={
                          state.salePrice === undefined ||
                          isNaN(Number(state.salePrice)) ||
                          Number(state.salePrice) <= 0
                        }
                      >
                        <CheckCircle className="mr-1.5 h-4 w-4" />
                        {t("barcode_prompt_confirm_button")}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <SheetFooter className="p-3 sm:p-4 border-t flex flex-col sm:flex-row gap-2 shrink-0 sticky bottom-0 bg-background z-10">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10"
          >
            <X className="mr-1.5 h-4 w-4" /> {t("barcode_prompt_cancel_button")}
          </Button>
          <Button
            onClick={handleSaveAllAndContinue}
            className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10 bg-accent hover:bg-accent/90"
            disabled={
              initialProductsFromProps.length === 0 &&
              productsToDisplay.length === 0
            }
          >
            <Save className="mr-1.5 h-4 w-4" />
            {t("barcode_prompt_save_all_button")}
          </Button>
        </SheetFooter>
      </SheetContent>

      {currentScanningProductId && (
        <BarcodeScanner
          onBarcodeDetected={handleBarcodeDetected}
          onClose={handleScannerClose}
        />
      )}
    </Sheet>
  );
};

export default BarcodePromptDialog;
