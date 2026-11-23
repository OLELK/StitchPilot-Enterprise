import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Shirt,
  Scissors,
  Layers,
  Clock,
  Edit,
  X,
  AlertCircle,
  Building,
  CheckCircle2,
} from 'lucide-react';
import { StyleEntity, BuyerEntity } from '../../db/types';

interface StyleManagementViewProps {
  styles: StyleEntity[];
  buyers: BuyerEntity[];
  onCreateStyle: (style: Omit<StyleEntity, 'id' | 'createdAt' | 'updatedAt' | 'isSimulated'>) => Promise<any>;
  onUpdateStyle: (id: string, updates: Partial<StyleEntity>) => Promise<any>;
}

export const StyleManagementView: React.FC<StyleManagementViewProps> = ({
  styles,
  buyers,
  onCreateStyle,
  onUpdateStyle,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [buyerFilter, setBuyerFilter] = useState('ALL');
  const [genderFilter, setGenderFilter] = useState('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [styleToEdit, setStyleToEdit] = useState<StyleEntity | null>(null);

  // Form Fields
  const [styleCode, setStyleCode] = useState('');
  const [description, setDescription] = useState('');
  const [buyerId, setBuyerId] = useState(buyers[0]?.id || '');
  const [garmentType, setGarmentType] = useState('Fleece Sweatshirt');
  const [productType, setProductType] = useState('Outerwear');
  const [genderCategory, setGenderCategory] = useState('Unisex');
  const [fabricClassification, setFabricClassification] = useState('');
  const [samMinutes, setSamMinutes] = useState('16.0');
  const [targetEfficiencyPercent, setTargetEfficiencyPercent] = useState('85');
  const [season, setSeason] = useState('Autumn/Winter 2026');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const buyerMap = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers]);

  const filteredStyles = useMemo(() => {
    return styles.filter((s) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        s.styleCode.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.fabricClassification.toLowerCase().includes(q) ||
        (s.productType && s.productType.toLowerCase().includes(q));

      const matchesBuyer = buyerFilter === 'ALL' || s.buyerId === buyerFilter;
      const matchesGender = genderFilter === 'ALL' || (s.genderCategory || 'Unisex') === genderFilter;

      return matchesSearch && matchesBuyer && matchesGender;
    });
  }, [styles, searchQuery, buyerFilter, genderFilter]);

  const handleOpenCreate = () => {
    setStyleToEdit(null);
    setStyleCode('');
    setDescription('');
    setBuyerId(buyers[0]?.id || '');
    setGarmentType('Fleece Sweatshirt');
    setProductType('Outerwear');
    setGenderCategory('Unisex');
    setFabricClassification('');
    setSamMinutes('16.0');
    setTargetEfficiencyPercent('85');
    setSeason('Autumn/Winter 2026');
    setStatus('ACTIVE');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (style: StyleEntity) => {
    setStyleToEdit(style);
    setStyleCode(style.styleCode);
    setDescription(style.description);
    setBuyerId(style.buyerId);
    setGarmentType(style.garmentType);
    setProductType(style.productType || 'Outerwear');
    setGenderCategory(style.genderCategory || 'Unisex');
    setFabricClassification(style.fabricClassification);
    setSamMinutes(style.samMinutes.toString());
    setTargetEfficiencyPercent(style.targetEfficiencyPercent.toString());
    setSeason(style.season);
    setStatus(style.status || 'ACTIVE');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!styleCode.trim()) {
      setFormError('Style Code is required (e.g. ST-402).');
      return;
    }
    if (!description.trim()) {
      setFormError('Style Description is required.');
      return;
    }
    if (!buyerId) {
      setFormError('Buyer selection is required.');
      return;
    }
    if (!fabricClassification.trim()) {
      setFormError('Fabric classification description is required.');
      return;
    }

    const samVal = parseFloat(samMinutes);
    if (isNaN(samVal) || samVal <= 0) {
      setFormError('SAM / SMV must be a positive number.');
      return;
    }

    const effVal = parseFloat(targetEfficiencyPercent);
    if (isNaN(effVal) || effVal <= 0 || effVal > 150) {
      setFormError('Target efficiency percent must be between 1 and 150%.');
      return;
    }

    try {
      setIsSubmitting(true);
      if (styleToEdit) {
        await onUpdateStyle(styleToEdit.id, {
          styleCode: styleCode.trim().toUpperCase(),
          description: description.trim(),
          buyerId,
          garmentType,
          productType,
          genderCategory,
          fabricClassification: fabricClassification.trim(),
          samMinutes: samVal,
          targetEfficiencyPercent: effVal,
          season,
          status,
        });
      } else {
        await onCreateStyle({
          styleCode: styleCode.trim().toUpperCase(),
          description: description.trim(),
          buyerId,
          garmentType,
          productType,
          genderCategory,
          fabricClassification: fabricClassification.trim(),
          samMinutes: samVal,
          targetEfficiencyPercent: effVal,
          season,
          status,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save garment style.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 bg-zinc-900/90 border border-zinc-800 rounded-lg">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search style code, description, fabric..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-hidden focus:border-amber-500 transition-colors font-mono"
          />
        </div>

        {/* Filters and Add Button */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Buyer Filter */}
          <select
            value={buyerFilter}
            onChange={(e) => setBuyerFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 font-sans"
          >
            <option value="ALL">All Buyers</option>
            {buyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} [{b.code}]
              </option>
            ))}
          </select>

          {/* Gender Filter */}
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 font-sans"
          >
            <option value="ALL">All Genders</option>
            <option value="Unisex">Unisex</option>
            <option value="Men">Men</option>
            <option value="Women">Women</option>
            <option value="Kids">Kids</option>
          </select>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-md text-xs font-bold font-mono flex items-center gap-1.5 transition-colors shadow-sm ml-auto sm:ml-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            New Style
          </button>
        </div>
      </div>

      {/* Styles Table */}
      <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-zinc-950/70 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
                <th className="py-3 px-4 font-medium">Style Code</th>
                <th className="py-3 px-4 font-medium">Description & Fabric Spec</th>
                <th className="py-3 px-3 font-medium">Buyer</th>
                <th className="py-3 px-3 font-medium">Category / Gender</th>
                <th className="py-3 px-3 font-medium text-right">SAM (SMV)</th>
                <th className="py-3 px-3 font-medium text-right">Target Eff%</th>
                <th className="py-3 px-3 font-medium">Season</th>
                <th className="py-3 px-3 font-medium text-center">Status</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {filteredStyles.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-zinc-500 font-mono">
                    No garment styles matching the selected criteria.
                  </td>
                </tr>
              ) : (
                filteredStyles.map((style) => {
                  const buyer = buyerMap.get(style.buyerId);

                  return (
                    <tr key={style.id} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-amber-400 tracking-tight">
                          {style.styleCode}
                        </div>
                        <div className="text-[10px] text-zinc-500">{style.garmentType}</div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-sans font-semibold text-zinc-100">
                          {style.description}
                        </div>
                        <div className="text-[10px] text-zinc-400 truncate max-w-sm">
                          {style.fabricClassification}
                        </div>
                      </td>

                      <td className="py-3 px-3 font-sans text-zinc-300">
                        {buyer ? (
                          <div>
                            <span className="font-medium text-zinc-200">{buyer.name}</span>
                            <span className="text-[10px] text-zinc-500 font-mono block">
                              [{buyer.code}]
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-500">Unassigned</span>
                        )}
                      </td>

                      <td className="py-3 px-3 font-sans">
                        <div className="text-zinc-200">{style.productType || style.garmentType}</div>
                        <div className="text-[10px] text-zinc-500">
                          {style.genderCategory || 'Unisex'}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-amber-300 font-bold">
                        {style.samMinutes.toFixed(1)} <span className="text-[10px] text-zinc-500 font-normal">min</span>
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-zinc-300">
                        {style.targetEfficiencyPercent}%
                      </td>

                      <td className="py-3 px-3 text-zinc-400 text-[11px]">
                        {style.season}
                      </td>

                      <td className="py-3 px-3 text-center">
                        {(style.status || 'ACTIVE') === 'ACTIVE' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800/80">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                            INACTIVE
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(style)}
                          className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] font-mono flex items-center gap-1 ml-auto transition-colors border border-zinc-700"
                        >
                          <Edit className="w-3 h-3 text-amber-400" />
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Style Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-xl w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <div className="text-[11px] font-mono text-amber-400 uppercase tracking-wider font-semibold">
                  Garment Style Master
                </div>
                <div className="text-base font-bold text-zinc-100">
                  {styleToEdit ? `Edit Style: ${styleToEdit.styleCode}` : 'Create Garment Style'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-mono flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Style Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ST-402, TEE-99"
                  value={styleCode}
                  onChange={(e) => setStyleCode(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono uppercase"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Buyer Reference *
                </label>
                <select
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                >
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} [{b.code}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Style Description *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Heavyweight Fleece Crewneck (380 GSM)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Product Type
                </label>
                <select
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                >
                  <option value="Outerwear">Outerwear & Hoodies</option>
                  <option value="T-Shirts">T-Shirts & Tops</option>
                  <option value="Bottoms">Bottoms & Pants</option>
                  <option value="Shirts">Woven Shirts</option>
                  <option value="Activewear">Activewear & Polos</option>
                  <option value="Denim">Denim Wear</option>
                </select>
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Gender / Category
                </label>
                <select
                  value={genderCategory}
                  onChange={(e) => setGenderCategory(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                >
                  <option value="Unisex">Unisex</option>
                  <option value="Men">Men</option>
                  <option value="Women">Women</option>
                  <option value="Kids">Kids</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Fabric Classification & Construction *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Knitted 3-End Brushed Fleece 380 GSM (100% Cotton Face)"
                  value={fabricClassification}
                  onChange={(e) => setFabricClassification(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Standard Allowed Minutes (SAM / SMV) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  required
                  value={samMinutes}
                  onChange={(e) => setSamMinutes(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Target Line Efficiency (%) *
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="120"
                  required
                  value={targetEfficiencyPercent}
                  onChange={(e) => setTargetEfficiencyPercent(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Season
                </label>
                <input
                  type="text"
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                  placeholder="e.g. Autumn/Winter 2026"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded text-xs font-bold font-mono transition-colors"
              >
                {isSubmitting ? 'Saving...' : styleToEdit ? 'Save Changes' : 'Create Style'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
