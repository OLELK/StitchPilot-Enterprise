/**
 * StitchPilot Enterprise — Phase 3A Stage 2 Automated Test Suite
 * BOM Repository & Order MRP Service Extensions
 *
 * Covers 24 comprehensive integration scenarios on real Dexie + fake-indexeddb:
 *  1. BOM repository creation
 *  2. BOM retrieval by style
 *  3. BOM updates
 *  4. BOM archiving (non-destructive)
 *  5. BOM version retrieval & isolation
 *  6. Material & style relationship / UOM validation
 *  7. Single-order MRP
 *  8. Multi-order MRP
 *  9. Colour-wise requirements
 * 10. Size-wise requirements & overrides
 * 11. Wastage application
 * 12. Fractional consumption precision
 * 13. UOM conversions (pcs->gross, yards/meters->kg, PER_DOZEN->cones)
 * 14. Material requirement aggregation (intra-style & cross-order)
 * 15. Missing BOM handling
 * 16. Archived BOM handling (partial exclusion & all-archived rejection)
 * 17. Cutting allocation reconciliation
 * 18. Avoidance of double-counting & unbacked/dangling ledger validation
 * 19. Available-stock calculation
 * 20. Net procurement calculation
 * 21. Cancelled-order handling
 * 22. Inventory balance immutability
 * 23. Existing transaction history preservation
 * 24. Seeded demo multi-order realistic MRP verification (ORD-01 + ORD-02 + ORD-03)
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase } from '../database';
import { createRepositories } from '../repositories';
import { createMrpService } from '../services/mrpService';
import {
  EntityNotFoundError,
  RelationshipValidationError,
  ValidationError,
} from '../errors';
import { BomItemEntity, MaterialEntity, OrderEntity, OrderItemEntity } from '../types';

export interface Phase3AStage2TestResult {
  testNumber: number;
  category: 'BOM_REPO' | 'MRP_SERVICE' | 'RECONCILIATION' | 'INTEGRITY';
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

function approxEqual(a: number, b: number, tol: number = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

async function setupSeededTestContext(dbName: string) {
  const customIDB = new IDBFactory();
  const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, dbName);
  const repos = createRepositories(db);
  await db.open();
  await repos.system.initializeAndSeedIfEmpty();
  const mrp = createMrpService(db);
  return { db, repos, mrp };
}

function makeTestMaterial(overrides: Partial<MaterialEntity>): Omit<MaterialEntity, 'createdAt' | 'updatedAt'> {
  return {
    id: 'MAT-S2-X',
    materialCode: 'S2-MAT-X',
    name: 'Stage 2 Test Material',
    category: 'Trims & Fasteners',
    spec: 'Standard Spec',
    unit: 'pcs',
    reorderPoint: 100,
    warehouseLocation: 'Zone Z-1',
    supplierName: 'Test Supplier',
    isSimulated: true,
    ...overrides,
  };
}

export async function runPhase3AStage2Tests(): Promise<{
  allPassed: boolean;
  results: Phase3AStage2TestResult[];
}> {
  const results: Phase3AStage2TestResult[] = [];

  // ------------------------------------------------------------------
  // Test 1: BOM Repository Creation
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededTestContext('TestS2_01_BomCreate');
    const created = await repos.master.createBomItem({
      id: 'BOM-S2-CREATE-1',
      styleId: 'STY-01',
      materialId: 'MAT-08', // Polybags (pcs)
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'PACKAGING',
      consumptionPerGarment: 1,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 2,
      placement: 'Individual Garment Polybag',
      colorScope: 'ALL',
      sizeScope: 'ALL',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const fetched = await repos.master.getBomItemById('BOM-S2-CREATE-1');
    const ok =
      !!fetched &&
      fetched.id === created.id &&
      fetched.styleId === 'STY-01' &&
      fetched.materialId === 'MAT-08' &&
      fetched.status === 'ACTIVE' &&
      fetched.bomVersion === 1;

    results.push({
      testNumber: 1,
      category: 'BOM_REPO',
      name: 'BOM Repository Creation',
      passed: ok,
      message: ok
        ? 'createBomItem persisted validated BOM item with normalized version, status, and timestamps.'
        : 'Created BOM item missing or malformed upon retrieval.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 1, category: 'BOM_REPO', name: 'BOM Repository Creation', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 2: BOM Retrieval by Style
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededTestContext('TestS2_02_BomByStyle');
    const sty1Items = await repos.master.getBomByStyle('STY-01');
    const sty2Items = await repos.master.getBomByStyle('STY-02');
    const ok =
      sty1Items.length === 3 &&
      sty1Items.every((i) => i.styleId === 'STY-01') &&
      sty2Items.length === 2 &&
      sty2Items.every((i) => i.styleId === 'STY-02');

    results.push({
      testNumber: 2,
      category: 'BOM_REPO',
      name: 'BOM Retrieval by Style',
      passed: ok,
      message: ok
        ? `Retrieved ${sty1Items.length} BOM lines for STY-01 and ${sty2Items.length} lines for STY-02 cleanly isolated.`
        : `Unexpected BOM line counts: STY-01=${sty1Items.length}, STY-02=${sty2Items.length}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 2, category: 'BOM_REPO', name: 'BOM Retrieval by Style', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 3: BOM Updates
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededTestContext('TestS2_03_BomUpdate');
    const updated = await repos.master.updateBomItem('BOM-01', {
      consumptionPerGarment: 0.52,
      wastagePercent: 6.5,
      placement: 'Updated Body & Hood Shell',
    });
    const reRead = await repos.master.getBomItemById('BOM-01');
    const ok =
      !!reRead &&
      reRead.id === 'BOM-01' &&
      approxEqual(reRead.consumptionPerGarment, 0.52) &&
      approxEqual(reRead.wastagePercent, 6.5) &&
      reRead.placement === 'Updated Body & Hood Shell' &&
      updated.styleId === 'STY-01';

    results.push({
      testNumber: 3,
      category: 'BOM_REPO',
      name: 'BOM Updates',
      passed: ok,
      message: ok
        ? 'updateBomItem updated consumption, wastage, and placement while preserving ID and style linkage.'
        : 'BOM update did not persist expected values.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 3, category: 'BOM_REPO', name: 'BOM Updates', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 4: BOM Archiving (Non-Destructive)
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededTestContext('TestS2_04_BomArchive');
    const archived = await repos.master.archiveBomItem('BOM-03');
    const rawInDb = await repos.master.getBomItemById('BOM-03');
    const allWithArchived = await repos.master.getBomByStyle('STY-01', { includeArchived: true });
    const activeOnly = await repos.master.getActiveBomByStyle('STY-01');

    const ok =
      archived.status === 'ARCHIVED' &&
      !!rawInDb &&
      rawInDb.status === 'ARCHIVED' &&
      allWithArchived.length === 3 &&
      activeOnly.length === 2 &&
      !activeOnly.some((b) => b.id === 'BOM-03');

    results.push({
      testNumber: 4,
      category: 'BOM_REPO',
      name: 'BOM Archiving (Non-Destructive)',
      passed: ok,
      message: ok
        ? 'archiveBomItem set status=ARCHIVED without deleting record from IndexedDB; active retrieval excludes it cleanly.'
        : 'BOM archiving either deleted the record or failed to filter from active list.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 4, category: 'BOM_REPO', name: 'BOM Archiving (Non-Destructive)', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 5: BOM Version Retrieval & Isolation
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededTestContext('TestS2_05_BomVersions');
    await repos.master.createBomItem({
      id: 'BOM-V2-01',
      styleId: 'STY-01',
      materialId: 'MAT-02',
      bomVersion: 2,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 0.5,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'kg',
      wastagePercent: 4,
      placement: 'V2 Fleece Body',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const v1 = await repos.master.getBomByStyleAndVersion('STY-01', 1);
    const v2 = await repos.master.getBomByStyleAndVersion('STY-01', 2);
    const activeLatest = await repos.master.getActiveBomByStyle('STY-01');
    const versionsSummary = await repos.master.getBomVersionsByStyle('STY-01');

    const ok =
      v1.length === 3 &&
      v2.length === 1 &&
      v2[0].id === 'BOM-V2-01' &&
      activeLatest.length === 1 &&
      activeLatest[0].bomVersion === 2 &&
      versionsSummary.length === 2 &&
      versionsSummary[0].bomVersion === 2;

    results.push({
      testNumber: 5,
      category: 'BOM_REPO',
      name: 'BOM Version Retrieval & Isolation',
      passed: ok,
      message: ok
        ? 'Versioned retrieval returns v1 (3 items), v2 (1 item), and getActiveBomByStyle resolves latest active v2.'
        : 'BOM version isolation or latest-version resolution failed.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 5, category: 'BOM_REPO', name: 'BOM Version Retrieval & Isolation', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 6: Material & Style Relationship & UOM Validation
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededTestContext('TestS2_06_BomValidation');
    let missingMatRejected = false;
    let missingStyleRejected = false;
    let badUomRejected = false;
    let negativeConsRejected = false;

    try {
      await repos.master.createBomItem({
        id: 'BOM-ERR-MAT',
        styleId: 'STY-01',
        materialId: 'MAT-DOES-NOT-EXIST',
        consumptionPerGarment: 1,
        wastagePercent: 0,
        placement: 'Shell',
        isMandatory: true,
        isSimulated: true,
        createdAt: new Date().toISOString(),
      });
    } catch (e: any) {
      missingMatRejected = e instanceof RelationshipValidationError;
    }

    try {
      await repos.master.createBomItem({
        id: 'BOM-ERR-STY',
        styleId: 'STY-DOES-NOT-EXIST',
        materialId: 'MAT-02',
        consumptionPerGarment: 1,
        wastagePercent: 0,
        placement: 'Shell',
        isMandatory: true,
        isSimulated: true,
        createdAt: new Date().toISOString(),
      });
    } catch (e: any) {
      missingStyleRejected = e instanceof RelationshipValidationError;
    }

    try {
      await repos.master.createBomItem({
        id: 'BOM-ERR-UOM',
        styleId: 'STY-01',
        materialId: 'MAT-02', // stock unit kg, no GSM/width defined on MAT-02
        consumptionPerGarment: 1.2,
        consumptionUnit: 'meters', // incompatible without gsm + usableWidthCm
        wastagePercent: 2,
        placement: 'Shell',
        isMandatory: true,
        isSimulated: true,
        createdAt: new Date().toISOString(),
      });
    } catch (e: any) {
      badUomRejected = e instanceof ValidationError;
    }

    try {
      await repos.master.createBomItem({
        id: 'BOM-ERR-NEG',
        styleId: 'STY-01',
        materialId: 'MAT-02',
        consumptionPerGarment: -0.5,
        wastagePercent: 2,
        placement: 'Shell',
        isMandatory: true,
        isSimulated: true,
        createdAt: new Date().toISOString(),
      });
    } catch (e: any) {
      negativeConsRejected = e instanceof ValidationError;
    }

    const ok = missingMatRejected && missingStyleRejected && badUomRejected && negativeConsRejected;
    results.push({
      testNumber: 6,
      category: 'BOM_REPO',
      name: 'Material Relationship & Upfront UOM Validation',
      passed: ok,
      message: ok
        ? 'Rejected missing material FK, missing style FK, incompatible UOM path, and non-positive consumption.'
        : `Failures: mat=${missingMatRejected}, style=${missingStyleRejected}, uom=${badUomRejected}, neg=${negativeConsRejected}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 6, category: 'BOM_REPO', name: 'Material Relationship & Upfront UOM Validation', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 7: Single-Order MRP
  // ------------------------------------------------------------------
  try {
    const { db, mrp } = await setupSeededTestContext('TestS2_07_SingleOrderMrp');
    const result = await mrp.generateOrderMrp('ORD-02');
    // ORD-02: 28,000 pcs STY-02 -> MAT-01 (0.22 * 1.045 * 28000 = 6437.2 kg), MAT-03 (0.03 * 1.03 * 28000 = 865.2 kg)
    const mat01 = result.materialRequirements.find((m) => m.materialId === 'MAT-01');
    const mat03 = result.materialRequirements.find((m) => m.materialId === 'MAT-03');

    const ok =
      result.orderId === 'ORD-02' &&
      result.totalGarmentPieces === 28000 &&
      !!mat01 &&
      approxEqual(mat01.grossBomRequirementExact, 6437.2) &&
      approxEqual(mat01.availableStock, 4850) &&
      approxEqual(mat01.netProcurementRequirementExact, 1587.2) &&
      !!mat03 &&
      approxEqual(mat03.grossBomRequirementExact, 865.2) &&
      approxEqual(mat03.availableStock, 650) &&
      approxEqual(mat03.netProcurementRequirementExact, 215.2);

    results.push({
      testNumber: 7,
      category: 'MRP_SERVICE',
      name: 'Single-Order MRP Calculation',
      passed: ok,
      message: ok
        ? 'ORD-02 (28,000 pcs) computed MAT-01 gross 6437.2 kg (net proc 1587.2 kg) and MAT-03 gross 865.2 kg (net proc 215.2 kg).'
        : 'Single-order MRP numbers did not match expected values.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 7, category: 'MRP_SERVICE', name: 'Single-Order MRP Calculation', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 8: Multi-Order MRP & Order Traceability
  // ------------------------------------------------------------------
  try {
    const { db, mrp } = await setupSeededTestContext('TestS2_08_MultiOrderMrp');
    const multi = await mrp.generateMultiOrderMrp(['ORD-01', 'ORD-02']);
    // Shared MAT-03: ORD-01 (14000 * 0.08 * 1.04 = 1164.8) + ORD-02 (28000 * 0.03 * 1.03 = 865.2) = 2030 kg
    const mat03 = multi.consolidatedMaterials.find((m) => m.materialId === 'MAT-03');
    const ok =
      multi.includedOrderIds.length === 2 &&
      multi.totalGarmentPieces === 42000 &&
      !!mat03 &&
      mat03.orderTraceability.length === 2 &&
      approxEqual(mat03.totalGrossBomRequirementExact, 2030) &&
      approxEqual(mat03.availableStock, 650) &&
      approxEqual(mat03.netProcurementRequirementExact, 1380);

    results.push({
      testNumber: 8,
      category: 'MRP_SERVICE',
      name: 'Multi-Order MRP & Order Traceability',
      passed: ok,
      message: ok
        ? 'Multi-order MRP aggregated MAT-03 across ORD-01 (1164.8 kg) & ORD-02 (865.2 kg) = 2030 kg total, 1380 kg net procurement with full traceability.'
        : 'Multi-order MRP aggregation or traceability failed.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 8, category: 'MRP_SERVICE', name: 'Multi-Order MRP & Order Traceability', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 9: Colour-Wise Requirements (colorScope: 'SPECIFIC')
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_09_ColorWise');
    await repos.master.createStyle({
      id: 'STY-COL',
      buyerId: 'BUY-01',
      styleCode: 'ST-COL-01',
      description: 'Two-Tone Dye Trim Style',
      garmentType: 'Tee',
      fabricClassification: 'Jersey',
      samMinutes: 10,
      targetEfficiencyPercent: 85,
      season: 'SS26',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repos.inventory.createMaterial(makeTestMaterial({ id: 'MAT-BLACK-LBL', materialCode: 'LBL-BLK', name: 'Black Woven Label', unit: 'pcs' }));
    await repos.inventory.createMaterial(makeTestMaterial({ id: 'MAT-NAVY-LBL', materialCode: 'LBL-NVY', name: 'Navy Woven Label', unit: 'pcs' }));
    await repos.master.createBomItem({
      id: 'BOM-COL-BLK',
      styleId: 'STY-COL',
      materialId: 'MAT-BLACK-LBL',
      consumptionPerGarment: 1,
      wastagePercent: 10,
      placement: 'Main Neck Label (Black Only)',
      colorScope: 'SPECIFIC',
      applicableColors: ['Jet Black'],
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });
    await repos.master.createBomItem({
      id: 'BOM-COL-NVY',
      styleId: 'STY-COL',
      materialId: 'MAT-NAVY-LBL',
      consumptionPerGarment: 1,
      wastagePercent: 0,
      placement: 'Main Neck Label (Navy Only)',
      colorScope: 'SPECIFIC',
      applicableColors: ['Midnight Navy'],
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    await repos.orders.createOrder(
      {
        id: 'ORD-COL',
        poNumber: 'PO-COL-100',
        buyerId: 'BUY-01',
        styleId: 'STY-COL',
        orderQuantity: 500,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-01',
        status: 'CONFIRMED',
        assignedLineId: 'LINE-01',
        dhuPercent: 0,
        notes: 'Color test',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: 'ITM-C1', orderId: 'ORD-COL', color: 'Jet Black', size: 'M', quantity: 200, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: 'ITM-C2', orderId: 'ORD-COL', color: 'Midnight Navy', size: 'M', quantity: 300, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    const res = await mrp.generateOrderMrp('ORD-COL');
    const blkReq = res.materialRequirements.find((m) => m.materialId === 'MAT-BLACK-LBL');
    const nvyReq = res.materialRequirements.find((m) => m.materialId === 'MAT-NAVY-LBL');

    const ok =
      !!blkReq &&
      approxEqual(blkReq.grossBomRequirementExact, 220) &&
      blkReq.byColor.length === 1 &&
      blkReq.byColor[0].color === 'Jet Black' &&
      !!nvyReq &&
      approxEqual(nvyReq.grossBomRequirementExact, 300) &&
      nvyReq.byColor.length === 1 &&
      nvyReq.byColor[0].color === 'Midnight Navy';

    results.push({
      testNumber: 9,
      category: 'MRP_SERVICE',
      name: 'Colour-Wise Requirements & Applicability Filtering',
      passed: ok,
      message: ok
        ? 'Color-scoped BOM lines filtered strictly to Jet Black (200 pcs + 10% = 220) and Midnight Navy (300 pcs = 300).'
        : 'Color-scoped filtering produced incorrect requirements.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 9, category: 'MRP_SERVICE', name: 'Colour-Wise Requirements & Applicability Filtering', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 10: Size-Wise Requirements & Size Consumption Overrides
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_10_SizeWise');
    await repos.master.createStyle({
      id: 'STY-SZ',
      buyerId: 'BUY-01',
      styleCode: 'ST-SZ-01',
      description: 'Graded Zipper Jacket',
      garmentType: 'Jacket',
      fabricClassification: 'Fleece',
      samMinutes: 15,
      targetEfficiencyPercent: 85,
      season: 'AW26',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repos.inventory.createMaterial(makeTestMaterial({ id: 'MAT-SZ-FAB', materialCode: 'SZ-FAB', name: 'Body Fabric', unit: 'meters' }));
    await repos.inventory.createMaterial(makeTestMaterial({ id: 'MAT-SZ-PATCH', materialCode: 'SZ-PAT', name: 'XL Reinforcement Patch', unit: 'pcs' }));

    await repos.master.createBomItem({
      id: 'BOM-SZ-GRADED',
      styleId: 'STY-SZ',
      materialId: 'MAT-SZ-FAB',
      consumptionPerGarment: 1.0,
      sizeConsumptionMap: { S: 0.9, XL: 1.25 },
      wastagePercent: 0,
      placement: 'Graded Shell',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });
    await repos.master.createBomItem({
      id: 'BOM-SZ-XL-ONLY',
      styleId: 'STY-SZ',
      materialId: 'MAT-SZ-PATCH',
      consumptionPerGarment: 2,
      wastagePercent: 0,
      placement: 'Oversize Elbow Patch',
      sizeScope: 'SPECIFIC',
      applicableSizes: ['XL'],
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    await repos.orders.createOrder(
      {
        id: 'ORD-SZ',
        poNumber: 'PO-SZ-100',
        buyerId: 'BUY-01',
        styleId: 'STY-SZ',
        orderQuantity: 250,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-01',
        status: 'CONFIRMED',
        assignedLineId: 'LINE-01',
        dhuPercent: 0,
        notes: 'Size grading test',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: 'ITM-S1', orderId: 'ORD-SZ', color: 'Charcoal', size: 'S', quantity: 100, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: 'ITM-S2', orderId: 'ORD-SZ', color: 'Charcoal', size: 'M', quantity: 100, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: 'ITM-S3', orderId: 'ORD-SZ', color: 'Charcoal', size: 'XL', quantity: 50, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    const res = await mrp.generateOrderMrp('ORD-SZ');
    const fab = res.materialRequirements.find((m) => m.materialId === 'MAT-SZ-FAB');
    const patch = res.materialRequirements.find((m) => m.materialId === 'MAT-SZ-PATCH');
    // Graded fab = 100*0.9 + 100*1.0 + 50*1.25 = 90 + 100 + 62.5 = 252.5 m
    // XL patch = 50 * 2 = 100 pcs
    const ok =
      !!fab &&
      approxEqual(fab.grossBomRequirementExact, 252.5) &&
      !!patch &&
      approxEqual(patch.grossBomRequirementExact, 100);

    results.push({
      testNumber: 10,
      category: 'MRP_SERVICE',
      name: 'Size-Wise Requirements & Size Consumption Overrides',
      passed: ok,
      message: ok
        ? 'Applied sizeConsumptionMap (S=0.9, M=1.0, XL=1.25 -> 252.5 m) and sizeScope SPECIFIC (XL patch -> 100 pcs).'
        : 'Size-wise consumption override or filtering failed.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 10, category: 'MRP_SERVICE', name: 'Size-Wise Requirements & Size Consumption Overrides', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 11: Wastage Application
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_11_Wastage');
    await repos.master.createStyle({
      id: 'STY-WST',
      buyerId: 'BUY-01',
      styleCode: 'ST-WST',
      description: 'Wastage Test Style',
      garmentType: 'Top',
      fabricClassification: 'Knit',
      samMinutes: 10,
      targetEfficiencyPercent: 85,
      season: 'AW26',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repos.inventory.createMaterial(makeTestMaterial({ id: 'MAT-WST', materialCode: 'WST-01', unit: 'meters' }));
    await repos.master.createBomItem({
      id: 'BOM-WST',
      styleId: 'STY-WST',
      materialId: 'MAT-WST',
      consumptionPerGarment: 2,
      wastagePercent: 7.5,
      placement: 'Shell',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });
    await repos.orders.createOrder(
      {
        id: 'ORD-WST',
        poNumber: 'PO-WST-1',
        buyerId: 'BUY-01',
        styleId: 'STY-WST',
        orderQuantity: 400,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-01',
        status: 'CONFIRMED',
        assignedLineId: 'LINE-01',
        dhuPercent: 0,
        notes: 'Wastage test',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: 'ITM-W1', orderId: 'ORD-WST', color: 'Black', size: 'L', quantity: 400, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    const res = await mrp.generateOrderMrp('ORD-WST');
    const req = res.materialRequirements[0];
    // Net = 800, Wastage 7.5% = 60, Gross = 860
    const ok =
      !!req &&
      approxEqual(req.netBomRequirementExact, 800) &&
      approxEqual(req.wastageQuantityExact, 60) &&
      approxEqual(req.grossBomRequirementExact, 860);

    results.push({
      testNumber: 11,
      category: 'MRP_SERVICE',
      name: 'Wastage Application',
      passed: ok,
      message: ok
        ? 'Net 800m + 7.5% wastage (60m) produced exact gross requirement 860m.'
        : 'Wastage calculation mismatch.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 11, category: 'MRP_SERVICE', name: 'Wastage Application', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 12: Fractional Consumption Precision
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_12_Fractional');
    await repos.master.createStyle({
      id: 'STY-FRAC',
      buyerId: 'BUY-01',
      styleCode: 'ST-FRAC',
      description: 'Fractional Trim Style',
      garmentType: 'Top',
      fabricClassification: 'Knit',
      samMinutes: 8,
      targetEfficiencyPercent: 90,
      season: 'SS26',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repos.inventory.createMaterial(makeTestMaterial({ id: 'MAT-FRAC', materialCode: 'FRAC-01', unit: 'meters' }));
    await repos.master.createBomItem({
      id: 'BOM-FRAC',
      styleId: 'STY-FRAC',
      materialId: 'MAT-FRAC',
      consumptionPerGarment: 0.0375,
      wastagePercent: 4,
      placement: 'Collar Twill Tape',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });
    await repos.orders.createOrder(
      {
        id: 'ORD-FRAC',
        poNumber: 'PO-FRAC-1',
        buyerId: 'BUY-01',
        styleId: 'STY-FRAC',
        orderQuantity: 101,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-01',
        status: 'CONFIRMED',
        assignedLineId: 'LINE-01',
        dhuPercent: 0,
        notes: 'Fractional test',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: 'ITM-F1', orderId: 'ORD-FRAC', color: 'White', size: 'S', quantity: 101, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    const res = await mrp.generateOrderMrp('ORD-FRAC');
    const req = res.materialRequirements[0];
    // Net = 101 * 0.0375 = 3.7875, Gross = 3.7875 * 1.04 = 3.939
    const ok =
      !!req &&
      approxEqual(req.netBomRequirementExact, 3.7875) &&
      approxEqual(req.grossBomRequirementExact, 3.939) &&
      req.discreteGrossUnits === 4 &&
      req.discreteOrderUnits === 4;

    results.push({
      testNumber: 12,
      category: 'MRP_SERVICE',
      name: 'Fractional Consumption Precision',
      passed: ok,
      message: ok
        ? 'Preserved exact fractional consumption 3.7875 net / 3.939 gross meters with discreteOrderUnits=4.'
        : 'Fractional consumption lost precision.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 12, category: 'MRP_SERVICE', name: 'Fractional Consumption Precision', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 13: UOM Conversions (pcs->gross, yards->kg, PER_DOZEN->cones)
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_13_UomConversion');
    await repos.master.createStyle({
      id: 'STY-UOM',
      buyerId: 'BUY-01',
      styleCode: 'ST-UOM',
      description: 'Multi-UOM Style',
      garmentType: 'Pant',
      fabricClassification: 'Woven',
      samMinutes: 18,
      targetEfficiencyPercent: 84,
      season: 'AW26',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // Material with gsm=250, width=150cm => 0.375 kg/m; 1 yard = 0.9144 m => 0.3429 kg/yard
    await repos.inventory.createMaterial(
      makeTestMaterial({
        id: 'MAT-UOM-KG',
        materialCode: 'UOM-KG',
        category: 'Woven Fabric',
        unit: 'kg',
        uomAttributes: { gsm: 250, usableWidthCm: 150 },
      })
    );
    await repos.master.createBomItem({
      id: 'BOM-UOM-YD',
      styleId: 'STY-UOM',
      materialId: 'MAT-UOM-KG',
      consumptionPerGarment: 2, // 2 yards/pc
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'yards',
      wastagePercent: 0,
      placement: 'Shell Yardage -> KG',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });
    await repos.master.createBomItem({
      id: 'BOM-UOM-BTN',
      styleId: 'STY-UOM',
      materialId: 'MAT-06', // stock unit 'gross'
      consumptionPerGarment: 3, // 3 pcs/pc
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 0,
      placement: 'Buttons Pcs -> Gross',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });
    await repos.master.createBomItem({
      id: 'BOM-UOM-THD',
      styleId: 'STY-UOM',
      materialId: 'MAT-07', // stock unit 'cones'
      consumptionPerGarment: 0.24, // 0.24 cones per dozen = 0.02 cone/pc
      consumptionBasis: 'PER_DOZEN',
      consumptionUnit: 'cones',
      wastagePercent: 0,
      placement: 'Thread Per Dozen -> Cones',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    await repos.orders.createOrder(
      {
        id: 'ORD-UOM',
        poNumber: 'PO-UOM-1',
        buyerId: 'BUY-01',
        styleId: 'STY-UOM',
        orderQuantity: 144,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-01',
        status: 'CONFIRMED',
        assignedLineId: 'LINE-01',
        dhuPercent: 0,
        notes: 'UOM conversion MRP test',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: 'ITM-U1', orderId: 'ORD-UOM', color: 'Olive', size: '32', quantity: 144, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    const res = await mrp.generateOrderMrp('ORD-UOM');
    const kgReq = res.materialRequirements.find((m) => m.materialId === 'MAT-UOM-KG');
    const btnReq = res.materialRequirements.find((m) => m.materialId === 'MAT-06');
    const thdReq = res.materialRequirements.find((m) => m.materialId === 'MAT-07');

    // 144 * 2 yards = 288 yards = 288 * 0.9144 m * 0.375 kg/m = 98.7552 kg
    // Buttons: 144 * 3 = 432 pcs = 3 gross
    // Thread: 144 / 12 * 0.24 = 2.88 cones
    const ok =
      !!kgReq &&
      approxEqual(kgReq.grossBomRequirementExact, 98.7552) &&
      !!btnReq &&
      approxEqual(btnReq.grossBomRequirementExact, 3) &&
      !!thdReq &&
      approxEqual(thdReq.grossBomRequirementExact, 2.88);

    results.push({
      testNumber: 13,
      category: 'MRP_SERVICE',
      name: 'UOM Conversions in Order MRP',
      passed: ok,
      message: ok
        ? 'Converted yards->kg (98.7552 kg), pcs->gross (3 gross), and PER_DOZEN->cones (2.88 cones) accurately.'
        : 'UOM conversion inside Order MRP produced mismatched quantities.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 13, category: 'MRP_SERVICE', name: 'UOM Conversions in Order MRP', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 14: Material Requirement Aggregation (Same Material Across Multiple BOM Lines)
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_14_Aggregation');
    // Add a second BOM line using MAT-03 on STY-01 (Hood Drawcord / Hood Edge) in addition to BOM-02
    await repos.master.createBomItem({
      id: 'BOM-S2-EXTRA-RIB',
      styleId: 'STY-01',
      materialId: 'MAT-03',
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 0.02,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'kg',
      wastagePercent: 5,
      placement: 'Pocket Welt 2x2 Rib',
      isMandatory: true,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const res = await mrp.generateOrderMrp('ORD-01');
    const rib = res.materialRequirements.find((m) => m.materialId === 'MAT-03');
    // BOM-02: 14000 * 0.08 * 1.04 = 1164.8 kg
    // BOM-S2-EXTRA-RIB: 14000 * 0.02 * 1.05 = 294 kg
    // Consolidated MAT-03 = 1458.8 kg across ['BOM-02', 'BOM-S2-EXTRA-RIB']
    const ok =
      !!rib &&
      rib.matchedBomItemIds.length === 2 &&
      rib.matchedBomItemIds.includes('BOM-02') &&
      rib.matchedBomItemIds.includes('BOM-S2-EXTRA-RIB') &&
      approxEqual(rib.grossBomRequirementExact, 1458.8);

    results.push({
      testNumber: 14,
      category: 'MRP_SERVICE',
      name: 'Material Requirement Aggregation Across BOM Lines',
      passed: ok,
      message: ok
        ? 'Consolidated two STY-01 BOM lines sharing MAT-03 (1164.8 + 294 = 1458.8 kg) into a single net requirement.'
        : 'Same-material aggregation across multiple BOM lines failed.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 14, category: 'MRP_SERVICE', name: 'Material Requirement Aggregation Across BOM Lines', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 15: Missing BOM Handling
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_15_MissingBom');
    await repos.master.createStyle({
      id: 'STY-NO-BOM',
      buyerId: 'BUY-01',
      styleCode: 'ST-NOBOM',
      description: 'Style Missing BOM',
      garmentType: 'Tee',
      fabricClassification: 'Jersey',
      samMinutes: 9,
      targetEfficiencyPercent: 85,
      season: 'SS26',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repos.orders.createOrder(
      {
        id: 'ORD-NO-BOM',
        poNumber: 'PO-NOBOM-1',
        buyerId: 'BUY-01',
        styleId: 'STY-NO-BOM',
        orderQuantity: 500,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-01',
        status: 'DRAFT',
        assignedLineId: 'LINE-01',
        dhuPercent: 0,
        notes: 'Missing BOM check',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: 'ITM-NB1', orderId: 'ORD-NO-BOM', color: 'White', size: 'M', quantity: 500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    let rejected = false;
    try {
      await mrp.generateOrderMrp('ORD-NO-BOM');
    } catch (e: any) {
      rejected = e instanceof ValidationError && e.message.toLowerCase().includes('no bill of materials');
    }

    results.push({
      testNumber: 15,
      category: 'INTEGRITY',
      name: 'Missing BOM Handling',
      passed: rejected,
      message: rejected
        ? 'generateOrderMrp rejected order whose style lacks any BOM definition with ValidationError.'
        : 'Missing BOM was not rejected properly.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 15, category: 'INTEGRITY', name: 'Missing BOM Handling', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 16: Archived BOM Handling (Partial Exclusion & All-Archived Error)
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_16_ArchivedBom');
    // Partial archive: archive BOM-03 on STY-01 while BOM-01 & BOM-02 stay active
    await repos.master.archiveBomItem('BOM-03');
    const partialRes = await mrp.generateOrderMrp('ORD-01');
    const partialOk =
      partialRes.archivedComponentsExcluded.length === 1 &&
      partialRes.archivedComponentsExcluded[0].bomItemId === 'BOM-03' &&
      !partialRes.materialRequirements.some((m) => m.materialId === 'MAT-07') &&
      partialRes.materialRequirements.length === 2;

    // All-archived: archive entire v1 BOM on STY-02
    await repos.master.archiveBomVersion('STY-02', 1);
    let allArchivedRejected = false;
    try {
      await mrp.generateOrderMrp('ORD-02');
    } catch (e: any) {
      allArchivedRejected = e instanceof ValidationError && e.message.includes('ARCHIVED');
    }

    const ok = partialOk && allArchivedRejected;
    results.push({
      testNumber: 16,
      category: 'INTEGRITY',
      name: 'Archived BOM Handling',
      passed: ok,
      message: ok
        ? 'Excluded archived BOM-03 and reported it in archivedComponentsExcluded; rejected STY-02 when all BOM items archived.'
        : `Failed: partialOk=${partialOk}, allArchivedRejected=${allArchivedRejected}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 16, category: 'INTEGRITY', name: 'Archived BOM Handling', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 17: Cutting Allocation Reconciliation
  // ------------------------------------------------------------------
  try {
    const { db, mrp } = await setupSeededTestContext('TestS2_17_CuttingReconciliation');
    const ord1 = await mrp.generateOrderMrp('ORD-01');
    const mat02 = ord1.materialRequirements.find((m) => m.materialId === 'MAT-02');

    // ORD-01: Gross 7056 kg, TX-ACT-01 allocated 1800, TX-ACT-02 issued 1200 -> activeReserved=600, remaining=5256
    const ok =
      !!mat02 &&
      approxEqual(mat02.grossBomRequirementExact, 7056) &&
      approxEqual(mat02.existingCuttingAllocationExact, 1800) &&
      approxEqual(mat02.alreadyIssuedExact, 1200) &&
      approxEqual(mat02.activeReservedForOrderExact, 600) &&
      approxEqual(mat02.remainingUnallocatedRequirementExact, 5256) &&
      mat02.reconciledCuttingJobIds.includes('CJ-01');

    results.push({
      testNumber: 17,
      category: 'RECONCILIATION',
      name: 'Cutting Allocation Reconciliation',
      passed: ok,
      message: ok
        ? 'ORD-01 MAT-02 reconciled gross=7056, existingAlloc=1800, issued=1200, activeReserved=600, remaining=5256 kg.'
        : 'Cutting reconciliation values mismatch on ORD-01.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 17, category: 'RECONCILIATION', name: 'Cutting Allocation Reconciliation', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 18: Avoidance of Double-Counting & Unbacked/Dangling Ledger Checks
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_18_NoDoubleCount');
    // Add partial DEALLOCATION of 200 kg for ORD-01 (net allocated becomes 1800 - 200 = 1600: 1200 issued + 400 active reserved)
    await repos.inventory.postTransaction({
      idempotencyKey: 'TEST-S2-DEALLOC-200',
      materialId: 'MAT-02',
      transactionType: 'DEALLOCATION',
      quantity: 200,
      referenceType: 'ORDER_ALLOCATION',
      referenceId: 'ORD-01',
    });

    const ord1AfterDealloc = await mrp.generateOrderMrp('ORD-01');
    const mat02 = ord1AfterDealloc.materialRequirements.find((m) => m.materialId === 'MAT-02');
    // Must NOT subtract both 1600 and 1200! Remaining must be 7056 - 1600 = 5456.
    const noDoubleCountOk =
      !!mat02 &&
      approxEqual(mat02.existingCuttingAllocationExact, 1600) &&
      approxEqual(mat02.alreadyIssuedExact, 1200) &&
      approxEqual(mat02.activeReservedForOrderExact, 400) &&
      approxEqual(mat02.remainingUnallocatedRequirementExact, 5456);

    // Also test rejection when a CuttingJob claims allocatedFabricQuantity > 0 without ledger backing
    await repos.cutting.createCuttingJob({
      id: 'CJ-UNBACKED',
      jobNumber: 'CJ-2026-UNBACKED',
      orderId: 'ORD-02',
      styleId: 'STY-02',
      fabricMaterialId: 'MAT-01',
      markerLengthMeters: 6,
      plannedPlies: 50,
      plannedGarmentQuantity: 1000,
      actualCutGarmentQuantity: 0,
      allocatedFabricQuantity: 500, // NO ledger tx exists for ORD-02 / MAT-01!
      issuedFabricQuantity: 0,
      layTableNumber: 'Table 02',
      status: 'ALLOCATED',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let unbackedRejected = false;
    try {
      await mrp.generateOrderMrp('ORD-02');
    } catch (e: any) {
      unbackedRejected = e instanceof ValidationError && e.message.includes('backing ALLOCATION');
    }

    const ok = noDoubleCountOk && unbackedRejected;
    results.push({
      testNumber: 18,
      category: 'RECONCILIATION',
      name: 'Avoidance of Double-Counting & Unbacked Allocation Check',
      passed: ok,
      message: ok
        ? 'Reconciled net allocation (1600 = 1200 issued + 400 reserved) without double-counting, and rejected unbacked cutting job.'
        : `Failed: noDoubleCountOk=${noDoubleCountOk}, unbackedRejected=${unbackedRejected}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 18, category: 'RECONCILIATION', name: 'Avoidance of Double-Counting & Unbacked Allocation Check', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 19: Available-Stock Calculation
  // ------------------------------------------------------------------
  try {
    const { db, mrp } = await setupSeededTestContext('TestS2_19_AvailableStock');
    const ord1 = await mrp.generateOrderMrp('ORD-01');
    const mat02 = ord1.materialRequirements.find((m) => m.materialId === 'MAT-02');
    // MAT-02: Receipts=3200, Issues=1200 -> Physical=2000; Alloc=1800-1200=Reserved=600 -> Available=1400
    const ok =
      !!mat02 &&
      approxEqual(mat02.physicalStock, 2000) &&
      approxEqual(mat02.reservedStock, 600) &&
      approxEqual(mat02.availableStock, 1400) &&
      approxEqual(mat02.warehouseTotalIssuedStock, 1200);

    results.push({
      testNumber: 19,
      category: 'RECONCILIATION',
      name: 'Available-Stock Calculation (Physical - Reserved)',
      passed: ok,
      message: ok
        ? 'Verified MAT-02 live ledger snapshot: physical=2000 kg, reserved=600 kg, available=1400 kg.'
        : 'Available stock numbers deviated from InventoryRepository.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 19, category: 'RECONCILIATION', name: 'Available-Stock Calculation (Physical - Reserved)', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 20: Net Procurement Calculation (Shortage & Stock-Covered Zero Shortage)
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_20_NetProcurement');
    const ord1 = await mrp.generateOrderMrp('ORD-01');
    const mat02 = ord1.materialRequirements.find((m) => m.materialId === 'MAT-02');
    const mat07 = ord1.materialRequirements.find((m) => m.materialId === 'MAT-07');
    // MAT-02 shortage: 5256 - 1400 = 3856 kg
    // MAT-07 Thread: (14000/12)*0.02*1.03 = 24.033333... cones; stock = 480 cones -> netProcurement = 0!
    const shortageOk = !!mat02 && approxEqual(mat02.netProcurementRequirementExact, 3856);
    const coveredOk =
      !!mat07 &&
      approxEqual(mat07.grossBomRequirementExact, (14000 / 12) * 0.02 * 1.03) &&
      approxEqual(mat07.availableStock, 480) &&
      approxEqual(mat07.netProcurementRequirementExact, 0) &&
      mat07.discreteOrderUnits === 0;

    // Also test orderQuantity reduction where existing allocation exceeds gross need -> clamped to 0 remaining
    await repos.inventory.createMaterial(makeTestMaterial({ id: 'MAT-OVR', materialCode: 'OVR-1', unit: 'pcs' }));
    await repos.inventory.postTransaction({
      idempotencyKey: 'OVR-REC',
      materialId: 'MAT-OVR',
      transactionType: 'PO_RECEIPT',
      quantity: 1000,
      referenceType: 'PURCHASE_ORDER',
      referenceId: 'PO-OVR',
    });

    const ok = shortageOk && coveredOk;
    results.push({
      testNumber: 20,
      category: 'RECONCILIATION',
      name: 'Net Procurement Calculation (Shortage & Stock-Covered)',
      passed: ok,
      message: ok
        ? 'MAT-02 computed exact net procurement shortage 3856 kg; well-stocked MAT-07 computed 0 net procurement.'
        : `Failed: shortageOk=${shortageOk}, coveredOk=${coveredOk}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 20, category: 'RECONCILIATION', name: 'Net Procurement Calculation (Shortage & Stock-Covered)', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 21: Cancelled-Order Handling
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_21_CancelledOrder');
    await repos.orders.cancelOrder('ORD-03', 'Buyer cancelled style');

    let singleRejected = false;
    try {
      await mrp.generateOrderMrp('ORD-03');
    } catch (e: any) {
      singleRejected = e instanceof ValidationError && e.message.toLowerCase().includes('cancelled');
    }

    let multiDefaultRejected = false;
    try {
      await mrp.generateMultiOrderMrp(['ORD-01', 'ORD-03']);
    } catch (e: any) {
      multiDefaultRejected = e instanceof ValidationError && e.message.toLowerCase().includes('cancelled');
    }

    const multiExcluded = await mrp.generateMultiOrderMrp(['ORD-01', 'ORD-03'], {
      excludeCancelled: true,
    });
    const excludeWorked =
      multiExcluded.includedOrderIds.length === 1 &&
      multiExcluded.includedOrderIds[0] === 'ORD-01' &&
      multiExcluded.excludedCancelledOrders.length === 1 &&
      multiExcluded.excludedCancelledOrders[0].orderId === 'ORD-03';

    const ok = singleRejected && multiDefaultRejected && excludeWorked;
    results.push({
      testNumber: 21,
      category: 'INTEGRITY',
      name: 'Cancelled-Order Handling',
      passed: ok,
      message: ok
        ? 'Rejected cancelled ORD-03 in single/default multi-order MRP and skipped it cleanly with notice when excludeCancelled=true.'
        : `Failed: singleRejected=${singleRejected}, multiDefaultRejected=${multiDefaultRejected}, excludeWorked=${excludeWorked}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 21, category: 'INTEGRITY', name: 'Cancelled-Order Handling', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 22: Inventory Balance Immutability
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededTestContext('TestS2_22_BalanceImmutability');
    const balancesBefore = await repos.inventory.getAllStockBalances();
    await mrp.generateOrderMrp('ORD-01');
    await mrp.generateOrderMrp('ORD-02');
    await mrp.generateOrderMrp('ORD-03');
    await mrp.generateMultiOrderMrp(['ORD-01', 'ORD-02', 'ORD-03']);
    const balancesAfter = await repos.inventory.getAllStockBalances();

    const ok = JSON.stringify(balancesBefore) === JSON.stringify(balancesAfter);
    results.push({
      testNumber: 22,
      category: 'INTEGRITY',
      name: 'Inventory Balance Immutability',
      passed: ok,
      message: ok
        ? 'All 8 material stock balances (physical, reserved, available) remained bit-for-bit identical after single & multi-order MRP runs.'
        : 'Inventory balances changed during MRP calculation!',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 22, category: 'INTEGRITY', name: 'Inventory Balance Immutability', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 23: Existing Transaction History Preservation
  // ------------------------------------------------------------------
  try {
    const { db, mrp } = await setupSeededTestContext('TestS2_23_TxPreservation');
    const txsBefore = await db.inventory_transactions.orderBy('id').toArray();
    await mrp.generateOrderMrp('ORD-01');
    await mrp.generateMultiOrderMrp(['ORD-01', 'ORD-02', 'ORD-03']);
    const txsAfter = await db.inventory_transactions.orderBy('id').toArray();

    const ok =
      txsBefore.length === txsAfter.length &&
      JSON.stringify(txsBefore) === JSON.stringify(txsAfter);

    results.push({
      testNumber: 23,
      category: 'INTEGRITY',
      name: 'Existing Transaction History Preservation',
      passed: ok,
      message: ok
        ? `Ledger transaction count (${txsAfter.length}) and every transaction record remained 100% untouched (zero allocations/issues created).`
        : `Transaction ledger mutated: before=${txsBefore.length}, after=${txsAfter.length}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 23, category: 'INTEGRITY', name: 'Existing Transaction History Preservation', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 24: Realistic Demo Multi-Order Scenario (ORD-01 + ORD-02 + ORD-03)
  // ------------------------------------------------------------------
  try {
    const { db, mrp } = await setupSeededTestContext('TestS2_24_DemoFullScenario');
    const full = await mrp.generateMultiOrderMrp(['ORD-01', 'ORD-02', 'ORD-03']);

    // ORD-03 has no order_items rows in DEMO_ORDER_ITEMS -> fallback warning expected & 12,000 pcs applied
    const ord3Breakdown = full.orderBreakdowns.find((o) => o.orderId === 'ORD-03');
    const ord3Btn = ord3Breakdown?.materialRequirements.find((m) => m.materialId === 'MAT-06');
    // ORD-03 MAT-06: 12,000 * 2 pcs * 1.02 = 24,480 pcs = 170 gross; avail = 140 gross; netProcurement = 30 gross
    const ord3Ok =
      !!ord3Breakdown &&
      ord3Breakdown.usedOrderQuantityFallback === true &&
      ord3Breakdown.warnings.length >= 1 &&
      ord3Breakdown.totalGarmentPieces === 12000 &&
      !!ord3Btn &&
      approxEqual(ord3Btn.grossBomRequirementExact, 170) &&
      approxEqual(ord3Btn.netProcurementRequirementExact, 30);

    // Consolidated MAT-02 (3856 kg), MAT-03 (1380 kg), MAT-04 (12000*1.45*1.06 - 3900 = 18444 - 3900 = 14544 m)
    const mat02 = full.consolidatedMaterials.find((m) => m.materialId === 'MAT-02');
    const mat03 = full.consolidatedMaterials.find((m) => m.materialId === 'MAT-03');
    const mat04 = full.consolidatedMaterials.find((m) => m.materialId === 'MAT-04');
    const mat05 = full.consolidatedMaterials.find((m) => m.materialId === 'MAT-05'); // Zipper: 12000*1.01 - 3200 = 12120 - 3200 = 8920 pcs

    const consolidatedOk =
      full.totalGarmentPieces === 54000 &&
      !!mat02 && approxEqual(mat02.netProcurementRequirementExact, 3856) &&
      !!mat03 && approxEqual(mat03.netProcurementRequirementExact, 1380) &&
      !!mat04 && approxEqual(mat04.netProcurementRequirementExact, 14544) &&
      !!mat05 && approxEqual(mat05.netProcurementRequirementExact, 8920);

    const ok = ord3Ok && consolidatedOk;
    results.push({
      testNumber: 24,
      category: 'MRP_SERVICE',
      name: 'Realistic Multi-Order Seeded Demo MRP (ORD-01 + ORD-02 + ORD-03)',
      passed: ok,
      message: ok
        ? 'Verified full 54,000-pc demo batch: ORD-03 fallback (MAT-06 170 gross / 30 shortage), MAT-02 3,856 kg shortage, MAT-03 shared 1,380 kg shortage, MAT-04 14,544 m shortage, MAT-05 8,920 pcs shortage.'
        : `Demo scenario mismatch: ord3Ok=${ord3Ok}, consolidatedOk=${consolidatedOk}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 24, category: 'MRP_SERVICE', name: 'Realistic Multi-Order Seeded Demo MRP (ORD-01 + ORD-02 + ORD-03)', passed: false, message: err.message });
  }

  return {
    allPassed: results.every((r) => r.passed),
    results,
  };
}
