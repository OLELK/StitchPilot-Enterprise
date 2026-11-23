import { useState, useCallback } from 'react';
import {
  mrpService,
  OrderMrpResult,
  MultiOrderMrpResult,
  GenerateOrderMrpOptions,
  GenerateMultiOrderMrpOptions,
} from '../services/mrpService';
import { masterRepo, cuttingRepo } from '../repositories';
import { CuttingJobEntity } from '../types';
import { BomVersionSummary } from './useBomData';

export interface MrpErrorState {
  message: string;
  code?: string;
  field?: string;
  styleId?: string;
}

/**
 * Strictly READ-ONLY React hook wrapping OrderMrpService, MasterRepository
 * (BOM version lookup), and CuttingRepository (cutting job metadata lookup).
 *
 * Performs ZERO database writes, ZERO inventory allocations, and ZERO
 * duplicate MRP formula calculations.
 */
export function useOrderMrp() {
  const [singleResult, setSingleResult] = useState<OrderMrpResult | null>(null);
  const [singleCuttingJobs, setSingleCuttingJobs] = useState<CuttingJobEntity[]>([]);
  const [multiResult, setMultiResult] = useState<MultiOrderMrpResult | null>(null);
  const [multiCuttingJobsByOrder, setMultiCuttingJobsByOrder] = useState<
    Record<string, CuttingJobEntity[]>
  >({});
  const [styleVersions, setStyleVersions] = useState<BomVersionSummary[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState<boolean>(false);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [error, setError] = useState<MrpErrorState | null>(null);

  const loadStyleBomVersions = useCallback(async (styleId: string | null) => {
    if (!styleId) {
      setStyleVersions([]);
      return;
    }
    setIsLoadingVersions(true);
    try {
      const versions = await masterRepo.getBomVersionsByStyle(styleId);
      setStyleVersions(versions);
    } catch {
      setStyleVersions([]);
    } finally {
      setIsLoadingVersions(false);
    }
  }, []);

  const calculateSingleOrderMrp = useCallback(
    async (
      orderId: string,
      options?: GenerateOrderMrpOptions
    ): Promise<OrderMrpResult | null> => {
      if (!orderId || !orderId.trim()) {
        setError({
          message: 'Select a purchase order before calculating Order MRP.',
          field: 'orderId',
        });
        setSingleResult(null);
        setSingleCuttingJobs([]);
        return null;
      }

      setIsCalculating(true);
      setError(null);
      try {
        const [result, jobs] = await Promise.all([
          mrpService.generateOrderMrp(orderId, options),
          cuttingRepo.getCuttingJobsByOrder(orderId),
        ]);
        setSingleResult(result);
        setSingleCuttingJobs(jobs);
        return result;
      } catch (err: any) {
        const details = err?.details;
        setError({
          message: err?.message || 'Failed to calculate Order MRP.',
          code: err?.code,
          field: err?.field,
          styleId: typeof details?.styleId === 'string' ? details.styleId : undefined,
        });
        setSingleResult(null);
        setSingleCuttingJobs([]);
        return null;
      } finally {
        setIsCalculating(false);
      }
    },
    []
  );

  const calculateMultiOrderMrp = useCallback(
    async (
      orderIds: string[],
      options?: GenerateMultiOrderMrpOptions
    ): Promise<MultiOrderMrpResult | null> => {
      if (!orderIds || orderIds.length === 0) {
        setError({
          message: 'Select at least one purchase order to run Consolidated MRP.',
          field: 'orderIds',
        });
        setMultiResult(null);
        setMultiCuttingJobsByOrder({});
        return null;
      }

      setIsCalculating(true);
      setError(null);
      try {
        const result = await mrpService.generateMultiOrderMrp(orderIds, options);
        const jobsEntries = await Promise.all(
          result.includedOrderIds.map(async (ordId) => {
            const jobs = await cuttingRepo.getCuttingJobsByOrder(ordId);
            return [ordId, jobs] as const;
          })
        );
        const jobsMap: Record<string, CuttingJobEntity[]> = {};
        for (const [ordId, jobs] of jobsEntries) {
          jobsMap[ordId] = jobs;
        }
        setMultiResult(result);
        setMultiCuttingJobsByOrder(jobsMap);
        return result;
      } catch (err: any) {
        const details = err?.details;
        setError({
          message: err?.message || 'Failed to calculate Consolidated Multi-Order MRP.',
          code: err?.code,
          field: err?.field,
          styleId: typeof details?.styleId === 'string' ? details.styleId : undefined,
        });
        setMultiResult(null);
        setMultiCuttingJobsByOrder({});
        return null;
      } finally {
        setIsCalculating(false);
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);
  const clearResults = useCallback(() => {
    setSingleResult(null);
    setSingleCuttingJobs([]);
    setMultiResult(null);
    setMultiCuttingJobsByOrder({});
    setError(null);
  }, []);

  return {
    singleResult,
    singleCuttingJobs,
    multiResult,
    multiCuttingJobsByOrder,
    styleVersions,
    isLoadingVersions,
    isCalculating,
    error,
    loadStyleBomVersions,
    calculateSingleOrderMrp,
    calculateMultiOrderMrp,
    clearError,
    clearResults,
  };
}
