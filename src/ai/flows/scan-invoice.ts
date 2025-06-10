// src/ai/flows/scan-invoice.ts
"use server";
/**
 * @fileOverview A flow to scan invoices using Gemini and extract product information.
 *
 * - scanInvoice - A function that handles the invoice scanning process.
 * - ScanInvoiceInput - The input type for the scanInvoice function.
 * - ScanInvoiceOutput - The return type for the scanInvoice function.
 */

import { ai } from "@/ai/ai-instance";
import { z } from "genkit";
import {
  ScanInvoiceInputSchema,
  ScanInvoiceOutputSchema,
  PromptOutputSchema,
  ExtractedProductSchema,
  FinalProductSchema,
} from "./invoice-schemas";
import type {
  ScanInvoiceInput,
  ScanInvoiceOutput,
  PromptOutputType,
} from "./invoice-schemas";

export type { ScanInvoiceInput, ScanInvoiceOutput };

export async function scanInvoice(
  input: ScanInvoiceInput
): Promise<ScanInvoiceOutput> {
  try {
    console.log(
      "[scanInvoice Server Action] Received input:",
      input ? "Data URI present" : "No input"
    );
    if (!input || !input.invoiceDataUri) {
      console.error(
        "[scanInvoice Server Action] Error: invoiceDataUri is missing in input."
      );
      return {
        products: [],
        error: "AI Scan Error: Missing invoice image data.",
      };
    }
    // Removed streamingCallback from the call
    const result = await scanInvoiceFlow(input);
    console.log(
      "[scanInvoice Server Action] Result from flow:",
      result
        ? result.error
          ? `Error: ${result.error}`
          : `${result.products?.length} products`
        : "null/undefined result"
    );
    if (!result) {
      return { products: [], error: "AI Scan Error: Flow returned no result." };
    }
    return result;
  } catch (error: any) {
    console.error(
      "[scanInvoice Server Action] Unhandled error in scanInvoice:",
      error
    );
    // Ensure a serializable error object is returned
    const errorMessage = error.message || "Unknown error";
    return {
      products: [],
      error: `AI Scan Error: Unhandled server error during invoice scan. ${errorMessage}`,
    };
  }
}

const prompt = ai.definePrompt({
  name: "scanInvoicePrompt",
  input: {
    schema: z.object({
      invoiceDataUri: z
        .string()
        .describe(
          "A photo of an invoice, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
        ),
    }),
  },
  output: {
    schema: PromptOutputSchema,
  },
  prompt: `
    Analyze the following image and extract information for ALL distinct products found.
    Provide the extracted data as a JSON **object**.

    This JSON object should have a key named "products" whose value is a JSON **array** (list) of JSON objects.
    Each JSON object in the "products" array should represent a single product. 
    
    For each product, ALWAYS include the following keys:
    "product_name" (string, or provide a relevant short description if no explicit name),
    "catalog_number" (string, if not found, provide an empty string "" or "N/A". Do not use values from 'Reference 2' or 'אסמכתא 2' for this field.),
    "quantity" (number),
    "purchase_price" (number, this is the unit cost price if available),
    "sale_price" (number, include this key only if a sale price is clearly present for that specific product),
    "total" (number, this is the line total for the product: quantity * purchase_price).

    Also include these keys if the information is present:
    "barcode" (EAN or UPC, include this key only if a barcode is clearly visible for that specific product).
    
    **IMPORTANT for "quantity":** If there are multiple columns indicating quantity (e.g., one for "Units"/'יח'/'כמות' and another for "Cases"/'ארגזים'/'קרטונים'), ALWAYS extract the value from the column representing **individual units**.

    For the keys "quantity", "purchase_price", "sale_price", and "total", extract ONLY the numerical value (integers or decimals).
    **DO NOT** include any currency symbols (like $, ₪, EUR), commas (unless they are decimal separators if applicable), or any other non-numeric text in the values for these four keys. 
    If the value is not found for "purchase_price", "sale_price", or "total", you can omit the key or provide a value of 0. For "quantity", if not found, provide 0.

    Include a key \`short_product_name\` containing a very brief (max 3-4 words) summary or key identifier for the product. If you cannot create a meaningful short name, provide 1-2 relevant keywords instead.
    
    Additionally, the main JSON object should also have a key named "invoice_details" if invoice-level information is found.
    The value of "invoice_details" should be a JSON object containing the following optional keys:
    "invoice_number" (string, the invoice number from the document),
    "supplier_name" (string, the supplier's name identified on the document),
    "invoice_total_amount" (number, the final total amount stated on the invoice, typically including keywords like "סהכ לתשלום"),
    "invoice_date" (string, the date written on the invoice document, e.g., 'YYYY-MM-DD', 'DD/MM/YYYY', 'Month DD, YYYY'),
    "osek_morshe" (string, the 'עוסק מורשה' or 'ח.פ.' number of the supplier. This is a crucial identifier for Israeli businesses. Look for labels like "עוסק מורשה", "ח.פ.", "ע.מ.", or "מס' עוסק". It's a 9-digit number),
    "payment_method" (string, the method of payment mentioned, if any, e.g., 'Cash', 'Credit Card', 'Bank Transfer', 'Check')

    Ensure the entire output is a valid JSON object.
    If no products are found, "products" should be an empty array: \`{"products": []}\`.
    If no invoice-level details are found, the "invoice_details" key can be omitted or be an empty object.
    NEVER return null or an empty response. ALWAYS return a JSON object structured as described.

    Invoice Image: {{media url=invoiceDataUri}}
  `,
});

// Removed streamingCallback from the flow definition
const scanInvoiceFlow = ai.defineFlow(
  {
    name: "scanInvoiceFlow",
    inputSchema: ScanInvoiceInputSchema,
    outputSchema: ScanInvoiceOutputSchema,
  },
  async (input: ScanInvoiceInput): Promise<ScanInvoiceOutput> => {
    // Removed streamingCallback from async parameters
    let rawOutputFromAI: PromptOutputType | null = null;
    let productsForOutput: z.infer<typeof FinalProductSchema>[] = [];
    let invoiceDetailsForOutput: Partial<
      Omit<ScanInvoiceOutput, "products" | "error">
    > = {};

    const maxRetries = 3;
    let currentRetry = 0;
    let delay = 1000;

    while (currentRetry < maxRetries) {
      try {
        // Removed streamingCallback call
        console.log(
          `[scanInvoiceFlow] Attempting AI call, try ${
            currentRetry + 1
          }. Input provided: ${!!input.invoiceDataUri}`
        );
        const { output } = await prompt(input);
        console.log(
          "[scanInvoiceFlow] Raw output from AI:",
          JSON.stringify(output, null, 2)
        );

        const validationResult = PromptOutputSchema.safeParse(output);

        if (!validationResult.success) {
          console.error(
            "[scanInvoiceFlow] AI output structure validation failed. Received:",
            output,
            "Errors:",
            validationResult.error.flatten()
          );
          if (
            currentRetry < maxRetries - 1 &&
            (output === null || typeof output !== "object")
          ) {
            console.log(
              `[scanInvoiceFlow] AI returned null or non-object, retrying... (Attempt ${
                currentRetry + 1
              })`
            );
            currentRetry++;
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
            continue;
          }
          return {
            products: [],
            error: `AI output validation failed: ${validationResult.error
              .flatten()
              .formErrors.join(", ")}`,
          };
        }
        rawOutputFromAI = validationResult.data;
        break;
      } catch (promptError: any) {
        console.error(
          `[scanInvoiceFlow] Error calling AI prompt (attempt ${
            currentRetry + 1
          }):`,
          promptError.message,
          promptError.stack,
          "Raw AI output if available (before error):",
          rawOutputFromAI
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
              "The AI scanning service is temporarily unavailable due to high demand. Please try again in a few minutes. If the issue persists, you can add products manually.";
          } else if (
            promptError.message &&
            (promptError.message.includes("INVALID_ARGUMENT") ||
              promptError.message.includes("Parse Error")) &&
            String(promptError.message).includes("Provided data: null")
          ) {
            userErrorMessage =
              "The AI model failed to return structured product data. This can happen with unclear images or complex layouts. Please try a clearer image or add products manually.";
          } else if (
            promptError.message &&
            promptError.message.includes("Schema validation failed")
          ) {
            userErrorMessage = `The AI model's response did not match the expected format. Details: ${promptError.message}`;
          }
          return { products: [], error: userErrorMessage };
        }
      }
    }

    if (!rawOutputFromAI) {
      return {
        products: [],
        error:
          "AI processing failed after multiple retries. The AI service might be temporarily unavailable. Please try again later or add products manually.",
      };
    }

    // Removed streamingCallback call
    console.log("[scanInvoiceFlow] Processing scanned data...");

    try {
      if (!rawOutputFromAI || !Array.isArray(rawOutputFromAI.products)) {
        console.error(
          "[scanInvoiceFlow] Invalid rawOutputFromAI structure before processing product lines:",
          rawOutputFromAI
        );
        return {
          products: [],
          error:
            "Internal error: Invalid raw product data structure from AI after initial processing.",
        };
      }

      productsForOutput = rawOutputFromAI.products
        .map((rawProduct: z.infer<typeof ExtractedProductSchema>) => {
          const quantity = rawProduct.quantity ?? 0;
          const lineTotal = rawProduct.total ?? 0;
          const aiExtractedPurchasePrice = rawProduct.purchase_price;
          const salePrice = rawProduct.sale_price;

          let finalUnitPrice = 0;

          if (quantity > 0 && lineTotal > 0) {
            finalUnitPrice = parseFloat((lineTotal / quantity).toFixed(2));
            if (
              aiExtractedPurchasePrice !== undefined &&
              Math.abs(finalUnitPrice - aiExtractedPurchasePrice) > 0.01
            ) {
              console.warn(
                `[ScanInvoiceFlow] Unit price discrepancy for "${
                  rawProduct.product_name || rawProduct.catalog_number
                }". Calculated from total/qty: ${finalUnitPrice}, AI extracted purchase_price: ${aiExtractedPurchasePrice}. Prioritizing calculated value.`
              );
            }
          } else if (
            aiExtractedPurchasePrice !== undefined &&
            aiExtractedPurchasePrice > 0
          ) {
            finalUnitPrice = aiExtractedPurchasePrice;
            console.log(
              `[ScanInvoiceFlow] Using AI extracted purchase_price (${finalUnitPrice}) for "${
                rawProduct.product_name || rawProduct.catalog_number
              }" as total/quantity calculation was not possible or resulted in zero (qty: ${quantity}, total: ${lineTotal}).`
            );
          } else {
            console.warn(
              `[ScanInvoiceFlow] Could not determine unit price for "${
                rawProduct.product_name || rawProduct.catalog_number
              }". Qty: ${quantity}, Total: ${lineTotal}, AI Purchase Price: ${aiExtractedPurchasePrice}. Setting to 0.`
            );
            finalUnitPrice = 0;
          }

          const description =
            rawProduct.product_name ||
            rawProduct.description ||
            rawProduct.catalog_number ||
            "Unknown Product";
          const shortName =
            rawProduct.short_product_name ||
            description.split(" ").slice(0, 3).join(" ") ||
            rawProduct.catalog_number ||
            undefined;

          const finalProduct: z.infer<typeof FinalProductSchema> = {
            catalogNumber: rawProduct.catalog_number || "N/A",
            barcode: rawProduct.barcode,
            description: description,
            shortName: shortName,
            quantity: quantity,
            unitPrice: finalUnitPrice,
            salePrice: salePrice,
            lineTotal: lineTotal,
            minStockLevel: undefined,
            maxStockLevel: undefined,
          };
          return finalProduct;
        })
        .filter(
          (product) =>
            (product.catalogNumber && product.catalogNumber !== "N/A") ||
            (product.description &&
              product.description !== "Unknown Product") ||
            product.barcode
        );

      if (rawOutputFromAI.invoice_details) {
        invoiceDetailsForOutput.invoiceNumber =
          rawOutputFromAI.invoice_details.invoice_number;
        invoiceDetailsForOutput.supplier =
          rawOutputFromAI.invoice_details.supplier_name;
        invoiceDetailsForOutput.totalAmount =
          rawOutputFromAI.invoice_details.invoice_total_amount;
        invoiceDetailsForOutput.invoiceDate =
          rawOutputFromAI.invoice_details.invoice_date;
        invoiceDetailsForOutput.paymentMethod =
          rawOutputFromAI.invoice_details.payment_method;
        invoiceDetailsForOutput.osekMorshe =
          rawOutputFromAI.invoice_details.osek_morshe;
      }

      // Removed streamingCallback call
      console.log("[scanInvoiceFlow] Successfully processed scan. Output:", {
        products: productsForOutput,
        ...invoiceDetailsForOutput,
      });
      return {
        products: productsForOutput,
        ...invoiceDetailsForOutput,
      };
    } catch (processingError: any) {
      console.error(
        "[scanInvoiceFlow] Error processing AI output:",
        processingError,
        "Raw Output for processing:",
        rawOutputFromAI
      );
      return {
        products: [],
        error: `AI Scan Error: Error processing AI data: ${
          (processingError as Error).message || "Unknown processing error"
        }`,
      };
    }
  }
);
