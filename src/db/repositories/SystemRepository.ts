import { StitchPilotDatabase } from '../database';
import {
  DEMO_BUYERS,
  DEMO_STYLES,
  DEMO_MATERIALS,
  DEMO_COST_SHEETS,
  DEMO_BOM_ITEMS,
  DEMO_PRODUCTION_LINES,
  DEMO_ORDERS,
  DEMO_ORDER_ITEMS,
  DEMO_INVENTORY_TRANSACTIONS,
  DEMO_CUTTING_JOBS,
  DEMO_MARKER_RATIOS,
  DEMO_BUNDLES,
  DEMO_PRODUCTION_EVENTS,
  DEMO_QUALITY_INSPECTIONS,
  DEMO_QUALITY_DEFECTS,
} from '../demoData';
import { PlantSettings } from '../../types';
import { DEFAULT_PLANT_SETTINGS } from '../../data/mockData';
import { ValidationError } from '../errors';

const PLANT_SETTINGS_META_KEY = 'plant_settings';

export interface DatabaseStatus {
  isOpen: boolean;
  isSeeded: boolean;
  seededAt: string | null;
  tableCounts: Record<string, number>;
  totalRecords: number;
}

export class SystemRepository {
  constructor(private db: StitchPilotDatabase) {}

  /**
   * Checks whether the database is empty by inspecting key tables
   */
  async isDatabaseEmpty(): Promise<boolean> {
    const buyerCount = await this.db.buyers.count();
    const materialCount = await this.db.materials.count();
    const orderCount = await this.db.orders.count();
    return buyerCount === 0 && materialCount === 0 && orderCount === 0;
  }

  /**
   * Checks whether the database has already been seeded with demo records
   */
  async isSeeded(): Promise<boolean> {
    const meta = await this.db.system_metadata.get('is_seeded');
    return meta?.value === 'true';
  }

  /**
   * Seeds demo data ONLY when the database is empty or not yet seeded.
   * Completely avoids duplicate inserts on every reload.
   */
  async initializeAndSeedIfEmpty(): Promise<{ seeded: boolean; message: string }> {
    // Check metadata first
    const alreadySeeded = await this.isSeeded();
    const isEmpty = await this.isDatabaseEmpty();

    if (alreadySeeded && !isEmpty) {
      return {
        seeded: false,
        message: 'Database is already initialized and persisted.',
      };
    }

    // Perform atomic transaction across all 15 tables
    await this.db.transaction(
      'rw',
      [
        this.db.buyers,
        this.db.styles,
        this.db.materials,
        this.db.cost_sheets,
        this.db.bom_items,
        this.db.production_lines,
        this.db.orders,
        this.db.order_items,
        this.db.inventory_transactions,
        this.db.cutting_jobs,
        this.db.marker_ratios,
        this.db.bundles,
        this.db.production_events,
        this.db.quality_inspections,
        this.db.quality_defects,
        this.db.system_metadata,
      ],
      async () => {
        // Bulk add all 15 entities
        await this.db.buyers.bulkAdd(DEMO_BUYERS);
        await this.db.styles.bulkAdd(DEMO_STYLES);
        await this.db.materials.bulkAdd(DEMO_MATERIALS);
        await this.db.cost_sheets.bulkAdd(DEMO_COST_SHEETS);
        await this.db.bom_items.bulkAdd(DEMO_BOM_ITEMS);
        await this.db.production_lines.bulkAdd(DEMO_PRODUCTION_LINES);
        await this.db.orders.bulkAdd(DEMO_ORDERS);
        await this.db.order_items.bulkAdd(DEMO_ORDER_ITEMS);
        await this.db.inventory_transactions.bulkAdd(DEMO_INVENTORY_TRANSACTIONS);
        await this.db.cutting_jobs.bulkAdd(DEMO_CUTTING_JOBS);
        await this.db.marker_ratios.bulkAdd(DEMO_MARKER_RATIOS);
        await this.db.bundles.bulkAdd(DEMO_BUNDLES);
        await this.db.production_events.bulkAdd(DEMO_PRODUCTION_EVENTS);
        await this.db.quality_inspections.bulkAdd(DEMO_QUALITY_INSPECTIONS);
        await this.db.quality_defects.bulkAdd(DEMO_QUALITY_DEFECTS);

        // Record seeding timestamp in system metadata
        const now = new Date().toISOString();
        await this.db.system_metadata.put({
          key: 'is_seeded',
          value: 'true',
          updatedAt: now,
        });
        await this.db.system_metadata.put({
          key: 'seeded_at',
          value: now,
          updatedAt: now,
        });
        await this.db.system_metadata.put({
          key: 'schema_version',
          value: '2.0.0',
          updatedAt: now,
        });
      }
    );

    return {
      seeded: true,
      message: 'Demo dataset successfully seeded into IndexedDB.',
    };
  }

  /**
   * Retrieves row counts across all 15 tables
   */
  async getTableCounts(): Promise<Record<string, number>> {
    const [
      buyers,
      styles,
      orders,
      order_items,
      cost_sheets,
      materials,
      bom_items,
      inventory_transactions,
      cutting_jobs,
      marker_ratios,
      bundles,
      production_lines,
      production_events,
      quality_inspections,
      quality_defects,
    ] = await Promise.all([
      this.db.buyers.count(),
      this.db.styles.count(),
      this.db.orders.count(),
      this.db.order_items.count(),
      this.db.cost_sheets.count(),
      this.db.materials.count(),
      this.db.bom_items.count(),
      this.db.inventory_transactions.count(),
      this.db.cutting_jobs.count(),
      this.db.marker_ratios.count(),
      this.db.bundles.count(),
      this.db.production_lines.count(),
      this.db.production_events.count(),
      this.db.quality_inspections.count(),
      this.db.quality_defects.count(),
    ]);

    return {
      buyers,
      styles,
      orders,
      order_items,
      cost_sheets,
      materials,
      bom_items,
      inventory_transactions,
      cutting_jobs,
      marker_ratios,
      bundles,
      production_lines,
      production_events,
      quality_inspections,
      quality_defects,
    };
  }

  /**
   * Retrieves high-level database diagnostics
   */
  async getDatabaseStatus(): Promise<DatabaseStatus> {
    const isSeeded = await this.isSeeded();
    const seededAtMeta = await this.db.system_metadata.get('seeded_at');
    const tableCounts = await this.getTableCounts();
    const totalRecords = Object.values(tableCounts).reduce((a, b) => a + b, 0);

    return {
      isOpen: this.db.isOpen(),
      isSeeded,
      seededAt: seededAtMeta?.value || null,
      tableCounts,
      totalRecords,
    };
  }

  /**
   * Purges all tables and reseeds demo data
   */
  async purgeAndReseed(): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.buyers,
        this.db.styles,
        this.db.materials,
        this.db.cost_sheets,
        this.db.bom_items,
        this.db.production_lines,
        this.db.orders,
        this.db.order_items,
        this.db.inventory_transactions,
        this.db.cutting_jobs,
        this.db.marker_ratios,
        this.db.bundles,
        this.db.production_events,
        this.db.quality_inspections,
        this.db.quality_defects,
        this.db.system_metadata,
      ],
      async () => {
        await Promise.all([
          this.db.buyers.clear(),
          this.db.styles.clear(),
          this.db.materials.clear(),
          this.db.cost_sheets.clear(),
          this.db.bom_items.clear(),
          this.db.production_lines.clear(),
          this.db.orders.clear(),
          this.db.order_items.clear(),
          this.db.inventory_transactions.clear(),
          this.db.cutting_jobs.clear(),
          this.db.marker_ratios.clear(),
          this.db.bundles.clear(),
          this.db.production_events.clear(),
          this.db.quality_inspections.clear(),
          this.db.quality_defects.clear(),
          this.db.system_metadata.clear(),
        ]);
      }
    );

    await this.initializeAndSeedIfEmpty();
  }

  /**
   * Validates plant configuration values before persistence.
   * Rejects negative planned daily output instead of silently coercing it to zero.
   */
  validatePlantSettings(settings: PlantSettings): void {
    if (!settings.plantName || !settings.plantName.trim()) {
      throw new ValidationError('Facility name is required.', 'plantName');
    }
    if (!settings.plantCode || !settings.plantCode.trim()) {
      throw new ValidationError('Plant ERP code is required.', 'plantCode');
    }
    if (!settings.division || !settings.division.trim()) {
      throw new ValidationError('Operating apparel division is required.', 'division');
    }
    if (
      typeof settings.plannedDailyOutput !== 'number' ||
      !Number.isFinite(settings.plannedDailyOutput) ||
      !Number.isInteger(settings.plannedDailyOutput) ||
      settings.plannedDailyOutput < 0
    ) {
      throw new ValidationError(
        'Planned daily output cannot be negative. Enter 0 or a positive whole number.',
        'plannedDailyOutput',
        { plannedDailyOutput: settings.plannedDailyOutput }
      );
    }
    if (
      typeof settings.sewingLinesConfigured !== 'number' ||
      !Number.isFinite(settings.sewingLinesConfigured) ||
      !Number.isInteger(settings.sewingLinesConfigured) ||
      settings.sewingLinesConfigured < 1 ||
      settings.sewingLinesConfigured > 24
    ) {
      throw new ValidationError(
        'Active sewing lines must be a whole number between 1 and 24.',
        'sewingLinesConfigured',
        { sewingLinesConfigured: settings.sewingLinesConfigured }
      );
    }
    if (
      typeof settings.dhuToleranceLimit !== 'number' ||
      !Number.isFinite(settings.dhuToleranceLimit) ||
      settings.dhuToleranceLimit < 0 ||
      settings.dhuToleranceLimit > 100
    ) {
      throw new ValidationError(
        'Standard DHU tolerance limit must be between 0 and 100.',
        'dhuToleranceLimit',
        { dhuToleranceLimit: settings.dhuToleranceLimit }
      );
    }
    if (
      typeof settings.criticalDhuAlertThreshold !== 'number' ||
      !Number.isFinite(settings.criticalDhuAlertThreshold) ||
      settings.criticalDhuAlertThreshold < 0 ||
      settings.criticalDhuAlertThreshold > 100
    ) {
      throw new ValidationError(
        'Critical DHU escalation limit must be between 0 and 100.',
        'criticalDhuAlertThreshold',
        { criticalDhuAlertThreshold: settings.criticalDhuAlertThreshold }
      );
    }
  }

  /**
   * Loads persisted plant settings from system_metadata, falling back to DEFAULT_PLANT_SETTINGS.
   */
  async getPlantSettings(): Promise<PlantSettings> {
    const record = await this.db.system_metadata.get(PLANT_SETTINGS_META_KEY);
    if (!record?.value) {
      return { ...DEFAULT_PLANT_SETTINGS };
    }
    try {
      const parsed = JSON.parse(record.value) as Partial<PlantSettings>;
      return {
        ...DEFAULT_PLANT_SETTINGS,
        ...parsed,
      };
    } catch {
      return { ...DEFAULT_PLANT_SETTINGS };
    }
  }

  /**
   * Validates and persists plant settings into system_metadata without touching operational tables.
   */
  async savePlantSettings(settings: PlantSettings): Promise<PlantSettings> {
    this.validatePlantSettings(settings);
    const normalized: PlantSettings = {
      ...DEFAULT_PLANT_SETTINGS,
      ...settings,
      plantName: settings.plantName.trim(),
      plantCode: settings.plantCode.trim(),
      division: settings.division.trim(),
    };
    await this.db.system_metadata.put({
      key: PLANT_SETTINGS_META_KEY,
      value: JSON.stringify(normalized),
      updatedAt: new Date().toISOString(),
    });
    return normalized;
  }

  /**
   * Restores plant settings to DEFAULT_PLANT_SETTINGS and persists them in system_metadata.
   * Does NOT delete or alter orders, BOMs, cost sheets, inventory, or production records.
   */
  async resetPlantSettings(): Promise<PlantSettings> {
    const defaults: PlantSettings = { ...DEFAULT_PLANT_SETTINGS };
    await this.db.system_metadata.put({
      key: PLANT_SETTINGS_META_KEY,
      value: JSON.stringify(defaults),
      updatedAt: new Date().toISOString(),
    });
    return defaults;
  }
}
