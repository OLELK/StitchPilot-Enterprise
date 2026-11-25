import { RepositoryBundle } from '../repositories';
import {
  DashboardFloorNotice,
  DashboardSummaryMeta,
  HourlyProduction,
  LineFloorStatus,
  PlantSettings,
  ProductionMetric,
} from '../../types';
import { OrderStatus } from '../types';
import { filterEventsForShiftAndDate, formatLocalDate } from './shiftSchedule';

const CLOSED_ORDER_STATUSES = new Set<OrderStatus>(['COMPLETED', 'SHIPPED', 'CANCELLED']);
const IN_PRODUCTION_STATUSES = new Set<OrderStatus>([
  'IN_PRODUCTION',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'FINAL_QC',
  'PACKED',
]);

export interface DashboardSnapshot {
  metrics: ProductionMetric[];
  hourlyData: HourlyProduction[];
  lines: LineFloorStatus[];
  summaryMeta: DashboardSummaryMeta;
}

export interface DashboardSnapshotOptions {
  reportingDate?: string;
  now?: Date;
}

export async function buildDashboardSnapshot(
  repos: Pick<RepositoryBundle, 'orders' | 'production' | 'inventory' | 'quality' | 'master'>,
  plantSettings: PlantSettings,
  options?: DashboardSnapshotOptions
): Promise<DashboardSnapshot> {
  const [
    orders,
    allProductionEvents,
    dbLines,
    materials,
    stockBalances,
    qualityStats,
    inspections,
    allDefects,
    buyers,
    styles,
  ] = await Promise.all([
    repos.orders.getAllOrders(),
    repos.production.getAllProductionEvents(),
    repos.production.getAllLines(),
    repos.inventory.getAllMaterials(),
    repos.inventory.getAllStockBalances(),
    repos.quality.getQualityDhuMetric(),
    repos.quality.getAllInspections(),
    repos.quality.getAllDefects(),
    repos.master.getAllBuyers(),
    repos.master.getAllStyles(),
  ]);

  const ordersById = new Map(orders.map((o) => [o.id, o]));
  const buyersById = new Map(buyers.map((b) => [b.id, b]));
  const stylesById = new Map(styles.map((s) => [s.id, s]));

  // Scope hourly production events strictly to configured shift, single reporting date, and non-future intervals
  const now = options?.now ?? new Date();
  const todayLocal = formatLocalDate(now);
  const allHourlyEvents = allProductionEvents.filter((ev) => ev.eventType === 'HOURLY_OUTPUT');
  const { shift, reportingDate, slots, shiftEvents } = filterEventsForShiftAndDate(
    allHourlyEvents,
    plantSettings.activeShift,
    { reportingDate: options?.reportingDate, now }
  );

  const isHistoricalDate = reportingDate < todayLocal;
  const isSimulatedShiftData =
    shiftEvents.length > 0 && shiftEvents.every((ev) => ev.isSimulated);

  // Build shift-scoped hourly slots strictly from persisted shiftEvents (never inventing targets or mixing dates/shifts)
  const hourlyData: HourlyProduction[] =
    shiftEvents.length === 0
      ? []
      : slots.map((slot) => {
          let actual = 0;
          let target = 0;
          let dhuWeightedSum = 0;
          let eventCount = 0;

          for (const ev of shiftEvents) {
            const t = new Date(ev.timestamp).getTime();
            if (t >= slot.startMs && t < slot.endMs) {
              actual += ev.quantityProduced;
              target += ev.targetQuantity;
              dhuWeightedSum += ev.dhuPercent * ev.quantityProduced;
              eventCount += 1;
            }
          }

          // Preserve explicit 0 target when events were logged; use null when no events/target exist
          const targetPcs = eventCount > 0 ? target : null;
          const efficiency =
            targetPcs !== null && targetPcs > 0
              ? Math.round((actual / targetPcs) * 1000) / 10
              : null;
          const dhu =
            eventCount > 0 && actual > 0 ? Math.round((dhuWeightedSum / actual) * 10) / 10 : null;

          return {
            hour: slot.hourLabel,
            actualPcs: actual,
            targetPcs,
            efficiency,
            dhu,
            eventCount,
          };
        });

  // 1. Active Orders & mutually-exclusive stage counts (sum strictly equals activeOrders.length)
  const activeOrders = orders.filter((o) => !CLOSED_ORDER_STATUSES.has(o.status));
  const inProductionCount = activeOrders.filter((o) => IN_PRODUCTION_STATUSES.has(o.status)).length;
  const confirmedCount = activeOrders.filter((o) => o.status === 'CONFIRMED').length;
  const draftCount = activeOrders.filter((o) => o.status === 'DRAFT').length;
  const partiallyShippedCount = activeOrders.filter((o) => o.status === 'PARTIALLY_SHIPPED').length;
  const closedCount = orders.length - activeOrders.length;
  const totalActivePieces = activeOrders.reduce((sum, o) => sum + (o.orderQuantity || 0), 0);

  let ordersSubtitle: string;
  if (activeOrders.length === 0) {
    ordersSubtitle =
      orders.length === 0
        ? 'No purchase orders recorded'
        : `0 active · ${closedCount} closed/cancelled`;
  } else {
    const parts = [
      `${inProductionCount} in production`,
      `${confirmedCount} confirmed`,
      `${draftCount} draft`,
    ];
    if (partiallyShippedCount > 0) {
      parts.push(`${partiallyShippedCount} part. shipped`);
    }
    ordersSubtitle = parts.join(' · ');
  }

  // 2. Shift-scoped Production Output strictly from persisted shiftEvents + persisted plannedDailyOutput
  const totalProducedPcs = shiftEvents.reduce((sum, ev) => sum + (ev.quantityProduced || 0), 0);
  const shiftTargetPcs: number | null =
    shiftEvents.length > 0
      ? shiftEvents.reduce((sum, ev) => sum + (ev.targetQuantity || 0), 0)
      : null;
  const shiftEfficiencyPercent =
    shiftTargetPcs !== null && shiftTargetPcs > 0
      ? Math.round((totalProducedPcs / shiftTargetPcs) * 1000) / 10
      : null;

  const dailyTarget = plantSettings.plannedDailyOutput;
  const shiftShort = shift.label;
  const dateContextLabel = isHistoricalDate
    ? `Historical ${reportingDate}${isSimulatedShiftData ? ' · Demo' : ''}`
    : isSimulatedShiftData
    ? `${reportingDate} · Demo`
    : reportingDate;

  let outputValue: string;
  let outputUnit: string;
  let outputSubtitle: string;
  let outputBenchmark: string;
  let outputStatus: ProductionMetric['status'];

  if (shiftEvents.length === 0) {
    outputValue = '0';
    outputUnit = 'pcs';
    outputSubtitle = `Daily target: ${dailyTarget.toLocaleString()} pcs (${shiftShort} · ${dateContextLabel})`;
    outputBenchmark =
      allHourlyEvents.length === 0
        ? 'No production events logged'
        : `No events logged in ${shiftShort} (${shift.windowLabel})`;
    outputStatus = 'nominal';
  } else {
    outputValue = totalProducedPcs.toLocaleString();
    outputUnit = 'pcs';
    outputSubtitle = `Daily target: ${dailyTarget.toLocaleString()} pcs (${shiftShort} · ${dateContextLabel})`;
    if (dailyTarget > 0) {
      const pct = Math.round((totalProducedPcs / dailyTarget) * 1000) / 10;
      outputBenchmark = `${pct}% of daily target`;
      outputStatus = pct >= 80 ? 'positive' : 'warning';
    } else {
      outputBenchmark = 'No daily target configured';
      outputStatus = 'nominal';
    }
  }

  // 3. Inventory Items strictly from ledger-computed stockBalances
  const inStockCount = stockBalances.filter((b) => b.status === 'IN_STOCK').length;
  const lowStockCount = stockBalances.filter((b) => b.status === 'LOW_STOCK').length;
  const criticalCount = stockBalances.filter((b) => b.status === 'CRITICAL').length;
  const totalLedgerTxs = stockBalances.reduce((acc, b) => acc + b.transactionCount, 0);

  // 4. Quality DHU strictly from quality_inspections + quality_defects vs plantSettings tolerances
  const hasQualityData = qualityStats.inspectionCount > 0 && qualityStats.totalInspected > 0;
  const dhuLimit = plantSettings.dhuToleranceLimit;
  const criticalDhuLimit = plantSettings.criticalDhuAlertThreshold;

  let dhuValue = 'N/A';
  let dhuUnit = '';
  let dhuSubtitle = 'No quality inspections recorded';
  let dhuBenchmark = `Tolerance limit: ${dhuLimit.toFixed(1)} DHU`;
  let dhuStatus: ProductionMetric['status'] = 'nominal';

  if (hasQualityData) {
    const variance = Math.round((qualityStats.averageDhu - dhuLimit) * 10) / 10;
    dhuValue = qualityStats.averageDhu.toFixed(1);
    dhuUnit = 'defects/100 pcs';
    dhuSubtitle = `${qualityStats.totalDefects.toLocaleString()} defects in ${qualityStats.totalInspected.toLocaleString()} inspected pcs`;
    if (variance <= 0) {
      dhuBenchmark = `Within ${dhuLimit.toFixed(1)} tolerance`;
      dhuStatus = 'positive';
    } else {
      dhuBenchmark = `+${variance.toFixed(1)} above ${dhuLimit.toFixed(1)} limit`;
      dhuStatus = qualityStats.averageDhu >= criticalDhuLimit ? 'alert' : 'warning';
    }
  }

  // 5. Per-line floor status strictly from production_lines, shift-scoped shiftEvents, and quality_inspections
  const hourlyEventsByLine = new Map<string, typeof shiftEvents>();
  for (const ev of shiftEvents) {
    const list = hourlyEventsByLine.get(ev.lineId) || [];
    list.push(ev);
    hourlyEventsByLine.set(ev.lineId, list);
  }

  const defectsByInspectionId = new Map<string, number>();
  for (const defect of allDefects) {
    defectsByInspectionId.set(
      defect.inspectionId,
      (defectsByInspectionId.get(defect.inspectionId) || 0) + (defect.count || 0)
    );
  }

  const inspectionsByLine = new Map<string, typeof inspections>();
  for (const insp of inspections) {
    if (!insp.lineId) continue;
    const list = inspectionsByLine.get(insp.lineId) || [];
    list.push(insp);
    inspectionsByLine.set(insp.lineId, list);
  }

  const lines: LineFloorStatus[] = dbLines.map((line) => {
    let buyerName = 'Unassigned';
    let styleCode = '—';
    let itemType = line.section;

    if (line.activeOrderId) {
      const order = ordersById.get(line.activeOrderId);
      if (order) {
        const buyer = buyersById.get(order.buyerId);
        const style = stylesById.get(order.styleId);
        if (buyer) buyerName = buyer.name.split('(')[0].trim();
        if (style) {
          styleCode = style.styleCode;
          itemType = style.garmentType;
        }
      }
    }

    // Use ONLY persisted shift-scoped production events for this line.
    // Never silently substitute production_lines.capacityPcsPerHour when no shift target exists.
    const lineEvents = hourlyEventsByLine.get(line.id) || [];
    let targetPcsHr: number | null = null;
    let actualPcsHr: number | null = null;
    let shiftTargetForLine: number | null = null;
    let shiftActualForLine: number | null = null;
    let loggedHoursCount = 0;
    let efficiencyPercent: number | null = null;

    if (lineEvents.length > 0) {
      const sumActual = lineEvents.reduce((s, e) => s + e.quantityProduced, 0);
      const sumTarget = lineEvents.reduce((s, e) => s + e.targetQuantity, 0);
      const distinctSlotKeys = new Set<string>();
      for (const ev of lineEvents) {
        const t = new Date(ev.timestamp).getTime();
        const matchedSlot = slots.find((s) => t >= s.startMs && t < s.endMs);
        if (matchedSlot) distinctSlotKeys.add(matchedSlot.key);
      }
      loggedHoursCount = distinctSlotKeys.size || lineEvents.length;
      shiftActualForLine = sumActual;
      // Preserve explicit 0 target when events were logged; efficiency remains null (N/A) when target is 0
      shiftTargetForLine = sumTarget;
      actualPcsHr = Math.round(sumActual / loggedHoursCount);
      targetPcsHr = Math.round(sumTarget / loggedHoursCount);
      efficiencyPercent =
        sumTarget > 0 ? Math.round((sumActual / sumTarget) * 1000) / 10 : null;
    }

    const lineInspections = inspectionsByLine.get(line.id) || [];
    let dhuPercent: number | null = null;
    if (lineInspections.length > 0) {
      const totalInspected = lineInspections.reduce((s, i) => s + i.inspectedQuantity, 0);
      const totalDefects = lineInspections.reduce(
        (s, i) => s + (defectsByInspectionId.get(i.id) || 0),
        0
      );
      if (totalInspected > 0) {
        dhuPercent = Math.round((totalDefects / totalInspected) * 1000) / 10;
      }
    } else if (lineEvents.length > 0) {
      const sumActual = lineEvents.reduce((s, e) => s + e.quantityProduced, 0);
      if (sumActual > 0) {
        const weightedDhu = lineEvents.reduce(
          (s, e) => s + e.dhuPercent * e.quantityProduced,
          0
        );
        dhuPercent = Math.round((weightedDhu / sumActual) * 10) / 10;
      }
    }

    let lineStatus: LineFloorStatus['status'] = 'running';
    if (line.status === 'NEEDLE_CHANGE') lineStatus = 'needle-change';
    if (line.status === 'MATERIAL_WAIT') lineStatus = 'material-wait';
    if (line.status === 'MAINTENANCE') lineStatus = 'maintenance';

    return {
      lineId: line.id,
      lineName: line.name,
      buyer: buyerName,
      styleCode,
      itemType,
      targetPcsHr,
      actualPcsHr,
      shiftTargetPcs: shiftTargetForLine,
      shiftActualPcs: shiftActualForLine,
      loggedHoursCount,
      efficiencyPercent,
      dhuPercent,
      activeOperators: line.activeOperatorCount,
      status: lineStatus,
    };
  });

  const runningLineCount = lines.filter((l) => l.status === 'running').length;
  const totalOperators = lines.reduce((sum, l) => sum + l.activeOperators, 0);
  const reportingLineCount = hourlyEventsByLine.size;

  const metrics: ProductionMetric[] = [
    {
      id: 'total_orders',
      title: 'Active Orders',
      value: `${activeOrders.length}`,
      unit: activeOrders.length === 1 ? 'active PO' : 'active POs',
      subtitle: ordersSubtitle,
      benchmark:
        activeOrders.length > 0
          ? `${totalActivePieces.toLocaleString()} active pcs`
          : 'No active order volume',
      status: 'nominal',
      change: `${orders.length} total PO${orders.length === 1 ? '' : 's'}`,
    },
    {
      id: 'production_output',
      title: 'Production Output',
      value: outputValue,
      unit: outputUnit,
      subtitle: outputSubtitle,
      benchmark: outputBenchmark,
      status: outputStatus,
      change: `${shiftEvents.length} shift event${shiftEvents.length === 1 ? '' : 's'} · ${reportingLineCount}/${lines.length} reporting`,
    },
    {
      id: 'inventory_items',
      title: 'Tracked Materials',
      value: `${materials.length}`,
      unit: 'ledger SKUs',
      subtitle:
        materials.length === 0
          ? 'No materials registered'
          : `${inStockCount} in stock · ${lowStockCount} low buffer · ${criticalCount} critical`,
      benchmark: materials.length === 0 ? 'Data unavailable' : 'Calculated from ledger txs',
      status: criticalCount > 0 ? 'alert' : lowStockCount > 0 ? 'warning' : 'nominal',
      change: `${totalLedgerTxs} transaction${totalLedgerTxs === 1 ? '' : 's'} posted`,
    },
    {
      id: 'quality_dhu',
      title: 'Quality DHU',
      value: dhuValue,
      unit: dhuUnit || undefined,
      subtitle: dhuSubtitle,
      benchmark: dhuBenchmark,
      status: dhuStatus,
      change: `${qualityStats.inspectionCount} audit${qualityStats.inspectionCount === 1 ? '' : 's'}`,
    },
  ];

  // 6. Truthful floor monitoring notice strictly derived from persisted records
  const nonRunningLines = lines.filter((l) => l.status !== 'running');
  let floorNotice: DashboardFloorNotice;

  if (dbLines.length === 0 && shiftEvents.length === 0 && !hasQualityData) {
    floorNotice = {
      severity: 'nominal',
      title: `${shiftShort} Floor Status`,
      badgeText: 'No Floor Data',
      description:
        'No sewing lines, production output events, or quality inspections are currently recorded in the local database.',
    };
  } else if (nonRunningLines.length > 0) {
    const affectedList = nonRunningLines
      .map((l) => `${l.lineName} (${l.status.replace('-', ' ')})`)
      .join(', ');
    floorNotice = {
      severity: 'alert',
      title: `${shiftShort} Floor Attention Required`,
      badgeText: `${nonRunningLines.length} Line${nonRunningLines.length === 1 ? '' : 's'} Interrupted`,
      description: `${affectedList}. ${runningLineCount} of ${lines.length} configured lines running (${reportingLineCount} reporting output) across ${totalOperators} operators.`,
    };
  } else if (hasQualityData && qualityStats.averageDhu > dhuLimit) {
    const latestInspection = inspections[0];
    const inspLine = latestInspection
      ? dbLines.find((l) => l.id === latestInspection.lineId)
      : undefined;
    const inspOrder = latestInspection ? ordersById.get(latestInspection.orderId) : undefined;
    const inspStyle = inspOrder ? stylesById.get(inspOrder.styleId) : undefined;
    const variance = (qualityStats.averageDhu - dhuLimit).toFixed(1);
    const contextParts: string[] = [];
    if (inspLine) contextParts.push(inspLine.name);
    if (inspStyle) contextParts.push(`style ${inspStyle.styleCode}`);
    const contextPrefix =
      contextParts.length > 0 ? `Latest audit on ${contextParts.join(' · ')}: ` : '';

    floorNotice = {
      severity: qualityStats.averageDhu >= criticalDhuLimit ? 'alert' : 'warning',
      title: `${shiftShort} Quality Tolerance Notice`,
      badgeText: `DHU ${qualityStats.averageDhu.toFixed(1)} / ${dhuLimit.toFixed(1)} Limit`,
      description: `${contextPrefix}${qualityStats.totalDefects} defects across ${qualityStats.totalInspected.toLocaleString()} inspected pcs (+${variance} above configured ${dhuLimit.toFixed(1)} tolerance). ${runningLineCount} of ${lines.length} configured lines running (${reportingLineCount} reporting output, ${totalOperators} operators).`,
    };
  } else {
    const qaSummary = hasQualityData
      ? `Quality DHU at ${qualityStats.averageDhu.toFixed(1)} across ${qualityStats.totalInspected.toLocaleString()} inspected pcs (within ${dhuLimit.toFixed(1)} limit).`
      : 'No quality inspections recorded yet.';
    const outputSummary =
      shiftEvents.length > 0
        ? `${totalProducedPcs.toLocaleString()} pcs logged on ${reportingDate} across ${reportingLineCount} of ${lines.length} configured line${lines.length === 1 ? '' : 's'}.`
        : `No hourly production events logged for ${shiftShort} (${shift.windowLabel}) on ${reportingDate}.`;

    floorNotice = {
      severity: 'nominal',
      title: `${shiftShort} Floor Status`,
      badgeText: hasQualityData
        ? `DHU ${qualityStats.averageDhu.toFixed(1)} / ${dhuLimit.toFixed(1)}`
        : 'No QA Audits',
      description: `${runningLineCount} of ${lines.length} configured lines running (${totalOperators} operators). ${outputSummary} ${qaSummary}`,
    };
  }

  return {
    metrics,
    hourlyData,
    lines,
    summaryMeta: {
      activeOrderCount: activeOrders.length,
      totalOrderCount: orders.length,
      totalProducedPcs,
      shiftTargetPcs,
      shiftEfficiencyPercent,
      shiftEventCount: shiftEvents.length,
      reportingDate,
      isHistoricalDate,
      isSimulatedShiftData,
      shiftWindowLabel: shift.windowLabel,
      reportingLineCount,
      totalLineCount: lines.length,
      runningLineCount,
      totalOperators,
      averageDhu: hasQualityData ? qualityStats.averageDhu : null,
      inspectionCount: qualityStats.inspectionCount,
      floorNotice,
    },
  };
}
