import React, { useState, useMemo } from 'react';
import { 
  MaterialStockBalance, 
  InventoryTransactionType, 
  InventoryReferenceType,
  MaterialCategory,
  MaterialUnit 
} from '../../db/types';
import { 
  Search, 
  Plus, 
  AlertTriangle, 
  Package, 
  Archive, 
  ArrowUpRight, 
  X, 
  CheckCircle2, 
  Layers,
  MapPin,
  RefreshCw,
  FileSpreadsheet,
  AlertOctagon,
  ArrowDownRight,
  TrendingDown,
  TrendingUp,
  ShieldAlert
} from 'lucide-react';

interface InventoryViewProps {
  balances: MaterialStockBalance[];
  onPostTransaction: (params: {
    materialId: string;
    transactionType: InventoryTransactionType;
    quantity: number;
    referenceType: InventoryReferenceType;
    referenceId: string;
    notes?: string;
    batchLot?: string;
  }) => Promise<any>;
  onCreateMaterial: (
    material: {
      id: string;
      materialCode: string;
      name: string;
      category: MaterialCategory;
      spec: string;
      unit: MaterialUnit;
      reorderPoint: number;
      warehouseLocation: string;
      supplierName: string;
      isSimulated: boolean;
    },
    initialReceiptQty?: number
  ) => Promise<any>;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  balances,
  onPostTransaction,
  onCreateMaterial,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // Transaction Posting Modal State
  const [selectedBalance, setSelectedBalance] = useState<MaterialStockBalance | null>(null);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txType, setTxType] = useState<InventoryTransactionType>('ALLOCATION');
  const [txQty, setTxQty] = useState<string>('');
  const [txRefId, setTxRefId] = useState<string>('ORD-01');
  const [txNotes, setTxNotes] = useState<string>('');
  const [txError, setTxError] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<string | null>(null);
  const [isSubmittingTx, setIsSubmittingTx] = useState(false);

  // New Material Creation Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState<MaterialCategory>('Knitted Fabric');
  const [newSpec, setNewSpec] = useState('');
  const [newStock, setNewStock] = useState('1000');
  const [newUnit, setNewUnit] = useState<MaterialUnit>('kg');
  const [newReorder, setNewReorder] = useState('500');
  const [newLoc, setNewLoc] = useState('Zone A-08');
  const [newSupplier, setNewSupplier] = useState('Apex Textile Mills');

  // Filtered items
  const filteredBalances = useMemo(() => {
    return balances.filter((item) => {
      const matchesSearch =
        item.materialCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.location.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        selectedCategory === 'all' || item.category === selectedCategory;

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'critical' && item.status === 'CRITICAL') ||
        (statusFilter === 'low-stock' && item.status === 'LOW_STOCK') ||
        (statusFilter === 'in-stock' && item.status === 'IN_STOCK');

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [balances, searchQuery, selectedCategory, statusFilter]);

  const categories: { label: string; value: string; count: number }[] = [
    { label: 'All SKUs', value: 'all', count: balances.length },
    { label: 'Knitted Fabric', value: 'Knitted Fabric', count: balances.filter((i) => i.category === 'Knitted Fabric').length },
    { label: 'Woven Fabric', value: 'Woven Fabric', count: balances.filter((i) => i.category === 'Woven Fabric').length },
    { label: 'Trims & Fasteners', value: 'Trims & Fasteners', count: balances.filter((i) => i.category === 'Trims & Fasteners').length },
    { label: 'Threads & Notions', value: 'Threads & Notions', count: balances.filter((i) => i.category === 'Threads & Notions').length },
    { label: 'Packaging', value: 'Packaging', count: balances.filter((i) => i.category === 'Packaging').length },
  ];

  const lowStockCount = balances.filter((i) => i.status === 'LOW_STOCK').length;
  const criticalCount = balances.filter((i) => i.status === 'CRITICAL').length;

  const getStatusBadge = (status: MaterialStockBalance['status']) => {
    switch (status) {
      case 'IN_STOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
            In Stock
          </span>
        );
      case 'LOW_STOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-950/80 text-amber-300 border border-amber-800/60">
            Low Buffer
          </span>
        );
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-rose-950/80 text-rose-300 border border-rose-800/60">
            Critical Level
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
            {status}
          </span>
        );
    }
  };

  const handleOpenTxModal = (balance: MaterialStockBalance) => {
    setSelectedBalance(balance);
    setTxQty('');
    setTxError(null);
    setTxSuccess(null);
    setTxType('ALLOCATION');
    setIsTxModalOpen(true);
  };

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBalance) return;
    setTxError(null);
    setTxSuccess(null);
    setIsSubmittingTx(true);

    const qty = parseFloat(txQty);
    if (isNaN(qty) || qty <= 0) {
      setTxError('Transaction quantity must be a positive number.');
      setIsSubmittingTx(false);
      return;
    }

    try {
      let refType: InventoryReferenceType = 'ORDER_ALLOCATION';
      if (txType === 'PO_RECEIPT') refType = 'PURCHASE_ORDER';
      if (txType === 'CUTTING_ISSUE') refType = 'CUTTING_JOB';
      if (txType === 'RETURN_TO_STORE') refType = 'RETURN';
      if (txType === 'SCRAP_ADJUSTMENT') refType = 'SCRAP_AUDIT';

      await onPostTransaction({
        materialId: selectedBalance.materialId,
        transactionType: txType,
        quantity: qty,
        referenceType: refType,
        referenceId: txRefId || 'MANUAL-REF',
        notes: txNotes || `Posted via StitchPilot Inventory Console`,
        batchLot: 'LOT-FLOOR-CURRENT',
      });

      setTxSuccess(
        `Successfully posted ${txType} of ${qty} ${selectedBalance.unit} to the IndexedDB ledger!`
      );
      setTimeout(() => {
        setIsTxModalOpen(false);
        setSelectedBalance(null);
      }, 1500);
    } catch (err: any) {
      // Rule violation caught from Repository
      setTxError(err?.message || 'Transaction rejected by inventory ledger rule.');
    } finally {
      setIsSubmittingTx(false);
    }
  };

  const handleCreateMaterialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode || !newName) return;

    const reorder = parseFloat(newReorder) || 500;
    const initialQty = parseFloat(newStock) || 0;

    try {
      await onCreateMaterial(
        {
          id: `MAT-${Date.now()}`,
          materialCode: newCode.toUpperCase(),
          name: newName,
          category: newCat,
          spec: newSpec || 'Standard manufacturing specification',
          unit: newUnit,
          reorderPoint: reorder,
          warehouseLocation: newLoc,
          supplierName: newSupplier,
          isSimulated: true,
        },
        initialQty
      );
      setIsAddModalOpen(false);
      setNewCode('');
      setNewName('');
      setNewSpec('');
    } catch (err: any) {
      alert(err?.message || 'Failed to create material in database.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Action */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 tracking-tight flex items-center gap-2">
            <span>Raw Fabric & Trims Inventory Ledger</span>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-zinc-800 text-amber-400 border border-zinc-700">
              {balances.length} Tracked SKUs
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 hidden sm:inline">
              Single Ledger Truth
            </span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Real-time physical, reserved, and available stock dynamically calculated from IndexedDB transaction history.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-md text-xs font-bold font-mono transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            Register Material SKU
          </button>
        </div>
      </div>

      {/* Reorder Warnings Summary Bar */}
      {(lowStockCount > 0 || criticalCount > 0) && (
        <div className="p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-zinc-300">
              Material Reorder Watch: <strong className="text-rose-400">{criticalCount} critical</strong> and{' '}
              <strong className="text-amber-300">{lowStockCount} low buffer</strong> materials need supplier purchase orders.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setStatusFilter(statusFilter === 'critical' ? 'all' : 'critical')}
              className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                statusFilter === 'critical'
                  ? 'bg-rose-950 text-rose-300 border-rose-700'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
            >
              Show Critical ({criticalCount})
            </button>
            <button
              onClick={() => setStatusFilter(statusFilter === 'low-stock' ? 'all' : 'low-stock')}
              className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                statusFilter === 'low-stock'
                  ? 'bg-amber-950 text-amber-300 border-amber-700'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
            >
              Show Low Stock ({lowStockCount})
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-2 bg-zinc-900/90 border border-zinc-800 rounded-lg">
        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setSelectedCategory(cat.value)}
              className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md whitespace-nowrap transition-all ${
                selectedCategory === cat.value
                  ? 'bg-zinc-800 text-amber-400 border border-zinc-700/80 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {cat.label} ({cat.count})
            </button>
          ))}
        </div>

        {/* Live Search Input */}
        <div className="relative min-w-[240px] sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search SKU, Fabric, Location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-hidden focus:border-amber-500 transition-colors font-mono"
          />
        </div>
      </div>

      {/* Inventory Data Table with Accounting Fields */}
      <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-zinc-950/70 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
                <th className="py-3 px-4 font-medium">SKU Code</th>
                <th className="py-3 px-3 font-medium">Material Name & Category</th>
                <th className="py-3 px-3 font-medium text-right">Physical Stock</th>
                <th className="py-3 px-3 font-medium text-right">Reserved</th>
                <th className="py-3 px-3 font-medium text-right">Available Stock</th>
                <th className="py-3 px-3 font-medium text-right">Reorder Point</th>
                <th className="py-3 px-3 font-medium">Location</th>
                <th className="py-3 px-3 font-medium text-right">Status</th>
                <th className="py-3 px-4 font-medium text-right">Ledger Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {filteredBalances.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-zinc-500 font-mono">
                    No materials matching the selected criteria.
                  </td>
                </tr>
              ) : (
                filteredBalances.map((item) => {
                  const isStockCritical = item.status === 'CRITICAL';
                  const isStockLow = item.status === 'LOW_STOCK';

                  return (
                    <tr
                      key={item.materialId}
                      className="hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span className="font-bold text-amber-400">
                          {item.materialCode}
                        </span>
                        <div className="text-[10px] text-zinc-500">
                          {item.transactionCount} transactions
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-sans font-semibold text-zinc-200">
                          {item.name}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {item.category}
                        </div>
                      </td>

                      {/* Physical Stock */}
                      <td className="py-3 px-3 text-right tabular-nums">
                        <span className="font-bold text-zinc-100">
                          {item.physicalStock.toLocaleString()}
                        </span>{' '}
                        <span className="text-[10px] text-zinc-500 font-normal">{item.unit}</span>
                      </td>

                      {/* Reserved Stock */}
                      <td className="py-3 px-3 text-right tabular-nums">
                        <span className={`font-semibold ${item.reservedStock > 0 ? 'text-cyan-400' : 'text-zinc-500'}`}>
                          {item.reservedStock.toLocaleString()}
                        </span>{' '}
                        <span className="text-[10px] text-zinc-500 font-normal">{item.unit}</span>
                      </td>

                      {/* Available Stock */}
                      <td className="py-3 px-3 text-right tabular-nums">
                        <span className={`font-bold text-sm ${
                          isStockCritical
                            ? 'text-rose-400'
                            : isStockLow
                            ? 'text-amber-300'
                            : 'text-emerald-400'
                        }`}>
                          {item.availableStock.toLocaleString()}
                        </span>{' '}
                        <span className="text-[10px] text-zinc-500 font-normal">{item.unit}</span>
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-zinc-400">
                        {item.reorderPoint.toLocaleString()} {item.unit}
                      </td>

                      <td className="py-3 px-3 text-zinc-300">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <MapPin className="w-3 h-3 text-zinc-500 shrink-0" />
                          <span>{item.location}</span>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right">
                        {getStatusBadge(item.status)}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleOpenTxModal(item)}
                          className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-amber-400 hover:text-amber-300 rounded text-[11px] font-mono border border-zinc-700 transition-colors shadow-xs"
                        >
                          Post Tx
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

      {/* Post Ledger Transaction Modal */}
      {isTxModalOpen && selectedBalance && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleTransactionSubmit}
            className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-lg w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <div className="text-xs font-mono text-amber-400 uppercase tracking-wider font-semibold">
                  Post Ledger Transaction
                </div>
                <div className="text-base font-bold text-zinc-100">
                  {selectedBalance.materialCode} · {selectedBalance.name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTxModalOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Balances Breakdown */}
            <div className="grid grid-cols-3 gap-2 text-center p-3 rounded bg-zinc-950 border border-zinc-800 text-xs font-mono">
              <div className="p-1.5 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">Physical Stock</span>
                <span className="text-zinc-100 font-bold tabular-nums">
                  {selectedBalance.physicalStock} {selectedBalance.unit}
                </span>
              </div>
              <div className="p-1.5 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">Reserved Stock</span>
                <span className="text-cyan-400 font-bold tabular-nums">
                  {selectedBalance.reservedStock} {selectedBalance.unit}
                </span>
              </div>
              <div className="p-1.5 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">Available Stock</span>
                <span className="text-emerald-400 font-bold tabular-nums">
                  {selectedBalance.availableStock} {selectedBalance.unit}
                </span>
              </div>
            </div>

            {/* Error / Success Feedback */}
            {txError && (
              <div className="p-3 bg-rose-950/80 border border-rose-800 rounded text-rose-300 text-xs font-mono flex items-start gap-2">
                <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{txError}</span>
              </div>
            )}

            {txSuccess && (
              <div className="p-3 bg-emerald-950/80 border border-emerald-800 rounded text-emerald-300 text-xs font-mono flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{txSuccess}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Transaction Type *
                </label>
                <select
                  value={txType}
                  onChange={(e) => setTxType(e.target.value as InventoryTransactionType)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 font-mono focus:border-amber-500 focus:outline-hidden"
                >
                  <option value="PO_RECEIPT">PO_RECEIPT (+Physical, No change Reserved)</option>
                  <option value="ALLOCATION">ALLOCATION (No change Physical, +Reserved)</option>
                  <option value="DEALLOCATION">DEALLOCATION (No change Physical, -Reserved)</option>
                  <option value="CUTTING_ISSUE">CUTTING_ISSUE (-Physical, -Reserved)</option>
                  <option value="RETURN_TO_STORE">RETURN_TO_STORE (+Physical, No change Reserved)</option>
                  <option value="SCRAP_ADJUSTMENT">SCRAP_ADJUSTMENT (-Physical, No change Reserved)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                    Quantity ({selectedBalance.unit}) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    min="0.01"
                    placeholder="e.g. 50"
                    value={txQty}
                    onChange={(e) => setTxQty(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 font-mono focus:border-amber-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                    Reference ID (PO / Job #)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ORD-01 or CJ-01"
                    value={txRefId}
                    onChange={(e) => setTxRefId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 font-mono focus:border-amber-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Ledger Notes & Batch Information
                </label>
                <input
                  type="text"
                  placeholder="e.g. Floor allocation for cutting lay table 1"
                  value={txNotes}
                  onChange={(e) => setTxNotes(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 font-mono focus:border-amber-500 focus:outline-hidden"
                />
              </div>

              <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800/80 text-[11px] font-mono text-zinc-400 space-y-1">
                <div className="font-semibold text-zinc-300">Accounting Rules Enforced:</div>
                <div>• Never permits negative physical or available stock.</div>
                <div>• Cannot issue more than reserved stock.</div>
                <div>• Atomically commits with unique idempotency key.</div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsTxModalOpen(false)}
                className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingTx}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded text-xs font-bold font-mono transition-colors disabled:opacity-50"
              >
                {isSubmittingTx ? 'Validating Ledger...' : 'Post to Ledger'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add New Raw Material Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateMaterialSubmit}
            className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-lg w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <div className="text-xs font-mono text-amber-400 uppercase tracking-wider font-semibold">
                  Material SKU Registration
                </div>
                <div className="text-base font-bold text-zinc-100">
                  Register Material in Master Database
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  SKU / Material Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. RAW-COT-25"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 font-mono focus:border-amber-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Category *
                </label>
                <select
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value as MaterialCategory)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 font-mono focus:border-amber-500 focus:outline-hidden"
                >
                  <option value="Knitted Fabric">Knitted Fabric</option>
                  <option value="Woven Fabric">Woven Fabric</option>
                  <option value="Trims & Fasteners">Trims & Fasteners</option>
                  <option value="Threads & Notions">Threads & Notions</option>
                  <option value="Packaging">Packaging</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Material Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 100% Organic Bamboo Cotton Slub"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:border-amber-500 focus:outline-hidden"
                />
              </div>

              <div className="col-span-2">
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Technical Specification (GSM, Yarn, Coating)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 195 GSM · 40s/1 Yarn · 68in Width"
                  value={newSpec}
                  onChange={(e) => setNewSpec(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:border-amber-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Opening Receipt Quantity (PO_RECEIPT)
                </label>
                <input
                  type="number"
                  step="any"
                  value={newStock}
                  onChange={(e) => setNewStock(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 font-mono focus:border-amber-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Unit of Measure *
                </label>
                <select
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value as MaterialUnit)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 font-mono focus:border-amber-500 focus:outline-hidden"
                >
                  <option value="kg">kg (Kilograms)</option>
                  <option value="meters">meters (Yardage)</option>
                  <option value="pcs">pcs (Pieces)</option>
                  <option value="cones">cones (Spools)</option>
                  <option value="rolls">rolls</option>
                  <option value="gross">gross (144 pcs)</option>
                </select>
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Reorder Level Threshold
                </label>
                <input
                  type="number"
                  step="any"
                  value={newReorder}
                  onChange={(e) => setNewReorder(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 font-mono focus:border-amber-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Warehouse Location
                </label>
                <input
                  type="text"
                  placeholder="e.g. Zone A-08 / Rack 2"
                  value={newLoc}
                  onChange={(e) => setNewLoc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 font-mono focus:border-amber-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded text-xs font-bold font-mono transition-colors"
              >
                Register & Commit
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
