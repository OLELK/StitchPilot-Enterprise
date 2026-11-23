import { useState, useEffect, useCallback } from 'react';
import {
  costingRepo,
  masterRepo,
  CostingRepository,
  MasterRepository,
  CostSheetContext,
  CreateCostSheetInput,
  UpdateDraftCostSheetInput,
  CreateRevisionOptions,
} from '../repositories';
import {
  costingBomService,
  CostingBomService,
  ImportBomToCostingOptions,
  BomCostingImportResult,
} from '../services/costingBomService';
import { CostSheetEntity } from '../types';
import { BomVersionSummary } from './useBomData';

export interface UseCostingDataOptions {
  isDbReady: boolean;
  onDataMutated?: () => Promise<void> | void;
  costingRepository?: CostingRepository;
  masterRepository?: MasterRepository;
  bomService?: CostingBomService;
}

export interface CostingErrorState {
  message: string;
  code?: string;
  field?: string;
}

function toCostingError(err: any, fallback: string): CostingErrorState {
  return {
    message: err?.message || fallback,
    code: err?.code,
    field: err?.field,
  };
}

function sortCostSheetsDesc(sheets: CostSheetEntity[]): CostSheetEntity[] {
  return [...sheets].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    if (bTime !== aTime) return bTime - aTime;
    if (a.styleId !== b.styleId) return a.styleId.localeCompare(b.styleId);
    return b.version - a.version;
  });
}

/**
 * React hook wrapping CostingRepository, CostingBomService, and MasterRepository
 * (BOM version lookup only — NEVER legacy MasterRepository costing helpers).
 *
 * Performs zero calculation duplication and delegates all persistence, validation,
 * revisioning, and approval transitions strictly to CostingRepository.
 */
export function useCostingData({
  isDbReady,
  onDataMutated,
  costingRepository = costingRepo,
  masterRepository = masterRepo,
  bomService = costingBomService,
}: UseCostingDataOptions) {
  const [costSheets, setCostSheets] = useState<CostSheetEntity[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [error, setError] = useState<CostingErrorState | null>(null);

  const loadCostSheets = useCallback(async (): Promise<CostSheetEntity[]> => {
    if (!isDbReady) {
      setCostSheets([]);
      setIsLoading(false);
      return [];
    }

    setIsLoading(true);
    setError(null);
    try {
      const all = await costingRepository.getAllCostSheets();
      const sorted = sortCostSheetsDesc(all);
      setCostSheets(sorted);
      return sorted;
    } catch (err: any) {
      setError(toCostingError(err, 'Failed to load cost sheets.'));
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [isDbReady, costingRepository]);

  useEffect(() => {
    loadCostSheets();
  }, [loadCostSheets]);

  const notifyMutation = useCallback(async () => {
    await loadCostSheets();
    if (onDataMutated) {
      await onDataMutated();
    }
  }, [loadCostSheets, onDataMutated]);

  const getCostSheetById = useCallback(
    async (id: string): Promise<CostSheetEntity | undefined> => {
      return costingRepository.getCostSheetById(id);
    },
    [costingRepository]
  );

  const getVersionsForContext = useCallback(
    async (context: CostSheetContext): Promise<CostSheetEntity[]> => {
      return costingRepository.getCostSheetVersions(context);
    },
    [costingRepository]
  );

  const getStyleBomVersions = useCallback(
    async (styleId: string): Promise<BomVersionSummary[]> => {
      if (!styleId || !styleId.trim()) return [];
      return masterRepository.getBomVersionsByStyle(styleId);
    },
    [masterRepository]
  );

  const importBomForCosting = useCallback(
    async (options: ImportBomToCostingOptions): Promise<BomCostingImportResult> => {
      setError(null);
      try {
        return await bomService.importBomToCostingLines(options);
      } catch (err: any) {
        setError(toCostingError(err, 'Failed to import BOM components for costing.'));
        throw err;
      }
    },
    [bomService]
  );

  const createCostSheet = useCallback(
    async (input: CreateCostSheetInput): Promise<CostSheetEntity> => {
      setIsMutating(true);
      setError(null);
      try {
        const created = await costingRepository.createCostSheet(input);
        await notifyMutation();
        return created;
      } catch (err: any) {
        setError(toCostingError(err, 'Failed to create draft cost sheet.'));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [costingRepository, notifyMutation]
  );

  const updateDraftCostSheet = useCallback(
    async (
      costSheetId: string,
      updates: UpdateDraftCostSheetInput
    ): Promise<CostSheetEntity> => {
      setIsMutating(true);
      setError(null);
      try {
        const updated = await costingRepository.updateDraftCostSheet(costSheetId, updates);
        await notifyMutation();
        return updated;
      } catch (err: any) {
        setError(toCostingError(err, 'Failed to update draft cost sheet.'));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [costingRepository, notifyMutation]
  );

  const createRevision = useCallback(
    async (
      sourceCostSheetId: string,
      options?: CreateRevisionOptions
    ): Promise<CostSheetEntity> => {
      setIsMutating(true);
      setError(null);
      try {
        const revision = await costingRepository.createRevision(sourceCostSheetId, options);
        await notifyMutation();
        return revision;
      } catch (err: any) {
        setError(toCostingError(err, 'Failed to create cost sheet revision.'));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [costingRepository, notifyMutation]
  );

  const submitForApproval = useCallback(
    async (costSheetId: string): Promise<CostSheetEntity> => {
      setIsMutating(true);
      setError(null);
      try {
        const submitted = await costingRepository.submitForApproval(costSheetId);
        await notifyMutation();
        return submitted;
      } catch (err: any) {
        setError(toCostingError(err, 'Failed to submit cost sheet for approval.'));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [costingRepository, notifyMutation]
  );

  const approveCostSheet = useCallback(
    async (
      costSheetId: string,
      approvedBy: string
    ): Promise<{ approved: CostSheetEntity; superseded: CostSheetEntity[] }> => {
      setIsMutating(true);
      setError(null);
      try {
        const res = await costingRepository.approveCostSheet(costSheetId, approvedBy);
        await notifyMutation();
        return res;
      } catch (err: any) {
        setError(toCostingError(err, 'Failed to approve cost sheet.'));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [costingRepository, notifyMutation]
  );

  const rejectCostSheet = useCallback(
    async (costSheetId: string, rejectionReason: string): Promise<CostSheetEntity> => {
      setIsMutating(true);
      setError(null);
      try {
        const rejected = await costingRepository.rejectCostSheet(
          costSheetId,
          rejectionReason
        );
        await notifyMutation();
        return rejected;
      } catch (err: any) {
        setError(toCostingError(err, 'Failed to reject cost sheet.'));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [costingRepository, notifyMutation]
  );

  const reopenRejectedCostSheet = useCallback(
    async (costSheetId: string): Promise<CostSheetEntity> => {
      setIsMutating(true);
      setError(null);
      try {
        const reopened = await costingRepository.reopenRejectedCostSheet(costSheetId);
        await notifyMutation();
        return reopened;
      } catch (err: any) {
        setError(toCostingError(err, 'Failed to reopen rejected cost sheet.'));
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [costingRepository, notifyMutation]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    costSheets,
    isLoading,
    isMutating,
    error,
    clearError,
    refreshCostSheets: loadCostSheets,
    getCostSheetById,
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
  };
}
