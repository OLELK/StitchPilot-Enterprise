import { useState, useEffect, useCallback } from 'react';
import { inventoryRepo } from '../repositories';
import { MaterialEntity, MaterialStockBalance, InventoryTransactionType, InventoryReferenceType } from '../types';

export function useInventoryData(isDbReady: boolean) {
  const [materials, setMaterials] = useState<MaterialEntity[]>([]);
  const [stockBalances, setStockBalances] = useState<MaterialStockBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInventory = useCallback(async () => {
    if (!isDbReady) return;
    setIsLoading(true);
    setError(null);
    try {
      const [allMaterials, allBalances] = await Promise.all([
        inventoryRepo.getAllMaterials(),
        inventoryRepo.getAllStockBalances(),
      ]);
      setMaterials(allMaterials);
      setStockBalances(allBalances);
    } catch (err: any) {
      console.error('[useInventoryData] Error:', err);
      setError(err?.message || 'Failed to fetch inventory balances.');
    } finally {
      setIsLoading(false);
    }
  }, [isDbReady]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  /**
   * Post a ledger transaction (PO_RECEIPT, ALLOCATION, DEALLOCATION, CUTTING_ISSUE, etc.)
   */
  const postTransaction = async (params: {
    materialId: string;
    transactionType: InventoryTransactionType;
    quantity: number;
    referenceType: InventoryReferenceType;
    referenceId: string;
    notes?: string;
    batchLot?: string;
  }) => {
    const idempotencyKey = `IDEMP-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const tx = await inventoryRepo.postTransaction({
      ...params,
      idempotencyKey,
    });
    await fetchInventory();
    return tx;
  };

  /**
   * Register a new raw material and optionally post an initial receipt
   */
  const createMaterial = async (
    material: Omit<MaterialEntity, 'createdAt' | 'updatedAt'>,
    initialReceiptQty?: number
  ) => {
    const entity = await inventoryRepo.createMaterial(material);
    if (initialReceiptQty && initialReceiptQty > 0) {
      await inventoryRepo.postTransaction({
        idempotencyKey: `IDEMP-INIT-${entity.id}-${Date.now()}`,
        materialId: entity.id,
        transactionType: 'PO_RECEIPT',
        quantity: initialReceiptQty,
        referenceType: 'INITIAL_INVENTORY',
        referenceId: `INIT-${entity.materialCode}`,
        notes: 'Initial material receipt on registration',
        batchLot: 'LOT-NEW-01',
      });
    }
    await fetchInventory();
    return entity;
  };

  return {
    materials,
    stockBalances,
    isLoading,
    error,
    postTransaction,
    createMaterial,
    refreshInventory: fetchInventory,
  };
}
