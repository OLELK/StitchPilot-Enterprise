import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Filter,
  Calendar,
  Scissors,
  Layers,
  CheckCircle,
  Clock,
  X,
  FileSpreadsheet,
  AlertCircle,
  Users,
  Shirt,
  ShoppingBag,
  ArrowUpDown,
  Building,
  Ban,
} from 'lucide-react';
import { OrderEntity, OrderItemEntity, BuyerEntity, StyleEntity, OrderStatus } from '../../db/types';
import { OrderWithDetails } from '../../db/hooks/useOrdersData';
import { OrderStatistics } from '../../db/repositories/OrderRepository';
import { OrderDashboardStrip } from '../orders/OrderDashboardStrip';
import { OrderCreateEditModal } from '../orders/OrderCreateEditModal';
import { OrderDetailDrawer } from '../orders/OrderDetailDrawer';
import { BuyerManagementView } from '../orders/BuyerManagementView';
import { StyleManagementView } from '../orders/StyleManagementView';

type MerchandisingTab = 'orders' | 'buyers' | 'styles';

interface OrdersViewProps {
  orders: OrderWithDetails[];
  buyers: BuyerEntity[];
  styles: StyleEntity[];
  stats: OrderStatistics;
  isLoading?: boolean;
  onCreateOrder: (
    order: Omit<OrderEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    items: OrderItemEntity[]
  ) => Promise<any>;
  onUpdateOrder: (
    orderId: string,
    updates: Partial<OrderEntity>,
    items?: OrderItemEntity[]
  ) => Promise<any>;
  onUpdateOrderStatus: (
    orderId: string,
    status: OrderStatus,
    reason?: string
  ) => Promise<any>;
  onCancelOrder: (orderId: string, reason: string) => Promise<any>;
  onGetOrderItems: (orderId: string) => Promise<OrderItemEntity[]>;
  onCreateBuyer: (
    buyer: Omit<BuyerEntity, 'id' | 'createdAt' | 'updatedAt' | 'isSimulated'>
  ) => Promise<any>;
  onUpdateBuyer: (id: string, updates: Partial<BuyerEntity>) => Promise<any>;
  onCreateStyle: (
    style: Omit<StyleEntity, 'id' | 'createdAt' | 'updatedAt' | 'isSimulated'>
  ) => Promise<any>;
  onUpdateStyle: (id: string, updates: Partial<StyleEntity>) => Promise<any>;
}

export const OrdersView: React.FC<OrdersViewProps> = ({
  orders,
  buyers,
  styles,
  stats,
  isLoading = false,
  onCreateOrder,
  onUpdateOrder,
  onUpdateOrderStatus,
  onCancelOrder,
  onGetOrderItems,
  onCreateBuyer,
  onUpdateBuyer,
  onCreateStyle,
  onUpdateStyle,
}) => {
  const [activeTab, setActiveTab] = useState<MerchandisingTab>('orders');

  // Search & Filter state for Orders
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [buyerFilter, setBuyerFilter] = useState<string>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');

  // Selected Order for Drawer
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);

  // Modal State for Create / Edit
  const [isCreateEditModalOpen, setIsCreateEditModalOpen] = useState(false);
  const [orderToEdit, setOrderToEdit] = useState<OrderWithDetails | null>(null);
  const [initialEditItems, setInitialEditItems] = useState<OrderItemEntity[]>([]);

  // Filtered orders list
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        order.poNumber.toLowerCase().includes(q) ||
        (order.internalOrderNumber && order.internalOrderNumber.toLowerCase().includes(q)) ||
        order.buyerName.toLowerCase().includes(q) ||
        order.styleCode.toLowerCase().includes(q) ||
        order.styleDescription.toLowerCase().includes(q) ||
        order.fabricSpec.toLowerCase().includes(q);

      // Status filter
      let matchesStatus = true;
      if (statusFilter === 'all_active') {
        matchesStatus = order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && order.status !== 'SHIPPED';
      } else if (statusFilter === 'overdue') {
        const today = new Date().toISOString().split('T')[0];
        matchesStatus =
          order.targetExFactoryDate < today &&
          order.status !== 'COMPLETED' &&
          order.status !== 'CANCELLED' &&
          order.status !== 'SHIPPED';
      } else if (statusFilter === 'upcoming_14') {
        const today = new Date().toISOString().split('T')[0];
        const future14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        matchesStatus =
          order.targetExFactoryDate >= today &&
          order.targetExFactoryDate <= future14 &&
          order.status !== 'COMPLETED' &&
          order.status !== 'CANCELLED' &&
          order.status !== 'SHIPPED';
      } else if (statusFilter !== 'all') {
        if (statusFilter === 'IN_PRODUCTION') {
          matchesStatus =
            order.status === 'IN_PRODUCTION' ||
            ['CUTTING', 'SEWING', 'FINISHING', 'FINAL_QC', 'PACKED'].includes(order.status);
        } else {
          matchesStatus = order.status === statusFilter;
        }
      }

      // Buyer filter
      const matchesBuyer = buyerFilter === 'all' || order.buyerId === buyerFilter;

      // Style filter
      const matchesStyle = styleFilter === 'all' || order.styleId === styleFilter;

      return matchesSearch && matchesStatus && matchesBuyer && matchesStyle;
    });
  }, [orders, searchQuery, statusFilter, buyerFilter, styleFilter]);

  const handleOpenCreateOrder = () => {
    setOrderToEdit(null);
    setInitialEditItems([]);
    setIsCreateEditModalOpen(true);
  };

  const handleOpenEditOrder = async (ord: OrderWithDetails) => {
    try {
      const items = await onGetOrderItems(ord.id);
      setOrderToEdit(ord);
      setInitialEditItems(items);
      setIsCreateEditModalOpen(true);
    } catch (err) {
      console.error('Failed to load order items for editing:', err);
    }
  };

  const handleSaveOrder = async (orderData: any, items: OrderItemEntity[]) => {
    if (orderToEdit) {
      // Editing existing order: preserve original ID
      const existingId = orderToEdit.id;
      await onUpdateOrder(existingId, { ...orderData, id: existingId }, items);
      if (selectedOrder && selectedOrder.id === existingId) {
        setSelectedOrder({
          ...selectedOrder,
          ...orderData,
          id: existingId,
        });
      }
    } else {
      // Creating new order (orderData.id carries pre-generated targetOrderId)
      await onCreateOrder(orderData, items);
    }
  };

  const getStatusBadge = (st: OrderStatus) => {
    switch (st) {
      case 'DRAFT':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
            DRAFT
          </span>
        );
      case 'CONFIRMED':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-blue-950/80 text-blue-300 border border-blue-800/80">
            CONFIRMED
          </span>
        );
      case 'IN_PRODUCTION':
      case 'SEWING':
      case 'CUTTING':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {st === 'IN_PRODUCTION' ? 'IN PROD' : st}
          </span>
        );
      case 'PARTIALLY_SHIPPED':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-cyan-950/80 text-cyan-300 border border-cyan-800/80">
            PARTIAL
          </span>
        );
      case 'COMPLETED':
      case 'SHIPPED':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-purple-950/80 text-purple-300 border border-purple-800/80">
            COMPLETED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-rose-950/90 text-rose-300 border border-rose-800">
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono text-zinc-300 bg-zinc-800 border border-zinc-700">
            {st}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner and Module Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="text-[11px] font-mono text-amber-400 uppercase tracking-wider font-semibold flex items-center gap-2">
            <span>StitchPilot Commercial ERP</span>
            <span className="text-zinc-600">/</span>
            <span>Phase 2B Merchandising</span>
          </div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight mt-0.5">
            Merchandising & Order Management
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Buyer purchase orders, colourway & size breakdown matrices, garment styles, and customer master accounts.
          </p>
        </div>

        {/* Sub-module Switcher Tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-lg text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'orders'
                ? 'bg-zinc-800 text-amber-400 font-bold shadow-xs border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Purchase Orders</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-950 text-zinc-300 border border-zinc-800">
              {orders.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('buyers')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'buyers'
                ? 'bg-zinc-800 text-amber-400 font-bold shadow-xs border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Buyer Master</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-950 text-zinc-300 border border-zinc-800">
              {buyers.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('styles')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'styles'
                ? 'bg-zinc-800 text-amber-400 font-bold shadow-xs border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Shirt className="w-3.5 h-3.5" />
            <span>Style Master</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-950 text-zinc-300 border border-zinc-800">
              {styles.length}
            </span>
          </button>
        </div>
      </div>

      {/* VIEW: BUYER MASTER */}
      {activeTab === 'buyers' && (
        <BuyerManagementView
          buyers={buyers}
          onCreateBuyer={onCreateBuyer}
          onUpdateBuyer={onUpdateBuyer}
        />
      )}

      {/* VIEW: STYLE MASTER */}
      {activeTab === 'styles' && (
        <StyleManagementView
          styles={styles}
          buyers={buyers}
          onCreateStyle={onCreateStyle}
          onUpdateStyle={onUpdateStyle}
        />
      )}

      {/* VIEW: PURCHASE ORDERS */}
      {activeTab === 'orders' && (
        <div className="space-y-5">
          {/* 1. Merchandising KPIs Strip */}
          <OrderDashboardStrip
            stats={stats}
            selectedFilter={statusFilter}
            onSelectFilter={setStatusFilter}
          />

          {/* 2. Controls and Search Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 bg-zinc-900/90 border border-zinc-800 rounded-lg">
            {/* Live Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search PO#, SO#, Buyer, Style Code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-hidden focus:border-amber-500 transition-colors font-mono"
              />
            </div>

            {/* Filter Dropdowns and Action */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              {/* Buyer Dropdown Filter */}
              <select
                value={buyerFilter}
                onChange={(e) => setBuyerFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-300 font-sans"
              >
                <option value="all">All Buyers</option>
                {buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} [{b.code}]
                  </option>
                ))}
              </select>

              {/* Status Dropdown Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-300 font-mono"
              >
                <option value="all">All Statuses ({orders.length})</option>
                <option value="all_active">All Active ({stats.activeOrders})</option>
                <option value="DRAFT">Draft ({stats.drafts})</option>
                <option value="CONFIRMED">Confirmed ({stats.confirmed})</option>
                <option value="IN_PRODUCTION">In Production ({stats.inProduction})</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="overdue">Overdue Ex-Factory ({stats.overdue})</option>
                <option value="upcoming_14">Next 14 Days ({stats.upcoming14Days})</option>
              </select>

              {/* Add Order Button */}
              <button
                type="button"
                onClick={handleOpenCreateOrder}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-md text-xs font-bold font-mono flex items-center gap-1.5 transition-colors shadow-sm ml-auto sm:ml-0"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                New Purchase Order
              </button>
            </div>
          </div>

          {/* 3. Orders High-Density ERP Table */}
          <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-zinc-950/70 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
                    <th className="py-3 px-4 font-medium">PO Number & SO#</th>
                    <th className="py-3 px-3 font-medium">Buyer / Customer</th>
                    <th className="py-3 px-3 font-medium">Style & Fabric Spec</th>
                    <th className="py-3 px-3 font-medium text-right">Order Units</th>
                    <th className="py-3 px-4 font-medium min-w-[140px]">Production Output</th>
                    <th className="py-3 px-3 font-medium text-right">SAM</th>
                    <th className="py-3 px-3 font-medium text-right">Assigned Line</th>
                    <th className="py-3 px-3 font-medium text-right">Ex-Factory</th>
                    <th className="py-3 px-4 font-medium text-center">Lifecycle Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-mono">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-zinc-500 font-mono">
                        No purchase orders matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => {
                      const progress = Math.min(
                        100,
                        Math.round((order.producedQuantity / order.orderQuantity) * 100)
                      );

                      const today = new Date().toISOString().split('T')[0];
                      const isOverdue =
                        order.targetExFactoryDate < today &&
                        order.status !== 'COMPLETED' &&
                        order.status !== 'CANCELLED' &&
                        order.status !== 'SHIPPED';

                      return (
                        <tr
                          key={order.id}
                          onClick={() => setSelectedOrder(order)}
                          className="hover:bg-zinc-800/40 cursor-pointer transition-colors"
                          title="Click to view size matrix breakdown and audit trail"
                        >
                          {/* PO Number & Internal SO Number */}
                          <td className="py-3 px-4">
                            <div className="font-bold text-amber-400 tracking-tight flex items-center gap-1.5">
                              <span>{order.poNumber}</span>
                            </div>
                            <div className="text-[10px] text-zinc-400 flex items-center gap-1">
                              <span>SO: {order.internalOrderNumber || order.id}</span>
                            </div>
                          </td>

                          {/* Buyer Name & Code */}
                          <td className="py-3 px-3 font-sans font-semibold text-zinc-200">
                            <div>{order.buyerName}</div>
                            <div className="text-[10px] text-zinc-500 font-mono">
                              [{order.buyerCode}]
                            </div>
                          </td>

                          {/* Style Code & Fabric */}
                          <td className="py-3 px-3">
                            <div className="font-sans font-medium text-zinc-100 flex items-baseline gap-1.5">
                              <span className="font-mono text-amber-300 font-bold">{order.styleCode}</span>
                              <span className="truncate max-w-xs">{order.styleDescription}</span>
                            </div>
                            <div className="text-[10px] text-zinc-400 truncate max-w-sm">
                              {order.fabricSpec}
                            </div>
                          </td>

                          {/* Order Quantity */}
                          <td className="py-3 px-3 text-right tabular-nums text-zinc-100 font-bold">
                            {order.orderQuantity.toLocaleString()}{' '}
                            <span className="text-[10px] text-zinc-400 font-normal">pcs</span>
                          </td>

                          {/* Output Progress */}
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                              <span>{order.producedQuantity.toLocaleString()} pcs</span>
                              <span className="font-bold text-zinc-200">{progress}%</span>
                            </div>
                            <div className="w-full bg-zinc-950 rounded-full h-1.5 overflow-hidden border border-zinc-800">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  progress >= 100
                                    ? 'bg-purple-500'
                                    : progress >= 50
                                    ? 'bg-emerald-400'
                                    : 'bg-cyan-500'
                                }`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </td>

                          {/* SAM */}
                          <td className="py-3 px-3 text-right tabular-nums text-zinc-300">
                            {order.samMinutes.toFixed(1)}{' '}
                            <span className="text-[10px] text-zinc-500">min</span>
                          </td>

                          {/* Assigned Line */}
                          <td className="py-3 px-3 text-right tabular-nums text-zinc-300 font-semibold">
                            {order.assignedLineId}
                          </td>

                          {/* Ex-Factory Delivery */}
                          <td className="py-3 px-3 text-right tabular-nums">
                            <span
                              className={
                                isOverdue
                                  ? 'text-rose-400 font-bold flex items-center justify-end gap-1'
                                  : 'text-zinc-300'
                              }
                            >
                              {order.targetExFactoryDate}
                            </span>
                            {isOverdue && (
                              <span className="text-[9px] text-rose-500 block font-sans">
                                Overdue
                              </span>
                            )}
                          </td>

                          {/* Lifecycle Status */}
                          <td className="py-3 px-4 text-center">
                            {getStatusBadge(order.status)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-zinc-950/60 border-t border-zinc-800 text-[11px] font-mono text-zinc-400 flex items-center justify-between">
              <span>Showing {filteredOrders.length} of {orders.length} orders</span>
              <span>Total Active Commitment: {stats.totalPieces.toLocaleString()} pcs</span>
            </div>
          </div>
        </div>
      )}

      {/* Order Detail Drawer */}
      <OrderDetailDrawer
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onEdit={(ord) => {
          setSelectedOrder(null);
          handleOpenEditOrder(ord);
        }}
        onUpdateStatus={async (orderId, newStatus, note) => {
          await onUpdateOrderStatus(orderId, newStatus, note);
          if (selectedOrder) {
            setSelectedOrder({
              ...selectedOrder,
              status: newStatus,
            });
          }
        }}
        onCancelOrder={async (orderId, reason) => {
          await onCancelOrder(orderId, reason);
          if (selectedOrder) {
            setSelectedOrder({
              ...selectedOrder,
              status: 'CANCELLED',
            });
          }
        }}
        fetchItems={onGetOrderItems}
      />

      {/* Create / Edit Purchase Order Modal */}
      <OrderCreateEditModal
        isOpen={isCreateEditModalOpen}
        onClose={() => {
          setIsCreateEditModalOpen(false);
          setOrderToEdit(null);
          setInitialEditItems([]);
        }}
        orderToEdit={orderToEdit}
        initialItems={initialEditItems}
        buyers={buyers}
        styles={styles}
        onSaveOrder={handleSaveOrder}
      />
    </div>
  );
};
