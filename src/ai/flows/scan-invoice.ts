// src/ai/flows/scan-invoice.ts
'use server';
/**
 * @fileOverview A flow to scan invoices using Gemini and extract product information.
 *
 * - scanInvoice - A function that handles the invoice scanning process.
 * - ScanInvoiceInput - The input type for the scanInvoice function.
 * - ScanInvoiceOutput - The return type for the scanInvoice function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';
import {
  ScanInvoiceInputSchema,
  ScanInvoiceOutputSchema,
  ExtractedProductSchema,
  FinalProductSchema
} from './invoice-schemas';
import type {
  ScanInvoiceInput,
  ScanInvoiceOutput
} from './invoice-schemas';


export type { ScanInvoiceInput, ScanInvoiceOutput };


export async function scanInvoice(input: ScanInvoiceInput): Promise<ScanInvoiceOutput> {
  return scanInvoiceFlow(input);
}


const prompt = ai.definePrompt({
  name: 'scanInvoicePrompt',
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
    // Output schema from AI matches the extraction request
    schema: z.object({
        products: z.array(ExtractedProductSchema) // Use the Zod schema defined in invoice-schemas.ts
                 .describe('Raw extracted product list from the invoice.'),
    })
  },
  prompt: `
    Analyze the following image and extract information for ALL distinct products found.
    Provide the extracted data as a JSON **object** with a single key named "products".
    The value of the "products" key should be a JSON **array** (list) of JSON objects.
    Each JSON object in the array should represent a single product and contain the following keys:
    "product_name",
    "catalog_number",
    "barcode" (EAN or UPC, include this key only if a barcode is clearly visible for that specific product),
    "quantity",
    "purchase_price",
    "total",
    "description" (include this key only if a description is clearly present for that specific product).

    **IMPORTANT for "quantity":** If there are multiple columns indicating quantity (e.g., one for "Units"/'יח'/'כמות' and another for "Cases"/'ארגזים'/'קרטונים'), ALWAYS extract the value from the column representing **individual units**.

    For the keys "quantity", "purchase_price", and "total", extract ONLY the numerical value (integers or decimals).
    **DO NOT** include any currency symbols (like $, ₪, EUR), commas (unless they are decimal separators if applicable), or any other non-numeric text in the values for these three keys.

    **NEW**: Also, include a key \`short_product_name\` containing a very brief (max 3-4 words) summary or key identifier for the product. If you cannot create a meaningful short name, provide 1-2 relevant keywords instead.

    If a specific piece of information (other than description and barcode) for a product is not found, you can omit that key from that product's JSON object.
    Ensure the output is a valid JSON object.
    If no products are found, return a JSON object with the "products" key set to an empty array: \`{"products": []}\`.
    NEVER return null or an empty response. ALWAYS return a JSON object structured as described.

    Invoice Image: {{media url=invoiceDataUri}}
  `,
});


const scanInvoiceFlow = ai.defineFlow<
  typeof ScanInvoiceInputSchema,
  typeof ScanInvoiceOutputSchema
>({
  name: 'scanInvoiceFlow',
  inputSchema: ScanInvoiceInputSchema,
  outputSchema: ScanInvoiceOutputSchema
}, async input => {
    let rawOutputFromAI: any = null;
    try {
        const { output } = await prompt(input);
        rawOutputFromAI = output; // Store the raw output for logging

        // Defensive check: If AI returns null or not an object, handle it.
        // This scenario should ideally be caught by Genkit's schema validation during the prompt call itself,
        // leading to the catch block. This check is an additional safeguard.
        if (output === null || typeof output !== 'object' || !('products' in output)) {
            console.error('AI returned null or an invalid structure (missing "products" key). Received:', output);
            return {
                products: [],
                error: "AI output was null or malformed. Expected an object with a 'products' array."
            };
        }
        
        // Zod validation for the structure of 'output.products'
        const validationResult = z.object({ products: z.array(ExtractedProductSchema).nullable() }).safeParse(output);

        if (validationResult.success) {
            const productsArray = validationResult.data.products ?? []; // Handle null products array if schema allows
            rawOutputFromAI = { products: productsArray }; 
        } else {
            console.error('AI output structure validation failed after prompt success. Received:', output, 'Errors:', validationResult.error.flatten());
            return {
                products: [],
                error: `AI output validation failed: ${validationResult.error.flatten().formErrors.join(', ')}`
            };
        }

    } catch (promptError: any) {
        console.error('Error calling AI prompt:', promptError, "Raw AI output if available (before error):", rawOutputFromAI);
        
        let userErrorMessage = `Error calling AI: ${promptError.message || 'Unknown AI error'}`;
        // Check for the specific schema validation error where the AI returned null
        if (promptError.message && promptError.message.includes("INVALID_ARGUMENT") && promptError.message.includes("Provided data: null")) {
            userErrorMessage = "The AI model failed to return structured product data. This can happen with unclear images or complex layouts. Please try a clearer image or add products manually.";
        } else if (promptError.message && promptError.message.includes("Schema validation failed")) {
             userErrorMessage = `The AI model's response did not match the expected format. Details: ${promptError.message}`;
        }
        
        return { products: [], error: userErrorMessage };
    }

    try {
        if (!rawOutputFromAI || !Array.isArray(rawOutputFromAI.products)) {
            console.error('Invalid rawOutputFromAI structure before processing:', rawOutputFromAI);
            return { products: [], error: "Internal error: Invalid raw data structure from AI after initial processing." };
        }

        const processedProducts = rawOutputFromAI.products
            .map((rawProduct: z.infer<typeof ExtractedProductSchema>) => {
                const quantity = rawProduct.quantity ?? 0;
                const lineTotal = rawProduct.total ?? 0;
                const purchasePrice = rawProduct.purchase_price ?? 0;

                // Recalculate unitPrice based on lineTotal and quantity, if possible.
                // Otherwise, use the purchase_price if available.
                let unitPrice = 0;
                if (quantity !== 0 && lineTotal !== 0) {
                    unitPrice = parseFloat((lineTotal / quantity).toFixed(2));
                } else if (purchasePrice !== 0) {
                    unitPrice = purchasePrice;
                }


                const description = rawProduct.product_name || rawProduct.description || rawProduct.catalog_number || 'Unknown Product';
                const shortName = rawProduct.short_product_name || description.split(' ').slice(0, 3).join(' ') || rawProduct.catalog_number || undefined;

                const finalProduct: z.infer<typeof FinalProductSchema> = {
                    catalogNumber: rawProduct.catalog_number || 'N/A',
                    barcode: rawProduct.barcode,
                    description: description,
                    shortName: shortName,
                    quantity: quantity,
                    unitPrice: unitPrice, // Use the recalculated/prioritized unit price
                    lineTotal: lineTotal,
                };
                return finalProduct;
            })
            .filter(product => product.catalogNumber !== 'N/A' || product.description !== 'Unknown Product' || product.barcode);

        return { products: processedProducts };

    } catch (processingError: any) {
         console.error('Error processing AI output:', processingError, 'Raw Output for processing:', rawOutputFromAI);
         return { products: [], error: `Error processing AI data: ${(processingError as Error).message || 'Unknown processing error'}` };
    }
});
