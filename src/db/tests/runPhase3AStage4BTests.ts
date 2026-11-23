/**
 * StitchPilot Enterprise — Phase 3A Stage 4B Automated Test Suite
 * Order MRP Interface: Individual Order MRP, Consolidated Multi-Order MRP,
 * Stock Availability & Shortages, Validation Guards, Read-Only Preservation & UI Safety
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase } from '../database';
import { createRepositories } from '../repositories';
import { createMrpService } from '../services/mrpService';
import { DEMO_BUYERS, DEMO_MATERIALS, DEMO_ORDERS, DEMO_STYLES } from '../demoData';
import { EntityNotFoundError, ValidationError } from '../errors';
import { OrderWithDetails } from '../hooks/useOrdersData';
import { OrderMrpView } from '../../components/mrp/OrderMrpView';
import { BomMrpView } from '../../components/pages/BomMrpView';

export interface Phase3AStage4BTestResult {
  testNumber: number;
  category:
    | 'SINGLE_ORDER_MRP'
    | 'MULTI_ORDER_MRP'
    | 'STOCK_SHORTAGE'
    | 'VALIDATION'
    | 'READ_ONLY_PRESERVATION'
    | 'UI_SAFETY';
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const EPSILON = 1e-4;
function approxEq(a: number, b: number, eps = EPSILON): boolean {
  return Math.abs(a - b) <= eps;
}

async function setupSeededDb(dbName: string) {
  const customIDB = new IDBFactory();
  const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, dbName);
  const repos = createRepositories(db);
  const mrpService = createMrpService(db);
  await db.open();
  await repos.system.initializeAndSeedIfEmpty();
  return { customIDB, db, repos, mrpService };
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
 * Uses the real browser DOM when run inside the browser DB Diagnostic Modal,
 * and installs a minimal React 19 compatible DOM shim only when running under Node.js.
 */
async function withTestDom<T>(
  fn: (ctx: {
    container: any;
    renderSync: (el: React.ReactElement) => void;
    flushEffects: () => Promise<void>;
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
      flushEffects: async () => {
        await new Promise((r) => setTimeout(r, 20));
      },
      capturedErrors,
    });
  } finally {
    try {
      flushSync(() => {
        root.unmount();
      });
    } catch {
      // Ignore unmount errors in cleanup
    }
    // Allow React 19 scheduler immediate/macrotask callbacks to drain before tearing down mock window
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

export async function runPhase3AStage4BTests(): Promise<{
  allPassed: boolean;
  results: Phase3AStage4BTestResult[];
}> {
  const results: Phase3AStage4BTestResult[] = [];

  // =========================================================================
  // Test 1: Individual Order MRP — Seeded ORD-01 full calculation & cutting reconciliation
  // =========================================================================
  try {
    const { db, mrpService } = await setupSeededDb('TestDB_S4B_SingleOrd01');
    const mrp = await mrpService.generateOrderMrp('ORD-01');

    // ORD-01 = 14,000 pcs STY-01 (Washed Charcoal).
    // MAT-02 (Fleece): 0.48 kg/pc * 14000 = 6720 net, +5% wastage = 336, gross = 7056 kg.
    // Cutting job CJ-01: allocated = 1800, issued = 1200, activeReserved = 600.
    // Remaining unallocated = 7056 - 1800 = 5256.
    // Warehouse MAT-02: physical = 3200 - 1200 = 2000, reserved = 600, available = 1400.
    // Net procurement shortage = max(0, 5256 - 1400) = 3856 kg.
    const mat02 = mrp.materialRequirements.find((m) => m.materialId === 'MAT-02');
    const mat03 = mrp.materialRequirements.find((m) => m.materialId === 'MAT-03');
    const mat07 = mrp.materialRequirements.find((m) => m.materialId === 'MAT-07');

    const passed =
      mrp.orderId === 'ORD-01' &&
      mrp.poNumber === 'PO-99410' &&
      mrp.totalGarmentPieces === 14000 &&
      !mrp.usedOrderQuantityFallback &&
      mrp.materialRequirements.length === 3 &&
      mat02 !== undefined &&
      approxEq(mat02.netBomRequirement, 6720) &&
      approxEq(mat02.wastageQuantity, 336) &&
      approxEq(mat02.grossBomRequirement, 7056) &&
      approxEq(mat02.existingCuttingAllocation, 1800) &&
      approxEq(mat02.alreadyIssued, 1200) &&
      approxEq(mat02.activeReservedForOrder, 600) &&
      approxEq(mat02.remainingUnallocatedRequirement, 5256) &&
      approxEq(mat02.physicalStock, 2000) &&
      approxEq(mat02.reservedStock, 600) &&
      approxEq(mat02.availableStock, 1400) &&
      approxEq(mat02.netProcurementRequirement, 3856) &&
      mat02.reconciledCuttingJobIds.includes('CJ-01') &&
      mat03 !== undefined &&
      approxEq(mat03.grossBomRequirement, 14000 * 0.08 * 1.04) &&
      mat07 !== undefined &&
      approxEq(mat07.grossBomRequirement, (14000 / 12) * 0.02 * 1.03);

    results.push({
      testNumber: 1,
      category: 'SINGLE_ORDER_MRP',
      name: 'Individual Order MRP Calculation & Cutting Reconciliation (ORD-01)',
      passed,
      message: passed
        ? 'ORD-01 MRP matched exact gross/net/wastage (7056/6720/336 kg), cutting reconciliation (alloc 1800, issued 1200, active res 600, rem 5256), stock (avail 1400), and shortage (3856 kg).'
        : `ORD-01 MRP mismatch: mat02=${JSON.stringify(mat02)}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 1,
      category: 'SINGLE_ORDER_MRP',
      name: 'Individual Order MRP Calculation & Cutting Reconciliation (ORD-01)',
      passed: false,
      message: `Test 1 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 2: Individual Order MRP Colour & Size Matrix Breakdown + Size Override
  // =========================================================================
  try {
    const { db, repos, mrpService } = await setupSeededDb('TestDB_S4B_ColorSize');

    // Add a SPECIFIC colour/size trim item on STY-01 with XL sizeConsumptionMap override
    await repos.master.createBomItem({
      id: 'BOM-S4B-SPEC-1',
      styleId: 'STY-01',
      materialId: 'MAT-05', // YKK zipper, pcs
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'TRIM',
      consumptionPerGarment: 1,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 0,
      placement: 'Half-Zip Placket (L & XL Only)',
      colorScope: 'SPECIFIC',
      applicableColors: ['Washed Charcoal'],
      sizeScope: 'SPECIFIC',
      applicableSizes: ['L', 'XL'],
      sizeConsumptionMap: { XL: 2 },
      isMandatory: false,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    });

    const mrp = await mrpService.generateOrderMrp('ORD-01');
    // ORD-01 has L=3000 (1 pc/garment = 3000) and XL=1500 (override 2 pcs/garment = 3000) => total 6000 pcs
    const mat05 = mrp.materialRequirements.find((m) => m.materialId === 'MAT-05');
    const charcoalColor = mat05?.byColor.find((c) => c.color === 'Washed Charcoal');
    const specLine = mrp.lineCalculations.find((l) => l.bomItemId === 'BOM-S4B-SPEC-1');
    const lCell = specLine?.cellBreakdowns.find((c) => c.size === 'L');
    const xlCell = specLine?.cellBreakdowns.find((c) => c.size === 'XL');

    const passed =
      mat05 !== undefined &&
      approxEq(mat05.grossBomRequirement, 6000) &&
      charcoalColor !== undefined &&
      approxEq(charcoalColor.grossStockQty, 6000) &&
      specLine !== undefined &&
      specLine.cellBreakdowns.length === 2 &&
      lCell !== undefined &&
      approxEq(lCell.grossConsumptionQty, 3000) &&
      xlCell !== undefined &&
      approxEq(xlCell.grossConsumptionQty, 3000) &&
      xlCell.garmentPieces === 1500;

    results.push({
      testNumber: 2,
      category: 'SINGLE_ORDER_MRP',
      name: 'Individual Order MRP Colour & Size Scope Filtering + Size Override',
      passed,
      message: passed
        ? 'SPECIFIC colour/size BOM item filtered ORD-01 to L (3,000 pcs) and XL (1,500 × 2 = 3,000 pcs) = 6,000 pcs total with accurate cellBreakdowns.'
        : `Colour/size breakdown mismatch: mat05=${JSON.stringify(mat05)}, cells=${JSON.stringify(specLine?.cellBreakdowns)}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 2,
      category: 'SINGLE_ORDER_MRP',
      name: 'Individual Order MRP Colour & Size Scope Filtering + Size Override',
      passed: false,
      message: `Test 2 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 3: Individual Order MRP Explicit BOM Version Override (v1 vs v2)
  // =========================================================================
  try {
    const { db, repos, mrpService } = await setupSeededDb('TestDB_S4B_BomVersion');

    // Clone STY-01 v1 -> v2 and raise MAT-02 consumption from 0.48 to 0.60 kg/pc in v2
    const clonedItems = await repos.master.cloneBomVersion('STY-01', 1);
    const v2Fleece = clonedItems.find((i) => i.materialId === 'MAT-02');
    if (!v2Fleece) throw new Error('Cloned v2 MAT-02 item not found');
    await repos.master.updateBomItem(v2Fleece.id, { consumptionPerGarment: 0.6 });

    const mrpV1 = await mrpService.generateOrderMrp('ORD-01', {
      bomVersionByStyle: { 'STY-01': 1 },
    });
    const mrpV2 = await mrpService.generateOrderMrp('ORD-01', {
      bomVersionByStyle: { 'STY-01': 2 },
    });

    const fleeceV1 = mrpV1.materialRequirements.find((m) => m.materialId === 'MAT-02');
    const fleeceV2 = mrpV2.materialRequirements.find((m) => m.materialId === 'MAT-02');

    // v1 gross: 14000 * 0.48 * 1.05 = 7056; v2 gross: 14000 * 0.60 * 1.05 = 8820
    const passed =
      mrpV1.bomVersionUsedByStyle['STY-01'] === 1 &&
      mrpV2.bomVersionUsedByStyle['STY-01'] === 2 &&
      fleeceV1 !== undefined &&
      fleeceV2 !== undefined &&
      approxEq(fleeceV1.grossBomRequirement, 7056) &&
      approxEq(fleeceV2.grossBomRequirement, 8820);

    results.push({
      testNumber: 3,
      category: 'SINGLE_ORDER_MRP',
      name: 'Individual Order MRP Explicit BOM Version Override (v1 vs v2)',
      passed,
      message: passed
        ? 'BOM version selector cleanly isolated STY-01 v1 (7,056 kg gross) from modified v2 (8,820 kg gross).'
        : `Version override mismatch: v1=${fleeceV1?.grossBomRequirement}, v2=${fleeceV2?.grossBomRequirement}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 3,
      category: 'SINGLE_ORDER_MRP',
      name: 'Individual Order MRP Explicit BOM Version Override (v1 vs v2)',
      passed: false,
      message: `Test 3 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 4: Consolidated Multi-Order MRP Shared Material Aggregation Without Double-Counting Stock
  // =========================================================================
  try {
    const { db, mrpService } = await setupSeededDb('TestDB_S4B_MultiShared');

    const single1 = await mrpService.generateOrderMrp('ORD-01');
    const single2 = await mrpService.generateOrderMrp('ORD-02');
    const consolidated = await mrpService.generateMultiOrderMrp(['ORD-01', 'ORD-02']);

    // MAT-03 (2x2 Rib Knit) is shared between STY-01 (ORD-01) and STY-02 (ORD-02).
    // ORD-01 gross: 14000 * 0.08 * 1.04 = 1164.8 kg (alloc 0)
    // ORD-02 gross: 28000 * 0.03 * 1.03 = 865.2 kg (alloc 0)
    // Combined gross: 2030.0 kg
    // Warehouse available stock MAT-03 = 650 kg (MUST BE APPLIED ONCE, NOT 2 × 650 = 1300!)
    // Individual shortages: (1164.8 - 650) + (865.2 - 650) = 514.8 + 215.2 = 730 kg (wrong if summed!)
    // Consolidated shortage: 2030.0 - 650 = 1380.0 kg (correct shared-pool shortage!)
    const s1Rib = single1.materialRequirements.find((m) => m.materialId === 'MAT-03');
    const s2Rib = single2.materialRequirements.find((m) => m.materialId === 'MAT-03');
    const consRib = consolidated.consolidatedMaterials.find((m) => m.materialId === 'MAT-03');

    const passed =
      s1Rib !== undefined &&
      s2Rib !== undefined &&
      consRib !== undefined &&
      approxEq(
        consRib.totalGrossBomRequirement,
        s1Rib.grossBomRequirement + s2Rib.grossBomRequirement
      ) &&
      approxEq(consRib.totalGrossBomRequirement, 2030) &&
      approxEq(consRib.availableStock, 650) &&
      approxEq(consRib.netProcurementRequirement, 1380) &&
      consRib.netProcurementRequirement >
        s1Rib.netProcurementRequirement + s2Rib.netProcurementRequirement;

    results.push({
      testNumber: 4,
      category: 'MULTI_ORDER_MRP',
      name: 'Consolidated Multi-Order MRP Shared Material Aggregation (No Stock Double-Count)',
      passed,
      message: passed
        ? 'Shared MAT-03 combined gross (1,164.8 + 865.2 = 2,030 kg) deducted 650 kg available stock ONCE -> 1,380 kg consolidated shortage (vs 730 kg naive sum).'
        : `Consolidated MAT-03 mismatch: cons=${JSON.stringify(consRib)}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 4,
      category: 'MULTI_ORDER_MRP',
      name: 'Consolidated Multi-Order MRP Shared Material Aggregation (No Stock Double-Count)',
      passed: false,
      message: `Test 4 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 5: Consolidated vs Individual Order Breakdown & Traceability Alignment
  // =========================================================================
  try {
    const { db, mrpService } = await setupSeededDb('TestDB_S4B_Traceability');

    const consolidated = await mrpService.generateMultiOrderMrp(['ORD-01', 'ORD-02', 'ORD-03']);
    const consRib = consolidated.consolidatedMaterials.find((m) => m.materialId === 'MAT-03');

    const breakdownById = new Map(consolidated.orderBreakdowns.map((b) => [b.orderId, b]));
    const traceSumGross =
      consRib?.orderTraceability.reduce((sum, t) => sum + t.grossBomRequirement, 0) ?? 0;
    const traceSumRemaining =
      consRib?.orderTraceability.reduce((sum, t) => sum + t.remainingUnallocatedRequirement, 0) ??
      0;

    // Verify each traceability entry strictly equals its individual orderBreakdown line
    const everyTraceMatchesBreakdown =
      consRib !== undefined &&
      consRib.orderTraceability.length === 2 &&
      consRib.orderTraceability.every((t) => {
        const ordMrp = breakdownById.get(t.orderId);
        const ordMat = ordMrp?.materialRequirements.find((m) => m.materialId === 'MAT-03');
        return (
          ordMat !== undefined &&
          approxEq(t.grossBomRequirement, ordMat.grossBomRequirement) &&
          approxEq(t.existingCuttingAllocation, ordMat.existingCuttingAllocation) &&
          approxEq(t.remainingUnallocatedRequirement, ordMat.remainingUnallocatedRequirement)
        );
      });

    const colorNames = consRib?.byColor.map((c) => c.color) ?? [];

    const passed =
      consolidated.orderBreakdowns.length === 3 &&
      consolidated.includedOrderIds.length === 3 &&
      consRib !== undefined &&
      approxEq(traceSumGross, consRib.totalGrossBomRequirement) &&
      approxEq(traceSumRemaining, consRib.totalRemainingUnallocatedRequirement) &&
      everyTraceMatchesBreakdown &&
      colorNames.includes('Washed Charcoal') &&
      colorNames.includes('Optical White');

    results.push({
      testNumber: 5,
      category: 'MULTI_ORDER_MRP',
      name: 'Consolidated Order Traceability Strictly Matches Individual Order Breakdowns',
      passed,
      message: passed
        ? 'All 3 individual orderBreakdowns preserved alongside consolidated totals; MAT-03 orderTraceability and colour buckets reconcile exactly.'
        : `Traceability mismatch: breakdowns=${consolidated.orderBreakdowns.length}, traceSumGross=${traceSumGross}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 5,
      category: 'MULTI_ORDER_MRP',
      name: 'Consolidated Order Traceability Strictly Matches Individual Order Breakdowns',
      passed: false,
      message: `Test 5 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 6: Stock Availability, Shortage & Stock-Covered Indicator Verification
  // =========================================================================
  try {
    const { db, repos, mrpService } = await setupSeededDb('TestDB_S4B_StockCover');

    // Check ORD-01 before receiving extra stock: MAT-07 (thread cones) has 380 cones available vs ~24.03 cones required => Stock Covered!
    // MAT-02 (fleece) has 1400 kg available vs 5256 remaining => Shortage (3856 kg, discrete 3856)!
    const before = await mrpService.generateOrderMrp('ORD-01');
    const threadBefore = before.materialRequirements.find((m) => m.materialId === 'MAT-07');
    const fleeceBefore = before.materialRequirements.find((m) => m.materialId === 'MAT-02');

    // Now receive 4,000 kg of MAT-02 so available stock becomes 5,400 kg (> 5,256 remaining)
    await repos.inventory.postTransaction({
      idempotencyKey: 'TX-S4B-COVER-MAT02',
      materialId: 'MAT-02',
      transactionType: 'PO_RECEIPT',
      quantity: 4000,
      referenceType: 'PURCHASE_ORDER',
      referenceId: 'PO-S4B-REPLENISH',
    });

    const after = await mrpService.generateOrderMrp('ORD-01');
    const fleeceAfter = after.materialRequirements.find((m) => m.materialId === 'MAT-02');

    const passed =
      threadBefore !== undefined &&
      threadBefore.netProcurementRequirement === 0 &&
      threadBefore.discreteOrderUnits === 0 &&
      threadBefore.availableStock > threadBefore.remainingUnallocatedRequirement &&
      fleeceBefore !== undefined &&
      approxEq(fleeceBefore.netProcurementRequirement, 3856) &&
      fleeceBefore.discreteOrderUnits === Math.ceil(fleeceBefore.netProcurementRequirement) &&
      fleeceAfter !== undefined &&
      approxEq(fleeceAfter.availableStock, 5400) &&
      fleeceAfter.netProcurementRequirement === 0 &&
      fleeceAfter.discreteOrderUnits === 0;

    results.push({
      testNumber: 6,
      category: 'STOCK_SHORTAGE',
      name: 'Stock Availability, Procurement Shortage & Stock-Covered Transitions',
      passed,
      message: passed
        ? 'Verified MAT-07 stock-covered (0 shortage), MAT-02 shortage (3,856 kg) and transition to 0 shortage after 4,000 kg PO receipt.'
        : `Stock cover transition mismatch: fleeceBefore=${fleeceBefore?.netProcurementRequirement}, fleeceAfter=${fleeceAfter?.netProcurementRequirement}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 6,
      category: 'STOCK_SHORTAGE',
      name: 'Stock Availability, Procurement Shortage & Stock-Covered Transitions',
      passed: false,
      message: `Test 6 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 7: Empty, Non-Existent & Cancelled Order Selection Validation Guards
  // =========================================================================
  try {
    const { db, repos, mrpService } = await setupSeededDb('TestDB_S4B_Validation');

    // 1. Empty array -> ValidationError
    let emptyArrayRejected = false;
    try {
      await mrpService.generateMultiOrderMrp([]);
    } catch (e) {
      emptyArrayRejected = e instanceof ValidationError;
    }

    // 2. Non-existent order ID -> EntityNotFoundError
    let missingOrderRejected = false;
    try {
      await mrpService.generateOrderMrp('ORD-NON-EXISTENT-999');
    } catch (e) {
      missingOrderRejected = e instanceof EntityNotFoundError;
    }

    // 3. Cancel ORD-03 and test both single-order rejection and all-cancelled multi-order rejection
    await repos.orders.cancelOrder('ORD-03', 'Buyer postponed season');

    let cancelledSingleRejected = false;
    try {
      await mrpService.generateOrderMrp('ORD-03');
    } catch (e) {
      cancelledSingleRejected = e instanceof ValidationError;
    }

    let allCancelledMultiRejected = false;
    try {
      await mrpService.generateMultiOrderMrp(['ORD-03'], { excludeCancelled: true });
    } catch (e) {
      allCancelledMultiRejected = e instanceof ValidationError;
    }

    const passed =
      emptyArrayRejected &&
      missingOrderRejected &&
      cancelledSingleRejected &&
      allCancelledMultiRejected;

    results.push({
      testNumber: 7,
      category: 'VALIDATION',
      name: 'Empty, Missing & Cancelled Order Selection Validation Guards',
      passed,
      message: passed
        ? 'All invalid MRP selections rejected cleanly: empty multi-order array, missing order ID, cancelled single order, and all-cancelled batch.'
        : `Validation guard flags: empty=${emptyArrayRejected}, missing=${missingOrderRejected}, cancelledSingle=${cancelledSingleRejected}, allCancelledMulti=${allCancelledMultiRejected}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 7,
      category: 'VALIDATION',
      name: 'Empty, Missing & Cancelled Order Selection Validation Guards',
      passed: false,
      message: `Test 7 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 8: Mixed Active + Cancelled Consolidated MRP Exclusion Behaviour
  // =========================================================================
  try {
    const { db, repos, mrpService } = await setupSeededDb('TestDB_S4B_MixedCancel');
    await repos.orders.cancelOrder('ORD-03', 'Cancelled for mixed batch test');

    const consolidated = await mrpService.generateMultiOrderMrp(['ORD-01', 'ORD-02', 'ORD-03'], {
      excludeCancelled: true,
    });

    const passed =
      consolidated.includedOrderIds.length === 2 &&
      consolidated.includedOrderIds.includes('ORD-01') &&
      consolidated.includedOrderIds.includes('ORD-02') &&
      !consolidated.includedOrderIds.includes('ORD-03') &&
      consolidated.excludedCancelledOrders.length === 1 &&
      consolidated.excludedCancelledOrders[0].orderId === 'ORD-03' &&
      consolidated.excludedCancelledOrders[0].poNumber === 'PO-99413' &&
      consolidated.excludedCancelledOrders[0].reason.includes('CANCELLED');

    results.push({
      testNumber: 8,
      category: 'MULTI_ORDER_MRP',
      name: 'Mixed Active + Cancelled Consolidated MRP Exclusion & Warning',
      passed,
      message: passed
        ? 'Consolidated MRP excluded cancelled ORD-03 (PO-99413) with explicit excludedCancelledOrders record and warning while planning active ORD-01 & ORD-02.'
        : `Mixed cancellation result unexpected: includedOrderIds=${JSON.stringify(consolidated.includedOrderIds)}, excluded=${JSON.stringify(consolidated.excludedCancelledOrders)}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 8,
      category: 'MULTI_ORDER_MRP',
      name: 'Mixed Active + Cancelled Consolidated MRP Exclusion & Warning',
      passed: false,
      message: `Test 8 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 9: Fallback Order Quantity Warning (ORD-03) & Archived BOM Exclusion
  // =========================================================================
  try {
    const { db, repos, mrpService } = await setupSeededDb('TestDB_S4B_FallbackArchive');

    // Archive BOM-08 (Shell Button) on STY-03 so it must be excluded & reported
    await repos.master.archiveBomItem('BOM-08');

    // ORD-03 has 0 order_items in DEMO_ORDER_ITEMS => falls back to orderQuantity=12000
    const mrp = await mrpService.generateOrderMrp('ORD-03');

    const hasMat06 = mrp.materialRequirements.some((m) => m.materialId === 'MAT-06');
    const mat04 = mrp.materialRequirements.find((m) => m.materialId === 'MAT-04');

    const passed =
      mrp.usedOrderQuantityFallback === true &&
      mrp.totalGarmentPieces === 12000 &&
      mrp.warnings.some((w) => w.includes('order_items') && w.includes('falling back')) &&
      !hasMat06 &&
      mrp.archivedComponentsExcluded.some((a) => a.bomItemId === 'BOM-08') &&
      mat04 !== undefined &&
      approxEq(mat04.grossBomRequirement, 12000 * 1.45 * 1.06);

    results.push({
      testNumber: 9,
      category: 'SINGLE_ORDER_MRP',
      name: 'Fallback Order Quantity Warning (ORD-03) & Archived BOM Component Exclusion',
      passed,
      message: passed
        ? 'ORD-03 flagged usedOrderQuantityFallback=true with explicit warning and excluded archived BOM-08 (MAT-06) with archivedComponentsExcluded audit entry.'
        : `Fallback/archive check failed: fallback=${mrp.usedOrderQuantityFallback}, excluded=${JSON.stringify(mrp.archivedComponentsExcluded)}, hasMat06=${hasMat06}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 9,
      category: 'SINGLE_ORDER_MRP',
      name: 'Fallback Order Quantity Warning (ORD-03) & Archived BOM Component Exclusion',
      passed: false,
      message: `Test 9 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 10: Strict Read-Only Execution — Zero Mutations to Inventory, Orders, BOMs or Tables
  // =========================================================================
  try {
    const { db, repos, mrpService } = await setupSeededDb('TestDB_S4B_ReadOnly');

    const countsBefore = await repos.system.getTableCounts();
    const balancesBefore = await repos.inventory.getAllStockBalances();
    const txsBefore = await db.inventory_transactions.toArray();
    const ordersBefore = await db.orders.toArray();
    const bomsBefore = await db.bom_items.toArray();

    // Execute multiple single-order and consolidated MRP calculations
    await mrpService.generateOrderMrp('ORD-01');
    await mrpService.generateOrderMrp('ORD-02');
    await mrpService.generateOrderMrp('ORD-03');
    await mrpService.generateMultiOrderMrp(['ORD-01', 'ORD-02', 'ORD-03']);

    const countsAfter = await repos.system.getTableCounts();
    const balancesAfter = await repos.inventory.getAllStockBalances();
    const txsAfter = await db.inventory_transactions.toArray();
    const ordersAfter = await db.orders.toArray();
    const bomsAfter = await db.bom_items.toArray();

    const passed =
      JSON.stringify(countsBefore) === JSON.stringify(countsAfter) &&
      JSON.stringify(balancesBefore) === JSON.stringify(balancesAfter) &&
      JSON.stringify(txsBefore) === JSON.stringify(txsAfter) &&
      JSON.stringify(ordersBefore) === JSON.stringify(ordersAfter) &&
      JSON.stringify(bomsBefore) === JSON.stringify(bomsAfter);

    results.push({
      testNumber: 10,
      category: 'READ_ONLY_PRESERVATION',
      name: 'Strict Read-Only MRP Execution & Complete IndexedDB Preservation',
      passed,
      message: passed
        ? 'Verified zero database writes across all 15 entity tables, inventory_transactions, stock balances, orders, and BOM items after single & multi-order MRP calculations.'
        : 'Database state mutated unexpectedly during read-only MRP calculations.',
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 10,
      category: 'READ_ONLY_PRESERVATION',
      name: 'Strict Read-Only MRP Execution & Complete IndexedDB Preservation',
      passed: false,
      message: `Test 10 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 11: OrderMrpView React 19 Lifecycle, Hook Safety & Mode Switching
  // =========================================================================
  try {
    const demoOrders = buildDemoOrdersWithDetails();
    const uiCheck = await withTestDom(
      async ({ container, renderSync, flushEffects, capturedErrors }) => {
        renderSync(
          React.createElement(OrderMrpView, {
            orders: demoOrders,
            styles: DEMO_STYLES,
            buyers: DEMO_BUYERS,
            isDbReady: false,
            onOpenStyleBom: () => {},
          })
        );
        await flushEffects();

        const hasSingleTab = Boolean(container.querySelector('[data-testid="mrp-mode-single-tab"]'));
        const hasMultiTab = Boolean(container.querySelector('[data-testid="mrp-mode-multi-tab"]'));
        const hasOrderSelect = Boolean(
          container.querySelector('[data-testid="mrp-single-order-select"]')
        );
        const hasSingleEmpty = Boolean(
          container.querySelector('[data-testid="mrp-single-empty-state"]')
        );
        const optionTexts = Array.from(
          container.querySelectorAll('option') as Iterable<any>
        ).map((o: any) => o.textContent || '');
        const hasPo99410 = optionTexts.some((t) => t.includes('PO-99410'));

        // Switch to Consolidated Multi-Order MRP tab via click
        const multiTabBtn = container.querySelector('[data-testid="mrp-mode-multi-tab"]');
        flushSync(() => {
          multiTabBtn?.click();
        });
        await flushEffects();

        const hasMultiEmpty = Boolean(
          container.querySelector('[data-testid="mrp-multi-empty-state"]')
        );
        const hasOrd01Row = Boolean(
          container.querySelector('[data-testid="mrp-multi-order-row-ORD-01"]')
        );
        const hasOrd02Row = Boolean(
          container.querySelector('[data-testid="mrp-multi-order-row-ORD-02"]')
        );
        const hasExcludeToggle = Boolean(
          container.querySelector('[data-testid="mrp-exclude-cancelled-toggle"]')
        );

        // Switch back to Individual mode
        const singleTabBtn = container.querySelector('[data-testid="mrp-mode-single-tab"]');
        flushSync(() => {
          singleTabBtn?.click();
        });
        await flushEffects();

        const backToSingle = Boolean(
          container.querySelector('[data-testid="mrp-single-order-select"]')
        );
        const hookErrors = capturedErrors.filter(
          (msg) => msg.includes('Rendered more hooks') || msg.includes('Rendered fewer hooks')
        );

        return {
          hasSingleTab,
          hasMultiTab,
          hasOrderSelect,
          hasSingleEmpty,
          hasPo99410,
          hasMultiEmpty,
          hasOrd01Row,
          hasOrd02Row,
          hasExcludeToggle,
          backToSingle,
          hookErrors,
        };
      }
    );

    const passed =
      uiCheck.hasSingleTab &&
      uiCheck.hasMultiTab &&
      uiCheck.hasOrderSelect &&
      uiCheck.hasSingleEmpty &&
      uiCheck.hasPo99410 &&
      uiCheck.hasMultiEmpty &&
      uiCheck.hasOrd01Row &&
      uiCheck.hasOrd02Row &&
      uiCheck.hasExcludeToggle &&
      uiCheck.backToSingle &&
      uiCheck.hookErrors.length === 0;

    results.push({
      testNumber: 11,
      category: 'UI_SAFETY',
      name: 'OrderMrpView React 19 Render, Controls & Individual/Consolidated Mode Switch',
      passed,
      message: passed
        ? 'OrderMrpView rendered Individual & Consolidated modes with order selectors, exclude-cancelled control, empty states, and zero hook errors.'
        : `OrderMrpView UI check failed: ${JSON.stringify(uiCheck)}`,
    });
  } catch (err: any) {
    results.push({
      testNumber: 11,
      category: 'UI_SAFETY',
      name: 'OrderMrpView React 19 Render, Controls & Individual/Consolidated Mode Switch',
      passed: false,
      message: `Test 11 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 12: BomMrpView Sub-Module Navigation Structural Render (BOM & Order MRP Tabs)
  // =========================================================================
  try {
    const demoOrders = buildDemoOrdersWithDetails();
    const htmlBomDefault = renderToStaticMarkup(
      React.createElement(BomMrpView, {
        orders: demoOrders,
        styles: DEMO_STYLES,
        buyers: DEMO_BUYERS,
        materials: DEMO_MATERIALS,
        isDbReady: false,
      })
    );

    const htmlMrpDirect = renderToStaticMarkup(
      React.createElement(BomMrpView, {
        orders: demoOrders,
        styles: DEMO_STYLES,
        buyers: DEMO_BUYERS,
        materials: DEMO_MATERIALS,
        isDbReady: false,
        initialSubTab: 'mrp',
      })
    );

    const passed =
      htmlBomDefault.includes('Style BOM Editor') &&
      htmlBomDefault.includes('Order MRP') &&
      htmlBomDefault.includes('Style Bill of Materials (BOM)') &&
      htmlMrpDirect.includes('Order Material Requirements Planning (MRP)') &&
      htmlMrpDirect.includes('Individual Order MRP') &&
      htmlMrpDirect.includes('Consolidated Multi-Order MRP') &&
      htmlMrpDirect.includes('PO-99410');

    results.push({
      testNumber: 12,
      category: 'UI_SAFETY',
      name: 'BomMrpView Sub-Module Navigation & Order MRP Mount Verification',
      passed,
      message: passed
        ? 'BomMrpView cleanly rendered Style BOM Editor & Order MRP sub-module tabs and mounted OrderMrpView with live orders.'
        : 'BomMrpView sub-module structural render check missed expected labels or MRP controls.',
    });
  } catch (err: any) {
    results.push({
      testNumber: 12,
      category: 'UI_SAFETY',
      name: 'BomMrpView Sub-Module Navigation & Order MRP Mount Verification',
      passed: false,
      message: `Test 12 threw error: ${err.message}`,
    });
  }

  const allPassed = results.length === 12 && results.every((r) => r.passed);
  return { allPassed, results };
}

// CLI direct runner
if (
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1]?.includes('runPhase3AStage4BTests')
) {
  runPhase3AStage4BTests().then((output) => {
    console.log('\n===============================================================');
    console.log('STITCHPILOT ENTERPRISE — PHASE 3A STAGE 4B TEST SUITE');
    console.log('===============================================================\n');
    output.results.forEach((r) => {
      console.log(`[${r.passed ? 'PASS' : 'FAIL'}] Test ${r.testNumber} (${r.category}): ${r.name}`);
      console.log(`  ${r.message}\n`);
    });
    console.log('---------------------------------------------------------------');
    console.log(
      `Summary: ${output.allPassed ? `ALL ${output.results.length} STAGE 4B TESTS PASSED` : 'SOME TESTS FAILED'} (${
        output.results.filter((r) => r.passed).length
      }/${output.results.length})`
    );
    console.log('===============================================================\n');
    if (!output.allPassed) {
      process.exit(1);
    }
  });
}
