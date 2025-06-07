// src/ai/flows/scan-tax-invoice.ts
"use server";
/**
 * @fileOverview A flow to scan tax invoices using Gemini and extract invoice-level information.
 *
 * - scanTaxInvoice - A function that handles the tax invoice scanning process.
 * - ScanTaxInvoiceInput - The input type for the scanTaxInvoice function.
 * - ScanTaxInvoiceOutput - The return type for the scanTaxInvoice function.
 */

import { ai } from "@/ai/ai-instance";
import { z } from "genkit";
import {
  ScanTaxInvoiceInputSchema,
  ScanTaxInvoiceOutputSchema,
  TaxInvoicePromptOutputSchema,
} from "./tax-invoice-schemas";
import type {
  ScanTaxInvoiceInput,
  ScanTaxInvoiceOutput,
} from "./tax-invoice-schemas";

export type { ScanTaxInvoiceInput, ScanTaxInvoiceOutput };

export async function scanTaxInvoice(
  input: ScanTaxInvoiceInput
): Promise<ScanTaxInvoiceOutput> {
  try {
    console.log(
      "[scanTaxInvoice Server Action] Received input:",
      input ? "Data URI present" : "No input"
    );
    if (!input || !input.invoiceDataUri) {
      console.error(
        "[scanTaxInvoice Server Action] Error: invoiceDataUri is missing in input."
      );
      return { error: "AI Scan Error: Missing invoice image data." };
    }
    // Removed streamingCallback from the call
    const result = await scanTaxInvoiceFlow(input);
    console.log(
      "[scanTaxInvoice Server Action] Result from flow:",
      result
        ? result.error
          ? `Error: ${result.error}`
          : "Success"
        : "null/undefined result"
    );
    if (!result) {
      return { error: "AI Scan Error: Flow returned no result." };
    }
    return result;
  } catch (error: any) {
    console.error(
      "[scanTaxInvoice Server Action] Unhandled error in scanTaxInvoice:",
      error
    );
    // Ensure a serializable error object is returned
    const errorMessage = error.message || "Unknown error";
    return {
      error: `AI Scan Error: Unhandled server error during tax invoice scan. ${errorMessage}`,
    };
  }
}

const prompt = ai.definePrompt({
  name: "scanTaxInvoicePrompt",
  input: { schema: ScanTaxInvoiceInputSchema },
  output: { schema: TaxInvoicePromptOutputSchema },
  prompt: `
    Analyze the following invoice image and extract the specified details.
    Provide the extracted data as a JSON object.

    Extract the following information if present:
    "supplierName": (string) The name of the supplier or vendor.
    "invoiceNumber": (string) The unique invoice identifier.
    "totalAmount": (number) The final total amount due on the invoice. Extract ONLY the numerical value, no currency symbols. Look for keywords like 'Total', 'Grand Total', 'סהכ לתשלום', 'סה"כ'.
    "invoiceDate": (string) The date written on the invoice document (e.g., 'YYYY-MM-DD', 'DD/MM/YYYY', 'Month DD, YYYY').
    "paymentMethod": (string) The method of payment mentioned, if any (e.g., 'Cash', 'Credit Card', 'Bank Transfer', 'Check', 'מזומן', 'אשראי', 'העברה בנקאית', 'צ׳ק').

    Ensure the entire output is a valid JSON object.
    If a piece of information is not found, you can omit the key or provide a null/empty string value for it.
    NEVER return null or an empty response if the document is an invoice. ALWAYS return a JSON object structured as described.

    Invoice Image: {{media url=invoiceDataUri}}
  `,
});

// Removed streamingCallback from the flow definition
const scanTaxInvoiceFlow = ai.defineFlow<
  ScanTaxInvoiceInput,
  ScanTaxInvoiceOutput
>(
  {
    name: "scanTaxInvoiceFlow",
    inputSchema: ScanTaxInvoiceInputSchema,
    outputSchema: ScanTaxInvoiceOutputSchema,
  },
  async (input) => {
    // Removed streamingCallback from async parameters
    let rawOutputFromAI: z.infer<typeof TaxInvoicePromptOutputSchema> | null =
      null;
    const maxRetries = 3;
    let currentRetry = 0;
    let delay = 1000; // Initial delay 1 second

    while (currentRetry < maxRetries) {
      try {
        // Removed streamingCallback call
        console.log(
          `[scanTaxInvoiceFlow] Attempting AI call, try ${
            currentRetry + 1
          }. Input provided: ${!!input.invoiceDataUri}`
        );
        const { output } = await prompt(input);
        console.log(
          "[scanTaxInvoiceFlow] Raw output from AI:",
          JSON.stringify(output, null, 2)
        );

        const validationResult = TaxInvoicePromptOutputSchema.safeParse(output);

        if (!validationResult.success) {
          console.error(
            "[scanTaxInvoiceFlow] AI output structure validation failed for tax invoice. Received:",
            output,
            "Errors:",
            validationResult.error.flatten()
          );
          if (
            currentRetry < maxRetries - 1 &&
            (output === null || typeof output !== "object")
          ) {
            console.log(
              `[scanTaxInvoiceFlow] AI returned null or non-object for tax invoice, retrying... (Attempt ${
                currentRetry + 1
              })`
            );
            currentRetry++;
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
            continue;
          }
          return {
            error: `AI output validation failed for tax invoice: ${validationResult.error
              .flatten()
              .formErrors.join(", ")}`,
          };
        }
        rawOutputFromAI = validationResult.data;
        break;
      } catch (promptError: any) {
        console.error(
          `[scanTaxInvoiceFlow] Error calling AI prompt for tax invoice (attempt ${
            currentRetry + 1
          }):`,
          promptError.message,
          promptError.stack
        );
        const isServiceUnavailable =
          promptError.message?.includes("503") ||
          promptError.message?.toLowerCase().includes("service unavailable") ||
          promptError.message?.toLowerCase().includes("model is overloaded");
        const isRateLimit =
          promptError.message?.includes("429") ||
          promptError.message?.toLowerCase().includes("rate limit");

        if (
          (isServiceUnavailable || isRateLimit) &&
          currentRetry < maxRetries - 1
        ) {
          currentRetry++;
          // Removed streamingCallback call
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        } else {
          let userErrorMessage = `AI Scan Error: ${
            promptError.message || "Unknown AI error"
          }`;
          if (isServiceUnavailable) {
            userErrorMessage =
              "The AI scanning service is temporarily unavailable for tax invoices due to high demand. Please try again in a few minutes.";
          }
          return { error: userErrorMessage };
        }
      }
    }

    if (!rawOutputFromAI) {
      return {
        error:
          "AI processing failed for tax invoice after multiple retries. The AI service might be temporarily unavailable. Please try again later.",
      };
    }

    // Removed streamingCallback call
    console.log(
      "[scanTaxInvoiceFlow] Successfully processed tax invoice scan. Output:",
      rawOutputFromAI
    );
    return {
      supplierName: rawOutputFromAI.supplierName,
      invoiceNumber: rawOutputFromAI.invoiceNumber,
      totalAmount: rawOutputFromAI.totalAmount,
      invoiceDate: rawOutputFromAI.invoiceDate,
      paymentMethod: rawOutputFromAI.paymentMethod,
    };
  }
);
