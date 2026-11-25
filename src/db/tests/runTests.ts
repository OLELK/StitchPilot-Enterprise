/**
 * StitchPilot Enterprise — Automated Test Suite for Phase 2A
 * Tests:
 *  Test A — Database initialization (15 tables, demo records)
 *  Test B — Persistence across sessions
 *  Test C — Inventory accounting calculations (100m fabric sequence)
 *  Test D — Duplicate transaction prevention (idempotency key)
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase, StitchPilotDatabase } from '../database';
import { createRepositories } from '../repositories';
import { DuplicateTransactionError, InventoryAccountingError } from '../errors';
import { runPhase2BTests } from './runPhase2BTests';
import { runPhase3ATests } from './runPhase3ATests';
import { runPhase3AStage2Tests } from './runPhase3AStage2Tests';
import { runPhase3AStage3Tests } from './runPhase3AStage3Tests';
import { runPhase3AStage4ATests } from './runPhase3AStage4ATests';
import { runPhase3AStage4BTests } from './runPhase3AStage4BTests';
import { runPhase3AStage4C1Tests } from './runPhase3AStage4C1Tests';
import { runPhase3AStage4C2Tests } from './runPhase3AStage4C2Tests';
import { runDefectRegressionTests } from './runDefectRegressionTests';

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

export async function runAllTests(): Promise<{
  allPassed: boolean;
  results: TestResult[];
}> {
  const results: TestResult[] = [];

  // ==========================================
  // Test A — Database Initialization
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const testDb = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Init');
    const repos = createRepositories(testDb);

    await testDb.open();
    const isOpen = testDb.isOpen();

    // Verify all 15 entity tables exist on the database instance
    const expectedTables = [
      'buyers',
      'styles',
      'orders',
      'order_items',
      'cost_sheets',
      'materials',
      'bom_items',
      'inventory_transactions',
      'cutting_jobs',
      'marker_ratios',
      'bundles',
      'production_lines',
      'production_events',
      'quality_inspections',
      'quality_defects',
    ];

    const missingTables = expectedTables.filter((t) => !(t in testDb.tables.map((tbl) => tbl.name)));
    const actualTableNames = testDb.tables.map((t) => t.name);

    // Seed demo records
    const seedResult = await repos.system.initializeAndSeedIfEmpty();
    const tableCounts = await repos.system.getTableCounts();

    const buyersCount = await repos.master.getAllBuyers();
    const stylesCount = await repos.master.getAllStyles();
    const ordersCount = await repos.orders.getAllOrders();
    const materialsCount = await repos.inventory.getAllMaterials();
    const linesCount = await repos.production.getAllLines();

    const tablesExist = expectedTables.every((t) => actualTableNames.includes(t));
    const hasData =
      buyersCount.length >= 2 &&
      stylesCount.length >= 3 &&
      ordersCount.length >= 2 &&
      materialsCount.length >= 8 &&
      linesCount.length >= 3;

    if (isOpen && tablesExist && hasData) {
      results.push({
        name: 'Test A — Database Initialization',
        passed: true,
        message: `Database opened successfully. All 15 entity tables exist. Demo records seeded (${buyersCount.length} buyers, ${stylesCount.length} styles, ${ordersCount.length} orders, ${materialsCount.length} materials, ${linesCount.length} lines).`,
        details: { tableCounts, seedMessage: seedResult.message },
      });
    } else {
      results.push({
        name: 'Test A — Database Initialization',
        passed: false,
        message: `Initialization check failed. isOpen: ${isOpen}, tablesExist: ${tablesExist}, hasData: ${hasData}`,
        details: { missingTables, tableCounts },
      });
    }
    testDb.close();
  } catch (error: any) {
    results.push({
      name: 'Test A — Database Initialization',
      passed: false,
      message: `Test A threw error: ${error?.message}`,
    });
  }

  // ==========================================
  // Test B — Persistence
  // ==========================================
  try {
    const sharedIDB = new IDBFactory();
    const dbName = 'TestDB_Persistence';

    // Session 1: Open DB, seed, insert custom test record, close
    const session1Db = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    const repos1 = createRepositories(session1Db);
    await repos1.system.initializeAndSeedIfEmpty();

    const testPoNumber = `PO-TEST-PERSIST-${Date.now()}`;
    await repos1.orders.createOrder({
      id: 'ORD-PERSIST-TEST',
      poNumber: testPoNumber,
      buyerId: 'BUY-01',
      styleId: 'STY-01',
      orderQuantity: 7777,
      producedQuantity: 0,
      targetExFactoryDate: '2026-12-30',
      status: 'CONFIRMED',
      assignedLineId: 'LINE-01',
      dhuPercent: 1.2,
      notes: 'Persistence test order record',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    session1Db.close();

    // Session 2: Reopen same database name from the same storage
    const session2Db = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    const repos2 = createRepositories(session2Db);
    await session2Db.open();

    // Confirm that the database does not re-seed duplicates
    const seedCheck = await repos2.system.initializeAndSeedIfEmpty();
    const retrievedOrder = await repos2.orders.getOrderByPo(testPoNumber);

    if (retrievedOrder && retrievedOrder.orderQuantity === 7777 && seedCheck.seeded === false) {
      results.push({
        name: 'Test B — Persistence',
        passed: true,
        message: `Record with PO "${testPoNumber}" persisted across sessions. Re-seed duplicate check passed (seeded: false).`,
        details: { retrievedOrder },
      });
    } else {
      results.push({
        name: 'Test B — Persistence',
        passed: false,
        message: `Record was not found after reopening database or duplicate seeding occurred.`,
      });
    }
    session2Db.close();
  } catch (error: any) {
    results.push({
      name: 'Test B — Persistence',
      passed: false,
      message: `Test B threw error: ${error?.message}`,
    });
  }

  // ==========================================
  // Test C — Inventory Calculations
  // Start with 100 metres of fabric:
  // 1. Receive 100 m
  // 2. Allocate 60 m -> Physical: 100 m, Reserved: 60 m, Available: 40 m
  // 3. Issue 40 m -> Physical: 60 m, Reserved: 20 m, Available: 40 m
  // 4. Attempt to issue another 30 m -> REJECTED (only 20 m reserved)
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const testDb = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_InventoryCalc');
    const repos = createRepositories(testDb);
    await testDb.open();

    // Create a fresh test fabric material (0 stock)
    const testMat = await repos.inventory.createMaterial({
      id: 'MAT-TEST-FABRIC',
      materialCode: 'TEST-FAB-100',
      name: 'Test Woven Cotton 100m Drill',
      category: 'Woven Fabric',
      spec: '100m Test Fabric Roll',
      unit: 'meters',
      reorderPoint: 20,
      warehouseLocation: 'Zone T-01',
      supplierName: 'Test Fabric Mill',
      isSimulated: true,
    });

    // Step 1: Receive 100 m
    await repos.inventory.postTransaction({
      idempotencyKey: 'TX-C-01-RECEIVE-100',
      materialId: testMat.id,
      transactionType: 'PO_RECEIPT',
      quantity: 100,
      referenceType: 'PURCHASE_ORDER',
      referenceId: 'PO-TEST-100M',
    });

    const balanceAfterReceive = await repos.inventory.getMaterialStockBalance(testMat.id);
    const step1Ok =
      balanceAfterReceive.physicalStock === 100 &&
      balanceAfterReceive.reservedStock === 0 &&
      balanceAfterReceive.availableStock === 100;

    // Step 2: Allocate 60 m
    await repos.inventory.postTransaction({
      idempotencyKey: 'TX-C-02-ALLOC-60',
      materialId: testMat.id,
      transactionType: 'ALLOCATION',
      quantity: 60,
      referenceType: 'ORDER_ALLOCATION',
      referenceId: 'ORD-TEST-1',
    });

    const balanceAfterAlloc = await repos.inventory.getMaterialStockBalance(testMat.id);
    // Expected: Physical 100 m, Reserved 60 m, Available 40 m
    const step2Ok =
      balanceAfterAlloc.physicalStock === 100 &&
      balanceAfterAlloc.reservedStock === 60 &&
      balanceAfterAlloc.availableStock === 40;

    // Step 3: Issue 40 m
    await repos.inventory.postTransaction({
      idempotencyKey: 'TX-C-03-ISSUE-40',
      materialId: testMat.id,
      transactionType: 'CUTTING_ISSUE',
      quantity: 40,
      referenceType: 'CUTTING_JOB',
      referenceId: 'CJ-TEST-1',
    });

    const balanceAfterIssue = await repos.inventory.getMaterialStockBalance(testMat.id);
    // Expected: Physical 60 m, Reserved 20 m, Available 40 m
    const step3Ok =
      balanceAfterIssue.physicalStock === 60 &&
      balanceAfterIssue.reservedStock === 20 &&
      balanceAfterIssue.availableStock === 40;

    // Step 4: Attempt to issue another 30 m (Only 20 m is reserved -> MUST BE REJECTED)
    let issue30Rejected = false;
    let rejectionReason = '';
    try {
      await repos.inventory.postTransaction({
        idempotencyKey: 'TX-C-04-ISSUE-30-INVALID',
        materialId: testMat.id,
        transactionType: 'CUTTING_ISSUE',
        quantity: 30,
        referenceType: 'CUTTING_JOB',
        referenceId: 'CJ-TEST-2',
      });
    } catch (err: any) {
      if (err instanceof InventoryAccountingError) {
        issue30Rejected = true;
        rejectionReason = err.message;
      } else {
        throw err;
      }
    }

    const finalBalance = await repos.inventory.getMaterialStockBalance(testMat.id);
    const balancePreserved =
      finalBalance.physicalStock === 60 &&
      finalBalance.reservedStock === 20 &&
      finalBalance.availableStock === 40;

    if (step1Ok && step2Ok && step3Ok && issue30Rejected && balancePreserved) {
      results.push({
        name: 'Test C — Inventory Calculations',
        passed: true,
        message: `Inventory accounting verification passed:\n` +
          `  1. Receive 100m -> Physical: ${balanceAfterReceive.physicalStock}m, Reserved: ${balanceAfterReceive.reservedStock}m, Available: ${balanceAfterReceive.availableStock}m\n` +
          `  2. Allocate 60m -> Physical: ${balanceAfterAlloc.physicalStock}m, Reserved: ${balanceAfterAlloc.reservedStock}m, Available: ${balanceAfterAlloc.availableStock}m\n` +
          `  3. Issue 40m -> Physical: ${balanceAfterIssue.physicalStock}m, Reserved: ${balanceAfterIssue.reservedStock}m, Available: ${balanceAfterIssue.availableStock}m\n` +
          `  4. Attempted issue 30m was rejected as expected: "${rejectionReason}"\n` +
          `  5. Balance remained strictly preserved (Physical: 60m, Reserved: 20m, Available: 40m).`,
        details: { balanceAfterReceive, balanceAfterAlloc, balanceAfterIssue, finalBalance },
      });
    } else {
      results.push({
        name: 'Test C — Inventory Calculations',
        passed: false,
        message: `Inventory calculation check failed. step1Ok: ${step1Ok}, step2Ok: ${step2Ok}, step3Ok: ${step3Ok}, issue30Rejected: ${issue30Rejected}`,
        details: { balanceAfterReceive, balanceAfterAlloc, balanceAfterIssue, finalBalance },
      });
    }
    testDb.close();
  } catch (error: any) {
    results.push({
      name: 'Test C — Inventory Calculations',
      passed: false,
      message: `Test C threw error: ${error?.message}`,
    });
  }

  // ==========================================
  // Test D — Duplicate Transaction Prevention
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const testDb = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_DuplicateCheck');
    const repos = createRepositories(testDb);
    await testDb.open();

    const mat = await repos.inventory.createMaterial({
      id: 'MAT-DUP-TEST',
      materialCode: 'DUP-TEST-01',
      name: 'Duplicate Check Material',
      category: 'Trims & Fasteners',
      spec: 'Brass Fastener',
      unit: 'pcs',
      reorderPoint: 50,
      warehouseLocation: 'Zone D-01',
      supplierName: 'Fastener Supplier',
      isSimulated: true,
    });

    const duplicateIdempotencyKey = 'IDEMP-UNIQUE-KEY-XYZ-999';

    // 1st insertion: should succeed
    const firstTx = await repos.inventory.postTransaction({
      idempotencyKey: duplicateIdempotencyKey,
      materialId: mat.id,
      transactionType: 'PO_RECEIPT',
      quantity: 500,
      referenceType: 'PURCHASE_ORDER',
      referenceId: 'PO-DUP-FIRST',
    });

    // 2nd insertion: identical idempotencyKey -> must throw DuplicateTransactionError
    let duplicateRejected = false;
    let duplicateErrorMessage = '';
    try {
      await repos.inventory.postTransaction({
        idempotencyKey: duplicateIdempotencyKey,
        materialId: mat.id,
        transactionType: 'PO_RECEIPT',
        quantity: 500,
        referenceType: 'PURCHASE_ORDER',
        referenceId: 'PO-DUP-SECOND',
      });
    } catch (err: any) {
      if (err instanceof DuplicateTransactionError) {
        duplicateRejected = true;
        duplicateErrorMessage = err.message;
      } else {
        throw err;
      }
    }

    const txs = await repos.inventory.getMaterialTransactions(mat.id);
    const onlyOneTx = txs.length === 1;

    if (firstTx && duplicateRejected && onlyOneTx) {
      results.push({
        name: 'Test D — Duplicate Transaction',
        passed: true,
        message: `Duplicate transaction with key "${duplicateIdempotencyKey}" was successfully prevented. Error: "${duplicateErrorMessage}". Ledger contains exactly 1 record.`,
        details: { transactionCount: txs.length },
      });
    } else {
      results.push({
        name: 'Test D — Duplicate Transaction',
        passed: false,
        message: `Duplicate prevention failed. duplicateRejected: ${duplicateRejected}, onlyOneTx: ${onlyOneTx}`,
      });
    }
    testDb.close();
  } catch (error: any) {
    results.push({
      name: 'Test D — Duplicate Transaction',
      passed: false,
      message: `Test D threw error: ${error?.message}`,
    });
  }

  // Include Phase 2B Tests (13 Domain & Lifecycle checks)
  try {
    const phase2B = await runPhase2BTests();
    for (const r of phase2B.results) {
      results.push({
        name: `Phase 2B Test ${r.testNumber} — ${r.name}`,
        passed: r.passed,
        message: r.message,
        details: r.details,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Phase 2B Test Suite Execution',
      passed: false,
      message: `Phase 2B runner failed: ${err.message}`,
    });
  }

  // Include Phase 3A Stage 1 Tests (29 UOM, BOM, Costing & Migration checks)
  try {
    const phase3A = await runPhase3ATests();
    for (const r of phase3A.results) {
      results.push({
        name: `Phase 3A Test ${r.testNumber} (${r.category}) — ${r.name}`,
        passed: r.passed,
        message: r.message,
        details: r.details,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Phase 3A Test Suite Execution',
      passed: false,
      message: `Phase 3A runner failed: ${err.message}`,
    });
  }

  // Include Phase 3A Stage 2 Tests (24 BOM Repository & Order MRP checks)
  try {
    const phase3AStage2 = await runPhase3AStage2Tests();
    for (const r of phase3AStage2.results) {
      results.push({
        name: `Phase 3A Stage 2 Test ${r.testNumber} (${r.category}) — ${r.name}`,
        passed: r.passed,
        message: r.message,
        details: r.details,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Phase 3A Stage 2 Test Suite Execution',
      passed: false,
      message: `Phase 3A Stage 2 runner failed: ${err.message}`,
    });
  }

  // Include Phase 3A Stage 3 Tests (16 Costing Repository, Revision & Approval checks)
  try {
    const phase3AStage3 = await runPhase3AStage3Tests();
    for (const r of phase3AStage3.results) {
      results.push({
        name: `Phase 3A Stage 3 Test ${r.testNumber} (${r.category}) — ${r.name}`,
        passed: r.passed,
        message: r.message,
        details: r.details,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Phase 3A Stage 3 Test Suite Execution',
      passed: false,
      message: `Phase 3A Stage 3 runner failed: ${err.message}`,
    });
  }

  // Include Phase 3A Stage 4A Tests (10 Style BOM Editor, Cloning, UOM & UI checks)
  try {
    const phase3AStage4A = await runPhase3AStage4ATests();
    for (const r of phase3AStage4A.results) {
      results.push({
        name: `Phase 3A Stage 4A Test ${r.testNumber} (${r.category}) — ${r.name}`,
        passed: r.passed,
        message: r.message,
        details: r.details,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Phase 3A Stage 4A Test Suite Execution',
      passed: false,
      message: `Phase 3A Stage 4A runner failed: ${err.message}`,
    });
  }

  // Include Phase 3A Stage 4B Tests (12 Order MRP, Consolidated MRP, Preservation & UI checks)
  try {
    const phase3AStage4B = await runPhase3AStage4BTests();
    for (const r of phase3AStage4B.results) {
      results.push({
        name: `Phase 3A Stage 4B Test ${r.testNumber} (${r.category}) — ${r.name}`,
        passed: r.passed,
        message: r.message,
        details: r.details,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Phase 3A Stage 4B Test Suite Execution',
      passed: false,
      message: `Phase 3A Stage 4B runner failed: ${err.message}`,
    });
  }

  // Include Phase 3A Stage 4C.1 Tests (13 BOM-to-Costing Integration & Repository Hydration checks)
  try {
    const phase3AStage4C1 = await runPhase3AStage4C1Tests();
    for (const r of phase3AStage4C1.results) {
      results.push({
        name: `Phase 3A Stage 4C.1 Test ${r.testNumber} (${r.category}) — ${r.name}`,
        passed: r.passed,
        message: r.message,
        details: r.details,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Phase 3A Stage 4C.1 Test Suite Execution',
      passed: false,
      message: `Phase 3A Stage 4C.1 runner failed: ${err.message}`,
    });
  }

  // Include Phase 3A Stage 4C.2 Tests (18 Costing UI, Workflow, Pricing & Preservation checks)
  try {
    const phase3AStage4C2 = await runPhase3AStage4C2Tests();
    for (const r of phase3AStage4C2.results) {
      results.push({
        name: `Phase 3A Stage 4C.2 Test ${r.testNumber} (${r.category}) — ${r.name}`,
        passed: r.passed,
        message: r.message,
        details: r.details,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Phase 3A Stage 4C.2 Test Suite Execution',
      passed: false,
      message: `Phase 3A Stage 4C.2 runner failed: ${err.message}`,
    });
  }

  // Include Priority Defect Regression Tests (6 checks for Bugs 1, 2 & 3)
  try {
    const defectRegression = await runDefectRegressionTests();
    for (const r of defectRegression.results) {
      results.push({
        name: `Defect Regression Test ${r.testNumber} (${r.bugId}) — ${r.name}`,
        passed: r.passed,
        message: r.message,
        details: r.details,
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Defect Regression Test Suite Execution',
      passed: false,
      message: `Defect regression runner failed: ${err.message}`,
    });
  }

  const allPassed = results.every((r) => r.passed);
  return { allPassed, results };
}

// CLI runner if executed directly
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('runTests')) {
  runAllTests().then((output) => {
    console.log('\n======================================================');
    console.log('STITCHPILOT ENTERPRISE — PHASE 2A, 2B & 3A COMPLETE SUITE');
    console.log('======================================================\n');
    output.results.forEach((r, i) => {
      console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.name}`);
      console.log(`  ${r.message.replace(/\n/g, '\n  ')}\n`);
    });
    console.log('------------------------------------------------------');
    console.log(`Summary: ${output.allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'} (${output.results.filter(r => r.passed).length}/${output.results.length})`);
    console.log('======================================================\n');
    if (!output.allPassed) {
      process.exit(1);
    }
  });
}
