import { useState, useEffect, useCallback } from 'react';
import {
  orderRepo,
  productionRepo,
  inventoryRepo,
  qualityRepo,
  masterRepo,
} from '../repositories';
import {
  DashboardSummaryMeta,
  HourlyProduction,
  LineFloorStatus,
  PlantSettings,
  ProductionMetric,
} from '../../types';
import { buildDashboardSnapshot } from '../services/dashboardService';

export function useDashboardData(isDbReady: boolean, plantSettings: PlantSettings) {
  const [metrics, setMetrics] = useState<ProductionMetric[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyProduction[]>([]);
  const [lines, setLines] = useState<LineFloorStatus[]>([]);
  const [summaryMeta, setSummaryMeta] = useState<DashboardSummaryMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    if (!isDbReady) return;
    setIsLoading(true);
    setError(null);

    try {
      const snapshot = await buildDashboardSnapshot(
        {
          orders: orderRepo,
          production: productionRepo,
          inventory: inventoryRepo,
          quality: qualityRepo,
          master: masterRepo,
        },
        plantSettings
      );

      setMetrics(snapshot.metrics);
      setHourlyData(snapshot.hourlyData);
      setLines(snapshot.lines);
      setSummaryMeta(snapshot.summaryMeta);
    } catch (err: any) {
      console.error('[useDashboardData] Query Error:', err);
      setError(err?.message || 'Failed to query dashboard metrics from IndexedDB.');
    } finally {
      setIsLoading(false);
    }
  }, [isDbReady, plantSettings]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return {
    metrics,
    hourlyData,
    lines,
    summaryMeta,
    isLoading,
    error,
    refreshDashboard: fetchDashboardData,
  };
}
