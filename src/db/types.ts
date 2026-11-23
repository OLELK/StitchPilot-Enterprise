/**
 * StitchPilot Enterprise — Database Entity Types
 * 15 Apparel Manufacturing Entities + System Metadata
 */

// 1. Buyers
export interface BuyerEntity {
  id: string; // e.g. "BUY-01"
  code: string; // e.g. "ZARA"
  name: string; // e.g. "Zara International"
  country: string;
  contactPerson?: string; // Phase 2B
  contactEmail: string;
  paymentTerms: string;
  complianceRating: string;
  status?: 'ACTIVE' | 'INACTIVE'; // Phase 2B
  isSimulated: boolean;
  createdAt: string;
  updatedAt: string;
}

// 2. Styles
export interface StyleEntity {
  id: string; // e.g. "STY-01"
  buyerId: string; // FK -> buyers.id
  styleCode: string; // e.g. "ST-402"
  description: string;
  garmentType: string; // e.g. "Heavy Fleece Hoodie"
  productType?: string; // Phase 2B: e.g. "Outerwear", "T-Shirt", "Bottoms"
  genderCategory?: string; // Phase 2B: e.g. "Men", "Women", "Unisex", "Kids"
  fabricClassification: string;
  samMinutes: number; // Standard Allowed Minutes (SMV)
  targetEfficiencyPercent: number;
  season: string;
  status?: 'ACTIVE' | 'INACTIVE'; // Phase 2B
  isSimulated: boolean;
  createdAt: string;
  updatedAt: string;
}

// 3. Orders
export type OrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'PARTIALLY_SHIPPED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'CUTTING'
  | 'SEWING'
  | 'FINISHING'
  | 'FINAL_QC'
  | 'PACKED'
  | 'SHIPPED';

export interface OrderStatusHistoryEntry {
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
  timestamp: string;
  note?: string;
  updatedBy?: string;
}

export interface OrderEntity {
  id: string; // e.g. "ORD-01"
  poNumber: string; // unique buyer PO e.g. "PO-99410"
  internalOrderNumber?: string; // Phase 2B: e.g. "SO-2026-001"
  buyerId: string; // FK -> buyers.id
  styleId: string; // FK -> styles.id
  additionalStyleIds?: string[]; // Phase 2B: multi-style support
  orderQuantity: number;
  producedQuantity: number;
  targetExFactoryDate: string;
  status: OrderStatus;
  statusHistory?: OrderStatusHistoryEntry[]; // Phase 2B: audit trail
  assignedLineId: string; // FK -> production_lines.id
  dhuPercent: number;
  notes: string;
  isSimulated: boolean;
  createdAt: string;
  updatedAt: string;
}

// 4. Order Items (Size-wise breakdown)
export interface OrderItemEntity {
  id: string; // e.g. "ITM-01-S"
  orderId: string; // FK -> orders.id
  styleId?: string; // Phase 2B: links to specific style in order
  color: string;
  size: string; // e.g. 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | '28' | '30' | '32' | '34' | '36'
  quantity: number;
  cutQuantity: number;
  sewnQuantity: number;
  packedQuantity: number;
  isSimulated: boolean;
  createdAt: string;
}

// 5. Cost Sheets (Extended in Phase 3A)
export type CostSheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
export type CmtCalculationMethod = 'SAM_RATE' | 'DIRECT_CMT';
export type CmRateBasis = 'ACTUAL_MINUTE' | 'STANDARD_MINUTE';
export type OverheadCalculationMethod =
  | 'FIXED_PER_GARMENT'
  | 'PERCENT_OF_CMT'
  | 'PERCENT_OF_DIRECT_COST';

export type CostSheetLineCategory =
  | 'FABRIC'
  | 'TRIMS'
  | 'THREAD_CONSUMABLES'
  | 'PACKING'
  | 'PRINTING_EMBROIDERY'
  | 'WASHING_FINISHING'
  | 'OTHER';

export type CostSheetLineSourceType = 'BOM_IMPORT' | 'MANUAL';
export type MaterialRateStatus =
  | 'MATCHED_MASTER_RATE'
  | 'MANUAL_OVERRIDE'
  | 'MISSING_MASTER_RATE'
  | 'CURRENCY_MISMATCH';

export interface CostSheetLineItem {
  id: string;
  category: CostSheetLineCategory;
  description: string;
  materialId?: string;
  materialCode?: string; // Stage 4C.1: snapshot of material code
  bomItemId?: string;
  sourceType?: CostSheetLineSourceType; // Stage 4C.1: 'BOM_IMPORT' | 'MANUAL'
  consumptionPerGarment?: number;
  consumptionBasis?: ConsumptionBasis;
  consumptionUnit?: ConsumptionUnit;
  wastagePercent?: number;
  unitPrice: number;
  masterUnitCostSnapshot?: number; // Stage 4C.1: snapshot of material.standardUnitCost at import
  masterCostCurrencySnapshot?: string; // Stage 4C.1: snapshot of material.costCurrency at import
  isRateOverridden?: boolean; // Stage 4C.1: true when manual override replaced master rate
  stockUnit?: MaterialUnit;
  uomAttributesSnapshot?: MaterialUomAttributes; // Stage 4C.1: frozen UOM attributes for immutable historical recalculation
  currency: string;
  costPerGarment: number;
  notes?: string;
}

export interface CostSheetEntity {
  id: string; // e.g. "CST-01"
  styleId: string; // FK -> styles.id
  orderId?: string; // Phase 3A: Optional FK -> orders.id for order-specific costing
  buyerId?: string; // Phase 3A: Optional FK -> buyers.id
  version: number;
  status?: CostSheetStatus; // Phase 3A: DRAFT | SUBMITTED | APPROVED | REJECTED | SUPERSEDED
  currency: string; // Explicit ISO-4217 currency code (e.g. 'USD', 'EUR', 'GBP', 'BDT')
  costingBasisQuantity?: number; // Reference lot size (e.g. PO qty or 1 pc)
  bomVersionRef?: number; // Referenced style BOM version
  fabricCost: number;
  trimsCost: number;
  threadConsumablesCost?: number; // Phase 3A
  packingCost?: number; // Phase 3A
  printingEmbroideryCost?: number; // Phase 3A
  washingFinishingCost?: number; // Phase 3A
  otherDirectCost?: number; // Phase 3A (testing, compliance, special finishes)
  laborCmtCost: number;
  overheadCost: number;
  totalCostPerGarment: number;
  quotedFobPrice: number;
  marginPercent: number; // Gross margin % = (Profit / Quoted FOB) * 100
  markupPercent?: number; // Phase 3A: Markup % = (Profit / Total Cost) * 100
  profitPerGarment?: number; // Phase 3A: Net Realized FOB - Total Manufacturing Cost
  commissionPercent?: number; // Phase 3A: Buying/agent commission % on FOB
  samSnapshot?: number;
  efficiencySnapshot?: number;
  cmRatePerMinute?: number;
  cmRateBasis?: CmRateBasis;
  cmtCalculationMethod?: CmtCalculationMethod;
  overheadMethod?: OverheadCalculationMethod;
  overheadValue?: number;
  lineItems?: CostSheetLineItem[];
  parentCostSheetId?: string;
  approvedBy: string;
  approvedAt?: string;
  rejectionReason?: string;
  isSimulated: boolean;
  createdAt: string;
  updatedAt?: string;
}

// 6. Materials (Extended in Phase 3A)
export type MaterialCategory =
  | 'Knitted Fabric'
  | 'Woven Fabric'
  | 'Trims & Fasteners'
  | 'Threads & Notions'
  | 'Packaging';

export type MaterialUnit = 'kg' | 'meters' | 'pcs' | 'cones' | 'rolls' | 'gross';

export type ConsumptionUnit = MaterialUnit | 'yards' | 'dozens';
export type ConsumptionBasis = 'PER_PIECE' | 'PER_DOZEN';
export type BomStatus = 'ACTIVE' | 'ARCHIVED';
export type BomComponentCategory = 'FABRIC' | 'TRIM' | 'THREAD' | 'PACKAGING' | 'LABEL';
export type BomDimensionScope = 'ALL' | 'SPECIFIC';

export interface MaterialUomAttributes {
  gsm?: number; // Grams per square meter (required for kg <-> meters)
  usableWidthCm?: number; // Usable cuttable width in cm (required for kg <-> meters)
  metersPerRoll?: number; // Linear meters per roll (required for meters <-> rolls)
  metersPerCone?: number; // Linear thread meters per cone (required for meters <-> cones)
  piecesPerPack?: number; // Optional informational pack metadata
}

export interface MaterialEntity {
  id: string; // e.g. "MAT-01"
  materialCode: string; // unique e.g. "RAW-COT-01"
  name: string;
  category: MaterialCategory;
  spec: string;
  unit: MaterialUnit;
  reorderPoint: number;
  warehouseLocation: string;
  supplierName: string;
  standardUnitCost?: number; // Phase 3A: Optional configurable baseline cost in costCurrency
  costCurrency?: string; // Phase 3A: Explicit ISO currency code for standardUnitCost
  uomAttributes?: MaterialUomAttributes; // Phase 3A: Configured textile/packaging conversion parameters
  isSimulated: boolean;
  createdAt: string;
  updatedAt: string;
  // NOTE: Stock is NOT stored here! It is calculated from inventory_transactions ledger
}

// 7. BOM Items (Bill of Materials - Extended in Phase 3A)
export interface BomItemEntity {
  id: string; // e.g. "BOM-01"
  styleId: string; // FK -> styles.id
  materialId: string; // FK -> materials.id
  bomVersion?: number; // Phase 3A: Style BOM version (default 1)
  status?: BomStatus; // Phase 3A: ACTIVE | ARCHIVED
  componentCategory?: BomComponentCategory;
  consumptionPerGarment: number; // Base consumption value (interpreted per consumptionBasis & consumptionUnit)
  consumptionBasis?: ConsumptionBasis; // Phase 3A: PER_PIECE (default) | PER_DOZEN
  consumptionUnit?: ConsumptionUnit; // Phase 3A: Explicit unit of consumptionPerGarment
  wastagePercent: number; // e.g. 5%
  placement: string; // e.g. "Main Body Shell", "Front Zipper"
  colorScope?: BomDimensionScope; // Phase 3A: ALL | SPECIFIC
  applicableColors?: string[]; // Phase 3A: Required when colorScope === 'SPECIFIC'
  sizeScope?: BomDimensionScope; // Phase 3A: ALL | SPECIFIC
  applicableSizes?: string[]; // Phase 3A: Required when sizeScope === 'SPECIFIC'
  sizeConsumptionMap?: Record<string, number>; // Phase 3A: Size-specific consumption overrides
  notes?: string;
  isMandatory: boolean;
  isSimulated: boolean;
  createdAt: string;
  updatedAt?: string;
}

// 8. Inventory Transactions (Ledger Source of Truth)
export type InventoryTransactionType =
  | 'PO_RECEIPT'
  | 'ALLOCATION'
  | 'DEALLOCATION'
  | 'CUTTING_ISSUE'
  | 'RETURN_TO_STORE'
  | 'SCRAP_ADJUSTMENT';

export type InventoryReferenceType =
  | 'PURCHASE_ORDER'
  | 'ORDER_ALLOCATION'
  | 'CUTTING_JOB'
  | 'RETURN'
  | 'SCRAP_AUDIT'
  | 'INITIAL_INVENTORY';

export interface InventoryTransactionEntity {
  id: string; // unique UUID
  idempotencyKey: string; // unique index to prevent duplicate posting
  materialId: string; // FK -> materials.id
  transactionType: InventoryTransactionType;
  quantity: number; // Always positive magnitude
  referenceType: InventoryReferenceType;
  referenceId: string;
  batchLot: string;
  performedBy: string;
  notes: string;
  timestamp: string; // ISO 8601
  isSimulated: boolean;
}

// Ledger Balance Model (computed dynamically from ledger)
export interface MaterialStockBalance {
  materialId: string;
  materialCode: string;
  name: string;
  category: MaterialCategory;
  unit: MaterialUnit;
  reorderPoint: number;
  location: string;
  physicalStock: number; // Receipts + Returns - Issues - Scrap
  reservedStock: number; // Allocations - Deallocations - Issues
  availableStock: number; // Physical Stock - Reserved Stock
  totalReceipts: number;
  totalAllocations: number;
  totalDeallocations: number;
  totalIssues: number;
  totalReturns: number;
  totalScrap: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'CRITICAL' | 'REORDERED';
  transactionCount: number;
}

// 9. Cutting Jobs
export type CuttingJobStatus =
  | 'PENDING_FABRIC'
  | 'ALLOCATED'
  | 'SPREADING'
  | 'CUTTING'
  | 'COMPLETED'
  | 'CANCELLED';

export interface CuttingJobEntity {
  id: string; // e.g. "CUT-01"
  jobNumber: string; // unique e.g. "CJ-2026-001"
  orderId: string; // FK -> orders.id
  styleId: string; // FK -> styles.id
  fabricMaterialId: string; // FK -> materials.id
  markerLengthMeters: number;
  plannedPlies: number;
  plannedGarmentQuantity: number;
  actualCutGarmentQuantity: number;
  allocatedFabricQuantity: number;
  issuedFabricQuantity: number;
  layTableNumber: string;
  status: CuttingJobStatus;
  isSimulated: boolean;
  createdAt: string;
  updatedAt: string;
}

// 10. Marker Ratios
export interface MarkerRatioEntity {
  id: string;
  cuttingJobId: string; // FK -> cutting_jobs.id
  size: string;
  ratio: number;
  plannedPieces: number;
  cutPieces: number;
  isSimulated: boolean;
}

// 11. Bundles
export type BundleStatus =
  | 'CUT'
  | 'ISSUED_TO_LINE'
  | 'IN_SEWING'
  | 'INSPECTION_PASSED'
  | 'REWORK_REQUIRED';

export interface BundleEntity {
  id: string; // e.g. "BDL-01"
  bundleBarcode: string; // unique e.g. "BDL-99410-001"
  cuttingJobId: string; // FK -> cutting_jobs.id
  orderId: string; // FK -> orders.id
  styleId: string; // FK -> styles.id
  bundleNumber: number;
  size: string;
  color: string;
  quantity: number;
  startPcsNo: number;
  endPcsNo: number;
  currentLineId: string; // FK -> production_lines.id
  status: BundleStatus;
  isSimulated: boolean;
  createdAt: string;
}

// 12. Production Lines
export type LineOperationalStatus =
  | 'RUNNING'
  | 'NEEDLE_CHANGE'
  | 'MATERIAL_WAIT'
  | 'MAINTENANCE'
  | 'CHANGEOVER'
  | 'IDLE';

export interface ProductionLineEntity {
  id: string; // e.g. "LINE-01"
  name: string; // e.g. "Sewing Line 01"
  section: string; // e.g. "Heavy Fleece"
  capacityPcsPerHour: number;
  activeOperatorCount: number;
  supervisor: string;
  activeOrderId: string; // FK -> orders.id
  status: LineOperationalStatus;
  isSimulated: boolean;
  createdAt: string;
  updatedAt: string;
}

// 13. Production Events
export type ProductionEventType =
  | 'LINE_START'
  | 'HOURLY_OUTPUT'
  | 'NEEDLE_CHANGE'
  | 'OPERATOR_ABSENCE'
  | 'MATERIAL_WAIT'
  | 'LINE_STOP';

export interface ProductionEventEntity {
  id: string;
  lineId: string; // FK -> production_lines.id
  orderId: string; // FK -> orders.id
  bundleId?: string; // FK -> bundles.id
  eventType: ProductionEventType;
  quantityProduced: number;
  targetQuantity: number;
  efficiencyPercent: number;
  dhuPercent: number;
  notes: string;
  recordedBy: string;
  timestamp: string; // ISO 8601
  isSimulated: boolean;
}

// 14. Quality Inspections
export type InspectionStage = 'INLINE' | 'END_OF_LINE' | 'FINAL_AUDIT' | 'FABRIC_ROLL';
export type InspectionResult = 'PASSED' | 'PENDING' | 'REWORK' | 'FAILED';

export interface QualityInspectionEntity {
  id: string;
  inspectionNumber: string; // unique e.g. "QC-2026-001"
  orderId: string; // FK -> orders.id
  lineId: string; // FK -> production_lines.id
  stage: InspectionStage;
  inspectedQuantity: number;
  passedQuantity: number;
  defectiveQuantity: number;
  dhuPercent: number; // Defects per hundred units
  inspector: string;
  result: InspectionResult;
  inspectionDate: string;
  notes: string;
  isSimulated: boolean;
  createdAt: string;
}

// 15. Quality Defects
export type DefectSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL';
export type DefectCategory =
  | 'STITCHING'
  | 'FABRIC'
  | 'TRIM'
  | 'MEASUREMENT'
  | 'DIRT_STAIN'
  | 'COLOR_SHADING';

export interface QualityDefectEntity {
  id: string;
  inspectionId: string; // FK -> quality_inspections.id
  defectCode: string; // e.g. "DEF-STITCH-SKIP"
  defectName: string; // e.g. "Skipped Needle Stitch"
  category: DefectCategory;
  severity: DefectSeverity;
  count: number;
  repairedCount: number;
  isSimulated: boolean;
  createdAt: string;
}

// System Metadata & Initialization Status
export interface SystemMetadataEntity {
  key: string;
  value: string;
  updatedAt: string;
}
