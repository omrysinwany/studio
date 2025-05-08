'use client';

import React, { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Save, X, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CreateSupplierSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCreateSupplier: (name: string, contactInfo: { phone?: string; email?: string }) => Promise<void>;
}

const CreateSupplierSheet: React.FC<CreateSupplierSheetProps> = ({
  isOpen,
  onOpenChange,
  onCreateSupplier,
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        title: "Validation Error",
        description: "Supplier name is required.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      await onCreateSupplier(name.trim(), { 
        phone: phone.trim() || undefined, 
        email: email.trim() || undefined 
      });
      // Reset form after successful creation
      setName('');
      setPhone('');
      setEmail('');
    } catch (error: any) {
      // Error toast is handled by the parent `handleCreateSupplier`
      console.error("Error in handleSubmit for create supplier:", error)
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-4 sm:p-6 border-b shrink-0">
          <SheetTitle className="text-lg sm:text-xl flex items-center">
            <PlusCircle className="mr-2 h-5 w-5 text-primary" /> Create New Supplier
          </SheetTitle>
          <SheetDescription className="text-xs sm:text-sm">
            Enter the details for the new supplier.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-grow p-4 sm:p-6 space-y-4 overflow-y-auto">
          <div>
            <Label htmlFor="newSupplierName">Supplier Name <span className="text-destructive">*</span></Label>
            <Input
              id="newSupplierName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Acme Supplies Inc."
              className="mt-1"
              disabled={isSaving}
            />
          </div>
          <div>
            <Label htmlFor="newSupplierPhone">Phone (Optional)</Label>
            <Input
              id="newSupplierPhone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g., 050-1234567"
              className="mt-1"
              disabled={isSaving}
            />
          </div>
          <div>
            <Label htmlFor="newSupplierEmail">Email (Optional)</Label>
            <Input
              id="newSupplierEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g., contact@acmesupplies.com"
              className="mt-1"
              disabled={isSaving}
            />
          </div>
        </div>

        <SheetFooter className="p-4 sm:p-6 border-t flex flex-col sm:flex-row gap-2 shrink-0">
          <SheetClose asChild>
            <Button variant="outline" className="w-full sm:w-auto" disabled={isSaving}>
              <X className="mr-2 h-4 w-4" /> Cancel
            </Button>
          </SheetClose>
          <Button onClick={handleSubmit} className="w-full sm:w-auto" disabled={isSaving || !name.trim()}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Supplier
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default CreateSupplierSheet;