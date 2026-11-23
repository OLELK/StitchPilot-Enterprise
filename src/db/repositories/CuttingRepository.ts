import { StitchPilotDatabase } from '../database';
import {
  CuttingJobEntity,
  CuttingJobStatus,
  MarkerRatioEntity,
  BundleEntity,
} from '../types';
import { EntityNotFoundError, RelationshipValidationError } from '../errors';

export class CuttingRepository {
  constructor(private db: StitchPilotDatabase) {}

  async getAllCuttingJobs(): Promise<CuttingJobEntity[]> {
    return this.db.cutting_jobs.orderBy('createdAt').reverse().toArray();
  }

  async getCuttingJobById(id: string): Promise<CuttingJobEntity | undefined> {
    return this.db.cutting_jobs.get(id);
  }

  async getCuttingJobsByOrder(orderId: string): Promise<CuttingJobEntity[]> {
    return this.db.cutting_jobs.where('orderId').equals(orderId).toArray();
  }

  async getMarkerRatiosByJob(cuttingJobId: string): Promise<MarkerRatioEntity[]> {
    return this.db.marker_ratios.where('cuttingJobId').equals(cuttingJobId).toArray();
  }

  async getBundlesByCuttingJob(cuttingJobId: string): Promise<BundleEntity[]> {
    return this.db.bundles.where('cuttingJobId').equals(cuttingJobId).toArray();
  }

  async getBundlesByOrder(orderId: string): Promise<BundleEntity[]> {
    return this.db.bundles.where('orderId').equals(orderId).toArray();
  }

  async createCuttingJob(
    job: CuttingJobEntity,
    ratios: MarkerRatioEntity[] = []
  ): Promise<{ job: CuttingJobEntity; ratios: MarkerRatioEntity[] }> {
    // Validate order exists
    const order = await this.db.orders.get(job.orderId);
    if (!order) {
      throw new RelationshipValidationError(
        'CuttingJob',
        'Order',
        job.orderId,
        'Cannot plan cutting for non-existent order.'
      );
    }

    // Validate material exists
    const material = await this.db.materials.get(job.fabricMaterialId);
    if (!material) {
      throw new RelationshipValidationError(
        'CuttingJob',
        'Material',
        job.fabricMaterialId,
        'Referenced fabric material does not exist.'
      );
    }

    return await this.db.transaction(
      'rw',
      [this.db.cutting_jobs, this.db.marker_ratios],
      async () => {
        await this.db.cutting_jobs.add(job);
        if (ratios.length > 0) {
          await this.db.marker_ratios.bulkAdd(ratios);
        }
        return { job, ratios };
      }
    );
  }

  async createBundles(bundles: BundleEntity[]): Promise<BundleEntity[]> {
    await this.db.bundles.bulkAdd(bundles);
    return bundles;
  }

  async updateCuttingJobStatus(id: string, status: CuttingJobStatus): Promise<CuttingJobEntity> {
    const job = await this.db.cutting_jobs.get(id);
    if (!job) {
      throw new EntityNotFoundError('CuttingJob', id);
    }
    const updated: CuttingJobEntity = {
      ...job,
      status,
      updatedAt: new Date().toISOString(),
    };
    await this.db.cutting_jobs.put(updated);
    return updated;
  }
}
