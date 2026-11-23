import { db, StitchPilotDatabase } from '../database';
import {
  BomComponentCategory,
  BomItemEntity,
  ConsumptionBasis,
  ConsumptionUnit,
  CostSheetLineCategory,
  MaterialCategory,
  MaterialEntity,
  MaterialRateStatus,
  MaterialUnit,
} from '../types';
import {
  EntityNotFoundError,
  RelationshipValidationError,
  ValidationError,
} from '../errors';
import { MasterRepository } from '../repositories/MasterRepository';
import { OrderRepository } from '../repositories/OrderRepository';
import { InventoryRepository } from '../repositories/InventoryRepository';
import {
  BomLineCalculationResult,
  BomOrderMatrixRow,
  calculateOrderBomRequirements,
} from './bomCalculator';
import { getUomConversionFactor, roundUomDisplay } from './uomConverter';
import { CostingLineInput } from './costingCalculator';

/**
 * StitchPilot Enterprise — BOM-to-Costing Integration Service (Phase 3A Stage 4C.1)
 *
 * STRICT READ-ONLY SERVICE:
 * Reads Style BOMs, Material Master records, and Order size/colour breakdowns
 * from Dexie/IndexedDB and converts them into CostingLineInput[] records ready
 * for costingCalculator.ts and CostingRepository.ts.
 *
 * Performs ZERO database writes and reuses bomCalculator.ts and uomConverter.ts
 * without duplicating consumption, wastage, or UOM conversion formulas.
 */

export interface ImportBomToCostingOptions {
  styleId: string;
  currency: string;
  bomVersion?: number;
  orderId?: string;
  /**
   * Optional manual unit-price overrides in the target costing currency.
   * Lookup checks `rateOverrides[bomItemId]` first, then `rateOverrides[materialId]`.
   */
  rateOverrides?: Record<string, number>;
  displayDecimals?: number;
}

export interface MaterialRateResolution {
  status: MaterialRateStatus;
  resolvedUnitPrice?: number;
  masterUnitCostSnapshot?: number;
  masterCostCurrencySnapshot?: string;
  isRateOverridden: boolean;
  requiresManualRate: boolean;
  issueMessage?: string;
}

export interface MaterialRateIssue {
  bomItemId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  reason: 'MISSING_MASTER_RATE' | 'CURRENCY_MISMATCH';
  masterUnitCost?: number;
  masterCostCurrency?: string;
  targetCurrency: string;
  message: string;
}

export interface BomApplicabilityWarning {
  bomItemId: string;
  materialId: string;
  materialCode: string;
  placement: string;
  type: 'COLOR_SPECIFIC' | 'SIZE_SPECIFIC' | 'SIZE_CONSUMPTION_OVERRIDE';
  applicableColors?: string[];
  applicableSizes?: string[];
  overriddenSizes?: string[];
  message: string;
}

export interface SkippedBomCostingItem {
  bomItemId: string;
  materialId: string;
  materialCode: string;
  placement: string;
  reason: string;
}

export interface ImportedBomCostLinePreview {
  lineInput: CostingLineInput;
  bomItemId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  placement: string;
  category: CostSheetLineCategory;
  consumptionBasis: ConsumptionBasis;
  consumptionUnit: ConsumptionUnit;
  stockUnit: MaterialUnit;
  wastagePercent: number;
  conversionFactor: number;
  conversionFormula: string;
  rateResolution: MaterialRateResolution;
  isWeightedByOrder: boolean;
  baseConsumptionPerGarment: number;
  effectiveConsumptionPerGarment: number;
  orderMatchedGarmentPieces?: number;
  orderTotalGarmentPieces?: number;
  orderGrossRequirementStockUnitExact?: number;
  orderGrossRequirementStockUnit?: number;
  orderEstimatedMaterialCost?: number;
}

export interface BomCostingImportResult {
  mode: 'STYLE' | 'ORDER';
  styleId: string;
  styleCode: string;
  buyerId: string;
  orderId?: string;
  poNumber?: string;
  bomVersionUsed: number;
  currency: string;
  costingBasisQuantity?: number;
  usedOrderQuantityFallback: boolean;
  lineItems: CostingLineInput[];
  linePreviews: ImportedBomCostLinePreview[];
  rateIssues: MaterialRateIssue[];
  applicabilityWarnings: BomApplicabilityWarning[];
  skippedUnmatchedBomItems: SkippedBomCostingItem[];
  archivedComponentsExcludedCount: number;
  warnings: string[];
  readyForCalculation: boolean;
}

function assertIsoCurrency(currency: string): string {
  if (!currency || typeof currency !== 'string') {
    throw new ValidationError(
      'Explicit 3-letter ISO-4217 currency code is required for BOM costing import.',
      'currency'
    );
  }
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ValidationError(
      `Invalid currency code "${currency}". Expected a 3-letter ISO-4217 code (e.g., USD, EUR, BDT).`,
      'currency'
    );
  }
  return normalized;
}

/**
 * Pure mapper from BOM component category (with MaterialCategory fallback)
 * to CostSheetLineCategory.
 */
export function mapBomCategoryToCostCategory(
  componentCategory?: BomComponentCategory,
  materialCategory?: MaterialCategory
): CostSheetLineCategory {
  if (componentCategory) {
    switch (componentCategory) {
      case 'FABRIC':
        return 'FABRIC';
      case 'TRIM':
      case 'LABEL':
        return 'TRIMS';
      case 'THREAD':
        return 'THREAD_CONSUMABLES';
      case 'PACKAGING':
        return 'PACKING';
    }
  }

  if (materialCategory) {
    switch (materialCategory) {
      case 'Knitted Fabric':
      case 'Woven Fabric':
        return 'FABRIC';
      case 'Trims & Fasteners':
        return 'TRIMS';
      case 'Threads & Notions':
        return 'THREAD_CONSUMABLES';
      case 'Packaging':
        return 'PACKING';
    }
  }

  return 'OTHER';
}

/**
 * Resolves a material's unit price safely against the target costing currency.
 * Never invents, assumes, or silently substitutes missing or currency-mismatched rates.
 */
export function resolveMaterialRate(
  material: Pick<MaterialEntity, 'id' | 'materialCode' | 'name' | 'standardUnitCost' | 'costCurrency'>,
  targetCurrency: string,
  manualOverrideRate?: number
): MaterialRateResolution {
  const normalizedTarget = assertIsoCurrency(targetCurrency);

  const hasValidMasterCost =
    typeof material.standardUnitCost === 'number' &&
    Number.isFinite(material.standardUnitCost) &&
    material.standardUnitCost >= 0;

  const normalizedMasterCurrency =
    typeof material.costCurrency === 'string' && material.costCurrency.trim().length > 0
      ? material.costCurrency.trim().toUpperCase()
      : undefined;

  const masterUnitCostSnapshot = hasValidMasterCost ? material.standardUnitCost : undefined;
  const masterCostCurrencySnapshot = normalizedMasterCurrency;

  // Validate manual override if provided
  if (manualOverrideRate !== undefined) {
    if (
      typeof manualOverrideRate !== 'number' ||
      !Number.isFinite(manualOverrideRate) ||
      manualOverrideRate < 0
    ) {
      throw new ValidationError(
        `Manual rate override for material "${material.materialCode}" must be a non-negative finite number (received ${manualOverrideRate}).`,
        'rateOverrides'
      );
    }

    return {
      status: 'MANUAL_OVERRIDE',
      resolvedUnitPrice: manualOverrideRate,
      masterUnitCostSnapshot,
      masterCostCurrencySnapshot,
      isRateOverridden: true,
      requiresManualRate: false,
    };
  }

  if (!hasValidMasterCost) {
    return {
      status: 'MISSING_MASTER_RATE',
      resolvedUnitPrice: undefined,
      masterUnitCostSnapshot: undefined,
      masterCostCurrencySnapshot,
      isRateOverridden: false,
      requiresManualRate: true,
      issueMessage: `Material "${material.materialCode}" (${material.name}) has no configured standardUnitCost; manual rate in ${normalizedTarget} is required.`,
    };
  }

  if (!normalizedMasterCurrency || normalizedMasterCurrency !== normalizedTarget) {
    return {
      status: 'CURRENCY_MISMATCH',
      resolvedUnitPrice: undefined,
      masterUnitCostSnapshot,
      masterCostCurrencySnapshot,
      isRateOverridden: false,
      requiresManualRate: true,
      issueMessage: `Material "${material.materialCode}" (${material.name}) standard rate (${material.standardUnitCost} ${
        normalizedMasterCurrency || 'UNSPECIFIED'
      }) does not match costing currency ${normalizedTarget}; manual rate in ${normalizedTarget} is required.`,
    };
  }

  return {
    status: 'MATCHED_MASTER_RATE',
    resolvedUnitPrice: material.standardUnitCost!,
    masterUnitCostSnapshot,
    masterCostCurrencySnapshot,
    isRateOverridden: false,
    requiresManualRate: false,
  };
}

/**
 * Pure helper to apply a manual rate override onto an existing CostingLineInput.
 * Preserves master rate snapshots and explicitly clears any stale costPerGarment
 * on consumption-driven lines so costingCalculator recalculates cleanly.
 */
export function applyManualRateOverride(
  line: CostingLineInput,
  overrideUnitPrice: number
): CostingLineInput {
  if (
    typeof overrideUnitPrice !== 'number' ||
    !Number.isFinite(overrideUnitPrice) ||
    overrideUnitPrice < 0
  ) {
    throw new ValidationError(
      `Manual unit price override must be a non-negative finite number (received ${overrideUnitPrice}).`,
      'unitPrice'
    );
  }

  const isConsumptionDriven = line.consumptionPerGarment !== undefined;

  return {
    ...line,
    unitPrice: overrideUnitPrice,
    isRateOverridden: true,
    costPerGarment: isConsumptionDriven ? undefined : overrideUnitPrice,
  };
}

/**
 * Pure helper to edit consumption, basis, UOM, wastage, or unit price on a
 * consumption-driven costing line while stripping any stale costPerGarment.
 */
export function updateConsumptionDrivenCostingLine(
  line: CostingLineInput,
  patch: Partial<
    Pick<
      CostingLineInput,
      | 'description'
      | 'category'
      | 'consumptionPerGarment'
      | 'consumptionBasis'
      | 'consumptionUnit'
      | 'wastagePercent'
      | 'unitPrice'
      | 'notes'
    >
  >
): CostingLineInput {
  const rateChanged =
    patch.unitPrice !== undefined && patch.unitPrice !== line.unitPrice;

  return {
    ...line,
    ...patch,
    isRateOverridden: rateChanged ? true : line.isRateOverridden,
    // Never carry a stale costPerGarment when consumption-driven parameters are edited
    costPerGarment: undefined,
  };
}

export class CostingBomService {
  private masterRepo: MasterRepository;
  private orderRepo: OrderRepository;
  private inventoryRepo: InventoryRepository;

  constructor(private database: StitchPilotDatabase) {
    this.masterRepo = new MasterRepository(database);
    this.orderRepo = new OrderRepository(database);
    this.inventoryRepo = new InventoryRepository(database);
  }

  async importBomToCostingLines(
    options: ImportBomToCostingOptions
  ): Promise<BomCostingImportResult> {
    const displayDecimals = options.displayDecimals ?? 4;
    const targetCurrency = assertIsoCurrency(options.currency);

    if (!options.styleId || !options.styleId.trim()) {
      throw new ValidationError('styleId is required for BOM costing import.', 'styleId');
    }

    const style = await this.masterRepo.getStyleById(options.styleId);
    if (!style) {
      throw new EntityNotFoundError('Style', options.styleId);
    }

    if (options.bomVersion !== undefined) {
      if (!Number.isInteger(options.bomVersion) || options.bomVersion < 1) {
        throw new ValidationError(
          `bomVersion must be a positive integer (received ${options.bomVersion}).`,
          'bomVersion'
        );
      }
    }

    // 1. Resolve active BOM items for explicit or latest active version
    const activeBomItems = await this.masterRepo.getActiveBomByStyle(
      style.id,
      options.bomVersion
    );

    if (activeBomItems.length === 0) {
      const versionLabel =
        options.bomVersion !== undefined ? `version ${options.bomVersion}` : 'any active version';
      throw new ValidationError(
        `Style "${style.styleCode}" (${style.id}) has no ACTIVE BOM items for ${versionLabel}.`,
        'bomVersion'
      );
    }

    const bomVersionUsed =
      options.bomVersion ?? Math.max(...activeBomItems.map((i) => i.bomVersion ?? 1));

    const allVersionItems = await this.masterRepo.getBomByStyleAndVersion(
      style.id,
      bomVersionUsed
    );
    const archivedComponentsExcludedCount = allVersionItems.filter(
      (i) => i.status === 'ARCHIVED'
    ).length;

    // 2. Load all referenced Material records
    const allMaterials = await this.inventoryRepo.getAllMaterials();
    const materialsById: Record<string, MaterialEntity> = {};
    for (const mat of allMaterials) {
      materialsById[mat.id] = mat;
    }

    for (const bomItem of activeBomItems) {
      if (!materialsById[bomItem.materialId]) {
        throw new RelationshipValidationError(
          'BomItem',
          'Material',
          bomItem.materialId,
          `BOM item "${bomItem.id}" references non-existent material "${bomItem.materialId}".`
        );
      }
    }

    const warnings: string[] = [];
    const rateIssues: MaterialRateIssue[] = [];
    const applicabilityWarnings: BomApplicabilityWarning[] = [];
    const skippedUnmatchedBomItems: SkippedBomCostingItem[] = [];

    if (archivedComponentsExcludedCount > 0) {
      warnings.push(
        `Excluded ${archivedComponentsExcludedCount} ARCHIVED BOM component(s) from style "${style.styleCode}" BOM v${bomVersionUsed}.`
      );
    }

    // 3. Optional Order-Level Context & Weighted BOM Calculation via bomCalculator.ts
    const normalizedOrderId = options.orderId?.trim() || undefined;
    let mode: 'STYLE' | 'ORDER' = 'STYLE';
    let orderPoNumber: string | undefined;
    let resolvedBuyerId = style.buyerId;
    let costingBasisQuantity: number | undefined;
    let usedOrderQuantityFallback = false;
    let orderBomLineById: Map<string, BomLineCalculationResult> | null = null;
    let totalOrderPiecesForStyle = 0;

    if (normalizedOrderId) {
      mode = 'ORDER';
      const order = await this.orderRepo.getOrderById(normalizedOrderId);
      if (!order) {
        throw new EntityNotFoundError('Order', normalizedOrderId);
      }
      if (order.status === 'CANCELLED') {
        throw new ValidationError(
          `Cannot import BOM for order costing on cancelled order "${order.poNumber}" (${order.id}).`,
          'orderId'
        );
      }

      const rawOrderItems = await this.orderRepo.getOrderItems(order.id);
      const orderStyles = new Set<string>([
        order.styleId,
        ...(order.additionalStyleIds || []),
        ...rawOrderItems.map((i) => i.styleId).filter((s): s is string => !!s),
      ]);
      if (!orderStyles.has(style.id)) {
        throw new RelationshipValidationError(
          'CostSheet',
          'Order',
          order.id,
          `Order "${order.poNumber}" is not linked to style "${style.styleCode}" (${style.id}).`
        );
      }

      orderPoNumber = order.poNumber;
      resolvedBuyerId = order.buyerId;

      const styleOrderItems = rawOrderItems.filter(
        (item) => (item.styleId || order.styleId) === style.id
      );

      let matrixRows: BomOrderMatrixRow[];
      if (styleOrderItems.length > 0) {
        matrixRows = styleOrderItems.map((item) => ({
          styleId: item.styleId || order.styleId,
          color: item.color,
          size: item.size,
          quantity: item.quantity,
        }));
      } else {
        usedOrderQuantityFallback = true;
        if (!Number.isFinite(order.orderQuantity) || order.orderQuantity <= 0) {
          throw new ValidationError(
            `Order "${order.poNumber}" has no order_items and invalid orderQuantity (${order.orderQuantity}).`,
            'orderQuantity'
          );
        }
        matrixRows = [
          {
            styleId: style.id,
            color: 'UNSPECIFIED',
            size: 'ALL',
            quantity: order.orderQuantity,
          },
        ];
        warnings.push(
          `Order "${order.poNumber}" has no colour/size matrix rows in order_items; fell back to order.orderQuantity (${order.orderQuantity} pcs) for style "${style.styleCode}".`
        );
      }

      // Reuse bomCalculator.ts directly — zero duplicated BOM, size-weighting, or UOM math
      const bomCalcResult = calculateOrderBomRequirements({
        primaryStyleId: style.id,
        orderItems: matrixRows,
        bomItems: activeBomItems,
        materialsById,
        includeArchived: false,
        displayDecimals,
      });

      totalOrderPiecesForStyle = bomCalcResult.totalGarmentPieces;
      if (totalOrderPiecesForStyle <= 0) {
        throw new ValidationError(
          `Order "${order.poNumber}" has zero total garment pieces for style "${style.styleCode}".`,
          'orderId'
        );
      }

      costingBasisQuantity = totalOrderPiecesForStyle;
      orderBomLineById = new Map(
        bomCalcResult.lineResults.map((lr) => [lr.bomItemId, lr])
      );
    }

    // 4. Build CostingLineInput[] & rich audit previews
    const lineItems: CostingLineInput[] = [];
    const linePreviews: ImportedBomCostLinePreview[] = [];

    for (const bomItem of activeBomItems) {
      const material = materialsById[bomItem.materialId];
      const consumptionBasis: ConsumptionBasis = bomItem.consumptionBasis ?? 'PER_PIECE';
      const consumptionUnit: ConsumptionUnit = bomItem.consumptionUnit ?? material.unit;
      const category = mapBomCategoryToCostCategory(
        bomItem.componentCategory,
        material.category
      );

      // Validate UOM conversion compatibility upfront using uomConverter.ts
      const { factor: conversionFactor, formulaDescription: conversionFormula } =
        getUomConversionFactor(consumptionUnit, material.unit, material.uomAttributes);

      // Check override lookup: bomItemId takes precedence over materialId
      const overrideRate =
        options.rateOverrides && Object.prototype.hasOwnProperty.call(options.rateOverrides, bomItem.id)
          ? options.rateOverrides[bomItem.id]
          : options.rateOverrides &&
            Object.prototype.hasOwnProperty.call(options.rateOverrides, material.id)
          ? options.rateOverrides[material.id]
          : undefined;

      const rateResolution = resolveMaterialRate(material, targetCurrency, overrideRate);

      let effectiveConsumption: number;
      let isWeightedByOrder = false;
      let orderMatchedGarmentPieces: number | undefined;
      let orderGrossStockExact: number | undefined;
      let orderGrossStockDisplay: number | undefined;
      let orderEstimatedMaterialCost: number | undefined;
      const lineNotesParts: string[] = [];

      if (bomItem.notes && bomItem.notes.trim()) {
        lineNotesParts.push(bomItem.notes.trim());
      }

      if (mode === 'ORDER' && orderBomLineById) {
        const bomLineCalc = orderBomLineById.get(bomItem.id);
        if (!bomLineCalc || bomLineCalc.matchedGarmentPieces <= 0) {
          const scopeDetail = [
            bomItem.colorScope === 'SPECIFIC'
              ? `colors=[${(bomItem.applicableColors || []).join(', ')}]`
              : null,
            bomItem.sizeScope === 'SPECIFIC'
              ? `sizes=[${(bomItem.applicableSizes || []).join(', ')}]`
              : null,
          ]
            .filter(Boolean)
            .join(', ');
          const skipReason = `Matched 0 of ${totalOrderPiecesForStyle} garments in order "${orderPoNumber}"${
            scopeDetail ? ` (${scopeDetail})` : ''
          }.`;
          skippedUnmatchedBomItems.push({
            bomItemId: bomItem.id,
            materialId: material.id,
            materialCode: material.materialCode,
            placement: bomItem.placement,
            reason: skipReason,
          });
          warnings.push(
            `Excluded BOM component "${bomItem.placement}" (${material.materialCode}) from order costing: ${skipReason}`
          );
          continue;
        }

        isWeightedByOrder = true;
        orderMatchedGarmentPieces = bomLineCalc.matchedGarmentPieces;
        orderGrossStockExact = bomLineCalc.grossRequirementStockUnitExact;
        orderGrossStockDisplay = bomLineCalc.grossRequirementStockUnit;

        // Weighted net consumption per order garment in bomItem's consumptionUnit & basis:
        // Ensures (costPerGarment * totalOrderPiecesForStyle) === (orderGrossStockExact * unitPrice)
        const weightedNetPerPieceConsUnit =
          bomLineCalc.netRequirementConsUnitExact / totalOrderPiecesForStyle;
        effectiveConsumption =
          consumptionBasis === 'PER_DOZEN'
            ? weightedNetPerPieceConsUnit * 12
            : weightedNetPerPieceConsUnit;

        if (rateResolution.resolvedUnitPrice !== undefined) {
          orderEstimatedMaterialCost = roundUomDisplay(
            bomLineCalc.grossRequirementStockUnitExact * rateResolution.resolvedUnitPrice,
            displayDecimals
          );
        }

        if (
          bomLineCalc.matchedGarmentPieces < totalOrderPiecesForStyle ||
          (bomItem.sizeConsumptionMap && Object.keys(bomItem.sizeConsumptionMap).length > 0)
        ) {
          lineNotesParts.push(
            `Order-weighted across ${bomLineCalc.matchedGarmentPieces}/${totalOrderPiecesForStyle} pcs in ${orderPoNumber}`
          );
        }
      } else {
        // Style-level costing: use base consumption and warn clearly on scoped/size-overridden items
        effectiveConsumption = bomItem.consumptionPerGarment;

        if (bomItem.colorScope === 'SPECIFIC') {
          const colors = bomItem.applicableColors || [];
          const msg = `Style-level costing uses base consumption for "${bomItem.placement}" (${material.materialCode}), which is colour-specific (${colors.join(', ')}). Use order-specific costing for colour-weighted cost.`;
          applicabilityWarnings.push({
            bomItemId: bomItem.id,
            materialId: material.id,
            materialCode: material.materialCode,
            placement: bomItem.placement,
            type: 'COLOR_SPECIFIC',
            applicableColors: [...colors],
            message: msg,
          });
          warnings.push(msg);
        }

        if (bomItem.sizeScope === 'SPECIFIC') {
          const sizes = bomItem.applicableSizes || [];
          const msg = `Style-level costing uses base consumption for "${bomItem.placement}" (${material.materialCode}), which is size-specific (${sizes.join(', ')}). Use order-specific costing for size-weighted cost.`;
          applicabilityWarnings.push({
            bomItemId: bomItem.id,
            materialId: material.id,
            materialCode: material.materialCode,
            placement: bomItem.placement,
            type: 'SIZE_SPECIFIC',
            applicableSizes: [...sizes],
            message: msg,
          });
          warnings.push(msg);
        }

        if (bomItem.sizeConsumptionMap && Object.keys(bomItem.sizeConsumptionMap).length > 0) {
          const overriddenSizes = Object.keys(bomItem.sizeConsumptionMap);
          const msg = `Style-level costing uses base consumption (${bomItem.consumptionPerGarment} ${consumptionUnit}) for "${bomItem.placement}" (${material.materialCode}), ignoring sizeConsumptionMap overrides for [${overriddenSizes.join(', ')}]. Use order-specific costing for weighted size costing.`;
          applicabilityWarnings.push({
            bomItemId: bomItem.id,
            materialId: material.id,
            materialCode: material.materialCode,
            placement: bomItem.placement,
            type: 'SIZE_CONSUMPTION_OVERRIDE',
            overriddenSizes,
            message: msg,
          });
          warnings.push(msg);
        }
      }

      // Record missing / currency-mismatched rate issues transparently
      if (rateResolution.requiresManualRate && rateResolution.issueMessage) {
        rateIssues.push({
          bomItemId: bomItem.id,
          materialId: material.id,
          materialCode: material.materialCode,
          materialName: material.name,
          reason:
            rateResolution.status === 'CURRENCY_MISMATCH'
              ? 'CURRENCY_MISMATCH'
              : 'MISSING_MASTER_RATE',
          masterUnitCost: rateResolution.masterUnitCostSnapshot,
          masterCostCurrency: rateResolution.masterCostCurrencySnapshot,
          targetCurrency,
          message: rateResolution.issueMessage,
        });
        warnings.push(rateResolution.issueMessage);
      }

      const lineInput: CostingLineInput = {
        id: `LI-${bomItem.id}`,
        category,
        description: `${material.name} — ${bomItem.placement}`,
        currency: targetCurrency,
        materialId: material.id,
        materialCode: material.materialCode,
        bomItemId: bomItem.id,
        sourceType: 'BOM_IMPORT',
        // Explicitly omit costPerGarment so costingCalculator always calculates from consumption x rate
        consumptionPerGarment: effectiveConsumption,
        consumptionBasis,
        consumptionUnit,
        wastagePercent: bomItem.wastagePercent,
        stockUnit: material.unit,
        uomAttributes: material.uomAttributes ? { ...material.uomAttributes } : undefined,
        unitPrice: rateResolution.resolvedUnitPrice,
        masterUnitCostSnapshot: rateResolution.masterUnitCostSnapshot,
        masterCostCurrencySnapshot: rateResolution.masterCostCurrencySnapshot,
        isRateOverridden: rateResolution.isRateOverridden,
        notes: lineNotesParts.length > 0 ? lineNotesParts.join(' | ') : undefined,
      };

      lineItems.push(lineInput);
      linePreviews.push({
        lineInput,
        bomItemId: bomItem.id,
        materialId: material.id,
        materialCode: material.materialCode,
        materialName: material.name,
        placement: bomItem.placement,
        category,
        consumptionBasis,
        consumptionUnit,
        stockUnit: material.unit,
        wastagePercent: bomItem.wastagePercent,
        conversionFactor,
        conversionFormula,
        rateResolution,
        isWeightedByOrder,
        baseConsumptionPerGarment: bomItem.consumptionPerGarment,
        effectiveConsumptionPerGarment: effectiveConsumption,
        orderMatchedGarmentPieces,
        orderTotalGarmentPieces: mode === 'ORDER' ? totalOrderPiecesForStyle : undefined,
        orderGrossRequirementStockUnitExact: orderGrossStockExact,
        orderGrossRequirementStockUnit: orderGrossStockDisplay,
        orderEstimatedMaterialCost,
      });
    }

    const readyForCalculation = lineItems.length > 0 && rateIssues.length === 0;

    return {
      mode,
      styleId: style.id,
      styleCode: style.styleCode,
      buyerId: resolvedBuyerId,
      orderId: normalizedOrderId,
      poNumber: orderPoNumber,
      bomVersionUsed,
      currency: targetCurrency,
      costingBasisQuantity,
      usedOrderQuantityFallback,
      lineItems,
      linePreviews,
      rateIssues,
      applicabilityWarnings,
      skippedUnmatchedBomItems,
      archivedComponentsExcludedCount,
      warnings,
      readyForCalculation,
    };
  }
}

export function createCostingBomService(database: StitchPilotDatabase): CostingBomService {
  return new CostingBomService(database);
}

export const costingBomService = createCostingBomService(db);
