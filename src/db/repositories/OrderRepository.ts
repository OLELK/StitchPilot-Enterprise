import { StitchPilotDatabase } from '../database';
import {
  OrderEntity,
  OrderItemEntity,
  OrderStatus,
  OrderStatusHistoryEntry,
} from '../types';
import {
  EntityNotFoundError,
  RelationshipValidationError,
  ValidationError,
  InvalidStatusTransitionError,
} from '../errors';

export interface OrderStatistics {
  totalOrders: number;
  activeOrders: number;
  drafts: number;
  confirmed: number;
  inProduction: number;
  overdue: number;
  upcoming14Days: number;
  totalPieces: number;
}

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PRODUCTION', 'CUTTING', 'SEWING', 'DRAFT', 'CANCELLED'],
  IN_PRODUCTION: ['PARTIALLY_SHIPPED', 'COMPLETED', 'CUTTING', 'SEWING', 'FINISHING', 'FINAL_QC', 'PACKED', 'SHIPPED', 'CANCELLED'],
  CUTTING: ['SEWING', 'IN_PRODUCTION', 'CANCELLED'],
  SEWING: ['FINISHING', 'IN_PRODUCTION', 'CANCELLED'],
  FINISHING: ['FINAL_QC', 'PACKED', 'IN_PRODUCTION', 'CANCELLED'],
  FINAL_QC: ['PACKED', 'SHIPPED', 'COMPLETED', 'IN_PRODUCTION', 'CANCELLED'],
  PACKED: ['SHIPPED', 'PARTIALLY_SHIPPED', 'COMPLETED', 'CANCELLED'],
  PARTIALLY_SHIPPED: ['COMPLETED', 'SHIPPED', 'CANCELLED'],
  COMPLETED: [], // Terminal
  SHIPPED: [], // Terminal
  CANCELLED: [], // Strictly Terminal: Cancelled orders MUST NOT proceed into production workflows
};

export class OrderRepository {
  constructor(private db: StitchPilotDatabase) {}

  async getAllOrders(): Promise<OrderEntity[]> {
    return this.db.orders.orderBy('createdAt').reverse().toArray();
  }

  async getOrderById(id: string): Promise<OrderEntity | undefined> {
    return this.db.orders.get(id);
  }

  async getOrderByPo(poNumber: string): Promise<OrderEntity | undefined> {
    const normalized = poNumber.trim().toUpperCase();
    const orders = await this.db.orders.toArray();
    return orders.find((o) => o.poNumber.toUpperCase() === normalized);
  }

  async getOrderByInternalNumber(internalOrderNumber: string): Promise<OrderEntity | undefined> {
    const normalized = internalOrderNumber.trim().toUpperCase();
    const orders = await this.db.orders.toArray();
    return orders.find((o) => o.internalOrderNumber?.toUpperCase() === normalized);
  }

  async getOrderItems(orderId: string): Promise<OrderItemEntity[]> {
    return this.db.order_items.where('orderId').equals(orderId).toArray();
  }

  async getActiveOrdersCount(): Promise<number> {
    return this.db.orders
      .where('status')
      .noneOf(['COMPLETED', 'SHIPPED', 'CANCELLED'])
      .count();
  }

  // Normalize items so every item references the real parent orderId and has an order-scoped unique primary key
  private normalizeOrderItems(orderId: string, items: OrderItemEntity[]): OrderItemEntity[] {
    return items.map((item) => {
      const safeColor = encodeURIComponent(item.color);
      const safeSize = encodeURIComponent(item.size);
      const hasPlaceholderOrMismatch =
        !item.id ||
        item.id.includes('ORD-NEW') ||
        item.id.includes('ORD-TEMP') ||
        item.orderId !== orderId;

      return {
        ...item,
        id: hasPlaceholderOrMismatch ? `ITM-${orderId}-${safeColor}-${safeSize}` : item.id,
        orderId,
      };
    });
  }

  // Validate matrix and master relationships
  private async validateOrderData(
    order: OrderEntity,
    items: OrderItemEntity[] = [],
    isNew: boolean = true
  ): Promise<void> {
    // 1. Required fields
    if (!order.id || !order.id.trim()) {
      throw new ValidationError('Order ID is required.', 'id');
    }
    if (!order.poNumber || !order.poNumber.trim()) {
      throw new ValidationError('Buyer PO number is required.', 'poNumber');
    }
    if (!order.buyerId || !order.buyerId.trim()) {
      throw new ValidationError('Buyer selection is required.', 'buyerId');
    }
    if (!order.styleId || !order.styleId.trim()) {
      throw new ValidationError('Garment style selection is required.', 'styleId');
    }
    if (!order.targetExFactoryDate) {
      throw new ValidationError('Target delivery date is required.', 'targetExFactoryDate');
    }

    // 2. Validate Order Quantity & Produced Quantity
    if (typeof order.orderQuantity !== 'number' || !Number.isInteger(order.orderQuantity) || order.orderQuantity <= 0) {
      throw new ValidationError(
        'Order quantity must be a positive integer.',
        'orderQuantity',
        { orderQuantity: order.orderQuantity }
      );
    }

    if (
      order.producedQuantity !== undefined &&
      (typeof order.producedQuantity !== 'number' ||
        !Number.isFinite(order.producedQuantity) ||
        !Number.isInteger(order.producedQuantity) ||
        order.producedQuantity < 0)
    ) {
      throw new ValidationError(
        'Produced quantity cannot be negative. Enter 0 or a positive whole number.',
        'producedQuantity',
        { producedQuantity: order.producedQuantity }
      );
    }

    // 3. Foreign key validations
    const buyer = await this.db.buyers.get(order.buyerId);
    if (!buyer) {
      throw new RelationshipValidationError(
        'Order',
        'Buyer',
        order.buyerId,
        'Referenced buyer does not exist in master records.'
      );
    }

    const style = await this.db.styles.get(order.styleId);
    if (!style) {
      throw new RelationshipValidationError(
        'Order',
        'Style',
        order.styleId,
        'Referenced garment style does not exist in master records.'
      );
    }

    if (order.additionalStyleIds && order.additionalStyleIds.length > 0) {
      for (const additionalId of order.additionalStyleIds) {
        const extraStyle = await this.db.styles.get(additionalId);
        if (!extraStyle) {
          throw new RelationshipValidationError(
            'Order',
            'Additional Style',
            additionalId,
            `Additional referenced style "${additionalId}" does not exist in master records.`
          );
        }
      }
    }

    // 4. Duplicate PO check
    const existingPo = await this.getOrderByPo(order.poNumber);
    if (existingPo && (isNew || existingPo.id !== order.id)) {
      throw new ValidationError(
        `Purchase Order number "${order.poNumber}" is already registered.`,
        'poNumber'
      );
    }

    // 5. Size-wise matrix breakdown items validation
    if (items.length > 0) {
      let sumOfItems = 0;
      const seenCombinations = new Set<string>();
      for (const item of items) {
        if (!item.color || !item.color.trim()) {
          throw new ValidationError('Order item colourway is required.', 'color', { item });
        }
        if (!item.size || !item.size.trim()) {
          throw new ValidationError('Order item size is required.', 'size', { item });
        }
        if (item.orderId !== order.id) {
          throw new RelationshipValidationError(
            'OrderItem',
            'Order',
            item.orderId,
            `Order item "${item.id}" references mismatched orderId "${item.orderId}" instead of "${order.id}".`
          );
        }
        const comboKey = `${item.color.trim().toUpperCase()}::${item.size.trim().toUpperCase()}`;
        if (seenCombinations.has(comboKey)) {
          throw new ValidationError(
            `Duplicate colour/size combination "${item.color} / ${item.size}" in order breakdown.`,
            'items',
            { item }
          );
        }
        seenCombinations.add(comboKey);

        if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 0) {
          throw new ValidationError(
            `Item size "${item.size}" color "${item.color}" has invalid quantity "${item.quantity}". Quantities must be non-negative integers.`,
            'quantity',
            { item }
          );
        }
        sumOfItems += item.quantity;
      }

      if (sumOfItems !== order.orderQuantity) {
        throw new ValidationError(
          `Order total quantity (${order.orderQuantity.toLocaleString()} pcs) must strictly match the sum of size breakdown items (${sumOfItems.toLocaleString()} pcs).`,
          'orderQuantity',
          { orderQuantity: order.orderQuantity, sumOfItems }
        );
      }
    }
  }

  async createOrder(
    order: OrderEntity,
    items: OrderItemEntity[] = []
  ): Promise<{ order: OrderEntity; items: OrderItemEntity[] }> {
    const resolvedOrderId =
      order.id && order.id.trim()
        ? order.id.trim()
        : `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const now = new Date().toISOString();
    const initialHistory: OrderStatusHistoryEntry[] = order.statusHistory || [
      {
        toStatus: order.status || 'DRAFT',
        timestamp: now,
        note: `Order registered with PO "${order.poNumber}" (${order.orderQuantity.toLocaleString()} pcs)`,
        updatedBy: 'Merchandiser',
      },
    ];

    const orderToSave: OrderEntity = {
      ...order,
      id: resolvedOrderId,
      poNumber: order.poNumber.trim().toUpperCase(),
      internalOrderNumber: order.internalOrderNumber
        ? order.internalOrderNumber.trim().toUpperCase()
        : undefined,
      status: order.status || 'DRAFT',
      statusHistory: initialHistory,
      createdAt: order.createdAt || now,
      updatedAt: now,
    };

    const itemsToSave = this.normalizeOrderItems(resolvedOrderId, items);

    await this.validateOrderData(orderToSave, itemsToSave, true);

    return await this.db.transaction('rw', [this.db.orders, this.db.order_items], async () => {
      await this.db.orders.add(orderToSave);
      if (itemsToSave.length > 0) {
        await this.db.order_items.bulkAdd(itemsToSave);
      }
      return { order: orderToSave, items: itemsToSave };
    });
  }

  async updateOrder(
    orderId: string,
    updates: Partial<OrderEntity>,
    newItems?: OrderItemEntity[]
  ): Promise<{ order: OrderEntity; items?: OrderItemEntity[] }> {
    const existing = await this.db.orders.get(orderId);
    if (!existing) {
      throw new EntityNotFoundError('Order', orderId);
    }

    if (existing.status === 'CANCELLED') {
      throw new ValidationError(
        'Cannot edit a cancelled order. Cancelled orders are immutable.',
        'status'
      );
    }

    const merged: OrderEntity = {
      ...existing,
      ...updates,
      id: orderId,
      poNumber: (updates.poNumber ?? existing.poNumber).trim().toUpperCase(),
      updatedAt: new Date().toISOString(),
    };

    const itemsToSave = newItems ? this.normalizeOrderItems(orderId, newItems) : undefined;

    // If items are provided, validate them and reconcile with merged orderQuantity
    if (itemsToSave) {
      await this.validateOrderData(merged, itemsToSave, false);
    } else {
      // Validate merged order data with existing items
      const currentItems = await this.getOrderItems(orderId);
      await this.validateOrderData(merged, currentItems, false);
    }

    return await this.db.transaction('rw', [this.db.orders, this.db.order_items], async () => {
      await this.db.orders.put(merged);
      if (itemsToSave) {
        await this.db.order_items.where('orderId').equals(orderId).delete();
        if (itemsToSave.length > 0) {
          await this.db.order_items.bulkAdd(itemsToSave);
        }
      }
      return { order: merged, items: itemsToSave };
    });
  }

  async updateOrderStatus(
    orderId: string,
    toStatus: OrderStatus,
    reason?: string,
    updatedBy: string = 'Production Lead'
  ): Promise<OrderEntity> {
    const order = await this.db.orders.get(orderId);
    if (!order) {
      throw new EntityNotFoundError('Order', orderId);
    }

    const currentStatus = order.status;
    if (currentStatus === toStatus) {
      return order; // No-op
    }

    // STRICT RULE: Cancelled orders MUST NOT proceed into production or active workflows
    if (currentStatus === 'CANCELLED') {
      throw new InvalidStatusTransitionError(
        orderId,
        'CANCELLED',
        toStatus,
        'Cancelled orders are permanently terminated and cannot proceed into production or be reopened.'
      );
    }

    if (currentStatus === 'COMPLETED' && toStatus !== 'COMPLETED') {
      throw new InvalidStatusTransitionError(
        orderId,
        'COMPLETED',
        toStatus,
        'Completed orders have completed final shipment and cannot be transitioned back.'
      );
    }

    const allowedNextStatuses = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowedNextStatuses.includes(toStatus)) {
      throw new InvalidStatusTransitionError(
        orderId,
        currentStatus,
        toStatus,
        `Valid next statuses from ${currentStatus} are: ${allowedNextStatuses.join(', ')}`
      );
    }

    const now = new Date().toISOString();
    const historyEntry: OrderStatusHistoryEntry = {
      fromStatus: currentStatus,
      toStatus,
      timestamp: now,
      note: reason || `Status transitioned from ${currentStatus} to ${toStatus}`,
      updatedBy,
    };

    const updatedHistory = [...(order.statusHistory || []), historyEntry];
    const updated: OrderEntity = {
      ...order,
      status: toStatus,
      statusHistory: updatedHistory,
      updatedAt: now,
    };

    await this.db.orders.put(updated);
    return updated;
  }

  async cancelOrder(
    orderId: string,
    reason: string,
    cancelledBy: string = 'Merchandiser'
  ): Promise<OrderEntity> {
    const order = await this.db.orders.get(orderId);
    if (!order) {
      throw new EntityNotFoundError('Order', orderId);
    }

    if (order.status === 'CANCELLED') {
      return order;
    }

    const now = new Date().toISOString();
    const historyEntry: OrderStatusHistoryEntry = {
      fromStatus: order.status,
      toStatus: 'CANCELLED',
      timestamp: now,
      note: `ORDER CANCELLED: ${reason || 'Cancelled by merchandising'}`,
      updatedBy: cancelledBy,
    };

    const updated: OrderEntity = {
      ...order,
      status: 'CANCELLED',
      statusHistory: [...(order.statusHistory || []), historyEntry],
      updatedAt: now,
    };

    await this.db.orders.put(updated);
    return updated;
  }

  async updateOrderProgress(orderId: string, producedQuantity: number): Promise<OrderEntity> {
    if (
      typeof producedQuantity !== 'number' ||
      !Number.isFinite(producedQuantity) ||
      !Number.isInteger(producedQuantity) ||
      producedQuantity < 0
    ) {
      throw new ValidationError(
        'Produced quantity cannot be negative. Enter 0 or a positive whole number.',
        'producedQuantity',
        { producedQuantity }
      );
    }

    const order = await this.db.orders.get(orderId);
    if (!order) {
      throw new EntityNotFoundError('Order', orderId);
    }

    const updated: OrderEntity = {
      ...order,
      producedQuantity,
      updatedAt: new Date().toISOString(),
    };
    await this.db.orders.put(updated);
    return updated;
  }

  async getOrderStatistics(): Promise<OrderStatistics> {
    const allOrders = await this.db.orders.toArray();
    const today = new Date().toISOString().split('T')[0];
    const future14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let drafts = 0;
    let confirmed = 0;
    let inProduction = 0;
    let overdue = 0;
    let upcoming14Days = 0;
    let totalPieces = 0;
    let activeOrders = 0;

    for (const ord of allOrders) {
      if (ord.status === 'DRAFT') drafts++;
      if (ord.status === 'CONFIRMED') confirmed++;
      if (
        ord.status === 'IN_PRODUCTION' ||
        ['CUTTING', 'SEWING', 'FINISHING', 'FINAL_QC', 'PACKED'].includes(ord.status)
      ) {
        inProduction++;
      }

      const isClosed = ord.status === 'COMPLETED' || ord.status === 'CANCELLED' || ord.status === 'SHIPPED';
      if (!isClosed) {
        activeOrders++;
        totalPieces += ord.orderQuantity;

        if (ord.targetExFactoryDate < today) {
          overdue++;
        } else if (ord.targetExFactoryDate >= today && ord.targetExFactoryDate <= future14) {
          upcoming14Days++;
        }
      }
    }

    return {
      totalOrders: allOrders.length,
      activeOrders,
      drafts,
      confirmed,
      inProduction,
      overdue,
      upcoming14Days,
      totalPieces,
    };
  }
}
