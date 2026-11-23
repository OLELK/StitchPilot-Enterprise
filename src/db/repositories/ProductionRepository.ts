import { StitchPilotDatabase } from '../database';
import {
  ProductionLineEntity,
  ProductionEventEntity,
  LineOperationalStatus,
} from '../types';
import { EntityNotFoundError, RelationshipValidationError } from '../errors';

export class ProductionRepository {
  constructor(private db: StitchPilotDatabase) {}

  async getAllLines(): Promise<ProductionLineEntity[]> {
    return this.db.production_lines.toArray();
  }

  async getLineById(id: string): Promise<ProductionLineEntity | undefined> {
    return this.db.production_lines.get(id);
  }

  async createProductionLine(line: ProductionLineEntity): Promise<ProductionLineEntity> {
    await this.db.production_lines.add(line);
    return line;
  }

  async updateLineStatus(
    lineId: string,
    status: LineOperationalStatus,
    activeOrderId?: string
  ): Promise<ProductionLineEntity> {
    const line = await this.db.production_lines.get(lineId);
    if (!line) {
      throw new EntityNotFoundError('ProductionLine', lineId);
    }

    const updated: ProductionLineEntity = {
      ...line,
      status,
      activeOrderId: activeOrderId !== undefined ? activeOrderId : line.activeOrderId,
      updatedAt: new Date().toISOString(),
    };
    await this.db.production_lines.put(updated);
    return updated;
  }

  async recordProductionEvent(event: ProductionEventEntity): Promise<ProductionEventEntity> {
    const line = await this.db.production_lines.get(event.lineId);
    if (!line) {
      throw new RelationshipValidationError(
        'ProductionEvent',
        'ProductionLine',
        event.lineId,
        'Cannot record event for unregistered sewing line.'
      );
    }

    await this.db.production_events.add(event);
    return event;
  }

  async getProductionEventsByLine(lineId: string): Promise<ProductionEventEntity[]> {
    return this.db.production_events
      .where('lineId')
      .equals(lineId)
      .reverse()
      .sortBy('timestamp');
  }

  async getProductionEventsByOrder(orderId: string): Promise<ProductionEventEntity[]> {
    return this.db.production_events
      .where('orderId')
      .equals(orderId)
      .reverse()
      .sortBy('timestamp');
  }

  /**
   * Retrieves the aggregate production output (total pieces produced) from production events
   */
  async getTotalProductionOutput(): Promise<number> {
    const events = await this.db.production_events.toArray();
    return events.reduce((sum, e) => sum + (e.quantityProduced || 0), 0);
  }

  /**
   * Retrieves hourly aggregate production data across all lines
   */
  async getHourlyProductionSummary(): Promise<
    { hour: string; actualPcs: number; targetPcs: number; efficiency: number; dhu: number }[]
  > {
    const events = await this.db.production_events
      .where('eventType')
      .equals('HOURLY_OUTPUT')
      .toArray();

    // Group by hour
    const hourMap = new Map<
      string,
      { actual: number; target: number; dhuWeightedSum: number; count: number }
    >();

    for (const ev of events) {
      const time = new Date(ev.timestamp);
      const hourStr = `${time.getHours().toString().padStart(2, '0')}:00`;
      const current = hourMap.get(hourStr) || { actual: 0, target: 0, dhuWeightedSum: 0, count: 0 };
      current.actual += ev.quantityProduced;
      current.target += ev.targetQuantity;
      current.dhuWeightedSum += ev.dhuPercent * ev.quantityProduced;
      current.count += 1;
      hourMap.set(hourStr, current);
    }

    const result: { hour: string; actualPcs: number; targetPcs: number; efficiency: number; dhu: number }[] = [];
    const sortedHours = Array.from(hourMap.keys()).sort();

    for (const h of sortedHours) {
      const data = hourMap.get(h)!;
      const efficiency = data.target > 0 ? (data.actual / data.target) * 100 : 0;
      const dhu = data.actual > 0 ? data.dhuWeightedSum / data.actual : 0;
      result.push({
        hour: h,
        actualPcs: data.actual,
        targetPcs: data.target,
        efficiency: Math.round(efficiency * 10) / 10,
        dhu: Math.round(dhu * 10) / 10,
      });
    }

    return result;
  }
}
