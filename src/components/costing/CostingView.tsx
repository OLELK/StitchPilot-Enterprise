import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Plus,
  Search,
  FileSpreadsheet,
  AlertCircle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import {
  BuyerEntity,
  CostSheetEntity,
  CostSheetStatus,
  MaterialEntity,
  StyleEntity,
} from '../../db/types';
import { OrderWithDetails } from '../../db/hooks/useOrdersData';
import { useCostingData } from '../../db/hooks/useCostingData';
import {
  CostingRepository,
  MasterRepository,
  CreateCostSheetInput,
  UpdateDraftCostSheetInput,
  CreateRevisionOptions,
} from '../../db/repositories';
import { CostingBomService } from '../../db/services/costingBomService';
import { CostSheetEditor } from './CostSheetEditor';

type StatusFilter = 'ALL' | CostSheetStatus;
type ScopeFilter = 'ALL' | 'STYLE' | 'ORDER';

export interface CostingViewProps {
  styles: StyleEntity[];
  orders: OrderWithDetails[];
  buyers: BuyerEntity[];
  materials: MaterialEntity[];
  isDbReady: boolean;
  onCostingMutated?: () => Promise<void> | void;
  // Optional dependency overrides for isolated testing
  costingRepository?: CostingRepository;
  masterRepository?: MasterRepository;
  bomService?: CostingBomService;
}

function formatDateShort(iso?: string): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function getStatusColorClass(status: CostSheetStatus): string {
  switch (status) {
    case 'APPROVED':
      return 'text-emerald-400';
    case 'SUBMITTED':
      return 'text-sky-400';
    case 'DRAFT':
      return 'text-amber-400';
    case 'REJECTED':
      return 'text-rose-400';
    case 'SUPERSEDED':
      return 'text-zinc-400';
  }
}

export const CostingView: React.FC<CostingViewProps> = ({
  styles,
  orders,
  buyers,
  materials,
  isDbReady,
  onCostingMutated,
  costingRepository,
  masterRepository,
  bomService,
}) => {
  const {
    costSheets,
    isLoading,
    isMutating,
    error,
    clearError,
    refreshCostSheets,
    getVersionsForContext,
    getStyleBomVersions,
    importBomForCosting,
    createCostSheet,
    updateDraftCostSheet,
    createRevision,
    submitForApproval,
    approveCostSheet,
    rejectCostSheet,
    reopenRejectedCostSheet,
  } = useCostingData({
    isDbReady,
    onDataMutated: onCostingMutated,
    costingRepository,
    masterRepository,
    bomService,
  });

  // View Mode: 'overview' | 'editor'
  const [viewMode, setViewMode] = useState<'overview' | 'editor'>('overview');
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [activeSheetRecord, setActiveSheetRecord] = useState<CostSheetEntity | null>(null);
  const [versionHistory, setVersionHistory] = useState<CostSheetEntity[]>([]);

  // Overview search & filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('ALL');
  const [styleFilter, setStyleFilter] = useState<string>('ALL');

  const styleMap = useMemo(() => new Map(styles.map((s) => [s.id, s])), [styles]);
  const buyerMap = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);
  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  // Keep activeSheetRecord synced with refreshed costSheets list
  useEffect(() => {
    if (!activeSheetId) {
      setActiveSheetRecord(null);
      return;
    }
    const found = costSheets.find((s) => s.id === activeSheetId);
    if (found) {
      setActiveSheetRecord(found);
    }
  }, [activeSheetId, costSheets]);

  // Load version history whenever active sheet context changes or costSheets refresh
  const refreshActiveVersionHistory = useCallback(
    async (target: CostSheetEntity | null) => {
      if (!target) {
        setVersionHistory([]);
        return;
      }
      try {
        const versions = await getVersionsForContext({
          styleId: target.styleId,
          orderId: target.orderId,
        });
        setVersionHistory(versions);
      } catch {
        setVersionHistory([]);
      }
    },
    [getVersionsForContext]
  );

  useEffect(() => {
    if (viewMode === 'editor' && activeSheetRecord) {
      refreshActiveVersionHistory(activeSheetRecord);
    } else {
      setVersionHistory([]);
    }
  }, [viewMode, activeSheetRecord, costSheets.length, refreshActiveVersionHistory]);

  // Filtered cost sheets for overview table
  const filteredCostSheets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return costSheets.filter((sheet) => {
      const sheetStatus = sheet.status ?? 'DRAFT';
      if (statusFilter !== 'ALL' && sheetStatus !== statusFilter) return false;
      if (scopeFilter === 'STYLE' && sheet.orderId) return false;
      if (scopeFilter === 'ORDER' && !sheet.orderId) return false;
      if (styleFilter !== 'ALL' && sheet.styleId !== styleFilter) return false;

      if (!q) return true;
      const style = styleMap.get(sheet.styleId);
      const order = sheet.orderId ? orderMap.get(sheet.orderId) : undefined;
      const buyer = sheet.buyerId
        ? buyerMap.get(sheet.buyerId)
        : style?.buyerId
        ? buyerMap.get(style.buyerId)
        : undefined;

      return (
        sheet.id.toLowerCase().includes(q) ||
        sheet.currency.toLowerCase().includes(q) ||
        (style?.styleCode.toLowerCase().includes(q) ?? false) ||
        (style?.description.toLowerCase().includes(q) ?? false) ||
        (order?.poNumber.toLowerCase().includes(q) ?? false) ||
        (buyer?.name.toLowerCase().includes(q) ?? false) ||
        (buyer?.code.toLowerCase().includes(q) ?? false) ||
        (sheet.approvedBy?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [
    costSheets,
    searchQuery,
    statusFilter,
    scopeFilter,
    styleFilter,
    styleMap,
    orderMap,
    buyerMap,
  ]);

  // Overview KPI counts (derived strictly from live records)
  const overviewStats = useMemo(() => {
    let approvedCount = 0;
    let draftOrSubmittedCount = 0;
    let legacySummaryCount = 0;
    const coveredStyles = new Set<string>();

    for (const cs of costSheets) {
      const st = cs.status ?? 'DRAFT';
      if (st === 'APPROVED') approvedCount++;
      if (st === 'DRAFT' || st === 'SUBMITTED') draftOrSubmittedCount++;
      if (!cs.lineItems || cs.lineItems.length === 0) legacySummaryCount++;
      coveredStyles.add(cs.styleId);
    }

    return {
      total: costSheets.length,
      approvedCount,
      draftOrSubmittedCount,
      legacySummaryCount,
      coveredStyleCount: coveredStyles.size,
    };
  }, [costSheets]);

  const handleOpenSheet = (sheet: CostSheetEntity) => {
    clearError();
    setActiveSheetId(sheet.id);
    setActiveSheetRecord(sheet);
    setViewMode('editor');
  };

  const handleCreateNew = () => {
    clearError();
    setActiveSheetId(null);
    setActiveSheetRecord(null);
    setVersionHistory([]);
    setViewMode('editor');
  };

  const handleBackToOverview = () => {
    clearError();
    setViewMode('overview');
    setActiveSheetId(null);
    setActiveSheetRecord(null);
    setVersionHistory([]);
  };

  // Wrap repository mutations so activeSheetRecord transitions cleanly
  const handleCreateCostSheet = async (
    input: CreateCostSheetInput
  ): Promise<CostSheetEntity> => {
    const created = await createCostSheet(input);
    setActiveSheetId(created.id);
    setActiveSheetRecord(created);
    await refreshActiveVersionHistory(created);
    return created;
  };

  const handleUpdateDraftCostSheet = async (
    costSheetId: string,
    updates: UpdateDraftCostSheetInput
  ): Promise<CostSheetEntity> => {
    const updated = await updateDraftCostSheet(costSheetId, updates);
    setActiveSheetId(updated.id);
    setActiveSheetRecord(updated);
    await refreshActiveVersionHistory(updated);
    return updated;
  };

  const handleCreateRevision = async (
    sourceCostSheetId: string,
    options?: CreateRevisionOptions
  ): Promise<CostSheetEntity> => {
    const revision = await createRevision(sourceCostSheetId, options);
    setActiveSheetId(revision.id);
    setActiveSheetRecord(revision);
    await refreshActiveVersionHistory(revision);
    return revision;
  };

  const handleSubmitForApproval = async (
    costSheetId: string
  ): Promise<CostSheetEntity> => {
    const submitted = await submitForApproval(costSheetId);
    setActiveSheetId(submitted.id);
    setActiveSheetRecord(submitted);
    await refreshActiveVersionHistory(submitted);
    return submitted;
  };

  const handleApproveCostSheet = async (
    costSheetId: string,
    approvedBy: string
  ): Promise<{ approved: CostSheetEntity; superseded: CostSheetEntity[] }> => {
    const res = await approveCostSheet(costSheetId, approvedBy);
    setActiveSheetId(res.approved.id);
    setActiveSheetRecord(res.approved);
    await refreshActiveVersionHistory(res.approved);
    return res;
  };

  const handleRejectCostSheet = async (
    costSheetId: string,
    rejectionReason: string
  ): Promise<CostSheetEntity> => {
    const rejected = await rejectCostSheet(costSheetId, rejectionReason);
    setActiveSheetId(rejected.id);
    setActiveSheetRecord(rejected);
    await refreshActiveVersionHistory(rejected);
    return rejected;
  };

  const handleReopenRejectedCostSheet = async (
    costSheetId: string
  ): Promise<CostSheetEntity> => {
    const reopened = await reopenRejectedCostSheet(costSheetId);
    setActiveSheetId(reopened.id);
    setActiveSheetRecord(reopened);
    await refreshActiveVersionHistory(reopened);
    return reopened;
  };

  if (viewMode === 'editor') {
    return (
      <CostSheetEditor
        sheet={activeSheetRecord}
        versionHistory={versionHistory}
        styles={styles}
        orders={orders}
        buyers={buyers}
        materials={materials}
        isMutating={isMutating}
        onBackToOverview={handleBackToOverview}
        onSelectVersion={(ver) => handleOpenSheet(ver)}
        onGetStyleBomVersions={getStyleBomVersions}
        onImportBom={importBomForCosting}
        onCreateCostSheet={handleCreateCostSheet}
        onUpdateDraftCostSheet={handleUpdateDraftCostSheet}
        onCreateRevision={handleCreateRevision}
        onSubmitForApproval={handleSubmitForApproval}
        onApproveCostSheet={handleApproveCostSheet}
        onRejectCostSheet={handleRejectCostSheet}
        onReopenRejectedCostSheet={handleReopenRejectedCostSheet}
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="costing-overview">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="text-[11px] font-mono text-amber-400 font-semibold flex items-center gap-2">
            <span>StitchPilot Commercial ERP</span>
            <span className="text-zinc-600">/</span>
            <span>Garment Costing & FOB Quotation</span>
          </div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight mt-0.5">
            Style & Order Cost Sheets
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Prepare BOM-backed style and order cost sheets, manage material rate overrides,
            evaluate FOB pricing margins, and track immutable approval revisions.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => refreshCostSheets()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleCreateNew}
            data-testid="costing-new-sheet-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Cost Sheet</span>
          </button>
        </div>
      </div>

      {/* Real-Time Summary Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-md bg-zinc-900 border border-zinc-800 p-4">
          <div className="text-xs text-zinc-400">Total Cost Sheets</div>
          <div
            data-testid="overview-total-count"
            className="text-2xl font-bold font-mono tabular-nums text-zinc-100 mt-1"
          >
            {overviewStats.total}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            {overviewStats.legacySummaryCount} legacy summary record(s)
          </div>
        </div>

        <div className="rounded-md bg-zinc-900 border border-zinc-800 p-4">
          <div className="text-xs text-zinc-400">Active Approved</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400 mt-1">
            {overviewStats.approvedCount}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            Locked historical quotations
          </div>
        </div>

        <div className="rounded-md bg-zinc-900 border border-zinc-800 p-4">
          <div className="text-xs text-zinc-400">Draft & Pending Review</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-400 mt-1">
            {overviewStats.draftOrSubmittedCount}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            In preparation or submitted
          </div>
        </div>

        <div className="rounded-md bg-zinc-900 border border-zinc-800 p-4">
          <div className="text-xs text-zinc-400">Styles Covered</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-zinc-100 mt-1">
            {overviewStats.coveredStyleCount}{' '}
            <span className="text-sm font-normal text-zinc-500">/ {styles.length}</span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            Garment styles with cost records
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 px-4 py-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error.message}</span>
        </div>
      )}

      {/* Search & Filters Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 rounded-md bg-zinc-900 border border-zinc-800">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="costing-search-input"
            placeholder="Search by ID, style code, buyer, PO number, currency, or approver..."
            className="w-full pl-9 pr-3 py-1.5 rounded-md bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            aria-label="Filter by status"
            data-testid="costing-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="SUPERSEDED">Superseded</option>
          </select>

          {/* Scope Filter */}
          <div className="inline-flex items-center p-0.5 rounded-md bg-zinc-950 border border-zinc-800">
            {(
              [
                { id: 'ALL', label: 'All Scopes' },
                { id: 'STYLE', label: 'Style-Level' },
                { id: 'ORDER', label: 'Order-Linked' },
              ] as Array<{ id: ScopeFilter; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`costing-scope-filter-${opt.id}`}
                onClick={() => setScopeFilter(opt.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  scopeFilter === opt.id
                    ? 'bg-zinc-800 text-amber-300'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Style Filter */}
          <select
            aria-label="Filter by style"
            data-testid="costing-style-filter"
            value={styleFilter}
            onChange={(e) => setStyleFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
          >
            <option value="ALL">All Styles</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.styleCode} — {s.description}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cost Sheets Table */}
      <div className="rounded-md bg-zinc-900 border border-zinc-800 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-zinc-400">
            Loading persisted cost sheets...
          </div>
        ) : filteredCostSheets.length === 0 ? (
          <div className="p-10 text-center space-y-2.5">
            <FileSpreadsheet className="w-8 h-8 text-zinc-600 mx-auto" />
            <div className="text-sm font-medium text-zinc-200">
              {costSheets.length === 0
                ? 'No cost sheets recorded yet'
                : 'No cost sheets match the active filters'}
            </div>
            <p className="text-xs text-zinc-500 max-w-md mx-auto">
              {costSheets.length === 0
                ? 'Create a new draft cost sheet from any style BOM to calculate garment manufacturing costs and FOB quotations.'
                : 'Try adjusting your search terms or clearing the status, scope, or style filter.'}
            </p>
            {costSheets.length === 0 && (
              <button
                type="button"
                onClick={handleCreateNew}
                className="inline-flex items-center gap-1.5 px-4 py-2 mt-2 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create First Cost Sheet</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse" data-testid="costing-overview-table">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] font-mono text-zinc-400">
                  <th className="py-2.5 px-3 font-medium">Cost Sheet ID</th>
                  <th className="py-2.5 px-3 font-medium">Style & Buyer</th>
                  <th className="py-2.5 px-3 font-medium">Linked Order</th>
                  <th className="py-2.5 px-3 font-medium">Version / BOM</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Currency</th>
                  <th className="py-2.5 px-3 font-medium text-right">Cost / Pc</th>
                  <th className="py-2.5 px-3 font-medium text-right">Quoted FOB</th>
                  <th className="py-2.5 px-3 font-medium text-right">Margin %</th>
                  <th className="py-2.5 px-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70 text-xs">
                {filteredCostSheets.map((cs) => {
                  const style = styleMap.get(cs.styleId);
                  const order = cs.orderId ? orderMap.get(cs.orderId) : undefined;
                  const buyer = cs.buyerId
                    ? buyerMap.get(cs.buyerId)
                    : style?.buyerId
                    ? buyerMap.get(style.buyerId)
                    : undefined;
                  const status = cs.status ?? 'DRAFT';
                  const isLegacy = !cs.lineItems || cs.lineItems.length === 0;

                  return (
                    <tr
                      key={cs.id}
                      data-testid={`cost-sheet-row-${cs.id}`}
                      className="hover:bg-zinc-800/40 transition-colors"
                    >
                      {/* Cost Sheet ID */}
                      <td className="py-3 px-3 align-top">
                        <div className="font-mono font-semibold text-zinc-100">{cs.id}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5 flex items-center gap-1.5">
                          <span>{formatDateShort(cs.approvedAt || cs.updatedAt || cs.createdAt)}</span>
                          {isLegacy && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-400/90">Legacy summary</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Style & Buyer */}
                      <td className="py-3 px-3 align-top min-w-[200px]">
                        <div className="font-medium text-zinc-100">
                          <span className="font-mono text-amber-300 mr-1.5">
                            {style?.styleCode || cs.styleId}
                          </span>
                          <span>{style?.description || 'Unknown Style'}</span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">
                          {buyer ? `${buyer.code} · ${buyer.name}` : cs.buyerId || '—'}
                        </div>
                      </td>

                      {/* Linked Order */}
                      <td className="py-3 px-3 align-top whitespace-nowrap">
                        {cs.orderId ? (
                          <div>
                            <div className="font-mono text-zinc-200">
                              {order?.poNumber || cs.orderId}
                            </div>
                            {cs.costingBasisQuantity && (
                              <div className="text-[10px] font-mono text-zinc-500 tabular-nums">
                                {cs.costingBasisQuantity.toLocaleString()} pcs
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-500">Style-Level</span>
                        )}
                      </td>

                      {/* Version / BOM Ref */}
                      <td className="py-3 px-3 align-top font-mono whitespace-nowrap">
                        <div className="text-zinc-100 font-semibold">v{cs.version}</div>
                        <div className="text-[10px] text-zinc-500">
                          {cs.bomVersionRef !== undefined
                            ? `BOM v${cs.bomVersionRef}`
                            : isLegacy
                            ? 'Summary only'
                            : 'Manual'}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 align-top whitespace-nowrap">
                        <div className={`font-mono font-semibold ${getStatusColorClass(status)}`}>
                          {status}
                        </div>
                        {cs.approvedBy && status === 'APPROVED' && (
                          <div className="text-[10px] text-zinc-500 truncate max-w-[140px]">
                            {cs.approvedBy}
                          </div>
                        )}
                      </td>

                      {/* Currency */}
                      <td className="py-3 px-3 align-top font-mono text-zinc-300 whitespace-nowrap">
                        {cs.currency}
                      </td>

                      {/* Cost / Pc */}
                      <td className="py-3 px-3 align-top text-right font-mono tabular-nums text-zinc-200 whitespace-nowrap">
                        {Number.isFinite(cs.totalCostPerGarment)
                          ? cs.totalCostPerGarment.toFixed(4)
                          : '—'}
                      </td>

                      {/* Quoted FOB */}
                      <td className="py-3 px-3 align-top text-right font-mono tabular-nums font-semibold text-amber-300 whitespace-nowrap">
                        {Number.isFinite(cs.quotedFobPrice)
                          ? cs.quotedFobPrice.toFixed(4)
                          : '—'}
                      </td>

                      {/* Gross Margin % */}
                      <td className="py-3 px-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={
                            cs.marginPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {Number.isFinite(cs.marginPercent)
                            ? `${cs.marginPercent.toFixed(2)}%`
                            : '—'}
                        </span>
                      </td>

                      {/* Open Action */}
                      <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenSheet(cs)}
                          data-testid={`open-cost-sheet-btn-${cs.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 text-xs font-medium transition-colors"
                        >
                          <span>{status === 'DRAFT' ? 'Edit' : 'Open'}</span>
                          <ExternalLink className="w-3 h-3 text-amber-400" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
