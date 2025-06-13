"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, Check, X, AlertTriangle, Info } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "@/hooks/useTranslation";
import { toast } from "@/hooks/use-toast";
import type { Supplier } from "@/services/backend";

import {
  format,
  addDays,
  endOfMonth,
  parseISO,
  isValid,
  startOfDay,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Timestamp } from "firebase/firestore";

export type DueDateOption =
  | "immediate"
  | "net30"
  | "net60"
  | "net90"
  | "eom"
  | "custom";

export type SupplierOption = "use_new" | "rename_new" | "select_existing";

export interface SupplierPaymentSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  potentialSupplierNameFromScan?: string;
  potentialOsekMorsheFromScan?: string;
  existingSuppliers: Supplier[];
  initialPaymentTermOption?: DueDateOption | null;
  initialCustomPaymentDate?: Date | undefined;
  invoiceDate?: Date | string | Timestamp | null;
  onSave: (data: {
    confirmedSupplierName: string;
    isNewSupplierFlag: boolean;
    paymentTermOption: DueDateOption | null;
    paymentDueDate: Date | undefined;
    osekMorshe?: string | null;
  }) => Promise<void>;
  onCancel: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const SupplierPaymentSheet: React.FC<SupplierPaymentSheetProps> = ({
  isOpen,
  onOpenChange,
  potentialSupplierNameFromScan,
  potentialOsekMorsheFromScan,
  existingSuppliers,
  initialPaymentTermOption,
  initialCustomPaymentDate,
  invoiceDate,
  onSave,
  onCancel,
  t,
}) => {
  // Supplier State
  const [supplierOption, setSupplierOption] =
    useState<SupplierOption>("use_new");
  const [supplierNameInput, setSupplierNameInput] = useState(
    potentialSupplierNameFromScan || ""
  );
  const [selectedExistingSupplierId, setSelectedExistingSupplierId] =
    useState<string>("");
  const [osekMorsheInput, setOsekMorsheInput] = useState(
    potentialOsekMorsheFromScan || ""
  );

  // Payment Term State
  const [paymentOption, setPaymentOption] = useState<DueDateOption | null>(
    initialPaymentTermOption || "immediate"
  );
  const [customDueDate, setCustomDueDate] = useState<Date | undefined>(
    initialCustomPaymentDate || new Date()
  );

  useEffect(() => {
    if (isOpen) {
      // Reset supplier part
      const hasExistingSuppliers =
        existingSuppliers && existingSuppliers.length > 0;
      const initialSupOpt = potentialSupplierNameFromScan
        ? "use_new"
        : hasExistingSuppliers
        ? "select_existing"
        : "rename_new";
      setSupplierOption(initialSupOpt);
      setSupplierNameInput(potentialSupplierNameFromScan || "");
      setOsekMorsheInput(potentialOsekMorsheFromScan || "");
      setSelectedExistingSupplierId("");

      // Reset payment part
      setPaymentOption(initialPaymentTermOption || "immediate");
      setCustomDueDate(initialCustomPaymentDate || new Date());
      console.log("[SupplierPaymentSheet] Opened. Initial state set.", {
        potentialSupplierNameFromScan,
        initialPaymentTermOption,
      });
    }
  }, [
    isOpen,
    potentialSupplierNameFromScan,
    potentialOsekMorsheFromScan,
    existingSuppliers,
    initialPaymentTermOption,
    initialCustomPaymentDate,
  ]);

  const handleSelectedSupplierChange = (supplierId: string) => {
    setSelectedExistingSupplierId(supplierId);
    const supplier = existingSuppliers.find((s) => s.id === supplierId);
    if (supplier) {
      setOsekMorsheInput(supplier.osekMorshe || "");
      // You could also set payment terms based on the selected supplier here
    }
  };

  const handleSave = async () => {
    let finalSupplierName: string = "";
    let isNew = false;

    if (supplierOption === "use_new") {
      if (!potentialSupplierNameFromScan?.trim()) {
        toast({
          title: t("error_title"),
          description: t("supplier_confirmation_error_empty_name_scanned"),
          variant: "destructive",
        });
        return;
      }
      finalSupplierName = potentialSupplierNameFromScan.trim();
      isNew = true;
    } else if (supplierOption === "rename_new") {
      if (!supplierNameInput.trim()) {
        toast({
          title: t("error_title"),
          description: t("supplier_confirmation_error_empty_name"),
          variant: "destructive",
        });
        return;
      }
      finalSupplierName = supplierNameInput.trim();
      isNew = true;
    } else {
      // select_existing
      const chosenSupplier = existingSuppliers.find(
        (s) => s.id === selectedExistingSupplierId
      );
      if (!chosenSupplier) {
        toast({
          title: t("error_title"),
          description: t("supplier_confirmation_error_select_existing"),
          variant: "destructive",
        });
        return;
      }
      finalSupplierName = chosenSupplier.name;
      isNew = false;
    }

    const finalOsekMorshe = osekMorsheInput.trim() || null;

    let finalPaymentDueDate: Date | undefined;
    let baseDateForCalc: Date;

    if (invoiceDate) {
      if (invoiceDate instanceof Timestamp) {
        baseDateForCalc = invoiceDate.toDate();
      } else if (
        typeof invoiceDate === "string" &&
        isValid(parseISO(invoiceDate))
      ) {
        baseDateForCalc = parseISO(invoiceDate);
      } else if (invoiceDate instanceof Date && isValid(invoiceDate)) {
        baseDateForCalc = invoiceDate;
      } else {
        baseDateForCalc = new Date(); // Fallback
      }
    } else {
      baseDateForCalc = new Date(); // Fallback
    }
    baseDateForCalc = startOfDay(baseDateForCalc);

    if (paymentOption === "custom") {
      if (!customDueDate) {
        toast({
          title: t("error_title"),
          description: t("payment_due_date_custom_date_required"),
          variant: "destructive",
        });
        return;
      }
      finalPaymentDueDate = customDueDate;
    } else if (paymentOption) {
      switch (paymentOption) {
        case "immediate":
          finalPaymentDueDate = new Date();
          break;
        case "net30":
          finalPaymentDueDate = addDays(endOfMonth(baseDateForCalc), 30);
          break;
        case "net60":
          finalPaymentDueDate = addDays(endOfMonth(baseDateForCalc), 60);
          break;
        case "net90":
          finalPaymentDueDate = addDays(endOfMonth(baseDateForCalc), 90);
          break;
        case "eom":
          finalPaymentDueDate = endOfMonth(baseDateForCalc);
          break;
        default:
          finalPaymentDueDate = undefined;
      }
    }

    console.log("[SupplierPaymentSheet] Saving...", {
      finalSupplierName,
      isNew,
      paymentOption,
      finalPaymentDueDate,
      osekMorshe: finalOsekMorshe,
    });
    try {
      await onSave({
        confirmedSupplierName: finalSupplierName,
        isNewSupplierFlag: isNew,
        paymentTermOption: paymentOption,
        paymentDueDate: finalPaymentDueDate,
        osekMorshe: finalOsekMorshe,
      });
      onOpenChange(false); // Close sheet on successful save
    } catch (error) {
      console.error("[SupplierPaymentSheet] onSave callback failed:", error);
      // Toast for error is expected to be handled by the caller (useDialogFlow)
    }
  };

  const handleCancelInternal = () => {
    onCancel();
    onOpenChange(false);
  };

  const paymentOptions: { value: DueDateOption; labelKey: string }[] = [
    { value: "immediate", labelKey: "payment_due_date_option_immediate" },
    { value: "net30", labelKey: "payment_due_date_option_net30" },
    { value: "net60", labelKey: "payment_due_date_option_net60" },
    { value: "net90", labelKey: "payment_due_date_option_net90" },
    { value: "eom", labelKey: "payment_due_date_option_eom" },
    { value: "custom", labelKey: "payment_due_date_option_custom" },
  ];

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleCancelInternal();
        else onOpenChange(open);
      }}
    >
      <SheetContent
        side="bottom"
        className="h-[85vh] sm:h-[90vh] flex flex-col p-0 rounded-t-lg"
      >
        <SheetHeader className="p-4 sm:p-6 border-b shrink-0 sticky top-0 bg-background z-10">
          <SheetTitle className="flex items-center text-lg sm:text-xl">
            <Info className="mr-2 h-5 w-5 text-primary" />
            {t("supplier_payment_sheet_title")}
          </SheetTitle>
          <SheetDescription className="text-xs sm:text-sm">
            {t("supplier_payment_sheet_description")}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-grow">
          <div className="p-4 sm:p-6 space-y-6">
            {/* Supplier Section */}
            <div className="space-y-3">
              <h3 className="text-md font-semibold text-foreground">
                {t("supplier_section_title")}
              </h3>
              <RadioGroup
                value={supplierOption}
                onValueChange={(val) =>
                  setSupplierOption(val as SupplierOption)
                }
                className="space-y-2"
              >
                {potentialSupplierNameFromScan && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="use_new" id="sps_use_new" />
                    <Label
                      htmlFor="sps_use_new"
                      className="font-normal cursor-pointer"
                    >
                      {t("supplier_confirmation_option_use_new", {
                        supplierName: potentialSupplierNameFromScan,
                      })}
                    </Label>
                  </div>
                )}
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="rename_new" id="sps_rename_new" />
                  <Label
                    htmlFor="sps_rename_new"
                    className="font-normal cursor-pointer"
                  >
                    {potentialSupplierNameFromScan
                      ? t("supplier_confirmation_option_rename_new")
                      : t("supplier_confirmation_option_create_new")}
                  </Label>
                </div>
                {supplierOption === "rename_new" && (
                  <Input
                    type="text"
                    value={supplierNameInput}
                    onChange={(e) => setSupplierNameInput(e.target.value)}
                    placeholder={t("supplier_confirmation_rename_placeholder")}
                    className="mt-1 h-9"
                  />
                )}
                {existingSuppliers && existingSuppliers.length > 0 && (
                  <>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem
                        value="select_existing"
                        id="sps_select_existing"
                      />
                      <Label
                        htmlFor="sps_select_existing"
                        className="font-normal cursor-pointer"
                      >
                        {t("supplier_confirmation_option_select_existing")}
                      </Label>
                    </div>
                    {supplierOption === "select_existing" && (
                      <Select
                        value={selectedExistingSupplierId}
                        onValueChange={handleSelectedSupplierChange}
                      >
                        <SelectTrigger className="w-full mt-1 h-9">
                          <SelectValue
                            placeholder={t(
                              "supplier_confirmation_select_existing_placeholder"
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {existingSuppliers.map((s) => (
                            <SelectItem
                              key={s.id || s.name}
                              value={s.id || s.name}
                            >
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </>
                )}
              </RadioGroup>
            </div>

            {/* Osek Morshe Input */}
            <div className="space-y-2 rounded-md border p-4">
              <Label htmlFor="osekMorshe" className="text-lg font-semibold">
                {t("osek_morshe_label")}
              </Label>
              <Input
                id="osekMorshe"
                value={osekMorsheInput}
                onChange={(e) => setOsekMorsheInput(e.target.value)}
                placeholder={t("osek_morshe_placeholder")}
                disabled={supplierOption === "use_new"}
              />
              {supplierOption === "use_new" && (
                <p className="text-xs text-muted-foreground">
                  {t("osek_morshe_scanned_info")}
                </p>
              )}
            </div>

            {/* Payment Terms Section */}
            <div className="space-y-3">
              <h3 className="text-md font-semibold text-foreground">
                {t("payment_terms_section_title")}
              </h3>
              <RadioGroup
                value={paymentOption || ""}
                onValueChange={(val) => setPaymentOption(val as DueDateOption)}
                className="space-y-2"
              >
                {paymentOptions.map((opt) => (
                  <div key={opt.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={opt.value} id={`pts_${opt.value}`} />
                    <Label
                      htmlFor={`pts_${opt.value}`}
                      className="font-normal cursor-pointer"
                    >
                      {t(opt.labelKey)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              {paymentOption === "custom" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal mt-2 h-9",
                        !customDueDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customDueDate ? (
                        format(customDueDate, "PPP")
                      ) : (
                        <span>{t("payment_due_date_pick_date")}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={customDueDate}
                      onSelect={setCustomDueDate}
                      initialFocus
                      disabled={(date) =>
                        date <
                        new Date(new Date().setDate(new Date().getDate() - 1))
                      }
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="p-4 sm:p-6 border-t flex flex-col sm:flex-row gap-2 shrink-0 sticky bottom-0 bg-background z-10">
          <Button
            variant="outline"
            onClick={handleCancelInternal}
            className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10"
          >
            <X className="mr-1.5 h-4 w-4" /> {t("cancel_button")}
          </Button>
          <Button
            onClick={handleSave}
            className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10 bg-primary hover:bg-primary/90"
          >
            <Check className="mr-1.5 h-4 w-4" /> {t("save_button")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default SupplierPaymentSheet;
