import { StitchPilotDatabase } from '../database';
import {
  InventoryReferenceType,
  InventoryTransactionEntity,
  InventoryTransactionType,
  MaterialCategory,
  MaterialEntity,
  MaterialStockBalance,
} from '../types';
import {
  DuplicateTransactionError,
  EntityNotFoundError,
  InventoryAccountingError,
} from '../errors';

export interface PostTransactionParams {
  id?: string;
  idempotencyKey: string;
  materialId: string;
  transactionType: InventoryTransactionType;
  quantity: number;
  referenceType: InventoryReferenceType;
  referenceId: string;
  batchLot?: string;
  performedBy?: string;
  notes?: string;
  timestamp?: string;
  isSimulated?: boolean;
}

export class InventoryRepository {
  constructor(private db: StitchPilotDatabase) {}

  /**
   * Retrieves all tracked materials
   */
  async getAllMaterials(): Promise<MaterialEntity[]> {
    return this.db.materials.toArray();
  }

  /**
   * Retrieves a single material by ID
   */
  async getMaterialById(id: string): Promise<MaterialEntity | undefined> {
    return this.db.materials.get(id);
  }

  /**
   * Retrieves a material by its unique materialCode
   */
  async getMaterialByCode(materialCode: string): Promise<MaterialEntity | undefined> {
    return this.db.materials.where('materialCode').equals(materialCode).first();
  }

  /**
   * Adds a new material definition (stock will start at 0 until transactions are posted)
   */
  async createMaterial(
    material: Omit<MaterialEntity, 'createdAt' | 'updatedAt'>
  ): Promise<MaterialEntity> {
    const existing = await this.getMaterialByCode(material.materialCode);
    if (existing) {
      throw new InventoryAccountingError(
        `Material with code "${material.materialCode}" already exists.`,
        material.id
      );
    }

    const now = new Date().toISOString();
    const entity: MaterialEntity = {
      ...material,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.materials.add(entity);
    return entity;
  }

  /**
   * Calculates the exact stock balance for a material from the ledger.
   * Physical Stock = Receipts + Returns - Issues - Scrap
   * Reserved Stock = Allocations - Deallocations - Issues
   * Available Stock = Physical Stock - Reserved Stock
   */
  async getMaterialStockBalance(materialId: string): Promise<MaterialStockBalance> {
    const material = await this.db.materials.get(materialId);
    if (!material) {
      throw new EntityNotFoundError('Material', materialId);
    }

    const transactions = await this.db.inventory_transactions
      .where('materialId')
      .equals(materialId)
      .sortBy('timestamp');

    let totalReceipts = 0;
    let totalAllocations = 0;
    let totalDeallocations = 0;
    let totalIssues = 0;
    let totalReturns = 0;
    let totalScrap = 0;

    for (const tx of transactions) {
      const qty = tx.quantity;
      switch (tx.transactionType) {
        case 'PO_RECEIPT':
          totalReceipts += qty;
          break;
        case 'ALLOCATION':
          totalAllocations += qty;
          break;
        case 'DEALLOCATION':
          totalDeallocations += qty;
          break;
        case 'CUTTING_ISSUE':
          totalIssues += qty;
          break;
        case 'RETURN_TO_STORE':
          totalReturns += qty;
          break;
        case 'SCRAP_ADJUSTMENT':
          totalScrap += qty;
          break;
      }
    }

    // Mathematical formula per requirements:
    // Physical Stock = Receipts + Returns - Issues - Scrap
    const physicalStock = totalReceipts + totalReturns - totalIssues - totalScrap;

    // Reserved Stock = Allocations - Deallocations - Issues
    // (Issuing fabric to cutting consumes both physical and reserved stock)
    const reservedStock = totalAllocations - totalDeallocations - totalIssues;

    // Available Stock = Physical Stock - Reserved Stock
    const availableStock = physicalStock - reservedStock;

    // Determine status based on thresholds
    let status: MaterialStockBalance['status'] = 'IN_STOCK';
    if (physicalStock <= 0) {
      status = 'CRITICAL';
    } else if (physicalStock <= material.reorderPoint * 0.3) {
      status = 'CRITICAL';
    } else if (physicalStock <= material.reorderPoint) {
      status = 'LOW_STOCK';
    }

    return {
      materialId: material.id,
      materialCode: material.materialCode,
      name: material.name,
      category: material.category,
      unit: material.unit,
      reorderPoint: material.reorderPoint,
      location: material.warehouseLocation,
      physicalStock,
      reservedStock,
      availableStock,
      totalReceipts,
      totalAllocations,
      totalDeallocations,
      totalIssues,
      totalReturns,
      totalScrap,
      status,
      transactionCount: transactions.length,
    };
  }

  /**
   * Retrieves stock balances for all registered materials
   */
  async getAllStockBalances(): Promise<MaterialStockBalance[]> {
    const materials = await this.getAllMaterials();
    const balances: MaterialStockBalance[] = [];
    for (const mat of materials) {
      const balance = await this.getMaterialStockBalance(mat.id);
      balances.push(balance);
    }
    return balances;
  }

  /**
   * Posts an inventory transaction to the ledger with strict accounting rules enforcement.
   * Wrapped in an atomic Dexie transaction.
   */
  async postTransaction(params: PostTransactionParams): Promise<InventoryTransactionEntity> {
    const {
      idempotencyKey,
      materialId,
      transactionType,
      quantity,
      referenceType,
      referenceId,
      batchLot = 'LOT-DEFAULT',
      performedBy = 'Inventory System',
      notes = '',
      timestamp = new Date().toISOString(),
      isSimulated = true,
    } = params;

    if (!quantity || quantity <= 0) {
      throw new InventoryAccountingError(
        `Transaction quantity must be strictly positive. Received: ${quantity}`,
        materialId,
        { requestedQuantity: quantity, transactionType }
      );
    }

    // Atomic transaction ensures idempotency and balance integrity under concurrency
    return await this.db.transaction(
      'rw',
      [this.db.materials, this.db.inventory_transactions],
      async () => {
        // 1. Idempotency Check
        const existingTx = await this.db.inventory_transactions
          .where('idempotencyKey')
          .equals(idempotencyKey)
          .first();

        if (existingTx) {
          throw new DuplicateTransactionError(
            idempotencyKey,
            `Transaction with idempotency key "${idempotencyKey}" already exists in the ledger.`
          );
        }

        // 2. Material Existence Check
        const material = await this.db.materials.get(materialId);
        if (!material) {
          throw new EntityNotFoundError('Material', materialId);
        }

        // 3. Current Stock Balance Calculation
        const balance = await this.getMaterialStockBalance(materialId);

        // 4. Strict Accounting Rule Validations
        switch (transactionType) {
          case 'PO_RECEIPT':
            // +Qty to physical stock. Always valid for positive quantities.
            break;

          case 'ALLOCATION': {
            // Reserves available material for an order/cutting job.
            // Available Stock = Physical Stock - Reserved Stock.
            // If requested allocation > Available Stock, available stock would become negative -> REJECT!
            if (quantity > balance.availableStock) {
              throw new InventoryAccountingError(
                `Insufficient available stock for allocation. Available: ${balance.availableStock} ${material.unit}, Requested allocation: ${quantity} ${material.unit}.`,
                materialId,
                {
                  physicalStock: balance.physicalStock,
                  reservedStock: balance.reservedStock,
                  availableStock: balance.availableStock,
                  requestedQuantity: quantity,
                  transactionType,
                }
              );
            }
            break;
          }

          case 'DEALLOCATION': {
            // Releases previously reserved material.
            // Cannot deallocate more than currently reserved stock.
            if (quantity > balance.reservedStock) {
              throw new InventoryAccountingError(
                `Cannot deallocate more than currently reserved stock. Currently reserved: ${balance.reservedStock} ${material.unit}, Requested deallocation: ${quantity} ${material.unit}.`,
                materialId,
                {
                  physicalStock: balance.physicalStock,
                  reservedStock: balance.reservedStock,
                  availableStock: balance.availableStock,
                  requestedQuantity: quantity,
                  transactionType,
                }
              );
            }
            break;
          }

          case 'CUTTING_ISSUE': {
            // Issues material from warehouse to cutting floor.
            // Rule: "Never issue more material than the quantity reserved."
            if (quantity > balance.reservedStock) {
              throw new InventoryAccountingError(
                `Cannot issue material exceeding reserved stock. Reserved: ${balance.reservedStock} ${material.unit}, Requested issue: ${quantity} ${material.unit}.`,
                materialId,
                {
                  physicalStock: balance.physicalStock,
                  reservedStock: balance.reservedStock,
                  availableStock: balance.availableStock,
                  requestedQuantity: quantity,
                  transactionType,
                }
              );
            }

            // Rule: Never permit negative physical stock.
            if (quantity > balance.physicalStock) {
              throw new InventoryAccountingError(
                `Cannot issue material exceeding physical stock. Physical: ${balance.physicalStock} ${material.unit}, Requested issue: ${quantity} ${material.unit}.`,
                materialId,
                {
                  physicalStock: balance.physicalStock,
                  reservedStock: balance.reservedStock,
                  availableStock: balance.availableStock,
                  requestedQuantity: quantity,
                  transactionType,
                }
              );
            }
            break;
          }

          case 'RETURN_TO_STORE':
            // +Qty to physical stock (leftover fabric returned from cutting floor)
            break;

          case 'SCRAP_ADJUSTMENT': {
            // -Qty from physical stock due to damage, fabric faults, or cutting waste.
            if (quantity > balance.physicalStock) {
              throw new InventoryAccountingError(
                `Cannot scrap more than physical stock. Physical: ${balance.physicalStock} ${material.unit}, Requested scrap: ${quantity} ${material.unit}.`,
                materialId,
                {
                  physicalStock: balance.physicalStock,
                  reservedStock: balance.reservedStock,
                  availableStock: balance.availableStock,
                  requestedQuantity: quantity,
                  transactionType,
                }
              );
            }
            // Cannot scrap if it would leave physical stock less than currently reserved allocations
            if (balance.physicalStock - quantity < balance.reservedStock) {
              throw new InventoryAccountingError(
                `Scrap adjustment of ${quantity} ${material.unit} would breach reserved stock obligations (${balance.reservedStock} ${material.unit}).`,
                materialId,
                {
                  physicalStock: balance.physicalStock,
                  reservedStock: balance.reservedStock,
                  availableStock: balance.availableStock,
                  requestedQuantity: quantity,
                  transactionType,
                }
              );
            }
            break;
          }
        }

        // 5. Record Transaction into the Ledger
        const newTx: InventoryTransactionEntity = {
          id: params.id || `tx-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          idempotencyKey,
          materialId,
          transactionType,
          quantity,
          referenceType,
          referenceId,
          batchLot,
          performedBy,
          notes,
          timestamp,
          isSimulated,
        };

        await this.db.inventory_transactions.add(newTx);
        return newTx;
      }
    );
  }

  /**
   * Retrieves transaction ledger history for a material
   */
  async getMaterialTransactions(materialId: string): Promise<InventoryTransactionEntity[]> {
    return this.db.inventory_transactions
      .where('materialId')
      .equals(materialId)
      .reverse()
      .sortBy('timestamp');
  }

  /**
   * Retrieves all transaction entries across all materials
   */
  async getAllTransactions(limit = 100): Promise<InventoryTransactionEntity[]> {
    return this.db.inventory_transactions.orderBy('timestamp').reverse().limit(limit).toArray();
  }
}
