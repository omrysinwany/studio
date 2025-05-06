
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
  ExtractedProductSchema, // Import as value
  FinalProductSchema // Import as value
} from './invoice-schemas';
import type { // Keep type exports if used elsewhere
  ScanInvoiceInput,
  ScanInvoiceOutput
} from './invoice-schemas';

// Re-export types for external use if needed by components
// Updated: No need to re-export FinalProductSchema type directly if using z.infer elsewhere
export type { ScanInvoiceInput, ScanInvoiceOutput };
// Expose FinalProductSchema type via z.infer if needed in components:
// import type { FinalProductSchema as FinalProductSchemaType } from '@/ai/flows/invoice-schemas';
// type MyProduct = z.infer<typeof FinalProductSchemaType>;


export async function scanInvoice(input: ScanInvoiceInput): Promise<ScanInvoiceOutput> {
  return scanInvoiceFlow(input);
}


// Updated prompt based on user request
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
  // Updated prompt to prioritize unit quantity, request short name, and barcode
  prompt: `
    Analyze the following image and extract information for ALL distinct products found.
    Provide the extracted data as a JSON **array** (list) of JSON objects.
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
    Ensure the output is a valid JSON array.
    If no products are found, return an empty JSON array [].

    Invoice Image: {{media url=invoiceDataUri}}
  `,
});


const scanInvoiceFlow = ai.defineFlow<
  typeof ScanInvoiceInputSchema,
  typeof ScanInvoiceOutputSchema // Output is the final processed schema
>({
  name: 'scanInvoiceFlow',
  inputSchema: ScanInvoiceInputSchema,
  outputSchema: ScanInvoiceOutputSchema, // Ensure flow output matches final schema
}, async input => {
    // Infer the type for rawOutput products from the ExtractedProductSchema
    let rawOutput: { products: z.infer<typeof ExtractedProductSchema>[] } | null = null;
    try {
        // Call the prompt to get raw extracted data
        const { output } = await prompt(input);

        // Basic validation of the output structure
        // Use Zod schema to parse and validate the structure more reliably
        const validationResult = z.object({ products: z.array(ExtractedProductSchema) }).safeParse(output);

        if (validationResult.success) {
            rawOutput = validationResult.data; // Use validated data
        } else {
            console.error('AI did not return the expected { products: [...] } structure or validation failed. Received:', output, 'Errors:', validationResult.error);
            // Fallback to empty products if structure is wrong or validation fails
            return { products: [] };
        }

    } catch (promptError) {
        console.error('Error calling AI prompt:', promptError);
        // Return empty products on prompt error
        return { products: [] };
    }

    // Process the raw data: calculate unitPrice and map to final schema
    try {
        // Ensure rawOutput and rawOutput.products are valid before mapping
        if (!rawOutput || !Array.isArray(rawOutput.products)) {
            console.error('Invalid rawOutput structure before processing:', rawOutput);
            return { products: [] };
        }

        const processedProducts = rawOutput.products
            .map((rawProduct) => {
                // The Zod schema already validated the structure and types,
                // but we still need to handle potential variations and calculate unitPrice.

                // Defensive parsing just in case Zod validation missed edge cases or types are loose
                const quantity = rawProduct.quantity ?? 0; // quantity is now guaranteed to be a number by Zod
                const lineTotal = rawProduct.total ?? 0; // total is now guaranteed to be a number by Zod
                const purchasePrice = rawProduct.purchase_price ?? 0; // purchase_price is optional number

                // Calculate unit price based on extracted total and quantity
                // Prefer calculation, fallback to purchase_price, then 0
                const calculatedUnitPrice = quantity !== 0 && lineTotal !== 0
                               ? parseFloat((lineTotal / quantity).toFixed(2))
                               : 0; // Default to 0 if calculation not possible

                // Use purchase_price ONLY if calculation is not possible AND purchase_price exists
                const unitPrice = calculatedUnitPrice !== 0 ? calculatedUnitPrice : purchasePrice;


                // Use product_name if available, otherwise fallback to description or catalog number
                const description = rawProduct.product_name || rawProduct.description || rawProduct.catalog_number || 'Unknown Product';

                // Fallback logic for shortName: Use AI's short_product_name, or first 3 words of description, or catalog number
                const shortName = rawProduct.short_product_name || description.split(' ').slice(0, 3).join(' ') || rawProduct.catalog_number || undefined;


                // Construct the final product object conforming to FinalProductSchema
                const finalProduct: z.infer<typeof FinalProductSchema> = {
                    catalogNumber: rawProduct.catalog_number || 'N/A',
                    barcode: rawProduct.barcode, // Include the barcode (optional)
                    description: description,
                    shortName: shortName, // Assign the shortName
                    quantity: quantity, // Use parsed quantity
                    unitPrice: unitPrice, // Use calculated or fallback unit price
                    lineTotal: lineTotal, // Use parsed lineTotal
                };
                return finalProduct;
            })
             // Filter out products that couldn't be meaningfully processed (e.g., no catalog or description or barcode)
            .filter(product => product.catalogNumber !== 'N/A' || product.description !== 'Unknown Product' || product.barcode); // Adjusted filter logic

        return { products: processedProducts };

    } catch (processingError) {
         console.error('Error processing AI output:', processingError, 'Raw Output:', rawOutput);
         // Return empty products if processing fails
         return { products: [] };
    }
});
