import { StitchPilotDatabase } from '../database';
import {
  BomItemEntity,
  CostSheetEntity,
  CostSheetLineCategory,
  CostSheetLineItem,
  CostSheetStatus,
  MaterialEntity,
  OrderEntity,
  StyleEntity,
} from '../types';
import {
  EntityNotFoundError,
  InvalidStatusTransitionError,
  RelationshipValidationError,
  ValidationError,
} from '../errors';
import {
  calculateCostSheet,
  CmtInput,
  CostingCalculationInput,
  CostingLineInput,
  CostPricingMode,
  OverheadInput,
} from '../services/costingCalculator';

/**
 * StitchPilot Enterprise — Costing Repository (Phase 3A Stage 3)
 *
 * Manages persisted style-level and order-specific Cost Sheets, multi-revision
 * versioning, draft editing, approval transitions, and historical preservation.
 *
 * All costing math (materials, CMT rate basis, overheads, commission, FOB,
 * gross margin %, and markup %) delegates strictly to costingCalculator.ts.
 */

export interface CostSheetContext {
  styleId: string;
  orderId?: string;
}

export interface CreateCostSheetInput {
  id?: string;
  styleId: string;
  orderId?: string;
  buyerId?: string;
  version?: number;
  costingBasisQuantity?: number;
  bomVersionRef?: number;
  currency: string;
  lineItems?: CostingLineInput[];
  categoryCosts?: Partial<Record<CostSheetLineCategory, number>>;
  cmt: CmtInput;
  overhead: OverheadInput;
  commissionPercent?: number;
  pricingMode: CostPricingMode;
  quotedFobPrice?: number;
  targetMarginPercent?: number;
  targetMarkupPercent?: number;
  displayDecimals?: number;
  parentCostSheetId?: string;
  isSimulated?: boolean;
}

export interface UpdateDraftCostSheetInput {
  buyerId?: string;
  costingBasisQuantity?: number;
  bomVersionRef?: number;
  currency?: string;
  lineItems?: CostingLineInput[];
  categoryCosts?: Partial<Record<CostSheetLineCategory, number>>;
  cmt?: CmtInput;
  overhead?: OverheadInput;
  commissionPercent?: number;
  pricingMode?: CostPricingMode;
  quotedFobPrice?: number;
  targetMarginPercent?: number;
  targetMarkupPercent?: number;
  displayDecimals?: number;
}

export interface CreateRevisionOptions {
  newId?: string;
  version?: number;
  updates?: UpdateDraftCostSheetInput;
}

const VALID_TRANSITIONS: Record<CostSheetStatus, CostSheetStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  REJECTED: ['DRAFT'],
  APPROVED: ['SUPERSEDED'],
  SUPERSEDED: [],
};

const ALL_LINE_CATEGORIES: CostSheetLineCategory[] = [
  'FABRIC',
  'TRIMS',
  'THREAD_CONSUMABLES',
  'PACKING',
  'PRINTING_EMBROIDERY',
  'WASHING_FINISHING',
  'OTHER',
];

function sameContext(
  sheet: Pick<CostSheetEntity, 'styleId' | 'orderId'>,
  styleId: string,
  orderId?: string
): boolean {
  const normalizedSheetOrder = sheet.orderId?.trim() || undefined;
  const normalizedTargetOrder = orderId?.trim() || undefined;
  return sheet.styleId === styleId && normalizedSheetOrder === normalizedTargetOrder;
}

export class CostingRepository {
  constructor(private db: StitchPilotDatabase) {}

  // ====================================================
  // Read & Version Queries
  // ====================================================

  async getCostSheetById(id: string): Promise<CostSheetEntity | undefined> {
    return this.db.cost_sheets.get(id);
  }

  async getAllCostSheets(): Promise<CostSheetEntity[]> {
    return this.db.cost_sheets.toArray();
  }

  async getCostSheetsByStyle(
    styleId: string,
    options?: { includeOrderSpecific?: boolean; status?: CostSheetStatus }
  ): Promise<CostSheetEntity[]> {
    const includeOrderSpecific = options?.includeOrderSpecific ?? true;
    const rows = await this.db.cost_sheets.where('styleId').equals(styleId).toArray();

    return rows
      .filter((row) => {
        if (!includeOrderSpecific && row.orderId) return false;
        if (options?.status && (row.status ?? 'DRAFT') !== options.status) return false;
        return true;
      })
      .sort((a, b) => a.version - b.version);
  }

  async getCostSheetsByOrder(
    orderId: string,
    options?: { styleId?: string; status?: CostSheetStatus }
  ): Promise<CostSheetEntity[]> {
    const rows = await this.db.cost_sheets.where('orderId').equals(orderId).toArray();
    return rows
      .filter((row) => {
        if (options?.styleId && row.styleId !== options.styleId) return false;
        if (options?.status && (row.status ?? 'DRAFT') !== options.status) return false;
        return true;
      })
      .sort((a, b) => a.version - b.version);
  }

  async getCostSheetVersions(context: CostSheetContext): Promise<CostSheetEntity[]> {
    const styleRows = await this.db.cost_sheets
      .where('styleId')
      .equals(context.styleId)
      .toArray();

    return styleRows
      .filter((row) => sameContext(row, context.styleId, context.orderId))
      .sort((a, b) => a.version - b.version);
  }

  async getCostSheetByVersion(
    context: CostSheetContext & { version: number }
  ): Promise<CostSheetEntity | undefined> {
    const candidates = await this.db.cost_sheets
      .where('[styleId+version]')
      .equals([context.styleId, context.version])
      .toArray();

    return candidates.find((row) =>
      sameContext(row, context.styleId, context.orderId)
    );
  }

  async getLatestCostSheet(
    context: CostSheetContext
  ): Promise<CostSheetEntity | undefined> {
    const versions = await this.getCostSheetVersions(context);
    if (versions.length === 0) return undefined;
    return versions[versions.length - 1];
  }

  async getActiveApprovedCostSheet(
    context: CostSheetContext
  ): Promise<CostSheetEntity | undefined> {
    const versions = await this.getCostSheetVersions(context);
    const approved = versions.filter((v) => v.status === 'APPROVED');
    if (approved.length === 0) return undefined;
    return approved[approved.length - 1];
  }

  // ====================================================
  // Internal Validation & Calculation Helpers
  // ====================================================

  private async validateRelationships(params: {
    styleId: string;
    orderId?: string;
    buyerId?: string;
    bomVersionRef?: number;
    costingBasisQuantity?: number;
    lineItems?: Array<{ materialId?: string; bomItemId?: string; description: string }>;
  }): Promise<{ style: StyleEntity; order?: OrderEntity }> {
    if (!params.styleId || !params.styleId.trim()) {
      throw new ValidationError('Style ID is required for cost sheet.', 'styleId');
    }

    const style = await this.db.styles.get(params.styleId);
    if (!style) {
      throw new RelationshipValidationError(
        'CostSheet',
        'Style',
        params.styleId,
        'Referenced garment style does not exist.'
      );
    }

    let order: OrderEntity | undefined;
    const normalizedOrderId = params.orderId?.trim() || undefined;
    if (normalizedOrderId) {
      order = await this.db.orders.get(normalizedOrderId);
      if (!order) {
        throw new RelationshipValidationError(
          'CostSheet',
          'Order',
          normalizedOrderId,
          'Referenced purchase order does not exist.'
        );
      }

      if (order.status === 'CANCELLED') {
        throw new ValidationError(
          `Cannot create or modify cost sheet for cancelled order "${order.poNumber}" (${order.id}).`,
          'orderId'
        );
      }

      const orderItems = await this.db.order_items
        .where('orderId')
        .equals(order.id)
        .toArray();
      const orderStyles = new Set<string>([
        order.styleId,
        ...(order.additionalStyleIds || []),
        ...orderItems.map((i) => i.styleId).filter((s): s is string => !!s),
      ]);

      if (!orderStyles.has(params.styleId)) {
        throw new RelationshipValidationError(
          'CostSheet',
          'Order',
          normalizedOrderId,
          `Order "${order.poNumber}" is not linked to style "${params.styleId}".`
        );
      }
    }

    if (params.buyerId !== undefined && params.buyerId.trim() !== '') {
      const buyer = await this.db.buyers.get(params.buyerId);
      if (!buyer) {
        throw new RelationshipValidationError(
          'CostSheet',
          'Buyer',
          params.buyerId,
          'Referenced buyer does not exist.'
        );
      }
      if (order && params.buyerId !== order.buyerId) {
        throw new ValidationError(
          `Buyer "${params.buyerId}" does not match order "${order.poNumber}" buyer "${order.buyerId}".`,
          'buyerId'
        );
      }
      if (!order && params.buyerId !== style.buyerId) {
        throw new ValidationError(
          `Buyer "${params.buyerId}" does not match style "${style.styleCode}" buyer "${style.buyerId}".`,
          'buyerId'
        );
      }
    }

    if (params.bomVersionRef !== undefined) {
      if (!Number.isInteger(params.bomVersionRef) || params.bomVersionRef < 1) {
        throw new ValidationError(
          `bomVersionRef must be a positive integer (received ${params.bomVersionRef}).`,
          'bomVersionRef'
        );
      }
      const matchingBomItems = await this.db.bom_items
        .where('[styleId+bomVersion]')
        .equals([params.styleId, params.bomVersionRef])
        .toArray();
      if (matchingBomItems.length === 0) {
        throw new RelationshipValidationError(
          'CostSheet',
          'BomItem',
          `${params.styleId}:v${params.bomVersionRef}`,
          `Style "${params.styleId}" has no BOM items for version ${params.bomVersionRef}.`
        );
      }
    }

    if (params.costingBasisQuantity !== undefined) {
      if (
        typeof params.costingBasisQuantity !== 'number' ||
        !Number.isFinite(params.costingBasisQuantity) ||
        params.costingBasisQuantity <= 0
      ) {
        throw new ValidationError(
          `costingBasisQuantity must be a positive finite number (received ${params.costingBasisQuantity}).`,
          'costingBasisQuantity'
        );
      }
    }

    if (params.lineItems) {
      for (const line of params.lineItems) {
        if (line.materialId) {
          const mat: MaterialEntity | undefined = await this.db.materials.get(
            line.materialId
          );
          if (!mat) {
            throw new RelationshipValidationError(
              'CostSheetLineItem',
              'Material',
              line.materialId,
              `Cost line "${line.description}" references non-existent material.`
            );
          }
        }
        if (line.bomItemId) {
          const bomItem: BomItemEntity | undefined = await this.db.bom_items.get(
            line.bomItemId
          );
          if (!bomItem) {
            throw new RelationshipValidationError(
              'CostSheetLineItem',
              'BomItem',
              line.bomItemId,
              `Cost line "${line.description}" references non-existent BOM item.`
            );
          }
          if (bomItem.styleId !== params.styleId) {
            throw new RelationshipValidationError(
              'CostSheetLineItem',
              'BomItem',
              line.bomItemId,
              `BOM item "${line.bomItemId}" belongs to style "${bomItem.styleId}", not "${params.styleId}".`
            );
          }
        }
      }
    }

    return { style, order };
  }

  private async hydrateLineItemsForCalculation(
    lineItems?: CostingLineInput[]
  ): Promise<CostingLineInput[] | undefined> {
    if (!lineItems || lineItems.length === 0) return lineItems;

    const materialIdsToFetch = Array.from(
      new Set(
        lineItems
          .map((li) => li.materialId)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      )
    );

    const materialsById = new Map<string, MaterialEntity>();
    if (materialIdsToFetch.length > 0) {
      const fetched = await this.db.materials.bulkGet(materialIdsToFetch);
      for (const mat of fetched) {
        if (mat) {
          materialsById.set(mat.id, mat);
        }
      }
    }

    return lineItems.map((line) => {
      const material = line.materialId ? materialsById.get(line.materialId) : undefined;
      const isConsumptionDriven = line.consumptionPerGarment !== undefined;

      const hydrated: CostingLineInput = {
        ...line,
        // Guard against stale costPerGarment on consumption-driven lines while preserving direct-cost lines
        costPerGarment: isConsumptionDriven ? undefined : line.costPerGarment,
        uomAttributes:
          line.uomAttributes ??
          (material?.uomAttributes ? { ...material.uomAttributes } : undefined),
        stockUnit:
          line.stockUnit ?? (isConsumptionDriven && material ? material.unit : undefined),
        materialCode: line.materialCode ?? material?.materialCode,
      };

      return hydrated;
    });
  }

  private buildCalculationInputFromEntity(
    sheet: CostSheetEntity,
    overrides?: UpdateDraftCostSheetInput
  ): CostingCalculationInput {
    const lineItemsToUse: CostingLineInput[] | undefined = overrides?.lineItems
      ? overrides.lineItems
      : sheet.lineItems?.map((li: CostSheetLineItem) => {
          const isConsumptionDriven = li.consumptionPerGarment !== undefined;
          return {
            id: li.id,
            category: li.category,
            description: li.description,
            currency: li.currency,
            materialId: li.materialId,
            materialCode: li.materialCode,
            bomItemId: li.bomItemId,
            sourceType: li.sourceType,
            costPerGarment: isConsumptionDriven ? undefined : li.costPerGarment,
            consumptionPerGarment: li.consumptionPerGarment,
            consumptionBasis: li.consumptionBasis,
            consumptionUnit: li.consumptionUnit,
            wastagePercent: li.wastagePercent,
            stockUnit: li.stockUnit,
            uomAttributes: li.uomAttributesSnapshot
              ? { ...li.uomAttributesSnapshot }
              : undefined,
            unitPrice: li.unitPrice,
            masterUnitCostSnapshot: li.masterUnitCostSnapshot,
            masterCostCurrencySnapshot: li.masterCostCurrencySnapshot,
            isRateOverridden: li.isRateOverridden,
            notes: li.notes,
          };
        });

    let categoryCostsToUse: Partial<Record<CostSheetLineCategory, number>>;
    if (overrides?.categoryCosts !== undefined) {
      categoryCostsToUse = overrides.categoryCosts;
    } else {
      const entityCategoryTotals: Record<CostSheetLineCategory, number> = {
        FABRIC: sheet.fabricCost ?? 0,
        TRIMS: sheet.trimsCost ?? 0,
        THREAD_CONSUMABLES: sheet.threadConsumablesCost ?? 0,
        PACKING: sheet.packingCost ?? 0,
        PRINTING_EMBROIDERY: sheet.printingEmbroideryCost ?? 0,
        WASHING_FINISHING: sheet.washingFinishingCost ?? 0,
        OTHER: sheet.otherDirectCost ?? 0,
      };

      const lineSums: Record<CostSheetLineCategory, number> = {
        FABRIC: 0,
        TRIMS: 0,
        THREAD_CONSUMABLES: 0,
        PACKING: 0,
        PRINTING_EMBROIDERY: 0,
        WASHING_FINISHING: 0,
        OTHER: 0,
      };

      // Always subtract costs already represented inside sheet.lineItems so replacing
      // lineItems on draft update/revision never double-counts prior line totals
      if (sheet.lineItems) {
        for (const li of sheet.lineItems) {
          lineSums[li.category] += li.costPerGarment;
        }
      }

      categoryCostsToUse = {};
      for (const cat of ALL_LINE_CATEGORIES) {
        const residual = entityCategoryTotals[cat] - lineSums[cat];
        if (residual > 1e-9) {
          categoryCostsToUse[cat] = Number(residual.toFixed(6));
        }
      }
    }

    let cmtToUse: CmtInput;
    if (overrides?.cmt) {
      cmtToUse = overrides.cmt;
    } else if (
      sheet.cmtCalculationMethod === 'SAM_RATE' &&
      sheet.samSnapshot !== undefined &&
      sheet.efficiencySnapshot !== undefined &&
      sheet.cmRatePerMinute !== undefined &&
      sheet.cmRateBasis !== undefined
    ) {
      cmtToUse = {
        method: 'SAM_RATE',
        samMinutes: sheet.samSnapshot,
        efficiencyPercent: sheet.efficiencySnapshot,
        cmRatePerMinute: sheet.cmRatePerMinute,
        cmRateBasis: sheet.cmRateBasis,
      };
    } else {
      cmtToUse = {
        method: 'DIRECT_CMT',
        directCmtCost: sheet.laborCmtCost ?? 0,
      };
    }

    let overheadToUse: OverheadInput;
    if (overrides?.overhead) {
      overheadToUse = overrides.overhead;
    } else if (sheet.overheadMethod && sheet.overheadValue !== undefined) {
      overheadToUse = {
        method: sheet.overheadMethod,
        value: sheet.overheadValue,
      };
    } else {
      overheadToUse = {
        method: 'FIXED_PER_GARMENT',
        value: sheet.overheadCost ?? 0,
      };
    }

    let pricingMode: CostPricingMode = overrides?.pricingMode ?? 'FOB_TO_MARGIN';
    if (!overrides?.pricingMode) {
      if (overrides?.targetMarginPercent !== undefined) {
        pricingMode = 'MARGIN_TO_FOB';
      } else if (overrides?.targetMarkupPercent !== undefined) {
        pricingMode = 'MARKUP_TO_FOB';
      }
    }

    return {
      currency: overrides?.currency ?? sheet.currency,
      lineItems: lineItemsToUse,
      categoryCosts: categoryCostsToUse,
      cmt: cmtToUse,
      overhead: overheadToUse,
      commissionPercent:
        overrides?.commissionPercent ?? sheet.commissionPercent ?? 0,
      pricingMode,
      quotedFobPrice: overrides?.quotedFobPrice ?? sheet.quotedFobPrice,
      targetMarginPercent: overrides?.targetMarginPercent,
      targetMarkupPercent: overrides?.targetMarkupPercent,
      displayDecimals: overrides?.displayDecimals ?? 4,
    };
  }

  private mapCalculatedResultToEntityFields(
    calcInput: CostingCalculationInput
  ): Partial<CostSheetEntity> {
    const calc = calculateCostSheet(calcInput);

    return {
      currency: calc.currency,
      fabricCost: calc.fabricCost,
      trimsCost: calc.trimsCost,
      threadConsumablesCost: calc.threadConsumablesCost,
      packingCost: calc.packingCost,
      printingEmbroideryCost: calc.printingEmbroideryCost,
      washingFinishingCost: calc.washingFinishingCost,
      otherDirectCost: calc.otherDirectCost,
      laborCmtCost: calc.laborCmtCost,
      overheadCost: calc.overheadCost,
      totalCostPerGarment: calc.totalManufacturingCost,
      quotedFobPrice: calc.quotedFobPrice,
      marginPercent: calc.grossMarginPercent,
      markupPercent: calc.markupPercent,
      profitPerGarment: calc.profitPerGarment,
      commissionPercent: calc.commissionPercent,
      cmtCalculationMethod: calcInput.cmt.method,
      samSnapshot:
        calcInput.cmt.method === 'SAM_RATE' ? calcInput.cmt.samMinutes : undefined,
      efficiencySnapshot:
        calcInput.cmt.method === 'SAM_RATE'
          ? calcInput.cmt.efficiencyPercent
          : undefined,
      cmRatePerMinute:
        calcInput.cmt.method === 'SAM_RATE'
          ? calcInput.cmt.cmRatePerMinute
          : undefined,
      cmRateBasis:
        calcInput.cmt.method === 'SAM_RATE' ? calcInput.cmt.cmRateBasis : undefined,
      overheadMethod: calcInput.overhead.method,
      overheadValue: calcInput.overhead.value,
      lineItems: calc.calculatedLineItems,
    };
  }

  private assertUniqueVersionInContext(
    existingInContext: CostSheetEntity[],
    version: number,
    styleId: string,
    orderId?: string
  ): void {
    if (!Number.isInteger(version) || version < 1) {
      throw new ValidationError(
        `Cost sheet version must be a positive integer (received ${version}).`,
        'version'
      );
    }

    const duplicate = existingInContext.find((s) => s.version === version);
    if (duplicate) {
      const scopeLabel = orderId
        ? `style "${styleId}" / order "${orderId}"`
        : `style "${styleId}"`;
      throw new ValidationError(
        `Cost sheet version ${version} already exists for ${scopeLabel} (existing ID: ${duplicate.id}).`,
        'version',
        { existingId: duplicate.id, version, styleId, orderId }
      );
    }
  }

  // ====================================================
  // Create, Update Draft & Revision Operations
  // ====================================================

  async createCostSheet(input: CreateCostSheetInput): Promise<CostSheetEntity> {
    const normalizedOrderId = input.orderId?.trim() || undefined;
    const { style, order } = await this.validateRelationships({
      styleId: input.styleId,
      orderId: normalizedOrderId,
      buyerId: input.buyerId,
      bomVersionRef: input.bomVersionRef,
      costingBasisQuantity: input.costingBasisQuantity,
      lineItems: input.lineItems,
    });

    if (input.parentCostSheetId) {
      const parent = await this.db.cost_sheets.get(input.parentCostSheetId);
      if (!parent) {
        throw new RelationshipValidationError(
          'CostSheet',
          'ParentCostSheet',
          input.parentCostSheetId,
          'Referenced parentCostSheetId does not exist.'
        );
      }
      if (!sameContext(parent, input.styleId, normalizedOrderId)) {
        throw new ValidationError(
          `parentCostSheetId "${input.parentCostSheetId}" belongs to a different style/order context.`,
          'parentCostSheetId'
        );
      }
    }

    // Hydrate material UOM attributes & guard against stale costPerGarment before calculation
    const hydratedLineItems = await this.hydrateLineItemsForCalculation(input.lineItems);

    // Calculate strictly via costingCalculator.ts
    const computedFields = this.mapCalculatedResultToEntityFields({
      currency: input.currency,
      lineItems: hydratedLineItems,
      categoryCosts: input.categoryCosts,
      cmt: input.cmt,
      overhead: input.overhead,
      commissionPercent: input.commissionPercent,
      pricingMode: input.pricingMode,
      quotedFobPrice: input.quotedFobPrice,
      targetMarginPercent: input.targetMarginPercent,
      targetMarkupPercent: input.targetMarkupPercent,
      displayDecimals: input.displayDecimals ?? 4,
    });

    return await this.db.transaction(
      'rw',
      [
        this.db.cost_sheets,
        this.db.styles,
        this.db.orders,
        this.db.order_items,
        this.db.buyers,
        this.db.materials,
        this.db.bom_items,
      ],
      async () => {
        const resolvedId =
          input.id && input.id.trim()
            ? input.id.trim()
            : `CST-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        const existingWithId = await this.db.cost_sheets.get(resolvedId);
        if (existingWithId) {
          throw new ValidationError(
            `Cost sheet ID "${resolvedId}" already exists.`,
            'id'
          );
        }

        const existingInContext = await this.getCostSheetVersions({
          styleId: input.styleId,
          orderId: normalizedOrderId,
        });

        const resolvedVersion =
          input.version !== undefined
            ? input.version
            : existingInContext.length > 0
            ? Math.max(...existingInContext.map((s) => s.version)) + 1
            : 1;

        this.assertUniqueVersionInContext(
          existingInContext,
          resolvedVersion,
          input.styleId,
          normalizedOrderId
        );

        const now = new Date().toISOString();
        const resolvedBuyerId =
          input.buyerId?.trim() || order?.buyerId || style.buyerId;

        const entity: CostSheetEntity = {
          id: resolvedId,
          styleId: input.styleId,
          orderId: normalizedOrderId,
          buyerId: resolvedBuyerId,
          version: resolvedVersion,
          status: 'DRAFT',
          currency: computedFields.currency!,
          costingBasisQuantity: input.costingBasisQuantity,
          bomVersionRef: input.bomVersionRef,
          fabricCost: computedFields.fabricCost!,
          trimsCost: computedFields.trimsCost!,
          threadConsumablesCost: computedFields.threadConsumablesCost!,
          packingCost: computedFields.packingCost!,
          printingEmbroideryCost: computedFields.printingEmbroideryCost!,
          washingFinishingCost: computedFields.washingFinishingCost!,
          otherDirectCost: computedFields.otherDirectCost!,
          laborCmtCost: computedFields.laborCmtCost!,
          overheadCost: computedFields.overheadCost!,
          totalCostPerGarment: computedFields.totalCostPerGarment!,
          quotedFobPrice: computedFields.quotedFobPrice!,
          marginPercent: computedFields.marginPercent!,
          markupPercent: computedFields.markupPercent!,
          profitPerGarment: computedFields.profitPerGarment!,
          commissionPercent: computedFields.commissionPercent!,
          samSnapshot: computedFields.samSnapshot,
          efficiencySnapshot: computedFields.efficiencySnapshot,
          cmRatePerMinute: computedFields.cmRatePerMinute,
          cmRateBasis: computedFields.cmRateBasis,
          cmtCalculationMethod: computedFields.cmtCalculationMethod,
          overheadMethod: computedFields.overheadMethod,
          overheadValue: computedFields.overheadValue,
          lineItems: computedFields.lineItems,
          parentCostSheetId: input.parentCostSheetId,
          approvedBy: '',
          isSimulated: input.isSimulated ?? true,
          createdAt: now,
          updatedAt: now,
        };

        await this.db.cost_sheets.add(entity);
        return entity;
      }
    );
  }

  async updateDraftCostSheet(
    costSheetId: string,
    updates: UpdateDraftCostSheetInput
  ): Promise<CostSheetEntity> {
    if (!costSheetId || !costSheetId.trim()) {
      throw new ValidationError('Cost sheet ID is required.', 'costSheetId');
    }

    return await this.db.transaction(
      'rw',
      [
        this.db.cost_sheets,
        this.db.styles,
        this.db.orders,
        this.db.order_items,
        this.db.buyers,
        this.db.materials,
        this.db.bom_items,
      ],
      async () => {
        const existing = await this.db.cost_sheets.get(costSheetId);
        if (!existing) {
          throw new EntityNotFoundError('CostSheet', costSheetId);
        }

        const currentStatus = existing.status ?? 'DRAFT';
        if (currentStatus !== 'DRAFT') {
          throw new ValidationError(
            `Only DRAFT cost sheets can be modified. Cost sheet "${existing.id}" (v${existing.version}) has status "${currentStatus}"; create a new revision instead.`,
            'status',
            { costSheetId: existing.id, currentStatus }
          );
        }

        // Guard against unauthorized status/version/approval fields injected dynamically
        const rawUpdates = updates as Record<string, unknown>;
        for (const forbiddenField of [
          'id',
          'styleId',
          'orderId',
          'version',
          'status',
          'approvedBy',
          'approvedAt',
          'parentCostSheetId',
        ]) {
          if (rawUpdates[forbiddenField] !== undefined) {
            throw new ValidationError(
              `Field "${forbiddenField}" cannot be modified via updateDraftCostSheet.`,
              forbiddenField
            );
          }
        }

        await this.validateRelationships({
          styleId: existing.styleId,
          orderId: existing.orderId,
          buyerId: updates.buyerId ?? existing.buyerId,
          bomVersionRef: updates.bomVersionRef ?? existing.bomVersionRef,
          costingBasisQuantity:
            updates.costingBasisQuantity ?? existing.costingBasisQuantity,
          lineItems: updates.lineItems,
        });

        const calcInput = this.buildCalculationInputFromEntity(existing, updates);
        calcInput.lineItems = await this.hydrateLineItemsForCalculation(calcInput.lineItems);
        const computedFields = this.mapCalculatedResultToEntityFields(calcInput);

        const updated: CostSheetEntity = {
          ...existing,
          buyerId: updates.buyerId !== undefined ? updates.buyerId : existing.buyerId,
          costingBasisQuantity:
            updates.costingBasisQuantity !== undefined
              ? updates.costingBasisQuantity
              : existing.costingBasisQuantity,
          bomVersionRef:
            updates.bomVersionRef !== undefined
              ? updates.bomVersionRef
              : existing.bomVersionRef,
          currency: computedFields.currency!,
          fabricCost: computedFields.fabricCost!,
          trimsCost: computedFields.trimsCost!,
          threadConsumablesCost: computedFields.threadConsumablesCost!,
          packingCost: computedFields.packingCost!,
          printingEmbroideryCost: computedFields.printingEmbroideryCost!,
          washingFinishingCost: computedFields.washingFinishingCost!,
          otherDirectCost: computedFields.otherDirectCost!,
          laborCmtCost: computedFields.laborCmtCost!,
          overheadCost: computedFields.overheadCost!,
          totalCostPerGarment: computedFields.totalCostPerGarment!,
          quotedFobPrice: computedFields.quotedFobPrice!,
          marginPercent: computedFields.marginPercent!,
          markupPercent: computedFields.markupPercent!,
          profitPerGarment: computedFields.profitPerGarment!,
          commissionPercent: computedFields.commissionPercent!,
          samSnapshot: computedFields.samSnapshot,
          efficiencySnapshot: computedFields.efficiencySnapshot,
          cmRatePerMinute: computedFields.cmRatePerMinute,
          cmRateBasis: computedFields.cmRateBasis,
          cmtCalculationMethod: computedFields.cmtCalculationMethod,
          overheadMethod: computedFields.overheadMethod,
          overheadValue: computedFields.overheadValue,
          lineItems: computedFields.lineItems,
          updatedAt: new Date().toISOString(),
        };

        await this.db.cost_sheets.put(updated);
        return updated;
      }
    );
  }

  /**
   * Creates a new DRAFT revision from an existing cost sheet without modifying
   * or overwriting historical versions.
   */
  async createRevision(
    sourceCostSheetId: string,
    options: CreateRevisionOptions = {}
  ): Promise<CostSheetEntity> {
    if (!sourceCostSheetId || !sourceCostSheetId.trim()) {
      throw new ValidationError(
        'Source cost sheet ID is required to create a revision.',
        'sourceCostSheetId'
      );
    }

    return await this.db.transaction(
      'rw',
      [
        this.db.cost_sheets,
        this.db.styles,
        this.db.orders,
        this.db.order_items,
        this.db.buyers,
        this.db.materials,
        this.db.bom_items,
      ],
      async () => {
        const source = await this.db.cost_sheets.get(sourceCostSheetId);
        if (!source) {
          throw new EntityNotFoundError('CostSheet', sourceCostSheetId);
        }

        const updates = options.updates;
        await this.validateRelationships({
          styleId: source.styleId,
          orderId: source.orderId,
          buyerId: updates?.buyerId ?? source.buyerId,
          bomVersionRef: updates?.bomVersionRef ?? source.bomVersionRef,
          costingBasisQuantity:
            updates?.costingBasisQuantity ?? source.costingBasisQuantity,
          lineItems: updates?.lineItems,
        });

        const existingInContext = await this.getCostSheetVersions({
          styleId: source.styleId,
          orderId: source.orderId,
        });

        const nextVersion =
          options.version !== undefined
            ? options.version
            : Math.max(...existingInContext.map((s) => s.version), 0) + 1;

        this.assertUniqueVersionInContext(
          existingInContext,
          nextVersion,
          source.styleId,
          source.orderId
        );

        const newId =
          options.newId && options.newId.trim()
            ? options.newId.trim()
            : `CST-${source.styleId}-V${nextVersion}-${Date.now()}-${Math.random()
                .toString(36)
                .substring(2, 5)
                .toUpperCase()}`;

        const existingWithId = await this.db.cost_sheets.get(newId);
        if (existingWithId) {
          throw new ValidationError(
            `Cost sheet ID "${newId}" already exists.`,
            'newId'
          );
        }

        const calcInput = this.buildCalculationInputFromEntity(source, updates);
        calcInput.lineItems = await this.hydrateLineItemsForCalculation(calcInput.lineItems);
        const computedFields = this.mapCalculatedResultToEntityFields(calcInput);
        const now = new Date().toISOString();

        const revision: CostSheetEntity = {
          id: newId,
          styleId: source.styleId,
          orderId: source.orderId,
          buyerId: updates?.buyerId ?? source.buyerId,
          version: nextVersion,
          status: 'DRAFT',
          currency: computedFields.currency!,
          costingBasisQuantity:
            updates?.costingBasisQuantity ?? source.costingBasisQuantity,
          bomVersionRef: updates?.bomVersionRef ?? source.bomVersionRef,
          fabricCost: computedFields.fabricCost!,
          trimsCost: computedFields.trimsCost!,
          threadConsumablesCost: computedFields.threadConsumablesCost!,
          packingCost: computedFields.packingCost!,
          printingEmbroideryCost: computedFields.printingEmbroideryCost!,
          washingFinishingCost: computedFields.washingFinishingCost!,
          otherDirectCost: computedFields.otherDirectCost!,
          laborCmtCost: computedFields.laborCmtCost!,
          overheadCost: computedFields.overheadCost!,
          totalCostPerGarment: computedFields.totalCostPerGarment!,
          quotedFobPrice: computedFields.quotedFobPrice!,
          marginPercent: computedFields.marginPercent!,
          markupPercent: computedFields.markupPercent!,
          profitPerGarment: computedFields.profitPerGarment!,
          commissionPercent: computedFields.commissionPercent!,
          samSnapshot: computedFields.samSnapshot,
          efficiencySnapshot: computedFields.efficiencySnapshot,
          cmRatePerMinute: computedFields.cmRatePerMinute,
          cmRateBasis: computedFields.cmRateBasis,
          cmtCalculationMethod: computedFields.cmtCalculationMethod,
          overheadMethod: computedFields.overheadMethod,
          overheadValue: computedFields.overheadValue,
          lineItems: computedFields.lineItems,
          parentCostSheetId: source.id,
          approvedBy: '',
          approvedAt: undefined,
          rejectionReason: undefined,
          isSimulated: source.isSimulated,
          createdAt: now,
          updatedAt: now,
        };

        await this.db.cost_sheets.add(revision);
        return revision;
      }
    );
  }

  // ====================================================
  // Status & Approval Lifecycle Transitions
  // ====================================================

  private assertValidTransition(
    costSheetId: string,
    fromStatus: CostSheetStatus,
    toStatus: CostSheetStatus
  ): void {
    const allowed = VALID_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new InvalidStatusTransitionError(
        costSheetId,
        fromStatus,
        toStatus,
        `Cost sheet "${costSheetId}" cannot transition from "${fromStatus}" to "${toStatus}". Allowed next statuses from ${fromStatus}: ${
          allowed.length > 0 ? allowed.join(', ') : 'NONE (terminal/auto-only)'
        }.`
      );
    }
  }

  async submitForApproval(costSheetId: string): Promise<CostSheetEntity> {
    if (!costSheetId || !costSheetId.trim()) {
      throw new ValidationError('Cost sheet ID is required.', 'costSheetId');
    }

    return await this.db.transaction(
      'rw',
      [
        this.db.cost_sheets,
        this.db.styles,
        this.db.orders,
        this.db.order_items,
        this.db.buyers,
        this.db.materials,
        this.db.bom_items,
      ],
      async () => {
        const existing = await this.db.cost_sheets.get(costSheetId);
        if (!existing) {
          throw new EntityNotFoundError('CostSheet', costSheetId);
        }

        const currentStatus = existing.status ?? 'DRAFT';
        this.assertValidTransition(existing.id, currentStatus, 'SUBMITTED');

        await this.validateRelationships({
          styleId: existing.styleId,
          orderId: existing.orderId,
          buyerId: existing.buyerId,
          bomVersionRef: existing.bomVersionRef,
          costingBasisQuantity: existing.costingBasisQuantity,
          lineItems: existing.lineItems,
        });

        // Re-validate arithmetic integrity via costingCalculator before submission
        const calcInput = this.buildCalculationInputFromEntity(existing);
        calcInput.lineItems = await this.hydrateLineItemsForCalculation(calcInput.lineItems);
        calculateCostSheet(calcInput);

        if (existing.quotedFobPrice <= 0 || existing.totalCostPerGarment < 0) {
          throw new ValidationError(
            `Cost sheet "${existing.id}" must have positive quotedFobPrice and non-negative cost before submission.`,
            'quotedFobPrice'
          );
        }

        const updated: CostSheetEntity = {
          ...existing,
          status: 'SUBMITTED',
          rejectionReason: undefined,
          updatedAt: new Date().toISOString(),
        };

        await this.db.cost_sheets.put(updated);
        return updated;
      }
    );
  }

  /**
   * Atomically approves a SUBMITTED cost sheet and supersedes any previously
   * APPROVED cost sheet in the same (styleId, orderId) context while preserving
   * all historical financial & approval values on the superseded record.
   */
  async approveCostSheet(
    costSheetId: string,
    approvedBy: string
  ): Promise<{ approved: CostSheetEntity; superseded: CostSheetEntity[] }> {
    if (!costSheetId || !costSheetId.trim()) {
      throw new ValidationError('Cost sheet ID is required.', 'costSheetId');
    }
    if (!approvedBy || !approvedBy.trim()) {
      throw new ValidationError(
        'Approver name (approvedBy) is required to approve a cost sheet.',
        'approvedBy'
      );
    }

    const normalizedApprover = approvedBy.trim();

    return await this.db.transaction(
      'rw',
      [
        this.db.cost_sheets,
        this.db.styles,
        this.db.orders,
        this.db.order_items,
        this.db.buyers,
        this.db.materials,
        this.db.bom_items,
      ],
      async () => {
        const target = await this.db.cost_sheets.get(costSheetId);
        if (!target) {
          throw new EntityNotFoundError('CostSheet', costSheetId);
        }

        const currentStatus = target.status ?? 'DRAFT';
        this.assertValidTransition(target.id, currentStatus, 'APPROVED');

        await this.validateRelationships({
          styleId: target.styleId,
          orderId: target.orderId,
          buyerId: target.buyerId,
          bomVersionRef: target.bomVersionRef,
          costingBasisQuantity: target.costingBasisQuantity,
          lineItems: target.lineItems,
        });

        // Re-validate arithmetic consistency prior to final approval
        const calcInput = this.buildCalculationInputFromEntity(target);
        calcInput.lineItems = await this.hydrateLineItemsForCalculation(calcInput.lineItems);
        calculateCostSheet(calcInput);

        const now = new Date().toISOString();

        // Find prior APPROVED versions in the exact same style/order context
        const contextVersions = await this.getCostSheetVersions({
          styleId: target.styleId,
          orderId: target.orderId,
        });

        const superseded: CostSheetEntity[] = [];
        for (const prev of contextVersions) {
          if (prev.id !== target.id && prev.status === 'APPROVED') {
            this.assertValidTransition(prev.id, 'APPROVED', 'SUPERSEDED');
            // Preserve all historical financial figures, approvedBy, and approvedAt untouched
            const updatedPrev: CostSheetEntity = {
              ...prev,
              status: 'SUPERSEDED',
              updatedAt: now,
            };
            await this.db.cost_sheets.put(updatedPrev);
            superseded.push(updatedPrev);
          }
        }

        const approved: CostSheetEntity = {
          ...target,
          status: 'APPROVED',
          approvedBy: normalizedApprover,
          approvedAt: now,
          rejectionReason: undefined,
          updatedAt: now,
        };

        await this.db.cost_sheets.put(approved);
        return { approved, superseded };
      }
    );
  }

  async rejectCostSheet(
    costSheetId: string,
    rejectionReason: string
  ): Promise<CostSheetEntity> {
    if (!costSheetId || !costSheetId.trim()) {
      throw new ValidationError('Cost sheet ID is required.', 'costSheetId');
    }
    if (!rejectionReason || !rejectionReason.trim()) {
      throw new ValidationError(
        'A rejectionReason is required when rejecting a cost sheet.',
        'rejectionReason'
      );
    }

    return await this.db.transaction('rw', [this.db.cost_sheets], async () => {
      const existing = await this.db.cost_sheets.get(costSheetId);
      if (!existing) {
        throw new EntityNotFoundError('CostSheet', costSheetId);
      }

      const currentStatus = existing.status ?? 'DRAFT';
      this.assertValidTransition(existing.id, currentStatus, 'REJECTED');

      const updated: CostSheetEntity = {
        ...existing,
        status: 'REJECTED',
        rejectionReason: rejectionReason.trim(),
        updatedAt: new Date().toISOString(),
      };

      await this.db.cost_sheets.put(updated);
      return updated;
    });
  }

  async reopenRejectedCostSheet(costSheetId: string): Promise<CostSheetEntity> {
    if (!costSheetId || !costSheetId.trim()) {
      throw new ValidationError('Cost sheet ID is required.', 'costSheetId');
    }

    return await this.db.transaction('rw', [this.db.cost_sheets], async () => {
      const existing = await this.db.cost_sheets.get(costSheetId);
      if (!existing) {
        throw new EntityNotFoundError('CostSheet', costSheetId);
      }

      const currentStatus = existing.status ?? 'DRAFT';
      this.assertValidTransition(existing.id, currentStatus, 'DRAFT');

      const updated: CostSheetEntity = {
        ...existing,
        status: 'DRAFT',
        updatedAt: new Date().toISOString(),
      };

      await this.db.cost_sheets.put(updated);
      return updated;
    });
  }
}
