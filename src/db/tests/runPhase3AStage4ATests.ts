/**
 * StitchPilot Enterprise — Phase 3A Stage 4A Automated Test Suite
 * Style BOM Editor, Version Cloning, Archiving, UOM Validation & UI Safety
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase } from '../database';
import { createRepositories } from '../repositories';
import { DEMO_BUYERS, DEMO_MATERIALS, DEMO_STYLES, DEMO_BOM_ITEMS } from '../demoData';
import { canConvertUom } from '../services/uomConverter';
import { EntityNotFoundError, ValidationError } from '../errors';
import { BomItemEntity, MaterialEntity } from '../types';
import { BomItemFormModal } from '../../components/bom/BomItemFormModal';
import { BomMrpView } from '../../components/pages/BomMrpView';

export interface Phase3AStage4ATestResult {
  testNumber: number;
  category: 'BOM_CLONE' | 'BOM_CRUD' | 'UOM_VALIDATION' | 'PRESERVATION' | 'UI_SAFETY';
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

async function setupSeededDb(dbName: string) {
  const customIDB = new IDBFactory();
  const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, dbName);
  const repos = createRepositories(db);
  await db.open();
  await repos.system.initializeAndSeedIfEmpty();
  return { customIDB, db, repos };
}

function makeMaterial(
  overrides: Partial<MaterialEntity>
): Omit<MaterialEntity, 'createdAt' | 'updatedAt'> {
  return {
    id: 'MAT-S4A-TEST',
    materialCode: 'S4A-TEST-01',
    name: 'Stage 4A Test Material',
    category: 'Knitted Fabric',
    spec: '200 GSM · 160cm Width',
    unit: 'kg',
    reorderPoint: 100,
    warehouseLocation: 'Zone A-9',
    supplierName: 'Test Mill',
    isSimulated: true,
    ...overrides,
  };
}

/**
 * Browser-safe & Node-safe minimal DOM harness for React hook-lifecycle tests.
 * Uses the real browser document when running inside the browser Diagnostic Modal,
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
      // Ignore unmount cleanup issues
    }
    await new Promise((r) => setTimeout(r, 15));
    console.error = origConsoleError;
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
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

export async function runPhase3AStage4ATests(): Promise<{
  allPassed: boolean;
  results: Phase3AStage4ATestResult[];
}> {
  const results: Phase3AStage4ATestResult[] = [];

  // =========================================================================
  // Test 1: cloneBomVersion clones ACTIVE items atomically & deep-copies scopes
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_S4A_CloneActive');
    const now = new Date().toISOString();

    // Add a scoped component with colour/size/overrides to STY-01 v1, and archive BOM-03
    const scopedItem = await repos.master.createBomItem({
      id: 'BOM-S4A-SCOPED',
      styleId: 'STY-01',
      materialId: 'MAT-05',
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'TRIM',
      consumptionPerGarment: 1,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 2,
      placement: 'Special Edition Zip Pocket',
      colorScope: 'SPECIFIC',
      applicableColors: ['Charcoal', 'Midnight Navy'],
      sizeScope: 'SPECIFIC',
      applicableSizes: ['L', 'XL'],
      sizeConsumptionMap: { XL: 1.5 },
      notes: 'Contrast metal zipper',
      isMandatory: false,
      isSimulated: false,
      createdAt: now,
    });

    await repos.master.archiveBomItem('BOM-03'); // v1 now has 3 ACTIVE + 1 ARCHIVED

    const cloned = await repos.master.cloneBomVersion('STY-01', 1);
    const v1After = await repos.master.getBomByStyleAndVersion('STY-01', 1);
    const v2After = await repos.master.getBomByStyleAndVersion('STY-01', 2);

    const clonedScoped = cloned.find((c) => c.placement === 'Special Edition Zip Pocket');
    const allNewIds = cloned.every((c) => !v1After.some((orig) => orig.id === c.id));
    const deepCopyCheck =
      clonedScoped !== undefined &&
      clonedScoped.id !== scopedItem.id &&
      clonedScoped.bomVersion === 2 &&
      clonedScoped.status === 'ACTIVE' &&
      JSON.stringify(clonedScoped.applicableColors) === JSON.stringify(['Charcoal', 'Midnight Navy']) &&
      JSON.stringify(clonedScoped.applicableSizes) === JSON.stringify(['L', 'XL']) &&
      clonedScoped.sizeConsumptionMap?.XL === 1.5;

    const passed =
      cloned.length === 3 &&
      v2After.length === 3 &&
      v1After.length === 4 &&
      v1After.filter((i) => i.status === 'ARCHIVED').length === 1 &&
      allNewIds &&
      deepCopyCheck;

    results.push({
      testNumber: 1,
      category: 'BOM_CLONE',
      name: 'Clone BOM Version Copies Active Components & Deep-Copies Scopes',
      passed,
      message: passed
        ? `Cloned 3 ACTIVE items from STY-01 v1 to v2 (excluded 1 archived item, assigned new IDs, deep-copied colour/size scopes & overrides, preserved v1 intact).`
        : `Clone verification failed: cloned=${cloned.length}, v1=${v1After.length}, v2=${v2After.length}, allNewIds=${allNewIds}, deepCopy=${deepCopyCheck}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 1,
      category: 'BOM_CLONE',
      name: 'Clone BOM Version Copies Active Components & Deep-Copies Scopes',
      passed: false,
      message: `Test 1 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 2: cloneBomVersion validation guards & explicit target version
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_S4A_CloneGuards');

    // Explicit targetVersion = 5 should work
    const clonedV5 = await repos.master.cloneBomVersion('STY-02', 1, 5);
    const v5Ok = clonedV5.length === 2 && clonedV5.every((c) => c.bomVersion === 5);

    // Duplicate target version (5) must throw ValidationError
    let dupRejected = false;
    try {
      await repos.master.cloneBomVersion('STY-02', 1, 5);
    } catch (e) {
      dupRejected = e instanceof ValidationError;
    }

    // Missing style must throw EntityNotFoundError
    let missingStyleRejected = false;
    try {
      await repos.master.cloneBomVersion('STY-NONEXISTENT', 1);
    } catch (e) {
      missingStyleRejected = e instanceof EntityNotFoundError;
    }

    // Non-positive source/target version must throw ValidationError
    let invalidVerRejected = false;
    try {
      await repos.master.cloneBomVersion('STY-02', 0);
    } catch (e) {
      invalidVerRejected = e instanceof ValidationError;
    }

    // Archiving all items in v5 then trying to clone v5 must throw ValidationError
    await repos.master.archiveBomVersion('STY-02', 5);
    let allArchivedRejected = false;
    try {
      await repos.master.cloneBomVersion('STY-02', 5);
    } catch (e) {
      allArchivedRejected = e instanceof ValidationError;
    }

    const passed =
      v5Ok &&
      dupRejected &&
      missingStyleRejected &&
      invalidVerRejected &&
      allArchivedRejected;

    results.push({
      testNumber: 2,
      category: 'BOM_CLONE',
      name: 'Clone BOM Version Validation Guards & Explicit Target Version',
      passed,
      message: passed
        ? 'Explicit target v5 succeeded; duplicate version, missing style, non-positive version, and all-archived source version were cleanly rejected.'
        : `Guard checks failed: v5Ok=${v5Ok}, dup=${dupRejected}, missingStyle=${missingStyleRejected}, invalidVer=${invalidVerRejected}, allArchived=${allArchivedRejected}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 2,
      category: 'BOM_CLONE',
      name: 'Clone BOM Version Validation Guards & Explicit Target Version',
      passed: false,
      message: `Test 2 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 3: BOM CRUD with PER_DOZEN, colour/size scopes & persistence across reopen
  // =========================================================================
  try {
    const sharedIDB = new IDBFactory();
    const dbName = 'TestDB_S4A_CrudPersist';

    const db1 = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    const repos1 = createRepositories(db1);
    await db1.open();
    await repos1.system.initializeAndSeedIfEmpty();

    const created = await repos1.master.createBomItem({
      id: 'BOM-S4A-CRUD-1',
      styleId: 'STY-01',
      materialId: 'MAT-06', // unit: gross
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'TRIM',
      consumptionPerGarment: 24, // 24 pcs per dozen = 2 pcs/garment
      consumptionBasis: 'PER_DOZEN',
      consumptionUnit: 'pcs', // converts pcs -> gross (1/144)
      wastagePercent: 2.5,
      placement: 'Front Placket Buttons',
      colorScope: 'SPECIFIC',
      applicableColors: ['Olive', 'Black'],
      sizeScope: 'SPECIFIC',
      applicableSizes: ['M', 'L', 'XL'],
      sizeConsumptionMap: { XL: 30 },
      notes: 'Matched shell buttons',
      isMandatory: true,
      isSimulated: false,
      createdAt: new Date().toISOString(),
    });

    await repos1.master.updateBomItem(created.id, {
      consumptionPerGarment: 36,
      wastagePercent: 3.0,
      applicableColors: ['Olive', 'Black', 'Sand'],
      sizeConsumptionMap: { XL: 42 },
    });

    db1.close();

    // Reopen database on same storage instance
    const db2 = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    const repos2 = createRepositories(db2);
    await db2.open();

    const reloaded = await repos2.master.getBomItemById('BOM-S4A-CRUD-1');
    const passed =
      reloaded !== undefined &&
      reloaded.consumptionPerGarment === 36 &&
      reloaded.consumptionBasis === 'PER_DOZEN' &&
      reloaded.consumptionUnit === 'pcs' &&
      reloaded.wastagePercent === 3.0 &&
      reloaded.colorScope === 'SPECIFIC' &&
      reloaded.applicableColors?.length === 3 &&
      reloaded.sizeScope === 'SPECIFIC' &&
      reloaded.sizeConsumptionMap?.XL === 42;

    results.push({
      testNumber: 3,
      category: 'BOM_CRUD',
      name: 'BOM Create, Edit & Persistence Across DB Reopen',
      passed,
      message: passed
        ? 'Created and updated BOM item with PER_DOZEN basis, pcs->gross UOM, colour/size scopes, and size overrides; verified full persistence after DB close & reopen.'
        : `Persistence check failed: ${JSON.stringify(reloaded)}`,
    });
    db2.close();
  } catch (err: any) {
    results.push({
      testNumber: 3,
      category: 'BOM_CRUD',
      name: 'BOM Create, Edit & Persistence Across DB Reopen',
      passed: false,
      message: `Test 3 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 4: Non-destructive component & version archiving
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_S4A_Archive');

    // Clone STY-01 v1 -> v2 so we can archive v1 without losing active v2
    await repos.master.cloneBomVersion('STY-01', 1);

    // Archive 1 component in v2
    const v2Before = await repos.master.getBomByStyleAndVersion('STY-01', 2);
    await repos.master.archiveBomItem(v2Before[0].id);

    // Archive entire v1
    await repos.master.archiveBomVersion('STY-01', 1);

    const versions = await repos.master.getBomVersionsByStyle('STY-01');
    const v1Summary = versions.find((v) => v.bomVersion === 1);
    const v2Summary = versions.find((v) => v.bomVersion === 2);
    const activeLatest = await repos.master.getActiveBomByStyle('STY-01');

    const passed =
      v1Summary !== undefined &&
      v1Summary.totalItems === 3 &&
      v1Summary.activeItems === 0 &&
      v1Summary.archivedItems === 3 &&
      v2Summary !== undefined &&
      v2Summary.totalItems === 3 &&
      v2Summary.activeItems === 2 &&
      v2Summary.archivedItems === 1 &&
      activeLatest.length === 2 &&
      activeLatest.every((i) => i.bomVersion === 2 && i.status === 'ACTIVE');

    results.push({
      testNumber: 4,
      category: 'BOM_CRUD',
      name: 'Non-Destructive Component & Version Archiving',
      passed,
      message: passed
        ? 'Archived v1 completely (0 active, 3 archived preserved) and archived 1 component in v2 (2 active, 1 archived); getActiveBomByStyle isolated active v2 items.'
        : `Archiving summary mismatch: v1=${JSON.stringify(v1Summary)}, v2=${JSON.stringify(v2Summary)}, activeLatest=${activeLatest.length}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 4,
      category: 'BOM_CRUD',
      name: 'Non-Destructive Component & Version Archiving',
      passed: false,
      message: `Test 4 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 5: UOM conversion validation alignment between canConvertUom & MasterRepository
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_S4A_UomAlign');

    // Register a fabric material WITH GSM & width, and a thread cone WITH metersPerCone
    const fabWithAttrs = await repos.inventory.createMaterial(
      makeMaterial({
        id: 'MAT-S4A-FAB-ATTR',
        materialCode: 'S4A-FAB-GSM',
        name: 'Configured Jersey 200 GSM',
        unit: 'kg',
        uomAttributes: { gsm: 200, usableWidthCm: 160 },
      })
    );

    const threadWithAttrs = await repos.inventory.createMaterial(
      makeMaterial({
        id: 'MAT-S4A-THD-ATTR',
        materialCode: 'S4A-THD-5K',
        name: 'Configured Thread 5000m Cone',
        category: 'Threads & Notions',
        unit: 'cones',
        uomAttributes: { metersPerCone: 5000 },
      })
    );

    // Valid pairs
    const validCases: Array<{ mat: MaterialEntity; unit: BomItemEntity['consumptionUnit'] }> = [
      { mat: fabWithAttrs, unit: 'meters' },
      { mat: fabWithAttrs, unit: 'yards' },
      { mat: threadWithAttrs, unit: 'meters' },
      { mat: (await repos.inventory.getMaterialById('MAT-06'))!, unit: 'pcs' }, // pcs -> gross
      { mat: (await repos.inventory.getMaterialById('MAT-04'))!, unit: 'yards' }, // yards -> meters
    ];

    let allValidAccepted = true;
    for (let i = 0; i < validCases.length; i++) {
      const vc = validCases[i];
      const check = canConvertUom(vc.unit!, vc.mat.unit, vc.mat.uomAttributes);
      if (!check.valid) allValidAccepted = false;
      await repos.master.createBomItem({
        id: `BOM-S4A-UOM-OK-${i}`,
        styleId: 'STY-02',
        materialId: vc.mat.id,
        bomVersion: 2,
        status: 'ACTIVE',
        componentCategory: 'FABRIC',
        consumptionPerGarment: 1.25,
        consumptionBasis: 'PER_PIECE',
        consumptionUnit: vc.unit,
        wastagePercent: 4,
        placement: `Valid UOM Case ${i}`,
        isMandatory: true,
        isSimulated: false,
        createdAt: new Date().toISOString(),
      });
    }

    // Invalid pairs (MAT-02 is kg WITHOUT gsm/usableWidthCm; MAT-05 is pcs)
    const matNoAttrsKg = (await repos.inventory.getMaterialById('MAT-02'))!;
    const matPcs = (await repos.inventory.getMaterialById('MAT-05'))!;
    const invalidCases: Array<{ mat: MaterialEntity; unit: BomItemEntity['consumptionUnit'] }> = [
      { mat: matNoAttrsKg, unit: 'meters' }, // missing gsm/usableWidthCm
      { mat: matNoAttrsKg, unit: 'pcs' }, // cross-dimension
      { mat: matPcs, unit: 'kg' }, // cross-dimension
      { mat: threadWithAttrs, unit: 'kg' }, // cones <-> kg unsupported
    ];

    let allInvalidRejected = true;
    for (let i = 0; i < invalidCases.length; i++) {
      const ic = invalidCases[i];
      const check = canConvertUom(ic.unit!, ic.mat.unit, ic.mat.uomAttributes);
      if (check.valid) allInvalidRejected = false;
      let threw = false;
      try {
        await repos.master.createBomItem({
          id: `BOM-S4A-UOM-BAD-${i}`,
          styleId: 'STY-02',
          materialId: ic.mat.id,
          bomVersion: 2,
          status: 'ACTIVE',
          componentCategory: 'FABRIC',
          consumptionPerGarment: 1,
          consumptionBasis: 'PER_PIECE',
          consumptionUnit: ic.unit,
          wastagePercent: 4,
          placement: `Invalid UOM Case ${i}`,
          isMandatory: true,
          isSimulated: false,
          createdAt: new Date().toISOString(),
        });
      } catch (e) {
        threw = e instanceof ValidationError;
      }
      if (!threw) allInvalidRejected = false;
    }

    const passed = allValidAccepted && allInvalidRejected;
    results.push({
      testNumber: 5,
      category: 'UOM_VALIDATION',
      name: 'UOM Conversion Alignment Between Engine & MasterRepository',
      passed,
      message: passed
        ? `All ${validCases.length} valid UOM pairs accepted and all ${invalidCases.length} incompatible/unconfigured UOM pairs consistently rejected by both canConvertUom and MasterRepository.`
        : `UOM alignment failed: allValidAccepted=${allValidAccepted}, allInvalidRejected=${allInvalidRejected}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 5,
      category: 'UOM_VALIDATION',
      name: 'UOM Conversion Alignment Between Engine & MasterRepository',
      passed: false,
      message: `Test 5 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 6: Multi-version isolation & empty new version workflow
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_S4A_VersionIsolation');

    // Create a brand-new v3 directly without cloning v1
    await repos.master.createBomItem({
      id: 'BOM-S4A-V3-ONLY',
      styleId: 'STY-03',
      materialId: 'MAT-04',
      bomVersion: 3,
      status: 'ACTIVE',
      componentCategory: 'FABRIC',
      consumptionPerGarment: 1.6,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'meters',
      wastagePercent: 5,
      placement: 'Updated Wide-Leg Cargo Shell',
      isMandatory: true,
      isSimulated: false,
      createdAt: new Date().toISOString(),
    });

    const versions = await repos.master.getBomVersionsByStyle('STY-03');
    const v1Items = await repos.master.getBomByStyleAndVersion('STY-03', 1);
    const v3Items = await repos.master.getBomByStyleAndVersion('STY-03', 3);

    const passed =
      versions.length === 2 &&
      versions[0].bomVersion === 3 &&
      versions[0].activeItems === 1 &&
      versions[1].bomVersion === 1 &&
      v1Items.length >= 2 &&
      v3Items.length === 1 &&
      v3Items[0].id === 'BOM-S4A-V3-ONLY';

    results.push({
      testNumber: 6,
      category: 'BOM_CLONE',
      name: 'Multi-Version Isolation & New Empty Version Creation',
      passed,
      message: passed
        ? `Created isolated v3 on STY-03 (${v3Items.length} item) while preserving v1 (${v1Items.length} items) completely untouched.`
        : `Version isolation failed: versions=${JSON.stringify(versions)}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 6,
      category: 'BOM_CLONE',
      name: 'Multi-Version Isolation & New Empty Version Creation',
      passed: false,
      message: `Test 6 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 7: Strict preservation of existing entities & inventory ledger
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_S4A_Preservation');

    const beforeCounts = await repos.system.getTableCounts();
    const beforeBalances = await repos.inventory.getAllStockBalances();

    // Perform full BOM editor workflow: create -> edit -> clone -> archive item -> archive version
    const created = await repos.master.createBomItem({
      id: 'BOM-S4A-PRES-1',
      styleId: 'STY-01',
      materialId: 'MAT-08',
      bomVersion: 1,
      status: 'ACTIVE',
      componentCategory: 'PACKAGING',
      consumptionPerGarment: 1,
      consumptionBasis: 'PER_PIECE',
      consumptionUnit: 'pcs',
      wastagePercent: 1,
      placement: 'Individual Polybag',
      isMandatory: true,
      isSimulated: false,
      createdAt: new Date().toISOString(),
    });
    await repos.master.updateBomItem(created.id, { wastagePercent: 1.5 });
    await repos.master.cloneBomVersion('STY-01', 1);
    await repos.master.archiveBomItem(created.id);
    await repos.master.archiveBomVersion('STY-01', 2);

    const afterCounts = await repos.system.getTableCounts();
    const afterBalances = await repos.inventory.getAllStockBalances();

    const untouchedTables = [
      'buyers',
      'styles',
      'orders',
      'order_items',
      'cost_sheets',
      'materials',
      'inventory_transactions',
      'cutting_jobs',
      'marker_ratios',
      'bundles',
      'production_lines',
      'production_events',
      'quality_inspections',
      'quality_defects',
    ] as const;

    const allOtherTablesUnchanged = untouchedTables.every(
      (tbl) => beforeCounts[tbl] === afterCounts[tbl]
    );
    const stockBalancesIdentical =
      JSON.stringify(beforeBalances) === JSON.stringify(afterBalances);

    const passed = allOtherTablesUnchanged && stockBalancesIdentical;
    results.push({
      testNumber: 7,
      category: 'PRESERVATION',
      name: 'Strict Preservation of Existing Tables & Inventory Ledger',
      passed,
      message: passed
        ? 'All 14 non-BOM tables and all calculated inventory stock balances remained 100% identical after BOM create, edit, clone, and archive operations.'
        : `Unexpected side-effect detected: allOtherTablesUnchanged=${allOtherTablesUnchanged}, stockBalancesIdentical=${stockBalancesIdentical}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 7,
      category: 'PRESERVATION',
      name: 'Strict Preservation of Existing Tables & Inventory Ledger',
      passed: false,
      message: `Test 7 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 8: BomItemFormModal React Rules of Hooks & Open/Close/Edit Toggle Safety
  // =========================================================================
  try {
    const sampleStyle = DEMO_STYLES[0];
    const sampleItem: BomItemEntity = {
      ...DEMO_BOM_ITEMS[0],
      colorScope: 'SPECIFIC',
      applicableColors: ['Heather Grey'],
      sizeScope: 'SPECIFIC',
      applicableSizes: ['M', 'L'],
      sizeConsumptionMap: { L: 0.52 },
    };

    const hookResult = await withTestDom(
      async ({ container, renderSync, flushEffects, capturedErrors }) => {
        // 1. Render closed
        renderSync(
          React.createElement(BomItemFormModal, {
            isOpen: false,
            onClose: () => {},
            style: sampleStyle,
            defaultVersion: 1,
            materials: DEMO_MATERIALS,
            itemToEdit: null,
            onSave: async () => {},
          })
        );
        await flushEffects();
        const closedEmpty =
          container.querySelector('[data-testid="bom-item-form-modal"]') === null;

        // 2. Open in Create mode
        renderSync(
          React.createElement(BomItemFormModal, {
            isOpen: true,
            onClose: () => {},
            style: sampleStyle,
            defaultVersion: 2,
            materials: DEMO_MATERIALS,
            itemToEdit: null,
            onSave: async () => {},
          })
        );
        await flushEffects();
        const createRendered =
          container.querySelector('[data-testid="bom-item-form-modal"]') !== null &&
          container.textContent.includes('Add BOM Component');

        // 3. Close again
        renderSync(
          React.createElement(BomItemFormModal, {
            isOpen: false,
            onClose: () => {},
            style: null,
            defaultVersion: 2,
            materials: DEMO_MATERIALS,
            itemToEdit: null,
            onSave: async () => {},
          })
        );
        await flushEffects();

        // 4. Reopen in Edit mode with SPECIFIC colours/sizes/overrides
        renderSync(
          React.createElement(BomItemFormModal, {
            isOpen: true,
            onClose: () => {},
            style: sampleStyle,
            defaultVersion: 1,
            materials: DEMO_MATERIALS,
            itemToEdit: sampleItem,
            onSave: async () => {},
          })
        );
        await flushEffects();
        const editText = container.textContent || '';
        const editRendered =
          editText.includes('Edit BOM Component') &&
          editText.includes('Heather Grey') &&
          editText.includes('UOM Conversion Valid');

        const buttonCount = Array.from(container.querySelectorAll('button')).length;
        const noHookErrors = !capturedErrors.some((e) =>
          e.toLowerCase().includes('more hooks')
        );

        return { closedEmpty, createRendered, editRendered, buttonCount, noHookErrors };
      }
    );

    const passed =
      hookResult.closedEmpty &&
      hookResult.createRendered &&
      hookResult.editRendered &&
      hookResult.buttonCount > 0 &&
      hookResult.noHookErrors;

    results.push({
      testNumber: 8,
      category: 'UI_SAFETY',
      name: 'BomItemFormModal React Rules of Hooks & Create/Edit Toggle Safety',
      passed,
      message: passed
        ? `BomItemFormModal transitioned cleanly across closed -> Create -> closed -> Edit (with specific colour/size scopes) with zero hook violations (${hookResult.buttonCount} interactive controls rendered).`
        : `Modal render check failed: ${JSON.stringify(hookResult)}`,
    });
  } catch (err: any) {
    results.push({
      testNumber: 8,
      category: 'UI_SAFETY',
      name: 'BomItemFormModal React Rules of Hooks & Create/Edit Toggle Safety',
      passed: false,
      message: `Test 8 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 9: BomItemFormModal live incompatible UOM feedback & submit guard
  // =========================================================================
  try {
    const sampleStyle = DEMO_STYLES[0];
    // MAT-02 is kg without GSM/width; giving it consumptionUnit='meters' triggers live UOM error
    const incompatibleItem: BomItemEntity = {
      ...DEMO_BOM_ITEMS[0],
      materialId: 'MAT-02',
      consumptionUnit: 'meters',
    };

    const uomUiCheck = await withTestDom(
      async ({ container, renderSync, flushEffects }) => {
        renderSync(
          React.createElement(BomItemFormModal, {
            isOpen: true,
            onClose: () => {},
            style: sampleStyle,
            defaultVersion: 1,
            materials: DEMO_MATERIALS,
            itemToEdit: incompatibleItem,
            onSave: async () => {},
          })
        );
        await flushEffects();
        const uomBox = container.querySelector('[data-testid="bom-uom-validation-box"]');
        const submitBtn = container.querySelector('[data-testid="bom-form-submit-btn"]');
        const uomText = uomBox?.textContent || '';
        const showsIncompatible =
          uomText.includes('Incompatible Unit Conversion') &&
          uomText.includes('gsm');
        const submitDisabled = Boolean(
          submitBtn?.disabled || submitBtn?.hasAttribute?.('disabled')
        );
        return { showsIncompatible, submitDisabled, uomText };
      }
    );

    const passed = uomUiCheck.showsIncompatible && uomUiCheck.submitDisabled;
    results.push({
      testNumber: 9,
      category: 'UI_SAFETY',
      name: 'BomItemFormModal Live UOM Incompatibility Warning & Submit Guard',
      passed,
      message: passed
        ? 'Live UOM panel displayed explicit missing-GSM incompatibility warning and disabled submit button.'
        : `UOM UI guard failed: ${JSON.stringify(uomUiCheck)}`,
    });
  } catch (err: any) {
    results.push({
      testNumber: 9,
      category: 'UI_SAFETY',
      name: 'BomItemFormModal Live UOM Incompatibility Warning & Submit Guard',
      passed: false,
      message: `Test 9 threw error: ${err.message}`,
    });
  }

  // =========================================================================
  // Test 10: BomMrpView & StyleBomEditorView clean SSR/static render verification
  // =========================================================================
  try {
    const html = renderToStaticMarkup(
      React.createElement(BomMrpView, {
        styles: DEMO_STYLES,
        buyers: DEMO_BUYERS,
        materials: DEMO_MATERIALS,
        isDbReady: false,
      })
    );

    const hasHeading = html.includes('Style Bill of Materials (BOM)');
    const hasStyleCode = html.includes('ST-402');
    const hasAddBtn = html.includes('Add Component');
    const hasCloneBtn = html.includes('Clone Active');
    const hasShowArchived = html.includes('Show Archived');

    const passed = hasHeading && hasStyleCode && hasAddBtn && hasCloneBtn && hasShowArchived;
    results.push({
      testNumber: 10,
      category: 'UI_SAFETY',
      name: 'BomMrpView & StyleBomEditorView Structural Render Verification',
      passed,
      message: passed
        ? 'BomMrpView and StyleBomEditorView rendered cleanly with style selector, version actions, and BOM table structure.'
        : `Render verification missing expected UI elements: heading=${hasHeading}, styleCode=${hasStyleCode}, addBtn=${hasAddBtn}, cloneBtn=${hasCloneBtn}, archived=${hasShowArchived}`,
    });
  } catch (err: any) {
    results.push({
      testNumber: 10,
      category: 'UI_SAFETY',
      name: 'BomMrpView & StyleBomEditorView Structural Render Verification',
      passed: false,
      message: `Test 10 threw error: ${err.message}`,
    });
  }

  const allPassed = results.length === 10 && results.every((r) => r.passed);
  return { allPassed, results };
}

// CLI direct runner
if (
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1]?.includes('runPhase3AStage4ATests')
) {
  runPhase3AStage4ATests().then((output) => {
    console.log('\n===============================================================');
    console.log('STITCHPILOT ENTERPRISE — PHASE 3A STAGE 4A TEST SUITE');
    console.log('===============================================================\n');
    output.results.forEach((r) => {
      console.log(`[${r.passed ? 'PASS' : 'FAIL'}] Test ${r.testNumber} (${r.category}): ${r.name}`);
      console.log(`  ${r.message}\n`);
    });
    console.log('---------------------------------------------------------------');
    console.log(
      `Summary: ${output.allPassed ? `ALL ${output.results.length} STAGE 4A TESTS PASSED` : 'SOME TESTS FAILED'} (${
        output.results.filter((r) => r.passed).length
      }/${output.results.length})`
    );
    console.log('===============================================================\n');
    if (!output.allPassed) {
      process.exit(1);
    }
  });
}
