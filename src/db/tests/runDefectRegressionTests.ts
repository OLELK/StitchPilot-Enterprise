/**
 * StitchPilot Enterprise — Focused Regression Test Suite for Priority Defects
 *
 * Covers:
 *  - BUG 1: Dashboard data accuracy (derived KPIs, stage consistency, no fabricated values, empty states)
 *  - BUG 2: Settings -> Reset Defaults (confirmation, distinction from Save, persistence across reload, operational data safety)
 *  - BUG 3: Negative production output rejection in both UI and data-writing repositories (rejects negative, accepts 0 & positive, no silent coercion)
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase } from '../database';
import { createRepositories } from '../repositories';
import { buildDashboardSnapshot } from '../services/dashboardService';
import { ValidationError } from '../errors';
import { DEFAULT_PLANT_SETTINGS } from '../../data/mockData';
import { PlantSettings } from '../../types';
import { DashboardView } from '../../components/pages/DashboardView';
import { ProductionChartTooltip } from '../../components/dashboard/ProductionChart';
import { SettingsView } from '../../components/pages/SettingsView';
import { TopNavbar } from '../../components/layout/TopNavbar';

export interface DefectRegressionTestResult {
  testNumber: number;
  bugId: 'BUG_1_DASHBOARD' | 'BUG_2_SETTINGS_RESET' | 'BUG_3_NEGATIVE_OUTPUT';
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

async function setupSeededDb(dbName: string, sharedIDB?: IDBFactory) {
  const customIDB = sharedIDB || new IDBFactory();
  const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, dbName);
  const repos = createRepositories(db);
  await db.open();
  await repos.system.initializeAndSeedIfEmpty();
  return { customIDB, db, repos };
}

/**
 * Minimal Node-safe & browser-safe DOM harness for React 19 component verification.
 */
async function withTestDom<T>(
  fn: (ctx: {
    container: any;
    renderSync: (el: React.ReactElement) => void;
    flushEffects: (ms?: number) => Promise<void>;
    setInputValue: (input: any, value: string) => void;
    submitForm: (form: any) => void;
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
      _value: any = '';
      type: string = '';
      oninput: any = null;
      onchange: any = null;
      onsubmit: any = null;
      onclick: any = null;
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
      get value() {
        return this._value;
      }
      set value(v: any) {
        this._value = v;
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
        if (k === 'value') this._value = String(v);
        if (k === 'type') this.type = String(v);
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

  const container = (globalThis as any).document.createElement('div');
  (globalThis as any).document.body.appendChild(container);
  const root = createRoot(container);

  const setInputValue = (input: any, value: string) => {
    const proto = (globalThis as any).HTMLInputElement?.prototype;
    const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : undefined;
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    const EvCtor = (globalThis as any).Event;
    flushSync(() => {
      if (hadDocument) {
        input.dispatchEvent(new EvCtor('input', { bubbles: true, cancelable: true }));
        input.dispatchEvent(new EvCtor('change', { bubbles: true, cancelable: true }));
      } else {
        // In Node CLI runs, react-dom initializes with canUseDOM=false (so ChangeEventPlugin
        // disables DOM 'input' delegation). Invoke the exact attached React onChange handler.
        const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$'));
        const onChange = propsKey ? input[propsKey]?.onChange : undefined;
        if (typeof onChange === 'function') {
          const ev = new EvCtor('change', { bubbles: true, cancelable: true });
          ev.target = input;
          ev.currentTarget = input;
          onChange(ev);
        }
      }
    });
  };

  const submitForm = (form: any) => {
    const EvCtor = (globalThis as any).Event;
    flushSync(() => {
      form.dispatchEvent(new EvCtor('submit', { bubbles: true, cancelable: true }));
    });
  };

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
      setInputValue,
      submitForm,
    });
  } finally {
    try {
      flushSync(() => {
        root.unmount();
      });
    } catch {
      // ignore
    }
    if (!hadDocument) {
      await new Promise((r) => setTimeout(r, 25));
    }
    try {
      if (container.parentNode) container.parentNode.removeChild(container);
    } catch {
      // ignore
    }
    if (!hadDocument) {
      keysToRestore.forEach((k) => {
        if (prevGlobals[k] === undefined) delete (globalThis as any)[k];
        else (globalThis as any)[k] = prevGlobals[k];
      });
    }
  }
}

export async function runDefectRegressionTests(): Promise<{
  allPassed: boolean;
  results: DefectRegressionTestResult[];
}> {
  const results: DefectRegressionTestResult[] = [];

  // =========================================================================
  // Test 1 (BUG 1) — Dashboard active orders & stage counts consistency
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B1_T1');
    try {
      const snap1 = await buildDashboardSnapshot(repos, DEFAULT_PLANT_SETTINGS);
      const ordersMetric1 = snap1.metrics.find((m) => m.id === 'total_orders');

      // Seeded DB has 3 active orders: 2 IN_PRODUCTION, 1 CONFIRMED, 0 DRAFT
      const initialConsistent =
        ordersMetric1?.value === '3' &&
        ordersMetric1?.subtitle === '2 in production · 1 confirmed · 0 draft' &&
        snap1.summaryMeta.activeOrderCount === 3 &&
        snap1.summaryMeta.totalOrderCount === 3;

      // Cancel ORD-03 (CONFIRMED -> CANCELLED) and confirm active order count drops to 2
      await repos.orders.cancelOrder('ORD-03', 'Buyer cancelled style');
      const snap2 = await buildDashboardSnapshot(repos, DEFAULT_PLANT_SETTINGS);
      const ordersMetric2 = snap2.metrics.find((m) => m.id === 'total_orders');

      const afterCancelConsistent =
        ordersMetric2?.value === '2' &&
        ordersMetric2?.subtitle === '2 in production · 0 confirmed · 0 draft' &&
        ordersMetric2?.change === '3 total POs' &&
        snap2.summaryMeta.activeOrderCount === 2 &&
        snap2.summaryMeta.totalOrderCount === 3;

      const passed = initialConsistent && afterCancelConsistent;
      results.push({
        testNumber: 1,
        bugId: 'BUG_1_DASHBOARD',
        name: 'Dashboard active orders exclude closed/cancelled orders and stage counts sum accurately',
        passed,
        message: passed
          ? `Seeded: "${ordersMetric1?.value}" (${ordersMetric1?.subtitle}); after cancelling ORD-03: "${ordersMetric2?.value}" (${ordersMetric2?.subtitle}, ${ordersMetric2?.change}).`
          : `Orders KPI mismatch: before=${JSON.stringify(ordersMetric1)}, after=${JSON.stringify(ordersMetric2)}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 1,
      bugId: 'BUG_1_DASHBOARD',
      name: 'Dashboard active orders exclude closed/cancelled orders and stage counts sum accurately',
      passed: false,
      message: `Test 1 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 2 (BUG 1) — Dashboard output target & quality DHU reflect real settings/data
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B1_T2');
    try {
      const customShiftASettings: PlantSettings = {
        ...DEFAULT_PLANT_SETTINGS,
        activeShift: 'Shift A (07:00 - 15:30)',
        plannedDailyOutput: 12000,
        dhuToleranceLimit: 2.5,
      };
      const snapCustom = await buildDashboardSnapshot(repos, customShiftASettings);
      const outputMetric = snapCustom.metrics.find((m) => m.id === 'production_output');
      const dhuMetric = snapCustom.metrics.find((m) => m.id === 'quality_dhu');

      // 8450 / 12000 = 70.4%; DHU = 3.2 vs 2.5 limit -> +0.7 above 2.5 limit
      const customOk =
        outputMetric?.value === '8,450' &&
        outputMetric?.subtitle.includes('12,000 pcs') &&
        outputMetric?.subtitle.includes('Shift A') &&
        outputMetric?.benchmark === '70.4% of daily target' &&
        dhuMetric?.value === '3.2' &&
        dhuMetric?.benchmark === '+0.7 above 2.5 limit';

      // Switching to Shift B (15:30 - 23:00) when only Shift A events exist must NOT show Shift A output
      const snapShiftB = await buildDashboardSnapshot(repos, {
        ...DEFAULT_PLANT_SETTINGS,
        activeShift: 'Shift B (15:30 - 23:00)',
      });
      const shiftBOutputMetric = snapShiftB.metrics.find((m) => m.id === 'production_output');
      const shiftBIsolationOk =
        shiftBOutputMetric?.value === '0' &&
        snapShiftB.hourlyData.length === 0 &&
        snapShiftB.summaryMeta.reportingLineCount === 0;

      // Zero planned daily output should not produce Infinity% or NaN%
      const snapZeroTarget = await buildDashboardSnapshot(repos, {
        ...DEFAULT_PLANT_SETTINGS,
        plannedDailyOutput: 0,
        dhuToleranceLimit: 4.0,
      });
      const zeroOutputMetric = snapZeroTarget.metrics.find((m) => m.id === 'production_output');
      const relaxedDhuMetric = snapZeroTarget.metrics.find((m) => m.id === 'quality_dhu');
      const zeroOk =
        zeroOutputMetric?.benchmark === 'No daily target configured' &&
        relaxedDhuMetric?.benchmark === 'Within 4.0 tolerance';

      const passed = customOk && shiftBIsolationOk && zeroOk;
      results.push({
        testNumber: 2,
        bugId: 'BUG_1_DASHBOARD',
        name: 'Dashboard output target & Quality DHU derive dynamically from persisted data and settings',
        passed,
        message: passed
          ? `Verified Shift A target (${outputMetric?.benchmark}), Shift B isolation (0 pcs), dynamic DHU delta (${dhuMetric?.benchmark}), and safe 0-target handling.`
          : `Custom/zero KPI check failed: ${JSON.stringify({ outputMetric, shiftBOutputMetric, dhuMetric, zeroOutputMetric, relaxedDhuMetric })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 2,
      bugId: 'BUG_1_DASHBOARD',
      name: 'Dashboard output target & Quality DHU derive dynamically from persisted data and settings',
      passed: false,
      message: `Test 2 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 3 (BUG 1) — Floor lines, operators, chart totals & unavailable states (zero fabrication)
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B1_T3');
    try {
      const snap = await buildDashboardSnapshot(repos, DEFAULT_PLANT_SETTINGS);
      const line1 = snap.lines.find((l) => l.lineId === 'LINE-01');
      const line2 = snap.lines.find((l) => l.lineId === 'LINE-02');
      const line3 = snap.lines.find((l) => l.lineId === 'LINE-03');

      // Seeded DB has 3 lines (28+32+30 = 90 operators), events ONLY on LINE-01, QC ONLY on LINE-01
      const line1DerivedOk =
        !!line1 &&
        line1.shiftTargetPcs === 8750 &&
        line1.shiftActualPcs === 8450 &&
        line1.actualPcsHr === Math.round(8450 / 8) &&
        line1.targetPcsHr === Math.round(8750 / 8) &&
        line1.efficiencyPercent === Math.round((8450 / 8750) * 1000) / 10 &&
        line1.dhuPercent === 3.2;

      // Lines without shift production events must NOT have targets silently substituted from capacity
      const linesWithoutTelemetryUnavailable =
        !!line2 &&
        line2.targetPcsHr === null &&
        line2.shiftTargetPcs === null &&
        line2.actualPcsHr === null &&
        line2.efficiencyPercent === null &&
        line2.dhuPercent === null &&
        !!line3 &&
        line3.targetPcsHr === null &&
        line3.shiftTargetPcs === null &&
        line3.actualPcsHr === null &&
        line3.efficiencyPercent === null &&
        line3.dhuPercent === null;

      const noHardcodedCounts =
        snap.summaryMeta.totalLineCount === 3 &&
        snap.summaryMeta.reportingLineCount === 1 &&
        snap.summaryMeta.runningLineCount === 3 &&
        snap.summaryMeta.totalOperators === 90 &&
        !snap.summaryMeta.floorNotice.description.includes('ST-318') &&
        !snap.summaryMeta.floorNotice.description.includes('Line 04') &&
        !snap.summaryMeta.floorNotice.description.includes('Line 06');

      // Also verify empty database renders truthful empty/unavailable states cleanly in UI
      const emptyIDB = new IDBFactory();
      const emptyDb = createIsolatedTestDatabase(emptyIDB, IDBKeyRange, 'TestDB_Defect_B1_Empty');
      const emptyRepos = createRepositories(emptyDb);
      await emptyDb.open();
      let emptyStateOk = false;
      try {
        const emptySnap = await buildDashboardSnapshot(emptyRepos, DEFAULT_PLANT_SETTINGS);
        const emptyDhu = emptySnap.metrics.find((m) => m.id === 'quality_dhu');
        const emptyOrders = emptySnap.metrics.find((m) => m.id === 'total_orders');

        const uiCheck = await withTestDom(async ({ container, renderSync }) => {
          renderSync(
            React.createElement(DashboardView, {
              metrics: emptySnap.metrics,
              hourlyData: emptySnap.hourlyData,
              lines: emptySnap.lines,
              summaryMeta: emptySnap.summaryMeta,
              plantSettings: DEFAULT_PLANT_SETTINGS,
              onNavigateTab: () => {},
            })
          );
          const text = container.textContent || '';
          return {
            hasChartEmpty: !!container.querySelector('[data-testid="production-chart-empty"]'),
            hasLineEmpty: !!container.querySelector('[data-testid="line-table-empty"]'),
            hasZeroOperators: (container.querySelector('[data-testid="line-table-operators-count"]')?.textContent || '').includes('0 Floor Operators'),
            noFakeFooter: !text.includes('8,800 pcs') && !text.includes('174 Floor Operators') && !text.includes('ST-318'),
          };
        });

        emptyStateOk =
          emptyDhu?.value === 'N/A' &&
          emptyOrders?.value === '0' &&
          emptySnap.hourlyData.length === 0 &&
          emptySnap.lines.length === 0 &&
          uiCheck.hasChartEmpty &&
          uiCheck.hasLineEmpty &&
          uiCheck.hasZeroOperators &&
          uiCheck.noFakeFooter;
      } finally {
        emptyDb.close();
      }

      const passed =
        line1DerivedOk && linesWithoutTelemetryUnavailable && noHardcodedCounts && emptyStateOk;
      results.push({
        testNumber: 3,
        bugId: 'BUG_1_DASHBOARD',
        name: 'Line metrics, operator counts, chart annotations, and empty states use real data without fabrication',
        passed,
        message: passed
          ? 'Verified 3 lines / 90 operators, real LINE-01 hourly averages (1056 pcs/hr, 96.6% eff, 3.2% DHU), N/A on lines without telemetry, and truthful empty DB states.'
          : `Floor line / empty check failed: ${JSON.stringify({ line1DerivedOk, linesWithoutTelemetryUnavailable, noHardcodedCounts, emptyStateOk })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 3,
      bugId: 'BUG_1_DASHBOARD',
      name: 'Line metrics, operator counts, chart annotations, and empty states use real data without fabrication',
      passed: false,
      message: `Test 3 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 4 (BUG 2) — Settings Reset Defaults confirmation, persistence & operational data safety
  // =========================================================================
  try {
    const sharedIDB = new IDBFactory();
    const dbName = 'TestDB_Defect_B2_Reset';
    const { db, repos } = await setupSeededDb(dbName, sharedIDB);
    try {
      const countsBefore = await repos.system.getTableCounts();
      const balancesBefore = await repos.inventory.getAllStockBalances();

      // 1. Save custom settings first
      const customSettings: PlantSettings = {
        ...DEFAULT_PLANT_SETTINGS,
        plantName: 'Custom Knitwear Unit 99',
        plantCode: 'SP-CUST-99',
        division: 'Technical Outerwear Division',
        activeShift: 'Shift C (23:00 - 07:00)',
        plannedDailyOutput: 15500,
        sewingLinesConfigured: 12,
        dhuToleranceLimit: 4.4,
        autoDefectEscalation: false,
      };
      await repos.system.savePlantSettings(customSettings);

      // 2. Test UI flow: Cancel keeps custom values; Confirm restores defaults & shows reset toast
      let latestSettings = await repos.system.getPlantSettings();
      const uiCheck = await withTestDom(async ({ container, renderSync, flushEffects }) => {
        const renderSettings = (current: PlantSettings) => {
          renderSync(
            React.createElement(SettingsView, {
              settings: current,
              onSaveSettings: async (upd) => {
                latestSettings = await repos.system.savePlantSettings(upd);
                renderSettings(latestSettings);
                return latestSettings;
              },
              onResetDefaults: async () => {
                latestSettings = await repos.system.resetPlantSettings();
                renderSettings(latestSettings);
                return latestSettings;
              },
            })
          );
        };

        renderSettings(latestSettings);
        await flushEffects(20);

        // Open reset confirmation modal
        const resetBtn = container.querySelector('[data-testid="settings-reset-defaults-btn"]');
        flushSync(() => resetBtn.click());
        const modalOpened = !!container.querySelector('[data-testid="reset-defaults-confirm-modal"]');

        // Click Cancel -> custom value must remain intact
        const cancelBtn = container.querySelector('[data-testid="reset-defaults-cancel-btn"]');
        flushSync(() => cancelBtn.click());
        const keptCustomAfterCancel =
          container.querySelector('[data-testid="planned-daily-output-input"]')?.value === '15500' &&
          container.querySelector('[data-testid="settings-plant-code-input"]')?.value === 'SP-CUST-99';

        // Open again and Confirm Reset Defaults
        flushSync(() => container.querySelector('[data-testid="settings-reset-defaults-btn"]').click());
        const confirmBtn = container.querySelector('[data-testid="reset-defaults-confirm-btn"]');
        flushSync(() => confirmBtn.click());
        await flushEffects(40);

        const restoredOutputVal =
          container.querySelector('[data-testid="planned-daily-output-input"]')?.value;
        const restoredPlantCode =
          container.querySelector('[data-testid="settings-plant-code-input"]')?.value;
        const hasResetToast = !!container.querySelector('[data-testid="settings-toast-reset"]');
        const hasSavedToast = !!container.querySelector('[data-testid="settings-toast-saved"]');

        return {
          modalOpened,
          keptCustomAfterCancel,
          restoredOutputVal,
          restoredPlantCode,
          hasResetToast,
          hasSavedToast,
        };
      });

      db.close();

      // 3. Reopen database (simulating full page refresh) and confirm reset persisted & operational data untouched
      const reopenedDb = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
      const reopenedRepos = createRepositories(reopenedDb);
      await reopenedDb.open();
      try {
        const persistedAfterRefresh = await reopenedRepos.system.getPlantSettings();
        const countsAfter = await reopenedRepos.system.getTableCounts();
        const balancesAfter = await reopenedRepos.inventory.getAllStockBalances();

        const resetPersistedAcrossReload =
          persistedAfterRefresh.plantName === DEFAULT_PLANT_SETTINGS.plantName &&
          persistedAfterRefresh.plantCode === DEFAULT_PLANT_SETTINGS.plantCode &&
          persistedAfterRefresh.activeShift === DEFAULT_PLANT_SETTINGS.activeShift &&
          persistedAfterRefresh.plannedDailyOutput === DEFAULT_PLANT_SETTINGS.plannedDailyOutput &&
          persistedAfterRefresh.sewingLinesConfigured === DEFAULT_PLANT_SETTINGS.sewingLinesConfigured &&
          persistedAfterRefresh.dhuToleranceLimit === DEFAULT_PLANT_SETTINGS.dhuToleranceLimit &&
          persistedAfterRefresh.autoDefectEscalation === DEFAULT_PLANT_SETTINGS.autoDefectEscalation;

        const operationalDataPreserved =
          JSON.stringify(countsBefore) === JSON.stringify(countsAfter) &&
          JSON.stringify(balancesBefore) === JSON.stringify(balancesAfter);

        const passed =
          uiCheck.modalOpened &&
          uiCheck.keptCustomAfterCancel &&
          uiCheck.restoredOutputVal === String(DEFAULT_PLANT_SETTINGS.plannedDailyOutput) &&
          uiCheck.restoredPlantCode === DEFAULT_PLANT_SETTINGS.plantCode &&
          uiCheck.hasResetToast &&
          !uiCheck.hasSavedToast &&
          resetPersistedAcrossReload &&
          operationalDataPreserved;

        results.push({
          testNumber: 4,
          bugId: 'BUG_2_SETTINGS_RESET',
          name: 'Settings Reset Defaults requires confirmation, restores defaults across refresh, and preserves operational data',
          passed,
          message: passed
            ? 'Confirmed Reset modal Cancel/Confirm flow, distinct reset toast, persistence of DEFAULT_PLANT_SETTINGS across DB reopen, and 100% preservation of all 15 operational tables.'
            : `Settings reset check failed: ${JSON.stringify({ uiCheck, resetPersistedAcrossReload, operationalDataPreserved })}`,
        });
      } finally {
        reopenedDb.close();
      }
    } catch (innerErr) {
      db.close();
      throw innerErr;
    }
  } catch (err: any) {
    results.push({
      testNumber: 4,
      bugId: 'BUG_2_SETTINGS_RESET',
      name: 'Settings Reset Defaults requires confirmation, restores defaults across refresh, and preserves operational data',
      passed: false,
      message: `Test 4 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 5 (BUG 3) — Settings UI rejects negative daily output, accepts 0 & positive, no silent coercion
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B3_UI');
    try {
      let saveCalls = 0;
      let currentSettings = await repos.system.getPlantSettings();

      const uiCheck = await withTestDom(async ({ container, renderSync, flushEffects, setInputValue, submitForm }) => {
        const renderSettings = (s: PlantSettings) => {
          renderSync(
            React.createElement(SettingsView, {
              settings: s,
              onSaveSettings: async (upd) => {
                saveCalls += 1;
                currentSettings = await repos.system.savePlantSettings(upd);
                renderSettings(currentSettings);
                return currentSettings;
              },
              onResetDefaults: async () => {
                currentSettings = await repos.system.resetPlantSettings();
                renderSettings(currentSettings);
                return currentSettings;
              },
            })
          );
        };

        renderSettings(currentSettings);
        await flushEffects(20);

        const outputInput = container.querySelector('[data-testid="planned-daily-output-input"]');
        const form = container.querySelector('form');

        // 1. Enter -500 -> must NOT convert to 0, must display error, must block save
        setInputValue(outputInput, '-500');
        const valueNotCoerced = outputInput.value === '-500';
        const inlineErrorShown = !!(
          container.querySelector('[data-testid="planned-daily-output-error"]')?.textContent || ''
        ).includes('cannot be negative');

        submitForm(form);
        await flushEffects(25);
        const blockedNegativeSave = saveCalls === 0;
        const formErrorShown = !!container.querySelector('[data-testid="settings-validation-error"]');

        // 2. Enter 0 -> must accept and save
        setInputValue(outputInput, '0');
        submitForm(form);
        await flushEffects(35);
        const zeroAccepted = saveCalls === 1 && currentSettings.plannedDailyOutput === 0;

        // 3. Enter 12500 -> must accept and save
        setInputValue(outputInput, '12500');
        submitForm(form);
        await flushEffects(35);
        const positiveAccepted = saveCalls === 2 && currentSettings.plannedDailyOutput === 12500;

        return {
          valueNotCoerced,
          inlineErrorShown,
          blockedNegativeSave,
          formErrorShown,
          zeroAccepted,
          positiveAccepted,
        };
      });

      const stored = await repos.system.getPlantSettings();
      const passed =
        uiCheck.valueNotCoerced &&
        uiCheck.inlineErrorShown &&
        uiCheck.blockedNegativeSave &&
        uiCheck.formErrorShown &&
        uiCheck.zeroAccepted &&
        uiCheck.positiveAccepted &&
        stored.plannedDailyOutput === 12500;

      results.push({
        testNumber: 5,
        bugId: 'BUG_3_NEGATIVE_OUTPUT',
        name: 'Settings UI rejects negative Planned Daily Output without silent coercion and accepts 0 and positive values',
        passed,
        message: passed
          ? 'Verified -500 stayed "-500" with clear inline error and blocked save; 0 and 12500 saved cleanly to IndexedDB.'
          : `Negative output UI check failed: ${JSON.stringify({ uiCheck, storedOutput: stored.plannedDailyOutput })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 5,
      bugId: 'BUG_3_NEGATIVE_OUTPUT',
      name: 'Settings UI rejects negative Planned Daily Output without silent coercion and accepts 0 and positive values',
      passed: false,
      message: `Test 5 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 6 (BUG 3) — Underlying repositories reject negative output quantities & accept 0/positive
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B3_Repo');
    try {
      // 1. SystemRepository.savePlantSettings
      let settingsNegRejected = false;
      try {
        await repos.system.savePlantSettings({
          ...DEFAULT_PLANT_SETTINGS,
          plannedDailyOutput: -1,
        });
      } catch (err) {
        settingsNegRejected = err instanceof ValidationError;
      }
      const settingsAfterNeg = await repos.system.getPlantSettings();
      const settingsZeroSaved = await repos.system.savePlantSettings({
        ...DEFAULT_PLANT_SETTINGS,
        plannedDailyOutput: 0,
      });

      // 2. ProductionRepository.recordProductionEvent
      const eventsBefore = await repos.production.getAllProductionEvents();
      let eventNegRejected = false;
      try {
        await repos.production.recordProductionEvent({
          id: 'EV-NEG-TEST',
          lineId: 'LINE-01',
          orderId: 'ORD-01',
          eventType: 'HOURLY_OUTPUT',
          quantityProduced: -50,
          targetQuantity: 100,
          efficiencyPercent: 0,
          dhuPercent: 0,
          notes: 'Invalid negative output',
          recordedBy: 'QA Test',
          timestamp: '2026-11-08T09:00:00.000Z',
          isSimulated: true,
        });
      } catch (err) {
        eventNegRejected = err instanceof ValidationError;
      }
      const eventsAfterNeg = await repos.production.getAllProductionEvents();

      const zeroEvent = await repos.production.recordProductionEvent({
        id: 'EV-ZERO-TEST',
        lineId: 'LINE-01',
        orderId: 'ORD-01',
        eventType: 'HOURLY_OUTPUT',
        quantityProduced: 0,
        targetQuantity: 100,
        efficiencyPercent: 0,
        dhuPercent: 0,
        notes: 'Valid zero output during changeover',
        recordedBy: 'QA Test',
        timestamp: '2026-11-08T10:00:00.000Z',
        isSimulated: true,
      });

      const posEvent = await repos.production.recordProductionEvent({
        id: 'EV-POS-TEST',
        lineId: 'LINE-01',
        orderId: 'ORD-01',
        eventType: 'HOURLY_OUTPUT',
        quantityProduced: 180,
        targetQuantity: 160,
        efficiencyPercent: 112.5,
        dhuPercent: 1.5,
        notes: 'Valid positive output',
        recordedBy: 'QA Test',
        timestamp: '2026-11-08T11:00:00.000Z',
        isSimulated: true,
      });

      // 3. OrderRepository.updateOrderProgress & createOrder
      const ordBefore = await repos.orders.getOrderById('ORD-01');
      let orderProgressNegRejected = false;
      try {
        await repos.orders.updateOrderProgress('ORD-01', -25);
      } catch (err) {
        orderProgressNegRejected = err instanceof ValidationError;
      }
      const ordAfterNeg = await repos.orders.getOrderById('ORD-01');
      const ordZero = await repos.orders.updateOrderProgress('ORD-01', 0);
      const ordPos = await repos.orders.updateOrderProgress('ORD-01', 11500);

      let createOrderNegRejected = false;
      try {
        await repos.orders.createOrder({
          id: 'ORD-NEG-PROD',
          poNumber: 'PO-NEG-PROD-01',
          buyerId: 'BUY-01',
          styleId: 'STY-01',
          orderQuantity: 500,
          producedQuantity: -10,
          targetExFactoryDate: '2026-12-20',
          status: 'DRAFT',
          assignedLineId: 'LINE-01',
          dhuPercent: 0,
          notes: 'Negative produced qty check',
          isSimulated: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        createOrderNegRejected = err instanceof ValidationError;
      }

      const passed =
        settingsNegRejected &&
        settingsAfterNeg.plannedDailyOutput === DEFAULT_PLANT_SETTINGS.plannedDailyOutput &&
        settingsZeroSaved.plannedDailyOutput === 0 &&
        eventNegRejected &&
        eventsAfterNeg.length === eventsBefore.length &&
        zeroEvent.quantityProduced === 0 &&
        posEvent.quantityProduced === 180 &&
        orderProgressNegRejected &&
        ordAfterNeg?.producedQuantity === ordBefore?.producedQuantity &&
        ordZero.producedQuantity === 0 &&
        ordPos.producedQuantity === 11500 &&
        createOrderNegRejected;

      results.push({
        testNumber: 6,
        bugId: 'BUG_3_NEGATIVE_OUTPUT',
        name: 'SystemRepository, ProductionRepository, and OrderRepository reject negative quantities and accept 0/positive values',
        passed,
        message: passed
          ? 'Verified ValidationError thrown for negative plannedDailyOutput, production_events.quantityProduced, and order producedQuantity; 0 and positive quantities persisted cleanly.'
          : 'Repository negative output validation check failed.',
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 6,
      bugId: 'BUG_3_NEGATIVE_OUTPUT',
      name: 'SystemRepository, ProductionRepository, and OrderRepository reject negative quantities and accept 0/positive values',
      passed: false,
      message: `Test 6 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 7 (BUG 1) — Hourly production summary uses factory local timezone (no UTC shift/split)
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B1_Timezone');
    try {
      // 1. Seeded Shift A events must map to 08:00 - 15:00 in the factory's local timezone
      const seededHourly = await repos.production.getHourlyProductionSummary();
      const seededHours = seededHourly.map((h) => h.hour);
      const expectedSeededHours = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'];
      const seededHoursOk = JSON.stringify(seededHours) === JSON.stringify(expectedSeededHours);

      // 2. Two real-time UTC ISO events occurring at 16:15 and 16:45 LOCAL time must group into
      //    a single '16:00' local bucket (even in half-hour offset zones like Asia/Kolkata +05:30,
      //    where 16:15 IST = 10:45Z and 16:45 IST = 11:15Z would split across two UTC hours!).
      const local1615 = new Date(2026, 10, 8, 16, 15, 0).toISOString();
      const local1645 = new Date(2026, 10, 8, 16, 45, 0).toISOString();

      await repos.production.recordProductionEvent({
        id: 'EV-TZ-1',
        lineId: 'LINE-02',
        orderId: 'ORD-02',
        eventType: 'HOURLY_OUTPUT',
        quantityProduced: 110,
        targetQuantity: 120,
        efficiencyPercent: 91.7,
        dhuPercent: 1.5,
        notes: 'Local 16:15 output',
        recordedBy: 'QA Test',
        timestamp: local1615,
        isSimulated: false,
      });
      await repos.production.recordProductionEvent({
        id: 'EV-TZ-2',
        lineId: 'LINE-02',
        orderId: 'ORD-02',
        eventType: 'HOURLY_OUTPUT',
        quantityProduced: 130,
        targetQuantity: 120,
        efficiencyPercent: 108.3,
        dhuPercent: 2.0,
        notes: 'Local 16:45 output',
        recordedBy: 'QA Test',
        timestamp: local1645,
        isSimulated: false,
      });

      const updatedHourly = await repos.production.getHourlyProductionSummary();
      const slot16 = updatedHourly.find((h) => h.hour === '16:00');
      const localGroupingOk =
        updatedHourly.length === 9 &&
        !!slot16 &&
        slot16.actualPcs === 240 &&
        slot16.targetPcs === 240 &&
        slot16.efficiency === 100;

      const passed = seededHoursOk && localGroupingOk;
      results.push({
        testNumber: 7,
        bugId: 'BUG_1_DASHBOARD',
        name: 'Hourly production chart groups events by factory local timezone without UTC shift or split',
        passed,
        message: passed
          ? `Verified Shift A seeded slots (08:00-15:00) and grouped local 16:15 + 16:45 ISO instants into single 16:00 slot (240/240 pcs).`
          : `Timezone grouping mismatch: seededHours=${JSON.stringify(seededHours)}, slot16=${JSON.stringify(slot16)}, totalSlots=${updatedHourly.length}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 7,
      bugId: 'BUG_1_DASHBOARD',
      name: 'Hourly production chart groups events by factory local timezone without UTC shift or split',
      passed: false,
      message: `Test 7 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 8 (BUG 1) — Shift start/end boundaries & before/during/after shift exclusion
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B1_ShiftBounds');
    try {
      // Record events BEFORE Shift A (06:59), AT start (07:00), BEFORE end (15:29), AT end (15:30), AFTER end (16:30)
      // on a single date 2026-11-10, plus overnight Shift C events (23:15 on 2026-11-10 and 01:30 on 2026-11-11)
      const boundaryEvents = [
        { id: 'EV-B-PRE', ts: '2026-11-10T06:59:00', qty: 999, tgt: 1000, lineId: 'LINE-02' },
        { id: 'EV-B-START', ts: '2026-11-10T07:00:00', qty: 200, tgt: 250, lineId: 'LINE-02' },
        { id: 'EV-B-ENDIN', ts: '2026-11-10T15:29:00', qty: 180, tgt: 200, lineId: 'LINE-02' },
        { id: 'EV-B-ENDOUT', ts: '2026-11-10T15:30:00', qty: 300, tgt: 300, lineId: 'LINE-02' },
        { id: 'EV-B-POST', ts: '2026-11-10T16:30:00', qty: 400, tgt: 400, lineId: 'LINE-02' },
        { id: 'EV-C-NIGHT1', ts: '2026-11-10T23:15:00', qty: 150, tgt: 200, lineId: 'LINE-03' },
        { id: 'EV-C-NIGHT2', ts: '2026-11-11T01:30:00', qty: 170, tgt: 200, lineId: 'LINE-03' },
        { id: 'EV-C-AFTER', ts: '2026-11-11T07:00:00', qty: 500, tgt: 500, lineId: 'LINE-03' },
      ];

      for (const item of boundaryEvents) {
        await repos.production.recordProductionEvent({
          id: item.id,
          lineId: item.lineId,
          orderId: 'ORD-02',
          eventType: 'HOURLY_OUTPUT',
          quantityProduced: item.qty,
          targetQuantity: item.tgt,
          efficiencyPercent: 0,
          dhuPercent: 1.0,
          notes: 'Shift boundary test',
          recordedBy: 'QA Test',
          timestamp: item.ts,
          isSimulated: false,
        });
      }

      const fixedNow = new Date(2026, 10, 12, 12, 0, 0); // 2026-11-12 12:00 local

      // Shift A (07:00 - 15:30) on 2026-11-10: must include ONLY 07:00 (200) and 15:29 (180), total 380/450
      const snapA = await buildDashboardSnapshot(
        repos,
        { ...DEFAULT_PLANT_SETTINGS, activeShift: 'Shift A (07:00 - 15:30)' },
        { reportingDate: '2026-11-10', now: fixedNow }
      );
      const hoursA = snapA.hourlyData.map((h) => h.hour);
      const expectedHoursA = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'];
      const slot07A = snapA.hourlyData.find((h) => h.hour === '07:00');
      const slot15A = snapA.hourlyData.find((h) => h.hour === '15:00');
      const slot10A = snapA.hourlyData.find((h) => h.hour === '10:00');
      const shiftAOk =
        JSON.stringify(hoursA) === JSON.stringify(expectedHoursA) &&
        snapA.summaryMeta.totalProducedPcs === 380 &&
        snapA.summaryMeta.shiftTargetPcs === 450 &&
        slot07A?.actualPcs === 200 &&
        slot15A?.actualPcs === 180 &&
        slot10A?.actualPcs === 0 &&
        slot10A?.targetPcs === null &&
        slot10A?.eventCount === 0 &&
        slot10A?.efficiency === null;

      // Shift B (15:30 - 23:00) on 2026-11-10: must include ONLY 15:30 (300) and 16:30 (400), total 700/700
      const snapB = await buildDashboardSnapshot(
        repos,
        { ...DEFAULT_PLANT_SETTINGS, activeShift: 'Shift B (15:30 - 23:00)' },
        { reportingDate: '2026-11-10', now: fixedNow }
      );
      const hoursB = snapB.hourlyData.map((h) => h.hour);
      const expectedHoursB = ['15:30', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
      const shiftBOk =
        JSON.stringify(hoursB) === JSON.stringify(expectedHoursB) &&
        snapB.summaryMeta.totalProducedPcs === 700 &&
        snapB.summaryMeta.shiftTargetPcs === 700 &&
        snapB.summaryMeta.shiftEfficiencyPercent === 100;

      // Overnight Shift C (23:00 - 07:00) starting 2026-11-10: must include 23:15 (150) + 01:30 next day (170), exclude 07:00 next day
      const snapC = await buildDashboardSnapshot(
        repos,
        { ...DEFAULT_PLANT_SETTINGS, activeShift: 'Shift C (23:00 - 07:00)' },
        { reportingDate: '2026-11-10', now: fixedNow }
      );
      const hoursC = snapC.hourlyData.map((h) => h.hour);
      const expectedHoursC = ['23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00'];
      const shiftCOk =
        JSON.stringify(hoursC) === JSON.stringify(expectedHoursC) &&
        snapC.summaryMeta.totalProducedPcs === 320 &&
        snapC.summaryMeta.shiftTargetPcs === 400 &&
        snapC.summaryMeta.shiftEfficiencyPercent === 80;

      const passed = shiftAOk && shiftBOk && shiftCOk;
      results.push({
        testNumber: 8,
        bugId: 'BUG_1_DASHBOARD',
        name: 'Shift boundaries strictly include [start, end) intervals and exclude before/after-shift events across Shift A, B, and overnight Shift C',
        passed,
        message: passed
          ? 'Verified Shift A (07:00-15:00, 380 pcs), Shift B (15:30-22:00, 700 pcs), and overnight Shift C (23:00-06:00, 320 pcs) with exact boundary exclusion.'
          : `Shift boundary mismatch: ${JSON.stringify({ shiftAOk, shiftBOk, shiftCOk, hoursA, hoursB, hoursC, aTot: snapA.summaryMeta.totalProducedPcs, bTot: snapB.summaryMeta.totalProducedPcs, cTot: snapC.summaryMeta.totalProducedPcs })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 8,
      bugId: 'BUG_1_DASHBOARD',
      name: 'Shift boundaries strictly include [start, end) intervals and exclude before/after-shift events across Shift A, B, and overnight Shift C',
      passed: false,
      message: `Test 8 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 9 (BUG 1) — Multi-date isolation & future-hour exclusion on live reporting date
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B1_DateAndFuture');
    try {
      // Seeded DB already has 2026-11-07 Shift A (8,450 pcs). Add Shift A events on 2026-11-24:
      // 08:00 (250/250), 09:30 (275/250), and a FUTURE event at 13:00 (900/900) when now = 10:15 local.
      await repos.production.recordProductionEvent({
        id: 'EV-D24-08',
        lineId: 'LINE-01',
        orderId: 'ORD-01',
        eventType: 'HOURLY_OUTPUT',
        quantityProduced: 250,
        targetQuantity: 250,
        efficiencyPercent: 100,
        dhuPercent: 1.2,
        notes: 'Nov 24 08:00',
        recordedBy: 'QA Test',
        timestamp: '2026-11-24T08:00:00',
        isSimulated: false,
      });
      await repos.production.recordProductionEvent({
        id: 'EV-D24-09',
        lineId: 'LINE-01',
        orderId: 'ORD-01',
        eventType: 'HOURLY_OUTPUT',
        quantityProduced: 275,
        targetQuantity: 250,
        efficiencyPercent: 110,
        dhuPercent: 1.4,
        notes: 'Nov 24 09:30',
        recordedBy: 'QA Test',
        timestamp: '2026-11-24T09:30:00',
        isSimulated: false,
      });
      await repos.production.recordProductionEvent({
        id: 'EV-D24-13-FUTURE',
        lineId: 'LINE-01',
        orderId: 'ORD-01',
        eventType: 'HOURLY_OUTPUT',
        quantityProduced: 900,
        targetQuantity: 900,
        efficiencyPercent: 100,
        dhuPercent: 1.0,
        notes: 'Future timestamp should be excluded',
        recordedBy: 'QA Test',
        timestamp: '2026-11-24T13:00:00',
        isSimulated: false,
      });

      const liveNow = new Date(2026, 10, 24, 10, 15, 0); // 2026-11-24 10:15 local
      const snapLive = await buildDashboardSnapshot(repos, DEFAULT_PLANT_SETTINGS, { now: liveNow });

      // Must pick 2026-11-24 ONLY (never mix 2026-11-07's 8,450 pcs!),
      // show ONLY elapsed hours [07:00, 08:00, 09:00, 10:00] (NO 11:00..15:00 future hours!),
      // and exclude the 13:00 future event (900 pcs).
      const liveHours = snapLive.hourlyData.map((h) => h.hour);
      const expectedLiveHours = ['07:00', '08:00', '09:00', '10:00'];
      const dateAndFutureOk =
        snapLive.summaryMeta.reportingDate === '2026-11-24' &&
        snapLive.summaryMeta.isHistoricalDate === false &&
        snapLive.summaryMeta.isSimulatedShiftData === false &&
        JSON.stringify(liveHours) === JSON.stringify(expectedLiveHours) &&
        snapLive.summaryMeta.totalProducedPcs === 525 &&
        snapLive.summaryMeta.shiftTargetPcs === 500 &&
        snapLive.summaryMeta.shiftEfficiencyPercent === 105;

      const passed = dateAndFutureOk;
      results.push({
        testNumber: 9,
        bugId: 'BUG_1_DASHBOARD',
        name: 'Multi-date production records are never combined and future shift hours are excluded from completed production',
        passed,
        message: passed
          ? `Verified 2026-11-24 isolated from 2026-11-07 (525/500 pcs = 105.0%) with only elapsed slots ${JSON.stringify(liveHours)} at 10:15 local.`
          : `Date/future isolation failed: ${JSON.stringify({ reportingDate: snapLive.summaryMeta.reportingDate, liveHours, produced: snapLive.summaryMeta.totalProducedPcs, target: snapLive.summaryMeta.shiftTargetPcs })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 9,
      bugId: 'BUG_1_DASHBOARD',
      name: 'Multi-date production records are never combined and future shift hours are excluded from completed production',
      passed: false,
      message: `Test 9 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 10 (BUG 1 & Clock) — Chart/Peak/Line efficiency reconciliation, N/A on 0-target, and single local header clock
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B1_Reconcile');
    try {
      // 1. Seeded Shift A reconciliation (LINE-01 is only reporting line)
      const snap = await buildDashboardSnapshot(repos, DEFAULT_PLANT_SETTINGS);
      const line1 = snap.lines.find((l) => l.lineId === 'LINE-01');
      const peakSlot = snap.hourlyData.reduce(
        (best, s) => (s.actualPcs > best.actualPcs ? s : best),
        snap.hourlyData[0]
      );
      const chartTargetSum = snap.hourlyData.reduce((s, h) => s + (h.targetPcs ?? 0), 0);
      const chartActualSum = snap.hourlyData.reduce((s, h) => s + h.actualPcs, 0);

      const seededReconcileOk =
        peakSlot.hour === '14:00' &&
        peakSlot.actualPcs === 1220 &&
        peakSlot.targetPcs === 1200 &&
        peakSlot.efficiency === Math.round((1220 / 1200) * 1000) / 10 &&
        chartTargetSum === 8750 &&
        chartActualSum === 8450 &&
        line1?.shiftTargetPcs === chartTargetSum &&
        line1?.shiftActualPcs === chartActualSum &&
        line1?.efficiencyPercent === snap.summaryMeta.shiftEfficiencyPercent &&
        snap.summaryMeta.shiftEfficiencyPercent === 96.6;

      // 2. Event with explicitly configured zero target (targetQuantity = 0) vs unlogged slot/line:
      //    - Logged slot/line preserves explicit 0 target while efficiency remains null (N/A), never substituting line capacity.
      //    - Unlogged slot/line uses null target to denote missing target data.
      await repos.production.recordProductionEvent({
        id: 'EV-NOTARGET-L2',
        lineId: 'LINE-02',
        orderId: 'ORD-02',
        eventType: 'HOURLY_OUTPUT',
        quantityProduced: 190,
        targetQuantity: 0,
        efficiencyPercent: 0,
        dhuPercent: 1.0,
        notes: 'Output with explicitly configured zero target',
        recordedBy: 'QA Test',
        timestamp: '2026-11-15T09:00:00',
        isSimulated: false,
      });
      const snapNoTarget = await buildDashboardSnapshot(repos, DEFAULT_PLANT_SETTINGS, {
        reportingDate: '2026-11-15',
        now: new Date(2026, 10, 16, 12, 0, 0),
      });
      const slot08Missing = snapNoTarget.hourlyData.find((h) => h.hour === '08:00');
      const slot09NoTarget = snapNoTarget.hourlyData.find((h) => h.hour === '09:00');
      const line2NoTarget = snapNoTarget.lines.find((l) => l.lineId === 'LINE-02');
      const line3Unlogged = snapNoTarget.lines.find((l) => l.lineId === 'LINE-03');
      const unavailableTargetOk =
        slot08Missing?.actualPcs === 0 &&
        slot08Missing?.targetPcs === null &&
        slot08Missing?.eventCount === 0 &&
        slot08Missing?.efficiency === null &&
        slot09NoTarget?.actualPcs === 190 &&
        slot09NoTarget?.targetPcs === 0 &&
        slot09NoTarget?.eventCount === 1 &&
        slot09NoTarget?.efficiency === null &&
        line2NoTarget?.shiftActualPcs === 190 &&
        line2NoTarget?.shiftTargetPcs === 0 &&
        line2NoTarget?.targetPcsHr === 0 &&
        line2NoTarget?.efficiencyPercent === null &&
        line3Unlogged?.shiftTargetPcs === null &&
        line3Unlogged?.targetPcsHr === null &&
        snapNoTarget.summaryMeta.shiftTargetPcs === 0 &&
        snapNoTarget.summaryMeta.shiftEfficiencyPercent === null;

      // 3. Render DashboardView & TopNavbar in test DOM: verify peak target displayed & single local clock rendered
      const uiCheck = await withTestDom(async ({ container, renderSync }) => {
        renderSync(
          React.createElement(
            'div',
            null,
            React.createElement(TopNavbar, {
              currentTab: 'dashboard',
              onOpenMobileMenu: () => {},
              onSelectTab: () => {},
              onOpenDbModal: () => {},
              plantSettings: DEFAULT_PLANT_SETTINGS,
            }),
            React.createElement(DashboardView, {
              metrics: snap.metrics,
              hourlyData: snap.hourlyData,
              lines: snap.lines,
              summaryMeta: snap.summaryMeta,
              plantSettings: DEFAULT_PLANT_SETTINGS,
              onNavigateTab: () => {},
            })
          )
        );

        const clocks = container.querySelectorAll('[data-testid="header-local-clock"]');
        const clockText = clocks[0]?.textContent?.trim() || '';
        const footerText = container.querySelector('[data-testid="production-chart-footer"]')?.textContent || '';
        const line1Text = container.querySelector('[data-testid="line-row-LINE-01"]')?.textContent || '';
        const line2Text = container.querySelector('[data-testid="line-row-LINE-02"]')?.textContent || '';

        return {
          singleClockRendered: clocks.length === 1 && /^\d{2}:\d{2}:\d{2}$/.test(clockText),
          footerShowsPeakTargetAndShiftEff:
            footerText.includes('1,220 / 1,200 pcs target') &&
            footerText.includes('101.7% eff.') &&
            footerText.includes('96.6%'),
          line1MatchesChartTotals:
            line1Text.includes('8,750 pcs') &&
            line1Text.includes('8,450 pcs') &&
            line1Text.includes('96.6%'),
          line2ShowsNA: line2Text.includes('N/A'),
        };
      });

      const passed =
        seededReconcileOk &&
        unavailableTargetOk &&
        uiCheck.singleClockRendered &&
        uiCheck.footerShowsPeakTargetAndShiftEff &&
        uiCheck.line1MatchesChartTotals &&
        uiCheck.line2ShowsNA;

      results.push({
        testNumber: 10,
        bugId: 'BUG_1_DASHBOARD',
        name: 'Peak-hour efficiency, shift totals, Line table, N/A unavailable targets, and single local header clock reconcile accurately',
        passed,
        message: passed
          ? 'Verified Peak 14:00 (1,220/1,200 = 101.7%), Shift/Line-01 totals (8,450/8,750 = 96.6%), null/N/A when target=0, and single local HH:MM:SS header clock.'
          : `Reconciliation/clock check failed: ${JSON.stringify({ seededReconcileOk, unavailableTargetOk, uiCheck })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 10,
      bugId: 'BUG_1_DASHBOARD',
      name: 'Peak-hour efficiency, shift totals, Line table, N/A unavailable targets, and single local header clock reconcile accurately',
      passed: false,
      message: `Test 10 threw: ${err?.message}`,
    });
  }

  // =========================================================================
  // Test 11 (BUG 1) — Missing vs configured-zero hourly targets & historical/demo date labeling
  // =========================================================================
  try {
    const { db, repos } = await setupSeededDb('TestDB_Defect_B1_TargetAndHistorical');
    try {
      const initialEventsCount = (await repos.production.getAllProductionEvents()).length;

      // 1. Seeded 2026-11-07 Shift A viewed on 2026-11-25 10:00 local:
      //    - 07:00 has 0 events -> targetPcs MUST be null (missing), NOT 0.
      //    - summaryMeta MUST mark isHistoricalDate=true and isSimulatedShiftData=true.
      const nov25Now = new Date(2026, 10, 25, 10, 0, 0);
      const historicalSnap = await buildDashboardSnapshot(repos, DEFAULT_PLANT_SETTINGS, {
        now: nov25Now,
      });
      const repoHourly = await repos.production.getHourlyProductionSummary({
        activeShift: DEFAULT_PLANT_SETTINGS.activeShift,
        reportingDate: '2026-11-07',
        now: nov25Now,
      });

      const slot07Snap = historicalSnap.hourlyData.find((h) => h.hour === '07:00');
      const slot07Repo = repoHourly.find((h) => h.hour === '07:00');
      const slot14Snap = historicalSnap.hourlyData.find((h) => h.hour === '14:00');
      const outputMetric = historicalSnap.metrics.find((m) => m.id === 'production_output');

      const historicalMetaOk =
        historicalSnap.summaryMeta.reportingDate === '2026-11-07' &&
        historicalSnap.summaryMeta.isHistoricalDate === true &&
        historicalSnap.summaryMeta.isSimulatedShiftData === true &&
        slot07Snap?.eventCount === 0 &&
        slot07Snap?.targetPcs === null &&
        slot07Snap?.efficiency === null &&
        slot07Repo?.eventCount === 0 &&
        slot07Repo?.targetPcs === null &&
        outputMetric?.subtitle?.includes('Historical 2026-11-07 · Demo') === true;

      // 2. Add an explicit 0-target event on 2026-11-20 09:00 (non-simulated) to test configured 0 vs missing null
      await repos.production.recordProductionEvent({
        id: 'EV-EXPLICIT-ZERO-TGT',
        lineId: 'LINE-02',
        orderId: 'ORD-02',
        eventType: 'HOURLY_OUTPUT',
        quantityProduced: 145,
        targetQuantity: 0,
        efficiencyPercent: 0,
        dhuPercent: 0.8,
        notes: 'Explicitly configured zero target test',
        recordedBy: 'QA Test',
        timestamp: '2026-11-20T09:00:00',
        isSimulated: false,
      });
      const zeroTargetSnap = await buildDashboardSnapshot(repos, DEFAULT_PLANT_SETTINGS, {
        reportingDate: '2026-11-20',
        now: nov25Now,
      });
      const slot08Missing = zeroTargetSnap.hourlyData.find((h) => h.hour === '08:00')!;
      const slot09Zero = zeroTargetSnap.hourlyData.find((h) => h.hour === '09:00')!;

      const zeroVsNullDataOk =
        slot08Missing.eventCount === 0 &&
        slot08Missing.targetPcs === null &&
        slot09Zero.eventCount === 1 &&
        slot09Zero.targetPcs === 0 &&
        slot09Zero.efficiency === null &&
        zeroTargetSnap.summaryMeta.isHistoricalDate === true &&
        zeroTargetSnap.summaryMeta.isSimulatedShiftData === false &&
        zeroTargetSnap.summaryMeta.shiftTargetPcs === 0;

      // 3. Render DashboardView (historical demo & zero-target) and ProductionChartTooltip (null, 0, positive)
      const uiChecks = await withTestDom(async ({ container, renderSync }) => {
        renderSync(
          React.createElement(DashboardView, {
            metrics: historicalSnap.metrics,
            hourlyData: historicalSnap.hourlyData,
            lines: historicalSnap.lines,
            summaryMeta: historicalSnap.summaryMeta,
            plantSettings: DEFAULT_PLANT_SETTINGS,
            onNavigateTab: () => {},
          })
        );
        const histDateBadge =
          container.querySelector('[data-testid="production-chart-date-badge"]')?.textContent || '';
        const histSubtitle =
          container.querySelector('[data-testid="production-chart-subtitle"]')?.textContent || '';

        renderSync(
          React.createElement(DashboardView, {
            metrics: zeroTargetSnap.metrics,
            hourlyData: zeroTargetSnap.hourlyData,
            lines: zeroTargetSnap.lines,
            summaryMeta: zeroTargetSnap.summaryMeta,
            plantSettings: DEFAULT_PLANT_SETTINGS,
            onNavigateTab: () => {},
          })
        );
        const zeroDateBadge =
          container.querySelector('[data-testid="production-chart-date-badge"]')?.textContent || '';
        const zeroFooter =
          container.querySelector('[data-testid="production-chart-footer"]')?.textContent || '';

        // Tooltip for unlogged (missing target -> null) slot
        renderSync(
          React.createElement(ProductionChartTooltip, {
            active: true,
            label: '08:00',
            chartMode: 'output',
            reportingDate: '2026-11-20',
            payload: [{ name: 'Actual Output', value: 0, payload: slot08Missing }],
          })
        );
        const missingTooltipText =
          container.querySelector('[data-testid="production-chart-tooltip"]')?.textContent || '';

        // Tooltip for explicitly configured zero target (0) slot
        renderSync(
          React.createElement(ProductionChartTooltip, {
            active: true,
            label: '09:00',
            chartMode: 'output',
            reportingDate: '2026-11-20',
            payload: [{ name: 'Actual Output', value: 145, payload: slot09Zero }],
          })
        );
        const zeroTooltipText =
          container.querySelector('[data-testid="production-chart-tooltip"]')?.textContent || '';

        // Tooltip for positive target slot (14:00 = 1220 / 1200)
        renderSync(
          React.createElement(ProductionChartTooltip, {
            active: true,
            label: '14:00',
            chartMode: 'output',
            reportingDate: '2026-11-07',
            payload: [{ name: 'Actual Output', value: 1220, payload: slot14Snap }],
          })
        );
        const positiveTooltipText =
          container.querySelector('[data-testid="production-chart-tooltip"]')?.textContent || '';

        return {
          histBadgeOk: histDateBadge.includes('Historical · 2026-11-07 · Demo Data'),
          histSubtitleOk:
            histSubtitle.includes('No production events logged today') &&
            histSubtitle.includes('showing latest logged shift on 2026-11-07') &&
            histSubtitle.includes('simulated demo data'),
          zeroBadgeNonDemoOk:
            zeroDateBadge.includes('Historical · 2026-11-20') &&
            !zeroDateBadge.includes('Demo Data'),
          zeroFooterOk:
            zeroFooter.includes('0 pcs (configured)') &&
            zeroFooter.includes('0 pcs target (configured)') &&
            zeroFooter.includes('N/A eff.'),
          missingTooltipOk:
            missingTooltipText.includes('No production events logged for this interval') &&
            missingTooltipText.includes('No target data (N/A)') &&
            !missingTooltipText.includes('0 pcs (configured)'),
          zeroTooltipOk:
            !zeroTooltipText.includes('No production events logged for this interval') &&
            zeroTooltipText.includes('0 pcs (configured)') &&
            zeroTooltipText.includes('N/A (zero target)'),
          positiveTooltipOk:
            positiveTooltipText.includes('1,220 pcs') &&
            positiveTooltipText.includes('1,200 pcs') &&
            positiveTooltipText.includes('+20 pcs') &&
            positiveTooltipText.includes('101.7%'),
        };
      });

      // Verify existing records were preserved (initial + 1 added event)
      const finalEventsCount = (await repos.production.getAllProductionEvents()).length;
      const recordsPreserved = finalEventsCount === initialEventsCount + 1;

      const passed =
        historicalMetaOk &&
        zeroVsNullDataOk &&
        recordsPreserved &&
        Object.values(uiChecks).every(Boolean);

      results.push({
        testNumber: 11,
        bugId: 'BUG_1_DASHBOARD',
        name: 'Missing targets use null (N/A), configured zero targets preserve 0, and historical/demo reporting dates are explicitly labeled',
        passed,
        message: passed
          ? 'Verified null vs configured-0 targets across repository, snapshot, tooltip, and footer, plus explicit Historical/Demo labeling with all IndexedDB records preserved.'
          : `Issue 1/2 check failed: ${JSON.stringify({ historicalMetaOk, zeroVsNullDataOk, recordsPreserved, uiChecks })}`,
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    results.push({
      testNumber: 11,
      bugId: 'BUG_1_DASHBOARD',
      name: 'Missing targets use null (N/A), configured zero targets preserve 0, and historical/demo reporting dates are explicitly labeled',
      passed: false,
      message: `Test 11 threw: ${err?.message}`,
    });
  }

  const allPassed = results.every((r) => r.passed);
  return { allPassed, results };
}
