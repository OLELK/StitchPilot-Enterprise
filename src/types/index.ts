export type NavigationTab = 'dashboard' | 'orders' | 'bom-mrp' | 'costing' | 'inventory' | 'settings';

export interface ProductionMetric {
  id: string;
  title: string;
  value: string;
  unit?: string;
  subtitle: string;
  benchmark: string;
  status: 'nominal' | 'warning' | 'alert' | 'positive';
  change?: string;
}

export interface HourlyProduction {
  hour: string;
  actualPcs: number;
  targetPcs: number | null;
  efficiency: number | null;
  dhu: number | null;
  eventCount?: number;
}

export interface LineFloorStatus {
  lineId: string;
  lineName: string;
  buyer: string;
  styleCode: string;
  itemType: string;
  targetPcsHr: number | null;
  actualPcsHr: number | null;
  shiftTargetPcs?: number | null;
  shiftActualPcs?: number | null;
  loggedHoursCount?: number;
  efficiencyPercent: number | null;
  dhuPercent: number | null;
  activeOperators: number;
  status: 'running' | 'needle-change' | 'material-wait' | 'maintenance';
}

export interface DashboardFloorNotice {
  severity: 'nominal' | 'warning' | 'alert';
  title: string;
  badgeText: string;
  description: string;
}

export interface DashboardSummaryMeta {
  activeOrderCount: number;
  totalOrderCount: number;
  totalProducedPcs: number;
  shiftTargetPcs: number | null;
  shiftEfficiencyPercent: number | null;
  shiftEventCount: number;
  reportingDate: string;
  isHistoricalDate: boolean;
  isSimulatedShiftData: boolean;
  shiftWindowLabel: string;
  reportingLineCount: number;
  totalLineCount: number;
  runningLineCount: number;
  totalOperators: number;
  averageDhu: number | null;
  inspectionCount: number;
  floorNotice: DashboardFloorNotice;
}

export type OrderStage = 'Cutting' | 'Sewing' | 'Finishing' | 'Final QC' | 'Dispatched';

export interface ApparelOrder {
  id: string;
  poNumber: string;
  buyer: string;
  styleCode: string;
  styleDescription: string;
  fabricSpec: string;
  colorway: string;
  orderQtyPcs: number;
  producedQtyPcs: number;
  samMinutes: number; // Standard Allowed Minutes (SMV)
  assignedLine: string;
  deliveryDate: string;
  stage: OrderStage;
  dhuPercent: number;
}

export type InventoryCategory = 'Knitted Fabric' | 'Woven Fabric' | 'Trims & Fasteners' | 'Threads & Notions' | 'Packaging';

export interface InventoryItem {
  id: string;
  itemCode: string;
  name: string;
  category: InventoryCategory;
  spec: string;
  currentStock: number;
  unit: 'kg' | 'meters' | 'pcs' | 'cones' | 'rolls' | 'gross';
  reorderLevel: number;
  location: string;
  lotBatch: string;
  status: 'in-stock' | 'low-stock' | 'critical' | 'reordered';
}

export interface PlantSettings {
  plantName: string;
  plantCode: string;
  division: string;
  activeShift: 'Shift A (07:00 - 15:30)' | 'Shift B (15:30 - 23:00)' | 'Shift C (23:00 - 07:00)';
  dhuToleranceLimit: number;
  criticalDhuAlertThreshold: number;
  standardWorkingHours: number;
  plannedDailyOutput: number;
  sewingLinesConfigured: number;
  defaultSamAllowancePercent: number;
  autoDefectEscalation: boolean;
  rfidBundleTracking: boolean;
  soundAlarmOnToleranceBreach: boolean;
}
