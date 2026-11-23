/**
 * StitchPilot Enterprise — Phase 3A Stage 3 Automated Test Suite
 * Costing Repository, Multi-Revision Versioning & Approval Workflow
 *
 * Covers 16 comprehensive tests on isolated Dexie + fake-indexeddb instances:
 *  1. Cost sheet creation (style-level BOM line costing & calculator delegation)
 *  2. Cost sheet creation (order-specific context isolation)
 *  3. Cost sheet retrieval (by ID, style, order, version, latest & active approved)
 *  4. Duplicate & invalid version rejection
 *  5. Draft modification & full recalculation
 *  6. Prevention of unauthorized modification on non-DRAFT records
 *  7. Revision creation without overwriting historical versions
 *  8. Approval of v2 atomically superseding v1 while preserving v1 history
 *  9. Full rejection & reopen workflow (DRAFT -> SUBMITTED -> REJECTED -> DRAFT -> SUBMITTED -> APPROVED)
 * 10. Invalid approval transition & missing metadata rejection
 * 11. Foreign-key & relationship validation (style, order, buyer, BOM version, material, bomItem, cancelled order)
 * 12. Atomic Dexie transaction rollback on failure
 * 13. Bit-for-bit calculation consistency with costingCalculator.ts
 * 14. Multi-revision chain & branching version uniqueness (v3 branched from v1)
 * 15. Compatibility with seeded DEMO_COST_SHEETS (CST-01, CST-02, CST-03)
 * 16. Stage 1 & Stage 2 regression compatibility (BOM, MRP & inventory ledger untouched)
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase } from '../database';
import { createRepositories } from '../repositories';
import { createMrpService } from '../services/mrpService';
import { calculateCostSheet, CostingCalculationInput } from '../services/costingCalculator';
import {
  InvalidStatusTransitionError,
  RelationshipValidationError,
  ValidationError,
} from '../errors';

export interface Phase3AStage3TestResult {
  testNumber: number;
  category: 'CRUD' | 'VERSIONING' | 'WORKFLOW' | 'INTEGRITY' | 'REGRESSION';
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

function approxEqual(a: number, b: number, tol: number = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

async function setupSeededCostingTest(dbName: string) {
  const customIDB = new IDBFactory();
  const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, dbName);
  const repos = createRepositories(db);
  await db.open();
  await repos.system.initializeAndSeedIfEmpty();
  const mrp = createMrpService(db);
  return { db, repos, mrp };
}

export async function runPhase3AStage3Tests(): Promise<{
  allPassed: boolean;
  results: Phase3AStage3TestResult[];
}> {
  const results: Phase3AStage3TestResult[] = [];

  // ------------------------------------------------------------------
  // Test 1: Cost Sheet Creation (Style-Level with Line Items + SAM Rate)
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_01_CreateStyle');
    // Note: STY-01 already has seeded CST-01 (v1), so next auto-version is v2
    const created = await repos.costing.createCostSheet({
      id: 'CST-S3-STYLE-1',
      styleId: 'STY-01',
      bomVersionRef: 1,
      costingBasisQuantity: 14000,
      currency: 'USD',
      lineItems: [
        {
          id: 'LI-FLC',
          category: 'FABRIC',
          description: '380 GSM Brushed Fleece Shell',
          materialId: 'MAT-02',
          bomItemId: 'BOM-01',
          consumptionPerGarment: 0.48,
          consumptionBasis: 'PER_PIECE',
          consumptionUnit: 'kg',
          stockUnit: 'kg',
          wastagePercent: 5,
          unitPrice: 8.0,
          currency: 'USD',
        },
        {
          id: 'LI-RIB',
          category: 'FABRIC',
          description: '2x2 Spandex Cuff & Hem Rib',
          materialId: 'MAT-03',
          bomItemId: 'BOM-02',
          consumptionPerGarment: 0.08,
          consumptionBasis: 'PER_PIECE',
          consumptionUnit: 'kg',
          stockUnit: 'kg',
          wastagePercent: 4,
          unitPrice: 9.5,
          currency: 'USD',
        },
        {
          id: 'LI-THD',
          category: 'THREAD_CONSUMABLES',
          description: 'Coats Overlock Thread',
          materialId: 'MAT-07',
          bomItemId: 'BOM-03',
          consumptionPerGarment: 0.02,
          consumptionBasis: 'PER_DOZEN',
          consumptionUnit: 'cones',
          stockUnit: 'cones',
          wastagePercent: 3,
          unitPrice: 2.5,
          currency: 'USD',
        },
      ],
      categoryCosts: {
        TRIMS: 0.95,
        PACKING: 0.35,
      },
      cmt: {
        method: 'SAM_RATE',
        samMinutes: 16.4,
        efficiencyPercent: 82,
        cmRatePerMinute: 0.11,
        cmRateBasis: 'ACTUAL_MINUTE', // 16.4 / 0.82 = 20 actual min * 0.11 = $2.20
      },
      overhead: {
        method: 'PERCENT_OF_CMT',
        value: 30, // 30% of $2.20 = $0.66
      },
      commissionPercent: 4,
      pricingMode: 'MARGIN_TO_FOB',
      targetMarginPercent: 20,
    });

    const retrieved = await repos.costing.getCostSheetById('CST-S3-STYLE-1');
    const ok =
      !!retrieved &&
      retrieved.version === 2 &&
      retrieved.status === 'DRAFT' &&
      retrieved.approvedBy === '' &&
      approxEqual(retrieved.laborCmtCost, 2.2) &&
      approxEqual(retrieved.overheadCost, 0.66) &&
      retrieved.lineItems?.length === 3 &&
      approxEqual(retrieved.marginPercent, 20) &&
      retrieved.quotedFobPrice > retrieved.totalCostPerGarment;

    results.push({
      testNumber: 1,
      category: 'CRUD',
      name: 'Cost Sheet Creation (Style-Level BOM Line Costing)',
      passed: ok,
      message: ok
        ? `Created DRAFT v2 (${retrieved?.id}): Total=$${retrieved?.totalCostPerGarment}, FOB=$${retrieved?.quotedFobPrice}, Margin=${retrieved?.marginPercent}%.`
        : 'Created style-level cost sheet values mismatched.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 1, category: 'CRUD', name: 'Cost Sheet Creation (Style-Level BOM Line Costing)', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 2: Order-Specific Context Isolation
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_02_OrderContext');
    // ORD-01 uses STY-01. Seeded CST-01 is style-level (no orderId, version 1).
    // Creating order-specific cost sheet for ORD-01/STY-01 MUST start at version 1 cleanly without collision.
    const ordSheet = await repos.costing.createCostSheet({
      id: 'CST-ORD01-V1',
      styleId: 'STY-01',
      orderId: 'ORD-01',
      costingBasisQuantity: 14000,
      currency: 'USD',
      categoryCosts: {
        FABRIC: 4.95,
        TRIMS: 1.15,
        PACKING: 0.25,
      },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.25 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 12.0,
    });

    const styleOnly = await repos.costing.getCostSheetsByStyle('STY-01', {
      includeOrderSpecific: false,
    });
    const orderSheets = await repos.costing.getCostSheetsByOrder('ORD-01');
    const orderVersions = await repos.costing.getCostSheetVersions({
      styleId: 'STY-01',
      orderId: 'ORD-01',
    });

    const ok =
      ordSheet.version === 1 &&
      ordSheet.orderId === 'ORD-01' &&
      ordSheet.buyerId === 'BUY-01' &&
      styleOnly.length === 1 &&
      styleOnly[0].id === 'CST-01' &&
      orderSheets.length === 1 &&
      orderVersions.length === 1 &&
      orderVersions[0].id === 'CST-ORD01-V1';

    results.push({
      testNumber: 2,
      category: 'CRUD',
      name: 'Order-Specific Cost Sheet Context Isolation',
      passed: ok,
      message: ok
        ? 'Order-specific costing for ORD-01 started independently at v1 while style-level CST-01 remained isolated.'
        : 'Order-specific vs style-level context isolation failed.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 2, category: 'CRUD', name: 'Order-Specific Cost Sheet Context Isolation', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 3: Cost Sheet Retrieval Methods
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_03_Retrieval');
    await repos.costing.createCostSheet({
      id: 'CST-RET-V2',
      styleId: 'STY-02',
      currency: 'USD',
      categoryCosts: { FABRIC: 1.9, TRIMS: 0.4 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 1.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.3 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 5.5,
    });

    const byId = await repos.costing.getCostSheetById('CST-RET-V2');
    const byStyle = await repos.costing.getCostSheetsByStyle('STY-02');
    const byVer1 = await repos.costing.getCostSheetByVersion({ styleId: 'STY-02', version: 1 });
    const byVer2 = await repos.costing.getCostSheetByVersion({ styleId: 'STY-02', version: 2 });
    const latest = await repos.costing.getLatestCostSheet({ styleId: 'STY-02' });
    const activeApproved = await repos.costing.getActiveApprovedCostSheet({ styleId: 'STY-02' });

    const ok =
      !!byId &&
      byStyle.length === 2 &&
      byVer1?.id === 'CST-02' &&
      byVer2?.id === 'CST-RET-V2' &&
      latest?.id === 'CST-RET-V2' &&
      activeApproved?.id === 'CST-02';

    results.push({
      testNumber: 3,
      category: 'CRUD',
      name: 'Cost Sheet Retrieval Queries',
      passed: ok,
      message: ok
        ? 'Verified getCostSheetById, getCostSheetsByStyle, getCostSheetByVersion, getLatestCostSheet (v2), and getActiveApprovedCostSheet (v1).'
        : 'Cost sheet query results did not match expected versions.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 3, category: 'CRUD', name: 'Cost Sheet Retrieval Queries', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 4: Duplicate & Invalid Version Rejection
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_04_VersionUniqueness');
    let dupRejected = false;
    let zeroRejected = false;
    let fracRejected = false;
    let dupIdRejected = false;

    const basePayload = {
      styleId: 'STY-01',
      currency: 'USD',
      categoryCosts: { FABRIC: 4.5, TRIMS: 1.0 },
      cmt: { method: 'DIRECT_CMT' as const, directCmtCost: 2.0 },
      overhead: { method: 'FIXED_PER_GARMENT' as const, value: 0.5 },
      pricingMode: 'FOB_TO_MARGIN' as const,
      quotedFobPrice: 11.0,
    };

    // Duplicate version 1 for STY-01 (already exists via CST-01)
    try {
      await repos.costing.createCostSheet({ ...basePayload, id: 'CST-DUP-V1', version: 1 });
    } catch (e: any) {
      dupRejected = e instanceof ValidationError && e.field === 'version';
    }

    // Zero / negative / fractional version
    try {
      await repos.costing.createCostSheet({ ...basePayload, id: 'CST-ZERO-V', version: 0 });
    } catch (e: any) {
      zeroRejected = e instanceof ValidationError && e.field === 'version';
    }
    try {
      await repos.costing.createCostSheet({ ...basePayload, id: 'CST-FRAC-V', version: 2.5 });
    } catch (e: any) {
      fracRejected = e instanceof ValidationError && e.field === 'version';
    }

    // Duplicate primary key ID
    try {
      await repos.costing.createCostSheet({ ...basePayload, id: 'CST-01', version: 2 });
    } catch (e: any) {
      dupIdRejected = e instanceof ValidationError && e.field === 'id';
    }

    const ok = dupRejected && zeroRejected && fracRejected && dupIdRejected;
    results.push({
      testNumber: 4,
      category: 'VERSIONING',
      name: 'Duplicate & Invalid Version Rejection',
      passed: ok,
      message: ok
        ? 'Rejected duplicate context version (v1), version=0, fractional version (2.5), and duplicate primary ID.'
        : `Failures: dup=${dupRejected}, zero=${zeroRejected}, frac=${fracRejected}, dupId=${dupIdRejected}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 4, category: 'VERSIONING', name: 'Duplicate & Invalid Version Rejection', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 5: Draft Modification & Full Recalculation
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_05_DraftUpdate');
    const draft = await repos.costing.createCostSheet({
      id: 'CST-DRAFT-UPD',
      styleId: 'STY-03',
      currency: 'USD',
      categoryCosts: { FABRIC: 5.0, TRIMS: 1.5, WASHING_FINISHING: 0.5 },
      cmt: {
        method: 'SAM_RATE',
        samMinutes: 24,
        efficiencyPercent: 80,
        cmRatePerMinute: 0.1,
        cmRateBasis: 'STANDARD_MINUTE', // 24 * 0.1 = 2.40
      },
      overhead: { method: 'PERCENT_OF_DIRECT_COST', value: 10 }, // Direct = 7.0 + 2.4 = 9.40 -> OH = 0.94 -> Total = 10.34
      commissionPercent: 0,
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 14.0,
    });

    const updated = await repos.costing.updateDraftCostSheet(draft.id, {
      categoryCosts: { FABRIC: 5.5, TRIMS: 1.5, WASHING_FINISHING: 0.5 }, // Direct = 7.5 + 2.4 = 9.9 -> OH = 0.99 -> Total = 10.89
      commissionPercent: 5,
      pricingMode: 'MARKUP_TO_FOB',
      targetMarkupPercent: 25, // Profit = 10.89 * 0.25 = 2.7225; NetFOB = 13.6125; FOB = 13.6125 / 0.95 = 14.3289
    });

    const ok =
      approxEqual(draft.totalCostPerGarment, 10.34) &&
      approxEqual(updated.totalCostPerGarment, 10.89) &&
      approxEqual(updated.overheadCost, 0.99) &&
      approxEqual(updated.profitPerGarment ?? 0, 2.7225) &&
      approxEqual(updated.quotedFobPrice, 14.3289, 1e-4) &&
      approxEqual(updated.markupPercent ?? 0, 25, 0.01) &&
      updated.version === draft.version &&
      updated.status === 'DRAFT';

    results.push({
      testNumber: 5,
      category: 'CRUD',
      name: 'Draft Cost Sheet Modification & Recalculation',
      passed: ok,
      message: ok
        ? `Draft updated & recalculated via costingCalculator: Total $${draft.totalCostPerGarment} -> $${updated.totalCostPerGarment}, FOB $${updated.quotedFobPrice} (25% markup after 5% commission).`
        : 'Draft recalculation produced unexpected figures.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 5, category: 'CRUD', name: 'Draft Cost Sheet Modification & Recalculation', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 6: Prevention of Unauthorized Modification of Non-DRAFT Records
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_06_Immutability');
    // 1. Seeded APPROVED CST-01 cannot be modified
    let approvedBlocked = false;
    try {
      await repos.costing.updateDraftCostSheet('CST-01', { quotedFobPrice: 99.99 });
    } catch (e: any) {
      approvedBlocked = e instanceof ValidationError;
    }

    // 2. SUBMITTED record cannot be modified
    const draft = await repos.costing.createCostSheet({
      id: 'CST-LOCK-TEST',
      styleId: 'STY-01',
      orderId: 'ORD-01',
      currency: 'USD',
      categoryCosts: { FABRIC: 4.8, TRIMS: 1.1 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 12.0,
    });
    await repos.costing.submitForApproval(draft.id);
    let submittedBlocked = false;
    try {
      await repos.costing.updateDraftCostSheet(draft.id, { quotedFobPrice: 15.0 });
    } catch (e: any) {
      submittedBlocked = e instanceof ValidationError;
    }

    // 3. REJECTED record cannot be directly modified without reopen or new revision
    await repos.costing.rejectCostSheet(draft.id, 'FOB too low');
    let rejectedBlocked = false;
    try {
      await repos.costing.updateDraftCostSheet(draft.id, { quotedFobPrice: 15.0 });
    } catch (e: any) {
      rejectedBlocked = e instanceof ValidationError;
    }

    // 4. Attempting to inject forbidden status/version fields into DRAFT update fails
    await repos.costing.reopenRejectedCostSheet(draft.id);
    let forbiddenFieldBlocked = false;
    try {
      await repos.costing.updateDraftCostSheet(draft.id, { status: 'APPROVED' } as any);
    } catch (e: any) {
      forbiddenFieldBlocked = e instanceof ValidationError;
    }

    const cst01After = await repos.costing.getCostSheetById('CST-01');
    const cst01Intact = cst01After?.quotedFobPrice === 11.5 && cst01After?.status === 'APPROVED';

    const ok = approvedBlocked && submittedBlocked && rejectedBlocked && forbiddenFieldBlocked && cst01Intact;
    results.push({
      testNumber: 6,
      category: 'INTEGRITY',
      name: 'Unauthorized Modification Prevention',
      passed: ok,
      message: ok
        ? 'Blocked in-place edits on APPROVED, SUBMITTED, REJECTED records and rejected forbidden status injection.'
        : `Failures: app=${approvedBlocked}, sub=${submittedBlocked}, rej=${rejectedBlocked}, inj=${forbiddenFieldBlocked}, intact=${cst01Intact}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 6, category: 'INTEGRITY', name: 'Unauthorized Modification Prevention', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 7: Revision Creation Without Overwriting Historical Versions
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_07_RevisionCreate');
    const v1Before = await repos.costing.getCostSheetById('CST-01');
    const v2Draft = await repos.costing.createRevision('CST-01', {
      newId: 'CST-01-V2',
      updates: {
        categoryCosts: { FABRIC: 5.2, TRIMS: 1.15 },
        quotedFobPrice: 12.8,
      },
    });
    const v1After = await repos.costing.getCostSheetById('CST-01');

    const ok =
      v2Draft.version === 2 &&
      v2Draft.status === 'DRAFT' &&
      v2Draft.parentCostSheetId === 'CST-01' &&
      v2Draft.approvedBy === '' &&
      v2Draft.approvedAt === undefined &&
      approxEqual(v2Draft.fabricCost, 5.2) &&
      approxEqual(v2Draft.quotedFobPrice, 12.8) &&
      JSON.stringify(v1Before) === JSON.stringify(v1After);

    results.push({
      testNumber: 7,
      category: 'VERSIONING',
      name: 'Revision Creation Without Overwriting History',
      passed: ok,
      message: ok
        ? 'Created DRAFT v2 linked via parentCostSheetId=CST-01 while v1 remained bit-for-bit unchanged and still APPROVED.'
        : 'Revision creation mutated v1 or failed version linkage.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 7, category: 'VERSIONING', name: 'Revision Creation Without Overwriting History', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 8: Preservation of Earlier Approved Versions Across v2 Approval
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_08_PreserveHistoryOnApprove');
    const v1Snapshot = await repos.costing.getCostSheetById('CST-01');

    const v2 = await repos.costing.createRevision('CST-01', {
      newId: 'CST-01-REV2',
      updates: {
        categoryCosts: { FABRIC: 5.0, TRIMS: 1.2 },
        quotedFobPrice: 12.5,
      },
    });
    await repos.costing.submitForApproval(v2.id);
    const approvalResult = await repos.costing.approveCostSheet(v2.id, 'Nadia Rahman (VP Merchandising)');

    const v1AfterApproval = await repos.costing.getCostSheetById('CST-01');
    const activeAfter = await repos.costing.getActiveApprovedCostSheet({ styleId: 'STY-01' });

    const historyPreserved =
      !!v1Snapshot &&
      !!v1AfterApproval &&
      v1AfterApproval.status === 'SUPERSEDED' &&
      v1AfterApproval.totalCostPerGarment === v1Snapshot.totalCostPerGarment &&
      v1AfterApproval.quotedFobPrice === v1Snapshot.quotedFobPrice &&
      v1AfterApproval.marginPercent === v1Snapshot.marginPercent &&
      v1AfterApproval.approvedBy === v1Snapshot.approvedBy &&
      v1AfterApproval.approvedAt === v1Snapshot.approvedAt;

    const ok =
      approvalResult.approved.id === 'CST-01-REV2' &&
      approvalResult.approved.status === 'APPROVED' &&
      approvalResult.approved.approvedBy === 'Nadia Rahman (VP Merchandising)' &&
      !!approvalResult.approved.approvedAt &&
      approvalResult.superseded.length === 1 &&
      approvalResult.superseded[0].id === 'CST-01' &&
      activeAfter?.id === 'CST-01-REV2' &&
      historyPreserved;

    results.push({
      testNumber: 8,
      category: 'VERSIONING',
      name: 'Preservation of Superseded Historical Approved Cost Sheets',
      passed: ok,
      message: ok
        ? 'Approving v2 atomically marked v1 SUPERSEDED while preserving v1 cost, FOB, margin, and original approval audit untouched.'
        : 'Historical approved version preservation failed during v2 approval.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 8, category: 'VERSIONING', name: 'Preservation of Superseded Historical Approved Cost Sheets', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 9: Full Approval & Rejection Workflow End-to-End
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_09_Workflow');
    const d = await repos.costing.createCostSheet({
      id: 'CST-WF-1',
      styleId: 'STY-03',
      orderId: 'ORD-03',
      currency: 'USD',
      categoryCosts: { FABRIC: 5.4, TRIMS: 1.8 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 3.1 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.85 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 13.5,
    });

    const submitted = await repos.costing.submitForApproval(d.id);
    const rejected = await repos.costing.rejectCostSheet(d.id, 'Margin below 18% buyer threshold');
    const reopened = await repos.costing.reopenRejectedCostSheet(d.id);
    const revisedDraft = await repos.costing.updateDraftCostSheet(d.id, { quotedFobPrice: 15.0 });
    await repos.costing.submitForApproval(d.id);
    const approvedRes = await repos.costing.approveCostSheet(d.id, 'Tariq Chowdhury');

    const ok =
      d.status === 'DRAFT' &&
      submitted.status === 'SUBMITTED' &&
      rejected.status === 'REJECTED' &&
      rejected.rejectionReason === 'Margin below 18% buyer threshold' &&
      rejected.approvedBy === '' &&
      reopened.status === 'DRAFT' &&
      revisedDraft.quotedFobPrice === 15.0 &&
      approvedRes.approved.status === 'APPROVED' &&
      approvedRes.approved.approvedBy === 'Tariq Chowdhury' &&
      approvedRes.approved.rejectionReason === undefined &&
      !!approvedRes.approved.approvedAt;

    results.push({
      testNumber: 9,
      category: 'WORKFLOW',
      name: 'Approval & Rejection Lifecycle Workflow',
      passed: ok,
      message: ok
        ? 'Completed DRAFT -> SUBMITTED -> REJECTED -> DRAFT -> updated FOB -> SUBMITTED -> APPROVED with full audit metadata.'
        : 'Lifecycle state transition or metadata check failed.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 9, category: 'WORKFLOW', name: 'Approval & Rejection Lifecycle Workflow', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 10: Invalid Approval Transition & Missing Audit Data Rejection
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_10_InvalidTransitions');
    const d = await repos.costing.createCostSheet({
      id: 'CST-INV-TR',
      styleId: 'STY-02',
      orderId: 'ORD-02',
      currency: 'USD',
      categoryCosts: { FABRIC: 1.9, TRIMS: 0.35 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 1.15 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.3 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 5.3,
    });

    let draftToApprovedBlocked = false;
    let draftToRejectedBlocked = false;
    let blankApproverBlocked = false;
    let blankReasonBlocked = false;
    let approvedToRejectedBlocked = false;

    try {
      await repos.costing.approveCostSheet(d.id, 'Approver');
    } catch (e: any) {
      draftToApprovedBlocked = e instanceof InvalidStatusTransitionError;
    }

    try {
      await repos.costing.rejectCostSheet(d.id, 'Reason');
    } catch (e: any) {
      draftToRejectedBlocked = e instanceof InvalidStatusTransitionError;
    }

    await repos.costing.submitForApproval(d.id);

    try {
      await repos.costing.approveCostSheet(d.id, '   ');
    } catch (e: any) {
      blankApproverBlocked = e instanceof ValidationError && e.field === 'approvedBy';
    }

    try {
      await repos.costing.rejectCostSheet(d.id, '   ');
    } catch (e: any) {
      blankReasonBlocked = e instanceof ValidationError && e.field === 'rejectionReason';
    }

    await repos.costing.approveCostSheet(d.id, 'Chief Costing Officer');

    try {
      await repos.costing.rejectCostSheet(d.id, 'Late change');
    } catch (e: any) {
      approvedToRejectedBlocked = e instanceof InvalidStatusTransitionError;
    }

    const ok =
      draftToApprovedBlocked &&
      draftToRejectedBlocked &&
      blankApproverBlocked &&
      blankReasonBlocked &&
      approvedToRejectedBlocked;

    results.push({
      testNumber: 10,
      category: 'WORKFLOW',
      name: 'Invalid Transition & Empty Approver/Reason Rejection',
      passed: ok,
      message: ok
        ? 'Blocked DRAFT->APPROVED, DRAFT->REJECTED, APPROVED->REJECTED, blank approver, and blank rejectionReason.'
        : `Failures: d2a=${draftToApprovedBlocked}, d2r=${draftToRejectedBlocked}, blkApp=${blankApproverBlocked}, blkReas=${blankReasonBlocked}, a2r=${approvedToRejectedBlocked}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 10, category: 'WORKFLOW', name: 'Invalid Transition & Empty Approver/Reason Rejection', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 11: Foreign-Key & Relationship Validation
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_11_FkValidation');
    let missingStyleBlocked = false;
    let missingOrderBlocked = false;
    let orderStyleMismatchBlocked = false;
    let buyerMismatchBlocked = false;
    let missingBomVerBlocked = false;
    let missingMaterialLineBlocked = false;
    let wrongStyleBomLineBlocked = false;
    let cancelledOrderBlocked = false;

    const base = {
      currency: 'USD',
      cmt: { method: 'DIRECT_CMT' as const, directCmtCost: 2.0 },
      overhead: { method: 'FIXED_PER_GARMENT' as const, value: 0.5 },
      pricingMode: 'FOB_TO_MARGIN' as const,
      quotedFobPrice: 10.0,
      categoryCosts: { FABRIC: 4.0 },
    };

    try {
      await repos.costing.createCostSheet({ ...base, styleId: 'STY-999' });
    } catch (e: any) {
      missingStyleBlocked = e instanceof RelationshipValidationError;
    }

    try {
      await repos.costing.createCostSheet({ ...base, styleId: 'STY-01', orderId: 'ORD-999' });
    } catch (e: any) {
      missingOrderBlocked = e instanceof RelationshipValidationError;
    }

    try {
      // ORD-01 belongs to STY-01, NOT STY-02
      await repos.costing.createCostSheet({ ...base, styleId: 'STY-02', orderId: 'ORD-01' });
    } catch (e: any) {
      orderStyleMismatchBlocked = e instanceof RelationshipValidationError;
    }

    try {
      // STY-01 belongs to BUY-01, NOT BUY-02
      await repos.costing.createCostSheet({ ...base, styleId: 'STY-01', buyerId: 'BUY-02' });
    } catch (e: any) {
      buyerMismatchBlocked = e instanceof ValidationError;
    }

    try {
      await repos.costing.createCostSheet({ ...base, styleId: 'STY-01', bomVersionRef: 99 });
    } catch (e: any) {
      missingBomVerBlocked = e instanceof RelationshipValidationError;
    }

    try {
      await repos.costing.createCostSheet({
        ...base,
        styleId: 'STY-01',
        lineItems: [
          { id: 'L1', category: 'FABRIC', description: 'Bad mat', materialId: 'MAT-NOPE', costPerGarment: 4.0, currency: 'USD' },
        ],
      });
    } catch (e: any) {
      missingMaterialLineBlocked = e instanceof RelationshipValidationError;
    }

    try {
      // BOM-04 belongs to STY-02, not STY-01
      await repos.costing.createCostSheet({
        ...base,
        styleId: 'STY-01',
        lineItems: [
          { id: 'L1', category: 'FABRIC', description: 'Wrong BOM style', bomItemId: 'BOM-04', costPerGarment: 4.0, currency: 'USD' },
        ],
      });
    } catch (e: any) {
      wrongStyleBomLineBlocked = e instanceof RelationshipValidationError;
    }

    await repos.orders.cancelOrder('ORD-03', 'Buyer cancelled PO');
    try {
      await repos.costing.createCostSheet({ ...base, styleId: 'STY-03', orderId: 'ORD-03' });
    } catch (e: any) {
      cancelledOrderBlocked = e instanceof ValidationError;
    }

    const ok =
      missingStyleBlocked &&
      missingOrderBlocked &&
      orderStyleMismatchBlocked &&
      buyerMismatchBlocked &&
      missingBomVerBlocked &&
      missingMaterialLineBlocked &&
      wrongStyleBomLineBlocked &&
      cancelledOrderBlocked;

    results.push({
      testNumber: 11,
      category: 'INTEGRITY',
      name: 'Foreign-Key & Relationship Validation',
      passed: ok,
      message: ok
        ? 'Validated and blocked bad styleId, orderId, order/style mismatch, buyer mismatch, bomVersionRef, materialId, cross-style bomItemId, and cancelled order.'
        : `Failures: sty=${missingStyleBlocked}, ord=${missingOrderBlocked}, os=${orderStyleMismatchBlocked}, buy=${buyerMismatchBlocked}, bv=${missingBomVerBlocked}, mat=${missingMaterialLineBlocked}, bom=${wrongStyleBomLineBlocked}, cancel=${cancelledOrderBlocked}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 11, category: 'INTEGRITY', name: 'Foreign-Key & Relationship Validation', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 12: Transaction Rollback on Failure
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_12_Rollback');
    // Scenario A: v1 is APPROVED, v2 is SUBMITTED. Then ORD-01 becomes CANCELLED (or data becomes invalid) OR a failure occurs during approveCostSheet transaction.
    // 1. Create order-level v1 APPROVED, then v2 SUBMITTED
    const v1 = await repos.costing.createCostSheet({
      id: 'CST-RB-V1',
      styleId: 'STY-01',
      orderId: 'ORD-01',
      currency: 'USD',
      categoryCosts: { FABRIC: 4.8, TRIMS: 1.1 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 11.5,
    });
    await repos.costing.submitForApproval(v1.id);
    await repos.costing.approveCostSheet(v1.id, 'Initial Approver');

    const v2 = await repos.costing.createRevision(v1.id, {
      newId: 'CST-RB-V2',
      updates: { quotedFobPrice: 12.2 },
    });
    await repos.costing.submitForApproval(v2.id);

    // Force a failure inside the approveCostSheet Dexie transaction by cancelling ORD-01 before approving v2
    await repos.orders.cancelOrder('ORD-01', 'Order cancelled before v2 signoff');
    let failedOnApprove = false;
    try {
      await repos.costing.approveCostSheet(v2.id, 'Second Approver');
    } catch (e: any) {
      failedOnApprove = e instanceof ValidationError;
    }

    const v1AfterFail = await repos.costing.getCostSheetById(v1.id);
    const v2AfterFail = await repos.costing.getCostSheetById(v2.id);

    // Scenario B: Simulate mid-transaction DB failure during supersede+approve write using a hook
    let hookRollbackOk = false;
    const v1StyleBefore = await repos.costing.getCostSheetById('CST-01');
    const v2Style = await repos.costing.createRevision('CST-01', {
      newId: 'CST-RB-STYLE-V2',
      updates: { quotedFobPrice: 13.0 },
    });
    await repos.costing.submitForApproval(v2Style.id);

    let writeCount = 0;
    const updatingListener = () => {
      writeCount += 1;
      // Fail on the 2nd put (i.e. after CST-01 was marked SUPERSEDED, fail when writing CST-RB-STYLE-V2 APPROVED!)
      if (writeCount === 2) {
        throw new Error('Simulated mid-transaction IndexedDB failure');
      }
    };
    db.cost_sheets.hook('updating', updatingListener);

    let midTxAborted = false;
    try {
      await repos.costing.approveCostSheet(v2Style.id, 'Mid-Tx Tester');
    } catch {
      midTxAborted = true;
    } finally {
      db.cost_sheets.hook('updating').unsubscribe(updatingListener);
    }

    const v1StyleAfter = await repos.costing.getCostSheetById('CST-01');
    const v2StyleAfter = await repos.costing.getCostSheetById(v2Style.id);
    hookRollbackOk =
      midTxAborted &&
      v1StyleAfter?.status === 'APPROVED' &&
      v1StyleAfter?.updatedAt === v1StyleBefore?.updatedAt &&
      v2StyleAfter?.status === 'SUBMITTED';

    const ok =
      failedOnApprove &&
      v1AfterFail?.status === 'APPROVED' &&
      v2AfterFail?.status === 'SUBMITTED' &&
      hookRollbackOk;

    results.push({
      testNumber: 12,
      category: 'INTEGRITY',
      name: 'Atomic Dexie Transaction Rollback on Failure',
      passed: ok,
      message: ok
        ? 'Verified full rollback when pre-check fails AND when a mid-transaction IndexedDB write fails after superseding v1 (v1 restored to APPROVED, v2 remained SUBMITTED).'
        : `Rollback failed: failedOnApprove=${failedOnApprove}, v1Status=${v1AfterFail?.status}, v2Status=${v2AfterFail?.status}, hookRollbackOk=${hookRollbackOk}`,
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 12, category: 'INTEGRITY', name: 'Atomic Dexie Transaction Rollback on Failure', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 13: Bit-for-Bit Calculation Consistency with costingCalculator.ts
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_13_CalcDelegation');
    const calcInput: CostingCalculationInput = {
      currency: 'EUR',
      lineItems: [
        {
          id: 'CALC-L1',
          category: 'FABRIC',
          description: 'Ripstop Meter -> Kg',
          materialId: 'MAT-04',
          bomItemId: 'BOM-06',
          consumptionPerGarment: 1.45,
          consumptionBasis: 'PER_PIECE',
          consumptionUnit: 'meters',
          stockUnit: 'meters',
          wastagePercent: 6,
          unitPrice: 3.1,
          currency: 'EUR',
        },
        {
          id: 'CALC-L2',
          category: 'TRIMS',
          description: 'Shell Buttons pcs -> gross',
          materialId: 'MAT-06',
          bomItemId: 'BOM-08',
          consumptionPerGarment: 2,
          consumptionBasis: 'PER_PIECE',
          consumptionUnit: 'pcs',
          stockUnit: 'gross',
          wastagePercent: 2,
          unitPrice: 7.2,
          currency: 'EUR',
        },
      ],
      categoryCosts: {
        PRINTING_EMBROIDERY: 0.45,
        OTHER: 0.25,
      },
      cmt: {
        method: 'SAM_RATE',
        samMinutes: 24.5,
        efficiencyPercent: 82,
        cmRatePerMinute: 0.14,
        cmRateBasis: 'STANDARD_MINUTE',
      },
      overhead: {
        method: 'PERCENT_OF_DIRECT_COST',
        value: 12,
      },
      commissionPercent: 3.5,
      pricingMode: 'MARGIN_TO_FOB',
      targetMarginPercent: 22,
    };

    const expected = calculateCostSheet(calcInput);
    const saved = await repos.costing.createCostSheet({
      id: 'CST-CALC-EXACT',
      styleId: 'STY-03',
      ...calcInput,
    });

    const ok =
      saved.fabricCost === expected.fabricCost &&
      saved.trimsCost === expected.trimsCost &&
      saved.printingEmbroideryCost === expected.printingEmbroideryCost &&
      saved.otherDirectCost === expected.otherDirectCost &&
      saved.laborCmtCost === expected.laborCmtCost &&
      saved.overheadCost === expected.overheadCost &&
      saved.totalCostPerGarment === expected.totalManufacturingCost &&
      saved.quotedFobPrice === expected.quotedFobPrice &&
      saved.marginPercent === expected.grossMarginPercent &&
      saved.markupPercent === expected.markupPercent &&
      saved.profitPerGarment === expected.profitPerGarment &&
      saved.commissionPercent === expected.commissionPercent;

    results.push({
      testNumber: 13,
      category: 'CRUD',
      name: 'Calculation Consistency with costingCalculator.ts',
      passed: ok,
      message: ok
        ? 'Persisted CostSheetEntity matches direct calculateCostSheet() output across every cost, CMT, overhead, commission, FOB, margin, and markup field.'
        : 'Repository persisted calculation deviated from costingCalculator.ts.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 13, category: 'CRUD', name: 'Calculation Consistency with costingCalculator.ts', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 14: Multi-Revision Chain & Branching Version Numbers
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_14_MultiRevisionChain');
    // Seeded CST-01 is v1 (APPROVED)
    const v2 = await repos.costing.createRevision('CST-01', {
      newId: 'CST-CH-V2',
      updates: { quotedFobPrice: 12.1 },
    });
    await repos.costing.submitForApproval(v2.id);
    await repos.costing.approveCostSheet(v2.id, 'Approver A');

    // Now branch v3 from original v1 (CST-01) rather than v2 -> must still be numbered v3 without colliding with v2!
    const v3 = await repos.costing.createRevision('CST-01', {
      newId: 'CST-CH-V3',
      updates: { quotedFobPrice: 12.9 },
    });
    await repos.costing.submitForApproval(v3.id);
    await repos.costing.approveCostSheet(v3.id, 'Approver B');

    const history = await repos.costing.getCostSheetVersions({ styleId: 'STY-01' });
    const h1 = history.find((h) => h.version === 1);
    const h2 = history.find((h) => h.version === 2);
    const h3 = history.find((h) => h.version === 3);

    const ok =
      history.length === 3 &&
      h1?.status === 'SUPERSEDED' &&
      h1?.approvedBy === 'Farhan Kabir (Costing Head)' &&
      h2?.status === 'SUPERSEDED' &&
      h2?.approvedBy === 'Approver A' &&
      h3?.status === 'APPROVED' &&
      h3?.approvedBy === 'Approver B' &&
      h3?.parentCostSheetId === 'CST-01';

    results.push({
      testNumber: 14,
      category: 'VERSIONING',
      name: 'Multi-Revision Chain & Branched Version Numbers',
      passed: ok,
      message: ok
        ? 'v1->v2->v3 chain preserved monotonic versions [1, 2, 3], independent approver history, and single active APPROVED v3.'
        : 'Multi-revision chain state failed.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 14, category: 'VERSIONING', name: 'Multi-Revision Chain & Branched Version Numbers', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 15: Compatibility with Seeded DEMO_COST_SHEETS
  // ------------------------------------------------------------------
  try {
    const { db, repos } = await setupSeededCostingTest('TestS3_15_DemoCompatibility');
    const c1 = await repos.costing.getActiveApprovedCostSheet({ styleId: 'STY-01' });
    const c2 = await repos.costing.getActiveApprovedCostSheet({ styleId: 'STY-02' });
    const c3 = await repos.costing.getActiveApprovedCostSheet({ styleId: 'STY-03' });

    const ok =
      c1?.id === 'CST-01' &&
      c1.currency === 'USD' &&
      c2?.id === 'CST-02' &&
      c3?.id === 'CST-03' &&
      c3.quotedFobPrice === 14.5;

    results.push({
      testNumber: 15,
      category: 'REGRESSION',
      name: 'Seeded Demo Cost Sheets Query Compatibility',
      passed: ok,
      message: ok
        ? 'All 3 seeded demo cost sheets (CST-01, CST-02, CST-03) are cleanly resolved as active APPROVED v1 records.'
        : 'Seeded demo cost sheet retrieval mismatch.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 15, category: 'REGRESSION', name: 'Seeded Demo Cost Sheets Query Compatibility', passed: false, message: err.message });
  }

  // ------------------------------------------------------------------
  // Test 16: Stage 1 & Stage 2 Regression Compatibility
  // ------------------------------------------------------------------
  try {
    const { db, repos, mrp } = await setupSeededCostingTest('TestS3_16_Stage1And2Regression');
    const mrpBefore = await mrp.generateOrderMrp('ORD-01');
    const balancesBefore = await repos.inventory.getAllStockBalances();
    const bomBefore = await repos.master.getBomByStyle('STY-01');

    // Run full costing creation, revision & approval lifecycle for ORD-01 / STY-01
    const ordCst = await repos.costing.createCostSheet({
      id: 'CST-REG-ORD01',
      styleId: 'STY-01',
      orderId: 'ORD-01',
      bomVersionRef: 1,
      currency: 'USD',
      categoryCosts: { FABRIC: 4.85, TRIMS: 1.1 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.2 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 11.75,
    });
    await repos.costing.submitForApproval(ordCst.id);
    await repos.costing.approveCostSheet(ordCst.id, 'Regression Tester');

    const mrpAfter = await mrp.generateOrderMrp('ORD-01');
    const balancesAfter = await repos.inventory.getAllStockBalances();
    const bomAfter = await repos.master.getBomByStyle('STY-01');

    const ok =
      JSON.stringify(mrpBefore.materialRequirements) ===
        JSON.stringify(mrpAfter.materialRequirements) &&
      JSON.stringify(balancesBefore) === JSON.stringify(balancesAfter) &&
      JSON.stringify(bomBefore) === JSON.stringify(bomAfter);

    results.push({
      testNumber: 16,
      category: 'REGRESSION',
      name: 'Stage 1 & Stage 2 Regression Compatibility',
      passed: ok,
      message: ok
        ? 'Costing lifecycle operations left BOM items, inventory balances, and ORD-01 MRP outputs 100% unchanged.'
        : 'Costing workflow unexpectedly modified BOM, MRP, or inventory state.',
    });
    db.close();
  } catch (err: any) {
    results.push({ testNumber: 16, category: 'REGRESSION', name: 'Stage 1 & Stage 2 Regression Compatibility', passed: false, message: err.message });
  }

  return {
    allPassed: results.every((r) => r.passed),
    results,
  };
}
