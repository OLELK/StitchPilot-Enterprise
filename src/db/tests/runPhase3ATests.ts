/**
 * StitchPilot Enterprise — Phase 3A Stage 1 Automated Test Suite
 *
 * Covers 29 targeted tests across:
 *  - UOM Conversion Engine (Tests 1-8)
 *  - Pure BOM Calculation Engine (Tests 9-16)
 *  - Pure Costing Calculation Engine (Tests 17-24)
 *  - Dexie v1 -> v2 Populated Database Migration (Tests 25-29)
 */

import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase } from '../database';
import { createRepositories } from '../repositories';
import { ValidationError } from '../errors';
import {
  BomItemEntity,
  CostSheetEntity,
  MaterialEntity,
} from '../types';
import {
  DEMO_BUYERS,
  DEMO_STYLES,
  DEMO_MATERIALS,
  DEMO_PRODUCTION_LINES,
  DEMO_ORDERS,
  DEMO_ORDER_ITEMS,
  DEMO_INVENTORY_TRANSACTIONS,
  DEMO_CUTTING_JOBS,
  DEMO_MARKER_RATIOS,
  DEMO_BUNDLES,
  DEMO_PRODUCTION_EVENTS,
  DEMO_QUALITY_INSPECTIONS,
  DEMO_QUALITY_DEFECTS,
} from '../demoData';
import { convertUom } from '../services/uomConverter';
import {
  calculateBomLineRequirement,
  calculateOrderBomRequirements,
} from '../services/bomCalculator';
import { calculateCostSheet } from '../services/costingCalculator';

export interface Phase3ATestResult {
  testNumber: number;
  category: 'UOM' | 'BOM' | 'COSTING' | 'MIGRATION';
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

class LegacyV1FixtureDatabase extends Dexie {
  constructor(indexedDB: any, idbKeyRange: any, dbName: string) {
    super(dbName, { indexedDB, IDBKeyRange: idbKeyRange });
    this.version(1).stores({
      buyers: 'id, &code, name, createdAt',
      styles: 'id, buyerId, &styleCode, garmentType, createdAt',
      orders:
        'id, &poNumber, buyerId, styleId, status, assignedLineId, targetExFactoryDate, createdAt',
      order_items: 'id, orderId, size, [orderId+size]',
      cost_sheets: 'id, styleId, version',
      materials: 'id, &materialCode, category, unit, createdAt',
      bom_items: 'id, styleId, materialId, [styleId+materialId]',
      inventory_transactions:
        'id, &idempotencyKey, materialId, transactionType, referenceId, timestamp, [materialId+transactionType]',
      cutting_jobs:
        'id, &jobNumber, orderId, styleId, status, fabricMaterialId, createdAt',
      marker_ratios: 'id, cuttingJobId, size',
      bundles:
        'id, &bundleBarcode, cuttingJobId, orderId, styleId, currentLineId, status, createdAt',
      production_lines: 'id, section, status, activeOrderId',
      production_events:
        'id, lineId, orderId, eventType, timestamp, [lineId+timestamp]',
      quality_inspections:
        'id, &inspectionNumber, orderId, lineId, stage, result, inspectionDate',
      quality_defects: 'id, inspectionId, defectCode, category, severity',
      system_metadata: '&key',
    });
  }
}

function approxEqual(a: number, b: number, tol: number = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

function makeMaterial(overrides: Partial<MaterialEntity>): MaterialEntity {
  return {
    id: 'MAT-X',
    materialCode: 'CODE-X',
    name: 'Test Material',
    category: 'Trims & Fasteners',
    spec: 'Spec',
    unit: 'pcs',
    reorderPoint: 100,
    warehouseLocation: 'Zone A',
    supplierName: 'Supplier',
    isSimulated: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBom(overrides: Partial<BomItemEntity>): BomItemEntity {
  return {
    id: 'BOM-X',
    styleId: 'STY-X',
    materialId: 'MAT-X',
    consumptionPerGarment: 1,
    wastagePercent: 0,
    placement: 'Placement',
    isMandatory: true,
    isSimulated: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export async function runPhase3ATests(): Promise<{
  allPassed: boolean;
  results: Phase3ATestResult[];
}> {
  const results: Phase3ATestResult[] = [];

  const record = (
    testNumber: number,
    category: Phase3ATestResult['category'],
    name: string,
    fn: () => { passed: boolean; message: string; details?: any }
  ) => {
    try {
      const outcome = fn();
      results.push({ testNumber, category, name, ...outcome });
    } catch (err: any) {
      results.push({
        testNumber,
        category,
        name,
        passed: false,
        message: `Threw unexpected error: ${err?.message || err}`,
      });
    }
  };

  // ==========================================================
  // UOM TESTS (1-8)
  // ==========================================================
  record(1, 'UOM', '144 pcs = 1 gross (bidirectional)', () => {
    const toGross = convertUom(144, 'pcs', 'gross');
    const toPcs = convertUom(1, 'gross', 'pcs');
    const ok = approxEqual(toGross.exactValue, 1) && approxEqual(toPcs.exactValue, 144);
    return {
      passed: ok,
      message: `144 pcs -> ${toGross.exactValue} gross; 1 gross -> ${toPcs.exactValue} pcs`,
    };
  });

  record(2, 'UOM', '12 pcs = 1 dozen (bidirectional)', () => {
    const toDoz = convertUom(12, 'pcs', 'dozens');
    const toPcs = convertUom(2.5, 'dozens', 'pcs');
    const ok = approxEqual(toDoz.exactValue, 1) && approxEqual(toPcs.exactValue, 30);
    return {
      passed: ok,
      message: `12 pcs -> ${toDoz.exactValue} doz; 2.5 doz -> ${toPcs.exactValue} pcs`,
    };
  });

  record(3, 'UOM', 'Meter-yard conversions', () => {
    const ydToM = convertUom(100, 'yards', 'meters');
    const mToYd = convertUom(91.44, 'meters', 'yards');
    const ok =
      approxEqual(ydToM.exactValue, 91.44) && approxEqual(mToYd.exactValue, 100);
    return {
      passed: ok,
      message: `100 yd -> ${ydToM.exactValue} m; 91.44 m -> ${mToYd.exactValue} yd`,
    };
  });

  record(4, 'UOM', 'Configured meters-roll conversion', () => {
    const attrs = { metersPerRoll: 50 };
    const mToR = convertUom(275, 'meters', 'rolls', attrs);
    const rToM = convertUom(5.5, 'rolls', 'meters', attrs);
    const ok =
      approxEqual(mToR.exactValue, 5.5) && approxEqual(rToM.exactValue, 275);
    return {
      passed: ok,
      message: `275 m -> ${mToR.exactValue} rolls (@50m/roll); 5.5 rolls -> ${rToM.exactValue} m`,
    };
  });

  record(5, 'UOM', 'Configured meters-cone conversion', () => {
    const attrs = { metersPerCone: 5000 };
    const mToC = convertUom(12500, 'meters', 'cones', attrs);
    const cToM = convertUom(2.5, 'cones', 'meters', attrs);
    const ok =
      approxEqual(mToC.exactValue, 2.5) && approxEqual(cToM.exactValue, 12500);
    return {
      passed: ok,
      message: `12,500 m -> ${mToC.exactValue} cones (@5000m/cone); 2.5 cones -> ${cToM.exactValue} m`,
    };
  });

  record(6, 'UOM', 'Valid kg-meter conversion with GSM & usable width', () => {
    // 200 GSM * 150 cm -> (200 * 150) / 100,000 = 0.30 kg per linear meter
    const attrs = { gsm: 200, usableWidthCm: 150 };
    const mToKg = convertUom(100, 'meters', 'kg', attrs);
    const kgToM = convertUom(30, 'kg', 'meters', attrs);
    const ok =
      approxEqual(mToKg.exactValue, 30) && approxEqual(kgToM.exactValue, 100);
    return {
      passed: ok,
      message: `100 m @200GSM/150cm -> ${mToKg.exactValue} kg; 30 kg -> ${kgToM.exactValue} m`,
    };
  });

  record(7, 'UOM', 'Rejection of kg-meter conversion without GSM/width', () => {
    let missingAllRejected = false;
    let missingWidthRejected = false;
    try {
      convertUom(10, 'kg', 'meters');
    } catch (e) {
      missingAllRejected = e instanceof ValidationError;
    }
    try {
      convertUom(10, 'meters', 'kg', { gsm: 220 });
    } catch (e) {
      missingWidthRejected = e instanceof ValidationError;
    }
    const ok = missingAllRejected && missingWidthRejected;
    return {
      passed: ok,
      message: ok
        ? 'Correctly threw ValidationError when GSM or usableWidthCm was missing.'
        : 'Failed to reject missing GSM/width.',
    };
  });

  record(8, 'UOM', 'Invalid/zero conversion attributes & incompatible units rejected', () => {
    const cases: Array<() => void> = [
      () => convertUom(10, 'meters', 'rolls', { metersPerRoll: 0 }),
      () => convertUom(10, 'meters', 'cones', { metersPerCone: -500 }),
      () => convertUom(10, 'kg', 'meters', { gsm: 0, usableWidthCm: 150 }),
      () => convertUom(10, 'kg', 'meters', { gsm: 180, usableWidthCm: Number.NaN }),
      () => convertUom(10, 'pcs', 'kg'),
      () => convertUom(-5, 'pcs', 'dozens'),
    ];
    let allRejected = true;
    for (const fn of cases) {
      try {
        fn();
        allRejected = false;
      } catch (e) {
        if (!(e instanceof ValidationError)) {
          allRejected = false;
        }
      }
    }
    return {
      passed: allRejected,
      message: allRejected
        ? `All ${cases.length} invalid attribute / incompatible UOM / negative qty cases threw ValidationError.`
        : 'One or more invalid cases did not throw ValidationError.',
    };
  });

  // ==========================================================
  // BOM TESTS (9-16)
  // ==========================================================
  record(9, 'BOM', 'PER_PIECE calculation', () => {
    const mat = makeMaterial({ id: 'M1', unit: 'kg' });
    const bom = makeBom({
      id: 'B1',
      styleId: 'S1',
      materialId: 'M1',
      consumptionPerGarment: 0.48,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'kg',
      wastagePercent: 0,
    });
    const res = calculateBomLineRequirement(
      bom,
      mat,
      [{ color: 'Black', size: 'M', quantity: 1000 }],
      'S1'
    );
    const ok =
      res.matchedGarmentPieces === 1000 &&
      approxEqual(res.netRequirementStockUnitExact, 480) &&
      approxEqual(res.grossRequirementStockUnitExact, 480);
    return {
      passed: ok,
      message: `1,000 pcs * 0.48 kg/pc = ${res.grossRequirementStockUnitExact} kg`,
    };
  });

  record(10, 'BOM', 'PER_DOZEN calculation', () => {
    const mat = makeMaterial({ id: 'M-THD', unit: 'cones' });
    const bom = makeBom({
      id: 'B-THD',
      styleId: 'S1',
      materialId: 'M-THD',
      consumptionPerGarment: 0.02, // 0.02 cones per dozen
      consumptionBasis: 'PER_DOZEN',
      consumptionUnit: 'cones',
      wastagePercent: 0,
    });
    const res = calculateBomLineRequirement(
      bom,
      mat,
      [{ color: 'Charcoal', size: 'L', quantity: 12000 }],
      'S1'
    );
    // 12,000 pcs = 1,000 dozens * 0.02 cones/doz = 20 cones
    const ok = approxEqual(res.netRequirementStockUnitExact, 20);
    return {
      passed: ok,
      message: `12,000 pcs (1,000 doz) * 0.02 cones/doz = ${res.netRequirementStockUnitExact} cones`,
    };
  });

  record(11, 'BOM', 'Wastage calculation', () => {
    const mat = makeMaterial({ id: 'M4', unit: 'meters' });
    const bom = makeBom({
      id: 'B6',
      styleId: 'S3',
      materialId: 'M4',
      consumptionPerGarment: 1.45,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'meters',
      wastagePercent: 6,
    });
    const res = calculateBomLineRequirement(
      bom,
      mat,
      [{ color: 'Olive', size: 'M', quantity: 1000 }],
      'S3'
    );
    // Net = 1450, Wastage = 87, Gross = 1537
    const ok =
      approxEqual(res.netRequirementStockUnitExact, 1450) &&
      approxEqual(res.wastageQuantityStockUnitExact, 87) &&
      approxEqual(res.grossRequirementStockUnitExact, 1537);
    return {
      passed: ok,
      message: `Net: ${res.netRequirementStockUnitExact} m, Wastage (6%): ${res.wastageQuantityStockUnitExact} m, Gross: ${res.grossRequirementStockUnitExact} m`,
    };
  });

  record(12, 'BOM', 'Colour filtering (colorScope SPECIFIC)', () => {
    const mat = makeMaterial({ id: 'M-DYE', unit: 'meters' });
    const bom = makeBom({
      id: 'B-COL',
      styleId: 'S1',
      materialId: 'M-DYE',
      consumptionPerGarment: 2.0,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'meters',
      wastagePercent: 5,
      colorScope: 'SPECIFIC',
      applicableColors: ['Washed Charcoal'],
    });
    const res = calculateBomLineRequirement(
      bom,
      mat,
      [
        { color: 'Washed Charcoal', size: 'M', quantity: 300 },
        { color: 'Optical White', size: 'M', quantity: 700 },
      ],
      'S1'
    );
    const ok =
      res.matchedGarmentPieces === 300 &&
      res.byColor.length === 1 &&
      res.byColor[0].color === 'Washed Charcoal' &&
      approxEqual(res.grossRequirementStockUnitExact, 630);
    return {
      passed: ok,
      message: `Matched only Washed Charcoal (300 pcs), excluded Optical White (700 pcs); Gross=${res.grossRequirementStockUnitExact}m`,
    };
  });

  record(13, 'BOM', 'Size filtering (sizeScope SPECIFIC)', () => {
    const mat = makeMaterial({ id: 'M-LBL', unit: 'pcs' });
    const bom = makeBom({
      id: 'B-SIZE',
      styleId: 'S1',
      materialId: 'M-LBL',
      consumptionPerGarment: 1,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 0,
      sizeScope: 'SPECIFIC',
      applicableSizes: ['XL', 'XXL'],
    });
    const res = calculateBomLineRequirement(
      bom,
      mat,
      [
        { color: 'Black', size: 'S', quantity: 400 },
        { color: 'Black', size: 'M', quantity: 500 },
        { color: 'Black', size: 'XL', quantity: 250 },
        { color: 'Black', size: 'XXL', quantity: 150 },
      ],
      'S1'
    );
    const ok =
      res.matchedGarmentPieces === 400 &&
      approxEqual(res.grossRequirementStockUnitExact, 400);
    return {
      passed: ok,
      message: `Matched XL + XXL (${res.matchedGarmentPieces} pcs), excluded S/M; Gross=${res.grossRequirementStockUnitExact} pcs`,
    };
  });

  record(14, 'BOM', 'Size-specific consumption overrides', () => {
    const mat = makeMaterial({ id: 'M-FAB', unit: 'meters' });
    const bom = makeBom({
      id: 'B-OVR',
      styleId: 'S3',
      materialId: 'M-FAB',
      consumptionPerGarment: 1.4,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'meters',
      wastagePercent: 0,
      sizeConsumptionMap: {
        XL: 1.65,
      },
    });
    const res = calculateBomLineRequirement(
      bom,
      mat,
      [
        { color: 'Khaki', size: 'M', quantity: 100 }, // 100 * 1.4 = 140
        { color: 'Khaki', size: 'XL', quantity: 100 }, // 100 * 1.65 = 165
      ],
      'S3'
    );
    const ok = approxEqual(res.netRequirementStockUnitExact, 305);
    return {
      passed: ok,
      message: `M(100*1.4) + XL(100*1.65) = ${res.netRequirementStockUnitExact} meters`,
    };
  });

  record(15, 'BOM', 'Gross requirement conversion to stock UOM (pcs -> gross)', () => {
    const buttonMat = makeMaterial({ id: 'MAT-06', unit: 'gross' });
    const bom = makeBom({
      id: 'BOM-08',
      styleId: 'STY-03',
      materialId: 'MAT-06',
      consumptionPerGarment: 2.0,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 2.0,
    });
    const summary = calculateOrderBomRequirements({
      primaryStyleId: 'STY-03',
      orderItems: [
        { color: 'Khaki', size: 'M', quantity: 7000 },
        { color: 'Olive', size: 'L', quantity: 5000 },
      ],
      bomItems: [bom],
      materialsById: { 'MAT-06': buttonMat },
    });
    const line = summary.lineResults[0];
    // Net: 12,000 * 2 = 24,000 pcs; Gross: 24,000 * 1.02 = 24,480 pcs = 170.00 gross
    const ok =
      approxEqual(line.grossRequirementConsUnitExact, 24480) &&
      approxEqual(line.grossRequirementStockUnitExact, 170) &&
      line.discreteOrderUnits === 170;
    return {
      passed: ok,
      message: `12,000 garments -> ${line.grossRequirementConsUnitExact} pcs -> ${line.grossRequirementStockUnitExact} gross (consolidated: ${summary.consolidatedMaterials[0].grossRequirementStockUnit} gross)`,
    };
  });

  record(16, 'BOM', 'Fractional requirements preserved cleanly', () => {
    const buttonMat = makeMaterial({ id: 'MAT-06', unit: 'gross' });
    const bom = makeBom({
      id: 'BOM-FRAC',
      styleId: 'STY-03',
      materialId: 'MAT-06',
      consumptionPerGarment: 2.0,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 2.0,
    });
    const res = calculateBomLineRequirement(
      bom,
      buttonMat,
      [{ color: 'Khaki', size: 'M', quantity: 1000 }],
      'STY-03'
    );
    // 1000 * 2 * 1.02 = 2040 pcs = 2040 / 144 = 14.166666666666666 gross
    const expectedExact = 2040 / 144;
    const ok =
      approxEqual(res.grossRequirementStockUnitExact, expectedExact) &&
      res.grossRequirementStockUnit === 14.1667 &&
      res.discreteOrderUnits === 15;
    return {
      passed: ok,
      message: `Exact: ${res.grossRequirementStockUnitExact.toFixed(6)} gross, Display: ${res.grossRequirementStockUnit}, Discrete Ceil: ${res.discreteOrderUnits}`,
    };
  });

  // ==========================================================
  // COSTING TESTS (17-24)
  // ==========================================================
  record(17, 'COSTING', 'Fabric, trim, thread, packing, print & wash aggregation', () => {
    const res = calculateCostSheet({
      currency: 'USD',
      lineItems: [
        {
          id: 'L1',
          category: 'FABRIC',
          description: 'Fleece Shell',
          currency: 'USD',
          consumptionPerGarment: 0.48,
          wastagePercent: 5,
          consumptionUnit: 'kg',
          stockUnit: 'kg',
          unitPrice: 8.0, // 0.48 * 1.05 * 8 = 4.032
        },
        {
          id: 'L2',
          category: 'TRIMS',
          description: 'Shell Buttons',
          currency: 'USD',
          consumptionPerGarment: 2,
          wastagePercent: 0,
          consumptionUnit: 'pcs',
          stockUnit: 'gross',
          unitPrice: 7.2, // (2/144) * 7.2 = 0.10
        },
        {
          id: 'L3',
          category: 'THREAD_CONSUMABLES',
          description: 'Overlock Thread',
          currency: 'USD',
          costPerGarment: 0.18,
        },
        {
          id: 'L4',
          category: 'PACKING',
          description: 'Polybag & Carton Share',
          currency: 'USD',
          costPerGarment: 0.25,
        },
        {
          id: 'L5',
          category: 'PRINTING_EMBROIDERY',
          description: 'Chest Embroidery',
          currency: 'USD',
          costPerGarment: 0.45,
        },
        {
          id: 'L6',
          category: 'WASHING_FINISHING',
          description: 'Enzyme Wash',
          currency: 'USD',
          costPerGarment: 0.35,
        },
      ],
      categoryCosts: { OTHER: 0.14 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 1.5 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.5 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 10.0,
    });

    // Total = 4.032 + 0.10 + 0.18 + 0.25 + 0.45 + 0.35 + 0.14 + 1.50 + 0.50 = 7.502
    const ok =
      approxEqual(res.fabricCost, 4.032) &&
      approxEqual(res.trimsCost, 0.1) &&
      approxEqual(res.materialCostSubtotal, 4.562) &&
      approxEqual(res.valueAddedCostSubtotal, 0.8) &&
      approxEqual(res.exact.totalManufacturingCost, 7.502);
    return {
      passed: ok,
      message: `Fabric=$${res.fabricCost}, Trims=$${res.trimsCost}, Materials=$${res.materialCostSubtotal}, VA=$${res.valueAddedCostSubtotal}, Total=$${res.totalManufacturingCost}`,
    };
  });

  record(18, 'COSTING', 'CMT with SAM and efficiency (no double efficiency adjustment)', () => {
    // Basis A: ACTUAL_MINUTE -> (20 / 0.80) * 0.10 = 25 * 0.10 = 2.50
    const actualBasis = calculateCostSheet({
      currency: 'EUR',
      categoryCosts: { FABRIC: 4.0 },
      cmt: {
        method: 'SAM_RATE',
        samMinutes: 20,
        efficiencyPercent: 80,
        cmRatePerMinute: 0.1,
        cmRateBasis: 'ACTUAL_MINUTE',
      },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 10,
    });

    // Basis B: STANDARD_MINUTE -> 20 * 0.10 = 2.00 (efficiency NOT applied a second time)
    const stdBasis = calculateCostSheet({
      currency: 'EUR',
      categoryCosts: { FABRIC: 4.0 },
      cmt: {
        method: 'SAM_RATE',
        samMinutes: 20,
        efficiencyPercent: 80,
        cmRatePerMinute: 0.1,
        cmRateBasis: 'STANDARD_MINUTE',
      },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 10,
    });

    const ok =
      actualBasis.effectiveActualMinutes === 25 &&
      approxEqual(actualBasis.laborCmtCost, 2.5) &&
      approxEqual(stdBasis.laborCmtCost, 2.0);
    return {
      passed: ok,
      message: `ACTUAL_MINUTE CMT=${actualBasis.laborCmtCost} EUR (25 actual min); STANDARD_MINUTE CMT=${stdBasis.laborCmtCost} EUR (20 SMV, no double adjustment)`,
    };
  });

  record(19, 'COSTING', 'Direct CMT override', () => {
    const res = calculateCostSheet({
      currency: 'GBP',
      categoryCosts: { FABRIC: 3.0, TRIMS: 1.0 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.35 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 10.0,
    });
    const ok =
      approxEqual(res.laborCmtCost, 2.35) &&
      res.effectiveActualMinutes === undefined &&
      approxEqual(res.exact.totalManufacturingCost, 7.0);
    return {
      passed: ok,
      message: `Direct CMT=${res.laborCmtCost} GBP, Total Cost=${res.totalManufacturingCost} GBP`,
    };
  });

  record(20, 'COSTING', 'Overhead calculation (FIXED, PERCENT_OF_CMT, PERCENT_OF_DIRECT_COST)', () => {
    const base = {
      currency: 'USD',
      categoryCosts: { FABRIC: 5.0, TRIMS: 1.0 }, // directMaterials = 6.0
      cmt: { method: 'DIRECT_CMT' as const, directCmtCost: 2.0 }, // directCost = 8.0
      pricingMode: 'FOB_TO_MARGIN' as const,
      quotedFobPrice: 12.0,
    };
    const rFixed = calculateCostSheet({
      ...base,
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.75 },
    });
    const rCmtPct = calculateCostSheet({
      ...base,
      overhead: { method: 'PERCENT_OF_CMT', value: 25 }, // 25% of 2.0 = 0.50
    });
    const rDirPct = calculateCostSheet({
      ...base,
      overhead: { method: 'PERCENT_OF_DIRECT_COST', value: 10 }, // 10% of 8.0 = 0.80
    });
    const ok =
      approxEqual(rFixed.overheadCost, 0.75) &&
      approxEqual(rCmtPct.overheadCost, 0.5) &&
      approxEqual(rDirPct.overheadCost, 0.8);
    return {
      passed: ok,
      message: `FIXED=${rFixed.overheadCost}, 25%_OF_CMT=${rCmtPct.overheadCost}, 10%_OF_DIRECT=${rDirPct.overheadCost}`,
    };
  });

  record(21, 'COSTING', 'Margin-to-FOB calculation (with commission)', () => {
    // Total Cost = 8.00, Commission = 5%, Target Gross Margin = 20%
    // FOB = 8.00 / (1 - 0.25) = 10.666666...
    // Commission = 0.533333..., Net Realized FOB = 10.133333..., Profit = 2.133333... (20% of 10.666666...)
    const res = calculateCostSheet({
      currency: 'USD',
      categoryCosts: { FABRIC: 5.0, TRIMS: 1.0 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 1.5 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.5 },
      commissionPercent: 5,
      pricingMode: 'MARGIN_TO_FOB',
      targetMarginPercent: 20,
    });
    const ok =
      approxEqual(res.exact.totalManufacturingCost, 8) &&
      approxEqual(res.exact.quotedFobPrice, 8 / 0.75) &&
      approxEqual(res.exact.grossMarginPercent, 20) &&
      approxEqual(res.exact.profitPerGarment, 8 / 0.75 * 0.2);
    return {
      passed: ok,
      message: `Cost=$8.00, Comm=5%, Target Margin=20% -> FOB=$${res.quotedFobPrice}, NetFOB=$${res.netRealizedFob}, Profit=$${res.profitPerGarment}`,
    };
  });

  record(22, 'COSTING', 'FOB-to-margin calculation', () => {
    const res = calculateCostSheet({
      currency: 'USD',
      categoryCosts: { FABRIC: 5.0, TRIMS: 1.0 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 1.5 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.5 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 10.0,
    });
    const ok =
      approxEqual(res.exact.totalManufacturingCost, 8.0) &&
      approxEqual(res.exact.profitPerGarment, 2.0) &&
      approxEqual(res.exact.grossMarginPercent, 20.0);
    return {
      passed: ok,
      message: `Cost=$8.00, FOB=$10.00 -> Profit=$${res.profitPerGarment}, Margin=${res.grossMarginPercent}%`,
    };
  });

  record(23, 'COSTING', 'Margin versus markup distinction', () => {
    // Cost = 8.00, Quoted FOB = 10.00 -> Profit = 2.00
    // Gross Margin = 2 / 10 = 20%, Markup = 2 / 8 = 25%
    const fobRes = calculateCostSheet({
      currency: 'USD',
      categoryCosts: { FABRIC: 8.0 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 0 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 10.0,
    });

    const markupRes = calculateCostSheet({
      currency: 'USD',
      categoryCosts: { FABRIC: 8.0 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 0 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0 },
      pricingMode: 'MARKUP_TO_FOB',
      targetMarkupPercent: 25,
    });

    const ok =
      approxEqual(fobRes.grossMarginPercent, 20) &&
      approxEqual(fobRes.markupPercent, 25) &&
      approxEqual(markupRes.exact.quotedFobPrice, 10) &&
      approxEqual(markupRes.grossMarginPercent, 20) &&
      approxEqual(markupRes.markupPercent, 25);
    return {
      passed: ok,
      message: `Gross Margin=${fobRes.grossMarginPercent}% vs Markup=${fobRes.markupPercent}% (MARKUP_TO_FOB 25% -> FOB=$${markupRes.quotedFobPrice})`,
    };
  });

  record(24, 'COSTING', 'Invalid input and currency mismatch rejection', () => {
    const invalidCases: Array<() => void> = [
      // Missing / invalid currency
      () =>
        calculateCostSheet({
          currency: '',
          categoryCosts: { FABRIC: 5 },
          cmt: { method: 'DIRECT_CMT', directCmtCost: 1 },
          overhead: { method: 'FIXED_PER_GARMENT', value: 0 },
          pricingMode: 'FOB_TO_MARGIN',
          quotedFobPrice: 10,
        }),
      // Multi-currency line mismatch (EUR on USD sheet)
      () =>
        calculateCostSheet({
          currency: 'USD',
          lineItems: [
            {
              id: 'L-EUR',
              category: 'FABRIC',
              description: 'Italian Wool',
              currency: 'EUR',
              costPerGarment: 5.0,
            },
          ],
          cmt: { method: 'DIRECT_CMT', directCmtCost: 1 },
          overhead: { method: 'FIXED_PER_GARMENT', value: 0 },
          pricingMode: 'FOB_TO_MARGIN',
          quotedFobPrice: 10,
        }),
      // Negative cost
      () =>
        calculateCostSheet({
          currency: 'USD',
          categoryCosts: { FABRIC: -1 },
          cmt: { method: 'DIRECT_CMT', directCmtCost: 1 },
          overhead: { method: 'FIXED_PER_GARMENT', value: 0 },
          pricingMode: 'FOB_TO_MARGIN',
          quotedFobPrice: 10,
        }),
      // Margin + commission >= 100%
      () =>
        calculateCostSheet({
          currency: 'USD',
          categoryCosts: { FABRIC: 5 },
          cmt: { method: 'DIRECT_CMT', directCmtCost: 1 },
          overhead: { method: 'FIXED_PER_GARMENT', value: 0 },
          commissionPercent: 5,
          pricingMode: 'MARGIN_TO_FOB',
          targetMarginPercent: 95,
        }),
      // Efficiency <= 0
      () =>
        calculateCostSheet({
          currency: 'USD',
          categoryCosts: { FABRIC: 5 },
          cmt: {
            method: 'SAM_RATE',
            samMinutes: 10,
            efficiencyPercent: 0,
            cmRatePerMinute: 0.1,
            cmRateBasis: 'ACTUAL_MINUTE',
          },
          overhead: { method: 'FIXED_PER_GARMENT', value: 0 },
          pricingMode: 'FOB_TO_MARGIN',
          quotedFobPrice: 10,
        }),
    ];

    let allRejected = true;
    for (const fn of invalidCases) {
      try {
        fn();
        allRejected = false;
      } catch (e) {
        if (!(e instanceof ValidationError)) {
          allRejected = false;
        }
      }
    }
    return {
      passed: allRejected,
      message: allRejected
        ? `All ${invalidCases.length} invalid costing/currency mismatch scenarios threw ValidationError.`
        : 'One or more invalid scenarios did not throw ValidationError.',
    };
  });

  // ==========================================================
  // MIGRATION TESTS (25-29): Realistic Populated v1 -> v2 Fixture
  // ==========================================================
  try {
    const sharedIDB = new IDBFactory();
    const dbName = `TestDB_V1_To_V2_Migration_${Date.now()}`;

    // Legacy v1 Cost Sheets (exact Phase 2B shape without Phase 3A status/updatedAt)
    const legacyV1CostSheets: CostSheetEntity[] = [
      {
        id: 'CST-01',
        styleId: 'STY-01',
        version: 1,
        currency: 'USD',
        fabricCost: 4.8,
        trimsCost: 1.1,
        laborCmtCost: 2.2,
        overheadCost: 0.65,
        totalCostPerGarment: 8.75,
        quotedFobPrice: 11.5,
        marginPercent: 23.9,
        approvedBy: 'Farhan Kabir (Costing Head)',
        isSimulated: true,
        createdAt: '2026-02-03T10:00:00.000Z',
      },
      {
        id: 'CST-USER-DRAFT',
        styleId: 'STY-02',
        version: 2,
        currency: 'EUR',
        fabricCost: 2.0,
        trimsCost: 0.5,
        laborCmtCost: 1.2,
        overheadCost: 0.3,
        totalCostPerGarment: 4.0,
        quotedFobPrice: 5.0,
        marginPercent: 20.0,
        approvedBy: '',
        isSimulated: false,
        createdAt: '2026-03-01T10:00:00.000Z',
      },
    ];

    // Legacy v1 BOM Items (without bomVersion, status, consumptionBasis, consumptionUnit)
    const legacyV1BomItems: BomItemEntity[] = [
      {
        id: 'BOM-01',
        styleId: 'STY-01',
        materialId: 'MAT-02',
        consumptionPerGarment: 0.48,
        wastagePercent: 5.0,
        placement: 'Main Body & Hood Shell',
        isMandatory: true,
        isSimulated: true,
        createdAt: '2026-02-02T08:00:00.000Z',
      },
      {
        id: 'BOM-03',
        styleId: 'STY-01',
        materialId: 'MAT-07',
        consumptionPerGarment: 0.02, // Legacy v1 demo comment was cones per doz
        wastagePercent: 3.0,
        placement: '4-Thread Overlock & Flatlock Seams',
        isMandatory: true,
        isSimulated: true,
        createdAt: '2026-02-02T08:00:00.000Z',
      },
      {
        id: 'BOM-08',
        styleId: 'STY-03',
        materialId: 'MAT-06',
        consumptionPerGarment: 2.0, // Legacy v1 demo was 2.0 pcs against gross material MAT-06
        wastagePercent: 2.0,
        placement: 'Waistband Button & Pocket Flaps',
        isMandatory: true,
        isSimulated: true,
        createdAt: '2026-02-11T08:00:00.000Z',
      },
      {
        id: 'BOM-USER-01',
        styleId: 'STY-03',
        materialId: 'MAT-06',
        consumptionPerGarment: 0.5,
        wastagePercent: 1.0,
        placement: 'User Custom Button Entry',
        isMandatory: true,
        isSimulated: false,
        createdAt: '2026-03-05T08:00:00.000Z',
      },
    ];

    // Step 1: Create & populate realistic v1 database
    const v1Db = new LegacyV1FixtureDatabase(sharedIDB, IDBKeyRange, dbName);
    await v1Db.open();

    await Promise.all([
      v1Db.table('buyers').bulkAdd(DEMO_BUYERS),
      v1Db.table('styles').bulkAdd(DEMO_STYLES),
      v1Db.table('materials').bulkAdd(DEMO_MATERIALS),
      v1Db.table('cost_sheets').bulkAdd(legacyV1CostSheets),
      v1Db.table('bom_items').bulkAdd(legacyV1BomItems),
      v1Db.table('production_lines').bulkAdd(DEMO_PRODUCTION_LINES),
      v1Db.table('orders').bulkAdd(DEMO_ORDERS),
      v1Db.table('order_items').bulkAdd(DEMO_ORDER_ITEMS),
      v1Db.table('inventory_transactions').bulkAdd(DEMO_INVENTORY_TRANSACTIONS),
      v1Db.table('cutting_jobs').bulkAdd(DEMO_CUTTING_JOBS),
      v1Db.table('marker_ratios').bulkAdd(DEMO_MARKER_RATIOS),
      v1Db.table('bundles').bulkAdd(DEMO_BUNDLES),
      v1Db.table('production_events').bulkAdd(DEMO_PRODUCTION_EVENTS),
      v1Db.table('quality_inspections').bulkAdd(DEMO_QUALITY_INSPECTIONS),
      v1Db.table('quality_defects').bulkAdd(DEMO_QUALITY_DEFECTS),
      v1Db.table('system_metadata').put({
        key: 'is_seeded',
        value: 'true',
        updatedAt: '2026-02-20T00:00:00.000Z',
      }),
      v1Db.table('system_metadata').put({
        key: 'schema_version',
        value: '1.0.0',
        updatedAt: '2026-02-20T00:00:00.000Z',
      }),
    ]);

    const preUpgradeVersion = v1Db.verno;
    v1Db.close();

    // Step 2: Reopen using StitchPilotDatabase (version 2)
    const v2Db = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    await v2Db.open();
    const postUpgradeVersion = v2Db.verno;
    const repos2 = createRepositories(v2Db);

    // Test 25: Upgrade completed from v1 -> v2
    const schemaMeta = await v2Db.system_metadata.get('schema_version');
    const storesCount = v2Db.tables.length;
    const t25Passed =
      preUpgradeVersion === 1 &&
      postUpgradeVersion === 2 &&
      schemaMeta?.value === '2.0.0' &&
      storesCount === 16;
    results.push({
      testNumber: 25,
      category: 'MIGRATION',
      name: 'Upgrade of populated version(1) database to version(2)',
      passed: t25Passed,
      message: `Upgraded v${preUpgradeVersion} -> v${postUpgradeVersion}, schema_version=${schemaMeta?.value}, registered stores=${storesCount} (15 business + system_metadata).`,
    });

    // Test 26: Preservation of existing orders & inventory transactions & balances
    const ordersAfter = await repos2.orders.getAllOrders();
    const txAfter = await repos2.inventory.getAllTransactions(100);
    const fleeceBalance = await repos2.inventory.getMaterialStockBalance('MAT-02');
    // MAT-02 had 3200 receipt, 1800 alloc, 1200 issue -> physical=2000, reserved=600, available=1400
    const t26Passed =
      ordersAfter.length === DEMO_ORDERS.length &&
      txAfter.length === DEMO_INVENTORY_TRANSACTIONS.length &&
      fleeceBalance.physicalStock === 2000 &&
      fleeceBalance.reservedStock === 600 &&
      fleeceBalance.availableStock === 1400;
    results.push({
      testNumber: 26,
      category: 'MIGRATION',
      name: 'Preservation of existing orders and inventory transactions',
      passed: t26Passed,
      message: `Orders preserved (${ordersAfter.length}/${DEMO_ORDERS.length}), Ledger TXs preserved (${txAfter.length}/${DEMO_INVENTORY_TRANSACTIONS.length}), MAT-02 balance exact (Phys=${fleeceBalance.physicalStock}, Res=${fleeceBalance.reservedStock}, Avail=${fleeceBalance.availableStock}).`,
    });

    // Test 27: Preservation of primary keys, FKs & new compound indexes
    const ord01 = await v2Db.orders.get('ORD-01');
    const itemsByColorIndex = await v2Db.order_items
      .where('[orderId+color]')
      .equals(['ORD-01', 'Washed Charcoal'])
      .toArray();
    const bomByStyleVerIndex = await v2Db.bom_items
      .where('[styleId+bomVersion]')
      .equals(['STY-01', 1])
      .toArray();
    const costByStyleVerIndex = await v2Db.cost_sheets
      .where('[styleId+version]')
      .equals(['STY-01', 1])
      .toArray();
    const t27Passed =
      ord01?.buyerId === 'BUY-01' &&
      ord01?.styleId === 'STY-01' &&
      itemsByColorIndex.length === 5 &&
      bomByStyleVerIndex.length === 2 &&
      costByStyleVerIndex.length === 1;
    results.push({
      testNumber: 27,
      category: 'MIGRATION',
      name: 'Preservation of primary keys, relationships, and v2 compound indexes',
      passed: t27Passed,
      message: `FKs intact on ORD-01; [orderId+color]=${itemsByColorIndex.length} rows, [styleId+bomVersion]=${bomByStyleVerIndex.length} rows, [styleId+version]=${costByStyleVerIndex.length} row.`,
    });

    // Test 28: Safe backfill of legacy BOM & cost-sheet records (including user-created rows)
    const cst01 = await v2Db.cost_sheets.get('CST-01');
    const cstUser = await v2Db.cost_sheets.get('CST-USER-DRAFT');
    const bom01 = await v2Db.bom_items.get('BOM-01');
    const bomUser = await v2Db.bom_items.get('BOM-USER-01');
    const t28Passed =
      cst01?.status === 'APPROVED' &&
      cstUser?.status === 'DRAFT' &&
      cstUser?.currency === 'EUR' &&
      bom01?.bomVersion === 1 &&
      bom01?.status === 'ACTIVE' &&
      bom01?.consumptionBasis === 'PER_PIECE' &&
      bom01?.consumptionUnit === 'kg' &&
      bomUser?.consumptionPerGarment === 0.5 &&
      bomUser?.consumptionBasis === 'PER_PIECE' &&
      bomUser?.consumptionUnit === 'gross'; // User row keeps numeric 0.5 and material.unit ('gross') untouched!
    results.push({
      testNumber: 28,
      category: 'MIGRATION',
      name: 'Safe backfill of legacy BOM and cost-sheet records',
      passed: t28Passed,
      message: `CST-01->APPROVED, CST-USER-DRAFT->DRAFT(EUR); BOM-USER-01 numeric (0.5) & stock unit ('gross') preserved without demo override.`,
    });

    // Test 29: Idempotent handling of known demo corrections (BOM-03 & BOM-08) across reopens
    const bom03First = await v2Db.bom_items.get('BOM-03');
    const bom08First = await v2Db.bom_items.get('BOM-08');
    v2Db.close();

    // Reopen v2 database again to verify persistence & idempotency
    const v2Reopened = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    await v2Reopened.open();
    const bom03Second = await v2Reopened.bom_items.get('BOM-03');
    const bom08Second = await v2Reopened.bom_items.get('BOM-08');
    const bomUserSecond = await v2Reopened.bom_items.get('BOM-USER-01');
    v2Reopened.close();

    const t29Passed =
      bom03First?.consumptionBasis === 'PER_DOZEN' &&
      bom03First?.consumptionUnit === 'cones' &&
      bom03First?.consumptionPerGarment === 0.02 &&
      bom08First?.consumptionBasis === 'PER_PIECE' &&
      bom08First?.consumptionUnit === 'pcs' &&
      bom08First?.consumptionPerGarment === 2.0 &&
      bom03Second?.consumptionBasis === bom03First?.consumptionBasis &&
      bom03Second?.consumptionUnit === bom03First?.consumptionUnit &&
      bom08Second?.consumptionUnit === bom08First?.consumptionUnit &&
      bomUserSecond?.consumptionPerGarment === 0.5 &&
      bomUserSecond?.consumptionUnit === 'gross';

    results.push({
      testNumber: 29,
      category: 'MIGRATION',
      name: 'Idempotent demo corrections for BOM-03 & BOM-08',
      passed: t29Passed,
      message: `BOM-03 -> 0.02 cones PER_DOZEN; BOM-08 -> 2.0 pcs PER_PIECE; User BOM-USER-01 unaffected; Reopen preserved identical state.`,
    });
  } catch (err: any) {
    for (let n = 25; n <= 29; n++) {
      if (!results.some((r) => r.testNumber === n)) {
        results.push({
          testNumber: n,
          category: 'MIGRATION',
          name: `Migration Test ${n}`,
          passed: false,
          message: `Migration harness threw error: ${err?.message || err}`,
        });
      }
    }
  }

  const allPassed = results.length === 29 && results.every((r) => r.passed);
  return { allPassed, results };
}

if (
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1]?.includes('runPhase3ATests')
) {
  runPhase3ATests().then((output) => {
    console.log('\n===============================================================');
    console.log('STITCHPILOT ENTERPRISE — PHASE 3A STAGE 1 TEST SUITE');
    console.log('===============================================================\n');
    output.results.forEach((r) => {
      console.log(
        `[${r.passed ? 'PASS' : 'FAIL'}] Test ${r.testNumber} (${r.category}): ${r.name}`
      );
      console.log(`  ${r.message}\n`);
    });
    console.log('---------------------------------------------------------------');
    console.log(
      `Summary: ${
        output.allPassed
          ? `ALL ${output.results.length} STAGE 1 TESTS PASSED`
          : 'SOME TESTS FAILED'
      } (${output.results.filter((r) => r.passed).length}/${output.results.length})`
    );
    console.log('===============================================================\n');
    if (!output.allPassed) {
      process.exit(1);
    }
  });
}
