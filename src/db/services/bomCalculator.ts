import {
  BomItemEntity,
  ConsumptionBasis,
  ConsumptionUnit,
  MaterialEntity,
  MaterialUnit,
} from '../types';
import { ValidationError } from '../errors';
import { convertUom, getUomConversionFactor, roundUomDisplay } from './uomConverter';

/**
 * StitchPilot Enterprise — Deterministic Bill of Materials (BOM) Calculation Engine
 *
 * Pure calculation module: zero IndexedDB, Dexie, React, or UI dependencies.
 *
 * Formulas per matched order cell (color, size) with garment quantity Q:
 * 1. Normalized per-garment net consumption:
 *    - raw = sizeConsumptionMap[size] ?? consumptionPerGarment
 *    - unitConsumption = (consumptionBasis === 'PER_DOZEN') ? raw / 12 : raw
 * 2. Net Requirement (consumptionUnit)    = sum(Q * unitConsumption)
 * 3. Wastage Quantity (consumptionUnit)   = Net * (wastagePercent / 100)
 * 4. Gross Requirement (consumptionUnit)  = Net + Wastage
 * 5. Stock Unit Conversion                = convertUom(value, consumptionUnit, material.unit, material.uomAttributes)
 */

export interface BomOrderMatrixRow {
  styleId?: string;
  color: string;
  size: string;
  quantity: number;
}

export interface CalculateBomInput {
  primaryStyleId: string;
  orderItems: BomOrderMatrixRow[];
  bomItems: BomItemEntity[];
  materialsById: Record<string, MaterialEntity>;
  includeArchived?: boolean;
  displayDecimals?: number;
}

export interface BomCellBreakdown {
  color: string;
  size: string;
  garmentPieces: number;
  perGarmentNetConsumption: number;
  netConsumptionQty: number;
  wastageConsumptionQty: number;
  grossConsumptionQty: number;
}

export interface BomColorBreakdown {
  color: string;
  garmentPieces: number;
  netConsumptionQty: number;
  wastageConsumptionQty: number;
  grossConsumptionQty: number;
  grossStockQtyExact: number;
  grossStockQty: number;
}

export interface BomLineCalculationResult {
  bomItemId: string;
  styleId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  placement: string;
  consumptionBasis: ConsumptionBasis;
  consumptionUnit: ConsumptionUnit;
  stockUnit: MaterialUnit;
  wastagePercent: number;
  matchedGarmentPieces: number;
  conversionFactor: number;
  // Consumption unit totals
  netRequirementConsUnitExact: number;
  wastageQuantityConsUnitExact: number;
  grossRequirementConsUnitExact: number;
  netRequirementConsUnit: number;
  wastageQuantityConsUnit: number;
  grossRequirementConsUnit: number;
  // Stock unit totals (material.unit)
  netRequirementStockUnitExact: number;
  wastageQuantityStockUnitExact: number;
  grossRequirementStockUnitExact: number;
  netRequirementStockUnit: number;
  wastageQuantityStockUnit: number;
  grossRequirementStockUnit: number;
  // Ceiling integer packs/units for procurement reference alongside fractional exact value
  discreteOrderUnits: number;
  byColor: BomColorBreakdown[];
  cellBreakdowns: BomCellBreakdown[];
}

export interface ConsolidatedMaterialRequirement {
  materialId: string;
  materialCode: string;
  materialName: string;
  category: MaterialEntity['category'];
  stockUnit: MaterialUnit;
  matchedBomItemIds: string[];
  netRequirementStockUnitExact: number;
  wastageQuantityStockUnitExact: number;
  grossRequirementStockUnitExact: number;
  netRequirementStockUnit: number;
  wastageQuantityStockUnit: number;
  grossRequirementStockUnit: number;
  discreteOrderUnits: number;
  byColor: Array<{
    color: string;
    garmentPieces: number;
    grossStockQtyExact: number;
    grossStockQty: number;
  }>;
}

export interface OrderBomCalculationResult {
  primaryStyleId: string;
  totalGarmentPieces: number;
  lineResults: BomLineCalculationResult[];
  consolidatedMaterials: ConsolidatedMaterialRequirement[];
}

function resolveSizeOverride(
  sizeConsumptionMap: Record<string, number> | undefined,
  size: string
): number | undefined {
  if (!sizeConsumptionMap) return undefined;
  if (Object.prototype.hasOwnProperty.call(sizeConsumptionMap, size)) {
    return sizeConsumptionMap[size];
  }
  const targetNorm = size.trim().toUpperCase();
  for (const [key, val] of Object.entries(sizeConsumptionMap)) {
    if (key.trim().toUpperCase() === targetNorm) {
      return val;
    }
  }
  return undefined;
}

function computeDiscreteCeil(exactValue: number): number {
  if (exactValue <= 0) return 0;
  // Guard floating-point noise like 170.00000000000003 from jumping to 171
  const nearestInt = Math.round(exactValue);
  if (Math.abs(exactValue - nearestInt) < 1e-9) {
    return nearestInt;
  }
  return Math.ceil(exactValue);
}

export function calculateBomLineRequirement(
  bomItem: BomItemEntity,
  material: MaterialEntity,
  orderItems: BomOrderMatrixRow[],
  primaryStyleId: string,
  displayDecimals: number = 4
): BomLineCalculationResult {
  if (
    typeof bomItem.consumptionPerGarment !== 'number' ||
    !Number.isFinite(bomItem.consumptionPerGarment) ||
    bomItem.consumptionPerGarment <= 0
  ) {
    throw new ValidationError(
      `BOM item "${bomItem.id}" must have positive finite consumptionPerGarment (received ${bomItem.consumptionPerGarment}).`,
      'consumptionPerGarment'
    );
  }

  if (
    typeof bomItem.wastagePercent !== 'number' ||
    !Number.isFinite(bomItem.wastagePercent) ||
    bomItem.wastagePercent < 0
  ) {
    throw new ValidationError(
      `BOM item "${bomItem.id}" must have non-negative finite wastagePercent (received ${bomItem.wastagePercent}).`,
      'wastagePercent'
    );
  }

  const consumptionBasis: ConsumptionBasis = bomItem.consumptionBasis ?? 'PER_PIECE';
  if (consumptionBasis !== 'PER_PIECE' && consumptionBasis !== 'PER_DOZEN') {
    throw new ValidationError(
      `BOM item "${bomItem.id}" has unsupported consumptionBasis "${consumptionBasis}".`,
      'consumptionBasis'
    );
  }

  const consumptionUnit: ConsumptionUnit = bomItem.consumptionUnit ?? material.unit;

  // Validate UOM conversion compatibility upfront even when matched quantity is 0
  const { factor: conversionFactor } = getUomConversionFactor(
    consumptionUnit,
    material.unit,
    material.uomAttributes
  );

  const colorScope = bomItem.colorScope ?? 'ALL';
  const sizeScope = bomItem.sizeScope ?? 'ALL';
  const allowedColorsSet =
    colorScope === 'SPECIFIC'
      ? new Set((bomItem.applicableColors || []).map((c) => c.trim().toUpperCase()))
      : null;
  const allowedSizesSet =
    sizeScope === 'SPECIFIC'
      ? new Set((bomItem.applicableSizes || []).map((s) => s.trim().toUpperCase()))
      : null;

  let matchedGarmentPieces = 0;
  let netConsExact = 0;
  let wastageConsExact = 0;
  let grossConsExact = 0;

  const colorAccumulator = new Map<
    string,
    {
      displayColor: string;
      garmentPieces: number;
      netConsExact: number;
      wastageConsExact: number;
      grossConsExact: number;
    }
  >();

  const cellBreakdowns: BomCellBreakdown[] = [];

  for (const row of orderItems) {
    if (typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity < 0) {
      throw new ValidationError(
        `Order matrix row (${row.color} / ${row.size}) has invalid quantity: ${row.quantity}.`,
        'quantity'
      );
    }

    const rowStyleId = row.styleId || primaryStyleId;
    if (rowStyleId !== bomItem.styleId) {
      continue;
    }

    const normalizedColor = row.color.trim().toUpperCase();
    const normalizedSize = row.size.trim().toUpperCase();

    if (allowedColorsSet && !allowedColorsSet.has(normalizedColor)) {
      continue;
    }
    if (allowedSizesSet && !allowedSizesSet.has(normalizedSize)) {
      continue;
    }

    const sizeOverride = resolveSizeOverride(bomItem.sizeConsumptionMap, row.size);
    if (sizeOverride !== undefined) {
      if (typeof sizeOverride !== 'number' || !Number.isFinite(sizeOverride) || sizeOverride <= 0) {
        throw new ValidationError(
          `BOM item "${bomItem.id}" has invalid sizeConsumptionMap override for size "${row.size}": ${sizeOverride}.`,
          'sizeConsumptionMap'
        );
      }
    }

    const rawConsumption = sizeOverride ?? bomItem.consumptionPerGarment;
    const perGarmentNet =
      consumptionBasis === 'PER_DOZEN' ? rawConsumption / 12 : rawConsumption;

    const rowNet = row.quantity * perGarmentNet;
    const rowWastage = rowNet * (bomItem.wastagePercent / 100);
    const rowGross = rowNet + rowWastage;

    matchedGarmentPieces += row.quantity;
    netConsExact += rowNet;
    wastageConsExact += rowWastage;
    grossConsExact += rowGross;

    cellBreakdowns.push({
      color: row.color,
      size: row.size,
      garmentPieces: row.quantity,
      perGarmentNetConsumption: perGarmentNet,
      netConsumptionQty: roundUomDisplay(rowNet, displayDecimals),
      wastageConsumptionQty: roundUomDisplay(rowWastage, displayDecimals),
      grossConsumptionQty: roundUomDisplay(rowGross, displayDecimals),
    });

    const existingColor = colorAccumulator.get(normalizedColor);
    if (existingColor) {
      existingColor.garmentPieces += row.quantity;
      existingColor.netConsExact += rowNet;
      existingColor.wastageConsExact += rowWastage;
      existingColor.grossConsExact += rowGross;
    } else {
      colorAccumulator.set(normalizedColor, {
        displayColor: row.color,
        garmentPieces: row.quantity,
        netConsExact: rowNet,
        wastageConsExact: rowWastage,
        grossConsExact: rowGross,
      });
    }
  }

  const netConverted = convertUom(
    netConsExact,
    consumptionUnit,
    material.unit,
    material.uomAttributes,
    displayDecimals
  );
  const wastageConverted = convertUom(
    wastageConsExact,
    consumptionUnit,
    material.unit,
    material.uomAttributes,
    displayDecimals
  );
  const grossConverted = convertUom(
    grossConsExact,
    consumptionUnit,
    material.unit,
    material.uomAttributes,
    displayDecimals
  );

  const byColor: BomColorBreakdown[] = Array.from(colorAccumulator.values()).map((c) => {
    const colorGrossStock = convertUom(
      c.grossConsExact,
      consumptionUnit,
      material.unit,
      material.uomAttributes,
      displayDecimals
    );
    return {
      color: c.displayColor,
      garmentPieces: c.garmentPieces,
      netConsumptionQty: roundUomDisplay(c.netConsExact, displayDecimals),
      wastageConsumptionQty: roundUomDisplay(c.wastageConsExact, displayDecimals),
      grossConsumptionQty: roundUomDisplay(c.grossConsExact, displayDecimals),
      grossStockQtyExact: colorGrossStock.exactValue,
      grossStockQty: colorGrossStock.displayValue,
    };
  });

  return {
    bomItemId: bomItem.id,
    styleId: bomItem.styleId,
    materialId: material.id,
    materialCode: material.materialCode,
    materialName: material.name,
    placement: bomItem.placement,
    consumptionBasis,
    consumptionUnit,
    stockUnit: material.unit,
    wastagePercent: bomItem.wastagePercent,
    matchedGarmentPieces,
    conversionFactor,
    netRequirementConsUnitExact: netConsExact,
    wastageQuantityConsUnitExact: wastageConsExact,
    grossRequirementConsUnitExact: grossConsExact,
    netRequirementConsUnit: roundUomDisplay(netConsExact, displayDecimals),
    wastageQuantityConsUnit: roundUomDisplay(wastageConsExact, displayDecimals),
    grossRequirementConsUnit: roundUomDisplay(grossConsExact, displayDecimals),
    netRequirementStockUnitExact: netConverted.exactValue,
    wastageQuantityStockUnitExact: wastageConverted.exactValue,
    grossRequirementStockUnitExact: grossConverted.exactValue,
    netRequirementStockUnit: netConverted.displayValue,
    wastageQuantityStockUnit: wastageConverted.displayValue,
    grossRequirementStockUnit: grossConverted.displayValue,
    discreteOrderUnits: computeDiscreteCeil(grossConverted.exactValue),
    byColor,
    cellBreakdowns,
  };
}

export function calculateOrderBomRequirements(
  input: CalculateBomInput
): OrderBomCalculationResult {
  const {
    primaryStyleId,
    orderItems,
    bomItems,
    materialsById,
    includeArchived = false,
    displayDecimals = 4,
  } = input;

  if (!primaryStyleId || !primaryStyleId.trim()) {
    throw new ValidationError('primaryStyleId is required for BOM calculation.', 'primaryStyleId');
  }

  let totalGarmentPieces = 0;
  for (const row of orderItems) {
    if (!row.color || !row.color.trim()) {
      throw new ValidationError('Order item color is required.', 'color');
    }
    if (!row.size || !row.size.trim()) {
      throw new ValidationError('Order item size is required.', 'size');
    }
    if (typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity < 0) {
      throw new ValidationError(
        `Order item (${row.color}/${row.size}) has invalid quantity: ${row.quantity}.`,
        'quantity'
      );
    }
    totalGarmentPieces += row.quantity;
  }

  const activeBomItems = includeArchived
    ? bomItems
    : bomItems.filter((item) => item.status !== 'ARCHIVED');

  const lineResults: BomLineCalculationResult[] = [];
  const consolidatedMap = new Map<
    string,
    {
      material: MaterialEntity;
      matchedBomItemIds: string[];
      netExact: number;
      wastageExact: number;
      grossExact: number;
      colorMap: Map<string, { color: string; garmentPieces: number; grossStockExact: number }>;
    }
  >();

  for (const bomItem of activeBomItems) {
    const material = materialsById[bomItem.materialId];
    if (!material) {
      throw new ValidationError(
        `BOM item "${bomItem.id}" references missing material "${bomItem.materialId}".`,
        'materialId'
      );
    }

    const lineResult = computeLineAndAccumulate(
      bomItem,
      material,
      orderItems,
      primaryStyleId,
      displayDecimals
    );
    lineResults.push(lineResult);

    let agg = consolidatedMap.get(material.id);
    if (!agg) {
      agg = {
        material,
        matchedBomItemIds: [],
        netExact: 0,
        wastageExact: 0,
        grossExact: 0,
        colorMap: new Map(),
      };
      consolidatedMap.set(material.id, agg);
    }

    agg.matchedBomItemIds.push(bomItem.id);
    agg.netExact += lineResult.netRequirementStockUnitExact;
    agg.wastageExact += lineResult.wastageQuantityStockUnitExact;
    agg.grossExact += lineResult.grossRequirementStockUnitExact;

    for (const cb of lineResult.byColor) {
      const colorKey = cb.color.trim().toUpperCase();
      const existingColor = agg.colorMap.get(colorKey);
      if (existingColor) {
        existingColor.garmentPieces = Math.max(existingColor.garmentPieces, cb.garmentPieces);
        existingColor.grossStockExact += cb.grossStockQtyExact;
      } else {
        agg.colorMap.set(colorKey, {
          color: cb.color,
          garmentPieces: cb.garmentPieces,
          grossStockExact: cb.grossStockQtyExact,
        });
      }
    }
  }

  const consolidatedMaterials: ConsolidatedMaterialRequirement[] = Array.from(
    consolidatedMap.values()
  ).map((agg) => ({
    materialId: agg.material.id,
    materialCode: agg.material.materialCode,
    materialName: agg.material.name,
    category: agg.material.category,
    stockUnit: agg.material.unit,
    matchedBomItemIds: agg.matchedBomItemIds,
    netRequirementStockUnitExact: agg.netExact,
    wastageQuantityStockUnitExact: agg.wastageExact,
    grossRequirementStockUnitExact: agg.grossExact,
    netRequirementStockUnit: roundUomDisplay(agg.netExact, displayDecimals),
    wastageQuantityStockUnit: roundUomDisplay(agg.wastageExact, displayDecimals),
    grossRequirementStockUnit: roundUomDisplay(agg.grossExact, displayDecimals),
    discreteOrderUnits: computeDiscreteCeil(agg.grossExact),
    byColor: Array.from(agg.colorMap.values()).map((c) => ({
      color: c.color,
      garmentPieces: c.garmentPieces,
      grossStockQtyExact: c.grossStockExact,
      grossStockQty: roundUomDisplay(c.grossStockExact, displayDecimals),
    })),
  }));

  return {
    primaryStyleId,
    totalGarmentPieces,
    lineResults,
    consolidatedMaterials,
  };
}

function computeLineAndAccumulate(
  bomItem: BomItemEntity,
  material: MaterialEntity,
  orderItems: BomOrderMatrixRow[],
  primaryStyleId: string,
  displayDecimals: number
): BomLineCalculationResult {
  return calculateBomLineRequirement(
    bomItem,
    material,
    orderItems,
    primaryStyleId,
    displayDecimals
  );
}
