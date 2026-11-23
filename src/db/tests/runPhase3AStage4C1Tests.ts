/**
 * StitchPilot Enterprise — Phase 3A Stage 4C.1 Automated Test Suite
 * BOM-to-Costing Integration Layer & Repository UOM Hydration
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase } from '../database';
import { createRepositories } from '../repositories';
import {
  applyManualRateOverride,
  createCostingBomService,
  mapBomCategoryToCostCategory,
  resolveMaterialRate,
  updateConsumptionDrivenCostingLine,
} from '../services/costingBomService';
import { calculateCostSheet } from '../services/costingCalculator';
import { calculateOrderBomRequirements } from '../services/bomCalculator';
import { MaterialEntity } from '../types';

export interface Phase3AStage4C1TestResult {
  testNumber: number;
  category:
    | 'BOM_IMPORT'
    | 'UOM_CONVERSION'
    | 'RATE_RESOLUTION'
    | 'ORDER_WEIGHTING'
    | 'RECALCULATION'
    | 'REPOSITORY_HYDRATION'
    | 'IMMUTABILITY_PRESERVATION';
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const EPS = 1e-4;
function approxEq(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

async function setupSeededDb(dbName: string) {
  const customIDB = new IDBFactory();
  const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, dbName);
  const repos = createRepositories(db);
  const costingBom = createCostingBomService(db);
  await db.open();
  await repos.system.initializeAndSeedIfEmpty();
  return { customIDB, db, repos, costingBom };
}

function makeMaterial(
  overrides: Partial<MaterialEntity>
): Omit<MaterialEntity, 'createdAt' | 'updatedAt'> {
  return {
    id: 'MAT-4C1-TEST',
    materialCode: 'C41-TEST-01',
    name: 'Stage 4C.1 Test Material',
    category: 'Knitted Fabric',
    spec: '200 GSM · 160cm Width',
    unit: 'kg',
    reorderPoint: 100,
    warehouseLocation: 'Zone C-1',
    supplierName: 'Test Mill',
    isSimulated: true,
    ...overrides,
  };
}

export async function runPhase3AStage4C1Tests(): Promise<{
  allPassed: boolean;
  results: Phase3AStage4C1TestResult[];
}> {
  const results: Phase3AStage4C1TestResult[] = [];

  // =========================================================================
  // Test 1: BOM Import & Category Mapping
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_01_ImportMap');

    // Add a LABEL and PACKAGING item on STY-01 v1 to test all 5 BOM categories
    await repos.master.createBomItem({
      id: 'BOM-4C1-LBL',
      styleId: 'STY-01',
      materialId: 'MAT-05',
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'LABEL',
      consumptionPerGarment: 1,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 2,
      placement: 'Main Woven Neck Label',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });
    await repos.master.createBomItem({
      id: 'BOM-4C1-PKG',
      styleId: 'STY-01',
      materialId: 'MAT-08',
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'PACKAGING',
      consumptionPerGarment: 1,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 1,
      placement: 'Individual Garment Polybag',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-01',
      currency: 'USD',
      bomVersion: 1,
    });

    const byBomId = new Map(imported.lineItems.map((li) => [li.bomItemId, li]));
    const pureMapChecks =
      mapBomCategoryToCostCategory('FABRIC') === 'FABRIC' &&
      mapBomCategoryToCostCategory('TRIM') === 'TRIMS' &&
      mapBomCategoryToCostCategory('LABEL') === 'TRIMS' &&
      mapBomCategoryToCostCategory('THREAD') === 'THREAD_CONSUMABLES' &&
      mapBomCategoryToCostCategory('PACKAGING') === 'PACKING' &&
      mapBomCategoryToCostCategory(undefined, 'Woven Fabric') === 'FABRIC' &&
      mapBomCategoryToCostCategory(undefined, 'Packaging') === 'PACKING' &&
      mapBomCategoryToCostCategory(undefined, undefined) === 'OTHER';

    const passed =
      pureMapChecks &&
      imported.mode === 'STYLE' &&
      imported.bomVersionUsed === 1 &&
      imported.lineItems.length === 5 &&
      byBomId.get('BOM-01')?.category === 'FABRIC' &&
      byBomId.get('BOM-02')?.category === 'FABRIC' &&
      byBomId.get('BOM-03')?.category === 'THREAD_CONSUMABLES' &&
      byBomId.get('BOM-4C1-LBL')?.category === 'TRIMS' &&
      byBomId.get('BOM-4C1-PKG')?.category === 'PACKING' &&
      imported.lineItems.every((li) => li.sourceType === 'BOM_IMPORT' && li.costPerGarment === undefined);

    results.push({
      testNumber: 1,
      category: 'BOM_IMPORT',
      name: 'BOM Import & Component-to-Costing Category Mapping',
      passed,
      message: passed
        ? 'Imported 5 active STY-01 v1 BOM items and mapped FABRIC/TRIM/LABEL/THREAD/PACKAGING + material fallbacks accurately.'
        : `Import/mapping mismatch: count=${imported.lineItems.length}, pureMapChecks=${pureMapChecks}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 1,
      category: 'BOM_IMPORT',
      name: 'BOM Import & Component-to-Costing Category Mapping',
      passed: false,
      message: `Test 1 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 2: Consumption, Basis, UOM, Wastage & Linkage Preservation
  // =========================================================================
  try {
    const { db, costingBom } = await setupSeededDb('TestDB_S4C1_02_Preservation');

    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-01',
      currency: 'USD',
    });

    const bom01 = imported.lineItems.find((l) => l.bomItemId === 'BOM-01');
    const bom02 = imported.lineItems.find((l) => l.bomItemId === 'BOM-02');
    const bom03 = imported.lineItems.find((l) => l.bomItemId === 'BOM-03');

    const passed =
      bom01 !== undefined &&
      bom01.materialId === 'MAT-02' &&
      bom01.materialCode === 'RAW-FLC-02' &&
      bom01.consumptionPerGarment === 0.48 &&
      bom01.consumptionBasis === 'PER_PIECE' &&
      bom01.consumptionUnit === 'kg' &&
      bom01.stockUnit === 'kg' &&
      bom01.wastagePercent === 5 &&
      bom02 !== undefined &&
      bom02.materialId === 'MAT-03' &&
      bom02.consumptionPerGarment === 0.08 &&
      bom02.wastagePercent === 4 &&
      bom03 !== undefined &&
      bom03.materialId === 'MAT-07' &&
      bom03.consumptionPerGarment === 0.02 &&
      bom03.consumptionBasis === 'PER_DOZEN' &&
      bom03.consumptionUnit === 'cones' &&
      bom03.stockUnit === 'cones' &&
      bom03.wastagePercent === 3;

    results.push({
      testNumber: 2,
      category: 'BOM_IMPORT',
      name: 'Consumption, Basis, UOM, Wastage & BOM/Material ID Preservation',
      passed,
      message: passed
        ? 'Preserved exact consumptionPerGarment, PER_PIECE/PER_DOZEN basis, consumptionUnit, stockUnit, wastagePercent, materialId, materialCode, and bomItemId across STY-01.'
        : `Field preservation mismatch: bom01=${JSON.stringify(bom01)}, bom03=${JSON.stringify(bom03)}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 2,
      category: 'BOM_IMPORT',
      name: 'Consumption, Basis, UOM, Wastage & BOM/Material ID Preservation',
      passed: false,
      message: `Test 2 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 3: UOM Conversion (Seeded BOM-08 pcs->gross, BOM-03 PER_DOZEN & meters->kg via uomAttributes)
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_03_UomConv');

    // Part A: Seeded STY-03 has BOM-08 (2 pcs/garment, 2% wastage -> MAT-06 stock unit 'gross' = 144 pcs)
    // Expected gross in gross-units: (2 * 1.02) / 144 = 0.0141666667 gross
    // At $14.40 / gross => costPerGarment = 0.0141666667 * 14.40 = $0.2040
    const sty03Import = await costingBom.importBomToCostingLines({
      styleId: 'STY-03',
      currency: 'USD',
      rateOverrides: {
        'MAT-04': 3.5, // meters
        'MAT-05': 0.85, // pcs
        'MAT-06': 14.4, // gross
      },
    });

    const sty03Calc = calculateCostSheet({
      currency: 'USD',
      lineItems: sty03Import.lineItems,
      cmt: { method: 'DIRECT_CMT', directCmtCost: 3.1 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.85 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 14.5,
    });

    const btnLine = sty03Calc.calculatedLineItems.find((l) => l.bomItemId === 'BOM-08');
    // BOM-06: 1.45 m * 1.06 * $3.50 = $5.3795
    // BOM-07: 1.0 pc * 1.01 * $0.85 = $0.8585
    // BOM-08: (2.0 * 1.02 / 144) * $14.40 = $0.2040
    const expectedBtnCost = ((2 * 1.02) / 144) * 14.4; // 0.204
    const expectedFabricCost = 1.45 * 1.06 * 3.5; // 5.3795
    const expectedZipCost = 1.0 * 1.01 * 0.85; // 0.8585

    // Part B: Custom fabric material with meters -> kg conversion via uomAttributes (200 GSM, 150cm width => 0.3 kg/m)
    // Consumption: 1.2 meters/garment, 5% wastage => 1.26 m => 1.26 * 0.3 = 0.378 kg => at $10/kg = $3.7800
    await repos.inventory.createMaterial(
      makeMaterial({
        id: 'MAT-4C1-GSM',
        materialCode: 'C41-GSM-200',
        name: '200 GSM 150cm Jersey',
        unit: 'kg',
        standardUnitCost: 10.0,
        costCurrency: 'USD',
        uomAttributes: { gsm: 200, usableWidthCm: 150 },
      })
    );
    await repos.master.createBomItem({
      id: 'BOM-4C1-GSM',
      styleId: 'STY-02',
      materialId: 'MAT-4C1-GSM',
      bomVersion: 2,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 1.2,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'meters',
      wastagePercent: 5,
      placement: 'Body Shell (Linear Meters)',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const sty02V2Import = await costingBom.importBomToCostingLines({
      styleId: 'STY-02',
      currency: 'USD',
      bomVersion: 2,
    });
    const sty02V2Calc = calculateCostSheet({
      currency: 'USD',
      lineItems: sty02V2Import.lineItems,
      cmt: { method: 'DIRECT_CMT', directCmtCost: 1.0 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.25 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 8.0,
    });
    const gsmLine = sty02V2Calc.calculatedLineItems.find((l) => l.bomItemId === 'BOM-4C1-GSM');

    // Part C: Seeded STY-01 BOM-03 PER_DOZEN (0.02 cones/dozen, 3% wastage, at $6.00/cone => (0.02/12)*1.03*6 = $0.0103)
    const sty01Import = await costingBom.importBomToCostingLines({
      styleId: 'STY-01',
      currency: 'USD',
      rateOverrides: { 'MAT-02': 8.0, 'MAT-03': 9.5, 'MAT-07': 6.0 },
    });
    const sty01Calc = calculateCostSheet({
      currency: 'USD',
      lineItems: sty01Import.lineItems,
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 11.5,
    });
    const threadLine = sty01Calc.calculatedLineItems.find((l) => l.bomItemId === 'BOM-03');
    const expectedThreadCost = (0.02 / 12) * 1.03 * 6.0; // 0.0103

    const passed =
      sty03Import.readyForCalculation &&
      btnLine !== undefined &&
      approxEq(btnLine.costPerGarment, expectedBtnCost) &&
      approxEq(sty03Calc.fabricCost, expectedFabricCost) &&
      approxEq(sty03Calc.trimsCost, expectedZipCost + expectedBtnCost) &&
      sty02V2Import.readyForCalculation &&
      gsmLine !== undefined &&
      approxEq(gsmLine.costPerGarment, 3.78) &&
      gsmLine.uomAttributesSnapshot?.gsm === 200 &&
      gsmLine.uomAttributesSnapshot?.usableWidthCm === 150 &&
      threadLine !== undefined &&
      approxEq(threadLine.costPerGarment, expectedThreadCost);

    results.push({
      testNumber: 3,
      category: 'UOM_CONVERSION',
      name: 'UOM Conversion Accuracy (pcs->gross, PER_DOZEN & meters->kg with uomAttributes)',
      passed,
      message: passed
        ? `Verified BOM-08 pcs->gross ($${btnLine?.costPerGarment}), BOM-03 PER_DOZEN ($${threadLine?.costPerGarment}), and meters->kg 200 GSM/150cm ($${gsmLine?.costPerGarment}).`
        : `UOM conversion mismatch: btn=${btnLine?.costPerGarment}, gsm=${gsmLine?.costPerGarment}, thread=${threadLine?.costPerGarment}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 3,
      category: 'UOM_CONVERSION',
      name: 'UOM Conversion Accuracy (pcs->gross, PER_DOZEN & meters->kg with uomAttributes)',
      passed: false,
      message: `Test 3 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 4: Matching Material Currency & Standard Rate Retrieval
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_04_MatchedRate');

    await repos.inventory.createMaterial(
      makeMaterial({
        id: 'MAT-4C1-USD',
        materialCode: 'C41-USD-01',
        name: 'Configured USD Interlock Fabric',
        unit: 'kg',
        standardUnitCost: 7.25,
        costCurrency: 'USD',
      })
    );
    await repos.master.createBomItem({
      id: 'BOM-4C1-USD',
      styleId: 'STY-02',
      materialId: 'MAT-4C1-USD',
      bomVersion: 3,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 0.3,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'kg',
      wastagePercent: 5,
      placement: 'Interlock Body',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-02',
      currency: 'usd', // lowercase normalized to USD
      bomVersion: 3,
    });

    const line = imported.lineItems[0];
    const preview = imported.linePreviews[0];

    const passed =
      imported.currency === 'USD' &&
      imported.readyForCalculation === true &&
      imported.rateIssues.length === 0 &&
      line.unitPrice === 7.25 &&
      line.masterUnitCostSnapshot === 7.25 &&
      line.masterCostCurrencySnapshot === 'USD' &&
      line.isRateOverridden === false &&
      preview.rateResolution.status === 'MATCHED_MASTER_RATE' &&
      preview.rateResolution.requiresManualRate === false;

    results.push({
      testNumber: 4,
      category: 'RATE_RESOLUTION',
      name: 'Matching Material Currency & Standard Rate Auto-Retrieval',
      passed,
      message: passed
        ? 'Resolved standardUnitCost ($7.25 USD) cleanly with MATCHED_MASTER_RATE, masterUnitCostSnapshot=7.25, isRateOverridden=false, and readyForCalculation=true.'
        : `Rate retrieval failed: ${JSON.stringify(preview?.rateResolution)}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 4,
      category: 'RATE_RESOLUTION',
      name: 'Matching Material Currency & Standard Rate Auto-Retrieval',
      passed: false,
      message: `Test 4 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 5: Missing-Rate & Currency-Mismatch Handling (Never Invents Rates)
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_05_RateIssues');

    // Add an EUR-priced material to STY-02 v4 alongside a seeded unpriced material (MAT-01)
    await repos.inventory.createMaterial(
      makeMaterial({
        id: 'MAT-4C1-EUR',
        materialCode: 'C41-EUR-01',
        name: 'European Organic Rib',
        unit: 'kg',
        standardUnitCost: 11.4,
        costCurrency: 'EUR',
      })
    );
    await repos.master.createBomItem({
      id: 'BOM-4C1-MISS',
      styleId: 'STY-02',
      materialId: 'MAT-01', // seeded material has NO standardUnitCost
      bomVersion: 4,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 0.22,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'kg',
      wastagePercent: 4.5,
      placement: 'Unpriced Jersey Body',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });
    await repos.master.createBomItem({
      id: 'BOM-4C1-MISMATCH',
      styleId: 'STY-02',
      materialId: 'MAT-4C1-EUR', // priced in EUR, costing is in USD
      bomVersion: 4,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 0.04,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'kg',
      wastagePercent: 3,
      placement: 'EUR Neckband Rib',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-02',
      currency: 'USD',
      bomVersion: 4,
    });

    const missingLine = imported.lineItems.find((l) => l.bomItemId === 'BOM-4C1-MISS');
    const mismatchLine = imported.lineItems.find((l) => l.bomItemId === 'BOM-4C1-MISMATCH');
    const missingIssue = imported.rateIssues.find((i) => i.bomItemId === 'BOM-4C1-MISS');
    const mismatchIssue = imported.rateIssues.find((i) => i.bomItemId === 'BOM-4C1-MISMATCH');

    // Verify pure resolver never silently returns 0
    const pureMissing = resolveMaterialRate(
      { id: 'M1', materialCode: 'M1', name: 'M1' },
      'USD'
    );

    const passed =
      imported.readyForCalculation === false &&
      imported.rateIssues.length === 2 &&
      missingLine?.unitPrice === undefined &&
      mismatchLine?.unitPrice === undefined &&
      mismatchLine?.masterUnitCostSnapshot === 11.4 &&
      mismatchLine?.masterCostCurrencySnapshot === 'EUR' &&
      missingIssue?.reason === 'MISSING_MASTER_RATE' &&
      mismatchIssue?.reason === 'CURRENCY_MISMATCH' &&
      mismatchIssue?.masterCostCurrency === 'EUR' &&
      pureMissing.resolvedUnitPrice === undefined &&
      pureMissing.requiresManualRate === true;

    results.push({
      testNumber: 5,
      category: 'RATE_RESOLUTION',
      name: 'Missing Master Rate & Currency Mismatch Detection (No Silent Substitution)',
      passed,
      message: passed
        ? 'Flagged MISSING_MASTER_RATE on unpriced MAT-01 and CURRENCY_MISMATCH (EUR vs USD) on MAT-4C1-EUR with unitPrice=undefined and readyForCalculation=false.'
        : `Rate issue check failed: issues=${JSON.stringify(imported.rateIssues)}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 5,
      category: 'RATE_RESOLUTION',
      name: 'Missing Master Rate & Currency Mismatch Detection (No Silent Substitution)',
      passed: false,
      message: `Test 5 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 6: Manual Rate Override Preservation & Precedence
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_06_Override');

    await repos.inventory.createMaterial(
      makeMaterial({
        id: 'MAT-4C1-OVR',
        materialCode: 'C41-OVR-01',
        name: 'Brushed Twill',
        unit: 'meters',
        standardUnitCost: 4.5,
        costCurrency: 'USD',
      })
    );
    await repos.master.createBomItem({
      id: 'BOM-4C1-OVR-1',
      styleId: 'STY-03',
      materialId: 'MAT-4C1-OVR',
      bomVersion: 2,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 1.2,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'meters',
      wastagePercent: 5,
      placement: 'Main Shell',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });
    await repos.master.createBomItem({
      id: 'BOM-4C1-OVR-2',
      styleId: 'STY-03',
      materialId: 'MAT-4C1-OVR',
      bomVersion: 2,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 0.25,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'meters',
      wastagePercent: 5,
      placement: 'Pocket Bagging',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    // bomItemId override ($5.25) should take precedence over materialId override ($4.90)
    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-03',
      currency: 'USD',
      bomVersion: 2,
      rateOverrides: {
        'MAT-4C1-OVR': 4.9,
        'BOM-4C1-OVR-1': 5.25,
      },
    });

    const line1 = imported.lineItems.find((l) => l.bomItemId === 'BOM-4C1-OVR-1')!;
    const line2 = imported.lineItems.find((l) => l.bomItemId === 'BOM-4C1-OVR-2')!;
    const manualReoverride = applyManualRateOverride(
      { ...line2, costPerGarment: 999 }, // stale value must be cleared
      6.1
    );

    const passed =
      imported.readyForCalculation === true &&
      line1.unitPrice === 5.25 &&
      line1.masterUnitCostSnapshot === 4.5 &&
      line1.masterCostCurrencySnapshot === 'USD' &&
      line1.isRateOverridden === true &&
      line2.unitPrice === 4.9 &&
      line2.masterUnitCostSnapshot === 4.5 &&
      line2.isRateOverridden === true &&
      manualReoverride.unitPrice === 6.1 &&
      manualReoverride.masterUnitCostSnapshot === 4.5 &&
      manualReoverride.isRateOverridden === true &&
      manualReoverride.costPerGarment === undefined;

    results.push({
      testNumber: 6,
      category: 'RATE_RESOLUTION',
      name: 'Manual Rate Override Preservation, Master Snapshot & Precedence',
      passed,
      message: passed
        ? 'Preserved masterUnitCostSnapshot ($4.50 USD) alongside manual overrides ($5.25 bomItemId > $4.90 materialId) with isRateOverridden=true and cleared stale costPerGarment.'
        : `Override check failed: line1=${JSON.stringify(line1)}, line2=${JSON.stringify(line2)}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 6,
      category: 'RATE_RESOLUTION',
      name: 'Manual Rate Override Preservation, Master Snapshot & Precedence',
      passed: false,
      message: `Test 6 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 7: Style-Level BOM Applicability Warnings (Color, Size & Size Consumption Map)
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_07_StyleWarn');

    await repos.master.createBomItem({
      id: 'BOM-4C1-SCOPED',
      styleId: 'STY-01',
      materialId: 'MAT-05',
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'TRIM',
      consumptionPerGarment: 1.0,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 2,
      placement: 'Contrast Half-Zip (Charcoal L/XL)',
      colorScope: 'SPECIFIC',
      applicableColors: ['Washed Charcoal'],
      sizeScope: 'SPECIFIC',
      applicableSizes: ['L', 'XL'],
      sizeConsumptionMap: { XL: 2.0 },
      isMandatory: false,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-01',
      currency: 'USD',
      bomVersion: 1,
      rateOverrides: { 'MAT-02': 8, 'MAT-03': 9, 'MAT-07': 2.5, 'MAT-05': 0.8 },
    });

    const scopedLine = imported.lineItems.find((l) => l.bomItemId === 'BOM-4C1-SCOPED');
    const types = imported.applicabilityWarnings
      .filter((w) => w.bomItemId === 'BOM-4C1-SCOPED')
      .map((w) => w.type);

    const passed =
      imported.mode === 'STYLE' &&
      scopedLine !== undefined &&
      scopedLine.consumptionPerGarment === 1.0 && // uses base consumption at style level
      types.includes('COLOR_SPECIFIC') &&
      types.includes('SIZE_SPECIFIC') &&
      types.includes('SIZE_CONSUMPTION_OVERRIDE') &&
      imported.warnings.length >= 3;

    results.push({
      testNumber: 7,
      category: 'BOM_IMPORT',
      name: 'Style-Level BOM Applicability Warnings (Colour, Size & Size Overrides)',
      passed,
      message: passed
        ? 'Style-level import used base consumption (1.0 pcs) and emitted explicit COLOR_SPECIFIC, SIZE_SPECIFIC, and SIZE_CONSUMPTION_OVERRIDE warnings.'
        : `Applicability warnings mismatch: types=${JSON.stringify(types)}, cons=${scopedLine?.consumptionPerGarment}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 7,
      category: 'BOM_IMPORT',
      name: 'Style-Level BOM Applicability Warnings (Colour, Size & Size Overrides)',
      passed: false,
      message: `Test 7 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 8: Order-Specific Weighted Colour/Size Consumption (Reusing bomCalculator)
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_08_OrderWeight');

    // ORD-01 has 14,000 pcs Washed Charcoal: XS=1500, S=3500, M=4500, L=3000, XL=1500.
    // Add 1 matched scoped BOM item (L=1.0, XL=2.0 -> 3000*1 + 1500*2 = 6000 net pcs; +5% wastage = 6300 gross pcs)
    // Weighted per garment across 14,000 pcs = 6000/14000 = 0.4285714286 net (NOT unweighted average 1.5!)
    // At $0.50/pc => gross cost/garment = (6300 / 14000) * 0.50 = $0.2250 => total order cost = $3,150.00!
    await repos.master.createBomItem({
      id: 'BOM-4C1-ORD-MATCH',
      styleId: 'STY-01',
      materialId: 'MAT-05',
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'TRIM',
      consumptionPerGarment: 1.0,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 5,
      placement: 'Half-Zip Placket (L & XL Only)',
      colorScope: 'SPECIFIC',
      applicableColors: ['Washed Charcoal'],
      sizeScope: 'SPECIFIC',
      applicableSizes: ['L', 'XL'],
      sizeConsumptionMap: { XL: 2.0 },
      isMandatory: false,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    // Add 1 unmatched colour BOM item (Navy Blue -> 0 pcs in ORD-01)
    await repos.master.createBomItem({
      id: 'BOM-4C1-ORD-SKIP',
      styleId: 'STY-01',
      materialId: 'MAT-08',
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'PACKAGING',
      consumptionPerGarment: 1.0,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 0,
      placement: 'Navy Special Hangtag',
      colorScope: 'SPECIFIC',
      applicableColors: ['Navy Blue'],
      sizeScope: 'ALL',
      isMandatory: false,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const rates = { 'MAT-02': 8.0, 'MAT-03': 9.5, 'MAT-07': 6.0, 'MAT-05': 0.5, 'MAT-08': 0.1 };
    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-01',
      orderId: 'ORD-01',
      currency: 'USD',
      rateOverrides: rates,
    });

    // Cross-check directly against bomCalculator.calculateOrderBomRequirements
    const orderItems = await repos.orders.getOrderItems('ORD-01');
    const bomItems = await repos.master.getActiveBomByStyle('STY-01', 1);
    const mats = await repos.inventory.getAllMaterials();
    const materialsById = Object.fromEntries(mats.map((m) => [m.id, m]));
    const directBom = calculateOrderBomRequirements({
      primaryStyleId: 'STY-01',
      orderItems: orderItems.map((i) => ({ color: i.color, size: i.size, quantity: i.quantity })),
      bomItems,
      materialsById,
    });

    const calc = calculateCostSheet({
      currency: 'USD',
      lineItems: imported.lineItems,
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 12.0,
    });

    const zipPreview = imported.linePreviews.find((p) => p.bomItemId === 'BOM-4C1-ORD-MATCH');
    const zipCalcLine = calc.calculatedLineItems.find((l) => l.bomItemId === 'BOM-4C1-ORD-MATCH');
    const zipDirectBom = directBom.lineResults.find((l) => l.bomItemId === 'BOM-4C1-ORD-MATCH');

    const expectedWeightedNet = 6000 / 14000; // 0.4285714286
    const expectedZipCostPerGarment = (6300 / 14000) * 0.5; // 0.225
    const expectedTotalOrderZipCost = (zipDirectBom?.grossRequirementStockUnitExact ?? 0) * 0.5; // 3150

    const passed =
      imported.mode === 'ORDER' &&
      imported.costingBasisQuantity === 14000 &&
      imported.skippedUnmatchedBomItems.length === 1 &&
      imported.skippedUnmatchedBomItems[0].bomItemId === 'BOM-4C1-ORD-SKIP' &&
      zipPreview !== undefined &&
      zipPreview.isWeightedByOrder === true &&
      zipPreview.orderMatchedGarmentPieces === 4500 &&
      zipPreview.orderTotalGarmentPieces === 14000 &&
      approxEq(zipPreview.effectiveConsumptionPerGarment, expectedWeightedNet) &&
      zipCalcLine !== undefined &&
      approxEq(zipCalcLine.costPerGarment, expectedZipCostPerGarment) &&
      approxEq(zipCalcLine.costPerGarment * 14000, expectedTotalOrderZipCost) &&
      approxEq(zipPreview.orderEstimatedMaterialCost ?? 0, 3150);

    results.push({
      testNumber: 8,
      category: 'ORDER_WEIGHTING',
      name: 'Order-Specific Weighted Colour/Size Consumption & Unmatched Scope Exclusion',
      passed,
      message: passed
        ? `ORD-01 weighted L(3000×1)+XL(1500×2)=6000/14000 pcs -> $${zipCalcLine?.costPerGarment}/garment ($3,150 total across 14,000 pcs) and excluded unmatched Navy item cleanly.`
        : `Order weighting mismatch: effCons=${zipPreview?.effectiveConsumptionPerGarment}, cost=${zipCalcLine?.costPerGarment}, skipped=${imported.skippedUnmatchedBomItems.length}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 8,
      category: 'ORDER_WEIGHTING',
      name: 'Order-Specific Weighted Colour/Size Consumption & Unmatched Scope Exclusion',
      passed: false,
      message: `Test 8 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 9: Recalculation After Editing a Consumption-Driven Line (No Stale costPerGarment)
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_09_Recalc');

    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-01',
      currency: 'USD',
      rateOverrides: { 'MAT-02': 8.0, 'MAT-03': 9.5, 'MAT-07': 6.0 },
    });

    // Persist initial DRAFT cost sheet
    const draft = await repos.costing.createCostSheet({
      id: 'CST-4C1-RECALC',
      styleId: 'STY-01',
      bomVersionRef: 1,
      currency: 'USD',
      lineItems: imported.lineItems,
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 12.0,
    });

    // Initial BOM-01 costPerGarment: 0.48 * 1.05 * 8.0 = 4.032
    const initialBom01 = draft.lineItems!.find((l) => l.bomItemId === 'BOM-01')!;

    // Scenario A: Caller naively spreads persisted CostSheetLineItem (carrying stale costPerGarment=4.032!)
    // and changes unitPrice 8.0 -> 10.0 and wastagePercent 5 -> 10 directly into calculateCostSheet
    const naiveEditedLines = draft.lineItems!.map((li) =>
      li.bomItemId === 'BOM-01'
        ? { ...li, unitPrice: 10.0, wastagePercent: 10 }
        : { ...li }
    );
    const directRecalc = calculateCostSheet({
      currency: 'USD',
      lineItems: naiveEditedLines,
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 12.0,
    });
    const directRecalcBom01 = directRecalc.calculatedLineItems.find((l) => l.bomItemId === 'BOM-01')!;
    // Expected: 0.48 * 1.10 * 10.0 = 5.28
    const expectedDirectRecalc = 0.48 * 1.1 * 10.0;

    // Scenario B: Persist edit via CostingRepository.updateDraftCostSheet using updateConsumptionDrivenCostingLine
    // Change consumptionPerGarment 0.48 -> 0.50, wastage 5 -> 8, unitPrice 8 -> 9 => 0.50 * 1.08 * 9 = 4.86
    const repoEditedLines = draft.lineItems!.map((li) =>
      li.bomItemId === 'BOM-01'
        ? updateConsumptionDrivenCostingLine(li, {
            consumptionPerGarment: 0.5,
            wastagePercent: 8,
            unitPrice: 9.0,
          })
        : { ...li }
    );
    const updatedDraft = await repos.costing.updateDraftCostSheet(draft.id, {
      lineItems: repoEditedLines,
    });
    const updatedBom01 = updatedDraft.lineItems!.find((l) => l.bomItemId === 'BOM-01')!;
    const expectedRepoRecalc = 0.5 * 1.08 * 9.0; // 4.86

    const passed =
      approxEq(initialBom01.costPerGarment, 4.032) &&
      approxEq(directRecalcBom01.costPerGarment, expectedDirectRecalc) &&
      approxEq(updatedBom01.costPerGarment, expectedRepoRecalc) &&
      updatedBom01.isRateOverridden === true &&
      !approxEq(updatedBom01.costPerGarment, initialBom01.costPerGarment);

    results.push({
      testNumber: 9,
      category: 'RECALCULATION',
      name: 'Consumption-Driven Line Recalculation (No Stale costPerGarment Leakage)',
      passed,
      message: passed
        ? `Initial $${initialBom01.costPerGarment} recalculated cleanly to $${directRecalcBom01.costPerGarment} (even with stale costPerGarment passed) and $${updatedBom01.costPerGarment} on draft update.`
        : `Recalculation failed: initial=${initialBom01.costPerGarment}, direct=${directRecalcBom01.costPerGarment}, repo=${updatedBom01.costPerGarment}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 9,
      category: 'RECALCULATION',
      name: 'Consumption-Driven Line Recalculation (No Stale costPerGarment Leakage)',
      passed: false,
      message: `Test 9 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 10: Existing Direct-Cost Line Compatibility Alongside BOM Lines
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_10_DirectCost');

    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-01',
      currency: 'USD',
      rateOverrides: { 'MAT-02': 8.0, 'MAT-03': 9.5, 'MAT-07': 6.0 },
    });

    const mixedLines = [
      ...imported.lineItems,
      {
        id: 'LI-MANUAL-PRINT',
        category: 'PRINTING_EMBROIDERY' as const,
        description: '3-Color Chest Screen Print',
        currency: 'USD',
        sourceType: 'MANUAL' as const,
        costPerGarment: 0.65,
      },
      {
        id: 'LI-MANUAL-WASH',
        category: 'WASHING_FINISHING' as const,
        description: 'Silicone Enzyme Wash',
        currency: 'USD',
        sourceType: 'MANUAL' as const,
        costPerGarment: 0.45,
      },
    ];

    const created = await repos.costing.createCostSheet({
      id: 'CST-4C1-MIXED',
      styleId: 'STY-01',
      bomVersionRef: 1,
      currency: 'USD',
      lineItems: mixedLines,
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 13.0,
    });

    // Update FOB only (direct-cost lines and BOM lines must both remain exact)
    const afterFobEdit = await repos.costing.updateDraftCostSheet(created.id, {
      quotedFobPrice: 14.0,
    });

    const printLine = afterFobEdit.lineItems!.find((l) => l.id === 'LI-MANUAL-PRINT');
    const washLine = afterFobEdit.lineItems!.find((l) => l.id === 'LI-MANUAL-WASH');
    const expectedFabric = 0.48 * 1.05 * 8.0 + 0.08 * 1.04 * 9.5; // 4.032 + 0.7904 = 4.8224

    const passed =
      approxEq(created.printingEmbroideryCost ?? 0, 0.65) &&
      approxEq(created.washingFinishingCost ?? 0, 0.45) &&
      approxEq(afterFobEdit.printingEmbroideryCost ?? 0, 0.65) &&
      approxEq(afterFobEdit.washingFinishingCost ?? 0, 0.45) &&
      approxEq(afterFobEdit.fabricCost, expectedFabric) &&
      printLine?.costPerGarment === 0.65 &&
      washLine?.costPerGarment === 0.45;

    results.push({
      testNumber: 10,
      category: 'RECALCULATION',
      name: 'Direct-Cost Line Compatibility Alongside Consumption-Driven BOM Lines',
      passed,
      message: passed
        ? 'Direct-cost manual lines ($0.65 Print, $0.45 Wash) and consumption-driven BOM lines ($4.8224 Fabric) persisted and recalculated accurately together.'
        : `Mixed line mismatch: print=${afterFobEdit.printingEmbroideryCost}, wash=${afterFobEdit.washingFinishingCost}, fabric=${afterFobEdit.fabricCost}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 10,
      category: 'RECALCULATION',
      name: 'Direct-Cost Line Compatibility Alongside Consumption-Driven BOM Lines',
      passed: false,
      message: `Test 10 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 11: Repository Persistence & Automatic Material UOM Hydration (No Caller uomAttributes)
  // =========================================================================
  try {
    const sharedIDB = new IDBFactory();
    const dbName = 'TestDB_S4C1_11_UomHydrate';

    const db1 = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    const repos1 = createRepositories(db1);
    await db1.open();
    await repos1.system.initializeAndSeedIfEmpty();

    // Register material with GSM & usableWidthCm (250 GSM * 160 cm / 100000 = 0.4 kg/m)
    await repos1.inventory.createMaterial(
      makeMaterial({
        id: 'MAT-4C1-HYD',
        materialCode: 'C41-HYD-250',
        name: '250 GSM Heavy Jersey',
        unit: 'kg',
        standardUnitCost: 9.0,
        costCurrency: 'USD',
        uomAttributes: { gsm: 250, usableWidthCm: 160 },
      })
    );
    await repos1.master.createBomItem({
      id: 'BOM-4C1-HYD',
      styleId: 'STY-02',
      materialId: 'MAT-4C1-HYD',
      bomVersion: 2,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 1.0,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'meters',
      wastagePercent: 5,
      placement: 'Body Shell',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    // Call CostingRepository.createCostSheet WITHOUT passing uomAttributes on lineItems:
    // Repository MUST hydrate uomAttributes from db.materials automatically!
    // Expected: 1.0 m * 1.05 * 0.4 kg/m * $9.00/kg = $3.7800
    const created = await repos1.costing.createCostSheet({
      id: 'CST-4C1-HYD',
      styleId: 'STY-02',
      bomVersionRef: 2,
      currency: 'USD',
      lineItems: [
        {
          id: 'LI-HYD-1',
          category: 'FABRIC',
          description: '250 GSM Heavy Jersey — Body Shell',
          currency: 'USD',
          materialId: 'MAT-4C1-HYD',
          bomItemId: 'BOM-4C1-HYD',
          consumptionPerGarment: 1.0,
          consumptionBasis: 'PER_PIECE',
          consumptionUnit: 'meters',
          wastagePercent: 5,
          stockUnit: 'kg',
          unitPrice: 9.0,
          // uomAttributes intentionally omitted to verify CostingRepository hydration!
        },
      ],
      cmt: { method: 'DIRECT_CMT', directCmtCost: 1.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.3 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 7.5,
    });

    // Submit & Approve (both re-validate arithmetic through costingCalculator!)
    await repos1.costing.submitForApproval(created.id);
    const { approved } = await repos1.costing.approveCostSheet(created.id, 'QA Costing Lead');
    db1.close();

    // Reopen DB and verify full persistence including uomAttributesSnapshot
    const db2 = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    const repos2 = createRepositories(db2);
    await db2.open();
    const reloaded = await repos2.costing.getCostSheetById('CST-4C1-HYD');
    const reloadedLine = reloaded?.lineItems?.[0];

    const passed =
      approxEq(created.fabricCost, 3.78) &&
      approved.status === 'APPROVED' &&
      reloaded !== undefined &&
      reloaded.status === 'APPROVED' &&
      approxEq(reloaded.fabricCost, 3.78) &&
      reloadedLine?.uomAttributesSnapshot?.gsm === 250 &&
      reloadedLine?.uomAttributesSnapshot?.usableWidthCm === 160;

    results.push({
      testNumber: 11,
      category: 'REPOSITORY_HYDRATION',
      name: 'Repository Material UOM Hydration, Approval & Persistence Across Reopen',
      passed,
      message: passed
        ? 'CostingRepository automatically hydrated gsm=250/width=160cm for meters->kg ($3.78), passed submit/approve validation, and persisted uomAttributesSnapshot across DB reopen.'
        : `Hydration/persistence failed: fabricCost=${reloaded?.fabricCost}, snapshot=${JSON.stringify(reloadedLine?.uomAttributesSnapshot)}`,
    });
    db2.close();
  } catch (err: any) {
    results.push({
      testNumber: 11,
      category: 'REPOSITORY_HYDRATION',
      name: 'Repository Material UOM Hydration, Approval & Persistence Across Reopen',
      passed: false,
      message: `Test 11 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 12: Existing Cost Sheet History & Post-Approval Immutability Against Master Edits
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_12_Immutability');

    const demoBefore = await repos.costing.getCostSheetById('CST-01');
    if (!demoBefore) throw new Error('Seeded CST-01 not found');

    // Create BOM-backed revision v2 branched from seeded CST-01
    const imported = await costingBom.importBomToCostingLines({
      styleId: 'STY-01',
      currency: 'USD',
      rateOverrides: { 'MAT-02': 8.0, 'MAT-03': 9.5, 'MAT-07': 6.0 },
    });

    const v2Draft = await repos.costing.createRevision('CST-01', {
      newId: 'CST-01-V2-BOM',
      updates: {
        bomVersionRef: 1,
        lineItems: imported.lineItems,
        categoryCosts: {}, // clear legacy residual summary so BOM lines drive costs
        quotedFobPrice: 12.5,
      },
    });
    await repos.costing.submitForApproval(v2Draft.id);
    const { approved: v2Approved, superseded } = await repos.costing.approveCostSheet(
      v2Draft.id,
      'Chief Merchandiser'
    );

    const v2SnapshotBeforeMasterChange = JSON.stringify(v2Approved);

    // Mutate underlying BOM item consumption & material cost AFTER approval
    await repos.master.updateBomItem('BOM-01', { consumptionPerGarment: 0.99 });
    await db.materials.update('MAT-02', { standardUnitCost: 99.99, costCurrency: 'USD' });

    const v2Reloaded = await repos.costing.getCostSheetById(v2Approved.id);
    const cst01After = await repos.costing.getCostSheetById('CST-01');

    const passed =
      superseded.length === 1 &&
      superseded[0].id === 'CST-01' &&
      cst01After?.status === 'SUPERSEDED' &&
      cst01After.fabricCost === demoBefore.fabricCost &&
      cst01After.quotedFobPrice === demoBefore.quotedFobPrice &&
      cst01After.approvedBy === demoBefore.approvedBy &&
      v2Reloaded !== undefined &&
      JSON.stringify(v2Reloaded) === v2SnapshotBeforeMasterChange;

    results.push({
      testNumber: 12,
      category: 'IMMUTABILITY_PRESERVATION',
      name: 'Historical Cost Sheet Immutability & Seeded Revision Preservation',
      passed,
      message: passed
        ? 'Approving BOM-backed v2 atomically superseded CST-01 without altering its historical values; subsequent BOM & material rate edits left approved v2 100% immutable.'
        : `Immutability check failed: cst01Status=${cst01After?.status}, v2Unchanged=${JSON.stringify(v2Reloaded) === v2SnapshotBeforeMasterChange}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 12,
      category: 'IMMUTABILITY_PRESERVATION',
      name: 'Historical Cost Sheet Immutability & Seeded Revision Preservation',
      passed: false,
      message: `Test 12 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 13: Strict Read-Only Import & Complete Preservation of All Database Records
  // =========================================================================
  try {
    const { db, repos, costingBom } = await setupSeededDb('TestDB_S4C1_13_DbPreserve');

    const countsBefore = await repos.system.getTableCounts();
    const costSheetsBefore = await db.cost_sheets.toArray();
    const materialsBefore = await db.materials.toArray();
    const bomItemsBefore = await db.bom_items.toArray();
    const balancesBefore = await repos.inventory.getAllStockBalances();

    // Execute style-level and order-level BOM imports across all 3 seeded styles/orders
    await costingBom.importBomToCostingLines({ styleId: 'STY-01', currency: 'USD' });
    await costingBom.importBomToCostingLines({ styleId: 'STY-02', currency: 'USD' });
    await costingBom.importBomToCostingLines({ styleId: 'STY-03', currency: 'USD' });
    await costingBom.importBomToCostingLines({ styleId: 'STY-01', orderId: 'ORD-01', currency: 'USD' });
    await costingBom.importBomToCostingLines({ styleId: 'STY-02', orderId: 'ORD-02', currency: 'USD' });
    await costingBom.importBomToCostingLines({ styleId: 'STY-03', orderId: 'ORD-03', currency: 'USD' });

    const countsAfter = await repos.system.getTableCounts();
    const costSheetsAfter = await db.cost_sheets.toArray();
    const materialsAfter = await db.materials.toArray();
    const bomItemsAfter = await db.bom_items.toArray();
    const balancesAfter = await repos.inventory.getAllStockBalances();

    const passed =
      JSON.stringify(countsBefore) === JSON.stringify(countsAfter) &&
      JSON.stringify(costSheetsBefore) === JSON.stringify(costSheetsAfter) &&
      JSON.stringify(materialsBefore) === JSON.stringify(materialsAfter) &&
      JSON.stringify(bomItemsBefore) === JSON.stringify(bomItemsAfter) &&
      JSON.stringify(balancesBefore) === JSON.stringify(balancesAfter);

    results.push({
      testNumber: 13,
      category: 'IMMUTABILITY_PRESERVATION',
      name: 'Strict Read-Only BOM Costing Import & Complete IndexedDB Preservation',
      passed,
      message: passed
        ? 'Verified zero mutations across all 15 entity stores, all 3 demo cost sheets, all 8 materials, BOM items, and inventory stock balances.'
        : 'Unexpected database mutation detected during BOM costing import.',
      details: { countsBefore, countsAfter },
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 13,
      category: 'IMMUTABILITY_PRESERVATION',
      name: 'Strict Read-Only BOM Costing Import & Complete IndexedDB Preservation',
      passed: false,
      message: `Test 13 threw error: ${err.message}`,
    });
  }

  const allPassed = results.length === 13 && results.every((r) => r.passed);
  return { allPassed, results };
}

// CLI direct runner
if (
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1]?.includes('runPhase3AStage4C1Tests')
) {
  runPhase3AStage4C1Tests().then((output) => {
    console.log('\n===============================================================');
    console.log('STITCHPILOT ENTERPRISE — PHASE 3A STAGE 4C.1 TEST SUITE');
    console.log('===============================================================\n');
    output.results.forEach((r) => {
      console.log(`[${r.passed ? 'PASS' : 'FAIL'}] Test ${r.testNumber} (${r.category}): ${r.name}`);
      console.log(`  ${r.message}\n`);
    });
    console.log('---------------------------------------------------------------');
    console.log(
      `Summary: ${output.allPassed ? `ALL ${output.results.length} STAGE 4C.1 TESTS PASSED` : 'SOME TESTS FAILED'} (${
        output.results.filter((r) => r.passed).length
      }/${output.results.length})`
    );
    console.log('===============================================================\n');
    if (!output.allPassed) {
      process.exit(1);
    }
  });
}
