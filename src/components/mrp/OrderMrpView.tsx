import React, { useState, useMemo, useEffect } from 'react';
import {
  Calculator,
  Search,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Scissors,
  Archive,
  Package,
  Info,
  ArrowRight,
  RefreshCw,
  CheckSquare,
  Square,
  ListChecks,
  FileSpreadsheet,
} from 'lucide-react';
import { OrderWithDetails } from '../../db/hooks/useOrdersData';
import { BuyerEntity, MaterialCategory, StyleEntity } from '../../db/types';
import { useOrderMrp } from '../../db/hooks/useOrderMrp';
import {
  OrderMaterialMrpRequirement,
  MultiOrderMaterialMrpSummary,
} from '../../db/services/mrpService';

type MrpMode = 'single' | 'multi';
type CategoryFilter = 'ALL' | MaterialCategory;

interface OrderMrpViewProps {
  orders: OrderWithDetails[];
  styles: StyleEntity[];
  buyers: BuyerEntity[];
  isDbReady: boolean;
  onOpenStyleBom?: (styleId: string) => void;
}

function formatNumber(value: number, maxDecimals: number = 4): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

export const OrderMrpView: React.FC<OrderMrpViewProps> = ({
  orders,
  styles,
  buyers,
  isDbReady,
  onOpenStyleBom,
}) => {
  const [mode, setMode] = useState<MrpMode>('single');

  // Single-order selection state
  const [singleOrderSearch, setSingleOrderSearch] = useState<string>('');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [selectedBomVersion, setSelectedBomVersion] = useState<string>('AUTO');

  // Multi-order selection state
  const [multiOrderSearch, setMultiOrderSearch] = useState<string>('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [excludeCancelled, setExcludeCancelled] = useState<boolean>(true);

  // Results filtering & expandable row state
  const [materialSearch, setMaterialSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [shortagesOnly, setShortagesOnly] = useState<boolean>(false);
  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Record<string, boolean>>({});
  const [expandedOrderBreakdowns, setExpandedOrderBreakdowns] = useState<Record<string, boolean>>({});

  const {
    singleResult,
    singleCuttingJobs,
    multiResult,
    multiCuttingJobsByOrder,
    styleVersions,
    isLoadingVersions,
    isCalculating,
    error,
    loadStyleBomVersions,
    calculateSingleOrderMrp,
    calculateMultiOrderMrp,
    clearError,
  } = useOrderMrp();

  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const styleMap = useMemo(() => new Map(styles.map((s) => [s.id, s])), [styles]);
  const buyerMap = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);

  // Default to first non-cancelled order when orders load
  useEffect(() => {
    if (!selectedOrderId && orders.length > 0) {
      const firstActive = orders.find((o) => o.status !== 'CANCELLED') || orders[0];
      setSelectedOrderId(firstActive.id);
    }
  }, [orders, selectedOrderId]);

  const selectedOrder = useMemo(
    () => (selectedOrderId ? orderMap.get(selectedOrderId) || null : null),
    [orderMap, selectedOrderId]
  );

  // Load persisted BOM versions for the selected order's style
  useEffect(() => {
    if (!isDbReady || !selectedOrder) {
      return;
    }
    setSelectedBomVersion('AUTO');
    loadStyleBomVersions(selectedOrder.styleId);
  }, [isDbReady, selectedOrder, loadStyleBomVersions]);

  const filteredSingleOrders = useMemo(() => {
    const q = singleOrderSearch.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.poNumber.toLowerCase().includes(q) ||
        (o.internalOrderNumber && o.internalOrderNumber.toLowerCase().includes(q)) ||
        o.buyerName.toLowerCase().includes(q) ||
        o.buyerCode.toLowerCase().includes(q) ||
        o.styleCode.toLowerCase().includes(q) ||
        o.styleDescription.toLowerCase().includes(q)
    );
  }, [orders, singleOrderSearch]);

  const filteredMultiOrders = useMemo(() => {
    const q = multiOrderSearch.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.poNumber.toLowerCase().includes(q) ||
        (o.internalOrderNumber && o.internalOrderNumber.toLowerCase().includes(q)) ||
        o.buyerName.toLowerCase().includes(q) ||
        o.buyerCode.toLowerCase().includes(q) ||
        o.styleCode.toLowerCase().includes(q) ||
        o.styleDescription.toLowerCase().includes(q)
    );
  }, [orders, multiOrderSearch]);

  const handleModeSwitch = (nextMode: MrpMode) => {
    setMode(nextMode);
    clearError();
    setExpandedMaterialIds({});
    setMaterialSearch('');
    setCategoryFilter('ALL');
    setShortagesOnly(false);
  };

  const handleCalculateSingle = async () => {
    setExpandedMaterialIds({});
    if (!selectedOrderId) {
      await calculateSingleOrderMrp('');
      return;
    }

    const options =
      selectedBomVersion !== 'AUTO' && selectedOrder
        ? { bomVersionByStyle: { [selectedOrder.styleId]: Number(selectedBomVersion) } }
        : undefined;

    await calculateSingleOrderMrp(selectedOrderId, options);
  };

  const handleToggleMultiOrder = (orderId: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  };

  const handleSelectAllActiveOrders = () => {
    setSelectedOrderIds(
      orders.filter((o) => o.status !== 'CANCELLED').map((o) => o.id)
    );
  };

  const handleSelectAllOrders = () => {
    setSelectedOrderIds(orders.map((o) => o.id));
  };

  const handleClearMultiSelection = () => {
    setSelectedOrderIds([]);
  };

  const handleCalculateMulti = async () => {
    setExpandedMaterialIds({});
    setExpandedOrderBreakdowns({});
    await calculateMultiOrderMrp(selectedOrderIds, { excludeCancelled });
  };

  const toggleExpandMaterial = (materialId: string) => {
    setExpandedMaterialIds((prev) => ({
      ...prev,
      [materialId]: !prev[materialId],
    }));
  };

  const toggleExpandOrderBreakdown = (orderId: string) => {
    setExpandedOrderBreakdowns((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  // Filtered Single-Order MRP rows
  const filteredSingleMaterials = useMemo(() => {
    if (!singleResult) return [];
    const q = materialSearch.trim().toLowerCase();
    return singleResult.materialRequirements.filter((req) => {
      if (categoryFilter !== 'ALL' && req.category !== categoryFilter) return false;
      if (shortagesOnly && req.netProcurementRequirement <= 0) return false;
      if (!q) return true;
      return (
        req.materialCode.toLowerCase().includes(q) ||
        req.materialName.toLowerCase().includes(q) ||
        req.category.toLowerCase().includes(q)
      );
    });
  }, [singleResult, materialSearch, categoryFilter, shortagesOnly]);

  // Filtered Consolidated Multi-Order MRP rows
  const filteredMultiMaterials = useMemo(() => {
    if (!multiResult) return [];
    const q = materialSearch.trim().toLowerCase();
    return multiResult.consolidatedMaterials.filter((mat) => {
      if (categoryFilter !== 'ALL' && mat.category !== categoryFilter) return false;
      if (shortagesOnly && mat.netProcurementRequirement <= 0) return false;
      if (!q) return true;
      return (
        mat.materialCode.toLowerCase().includes(q) ||
        mat.materialName.toLowerCase().includes(q) ||
        mat.category.toLowerCase().includes(q)
      );
    });
  }, [multiResult, materialSearch, categoryFilter, shortagesOnly]);

  // Single-order summary counts (derived strictly from singleResult, zero MRP formulas)
  const singleSummary = useMemo(() => {
    if (!singleResult) return null;
    const totalMaterials = singleResult.materialRequirements.length;
    const shortageCount = singleResult.materialRequirements.filter(
      (m) => m.netProcurementRequirement > 0
    ).length;
    const coveredCount = totalMaterials - shortageCount;
    const activeCuttingJobs = singleCuttingJobs.filter((j) => j.status !== 'CANCELLED').length;
    return {
      totalMaterials,
      shortageCount,
      coveredCount,
      activeCuttingJobs,
    };
  }, [singleResult, singleCuttingJobs]);

  // Consolidated multi-order summary counts (derived strictly from multiResult)
  const multiSummary = useMemo(() => {
    if (!multiResult) return null;
    const totalMaterials = multiResult.consolidatedMaterials.length;
    const shortageCount = multiResult.consolidatedMaterials.filter(
      (m) => m.netProcurementRequirement > 0
    ).length;
    const coveredCount = totalMaterials - shortageCount;
    return {
      totalMaterials,
      shortageCount,
      coveredCount,
      includedOrderCount: multiResult.includedOrderIds.length,
      excludedCount: multiResult.excludedCancelledOrders.length,
    };
  }, [multiResult]);

  const isSingleStale =
    Boolean(singleResult) &&
    Boolean(selectedOrderId) &&
    singleResult!.orderId !== selectedOrderId;

  const isMultiStale = useMemo(() => {
    if (!multiResult) return false;
    const prevSet = new Set(multiResult.requestedOrderIds);
    if (prevSet.size !== selectedOrderIds.length) return true;
    return selectedOrderIds.some((id) => !prevSet.has(id));
  }, [multiResult, selectedOrderIds]);

  return (
    <div className="space-y-5" data-testid="order-mrp-view">
      {/* Mode Switcher & Read-Only Guarantee Strip */}
      <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 p-1 rounded-md font-mono text-xs self-start"
          role="tablist"
          aria-label="MRP calculation mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'single'}
            data-testid="mrp-mode-single-tab"
            onClick={() => handleModeSwitch('single')}
            className={`px-3.5 py-1.5 rounded flex items-center gap-2 transition-colors whitespace-nowrap ${
              mode === 'single'
                ? 'bg-zinc-800 text-amber-400 font-bold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Individual Order MRP</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'multi'}
            data-testid="mrp-mode-multi-tab"
            onClick={() => handleModeSwitch('multi')}
            className={`px-3.5 py-1.5 rounded flex items-center gap-2 transition-colors whitespace-nowrap ${
              mode === 'multi'
                ? 'bg-zinc-800 text-amber-400 font-bold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <ListChecks className="w-3.5 h-3.5" />
            <span>Consolidated Multi-Order MRP</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
          <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>
            Read-only MRP engine · Evaluates live warehouse stock without reserving or issuing inventory
          </span>
        </div>
      </div>

      {/* ===================================================================
          SELECTION PANEL — MODE A: INDIVIDUAL ORDER MRP
         =================================================================== */}
      {mode === 'single' && (
        <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-lg space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-end gap-3">
            {/* Order Filter Search */}
            <div className="xl:w-64">
              <label
                htmlFor="mrp-single-order-search"
                className="block font-mono text-[11px] text-zinc-400 mb-1.5"
              >
                Filter Orders
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  id="mrp-single-order-search"
                  data-testid="mrp-single-order-search"
                  type="text"
                  placeholder="PO#, Buyer, Style..."
                  value={singleOrderSearch}
                  onChange={(e) => setSingleOrderSearch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 font-mono focus:outline-hidden"
                />
              </div>
            </div>

            {/* Order Dropdown */}
            <div className="flex-1 min-w-0">
              <label
                htmlFor="mrp-single-order-select"
                className="block font-mono text-[11px] text-zinc-400 mb-1.5"
              >
                Purchase Order *
              </label>
              <select
                id="mrp-single-order-select"
                data-testid="mrp-single-order-select"
                value={selectedOrderId}
                onChange={(e) => {
                  setSelectedOrderId(e.target.value);
                  clearError();
                }}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-3 py-2 text-xs text-zinc-100 font-sans focus:outline-hidden"
              >
                <option value="">Select purchase order...</option>
                {filteredSingleOrders.map((ord) => (
                  <option key={ord.id} value={ord.id}>
                    {ord.poNumber}
                    {ord.internalOrderNumber ? ` (${ord.internalOrderNumber})` : ''} —{' '}
                    {ord.styleCode} · {ord.buyerCode} · {ord.orderQuantity.toLocaleString()} pcs [
                    {ord.status}]
                  </option>
                ))}
              </select>
            </div>

            {/* Optional BOM Version Selector */}
            <div className="xl:w-56">
              <label
                htmlFor="mrp-bom-version-select"
                className="block font-mono text-[11px] text-zinc-400 mb-1.5"
              >
                Style BOM Version
              </label>
              <select
                id="mrp-bom-version-select"
                data-testid="mrp-bom-version-select"
                disabled={!selectedOrder || isLoadingVersions}
                value={selectedBomVersion}
                onChange={(e) => setSelectedBomVersion(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 disabled:opacity-50 rounded-md px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-hidden"
              >
                <option value="AUTO">Latest Active BOM (Auto)</option>
                {styleVersions.map((v) => (
                  <option key={v.bomVersion} value={String(v.bomVersion)}>
                    v{v.bomVersion} ({v.activeItems} active
                    {v.archivedItems > 0 ? ` · ${v.archivedItems} arch` : ''})
                  </option>
                ))}
              </select>
            </div>

            {/* Calculate Action Button */}
            <button
              type="button"
              data-testid="mrp-calculate-single-btn"
              disabled={isCalculating || !isDbReady}
              onClick={handleCalculateSingle}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-zinc-950 rounded-md text-xs font-bold font-mono flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              {isCalculating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Calculating...</span>
                </>
              ) : (
                <>
                  <Calculator className="w-4 h-4" />
                  <span>Calculate Order MRP</span>
                </>
              )}
            </button>
          </div>

          {/* Selected Order Unboxed Context Line */}
          {selectedOrder && (
            <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="font-mono font-bold text-amber-400">
                  {selectedOrder.poNumber}
                </span>
                {selectedOrder.internalOrderNumber && (
                  <span className="font-mono text-zinc-400">
                    {selectedOrder.internalOrderNumber}
                  </span>
                )}
                <span aria-hidden="true">·</span>
                <span className="text-zinc-200">
                  {selectedOrder.buyerName} ({selectedOrder.buyerCode})
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-zinc-200">
                  {selectedOrder.styleCode} — {selectedOrder.styleDescription}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-zinc-200">
                  {selectedOrder.orderQuantity.toLocaleString()} pcs
                </span>
                <span aria-hidden="true">·</span>
                <span
                  className={`font-mono font-semibold ${
                    selectedOrder.status === 'CANCELLED'
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {selectedOrder.status}
                </span>
              </div>

              {isSingleStale && (
                <span className="text-[11px] font-mono text-amber-300">
                  Order selection changed — click Calculate Order MRP to update results
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================
          SELECTION PANEL — MODE B: CONSOLIDATED MULTI-ORDER MRP
         =================================================================== */}
      {mode === 'multi' && (
        <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-lg space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  data-testid="mrp-multi-order-search"
                  placeholder="Search orders by PO#, buyer, style..."
                  value={multiOrderSearch}
                  onChange={(e) => setMultiOrderSearch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 font-mono focus:outline-hidden"
                />
              </div>

              <button
                type="button"
                data-testid="mrp-select-all-active-btn"
                onClick={handleSelectAllActiveOrders}
                className="px-2.5 py-1.5 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded text-xs font-mono whitespace-nowrap"
              >
                Select All Active
              </button>
              <button
                type="button"
                data-testid="mrp-select-all-btn"
                onClick={handleSelectAllOrders}
                className="px-2.5 py-1.5 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded text-xs font-mono whitespace-nowrap"
              >
                Select All ({orders.length})
              </button>
              <button
                type="button"
                data-testid="mrp-clear-selection-btn"
                onClick={handleClearMultiSelection}
                className="px-2.5 py-1.5 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 rounded text-xs font-mono whitespace-nowrap"
              >
                Clear
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-mono text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  data-testid="mrp-exclude-cancelled-toggle"
                  checked={excludeCancelled}
                  onChange={(e) => setExcludeCancelled(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
                />
                <span>Exclude Cancelled Orders</span>
              </label>

              <button
                type="button"
                data-testid="mrp-calculate-multi-btn"
                disabled={isCalculating || !isDbReady}
                onClick={handleCalculateMulti}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-zinc-950 rounded-md text-xs font-bold font-mono flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                {isCalculating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Aggregating...</span>
                  </>
                ) : (
                  <>
                    <Calculator className="w-4 h-4" />
                    <span>
                      Calculate Consolidated MRP ({selectedOrderIds.length})
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Multi-Order Selection Table */}
          <div className="border border-zinc-800 rounded-md overflow-hidden bg-zinc-950/60">
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-zinc-950 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
                  <tr>
                    <th className="py-2 px-3 w-10">Pick</th>
                    <th className="py-2 px-3">PO# / SO#</th>
                    <th className="py-2 px-3">Buyer</th>
                    <th className="py-2 px-3">Style</th>
                    <th className="py-2 px-3 text-right">Order Qty</th>
                    <th className="py-2 px-3 text-right">Ex-Factory</th>
                    <th className="py-2 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50 font-mono">
                  {filteredMultiOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-zinc-500">
                        No purchase orders match the search filter.
                      </td>
                    </tr>
                  ) : (
                    filteredMultiOrders.map((ord) => {
                      const isChecked = selectedOrderIds.includes(ord.id);
                      const isCancelled = ord.status === 'CANCELLED';
                      return (
                        <tr
                          key={ord.id}
                          onClick={() => handleToggleMultiOrder(ord.id)}
                          data-testid={`mrp-multi-order-row-${ord.id}`}
                          className={`cursor-pointer transition-colors ${
                            isChecked
                              ? 'bg-amber-500/10 text-zinc-100'
                              : 'hover:bg-zinc-900/70 text-zinc-300'
                          }`}
                        >
                          <td className="py-2 px-3">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-amber-400" />
                            ) : (
                              <Square className="w-4 h-4 text-zinc-600" />
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-bold text-amber-400">{ord.poNumber}</span>
                            {ord.internalOrderNumber && (
                              <span className="text-[10px] text-zinc-500 ml-1.5">
                                {ord.internalOrderNumber}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 font-sans text-zinc-300">
                            {ord.buyerName}{' '}
                            <span className="font-mono text-[10px] text-zinc-500">
                              ({ord.buyerCode})
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-zinc-200 font-semibold">{ord.styleCode}</span>
                            <span className="font-sans text-zinc-400 ml-1.5">
                              {ord.styleDescription}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-zinc-100">
                            {ord.orderQuantity.toLocaleString()} pcs
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-zinc-400">
                            {ord.targetExFactoryDate}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span
                              className={`text-[10px] font-semibold ${
                                isCancelled ? 'text-rose-400' : 'text-emerald-400'
                              }`}
                            >
                              {ord.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 bg-zinc-950 border-t border-zinc-800 text-[11px] font-mono text-zinc-400 flex items-center justify-between tabular-nums">
              <span>
                Selected: <strong className="text-amber-400">{selectedOrderIds.length}</strong> of{' '}
                {orders.length} orders
              </span>
              {isMultiStale && (
                <span className="text-amber-300">
                  Selection changed — click Calculate Consolidated MRP to refresh
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          ERROR STATE
         =================================================================== */}
      {error && (
        <div
          role="alert"
          data-testid="mrp-error-banner"
          className="p-4 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs font-mono space-y-2.5"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <div className="font-bold text-rose-300">
                MRP Calculation Blocked {error.code ? `(${error.code})` : ''}
              </div>
              <div className="leading-relaxed">{error.message}</div>
            </div>
          </div>
          {error.styleId && onOpenStyleBom && (
            <div className="pl-6">
              <button
                type="button"
                data-testid="mrp-error-open-bom-btn"
                onClick={() => onOpenStyleBom(error.styleId!)}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-amber-300 inline-flex items-center gap-1.5 transition-colors"
              >
                <span>Configure Style BOM ({styleMap.get(error.styleId)?.styleCode || error.styleId})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================
          RESULTS — MODE A: INDIVIDUAL ORDER MRP
         =================================================================== */}
      {mode === 'single' && !singleResult && !error && (
        <div
          data-testid="mrp-single-empty-state"
          className="p-10 bg-zinc-900/60 border border-zinc-800 rounded-lg text-center space-y-2"
        >
          <Package className="w-8 h-8 text-zinc-600 mx-auto" />
          <div className="text-sm font-semibold text-zinc-200">
            {orders.length === 0
              ? 'No Purchase Orders Available'
              : 'Ready to Calculate Individual Order MRP'}
          </div>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            {orders.length === 0
              ? 'Create a purchase order in Merchandising & Orders first, then return here to run MRP.'
              : 'Select a purchase order above and click "Calculate Order MRP" to explode style BOM requirements, reconcile cutting allocations, and check warehouse availability.'}
          </p>
        </div>
      )}

      {mode === 'single' && singleResult && singleSummary && (
        <div className="space-y-4" data-testid="mrp-single-results">
          {/* Individual Order Summary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
              <div className="text-[11px] font-mono text-zinc-400">
                Order Scope (Individual)
              </div>
              <div className="text-lg font-bold font-mono text-amber-400 mt-1 tabular-nums">
                {singleResult.poNumber}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 mt-0.5 tabular-nums">
                {singleResult.totalGarmentPieces.toLocaleString()} pcs · BOM{' '}
                {Object.entries(singleResult.bomVersionUsedByStyle)
                  .map(([stId, ver]) => `${styleMap.get(stId)?.styleCode || stId} v${ver}`)
                  .join(', ')}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
              <div className="text-[11px] font-mono text-zinc-400">
                Materials Exploded
              </div>
              <div className="text-lg font-bold font-mono text-zinc-100 mt-1 tabular-nums">
                {singleSummary.totalMaterials}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 mt-0.5 tabular-nums">
                {singleResult.lineCalculations.length} active BOM line
                {singleResult.lineCalculations.length === 1 ? '' : 's'}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
              <div className="text-[11px] font-mono text-zinc-400">
                Procurement Status
              </div>
              <div
                className={`text-lg font-bold font-mono mt-1 tabular-nums ${
                  singleSummary.shortageCount > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {singleSummary.shortageCount > 0
                  ? `${singleSummary.shortageCount} Shortage${singleSummary.shortageCount === 1 ? '' : 's'}`
                  : 'Fully Stock Covered'}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 mt-0.5 tabular-nums">
                {singleSummary.coveredCount} covered by stock / allocations
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
              <div className="text-[11px] font-mono text-zinc-400">
                Linked Cutting Jobs
              </div>
              <div className="text-lg font-bold font-mono text-cyan-300 mt-1 tabular-nums">
                {singleSummary.activeCuttingJobs}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                {singleResult.usedOrderQuantityFallback
                  ? 'Order-qty fallback used'
                  : 'Colour × size matrix used'}
              </div>
            </div>
          </div>

          {/* Warnings & Archived BOM Exclusion Notices */}
          {singleResult.warnings.length > 0 && (
            <div
              data-testid="mrp-warnings-banner"
              className="p-3.5 rounded-lg bg-amber-950/35 border border-amber-800/70 text-amber-200 text-xs font-mono space-y-1.5"
            >
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>MRP Planning Notices ({singleResult.warnings.length})</span>
              </div>
              <ul className="list-disc pl-5 space-y-1 text-[11px] text-amber-200/90">
                {singleResult.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {singleResult.archivedComponentsExcluded.length > 0 && (
            <div
              data-testid="mrp-archived-excluded-banner"
              className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300 flex flex-wrap items-center gap-2"
            >
              <Archive className="w-4 h-4 text-zinc-400 shrink-0" />
              <span>
                Excluded {singleResult.archivedComponentsExcluded.length} archived BOM component
                {singleResult.archivedComponentsExcluded.length === 1 ? '' : 's'}:{' '}
                {singleResult.archivedComponentsExcluded
                  .map((a) => `${a.placement} (v${a.bomVersion})`)
                  .join(', ')}
              </span>
            </div>
          )}

          {/* Material Requirement Filter Bar & Table */}
          <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 overflow-hidden">
            <div className="p-3 bg-zinc-950/60 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Filter material code or name..."
                    value={materialSearch}
                    onChange={(e) => setMaterialSearch(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 pl-8 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 font-mono focus:outline-hidden"
                  />
                </div>

                <select
                  aria-label="Filter materials by category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
                  className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 font-mono focus:outline-hidden focus:border-amber-500"
                >
                  <option value="ALL">All Categories</option>
                  <option value="Knitted Fabric">Knitted Fabric</option>
                  <option value="Woven Fabric">Woven Fabric</option>
                  <option value="Trims & Fasteners">Trims &amp; Fasteners</option>
                  <option value="Threads & Notions">Threads &amp; Notions</option>
                  <option value="Packaging">Packaging</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-xs font-mono text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={shortagesOnly}
                  onChange={(e) => setShortagesOnly(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
                />
                <span>Shortages Only ({singleSummary.shortageCount})</span>
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" data-testid="mrp-single-materials-table">
                <thead>
                  <tr className="bg-zinc-950/80 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
                    <th className="py-3 px-4 font-medium">Material &amp; BOM Lines</th>
                    <th className="py-3 px-3 font-medium text-right">Gross BOM (Net + Wastage)</th>
                    <th className="py-3 px-3 font-medium text-right">Alloc / Issued</th>
                    <th className="py-3 px-3 font-medium text-right">Remaining Unalloc</th>
                    <th className="py-3 px-3 font-medium text-right">Available Stock</th>
                    <th className="py-3 px-4 font-medium text-right">Net Procurement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredSingleMaterials.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-zinc-500 font-mono">
                        No materials match the active filters.
                      </td>
                    </tr>
                  ) : (
                    filteredSingleMaterials.map((req: OrderMaterialMrpRequirement) => {
                      const isExpanded = Boolean(expandedMaterialIds[req.materialId]);
                      const hasShortage = req.netProcurementRequirement > 0;
                      const matchingLines = singleResult.lineCalculations.filter(
                        (line) => line.materialId === req.materialId
                      );
                      const linkedJobs = singleCuttingJobs.filter((j) =>
                        req.reconciledCuttingJobIds.includes(j.id)
                      );

                      return (
                        <React.Fragment key={req.materialId}>
                          <tr
                            onClick={() => toggleExpandMaterial(req.materialId)}
                            data-testid={`mrp-single-row-${req.materialId}`}
                            className="hover:bg-zinc-800/40 cursor-pointer transition-colors"
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-start gap-2">
                                <span className="mt-0.5 text-zinc-400">
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-amber-400" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </span>
                                <div>
                                  <div className="flex items-baseline gap-2">
                                    <span className="font-mono font-bold text-amber-400">
                                      {req.materialCode}
                                    </span>
                                    <span className="font-sans font-semibold text-zinc-100">
                                      {req.materialName}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-zinc-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                                    <span>{req.category}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono text-[10px]">
                                      Unit: {req.stockUnit}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono text-[10px]">
                                      {req.matchedBomItemIds.length} BOM line
                                      {req.matchedBomItemIds.length === 1 ? '' : 's'}
                                    </span>
                                    {linkedJobs.length > 0 && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono text-[10px] text-cyan-300">
                                          {linkedJobs.length} cutting job
                                          {linkedJobs.length === 1 ? '' : 's'}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <div className="font-bold text-zinc-100">
                                {formatNumber(req.grossBomRequirement)} {req.stockUnit}
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                Net {formatNumber(req.netBomRequirement)} + Wastage{' '}
                                {formatNumber(req.wastageQuantity)}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <div className="text-zinc-200 font-semibold">
                                {formatNumber(req.existingCuttingAllocation)} {req.stockUnit}
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                Issued {formatNumber(req.alreadyIssued)} · Res{' '}
                                {formatNumber(req.activeReservedForOrder)}
                              </div>
                              {req.overAllocatedQuantity > 0 && (
                                <div className="text-[10px] text-amber-400 font-semibold">
                                  Over-alloc +{formatNumber(req.overAllocatedQuantity)}
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap text-zinc-100 font-semibold">
                              {formatNumber(req.remainingUnallocatedRequirement)} {req.stockUnit}
                            </td>

                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <div className="font-semibold text-cyan-300">
                                {formatNumber(req.availableStock)} {req.stockUnit}
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                Phys {formatNumber(req.physicalStock)} · Res{' '}
                                {formatNumber(req.reservedStock)}
                              </div>
                            </td>

                            <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                              {hasShortage ? (
                                <div>
                                  <div className="font-bold text-rose-400">
                                    Shortage: {formatNumber(req.netProcurementRequirement)}{' '}
                                    {req.stockUnit}
                                  </div>
                                  <div className="text-[10px] text-rose-300/80">
                                    Order ceil: {req.discreteOrderUnits.toLocaleString()}{' '}
                                    {req.stockUnit}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-emerald-400 font-semibold inline-flex items-center gap-1 justify-end">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Stock Covered (0)</span>
                                </div>
                              )}
                            </td>
                          </tr>

                          {/* Expanded Details: Colour Breakdown, Size Cell Breakdown & Cutting Jobs */}
                          {isExpanded && (
                            <tr
                              data-testid={`mrp-single-detail-${req.materialId}`}
                              className="bg-zinc-950/75"
                            >
                              <td colSpan={6} className="px-6 py-4 space-y-4">
                                {/* 1. Colour-wise Requirement Summary */}
                                <div className="space-y-1.5">
                                  <div className="text-[11px] font-mono text-amber-400 font-semibold">
                                    Colour-Wise Gross Requirement ({req.stockUnit})
                                  </div>
                                  {req.byColor.length === 0 ? (
                                    <div className="text-[11px] font-mono text-zinc-500">
                                      No colour breakdown rows matched.
                                    </div>
                                  ) : (
                                    <div className="overflow-x-auto border border-zinc-800 rounded">
                                      <table className="w-full text-left text-[11px] font-mono">
                                        <thead className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-400">
                                          <tr>
                                            <th className="py-1.5 px-3">Colourway</th>
                                            <th className="py-1.5 px-3 text-right">Garment Pieces</th>
                                            <th className="py-1.5 px-3 text-right">
                                              Gross Requirement ({req.stockUnit})
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/50 tabular-nums">
                                          {req.byColor.map((cb) => (
                                            <tr key={cb.color}>
                                              <td className="py-1.5 px-3 text-zinc-200">{cb.color}</td>
                                              <td className="py-1.5 px-3 text-right text-zinc-300">
                                                {cb.garmentPieces.toLocaleString()} pcs
                                              </td>
                                              <td className="py-1.5 px-3 text-right text-zinc-100 font-semibold">
                                                {formatNumber(cb.grossStockQty)} {req.stockUnit}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>

                                {/* 2. BOM Line & Colour × Size Cell Breakdown */}
                                <div className="space-y-2">
                                  <div className="text-[11px] font-mono text-amber-400 font-semibold">
                                    BOM Component &amp; Colour × Size Breakdown
                                  </div>
                                  {matchingLines.map((line) => (
                                    <div
                                      key={line.bomItemId}
                                      className="border border-zinc-800 rounded overflow-hidden"
                                    >
                                      <div className="px-3 py-2 bg-zinc-900/80 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                                        <span className="text-zinc-200 font-semibold">
                                          {line.placement}
                                        </span>
                                        <span className="text-zinc-400 tabular-nums">
                                          Basis: {line.consumptionBasis} · Wastage:{' '}
                                          {line.wastagePercent}% · Unit: {line.consumptionUnit} →{' '}
                                          {line.stockUnit} (×{formatNumber(line.conversionFactor, 6)})
                                        </span>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-left text-[11px] font-mono">
                                          <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800/80">
                                            <tr>
                                              <th className="py-1.5 px-3">Colour</th>
                                              <th className="py-1.5 px-3">Size</th>
                                              <th className="py-1.5 px-3 text-right">Pcs</th>
                                              <th className="py-1.5 px-3 text-right">
                                                Net / Pc ({line.consumptionUnit})
                                              </th>
                                              <th className="py-1.5 px-3 text-right">
                                                Net ({line.consumptionUnit})
                                              </th>
                                              <th className="py-1.5 px-3 text-right">
                                                Wastage ({line.consumptionUnit})
                                              </th>
                                              <th className="py-1.5 px-3 text-right">
                                                Gross ({line.consumptionUnit})
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-zinc-800/40 tabular-nums">
                                            {line.cellBreakdowns.map((cell, idx) => (
                                              <tr key={`${cell.color}-${cell.size}-${idx}`}>
                                                <td className="py-1.5 px-3 text-zinc-200">
                                                  {cell.color}
                                                </td>
                                                <td className="py-1.5 px-3 text-zinc-300">
                                                  {cell.size}
                                                </td>
                                                <td className="py-1.5 px-3 text-right text-zinc-300">
                                                  {cell.garmentPieces.toLocaleString()}
                                                </td>
                                                <td className="py-1.5 px-3 text-right text-zinc-400">
                                                  {formatNumber(cell.perGarmentNetConsumption, 5)}
                                                </td>
                                                <td className="py-1.5 px-3 text-right text-zinc-300">
                                                  {formatNumber(cell.netConsumptionQty)}
                                                </td>
                                                <td className="py-1.5 px-3 text-right text-zinc-400">
                                                  {formatNumber(cell.wastageConsumptionQty)}
                                                </td>
                                                <td className="py-1.5 px-3 text-right text-zinc-100 font-semibold">
                                                  {formatNumber(cell.grossConsumptionQty)}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                {/* 3. Cutting Jobs & Allocation Reconciliation */}
                                {linkedJobs.length > 0 && (
                                  <div className="space-y-1.5">
                                    <div className="text-[11px] font-mono text-cyan-300 font-semibold flex items-center gap-1.5">
                                      <Scissors className="w-3.5 h-3.5" />
                                      <span>Reconciled Cutting Jobs</span>
                                    </div>
                                    <div className="overflow-x-auto border border-zinc-800 rounded">
                                      <table className="w-full text-left text-[11px] font-mono">
                                        <thead className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-400">
                                          <tr>
                                            <th className="py-1.5 px-3">Job #</th>
                                            <th className="py-1.5 px-3">Lay Table</th>
                                            <th className="py-1.5 px-3 text-right">Planned / Cut Pcs</th>
                                            <th className="py-1.5 px-3 text-right">Allocated Fabric</th>
                                            <th className="py-1.5 px-3 text-right">Issued Fabric</th>
                                            <th className="py-1.5 px-3 text-center">Status</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/50 tabular-nums">
                                          {linkedJobs.map((job) => (
                                            <tr key={job.id}>
                                              <td className="py-1.5 px-3 text-amber-300 font-semibold">
                                                {job.jobNumber}
                                              </td>
                                              <td className="py-1.5 px-3 text-zinc-300">
                                                {job.layTableNumber}
                                              </td>
                                              <td className="py-1.5 px-3 text-right text-zinc-300">
                                                {job.actualCutGarmentQuantity.toLocaleString()} /{' '}
                                                {job.plannedGarmentQuantity.toLocaleString()}
                                              </td>
                                              <td className="py-1.5 px-3 text-right text-zinc-200">
                                                {formatNumber(job.allocatedFabricQuantity)}{' '}
                                                {req.stockUnit}
                                              </td>
                                              <td className="py-1.5 px-3 text-right text-zinc-200">
                                                {formatNumber(job.issuedFabricQuantity)}{' '}
                                                {req.stockUnit}
                                              </td>
                                              <td className="py-1.5 px-3 text-center text-cyan-300">
                                                {job.status}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-2.5 bg-zinc-950/70 border-t border-zinc-800 text-[11px] font-mono text-zinc-400 flex flex-wrap items-center justify-between gap-2">
              <span>
                Click any material row to inspect colour breakdown, size cells, and cutting jobs
              </span>
              <span>
                Generated {new Date(singleResult.generatedAt).toLocaleTimeString()} · Read-only
              </span>
            </div>
          </div>

          {/* Transparent Model Scope Note */}
          {singleResult.modelLimitations.length > 0 && (
            <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80 text-[11px] font-mono text-zinc-400 space-y-1">
              <div className="text-zinc-300 font-semibold">MRP Reconciliation Notes</div>
              {singleResult.modelLimitations.map((note, idx) => (
                <div key={idx}>· {note}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================
          RESULTS — MODE B: CONSOLIDATED MULTI-ORDER MRP
         =================================================================== */}
      {mode === 'multi' && !multiResult && !error && (
        <div
          data-testid="mrp-multi-empty-state"
          className="p-10 bg-zinc-900/60 border border-zinc-800 rounded-lg text-center space-y-2"
        >
          <Layers className="w-8 h-8 text-zinc-600 mx-auto" />
          <div className="text-sm font-semibold text-zinc-200">
            Select Orders for Consolidated Material Planning
          </div>
          <p className="text-xs text-zinc-400 max-w-lg mx-auto">
            Check two or more purchase orders above and click "Calculate Consolidated MRP" to
            aggregate shared fabric, trim, thread, and packaging demand across a single shared
            warehouse stock pool without double-counting.
          </p>
        </div>
      )}

      {mode === 'multi' && multiResult && multiSummary && (
        <div className="space-y-5" data-testid="mrp-multi-results">
          {/* Consolidated KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
              <div className="text-[11px] font-mono text-zinc-400">
                Consolidated Batch Scope
              </div>
              <div className="text-lg font-bold font-mono text-amber-400 mt-1 tabular-nums">
                {multiSummary.includedOrderCount} Order
                {multiSummary.includedOrderCount === 1 ? '' : 's'}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 mt-0.5 tabular-nums">
                {multiResult.totalGarmentPieces.toLocaleString()} combined garment pcs
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
              <div className="text-[11px] font-mono text-zinc-400">
                Aggregated Materials
              </div>
              <div className="text-lg font-bold font-mono text-zinc-100 mt-1 tabular-nums">
                {multiSummary.totalMaterials}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                Shared stock netted once per SKU
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
              <div className="text-[11px] font-mono text-zinc-400">
                Consolidated Shortages
              </div>
              <div
                className={`text-lg font-bold font-mono mt-1 tabular-nums ${
                  multiSummary.shortageCount > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {multiSummary.shortageCount > 0
                  ? `${multiSummary.shortageCount} Material${multiSummary.shortageCount === 1 ? '' : 's'}`
                  : 'All Covered'}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 mt-0.5 tabular-nums">
                {multiSummary.coveredCount} fully covered by warehouse stock
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
              <div className="text-[11px] font-mono text-zinc-400">
                Excluded Cancelled
              </div>
              <div className="text-lg font-bold font-mono text-zinc-200 mt-1 tabular-nums">
                {multiSummary.excludedCount}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                {multiSummary.excludedCount > 0
                  ? 'Skipped via Exclude Cancelled'
                  : 'All requested orders active'}
              </div>
            </div>
          </div>

          {/* Excluded Cancelled Orders & Warnings */}
          {multiResult.excludedCancelledOrders.length > 0 && (
            <div
              data-testid="mrp-excluded-cancelled-banner"
              className="p-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs font-mono text-zinc-300 space-y-1"
            >
              <div className="font-semibold text-amber-300">
                Excluded Cancelled Orders ({multiResult.excludedCancelledOrders.length})
              </div>
              {multiResult.excludedCancelledOrders.map((ex) => (
                <div key={ex.orderId} className="text-[11px] text-zinc-400">
                  · {ex.poNumber} ({ex.orderId}) — {ex.reason}
                </div>
              ))}
            </div>
          )}

          {multiResult.warnings.length > 0 && (
            <div className="p-3.5 rounded-lg bg-amber-950/35 border border-amber-800/70 text-amber-200 text-xs font-mono space-y-1.5">
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Consolidated Planning Notices ({multiResult.warnings.length})</span>
              </div>
              <ul className="list-disc pl-5 space-y-1 text-[11px] text-amber-200/90">
                {multiResult.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Section 1: Consolidated Material Requirements Table */}
          <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 bg-zinc-950/80 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-zinc-100">
                  Consolidated Material Requirements (Combined Pool)
                </div>
                <div className="text-[11px] text-zinc-400">
                  Warehouse available stock is applied once against combined remaining demand across all included orders.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-48">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Filter materials..."
                    value={materialSearch}
                    onChange={(e) => setMaterialSearch(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 pl-8 py-1 text-xs text-zinc-200 font-mono focus:outline-hidden"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-xs font-mono text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={shortagesOnly}
                    onChange={(e) => setShortagesOnly(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
                  />
                  <span>Shortages Only</span>
                </label>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" data-testid="mrp-multi-materials-table">
                <thead>
                  <tr className="bg-zinc-950/80 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
                    <th className="py-3 px-4 font-medium">Material &amp; Orders</th>
                    <th className="py-3 px-3 font-medium text-right">Total Gross BOM</th>
                    <th className="py-3 px-3 font-medium text-right">Total Alloc / Issued</th>
                    <th className="py-3 px-3 font-medium text-right">Total Remaining Unalloc</th>
                    <th className="py-3 px-3 font-medium text-right">Shared Available Stock</th>
                    <th className="py-3 px-4 font-medium text-right">Consolidated Procurement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredMultiMaterials.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-zinc-500 font-mono">
                        No consolidated materials match the active filters.
                      </td>
                    </tr>
                  ) : (
                    filteredMultiMaterials.map((mat: MultiOrderMaterialMrpSummary) => {
                      const isExpanded = Boolean(expandedMaterialIds[mat.materialId]);
                      const hasShortage = mat.netProcurementRequirement > 0;
                      return (
                        <React.Fragment key={mat.materialId}>
                          <tr
                            onClick={() => toggleExpandMaterial(mat.materialId)}
                            data-testid={`mrp-multi-row-${mat.materialId}`}
                            className="hover:bg-zinc-800/40 cursor-pointer transition-colors"
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-start gap-2">
                                <span className="mt-0.5 text-zinc-400">
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-amber-400" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </span>
                                <div>
                                  <div className="flex items-baseline gap-2">
                                    <span className="font-mono font-bold text-amber-400">
                                      {mat.materialCode}
                                    </span>
                                    <span className="font-sans font-semibold text-zinc-100">
                                      {mat.materialName}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-zinc-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                                    <span>{mat.category}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono text-[10px]">
                                      Shared across {mat.orderTraceability.length} order
                                      {mat.orderTraceability.length === 1 ? '' : 's'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap font-bold text-zinc-100">
                              {formatNumber(mat.totalGrossBomRequirement)} {mat.stockUnit}
                            </td>

                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <div className="text-zinc-200 font-semibold">
                                {formatNumber(mat.totalExistingCuttingAllocation)} {mat.stockUnit}
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                Issued {formatNumber(mat.totalAlreadyIssued)} · Res{' '}
                                {formatNumber(mat.totalActiveReservedForOrders)}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap text-zinc-100 font-semibold">
                              {formatNumber(mat.totalRemainingUnallocatedRequirement)}{' '}
                              {mat.stockUnit}
                            </td>

                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <div className="font-semibold text-cyan-300">
                                {formatNumber(mat.availableStock)} {mat.stockUnit}
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                Shared Pool (Phys {formatNumber(mat.physicalStock)} · Res{' '}
                                {formatNumber(mat.reservedStock)})
                              </div>
                            </td>

                            <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                              {hasShortage ? (
                                <div>
                                  <div className="font-bold text-rose-400">
                                    Shortage: {formatNumber(mat.netProcurementRequirement)}{' '}
                                    {mat.stockUnit}
                                  </div>
                                  <div className="text-[10px] text-rose-300/80">
                                    Order ceil: {mat.discreteOrderUnits.toLocaleString()}{' '}
                                    {mat.stockUnit}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-emerald-400 font-semibold inline-flex items-center gap-1 justify-end">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Stock Covered (0)</span>
                                </div>
                              )}
                            </td>
                          </tr>

                          {/* Expanded: Order Traceability + Combined Colour Breakdown */}
                          {isExpanded && (
                            <tr
                              data-testid={`mrp-multi-detail-${mat.materialId}`}
                              className="bg-zinc-950/75"
                            >
                              <td colSpan={6} className="px-6 py-4 space-y-4">
                                {/* Per-Order Traceability */}
                                <div className="space-y-1.5">
                                  <div className="text-[11px] font-mono text-amber-400 font-semibold">
                                    Order-Level Traceability (Contribution to Consolidated Demand)
                                  </div>
                                  <div className="overflow-x-auto border border-zinc-800 rounded">
                                    <table className="w-full text-left text-[11px] font-mono">
                                      <thead className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-400">
                                        <tr>
                                          <th className="py-1.5 px-3">Order PO#</th>
                                          <th className="py-1.5 px-3 text-right">Order Pcs</th>
                                          <th className="py-1.5 px-3 text-right">Order Gross BOM</th>
                                          <th className="py-1.5 px-3 text-right">Existing Alloc</th>
                                          <th className="py-1.5 px-3 text-right">Issued</th>
                                          <th className="py-1.5 px-3 text-right">Active Reserved</th>
                                          <th className="py-1.5 px-3 text-right">Remaining Unalloc</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-zinc-800/50 tabular-nums">
                                        {mat.orderTraceability.map((tr) => (
                                          <tr key={tr.orderId}>
                                            <td className="py-1.5 px-3 text-amber-300 font-semibold">
                                              {tr.poNumber}
                                              {tr.internalOrderNumber && (
                                                <span className="text-zinc-500 ml-1.5 font-normal">
                                                  ({tr.internalOrderNumber})
                                                </span>
                                              )}
                                            </td>
                                            <td className="py-1.5 px-3 text-right text-zinc-300">
                                              {tr.garmentPieces.toLocaleString()}
                                            </td>
                                            <td className="py-1.5 px-3 text-right text-zinc-100 font-semibold">
                                              {formatNumber(tr.grossBomRequirement)} {mat.stockUnit}
                                            </td>
                                            <td className="py-1.5 px-3 text-right text-zinc-300">
                                              {formatNumber(tr.existingCuttingAllocation)}
                                            </td>
                                            <td className="py-1.5 px-3 text-right text-zinc-300">
                                              {formatNumber(tr.alreadyIssued)}
                                            </td>
                                            <td className="py-1.5 px-3 text-right text-zinc-300">
                                              {formatNumber(tr.activeReservedForOrder)}
                                            </td>
                                            <td className="py-1.5 px-3 text-right text-zinc-100">
                                              {formatNumber(tr.remainingUnallocatedRequirement)}{' '}
                                              {mat.stockUnit}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                {/* Consolidated Colour Breakdown */}
                                {mat.byColor.length > 0 && (
                                  <div className="space-y-1.5">
                                    <div className="text-[11px] font-mono text-cyan-300 font-semibold">
                                      Consolidated Colour Breakdown ({mat.stockUnit})
                                    </div>
                                    <div className="overflow-x-auto border border-zinc-800 rounded">
                                      <table className="w-full text-left text-[11px] font-mono">
                                        <thead className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-400">
                                          <tr>
                                            <th className="py-1.5 px-3">Colourway</th>
                                            <th className="py-1.5 px-3 text-right">Combined Pcs</th>
                                            <th className="py-1.5 px-3 text-right">
                                              Consolidated Gross ({mat.stockUnit})
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/50 tabular-nums">
                                          {mat.byColor.map((cb) => (
                                            <tr key={cb.color}>
                                              <td className="py-1.5 px-3 text-zinc-200">{cb.color}</td>
                                              <td className="py-1.5 px-3 text-right text-zinc-300">
                                                {cb.garmentPieces.toLocaleString()} pcs
                                              </td>
                                              <td className="py-1.5 px-3 text-right text-zinc-100 font-semibold">
                                                {formatNumber(cb.grossStockQty)} {mat.stockUnit}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Individual Order Breakdowns (Clearly Separated from Consolidated Pool) */}
          <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 bg-zinc-950/80 border-b border-zinc-800">
              <div className="text-xs font-bold text-zinc-100">
                Individual Order Breakdowns ({multiResult.orderBreakdowns.length} Included Orders)
              </div>
              <div className="text-[11px] text-zinc-400">
                Standalone material requirements per individual order for reference. Do not sum standalone shortages — use the Consolidated table above for procurement.
              </div>
            </div>

            <div className="divide-y divide-zinc-800/70">
              {multiResult.orderBreakdowns.map((ordMrp) => {
                const isOpen = Boolean(expandedOrderBreakdowns[ordMrp.orderId]);
                const buyer = buyerMap.get(ordMrp.buyerId);
                const style = styleMap.get(ordMrp.primaryStyleId);
                const jobs = multiCuttingJobsByOrder[ordMrp.orderId] || [];

                return (
                  <div key={ordMrp.orderId}>
                    <button
                      type="button"
                      onClick={() => toggleExpandOrderBreakdown(ordMrp.orderId)}
                      data-testid={`mrp-multi-order-breakdown-${ordMrp.orderId}`}
                      className="w-full px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-left hover:bg-zinc-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 text-xs">
                        {isOpen ? (
                          <ChevronDown className="w-4 h-4 text-amber-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-zinc-500" />
                        )}
                        <span className="font-mono font-bold text-amber-400">
                          {ordMrp.poNumber}
                        </span>
                        <span className="text-zinc-300 font-medium">
                          {style?.styleCode || ordMrp.primaryStyleId}
                        </span>
                        <span className="text-zinc-500">·</span>
                        <span className="text-zinc-400">
                          {buyer ? buyer.code : ordMrp.buyerId}
                        </span>
                        <span className="text-zinc-500">·</span>
                        <span className="font-mono tabular-nums text-zinc-200">
                          {ordMrp.totalGarmentPieces.toLocaleString()} pcs
                        </span>
                      </div>

                      <div className="text-[11px] font-mono text-zinc-400 tabular-nums">
                        {ordMrp.materialRequirements.length} materials
                        {jobs.length > 0 ? ` · ${jobs.length} cutting job(s)` : ''}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-6 pb-4 bg-zinc-950/60">
                        <div className="overflow-x-auto border border-zinc-800 rounded">
                          <table className="w-full text-left text-[11px] font-mono">
                            <thead className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-400">
                              <tr>
                                <th className="py-1.5 px-3">Material</th>
                                <th className="py-1.5 px-3 text-right">Net BOM</th>
                                <th className="py-1.5 px-3 text-right">Wastage</th>
                                <th className="py-1.5 px-3 text-right">Gross BOM</th>
                                <th className="py-1.5 px-3 text-right">Existing Alloc</th>
                                <th className="py-1.5 px-3 text-right">Issued</th>
                                <th className="py-1.5 px-3 text-right">Remaining Unalloc</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/40 tabular-nums">
                              {ordMrp.materialRequirements.map((r) => (
                                <tr key={r.materialId}>
                                  <td className="py-1.5 px-3 text-zinc-200">
                                    <span className="text-amber-300 font-semibold">
                                      {r.materialCode}
                                    </span>{' '}
                                    {r.materialName}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-zinc-300">
                                    {formatNumber(r.netBomRequirement)} {r.stockUnit}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-zinc-400">
                                    {formatNumber(r.wastageQuantity)}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-zinc-100 font-semibold">
                                    {formatNumber(r.grossBomRequirement)} {r.stockUnit}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-zinc-300">
                                    {formatNumber(r.existingCuttingAllocation)}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-zinc-300">
                                    {formatNumber(r.alreadyIssued)}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-zinc-100">
                                    {formatNumber(r.remainingUnallocatedRequirement)}{' '}
                                    {r.stockUnit}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Model Limitations Note */}
          {multiResult.modelLimitations.length > 0 && (
            <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80 text-[11px] font-mono text-zinc-400 space-y-1">
              <div className="text-zinc-300 font-semibold">Consolidated MRP Reconciliation Notes</div>
              {multiResult.modelLimitations.map((note, idx) => (
                <div key={idx}>· {note}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
