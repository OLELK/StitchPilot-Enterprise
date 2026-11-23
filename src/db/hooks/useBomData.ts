import { useState, useEffect, useCallback } from 'react';
import { masterRepo } from '../repositories';
import { BomItemEntity } from '../types';

export interface BomVersionSummary {
  bomVersion: number;
  totalItems: number;
  activeItems: number;
  archivedItems: number;
}

export type CreateBomItemInput = Omit<
  BomItemEntity,
  'id' | 'createdAt' | 'updatedAt' | 'isSimulated'
> & {
  id?: string;
  isSimulated?: boolean;
};

export interface UseBomDataOptions {
  isDbReady: boolean;
  styleId: string | null;
  onDataMutated?: () => Promise<void> | void;
}

export function useBomData({ isDbReady, styleId, onDataMutated }: UseBomDataOptions) {
  const [bomItems, setBomItems] = useState<BomItemEntity[]>([]);
  const [versions, setVersions] = useState<BomVersionSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadStyleBom = useCallback(async () => {
    if (!isDbReady || !styleId) {
      setBomItems([]);
      setVersions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [allStyleItems, styleVersions] = await Promise.all([
        masterRepo.getBomByStyle(styleId, { includeArchived: true }),
        masterRepo.getBomVersionsByStyle(styleId),
      ]);
      setBomItems(allStyleItems);
      setVersions(styleVersions);
    } catch (err: any) {
      console.error('[useBomData] Error loading style BOM:', err);
      setError(err?.message || 'Failed to load Style BOM records.');
    } finally {
      setIsLoading(false);
    }
  }, [isDbReady, styleId]);

  useEffect(() => {
    loadStyleBom();
  }, [loadStyleBom]);

  const notifyMutation = useCallback(async () => {
    await loadStyleBom();
    if (onDataMutated) {
      await onDataMutated();
    }
  }, [loadStyleBom, onDataMutated]);

  const createBomItem = useCallback(
    async (input: CreateBomItemInput): Promise<BomItemEntity> => {
      const now = new Date().toISOString();
      const generatedId =
        input.id?.trim() ||
        `BOM-${input.styleId}-V${input.bomVersion ?? 1}-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;

      const created = await masterRepo.createBomItem({
        ...input,
        id: generatedId,
        status: input.status ?? 'ACTIVE',
        bomVersion: input.bomVersion ?? 1,
        isSimulated: input.isSimulated ?? false,
        createdAt: now,
        updatedAt: now,
      });
      await notifyMutation();
      return created;
    },
    [notifyMutation]
  );

  const updateBomItem = useCallback(
    async (id: string, updates: Partial<BomItemEntity>): Promise<BomItemEntity> => {
      const updated = await masterRepo.updateBomItem(id, updates);
      await notifyMutation();
      return updated;
    },
    [notifyMutation]
  );

  const archiveBomItem = useCallback(
    async (id: string): Promise<BomItemEntity> => {
      const archived = await masterRepo.archiveBomItem(id);
      await notifyMutation();
      return archived;
    },
    [notifyMutation]
  );

  const archiveBomVersion = useCallback(
    async (targetStyleId: string, bomVersion: number): Promise<BomItemEntity[]> => {
      const archivedItems = await masterRepo.archiveBomVersion(targetStyleId, bomVersion);
      await notifyMutation();
      return archivedItems;
    },
    [notifyMutation]
  );

  const cloneBomVersion = useCallback(
    async (
      targetStyleId: string,
      sourceVersion: number,
      targetVersion?: number
    ): Promise<BomItemEntity[]> => {
      const cloned = await masterRepo.cloneBomVersion(
        targetStyleId,
        sourceVersion,
        targetVersion
      );
      await notifyMutation();
      return cloned;
    },
    [notifyMutation]
  );

  return {
    bomItems,
    versions,
    isLoading,
    error,
    refreshBom: loadStyleBom,
    createBomItem,
    updateBomItem,
    archiveBomItem,
    archiveBomVersion,
    cloneBomVersion,
  };
}
