import {
  CmRateBasis,
  ConsumptionBasis,
  ConsumptionUnit,
  CostSheetLineCategory,
  CostSheetLineItem,
  CostSheetLineSourceType,
  MaterialUnit,
  MaterialUomAttributes,
  OverheadCalculationMethod,
} from '../types';
import { ValidationError } from '../errors';
import { convertUom, roundUomDisplay } from './uomConverter';

/**
 * StitchPilot Enterprise — Apparel Costing Calculation Engine
 *
 * Pure calculation module: zero IndexedDB, Dexie, React, or UI dependencies.
 *
 * Key financial & industrial engineering definitions:
 * 1. Currency: Explicit ISO-4217 3-letter code required. No default currency assumed
 *    and no multi-currency mixing permitted without explicit FX conversion.
 * 2. CMT Rate Basis (prevents double-efficiency adjustment):
 *    - 'ACTUAL_MINUTE': Minute rate represents cost per actual attended floor minute.
 *      CMT = (SAM / (efficiencyPercent / 100)) * cmRatePerMinute
 *    - 'STANDARD_MINUTE': Minute rate already prices 1 Standard Allowed Minute (SMV)
 *      including target efficiency allowance.
 *      CMT = SAM * cmRatePerMinute (efficiency NOT re-applied)
 *    - 'DIRECT_CMT': Uses explicit configured directCmtCost without SAM derivation.
 * 3. Margin vs Markup & Commission:
 *    - Commission Amount = Quoted FOB * (commissionPercent / 100)
 *    - Net Realized FOB  = Quoted FOB - Commission Amount
 *    - Profit / Garment  = Net Realized FOB - Total Manufacturing Cost
 *    - Gross Margin %    = (Profit / Quoted FOB) * 100
 *    - Markup %          = (Profit / Total Manufacturing Cost) * 100
 */

export type CostPricingMode = 'FOB_TO_MARGIN' | 'MARGIN_TO_FOB' | 'MARKUP_TO_FOB';

export interface CostingLineInput {
  id: string;
  category: CostSheetLineCategory;
  description: string;
  currency: string;
  materialId?: string;
  materialCode?: string;
  bomItemId?: string;
  sourceType?: CostSheetLineSourceType;
  costPerGarment?: number;
  consumptionPerGarment?: number;
  consumptionBasis?: ConsumptionBasis;
  consumptionUnit?: ConsumptionUnit;
  wastagePercent?: number;
  stockUnit?: MaterialUnit;
  uomAttributes?: MaterialUomAttributes;
  unitPrice?: number;
  masterUnitCostSnapshot?: number;
  masterCostCurrencySnapshot?: string;
  isRateOverridden?: boolean;
  notes?: string;
}

export type CmtInput =
  | {
      method: 'DIRECT_CMT';
      directCmtCost: number;
    }
  | {
      method: 'SAM_RATE';
      samMinutes: number;
      efficiencyPercent: number;
      cmRatePerMinute: number;
      cmRateBasis: CmRateBasis;
    };

export type OverheadInput = {
  method: OverheadCalculationMethod;
  value: number;
};

export interface CostingCalculationInput {
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
}

export interface CostingCalculationResult {
  currency: string;
  fabricCost: number;
  trimsCost: number;
  threadConsumablesCost: number;
  packingCost: number;
  printingEmbroideryCost: number;
  washingFinishingCost: number;
  otherDirectCost: number;
  materialCostSubtotal: number;
  valueAddedCostSubtotal: number;
  laborCmtCost: number;
  effectiveActualMinutes?: number;
  overheadCost: number;
  totalManufacturingCost: number;
  quotedFobPrice: number;
  commissionPercent: number;
  commissionAmount: number;
  netRealizedFob: number;
  profitPerGarment: number;
  grossMarginPercent: number;
  markupPercent: number;
  calculatedLineItems: CostSheetLineItem[];
  // Exact full-precision figures
  exact: {
    totalManufacturingCost: number;
    quotedFobPrice: number;
    netRealizedFob: number;
    profitPerGarment: number;
    grossMarginPercent: number;
    markupPercent: number;
  };
}

function assertIsoCurrency(currency: string | undefined, field: string): string {
  if (!currency || typeof currency !== 'string') {
    throw new ValidationError(
      `Explicit ISO currency code is required for "${field}".`,
      field
    );
  }
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ValidationError(
      `Invalid currency code "${currency}". Expected a 3-letter ISO-4217 code (e.g., USD, EUR, BDT).`,
      field
    );
  }
  return normalized;
}

function assertNonNegativeFinite(value: number | undefined, field: string): number {
  if (value === undefined || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(
      `"${field}" must be a non-negative finite number (received ${value}).`,
      field
    );
  }
  return value;
}

function assertPositiveFinite(value: number | undefined, field: string): number {
  if (value === undefined || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError(
      `"${field}" must be a strictly positive finite number (received ${value}).`,
      field
    );
  }
  return value;
}

export function calculateCostSheet(
  input: CostingCalculationInput
): CostingCalculationResult {
  const displayDecimals = input.displayDecimals ?? 4;
  const currency = assertIsoCurrency(input.currency, 'currency');

  const categoryTotalsExact: Record<CostSheetLineCategory, number> = {
    FABRIC: 0,
    TRIMS: 0,
    THREAD_CONSUMABLES: 0,
    PACKING: 0,
    PRINTING_EMBROIDERY: 0,
    WASHING_FINISHING: 0,
    OTHER: 0,
  };

  const calculatedLineItems: CostSheetLineItem[] = [];

  // 1. Evaluate Line Items (strict single-currency check)
  if (input.lineItems) {
    for (const line of input.lineItems) {
      const lineCurrency = assertIsoCurrency(line.currency, `lineItems[${line.id}].currency`);
      if (lineCurrency !== currency) {
        throw new ValidationError(
          `Currency mismatch on cost line "${line.description}" (${line.id}): expected "${currency}", received "${lineCurrency}". Multi-currency combination requires explicit conversion.`,
          'currency',
          { expectedCurrency: currency, receivedCurrency: lineCurrency, lineId: line.id }
        );
      }

      let lineCostExact: number;
      let resolvedUnitPrice: number;

      // Consumption-driven lines MUST recalculate from consumption, wastage, UOM conversion & unitPrice
      // even if a stale costPerGarment was carried over from a previous persisted CostSheetLineItem.
      // Direct-cost lines (no consumptionPerGarment) continue using costPerGarment directly.
      const isConsumptionDriven = line.consumptionPerGarment !== undefined;

      if (!isConsumptionDriven && line.costPerGarment !== undefined) {
        lineCostExact = assertNonNegativeFinite(
          line.costPerGarment,
          `lineItems[${line.id}].costPerGarment`
        );
        resolvedUnitPrice =
          line.unitPrice !== undefined
            ? assertNonNegativeFinite(line.unitPrice, `lineItems[${line.id}].unitPrice`)
            : lineCostExact;
      } else {
        const rawConsumption = assertPositiveFinite(
          line.consumptionPerGarment,
          `lineItems[${line.id}].consumptionPerGarment`
        );
        const wastagePercent = assertNonNegativeFinite(
          line.wastagePercent ?? 0,
          `lineItems[${line.id}].wastagePercent`
        );
        resolvedUnitPrice = assertNonNegativeFinite(
          line.unitPrice,
          `lineItems[${line.id}].unitPrice`
        );

        const basis = line.consumptionBasis ?? 'PER_PIECE';
        if (basis !== 'PER_PIECE' && basis !== 'PER_DOZEN') {
          throw new ValidationError(
            `Unsupported consumptionBasis "${basis}" on cost line "${line.id}".`,
            'consumptionBasis'
          );
        }

        const netConsPerGarment = basis === 'PER_DOZEN' ? rawConsumption / 12 : rawConsumption;
        const grossConsPerGarment = netConsPerGarment * (1 + wastagePercent / 100);

        const fromUnit = line.consumptionUnit ?? line.stockUnit;
        const toUnit = line.stockUnit ?? line.consumptionUnit;
        if (!fromUnit || !toUnit) {
          throw new ValidationError(
            `Cost line "${line.id}" requires consumptionUnit and stockUnit when calculating from consumption.`,
            'consumptionUnit'
          );
        }

        const converted = convertUom(
          grossConsPerGarment,
          fromUnit,
          toUnit,
          line.uomAttributes,
          displayDecimals
        );

        lineCostExact = converted.exactValue * resolvedUnitPrice;
      }

      categoryTotalsExact[line.category] += lineCostExact;

      const calculatedLine: CostSheetLineItem = {
        id: line.id,
        category: line.category,
        description: line.description,
        materialId: line.materialId,
        bomItemId: line.bomItemId,
        consumptionPerGarment: line.consumptionPerGarment,
        consumptionBasis: line.consumptionBasis,
        consumptionUnit: line.consumptionUnit,
        wastagePercent: line.wastagePercent,
        unitPrice: roundUomDisplay(resolvedUnitPrice, displayDecimals),
        stockUnit: line.stockUnit,
        currency,
        costPerGarment: roundUomDisplay(lineCostExact, displayDecimals),
        notes: line.notes,
      };

      if (line.materialCode !== undefined) {
        calculatedLine.materialCode = line.materialCode;
      }
      if (line.sourceType !== undefined) {
        calculatedLine.sourceType = line.sourceType;
      }
      if (line.masterUnitCostSnapshot !== undefined) {
        calculatedLine.masterUnitCostSnapshot = line.masterUnitCostSnapshot;
      }
      if (line.masterCostCurrencySnapshot !== undefined) {
        calculatedLine.masterCostCurrencySnapshot = line.masterCostCurrencySnapshot;
      }
      if (line.isRateOverridden !== undefined) {
        calculatedLine.isRateOverridden = line.isRateOverridden;
      }
      if (line.uomAttributes !== undefined) {
        calculatedLine.uomAttributesSnapshot = { ...line.uomAttributes };
      }

      calculatedLineItems.push(calculatedLine);
    }
  }

  // 2. Add any explicit category-level costs
  if (input.categoryCosts) {
    for (const [cat, amount] of Object.entries(input.categoryCosts) as Array<
      [CostSheetLineCategory, number | undefined]
    >) {
      if (amount !== undefined) {
        categoryTotalsExact[cat] += assertNonNegativeFinite(
          amount,
          `categoryCosts.${cat}`
        );
      }
    }
  }

  const materialCostSubtotalExact =
    categoryTotalsExact.FABRIC +
    categoryTotalsExact.TRIMS +
    categoryTotalsExact.THREAD_CONSUMABLES +
    categoryTotalsExact.PACKING;

  const valueAddedCostSubtotalExact =
    categoryTotalsExact.PRINTING_EMBROIDERY + categoryTotalsExact.WASHING_FINISHING;

  // 3. CMT Calculation (Explicit rate basis & direct override support)
  let laborCmtCostExact: number;
  let effectiveActualMinutes: number | undefined;

  if (input.cmt.method === 'DIRECT_CMT') {
    laborCmtCostExact = assertNonNegativeFinite(
      input.cmt.directCmtCost,
      'cmt.directCmtCost'
    );
  } else if (input.cmt.method === 'SAM_RATE') {
    const sam = assertPositiveFinite(input.cmt.samMinutes, 'cmt.samMinutes');
    const eff = assertPositiveFinite(
      input.cmt.efficiencyPercent,
      'cmt.efficiencyPercent'
    );
    const rate = assertNonNegativeFinite(
      input.cmt.cmRatePerMinute,
      'cmt.cmRatePerMinute'
    );

    effectiveActualMinutes = sam / (eff / 100);

    if (input.cmt.cmRateBasis === 'ACTUAL_MINUTE') {
      laborCmtCostExact = effectiveActualMinutes * rate;
    } else if (input.cmt.cmRateBasis === 'STANDARD_MINUTE') {
      // Rate already reflects standard minute pricing; do NOT adjust for efficiency twice
      laborCmtCostExact = sam * rate;
    } else {
      throw new ValidationError(
        `Invalid cmRateBasis "${input.cmt.cmRateBasis}". Expected ACTUAL_MINUTE or STANDARD_MINUTE.`,
        'cmt.cmRateBasis'
      );
    }
  } else {
    throw new ValidationError('Invalid CMT calculation method.', 'cmt.method');
  }

  // 4. Overheads Calculation
  const overheadValue = assertNonNegativeFinite(
    input.overhead.value,
    'overhead.value'
  );
  const directCostExact =
    materialCostSubtotalExact +
    valueAddedCostSubtotalExact +
    laborCmtCostExact +
    categoryTotalsExact.OTHER;

  let overheadCostExact: number;
  switch (input.overhead.method) {
    case 'FIXED_PER_GARMENT':
      overheadCostExact = overheadValue;
      break;
    case 'PERCENT_OF_CMT':
      overheadCostExact = laborCmtCostExact * (overheadValue / 100);
      break;
    case 'PERCENT_OF_DIRECT_COST':
      overheadCostExact = directCostExact * (overheadValue / 100);
      break;
    default:
      throw new ValidationError(
        `Unsupported overhead calculation method "${input.overhead.method}".`,
        'overhead.method'
      );
  }

  const totalManufacturingCostExact = directCostExact + overheadCostExact;

  // 5. Commission, FOB, Margin & Markup
  const commissionPercent = assertNonNegativeFinite(
    input.commissionPercent ?? 0,
    'commissionPercent'
  );
  if (commissionPercent >= 100) {
    throw new ValidationError(
      `Commission percent must be strictly less than 100% (received ${commissionPercent}%).`,
      'commissionPercent'
    );
  }

  let quotedFobPriceExact: number;

  switch (input.pricingMode) {
    case 'FOB_TO_MARGIN': {
      quotedFobPriceExact = assertPositiveFinite(
        input.quotedFobPrice,
        'quotedFobPrice'
      );
      break;
    }
    case 'MARGIN_TO_FOB': {
      const targetMargin = assertNonNegativeFinite(
        input.targetMarginPercent,
        'targetMarginPercent'
      );
      if (targetMargin + commissionPercent >= 100) {
        throw new ValidationError(
          `Target gross margin (${targetMargin}%) plus commission (${commissionPercent}%) must be strictly less than 100%.`,
          'targetMarginPercent'
        );
      }
      const denominator = 1 - (targetMargin + commissionPercent) / 100;
      quotedFobPriceExact = totalManufacturingCostExact / denominator;
      break;
    }
    case 'MARKUP_TO_FOB': {
      const targetMarkup = assertNonNegativeFinite(
        input.targetMarkupPercent,
        'targetMarkupPercent'
      );
      const targetProfit = totalManufacturingCostExact * (targetMarkup / 100);
      const netFobNeeded = totalManufacturingCostExact + targetProfit;
      quotedFobPriceExact = netFobNeeded / (1 - commissionPercent / 100);
      break;
    }
    default:
      throw new ValidationError(
        `Unsupported pricingMode "${input.pricingMode}".`,
        'pricingMode'
      );
  }

  const commissionAmountExact = quotedFobPriceExact * (commissionPercent / 100);
  const netRealizedFobExact = quotedFobPriceExact - commissionAmountExact;
  const profitPerGarmentExact = netRealizedFobExact - totalManufacturingCostExact;

  const grossMarginPercentExact =
    quotedFobPriceExact > 0
      ? (profitPerGarmentExact / quotedFobPriceExact) * 100
      : 0;

  const markupPercentExact =
    totalManufacturingCostExact > 0
      ? (profitPerGarmentExact / totalManufacturingCostExact) * 100
      : 0;

  return {
    currency,
    fabricCost: roundUomDisplay(categoryTotalsExact.FABRIC, displayDecimals),
    trimsCost: roundUomDisplay(categoryTotalsExact.TRIMS, displayDecimals),
    threadConsumablesCost: roundUomDisplay(
      categoryTotalsExact.THREAD_CONSUMABLES,
      displayDecimals
    ),
    packingCost: roundUomDisplay(categoryTotalsExact.PACKING, displayDecimals),
    printingEmbroideryCost: roundUomDisplay(
      categoryTotalsExact.PRINTING_EMBROIDERY,
      displayDecimals
    ),
    washingFinishingCost: roundUomDisplay(
      categoryTotalsExact.WASHING_FINISHING,
      displayDecimals
    ),
    otherDirectCost: roundUomDisplay(categoryTotalsExact.OTHER, displayDecimals),
    materialCostSubtotal: roundUomDisplay(materialCostSubtotalExact, displayDecimals),
    valueAddedCostSubtotal: roundUomDisplay(valueAddedCostSubtotalExact, displayDecimals),
    laborCmtCost: roundUomDisplay(laborCmtCostExact, displayDecimals),
    effectiveActualMinutes:
      effectiveActualMinutes !== undefined
        ? roundUomDisplay(effectiveActualMinutes, displayDecimals)
        : undefined,
    overheadCost: roundUomDisplay(overheadCostExact, displayDecimals),
    totalManufacturingCost: roundUomDisplay(totalManufacturingCostExact, displayDecimals),
    quotedFobPrice: roundUomDisplay(quotedFobPriceExact, displayDecimals),
    commissionPercent: roundUomDisplay(commissionPercent, 2),
    commissionAmount: roundUomDisplay(commissionAmountExact, displayDecimals),
    netRealizedFob: roundUomDisplay(netRealizedFobExact, displayDecimals),
    profitPerGarment: roundUomDisplay(profitPerGarmentExact, displayDecimals),
    grossMarginPercent: roundUomDisplay(grossMarginPercentExact, 2),
    markupPercent: roundUomDisplay(markupPercentExact, 2),
    calculatedLineItems,
    exact: {
      totalManufacturingCost: totalManufacturingCostExact,
      quotedFobPrice: quotedFobPriceExact,
      netRealizedFob: netRealizedFobExact,
      profitPerGarment: profitPerGarmentExact,
      grossMarginPercent: grossMarginPercentExact,
      markupPercent: markupPercentExact,
    },
  };
}
