import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Lock,
  Plus,
  Trash2,
  RefreshCw,
  Save,
  Send,
  GitBranch,
  RotateCcw,
  FileSpreadsheet,
  Info,
  XCircle,
  History,
  Layers,
} from 'lucide-react';
import {
  BuyerEntity,
  CmRateBasis,
  CmtCalculationMethod,
  ConsumptionBasis,
  ConsumptionUnit,
  CostSheetEntity,
  CostSheetLineCategory,
  CostSheetStatus,
  MaterialEntity,
  MaterialRateStatus,
  OverheadCalculationMethod,
  StyleEntity,
} from '../../db/types';
import { OrderWithDetails } from '../../db/hooks/useOrdersData';
import { BomVersionSummary } from '../../db/hooks/useBomData';
import {
  calculateCostSheet,
  CmtInput,
  CostingCalculationInput,
  CostingCalculationResult,
  CostingLineInput,
  CostPricingMode,
  OverheadInput,
} from '../../db/services/costingCalculator';
import {
  applyManualRateOverride,
  BomApplicabilityWarning,
  BomCostingImportResult,
  ImportBomToCostingOptions,
  MaterialRateIssue,
  SkippedBomCostingItem,
  updateConsumptionDrivenCostingLine,
} from '../../db/services/costingBomService';
import {
  CreateCostSheetInput,
  CreateRevisionOptions,
  UpdateDraftCostSheetInput,
} from '../../db/repositories';
import {
  CostSheetWorkflowActionMode,
  CostSheetWorkflowModal,
} from './CostSheetWorkflowModal';

interface EditableCostLine extends CostingLineInput {
  rateStatus?: MaterialRateStatus;
  rateIssueMessage?: string;
  conversionFormula?: string;
  isWeightedByOrder?: boolean;
  orderMatchedGarmentPieces?: number;
  orderTotalGarmentPieces?: number;
  orderGrossRequirementStockUnit?: number;
}

export interface CostSheetEditorProps {
  sheet: CostSheetEntity | null; // null = create new draft
  versionHistory: CostSheetEntity[];
  styles: StyleEntity[];
  orders: OrderWithDetails[];
  buyers: BuyerEntity[];
  materials: MaterialEntity[];
  isMutating: boolean;
  onBackToOverview: () => void;
  onSelectVersion: (versionSheet: CostSheetEntity) => void;
  onGetStyleBomVersions: (styleId: string) => Promise<BomVersionSummary[]>;
  onImportBom: (options: ImportBomToCostingOptions) => Promise<BomCostingImportResult>;
  onCreateCostSheet: (input: CreateCostSheetInput) => Promise<CostSheetEntity>;
  onUpdateDraftCostSheet: (
    costSheetId: string,
    updates: UpdateDraftCostSheetInput
  ) => Promise<CostSheetEntity>;
  onCreateRevision: (
    sourceCostSheetId: string,
    options?: CreateRevisionOptions
  ) => Promise<CostSheetEntity>;
  onSubmitForApproval: (costSheetId: string) => Promise<CostSheetEntity>;
  onApproveCostSheet: (
    costSheetId: string,
    approvedBy: string
  ) => Promise<{ approved: CostSheetEntity; superseded: CostSheetEntity[] }>;
  onRejectCostSheet: (
    costSheetId: string,
    rejectionReason: string
  ) => Promise<CostSheetEntity>;
  onReopenRejectedCostSheet: (costSheetId: string) => Promise<CostSheetEntity>;
}

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'BDT', 'INR', 'CNY', 'JPY'];

const CATEGORY_LABELS: Record<CostSheetLineCategory, string> = {
  FABRIC: 'Fabric',
  TRIMS: 'Trims & Fasteners',
  THREAD_CONSUMABLES: 'Thread & Consumables',
  PACKING: 'Packing',
  PRINTING_EMBROIDERY: 'Printing & Embroidery',
  WASHING_FINISHING: 'Washing & Finishing',
  OTHER: 'Other Direct Cost',
};

const ALL_CATEGORIES: CostSheetLineCategory[] = [
  'FABRIC',
  'TRIMS',
  'THREAD_CONSUMABLES',
  'PACKING',
  'PRINTING_EMBROIDERY',
  'WASHING_FINISHING',
  'OTHER',
];

const CONSUMPTION_UNITS: ConsumptionUnit[] = [
  'kg',
  'meters',
  'yards',
  'pcs',
  'dozens',
  'cones',
  'rolls',
  'gross',
];

function formatMoney(value: number | undefined, currency: string, decimals = 4): string {
  if (value === undefined || !Number.isFinite(value)) return `${currency} —`;
  return `${currency} ${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatDateShort(iso?: string): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusTextClass(status: CostSheetStatus): string {
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

function computeLegacyResiduals(
  sheet: CostSheetEntity
): Partial<Record<CostSheetLineCategory, number>> {
  const totals: Record<CostSheetLineCategory, number> = {
    FABRIC: sheet.fabricCost ?? 0,
    TRIMS: sheet.trimsCost ?? 0,
    THREAD_CONSUMABLES: sheet.threadConsumablesCost ?? 0,
    PACKING: sheet.packingCost ?? 0,
    PRINTING_EMBROIDERY: sheet.printingEmbroideryCost ?? 0,
    WASHING_FINISHING: sheet.washingFinishingCost ?? 0,
    OTHER: sheet.otherDirectCost ?? 0,
  };
  const lineSums: Record<CostSheetLineCategory, number> = {
    FABRIC: 0,
    TRIMS: 0,
    THREAD_CONSUMABLES: 0,
    PACKING: 0,
    PRINTING_EMBROIDERY: 0,
    WASHING_FINISHING: 0,
    OTHER: 0,
  };
  if (sheet.lineItems) {
    for (const li of sheet.lineItems) {
      lineSums[li.category] += li.costPerGarment;
    }
  }
  const residuals: Partial<Record<CostSheetLineCategory, number>> = {};
  for (const cat of ALL_CATEGORIES) {
    const diff = totals[cat] - lineSums[cat];
    if (diff > 1e-6) {
      residuals[cat] = Number(diff.toFixed(4));
    }
  }
  return residuals;
}

function toCleanCostingLineInput(line: EditableCostLine): CostingLineInput {
  const isConsumptionDriven = line.consumptionPerGarment !== undefined;
  return {
    id: line.id,
    category: line.category,
    description: line.description,
    currency: line.currency,
    materialId: line.materialId,
    materialCode: line.materialCode,
    bomItemId: line.bomItemId,
    sourceType: line.sourceType,
    costPerGarment: isConsumptionDriven ? undefined : line.costPerGarment,
    consumptionPerGarment: line.consumptionPerGarment,
    consumptionBasis: line.consumptionBasis,
    consumptionUnit: line.consumptionUnit,
    wastagePercent: line.wastagePercent,
    stockUnit: line.stockUnit,
    uomAttributes: line.uomAttributes ? { ...line.uomAttributes } : undefined,
    unitPrice: line.unitPrice,
    masterUnitCostSnapshot: line.masterUnitCostSnapshot,
    masterCostCurrencySnapshot: line.masterCostCurrencySnapshot,
    isRateOverridden: line.isRateOverridden,
    notes: line.notes,
  };
}

function deriveLineRateStatus(
  line: EditableCostLine,
  sheetCurrency: string
): MaterialRateStatus {
  if (line.consumptionPerGarment === undefined) {
    return 'MANUAL_OVERRIDE';
  }
  if (line.unitPrice === undefined || !Number.isFinite(line.unitPrice)) {
    if (
      line.masterUnitCostSnapshot !== undefined &&
      line.masterCostCurrencySnapshot &&
      line.masterCostCurrencySnapshot !== sheetCurrency
    ) {
      return 'CURRENCY_MISMATCH';
    }
    return 'MISSING_MASTER_RATE';
  }
  if (line.isRateOverridden) {
    return 'MANUAL_OVERRIDE';
  }
  if (
    line.masterUnitCostSnapshot !== undefined &&
    line.masterCostCurrencySnapshot === sheetCurrency
  ) {
    return 'MATCHED_MASTER_RATE';
  }
  return 'MANUAL_OVERRIDE';
}

export const CostSheetEditor: React.FC<CostSheetEditorProps> = ({
  sheet,
  versionHistory,
  styles,
  orders,
  buyers,
  materials,
  isMutating,
  onBackToOverview,
  onSelectVersion,
  onGetStyleBomVersions,
  onImportBom,
  onCreateCostSheet,
  onUpdateDraftCostSheet,
  onCreateRevision,
  onSubmitForApproval,
  onApproveCostSheet,
  onRejectCostSheet,
  onReopenRejectedCostSheet,
}) => {
  const isNewMode = sheet === null;
  const currentStatus: CostSheetStatus = sheet ? sheet.status ?? 'DRAFT' : 'DRAFT';
  const isReadOnly = !isNewMode && currentStatus !== 'DRAFT';
  const isLegacySummarySheet =
    !isNewMode && (!sheet.lineItems || sheet.lineItems.length === 0);

  const styleMap = useMemo(() => new Map(styles.map((s) => [s.id, s])), [styles]);
  const buyerMap = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);
  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const materialMap = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  // Header & context state
  const [selectedStyleId, setSelectedStyleId] = useState<string>(
    sheet?.styleId || styles[0]?.id || ''
  );
  const [selectedOrderId, setSelectedOrderId] = useState<string>(sheet?.orderId || '');
  const [selectedBomVersion, setSelectedBomVersion] = useState<string>(
    sheet?.bomVersionRef ? String(sheet.bomVersionRef) : ''
  );
  const [currency, setCurrency] = useState<string>(sheet?.currency || 'USD');
  const [costingBasisQuantityStr, setCostingBasisQuantityStr] = useState<string>(
    sheet?.costingBasisQuantity !== undefined ? String(sheet.costingBasisQuantity) : ''
  );

  // Available BOM versions for the selected style
  const [bomVersions, setBomVersions] = useState<BomVersionSummary[]>([]);
  const [isLoadingBomVersions, setIsLoadingBomVersions] = useState<boolean>(false);

  // Line items & BOM import metadata
  const [lines, setLines] = useState<EditableCostLine[]>([]);
  const [categoryCosts, setCategoryCosts] = useState<
    Partial<Record<CostSheetLineCategory, number>>
  >({});
  const [bomImportMeta, setBomImportMeta] = useState<{
    mode: 'STYLE' | 'ORDER';
    bomVersionUsed: number;
    rateIssues: MaterialRateIssue[];
    applicabilityWarnings: BomApplicabilityWarning[];
    skippedUnmatchedBomItems: SkippedBomCostingItem[];
    archivedComponentsExcludedCount: number;
    usedOrderQuantityFallback: boolean;
    warnings: string[];
  } | null>(null);
  const [isImportingBom, setIsImportingBom] = useState<boolean>(false);

  // CMT state
  const [cmtMethod, setCmtMethod] = useState<CmtCalculationMethod>('SAM_RATE');
  const [directCmtStr, setDirectCmtStr] = useState<string>('0');
  const [samMinutesStr, setSamMinutesStr] = useState<string>('15');
  const [efficiencyStr, setEfficiencyStr] = useState<string>('85');
  const [cmRateStr, setCmRateStr] = useState<string>('0.12');
  const [cmRateBasis, setCmRateBasis] = useState<CmRateBasis>('ACTUAL_MINUTE');

  // Overhead state
  const [overheadMethod, setOverheadMethod] =
    useState<OverheadCalculationMethod>('FIXED_PER_GARMENT');
  const [overheadValueStr, setOverheadValueStr] = useState<string>('0.5');

  // Pricing & commission state
  const [pricingMode, setPricingMode] = useState<CostPricingMode>('FOB_TO_MARGIN');
  const [commissionStr, setCommissionStr] = useState<string>('0');
  const [quotedFobStr, setQuotedFobStr] = useState<string>('12.00');
  const [targetMarginStr, setTargetMarginStr] = useState<string>('20');
  const [targetMarkupStr, setTargetMarkupStr] = useState<string>('25');

  // Local UI feedback & workflow modal state
  const [formError, setFormError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [workflowModal, setWorkflowModal] = useState<{
    isOpen: boolean;
    mode: CostSheetWorkflowActionMode;
  }>({ isOpen: false, mode: 'approve' });

  // Hydrate form state whenever opened sheet changes
  useEffect(() => {
    setFormError(null);
    setStatusNotice(null);
    setBomImportMeta(null);
    setHasUnsavedChanges(false);

    if (sheet) {
      setSelectedStyleId(sheet.styleId);
      setSelectedOrderId(sheet.orderId || '');
      setSelectedBomVersion(sheet.bomVersionRef ? String(sheet.bomVersionRef) : '');
      setCurrency(sheet.currency || 'USD');
      setCostingBasisQuantityStr(
        sheet.costingBasisQuantity !== undefined ? String(sheet.costingBasisQuantity) : ''
      );

      const loadedLines: EditableCostLine[] = (sheet.lineItems || []).map((li) => ({
        id: li.id,
        category: li.category,
        description: li.description,
        currency: li.currency,
        materialId: li.materialId,
        materialCode: li.materialCode,
        bomItemId: li.bomItemId,
        sourceType: li.sourceType,
        costPerGarment: li.consumptionPerGarment !== undefined ? undefined : li.costPerGarment,
        consumptionPerGarment: li.consumptionPerGarment,
        consumptionBasis: li.consumptionBasis,
        consumptionUnit: li.consumptionUnit,
        wastagePercent: li.wastagePercent,
        stockUnit: li.stockUnit,
        uomAttributes: li.uomAttributesSnapshot
          ? { ...li.uomAttributesSnapshot }
          : undefined,
        unitPrice: li.unitPrice,
        masterUnitCostSnapshot: li.masterUnitCostSnapshot,
        masterCostCurrencySnapshot: li.masterCostCurrencySnapshot,
        isRateOverridden: li.isRateOverridden,
        notes: li.notes,
      }));
      setLines(loadedLines);
      setCategoryCosts(computeLegacyResiduals(sheet));

      if (
        sheet.cmtCalculationMethod === 'SAM_RATE' &&
        sheet.samSnapshot !== undefined &&
        sheet.efficiencySnapshot !== undefined &&
        sheet.cmRatePerMinute !== undefined &&
        sheet.cmRateBasis !== undefined
      ) {
        setCmtMethod('SAM_RATE');
        setSamMinutesStr(String(sheet.samSnapshot));
        setEfficiencyStr(String(sheet.efficiencySnapshot));
        setCmRateStr(String(sheet.cmRatePerMinute));
        setCmRateBasis(sheet.cmRateBasis);
        setDirectCmtStr(String(sheet.laborCmtCost ?? 0));
      } else {
        setCmtMethod('DIRECT_CMT');
        setDirectCmtStr(String(sheet.laborCmtCost ?? 0));
        const st = styleMap.get(sheet.styleId);
        setSamMinutesStr(String(st?.samMinutes ?? 15));
        setEfficiencyStr(String(st?.targetEfficiencyPercent ?? 85));
        setCmRateStr('0.12');
        setCmRateBasis('ACTUAL_MINUTE');
      }

      if (sheet.overheadMethod && sheet.overheadValue !== undefined) {
        setOverheadMethod(sheet.overheadMethod);
        setOverheadValueStr(String(sheet.overheadValue));
      } else {
        setOverheadMethod('FIXED_PER_GARMENT');
        setOverheadValueStr(String(sheet.overheadCost ?? 0));
      }

      setPricingMode('FOB_TO_MARGIN');
      setCommissionStr(String(sheet.commissionPercent ?? 0));
      setQuotedFobStr(String(sheet.quotedFobPrice ?? 0));
      setTargetMarginStr(String(sheet.marginPercent ?? 20));
      setTargetMarkupStr(String(sheet.markupPercent ?? 25));
    } else {
      // Fresh draft defaults derived from first style
      const defaultStyle = styles[0];
      setSelectedStyleId(defaultStyle?.id || '');
      setSelectedOrderId('');
      setSelectedBomVersion('');
      setCurrency('USD');
      setCostingBasisQuantityStr('');
      setLines([]);
      setCategoryCosts({});
      setCmtMethod('SAM_RATE');
      setSamMinutesStr(String(defaultStyle?.samMinutes ?? 15));
      setEfficiencyStr(String(defaultStyle?.targetEfficiencyPercent ?? 85));
      setCmRateStr('0.12');
      setCmRateBasis('ACTUAL_MINUTE');
      setDirectCmtStr('1.50');
      setOverheadMethod('FIXED_PER_GARMENT');
      setOverheadValueStr('0.50');
      setPricingMode('MARGIN_TO_FOB');
      setCommissionStr('0');
      setQuotedFobStr('12.00');
      setTargetMarginStr('22');
      setTargetMarkupStr('28');
    }
  }, [sheet?.id, sheet?.updatedAt]);

  // Fetch BOM versions whenever selectedStyleId changes
  useEffect(() => {
    let active = true;
    if (!selectedStyleId) {
      setBomVersions([]);
      return;
    }
    setIsLoadingBomVersions(true);
    onGetStyleBomVersions(selectedStyleId)
      .then((versions) => {
        if (!active) return;
        setBomVersions(versions);
        if (isNewMode) {
          const activeVersions = versions.filter((v) => v.activeItems > 0);
          if (activeVersions.length > 0) {
            const latest = activeVersions[activeVersions.length - 1];
            setSelectedBomVersion(String(latest.bomVersion));
          } else {
            setSelectedBomVersion('');
          }
        }
      })
      .catch(() => {
        if (active) setBomVersions([]);
      })
      .finally(() => {
        if (active) setIsLoadingBomVersions(false);
      });
    return () => {
      active = false;
    };
  }, [selectedStyleId, isNewMode, onGetStyleBomVersions]);

  const selectedStyle = useMemo(
    () => (selectedStyleId ? styleMap.get(selectedStyleId) || null : null),
    [styleMap, selectedStyleId]
  );

  const selectedOrder = useMemo(
    () => (selectedOrderId ? orderMap.get(selectedOrderId) || null : null),
    [orderMap, selectedOrderId]
  );

  const linkedOrdersForStyle = useMemo(() => {
    if (!selectedStyleId) return [];
    return orders.filter((ord) => {
      if (ord.status === 'CANCELLED') return false;
      if (ord.styleId === selectedStyleId) return true;
      if (ord.additionalStyleIds?.includes(selectedStyleId)) return true;
      return false;
    });
  }, [orders, selectedStyleId]);

  const selectedBuyer = useMemo(() => {
    const buyerId =
      sheet?.buyerId || selectedOrder?.buyerId || selectedStyle?.buyerId;
    return buyerId ? buyerMap.get(buyerId) || null : null;
  }, [sheet?.buyerId, selectedOrder?.buyerId, selectedStyle?.buyerId, buyerMap]);

  // When style changes in new draft mode, sync SAM / efficiency & reset incompatible order
  const handleStyleChange = (nextStyleId: string) => {
    setSelectedStyleId(nextStyleId);
    setSelectedOrderId('');
    setLines([]);
    setCategoryCosts({});
    setBomImportMeta(null);
    setFormError(null);
    setStatusNotice(null);
    setHasUnsavedChanges(true);

    const nextStyle = styleMap.get(nextStyleId);
    if (nextStyle) {
      setSamMinutesStr(String(nextStyle.samMinutes));
      setEfficiencyStr(String(nextStyle.targetEfficiencyPercent));
    }
  };

  const handleOrderChange = (nextOrderId: string) => {
    setSelectedOrderId(nextOrderId);
    setBomImportMeta(null);
    setFormError(null);
    setStatusNotice(null);
    setHasUnsavedChanges(true);

    if (nextOrderId) {
      const ord = orderMap.get(nextOrderId);
      if (ord && ord.orderQuantity > 0) {
        setCostingBasisQuantityStr(String(ord.orderQuantity));
      }
    }
  };

  const handleCurrencyChange = (nextCurrency: string) => {
    const normalized = nextCurrency.trim().toUpperCase();
    setCurrency(normalized);
    setHasUnsavedChanges(true);
    setLines((prev) =>
      prev.map((line) => {
        const nextLine: EditableCostLine = { ...line, currency: normalized };
        // If this BOM line was auto-populated from a master rate in a different currency,
        // clear the stale master price so we never mix currencies silently.
        if (
          line.sourceType === 'BOM_IMPORT' &&
          !line.isRateOverridden &&
          line.masterCostCurrencySnapshot &&
          line.masterCostCurrencySnapshot !== normalized
        ) {
          nextLine.unitPrice = undefined;
          nextLine.rateStatus = 'CURRENCY_MISMATCH';
          nextLine.rateIssueMessage = `Master rate (${line.masterUnitCostSnapshot} ${line.masterCostCurrencySnapshot}) does not match costing currency ${normalized}; manual rate required.`;
        } else if (
          line.sourceType === 'BOM_IMPORT' &&
          !line.isRateOverridden &&
          line.masterUnitCostSnapshot !== undefined &&
          line.masterCostCurrencySnapshot === normalized
        ) {
          nextLine.unitPrice = line.masterUnitCostSnapshot;
          nextLine.rateStatus = 'MATCHED_MASTER_RATE';
          nextLine.rateIssueMessage = undefined;
        }
        return nextLine;
      })
    );
  };

  // BOM Import Handler (strictly via costingBomService)
  const handleImportBom = useCallback(async () => {
    setFormError(null);
    setStatusNotice(null);

    if (!selectedStyleId) {
      setFormError('Select a garment style before importing BOM components.');
      return;
    }

    const parsedBomVersion = selectedBomVersion ? Number(selectedBomVersion) : undefined;
    if (
      parsedBomVersion !== undefined &&
      (!Number.isInteger(parsedBomVersion) || parsedBomVersion < 1)
    ) {
      setFormError('Select a valid positive BOM version.');
      return;
    }

    setIsImportingBom(true);
    try {
      const importResult = await onImportBom({
        styleId: selectedStyleId,
        orderId: selectedOrderId || undefined,
        bomVersion: parsedBomVersion,
        currency,
      });

      const importedLines: EditableCostLine[] = importResult.linePreviews.map((p) => ({
        ...p.lineInput,
        rateStatus: p.rateResolution.status,
        rateIssueMessage: p.rateResolution.issueMessage,
        conversionFormula: p.conversionFormula,
        isWeightedByOrder: p.isWeightedByOrder,
        orderMatchedGarmentPieces: p.orderMatchedGarmentPieces,
        orderTotalGarmentPieces: p.orderTotalGarmentPieces,
        orderGrossRequirementStockUnit: p.orderGrossRequirementStockUnit,
      }));

      // Preserve any existing manual non-BOM lines (e.g., printing, washing, testing)
      setLines((prev) => {
        const preservedManual = prev
          .filter((l) => l.sourceType === 'MANUAL' || !l.bomItemId)
          .map((l) => ({ ...l, currency: importResult.currency }));
        return [...importedLines, ...preservedManual];
      });

      // Clear legacy summary residual category costs when importing BOM lines
      // to prevent double-counting legacy fabric/trims totals.
      setCategoryCosts({});
      setSelectedBomVersion(String(importResult.bomVersionUsed));
      if (importResult.costingBasisQuantity !== undefined) {
        setCostingBasisQuantityStr(String(importResult.costingBasisQuantity));
      }

      setBomImportMeta({
        mode: importResult.mode,
        bomVersionUsed: importResult.bomVersionUsed,
        rateIssues: importResult.rateIssues,
        applicabilityWarnings: importResult.applicabilityWarnings,
        skippedUnmatchedBomItems: importResult.skippedUnmatchedBomItems,
        archivedComponentsExcludedCount: importResult.archivedComponentsExcludedCount,
        usedOrderQuantityFallback: importResult.usedOrderQuantityFallback,
        warnings: importResult.warnings,
      });

      setHasUnsavedChanges(true);
      setStatusNotice(
        `Imported ${importedLines.length} active BOM component(s) from BOM v${importResult.bomVersionUsed} (${
          importResult.mode === 'ORDER'
            ? `Order-weighted for ${importResult.poNumber}`
            : 'Style-level base consumption'
        }).`
      );
    } catch (err: any) {
      setFormError(err?.message || 'Failed to import BOM components.');
    } finally {
      setIsImportingBom(false);
    }
  }, [selectedStyleId, selectedOrderId, selectedBomVersion, currency, onImportBom]);

  // Line Editing Helpers (reusing Stage 4C.1 pure helpers to prevent stale costPerGarment)
  const handleUpdateLineRate = (lineId: string, rawValue: string) => {
    setHasUnsavedChanges(true);
    setFormError(null);
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const trimmed = rawValue.trim();
        if (trimmed === '') {
          return {
            ...line,
            unitPrice: undefined,
            costPerGarment: undefined,
            rateStatus:
              line.masterUnitCostSnapshot !== undefined &&
              line.masterCostCurrencySnapshot &&
              line.masterCostCurrencySnapshot !== currency
                ? 'CURRENCY_MISMATCH'
                : 'MISSING_MASTER_RATE',
          };
        }
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return line;
        }
        const updatedBase = applyManualRateOverride(line, parsed);
        return {
          ...line,
          ...updatedBase,
          rateStatus: 'MANUAL_OVERRIDE',
          rateIssueMessage: undefined,
        };
      })
    );
  };

  const handleResetLineToMasterRate = (lineId: string) => {
    setHasUnsavedChanges(true);
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        if (
          line.masterUnitCostSnapshot === undefined ||
          line.masterCostCurrencySnapshot !== currency
        ) {
          return line;
        }
        return {
          ...line,
          unitPrice: line.masterUnitCostSnapshot,
          isRateOverridden: false,
          costPerGarment:
            line.consumptionPerGarment !== undefined
              ? undefined
              : line.masterUnitCostSnapshot,
          rateStatus: 'MATCHED_MASTER_RATE',
          rateIssueMessage: undefined,
        };
      })
    );
  };

  const handleUpdateLineField = (
    lineId: string,
    patch: Partial<EditableCostLine>
  ) => {
    setHasUnsavedChanges(true);
    setFormError(null);
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        if (line.consumptionPerGarment !== undefined) {
          const updated = updateConsumptionDrivenCostingLine(line, patch);
          return { ...line, ...updated };
        }
        return { ...line, ...patch };
      })
    );
  };

  const handleAddManualLine = (category: CostSheetLineCategory) => {
    setHasUnsavedChanges(true);
    setFormError(null);
    const id = `LI-MAN-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 5)
      .toUpperCase()}`;
    const newLine: EditableCostLine = {
      id,
      category,
      description: `${CATEGORY_LABELS[category]} Charge`,
      currency,
      sourceType: 'MANUAL',
      costPerGarment: 0,
      unitPrice: 0,
      isRateOverridden: true,
      rateStatus: 'MANUAL_OVERRIDE',
    };
    setLines((prev) => [...prev, newLine]);
  };

  const handleRemoveLine = (lineId: string) => {
    setHasUnsavedChanges(true);
    setLines((prev) => prev.filter((l) => l.id !== lineId));
  };

  // Detect lines missing explicit material rates
  const missingRateLines = useMemo(() => {
    return lines.filter((line) => {
      if (line.consumptionPerGarment !== undefined) {
        return (
          line.unitPrice === undefined ||
          typeof line.unitPrice !== 'number' ||
          !Number.isFinite(line.unitPrice) ||
          line.unitPrice < 0
        );
      }
      return (
        line.costPerGarment === undefined ||
        typeof line.costPerGarment !== 'number' ||
        !Number.isFinite(line.costPerGarment) ||
        line.costPerGarment < 0
      );
    });
  }, [lines]);

  // Build CostingCalculationInput from current form inputs
  const buildCalculationPayload = useCallback((): {
    payload: CostingCalculationInput | null;
    validationError: string | null;
  } => {
    if (missingRateLines.length > 0) {
      return {
        payload: null,
        validationError: `${missingRateLines.length} material line(s) are missing an explicit unit rate in ${currency}. Enter manual rates before saving or calculating.`,
      };
    }

    const cmtInput: CmtInput =
      cmtMethod === 'DIRECT_CMT'
        ? { method: 'DIRECT_CMT', directCmtCost: Number(directCmtStr) }
        : {
            method: 'SAM_RATE',
            samMinutes: Number(samMinutesStr),
            efficiencyPercent: Number(efficiencyStr),
            cmRatePerMinute: Number(cmRateStr),
            cmRateBasis,
          };

    const overheadInput: OverheadInput = {
      method: overheadMethod,
      value: Number(overheadValueStr),
    };

    const commissionPercent =
      commissionStr.trim() === '' ? 0 : Number(commissionStr);

    const calcInput: CostingCalculationInput = {
      currency,
      lineItems: lines.map(toCleanCostingLineInput),
      categoryCosts,
      cmt: cmtInput,
      overhead: overheadInput,
      commissionPercent,
      pricingMode,
      quotedFobPrice:
        pricingMode === 'FOB_TO_MARGIN' ? Number(quotedFobStr) : undefined,
      targetMarginPercent:
        pricingMode === 'MARGIN_TO_FOB' ? Number(targetMarginStr) : undefined,
      targetMarkupPercent:
        pricingMode === 'MARKUP_TO_FOB' ? Number(targetMarkupStr) : undefined,
      displayDecimals: 4,
    };

    return { payload: calcInput, validationError: null };
  }, [
    missingRateLines.length,
    currency,
    cmtMethod,
    directCmtStr,
    samMinutesStr,
    efficiencyStr,
    cmRateStr,
    cmRateBasis,
    overheadMethod,
    overheadValueStr,
    commissionStr,
    lines,
    categoryCosts,
    pricingMode,
    quotedFobStr,
    targetMarginStr,
    targetMarkupStr,
  ]);

  // Real-time preview strictly via costingCalculator.ts (zero duplicated math)
  const livePreview: {
    result: CostingCalculationResult | null;
    error: string | null;
  } = useMemo(() => {
    if (isReadOnly && sheet) {
      return { result: null, error: null };
    }
    const { payload, validationError } = buildCalculationPayload();
    if (validationError || !payload) {
      return { result: null, error: validationError };
    }
    try {
      const calc = calculateCostSheet(payload);
      return { result: calc, error: null };
    } catch (err: any) {
      return { result: null, error: err?.message || 'Incomplete costing inputs.' };
    }
  }, [isReadOnly, sheet, buildCalculationPayload]);

  // Map calculated line costs back by ID for display in the worksheet table
  const calculatedLineCostById = useMemo(() => {
    const map = new Map<string, number>();
    if (isReadOnly && sheet?.lineItems) {
      for (const li of sheet.lineItems) {
        map.set(li.id, li.costPerGarment);
      }
    } else if (livePreview.result) {
      for (const li of livePreview.result.calculatedLineItems) {
        map.set(li.id, li.costPerGarment);
      }
    }
    return map;
  }, [isReadOnly, sheet, livePreview.result]);

  // Derived summary metrics (persisted immutable snapshot for read-only; live calculator result for drafts)
  const summaryDisplay = useMemo(() => {
    const parsedQty =
      costingBasisQuantityStr.trim() !== ''
        ? Number(costingBasisQuantityStr)
        : undefined;
    const validLotQty =
      parsedQty !== undefined && Number.isFinite(parsedQty) && parsedQty > 0
        ? parsedQty
        : undefined;

    if (isReadOnly && sheet) {
      const matSubtotal =
        (sheet.fabricCost ?? 0) +
        (sheet.trimsCost ?? 0) +
        (sheet.threadConsumablesCost ?? 0) +
        (sheet.packingCost ?? 0);
      const valAddedSubtotal =
        (sheet.printingEmbroideryCost ?? 0) + (sheet.washingFinishingCost ?? 0);
      const commPct = sheet.commissionPercent ?? 0;
      const commAmt = (sheet.quotedFobPrice ?? 0) * (commPct / 100);
      const netFob = (sheet.quotedFobPrice ?? 0) - commAmt;
      const profit =
        sheet.profitPerGarment !== undefined
          ? sheet.profitPerGarment
          : netFob - sheet.totalCostPerGarment;
      const markup =
        sheet.markupPercent !== undefined
          ? sheet.markupPercent
          : sheet.totalCostPerGarment > 0
          ? (profit / sheet.totalCostPerGarment) * 100
          : 0;
      const effActualMin =
        sheet.cmtCalculationMethod === 'SAM_RATE' &&
        sheet.samSnapshot &&
        sheet.efficiencySnapshot
          ? sheet.samSnapshot / (sheet.efficiencySnapshot / 100)
          : undefined;

      return {
        isComplete: true,
        currency: sheet.currency,
        fabricCost: sheet.fabricCost,
        trimsCost: sheet.trimsCost,
        threadConsumablesCost: sheet.threadConsumablesCost ?? 0,
        packingCost: sheet.packingCost ?? 0,
        printingEmbroideryCost: sheet.printingEmbroideryCost ?? 0,
        washingFinishingCost: sheet.washingFinishingCost ?? 0,
        otherDirectCost: sheet.otherDirectCost ?? 0,
        materialCostSubtotal: matSubtotal,
        valueAddedCostSubtotal: valAddedSubtotal,
        laborCmtCost: sheet.laborCmtCost,
        effectiveActualMinutes: effActualMin,
        overheadCost: sheet.overheadCost,
        totalManufacturingCost: sheet.totalCostPerGarment,
        quotedFobPrice: sheet.quotedFobPrice,
        commissionPercent: commPct,
        commissionAmount: commAmt,
        netRealizedFob: netFob,
        profitPerGarment: profit,
        grossMarginPercent: sheet.marginPercent,
        markupPercent: markup,
        lotQty: validLotQty,
        totalLotCost:
          validLotQty !== undefined ? sheet.totalCostPerGarment * validLotQty : undefined,
        totalLotRevenue:
          validLotQty !== undefined ? sheet.quotedFobPrice * validLotQty : undefined,
        totalLotNetRevenue: validLotQty !== undefined ? netFob * validLotQty : undefined,
        totalLotProfit: validLotQty !== undefined ? profit * validLotQty : undefined,
      };
    }

    const r = livePreview.result;
    if (!r) {
      return {
        isComplete: false,
        currency,
        lotQty: validLotQty,
      };
    }

    return {
      isComplete: true,
      currency: r.currency,
      fabricCost: r.fabricCost,
      trimsCost: r.trimsCost,
      threadConsumablesCost: r.threadConsumablesCost,
      packingCost: r.packingCost,
      printingEmbroideryCost: r.printingEmbroideryCost,
      washingFinishingCost: r.washingFinishingCost,
      otherDirectCost: r.otherDirectCost,
      materialCostSubtotal: r.materialCostSubtotal,
      valueAddedCostSubtotal: r.valueAddedCostSubtotal,
      laborCmtCost: r.laborCmtCost,
      effectiveActualMinutes: r.effectiveActualMinutes,
      overheadCost: r.overheadCost,
      totalManufacturingCost: r.totalManufacturingCost,
      quotedFobPrice: r.quotedFobPrice,
      commissionPercent: r.commissionPercent,
      commissionAmount: r.commissionAmount,
      netRealizedFob: r.netRealizedFob,
      profitPerGarment: r.profitPerGarment,
      grossMarginPercent: r.grossMarginPercent,
      markupPercent: r.markupPercent,
      lotQty: validLotQty,
      totalLotCost:
        validLotQty !== undefined
          ? r.exact.totalManufacturingCost * validLotQty
          : undefined,
      totalLotRevenue:
        validLotQty !== undefined ? r.exact.quotedFobPrice * validLotQty : undefined,
      totalLotNetRevenue:
        validLotQty !== undefined ? r.exact.netRealizedFob * validLotQty : undefined,
      totalLotProfit:
        validLotQty !== undefined ? r.exact.profitPerGarment * validLotQty : undefined,
    };
  }, [isReadOnly, sheet, livePreview.result, costingBasisQuantityStr, currency]);

  // Save Draft (create or update)
  const handleSaveDraft = async (): Promise<CostSheetEntity | null> => {
    setFormError(null);
    setStatusNotice(null);

    const { payload, validationError } = buildCalculationPayload();
    if (validationError || !payload) {
      setFormError(validationError || 'Complete all required costing inputs before saving.');
      return null;
    }

    const parsedBomVersion = selectedBomVersion ? Number(selectedBomVersion) : undefined;
    const parsedLotQty =
      costingBasisQuantityStr.trim() !== ''
        ? Number(costingBasisQuantityStr)
        : undefined;

    if (
      parsedLotQty !== undefined &&
      (!Number.isFinite(parsedLotQty) || parsedLotQty <= 0)
    ) {
      setFormError('Costing basis / lot quantity must be a positive number.');
      return null;
    }

    try {
      if (isNewMode) {
        if (!selectedStyleId) {
          setFormError('Please select a garment style.');
          return null;
        }
        const created = await onCreateCostSheet({
          styleId: selectedStyleId,
          orderId: selectedOrderId || undefined,
          buyerId: selectedOrder?.buyerId || selectedStyle?.buyerId,
          bomVersionRef: parsedBomVersion,
          costingBasisQuantity: parsedLotQty,
          currency: payload.currency,
          lineItems: payload.lineItems,
          categoryCosts: payload.categoryCosts,
          cmt: payload.cmt,
          overhead: payload.overhead,
          commissionPercent: payload.commissionPercent,
          pricingMode: payload.pricingMode,
          quotedFobPrice: payload.quotedFobPrice,
          targetMarginPercent: payload.targetMarginPercent,
          targetMarkupPercent: payload.targetMarkupPercent,
          isSimulated: false,
        });
        setHasUnsavedChanges(false);
        setStatusNotice(`Created draft cost sheet ${created.id} (v${created.version}).`);
        return created;
      } else if (sheet) {
        const updated = await onUpdateDraftCostSheet(sheet.id, {
          bomVersionRef: parsedBomVersion,
          costingBasisQuantity: parsedLotQty,
          currency: payload.currency,
          lineItems: payload.lineItems,
          categoryCosts: payload.categoryCosts,
          cmt: payload.cmt,
          overhead: payload.overhead,
          commissionPercent: payload.commissionPercent,
          pricingMode: payload.pricingMode,
          quotedFobPrice: payload.quotedFobPrice,
          targetMarginPercent: payload.targetMarginPercent,
          targetMarkupPercent: payload.targetMarkupPercent,
        });
        setHasUnsavedChanges(false);
        setStatusNotice(`Saved draft changes to ${updated.id} (v${updated.version}).`);
        return updated;
      }
      return null;
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save cost sheet.');
      return null;
    }
  };

  const handleSubmitDraftForApproval = async () => {
    setFormError(null);
    setStatusNotice(null);
    try {
      let targetSheet = sheet;
      if (isNewMode || hasUnsavedChanges) {
        targetSheet = await handleSaveDraft();
        if (!targetSheet) return;
      }
      if (!targetSheet) return;
      const submitted = await onSubmitForApproval(targetSheet.id);
      setStatusNotice(
        `Submitted ${submitted.id} (v${submitted.version}) for management approval.`
      );
    } catch (err: any) {
      setFormError(err?.message || 'Failed to submit cost sheet for approval.');
    }
  };

  const handleCreateNewRevision = async () => {
    if (!sheet) return;
    setFormError(null);
    setStatusNotice(null);
    try {
      const revision = await onCreateRevision(sheet.id);
      setStatusNotice(
        `Created new draft revision ${revision.id} (v${revision.version}) branched from v${sheet.version}.`
      );
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create revision.');
    }
  };

  const handleReopenRejected = async () => {
    if (!sheet) return;
    setFormError(null);
    setStatusNotice(null);
    try {
      const reopened = await onReopenRejectedCostSheet(sheet.id);
      setStatusNotice(`Reopened ${reopened.id} (v${reopened.version}) as DRAFT.`);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to reopen rejected cost sheet.');
    }
  };

  const hasExistingApprovedInContext = useMemo(() => {
    if (!sheet) return false;
    return versionHistory.some(
      (v) => v.id !== sheet.id && v.status === 'APPROVED'
    );
  }, [sheet, versionHistory]);

  const hasLegacyCategoryResiduals = useMemo(
    () => Object.values(categoryCosts).some((v) => typeof v === 'number' && v > 0),
    [categoryCosts]
  );

  const canSaveOrSubmit =
    !isReadOnly && !isMutating && missingRateLines.length === 0 && livePreview.result !== null;

  return (
    <div className="space-y-6" data-testid="cost-sheet-editor">
      {/* Top Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToOverview}
            data-testid="costing-back-to-overview-btn"
            className="mt-0.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>All Cost Sheets</span>
          </button>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-zinc-400">
              <span>{isNewMode ? 'New Draft Cost Sheet' : sheet.id}</span>
              <span aria-hidden="true">·</span>
              <span>{isNewMode ? 'vNext' : `v${sheet.version}`}</span>
              <span aria-hidden="true">·</span>
              <span className={`font-semibold ${getStatusTextClass(currentStatus)}`}>
                {currentStatus}
              </span>
              {selectedStyle && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-zinc-200">{selectedStyle.styleCode}</span>
                </>
              )}
              {selectedOrder && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-300">{selectedOrder.poNumber}</span>
                </>
              )}
              {isLegacySummarySheet && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-400">Legacy Summary Record</span>
                </>
              )}
            </div>
            <h2 className="text-lg font-bold text-zinc-100 tracking-tight truncate mt-0.5">
              {selectedStyle
                ? `${selectedStyle.styleCode} — ${selectedStyle.description}`
                : 'Select Style to Configure Costing'}
            </h2>
          </div>
        </div>

        {/* Workflow Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={!canSaveOrSubmit}
                data-testid="costing-save-draft-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isNewMode ? 'Create Draft' : 'Save Draft'}</span>
              </button>

              <button
                type="button"
                onClick={handleSubmitDraftForApproval}
                disabled={!canSaveOrSubmit}
                data-testid="costing-submit-approval-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Submit for Approval</span>
              </button>
            </>
          )}

          {!isNewMode && currentStatus === 'SUBMITTED' && (
            <>
              <button
                type="button"
                disabled={isMutating}
                data-testid="costing-open-approve-modal-btn"
                onClick={() => setWorkflowModal({ isOpen: true, mode: 'approve' })}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Approve</span>
              </button>

              <button
                type="button"
                disabled={isMutating}
                data-testid="costing-open-reject-modal-btn"
                onClick={() => setWorkflowModal({ isOpen: true, mode: 'reject' })}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Reject</span>
              </button>
            </>
          )}

          {!isNewMode && currentStatus === 'REJECTED' && (
            <button
              type="button"
              disabled={isMutating}
              data-testid="costing-reopen-draft-btn"
              onClick={handleReopenRejected}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reopen as Draft</span>
            </button>
          )}

          {!isNewMode && (
            <button
              type="button"
              disabled={isMutating}
              data-testid="costing-create-revision-btn"
              onClick={handleCreateNewRevision}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <GitBranch className="w-3.5 h-3.5 text-amber-400" />
              <span>Create Revision</span>
            </button>
          )}
        </div>
      </div>

      {/* Banners: Read-Only Lock, Legacy Notice, Errors, Success */}
      {isReadOnly && sheet && (
        <div
          data-testid="costing-readonly-banner"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-md bg-zinc-900 border border-zinc-800 text-xs"
        >
          <div className="flex items-start gap-2.5 text-zinc-300">
            <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-zinc-100">
                Read-Only Historical View ({currentStatus}).
              </span>{' '}
              {currentStatus === 'APPROVED' && (
                <span>
                  Approved by <strong className="text-zinc-100">{sheet.approvedBy || 'N/A'}</strong>
                  {sheet.approvedAt ? ` on ${formatDateShort(sheet.approvedAt)}` : ''}. Approved cost
                  sheets are immutable — use Create Revision to prepare a new draft version.
                </span>
              )}
              {currentStatus === 'SUPERSEDED' && (
                <span>
                  This version was superseded by a newer approved revision. Original approval by{' '}
                  <strong className="text-zinc-100">{sheet.approvedBy || 'N/A'}</strong> and all
                  financial snapshots remain preserved.
                </span>
              )}
              {currentStatus === 'SUBMITTED' && (
                <span>
                  Locked for management review. Approve, Reject, or branch a new revision.
                </span>
              )}
              {currentStatus === 'REJECTED' && (
                <span>
                  Rejected reason:{' '}
                  <strong className="text-rose-300">
                    {sheet.rejectionReason || 'No reason recorded'}
                  </strong>
                  . Reopen as Draft to edit, or create a new revision.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {isLegacySummarySheet && (
        <div
          data-testid="costing-legacy-banner"
          className="flex items-start gap-2.5 px-4 py-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200"
        >
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Legacy Summary-Only Cost Sheet:</span> This record
            stores category-level cost totals without itemized BOM line snapshots. It is preserved
            read-only without modification. Click <strong className="text-amber-100">Create Revision</strong>{' '}
            to branch a new BOM-backed draft version.
          </div>
        </div>
      )}

      {formError && (
        <div
          role="alert"
          data-testid="costing-editor-error"
          className="flex items-start gap-2.5 px-4 py-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{formError}</span>
        </div>
      )}

      {statusNotice && (
        <div
          data-testid="costing-editor-notice"
          className="flex items-start gap-2.5 px-4 py-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* Main 2-Column Enterprise Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 8 Columns: Context, BOM Import, Lines Table, CMT, Overheads, Pricing */}
        <div className="xl:col-span-8 space-y-6">
          {/* 1. Costing Context & BOM Source Configuration */}
          <section className="rounded-md bg-zinc-900 border border-zinc-800 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Cost Sheet Scope & BOM Source
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Link a garment style, optional purchase order for colour/size-weighted
                  consumption, and an explicit BOM version.
                </p>
              </div>
              {selectedBuyer && (
                <div className="text-xs font-mono text-zinc-400">
                  Buyer: <span className="text-zinc-200">{selectedBuyer.name}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Style Selector */}
              <div className="space-y-1">
                <label
                  htmlFor="costing-style-select"
                  className="block text-xs font-medium text-zinc-300"
                >
                  Garment Style <span className="text-rose-400">*</span>
                </label>
                <select
                  id="costing-style-select"
                  data-testid="costing-style-select"
                  value={selectedStyleId}
                  onChange={(e) => handleStyleChange(e.target.value)}
                  disabled={!isNewMode}
                  className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                >
                  <option value="">Select style...</option>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.styleCode} — {s.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Optional Linked Order */}
              <div className="space-y-1">
                <label
                  htmlFor="costing-order-select"
                  className="block text-xs font-medium text-zinc-300"
                >
                  Linked Order (Optional)
                </label>
                <select
                  id="costing-order-select"
                  data-testid="costing-order-select"
                  value={selectedOrderId}
                  onChange={(e) => handleOrderChange(e.target.value)}
                  disabled={!isNewMode || !selectedStyleId}
                  className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                >
                  <option value="">Style-Level Costing (No Linked Order)</option>
                  {linkedOrdersForStyle.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.poNumber} ({o.orderQuantity.toLocaleString()} pcs · {o.status})
                    </option>
                  ))}
                </select>
              </div>

              {/* Explicit BOM Version */}
              <div className="space-y-1">
                <label
                  htmlFor="costing-bom-version-select"
                  className="block text-xs font-medium text-zinc-300"
                >
                  Style BOM Version
                </label>
                <select
                  id="costing-bom-version-select"
                  data-testid="costing-bom-version-select"
                  value={selectedBomVersion}
                  onChange={(e) => {
                    setSelectedBomVersion(e.target.value);
                    setHasUnsavedChanges(true);
                  }}
                  disabled={isReadOnly || isLoadingBomVersions || !selectedStyleId}
                  className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                >
                  <option value="">
                    {isLoadingBomVersions
                      ? 'Loading BOM versions...'
                      : bomVersions.length === 0
                      ? 'No BOM versions found'
                      : 'Select BOM version...'}
                  </option>
                  {bomVersions.map((v) => (
                    <option key={v.bomVersion} value={String(v.bomVersion)}>
                      BOM v{v.bomVersion} ({v.activeItems} active
                      {v.archivedItems > 0 ? `, ${v.archivedItems} archived` : ''})
                    </option>
                  ))}
                </select>
              </div>

              {/* Currency */}
              <div className="space-y-1">
                <label
                  htmlFor="costing-currency-select"
                  className="block text-xs font-medium text-zinc-300"
                >
                  Costing Currency (ISO-4217)
                </label>
                <select
                  id="costing-currency-select"
                  data-testid="costing-currency-select"
                  value={currency}
                  onChange={(e) => handleCurrencyChange(e.target.value)}
                  disabled={isReadOnly}
                  className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-xs font-mono text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                >
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                  {!CURRENCY_OPTIONS.includes(currency) && (
                    <option value={currency}>{currency}</option>
                  )}
                </select>
              </div>

              {/* Lot / Costing Basis Quantity */}
              <div className="space-y-1">
                <label
                  htmlFor="costing-basis-qty-input"
                  className="block text-xs font-medium text-zinc-300"
                >
                  Lot / Basis Quantity (pcs)
                </label>
                <input
                  id="costing-basis-qty-input"
                  data-testid="costing-basis-qty-input"
                  type="number"
                  min="1"
                  step="1"
                  value={costingBasisQuantityStr}
                  onChange={(e) => {
                    setCostingBasisQuantityStr(e.target.value);
                    setHasUnsavedChanges(true);
                  }}
                  disabled={isReadOnly}
                  placeholder="Optional lot qty (e.g. 5000)"
                  className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                />
              </div>

              {/* BOM Import Action */}
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleImportBom}
                  disabled={isReadOnly || isImportingBom || !selectedStyleId}
                  data-testid="costing-import-bom-btn"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-amber-500/40 text-amber-300 hover:text-amber-200 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isImportingBom ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isImportingBom
                      ? 'Importing BOM...'
                      : lines.some((l) => l.sourceType === 'BOM_IMPORT')
                      ? 'Re-sync BOM Lines'
                      : 'Import BOM Components'}
                  </span>
                </button>
              </div>
            </div>

            {/* BOM Import Transparency Warnings */}
            {bomImportMeta &&
              (bomImportMeta.applicabilityWarnings.length > 0 ||
                bomImportMeta.skippedUnmatchedBomItems.length > 0 ||
                bomImportMeta.rateIssues.length > 0 ||
                bomImportMeta.usedOrderQuantityFallback ||
                bomImportMeta.archivedComponentsExcludedCount > 0) && (
                <div
                  data-testid="costing-bom-warnings"
                  className="space-y-2 pt-3 border-t border-zinc-800 text-xs"
                >
                  {bomImportMeta.rateIssues.length > 0 && (
                    <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Material Rate Attention Required ({bomImportMeta.rateIssues.length})
                        </span>
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-amber-200/90">
                        {bomImportMeta.rateIssues.map((issue) => (
                          <li key={issue.bomItemId}>{issue.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {bomImportMeta.applicabilityWarnings.length > 0 && (
                    <div className="p-3 rounded-md bg-sky-500/10 border border-sky-500/30 text-sky-200 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5 text-sky-300">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Style-Level Scope & Size-Override Limitations (
                          {bomImportMeta.applicabilityWarnings.length})
                        </span>
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-sky-200/90">
                        {bomImportMeta.applicabilityWarnings.map((w, idx) => (
                          <li key={`${w.bomItemId}-${w.type}-${idx}`}>{w.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {bomImportMeta.skippedUnmatchedBomItems.length > 0 && (
                    <div className="p-3 rounded-md bg-zinc-950 border border-zinc-700 text-zinc-300 space-y-1">
                      <div className="font-semibold text-zinc-200">
                        Unmatched BOM Items Excluded from Order Costing (
                        {bomImportMeta.skippedUnmatchedBomItems.length})
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-zinc-400">
                        {bomImportMeta.skippedUnmatchedBomItems.map((sk) => (
                          <li key={sk.bomItemId}>
                            <span className="font-mono text-zinc-200">{sk.materialCode}</span> (
                            {sk.placement}): {sk.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(bomImportMeta.usedOrderQuantityFallback ||
                    bomImportMeta.archivedComponentsExcludedCount > 0) && (
                    <div className="p-2.5 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 space-y-0.5">
                      {bomImportMeta.usedOrderQuantityFallback && (
                        <div>
                          Order has no colour/size matrix rows in order_items; fell back to
                          header orderQuantity for weighted consumption.
                        </div>
                      )}
                      {bomImportMeta.archivedComponentsExcludedCount > 0 && (
                        <div>
                          Excluded {bomImportMeta.archivedComponentsExcludedCount} ARCHIVED BOM
                          component(s) from BOM v{bomImportMeta.bomVersionUsed}.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
          </section>

          {/* 2. BOM & Direct Cost Lines Worksheet Table */}
          <section className="rounded-md bg-zinc-900 border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  BOM Material & Direct Cost Lines
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Consumption-driven lines use Style BOM quantities, wastage %, and UOM
                  conversions via costingCalculator. Add direct lines for printing, washing, or
                  special finishes.
                </p>
              </div>

              {!isReadOnly && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAddManualLine('PRINTING_EMBROIDERY')}
                    data-testid="add-line-printing-btn"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3 h-3 text-amber-400" />
                    <span>Print / Emb</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddManualLine('WASHING_FINISHING')}
                    data-testid="add-line-washing-btn"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3 h-3 text-amber-400" />
                    <span>Wash / Finish</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddManualLine('OTHER')}
                    data-testid="add-line-other-btn"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3 h-3 text-amber-400" />
                    <span>Other Direct</span>
                  </button>
                </div>
              )}
            </div>

            {lines.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <FileSpreadsheet className="w-7 h-7 text-zinc-600 mx-auto" />
                <div className="text-xs font-medium text-zinc-300">
                  {isLegacySummarySheet
                    ? 'Legacy Summary Cost Sheet (No Itemized BOM Lines)'
                    : 'No cost lines added yet'}
                </div>
                <p className="text-xs text-zinc-500 max-w-md mx-auto">
                  {isLegacySummarySheet
                    ? 'Category totals for this historical record are displayed in the summary panel.'
                    : 'Click "Import BOM Components" above to pull active materials from the selected BOM version, or add direct processing cost lines.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] font-mono text-zinc-400">
                      <th className="py-2.5 px-3 font-medium">Component / Material</th>
                      <th className="py-2.5 px-3 font-medium">Category</th>
                      <th className="py-2.5 px-3 font-medium text-right">Consumption & UOM</th>
                      <th className="py-2.5 px-3 font-medium text-right">Wastage %</th>
                      <th className="py-2.5 px-3 font-medium text-right">
                        Unit Rate ({currency})
                      </th>
                      <th className="py-2.5 px-3 font-medium">Rate Source</th>
                      <th className="py-2.5 px-3 font-medium text-right">
                        Cost / Pc ({currency})
                      </th>
                      {!isReadOnly && <th className="py-2.5 px-2 font-medium w-8"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70 text-xs">
                    {lines.map((line) => {
                      const isConsumptionDriven = line.consumptionPerGarment !== undefined;
                      const rateStatus = deriveLineRateStatus(line, currency);
                      const isMissingRate =
                        rateStatus === 'MISSING_MASTER_RATE' ||
                        rateStatus === 'CURRENCY_MISMATCH';
                      const lineCost = calculatedLineCostById.get(line.id);
                      const mat = line.materialId ? materialMap.get(line.materialId) : undefined;
                      const canResetToMaster =
                        !isReadOnly &&
                        line.isRateOverridden &&
                        line.masterUnitCostSnapshot !== undefined &&
                        line.masterCostCurrencySnapshot === currency;

                      return (
                        <tr
                          key={line.id}
                          data-testid={`cost-line-row-${line.id}`}
                          className={`hover:bg-zinc-800/30 transition-colors ${
                            isMissingRate ? 'bg-amber-500/5' : ''
                          }`}
                        >
                          {/* Component / Material */}
                          <td className="py-2.5 px-3 align-top min-w-[200px]">
                            {isReadOnly || isConsumptionDriven ? (
                              <div>
                                <div className="font-medium text-zinc-100">
                                  {line.description}
                                </div>
                                <div className="text-[11px] font-mono text-zinc-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                                  {(line.materialCode || mat?.materialCode) && (
                                    <span className="text-amber-300/90">
                                      {line.materialCode || mat?.materialCode}
                                    </span>
                                  )}
                                  {line.bomItemId && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>BOM: {line.bomItemId}</span>
                                    </>
                                  )}
                                  {line.isWeightedByOrder && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-sky-400">
                                        Order-weighted ({line.orderMatchedGarmentPieces}/
                                        {line.orderTotalGarmentPieces} pcs)
                                      </span>
                                    </>
                                  )}
                                </div>
                                {line.conversionFormula && (
                                  <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                                    UOM: {line.conversionFormula}
                                  </div>
                                )}
                                {line.notes && (
                                  <div className="text-[10px] text-zinc-400 mt-0.5">
                                    {line.notes}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={line.description}
                                onChange={(e) =>
                                  handleUpdateLineField(line.id, {
                                    description: e.target.value,
                                  })
                                }
                                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                              />
                            )}
                          </td>

                          {/* Category */}
                          <td className="py-2.5 px-3 align-top whitespace-nowrap">
                            {isReadOnly || isConsumptionDriven ? (
                              <span className="text-zinc-300">
                                {CATEGORY_LABELS[line.category]}
                              </span>
                            ) : (
                              <select
                                value={line.category}
                                onChange={(e) =>
                                  handleUpdateLineField(line.id, {
                                    category: e.target.value as CostSheetLineCategory,
                                  })
                                }
                                className="px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                              >
                                {ALL_CATEGORIES.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {CATEGORY_LABELS[cat]}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* Consumption & UOM */}
                          <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                            {isConsumptionDriven ? (
                              isReadOnly ? (
                                <div>
                                  <div className="text-zinc-100">
                                    {line.consumptionPerGarment?.toFixed(4)}{' '}
                                    {line.consumptionUnit || line.stockUnit}
                                  </div>
                                  <div className="text-[10px] text-zinc-400">
                                    {line.consumptionBasis === 'PER_DOZEN'
                                      ? 'Per Dozen'
                                      : 'Per Piece'}
                                    {line.stockUnit &&
                                    line.consumptionUnit &&
                                    line.stockUnit !== line.consumptionUnit
                                      ? ` → ${line.stockUnit}`
                                      : ''}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col items-end gap-1">
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      min="0.0001"
                                      step="any"
                                      aria-label={`Consumption for ${line.description}`}
                                      value={line.consumptionPerGarment ?? ''}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        if (Number.isFinite(val) && val > 0) {
                                          handleUpdateLineField(line.id, {
                                            consumptionPerGarment: val,
                                          });
                                        }
                                      }}
                                      className="w-20 px-1.5 py-1 rounded bg-zinc-950 border border-zinc-700 text-right text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                                    />
                                    <select
                                      aria-label={`Consumption unit for ${line.description}`}
                                      value={line.consumptionUnit || line.stockUnit || 'pcs'}
                                      onChange={(e) =>
                                        handleUpdateLineField(line.id, {
                                          consumptionUnit: e.target.value as ConsumptionUnit,
                                        })
                                      }
                                      className="px-1 py-1 rounded bg-zinc-950 border border-zinc-700 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-500"
                                    >
                                      {CONSUMPTION_UNITS.map((u) => (
                                        <option key={u} value={u}>
                                          {u}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                                    <select
                                      aria-label={`Consumption basis for ${line.description}`}
                                      value={line.consumptionBasis || 'PER_PIECE'}
                                      onChange={(e) =>
                                        handleUpdateLineField(line.id, {
                                          consumptionBasis: e.target
                                            .value as ConsumptionBasis,
                                        })
                                      }
                                      className="bg-transparent text-zinc-400 focus:outline-none"
                                    >
                                      <option value="PER_PIECE" className="bg-zinc-900">
                                        Per Piece
                                      </option>
                                      <option value="PER_DOZEN" className="bg-zinc-900">
                                        Per Dozen
                                      </option>
                                    </select>
                                    {line.stockUnit && (
                                      <span>/ stock: {line.stockUnit}</span>
                                    )}
                                  </div>
                                </div>
                              )
                            ) : (
                              <span className="text-zinc-500">Direct / Pc</span>
                            )}
                          </td>

                          {/* Wastage % */}
                          <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                            {isConsumptionDriven ? (
                              isReadOnly ? (
                                <span className="text-zinc-300">
                                  {(line.wastagePercent ?? 0).toFixed(2)}%
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  aria-label={`Wastage percent for ${line.description}`}
                                  value={line.wastagePercent ?? 0}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    if (Number.isFinite(val) && val >= 0) {
                                      handleUpdateLineField(line.id, {
                                        wastagePercent: val,
                                      });
                                    }
                                  }}
                                  className="w-16 px-1.5 py-1 rounded bg-zinc-950 border border-zinc-700 text-right text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                                />
                              )
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>

                          {/* Unit Rate */}
                          <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                            {isReadOnly ? (
                              <div className="text-zinc-100">
                                {line.unitPrice !== undefined
                                  ? line.unitPrice.toFixed(4)
                                  : '—'}
                                {line.stockUnit && (
                                  <span className="text-[10px] text-zinc-500 ml-1">
                                    /{line.stockUnit}
                                  </span>
                                )}
                              </div>
                            ) : isConsumptionDriven ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  data-testid={`line-rate-input-${line.id}`}
                                  aria-label={`Unit rate for ${line.description}`}
                                  placeholder="Enter rate"
                                  value={
                                    line.unitPrice !== undefined ? line.unitPrice : ''
                                  }
                                  onChange={(e) =>
                                    handleUpdateLineRate(line.id, e.target.value)
                                  }
                                  className={`w-24 px-2 py-1 rounded bg-zinc-950 border text-right text-xs focus:outline-none ${
                                    isMissingRate
                                      ? 'border-amber-500 text-amber-200 placeholder:text-amber-400/70'
                                      : 'border-zinc-700 text-zinc-100 focus:border-amber-500'
                                  }`}
                                />
                                {line.stockUnit && (
                                  <span className="text-[10px] text-zinc-500">
                                    per {line.stockUnit}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                data-testid={`line-direct-cost-input-${line.id}`}
                                aria-label={`Direct cost per garment for ${line.description}`}
                                value={line.costPerGarment ?? 0}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  if (Number.isFinite(val) && val >= 0) {
                                    handleUpdateLineField(line.id, {
                                      costPerGarment: val,
                                      unitPrice: val,
                                    });
                                  }
                                }}
                                className="w-24 px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-right text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                              />
                            )}
                          </td>

                          {/* Rate Source & Snapshot Distinction */}
                          <td className="py-2.5 px-3 align-top min-w-[140px]">
                            {!isConsumptionDriven ? (
                              <span className="text-zinc-400 text-[11px]">Manual Direct</span>
                            ) : rateStatus === 'MATCHED_MASTER_RATE' ? (
                              <div className="space-y-0.5">
                                <div className="text-emerald-400 font-medium text-[11px]">
                                  Master Rate
                                </div>
                                <div className="text-[10px] font-mono text-zinc-500 tabular-nums">
                                  Snapshot: {line.masterCostCurrencySnapshot}{' '}
                                  {line.masterUnitCostSnapshot?.toFixed(4)}
                                </div>
                              </div>
                            ) : rateStatus === 'MANUAL_OVERRIDE' ? (
                              <div className="space-y-0.5">
                                <div className="text-amber-400 font-medium text-[11px]">
                                  {line.masterUnitCostSnapshot !== undefined
                                    ? 'Manual Override'
                                    : 'Manual Rate'}
                                </div>
                                {line.masterUnitCostSnapshot !== undefined && (
                                  <div className="text-[10px] font-mono text-zinc-500 tabular-nums">
                                    Master: {line.masterCostCurrencySnapshot || 'N/A'}{' '}
                                    {line.masterUnitCostSnapshot.toFixed(4)}
                                  </div>
                                )}
                                {canResetToMaster && (
                                  <button
                                    type="button"
                                    onClick={() => handleResetLineToMasterRate(line.id)}
                                    className="text-[10px] text-sky-400 hover:text-sky-300 underline"
                                  >
                                    Reset to Master
                                  </button>
                                )}
                              </div>
                            ) : rateStatus === 'CURRENCY_MISMATCH' ? (
                              <div className="space-y-0.5">
                                <div className="text-rose-400 font-medium text-[11px]">
                                  Currency Mismatch
                                </div>
                                <div className="text-[10px] font-mono text-zinc-400 tabular-nums">
                                  Master: {line.masterCostCurrencySnapshot}{' '}
                                  {line.masterUnitCostSnapshot?.toFixed(4)}
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <div className="text-amber-400 font-medium text-[11px]">
                                  Missing Master Rate
                                </div>
                                <div className="text-[10px] text-zinc-500">
                                  Manual rate required
                                </div>
                              </div>
                            )}
                          </td>

                          {/* Calculated Cost / Pc */}
                          <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums whitespace-nowrap font-semibold text-zinc-100">
                            {lineCost !== undefined ? lineCost.toFixed(4) : '—'}
                          </td>

                          {/* Remove Action */}
                          {!isReadOnly && (
                            <td className="py-2.5 px-2 align-top text-right">
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(line.id)}
                                title="Remove cost line"
                                aria-label={`Remove ${line.description}`}
                                className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Legacy Category-Level Residual Notice (when editing a draft branched from legacy summary) */}
            {!isReadOnly && hasLegacyCategoryResiduals && (
              <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="text-zinc-400">
                  <span className="text-amber-300 font-medium">
                    Legacy Summary Category Costs Active:
                  </span>{' '}
                  {Object.entries(categoryCosts)
                    .filter(([, val]) => typeof val === 'number' && val > 0)
                    .map(([cat, val]) => `${CATEGORY_LABELS[cat as CostSheetLineCategory]}: ${currency} ${val}`)
                    .join(' · ')}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCategoryCosts({});
                    setHasUnsavedChanges(true);
                  }}
                  className="text-xs text-rose-400 hover:text-rose-300 underline whitespace-nowrap"
                >
                  Clear Summary Residuals
                </button>
              </div>
            )}
          </section>

          {/* 3. Labour/CMT, Overheads & Pricing Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* CMT & Overheads Card */}
            <section className="rounded-md bg-zinc-900 border border-zinc-800 p-4 space-y-5">
              {/* CMT Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-800">
                  <h3 className="text-sm font-semibold text-zinc-100">Labour / CMT</h3>
                  <div className="inline-flex rounded bg-zinc-950 p-0.5 border border-zinc-800">
                    <button
                      type="button"
                      disabled={isReadOnly}
                      data-testid="cmt-mode-sam-btn"
                      onClick={() => {
                        setCmtMethod('SAM_RATE');
                        setHasUnsavedChanges(true);
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                        cmtMethod === 'SAM_RATE'
                          ? 'bg-zinc-800 text-amber-300'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      SAM × Rate
                    </button>
                    <button
                      type="button"
                      disabled={isReadOnly}
                      data-testid="cmt-mode-direct-btn"
                      onClick={() => {
                        setCmtMethod('DIRECT_CMT');
                        setHasUnsavedChanges(true);
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                        cmtMethod === 'DIRECT_CMT'
                          ? 'bg-zinc-800 text-amber-300'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Direct CMT
                    </button>
                  </div>
                </div>

                {cmtMethod === 'SAM_RATE' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label
                        htmlFor="costing-sam-input"
                        className="block text-[11px] text-zinc-400"
                      >
                        SAM (Minutes)
                      </label>
                      <input
                        id="costing-sam-input"
                        data-testid="costing-sam-input"
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={samMinutesStr}
                        onChange={(e) => {
                          setSamMinutesStr(e.target.value);
                          setHasUnsavedChanges(true);
                        }}
                        disabled={isReadOnly}
                        className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="costing-eff-input"
                        className="block text-[11px] text-zinc-400"
                      >
                        Efficiency (%)
                      </label>
                      <input
                        id="costing-eff-input"
                        data-testid="costing-eff-input"
                        type="number"
                        min="1"
                        max="200"
                        step="0.5"
                        value={efficiencyStr}
                        onChange={(e) => {
                          setEfficiencyStr(e.target.value);
                          setHasUnsavedChanges(true);
                        }}
                        disabled={isReadOnly}
                        className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="costing-cm-rate-input"
                        className="block text-[11px] text-zinc-400"
                      >
                        CM Rate / Min ({currency})
                      </label>
                      <input
                        id="costing-cm-rate-input"
                        data-testid="costing-cm-rate-input"
                        type="number"
                        min="0"
                        step="0.005"
                        value={cmRateStr}
                        onChange={(e) => {
                          setCmRateStr(e.target.value);
                          setHasUnsavedChanges(true);
                        }}
                        disabled={isReadOnly}
                        className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="costing-cm-basis-select"
                        className="block text-[11px] text-zinc-400"
                      >
                        Rate Basis
                      </label>
                      <select
                        id="costing-cm-basis-select"
                        data-testid="costing-cm-basis-select"
                        value={cmRateBasis}
                        onChange={(e) => {
                          setCmRateBasis(e.target.value as CmRateBasis);
                          setHasUnsavedChanges(true);
                        }}
                        disabled={isReadOnly}
                        className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                      >
                        <option value="ACTUAL_MINUTE">Actual Minute (SAM / Eff)</option>
                        <option value="STANDARD_MINUTE">Standard Minute (SAM × Rate)</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label
                      htmlFor="costing-direct-cmt-input"
                      className="block text-[11px] text-zinc-400"
                    >
                      Direct CMT Cost per Piece ({currency})
                    </label>
                    <input
                      id="costing-direct-cmt-input"
                      data-testid="costing-direct-cmt-input"
                      type="number"
                      min="0"
                      step="0.05"
                      value={directCmtStr}
                      onChange={(e) => {
                        setDirectCmtStr(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      disabled={isReadOnly}
                      className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                    />
                  </div>
                )}
              </div>

              {/* Overheads Section */}
              <div className="space-y-3 pt-3 border-t border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-100">Factory Overheads</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="costing-overhead-method-select"
                      className="block text-[11px] text-zinc-400"
                    >
                      Allocation Method
                    </label>
                    <select
                      id="costing-overhead-method-select"
                      data-testid="costing-overhead-method-select"
                      value={overheadMethod}
                      onChange={(e) => {
                        setOverheadMethod(e.target.value as OverheadCalculationMethod);
                        setHasUnsavedChanges(true);
                      }}
                      disabled={isReadOnly}
                      className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                    >
                      <option value="FIXED_PER_GARMENT">Fixed / Garment ({currency})</option>
                      <option value="PERCENT_OF_CMT">% of Labour / CMT</option>
                      <option value="PERCENT_OF_DIRECT_COST">% of Direct Cost</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="costing-overhead-value-input"
                      className="block text-[11px] text-zinc-400"
                    >
                      {overheadMethod === 'FIXED_PER_GARMENT'
                        ? `Overhead Amount (${currency})`
                        : 'Overhead Percentage (%)'}
                    </label>
                    <input
                      id="costing-overhead-value-input"
                      data-testid="costing-overhead-value-input"
                      type="number"
                      min="0"
                      step="0.05"
                      value={overheadValueStr}
                      onChange={(e) => {
                        setOverheadValueStr(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      disabled={isReadOnly}
                      className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Pricing, Commission & Margin/Markup Mode Card */}
            <section className="rounded-md bg-zinc-900 border border-zinc-800 p-4 space-y-4">
              <div className="pb-2 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-100">
                  FOB Pricing & Commission
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Gross Margin = Profit / Quoted FOB · Markup = Profit / Total Mfg Cost
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] text-zinc-400">Pricing Mode</label>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded bg-zinc-950 border border-zinc-800">
                  {(
                    [
                      { id: 'FOB_TO_MARGIN', label: 'FOB → Margin' },
                      { id: 'MARGIN_TO_FOB', label: 'Margin → FOB' },
                      { id: 'MARKUP_TO_FOB', label: 'Markup → FOB' },
                    ] as Array<{ id: CostPricingMode; label: string }>
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={isReadOnly}
                      data-testid={`pricing-mode-${m.id}`}
                      onClick={() => {
                        setPricingMode(m.id);
                        setHasUnsavedChanges(true);
                      }}
                      className={`px-2 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                        pricingMode === m.id
                          ? 'bg-zinc-800 text-amber-300'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {pricingMode === 'FOB_TO_MARGIN' && (
                  <div className="space-y-1">
                    <label
                      htmlFor="costing-quoted-fob-input"
                      className="block text-[11px] text-zinc-400"
                    >
                      Quoted FOB Price ({currency})
                    </label>
                    <input
                      id="costing-quoted-fob-input"
                      data-testid="costing-quoted-fob-input"
                      type="number"
                      min="0.01"
                      step="0.05"
                      value={quotedFobStr}
                      onChange={(e) => {
                        setQuotedFobStr(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      disabled={isReadOnly}
                      className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                    />
                  </div>
                )}

                {pricingMode === 'MARGIN_TO_FOB' && (
                  <div className="space-y-1">
                    <label
                      htmlFor="costing-target-margin-input"
                      className="block text-[11px] text-zinc-400"
                    >
                      Target Gross Margin (% of FOB)
                    </label>
                    <input
                      id="costing-target-margin-input"
                      data-testid="costing-target-margin-input"
                      type="number"
                      min="0"
                      max="99.9"
                      step="0.5"
                      value={targetMarginStr}
                      onChange={(e) => {
                        setTargetMarginStr(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      disabled={isReadOnly}
                      className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                    />
                  </div>
                )}

                {pricingMode === 'MARKUP_TO_FOB' && (
                  <div className="space-y-1">
                    <label
                      htmlFor="costing-target-markup-input"
                      className="block text-[11px] text-zinc-400"
                    >
                      Target Markup (% of Mfg Cost)
                    </label>
                    <input
                      id="costing-target-markup-input"
                      data-testid="costing-target-markup-input"
                      type="number"
                      min="0"
                      step="0.5"
                      value={targetMarkupStr}
                      onChange={(e) => {
                        setTargetMarkupStr(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      disabled={isReadOnly}
                      className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label
                    htmlFor="costing-commission-input"
                    className="block text-[11px] text-zinc-400"
                  >
                    Buying / Agent Commission (% on FOB)
                  </label>
                  <input
                    id="costing-commission-input"
                    data-testid="costing-commission-input"
                    type="number"
                    min="0"
                    max="99.9"
                    step="0.5"
                    value={commissionStr}
                    onChange={(e) => {
                      setCommissionStr(e.target.value);
                      setHasUnsavedChanges(true);
                    }}
                    disabled={isReadOnly}
                    className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="p-3 rounded bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
                <div className="font-medium text-zinc-300">Active Pricing Formula</div>
                {pricingMode === 'FOB_TO_MARGIN' && (
                  <div>
                    Net FOB = Quoted FOB × (1 − Commission%) · Profit = Net FOB − Total Cost
                  </div>
                )}
                {pricingMode === 'MARGIN_TO_FOB' && (
                  <div>
                    Quoted FOB = Total Cost ÷ (1 − (Target Gross Margin% + Commission%))
                  </div>
                )}
                {pricingMode === 'MARKUP_TO_FOB' && (
                  <div>
                    Quoted FOB = (Total Cost × (1 + Target Markup%)) ÷ (1 − Commission%)
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* Right 4 Columns: Live Cost Summary & Version History */}
        <div className="xl:col-span-4 space-y-6">
          {/* Cost Summary Panel */}
          <section
            data-testid="costing-summary-panel"
            className="rounded-md bg-zinc-900 border border-zinc-800 p-4 space-y-4"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-zinc-800">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Cost Summary</h3>
                <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                  Currency: <span className="text-zinc-200">{summaryDisplay.currency}</span>
                  {' · '}
                  <span>{isReadOnly ? `Locked (${currentStatus})` : 'Draft Preview'}</span>
                </div>
              </div>
              <Layers className="w-4 h-4 text-amber-400 shrink-0" />
            </div>

            {!summaryDisplay.isComplete ? (
              <div
                data-testid="costing-incomplete-summary"
                className="p-3.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1.5"
              >
                <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Incomplete Calculation — Not a Final Quotation</span>
                </div>
                <p className="text-[11px] text-amber-200/90">
                  {livePreview.error ||
                    'Complete missing material rates and costing inputs to compute per-piece cost and FOB quotation.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Per-Garment Breakdown */}
                <div className="space-y-1.5 text-xs font-mono tabular-nums">
                  <div className="text-[11px] font-sans font-semibold text-zinc-400 pb-1">
                    Per-Garment Cost Breakdown
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Fabric</span>
                    <span>{formatMoney(summaryDisplay.fabricCost, summaryDisplay.currency)}</span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Trims & Fasteners</span>
                    <span>{formatMoney(summaryDisplay.trimsCost, summaryDisplay.currency)}</span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Thread & Consumables</span>
                    <span>
                      {formatMoney(
                        summaryDisplay.threadConsumablesCost,
                        summaryDisplay.currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Packing</span>
                    <span>{formatMoney(summaryDisplay.packingCost, summaryDisplay.currency)}</span>
                  </div>
                  <div className="flex justify-between text-zinc-100 font-semibold pt-1.5 border-t border-zinc-800/80">
                    <span>Material Cost Subtotal</span>
                    <span data-testid="summary-material-subtotal">
                      {formatMoney(
                        summaryDisplay.materialCostSubtotal,
                        summaryDisplay.currency
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between text-zinc-300 pt-1">
                    <span>Printing & Embroidery</span>
                    <span>
                      {formatMoney(
                        summaryDisplay.printingEmbroideryCost,
                        summaryDisplay.currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Washing & Finishing</span>
                    <span>
                      {formatMoney(
                        summaryDisplay.washingFinishingCost,
                        summaryDisplay.currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Other Direct Cost</span>
                    <span>
                      {formatMoney(summaryDisplay.otherDirectCost, summaryDisplay.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>
                      Labour / CMT
                      {summaryDisplay.effectiveActualMinutes !== undefined
                        ? ` (${summaryDisplay.effectiveActualMinutes.toFixed(2)} act. min)`
                        : ''}
                    </span>
                    <span data-testid="summary-cmt-cost">
                      {formatMoney(summaryDisplay.laborCmtCost, summaryDisplay.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Factory Overhead</span>
                    <span data-testid="summary-overhead-cost">
                      {formatMoney(summaryDisplay.overheadCost, summaryDisplay.currency)}
                    </span>
                  </div>

                  <div className="flex justify-between text-sm font-bold text-white pt-2 mt-1 border-t border-zinc-700">
                    <span>Total Cost / Piece</span>
                    <span data-testid="summary-total-cost">
                      {formatMoney(
                        summaryDisplay.totalManufacturingCost,
                        summaryDisplay.currency
                      )}
                    </span>
                  </div>
                </div>

                {/* Quotation, Commission & Profitability */}
                <div className="p-3 rounded-md bg-zinc-950 border border-zinc-800 space-y-2 text-xs font-mono tabular-nums">
                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-300 font-sans font-medium">
                      Quoted FOB / Piece
                    </span>
                    <span
                      data-testid="summary-quoted-fob"
                      className="text-base font-bold text-amber-300"
                    >
                      {formatMoney(summaryDisplay.quotedFobPrice, summaryDisplay.currency)}
                    </span>
                  </div>

                  {(summaryDisplay.commissionPercent ?? 0) > 0 && (
                    <>
                      <div className="flex justify-between text-zinc-400">
                        <span>Commission ({summaryDisplay.commissionPercent?.toFixed(2)}%)</span>
                        <span>
                          -{formatMoney(summaryDisplay.commissionAmount, summaryDisplay.currency)}
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-300">
                        <span>Net Realized FOB</span>
                        <span>
                          {formatMoney(summaryDisplay.netRealizedFob, summaryDisplay.currency)}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="flex justify-between text-zinc-200 pt-1.5 border-t border-zinc-800">
                    <span>Profit / Piece</span>
                    <span
                      data-testid="summary-profit-piece"
                      className={
                        (summaryDisplay.profitPerGarment ?? 0) >= 0
                          ? 'text-emerald-400 font-semibold'
                          : 'text-rose-400 font-semibold'
                      }
                    >
                      {formatMoney(summaryDisplay.profitPerGarment, summaryDisplay.currency)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-zinc-800">
                    <div>
                      <div className="text-[10px] font-sans text-zinc-400">
                        Gross Margin (% of FOB)
                      </div>
                      <div
                        data-testid="summary-gross-margin"
                        className={`text-sm font-bold ${
                          (summaryDisplay.grossMarginPercent ?? 0) >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {summaryDisplay.grossMarginPercent?.toFixed(2)}%
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-sans text-zinc-400">
                        Markup (% of Cost)
                      </div>
                      <div
                        data-testid="summary-markup-percent"
                        className="text-sm font-bold text-zinc-200"
                      >
                        {summaryDisplay.markupPercent?.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Lot / Batch Totals (when costingBasisQuantity is configured) */}
                {summaryDisplay.lotQty !== undefined && (
                  <div
                    data-testid="summary-lot-totals"
                    className="p-3 rounded-md bg-zinc-950 border border-zinc-800 space-y-1.5 text-xs font-mono tabular-nums"
                  >
                    <div className="flex items-center justify-between font-sans pb-1 border-b border-zinc-800">
                      <span className="font-semibold text-zinc-200">Lot / Batch Totals</span>
                      <span className="font-mono text-zinc-400">
                        {summaryDisplay.lotQty.toLocaleString()} pcs
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-300">
                      <span>Total Lot Mfg Cost</span>
                      <span data-testid="summary-lot-cost">
                        {formatMoney(summaryDisplay.totalLotCost, summaryDisplay.currency, 2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-amber-300 font-semibold">
                      <span>Total Quoted Revenue</span>
                      <span data-testid="summary-lot-revenue">
                        {formatMoney(summaryDisplay.totalLotRevenue, summaryDisplay.currency, 2)}
                      </span>
                    </div>
                    {(summaryDisplay.commissionPercent ?? 0) > 0 && (
                      <div className="flex justify-between text-zinc-300">
                        <span>Total Net Revenue</span>
                        <span>
                          {formatMoney(
                            summaryDisplay.totalLotNetRevenue,
                            summaryDisplay.currency,
                            2
                          )}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-emerald-400 font-semibold">
                      <span>Projected Lot Profit</span>
                      <span data-testid="summary-lot-profit">
                        {formatMoney(summaryDisplay.totalLotProfit, summaryDisplay.currency, 2)}
                      </span>
                    </div>
                  </div>
                )}

                {!isReadOnly && (
                  <div className="text-[11px] text-zinc-500">
                    Draft preview calculated live. Submit and approve to issue a locked
                    quotation.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Cost Sheet Revision History Panel */}
          {!isNewMode && (
            <section
              data-testid="costing-version-history"
              className="rounded-md bg-zinc-900 border border-zinc-800 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Version History ({versionHistory.length})
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-zinc-500">
                  {sheet?.orderId ? 'Order Scope' : 'Style Scope'}
                </span>
              </div>

              {versionHistory.length === 0 ? (
                <div className="text-xs text-zinc-500">No saved revisions yet.</div>
              ) : (
                <div className="space-y-2">
                  {[...versionHistory]
                    .sort((a, b) => b.version - a.version)
                    .map((ver) => {
                      const isCurrent = sheet?.id === ver.id;
                      const verStatus = ver.status ?? 'DRAFT';
                      return (
                        <button
                          key={ver.id}
                          type="button"
                          data-testid={`version-history-item-${ver.id}`}
                          onClick={() => onSelectVersion(ver)}
                          className={`w-full text-left p-2.5 rounded-md border transition-colors ${
                            isCurrent
                              ? 'bg-zinc-800/90 border-amber-500/50'
                              : 'bg-zinc-950/60 border-zinc-800 hover:bg-zinc-800/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs font-mono">
                            <span className="font-semibold text-zinc-100">
                              v{ver.version} · {ver.id}
                            </span>
                            <span className={`font-semibold ${getStatusTextClass(verStatus)}`}>
                              {verStatus}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-zinc-400 mt-1">
                            <span>
                              Cost: {ver.currency} {ver.totalCostPerGarment.toFixed(4)}
                            </span>
                            <span className="text-amber-300">
                              FOB: {ver.currency} {ver.quotedFobPrice.toFixed(4)}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-1 flex flex-wrap items-center gap-1.5">
                            <span>{formatDateShort(ver.approvedAt || ver.updatedAt || ver.createdAt)}</span>
                            {ver.bomVersionRef && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>BOM v{ver.bomVersionRef}</span>
                              </>
                            )}
                            {ver.approvedBy && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>By {ver.approvedBy}</span>
                              </>
                            )}
                            {ver.parentCostSheetId && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>From {ver.parentCostSheetId}</span>
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Inline Workflow Modal (Approve / Reject) */}
      <CostSheetWorkflowModal
        isOpen={workflowModal.isOpen}
        mode={workflowModal.mode}
        costSheet={sheet}
        styleCode={selectedStyle?.styleCode}
        poNumber={selectedOrder?.poNumber}
        hasExistingApprovedVersion={hasExistingApprovedInContext}
        isSubmitting={isMutating}
        onClose={() => setWorkflowModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirmApprove={async (approvedBy) => {
          if (!sheet) return;
          const res = await onApproveCostSheet(sheet.id, approvedBy);
          setWorkflowModal((prev) => ({ ...prev, isOpen: false }));
          const supMsg =
            res.superseded.length > 0
              ? ` Superseded ${res.superseded.map((s) => `v${s.version}`).join(', ')}.`
              : '';
          setStatusNotice(
            `Approved ${res.approved.id} (v${res.approved.version}) by ${res.approved.approvedBy}.${supMsg}`
          );
        }}
        onConfirmReject={async (rejectionReason) => {
          if (!sheet) return;
          const rejected = await onRejectCostSheet(sheet.id, rejectionReason);
          setWorkflowModal((prev) => ({ ...prev, isOpen: false }));
          setStatusNotice(
            `Rejected ${rejected.id} (v${rejected.version}). Reason recorded.`
          );
        }}
      />
    </div>
  );
};
