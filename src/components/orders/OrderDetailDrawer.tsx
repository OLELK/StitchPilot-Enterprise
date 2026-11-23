import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  CheckCircle,
  AlertTriangle,
  Scissors,
  Layers,
  Edit,
  Ban,
  Calendar,
  Building,
  Shirt,
  FileText,
  Activity,
  History,
} from 'lucide-react';
import { OrderEntity, OrderItemEntity, OrderStatus } from '../../db/types';
import { OrderWithDetails } from '../../db/hooks/useOrdersData';

interface OrderDetailDrawerProps {
  order: OrderWithDetails | null;
  onClose: () => void;
  onEdit: (order: OrderWithDetails) => void;
  onUpdateStatus: (orderId: string, status: OrderStatus, reason?: string) => Promise<void>;
  onCancelOrder: (orderId: string, reason: string) => Promise<void>;
  fetchItems: (orderId: string) => Promise<OrderItemEntity[]>;
}

export const OrderDetailDrawer: React.FC<OrderDetailDrawerProps> = ({
  order,
  onClose,
  onEdit,
  onUpdateStatus,
  onCancelOrder,
  fetchItems,
}) => {
  const [items, setItems] = useState<OrderItemEntity[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const orderId = order?.id;

  useEffect(() => {
    if (!orderId) {
      setItems([]);
      setIsLoadingItems(false);
      setIsCancelConfirmOpen(false);
      setCancelReason('');
      setActionError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingItems(true);
    setActionError(null);
    setIsCancelConfirmOpen(false);
    setCancelReason('');

    fetchItems(orderId)
      .then((res) => {
        if (!cancelled) {
          setItems(res);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingItems(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, fetchItems]);

  if (!order) return null;

  // Aggregate items by colour and size
  const distinctColours = Array.from(new Set(items.map((i) => i.color)));
  const distinctSizes = Array.from(new Set(items.map((i) => i.size)));

  const handleStatusChange = async (newStatus: OrderStatus, note: string) => {
    try {
      setActionError(null);
      setIsProcessing(true);
      await onUpdateStatus(order.id, newStatus, note);
    } catch (err: any) {
      setActionError(err?.message || 'Status transition failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelReason.trim()) {
      setActionError('Cancellation reason is required for compliance audit trail.');
      return;
    }
    try {
      setActionError(null);
      setIsProcessing(true);
      await onCancelOrder(order.id, cancelReason);
      setIsCancelConfirmOpen(false);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to cancel order.');
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusBadge = (st: OrderStatus) => {
    switch (st) {
      case 'DRAFT':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
            DRAFT
          </span>
        );
      case 'CONFIRMED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-blue-950/80 text-blue-300 border border-blue-800/80">
            CONFIRMED
          </span>
        );
      case 'IN_PRODUCTION':
      case 'SEWING':
      case 'CUTTING':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {st}
          </span>
        );
      case 'PARTIALLY_SHIPPED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-cyan-950/80 text-cyan-300 border border-cyan-800/80">
            PARTIALLY SHIPPED
          </span>
        );
      case 'COMPLETED':
      case 'SHIPPED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-purple-950/80 text-purple-300 border border-purple-800/80">
            COMPLETED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-rose-950/90 text-rose-300 border border-rose-800">
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-xs font-mono text-zinc-300 bg-zinc-800 border border-zinc-700">
            {st}
          </span>
        );
    }
  };

  const progressPercent = Math.min(
    100,
    Math.round((order.producedQuantity / order.orderQuantity) * 100)
  );

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex justify-end">
      <div className="bg-zinc-900 border-l border-zinc-700 w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 bg-zinc-950/80 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold text-amber-400">
                PO: {order.poNumber}
              </span>
              {order.internalOrderNumber && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {order.internalOrderNumber}
                </span>
              )}
              {getStatusBadge(order.status)}
            </div>
            <div className="text-base font-bold text-zinc-100 flex items-center gap-2 mt-1">
              <span>{order.buyerName}</span>
              <span className="text-zinc-500 font-normal">·</span>
              <span className="text-xs font-mono text-amber-300">{order.styleCode}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {order.status !== 'CANCELLED' && (
              <button
                type="button"
                onClick={() => onEdit(order)}
                className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs font-mono flex items-center gap-1.5 transition-colors border border-zinc-700"
              >
                <Edit className="w-3.5 h-3.5 text-amber-400" />
                Edit
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Error Banner */}
        {actionError && (
          <div className="p-3 bg-rose-950/80 border-b border-rose-800 text-rose-200 text-xs font-mono flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <div className="flex-1">{actionError}</div>
          </div>
        )}

        {/* Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {/* Top Overview Key Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
            <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px]">Order Quantity</span>
              <span className="text-zinc-100 font-bold text-sm tabular-nums">
                {order.orderQuantity.toLocaleString()} pcs
              </span>
            </div>
            <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px]">Produced Output</span>
              <span className="text-emerald-400 font-bold text-sm tabular-nums">
                {order.producedQuantity.toLocaleString()} pcs
              </span>
            </div>
            <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px]">Ex-Factory Date</span>
              <span className="text-zinc-100 font-bold text-sm tabular-nums">
                {order.targetExFactoryDate}
              </span>
            </div>
            <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800">
              <span className="text-zinc-500 block text-[10px]">Standard SAM</span>
              <span className="text-amber-300 font-bold text-sm tabular-nums">
                {order.samMinutes} mins
              </span>
            </div>
          </div>

          {/* Garment & Line Details */}
          <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs space-y-2">
            <div className="text-[11px] font-mono font-semibold text-zinc-400 uppercase tracking-wider">
              Garment Technical Specifications
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-zinc-300">
              <div>
                <span className="text-zinc-500 mr-2 font-mono">Style Code:</span>
                <span className="font-mono text-amber-300 font-bold">{order.styleCode}</span>
              </div>
              <div>
                <span className="text-zinc-500 mr-2 font-mono">Description:</span>
                <span>{order.styleDescription}</span>
              </div>
              <div className="col-span-2">
                <span className="text-zinc-500 mr-2 font-mono">Fabric Spec:</span>
                <span>{order.fabricSpec}</span>
              </div>
              <div>
                <span className="text-zinc-500 mr-2 font-mono">Production Line:</span>
                <span className="font-mono">{order.assignedLineId}</span>
              </div>
              <div>
                <span className="text-zinc-500 mr-2 font-mono">Floor DHU Rate:</span>
                <span className="font-mono text-zinc-100">{order.dhuPercent}%</span>
              </div>
            </div>
            {order.notes && (
              <div className="pt-2 border-t border-zinc-900 text-zinc-400 text-[11px]">
                <span className="text-zinc-500 font-mono block mb-0.5">Notes:</span>
                {order.notes}
              </div>
            )}
          </div>

          {/* Size-wise Matrix Breakdown Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono font-semibold text-zinc-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                <span>Size-Wise Breakdown Ledger</span>
              </div>
              <span className="text-[11px] font-mono text-zinc-500">
                {items.length} matrix SKU records
              </span>
            </div>

            {isLoadingItems ? (
              <div className="py-6 text-center text-xs text-zinc-500 font-mono">
                Loading SKU breakdown items...
              </div>
            ) : items.length === 0 ? (
              <div className="p-4 rounded bg-zinc-950 border border-zinc-800 text-center text-xs text-zinc-500 font-mono">
                No size breakdown items recorded.
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-400 text-[11px]">
                      <th className="py-2 px-3">Colourway</th>
                      {distinctSizes.map((sz) => (
                        <th key={sz} className="py-2 px-2 text-center">
                          {sz}
                        </th>
                      ))}
                      <th className="py-2 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {distinctColours.map((color) => {
                      const colorItems = items.filter((i) => i.color === color);
                      const colorTotal = colorItems.reduce((acc, i) => acc + i.quantity, 0);

                      return (
                        <tr key={color} className="hover:bg-zinc-900/40">
                          <td className="py-2 px-3 font-sans text-zinc-200">{color}</td>
                          {distinctSizes.map((sz) => {
                            const found = colorItems.find((i) => i.size === sz);
                            return (
                              <td key={sz} className="py-2 px-2 text-center tabular-nums text-zinc-300">
                                {found ? found.quantity.toLocaleString() : '-'}
                              </td>
                            );
                          })}
                          <td className="py-2 px-3 text-right tabular-nums font-bold text-amber-300">
                            {colorTotal.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Lifecycle Status History Audit Trail */}
          <div className="space-y-2">
            <div className="text-xs font-mono font-semibold text-zinc-300 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-cyan-400" />
              <span>Lifecycle Status Audit Trail</span>
            </div>

            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 space-y-3">
              {(!order.statusHistory || order.statusHistory.length === 0) ? (
                <div className="text-xs text-zinc-500 font-mono">
                  No status transition history recorded.
                </div>
              ) : (
                <div className="space-y-2 font-mono text-xs">
                  {order.statusHistory.map((entry, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-amber-400">
                          {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                          {entry.toStatus}
                        </span>
                        <span className="text-zinc-500 text-[10px]">
                          {new Date(entry.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-zinc-300 text-[11px] font-sans">
                        {entry.note || 'Status updated'}
                      </div>
                      {entry.updatedBy && (
                        <div className="text-[10px] text-zinc-500">
                          Recorded by: <span className="text-zinc-400">{entry.updatedBy}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Cancel Order Section / Notice */}
          {order.status === 'CANCELLED' && (
            <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/80 text-xs font-mono text-rose-300 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-rose-400">
                <Ban className="w-4 h-4" />
                <span>TERMINATED PURCHASE ORDER</span>
              </div>
              <p className="text-[11px] text-rose-300/90 font-sans">
                This purchase order has been cancelled. In accordance with apparel manufacturing compliance rules, cancelled orders cannot be reopened or released to the cutting and sewing floors.
              </p>
            </div>
          )}
        </div>

        {/* Footer Lifecycle Transitions */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {order.status === 'DRAFT' && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() =>
                  handleStatusChange(
                    'CONFIRMED',
                    'Purchase Order verified and confirmed by commercial merchandising'
                  )
                }
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold font-mono transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Confirm Order
              </button>
            )}

            {order.status === 'CONFIRMED' && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() =>
                  handleStatusChange(
                    'IN_PRODUCTION',
                    'Fabric lots approved; order released to factory cutting floor'
                  )
                }
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold font-mono transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Scissors className="w-3.5 h-3.5" />
                Release to Production
              </button>
            )}

            {order.status === 'IN_PRODUCTION' && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() =>
                  handleStatusChange(
                    'COMPLETED',
                    'Final cartons inspected, audit passed, and shipped ex-factory'
                  )
                }
                className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-bold font-mono transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Complete Shipment
              </button>
            )}

            {order.status !== 'CANCELLED' && order.status !== 'COMPLETED' && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setIsCancelConfirmOpen(true)}
                className="px-3 py-2 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded text-xs font-mono transition-colors flex items-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5 text-rose-400" />
                Cancel Order
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono transition-colors ml-auto"
          >
            Close Drawer
          </button>
        </div>

        {/* Cancellation Confirmation Modal */}
        {isCancelConfirmOpen && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-60 flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-rose-800/80 rounded-lg max-w-md w-full p-5 space-y-4 shadow-2xl">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-sm font-mono">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>Confirm Purchase Order Cancellation</span>
              </div>

              <p className="text-xs text-zinc-300">
                Are you sure you want to cancel order <span className="font-mono font-bold text-amber-300">{order.poNumber}</span>?
                Cancelled orders <span className="text-rose-400 font-semibold">cannot proceed into production workflows</span> or be reopened.
              </p>

              <div>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Cancellation Reason (Required for audit log) *
                </label>
                <textarea
                  rows={2}
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Buyer changed seasonal plan / Fabric mill delivery delay"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-rose-500 rounded p-2 text-xs text-zinc-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsCancelConfirmOpen(false)}
                  className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono"
                >
                  Keep Order
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleConfirmCancel}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold font-mono transition-colors"
                >
                  {isProcessing ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
