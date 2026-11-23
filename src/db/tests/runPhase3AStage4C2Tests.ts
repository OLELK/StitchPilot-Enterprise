/**
 * StitchPilot Enterprise — Phase 3A Stage 4C.2 Automated Test Suite
 * Costing UI, Workflow Interface, BOM Integration, Pricing Modes, Revisions & Preservation
 *
 * Covers all 18 Stage 4C.2 acceptance criteria:
 *  1. Costing overview loads existing records (with search & filters)
 *  2. Legacy cost sheets display safely without modification
 *  3. A draft can be created for a valid style and BOM version
 *  4. Invalid style/BOM/order combinations are rejected
 *  5. BOM components import correctly (style-level & order-level)
 *  6. Consumption, wastage and UOM calculations remain correct
 *  7. Missing material rates produce warnings & incomplete state
 *  8. Manual rates and overrides are persisted correctly
 *  9. Master-rate and manual-rate snapshots are distinguishable
 * 10. Additional costing inputs (CMT, overhead, processing/direct lines) recalculate correctly
 * 11. Cost per piece and lot totals are correct
 * 12. FOB calculations use the existing pricing modes correctly (margin vs markup + commission)
 * 13. Draft updates persist correctly without stale costPerGarment
 * 14. Submission and approval/rejection follow repository rules & workflow modal validation
 * 15. Approved historical versions cannot be overwritten
 * 16. Revisions preserve earlier versions & supersede cleanly
 * 17. Historical versions display in read-only mode
 * 18. Existing BOM, MRP, Orders and Inventory functionality remains unaffected
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase } from '../database';
import { createRepositories } from '../repositories';
import {
  applyManualRateOverride,
  createCostingBomService,
  updateConsumptionDrivenCostingLine,
} from '../services/costingBomService';
import { calculateCostSheet } from '../services/costingCalculator';
import { createMrpService } from '../services/mrpService';
import {
  DEMO_BUYERS,
  DEMO_MATERIALS,
  DEMO_ORDERS,
  DEMO_STYLES,
} from '../demoData';
import {
  InvalidStatusTransitionError,
  RelationshipValidationError,
  ValidationError,
} from '../errors';
import { OrderWithDetails } from '../hooks/useOrdersData';
import { CostingView } from '../../components/costing/CostingView';
import { CostSheetEditor } from '../../components/costing/CostSheetEditor';
import { CostSheetWorkflowModal } from '../../components/costing/CostSheetWorkflowModal';
import { BomMrpView } from '../../components/pages/BomMrpView';

export interface Phase3AStage4C2TestResult {
  testNumber: number;
  category:
    | 'OVERVIEW_UI'
    | 'LEGACY_SAFETY'
    | 'DRAFT_VALIDATION'
    | 'BOM_IMPORT'
    | 'RATES_SNAPSHOTS'
    | 'CALCULATION_PRICING'
    | 'WORKFLOW_REVISIONS'
    | 'PRESERVATION';
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const EPSILON = 1e-3;
function approxEq(a: number, b: number, eps = EPSILON): boolean {
  return Math.abs(a - b) <= eps;
}

async function setupSeededDb(dbName: string) {
  const customIDB = new IDBFactory();
  const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, dbName);
  const repos = createRepositories(db);
  const bomService = createCostingBomService(db);
  const mrpService = createMrpService(db);
  await db.open();
  await repos.system.initializeAndSeedIfEmpty();
  return { customIDB, db, repos, bomService, mrpService };
}

function buildDemoOrdersWithDetails(): OrderWithDetails[] {
  const buyerMap = new Map(DEMO_BUYERS.map((b) => [b.id, b]));
  const styleMap = new Map(DEMO_STYLES.map((s) => [s.id, s]));
  return DEMO_ORDERS.map((ord) => {
    const buyer = buyerMap.get(ord.buyerId);
    const style = styleMap.get(ord.styleId);
    return {
      ...ord,
      buyerName: buyer?.name || 'Unknown Buyer',
      buyerCode: buyer?.code || 'N/A',
      styleCode: style?.styleCode || 'N/A',
      styleDescription: style?.description || '',
      fabricSpec: style?.fabricClassification || '',
      samMinutes: style?.samMinutes || 0,
      lineName: ord.assignedLineId || 'Unassigned',
    };
  });
}

/**
 * Browser-safe & Node-safe minimal DOM harness for React 19 UI lifecycle tests.
 */
async function withTestDom<T>(
  fn: (ctx: {
    container: any;
    renderSync: (el: React.ReactElement) => void;
    flushEffects: (ms?: number) => Promise<void>;
    capturedErrors: string[];
  }) => Promise<T> | T
): Promise<T> {
  const hadDocument = typeof (globalThis as any).document !== 'undefined';
  const keysToRestore = [
    'window',
    'document',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLIFrameElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'Event',
    'addEventListener',
    'removeEventListener',
  ];
  const prevGlobals: Record<string, any> = {};
  keysToRestore.forEach((k) => {
    prevGlobals[k] = (globalThis as any)[k];
  });

  if (!hadDocument) {
    class MockText {
      nodeType = 3;
      nodeName = '#text';
      data: string;
      parentNode: any = null;
      previousSibling: any = null;
      nextSibling: any = null;
      constructor(t: string) {
        this.data = String(t);
      }
      get textContent() {
        return this.data;
      }
      set textContent(v: string) {
        this.data = String(v);
      }
      get nodeValue() {
        return this.data;
      }
      set nodeValue(v: string) {
        this.data = String(v);
      }
    }

    class MockNode {
      nodeType = 1;
      tagName: string;
      nodeName: string;
      namespaceURI = 'http://www.w3.org/1999/xhtml';
      childNodes: any[] = [];
      children: any[] = [];
      parentNode: any = null;
      previousSibling: any = null;
      nextSibling: any = null;
      attributes: Record<string, string> = {};
      listeners: Record<string, Function[]> = {};
      style: Record<string, any> = {};
      value: any = '';
      defaultValue: any = '';
      checked = false;
      disabled = false;
      selected = false;
      defaultSelected = false;
      multiple = false;
      className = '';
      classList = { add() {}, remove() {}, contains: () => false };
      constructor(tag: string) {
        this.tagName = tag.toUpperCase();
        this.nodeName = this.tagName;
      }
      get options() {
        return this.querySelectorAll('option');
      }
      get firstChild() {
        return this.childNodes[0] || null;
      }
      get lastChild() {
        return this.childNodes[this.childNodes.length - 1] || null;
      }
      get ownerDocument() {
        return (globalThis as any).document;
      }
      appendChild(c: any) {
        return this.insertBefore(c, null);
      }
      insertBefore(c: any, ref: any) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        const idx = ref ? this.childNodes.indexOf(ref) : -1;
        if (idx === -1) this.childNodes.push(c);
        else this.childNodes.splice(idx, 0, c);
        this._relink();
        return c;
      }
      removeChild(c: any) {
        const idx = this.childNodes.indexOf(c);
        if (idx >= 0) {
          this.childNodes.splice(idx, 1);
          c.parentNode = null;
          this._relink();
        }
        return c;
      }
      _relink() {
        this.children = this.childNodes.filter((n) => n.nodeType === 1);
        this.childNodes.forEach((n, i) => {
          n.previousSibling = i > 0 ? this.childNodes[i - 1] : null;
          n.nextSibling = i < this.childNodes.length - 1 ? this.childNodes[i + 1] : null;
        });
      }
      setAttribute(k: string, v: string) {
        this.attributes[k] = String(v);
        if (k === 'value') this.value = String(v);
        if (k === 'disabled') this.disabled = true;
      }
      getAttribute(k: string) {
        return this.attributes[k] ?? null;
      }
      hasAttribute(k: string) {
        return k in this.attributes;
      }
      removeAttribute(k: string) {
        delete this.attributes[k];
        if (k === 'disabled') this.disabled = false;
      }
      addEventListener(t: string, fn: Function) {
        (this.listeners[t] ||= []).push(fn);
      }
      removeEventListener(t: string, fn: Function) {
        this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn);
      }
      dispatchEvent(ev: any) {
        ev.target = ev.target || this;
        ev.currentTarget = this;
        (this.listeners[ev.type] || []).forEach((fn) => fn(ev));
        if (this.parentNode && ev.bubbles !== false) {
          this.parentNode.dispatchEvent(ev);
        }
        return true;
      }
      click() {
        const EvCtor = (globalThis as any).Event;
        this.dispatchEvent(new EvCtor('click', { bubbles: true, cancelable: true }));
      }
      focus() {}
      scrollIntoView() {}
      set textContent(v: string) {
        this.childNodes = v ? [new MockText(String(v))] : [];
        this._relink();
      }
      get textContent(): string {
        return this.childNodes.map((c) => c.textContent).join('');
      }
      querySelectorAll(sel: string): any {
        const matches: MockNode[] = [];
        const testIdMatch = sel.match(/^\[data-testid="(.+)"\]$/);
        const upper = sel.toUpperCase();
        const walk = (n: MockNode) => {
          for (const c of n.children) {
            if (testIdMatch) {
              if (c.attributes['data-testid'] === testIdMatch[1]) matches.push(c);
            } else if (c.tagName === upper) {
              matches.push(c);
            }
            walk(c);
          }
        };
        walk(this);
        const nodeList: any = {
          length: matches.length,
          item: (i: number) => matches[i] ?? null,
          [Symbol.iterator]: function* () {
            for (const m of matches) yield m;
          },
        };
        matches.forEach((m, i) => {
          nodeList[i] = m;
        });
        return nodeList;
      }
      querySelector(sel: string): any {
        return this.querySelectorAll(sel)[0] || null;
      }
    }

    const mockDoc: any = {
      nodeType: 9,
      defaultView: globalThis,
      createElement: (t: string) => new MockNode(t),
      createElementNS: (_ns: string, t: string) => new MockNode(t),
      createTextNode: (t: string) => new MockText(t),
      createComment: (t: string) => new MockText(t),
      activeElement: null,
      body: new MockNode('body'),
      documentElement: new MockNode('html'),
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    (globalThis as any).document = mockDoc;
    (globalThis as any).window = globalThis;
    (globalThis as any).addEventListener = () => {};
    (globalThis as any).removeEventListener = () => {};
    (globalThis as any).Node = MockNode;
    (globalThis as any).Element = MockNode;
    (globalThis as any).HTMLElement = MockNode;
    (globalThis as any).HTMLIFrameElement = MockNode;
    (globalThis as any).HTMLInputElement = MockNode;
    (globalThis as any).HTMLSelectElement = MockNode;
    (globalThis as any).HTMLTextAreaElement = MockNode;
    (globalThis as any).Event = class {
      type: string;
      bubbles = true;
      cancelable = true;
      constructor(t: string, init?: { bubbles?: boolean; cancelable?: boolean }) {
        this.type = t;
        if (init?.bubbles !== undefined) this.bubbles = init.bubbles;
        if (init?.cancelable !== undefined) this.cancelable = init.cancelable;
      }
      preventDefault() {}
      stopPropagation() {}
    };
  }

  const origConsoleError = console.error;
  const capturedErrors: string[] = [];
  console.error = (...args: any[]) => {
    capturedErrors.push(args.map((a) => String(a)).join(' '));
  };

  const container = (globalThis as any).document.createElement('div');
  (globalThis as any).document.body.appendChild(container);
  const root = createRoot(container);

  try {
    return await fn({
      container,
      renderSync: (el: React.ReactElement) => {
        flushSync(() => {
          root.render(el);
        });
      },
      flushEffects: async (ms = 30) => {
        await new Promise((r) => setTimeout(r, ms));
      },
      capturedErrors,
    });
  } finally {
    try {
      flushSync(() => {
        root.unmount();
      });
    } catch {
      // Ignore unmount errors
    }
    // Allow React 19 scheduler callbacks to drain before tearing down mock globals
    if (!hadDocument) {
      await new Promise((r) => setTimeout(r, 25));
    }
    try {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    } catch {
      // Ignore DOM removal errors
    }
    console.error = origConsoleError;
    if (!hadDocument) {
      keysToRestore.forEach((k) => {
        if (prevGlobals[k] === undefined) {
          delete (globalThis as any)[k];
        } else {
          (globalThis as any)[k] = prevGlobals[k];
        }
      });
    }
  }
}

export async function runPhase3AStage4C2Tests(): Promise<{
  allPassed: boolean;
  results: Phase3AStage4C2TestResult[];
}> {
  const results: Phase3AStage4C2TestResult[] = [];
  const demoOrdersWithDetails = buildDemoOrdersWithDetails();

  // =========================================================================
  // Test 1 — Costing overview loads existing records (UI mount + rows)
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T01');
    try {
      const check = await withTestDom(async ({ container, renderSync, flushEffects, capturedErrors }) => {
        renderSync(
          React.createElement(CostingView, {
            styles: DEMO_STYLES,
            orders: demoOrdersWithDetails,
            buyers: DEMO_BUYERS,
            materials: DEMO_MATERIALS,
            isDbReady: true,
            costingRepository: repos.costing,
            masterRepository: repos.master,
            bomService,
          })
        );
        await flushEffects(50);

        const text = container.textContent || '';
        const hasCst1 = !!container.querySelector('[data-testid="cost-sheet-row-CST-01"]');
        const hasCst2 = !!container.querySelector('[data-testid="cost-sheet-row-CST-02"]');
        const hasCst3 = !!container.querySelector('[data-testid="cost-sheet-row-CST-03"]');
        const totalText = container.querySelector('[data-testid="overview-total-count"]')?.textContent || '';
        const hasReactError = capturedErrors.some(
          (e) => e.includes('Invalid hook') || e.includes('Error')
        );

        return { hasCst1, hasCst2, hasCst3, totalText, hasStyleCode: text.includes('ST-402'), hasReactError };
      });

      const passed =
        check.hasCst1 &&
        check.hasCst2 &&
        check.hasCst3 &&
        check.totalText.trim() === '3' &&
        check.hasStyleCode &&
        !check.hasReactError;

      results.push({
        testNumber: 1,
        category: 'OVERVIEW_UI',
        name: 'Costing overview loads existing records cleanly',
        passed,
        message: passed
          ? 'CostingView mounted cleanly, loaded all 3 persisted cost sheets (CST-01, CST-02, CST-03) with style codes, versions, statuses, currencies, and zero React hook errors.'
          : `Overview check failed: ${JSON.stringify(check)}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 1,
      category: 'OVERVIEW_UI',
      name: 'Costing overview loads existing records cleanly',
      passed: false,
      message: `Test 1 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 2 — Legacy cost sheets display safely without modification
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T02');
    try {
      const beforeSheet = await repos.costing.getCostSheetById('CST-01');

      const check = await withTestDom(async ({ container, renderSync, flushEffects }) => {
        renderSync(
          React.createElement(CostingView, {
            styles: DEMO_STYLES,
            orders: demoOrdersWithDetails,
            buyers: DEMO_BUYERS,
            materials: DEMO_MATERIALS,
            isDbReady: true,
            costingRepository: repos.costing,
            masterRepository: repos.master,
            bomService,
          })
        );
        await flushEffects(50);

        const openBtn = container.querySelector('[data-testid="open-cost-sheet-btn-CST-01"]');
        if (openBtn) {
          flushSync(() => openBtn.click());
        }
        await flushEffects(40);

        const hasLegacyBanner = !!container.querySelector('[data-testid="costing-legacy-banner"]');
        const hasReadOnlyBanner = !!container.querySelector('[data-testid="costing-readonly-banner"]');
        const hasSaveBtn = !!container.querySelector('[data-testid="costing-save-draft-btn"]');
        const totalCostText = container.querySelector('[data-testid="summary-total-cost"]')?.textContent || '';
        const fobText = container.querySelector('[data-testid="summary-quoted-fob"]')?.textContent || '';

        return { hasLegacyBanner, hasReadOnlyBanner, hasSaveBtn, totalCostText, fobText };
      });

      const afterSheet = await repos.costing.getCostSheetById('CST-01');
      const unchangedInDb = JSON.stringify(beforeSheet) === JSON.stringify(afterSheet);

      const passed =
        check.hasLegacyBanner &&
        check.hasReadOnlyBanner &&
        !check.hasSaveBtn &&
        check.totalCostText.includes('8.7500') &&
        check.fobText.includes('11.5000') &&
        unchangedInDb;

      results.push({
        testNumber: 2,
        category: 'LEGACY_SAFETY',
        name: 'Legacy cost sheets display safely in read-only mode without mutation',
        passed,
        message: passed
          ? 'Legacy CST-01 displayed with Legacy Summary notice, read-only lock, original USD 8.7500 cost / USD 11.5000 FOB, and zero DB mutation.'
          : `Legacy check failed: ${JSON.stringify({ check, unchangedInDb })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 2,
      category: 'LEGACY_SAFETY',
      name: 'Legacy cost sheets display safely in read-only mode without mutation',
      passed: false,
      message: `Test 2 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 3 — Draft creation for a valid style and explicit BOM version
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T03');
    try {
      const importRes = await bomService.importBomToCostingLines({
        styleId: 'STY-01',
        bomVersion: 1,
        currency: 'USD',
        rateOverrides: {
          'MAT-02': 7.2,
          'MAT-03': 6.4,
          'MAT-07': 2.5,
          'MAT-08': 0.08,
        },
      });

      const draft = await repos.costing.createCostSheet({
        styleId: 'STY-01',
        bomVersionRef: importRes.bomVersionUsed,
        costingBasisQuantity: 2500,
        currency: 'USD',
        lineItems: importRes.lineItems,
        cmt: {
          method: 'SAM_RATE',
          samMinutes: 16.4,
          efficiencyPercent: 85,
          cmRatePerMinute: 0.11,
          cmRateBasis: 'ACTUAL_MINUTE',
        },
        overhead: { method: 'FIXED_PER_GARMENT', value: 0.65 },
        pricingMode: 'MARGIN_TO_FOB',
        targetMarginPercent: 22,
      });

      const persisted = await repos.costing.getCostSheetById(draft.id);
      const passed =
        !!persisted &&
        persisted.status === 'DRAFT' &&
        persisted.styleId === 'STY-01' &&
        persisted.bomVersionRef === 1 &&
        persisted.version === 2 &&
        (persisted.lineItems?.length || 0) === importRes.lineItems.length &&
        persisted.totalCostPerGarment > 0 &&
        persisted.quotedFobPrice > persisted.totalCostPerGarment;

      results.push({
        testNumber: 3,
        category: 'DRAFT_VALIDATION',
        name: 'Draft cost sheet created for valid style and BOM version',
        passed,
        message: passed
          ? `Created persisted DRAFT ${draft.id} (v${draft.version}, BOM v${draft.bomVersionRef}) with ${draft.lineItems?.length} BOM lines, cost USD ${draft.totalCostPerGarment}, FOB USD ${draft.quotedFobPrice}.`
          : 'Draft creation assertions failed.',
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 3,
      category: 'DRAFT_VALIDATION',
      name: 'Draft cost sheet created for valid style and BOM version',
      passed: false,
      message: `Test 3 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 4 — Invalid style/BOM/order combinations are rejected
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T04');
    try {
      let rejectedBadBomVersion = false;
      try {
        await repos.costing.createCostSheet({
          styleId: 'STY-01',
          bomVersionRef: 99,
          currency: 'USD',
          categoryCosts: { FABRIC: 3 },
          cmt: { method: 'DIRECT_CMT', directCmtCost: 1 },
          overhead: { method: 'FIXED_PER_GARMENT', value: 0.5 },
          pricingMode: 'FOB_TO_MARGIN',
          quotedFobPrice: 8,
        });
      } catch (err) {
        rejectedBadBomVersion = err instanceof RelationshipValidationError;
      }

      let rejectedMismatchedOrder = false;
      try {
        // ORD-02 belongs to STY-02, not STY-01
        await bomService.importBomToCostingLines({
          styleId: 'STY-01',
          orderId: 'ORD-02',
          bomVersion: 1,
          currency: 'USD',
        });
      } catch (err) {
        rejectedMismatchedOrder = err instanceof RelationshipValidationError;
      }

      let rejectedWrongStyleBomItem = false;
      try {
        await repos.costing.createCostSheet({
          styleId: 'STY-01',
          bomVersionRef: 1,
          currency: 'USD',
          lineItems: [
            {
              id: 'LI-BAD',
              category: 'FABRIC',
              description: 'Wrong style BOM ref',
              currency: 'USD',
              materialId: 'MAT-01',
              bomItemId: 'BOM-05', // belongs to STY-02
              costPerGarment: 2,
            },
          ],
          cmt: { method: 'DIRECT_CMT', directCmtCost: 1 },
          overhead: { method: 'FIXED_PER_GARMENT', value: 0.5 },
          pricingMode: 'FOB_TO_MARGIN',
          quotedFobPrice: 6,
        });
      } catch (err) {
        rejectedWrongStyleBomItem = err instanceof RelationshipValidationError;
      }

      const passed =
        rejectedBadBomVersion && rejectedMismatchedOrder && rejectedWrongStyleBomItem;

      results.push({
        testNumber: 4,
        category: 'DRAFT_VALIDATION',
        name: 'Invalid style, BOM version, and order relationships are rejected',
        passed,
        message: passed
          ? 'Rejected non-existent BOM version (v99), style/order mismatch (STY-01 + ORD-02), and cross-style bomItemId cleanly.'
          : `Rejection check failed: ${JSON.stringify({
              rejectedBadBomVersion,
              rejectedMismatchedOrder,
              rejectedWrongStyleBomItem,
            })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 4,
      category: 'DRAFT_VALIDATION',
      name: 'Invalid style, BOM version, and order relationships are rejected',
      passed: false,
      message: `Test 4 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 5 — BOM components import correctly via UI (CostSheetEditor)
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T05');
    try {
      // Configure master rates on STY-01 materials in isolated test DB
      await db.materials.update('MAT-02', { standardUnitCost: 7.5, costCurrency: 'USD' });
      await db.materials.update('MAT-03', { standardUnitCost: 6.2, costCurrency: 'USD' });
      await db.materials.update('MAT-07', { standardUnitCost: 2.4, costCurrency: 'USD' });
      await db.materials.update('MAT-08', { standardUnitCost: 0.05, costCurrency: 'USD' });

      const updatedMaterials = await repos.inventory.getAllMaterials();

      const check = await withTestDom(async ({ container, renderSync, flushEffects }) => {
        renderSync(
          React.createElement(CostingView, {
            styles: DEMO_STYLES,
            orders: demoOrdersWithDetails,
            buyers: DEMO_BUYERS,
            materials: updatedMaterials,
            isDbReady: true,
            costingRepository: repos.costing,
            masterRepository: repos.master,
            bomService,
          })
        );
        await flushEffects(50);

        const newBtn = container.querySelector('[data-testid="costing-new-sheet-btn"]');
        flushSync(() => newBtn.click());
        await flushEffects(50);

        const importBtn = container.querySelector('[data-testid="costing-import-bom-btn"]');
        flushSync(() => importBtn.click());
        await flushEffects(60);

        const lineRows = Array.from(container.querySelectorAll('tr')).filter((tr: any) =>
          String(tr.getAttribute('data-testid') || '').startsWith('cost-line-row-LI-BOM-')
        );
        const text = container.textContent || '';
        const hasMasterRateLabel = text.includes('Master Rate');
        const hasSummaryTotal = !!container.querySelector('[data-testid="summary-total-cost"]');

        return { rowCount: lineRows.length, hasMasterRateLabel, hasSummaryTotal };
      });

      const passed =
        check.rowCount === 3 && check.hasMasterRateLabel && check.hasSummaryTotal;

      results.push({
        testNumber: 5,
        category: 'BOM_IMPORT',
        name: 'BOM components import cleanly into CostSheetEditor worksheet',
        passed,
        message: passed
          ? `Imported ${check.rowCount} active BOM components for STY-01 into worksheet with Master Rate badges and live summary calculation.`
          : `BOM import UI check failed: ${JSON.stringify(check)}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 5,
      category: 'BOM_IMPORT',
      name: 'BOM components import cleanly into CostSheetEditor worksheet',
      passed: false,
      message: `Test 5 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 6 — Consumption, wastage and UOM calculations remain correct
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T06');
    try {
      // Create a woven fabric stocked in meters with GSM/width and a BOM line consumed in yards PER_DOZEN
      await repos.inventory.createMaterial({
        id: 'MAT-4C2-UOM',
        materialCode: 'WVN-UOM-4C2',
        name: 'Twill Cotton 200 GSM',
        category: 'Woven Fabric',
        spec: '200 GSM 150cm',
        unit: 'meters',
        reorderPoint: 100,
        warehouseLocation: 'Z-01',
        supplierName: 'Test Mill',
        standardUnitCost: 5.0,
        costCurrency: 'USD',
        uomAttributes: { gsm: 200, usableWidthCm: 150 },
        isSimulated: true,
      });

      await repos.master.createBomItem({
        id: 'BOM-4C2-UOM',
        styleId: 'STY-03',
        materialId: 'MAT-4C2-UOM',
        bomVersion: 2,
        status: 'ACTIVE',
        componentCategory: 'FABRIC',
        consumptionPerGarment: 24, // 24 yards per dozen = 2 yards per piece
        consumptionBasis: 'PER_DOZEN',
        consumptionUnit: 'yards',
        wastagePercent: 5, // 2 * 1.05 = 2.1 yards -> 2.1 * 0.9144 = 1.92024 meters -> * $5 = $9.6012
        placement: 'Cargo Body Shell',
        isMandatory: true,
        isSimulated: true,
        createdAt: new Date().toISOString(),
      });

      const imported = await bomService.importBomToCostingLines({
        styleId: 'STY-03',
        bomVersion: 2,
        currency: 'USD',
      });

      const calc = calculateCostSheet({
        currency: 'USD',
        lineItems: imported.lineItems,
        cmt: { method: 'DIRECT_CMT', directCmtCost: 2.0 },
        overhead: { method: 'FIXED_PER_GARMENT', value: 0.5 },
        pricingMode: 'FOB_TO_MARGIN',
        quotedFobPrice: 15.0,
      });

      const expectedFabricCost = 2 * 1.05 * 0.9144 * 5.0; // 9.6012
      const passed =
        approxEq(calc.fabricCost, expectedFabricCost, 1e-4) &&
        approxEq(calc.totalManufacturingCost, expectedFabricCost + 2.5, 1e-4);

      results.push({
        testNumber: 6,
        category: 'BOM_IMPORT',
        name: 'Consumption basis (PER_DOZEN), wastage %, and UOM (yards→meters) math verified',
        passed,
        message: passed
          ? `24 yds/doz + 5% wastage → meters @ USD 5.00/m = USD ${calc.fabricCost.toFixed(4)} (expected ${expectedFabricCost.toFixed(4)}).`
          : `Expected fabric cost ${expectedFabricCost}, got ${calc.fabricCost}.`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 6,
      category: 'BOM_IMPORT',
      name: 'Consumption basis (PER_DOZEN), wastage %, and UOM (yards→meters) math verified',
      passed: false,
      message: `Test 6 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 7 — Missing material rates produce warnings & incomplete state in UI
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T07');
    try {
      // Seeded DEMO_MATERIALS have no standardUnitCost -> importing STY-01 BOM triggers missing-rate warnings
      const check = await withTestDom(async ({ container, renderSync, flushEffects }) => {
        renderSync(
          React.createElement(CostingView, {
            styles: DEMO_STYLES,
            orders: demoOrdersWithDetails,
            buyers: DEMO_BUYERS,
            materials: DEMO_MATERIALS,
            isDbReady: true,
            costingRepository: repos.costing,
            masterRepository: repos.master,
            bomService,
          })
        );
        await flushEffects(50);

        flushSync(() => container.querySelector('[data-testid="costing-new-sheet-btn"]').click());
        await flushEffects(50);

        flushSync(() => container.querySelector('[data-testid="costing-import-bom-btn"]').click());
        await flushEffects(60);

        const warningsEl = container.querySelector('[data-testid="costing-bom-warnings"]');
        const incompleteEl = container.querySelector('[data-testid="costing-incomplete-summary"]');
        const saveBtn = container.querySelector('[data-testid="costing-save-draft-btn"]');

        return {
          hasWarningsBanner: !!warningsEl && (warningsEl.textContent || '').includes('Material Rate Attention Required'),
          hasIncompleteSummary: !!incompleteEl && (incompleteEl.textContent || '').includes('Incomplete Calculation'),
          saveBtnDisabled: !!saveBtn?.disabled,
        };
      });

      const passed =
        check.hasWarningsBanner && check.hasIncompleteSummary && check.saveBtnDisabled;

      results.push({
        testNumber: 7,
        category: 'RATES_SNAPSHOTS',
        name: 'Missing material rates show warning, mark calculation incomplete, and block save',
        passed,
        message: passed
          ? 'Missing standardUnitCost surfaced rate warning banner, displayed Incomplete Calculation state without inventing $0, and disabled Create Draft.'
          : `Missing rate check failed: ${JSON.stringify(check)}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 7,
      category: 'RATES_SNAPSHOTS',
      name: 'Missing material rates show warning, mark calculation incomplete, and block save',
      passed: false,
      message: `Test 7 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 8 — Manual rates and overrides are persisted correctly
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T08');
    try {
      const imported = await bomService.importBomToCostingLines({
        styleId: 'STY-02',
        bomVersion: 1,
        currency: 'USD',
      });

      // Apply manual rates via Stage 4C.1 helper
      const overriddenLines = imported.lineItems.map((line, idx) =>
        applyManualRateOverride(line, idx === 0 ? 8.25 : 0.12)
      );

      const created = await repos.costing.createCostSheet({
        styleId: 'STY-02',
        bomVersionRef: 1,
        currency: 'USD',
        lineItems: overriddenLines,
        cmt: { method: 'DIRECT_CMT', directCmtCost: 1.15 },
        overhead: { method: 'FIXED_PER_GARMENT', value: 0.3 },
        pricingMode: 'FOB_TO_MARGIN',
        quotedFobPrice: 6.5,
      });

      const reloaded = await repos.costing.getCostSheetById(created.id);
      const firstLine = reloaded?.lineItems?.[0];

      const passed =
        !!firstLine &&
        approxEq(firstLine.unitPrice, 8.25) &&
        firstLine.isRateOverridden === true &&
        firstLine.sourceType === 'BOM_IMPORT' &&
        !!firstLine.bomItemId &&
        firstLine.costPerGarment > 0;

      results.push({
        testNumber: 8,
        category: 'RATES_SNAPSHOTS',
        name: 'Manual material rates and overrides persist with BOM provenance intact',
        passed,
        message: passed
          ? `Persisted manual rate USD ${firstLine?.unitPrice} (isRateOverridden=true, bomItemId=${firstLine?.bomItemId}) cleanly to IndexedDB.`
          : 'Manual rate persistence assertions failed.',
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 8,
      category: 'RATES_SNAPSHOTS',
      name: 'Manual material rates and overrides persist with BOM provenance intact',
      passed: false,
      message: `Test 8 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 9 — Master-rate and manual-rate snapshots are distinguishable
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T09');
    try {
      await db.materials.update('MAT-01', { standardUnitCost: 6.0, costCurrency: 'USD' });
      await db.materials.update('MAT-03', { standardUnitCost: 5.5, costCurrency: 'USD' });

      const imported = await bomService.importBomToCostingLines({
        styleId: 'STY-02',
        bomVersion: 1,
        currency: 'USD',
      });

      // Keep MAT-01 at master rate (6.0), override MAT-03 (5.5 -> 6.8)
      const mixedLines = imported.lineItems.map((line) =>
        line.materialId === 'MAT-03' ? applyManualRateOverride(line, 6.8) : line
      );

      const saved = await repos.costing.createCostSheet({
        styleId: 'STY-02',
        bomVersionRef: 1,
        currency: 'USD',
        lineItems: mixedLines,
        cmt: { method: 'DIRECT_CMT', directCmtCost: 1.1 },
        overhead: { method: 'FIXED_PER_GARMENT', value: 0.25 },
        pricingMode: 'FOB_TO_MARGIN',
        quotedFobPrice: 5.5,
      });

      const masterLine = saved.lineItems?.find((l) => l.materialId === 'MAT-01');
      const overrideLine = saved.lineItems?.find((l) => l.materialId === 'MAT-03');

      // Also verify UI renders distinct "Master Rate" vs "Manual Override" labels
      const uiCheck = await withTestDom(async ({ container, renderSync, flushEffects }) => {
        renderSync(
          React.createElement(CostSheetEditor, {
            sheet: saved,
            versionHistory: [saved],
            styles: DEMO_STYLES,
            orders: demoOrdersWithDetails,
            buyers: DEMO_BUYERS,
            materials: await repos.inventory.getAllMaterials(),
            isMutating: false,
            onBackToOverview: () => {},
            onSelectVersion: () => {},
            onGetStyleBomVersions: (sid) => repos.master.getBomVersionsByStyle(sid),
            onImportBom: (opts) => bomService.importBomToCostingLines(opts),
            onCreateCostSheet: (inp) => repos.costing.createCostSheet(inp),
            onUpdateDraftCostSheet: (id, upd) => repos.costing.updateDraftCostSheet(id, upd),
            onCreateRevision: (id, opt) => repos.costing.createRevision(id, opt),
            onSubmitForApproval: (id) => repos.costing.submitForApproval(id),
            onApproveCostSheet: (id, by) => repos.costing.approveCostSheet(id, by),
            onRejectCostSheet: (id, r) => repos.costing.rejectCostSheet(id, r),
            onReopenRejectedCostSheet: (id) => repos.costing.reopenRejectedCostSheet(id),
          })
        );
        await flushEffects(40);
        const text = container.textContent || '';
        return {
          showsMaster: text.includes('Master Rate'),
          showsOverride: text.includes('Manual Override'),
          showsSnapshot: text.includes('Master: USD 5.5000'),
        };
      });

      const passed =
        masterLine?.isRateOverridden === false &&
        masterLine?.masterUnitCostSnapshot === 6.0 &&
        overrideLine?.isRateOverridden === true &&
        overrideLine?.masterUnitCostSnapshot === 5.5 &&
        overrideLine?.unitPrice === 6.8 &&
        uiCheck.showsMaster &&
        uiCheck.showsOverride &&
        uiCheck.showsSnapshot;

      results.push({
        testNumber: 9,
        category: 'RATES_SNAPSHOTS',
        name: 'Master-rate and manual-override snapshots are clearly distinguishable in data and UI',
        passed,
        message: passed
          ? 'Persisted master rate (MAT-01: USD 6.00) and overridden rate (MAT-03: USD 6.80 vs master snapshot USD 5.50) rendered distinctly.'
          : `Snapshot distinction failed: ${JSON.stringify({ masterLine, overrideLine, uiCheck })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 9,
      category: 'RATES_SNAPSHOTS',
      name: 'Master-rate and manual-override snapshots are clearly distinguishable in data and UI',
      passed: false,
      message: `Test 9 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 10 — Additional costing inputs recalculate correctly
  // =========================================================================
  try {
    const baseLines = [
      {
        id: 'LI-FAB',
        category: 'FABRIC' as const,
        description: 'Main Fleece',
        currency: 'USD',
        costPerGarment: 4.0,
      },
      {
        id: 'LI-PRT',
        category: 'PRINTING_EMBROIDERY' as const,
        description: 'Chest Puff Print',
        currency: 'USD',
        costPerGarment: 0.75,
      },
      {
        id: 'LI-WSH',
        category: 'WASHING_FINISHING' as const,
        description: 'Enzyme Silicone Wash',
        currency: 'USD',
        costPerGarment: 0.45,
      },
      {
        id: 'LI-OTH',
        category: 'OTHER' as const,
        description: 'Lab Compliance Testing',
        currency: 'USD',
        costPerGarment: 0.2,
      },
    ];

    // ACTUAL_MINUTE: (16 / 0.80) * 0.10 = 2.00; PERCENT_OF_CMT (25%) = 0.50
    const actualCalc = calculateCostSheet({
      currency: 'USD',
      lineItems: baseLines,
      cmt: {
        method: 'SAM_RATE',
        samMinutes: 16,
        efficiencyPercent: 80,
        cmRatePerMinute: 0.1,
        cmRateBasis: 'ACTUAL_MINUTE',
      },
      overhead: { method: 'PERCENT_OF_CMT', value: 25 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 10.0,
    });

    // STANDARD_MINUTE: 16 * 0.10 = 1.60; PERCENT_OF_DIRECT_COST (10%) of (5.4 + 1.6 = 7.0) = 0.70
    const stdCalc = calculateCostSheet({
      currency: 'USD',
      lineItems: baseLines,
      cmt: {
        method: 'SAM_RATE',
        samMinutes: 16,
        efficiencyPercent: 80,
        cmRatePerMinute: 0.1,
        cmRateBasis: 'STANDARD_MINUTE',
      },
      overhead: { method: 'PERCENT_OF_DIRECT_COST', value: 10 },
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 10.0,
    });

    const passed =
      approxEq(actualCalc.printingEmbroideryCost, 0.75) &&
      approxEq(actualCalc.washingFinishingCost, 0.45) &&
      approxEq(actualCalc.otherDirectCost, 0.2) &&
      approxEq(actualCalc.laborCmtCost, 2.0) &&
      approxEq(actualCalc.overheadCost, 0.5) &&
      approxEq(actualCalc.totalManufacturingCost, 7.9) &&
      approxEq(stdCalc.laborCmtCost, 1.6) &&
      approxEq(stdCalc.overheadCost, 0.7) &&
      approxEq(stdCalc.totalManufacturingCost, 7.7);

    results.push({
      testNumber: 10,
      category: 'CALCULATION_PRICING',
      name: 'CMT bases, overhead allocation methods, and processing/other direct lines recalculate accurately',
      passed,
      message: passed
        ? `ACTUAL_MINUTE + 25% CMT overhead = USD ${actualCalc.totalManufacturingCost}; STANDARD_MINUTE + 10% Direct overhead = USD ${stdCalc.totalManufacturingCost}.`
        : 'Additional costing inputs calculation mismatch.',
    });
  } catch (err: any) {
    results.push({
      testNumber: 10,
      category: 'CALCULATION_PRICING',
      name: 'CMT bases, overhead allocation methods, and processing/other direct lines recalculate accurately',
      passed: false,
      message: `Test 10 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 11 — Cost per piece and lot totals are rendered accurately in UI
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T11');
    try {
      const draft = await repos.costing.createCostSheet({
        styleId: 'STY-01',
        orderId: 'ORD-01',
        costingBasisQuantity: 1000,
        currency: 'USD',
        lineItems: [
          {
            id: 'LI-LOT-1',
            category: 'FABRIC',
            description: 'Lot Fabric',
            currency: 'USD',
            costPerGarment: 5.0,
          },
        ],
        cmt: { method: 'DIRECT_CMT', directCmtCost: 2.0 },
        overhead: { method: 'FIXED_PER_GARMENT', value: 1.0 },
        pricingMode: 'FOB_TO_MARGIN',
        quotedFobPrice: 10.0,
      });

      const uiCheck = await withTestDom(async ({ container, renderSync, flushEffects }) => {
        renderSync(
          React.createElement(CostSheetEditor, {
            sheet: draft,
            versionHistory: [draft],
            styles: DEMO_STYLES,
            orders: demoOrdersWithDetails,
            buyers: DEMO_BUYERS,
            materials: DEMO_MATERIALS,
            isMutating: false,
            onBackToOverview: () => {},
            onSelectVersion: () => {},
            onGetStyleBomVersions: (sid) => repos.master.getBomVersionsByStyle(sid),
            onImportBom: (opts) => bomService.importBomToCostingLines(opts),
            onCreateCostSheet: (inp) => repos.costing.createCostSheet(inp),
            onUpdateDraftCostSheet: (id, upd) => repos.costing.updateDraftCostSheet(id, upd),
            onCreateRevision: (id, opt) => repos.costing.createRevision(id, opt),
            onSubmitForApproval: (id) => repos.costing.submitForApproval(id),
            onApproveCostSheet: (id, by) => repos.costing.approveCostSheet(id, by),
            onRejectCostSheet: (id, r) => repos.costing.rejectCostSheet(id, r),
            onReopenRejectedCostSheet: (id) => repos.costing.reopenRejectedCostSheet(id),
          })
        );
        await flushEffects(40);
        return {
          totalCost: container.querySelector('[data-testid="summary-total-cost"]')?.textContent || '',
          quotedFob: container.querySelector('[data-testid="summary-quoted-fob"]')?.textContent || '',
          lotCost: container.querySelector('[data-testid="summary-lot-cost"]')?.textContent || '',
          lotRevenue: container.querySelector('[data-testid="summary-lot-revenue"]')?.textContent || '',
          lotProfit: container.querySelector('[data-testid="summary-lot-profit"]')?.textContent || '',
        };
      });

      const passed =
        uiCheck.totalCost.includes('8.0000') &&
        uiCheck.quotedFob.includes('10.0000') &&
        uiCheck.lotCost.includes('8,000.00') &&
        uiCheck.lotRevenue.includes('10,000.00') &&
        uiCheck.lotProfit.includes('2,000.00');

      results.push({
        testNumber: 11,
        category: 'CALCULATION_PRICING',
        name: 'Per-piece cost and lot totals (cost, quoted revenue, profit) display accurately',
        passed,
        message: passed
          ? `1,000 pcs lot rendered: Cost/pc USD 8.0000, FOB USD 10.0000, Lot Cost USD 8,000.00, Lot Revenue USD 10,000.00, Lot Profit USD 2,000.00.`
          : `Lot total UI check failed: ${JSON.stringify(uiCheck)}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 11,
      category: 'CALCULATION_PRICING',
      name: 'Per-piece cost and lot totals (cost, quoted revenue, profit) display accurately',
      passed: false,
      message: `Test 11 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 12 — FOB pricing modes (FOB_TO_MARGIN, MARGIN_TO_FOB, MARKUP_TO_FOB)
  // =========================================================================
  try {
    // Total Mfg Cost = 8.00, Commission = 5%
    // 1) FOB_TO_MARGIN @ FOB 10.00 -> Net FOB = 9.50, Profit = 1.50, Margin = 15%, Markup = 18.75%
    const fobMode = calculateCostSheet({
      currency: 'USD',
      categoryCosts: { FABRIC: 5.0 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.0 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 1.0 },
      commissionPercent: 5,
      pricingMode: 'FOB_TO_MARGIN',
      quotedFobPrice: 10.0,
    });

    // 2) MARGIN_TO_FOB @ 20% gross margin + 5% comm -> FOB = 8 / (1 - 0.25) = 10.6667
    const marginMode = calculateCostSheet({
      currency: 'USD',
      categoryCosts: { FABRIC: 5.0 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.0 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 1.0 },
      commissionPercent: 5,
      pricingMode: 'MARGIN_TO_FOB',
      targetMarginPercent: 20,
    });

    // 3) MARKUP_TO_FOB @ 25% markup + 5% comm -> Net FOB = 10.00, Quoted FOB = 10 / 0.95 = 10.5263
    const markupMode = calculateCostSheet({
      currency: 'USD',
      categoryCosts: { FABRIC: 5.0 },
      cmt: { method: 'DIRECT_CMT', directCmtCost: 2.0 },
      overhead: { method: 'FIXED_PER_GARMENT', value: 1.0 },
      commissionPercent: 5,
      pricingMode: 'MARKUP_TO_FOB',
      targetMarkupPercent: 25,
    });

    const passed =
      approxEq(fobMode.grossMarginPercent, 15.0, 0.01) &&
      approxEq(fobMode.markupPercent, 18.75, 0.01) &&
      approxEq(marginMode.quotedFobPrice, 10.6667, 0.001) &&
      approxEq(marginMode.grossMarginPercent, 20.0, 0.01) &&
      approxEq(markupMode.quotedFobPrice, 10.5263, 0.001) &&
      approxEq(markupMode.markupPercent, 25.0, 0.01) &&
      !approxEq(marginMode.quotedFobPrice, markupMode.quotedFobPrice, 0.05);

    results.push({
      testNumber: 12,
      category: 'CALCULATION_PRICING',
      name: 'All three FOB pricing modes distinguish gross margin from markup with commission',
      passed,
      message: passed
        ? `FOB→Margin (${fobMode.grossMarginPercent}% margin / ${fobMode.markupPercent}% markup), Margin→FOB (USD ${marginMode.quotedFobPrice}), Markup→FOB (USD ${markupMode.quotedFobPrice}) verified.`
        : 'Pricing mode calculation mismatch.',
    });
  } catch (err: any) {
    results.push({
      testNumber: 12,
      category: 'CALCULATION_PRICING',
      name: 'All three FOB pricing modes distinguish gross margin from markup with commission',
      passed: false,
      message: `Test 12 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 13 — Draft updates persist correctly without stale costPerGarment
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T13');
    try {
      await db.materials.update('MAT-01', { standardUnitCost: 5.0, costCurrency: 'USD' });
      await db.materials.update('MAT-03', { standardUnitCost: 4.0, costCurrency: 'USD' });

      const imported = await bomService.importBomToCostingLines({
        styleId: 'STY-02',
        bomVersion: 1,
        currency: 'USD',
      });

      const draft = await repos.costing.createCostSheet({
        styleId: 'STY-02',
        bomVersionRef: 1,
        currency: 'USD',
        lineItems: imported.lineItems,
        cmt: { method: 'DIRECT_CMT', directCmtCost: 1.0 },
        overhead: { method: 'FIXED_PER_GARMENT', value: 0.25 },
        pricingMode: 'FOB_TO_MARGIN',
        quotedFobPrice: 5.0,
      });

      const initialFabric = draft.fabricCost;

      // Update consumption-driven MAT-01 line rate from 5.0 -> 7.0 using helper
      const editedLines = (draft.lineItems || []).map((li) =>
        li.materialId === 'MAT-01'
          ? updateConsumptionDrivenCostingLine(li, { unitPrice: 7.0 })
          : li
      );

      const updated = await repos.costing.updateDraftCostSheet(draft.id, {
        lineItems: editedLines,
        quotedFobPrice: 6.0,
      });

      // MAT-01 is 0.22 kg @ 4.5% wastage -> delta = 0.22 * 1.045 * (7 - 5) = 0.4598
      const expectedNewFabric = initialFabric + 0.22 * 1.045 * 2.0;
      const passed =
        approxEq(updated.fabricCost, expectedNewFabric, 1e-3) &&
        updated.fabricCost > initialFabric &&
        approxEq(updated.quotedFobPrice, 6.0) &&
        updated.status === 'DRAFT';

      results.push({
        testNumber: 13,
        category: 'WORKFLOW_REVISIONS',
        name: 'Draft updates persist recalculated costs without stale line costPerGarment',
        passed,
        message: passed
          ? `Draft fabric cost updated cleanly from USD ${initialFabric.toFixed(4)} to USD ${updated.fabricCost.toFixed(4)} and persisted.`
          : `Draft update mismatch: initial=${initialFabric}, updated=${updated.fabricCost}, expected=${expectedNewFabric}.`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 13,
      category: 'WORKFLOW_REVISIONS',
      name: 'Draft updates persist recalculated costs without stale line costPerGarment',
      passed: false,
      message: `Test 13 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 14 — Submission, rejection, reopen & approval + workflow modal validation
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_4C2_T14');
    try {
      const draft = await repos.costing.createCostSheet({
        styleId: 'STY-02',
        currency: 'USD',
        categoryCosts: { FABRIC: 2.0, TRIMS: 0.4 },
        cmt: { method: 'DIRECT_CMT', directCmtCost: 1.0 },
        overhead: { method: 'FIXED_PER_GARMENT', value: 0.3 },
        pricingMode: 'FOB_TO_MARGIN',
        quotedFobPrice: 5.2,
      });

      // Cannot approve directly from DRAFT
      let blockedDirectApprove = false;
      try {
        await repos.costing.approveCostSheet(draft.id, 'Director');
      } catch (err) {
        blockedDirectApprove = err instanceof InvalidStatusTransitionError;
      }

      const submitted = await repos.costing.submitForApproval(draft.id);
      const rejected = await repos.costing.rejectCostSheet(
        submitted.id,
        'Fabric wastage too high'
      );
      const reopened = await repos.costing.reopenRejectedCostSheet(rejected.id);
      const resubmitted = await repos.costing.submitForApproval(reopened.id);

      // Verify CostSheetWorkflowModal validates empty approver name inline
      const modalCheck = await withTestDom(async ({ container, renderSync, flushEffects }) => {
        let calledApprove = false;
        renderSync(
          React.createElement(CostSheetWorkflowModal, {
            isOpen: true,
            mode: 'approve',
            costSheet: resubmitted,
            styleCode: 'ST-109',
            hasExistingApprovedVersion: true,
            onClose: () => {},
            onConfirmApprove: async () => {
              calledApprove = true;
            },
            onConfirmReject: async () => {},
          })
        );
        await flushEffects(30);

        const form = container.querySelector('form');
        const EvCtor = (globalThis as any).Event;
        flushSync(() => {
          form.dispatchEvent(new EvCtor('submit', { bubbles: true, cancelable: true }));
        });
        await flushEffects(20);

        const errorText = container.querySelector('[data-testid="workflow-modal-error"]')?.textContent || '';
        return { calledApprove, showsRequiredError: errorText.includes('Approver name is required') };
      });

      const { approved } = await repos.costing.approveCostSheet(
        resubmitted.id,
        'Farhan Kabir'
      );

      const passed =
        blockedDirectApprove &&
        submitted.status === 'SUBMITTED' &&
        rejected.status === 'REJECTED' &&
        rejected.rejectionReason === 'Fabric wastage too high' &&
        reopened.status === 'DRAFT' &&
        approved.status === 'APPROVED' &&
        approved.approvedBy === 'Farhan Kabir' &&
        !modalCheck.calledApprove &&
        modalCheck.showsRequiredError;

      results.push({
        testNumber: 14,
        category: 'WORKFLOW_REVISIONS',
        name: 'Workflow transitions (DRAFT→SUBMITTED→REJECTED→DRAFT→APPROVED) and modal validation enforced',
        passed,
        message: passed
          ? 'Blocked direct DRAFT→APPROVED, completed full reject/reopen/approve lifecycle, and verified inline modal required-field validation.'
          : 'Workflow transition or modal check failed.',
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 14,
      category: 'WORKFLOW_REVISIONS',
      name: 'Workflow transitions (DRAFT→SUBMITTED→REJECTED→DRAFT→APPROVED) and modal validation enforced',
      passed: false,
      message: `Test 14 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 15 — Approved historical versions cannot be overwritten
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_4C2_T15');
    try {
      const before = await repos.costing.getCostSheetById('CST-01');
      let blockedUpdate = false;
      try {
        await repos.costing.updateDraftCostSheet('CST-01', { quotedFobPrice: 99.99 });
      } catch (err) {
        blockedUpdate = err instanceof ValidationError;
      }
      const after = await repos.costing.getCostSheetById('CST-01');
      const passed = blockedUpdate && JSON.stringify(before) === JSON.stringify(after);

      results.push({
        testNumber: 15,
        category: 'WORKFLOW_REVISIONS',
        name: 'Approved historical cost sheets are strictly immutable and cannot be overwritten',
        passed,
        message: passed
          ? 'Attempt to modify APPROVED CST-01 threw ValidationError and preserved every historical field untouched.'
          : 'Immutability check failed.',
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 15,
      category: 'WORKFLOW_REVISIONS',
      name: 'Approved historical cost sheets are strictly immutable and cannot be overwritten',
      passed: false,
      message: `Test 15 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 16 — Revisions preserve earlier versions & supersede cleanly on approval
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_4C2_T16');
    try {
      const originalV1 = await repos.costing.getCostSheetById('CST-01');
      const v2 = await repos.costing.createRevision('CST-01', {
        updates: {
          quotedFobPrice: 12.25,
        },
      });
      await repos.costing.submitForApproval(v2.id);
      const { approved: approvedV2, superseded } = await repos.costing.approveCostSheet(
        v2.id,
        'Commercial Director'
      );

      const reloadedV1 = await repos.costing.getCostSheetById('CST-01');
      const versions = await repos.costing.getCostSheetVersions({ styleId: 'STY-01' });

      const passed =
        v2.version === 2 &&
        v2.parentCostSheetId === 'CST-01' &&
        approvedV2.status === 'APPROVED' &&
        superseded.length === 1 &&
        reloadedV1?.status === 'SUPERSEDED' &&
        reloadedV1?.quotedFobPrice === originalV1?.quotedFobPrice &&
        reloadedV1?.totalCostPerGarment === originalV1?.totalCostPerGarment &&
        reloadedV1?.approvedBy === originalV1?.approvedBy &&
        reloadedV1?.approvedAt === originalV1?.approvedAt &&
        versions.length === 2;

      results.push({
        testNumber: 16,
        category: 'WORKFLOW_REVISIONS',
        name: 'Revisions preserve earlier versions and cleanly supersede prior approved version',
        passed,
        message: passed
          ? `Branched v2 (${v2.id}) from CST-01, approved v2, and preserved CST-01 as SUPERSEDED with original USD ${reloadedV1?.quotedFobPrice} FOB & approval audit intact.`
          : 'Revision preservation check failed.',
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 16,
      category: 'WORKFLOW_REVISIONS',
      name: 'Revisions preserve earlier versions and cleanly supersede prior approved version',
      passed: false,
      message: `Test 16 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 17 — Historical versions display in read-only mode in Version History UI
  // =========================================================================
  try {
    const { db, repos, bomService } = await setupSeededDb('TestDB_4C2_T17');
    try {
      const v2 = await repos.costing.createRevision('CST-01', {
        updates: { quotedFobPrice: 12.5 },
      });
      const versions = await repos.costing.getCostSheetVersions({ styleId: 'STY-01' });

      const uiCheck = await withTestDom(async ({ container, renderSync, flushEffects }) => {
        renderSync(
          React.createElement(CostingView, {
            styles: DEMO_STYLES,
            orders: demoOrdersWithDetails,
            buyers: DEMO_BUYERS,
            materials: DEMO_MATERIALS,
            isDbReady: true,
            costingRepository: repos.costing,
            masterRepository: repos.master,
            bomService,
          })
        );
        await flushEffects(50);

        // Open v2 (DRAFT) first
        const openV2Btn = container.querySelector(`[data-testid="open-cost-sheet-btn-${v2.id}"]`);
        flushSync(() => openV2Btn.click());
        await flushEffects(50);

        const draftHasSaveBtn = !!container.querySelector('[data-testid="costing-save-draft-btn"]');
        const historySection = container.querySelector('[data-testid="costing-version-history"]');
        const hasV1InHistory = !!container.querySelector('[data-testid="version-history-item-CST-01"]');

        // Switch to historical v1 (CST-01) via version history panel
        const v1Btn = container.querySelector('[data-testid="version-history-item-CST-01"]');
        flushSync(() => v1Btn.click());
        await flushEffects(50);

        const v1ReadOnlyBanner = !!container.querySelector('[data-testid="costing-readonly-banner"]');
        const v1HasSaveBtn = !!container.querySelector('[data-testid="costing-save-draft-btn"]');
        const currencySelect = container.querySelector('[data-testid="costing-currency-select"]');

        return {
          draftHasSaveBtn,
          hasHistory: !!historySection,
          hasV1InHistory,
          v1ReadOnlyBanner,
          v1HasSaveBtn,
          currencyDisabled: !!currencySelect?.disabled,
        };
      });

      const passed =
        versions.length === 2 &&
        uiCheck.draftHasSaveBtn &&
        uiCheck.hasHistory &&
        uiCheck.hasV1InHistory &&
        uiCheck.v1ReadOnlyBanner &&
        !uiCheck.v1HasSaveBtn &&
        uiCheck.currencyDisabled;

      results.push({
        testNumber: 17,
        category: 'WORKFLOW_REVISIONS',
        name: 'Version history lists all revisions and opens historical versions strictly read-only',
        passed,
        message: passed
          ? 'Opened DRAFT v2 with Save controls, navigated to APPROVED v1 via Version History, and verified read-only lock & disabled controls.'
          : `Historical read-only UI check failed: ${JSON.stringify(uiCheck)}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 17,
      category: 'WORKFLOW_REVISIONS',
      name: 'Version history lists all revisions and opens historical versions strictly read-only',
      passed: false,
      message: `Test 17 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 18 — Existing BOM, MRP, Orders and Inventory functionality unaffected
  // =========================================================================
  try {
    const { db, repos, bomService, mrpService } = await setupSeededDb('TestDB_4C2_T18');
    try {
      const beforeBalances = await repos.inventory.getAllStockBalances();
      const beforeTxCount = (await db.inventory_transactions.toArray()).length;
      const beforeBomCount = (await db.bom_items.toArray()).length;
      const beforeOrdersCount = (await repos.orders.getAllOrders()).length;

      // Execute full costing workflow (import + create + submit + approve)
      const imp = await bomService.importBomToCostingLines({
        styleId: 'STY-01',
        orderId: 'ORD-01',
        bomVersion: 1,
        currency: 'USD',
        rateOverrides: {
          'MAT-02': 7.0,
          'MAT-03': 6.0,
          'MAT-07': 2.0,
        },
      });
      const cs = await repos.costing.createCostSheet({
        styleId: 'STY-01',
        orderId: 'ORD-01',
        bomVersionRef: 1,
        costingBasisQuantity: imp.costingBasisQuantity,
        currency: 'USD',
        lineItems: imp.lineItems,
        cmt: { method: 'DIRECT_CMT', directCmtCost: 2.1 },
        overhead: { method: 'FIXED_PER_GARMENT', value: 0.6 },
        pricingMode: 'MARGIN_TO_FOB',
        targetMarginPercent: 20,
      });
      await repos.costing.submitForApproval(cs.id);
      await repos.costing.approveCostSheet(cs.id, 'QA Auditor');

      // Verify Inventory, BOM, Orders, and Order MRP remain completely unaffected
      const afterBalances = await repos.inventory.getAllStockBalances();
      const afterTxCount = (await db.inventory_transactions.toArray()).length;
      const afterBomCount = (await db.bom_items.toArray()).length;
      const afterOrdersCount = (await repos.orders.getAllOrders()).length;
      const mrpRes = await mrpService.generateOrderMrp('ORD-01');

      // Also verify BomMrpView still renders cleanly
      const bomMrpCheck = await withTestDom(async ({ container, renderSync, flushEffects, capturedErrors }) => {
        renderSync(
          React.createElement(BomMrpView, {
            orders: demoOrdersWithDetails,
            styles: DEMO_STYLES,
            buyers: DEMO_BUYERS,
            materials: DEMO_MATERIALS,
            isDbReady: false,
          })
        );
        await flushEffects(30);
        return {
          hasBomTab: !!container.querySelector('[data-testid="bom-mrp-subtab-bom"]'),
          hasMrpTab: !!container.querySelector('[data-testid="bom-mrp-subtab-mrp"]'),
          noErrors: capturedErrors.length === 0,
        };
      });

      const passed =
        JSON.stringify(beforeBalances) === JSON.stringify(afterBalances) &&
        beforeTxCount === afterTxCount &&
        beforeBomCount === afterBomCount &&
        beforeOrdersCount === afterOrdersCount &&
        mrpRes.materialRequirements.length > 0 &&
        bomMrpCheck.hasBomTab &&
        bomMrpCheck.hasMrpTab &&
        bomMrpCheck.noErrors;

      results.push({
        testNumber: 18,
        category: 'PRESERVATION',
        name: 'Existing BOM, MRP, Orders, and Inventory balances remain completely unaffected',
        passed,
        message: passed
          ? `Inventory balances (${afterBalances.length} materials, ${afterTxCount} ledger txs), BOM items (${afterBomCount}), Orders (${afterOrdersCount}), Order MRP, and BomMrpView all intact.`
          : 'Preservation verification failed.',
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 18,
      category: 'PRESERVATION',
      name: 'Existing BOM, MRP, Orders, and Inventory functionality unaffected',
      passed: false,
      message: `Test 18 threw: ${err?.message}`,
    });
  }

  return {
    allPassed: results.every((r) => r.passed),
    results,
  };
}
