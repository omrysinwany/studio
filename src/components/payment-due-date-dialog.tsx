'use client';

import React, { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Check, X } from 'lucide-react';
import { format, addDays, endOfMonth, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

export type DueDateOption = 'immediate' | 'net30' | 'net60' | 'eom' | 'custom';

interface PaymentDueDateDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (dueDate: Date | undefined, selectedOption: DueDateOption) => void;
  onCancel: () => void;
}

const PaymentDueDateDialog: React.FC<PaymentDueDateDialogProps> = ({
  isOpen,
  onOpenChange,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [selectedOption, setSelectedOption] = useState<DueDateOption>('immediate');
  const [customDate, setCustomDate] = useState<Date | undefined>(new Date());

  useEffect(() => {
    console.log("[PaymentDueDateDialog] isOpen prop changed to:", isOpen);
    if (isOpen) {
        console.log("[PaymentDueDateDialog] Dialog opened. Resetting to default state (immediate, today).");
        setSelectedOption('immediate');
        setCustomDate(new Date());
    }
  }, [isOpen]);

  const handleConfirm = () => {
    let dueDate: Date | undefined;
    switch (selectedOption) {
      case 'immediate':
        dueDate = new Date();
        break;
      case 'net30':
        dueDate = addDays(new Date(), 30);
        break;
      case 'net60':
        dueDate = addDays(new Date(), 60);
        break;
      case 'eom':
        dueDate = endOfMonth(new Date());
        break;
      case 'custom':
        dueDate = customDate;
        break;
      default:
        dueDate = undefined;
    }
    console.log("[PaymentDueDateDialog] Confirming with option:", selectedOption, "resulting due date:", dueDate);
    onConfirm(dueDate, selectedOption); // Pass selectedOption here
    onOpenChange(false);
  };

  const handleDialogCancel = () => {
    console.log("[PaymentDueDateDialog] Cancelled by user action (Skip or Close button).");
    onCancel();
    onOpenChange(false);
  };
  
  const handleSheetOpenChange = (open: boolean) => {
    console.log("[PaymentDueDateDialog] Sheet onOpenChange called with:", open);
    if (!open) {
        handleDialogCancel();
    } else {
        onOpenChange(open);
    }
  };

  const handleRadioChange = (value: string) => {
    console.log("[PaymentDueDateDialog] Radio option changed to:", value);
    setSelectedOption(value as DueDateOption);
  };
  
  const handleCustomDateChange = (date: Date | undefined) => {
      console.log("[PaymentDueDateDialog] Custom date selected:", date);
      if (date) {
        const today = new Date();
        today.setHours(0,0,0,0); // Compare with start of today
        if (date >= today) {
          setCustomDate(date);
        } else {
            // Optionally show a toast or prevent setting past dates
            console.warn("[PaymentDueDateDialog] Attempted to select a past date.");
            // For now, let's just not update if it's a past date
        }
      } else {
        setCustomDate(undefined);
      }
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleSheetOpenChange}>
      <SheetContent side="bottom" className="h-auto max-h-[80vh] flex flex-col p-0 rounded-t-lg">
        <SheetHeader className="p-4 sm:p-6 border-b shrink-0">
          <SheetTitle className="flex items-center text-lg sm:text-xl">
            {t('payment_due_date_dialog_title')}
          </SheetTitle>
          <SheetDescription className="text-xs sm:text-sm">
            {t('payment_due_date_dialog_description')}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-grow p-4 sm:p-6 space-y-4 overflow-y-auto">
          <RadioGroup value={selectedOption} onValueChange={handleRadioChange} className="space-y-3">
            <div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="immediate" id="due_immediate" />
                <Label htmlFor="due_immediate" className="font-medium cursor-pointer">
                  {t('payment_due_date_option_immediate')}
                </Label>
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="net30" id="due_net30" />
                <Label htmlFor="due_net30" className="font-medium cursor-pointer">
                  {t('payment_due_date_option_net30')}
                </Label>
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="net60" id="due_net60" />
                <Label htmlFor="due_net60" className="font-medium cursor-pointer">
                  {t('payment_due_date_option_net60')}
                </Label>
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="eom" id="due_eom" />
                <Label htmlFor="due_eom" className="font-medium cursor-pointer">
                  {t('payment_due_date_option_eom')}
                </Label>
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="custom" id="due_custom" />
                <Label htmlFor="due_custom" className="font-medium cursor-pointer">
                  {t('payment_due_date_option_custom')}
                </Label>
              </div>
              {selectedOption === 'custom' && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal mt-2 h-9",
                        !customDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customDate ? format(customDate, "PPP") : <span>{t('payment_due_date_pick_date')}</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={customDate}
                      onSelect={handleCustomDateChange}
                      initialFocus
                      disabled={(date) => date < new Date(new Date().setDate(new Date().getDate() -1))}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </RadioGroup>
        </div>

        <SheetFooter className="p-4 sm:p-6 border-t flex flex-col sm:flex-row gap-2 shrink-0">
          <Button variant="outline" onClick={handleDialogCancel} className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
            <X className="mr-2 h-4 w-4" /> {t('payment_due_date_skip_button')}
          </Button>
          <Button onClick={handleConfirm} className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-10">
            <Check className="mr-2 h-4 w-4" /> {t('payment_due_date_confirm_button')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default PaymentDueDateDialog;