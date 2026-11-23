import { useState, useEffect, useCallback } from 'react';
import { orderRepo, masterRepo } from '../repositories';
import {
  OrderEntity,
  OrderItemEntity,
  BuyerEntity,
  StyleEntity,
  OrderStatus,
} from '../types';
import { OrderStatistics } from '../repositories/OrderRepository';

export interface OrderWithDetails extends OrderEntity {
  buyerName: string;
  buyerCode: string;
  styleCode: string;
  styleDescription: string;
  fabricSpec: string;
  samMinutes: number;
}

export function useOrdersData(isDbReady: boolean) {
  const [ordersWithDetails, setOrdersWithDetails] = useState<OrderWithDetails[]>([]);
  const [buyers, setBuyers] = useState<BuyerEntity[]>([]);
  const [styles, setStyles] = useState<StyleEntity[]>([]);
  const [statistics, setStatistics] = useState<OrderStatistics>({
    totalOrders: 0,
    activeOrders: 0,
    drafts: 0,
    confirmed: 0,
    inProduction: 0,
    overdue: 0,
    upcoming14Days: 0,
    totalPieces: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!isDbReady) return;
    setIsLoading(true);
    setError(null);
    try {
      const [allOrders, allBuyers, allStyles, stats] = await Promise.all([
        orderRepo.getAllOrders(),
        masterRepo.getAllBuyers(),
        masterRepo.getAllStyles(),
        orderRepo.getOrderStatistics(),
      ]);

      setBuyers(allBuyers);
      setStyles(allStyles);
      setStatistics(stats);

      const buyerMap = new Map(allBuyers.map((b) => [b.id, b]));
      const styleMap = new Map(allStyles.map((s) => [s.id, s]));

      const populated: OrderWithDetails[] = allOrders.map((order) => {
        const buyer = buyerMap.get(order.buyerId);
        const style = styleMap.get(order.styleId);
        return {
          ...order,
          buyerName: buyer?.name || 'Unknown Buyer',
          buyerCode: buyer?.code || 'BUY',
          styleCode: style?.styleCode || 'ST-000',
          styleDescription: style?.description || 'Apparel Item',
          fabricSpec: style?.fabricClassification || 'Knitted Standard',
          samMinutes: style?.samMinutes || 15.0,
        };
      });

      setOrdersWithDetails(populated);
    } catch (err: any) {
      console.error('[useOrdersData] Error:', err);
      setError(err?.message || 'Failed to fetch orders from database.');
    } finally {
      setIsLoading(false);
    }
  }, [isDbReady]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Orders
  const createOrder = async (
    order: Omit<OrderEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    items: OrderItemEntity[] = []
  ) => {
    const id =
      order.id && order.id.trim()
        ? order.id.trim()
        : `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const now = new Date().toISOString();
    const newOrder: OrderEntity = {
      ...order,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const normalizedItems: OrderItemEntity[] = items.map((item) => {
      const safeColor = encodeURIComponent(item.color);
      const safeSize = encodeURIComponent(item.size);
      const needsRebind =
        !item.id ||
        item.id.includes('ORD-NEW') ||
        item.id.includes('ORD-TEMP') ||
        item.orderId !== id;
      return {
        ...item,
        id: needsRebind ? `ITM-${id}-${safeColor}-${safeSize}` : item.id,
        orderId: id,
      };
    });

    const res = await orderRepo.createOrder(newOrder, normalizedItems);
    await fetchOrders();
    return res;
  };

  const updateOrder = async (
    orderId: string,
    updates: Partial<OrderEntity>,
    newItems?: OrderItemEntity[]
  ) => {
    const normalizedItems = newItems?.map((item) => {
      const safeColor = encodeURIComponent(item.color);
      const safeSize = encodeURIComponent(item.size);
      const needsRebind =
        !item.id ||
        item.id.includes('ORD-NEW') ||
        item.id.includes('ORD-TEMP') ||
        item.orderId !== orderId;
      return {
        ...item,
        id: needsRebind ? `ITM-${orderId}-${safeColor}-${safeSize}` : item.id,
        orderId,
      };
    });

    const res = await orderRepo.updateOrder(orderId, updates, normalizedItems);
    await fetchOrders();
    return res;
  };

  const updateOrderStatus = async (
    orderId: string,
    status: OrderStatus,
    reason?: string,
    updatedBy?: string
  ) => {
    const res = await orderRepo.updateOrderStatus(orderId, status, reason, updatedBy);
    await fetchOrders();
    return res;
  };

  const cancelOrder = async (
    orderId: string,
    reason: string,
    cancelledBy?: string
  ) => {
    const res = await orderRepo.cancelOrder(orderId, reason, cancelledBy);
    await fetchOrders();
    return res;
  };

  const getOrderItems = useCallback(async (orderId: string): Promise<OrderItemEntity[]> => {
    return await orderRepo.getOrderItems(orderId);
  }, []);

  // Buyer Management (Phase 2B)
  const createBuyer = async (buyer: Omit<BuyerEntity, 'id' | 'createdAt' | 'updatedAt' | 'isSimulated'>) => {
    const id = `BUY-${Date.now()}`;
    const now = new Date().toISOString();
    const newBuyer: BuyerEntity = {
      ...buyer,
      id,
      isSimulated: true,
      createdAt: now,
      updatedAt: now,
    };
    const res = await masterRepo.createBuyer(newBuyer);
    await fetchOrders();
    return res;
  };

  const updateBuyer = async (id: string, updates: Partial<BuyerEntity>) => {
    const res = await masterRepo.updateBuyer(id, updates);
    await fetchOrders();
    return res;
  };

  // Style Management (Phase 2B)
  const createStyle = async (style: Omit<StyleEntity, 'id' | 'createdAt' | 'updatedAt' | 'isSimulated'>) => {
    const id = `STY-${Date.now()}`;
    const now = new Date().toISOString();
    const newStyle: StyleEntity = {
      ...style,
      id,
      isSimulated: true,
      createdAt: now,
      updatedAt: now,
    };
    const res = await masterRepo.createStyle(newStyle);
    await fetchOrders();
    return res;
  };

  const updateStyle = async (id: string, updates: Partial<StyleEntity>) => {
    const res = await masterRepo.updateStyle(id, updates);
    await fetchOrders();
    return res;
  };

  return {
    orders: ordersWithDetails,
    buyers,
    styles,
    statistics,
    isLoading,
    error,
    createOrder,
    updateOrder,
    updateOrderStatus,
    cancelOrder,
    getOrderItems,
    createBuyer,
    updateBuyer,
    createStyle,
    updateStyle,
    refreshOrders: fetchOrders,
  };
}
