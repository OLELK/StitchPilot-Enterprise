import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { CostSheetEntity } from '../../db/types';

export type CostSheetWorkflowActionMode = 'approve' | 'reject';

interface CostSheetWorkflowModalProps {
  isOpen: boolean;
  mode: CostSheetWorkflowActionMode;
  costSheet: CostSheetEntity | null;
  styleCode?: string;
  poNumber?: string;
  hasExistingApprovedVersion?: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirmApprove: (approvedBy: string) => Promise<void> | void;
  onConfirmReject: (rejectionReason: string) => Promise<void> | void;
}

export const CostSheetWorkflowModal: React.FC<CostSheetWorkflowModalProps> = ({
  isOpen,
  mode,
  costSheet,
  styleCode,
  poNumber,
  hasExistingApprovedVersion = false,
  isSubmitting = false,
  onClose,
  onConfirmApprove,
  onConfirmReject,
}) => {
  const [approverName, setApproverName] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setApproverName('');
      setRejectionReason('');
      setValidationError(null);
    }
  }, [isOpen, mode, costSheet?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !costSheet) return null;

  const isApprove = mode === 'approve';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (isApprove) {
      const trimmed = approverName.trim();
      if (!trimmed) {
        setValidationError('Approver name is required to approve a cost sheet.');
        return;
      }
      try {
        await onConfirmApprove(trimmed);
      } catch (err: any) {
        setValidationError(err?.message || 'Failed to approve cost sheet.');
      }
    } else {
      const trimmed = rejectionReason.trim();
      if (!trimmed) {
        setValidationError('A rejection reason is required when rejecting a cost sheet.');
        return;
      }
      try {
        await onConfirmReject(trimmed);
      } catch (err: any) {
        setValidationError(err?.message || 'Failed to reject cost sheet.');
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="costing-workflow-modal-title"
      data-testid="costing-workflow-modal"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            {isApprove ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <div>
              <h2
                id="costing-workflow-modal-title"
                className="text-sm font-bold text-zinc-100"
              >
                {isApprove ? 'Approve Cost Sheet' : 'Reject Cost Sheet'}
              </h2>
              <div className="text-xs font-mono text-zinc-400 mt-0.5 flex items-center gap-2">
                <span>{costSheet.id}</span>
                <span aria-hidden="true">·</span>
                <span>v{costSheet.version}</span>
                {styleCode && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{styleCode}</span>
                  </>
                )}
                {poNumber && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{poNumber}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close modal"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Financial snapshot confirmation */}
          <div className="grid grid-cols-3 gap-3 p-3 rounded-md bg-zinc-950 border border-zinc-800 text-xs font-mono tabular-nums">
            <div>
              <div className="text-zinc-400 text-[11px]">Total Cost / Pc</div>
              <div className="text-zinc-100 font-semibold mt-0.5">
                {costSheet.currency} {costSheet.totalCostPerGarment.toFixed(4)}
              </div>
            </div>
            <div>
              <div className="text-zinc-400 text-[11px]">Quoted FOB / Pc</div>
              <div className="text-amber-300 font-semibold mt-0.5">
                {costSheet.currency} {costSheet.quotedFobPrice.toFixed(4)}
              </div>
            </div>
            <div>
              <div className="text-zinc-400 text-[11px]">Gross Margin</div>
              <div className="text-emerald-400 font-semibold mt-0.5">
                {costSheet.marginPercent.toFixed(2)}%
              </div>
            </div>
          </div>

          {isApprove && hasExistingApprovedVersion && (
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                Approving version <span className="font-mono font-semibold">v{costSheet.version}</span>{' '}
                will automatically mark the previously approved cost sheet in this{' '}
                {costSheet.orderId ? 'style/order' : 'style'} context as{' '}
                <span className="font-mono font-semibold">SUPERSEDED</span>. All historical
                figures and approval timestamps on the superseded record remain preserved.
              </div>
            </div>
          )}

          {isApprove ? (
            <div className="space-y-1.5">
              <label
                htmlFor="costing-approver-input"
                className="block text-xs font-medium text-zinc-200"
              >
                Approver Name <span className="text-rose-400">*</span>
              </label>
              <input
                id="costing-approver-input"
                data-testid="workflow-approver-input"
                type="text"
                value={approverName}
                onChange={(e) => {
                  setApproverName(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="e.g. Farhan Kabir (Costing Head)"
                disabled={isSubmitting}
                className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
              />
              <p className="text-[11px] text-zinc-400">
                Once approved, this cost sheet becomes immutable. Future adjustments require
                creating a new revision.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="costing-rejection-reason-input"
                className="block text-xs font-medium text-zinc-200"
              >
                Rejection Reason <span className="text-rose-400">*</span>
              </label>
              <textarea
                id="costing-rejection-reason-input"
                data-testid="workflow-rejection-reason-input"
                rows={3}
                value={rejectionReason}
                onChange={(e) => {
                  setRejectionReason(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="Explain pricing, consumption, wastage, or margin concerns..."
                disabled={isSubmitting}
                className="w-full px-3 py-2 rounded-md bg-zinc-950 border border-zinc-700 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 resize-none"
              />
              <p className="text-[11px] text-zinc-400">
                Rejected sheets remain locked until explicitly reopened as Draft or branched
                into a new revision.
              </p>
            </div>
          )}

          {validationError && (
            <div
              role="alert"
              data-testid="workflow-modal-error"
              className="p-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300"
            >
              {validationError}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid={
                isApprove ? 'workflow-confirm-approve-btn' : 'workflow-confirm-reject-btn'
              }
              className={`px-4 py-2 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 ${
                isApprove
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-rose-600 hover:bg-rose-500 text-white'
              }`}
            >
              {isSubmitting
                ? isApprove
                  ? 'Approving...'
                  : 'Rejecting...'
                : isApprove
                ? 'Confirm Approval'
                : 'Confirm Rejection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
