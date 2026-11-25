import { StitchPilotDatabase } from '../database';
import {
  ProductionLineEntity,
  ProductionEventEntity,
  LineOperationalStatus,
} from '../types';
import { EntityNotFoundError, RelationshipValidationError, ValidationError } from '../errors';
import { filterEventsForShiftAndDate } from '../services/shiftSchedule';

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
    if (
      typeof event.quantityProduced !== 'number' ||
      !Number.isFinite(event.quantityProduced) ||
      !Number.isInteger(event.quantityProduced) ||
      event.quantityProduced < 0
    ) {
      throw new ValidationError(
        'Production output quantity cannot be negative. Enter 0 or a positive whole number.',
        'quantityProduced',
        { quantityProduced: event.quantityProduced }
      );
    }

    if (
      typeof event.targetQuantity !== 'number' ||
      !Number.isFinite(event.targetQuantity) ||
      !Number.isInteger(event.targetQuantity) ||
      event.targetQuantity < 0
    ) {
      throw new ValidationError(
        'Target production quantity cannot be negative. Enter 0 or a positive whole number.',
        'targetQuantity',
        { targetQuantity: event.targetQuantity }
      );
    }

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

  async getAllProductionEvents(): Promise<ProductionEventEntity[]> {
    return this.db.production_events.toArray();
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
   * Retrieves hourly aggregate production data across all lines.
   * When activeShift is provided, restricts results strictly to the configured shift window
   * and a single local reporting date, excluding out-of-shift, cross-date, and future intervals.
   */
  async getHourlyProductionSummary(options?: {
    activeShift?: string;
    reportingDate?: string;
    now?: Date;
  }): Promise<
    {
      hour: string;
      actualPcs: number;
      targetPcs: number | null;
      efficiency: number | null;
      dhu: number | null;
      eventCount: number;
    }[]
  > {
    const events = await this.db.production_events
      .where('eventType')
      .equals('HOURLY_OUTPUT')
      .toArray();

    if (options?.activeShift) {
      const { slots, shiftEvents } = filterEventsForShiftAndDate(events, options.activeShift, {
        reportingDate: options.reportingDate,
        now: options.now,
      });

      if (shiftEvents.length === 0) {
        return [];
      }

      return slots.map((slot) => {
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
    }

    // Legacy unfiltered local-hour grouping when called without shift options
    const hourMap = new Map<
      string,
      { actual: number; target: number; dhuWeightedSum: number; count: number }
    >();

    for (const ev of events) {
      const time = new Date(ev.timestamp);
      if (Number.isNaN(time.getTime())) continue;
      const hourStr = `${time.getHours().toString().padStart(2, '0')}:00`;
      const current = hourMap.get(hourStr) || { actual: 0, target: 0, dhuWeightedSum: 0, count: 0 };
      current.actual += ev.quantityProduced;
      current.target += ev.targetQuantity;
      current.dhuWeightedSum += ev.dhuPercent * ev.quantityProduced;
      current.count += 1;
      hourMap.set(hourStr, current);
    }

    const result: {
      hour: string;
      actualPcs: number;
      targetPcs: number | null;
      efficiency: number | null;
      dhu: number | null;
      eventCount: number;
    }[] = [];
    const sortedHours = Array.from(hourMap.keys()).sort();

    for (const h of sortedHours) {
      const data = hourMap.get(h)!;
      const efficiency =
        data.target > 0 ? Math.round((data.actual / data.target) * 1000) / 10 : null;
      const dhu = data.actual > 0 ? Math.round((data.dhuWeightedSum / data.actual) * 10) / 10 : null;
      result.push({
        hour: h,
        actualPcs: data.actual,
        targetPcs: data.target,
        efficiency,
        dhu,
        eventCount: data.count,
      });
    }

    return result;
  }
}
