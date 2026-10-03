import { z } from 'zod';

// Shared ID schema
export const IdSchema = z.string().uuid();

// Helper for strictly positive number validation (e.g., > 0, finite)
const positiveNumber = z.union([z.string(), z.number()])
  .transform(val => parseFloat(String(val)))
  .refine(val => !isNaN(val) && isFinite(val) && val > 0, { message: "Value must be a finite positive number greater than 0" });

// Helper for non-negative number validation (e.g., >= 0, finite)
const nonNegativeNumber = z.union([z.string(), z.number()])
  .transform(val => parseFloat(String(val)))
  .refine(val => !isNaN(val) && isFinite(val) && val >= 0, { message: "Value must be a finite non-negative number" });

// Manager Sales POST
export const ManagerSalesPostSchema = z.object({
  customerId: IdSchema,
  date: z.string().optional().nullable().or(z.literal("")),
  overridePin: z.string().optional().nullable(),
  items: z.array(z.object({
    productCategory: z.string(),
    brand: z.string().optional().nullable(),
    wireType: z.string().optional().nullable(),
    saudaContractId: z.string().optional().nullable(),
    qty: positiveNumber,
    pricePerKg: positiveNumber,
  })).min(1, "At least one item is required")
});

// Manager Purchase POST
export const ManagerPurchasePostSchema = z.object({
  supplierId: IdSchema,
  qty: positiveNumber,
  pricePerTon: positiveNumber,
  date: z.string().optional().nullable().or(z.literal("")),
});

// Manager Production POST
export const ManagerProductionPostSchema = z.object({
  rawCopperUsed: positiveNumber,
  productCategory: z.string().min(1),
  brand: z.string().optional().nullable(),
  wireType: z.string().optional().nullable(),
  wireProduced: positiveNumber,
  estimatedOverhead: nonNegativeNumber.optional().default(0),
  date: z.string().optional().nullable().or(z.literal("")),
});

// Manager Expense POST
export const ManagerExpensePostSchema = z.object({
  category: z.string().min(1),
  amount: positiveNumber,
  description: z.string().optional().nullable(),
  expenseMonth: z.string().optional().nullable(),
  date: z.string().optional().nullable().or(z.literal("")),
});

// Manager Advances POST
export const ManagerAdvancePostSchema = z.object({
  employeeId: IdSchema,
  amount: positiveNumber,
  reason: z.string().optional().nullable(),
  date: z.string().optional().nullable().or(z.literal("")),
});

// Manager Advances PUT (Repayment)
export const ManagerAdvancePutSchema = z.object({
  employeeId: IdSchema,
  amount: positiveNumber,
});

// Manager Attendance POST
export const ManagerAttendancePostSchema = z.object({
  attendance: z.record(IdSchema, z.object({
    status: z.enum(['Present', 'Absent', 'Half_day', 'Custom']),
    hours: nonNegativeNumber.optional().nullable(),
  })),
  date: z.string().optional().nullable().or(z.literal("")),
});

// Manager Market Price POST
export const ManagerMarketPricePostSchema = z.object({
  price: positiveNumber,
});

// Manager Payments POST
export const ManagerPaymentPostSchema = z.object({
  type: z.enum(['INCOMING', 'OUTGOING']),
  stakeholderId: IdSchema,
  amount: positiveNumber,
  date: z.string().optional().nullable().or(z.literal("")),
  description: z.string().optional().nullable(),
  idempotencyKey: z.string().optional(),
});

// Owner Scrap POST
export const OwnerScrapPostSchema = z.object({
  type: z.enum(['GENERATED', 'SOLD', 'PROCESS_LOSS_ADJUSTMENT']),
  qty: positiveNumber,
  revenue: nonNegativeNumber.optional().default(0),
  notes: z.string().optional().nullable(),
  date: z.string().optional().nullable().or(z.literal("")),
});

// Owner Directory POST (Action: CREATE or UPDATE)
export const OwnerDirectoryPostSchema = z.object({
  action: z.enum(['CREATE', 'UPDATE']),
  type: z.enum(['CUSTOMER', 'SUPPLIER']),
  id: IdSchema.optional(),
  data: z.object({
    name: z.string().min(1),
    contact: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    gst: z.string().optional().nullable(),
    transport: z.string().optional().nullable(), // Customer only
    bankDetails: z.string().optional().nullable(), // Supplier only
  })
});

// Owner Employees POST
export const OwnerEmployeePostSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  baseSalary: positiveNumber,
});

// Owner Employee Detail PUT
export const OwnerEmployeeDetailPutSchema = z.object({
  id: IdSchema,
  newSalary: positiveNumber,
  reason: z.string().min(1),
});
