import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import type { SupplierSummary } from "@/services/types";

export type DueDateOption = "immediate" | "net30" | "net60" | "eom" | "custom";

export interface SupplierAndPaymentDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (data: {
    confirmedName: string | null;
    isNew: boolean;
    paymentDueDate?: Date;
    paymentTermOption: DueDateOption | null;
  }) => void;
  onCancel: () => void;
  potentialSupplierName: string;
  existingSuppliers: SupplierSummary[];
}

export function SupplierAndPaymentDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  onCancel,
  potentialSupplierName,
  existingSuppliers,
}: SupplierAndPaymentDialogProps) {
  const [selectedSupplierName, setSelectedSupplierName] = useState<string>("");
  const [isNewSupplier, setIsNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [paymentTermOption, setPaymentTermOption] =
    useState<DueDateOption | null>(null);
  const [customDueDate, setCustomDueDate] = useState<Date | undefined>();

  useEffect(() => {
    if (isOpen) {
      const matchingSupplier = existingSuppliers.find(
        (s) => s.name.toLowerCase() === potentialSupplierName.toLowerCase()
      );
      if (matchingSupplier) {
        setSelectedSupplierName(matchingSupplier.name);
        setIsNewSupplier(false);
      } else {
        setSelectedSupplierName("new");
        setIsNewSupplier(true);
        setNewSupplierName(potentialSupplierName);
      }
      // Reset payment fields
      setPaymentTermOption(null);
      setCustomDueDate(undefined);
    }
  }, [isOpen, potentialSupplierName, existingSuppliers]);

  const handleConfirmClick = () => {
    const finalSupplierName = isNewSupplier
      ? newSupplierName
      : selectedSupplierName;
    if (!finalSupplierName) {
      // Maybe show an error
      return;
    }
    onConfirm({
      confirmedName: finalSupplierName,
      isNew: isNewSupplier,
      paymentDueDate: customDueDate,
      paymentTermOption,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Supplier and Payment Details</DialogTitle>
          <DialogDescription>
            Please verify the supplier and set the payment terms for this
            document.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Supplier Section */}
          <div className="space-y-2">
            <Label htmlFor="supplier-select">Supplier</Label>
            <Select
              value={selectedSupplierName}
              onValueChange={(value) => {
                if (value === "new") {
                  setIsNewSupplier(true);
                  setSelectedSupplierName("new");
                  setNewSupplierName(potentialSupplierName); // Pre-fill with scanned name
                } else {
                  setIsNewSupplier(false);
                  setSelectedSupplierName(value);
                }
              }}
            >
              <SelectTrigger id="supplier-select">
                <SelectValue placeholder="Select a supplier..." />
              </SelectTrigger>
              <SelectContent>
                {existingSuppliers.map((s) => (
                  <SelectItem key={s.id} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
                <SelectItem value="new">-- Create a new supplier --</SelectItem>
              </SelectContent>
            </Select>
            {isNewSupplier && (
              <Input
                placeholder="New supplier name"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                className="mt-2"
              />
            )}
          </div>
          {/* Payment Section */}
          <div className="space-y-2">
            <Label htmlFor="payment-terms">Payment Terms</Label>
            <Select
              onValueChange={(value: DueDateOption) =>
                setPaymentTermOption(value)
              }
            >
              <SelectTrigger id="payment-terms">
                <SelectValue placeholder="Select payment terms..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Immediate</SelectItem>
                <SelectItem value="net30">Net 30</SelectItem>
                <SelectItem value="net60">Net 60</SelectItem>
                <SelectItem value="eom">End of Month</SelectItem>
                <SelectItem value="custom">Custom Date</SelectItem>
              </SelectContent>
            </Select>
            {paymentTermOption === "custom" && (
              <DatePicker
                date={customDueDate}
                setDate={setCustomDueDate}
                className="mt-2"
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirmClick}>Confirm & Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
