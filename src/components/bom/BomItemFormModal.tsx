import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  ArrowRight,
  Info,
} from 'lucide-react';
import {
  BomComponentCategory,
  BomDimensionScope,
  BomItemEntity,
  ConsumptionBasis,
  ConsumptionUnit,
  MaterialEntity,
  StyleEntity,
} from '../../db/types';
import {
  canConvertUom,
  getUomConversionFactor,
  roundUomDisplay,
} from '../../db/services/uomConverter';

export interface BomItemSavePayload {
  mode: 'create' | 'edit';
  id?: string;
  data: Omit<BomItemEntity, 'id' | 'createdAt' | 'updatedAt' | 'isSimulated'>;
}

interface BomItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  style: StyleEntity | null;
  defaultVersion: number;
  materials: MaterialEntity[];
  itemToEdit: BomItemEntity | null;
  onSave: (payload: BomItemSavePayload) => Promise<void>;
}

interface SizeOverrideRow {
  id: string;
  size: string;
  consumption: string;
}

const ALL_CONSUMPTION_UNITS: ConsumptionUnit[] = [
  'kg',
  'meters',
  'yards',
  'pcs',
  'dozens',
  'gross',
  'cones',
  'rolls',
];

const COMPONENT_CATEGORIES: Array<{ value: BomComponentCategory; label: string }> = [
  { value: 'FABRIC', label: 'Fabric' },
  { value: 'TRIM', label: 'Trim & Fastener' },
  { value: 'THREAD', label: 'Thread & Notion' },
  { value: 'PACKAGING', label: 'Packaging' },
  { value: 'LABEL', label: 'Label & Tag' },
];

const QUICK_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36'];

function inferCategoryFromMaterial(material?: MaterialEntity): BomComponentCategory {
  if (!material) return 'FABRIC';
  switch (material.category) {
    case 'Knitted Fabric':
    case 'Woven Fabric':
      return 'FABRIC';
    case 'Trims & Fasteners':
      return 'TRIM';
    case 'Threads & Notions':
      return 'THREAD';
    case 'Packaging':
      return 'PACKAGING';
    default:
      return 'TRIM';
  }
}

export const BomItemFormModal: React.FC<BomItemFormModalProps> = ({
  isOpen,
  onClose,
  style,
  defaultVersion,
  materials,
  itemToEdit,
  onSave,
}) => {
  const initialMat = itemToEdit
    ? materials.find((m) => m.id === itemToEdit.materialId)
    : materials[0];

  // All hooks declared unconditionally at top level (React Rules of Hooks)
  const [materialId, setMaterialId] = useState<string>(
    itemToEdit?.materialId || materials[0]?.id || ''
  );
  const [componentCategory, setComponentCategory] = useState<BomComponentCategory>(
    itemToEdit?.componentCategory || inferCategoryFromMaterial(initialMat)
  );
  const [placement, setPlacement] = useState<string>(itemToEdit?.placement || '');
  const [consumptionPerGarment, setConsumptionPerGarment] = useState<string>(
    itemToEdit ? String(itemToEdit.consumptionPerGarment) : ''
  );
  const [consumptionBasis, setConsumptionBasis] = useState<ConsumptionBasis>(
    itemToEdit?.consumptionBasis || 'PER_PIECE'
  );
  const [consumptionUnit, setConsumptionUnit] = useState<ConsumptionUnit>(
    itemToEdit?.consumptionUnit || initialMat?.unit || 'pcs'
  );
  const [wastagePercent, setWastagePercent] = useState<string>(
    itemToEdit ? String(itemToEdit.wastagePercent ?? 0) : '5'
  );
  const [bomVersion, setBomVersion] = useState<string>(
    String(itemToEdit?.bomVersion ?? defaultVersion ?? 1)
  );
  const [isMandatory, setIsMandatory] = useState<boolean>(
    itemToEdit?.isMandatory ?? true
  );
  const [notes, setNotes] = useState<string>(itemToEdit?.notes || '');

  // Colour scope state
  const [colorScope, setColorScope] = useState<BomDimensionScope>(
    itemToEdit?.colorScope || 'ALL'
  );
  const [applicableColors, setApplicableColors] = useState<string[]>(
    itemToEdit?.colorScope === 'SPECIFIC' && itemToEdit.applicableColors
      ? [...itemToEdit.applicableColors]
      : []
  );
  const [newColorInput, setNewColorInput] = useState<string>('');

  // Size scope & size-specific consumption overrides
  const [sizeScope, setSizeScope] = useState<BomDimensionScope>(
    itemToEdit?.sizeScope || 'ALL'
  );
  const [applicableSizes, setApplicableSizes] = useState<string[]>(
    itemToEdit?.sizeScope === 'SPECIFIC' && itemToEdit.applicableSizes
      ? [...itemToEdit.applicableSizes]
      : []
  );
  const [newSizeInput, setNewSizeInput] = useState<string>('');
  const [sizeOverrides, setSizeOverrides] = useState<SizeOverrideRow[]>(
    itemToEdit?.sizeConsumptionMap
      ? Object.entries(itemToEdit.sizeConsumptionMap).map(([sz, qty], idx) => ({
          id: `ov-${idx}-${sz}`,
          size: sz,
          consumption: String(qty),
        }))
      : []
  );

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const materialMap = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials]
  );

  // Sync form fields whenever modal opens or target item/version changes
  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);
    setNewColorInput('');
    setNewSizeInput('');

    if (itemToEdit) {
      const mat = materialMap.get(itemToEdit.materialId);
      setMaterialId(itemToEdit.materialId);
      setComponentCategory(
        itemToEdit.componentCategory || inferCategoryFromMaterial(mat)
      );
      setPlacement(itemToEdit.placement || '');
      setConsumptionPerGarment(String(itemToEdit.consumptionPerGarment));
      setConsumptionBasis(itemToEdit.consumptionBasis || 'PER_PIECE');
      setConsumptionUnit(itemToEdit.consumptionUnit || mat?.unit || 'pcs');
      setWastagePercent(String(itemToEdit.wastagePercent ?? 0));
      setBomVersion(String(itemToEdit.bomVersion ?? 1));
      setIsMandatory(itemToEdit.isMandatory ?? true);
      setNotes(itemToEdit.notes || '');

      const cScope = itemToEdit.colorScope || 'ALL';
      setColorScope(cScope);
      setApplicableColors(
        cScope === 'SPECIFIC' && itemToEdit.applicableColors
          ? [...itemToEdit.applicableColors]
          : []
      );

      const sScope = itemToEdit.sizeScope || 'ALL';
      setSizeScope(sScope);
      setApplicableSizes(
        sScope === 'SPECIFIC' && itemToEdit.applicableSizes
          ? [...itemToEdit.applicableSizes]
          : []
      );

      const overrideEntries = itemToEdit.sizeConsumptionMap
        ? Object.entries(itemToEdit.sizeConsumptionMap).map(([sz, qty], idx) => ({
            id: `ov-${idx}-${sz}`,
            size: sz,
            consumption: String(qty),
          }))
        : [];
      setSizeOverrides(overrideEntries);
    } else {
      const firstMat = materials[0];
      setMaterialId(firstMat?.id || '');
      setComponentCategory(inferCategoryFromMaterial(firstMat));
      setPlacement('');
      setConsumptionPerGarment('');
      setConsumptionBasis('PER_PIECE');
      setConsumptionUnit(firstMat?.unit || 'pcs');
      setWastagePercent('5');
      setBomVersion(String(defaultVersion || 1));
      setIsMandatory(true);
      setNotes('');
      setColorScope('ALL');
      setApplicableColors([]);
      setSizeScope('ALL');
      setApplicableSizes([]);
      setSizeOverrides([]);
    }
  }, [isOpen, itemToEdit, defaultVersion, materials, materialMap]);

  const selectedMaterial = useMemo(
    () => materialMap.get(materialId),
    [materialMap, materialId]
  );

  // Live UOM conversion validation & preview via pure uomConverter
  const uomEvaluation = useMemo(() => {
    if (!selectedMaterial) {
      return {
        valid: false,
        reason: 'Select a material to validate unit of measurement compatibility.',
        factor: null as number | null,
        formula: '',
        netStockPerPiece: null as number | null,
        grossStockPerPiece: null as number | null,
      };
    }

    const check = canConvertUom(
      consumptionUnit,
      selectedMaterial.unit,
      selectedMaterial.uomAttributes
    );

    if (!check.valid) {
      return {
        valid: false,
        reason: check.reason || 'Incompatible unit conversion.',
        factor: null as number | null,
        formula: '',
        netStockPerPiece: null as number | null,
        grossStockPerPiece: null as number | null,
      };
    }

    const { factor, formulaDescription } = getUomConversionFactor(
      consumptionUnit,
      selectedMaterial.unit,
      selectedMaterial.uomAttributes
    );

    const parsedQty = parseFloat(consumptionPerGarment);
    const parsedWastage = parseFloat(wastagePercent);
    let netStockPerPiece: number | null = null;
    let grossStockPerPiece: number | null = null;

    if (Number.isFinite(parsedQty) && parsedQty > 0) {
      const perPieceInConsumptionUnit =
        consumptionBasis === 'PER_DOZEN' ? parsedQty / 12 : parsedQty;
      const netExact = perPieceInConsumptionUnit * factor;
      netStockPerPiece = roundUomDisplay(netExact, 5);
      if (Number.isFinite(parsedWastage) && parsedWastage >= 0) {
        grossStockPerPiece = roundUomDisplay(netExact * (1 + parsedWastage / 100), 5);
      }
    }

    return {
      valid: true,
      reason: undefined,
      factor,
      formula: formulaDescription,
      netStockPerPiece,
      grossStockPerPiece,
    };
  }, [
    selectedMaterial,
    consumptionUnit,
    consumptionPerGarment,
    consumptionBasis,
    wastagePercent,
  ]);

  if (!isOpen || !style) return null;

  const handleMaterialChange = (nextMaterialId: string) => {
    setMaterialId(nextMaterialId);
    const mat = materialMap.get(nextMaterialId);
    if (mat && !itemToEdit) {
      setConsumptionUnit(mat.unit);
      setComponentCategory(inferCategoryFromMaterial(mat));
    }
  };

  const handleAddColor = () => {
    const trimmed = newColorInput.trim();
    if (!trimmed) return;
    if (applicableColors.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setNewColorInput('');
      return;
    }
    setApplicableColors((prev) => [...prev, trimmed]);
    setNewColorInput('');
  };

  const handleRemoveColor = (colorToRemove: string) => {
    setApplicableColors((prev) => prev.filter((c) => c !== colorToRemove));
  };

  const handleAddSize = (sizeVal?: string) => {
    const trimmed = (sizeVal ?? newSizeInput).trim();
    if (!trimmed) return;
    if (applicableSizes.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      if (!sizeVal) setNewSizeInput('');
      return;
    }
    setApplicableSizes((prev) => [...prev, trimmed]);
    if (!sizeVal) setNewSizeInput('');
  };

  const handleRemoveSize = (sizeToRemove: string) => {
    setApplicableSizes((prev) => prev.filter((s) => s !== sizeToRemove));
  };

  const handleAddSizeOverride = () => {
    setSizeOverrides((prev) => [
      ...prev,
      {
        id: `ov-${Date.now()}-${prev.length}`,
        size: '',
        consumption: consumptionPerGarment || '',
      },
    ]);
  };

  const handleUpdateSizeOverride = (
    rowId: string,
    field: 'size' | 'consumption',
    value: string
  ) => {
    setSizeOverrides((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row))
    );
  };

  const handleRemoveSizeOverride = (rowId: string) => {
    setSizeOverrides((prev) => prev.filter((row) => row.id !== rowId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!materialId) {
      setFormError('Please select a raw material from the inventory master.');
      return;
    }
    if (!placement.trim()) {
      setFormError('Component placement description is required (e.g. Main Body Shell).');
      return;
    }

    const parsedConsumption = parseFloat(consumptionPerGarment);
    if (!Number.isFinite(parsedConsumption) || parsedConsumption <= 0) {
      setFormError('Consumption quantity must be a positive finite number greater than 0.');
      return;
    }

    const parsedWastage = parseFloat(wastagePercent);
    if (!Number.isFinite(parsedWastage) || parsedWastage < 0) {
      setFormError('Wastage percentage must be a non-negative number (0 or higher).');
      return;
    }

    const parsedVersion = Number(bomVersion);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
      setFormError('BOM version must be a positive integer (1, 2, 3, ...).');
      return;
    }

    if (!uomEvaluation.valid) {
      setFormError(
        uomEvaluation.reason ||
          'Selected consumption unit cannot be converted to the material stock unit.'
      );
      return;
    }

    if (colorScope === 'SPECIFIC' && applicableColors.length === 0) {
      setFormError(
        'Specific colour scope requires at least one colourway. Add a colour or switch back to All Colours.'
      );
      return;
    }

    if (sizeScope === 'SPECIFIC' && applicableSizes.length === 0) {
      setFormError(
        'Specific size scope requires at least one size. Add a size or switch back to All Sizes.'
      );
      return;
    }

    let sizeConsumptionMap: Record<string, number> | undefined;
    if (sizeOverrides.length > 0) {
      const map: Record<string, number> = {};
      const seenKeys = new Set<string>();
      for (const row of sizeOverrides) {
        const cleanSize = row.size.trim();
        if (!cleanSize) {
          setFormError('All size-specific consumption override rows must have a size label.');
          return;
        }
        const normalizedKey = cleanSize.toUpperCase();
        if (seenKeys.has(normalizedKey)) {
          setFormError(`Duplicate size override for "${cleanSize}". Remove duplicate rows.`);
          return;
        }
        seenKeys.add(normalizedKey);
        const qty = parseFloat(row.consumption);
        if (!Number.isFinite(qty) || qty <= 0) {
          setFormError(
            `Size override for "${cleanSize}" must have a positive consumption quantity.`
          );
          return;
        }
        map[cleanSize] = qty;
      }
      sizeConsumptionMap = map;
    }

    const data: Omit<BomItemEntity, 'id' | 'createdAt' | 'updatedAt' | 'isSimulated'> = {
      styleId: style.id,
      materialId,
      bomVersion: parsedVersion,
      status: itemToEdit?.status ?? 'ACTIVE',
      componentCategory,
      consumptionPerGarment: parsedConsumption,
      consumptionBasis,
      consumptionUnit,
      wastagePercent: parsedWastage,
      placement: placement.trim(),
      colorScope,
      applicableColors: colorScope === 'SPECIFIC' ? [...applicableColors] : undefined,
      sizeScope,
      applicableSizes: sizeScope === 'SPECIFIC' ? [...applicableSizes] : undefined,
      sizeConsumptionMap,
      notes: notes.trim() ? notes.trim() : undefined,
      isMandatory,
    };

    try {
      setIsSubmitting(true);
      await onSave({
        mode: itemToEdit ? 'edit' : 'create',
        id: itemToEdit?.id,
        data,
      });
      onClose();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save BOM component.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={itemToEdit ? 'Edit BOM Component' : 'Add BOM Component'}
      data-testid="bom-item-form-modal"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono text-amber-400 font-semibold">
              {style.styleCode} · BOM v{bomVersion}
            </div>
            <h2 className="text-base font-bold text-zinc-100 mt-0.5">
              {itemToEdit ? 'Edit BOM Component' : 'Add BOM Component'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close BOM component modal"
            className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {formError && (
            <div
              role="alert"
              data-testid="bom-form-error"
              className="p-3 rounded-md bg-rose-950/70 border border-rose-800 text-rose-200 font-mono flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* Section 1: Material & Component Placement */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="bom-material-select"
                className="block font-mono text-zinc-400 text-[11px] mb-1.5"
              >
                Material Master Record *
              </label>
              <select
                id="bom-material-select"
                data-testid="bom-material-select"
                value={materialId}
                onChange={(e) => handleMaterialChange(e.target.value)}
                required
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-3 py-2 text-zinc-100 font-sans focus:outline-hidden"
              >
                <option value="" disabled>
                  Select raw material...
                </option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    [{m.materialCode}] {m.name} — Stock Unit: {m.unit} ({m.category})
                  </option>
                ))}
              </select>
              {selectedMaterial && (
                <div className="mt-1.5 text-[11px] text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate">{selectedMaterial.spec}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-zinc-300">
                    Stock UOM: {selectedMaterial.unit}
                  </span>
                  {selectedMaterial.uomAttributes && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-cyan-300">
                        Attrs:{' '}
                        {[
                          selectedMaterial.uomAttributes.gsm
                            ? `${selectedMaterial.uomAttributes.gsm} GSM`
                            : null,
                          selectedMaterial.uomAttributes.usableWidthCm
                            ? `${selectedMaterial.uomAttributes.usableWidthCm} cm`
                            : null,
                          selectedMaterial.uomAttributes.metersPerRoll
                            ? `${selectedMaterial.uomAttributes.metersPerRoll} m/roll`
                            : null,
                          selectedMaterial.uomAttributes.metersPerCone
                            ? `${selectedMaterial.uomAttributes.metersPerCone} m/cone`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(', ') || 'None configured'}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="bom-category-select"
                className="block font-mono text-zinc-400 text-[11px] mb-1.5"
              >
                Component Category *
              </label>
              <select
                id="bom-category-select"
                data-testid="bom-category-select"
                value={componentCategory}
                onChange={(e) =>
                  setComponentCategory(e.target.value as BomComponentCategory)
                }
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-3 py-2 text-zinc-100 font-sans focus:outline-hidden"
              >
                {COMPONENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="bom-version-input"
                className="block font-mono text-zinc-400 text-[11px] mb-1.5"
              >
                BOM Version *
              </label>
              <input
                id="bom-version-input"
                data-testid="bom-version-input"
                type="number"
                min={1}
                step={1}
                required
                readOnly={Boolean(itemToEdit)}
                value={bomVersion}
                onChange={(e) => setBomVersion(e.target.value)}
                className={`w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 font-mono tabular-nums focus:outline-hidden ${
                  itemToEdit
                    ? 'text-zinc-500 cursor-not-allowed'
                    : 'text-zinc-100 focus:border-amber-500'
                }`}
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="bom-placement-input"
                className="block font-mono text-zinc-400 text-[11px] mb-1.5"
              >
                Placement / Usage Description *
              </label>
              <input
                id="bom-placement-input"
                data-testid="bom-placement-input"
                type="text"
                required
                placeholder="e.g. Main Body & Hood Shell, Front Zipper Closure, Care Label at Left Seam"
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-3 py-2 text-zinc-100 font-sans focus:outline-hidden"
              />
            </div>
          </div>

          {/* Section 2: Consumption, Basis, UOM & Wastage */}
          <div className="pt-4 border-t border-zinc-800 space-y-3">
            <div className="text-[11px] font-mono text-zinc-300 font-semibold">
              Consumption, Basis & Unit Conversion
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="bom-consumption-input"
                  className="block font-mono text-zinc-400 text-[11px] mb-1"
                >
                  Consumption Qty *
                </label>
                <input
                  id="bom-consumption-input"
                  data-testid="bom-consumption-input"
                  type="number"
                  step="any"
                  min="0.0001"
                  required
                  placeholder="e.g. 0.48"
                  value={consumptionPerGarment}
                  onChange={(e) => setConsumptionPerGarment(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-2.5 py-2 text-zinc-100 font-mono tabular-nums focus:outline-hidden"
                />
              </div>

              <div>
                <label
                  htmlFor="bom-basis-select"
                  className="block font-mono text-zinc-400 text-[11px] mb-1"
                >
                  Consumption Basis *
                </label>
                <select
                  id="bom-basis-select"
                  data-testid="bom-basis-select"
                  value={consumptionBasis}
                  onChange={(e) =>
                    setConsumptionBasis(e.target.value as ConsumptionBasis)
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-2.5 py-2 text-zinc-100 font-mono focus:outline-hidden"
                >
                  <option value="PER_PIECE">Per Piece (1 pc)</option>
                  <option value="PER_DOZEN">Per Dozen (12 pcs)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="bom-uom-select"
                  className="block font-mono text-zinc-400 text-[11px] mb-1"
                >
                  Consumption Unit *
                </label>
                <select
                  id="bom-uom-select"
                  data-testid="bom-uom-select"
                  value={consumptionUnit}
                  onChange={(e) =>
                    setConsumptionUnit(e.target.value as ConsumptionUnit)
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-2.5 py-2 text-zinc-100 font-mono focus:outline-hidden"
                >
                  {ALL_CONSUMPTION_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="bom-wastage-input"
                  className="block font-mono text-zinc-400 text-[11px] mb-1"
                >
                  Wastage (%) *
                </label>
                <input
                  id="bom-wastage-input"
                  data-testid="bom-wastage-input"
                  type="number"
                  step="any"
                  min="0"
                  required
                  placeholder="e.g. 5"
                  value={wastagePercent}
                  onChange={(e) => setWastagePercent(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-2.5 py-2 text-zinc-100 font-mono tabular-nums focus:outline-hidden"
                />
              </div>
            </div>

            {/* Live UOM Validation & Conversion Preview */}
            {selectedMaterial && (
              <div
                data-testid="bom-uom-validation-box"
                className={`p-3 rounded-md border font-mono text-[11px] ${
                  uomEvaluation.valid
                    ? 'bg-emerald-950/35 border-emerald-800/70 text-emerald-200'
                    : 'bg-rose-950/55 border-rose-800 text-rose-200'
                }`}
              >
                {uomEvaluation.valid ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-semibold text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        UOM Conversion Valid: {consumptionUnit}{' '}
                        <ArrowRight className="w-3 h-3 inline" /> {selectedMaterial.unit}
                      </span>
                      <span className="text-zinc-300 tabular-nums">
                        Factor: {uomEvaluation.factor !== null ? roundUomDisplay(uomEvaluation.factor, 6) : '—'}
                      </span>
                    </div>
                    <div className="text-zinc-400">{uomEvaluation.formula}</div>
                    {uomEvaluation.netStockPerPiece !== null && (
                      <div className="text-zinc-200 pt-1 border-t border-emerald-900/60 tabular-nums">
                        Effective Stock Req / Garment: Net{' '}
                        <span className="font-semibold text-white">
                          {uomEvaluation.netStockPerPiece} {selectedMaterial.unit}
                        </span>
                        {uomEvaluation.grossStockPerPiece !== null && (
                          <>
                            {' · '}Gross (incl. {wastagePercent || 0}% wastage){' '}
                            <span className="font-semibold text-amber-300">
                              {uomEvaluation.grossStockPerPiece} {selectedMaterial.unit}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                      <div>
                        <div className="font-semibold text-rose-300">
                          Incompatible Unit Conversion ({consumptionUnit} → {selectedMaterial.unit})
                        </div>
                        <div className="text-rose-200/90 mt-0.5">{uomEvaluation.reason}</div>
                      </div>
                    </div>
                    {consumptionUnit !== selectedMaterial.unit && (
                      <button
                        type="button"
                        onClick={() => setConsumptionUnit(selectedMaterial.unit)}
                        className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-[11px] text-amber-300 transition-colors"
                      >
                        Switch to Material Stock Unit ({selectedMaterial.unit})
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 3: Colour Applicability */}
          <div className="pt-4 border-t border-zinc-800 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono text-zinc-300 font-semibold">
                  Colour Applicability
                </div>
                <div className="text-[11px] text-zinc-400">
                  Apply component to all garment colourways or restrict to specific colours.
                </div>
              </div>
              <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 p-0.5 rounded-md font-mono">
                <button
                  type="button"
                  data-testid="bom-color-scope-all"
                  onClick={() => setColorScope('ALL')}
                  className={`px-2.5 py-1 rounded text-[11px] transition-colors whitespace-nowrap ${
                    colorScope === 'ALL'
                      ? 'bg-zinc-800 text-amber-400 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  All Colours
                </button>
                <button
                  type="button"
                  data-testid="bom-color-scope-specific"
                  onClick={() => setColorScope('SPECIFIC')}
                  className={`px-2.5 py-1 rounded text-[11px] transition-colors whitespace-nowrap ${
                    colorScope === 'SPECIFIC'
                      ? 'bg-zinc-800 text-amber-400 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Specific Colours
                </button>
              </div>
            </div>

            {colorScope === 'SPECIFIC' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    data-testid="bom-add-color-input"
                    placeholder="Enter colourway (e.g. Heather Grey, Navy Blue)..."
                    value={newColorInput}
                    onChange={(e) => setNewColorInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddColor();
                      }
                    }}
                    className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-3 py-1.5 text-zinc-100 font-sans focus:outline-hidden"
                  />
                  <button
                    type="button"
                    data-testid="bom-add-color-btn"
                    onClick={handleAddColor}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 rounded-md font-mono flex items-center gap-1 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Colour
                  </button>
                </div>

                {applicableColors.length === 0 ? (
                  <div className="text-[11px] text-amber-400/90 font-mono">
                    Add at least one colourway to save with Specific Colour scope.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {applicableColors.map((color) => (
                      <span
                        key={color}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-zinc-950 border border-zinc-700 rounded text-[11px] text-zinc-200 font-mono"
                      >
                        <span>{color}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveColor(color)}
                          aria-label={`Remove colour ${color}`}
                          className="text-zinc-500 hover:text-rose-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 4: Size Applicability & Size-Specific Consumption Overrides */}
          <div className="pt-4 border-t border-zinc-800 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono text-zinc-300 font-semibold">
                  Size Applicability & Size Overrides
                </div>
                <div className="text-[11px] text-zinc-400">
                  Restrict applicability to specific sizes or override base consumption per size.
                </div>
              </div>
              <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 p-0.5 rounded-md font-mono">
                <button
                  type="button"
                  data-testid="bom-size-scope-all"
                  onClick={() => setSizeScope('ALL')}
                  className={`px-2.5 py-1 rounded text-[11px] transition-colors whitespace-nowrap ${
                    sizeScope === 'ALL'
                      ? 'bg-zinc-800 text-amber-400 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  All Sizes
                </button>
                <button
                  type="button"
                  data-testid="bom-size-scope-specific"
                  onClick={() => setSizeScope('SPECIFIC')}
                  className={`px-2.5 py-1 rounded text-[11px] transition-colors whitespace-nowrap ${
                    sizeScope === 'SPECIFIC'
                      ? 'bg-zinc-800 text-amber-400 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Specific Sizes
                </button>
              </div>
            </div>

            {sizeScope === 'SPECIFIC' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    data-testid="bom-add-size-input"
                    placeholder="Enter custom size (e.g. S, XL, 32)..."
                    value={newSizeInput}
                    onChange={(e) => setNewSizeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSize();
                      }
                    }}
                    className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-3 py-1.5 text-zinc-100 font-mono focus:outline-hidden"
                  />
                  <button
                    type="button"
                    data-testid="bom-add-size-btn"
                    onClick={() => handleAddSize()}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 rounded-md font-mono flex items-center gap-1 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Size
                  </button>
                </div>

                {/* Quick-pick standard sizes */}
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] font-mono text-zinc-500 mr-1">Quick add:</span>
                  {QUICK_SIZES.map((sz) => {
                    const isSelected = applicableSizes.some(
                      (s) => s.toUpperCase() === sz.toUpperCase()
                    );
                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() =>
                          isSelected ? handleRemoveSize(sz) : handleAddSize(sz)
                        }
                        className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                          isSelected
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {sz}
                      </button>
                    );
                  })}
                </div>

                {applicableSizes.length === 0 ? (
                  <div className="text-[11px] text-amber-400/90 font-mono">
                    Select or enter at least one size to save with Specific Size scope.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {applicableSizes.map((size) => (
                      <span
                        key={size}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-zinc-950 border border-zinc-700 rounded text-[11px] text-zinc-200 font-mono"
                      >
                        <span>{size}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSize(size)}
                          aria-label={`Remove size ${size}`}
                          className="text-zinc-500 hover:text-rose-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Optional Size-Specific Consumption Map */}
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-zinc-500" />
                  Optional Size-Specific Consumption Overrides (in {consumptionUnit}{' '}
                  {consumptionBasis === 'PER_DOZEN' ? '/ dozen' : '/ piece'})
                </span>
                <button
                  type="button"
                  data-testid="bom-add-size-override-btn"
                  onClick={handleAddSizeOverride}
                  className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded text-[11px] font-mono flex items-center gap-1 whitespace-nowrap"
                >
                  <Plus className="w-3 h-3 text-amber-400" />
                  Add Override
                </button>
              </div>

              {sizeOverrides.length > 0 && (
                <div className="space-y-2">
                  {sizeOverrides.map((row) => (
                    <div key={row.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Size (e.g. XL)"
                        value={row.size}
                        onChange={(e) =>
                          handleUpdateSizeOverride(row.id, 'size', e.target.value)
                        }
                        className="w-32 bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-100 font-mono focus:outline-hidden"
                      />
                      <input
                        type="number"
                        step="any"
                        min="0.0001"
                        placeholder={`Qty (${consumptionUnit})`}
                        value={row.consumption}
                        onChange={(e) =>
                          handleUpdateSizeOverride(row.id, 'consumption', e.target.value)
                        }
                        className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-100 font-mono tabular-nums focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveSizeOverride(row.id)}
                        aria-label="Remove size override"
                        className="p-1.5 text-zinc-400 hover:text-rose-400 rounded hover:bg-zinc-800"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Section 5: Mandatory & Notes */}
          <div className="pt-4 border-t border-zinc-800 grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isMandatory}
                onChange={(e) => setIsMandatory(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
              />
              <div>
                <div className="text-zinc-200 font-medium">Mandatory BOM Component</div>
                <div className="text-[11px] text-zinc-500">
                  Required for production release & MRP explosion.
                </div>
              </div>
            </label>

            <div>
              <label
                htmlFor="bom-notes-input"
                className="block font-mono text-zinc-400 text-[11px] mb-1"
              >
                Technical Notes (Optional)
              </label>
              <input
                id="bom-notes-input"
                type="text"
                placeholder="Dyeing lot rule, needle gauge, supplier remark..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-md px-3 py-1.5 text-zinc-100 font-sans focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-800 bg-zinc-950 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md text-xs font-mono transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="bom-form-submit-btn"
            disabled={isSubmitting || !uomEvaluation.valid}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-zinc-950 rounded-md text-xs font-bold font-mono transition-colors"
          >
            {isSubmitting
              ? 'Saving...'
              : itemToEdit
              ? 'Save Component Changes'
              : 'Add Component to BOM'}
          </button>
        </div>
      </form>
    </div>
  );
};
