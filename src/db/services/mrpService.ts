import { db, StitchPilotDatabase } from '../database';
import {
  BomItemEntity,
  CuttingJobEntity,
  InventoryTransactionEntity,
  MaterialCategory,
  MaterialEntity,
  MaterialUnit,
  OrderEntity,
  OrderStatus,
} from '../types';
import {
  EntityNotFoundError,
  InventoryAccountingError,
  ValidationError,
} from '../errors';
import { MasterRepository } from '../repositories/MasterRepository';
import { OrderRepository } from '../repositories/OrderRepository';
import { InventoryRepository } from '../repositories/InventoryRepository';
import { CuttingRepository } from '../repositories/CuttingRepository';
import {
  BomLineCalculationResult,
  BomOrderMatrixRow,
  calculateOrderBomRequirements,
} from './bomCalculator';
import { roundUomDisplay } from './uomConverter';

/**
 * StitchPilot Enterprise — Order Material Requirements Planning (MRP) Service
 *
 * Connects the Dexie/IndexedDB repositories (Orders, Master Styles & BOMs,
 * Cutting Jobs, and Inventory Ledger) with the pure BOM & UOM calculation engines.
 *
 * STRICT READ-ONLY GUARANTEE:
 * This service performs ZERO database writes, ZERO inventory reservations,
 * and ZERO cutting issues. Inventory balance mathematics remain solely owned
 * by InventoryRepository.
 */

export interface GenerateOrderMrpOptions {
  bomVersionByStyle?: Record<string, number>;
  displayDecimals?: number;
}

export interface GenerateMultiOrderMrpOptions extends GenerateOrderMrpOptions {
  excludeCancelled?: boolean;
}

export interface ArchivedBomComponentNotice {
  bomItemId: string;
  styleId: string;
  materialId: string;
  placement: string;
  bomVersion: number;
  status: 'ARCHIVED';
}

export interface MaterialColorRequirementSummary {
  color: string;
  garmentPieces: number;
  grossStockQtyExact: number;
  grossStockQty: number;
}

export interface OrderMaterialMrpRequirement {
  materialId: string;
  materialCode: string;
  materialName: string;
  category: MaterialCategory;
  stockUnit: MaterialUnit;
  matchedBomItemIds: string[];

  // BOM gross vs net/wastage breakdown (in stockUnit)
  netBomRequirementExact: number;
  wastageQuantityExact: number;
  grossBomRequirementExact: number;
  netBomRequirement: number;
  wastageQuantity: number;
  grossBomRequirement: number;

  // Cutting & order allocation reconciliation (from inventory_transactions)
  existingCuttingAllocationExact: number;
  alreadyIssuedExact: number;
  returnedToStoreExact: number;
  activeReservedForOrderExact: number;
  remainingUnallocatedRequirementExact: number;
  overAllocatedQuantityExact: number;

  existingCuttingAllocation: number;
  alreadyIssued: number;
  returnedToStore: number;
  activeReservedForOrder: number;
  remainingUnallocatedRequirement: number;
  overAllocatedQuantity: number;

  // Live warehouse stock snapshot (read-only from InventoryRepository)
  physicalStock: number;
  reservedStock: number;
  availableStock: number;
  warehouseTotalIssuedStock: number;

  // Net additional procurement needed after order allocations + available stock
  netProcurementRequirementExact: number;
  netProcurementRequirement: number;
  discreteGrossUnits: number;
  discreteOrderUnits: number;

  byColor: MaterialColorRequirementSummary[];
  reconciledCuttingJobIds: string[];
}

export interface OrderMrpResult {
  orderId: string;
  poNumber: string;
  internalOrderNumber?: string;
  buyerId: string;
  primaryStyleId: string;
  resolvedStyleIds: string[];
  bomVersionUsedByStyle: Record<string, number>;
  orderStatus: OrderStatus;
  totalGarmentPieces: number;
  usedOrderQuantityFallback: boolean;
  warnings: string[];
  archivedComponentsExcluded: ArchivedBomComponentNotice[];
  lineCalculations: BomLineCalculationResult[];
  materialRequirements: OrderMaterialMrpRequirement[];
  modelLimitations: string[];
  generatedAt: string;
}

export interface MultiOrderMaterialTraceability {
  orderId: string;
  poNumber: string;
  internalOrderNumber?: string;
  styleIds: string[];
  garmentPieces: number;
  matchedBomItemIds: string[];
  grossBomRequirementExact: number;
  grossBomRequirement: number;
  existingCuttingAllocationExact: number;
  existingCuttingAllocation: number;
  alreadyIssuedExact: number;
  alreadyIssued: number;
  activeReservedForOrderExact: number;
  activeReservedForOrder: number;
  remainingUnallocatedRequirementExact: number;
  remainingUnallocatedRequirement: number;
}

export interface MultiOrderMaterialMrpSummary {
  materialId: string;
  materialCode: string;
  materialName: string;
  category: MaterialCategory;
  stockUnit: MaterialUnit;

  // Aggregated across included orders
  totalGrossBomRequirementExact: number;
  totalGrossBomRequirement: number;
  totalExistingCuttingAllocationExact: number;
  totalExistingCuttingAllocation: number;
  totalAlreadyIssuedExact: number;
  totalAlreadyIssued: number;
  totalActiveReservedForOrdersExact: number;
  totalActiveReservedForOrders: number;
  totalRemainingUnallocatedRequirementExact: number;
  totalRemainingUnallocatedRequirement: number;

  // Live warehouse stock snapshot (counted ONCE across the shared warehouse pool)
  physicalStock: number;
  reservedStock: number;
  availableStock: number;
  warehouseTotalIssuedStock: number;

  // Consolidated net procurement across all selected orders
  netProcurementRequirementExact: number;
  netProcurementRequirement: number;
  discreteGrossUnits: number;
  discreteOrderUnits: number;

  orderTraceability: MultiOrderMaterialTraceability[];
  byColor: MaterialColorRequirementSummary[];
}

export interface MultiOrderMrpResult {
  requestedOrderIds: string[];
  includedOrderIds: string[];
  excludedCancelledOrders: Array<{ orderId: string; poNumber: string; reason: string }>;
  totalGarmentPieces: number;
  warnings: string[];
  archivedComponentsExcluded: ArchivedBomComponentNotice[];
  orderBreakdowns: OrderMrpResult[];
  consolidatedMaterials: MultiOrderMaterialMrpSummary[];
  modelLimitations: string[];
  generatedAt: string;
}

const STAGE2_MODEL_LIMITATIONS: string[] = [
  'Order allocations (ORDER_ALLOCATION) and cutting issues (CUTTING_JOB) are tracked at (orderId, materialId) granularity and do not carry color or bomItemId attributes; gross BOM color breakdowns are preserved separately from material-level cutting reconciliation.',
  'Warehouse availableStock represents a shared pool across all orders; in multi-order MRP, netProcurementRequirement is computed once against shared availableStock across the combined unallocated demand.',
];

function computeDiscreteCeil(exactValue: number): number {
  if (exactValue <= 0) return 0;
  const nearestInt = Math.round(exactValue);
  if (Math.abs(exactValue - nearestInt) < 1e-9) {
    return nearestInt;
  }
  return Math.ceil(exactValue);
}

export class OrderMrpService {
  private masterRepo: MasterRepository;
  private orderRepo: OrderRepository;
  private inventoryRepo: InventoryRepository;
  private cuttingRepo: CuttingRepository;

  constructor(private database: StitchPilotDatabase) {
    this.masterRepo = new MasterRepository(database);
    this.orderRepo = new OrderRepository(database);
    this.inventoryRepo = new InventoryRepository(database);
    this.cuttingRepo = new CuttingRepository(database);
  }

  /**
   * Validates ledger references and transaction integrity for a material's transactions.
   * Ensures missing order/cutting job references and corrupted negative balances are surfaced explicitly.
   */
  private async validateMaterialLedgerIntegrity(
    materialId: string,
    transactions: InventoryTransactionEntity[]
  ): Promise<void> {
    for (const tx of transactions) {
      if (
        typeof tx.quantity !== 'number' ||
        !Number.isFinite(tx.quantity) ||
        tx.quantity <= 0
      ) {
        throw new ValidationError(
          `Inventory ledger transaction "${tx.id}" for material "${materialId}" has invalid quantity: ${tx.quantity}.`,
          'quantity',
          { transactionId: tx.id, materialId }
        );
      }

      if (tx.referenceType === 'ORDER_ALLOCATION') {
        const refOrder = await this.orderRepo.getOrderById(tx.referenceId);
        if (!refOrder) {
          throw new ValidationError(
            `Inventory transaction "${tx.id}" (${tx.transactionType}) references non-existent order "${tx.referenceId}".`,
            'referenceId',
            { transactionId: tx.id, referenceType: tx.referenceType, referenceId: tx.referenceId }
          );
        }
      } else if (tx.referenceType === 'CUTTING_JOB') {
        const jobById = await this.cuttingRepo.getCuttingJobById(tx.referenceId);
        const jobByNumber = jobById
          ? jobById
          : await this.database.cutting_jobs
              .where('jobNumber')
              .equals(tx.referenceId)
              .first();
        if (!jobById && !jobByNumber) {
          throw new ValidationError(
            `Inventory transaction "${tx.id}" (${tx.transactionType}) references non-existent cutting job "${tx.referenceId}".`,
            'referenceId',
            { transactionId: tx.id, referenceType: tx.referenceType, referenceId: tx.referenceId }
          );
        }
      }
    }
  }

  /**
   * Generates deterministic MRP and cutting/stock reconciliation for a single order.
   */
  async generateOrderMrp(
    orderId: string,
    options: GenerateOrderMrpOptions = {}
  ): Promise<OrderMrpResult> {
    if (!orderId || !orderId.trim()) {
      throw new ValidationError('Order ID is required to generate MRP.', 'orderId');
    }

    const displayDecimals = options.displayDecimals ?? 4;
    const warnings: string[] = [];

    // 1. Load & validate order
    const order: OrderEntity | undefined = await this.orderRepo.getOrderById(orderId);
    if (!order) {
      throw new EntityNotFoundError('Order', orderId);
    }

    if (order.status === 'CANCELLED') {
      throw new ValidationError(
        `Cannot calculate MRP for cancelled order "${order.poNumber}" (${order.id}).`,
        'status',
        { orderId: order.id, status: order.status }
      );
    }

    if (
      typeof order.orderQuantity !== 'number' ||
      !Number.isFinite(order.orderQuantity) ||
      order.orderQuantity <= 0
    ) {
      throw new ValidationError(
        `Order "${order.poNumber}" has invalid orderQuantity: ${order.orderQuantity}.`,
        'orderQuantity'
      );
    }

    // 2. Load order items & resolve style IDs
    const orderItems = await this.orderRepo.getOrderItems(order.id);
    const resolvedStyleSet = new Set<string>([order.styleId]);
    if (order.additionalStyleIds) {
      for (const extraStyleId of order.additionalStyleIds) {
        if (extraStyleId && extraStyleId.trim()) {
          resolvedStyleSet.add(extraStyleId.trim());
        }
      }
    }
    for (const item of orderItems) {
      if (item.styleId && item.styleId.trim()) {
        resolvedStyleSet.add(item.styleId.trim());
      }
    }
    const resolvedStyleIds = Array.from(resolvedStyleSet);

    // Validate all referenced styles exist
    for (const styleId of resolvedStyleIds) {
      const style = await this.masterRepo.getStyleById(styleId);
      if (!style) {
        throw new EntityNotFoundError('Style', styleId);
      }
    }

    // 3. Build order matrix rows (supporting fallback when order_items are absent, e.g. ORD-03)
    let matrixRows: BomOrderMatrixRow[];
    let usedOrderQuantityFallback = false;

    if (orderItems.length > 0) {
      const matrixTotal = orderItems.reduce((sum, item) => sum + item.quantity, 0);
      if (matrixTotal !== order.orderQuantity) {
        warnings.push(
          `Order "${order.poNumber}" size matrix sum (${matrixTotal} pcs) differs from orderQuantity (${order.orderQuantity} pcs); MRP calculated from actual order_items breakdown.`
        );
      }
      matrixRows = orderItems.map((item) => ({
        styleId: item.styleId || order.styleId,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
      }));
    } else {
      usedOrderQuantityFallback = true;
      if (resolvedStyleIds.length > 1) {
        throw new ValidationError(
          `Order "${order.poNumber}" references multiple styles (${resolvedStyleIds.join(', ')}) but has no order_items matrix to allocate quantities per style.`,
          'order_items'
        );
      }
      warnings.push(
        `Order "${order.poNumber}" (${order.id}) has no color/size matrix rows in order_items; falling back to order.orderQuantity (${order.orderQuantity} pcs) on primary style "${order.styleId}".`
      );
      matrixRows = [
        {
          styleId: order.styleId,
          color: 'UNSPECIFIED',
          size: 'ALL',
          quantity: order.orderQuantity,
        },
      ];
    }

    // 4. Resolve BOMs for each style (active items + explicit archived exclusion report)
    const activeBomItems: BomItemEntity[] = [];
    const archivedComponentsExcluded: ArchivedBomComponentNotice[] = [];
    const bomVersionUsedByStyle: Record<string, number> = {};

    for (const styleId of resolvedStyleIds) {
      const requestedVersion = options.bomVersionByStyle?.[styleId];

      const allItemsForScope = await this.masterRepo.getBomByStyle(styleId, {
        includeArchived: true,
        bomVersion: requestedVersion,
      });

      if (allItemsForScope.length === 0) {
        throw new ValidationError(
          requestedVersion !== undefined
            ? `Style "${styleId}" has no BOM items defined for version ${requestedVersion}.`
            : `Style "${styleId}" has no Bill of Materials (BOM) defined.`,
          'bomItems',
          { styleId, bomVersion: requestedVersion }
        );
      }

      const activeForStyle = await this.masterRepo.getActiveBomByStyle(
        styleId,
        requestedVersion
      );

      if (activeForStyle.length === 0) {
        throw new ValidationError(
          requestedVersion !== undefined
            ? `Style "${styleId}" BOM version ${requestedVersion} contains only ARCHIVED items and cannot be used for MRP.`
            : `Style "${styleId}" has only ARCHIVED BOM items (${allItemsForScope.length} item(s)) and no active BOM.`,
          'bomItems',
          { styleId, bomVersion: requestedVersion, archivedCount: allItemsForScope.length }
        );
      }

      const resolvedVersion =
        requestedVersion ?? Math.max(...activeForStyle.map((b) => b.bomVersion ?? 1));
      bomVersionUsedByStyle[styleId] = resolvedVersion;

      // Record any archived items on the style/version as explicitly excluded
      for (const item of allItemsForScope) {
        if (item.status === 'ARCHIVED') {
          archivedComponentsExcluded.push({
            bomItemId: item.id,
            styleId: item.styleId,
            materialId: item.materialId,
            placement: item.placement,
            bomVersion: item.bomVersion ?? 1,
            status: 'ARCHIVED',
          });
        }
      }

      // If fallback matrix row was used, ensure no active BOM line requires SPECIFIC colour or size breakdown
      if (usedOrderQuantityFallback) {
        for (const item of activeForStyle) {
          if (item.colorScope === 'SPECIFIC' || item.sizeScope === 'SPECIFIC') {
            throw new ValidationError(
              `BOM item "${item.id}" on style "${styleId}" uses SPECIFIC color/size applicability, which requires color/size rows in order_items.`,
              'order_items',
              { bomItemId: item.id, colorScope: item.colorScope, sizeScope: item.sizeScope }
            );
          }
        }
      }

      activeBomItems.push(...activeForStyle);
    }

    // 5. Load all referenced materials (active BOM + order cutting jobs)
    const cuttingJobsForOrder: CuttingJobEntity[] =
      await this.cuttingRepo.getCuttingJobsByOrder(order.id);

    const materialIdsToLoad = new Set<string>();
    for (const bomItem of activeBomItems) {
      materialIdsToLoad.add(bomItem.materialId);
    }
    for (const job of cuttingJobsForOrder) {
      materialIdsToLoad.add(job.fabricMaterialId);
    }

    const materialsById: Record<string, MaterialEntity> = {};
    for (const materialId of materialIdsToLoad) {
      const material = await this.inventoryRepo.getMaterialById(materialId);
      if (!material) {
        throw new EntityNotFoundError('Material', materialId);
      }
      materialsById[materialId] = material;
    }

    // 6. Execute pure deterministic BOM & UOM calculation
    const bomCalc = calculateOrderBomRequirements({
      primaryStyleId: order.styleId,
      orderItems: matrixRows,
      bomItems: activeBomItems,
      materialsById,
      includeArchived: false,
      displayDecimals,
    });

    // 7. Validate cutting jobs for unposted ledger claims across ALL order cutting jobs
    const orderJobIds = new Set(cuttingJobsForOrder.map((j) => j.id));
    const orderJobNumbers = new Set(cuttingJobsForOrder.map((j) => j.jobNumber));

    const txsByMaterialId = new Map<string, InventoryTransactionEntity[]>();
    const balancesByMaterialId = new Map<
      string,
      Awaited<ReturnType<InventoryRepository['getMaterialStockBalance']>>
    >();

    for (const materialId of materialIdsToLoad) {
      const balance = await this.inventoryRepo.getMaterialStockBalance(materialId);
      if (
        balance.physicalStock < -1e-9 ||
        balance.reservedStock < -1e-9 ||
        balance.availableStock < -1e-9
      ) {
        throw new InventoryAccountingError(
          `Corrupted negative stock balance detected for material "${materialId}" (physical: ${balance.physicalStock}, reserved: ${balance.reservedStock}, available: ${balance.availableStock}).`,
          materialId,
          {
            physicalStock: balance.physicalStock,
            reservedStock: balance.reservedStock,
            availableStock: balance.availableStock,
          }
        );
      }

      const txs = await this.inventoryRepo.getMaterialTransactions(materialId);
      await this.validateMaterialLedgerIntegrity(materialId, txs);

      balancesByMaterialId.set(materialId, balance);
      txsByMaterialId.set(materialId, txs);
    }

    // Verify cutting job ledger backing per non-cancelled cutting job
    for (const job of cuttingJobsForOrder) {
      if (job.status === 'CANCELLED') continue;
      if (job.allocatedFabricQuantity <= 0 && job.issuedFabricQuantity <= 0) continue;

      const matTxs = txsByMaterialId.get(job.fabricMaterialId) || [];
      const orderScopedTxs = matTxs.filter(
        (tx) =>
          (tx.referenceType === 'ORDER_ALLOCATION' && tx.referenceId === order.id) ||
          (tx.referenceType === 'CUTTING_JOB' &&
            (tx.referenceId === job.id || tx.referenceId === job.jobNumber ||
              orderJobIds.has(tx.referenceId) ||
              orderJobNumbers.has(tx.referenceId)))
      );

      const hasAllocationTx = orderScopedTxs.some(
        (tx) => tx.transactionType === 'ALLOCATION'
      );
      const hasIssueTx = orderScopedTxs.some(
        (tx) => tx.transactionType === 'CUTTING_ISSUE'
      );

      if (job.allocatedFabricQuantity > 0 && !hasAllocationTx) {
        throw new ValidationError(
          `Cutting job "${job.jobNumber}" (${job.id}) declares allocatedFabricQuantity=${job.allocatedFabricQuantity}, but no backing ALLOCATION ledger transaction exists for order "${order.poNumber}".`,
          'cuttingJobs',
          { cuttingJobId: job.id, orderId: order.id, materialId: job.fabricMaterialId }
        );
      }

      if (job.issuedFabricQuantity > 0 && !hasIssueTx) {
        throw new ValidationError(
          `Cutting job "${job.jobNumber}" (${job.id}) declares issuedFabricQuantity=${job.issuedFabricQuantity}, but no backing CUTTING_ISSUE ledger transaction exists for cutting job "${job.jobNumber}".`,
          'cuttingJobs',
          { cuttingJobId: job.id, orderId: order.id, materialId: job.fabricMaterialId }
        );
      }
    }

    // 8. Reconcile consolidated BOM requirements against cutting allocations, issues, and warehouse stock
    const materialRequirements: OrderMaterialMrpRequirement[] =
      bomCalc.consolidatedMaterials.map((cons) => {
        const balance = balancesByMaterialId.get(cons.materialId)!;
        const txs = txsByMaterialId.get(cons.materialId) || [];

        const orderScopedTxs = txs.filter(
          (tx) =>
            (tx.referenceType === 'ORDER_ALLOCATION' && tx.referenceId === order.id) ||
            (tx.referenceType === 'CUTTING_JOB' &&
              (orderJobIds.has(tx.referenceId) || orderJobNumbers.has(tx.referenceId))) ||
            (tx.referenceType === 'RETURN' &&
              (tx.referenceId === order.id ||
                orderJobIds.has(tx.referenceId) ||
                orderJobNumbers.has(tx.referenceId)))
        );

        let allocSum = 0;
        let deallocSum = 0;
        let issueSum = 0;
        let returnSum = 0;

        for (const tx of orderScopedTxs) {
          switch (tx.transactionType) {
            case 'ALLOCATION':
              allocSum += tx.quantity;
              break;
            case 'DEALLOCATION':
              deallocSum += tx.quantity;
              break;
            case 'CUTTING_ISSUE':
              issueSum += tx.quantity;
              break;
            case 'RETURN_TO_STORE':
              returnSum += tx.quantity;
              break;
            default:
              break;
          }
        }

        // Prevent double-counting: ALLOCATION moves stock into reservedStock, and
        // CUTTING_ISSUE consumes from reservedStock and physicalStock. Thus, total
        // order commitment satisfied from warehouse = net allocations minus returns to store
        // (and equals activeReservedForOrder + netIssuedToCutting when all issues came from order allocations).
        const activeReservedExact = Math.max(0, allocSum - deallocSum - issueSum);
        const existingCuttingAllocationExact = Math.max(
          0,
          allocSum - deallocSum - returnSum
        );

        const grossExact = cons.grossRequirementStockUnitExact;
        const remainingUnallocatedExact = Math.max(
          0,
          grossExact - existingCuttingAllocationExact
        );
        const overAllocatedExact = Math.max(
          0,
          existingCuttingAllocationExact - grossExact
        );

        if (overAllocatedExact > 1e-9) {
          warnings.push(
            `Material "${cons.materialCode}" is over-allocated for order "${order.poNumber}": allocated/issued ${roundUomDisplay(existingCuttingAllocationExact, displayDecimals)} ${cons.stockUnit} exceeds gross BOM requirement ${roundUomDisplay(grossExact, displayDecimals)} ${cons.stockUnit}.`
          );
        }

        const netProcurementExact = Math.max(
          0,
          remainingUnallocatedExact - balance.availableStock
        );

        const reconciledCuttingJobIds = cuttingJobsForOrder
          .filter(
            (j) =>
              j.status !== 'CANCELLED' && j.fabricMaterialId === cons.materialId
          )
          .map((j) => j.id);

        return {
          materialId: cons.materialId,
          materialCode: cons.materialCode,
          materialName: cons.materialName,
          category: cons.category,
          stockUnit: cons.stockUnit,
          matchedBomItemIds: cons.matchedBomItemIds,

          netBomRequirementExact: cons.netRequirementStockUnitExact,
          wastageQuantityExact: cons.wastageQuantityStockUnitExact,
          grossBomRequirementExact: grossExact,
          netBomRequirement: cons.netRequirementStockUnit,
          wastageQuantity: cons.wastageQuantityStockUnit,
          grossBomRequirement: cons.grossRequirementStockUnit,

          existingCuttingAllocationExact,
          alreadyIssuedExact: issueSum,
          returnedToStoreExact: returnSum,
          activeReservedForOrderExact: activeReservedExact,
          remainingUnallocatedRequirementExact: remainingUnallocatedExact,
          overAllocatedQuantityExact: overAllocatedExact,

          existingCuttingAllocation: roundUomDisplay(
            existingCuttingAllocationExact,
            displayDecimals
          ),
          alreadyIssued: roundUomDisplay(issueSum, displayDecimals),
          returnedToStore: roundUomDisplay(returnSum, displayDecimals),
          activeReservedForOrder: roundUomDisplay(
            activeReservedExact,
            displayDecimals
          ),
          remainingUnallocatedRequirement: roundUomDisplay(
            remainingUnallocatedExact,
            displayDecimals
          ),
          overAllocatedQuantity: roundUomDisplay(
            overAllocatedExact,
            displayDecimals
          ),

          physicalStock: balance.physicalStock,
          reservedStock: balance.reservedStock,
          availableStock: balance.availableStock,
          warehouseTotalIssuedStock: balance.totalIssues,

          netProcurementRequirementExact: netProcurementExact,
          netProcurementRequirement: roundUomDisplay(
            netProcurementExact,
            displayDecimals
          ),
          discreteGrossUnits: cons.discreteOrderUnits,
          discreteOrderUnits: computeDiscreteCeil(netProcurementExact),

          byColor: cons.byColor,
          reconciledCuttingJobIds,
        };
      });

    return {
      orderId: order.id,
      poNumber: order.poNumber,
      internalOrderNumber: order.internalOrderNumber,
      buyerId: order.buyerId,
      primaryStyleId: order.styleId,
      resolvedStyleIds,
      bomVersionUsedByStyle,
      orderStatus: order.status,
      totalGarmentPieces: bomCalc.totalGarmentPieces,
      usedOrderQuantityFallback,
      warnings,
      archivedComponentsExcluded,
      lineCalculations: bomCalc.lineResults,
      materialRequirements,
      modelLimitations: [...STAGE2_MODEL_LIMITATIONS],
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generates consolidated multi-order MRP with order-level traceability and
   * unified shared-warehouse availableStock netting.
   */
  async generateMultiOrderMrp(
    orderIds: string[],
    options: GenerateMultiOrderMrpOptions = {}
  ): Promise<MultiOrderMrpResult> {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      throw new ValidationError(
        'At least one order ID is required to generate multi-order MRP.',
        'orderIds'
      );
    }

    const displayDecimals = options.displayDecimals ?? 4;
    const excludeCancelled = options.excludeCancelled ?? false;

    const uniqueOrderIds = Array.from(
      new Set(orderIds.map((id) => id.trim()).filter(Boolean))
    );
    if (uniqueOrderIds.length === 0) {
      throw new ValidationError(
        'Order IDs list cannot contain only empty values.',
        'orderIds'
      );
    }

    const orderBreakdowns: OrderMrpResult[] = [];
    const excludedCancelledOrders: Array<{
      orderId: string;
      poNumber: string;
      reason: string;
    }> = [];
    const warnings: string[] = [];
    const archivedComponentsExcluded: ArchivedBomComponentNotice[] = [];

    for (const orderId of uniqueOrderIds) {
      const order = await this.orderRepo.getOrderById(orderId);
      if (!order) {
        throw new EntityNotFoundError('Order', orderId);
      }

      if (order.status === 'CANCELLED') {
        if (excludeCancelled) {
          excludedCancelledOrders.push({
            orderId: order.id,
            poNumber: order.poNumber,
            reason: 'Order status is CANCELLED; excluded from consolidated MRP.',
          });
          continue;
        }
        throw new ValidationError(
          `Cannot calculate MRP for cancelled order "${order.poNumber}" (${order.id}).`,
          'status',
          { orderId: order.id, status: order.status }
        );
      }

      const mrp = await this.generateOrderMrp(order.id, options);
      orderBreakdowns.push(mrp);
      warnings.push(...mrp.warnings);
      archivedComponentsExcluded.push(...mrp.archivedComponentsExcluded);
    }

    if (orderBreakdowns.length === 0) {
      throw new ValidationError(
        'No active non-cancelled orders remain to calculate consolidated MRP.',
        'orderIds'
      );
    }

    // Aggregate material requirements across included orders strictly matching stockUnit
    const consolidatedMap = new Map<
      string,
      {
        materialId: string;
        materialCode: string;
        materialName: string;
        category: MaterialCategory;
        stockUnit: MaterialUnit;
        physicalStock: number;
        reservedStock: number;
        availableStock: number;
        warehouseTotalIssuedStock: number;
        totalGrossExact: number;
        totalExistingAllocExact: number;
        totalAlreadyIssuedExact: number;
        totalActiveReservedExact: number;
        totalRemainingUnallocatedExact: number;
        orderTraceability: MultiOrderMaterialTraceability[];
        colorMap: Map<
          string,
          { color: string; garmentPieces: number; grossStockQtyExact: number }
        >;
      }
    >();

    for (const breakdown of orderBreakdowns) {
      for (const req of breakdown.materialRequirements) {
        let entry = consolidatedMap.get(req.materialId);
        if (!entry) {
          entry = {
            materialId: req.materialId,
            materialCode: req.materialCode,
            materialName: req.materialName,
            category: req.category,
            stockUnit: req.stockUnit,
            physicalStock: req.physicalStock,
            reservedStock: req.reservedStock,
            availableStock: req.availableStock,
            warehouseTotalIssuedStock: req.warehouseTotalIssuedStock,
            totalGrossExact: 0,
            totalExistingAllocExact: 0,
            totalAlreadyIssuedExact: 0,
            totalActiveReservedExact: 0,
            totalRemainingUnallocatedExact: 0,
            orderTraceability: [],
            colorMap: new Map(),
          };
          consolidatedMap.set(req.materialId, entry);
        } else if (entry.stockUnit !== req.stockUnit) {
          throw new ValidationError(
            `Cannot aggregate material "${req.materialCode}" across incompatible stock units "${entry.stockUnit}" and "${req.stockUnit}".`,
            'stockUnit'
          );
        }

        entry.totalGrossExact += req.grossBomRequirementExact;
        entry.totalExistingAllocExact += req.existingCuttingAllocationExact;
        entry.totalAlreadyIssuedExact += req.alreadyIssuedExact;
        entry.totalActiveReservedExact += req.activeReservedForOrderExact;
        entry.totalRemainingUnallocatedExact +=
          req.remainingUnallocatedRequirementExact;

        entry.orderTraceability.push({
          orderId: breakdown.orderId,
          poNumber: breakdown.poNumber,
          internalOrderNumber: breakdown.internalOrderNumber,
          styleIds: breakdown.resolvedStyleIds,
          garmentPieces: breakdown.totalGarmentPieces,
          matchedBomItemIds: req.matchedBomItemIds,
          grossBomRequirementExact: req.grossBomRequirementExact,
          grossBomRequirement: req.grossBomRequirement,
          existingCuttingAllocationExact: req.existingCuttingAllocationExact,
          existingCuttingAllocation: req.existingCuttingAllocation,
          alreadyIssuedExact: req.alreadyIssuedExact,
          alreadyIssued: req.alreadyIssued,
          activeReservedForOrderExact: req.activeReservedForOrderExact,
          activeReservedForOrder: req.activeReservedForOrder,
          remainingUnallocatedRequirementExact:
            req.remainingUnallocatedRequirementExact,
          remainingUnallocatedRequirement: req.remainingUnallocatedRequirement,
        });

        for (const cb of req.byColor) {
          const colorKey = cb.color.trim().toUpperCase();
          const existingColor = entry.colorMap.get(colorKey);
          if (existingColor) {
            existingColor.garmentPieces += cb.garmentPieces;
            existingColor.grossStockQtyExact += cb.grossStockQtyExact;
          } else {
            entry.colorMap.set(colorKey, {
              color: cb.color,
              garmentPieces: cb.garmentPieces,
              grossStockQtyExact: cb.grossStockQtyExact,
            });
          }
        }
      }
    }

    const consolidatedMaterials: MultiOrderMaterialMrpSummary[] = Array.from(
      consolidatedMap.values()
    ).map((entry) => {
      const netProcurementExact = Math.max(
        0,
        entry.totalRemainingUnallocatedExact - entry.availableStock
      );

      return {
        materialId: entry.materialId,
        materialCode: entry.materialCode,
        materialName: entry.materialName,
        category: entry.category,
        stockUnit: entry.stockUnit,

        totalGrossBomRequirementExact: entry.totalGrossExact,
        totalGrossBomRequirement: roundUomDisplay(
          entry.totalGrossExact,
          displayDecimals
        ),
        totalExistingCuttingAllocationExact: entry.totalExistingAllocExact,
        totalExistingCuttingAllocation: roundUomDisplay(
          entry.totalExistingAllocExact,
          displayDecimals
        ),
        totalAlreadyIssuedExact: entry.totalAlreadyIssuedExact,
        totalAlreadyIssued: roundUomDisplay(
          entry.totalAlreadyIssuedExact,
          displayDecimals
        ),
        totalActiveReservedForOrdersExact: entry.totalActiveReservedExact,
        totalActiveReservedForOrders: roundUomDisplay(
          entry.totalActiveReservedExact,
          displayDecimals
        ),
        totalRemainingUnallocatedRequirementExact:
          entry.totalRemainingUnallocatedExact,
        totalRemainingUnallocatedRequirement: roundUomDisplay(
          entry.totalRemainingUnallocatedExact,
          displayDecimals
        ),

        physicalStock: entry.physicalStock,
        reservedStock: entry.reservedStock,
        availableStock: entry.availableStock,
        warehouseTotalIssuedStock: entry.warehouseTotalIssuedStock,

        netProcurementRequirementExact: netProcurementExact,
        netProcurementRequirement: roundUomDisplay(
          netProcurementExact,
          displayDecimals
        ),
        discreteGrossUnits: computeDiscreteCeil(entry.totalGrossExact),
        discreteOrderUnits: computeDiscreteCeil(netProcurementExact),

        orderTraceability: entry.orderTraceability,
        byColor: Array.from(entry.colorMap.values()).map((c) => ({
          color: c.color,
          garmentPieces: c.garmentPieces,
          grossStockQtyExact: c.grossStockQtyExact,
          grossStockQty: roundUomDisplay(c.grossStockQtyExact, displayDecimals),
        })),
      };
    });

    const totalGarmentPieces = orderBreakdowns.reduce(
      (sum, o) => sum + o.totalGarmentPieces,
      0
    );

    return {
      requestedOrderIds: uniqueOrderIds,
      includedOrderIds: orderBreakdowns.map((o) => o.orderId),
      excludedCancelledOrders,
      totalGarmentPieces,
      warnings,
      archivedComponentsExcluded,
      orderBreakdowns,
      consolidatedMaterials,
      modelLimitations: [...STAGE2_MODEL_LIMITATIONS],
      generatedAt: new Date().toISOString(),
    };
  }
}

export function createMrpService(database: StitchPilotDatabase): OrderMrpService {
  return new OrderMrpService(database);
}

export const mrpService = createMrpService(db);
