import React, { useState, useEffect } from 'react';
import { X, Save, AlertCircle, ShoppingBag, FileSpreadsheet } from 'lucide-react';
import { OrderEntity, OrderItemEntity, BuyerEntity, StyleEntity, OrderStatus } from '../../db/types';
import { OrderMatrixInput } from './OrderMatrixInput';

interface OrderCreateEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderToEdit?: OrderEntity | null;
  initialItems?: OrderItemEntity[];
  buyers: BuyerEntity[];
  styles: StyleEntity[];
  onSaveOrder: (
    order: Omit<OrderEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    items: OrderItemEntity[]
  ) => Promise<void>;
}

function generateOrderId(): string {
  return `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

function generateInternalOrderNumber(): string {
  return `SO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
}

function getDefaultExFactoryDate(): string {
  return new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

const EMPTY_ITEMS: OrderItemEntity[] = [];

export const OrderCreateEditModal: React.FC<OrderCreateEditModalProps> = ({
  isOpen,
  onClose,
  orderToEdit,
  initialItems = EMPTY_ITEMS,
  buyers,
  styles,
  onSaveOrder,
}) => {
  const isEditing = Boolean(orderToEdit);
  const [draftOrderId, setDraftOrderId] = useState<string>(() => generateOrderId());
  const targetOrderId = orderToEdit?.id || draftOrderId;

  // Form Fields
  const [poNumber, setPoNumber] = useState(orderToEdit?.poNumber || '');
  const [internalOrderNumber, setInternalOrderNumber] = useState(
    orderToEdit?.internalOrderNumber || generateInternalOrderNumber()
  );
  const [buyerId, setBuyerId] = useState(orderToEdit?.buyerId || buyers[0]?.id || '');
  const [styleId, setStyleId] = useState(orderToEdit?.styleId || styles[0]?.id || '');
  const [targetExFactoryDate, setTargetExFactoryDate] = useState(
    orderToEdit?.targetExFactoryDate || getDefaultExFactoryDate()
  );
  const [assignedLineId, setAssignedLineId] = useState(
    orderToEdit?.assignedLineId || 'LINE-01'
  );
  const [status, setStatus] = useState<OrderStatus>(orderToEdit?.status || 'DRAFT');
  const [notes, setNotes] = useState(orderToEdit?.notes || '');

  // Matrix State
  const [matrixItems, setMatrixItems] = useState<OrderItemEntity[]>(initialItems);
  const [grandTotalQty, setGrandTotalQty] = useState<number>(orderToEdit?.orderQuantity || 0);

  // Validation & Submitting
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Synchronize and reset form fields cleanly whenever modal opens or target order changes
  useEffect(() => {
    if (!isOpen) {
      setErrorMessage(null);
      setIsSubmitting(false);
      return;
    }

    if (orderToEdit) {
      setPoNumber(orderToEdit.poNumber || '');
      setInternalOrderNumber(orderToEdit.internalOrderNumber || '');
      setBuyerId(orderToEdit.buyerId || buyers[0]?.id || '');
      setStyleId(orderToEdit.styleId || styles[0]?.id || '');
      setTargetExFactoryDate(orderToEdit.targetExFactoryDate || getDefaultExFactoryDate());
      setAssignedLineId(orderToEdit.assignedLineId || 'LINE-01');
      setStatus(orderToEdit.status || 'DRAFT');
      setNotes(orderToEdit.notes || '');
      setMatrixItems(initialItems);
      setGrandTotalQty(
        initialItems.length > 0
          ? initialItems.reduce((sum, item) => sum + item.quantity, 0)
          : orderToEdit.orderQuantity || 0
      );
    } else {
      const defaultBuyerId = buyers[0]?.id || '';
      const matchingStyles = styles.filter((s) => s.buyerId === defaultBuyerId);
      const defaultStyleId = matchingStyles[0]?.id || styles[0]?.id || '';

      setDraftOrderId(generateOrderId());
      setPoNumber('');
      setInternalOrderNumber(generateInternalOrderNumber());
      setBuyerId(defaultBuyerId);
      setStyleId(defaultStyleId);
      setTargetExFactoryDate(getDefaultExFactoryDate());
      setAssignedLineId('LINE-01');
      setStatus('DRAFT');
      setNotes('');
      setMatrixItems([]);
      setGrandTotalQty(0);
    }

    setErrorMessage(null);
    setIsSubmitting(false);
  }, [isOpen, orderToEdit, initialItems]);

  // Backfill buyer/style selection if master data finishes loading after modal opens
  useEffect(() => {
    if (!isOpen || orderToEdit) return;
    if (!buyerId && buyers.length > 0) {
      const firstBuyerId = buyers[0].id;
      setBuyerId(firstBuyerId);
      const matchingStyle = styles.find((s) => s.buyerId === firstBuyerId) || styles[0];
      if (matchingStyle) {
        setStyleId(matchingStyle.id);
      }
    } else if (!styleId && styles.length > 0) {
      const matchingStyle = styles.find((s) => s.buyerId === buyerId) || styles[0];
      if (matchingStyle) {
        setStyleId(matchingStyle.id);
      }
    }
  }, [isOpen, orderToEdit, buyerId, styleId, buyers, styles]);

  // Available styles for selected buyer
  const selectedStyle = styles.find((s) => s.id === styleId);

  // When buyer changes, ensure styleId is updated if necessary
  const handleBuyerChange = (newBuyerId: string) => {
    setBuyerId(newBuyerId);
    const availableForBuyer = styles.filter((s) => s.buyerId === newBuyerId);
    if (availableForBuyer.length > 0) {
      setStyleId(availableForBuyer[0].id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!poNumber.trim()) {
      setErrorMessage('Buyer Purchase Order (PO) number is required.');
      return;
    }
    if (!buyerId) {
      setErrorMessage('Please select a valid buyer.');
      return;
    }
    if (!styleId) {
      setErrorMessage('Please select a garment style.');
      return;
    }
    if (!targetExFactoryDate) {
      setErrorMessage('Target Ex-Factory date is required.');
      return;
    }
    if (grandTotalQty <= 0) {
      setErrorMessage('Total order quantity must be greater than zero. Please enter quantities in the size breakdown matrix.');
      return;
    }

    const normalizedItems: OrderItemEntity[] = matrixItems.map((item) => ({
      ...item,
      id: `ITM-${targetOrderId}-${encodeURIComponent(item.color)}-${encodeURIComponent(item.size)}`,
      orderId: targetOrderId,
    }));

    try {
      setIsSubmitting(true);
      await onSaveOrder(
        {
          id: targetOrderId,
          poNumber: poNumber.trim().toUpperCase(),
          internalOrderNumber: internalOrderNumber.trim().toUpperCase(),
          buyerId,
          styleId,
          orderQuantity: grandTotalQty,
          producedQuantity: orderToEdit?.producedQuantity || 0,
          targetExFactoryDate,
          status,
          assignedLineId,
          dhuPercent: orderToEdit?.dhuPercent || 1.8,
          notes: notes.trim(),
          isSimulated: true,
        },
        normalizedItems
      );
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to save purchase order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-4xl w-full my-auto shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-zinc-800 bg-zinc-950/60 rounded-t-lg">
          <div>
            <div className="text-[11px] font-mono text-amber-400 uppercase tracking-wider font-semibold flex items-center gap-2">
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>{isEditing ? 'Modify Purchase Order' : 'Commercial Merchandising'}</span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center gap-2 mt-0.5">
              <span>{isEditing ? `Edit PO: ${orderToEdit?.poNumber}` : 'New Apparel Purchase Order'}</span>
              <span className="text-xs font-mono font-normal text-zinc-400">
                ({grandTotalQty.toLocaleString()} units)
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {errorMessage && (
            <div className="p-3 rounded bg-rose-950/50 border border-rose-800 text-rose-300 text-xs font-mono flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
            </div>
          )}

          {/* Section 1: Commercial Header Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Buyer PO Number *
              </label>
              <input
                type="text"
                required
                disabled={isEditing}
                placeholder="e.g. PO-99450"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono uppercase disabled:bg-zinc-900 disabled:text-zinc-500"
              />
            </div>

            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Internal Order # (SO)
              </label>
              <input
                type="text"
                placeholder="e.g. SO-2026-088"
                value={internalOrderNumber}
                onChange={(e) => setInternalOrderNumber(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono uppercase"
              />
            </div>

            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Buyer / Customer *
              </label>
              <select
                value={buyerId}
                onChange={(e) => handleBuyerChange(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
              >
                {buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} [{b.code}] · {b.country}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Garment Style *
              </label>
              <select
                value={styleId}
                onChange={(e) => setStyleId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
              >
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.styleCode} — {s.description} ({s.samMinutes}m)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Ex-Factory Date *
              </label>
              <input
                type="date"
                required
                value={targetExFactoryDate}
                onChange={(e) => setTargetExFactoryDate(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono"
              />
            </div>

            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Target Sewing Line
              </label>
              <select
                value={assignedLineId}
                onChange={(e) => setAssignedLineId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono"
              >
                <option value="LINE-01">LINE-01 (Fleece Sweatshirts)</option>
                <option value="LINE-02">LINE-02 (Jersey Knit T-Shirts)</option>
                <option value="LINE-03">LINE-03 (Woven Utility Cargo)</option>
                <option value="LINE-04">LINE-04 (Pique Polo Shirts)</option>
                <option value="LINE-05">LINE-05 (Seamless Activewear)</option>
              </select>
            </div>

            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Initial Lifecycle Status
              </label>
              <select
                value={status}
                disabled={isEditing}
                onChange={(e) => setStatus(e.target.value as OrderStatus)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono"
              >
                <option value="DRAFT">DRAFT (Pending Approval)</option>
                <option value="CONFIRMED">CONFIRMED (Factory Order Released)</option>
              </select>
            </div>

            <div>
              <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                Total Order Quantity
              </label>
              <div className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-amber-400 font-mono font-bold tabular-nums">
                {grandTotalQty.toLocaleString()} pcs
              </div>
            </div>
          </div>

          {/* Style Reference Spec Card */}
          {selectedStyle && (
            <div className="p-3 rounded bg-zinc-950/70 border border-zinc-800 text-xs flex flex-wrap items-center justify-between gap-3 font-mono">
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">Fabric Spec:</span>
                <span className="text-zinc-200 font-semibold">{selectedStyle.fabricClassification}</span>
              </div>
              <div className="flex items-center gap-4">
                <span>
                  <span className="text-zinc-500 mr-1.5">SAM:</span>
                  <span className="text-zinc-200 font-bold">{selectedStyle.samMinutes} mins</span>
                </span>
                <span>
                  <span className="text-zinc-500 mr-1.5">Category:</span>
                  <span className="text-zinc-300">{selectedStyle.productType || selectedStyle.garmentType}</span>
                </span>
                <span>
                  <span className="text-zinc-500 mr-1.5">Gender:</span>
                  <span className="text-zinc-300">{selectedStyle.genderCategory || 'Unisex'}</span>
                </span>
              </div>
            </div>
          )}

          {/* Section 2: Size & Colour Breakdown Matrix */}
          <div className="pt-2">
            <OrderMatrixInput
              orderId={targetOrderId}
              initialItems={initialItems}
              onChange={(items, total) => {
                setMatrixItems(items);
                setGrandTotalQty(total);
              }}
            />
          </div>

          {/* Section 3: Notes / Special Instructions */}
          <div>
            <label className="block font-mono text-zinc-400 text-[11px] mb-1">
              Merchandising Notes & Quality Standard Instructions
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Pre-production gold seal required before cutting. Needle detector certificate mandatory for packing."
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded p-2 text-xs text-zinc-200 font-sans"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
            <span className="text-xs font-mono text-zinc-500">
              {isEditing ? 'Editing existing order parameters' : 'New order will be committed to IndexedDB'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 rounded text-xs font-bold font-mono flex items-center gap-2 transition-colors shadow-sm"
              >
                <Save className="w-4 h-4 stroke-[2.5]" />
                <span>{isSubmitting ? 'Saving Order...' : isEditing ? 'Update Purchase Order' : 'Save Purchase Order'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
