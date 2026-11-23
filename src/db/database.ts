import Dexie, { Table } from 'dexie';
import {
  BuyerEntity,
  StyleEntity,
  OrderEntity,
  OrderItemEntity,
  CostSheetEntity,
  MaterialEntity,
  BomItemEntity,
  InventoryTransactionEntity,
  CuttingJobEntity,
  MarkerRatioEntity,
  BundleEntity,
  ProductionLineEntity,
  ProductionEventEntity,
  QualityInspectionEntity,
  QualityDefectEntity,
  SystemMetadataEntity,
} from './types';

export class StitchPilotDatabase extends Dexie {
  buyers!: Table<BuyerEntity, string>;
  styles!: Table<StyleEntity, string>;
  orders!: Table<OrderEntity, string>;
  order_items!: Table<OrderItemEntity, string>;
  cost_sheets!: Table<CostSheetEntity, string>;
  materials!: Table<MaterialEntity, string>;
  bom_items!: Table<BomItemEntity, string>;
  inventory_transactions!: Table<InventoryTransactionEntity, string>;
  cutting_jobs!: Table<CuttingJobEntity, string>;
  marker_ratios!: Table<MarkerRatioEntity, string>;
  bundles!: Table<BundleEntity, string>;
  production_lines!: Table<ProductionLineEntity, string>;
  production_events!: Table<ProductionEventEntity, string>;
  quality_inspections!: Table<QualityInspectionEntity, string>;
  quality_defects!: Table<QualityDefectEntity, string>;
  system_metadata!: Table<SystemMetadataEntity, string>;

  constructor(options?: { indexedDB?: any; IDBKeyRange?: any; dbName?: string }) {
    const dexieOptions: { indexedDB?: any; IDBKeyRange?: any } = {};
    if (options?.indexedDB) {
      dexieOptions.indexedDB = options.indexedDB;
    }
    if (options?.IDBKeyRange) {
      dexieOptions.IDBKeyRange = options.IDBKeyRange;
    }

    super(
      options?.dbName || 'StitchPilotEnterpriseDB',
      Object.keys(dexieOptions).length > 0 ? dexieOptions : undefined
    );

    this.version(1).stores({
      buyers: 'id, &code, name, createdAt',
      styles: 'id, buyerId, &styleCode, garmentType, createdAt',
      orders: 'id, &poNumber, buyerId, styleId, status, assignedLineId, targetExFactoryDate, createdAt',
      order_items: 'id, orderId, size, [orderId+size]',
      cost_sheets: 'id, styleId, version',
      materials: 'id, &materialCode, category, unit, createdAt',
      bom_items: 'id, styleId, materialId, [styleId+materialId]',
      inventory_transactions: 'id, &idempotencyKey, materialId, transactionType, referenceId, timestamp, [materialId+transactionType]',
      cutting_jobs: 'id, &jobNumber, orderId, styleId, status, fabricMaterialId, createdAt',
      marker_ratios: 'id, cuttingJobId, size',
      bundles: 'id, &bundleBarcode, cuttingJobId, orderId, styleId, currentLineId, status, createdAt',
      production_lines: 'id, section, status, activeOrderId',
      production_events: 'id, lineId, orderId, eventType, timestamp, [lineId+timestamp]',
      quality_inspections: 'id, &inspectionNumber, orderId, lineId, stage, result, inspectionDate',
      quality_defects: 'id, inspectionId, defectCode, category, severity',
      system_metadata: '&key',
    });

    this.version(2)
      .stores({
        buyers: 'id, &code, name, createdAt',
        styles: 'id, buyerId, &styleCode, garmentType, createdAt',
        orders: 'id, &poNumber, buyerId, styleId, status, assignedLineId, targetExFactoryDate, createdAt',
        order_items: 'id, orderId, size, color, [orderId+size], [orderId+color]',
        cost_sheets: 'id, styleId, orderId, version, status, [styleId+version], [orderId+version]',
        materials: 'id, &materialCode, category, unit, createdAt',
        bom_items: 'id, styleId, materialId, [styleId+materialId], [styleId+bomVersion]',
        inventory_transactions: 'id, &idempotencyKey, materialId, transactionType, referenceId, timestamp, [materialId+transactionType]',
        cutting_jobs: 'id, &jobNumber, orderId, styleId, status, fabricMaterialId, createdAt',
        marker_ratios: 'id, cuttingJobId, size',
        bundles: 'id, &bundleBarcode, cuttingJobId, orderId, styleId, currentLineId, status, createdAt',
        production_lines: 'id, section, status, activeOrderId',
        production_events: 'id, lineId, orderId, eventType, timestamp, [lineId+timestamp]',
        quality_inspections: 'id, &inspectionNumber, orderId, lineId, stage, result, inspectionDate',
        quality_defects: 'id, inspectionId, defectCode, category, severity',
        system_metadata: '&key',
      })
      .upgrade(async (tx) => {
        const materials = (await tx.table('materials').toArray()) as MaterialEntity[];
        const materialsById = new Map<string, MaterialEntity>(
          materials.map((m) => [m.id, m])
        );

        await tx
          .table('cost_sheets')
          .toCollection()
          .modify((sheet: CostSheetEntity) => {
            if (!sheet.status) {
              sheet.status =
                sheet.approvedBy && sheet.approvedBy.trim().length > 0
                  ? 'APPROVED'
                  : 'DRAFT';
            }
            if (sheet.threadConsumablesCost === undefined) sheet.threadConsumablesCost = 0;
            if (sheet.packingCost === undefined) sheet.packingCost = 0;
            if (sheet.printingEmbroideryCost === undefined) sheet.printingEmbroideryCost = 0;
            if (sheet.washingFinishingCost === undefined) sheet.washingFinishingCost = 0;
            if (sheet.otherDirectCost === undefined) sheet.otherDirectCost = 0;
            if (sheet.commissionPercent === undefined) sheet.commissionPercent = 0;
            if (
              sheet.profitPerGarment === undefined &&
              typeof sheet.quotedFobPrice === 'number' &&
              typeof sheet.totalCostPerGarment === 'number'
            ) {
              sheet.profitPerGarment = Number(
                (sheet.quotedFobPrice - sheet.totalCostPerGarment).toFixed(4)
              );
            }
            if (
              sheet.markupPercent === undefined &&
              typeof sheet.quotedFobPrice === 'number' &&
              typeof sheet.totalCostPerGarment === 'number' &&
              sheet.totalCostPerGarment > 0
            ) {
              sheet.markupPercent = Number(
                (
                  ((sheet.quotedFobPrice - sheet.totalCostPerGarment) /
                    sheet.totalCostPerGarment) *
                  100
                ).toFixed(2)
              );
            }
            if (!sheet.updatedAt) {
              sheet.updatedAt = sheet.createdAt;
            }
          });

        await tx
          .table('bom_items')
          .toCollection()
          .modify((item: BomItemEntity) => {
            const mat = materialsById.get(item.materialId);

            if (item.bomVersion === undefined) item.bomVersion = 1;
            if (!item.status) item.status = 'ACTIVE';
            if (!item.colorScope) item.colorScope = 'ALL';
            if (!item.sizeScope) item.sizeScope = 'ALL';
            if (!item.updatedAt) item.updatedAt = item.createdAt;

            // Carefully scoped, idempotent corrections ONLY for known Phase 2A demo records
            if (
              item.id === 'BOM-03' &&
              item.isSimulated === true &&
              item.styleId === 'STY-01' &&
              item.materialId === 'MAT-07'
            ) {
              if (!item.consumptionBasis) {
                item.consumptionBasis = 'PER_DOZEN';
              }
              if (!item.consumptionUnit) {
                item.consumptionUnit = 'cones';
              }
              if (!item.componentCategory) {
                item.componentCategory = 'THREAD';
              }
            } else if (
              item.id === 'BOM-08' &&
              item.isSimulated === true &&
              item.styleId === 'STY-03' &&
              item.materialId === 'MAT-06'
            ) {
              if (!item.consumptionBasis) {
                item.consumptionBasis = 'PER_PIECE';
              }
              if (
                item.consumptionPerGarment === 2.0 &&
                (!item.consumptionUnit || item.consumptionUnit === 'gross')
              ) {
                item.consumptionUnit = 'pcs';
              }
              if (!item.componentCategory) {
                item.componentCategory = 'TRIM';
              }
            } else {
              // Legacy & user-created records: preserve existing numeric values without conversion
              if (!item.consumptionBasis) {
                item.consumptionBasis = 'PER_PIECE';
              }
              if (!item.consumptionUnit && mat?.unit) {
                item.consumptionUnit = mat.unit;
              }
            }
          });

        const schemaMeta = await tx.table('system_metadata').get('schema_version');
        if (schemaMeta) {
          await tx.table('system_metadata').put({
            key: 'schema_version',
            value: '2.0.0',
            updatedAt: new Date().toISOString(),
          });
        }
      });
  }
}

// Singleton browser instance
export const db = new StitchPilotDatabase();

// Factory for isolated tests
export function createIsolatedTestDatabase(customIndexedDB: any, customIDBKeyRange: any, dbName?: string) {
  return new StitchPilotDatabase({
    indexedDB: customIndexedDB,
    IDBKeyRange: customIDBKeyRange,
    dbName: dbName || `TestDB_${Date.now()}_${Math.random().toString(36).substring(7)}`,
  });
}
