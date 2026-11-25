import { StitchPilotDatabase } from '../database';
import {
  QualityInspectionEntity,
  QualityDefectEntity,
} from '../types';
import { RelationshipValidationError } from '../errors';

export class QualityRepository {
  constructor(private db: StitchPilotDatabase) {}

  async getAllInspections(): Promise<QualityInspectionEntity[]> {
    return this.db.quality_inspections.orderBy('inspectionDate').reverse().toArray();
  }

  async getInspectionById(id: string): Promise<QualityInspectionEntity | undefined> {
    return this.db.quality_inspections.get(id);
  }

  async getDefectsByInspection(inspectionId: string): Promise<QualityDefectEntity[]> {
    return this.db.quality_defects.where('inspectionId').equals(inspectionId).toArray();
  }

  async getAllDefects(): Promise<QualityDefectEntity[]> {
    return this.db.quality_defects.toArray();
  }

  async createInspection(
    inspection: QualityInspectionEntity,
    defects: QualityDefectEntity[] = []
  ): Promise<{ inspection: QualityInspectionEntity; defects: QualityDefectEntity[] }> {
    // Validate order exists
    const order = await this.db.orders.get(inspection.orderId);
    if (!order) {
      throw new RelationshipValidationError(
        'QualityInspection',
        'Order',
        inspection.orderId,
        'Cannot record inspection for non-existent order.'
      );
    }

    return await this.db.transaction(
      'rw',
      [this.db.quality_inspections, this.db.quality_defects],
      async () => {
        await this.db.quality_inspections.add(inspection);
        if (defects.length > 0) {
          await this.db.quality_defects.bulkAdd(defects);
        }
        return { inspection, defects };
      }
    );
  }

  /**
   * Calculates overall factory Quality DHU (Defects per Hundred Units)
   * Formula: (Total Defects Count / Total Pieces Inspected) * 100
   */
  async getQualityDhuMetric(): Promise<{
    averageDhu: number;
    totalInspected: number;
    totalDefects: number;
    inspectionCount: number;
  }> {
    const inspections = await this.db.quality_inspections.toArray();
    const defects = await this.db.quality_defects.toArray();

    if (inspections.length === 0) {
      return {
        averageDhu: 0,
        totalInspected: 0,
        totalDefects: 0,
        inspectionCount: 0,
      };
    }

    const totalInspected = inspections.reduce((sum, i) => sum + i.inspectedQuantity, 0);
    const totalDefects = defects.reduce((sum, d) => sum + d.count, 0);

    const averageDhu =
      totalInspected > 0 ? (totalDefects / totalInspected) * 100 : 0;

    return {
      averageDhu: Math.round(averageDhu * 10) / 10,
      totalInspected,
      totalDefects,
      inspectionCount: inspections.length,
    };
  }
}
