import { useState, useEffect, useCallback } from 'react';
import {
  orderRepo,
  productionRepo,
  inventoryRepo,
  qualityRepo,
  masterRepo,
} from '../repositories';
import { ProductionMetric, HourlyProduction, LineFloorStatus } from '../../types';

export function useDashboardData(isDbReady: boolean) {
  const [metrics, setMetrics] = useState<ProductionMetric[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyProduction[]>([]);
  const [lines, setLines] = useState<LineFloorStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    if (!isDbReady) return;
    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch live metrics from IndexedDB repositories concurrently
      const [
        orders,
        totalProducedPcs,
        materials,
        stockBalances,
        qualityStats,
        hourlySummary,
        dbLines,
      ] = await Promise.all([
        orderRepo.getAllOrders(),
        productionRepo.getTotalProductionOutput(),
        inventoryRepo.getAllMaterials(),
        inventoryRepo.getAllStockBalances(),
        qualityRepo.getQualityDhuMetric(),
        productionRepo.getHourlyProductionSummary(),
        productionRepo.getAllLines(),
      ]);

      // Count order stages
      const inSewing = orders.filter((o) => o.status === 'SEWING').length;
      const inCutting = orders.filter((o) => o.status === 'CUTTING').length;
      const inFinishing = orders.filter((o) => o.status === 'FINISHING').length;

      // Count inventory statuses from calculated balances
      const lowStockCount = stockBalances.filter((b) => b.status === 'LOW_STOCK').length;
      const criticalCount = stockBalances.filter((b) => b.status === 'CRITICAL').length;
      const inStockCount = stockBalances.filter((b) => b.status === 'IN_STOCK').length;

      // Build live metric cards
      const computedMetrics: ProductionMetric[] = [
        {
          id: 'total_orders',
          title: 'Total Active Orders',
          value: `${orders.length}`,
          unit: 'POs in database',
          subtitle: `${inSewing} in sewing · ${inCutting} in cutting · ${inFinishing} in finishing`,
          benchmark: 'Persisted in IndexedDB',
          status: 'nominal',
          change: 'Real-time ledger',
        },
        {
          id: 'production_output',
          title: 'Production Output',
          value: totalProducedPcs.toLocaleString(),
          unit: 'pcs',
          subtitle: 'Daily target: 10,000 pcs (Shift A events)',
          benchmark: `${Math.round((totalProducedPcs / 10000) * 100 * 10) / 10}% target achievement`,
          status: 'positive',
          change: 'Sum of production_events',
        },
        {
          id: 'inventory_items',
          title: 'Tracked Materials',
          value: `${materials.length}`,
          unit: 'ledger SKUs',
          subtitle: `${inStockCount} in stock · ${lowStockCount} low buffer · ${criticalCount} critical`,
          benchmark: 'Calculated from ledger txs',
          status: lowStockCount > 0 || criticalCount > 0 ? 'warning' : 'nominal',
          change: `${stockBalances.reduce((acc, b) => acc + b.transactionCount, 0)} transactions posted`,
        },
        {
          id: 'quality_dhu',
          title: 'Quality DHU',
          value: qualityStats.averageDhu.toFixed(1),
          unit: 'defects/100 pcs',
          subtitle: `Based on ${qualityStats.totalDefects} defects in ${qualityStats.totalInspected} pcs`,
          benchmark: qualityStats.averageDhu <= 3.0 ? 'Within tolerance' : '+0.2 above 3.0 target',
          status: qualityStats.averageDhu > 3.0 ? 'alert' : 'positive',
          change: 'From quality_inspections',
        },
      ];

      setMetrics(computedMetrics);
      setHourlyData(hourlySummary);

      // Map lines to floor display format
      const formattedLines: LineFloorStatus[] = [];
      for (const line of dbLines) {
        let buyerName = 'Simulated Buyer';
        let styleCode = 'ST-000';
        let itemType = line.section;

        if (line.activeOrderId) {
          const order = await orderRepo.getOrderById(line.activeOrderId);
          if (order) {
            const buyer = await masterRepo.getBuyerById(order.buyerId);
            const style = await masterRepo.getStyleById(order.styleId);
            if (buyer) buyerName = buyer.name.split('(')[0].trim();
            if (style) {
              styleCode = style.styleCode;
              itemType = style.garmentType;
            }
          }
        }

        let lineStatus: LineFloorStatus['status'] = 'running';
        if (line.status === 'NEEDLE_CHANGE') lineStatus = 'needle-change';
        if (line.status === 'MATERIAL_WAIT') lineStatus = 'material-wait';
        if (line.status === 'MAINTENANCE') lineStatus = 'maintenance';

        formattedLines.push({
          lineId: line.id,
          lineName: line.name,
          buyer: buyerName,
          styleCode,
          itemType,
          targetPcsHr: Math.round(line.capacityPcsPerHour * 0.95),
          actualPcsHr: line.capacityPcsPerHour,
          efficiencyPercent: 96.5,
          dhuPercent: 2.4,
          activeOperators: line.activeOperatorCount,
          status: lineStatus,
        });
      }

      setLines(formattedLines);
    } catch (err: any) {
      console.error('[useDashboardData] Query Error:', err);
      setError(err?.message || 'Failed to query dashboard metrics from IndexedDB.');
    } finally {
      setIsLoading(false);
    }
  }, [isDbReady]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return {
    metrics,
    hourlyData,
    lines,
    isLoading,
    error,
    refreshDashboard: fetchDashboardData,
  };
}
