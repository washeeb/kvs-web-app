import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Compatibility: the production host runs PostgreSQL older than 15 (and possibly older than 13),
// so IDs are generated in the app rather than with gen_random_uuid(), and no PG15-only syntax is used.
const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Money is stored as integer minor units (e.g. pesewas). */
const money = (name: string) => bigint(name, { mode: "number" });

// ───────────────────────────── Organisations & identity ─────────────────────────────

export const orgType = pgEnum("org_type", ["operator", "customer", "partner"]);

export const organizations = pgTable("organizations", {
  id: id(),
  type: orgType("type").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"),
  website: text("website"),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const departments = pgTable(
  "departments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.organizationId, t.key)],
);

export const users = pgTable("users", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").notNull().default("active"),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaLastStep: bigint("mfa_last_step", { mode: "number" }),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  passwordChangedAt: ts("password_changed_at"),
  lastLoginAt: ts("last_login_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index().on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export const permissionSets = pgTable("permission_sets", {
  id: id(),
  /** null = system template available to every organisation of the matching domain */
  organizationId: uuid("organization_id").references(() => organizations.id),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  domain: orgType("domain").notNull(),
  permissions: text("permissions").array().notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
});

export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    permissionSetId: uuid("permission_set_id").notNull().references(() => permissionSets.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    departmentId: uuid("department_id").references(() => departments.id),
    grantedBy: uuid("granted_by").references(() => users.id),
    createdAt: createdAt(),
  },
  // One grant per user/set/organisation/department; NULL department treated as a value (works before PostgreSQL 15).
  (t) => [
    uniqueIndex("role_assignments_unique").on(
      t.userId,
      t.permissionSetId,
      t.organizationId,
      sql`coalesce(${t.departmentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export const sequences = pgTable("sequences", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

// ───────────────────────────── Settings & audit ─────────────────────────────

export const settings = pgTable(
  "settings",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

export const currencies = pgTable("currencies", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  minorUnits: integer("minor_units").notNull().default(2),
  active: boolean("active").notNull().default(true),
});

export const taxRates = pgTable("tax_rates", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  /** basis points: 1500 = 15% */
  rateBp: integer("rate_bp").notNull(),
  compound: boolean("compound").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    at: ts("at").notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    actorOrgId: uuid("actor_org_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    data: jsonb("data").notNull().default({}),
    ip: text("ip"),
  },
  (t) => [index().on(t.at), index().on(t.targetType, t.targetId)],
);

export const mailOutbox = pgTable("mail_outbox", {
  id: id(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  adapter: text("adapter").notNull(),
  createdAt: createdAt(),
  sentAt: ts("sent_at"),
  lastError: text("last_error"),
});

// ───────────────────────────── Catalogue & stock ─────────────────────────────

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** Optional parent for sub-categories (one level deep keeps the shop menu simple). */
  parentId: uuid("parent_id"),
  /** Service line this category belongs to (see src/content/services.ts). */
  serviceLine: text("service_line"),
  /** Three-letter code used in new SKUs (KV-<code>-00001); defaults from the slug. */
  skuCode: text("sku_code"),
  /** Hidden categories stay on their products but are not offered in the shop. */
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Manufacturers and labels (Hikvision, TP-Link, HP …). */
export const brands = pgTable("brands", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  website: text("website"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Free labels for grouping and search ("wireless", "back to school", "best seller"). */
export const tags = pgTable("tags", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

/**
 * Images for products, categories, brands and service pages. Files are resized and converted in the browser,
 * checked by content on the server and stored outside the app folder as <id>/<width>.<ext>.
 */
export const media = pgTable(
  "media",
  {
    id: id(),
    /** product | category | brand | service | slide */
    ownerType: text("owner_type").notNull(),
    /** Row id, or the service slug for service pages. */
    ownerId: text("owner_id").notNull(),
    /** Widths stored, ascending (e.g. 320, 800, 1600). */
    widths: integer("widths").array().notNull(),
    /** webp | jpg | png */
    ext: text("ext").notNull(),
    /** Size of the largest stored copy. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    /** Text alternative for screen readers and search engines. */
    alt: text("alt").notNull().default(""),
    /** 0 = main image. */
    sortOrder: integer("sort_order").notNull().default(0),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.ownerType, t.ownerId)],
);

/** Home page slider. The picture is a media row (owner type "slide"); dates are inclusive, in Ghana time (GMT). */
export const slides = pgTable("slides", {
  id: id(),
  headline: text("headline").notNull(),
  body: text("body"),
  ctaLabel: text("cta_label"),
  /** A path on this site ("/shop") or an https:// address. */
  ctaHref: text("cta_href"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  /** YYYY-MM-DD; empty = no limit. */
  startsOn: text("starts_on"),
  endsOn: text("ends_on"),
  createdAt: createdAt(),
});

export const products = pgTable("products", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  summary: text("summary"),
  description: text("description"),
  categoryId: uuid("category_id").references(() => categories.id),
  brandId: uuid("brand_id").references(() => brands.id),
  /** Specification sheet shown on the product page: [{ name: "Resolution", value: "4 MP" }, …]. */
  specs: jsonb("specs").$type<{ name: string; value: string }[]>().notNull().default([]),
  /** draft | active | retired — drafts are never shown publicly */
  status: text("status").notNull().default("draft"),
  /** Offer this product to Synclytics (SES) through the partner link. */
  sesSync: boolean("ses_sync").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productTags = pgTable(
  "product_tags",
  {
    productId: uuid("product_id").notNull().references(() => products.id),
    tagId: uuid("tag_id").notNull().references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.productId, t.tagId] }), index().on(t.tagId)],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    priceMinor: money("price_minor").notNull(),
    /** Average cost per unit (weighted on each receipt); shared with SES as the partner cost when synced. */
    costMinor: money("cost_minor"),
    /** Manufacturer barcode (EAN/UPC) if the item has one; labels use the SKU otherwise. */
    barcode: text("barcode"),
    /** Alert and suggest a purchase when sellable stock falls to this level. */
    reorderPoint: integer("reorder_point"),
    /** Usual quantity to order. */
    reorderQty: integer("reorder_qty"),
    /** Each unit has a serial number, recorded on receipt and on sale (CCTV cameras, laptops …). */
    serialTracked: boolean("serial_tracked").notNull().default(false),
    preferredSupplierId: uuid("preferred_supplier_id"),
    /** Days from ordering to delivery, for reorder suggestions. */
    leadTimeDays: integer("lead_time_days"),
    /** Set when a low-stock alert was sent; cleared when stock recovers. */
    lowStockNotifiedAt: ts("low_stock_notified_at"),
    currency: text("currency").notNull().references(() => currencies.code),
    taxable: boolean("taxable").notNull().default(true),
    tracksStock: boolean("tracks_stock").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("price_non_negative", sql`${t.priceMinor} >= 0`), uniqueIndex("product_variants_barcode_unique").on(t.barcode).where(sql`${t.barcode} IS NOT NULL`)],
);

export const stockLocations = pgTable("stock_locations", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  /** shop | warehouse | van | other */
  kind: text("kind").notNull().default("shop"),
  /** Stock here counts towards what the shop and Synclytics can sell. */
  sellable: boolean("sellable").notNull().default(true),
  /** Where deliveries go unless another location is chosen. */
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  address: text("address"),
});

export const stockLevels = pgTable(
  "stock_levels",
  {
    id: id(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    locationId: uuid("location_id").notNull().references(() => stockLocations.id),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.variantId, t.locationId), check("stock_non_negative", sql`${t.onHand} >= 0 AND ${t.reserved} >= 0`)],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: id(),
    stockLevelId: uuid("stock_level_id").notNull().references(() => stockLevels.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    orderId: uuid("order_id").notNull(),
    quantity: integer("quantity").notNull(),
    /** active | released | consumed */
    status: text("status").notNull().default("active"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orderId), check("reservation_qty_positive", sql`${t.quantity} > 0`)],
);

/** Ledger of every stock change. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    locationId: uuid("location_id").notNull().references(() => stockLocations.id),
    /** Signed change to on-hand quantity. */
    quantity: integer("quantity").notNull(),
    /**
     * receipt | sale | return | transfer_out | transfer_in | count | damaged | lost | expired | internal_use |
     * supplier_return | found | correction (older rows: adjustment)
     */
    reason: text("reason").notNull(),
    /** Average cost per unit when the movement happened (for valuation and cost of sales). */
    unitCostMinor: money("unit_cost_minor"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.variantId, t.createdAt)],
);

/** One physical unit of a serial-tracked item. */
export const stockSerials = pgTable(
  "stock_serials",
  {
    id: id(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    serial: text("serial").notNull(),
    /** in_stock | in_transit | sold | written_off | returned_to_supplier */
    status: text("status").notNull().default("in_stock"),
    locationId: uuid("location_id").references(() => stockLocations.id),
    orderId: uuid("order_id"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    soldAt: ts("sold_at"),
    note: text("note"),
  },
  (t) => [unique().on(t.variantId, t.serial), index().on(t.serial)],
);

/** Moving stock between locations: draft → in_transit (left the source) → received (arrived), or cancelled. */
export const stockTransfers = pgTable("stock_transfers", {
  id: id(),
  number: text("number").notNull().unique(),
  fromLocationId: uuid("from_location_id").notNull().references(() => stockLocations.id),
  toLocationId: uuid("to_location_id").notNull().references(() => stockLocations.id),
  /** draft | in_transit | received | cancelled */
  status: text("status").notNull().default("draft"),
  note: text("note"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  dispatchedBy: uuid("dispatched_by").references(() => users.id),
  dispatchedAt: ts("dispatched_at"),
  receivedBy: uuid("received_by").references(() => users.id),
  receivedAt: ts("received_at"),
  createdAt: createdAt(),
});

export const stockTransferLines = pgTable(
  "stock_transfer_lines",
  {
    id: id(),
    transferId: uuid("transfer_id").notNull().references(() => stockTransfers.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    quantity: integer("quantity").notNull(),
    /** Serial numbers moved (serial-tracked items). */
    serials: text("serials").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [unique().on(t.transferId, t.variantId), check("transfer_qty_positive", sql`${t.quantity} > 0`)],
);

/**
 * Stocktake for one location. Each line records the system quantity at the moment it is counted, and completion
 * posts counted − that quantity, so sales made while counting are neither undone nor double-counted.
 */
export const stockCounts = pgTable("stock_counts", {
  id: id(),
  number: text("number").notNull().unique(),
  locationId: uuid("location_id").notNull().references(() => stockLocations.id),
  categoryId: uuid("category_id").references(() => categories.id),
  /** Counters do not see expected quantities. */
  blind: boolean("blind").notNull().default(true),
  /** open | completed | cancelled */
  status: text("status").notNull().default("open"),
  note: text("note"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  completedBy: uuid("completed_by").references(() => users.id),
  completedAt: ts("completed_at"),
  /** Value of the differences posted (negative = shortage). */
  varianceValueMinor: money("variance_value_minor"),
  createdAt: createdAt(),
});

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: id(),
    countId: uuid("count_id").notNull().references(() => stockCounts.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    /** System quantity when the count started (shown to counters unless the count is blind). */
    expected: integer("expected").notNull(),
    counted: integer("counted"),
    /** System quantity at the moment this line was counted; the adjustment is counted − this. */
    systemAtCount: integer("system_at_count"),
    countedAt: ts("counted_at"),
    unitCostMinor: money("unit_cost_minor"),
  },
  (t) => [unique().on(t.countId, t.variantId)],
);

// ───────────────────────────── Purchasing ─────────────────────────────

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  taxId: text("tax_id"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  /** Typical days from order to delivery. */
  leadTimeDays: integer("lead_time_days"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** draft → sent → partially_received → received, or cancelled. */
export const purchaseOrders = pgTable("purchase_orders", {
  id: id(),
  number: text("number").notNull().unique(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  status: text("status").notNull().default("draft"),
  currency: text("currency").notNull().default("GHS"),
  totalMinor: money("total_minor").notNull().default(0),
  locationId: uuid("location_id").notNull().references(() => stockLocations.id),
  expectedAt: ts("expected_at"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  sentAt: ts("sent_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: id(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitCostMinor: money("unit_cost_minor").notNull(),
    lineTotalMinor: money("line_total_minor").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    check("po_line_qty_positive", sql`${t.quantity} > 0`),
    check("po_line_received_range", sql`${t.receivedQuantity} >= 0 AND ${t.receivedQuantity} <= ${t.quantity}`),
  ],
);

export const goodsReceipts = pgTable("goods_receipts", {
  id: id(),
  number: text("number").notNull().unique(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  locationId: uuid("location_id").notNull().references(() => stockLocations.id),
  receivedBy: uuid("received_by").notNull().references(() => users.id),
  /** Supplier's delivery note or invoice number. */
  reference: text("reference"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: id(),
  goodsReceiptId: uuid("goods_receipt_id").notNull().references(() => goodsReceipts.id),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id),
  quantity: integer("quantity").notNull(),
  serials: text("serials").array().notNull().default(sql`'{}'::text[]`),
});

// ───────────────────────────── Customers & enquiries ─────────────────────────────

/** People and businesses KingsView sells to. They do not sign in (shop checkout is by guest + tracking link). */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    number: text("number").notNull().unique(),
    name: text("name").notNull(),
    company: text("company"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.email), index().on(t.phone)],
);

export const enquiries = pgTable(
  "enquiries",
  {
    id: id(),
    number: text("number").notNull().unique(),
    serviceLine: text("service_line"),
    name: text("name").notNull(),
    company: text("company"),
    phone: text("phone"),
    email: text("email"),
    message: text("message").notNull(),
    /** new | contacted | quoted | won | lost */
    status: text("status").notNull().default("new"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    customerId: uuid("customer_id").references(() => customers.id),
    source: text("source").notNull().default("website"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.status)],
);

// ───────────────────────────── Quotations ─────────────────────────────

export const quotes = pgTable("quotes", {
  id: id(),
  number: text("number").notNull().unique(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  enquiryId: uuid("enquiry_id").references(() => enquiries.id),
  serviceLine: text("service_line"),
  /** draft | sent | accepted | declined | expired */
  status: text("status").notNull().default("draft"),
  currency: text("currency").notNull().references(() => currencies.code),
  subtotalMinor: money("subtotal_minor").notNull().default(0),
  discountBp: integer("discount_bp").notNull().default(0),
  discountMinor: money("discount_minor").notNull().default(0),
  taxMinor: money("tax_minor").notNull().default(0),
  totalMinor: money("total_minor").notNull().default(0),
  taxBreakdown: jsonb("tax_breakdown").$type<{ code: string; name: string; amountMinor: number }[]>().notNull().default([]),
  validUntil: ts("valid_until"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  sentAt: ts("sent_at"),
  decidedAt: ts("decided_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const quoteLines = pgTable("quote_lines", {
  id: id(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  variantId: uuid("variant_id").references(() => productVariants.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: money("unit_price_minor").notNull(),
  taxable: boolean("taxable").notNull().default(true),
  lineTotalMinor: money("line_total_minor").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ───────────────────────────── Orders ─────────────────────────────

export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: text("number").notNull().unique(),
    /** shop (website checkout) | quote (accepted quotation) | ses (order lines Synclytics asked KingsView to fulfil) */
    source: text("source").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    quoteId: uuid("quote_id").references(() => quotes.id),
    /** Contact snapshot at the time of ordering (the customer record may change later). */
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    /** pickup | delivery */
    fulfilmentMethod: text("fulfilment_method").notNull().default("pickup"),
    deliveryAddress: text("delivery_address"),
    /** pending | confirmed | ready | fulfilled | cancelled | expired */
    status: text("status").notNull().default("pending"),
    /** unpaid | part_paid | paid */
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    currency: text("currency").notNull().references(() => currencies.code),
    subtotalMinor: money("subtotal_minor").notNull(),
    discountMinor: money("discount_minor").notNull().default(0),
    taxMinor: money("tax_minor").notNull(),
    totalMinor: money("total_minor").notNull(),
    taxBreakdown: jsonb("tax_breakdown").$type<{ code: string; name: string; amountMinor: number }[]>().notNull().default([]),
    /** SHA-256 of the private tracking token given to shop customers. */
    trackingTokenHash: text("tracking_token_hash").unique(),
    /** Synclytics order number for source = ses. */
    sesOrderNumber: text("ses_order_number"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    fulfilledAt: ts("fulfilled_at"),
    paidAt: ts("paid_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.status), index().on(t.sesOrderNumber)],
);

export const orderLines = pgTable("order_lines", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  variantId: uuid("variant_id").references(() => productVariants.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: money("unit_price_minor").notNull(),
  taxable: boolean("taxable").notNull().default(true),
  lineTotalMinor: money("line_total_minor").notNull(),
  /** Synclytics line id for SES orders (echoed in fulfilment.updated). */
  sesLineId: text("ses_line_id"),
  /** SES lines: requested | accepted | rejected | shipped | delivered | cancelled */
  fulfilmentStatus: text("fulfilment_status"),
  fulfilmentVersion: bigint("fulfilment_version", { mode: "number" }).notNull().default(0),
});

// ───────────────────────────── Invoices & payments ─────────────────────────────

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull().unique(),
    customerId: uuid("customer_id").references(() => customers.id),
    orderId: uuid("order_id").references(() => orders.id),
    billToName: text("bill_to_name").notNull(),
    billToDetails: text("bill_to_details"),
    /** issued | part_paid | paid | void */
    status: text("status").notNull().default("issued"),
    currency: text("currency").notNull().references(() => currencies.code),
    subtotalMinor: money("subtotal_minor").notNull(),
    discountMinor: money("discount_minor").notNull().default(0),
    taxMinor: money("tax_minor").notNull(),
    totalMinor: money("total_minor").notNull(),
    taxBreakdown: jsonb("tax_breakdown").$type<{ code: string; name: string; amountMinor: number }[]>().notNull().default([]),
    paidMinor: money("paid_minor").notNull().default(0),
    notes: text("notes"),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    dueAt: ts("due_at").notNull(),
    paidAt: ts("paid_at"),
    voidedAt: ts("voided_at"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.orderId), index().on(t.status, t.dueAt), check("invoice_paid_range", sql`${t.paidMinor} >= 0 AND ${t.paidMinor} <= ${t.totalMinor}`)],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: id(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: money("unit_price_minor").notNull(),
  taxable: boolean("taxable").notNull().default(true),
  lineTotalMinor: money("line_total_minor").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Manual payments are recorded by staff; online (Paystack) payments only succeed from a verified provider response. */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    provider: text("provider").notNull(),
    reference: text("reference").notNull().unique(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
    /** initialized | success | failed | abandoned | amount_mismatch | reversed */
    status: text("status").notNull().default("initialized"),
    mode: text("mode").notNull(),
    method: text("method"),
    externalReference: text("external_reference"),
    providerTransactionId: text("provider_transaction_id"),
    note: text("note"),
    failureReason: text("failure_reason"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.invoiceId), check("payment_amount_positive", sql`${t.amountMinor} > 0`)],
);

// ───────────────────────────── Service jobs ─────────────────────────────

/** Bookings for work done for a customer: installations, shoots, training, design and development work. */
export const serviceJobs = pgTable(
  "service_jobs",
  {
    id: id(),
    number: text("number").notNull().unique(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    serviceLine: text("service_line").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** requested | scheduled | in_progress | completed | cancelled */
    status: text("status").notNull().default("requested"),
    scheduledAt: ts("scheduled_at"),
    location: text("location"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    quoteId: uuid("quote_id").references(() => quotes.id),
    orderId: uuid("order_id").references(() => orders.id),
    completionNote: text("completion_note"),
    completedAt: ts("completed_at"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.status, t.scheduledAt), index().on(t.assigneeUserId)],
);

// ───────────────────────────── Synclytics (SES) link ─────────────────────────────

/** Events KingsView sends to SES (contract v1), delivered by the job queue with retries. */
export const sesOutbox = pgTable(
  "ses_outbox",
  {
    id: id(),
    eventId: text("event_id").notNull().unique(),
    type: text("type").notNull(),
    /** product/price: SKU · stock: SKU@location · fulfilment: SES line id */
    entityKey: text("entity_key").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    payload: jsonb("payload").notNull(),
    /** queued | sent | dead */
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastStatus: integer("last_status"),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [index().on(t.status, t.createdAt)],
);

/** Events received from SES. Unique event id makes delivery idempotent. */
export const sesInbound = pgTable("ses_inbound", {
  id: id(),
  eventId: text("event_id").notNull().unique(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  /** processed | ignored | failed */
  status: text("status").notNull(),
  error: text("error"),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

// ───────────────────────────── Approvals ─────────────────────────────

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    type: text("type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("pending"),
    /** null when raised by the system (e.g. a partner price feed) */
    requestedBy: uuid("requested_by").references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.status),
    check(
      "no_self_approval",
      sql`${t.decidedBy} IS NULL OR ${t.requestedBy} IS NULL OR ${t.decidedBy} <> ${t.requestedBy}`,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [index().on(t.status, t.runAt)],
);

// ───────────────────────────── Notifications ─────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    body: text("body"),
    /** Relative link inside the app. */
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.readAt)],
);
