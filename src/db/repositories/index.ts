import { db, StitchPilotDatabase } from '../database';
import { MasterRepository } from './MasterRepository';
import { OrderRepository } from './OrderRepository';
import { InventoryRepository } from './InventoryRepository';
import { CuttingRepository } from './CuttingRepository';
import { ProductionRepository } from './ProductionRepository';
import { QualityRepository } from './QualityRepository';
import { CostingRepository } from './CostingRepository';
import { SystemRepository } from './SystemRepository';

export interface RepositoryBundle {
  master: MasterRepository;
  orders: OrderRepository;
  inventory: InventoryRepository;
  cutting: CuttingRepository;
  production: ProductionRepository;
  quality: QualityRepository;
  costing: CostingRepository;
  system: SystemRepository;
}

export function createRepositories(database: StitchPilotDatabase): RepositoryBundle {
  return {
    master: new MasterRepository(database),
    orders: new OrderRepository(database),
    inventory: new InventoryRepository(database),
    cutting: new CuttingRepository(database),
    production: new ProductionRepository(database),
    quality: new QualityRepository(database),
    costing: new CostingRepository(database),
    system: new SystemRepository(database),
  };
}

// Singleton instances wired to default browser Dexie database
export const repositories = createRepositories(db);

export const masterRepo = repositories.master;
export const orderRepo = repositories.orders;
export const inventoryRepo = repositories.inventory;
export const cuttingRepo = repositories.cutting;
export const productionRepo = repositories.production;
export const qualityRepo = repositories.quality;
export const costingRepo = repositories.costing;
export const systemRepo = repositories.system;

export * from './MasterRepository';
export * from './OrderRepository';
export * from './InventoryRepository';
export * from './CuttingRepository';
export * from './ProductionRepository';
export * from './QualityRepository';
export * from './CostingRepository';
export * from './SystemRepository';
