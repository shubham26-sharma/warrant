import { z } from "zod";

export const CartSchema = z.object({
  merchantId: z.string().min(1),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  lineItems: z.array(z.object({
    productId: z.string().min(1),
    title: z.string(),
    description: z.string().optional(),
    quantity: z.number().int().positive(),
    unitPriceCents: z.number().int().nonnegative(),
    attributes: z.record(z.string(), z.string().nullable()).refine(
      (attributes) => Object.hasOwn(attributes, "size") && Object.hasOwn(attributes, "material"),
      "Attributes must include size and material",
    ),
  })).min(1),
  subtotalCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  deliveryDays: z.number().int().positive().nullable(),
});

export type Cart = z.infer<typeof CartSchema>;
