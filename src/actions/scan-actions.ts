"use server";

import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/googleai";
import { z } from "zod";
import {
  ScanInvoiceOutputSchema,
  ScanInvoiceOutput,
} from "@/ai/flows/invoice-schemas";
import {
  ScanTaxInvoiceOutputSchema,
  ScanTaxInvoiceOutput,
} from "@/ai/flows/tax-invoice-schemas";

// Initialize Genkit AI instance
const ai = genkit({
  plugins: [googleAI()],
  model: "gemini-pro",
});

// Configuration for Delivery Note extraction
const deliveryNoteExtractionConfig = {
  model: "gemini-pro",
  output: {
    schema: ScanInvoiceOutputSchema,
  },
  prompt:
    "Extract the data from this delivery note. Your response will be in Hebrew.",
};

// Define a schema that matches what the linter expects for a tax invoice result.
const TaxInvoiceResultSchema = z.object({
  supplierName: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  totalAmount: z.number().optional(),
  paymentMethod: z.string().optional(),
  error: z.string().optional(),
});

// Configuration for Tax Invoice extraction
const taxInvoiceExtractionConfig = {
  model: "gemini-pro",
  output: {
    schema: TaxInvoiceResultSchema, // Use the correct local schema
  },
  prompt:
    "Extract the data from this tax invoice. Your response will be in Hebrew.",
};

export async function runScanInvoiceAction(
  base64Image: string
): Promise<ScanInvoiceOutput> {
  console.log("[runScanInvoiceAction] Initiating scan for Delivery Note.");
  try {
    const result = await ai.generate({
      model: deliveryNoteExtractionConfig.model,
      output: deliveryNoteExtractionConfig.output,
      prompt: [
        { text: deliveryNoteExtractionConfig.prompt },
        { media: { url: base64Image } },
      ],
    });
    console.log("[runScanInvoiceAction] Scan successful.");
    return result.output || { products: [], error: "Failed to extract data." };
  } catch (error) {
    console.error(
      "[runScanInvoiceAction] Error during delivery note scan:",
      error
    );
    throw new Error("Failed to scan delivery note.");
  }
}

export async function runScanTaxInvoiceAction(
  base64Image: string
): Promise<ScanTaxInvoiceOutput> {
  console.log("[runScanTaxInvoiceAction] Initiating scan for Tax Invoice.");
  try {
    const result = await ai.generate({
      model: taxInvoiceExtractionConfig.model,
      output: taxInvoiceExtractionConfig.output,
      prompt: [
        { text: taxInvoiceExtractionConfig.prompt },
        { media: { url: base64Image } },
      ],
    });
    console.log("[runScanTaxInvoiceAction] Scan successful.");
    return (
      result.output || {
        supplierName: "",
        invoiceNumber: "",
        invoiceDate: "",
        totalAmount: 0,
        paymentMethod: "",
        error: "Failed to extract data.",
      }
    );
  } catch (error) {
    console.error(
      "[runScanTaxInvoiceAction] Error during tax invoice scan:",
      error
    );
    throw new Error("Failed to scan tax invoice.");
  }
}
