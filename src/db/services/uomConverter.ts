import { ConsumptionUnit, MaterialUomAttributes } from '../types';
import { ValidationError } from '../errors';

/**
 * StitchPilot Enterprise — Unit of Measurement (UOM) Conversion Engine
 *
 * Pure, deterministic conversion utility separating exact IEEE-754 internal
 * calculation values from display-rounded outputs.
 *
 * Explicit conversion rules & assumptions:
 * 1. Exact Count Conversions:
 *    - 1 dozen = 12 pcs
 *    - 1 gross = 144 pcs (12 dozens)
 * 2. Exact International Length Conversions:
 *    - 1 yard = 0.9144 meters
 * 3. Configured Roll / Cone Length Conversions:
 *    - 1 roll = uomAttributes.metersPerRoll meters (must be finite > 0)
 *    - 1 cone = uomAttributes.metersPerCone meters (must be finite > 0)
 * 4. Configured Fabric Weight <-> Length Conversions:
 *    - Weight per linear meter (kg/m) = (gsm * usableWidthCm) / 100,000
 *      (where gsm = g/m² and usableWidthCm / 100 = width in meters; / 1000 g->kg)
 *    - Requires BOTH gsm > 0 and usableWidthCm > 0.
 * 5. No implicit conversions across incompatible dimensions (e.g., pcs <-> kg).
 */

export const PCS_PER_DOZEN = 12;
export const PCS_PER_GROSS = 144;
export const METERS_PER_YARD = 0.9144;

const COUNT_UNITS: ReadonlySet<ConsumptionUnit> = new Set(['pcs', 'dozens', 'gross']);
const LENGTH_OR_WEIGHT_UNITS: ReadonlySet<ConsumptionUnit> = new Set([
  'meters',
  'yards',
  'rolls',
  'cones',
  'kg',
]);

export interface UomConversionResult {
  inputQuantity: number;
  fromUnit: ConsumptionUnit;
  toUnit: ConsumptionUnit;
  exactValue: number;
  displayValue: number;
  conversionFactor: number;
  formulaDescription: string;
}

export function roundUomDisplay(value: number, decimals: number = 4): number {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`Cannot round non-finite value: ${value}`, 'value');
  }
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function assertPositiveAttr(
  value: number | undefined,
  attrName: keyof MaterialUomAttributes,
  fromUnit: ConsumptionUnit,
  toUnit: ConsumptionUnit
): number {
  if (value === undefined || value === null || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError(
      `Cannot convert from "${fromUnit}" to "${toUnit}": required attribute "${attrName}" must be a finite positive number (received ${value}).`,
      attrName,
      { fromUnit, toUnit, attrName, value }
    );
  }
  return value;
}

function getCountToPcsFactor(unit: ConsumptionUnit): number {
  switch (unit) {
    case 'pcs':
      return 1;
    case 'dozens':
      return PCS_PER_DOZEN;
    case 'gross':
      return PCS_PER_GROSS;
    default:
      throw new ValidationError(`Unit "${unit}" is not a count unit.`, 'unit');
  }
}

/**
 * Computes factor M such that: targetQty = sourceQty * M
 */
export function getUomConversionFactor(
  fromUnit: ConsumptionUnit,
  toUnit: ConsumptionUnit,
  uomAttributes?: MaterialUomAttributes
): { factor: number; formulaDescription: string } {
  if (fromUnit === toUnit) {
    return {
      factor: 1,
      formulaDescription: `Identity (${fromUnit} -> ${toUnit}, factor 1)`,
    };
  }

  // 1. Count unit family (pcs <-> dozens <-> gross)
  if (COUNT_UNITS.has(fromUnit) && COUNT_UNITS.has(toUnit)) {
    const fromPcs = getCountToPcsFactor(fromUnit);
    const toPcs = getCountToPcsFactor(toUnit);
    const factor = fromPcs / toPcs;
    return {
      factor,
      formulaDescription: `${fromUnit} -> pcs (*${fromPcs}) -> ${toUnit} (/${toPcs})`,
    };
  }

  // Reject cross-family attempts immediately (count <-> length/weight)
  if (!LENGTH_OR_WEIGHT_UNITS.has(fromUnit) || !LENGTH_OR_WEIGHT_UNITS.has(toUnit)) {
    throw new ValidationError(
      `Incompatible UOM conversion: cannot convert between "${fromUnit}" and "${toUnit}".`,
      'uom',
      { fromUnit, toUnit }
    );
  }

  // Prevent rolls <-> cones unless bridged? No direct textile standard between roll length and thread cone.
  if (
    (fromUnit === 'rolls' && toUnit === 'cones') ||
    (fromUnit === 'cones' && toUnit === 'rolls') ||
    (fromUnit === 'kg' && toUnit === 'cones') ||
    (fromUnit === 'cones' && toUnit === 'kg')
  ) {
    throw new ValidationError(
      `Unsupported UOM conversion: cannot convert directly between "${fromUnit}" and "${toUnit}".`,
      'uom',
      { fromUnit, toUnit }
    );
  }

  // 2. Convert source unit -> linear meters
  let toMetersFactor: number;
  let sourceFormula: string;

  switch (fromUnit) {
    case 'meters':
      toMetersFactor = 1;
      sourceFormula = 'meters';
      break;
    case 'yards':
      toMetersFactor = METERS_PER_YARD;
      sourceFormula = `yards * ${METERS_PER_YARD} m/yd`;
      break;
    case 'rolls': {
      const mPerRoll = assertPositiveAttr(
        uomAttributes?.metersPerRoll,
        'metersPerRoll',
        fromUnit,
        toUnit
      );
      toMetersFactor = mPerRoll;
      sourceFormula = `rolls * ${mPerRoll} m/roll`;
      break;
    }
    case 'cones': {
      const mPerCone = assertPositiveAttr(
        uomAttributes?.metersPerCone,
        'metersPerCone',
        fromUnit,
        toUnit
      );
      toMetersFactor = mPerCone;
      sourceFormula = `cones * ${mPerCone} m/cone`;
      break;
    }
    case 'kg': {
      const gsm = assertPositiveAttr(uomAttributes?.gsm, 'gsm', fromUnit, toUnit);
      const widthCm = assertPositiveAttr(
        uomAttributes?.usableWidthCm,
        'usableWidthCm',
        fromUnit,
        toUnit
      );
      const kgPerMeter = (gsm * widthCm) / 100_000;
      toMetersFactor = 1 / kgPerMeter;
      sourceFormula = `kg / ((${gsm} gsm * ${widthCm} cm) / 100000)`;
      break;
    }
    default:
      throw new ValidationError(`Unsupported source unit "${fromUnit}".`, 'fromUnit');
  }

  // 3. Convert linear meters -> target unit
  let fromMetersFactor: number;
  let targetFormula: string;

  switch (toUnit) {
    case 'meters':
      fromMetersFactor = 1;
      targetFormula = 'meters';
      break;
    case 'yards':
      fromMetersFactor = 1 / METERS_PER_YARD;
      targetFormula = `/ ${METERS_PER_YARD} m/yd`;
      break;
    case 'rolls': {
      const mPerRoll = assertPositiveAttr(
        uomAttributes?.metersPerRoll,
        'metersPerRoll',
        fromUnit,
        toUnit
      );
      fromMetersFactor = 1 / mPerRoll;
      targetFormula = `/ ${mPerRoll} m/roll`;
      break;
    }
    case 'cones': {
      const mPerCone = assertPositiveAttr(
        uomAttributes?.metersPerCone,
        'metersPerCone',
        fromUnit,
        toUnit
      );
      fromMetersFactor = 1 / mPerCone;
      targetFormula = `/ ${mPerCone} m/cone`;
      break;
    }
    case 'kg': {
      const gsm = assertPositiveAttr(uomAttributes?.gsm, 'gsm', fromUnit, toUnit);
      const widthCm = assertPositiveAttr(
        uomAttributes?.usableWidthCm,
        'usableWidthCm',
        fromUnit,
        toUnit
      );
      const kgPerMeter = (gsm * widthCm) / 100_000;
      fromMetersFactor = kgPerMeter;
      targetFormula = `* ((${gsm} gsm * ${widthCm} cm) / 100000)`;
      break;
    }
    default:
      throw new ValidationError(`Unsupported target unit "${toUnit}".`, 'toUnit');
  }

  return {
    factor: toMetersFactor * fromMetersFactor,
    formulaDescription: `${sourceFormula} -> ${targetFormula}`,
  };
}

export function canConvertUom(
  fromUnit: ConsumptionUnit,
  toUnit: ConsumptionUnit,
  uomAttributes?: MaterialUomAttributes
): { valid: boolean; reason?: string } {
  try {
    getUomConversionFactor(fromUnit, toUnit, uomAttributes);
    return { valid: true };
  } catch (err: any) {
    return { valid: false, reason: err?.message || 'Conversion not possible' };
  }
}

export function convertUom(
  quantity: number,
  fromUnit: ConsumptionUnit,
  toUnit: ConsumptionUnit,
  uomAttributes?: MaterialUomAttributes,
  displayDecimals: number = 4
): UomConversionResult {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
    throw new ValidationError(
      `Quantity for UOM conversion must be a non-negative finite number (received ${quantity}).`,
      'quantity',
      { quantity, fromUnit, toUnit }
    );
  }

  const { factor, formulaDescription } = getUomConversionFactor(
    fromUnit,
    toUnit,
    uomAttributes
  );

  const exactValue = fromUnit === toUnit ? quantity : quantity * factor;

  return {
    inputQuantity: quantity,
    fromUnit,
    toUnit,
    exactValue,
    displayValue: roundUomDisplay(exactValue, displayDecimals),
    conversionFactor: factor,
    formulaDescription,
  };
}
