import { StitchPilotDatabase } from '../database';
import {
  BuyerEntity,
  StyleEntity,
  CostSheetEntity,
  BomItemEntity,
} from '../types';
import {
  EntityNotFoundError,
  RelationshipValidationError,
  ValidationError,
} from '../errors';
import { getUomConversionFactor } from '../services/uomConverter';

export class MasterRepository {
  constructor(private db: StitchPilotDatabase) {}

  // ====================================================
  // Buyers (Phase 2B)
  // ====================================================
  async getAllBuyers(): Promise<BuyerEntity[]> {
    return this.db.buyers.toArray();
  }

  async getBuyerById(id: string): Promise<BuyerEntity | undefined> {
    return this.db.buyers.get(id);
  }

  async getBuyerByCode(code: string): Promise<BuyerEntity | undefined> {
    const normalized = code.trim().toUpperCase();
    const buyers = await this.db.buyers.toArray();
    return buyers.find((b) => b.code.toUpperCase() === normalized);
  }

  async createBuyer(buyer: BuyerEntity): Promise<BuyerEntity> {
    if (!buyer.name || !buyer.name.trim()) {
      throw new ValidationError('Buyer name is required.', 'name');
    }
    if (!buyer.code || !buyer.code.trim()) {
      throw new ValidationError('Buyer code is required.', 'code');
    }
    if (!buyer.country || !buyer.country.trim()) {
      throw new ValidationError('Buyer country is required.', 'country');
    }

    const normalizedCode = buyer.code.trim().toUpperCase();
    const existing = await this.getBuyerByCode(normalizedCode);
    if (existing) {
      throw new ValidationError(
        `Buyer code "${normalizedCode}" already exists. Buyer codes must be unique.`,
        'code'
      );
    }

    const record: BuyerEntity = {
      ...buyer,
      code: normalizedCode,
      status: buyer.status || 'ACTIVE',
      createdAt: buyer.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.db.buyers.add(record);
    return record;
  }

  async updateBuyer(id: string, updates: Partial<BuyerEntity>): Promise<BuyerEntity> {
    const existing = await this.db.buyers.get(id);
    if (!existing) {
      throw new EntityNotFoundError('Buyer', id);
    }

    if (updates.code) {
      const normalizedCode = updates.code.trim().toUpperCase();
      if (normalizedCode !== existing.code.toUpperCase()) {
        const duplicate = await this.getBuyerByCode(normalizedCode);
        if (duplicate && duplicate.id !== id) {
          throw new ValidationError(
            `Buyer code "${normalizedCode}" is already in use by another buyer.`,
            'code'
          );
        }
      }
      updates.code = normalizedCode;
    }

    const updated: BuyerEntity = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.db.buyers.put(updated);
    return updated;
  }

  // ====================================================
  // Styles (Phase 2B)
  // ====================================================
  async getAllStyles(): Promise<StyleEntity[]> {
    return this.db.styles.toArray();
  }

  async getStyleById(id: string): Promise<StyleEntity | undefined> {
    return this.db.styles.get(id);
  }

  async getStyleByCode(styleCode: string): Promise<StyleEntity | undefined> {
    const normalized = styleCode.trim().toUpperCase();
    const styles = await this.db.styles.toArray();
    return styles.find((s) => s.styleCode.toUpperCase() === normalized);
  }

  async getStylesByBuyer(buyerId: string): Promise<StyleEntity[]> {
    return this.db.styles.where('buyerId').equals(buyerId).toArray();
  }

  async createStyle(style: StyleEntity): Promise<StyleEntity> {
    if (!style.styleCode || !style.styleCode.trim()) {
      throw new ValidationError('Style code is required.', 'styleCode');
    }
    if (!style.description || !style.description.trim()) {
      throw new ValidationError('Style description is required.', 'description');
    }
    if (!style.buyerId || !style.buyerId.trim()) {
      throw new ValidationError('Buyer reference is required.', 'buyerId');
    }

    // Validate Buyer exists
    const buyer = await this.db.buyers.get(style.buyerId);
    if (!buyer) {
      throw new RelationshipValidationError(
        'Style',
        'Buyer',
        style.buyerId,
        'Cannot register style for non-existent buyer.'
      );
    }

    const normalizedCode = style.styleCode.trim().toUpperCase();
    const existing = await this.getStyleByCode(normalizedCode);
    if (existing) {
      throw new ValidationError(
        `Style code "${normalizedCode}" already exists. Style codes must be unique.`,
        'styleCode'
      );
    }

    const record: StyleEntity = {
      ...style,
      styleCode: normalizedCode,
      status: style.status || 'ACTIVE',
      createdAt: style.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.db.styles.add(record);
    return record;
  }

  async updateStyle(id: string, updates: Partial<StyleEntity>): Promise<StyleEntity> {
    const existing = await this.db.styles.get(id);
    if (!existing) {
      throw new EntityNotFoundError('Style', id);
    }

    if (updates.buyerId) {
      const buyer = await this.db.buyers.get(updates.buyerId);
      if (!buyer) {
        throw new RelationshipValidationError(
          'Style',
          'Buyer',
          updates.buyerId,
          'Referenced buyer does not exist in master records.'
        );
      }
    }

    if (updates.styleCode) {
      const normalized = updates.styleCode.trim().toUpperCase();
      if (normalized !== existing.styleCode.toUpperCase()) {
        const duplicate = await this.getStyleByCode(normalized);
        if (duplicate && duplicate.id !== id) {
          throw new ValidationError(
            `Style code "${normalized}" is already in use by another style.`,
            'styleCode'
          );
        }
      }
      updates.styleCode = normalized;
    }

    const updated: StyleEntity = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.db.styles.put(updated);
    return updated;
  }

  // Cost Sheets
  async getCostSheetByStyle(styleId: string): Promise<CostSheetEntity | undefined> {
    return this.db.cost_sheets.where('styleId').equals(styleId).first();
  }

  async createCostSheet(costSheet: CostSheetEntity): Promise<CostSheetEntity> {
    const style = await this.db.styles.get(costSheet.styleId);
    if (!style) {
      throw new RelationshipValidationError(
        'CostSheet',
        'Style',
        costSheet.styleId,
        'Cannot create cost sheet for non-existent style.'
      );
    }
    await this.db.cost_sheets.add(costSheet);
    return costSheet;
  }

  // ====================================================
  // BOM Items (Phase 3A Stage 2)
  // ====================================================
  private async validateAndNormalizeBomItem(
    bomItem: BomItemEntity
  ): Promise<BomItemEntity> {
    if (!bomItem.id || !bomItem.id.trim()) {
      throw new ValidationError('BOM item ID is required.', 'id');
    }
    if (!bomItem.styleId || !bomItem.styleId.trim()) {
      throw new ValidationError('Style ID is required for BOM item.', 'styleId');
    }
    if (!bomItem.materialId || !bomItem.materialId.trim()) {
      throw new ValidationError('Material ID is required for BOM item.', 'materialId');
    }
    if (!bomItem.placement || !bomItem.placement.trim()) {
      throw new ValidationError('Component placement description is required.', 'placement');
    }
    if (
      typeof bomItem.consumptionPerGarment !== 'number' ||
      !Number.isFinite(bomItem.consumptionPerGarment) ||
      bomItem.consumptionPerGarment <= 0
    ) {
      throw new ValidationError(
        `BOM item consumptionPerGarment must be a positive finite number (received ${bomItem.consumptionPerGarment}).`,
        'consumptionPerGarment'
      );
    }
    if (
      typeof bomItem.wastagePercent !== 'number' ||
      !Number.isFinite(bomItem.wastagePercent) ||
      bomItem.wastagePercent < 0
    ) {
      throw new ValidationError(
        `BOM item wastagePercent must be a non-negative finite number (received ${bomItem.wastagePercent}).`,
        'wastagePercent'
      );
    }

    const bomVersion = bomItem.bomVersion ?? 1;
    if (!Number.isInteger(bomVersion) || bomVersion < 1) {
      throw new ValidationError(
        `BOM version must be a positive integer (received ${bomVersion}).`,
        'bomVersion'
      );
    }

    const status = bomItem.status ?? 'ACTIVE';
    if (status !== 'ACTIVE' && status !== 'ARCHIVED') {
      throw new ValidationError(
        `Invalid BOM status "${status}". Expected ACTIVE or ARCHIVED.`,
        'status'
      );
    }

    const consumptionBasis = bomItem.consumptionBasis ?? 'PER_PIECE';
    if (consumptionBasis !== 'PER_PIECE' && consumptionBasis !== 'PER_DOZEN') {
      throw new ValidationError(
        `Invalid consumptionBasis "${consumptionBasis}". Expected PER_PIECE or PER_DOZEN.`,
        'consumptionBasis'
      );
    }

    const style = await this.db.styles.get(bomItem.styleId);
    if (!style) {
      throw new RelationshipValidationError(
        'BOM Item',
        'Style',
        bomItem.styleId,
        'Referenced style does not exist.'
      );
    }

    const material = await this.db.materials.get(bomItem.materialId);
    if (!material) {
      throw new RelationshipValidationError(
        'BOM Item',
        'Material',
        bomItem.materialId,
        'Referenced material does not exist.'
      );
    }

    const consumptionUnit = bomItem.consumptionUnit ?? material.unit;
    // Validate UOM conversion path to material's stock unit upfront
    getUomConversionFactor(consumptionUnit, material.unit, material.uomAttributes);

    const colorScope = bomItem.colorScope ?? 'ALL';
    if (colorScope === 'SPECIFIC') {
      if (!bomItem.applicableColors || bomItem.applicableColors.length === 0) {
        throw new ValidationError(
          'BOM item with colorScope "SPECIFIC" must specify at least one colour in applicableColors.',
          'applicableColors'
        );
      }
      if (bomItem.applicableColors.some((c) => !c || !c.trim())) {
        throw new ValidationError(
          'applicableColors cannot contain empty colour names.',
          'applicableColors'
        );
      }
    }

    const sizeScope = bomItem.sizeScope ?? 'ALL';
    if (sizeScope === 'SPECIFIC') {
      if (!bomItem.applicableSizes || bomItem.applicableSizes.length === 0) {
        throw new ValidationError(
          'BOM item with sizeScope "SPECIFIC" must specify at least one size in applicableSizes.',
          'applicableSizes'
        );
      }
      if (bomItem.applicableSizes.some((s) => !s || !s.trim())) {
        throw new ValidationError(
          'applicableSizes cannot contain empty size labels.',
          'applicableSizes'
        );
      }
    }

    if (bomItem.sizeConsumptionMap) {
      for (const [sz, qty] of Object.entries(bomItem.sizeConsumptionMap)) {
        if (!sz.trim()) {
          throw new ValidationError('sizeConsumptionMap cannot contain blank size keys.', 'sizeConsumptionMap');
        }
        if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
          throw new ValidationError(
            `Invalid sizeConsumptionMap override for size "${sz}": must be positive finite number (received ${qty}).`,
            'sizeConsumptionMap'
          );
        }
      }
    }

    const now = new Date().toISOString();
    return {
      ...bomItem,
      bomVersion,
      status,
      consumptionBasis,
      consumptionUnit,
      colorScope,
      applicableColors:
        colorScope === 'SPECIFIC'
          ? bomItem.applicableColors?.map((c) => c.trim())
          : bomItem.applicableColors,
      sizeScope,
      applicableSizes:
        sizeScope === 'SPECIFIC'
          ? bomItem.applicableSizes?.map((s) => s.trim())
          : bomItem.applicableSizes,
      placement: bomItem.placement.trim(),
      createdAt: bomItem.createdAt || now,
      updatedAt: bomItem.updatedAt || now,
    };
  }

  async getBomItemById(id: string): Promise<BomItemEntity | undefined> {
    return this.db.bom_items.get(id);
  }

  async getBomByStyle(
    styleId: string,
    options?: { includeArchived?: boolean; bomVersion?: number }
  ): Promise<BomItemEntity[]> {
    let items: BomItemEntity[];
    if (options?.bomVersion !== undefined) {
      items = await this.db.bom_items
        .where('[styleId+bomVersion]')
        .equals([styleId, options.bomVersion])
        .toArray();
    } else {
      items = await this.db.bom_items.where('styleId').equals(styleId).toArray();
    }

    if (options?.includeArchived === false) {
      return items.filter((i) => i.status !== 'ARCHIVED');
    }
    return items;
  }

  async getActiveBomByStyle(
    styleId: string,
    bomVersion?: number
  ): Promise<BomItemEntity[]> {
    if (bomVersion !== undefined) {
      const versionItems = await this.db.bom_items
        .where('[styleId+bomVersion]')
        .equals([styleId, bomVersion])
        .toArray();
      return versionItems.filter((item) => item.status !== 'ARCHIVED');
    }

    const allStyleItems = await this.db.bom_items
      .where('styleId')
      .equals(styleId)
      .toArray();
    const activeItems = allStyleItems.filter((item) => item.status !== 'ARCHIVED');
    if (activeItems.length === 0) return [];

    // Resolve the highest version among active items so multi-version styles stay isolated
    const latestActiveVersion = Math.max(
      ...activeItems.map((item) => item.bomVersion ?? 1)
    );
    return activeItems.filter(
      (item) => (item.bomVersion ?? 1) === latestActiveVersion
    );
  }

  async getBomByStyleAndVersion(
    styleId: string,
    bomVersion: number
  ): Promise<BomItemEntity[]> {
    return this.db.bom_items
      .where('[styleId+bomVersion]')
      .equals([styleId, bomVersion])
      .toArray();
  }

  async getBomVersionsByStyle(
    styleId: string
  ): Promise<Array<{ bomVersion: number; totalItems: number; activeItems: number; archivedItems: number }>> {
    const items = await this.db.bom_items.where('styleId').equals(styleId).toArray();
    const map = new Map<number, { total: number; active: number; archived: number }>();

    for (const item of items) {
      const ver = item.bomVersion ?? 1;
      const entry = map.get(ver) || { total: 0, active: 0, archived: 0 };
      entry.total += 1;
      if (item.status === 'ARCHIVED') {
        entry.archived += 1;
      } else {
        entry.active += 1;
      }
      map.set(ver, entry);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => b - a)
      .map(([bomVersion, counts]) => ({
        bomVersion,
        totalItems: counts.total,
        activeItems: counts.active,
        archivedItems: counts.archived,
      }));
  }

  async createBomItem(bomItem: BomItemEntity): Promise<BomItemEntity> {
    const normalized = await this.validateAndNormalizeBomItem({
      ...bomItem,
      updatedAt: new Date().toISOString(),
    });
    await this.db.bom_items.add(normalized);
    return normalized;
  }

  async updateBomItem(
    id: string,
    updates: Partial<BomItemEntity>
  ): Promise<BomItemEntity> {
    const existing = await this.db.bom_items.get(id);
    if (!existing) {
      throw new EntityNotFoundError('BomItem', id);
    }

    const merged: BomItemEntity = {
      ...existing,
      ...updates,
      id, // Preserve primary key
      updatedAt: new Date().toISOString(),
    };

    const validated = await this.validateAndNormalizeBomItem(merged);
    await this.db.bom_items.put(validated);
    return validated;
  }

  async archiveBomItem(id: string): Promise<BomItemEntity> {
    const existing = await this.db.bom_items.get(id);
    if (!existing) {
      throw new EntityNotFoundError('BomItem', id);
    }

    if (existing.status === 'ARCHIVED') {
      return existing;
    }

    const archived: BomItemEntity = {
      ...existing,
      status: 'ARCHIVED',
      updatedAt: new Date().toISOString(),
    };
    await this.db.bom_items.put(archived);
    return archived;
  }

  async archiveBomVersion(
    styleId: string,
    bomVersion: number
  ): Promise<BomItemEntity[]> {
    const style = await this.db.styles.get(styleId);
    if (!style) {
      throw new EntityNotFoundError('Style', styleId);
    }

    return await this.db.transaction('rw', [this.db.bom_items], async () => {
      const items = await this.db.bom_items
        .where('[styleId+bomVersion]')
        .equals([styleId, bomVersion])
        .toArray();

      if (items.length === 0) {
        throw new ValidationError(
          `No BOM items found for style "${styleId}" version ${bomVersion}.`,
          'bomVersion'
        );
      }

      const now = new Date().toISOString();
      const updated = items.map((item) =>
        item.status === 'ARCHIVED'
          ? item
          : { ...item, status: 'ARCHIVED' as const, updatedAt: now }
      );
      await this.db.bom_items.bulkPut(updated);
      return updated;
    });
  }

  async cloneBomVersion(
    styleId: string,
    sourceVersion: number,
    targetVersion?: number
  ): Promise<BomItemEntity[]> {
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
      throw new ValidationError(
        `Source BOM version must be a positive integer (received ${sourceVersion}).`,
        'sourceVersion'
      );
    }

    return await this.db.transaction(
      'rw',
      [this.db.styles, this.db.materials, this.db.bom_items],
      async () => {
        const style = await this.db.styles.get(styleId);
        if (!style) {
          throw new EntityNotFoundError('Style', styleId);
        }

        const allStyleItems = await this.db.bom_items
          .where('styleId')
          .equals(styleId)
          .toArray();

        const activeSourceItems = allStyleItems.filter(
          (item) => (item.bomVersion ?? 1) === sourceVersion && item.status !== 'ARCHIVED'
        );

        if (activeSourceItems.length === 0) {
          throw new ValidationError(
            `Cannot clone BOM version ${sourceVersion} for style "${styleId}": no ACTIVE components exist in this version.`,
            'sourceVersion'
          );
        }

        const maxExistingVersion = allStyleItems.reduce(
          (max, item) => Math.max(max, item.bomVersion ?? 1),
          0
        );
        const resolvedTargetVersion =
          targetVersion !== undefined ? targetVersion : maxExistingVersion + 1;

        if (!Number.isInteger(resolvedTargetVersion) || resolvedTargetVersion < 1) {
          throw new ValidationError(
            `Target BOM version must be a positive integer (received ${resolvedTargetVersion}).`,
            'targetVersion'
          );
        }

        if (
          allStyleItems.some(
            (item) => (item.bomVersion ?? 1) === resolvedTargetVersion
          )
        ) {
          throw new ValidationError(
            `BOM version ${resolvedTargetVersion} already exists for style "${styleId}".`,
            'targetVersion'
          );
        }

        const now = new Date().toISOString();
        const stamp = Date.now().toString(36);
        const clonedItems: BomItemEntity[] = [];

        for (let idx = 0; idx < activeSourceItems.length; idx++) {
          const src = activeSourceItems[idx];
          const rand = Math.random().toString(36).slice(2, 6);
          const candidate: BomItemEntity = {
            ...src,
            id: `BOM-${styleId}-V${resolvedTargetVersion}-${idx + 1}-${stamp}-${rand}`,
            bomVersion: resolvedTargetVersion,
            status: 'ACTIVE',
            applicableColors: src.applicableColors ? [...src.applicableColors] : undefined,
            applicableSizes: src.applicableSizes ? [...src.applicableSizes] : undefined,
            sizeConsumptionMap: src.sizeConsumptionMap
              ? { ...src.sizeConsumptionMap }
              : undefined,
            isSimulated: false,
            createdAt: now,
            updatedAt: now,
          };
          const validated = await this.validateAndNormalizeBomItem(candidate);
          clonedItems.push(validated);
        }

        await this.db.bom_items.bulkAdd(clonedItems);
        return clonedItems;
      }
    );
  }
}
