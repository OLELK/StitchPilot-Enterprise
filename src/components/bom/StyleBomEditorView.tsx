import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Plus,
  Copy,
  Archive,
  Edit,
  AlertCircle,
  CheckCircle2,
  FilePlus2,
  Layers,
  X,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';
import {
  BomComponentCategory,
  BomItemEntity,
  BuyerEntity,
  MaterialEntity,
  StyleEntity,
} from '../../db/types';
import { useBomData } from '../../db/hooks/useBomData';
import {
  canConvertUom,
  getUomConversionFactor,
  roundUomDisplay,
} from '../../db/services/uomConverter';
import { BomItemFormModal, BomItemSavePayload } from './BomItemFormModal';

interface StyleBomEditorViewProps {
  styles: StyleEntity[];
  buyers: BuyerEntity[];
  materials: MaterialEntity[];
  isDbReady: boolean;
  initialStyleId?: string | null;
  onBomMutated?: () => Promise<void> | void;
}

type CategoryFilter = 'ALL' | BomComponentCategory;

export const StyleBomEditorView: React.FC<StyleBomEditorViewProps> = ({
  styles,
  buyers,
  materials,
  isDbReady,
  initialStyleId = null,
  onBomMutated,
}) => {
  const [styleSearch, setStyleSearch] = useState<string>('');
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(
    initialStyleId || styles[0]?.id || null
  );
  const [selectedVersion, setSelectedVersion] = useState<number>(1);
  const [draftEmptyVersion, setDraftEmptyVersion] = useState<number | null>(null);

  const [componentSearch, setComponentSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [showArchived, setShowArchived] = useState<boolean>(false);

  // Modal & confirmation states (zero window.confirm / window.alert)
  const [isFormModalOpen, setIsFormModalOpen] = useState<boolean>(false);
  const [itemToEdit, setItemToEdit] = useState<BomItemEntity | null>(null);
  const [itemToArchive, setItemToArchive] = useState<BomItemEntity | null>(null);
  const [versionToArchive, setVersionToArchive] = useState<number | null>(null);
  const [isMutatingAction, setIsMutatingAction] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const buyerMap = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);
  const materialMap = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials]
  );

  // Sync initial selection once styles load from IndexedDB
  useEffect(() => {
    if (initialStyleId && styles.some((s) => s.id === initialStyleId)) {
      setSelectedStyleId(initialStyleId);
      setDraftEmptyVersion(null);
      return;
    }
    if (!selectedStyleId && styles.length > 0) {
      setSelectedStyleId(styles[0].id);
    }
  }, [styles, initialStyleId, selectedStyleId]);

  const filteredStyles = useMemo(() => {
    const q = styleSearch.trim().toLowerCase();
    if (!q) return styles;
    return styles.filter((s) => {
      const buyer = buyerMap.get(s.buyerId);
      return (
        s.styleCode.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.garmentType.toLowerCase().includes(q) ||
        (buyer &&
          (buyer.name.toLowerCase().includes(q) ||
            buyer.code.toLowerCase().includes(q)))
      );
    });
  }, [styles, styleSearch, buyerMap]);

  const selectedStyle = useMemo(
    () => styles.find((s) => s.id === selectedStyleId) || null,
    [styles, selectedStyleId]
  );

  const {
    bomItems,
    versions,
    isLoading,
    error: bomLoadError,
    createBomItem,
    updateBomItem,
    archiveBomItem,
    archiveBomVersion,
    cloneBomVersion,
  } = useBomData({
    isDbReady,
    styleId: selectedStyleId,
    onDataMutated: onBomMutated,
  });

  // Keep selectedVersion synced with persisted versions or active draftEmptyVersion
  useEffect(() => {
    if (draftEmptyVersion !== null) {
      if (versions.some((v) => v.bomVersion === draftEmptyVersion)) {
        setDraftEmptyVersion(null);
      } else {
        setSelectedVersion(draftEmptyVersion);
        return;
      }
    }

    if (versions.length === 0) {
      setSelectedVersion(1);
      return;
    }

    const exists = versions.some((v) => v.bomVersion === selectedVersion);
    if (!exists) {
      const latestActive = versions.find((v) => v.activeItems > 0);
      setSelectedVersion(latestActive ? latestActive.bomVersion : versions[0].bomVersion);
    }
  }, [versions, selectedVersion, draftEmptyVersion]);

  // Combined version list for version switcher
  const displayVersions = useMemo(() => {
    const list = versions.map((v) => ({ ...v, isDraftNew: false }));
    if (
      draftEmptyVersion !== null &&
      !list.some((v) => v.bomVersion === draftEmptyVersion)
    ) {
      list.unshift({
        bomVersion: draftEmptyVersion,
        totalItems: 0,
        activeItems: 0,
        archivedItems: 0,
        isDraftNew: true,
      });
    }
    if (list.length === 0) {
      list.push({
        bomVersion: 1,
        totalItems: 0,
        activeItems: 0,
        archivedItems: 0,
        isDraftNew: true,
      });
    }
    return list;
  }, [versions, draftEmptyVersion]);

  const nextVersionNumber = useMemo(() => {
    const maxPersisted = versions.reduce((m, v) => Math.max(m, v.bomVersion), 0);
    const maxDraft = draftEmptyVersion ?? 0;
    return Math.max(maxPersisted, maxDraft, 0) + 1;
  }, [versions, draftEmptyVersion]);

  // Items belonging to the currently selected BOM version
  const versionItems = useMemo(
    () => bomItems.filter((item) => (item.bomVersion ?? 1) === selectedVersion),
    [bomItems, selectedVersion]
  );

  const activeCountInVersion = useMemo(
    () => versionItems.filter((i) => i.status !== 'ARCHIVED').length,
    [versionItems]
  );

  const archivedCountInVersion = useMemo(
    () => versionItems.filter((i) => i.status === 'ARCHIVED').length,
    [versionItems]
  );

  // UOM validation health across active components in this version
  const uomHealth = useMemo(() => {
    let validCount = 0;
    let invalidCount = 0;
    for (const item of versionItems) {
      if (item.status === 'ARCHIVED') continue;
      const mat = materialMap.get(item.materialId);
      if (!mat) {
        invalidCount += 1;
        continue;
      }
      const res = canConvertUom(
        item.consumptionUnit ?? mat.unit,
        mat.unit,
        mat.uomAttributes
      );
      if (res.valid) validCount += 1;
      else invalidCount += 1;
    }
    return { validCount, invalidCount };
  }, [versionItems, materialMap]);

  // Filtered rows for the table
  const visibleItems = useMemo(() => {
    const q = componentSearch.trim().toLowerCase();
    return versionItems.filter((item) => {
      if (!showArchived && item.status === 'ARCHIVED') return false;
      if (categoryFilter !== 'ALL') {
        const cat = item.componentCategory || 'FABRIC';
        if (cat !== categoryFilter) return false;
      }
      if (!q) return true;
      const mat = materialMap.get(item.materialId);
      return (
        item.placement.toLowerCase().includes(q) ||
        (item.notes && item.notes.toLowerCase().includes(q)) ||
        (mat &&
          (mat.materialCode.toLowerCase().includes(q) ||
            mat.name.toLowerCase().includes(q)))
      );
    });
  }, [versionItems, showArchived, categoryFilter, componentSearch, materialMap]);

  const handleSelectStyle = (nextId: string) => {
    setSelectedStyleId(nextId);
    setDraftEmptyVersion(null);
    setFeedback(null);
    setComponentSearch('');
    setCategoryFilter('ALL');
  };

  const handleOpenAddComponent = () => {
    setItemToEdit(null);
    setFeedback(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditComponent = (item: BomItemEntity) => {
    setItemToEdit(item);
    setFeedback(null);
    setIsFormModalOpen(true);
  };

  const handleSaveComponent = async (payload: BomItemSavePayload) => {
    if (payload.mode === 'edit' && payload.id) {
      await updateBomItem(payload.id, payload.data);
      setFeedback({
        type: 'success',
        message: `Updated BOM component "${payload.data.placement}" in v${payload.data.bomVersion ?? selectedVersion}.`,
      });
    } else {
      const created = await createBomItem(payload.data);
      const targetVer = created.bomVersion ?? 1;
      setSelectedVersion(targetVer);
      if (draftEmptyVersion === targetVer) {
        setDraftEmptyVersion(null);
      }
      setFeedback({
        type: 'success',
        message: `Added "${created.placement}" to ${selectedStyle?.styleCode || 'style'} BOM v${targetVer}.`,
      });
    }
  };

  const handleCloneVersion = async () => {
    if (!selectedStyle) return;
    setFeedback(null);
    setIsMutatingAction(true);
    try {
      const cloned = await cloneBomVersion(selectedStyle.id, selectedVersion);
      const newVer = cloned[0]?.bomVersion ?? nextVersionNumber;
      setDraftEmptyVersion(null);
      setSelectedVersion(newVer);
      setFeedback({
        type: 'success',
        message: `Cloned ${cloned.length} active component${cloned.length === 1 ? '' : 's'} from v${selectedVersion} to new BOM v${newVer}.`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to clone BOM version.',
      });
    } finally {
      setIsMutatingAction(false);
    }
  };

  const handleCreateEmptyVersion = () => {
    const newVer = nextVersionNumber;
    setDraftEmptyVersion(newVer);
    setSelectedVersion(newVer);
    setFeedback({
      type: 'success',
      message: `Prepared empty BOM v${newVer}. Add a component to persist this version.`,
    });
  };

  const handleConfirmArchiveItem = async () => {
    if (!itemToArchive) return;
    setIsMutatingAction(true);
    setFeedback(null);
    try {
      await archiveBomItem(itemToArchive.id);
      setFeedback({
        type: 'success',
        message: `Archived component "${itemToArchive.placement}" (historical record preserved).`,
      });
      setItemToArchive(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to archive BOM component.',
      });
    } finally {
      setIsMutatingAction(false);
    }
  };

  const handleConfirmArchiveVersion = async () => {
    if (!selectedStyle || versionToArchive === null) return;
    setIsMutatingAction(true);
    setFeedback(null);
    try {
      const archived = await archiveBomVersion(selectedStyle.id, versionToArchive);
      setShowArchived(true);
      setFeedback({
        type: 'success',
        message: `Archived BOM v${versionToArchive} for ${selectedStyle.styleCode} (${archived.length} record${archived.length === 1 ? '' : 's'} preserved).`,
      });
      setVersionToArchive(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to archive BOM version.',
      });
    } finally {
      setIsMutatingAction(false);
    }
  };

  const selectedBuyer = selectedStyle ? buyerMap.get(selectedStyle.buyerId) : undefined;
  const isCurrentVersionPersisted = versions.some(
    (v) => v.bomVersion === selectedVersion
  );

  return (
    <div className="space-y-5" data-testid="style-bom-editor">
      {/* Style Selector & Context Bar */}
      <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Style Search + Select */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
            <div className="relative sm:w-60">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                data-testid="bom-style-search"
                placeholder="Filter styles by code or buyer..."
                value={styleSearch}
                onChange={(e) => setStyleSearch(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-hidden focus:border-amber-500 font-mono"
              />
            </div>

            <select
              data-testid="bom-style-select"
              aria-label="Select garment style"
              value={selectedStyleId || ''}
              onChange={(e) => handleSelectStyle(e.target.value)}
              className="flex-1 max-w-xl bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-3 py-2 text-xs text-zinc-100 font-sans focus:outline-hidden"
            >
              {filteredStyles.length === 0 ? (
                <option value="">No styles match filter</option>
              ) : (
                filteredStyles.map((st) => {
                  const b = buyerMap.get(st.buyerId);
                  return (
                    <option key={st.id} value={st.id}>
                      {st.styleCode} — {st.description} ({b ? b.code : st.buyerId})
                    </option>
                  );
                })
              )}
            </select>
          </div>

          {/* Primary Action */}
          <button
            type="button"
            data-testid="bom-add-component-btn"
            disabled={!selectedStyle || materials.length === 0}
            onClick={handleOpenAddComponent}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-zinc-950 rounded-md text-xs font-bold font-mono flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            Add Component
          </button>
        </div>

        {/* Selected Style Unboxed Metadata Line */}
        {selectedStyle && (
          <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-zinc-400">
              <span className="font-mono font-bold text-amber-400">
                {selectedStyle.styleCode}
              </span>
              <span className="text-zinc-100 font-medium">
                {selectedStyle.description}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Buyer:{' '}
                <span className="text-zinc-200">
                  {selectedBuyer
                    ? `${selectedBuyer.name} (${selectedBuyer.code})`
                    : selectedStyle.buyerId}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span>{selectedStyle.fabricClassification}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-zinc-300">
                SAM {selectedStyle.samMinutes.toFixed(1)} min
              </span>
              <span aria-hidden="true">·</span>
              <span>{selectedStyle.season}</span>
            </div>

            <div className="flex items-center gap-4 text-[11px] font-mono tabular-nums text-zinc-400">
              <span>
                Active: <strong className="text-emerald-400">{activeCountInVersion}</strong>
              </span>
              <span>
                Archived: <strong className="text-zinc-300">{archivedCountInVersion}</strong>
              </span>
              <span>
                UOM:{' '}
                {uomHealth.invalidCount === 0 ? (
                  <strong className="text-emerald-400">
                    {uomHealth.validCount} Valid
                  </strong>
                ) : (
                  <strong className="text-rose-400">
                    {uomHealth.invalidCount} Incompatible
                  </strong>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Feedback / Error Banners */}
      {bomLoadError && (
        <div
          role="alert"
          className="p-3 rounded-md bg-rose-950/70 border border-rose-800 text-rose-200 text-xs font-mono flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{bomLoadError}</span>
        </div>
      )}

      {feedback && (
        <div
          data-testid="bom-feedback-banner"
          className={`p-3 rounded-md border text-xs font-mono flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-800/80 text-emerald-200'
              : 'bg-rose-950/60 border-rose-800 text-rose-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss notification"
            className="text-zinc-400 hover:text-white p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Version Switcher & Lifecycle Toolbar */}
      {selectedStyle && (
        <div className="p-3.5 bg-zinc-900/90 border border-zinc-800 rounded-lg flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Version Tabs */}
          <div className="flex flex-wrap items-center gap-1.5" data-testid="bom-version-tabs">
            <span className="text-[11px] font-mono text-zinc-400 mr-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              Versions:
            </span>
            {displayVersions.map((ver) => {
              const isSelected = ver.bomVersion === selectedVersion;
              return (
                <button
                  key={ver.bomVersion}
                  type="button"
                  data-testid={`bom-version-tab-${ver.bomVersion}`}
                  onClick={() => setSelectedVersion(ver.bomVersion)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5 whitespace-nowrap border ${
                    isSelected
                      ? 'bg-zinc-800 text-amber-400 border-amber-500/40 font-bold'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  <span>v{ver.bomVersion}</span>
                  <span className="text-[10px] text-zinc-400 font-normal tabular-nums">
                    {ver.isDraftNew
                      ? '(new)'
                      : `${ver.activeItems} active${
                          ver.archivedItems > 0 ? ` · ${ver.archivedItems} arch` : ''
                        }`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Version Actions */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <button
              type="button"
              data-testid="bom-clone-version-btn"
              disabled={activeCountInVersion === 0 || isMutatingAction}
              onClick={handleCloneVersion}
              title={
                activeCountInVersion === 0
                  ? 'Cloning requires at least one ACTIVE component in the current version.'
                  : `Clone ${activeCountInVersion} active component(s) into v${nextVersionNumber}`
              }
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 border border-zinc-700 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5 text-amber-400" />
              Clone Active to v{nextVersionNumber}
            </button>

            <button
              type="button"
              data-testid="bom-new-empty-version-btn"
              disabled={isMutatingAction || draftEmptyVersion !== null}
              onClick={handleCreateEmptyVersion}
              className="px-3 py-1.5 bg-zinc-950 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 border border-zinc-800 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-cyan-400" />
              New Empty v{nextVersionNumber}
            </button>

            <button
              type="button"
              data-testid="bom-archive-version-btn"
              disabled={
                !isCurrentVersionPersisted ||
                activeCountInVersion === 0 ||
                isMutatingAction
              }
              onClick={() => setVersionToArchive(selectedVersion)}
              className="px-3 py-1.5 bg-zinc-950 hover:bg-rose-950/60 disabled:opacity-40 disabled:cursor-not-allowed text-rose-300 border border-rose-900/60 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Archive className="w-3.5 h-3.5" />
              Archive v{selectedVersion}
            </button>
          </div>
        </div>
      )}

      {/* Table Filter Bar & High-Density BOM Table */}
      <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 overflow-hidden">
        {/* Filter Strip */}
        <div className="p-3 bg-zinc-950/60 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                data-testid="bom-component-search"
                placeholder="Search material or placement..."
                value={componentSearch}
                onChange={(e) => setComponentSearch(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 pl-8 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-hidden focus:border-amber-500 font-mono"
              />
            </div>

            <select
              data-testid="bom-category-filter"
              aria-label="Filter by component category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
              className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 font-mono focus:outline-hidden focus:border-amber-500"
            >
              <option value="ALL">All Categories</option>
              <option value="FABRIC">Fabric</option>
              <option value="TRIM">Trim & Fastener</option>
              <option value="THREAD">Thread & Notion</option>
              <option value="PACKAGING">Packaging</option>
              <option value="LABEL">Label & Tag</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs font-mono text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="bom-show-archived-toggle"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
            />
            <span>Show Archived ({archivedCountInVersion})</span>
          </label>
        </div>

        {/* BOM Components Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="bom-items-table">
            <thead>
              <tr className="bg-zinc-950/80 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
                <th className="py-3 px-4 font-medium">Material & Placement</th>
                <th className="py-3 px-3 font-medium text-right">Consumption</th>
                <th className="py-3 px-3 font-medium">UOM → Stock Unit</th>
                <th className="py-3 px-3 font-medium text-right">Wastage</th>
                <th className="py-3 px-3 font-medium">Colour Scope</th>
                <th className="py-3 px-3 font-medium">Size Scope & Overrides</th>
                <th className="py-3 px-3 font-medium text-center">Status</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-400 font-mono">
                    Loading style Bill of Materials...
                  </td>
                </tr>
              ) : !selectedStyle ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-400 font-mono">
                    No garment styles registered. Create a style in Merchandising to define a BOM.
                  </td>
                </tr>
              ) : visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center space-y-3">
                    <div className="text-zinc-400 font-mono">
                      {versionItems.length === 0
                        ? `No components defined in ${selectedStyle.styleCode} BOM v${selectedVersion}.`
                        : !showArchived && archivedCountInVersion > 0 && activeCountInVersion === 0
                        ? `All ${archivedCountInVersion} component(s) in BOM v${selectedVersion} are archived. Enable "Show Archived" to inspect them.`
                        : 'No BOM components match your current search or category filter.'}
                    </div>
                    {versionItems.length === 0 && materials.length > 0 && (
                      <button
                        type="button"
                        onClick={handleOpenAddComponent}
                        className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-md text-xs font-bold font-mono inline-flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                        Add First Component to v{selectedVersion}
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                visibleItems.map((item) => {
                  const mat = materialMap.get(item.materialId);
                  const isArchived = item.status === 'ARCHIVED';
                  const effectiveConsumptionUnit =
                    item.consumptionUnit ?? mat?.unit ?? 'pcs';
                  const uomStatus = mat
                    ? canConvertUom(
                        effectiveConsumptionUnit,
                        mat.unit,
                        mat.uomAttributes
                      )
                    : { valid: false, reason: 'Material record not found' };
                  const conversionFactor =
                    mat && uomStatus.valid
                      ? getUomConversionFactor(
                          effectiveConsumptionUnit,
                          mat.unit,
                          mat.uomAttributes
                        ).factor
                      : null;

                  const overrideEntries = item.sizeConsumptionMap
                    ? Object.entries(item.sizeConsumptionMap)
                    : [];

                  return (
                    <tr
                      key={item.id}
                      data-testid={`bom-row-${item.id}`}
                      className={`transition-colors ${
                        isArchived
                          ? 'bg-zinc-950/50 text-zinc-500'
                          : 'hover:bg-zinc-800/35 text-zinc-200'
                      }`}
                    >
                      {/* Material & Placement */}
                      <td className="py-3 px-4">
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`font-mono font-bold ${
                              isArchived ? 'text-zinc-500' : 'text-amber-400'
                            }`}
                          >
                            {mat ? mat.materialCode : item.materialId}
                          </span>
                          <span className="font-sans font-semibold text-zinc-100">
                            {mat ? mat.name : 'Unknown Material'}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                          <span>{item.placement}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[10px] text-zinc-500">
                            {item.componentCategory || 'FABRIC'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[10px] text-zinc-500">
                            {item.isMandatory ? 'Mandatory' : 'Optional'}
                          </span>
                        </div>
                        {item.notes && (
                          <div className="text-[10px] text-zinc-500 mt-0.5 truncate max-w-md">
                            Note: {item.notes}
                          </div>
                        )}
                      </td>

                      {/* Consumption & Basis */}
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-zinc-100">
                          {item.consumptionPerGarment} {effectiveConsumptionUnit}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {item.consumptionBasis === 'PER_DOZEN'
                            ? 'per dozen (12 pcs)'
                            : 'per piece (1 pc)'}
                        </div>
                      </td>

                      {/* Stock Unit & UOM Compatibility */}
                      <td className="py-3 px-3 font-mono whitespace-nowrap">
                        {mat ? (
                          <div>
                            <div className="flex items-center gap-1 text-zinc-200">
                              <span>{effectiveConsumptionUnit}</span>
                              <ArrowRight className="w-3 h-3 text-zinc-500" />
                              <span className="font-semibold">{mat.unit}</span>
                            </div>
                            {uomStatus.valid ? (
                              <div className="text-[10px] text-emerald-400 tabular-nums">
                                {conversionFactor === 1
                                  ? 'Direct (1:1)'
                                  : `Valid (×${roundUomDisplay(conversionFactor!, 5)})`}
                              </div>
                            ) : (
                              <div
                                className="text-[10px] text-rose-400 flex items-center gap-1"
                                title={uomStatus.reason}
                              >
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>Incompatible UOM</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-rose-400 text-[11px]">Missing material</span>
                        )}
                      </td>

                      {/* Wastage */}
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-300 whitespace-nowrap">
                        {item.wastagePercent}%
                      </td>

                      {/* Colour Scope */}
                      <td className="py-3 px-3 font-mono text-[11px]">
                        {item.colorScope === 'SPECIFIC' &&
                        item.applicableColors &&
                        item.applicableColors.length > 0 ? (
                          <div>
                            <div className="text-cyan-300 font-medium">Specific</div>
                            <div className="text-zinc-400 max-w-[160px] truncate" title={item.applicableColors.join(', ')}>
                              {item.applicableColors.join(', ')}
                            </div>
                          </div>
                        ) : (
                          <span className="text-zinc-400">All colours</span>
                        )}
                      </td>

                      {/* Size Scope & Overrides */}
                      <td className="py-3 px-3 font-mono text-[11px]">
                        <div>
                          {item.sizeScope === 'SPECIFIC' &&
                          item.applicableSizes &&
                          item.applicableSizes.length > 0 ? (
                            <span className="text-cyan-300">
                              Sizes: {item.applicableSizes.join(', ')}
                            </span>
                          ) : (
                            <span className="text-zinc-400">All sizes</span>
                          )}
                        </div>
                        {overrideEntries.length > 0 && (
                          <div className="text-[10px] text-amber-300/90 tabular-nums mt-0.5">
                            Overrides:{' '}
                            {overrideEntries
                              .map(([sz, qty]) => `${sz}=${qty}`)
                              .join(', ')}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center font-mono text-[11px] whitespace-nowrap">
                        {isArchived ? (
                          <span className="text-zinc-400 font-medium">ARCHIVED</span>
                        ) : (
                          <span className="text-emerald-400 font-semibold">ACTIVE</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {isArchived ? (
                          <span className="text-[11px] font-mono text-zinc-500">
                            Read-only
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              data-testid={`bom-edit-btn-${item.id}`}
                              onClick={() => handleOpenEditComponent(item)}
                              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded text-[11px] font-mono inline-flex items-center gap-1 transition-colors"
                            >
                              <Edit className="w-3 h-3 text-amber-400" />
                              Edit
                            </button>
                            <button
                              type="button"
                              data-testid={`bom-archive-btn-${item.id}`}
                              onClick={() => setItemToArchive(item)}
                              className="px-2.5 py-1 bg-zinc-950 hover:bg-rose-950/60 text-rose-300 border border-rose-900/60 rounded text-[11px] font-mono inline-flex items-center gap-1 transition-colors"
                            >
                              <Archive className="w-3 h-3" />
                              Archive
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="px-4 py-2.5 bg-zinc-950/70 border-t border-zinc-800 text-[11px] font-mono text-zinc-400 flex flex-wrap items-center justify-between gap-2 tabular-nums">
          <span>
            Showing {visibleItems.length} of {versionItems.length} component
            {versionItems.length === 1 ? '' : 's'} in BOM v{selectedVersion}
          </span>
          <span>
            {versions.length} persisted version{versions.length === 1 ? '' : 's'} · Non-destructive archiving enabled
          </span>
        </div>
      </div>

      {/* Add / Edit BOM Component Modal */}
      <BomItemFormModal
        isOpen={isFormModalOpen}
        onClose={() => {
          setIsFormModalOpen(false);
          setItemToEdit(null);
        }}
        style={selectedStyle}
        defaultVersion={selectedVersion}
        materials={materials}
        itemToEdit={itemToEdit}
        onSave={handleSaveComponent}
      />

      {/* Inline Confirmation Modal: Archive Single Component */}
      {itemToArchive && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          data-testid="bom-archive-item-confirm-modal"
        >
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono text-rose-400 font-semibold">
                  Non-Destructive Archive
                </div>
                <h3 className="text-base font-bold text-zinc-100 mt-0.5">
                  Archive BOM Component?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setItemToArchive(null)}
                className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              This will mark{' '}
              <strong className="text-white">{itemToArchive.placement}</strong> in BOM v
              {itemToArchive.bomVersion ?? 1} as <span className="font-mono text-rose-300">ARCHIVED</span>.
              Historical records remain stored in IndexedDB and can be inspected using the "Show Archived" toggle,
              but archived components are excluded from active MRP calculations.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setItemToArchive(null)}
                className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="bom-confirm-archive-item-btn"
                disabled={isMutatingAction}
                onClick={handleConfirmArchiveItem}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold font-mono"
              >
                {isMutatingAction ? 'Archiving...' : 'Archive Component'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Confirmation Modal: Archive Entire BOM Version */}
      {versionToArchive !== null && selectedStyle && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          data-testid="bom-archive-version-confirm-modal"
        >
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono text-rose-400 font-semibold">
                  Version Lifecycle Action
                </div>
                <h3 className="text-base font-bold text-zinc-100 mt-0.5">
                  Archive {selectedStyle.styleCode} BOM v{versionToArchive}?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setVersionToArchive(null)}
                className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              All <strong className="text-white">{activeCountInVersion}</strong> active
              component{activeCountInVersion === 1 ? '' : 's'} in BOM v{versionToArchive}{' '}
              will be archived atomically. Records are preserved for auditability and are
              never permanently deleted.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setVersionToArchive(null)}
                className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="bom-confirm-archive-version-btn"
                disabled={isMutatingAction}
                onClick={handleConfirmArchiveVersion}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold font-mono"
              >
                {isMutatingAction ? 'Archiving...' : `Archive v${versionToArchive}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
