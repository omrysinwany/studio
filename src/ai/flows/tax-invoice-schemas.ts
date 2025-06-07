// src/ai/flows/tax-invoice-schemas.ts
// This file defines Zod schemas and their TypeScript types for tax invoice scanning.
// It does not need to be a server module itself, as it's imported by server modules (flows).
import { z } from "genkit";

// Input schema for the AI flow for tax invoices
export const ScanTaxInvoiceInputSchema = z.object({
  invoiceDataUri: z
    .string()
    .describe(
      "A photo of an invoice, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ScanTaxInvoiceInput = z.infer<typeof ScanTaxInvoiceInputSchema>;

// Schema for the raw output from the AI prompt specifically for tax invoices
export const TaxInvoicePromptOutputSchema = z.object({
  supplierName: z
    .string()
    .optional()
    .describe("The supplier's name identified on the document."),
  invoiceNumber: z
    .string()
    .optional()
    .describe("The invoice number found on the document."),
  totalAmount: z
    .number()
    .optional()
    .describe(
      "The final total amount stated on the invoice document, usually including any taxes or VAT. Look for keywords like 'סהכ', 'Total', 'Grand Total', 'סהכ לתשלום'. Extract ONLY the numerical value."
    ),
  invoiceDate: z
    .string()
    .optional()
    .describe(
      "The date appearing on the invoice document (e.g., 'YYYY-MM-DD' or 'DD/MM/YYYY')."
    ),
  paymentMethod: z
    .string()
    .optional()
    .describe(
      "The method of payment indicated on the invoice (e.g., 'Cash', 'Credit Card', 'Bank Transfer', 'Check')."
    ),
});
export type TaxInvoicePromptOutput = z.infer<
  typeof TaxInvoicePromptOutputSchema
>;

// Final output schema for the tax invoice scanning flow
export const ScanTaxInvoiceOutputSchema = TaxInvoicePromptOutputSchema.extend({
  error: z
    .string()
    .optional()
    .describe("An error message if the scan or processing failed."),
});
export type ScanTaxInvoiceOutput = z.infer<typeof ScanTaxInvoiceOutputSchema>;
