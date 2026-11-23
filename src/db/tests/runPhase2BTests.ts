/**
 * StitchPilot Enterprise — Phase 2B Automated Test Suite
 * Merchandising & Order Management
 *
 * 13 Rigorous Domain & Data Integrity Tests:
 *  1. Creating a buyer
 *  2. Preventing duplicate buyer codes
 *  3. Creating a style linked to buyer
 *  4. Creating an order with multiple colours
 *  5. Creating size-wise quantities matrix
 *  6. Verifying automatic total calculation
 *  7. Editing an existing order
 *  8. Rejecting invalid quantities (negative, fractional, or mismatch)
 *  9. Confirming an order (DRAFT -> CONFIRMED)
 *  10. Cancelling an order (CONFIRMED -> CANCELLED)
 *  11. Verifying cancelled orders cannot proceed into production
 *  12. Persistence across DB close and reopen
 *  13. Phase 2A regression tests (inventory accounting rules & duplicate prevention)
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createIsolatedTestDatabase } from '../database';
import { createRepositories } from '../repositories';
import {
  ValidationError,
  InvalidStatusTransitionError,
  InventoryAccountingError,
  DuplicateTransactionError,
} from '../errors';
import { BuyerEntity, StyleEntity, OrderEntity, OrderItemEntity } from '../types';
import { OrderWithDetails } from '../hooks/useOrdersData';
import { OrderCreateEditModal } from '../../components/orders/OrderCreateEditModal';
import { OrderDetailDrawer } from '../../components/orders/OrderDetailDrawer';

export interface TestResult {
  testNumber: number;
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

export async function runPhase2BTests(): Promise<{
  allPassed: boolean;
  results: TestResult[];
}> {
  const results: TestResult[] = [];

  // ==========================================
  // Test 1: Creating a buyer
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_Main');
    const repos = createRepositories(db);
    await db.open();

    const buyerData: BuyerEntity = {
      id: 'BUY-P2B-01',
      code: 'GAP-GLOBAL',
      name: 'Gap Inc. Global Sourcing',
      country: 'United States',
      contactPerson: 'David Miller (VP Sourcing)',
      contactEmail: 'david_miller@gap.com',
      paymentTerms: 'LC 60 Days',
      complianceRating: 'Grade A WRAP Certified',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const createdBuyer = await repos.master.createBuyer(buyerData);
    const retrieved = await repos.master.getBuyerById('BUY-P2B-01');

    if (retrieved && retrieved.code === 'GAP-GLOBAL' && retrieved.status === 'ACTIVE') {
      results.push({
        testNumber: 1,
        name: 'Creating a Buyer',
        passed: true,
        message: `Buyer "${retrieved.name}" [Code: ${retrieved.code}] created and verified with active status.`,
      });
    } else {
      results.push({
        testNumber: 1,
        name: 'Creating a Buyer',
        passed: false,
        message: 'Buyer creation or verification failed.',
      });
    }
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 1,
      name: 'Creating a Buyer',
      passed: false,
      message: `Test 1 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 2: Preventing duplicate buyer codes
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_DupBuyer');
    const repos = createRepositories(db);
    await db.open();

    await repos.master.createBuyer({
      id: 'BUY-ORIG-01',
      code: 'TARGET-US',
      name: 'Target Corporation',
      country: 'USA',
      contactPerson: 'Sarah Jenkins',
      contactEmail: 'sarah.j@target.com',
      paymentTerms: 'TT 30 Days',
      complianceRating: 'Gold',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let duplicateRejected = false;
    let caughtMessage = '';
    try {
      await repos.master.createBuyer({
        id: 'BUY-DUP-02',
        code: 'TARGET-US', // Exact duplicate code (case-insensitive)
        name: 'Target US Alternate Sourcing',
        country: 'USA',
        contactPerson: 'Alex Jones',
        contactEmail: 'alex.j@target.com',
        paymentTerms: 'LC 45 Days',
        complianceRating: 'Gold',
        status: 'ACTIVE',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      if (err instanceof ValidationError && err.field === 'code') {
        duplicateRejected = true;
        caughtMessage = err.message;
      } else {
        throw err;
      }
    }

    if (duplicateRejected) {
      results.push({
        testNumber: 2,
        name: 'Preventing Duplicate Buyer Codes',
        passed: true,
        message: `Duplicate buyer code "TARGET-US" was properly rejected: "${caughtMessage}"`,
      });
    } else {
      results.push({
        testNumber: 2,
        name: 'Preventing Duplicate Buyer Codes',
        passed: false,
        message: 'Duplicate buyer code was NOT rejected.',
      });
    }
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 2,
      name: 'Preventing Duplicate Buyer Codes',
      passed: false,
      message: `Test 2 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 3: Creating a style linked to buyer
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_Style');
    const repos = createRepositories(db);
    await db.open();

    const buyer = await repos.master.createBuyer({
      id: 'BUY-STY-01',
      code: 'MANGO',
      name: 'Mango Fashion Group',
      country: 'Spain',
      contactPerson: 'Carlos Ruiz',
      contactEmail: 'carlos@mango.com',
      paymentTerms: 'LC 60 Days',
      complianceRating: 'Grade A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const styleData: StyleEntity = {
      id: 'STY-P2B-101',
      buyerId: buyer.id,
      styleCode: 'MNG-JKT-09',
      description: 'Oversized Technical Bomber Jacket',
      garmentType: 'Woven Outerwear',
      productType: 'Outerwear',
      genderCategory: 'Unisex',
      fabricClassification: 'Recycled Nylon Taslan 180 GSM',
      samMinutes: 28.5,
      targetEfficiencyPercent: 80.0,
      season: 'Autumn/Winter 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const createdStyle = await repos.master.createStyle(styleData);
    const retrievedStyle = await repos.master.getStyleByCode('MNG-JKT-09');

    if (
      retrievedStyle &&
      retrievedStyle.buyerId === buyer.id &&
      retrievedStyle.samMinutes === 28.5 &&
      retrievedStyle.genderCategory === 'Unisex'
    ) {
      results.push({
        testNumber: 3,
        name: 'Creating a Style',
        passed: true,
        message: `Style "${retrievedStyle.styleCode}" created, linked to buyer "${buyer.name}", and verified (SAM: ${retrievedStyle.samMinutes} mins).`,
      });
    } else {
      results.push({
        testNumber: 3,
        name: 'Creating a Style',
        passed: false,
        message: 'Style creation or verification failed.',
      });
    }
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 3,
      name: 'Creating a Style',
      passed: false,
      message: `Test 3 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 4: Creating an order with multiple colours
  // Test 5: Creating size-wise quantities
  // Test 6: Verifying automatic total calculation
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_OrderMatrix');
    const repos = createRepositories(db);
    await db.open();

    const buyer = await repos.master.createBuyer({
      id: 'BUY-MAT-01',
      code: 'COS',
      name: 'COS Stores (H&M Group)',
      country: 'United Kingdom',
      contactPerson: 'Emma Watson',
      contactEmail: 'emma@cos.com',
      paymentTerms: 'LC 90 Days',
      complianceRating: 'Grade A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const style = await repos.master.createStyle({
      id: 'STY-MAT-01',
      buyerId: buyer.id,
      styleCode: 'COS-TEE-01',
      description: 'Heavyweight Supima Relaxed T-Shirt',
      garmentType: 'T-Shirt',
      productType: 'T-Shirts',
      genderCategory: 'Unisex',
      fabricClassification: 'Supima Cotton Single Jersey 220 GSM',
      samMinutes: 11.2,
      targetEfficiencyPercent: 90.0,
      season: 'Summer 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Multi-colour matrix breakdown:
    // Colour 1: Washed Black (S: 500, M: 1000, L: 1500, XL: 1000, XXL: 500) = 4,500 pcs
    // Colour 2: Heather Grey (S: 500, M: 1000, L: 1500, XL: 1000, XXL: 500) = 4,500 pcs
    // Colour 3: Optical White (S: 300, M: 600, L: 800, XL: 500, XXL: 300) = 2,500 pcs
    // Grand Total = 11,500 pcs
    const matrixItems: OrderItemEntity[] = [
      // Washed Black
      { id: 'ITM-BLK-S', orderId: 'ORD-P2B-MAT-01', color: 'Washed Black', size: 'S', quantity: 500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-BLK-M', orderId: 'ORD-P2B-MAT-01', color: 'Washed Black', size: 'M', quantity: 1000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-BLK-L', orderId: 'ORD-P2B-MAT-01', color: 'Washed Black', size: 'L', quantity: 1500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-BLK-XL', orderId: 'ORD-P2B-MAT-01', color: 'Washed Black', size: 'XL', quantity: 1000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-BLK-XXL', orderId: 'ORD-P2B-MAT-01', color: 'Washed Black', size: 'XXL', quantity: 500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      // Heather Grey
      { id: 'ITM-GRY-S', orderId: 'ORD-P2B-MAT-01', color: 'Heather Grey', size: 'S', quantity: 500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-GRY-M', orderId: 'ORD-P2B-MAT-01', color: 'Heather Grey', size: 'M', quantity: 1000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-GRY-L', orderId: 'ORD-P2B-MAT-01', color: 'Heather Grey', size: 'L', quantity: 1500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-GRY-XL', orderId: 'ORD-P2B-MAT-01', color: 'Heather Grey', size: 'XL', quantity: 1000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-GRY-XXL', orderId: 'ORD-P2B-MAT-01', color: 'Heather Grey', size: 'XXL', quantity: 500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      // Optical White
      { id: 'ITM-WHT-S', orderId: 'ORD-P2B-MAT-01', color: 'Optical White', size: 'S', quantity: 300, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-WHT-M', orderId: 'ORD-P2B-MAT-01', color: 'Optical White', size: 'M', quantity: 600, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-WHT-L', orderId: 'ORD-P2B-MAT-01', color: 'Optical White', size: 'L', quantity: 800, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-WHT-XL', orderId: 'ORD-P2B-MAT-01', color: 'Optical White', size: 'XL', quantity: 500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-WHT-XXL', orderId: 'ORD-P2B-MAT-01', color: 'Optical White', size: 'XXL', quantity: 300, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
    ];

    const calculatedSum = matrixItems.reduce((acc, i) => acc + i.quantity, 0); // 11,500 pcs

    const orderData: OrderEntity = {
      id: 'ORD-P2B-MAT-01',
      poNumber: 'PO-COS-8800',
      internalOrderNumber: 'SO-2026-100',
      buyerId: buyer.id,
      styleId: style.id,
      orderQuantity: calculatedSum, // 11,500 pcs
      producedQuantity: 0,
      targetExFactoryDate: '2026-12-18',
      status: 'DRAFT',
      assignedLineId: 'LINE-01',
      dhuPercent: 1.5,
      notes: 'Three-colorway order breakdown test',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created = await repos.orders.createOrder(orderData, matrixItems);
    const savedItems = await repos.orders.getOrderItems(created.order.id);

    // Verify multi-colour
    const distinctColours = Array.from(new Set(savedItems.map((i) => i.color)));
    const hasMultipleColours = distinctColours.length === 3;

    // Verify size breakdown
    const distinctSizes = Array.from(new Set(savedItems.map((i) => i.size)));
    const hasSizeBreakdown = distinctSizes.length >= 5;

    // Verify sum reconciliation
    const itemsTotal = savedItems.reduce((acc, i) => acc + i.quantity, 0);
    const totalMatches = itemsTotal === created.order.orderQuantity && itemsTotal === 11500;

    // Record Test 4
    results.push({
      testNumber: 4,
      name: 'Creating an Order with Multiple Colours',
      passed: hasMultipleColours,
      message: `Order created with ${distinctColours.length} distinct colourways: [${distinctColours.join(', ')}].`,
    });

    // Record Test 5
    results.push({
      testNumber: 5,
      name: 'Creating Size-Wise Quantities',
      passed: hasSizeBreakdown,
      message: `Order items broken down across ${distinctSizes.length} sizes: [${distinctSizes.join(', ')}] across 15 matrix cells.`,
    });

    // Record Test 6
    results.push({
      testNumber: 6,
      name: 'Verifying Automatic Total Calculation',
      passed: totalMatches,
      message: `Automatic total verified: Matrix breakdown items sum (${itemsTotal.toLocaleString()} pcs) exactly matches order quantity (${created.order.orderQuantity.toLocaleString()} pcs).`,
    });

    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 4,
      name: 'Creating an Order with Multiple Colours',
      passed: false,
      message: `Error in order matrix test: ${err.message}`,
    });
    results.push({
      testNumber: 5,
      name: 'Creating Size-Wise Quantities',
      passed: false,
      message: `Error in order matrix test: ${err.message}`,
    });
    results.push({
      testNumber: 6,
      name: 'Verifying Automatic Total Calculation',
      passed: false,
      message: `Error in order matrix test: ${err.message}`,
    });
  }

  // ==========================================
  // Test 7: Editing an order
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_EditOrder');
    const repos = createRepositories(db);
    await db.open();

    const buyer = await repos.master.createBuyer({
      id: 'BUY-EDT-01',
      code: 'LEVIS',
      name: "Levi Strauss & Co.",
      country: 'United States',
      contactPerson: 'Marcus Vance',
      contactEmail: 'mvance@levi.com',
      paymentTerms: 'TT 60 Days',
      complianceRating: 'Grade A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const style = await repos.master.createStyle({
      id: 'STY-EDT-01',
      buyerId: buyer.id,
      styleCode: 'LEV-501-SH',
      description: 'Western Denim Overshirt',
      garmentType: 'Woven Shirt',
      productType: 'Shirts',
      genderCategory: 'Men',
      fabricClassification: 'Cotton Denim 7.5 oz',
      samMinutes: 19.0,
      targetEfficiencyPercent: 85.0,
      season: 'Spring 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const initialItems: OrderItemEntity[] = [
      { id: 'ITM-E-01', orderId: 'ORD-EDT-01', color: 'Stonewash', size: 'M', quantity: 2000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-E-02', orderId: 'ORD-EDT-01', color: 'Stonewash', size: 'L', quantity: 3000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
    ];

    await repos.orders.createOrder(
      {
        id: 'ORD-EDT-01',
        poNumber: 'PO-LEVI-991',
        buyerId: buyer.id,
        styleId: style.id,
        orderQuantity: 5000,
        producedQuantity: 0,
        targetExFactoryDate: '2026-11-30',
        status: 'DRAFT',
        assignedLineId: 'LINE-01',
        dhuPercent: 1.8,
        notes: 'Initial order notes',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      initialItems
    );

    // Edit order: Increase M to 3,000 pcs (total 6,000 pcs) and change target delivery date
    const updatedItems: OrderItemEntity[] = [
      { id: 'ITM-E-01', orderId: 'ORD-EDT-01', color: 'Stonewash', size: 'M', quantity: 3000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: 'ITM-E-02', orderId: 'ORD-EDT-01', color: 'Stonewash', size: 'L', quantity: 3000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
    ];

    const editResult = await repos.orders.updateOrder(
      'ORD-EDT-01',
      {
        orderQuantity: 6000,
        targetExFactoryDate: '2026-12-15',
        notes: 'Updated quantity and revised delivery date per buyer change request',
      },
      updatedItems
    );

    const refetchedOrder = await repos.orders.getOrderById('ORD-EDT-01');
    const refetchedItems = await repos.orders.getOrderItems('ORD-EDT-01');
    const newItemsSum = refetchedItems.reduce((acc, i) => acc + i.quantity, 0);

    if (
      refetchedOrder &&
      refetchedOrder.orderQuantity === 6000 &&
      refetchedOrder.targetExFactoryDate === '2026-12-15' &&
      newItemsSum === 6000
    ) {
      results.push({
        testNumber: 7,
        name: 'Editing an Order',
        passed: true,
        message: `Order "PO-LEVI-991" updated successfully: Quantity revised to 6,000 pcs, items reconciled (sum: ${newItemsSum} pcs), delivery date updated to 2026-12-15.`,
      });
    } else {
      results.push({
        testNumber: 7,
        name: 'Editing an Order',
        passed: false,
        message: 'Order update failed or item reconciliation mismatch.',
      });
    }
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 7,
      name: 'Editing an Order',
      passed: false,
      message: `Test 7 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 8: Rejecting invalid quantities
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_InvalidQty');
    const repos = createRepositories(db);
    await db.open();

    const buyer = await repos.master.createBuyer({
      id: 'BUY-INV-01',
      code: 'PUMA',
      name: 'Puma Sports SE',
      country: 'Germany',
      contactPerson: 'Hans Richter',
      contactEmail: 'hans@puma.com',
      paymentTerms: 'LC 60 Days',
      complianceRating: 'Grade A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const style = await repos.master.createStyle({
      id: 'STY-INV-01',
      buyerId: buyer.id,
      styleCode: 'PUM-TRK-01',
      description: 'Poly Tricot Track Jacket',
      garmentType: 'Active Jacket',
      productType: 'Outerwear',
      genderCategory: 'Men',
      fabricClassification: 'Polyester Tricot 220 GSM',
      samMinutes: 18.0,
      targetEfficiencyPercent: 88.0,
      season: 'Core 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 1. Negative quantity test
    let negativeRejected = false;
    try {
      await repos.orders.createOrder(
        {
          id: 'ORD-INV-NEG',
          poNumber: 'PO-PUMA-NEG',
          buyerId: buyer.id,
          styleId: style.id,
          orderQuantity: 1000,
          producedQuantity: 0,
          targetExFactoryDate: '2026-12-01',
          status: 'DRAFT',
          assignedLineId: 'LINE-01',
          dhuPercent: 1.5,
          notes: 'Negative quantity test',
          isSimulated: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        [
          { id: 'ITM-N1', orderId: 'ORD-INV-NEG', color: 'Black', size: 'M', quantity: 1500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
          { id: 'ITM-N2', orderId: 'ORD-INV-NEG', color: 'Black', size: 'L', quantity: -500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        ]
      );
    } catch (err: any) {
      if (err instanceof ValidationError) {
        negativeRejected = true;
      }
    }

    // 2. Fractional quantity test
    let fractionalRejected = false;
    try {
      await repos.orders.createOrder(
        {
          id: 'ORD-INV-FRAC',
          poNumber: 'PO-PUMA-FRAC',
          buyerId: buyer.id,
          styleId: style.id,
          orderQuantity: 1000.5,
          producedQuantity: 0,
          targetExFactoryDate: '2026-12-01',
          status: 'DRAFT',
          assignedLineId: 'LINE-01',
          dhuPercent: 1.5,
          notes: 'Fractional test',
          isSimulated: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        []
      );
    } catch (err: any) {
      if (err instanceof ValidationError) {
        fractionalRejected = true;
      }
    }

    // 3. Mismatch quantity test (orderQty 5,000 pcs, items sum 4,500 pcs)
    let mismatchRejected = false;
    try {
      await repos.orders.createOrder(
        {
          id: 'ORD-INV-MISMATCH',
          poNumber: 'PO-PUMA-MISMATCH',
          buyerId: buyer.id,
          styleId: style.id,
          orderQuantity: 5000,
          producedQuantity: 0,
          targetExFactoryDate: '2026-12-01',
          status: 'DRAFT',
          assignedLineId: 'LINE-01',
          dhuPercent: 1.5,
          notes: 'Mismatch test',
          isSimulated: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        [
          { id: 'ITM-M1', orderId: 'ORD-INV-MISMATCH', color: 'Navy', size: 'M', quantity: 2000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
          { id: 'ITM-M2', orderId: 'ORD-INV-MISMATCH', color: 'Navy', size: 'L', quantity: 2500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        ]
      );
    } catch (err: any) {
      if (err instanceof ValidationError && err.field === 'orderQuantity') {
        mismatchRejected = true;
      }
    }

    if (negativeRejected && fractionalRejected && mismatchRejected) {
      results.push({
        testNumber: 8,
        name: 'Rejecting Invalid Quantities',
        passed: true,
        message: 'All invalid quantities rejected as required: negative quantities rejected, fractional quantities rejected, and matrix mismatch (5000 vs 4500) rejected.',
      });
    } else {
      results.push({
        testNumber: 8,
        name: 'Rejecting Invalid Quantities',
        passed: false,
        message: `Validation rejection failure: negative=${negativeRejected}, fractional=${fractionalRejected}, mismatch=${mismatchRejected}`,
      });
    }
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 8,
      name: 'Rejecting Invalid Quantities',
      passed: false,
      message: `Test 8 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 9: Confirming an order
  // Test 10: Cancelling an order
  // Test 11: Verifying cancelled orders cannot proceed into production
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_Lifecycle');
    const repos = createRepositories(db);
    await db.open();

    const buyer = await repos.master.createBuyer({
      id: 'BUY-LC-01',
      code: 'ADIDAS',
      name: 'Adidas AG',
      country: 'Germany',
      contactPerson: 'Klaus Fischer',
      contactEmail: 'klaus@adidas.com',
      paymentTerms: 'LC 90 Days',
      complianceRating: 'Grade A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const style = await repos.master.createStyle({
      id: 'STY-LC-01',
      buyerId: buyer.id,
      styleCode: 'ADI-HOOD-99',
      description: 'French Terry Club Hoodie',
      garmentType: 'Fleece Sweatshirt',
      productType: 'Outerwear',
      genderCategory: 'Unisex',
      fabricClassification: 'French Terry 320 GSM',
      samMinutes: 17.5,
      targetEfficiencyPercent: 88.0,
      season: 'Fall 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Start with DRAFT order
    const draftOrder = await repos.orders.createOrder({
      id: 'ORD-LC-001',
      poNumber: 'PO-ADI-001',
      buyerId: buyer.id,
      styleId: style.id,
      orderQuantity: 8000,
      producedQuantity: 0,
      targetExFactoryDate: '2026-12-24',
      status: 'DRAFT',
      assignedLineId: 'LINE-01',
      dhuPercent: 1.4,
      notes: 'Lifecycle test order',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Test 9: Transition DRAFT -> CONFIRMED
    const confirmedOrder = await repos.orders.updateOrderStatus(
      'ORD-LC-001',
      'CONFIRMED',
      'Purchase Order confirmed by merchandising team',
      'Senior Merchandiser'
    );

    const hasConfirmedStatus = confirmedOrder.status === 'CONFIRMED';
    const hasConfirmedHistory = confirmedOrder.statusHistory?.some((h) => h.toStatus === 'CONFIRMED');

    results.push({
      testNumber: 9,
      name: 'Confirming an Order',
      passed: Boolean(hasConfirmedStatus && hasConfirmedHistory),
      message: `Order transitioned from DRAFT to CONFIRMED with timestamped status history entry.`,
    });

    // Test 10: Transition CONFIRMED -> CANCELLED
    const cancelledOrder = await repos.orders.cancelOrder(
      'ORD-LC-001',
      'Buyer requested cancellation due to global logistics reallocation',
      'Head of Merchandising'
    );

    const hasCancelledStatus = cancelledOrder.status === 'CANCELLED';
    const hasCancelledHistory = cancelledOrder.statusHistory?.some((h) => h.toStatus === 'CANCELLED');

    results.push({
      testNumber: 10,
      name: 'Cancelling an Order',
      passed: Boolean(hasCancelledStatus && hasCancelledHistory),
      message: `Order cancelled with audit note: "${cancelledOrder.statusHistory?.slice(-1)[0]?.note}"`,
    });

    // Test 11: Attempting to move CANCELLED -> IN_PRODUCTION MUST BE REJECTED
    let invalidTransitionRejected = false;
    let transitionErrorMessage = '';

    try {
      await repos.orders.updateOrderStatus(
        'ORD-LC-001',
        'IN_PRODUCTION',
        'Attempting illegal push to factory floor'
      );
    } catch (err: any) {
      if (err instanceof InvalidStatusTransitionError) {
        invalidTransitionRejected = true;
        transitionErrorMessage = err.message;
      } else {
        throw err;
      }
    }

    // Verify order remains strictly CANCELLED
    const orderAfterIllegalAttempt = await repos.orders.getOrderById('ORD-LC-001');
    const orderRemainedCancelled = orderAfterIllegalAttempt?.status === 'CANCELLED';

    results.push({
      testNumber: 11,
      name: 'Rejecting Cancelled Order Production Progression',
      passed: Boolean(invalidTransitionRejected && orderRemainedCancelled),
      message: `Cancelled order strictly prohibited from moving to IN_PRODUCTION: "${transitionErrorMessage}". Current status: ${orderAfterIllegalAttempt?.status}.`,
    });

    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 9,
      name: 'Confirming an Order',
      passed: false,
      message: `Error in lifecycle test: ${err.message}`,
    });
    results.push({
      testNumber: 10,
      name: 'Cancelling an Order',
      passed: false,
      message: `Error in lifecycle test: ${err.message}`,
    });
    results.push({
      testNumber: 11,
      name: 'Rejecting Cancelled Order Production Progression',
      passed: false,
      message: `Error in lifecycle test: ${err.message}`,
    });
  }

  // ==========================================
  // Test 12: Persistence across DB close and reopen
  // ==========================================
  try {
    const sharedIDB = new IDBFactory();
    const dbName = 'TestDB_Phase2B_PersistenceCheck';

    // Session 1: Create buyer, style, multi-colour order
    const session1Db = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    const repos1 = createRepositories(session1Db);
    await session1Db.open();

    const buyer = await repos1.master.createBuyer({
      id: 'BUY-PERSIST-P2B',
      code: 'NORTH-FACE',
      name: 'The North Face (VF Corp)',
      country: 'United States',
      contactPerson: 'Rachel Chen',
      contactEmail: 'rchen@vfc.com',
      paymentTerms: 'LC 60 Days',
      complianceRating: 'Grade A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const style = await repos1.master.createStyle({
      id: 'STY-PERSIST-P2B',
      buyerId: buyer.id,
      styleCode: 'TNF-GLACIER-01',
      description: 'Glacier 1/4 Zip Microfleece Pullover',
      garmentType: 'Fleece Pullover',
      productType: 'Outerwear',
      genderCategory: 'Unisex',
      fabricClassification: 'Polar Fleece 200 GSM',
      samMinutes: 15.6,
      targetEfficiencyPercent: 86.0,
      season: 'Winter 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const persistPo = 'PO-TNF-99281';
    await repos1.orders.createOrder(
      {
        id: 'ORD-PERSIST-P2B',
        poNumber: persistPo,
        internalOrderNumber: 'SO-2026-999',
        buyerId: buyer.id,
        styleId: style.id,
        orderQuantity: 6500,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-28',
        status: 'CONFIRMED',
        assignedLineId: 'LINE-01',
        dhuPercent: 1.6,
        notes: 'Persistence verification order',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: 'ITM-P-1', orderId: 'ORD-PERSIST-P2B', color: 'Summit Gold', size: 'M', quantity: 3500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: 'ITM-P-2', orderId: 'ORD-PERSIST-P2B', color: 'Summit Gold', size: 'L', quantity: 3000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    // Close Session 1
    session1Db.close();

    // Session 2: Reopen from same storage instance
    const session2Db = createIsolatedTestDatabase(sharedIDB, IDBKeyRange, dbName);
    const repos2 = createRepositories(session2Db);
    await session2Db.open();

    const retrievedOrder = await repos2.orders.getOrderByPo(persistPo);
    const retrievedItems = retrievedOrder ? await repos2.orders.getOrderItems(retrievedOrder.id) : [];
    const retrievedBuyer = await repos2.master.getBuyerByCode('NORTH-FACE');
    const retrievedStyle = await repos2.master.getStyleByCode('TNF-GLACIER-01');

    const orderPersisted =
      retrievedOrder !== undefined &&
      retrievedOrder.orderQuantity === 6500 &&
      retrievedOrder.internalOrderNumber === 'SO-2026-999' &&
      retrievedItems.length === 2 &&
      retrievedBuyer !== undefined &&
      retrievedStyle !== undefined;

    results.push({
      testNumber: 12,
      name: 'Persistence Across Sessions',
      passed: Boolean(orderPersisted),
      message: `Order "${persistPo}", items (${retrievedItems.length} records), Buyer [${retrievedBuyer?.code}], and Style [${retrievedStyle?.styleCode}] fully persisted across database restart.`,
    });

    session2Db.close();
  } catch (err: any) {
    results.push({
      testNumber: 12,
      name: 'Persistence Across Sessions',
      passed: false,
      message: `Test 12 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 13: Phase 2A regression tests
  // (Inventory physical/reserved/available accounting sequence + duplicate tx prevention)
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_Regression2A');
    const repos = createRepositories(db);
    await db.open();

    // 1. Inventory Accounting Sequence (100m -> Alloc 60m -> Issue 40m -> Reject 30m)
    const mat = await repos.inventory.createMaterial({
      id: 'MAT-REGRESS-01',
      materialCode: 'REG-FAB-01',
      name: 'Regression Fabric 100m Roll',
      category: 'Woven Fabric',
      spec: '100% Cotton Poplin',
      unit: 'meters',
      reorderPoint: 20,
      warehouseLocation: 'Zone R-01',
      supplierName: 'Regression Mills',
      isSimulated: true,
    });

    // Receive 100m
    await repos.inventory.postTransaction({
      idempotencyKey: 'TX-REG-01',
      materialId: mat.id,
      transactionType: 'PO_RECEIPT',
      quantity: 100,
      referenceType: 'PURCHASE_ORDER',
      referenceId: 'PO-REG-01',
    });

    // Allocate 60m
    await repos.inventory.postTransaction({
      idempotencyKey: 'TX-REG-02',
      materialId: mat.id,
      transactionType: 'ALLOCATION',
      quantity: 60,
      referenceType: 'ORDER_ALLOCATION',
      referenceId: 'ORD-REG-01',
    });

    // Issue 40m
    await repos.inventory.postTransaction({
      idempotencyKey: 'TX-REG-03',
      materialId: mat.id,
      transactionType: 'CUTTING_ISSUE',
      quantity: 40,
      referenceType: 'CUTTING_JOB',
      referenceId: 'CJ-REG-01',
    });

    // Attempt issue 30m (only 20m reserved -> must throw InventoryAccountingError)
    let issue30Rejected = false;
    try {
      await repos.inventory.postTransaction({
        idempotencyKey: 'TX-REG-04',
        materialId: mat.id,
        transactionType: 'CUTTING_ISSUE',
        quantity: 30,
        referenceType: 'CUTTING_JOB',
        referenceId: 'CJ-REG-02',
      });
    } catch (err: any) {
      if (err instanceof InventoryAccountingError) {
        issue30Rejected = true;
      }
    }

    const balance = await repos.inventory.getMaterialStockBalance(mat.id);
    const ledgerPreserved =
      balance.physicalStock === 60 &&
      balance.reservedStock === 20 &&
      balance.availableStock === 40;

    // 2. Duplicate Transaction Prevention
    const dupKey = 'IDEMP-REGRESS-DUP-KEY';
    await repos.inventory.postTransaction({
      idempotencyKey: dupKey,
      materialId: mat.id,
      transactionType: 'PO_RECEIPT',
      quantity: 50,
      referenceType: 'PURCHASE_ORDER',
      referenceId: 'PO-DUP-1',
    });

    let duplicateRejected = false;
    try {
      await repos.inventory.postTransaction({
        idempotencyKey: dupKey,
        materialId: mat.id,
        transactionType: 'PO_RECEIPT',
        quantity: 50,
        referenceType: 'PURCHASE_ORDER',
        referenceId: 'PO-DUP-2',
      });
    } catch (err: any) {
      if (err instanceof DuplicateTransactionError) {
        duplicateRejected = true;
      }
    }

    if (issue30Rejected && ledgerPreserved && duplicateRejected) {
      results.push({
        testNumber: 13,
        name: 'Phase 2A Regression Checks',
        passed: true,
        message: 'All Phase 2A regression tests passed: Inventory accounting balance rules verified (Physical: 60m, Reserved: 20m, Available: 40m, excess issue rejected) and duplicate transaction idempotency key prevention preserved.',
      });
    } else {
      results.push({
        testNumber: 13,
        name: 'Phase 2A Regression Checks',
        passed: false,
        message: `Phase 2A regression failure: issue30Rejected=${issue30Rejected}, ledgerPreserved=${ledgerPreserved}, duplicateRejected=${duplicateRejected}`,
      });
    }
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 13,
      name: 'Phase 2A Regression Checks',
      passed: false,
      message: `Test 13 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Helper for mounting React components in Node or Browser without touching document.body
  // ==========================================
  async function withMountedReactRoot(
    fn: (ctx: {
      container: any;
      renderSync: (el: React.ReactElement) => void;
      flushEffects: () => Promise<void>;
      capturedErrors: string[];
    }) => Promise<void>
  ): Promise<void> {
    const hadDocument = typeof (globalThis as any).document !== 'undefined';
    const prevGlobals: Record<string, any> = {};
    const keysToRestore = [
      'document',
      'window',
      'Node',
      'Element',
      'HTMLElement',
      'HTMLIFrameElement',
      'HTMLInputElement',
      'HTMLSelectElement',
      'HTMLTextAreaElement',
      'Event',
    ];

    if (!hadDocument) {
      keysToRestore.forEach((k) => {
        prevGlobals[k] = (globalThis as any)[k];
      });

      class MockText {
        nodeType = 3;
        data: string;
        parentNode: any = null;
        nextSibling: any = null;
        previousSibling: any = null;
        constructor(t: string) {
          this.data = t;
        }
        get nodeValue() {
          return this.data;
        }
        set nodeValue(v: string) {
          this.data = v;
        }
        get textContent() {
          return this.data;
        }
        set textContent(v: string) {
          this.data = v;
        }
      }

      class MockNode {
        nodeType = 1;
        tagName: string;
        namespaceURI = 'http://www.w3.org/1999/xhtml';
        children: any[] = [];
        childNodes: any[] = [];
        attributes: Record<string, string> = {};
        style: Record<string, string> = {};
        parentNode: any = null;
        nextSibling: any = null;
        previousSibling: any = null;
        listeners: Record<string, Function[]> = {};
        value: any = '';
        disabled = false;
        checked = false;
        selected = false;
        defaultSelected = false;
        multiple = false;
        defaultValue: any = '';
        className = '';
        classList = { add() {}, remove() {}, contains: () => false };

        constructor(tag: string) {
          this.tagName = tag.toUpperCase();
        }
        get options() {
          return this.querySelectorAll('option');
        }
        get firstChild() {
          return this.childNodes[0] || null;
        }
        get lastChild() {
          return this.childNodes[this.childNodes.length - 1] || null;
        }
        get ownerDocument() {
          return (globalThis as any).document;
        }
        appendChild(c: any) {
          return this.insertBefore(c, null);
        }
        insertBefore(c: any, ref: any) {
          if (c.parentNode) c.parentNode.removeChild(c);
          c.parentNode = this;
          const idx = ref ? this.childNodes.indexOf(ref) : -1;
          if (idx === -1) this.childNodes.push(c);
          else this.childNodes.splice(idx, 0, c);
          this._relink();
          return c;
        }
        removeChild(c: any) {
          const idx = this.childNodes.indexOf(c);
          if (idx >= 0) {
            this.childNodes.splice(idx, 1);
            c.parentNode = null;
            this._relink();
          }
          return c;
        }
        _relink() {
          this.children = this.childNodes.filter((n) => n.nodeType === 1);
          this.childNodes.forEach((n, i) => {
            n.previousSibling = i > 0 ? this.childNodes[i - 1] : null;
            n.nextSibling = i < this.childNodes.length - 1 ? this.childNodes[i + 1] : null;
          });
        }
        setAttribute(k: string, v: string) {
          this.attributes[k] = String(v);
          if (k === 'value') this.value = String(v);
        }
        getAttribute(k: string) {
          return this.attributes[k] ?? null;
        }
        hasAttribute(k: string) {
          return k in this.attributes;
        }
        removeAttribute(k: string) {
          delete this.attributes[k];
        }
        addEventListener(t: string, fn: Function) {
          (this.listeners[t] ||= []).push(fn);
        }
        removeEventListener(t: string, fn: Function) {
          this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn);
        }
        dispatchEvent(ev: any) {
          ev.target = ev.target || this;
          ev.currentTarget = this;
          (this.listeners[ev.type] || []).forEach((fn) => fn(ev));
          if (this.parentNode && ev.bubbles !== false) {
            this.parentNode.dispatchEvent(ev);
          }
          return true;
        }
        focus() {}
        scrollIntoView() {}
        set textContent(v: string) {
          this.childNodes = v ? [new MockText(String(v))] : [];
          this._relink();
        }
        get textContent(): string {
          return this.childNodes.map((c) => c.textContent).join('');
        }
        querySelectorAll(sel: string): any {
          const matches: MockNode[] = [];
          const upper = sel.toUpperCase();
          const walk = (n: MockNode) => {
            for (const c of n.children) {
              if (c.tagName === upper) matches.push(c);
              walk(c);
            }
          };
          walk(this);
          // Return a browser-faithful NodeList-like collection (no Array.prototype.map)
          const nodeList: any = {
            length: matches.length,
            item: (index: number) => matches[index] ?? null,
            forEach: (cb: (node: MockNode, idx: number, list: any) => void) => {
              matches.forEach((m, i) => cb(m, i, nodeList));
            },
            [Symbol.iterator]: function* () {
              for (const m of matches) yield m;
            },
          };
          matches.forEach((m, i) => {
            nodeList[i] = m;
          });
          return nodeList;
        }
        querySelector(sel: string): MockNode | null {
          return this.querySelectorAll(sel)[0] || null;
        }
      }

      const mockDoc: any = {
        nodeType: 9,
        defaultView: globalThis,
        createElement: (t: string) => new MockNode(t),
        createElementNS: (_ns: string, t: string) => new MockNode(t),
        createTextNode: (t: string) => new MockText(t),
        createComment: (t: string) => new MockText(t),
        activeElement: null,
        body: new MockNode('body'),
        addEventListener() {},
        removeEventListener() {},
      };

      (globalThis as any).document = mockDoc;
      (globalThis as any).window = globalThis;
      (globalThis as any).Node = MockNode;
      (globalThis as any).Element = MockNode;
      (globalThis as any).HTMLElement = MockNode;
      (globalThis as any).HTMLIFrameElement = MockNode;
      (globalThis as any).HTMLInputElement = MockNode;
      (globalThis as any).HTMLSelectElement = MockNode;
      (globalThis as any).HTMLTextAreaElement = MockNode;
      (globalThis as any).Event = class {
        type: string;
        bubbles = true;
        cancelable = true;
        constructor(t: string, init?: { bubbles?: boolean; cancelable?: boolean }) {
          this.type = t;
          if (init?.bubbles !== undefined) this.bubbles = init.bubbles;
          if (init?.cancelable !== undefined) this.cancelable = init.cancelable;
        }
        preventDefault() {}
        stopPropagation() {}
      };
    }

    const origConsoleError = console.error;
    const capturedErrors: string[] = [];
    console.error = (...args: any[]) => {
      capturedErrors.push(args.map((a) => String(a)).join(' '));
    };

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    try {
      await fn({
        container,
        renderSync: (el: React.ReactElement) => {
          flushSync(() => {
            root.render(el);
          });
        },
        flushEffects: async () => {
          await new Promise((r) => setTimeout(r, 20));
        },
        capturedErrors,
      });
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      try {
        flushSync(() => {
          root.unmount();
        });
      } catch {
        // Ignore unmount cleanup issues
      }
      await new Promise((r) => setTimeout(r, 20));
      console.error = origConsoleError;
      if (!hadDocument) {
        keysToRestore.forEach((k) => {
          if (prevGlobals[k] === undefined) {
            delete (globalThis as any)[k];
          } else {
            (globalThis as any)[k] = prevGlobals[k];
          }
        });
      }
    }
  }

  // ==========================================
  // Test 14: OrderCreateEditModal Repeated Open/Close Hook Stability
  // ==========================================
  try {
    const mockBuyers: BuyerEntity[] = [
      {
        id: 'BUY-HK-1',
        code: 'NIKE',
        name: 'Nike Sourcing',
        country: 'USA',
        contactPerson: 'Jane',
        contactEmail: 'jane@nike.com',
        paymentTerms: 'LC 60',
        complianceRating: 'A',
        status: 'ACTIVE',
        isSimulated: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    const mockStyles: StyleEntity[] = [
      {
        id: 'STY-HK-1',
        buyerId: 'BUY-HK-1',
        styleCode: 'NK-TEE-01',
        description: 'Dri-Fit Training Tee',
        garmentType: 'T-Shirt',
        fabricClassification: 'Polyester Jersey',
        samMinutes: 12.5,
        targetEfficiencyPercent: 85,
        season: 'Core 2026',
        status: 'ACTIVE',
        isSimulated: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    const editOrder: OrderEntity = {
      id: 'ORD-HK-EDIT-1',
      poNumber: 'PO-HK-001',
      internalOrderNumber: 'SO-2026-101',
      buyerId: 'BUY-HK-1',
      styleId: 'STY-HK-1',
      orderQuantity: 500,
      producedQuantity: 0,
      targetExFactoryDate: '2026-12-20',
      status: 'DRAFT',
      assignedLineId: 'LINE-01',
      dhuPercent: 1.5,
      notes: 'Hook check',
      isSimulated: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    let openInputCounts: number[] = [];
    let closedInputCounts: number[] = [];
    let hookWarnings: string[] = [];

    await withMountedReactRoot(async ({ container, renderSync, flushEffects, capturedErrors }) => {
      const states: Array<{ isOpen: boolean; orderToEdit?: OrderEntity | null }> = [
        { isOpen: false, orderToEdit: null },
        { isOpen: true, orderToEdit: null },
        { isOpen: false, orderToEdit: null },
        { isOpen: true, orderToEdit: editOrder },
        { isOpen: false, orderToEdit: editOrder },
        { isOpen: true, orderToEdit: null },
      ];

      for (const st of states) {
        renderSync(
          React.createElement(OrderCreateEditModal, {
            isOpen: st.isOpen,
            onClose: () => {},
            orderToEdit: st.orderToEdit,
            buyers: mockBuyers,
            styles: mockStyles,
            onSaveOrder: async () => {},
          })
        );
        await flushEffects();
        const inputs = container.querySelectorAll('input').length;
        if (st.isOpen) openInputCounts.push(inputs);
        else closedInputCounts.push(inputs);
      }

      hookWarnings = capturedErrors.filter(
        (m) => m.includes('hooks') || m.includes('Hook') || m.includes('error occurred')
      );
    });

    const passed =
      openInputCounts.length === 3 &&
      openInputCounts.every((c) => c > 0) &&
      closedInputCounts.length === 3 &&
      closedInputCounts.every((c) => c === 0) &&
      hookWarnings.length === 0;

    results.push({
      testNumber: 14,
      name: 'OrderCreateEditModal Repeated Open/Close Hook Stability',
      passed,
      message: passed
        ? `Toggled OrderCreateEditModal open/closed 6 times across create and edit modes without React hook errors (open inputs: [${openInputCounts.join(', ')}], closed inputs: [${closedInputCounts.join(', ')}]).`
        : `Hook stability check failed. open=${JSON.stringify(openInputCounts)}, closed=${JSON.stringify(closedInputCounts)}, errors=${JSON.stringify(hookWarnings)}`,
    });
  } catch (err: any) {
    results.push({
      testNumber: 14,
      name: 'OrderCreateEditModal Repeated Open/Close Hook Stability',
      passed: false,
      message: `Test 14 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 15: OrderDetailDrawer Repeated Open/Close Hook Stability
  // ==========================================
  try {
    const order1: OrderWithDetails = {
      id: 'ORD-DRW-1',
      poNumber: 'PO-DRW-1',
      internalOrderNumber: 'SO-2026-201',
      buyerId: 'BUY-1',
      styleId: 'STY-1',
      orderQuantity: 1000,
      producedQuantity: 250,
      targetExFactoryDate: '2026-12-10',
      status: 'CONFIRMED',
      assignedLineId: 'LINE-01',
      dhuPercent: 1.4,
      notes: 'Drawer hook stability check',
      isSimulated: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      buyerName: 'Buyer One',
      buyerCode: 'B1',
      styleCode: 'S-01',
      styleDescription: 'Classic Tee',
      fabricSpec: '180 GSM Cotton',
      samMinutes: 12.0,
    };
    const order2: OrderWithDetails = {
      ...order1,
      id: 'ORD-DRW-2',
      poNumber: 'PO-DRW-2',
      orderQuantity: 2200,
      status: 'DRAFT',
    };

    const itemsByOrder: Record<string, OrderItemEntity[]> = {
      'ORD-DRW-1': [
        { id: 'ITM-DRW-1-M', orderId: 'ORD-DRW-1', color: 'Black', size: 'M', quantity: 1000, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: '2026-01-01T00:00:00Z' },
      ],
      'ORD-DRW-2': [
        { id: 'ITM-DRW-2-L', orderId: 'ORD-DRW-2', color: 'Navy', size: 'L', quantity: 2200, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: '2026-01-01T00:00:00Z' },
      ],
    };

    const fetchItems = async (id: string) => itemsByOrder[id] || [];
    let openTexts: string[] = [];
    let closedTexts: string[] = [];
    let hookWarnings: string[] = [];

    await withMountedReactRoot(async ({ container, renderSync, flushEffects, capturedErrors }) => {
      const sequence: Array<OrderWithDetails | null> = [null, order1, null, order2, null, order1];
      for (const ord of sequence) {
        renderSync(
          React.createElement(OrderDetailDrawer, {
            order: ord,
            onClose: () => {},
            onEdit: () => {},
            onUpdateStatus: async () => {},
            onCancelOrder: async () => {},
            fetchItems,
          })
        );
        await flushEffects();
        if (ord) openTexts.push(container.textContent || '');
        else closedTexts.push(container.textContent || '');
      }

      hookWarnings = capturedErrors.filter(
        (m) => m.includes('hooks') || m.includes('Hook') || m.includes('error occurred')
      );
    });

    const passed =
      openTexts.length === 3 &&
      openTexts[0].includes('PO-DRW-1') &&
      openTexts[0].includes('Black') &&
      openTexts[1].includes('PO-DRW-2') &&
      openTexts[1].includes('Navy') &&
      closedTexts.length === 3 &&
      closedTexts.every((t) => t === '') &&
      hookWarnings.length === 0;

    results.push({
      testNumber: 15,
      name: 'OrderDetailDrawer Repeated Open/Close Hook Stability',
      passed,
      message: passed
        ? 'Toggled OrderDetailDrawer between null and multiple orders 6 times cleanly with zero React hook violations and accurate SKU breakdown rendering.'
        : `Drawer hook/render check failed. errors=${JSON.stringify(hookWarnings)}`,
    });
  } catch (err: any) {
    results.push({
      testNumber: 15,
      name: 'OrderDetailDrawer Repeated Open/Close Hook Stability',
      passed: false,
      message: `Test 15 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 16: New Order Item Foreign Key Alignment (UI Modal + Repository)
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_FKAlignment');
    const repos = createRepositories(db);
    await db.open();

    const buyer = await repos.master.createBuyer({
      id: 'BUY-FK-01',
      code: 'ZARA-FK',
      name: 'Inditex / Zara',
      country: 'Spain',
      contactPerson: 'Elena',
      contactEmail: 'elena@inditex.com',
      paymentTerms: 'LC 60',
      complianceRating: 'A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const style = await repos.master.createStyle({
      id: 'STY-FK-01',
      buyerId: buyer.id,
      styleCode: 'ZAR-POLO-01',
      description: 'Pique Knit Polo',
      garmentType: 'Polo',
      fabricClassification: 'Cotton Pique 210 GSM',
      samMinutes: 14.5,
      targetEfficiencyPercent: 88,
      season: 'SS 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let capturedOrderPayload: any = null;
    let capturedItemsPayload: OrderItemEntity[] = [];

    await withMountedReactRoot(async ({ container, renderSync, flushEffects }) => {
      renderSync(
        React.createElement(OrderCreateEditModal, {
          isOpen: true,
          onClose: () => {},
          buyers: [buyer],
          styles: [style],
          onSaveOrder: async (order, items) => {
            capturedOrderPayload = order;
            capturedItemsPayload = items;
          },
        })
      );
      await flushEffects();

      // Set PO number on the first input and submit the form
      const inputs = container.querySelectorAll('input');
      const poInput = inputs[0];
      poInput.value = 'PO-FK-9001';
      // Dispatch input & form submit via React's form element event or direct DOM submit
      const form = container.querySelector('form');
      const onChangeKey = Object.keys(poInput).find((k) => k.startsWith('__reactProps$'));
      if (onChangeKey && poInput[onChangeKey]?.onChange) {
        poInput[onChangeKey].onChange({ target: { value: 'PO-FK-9001' } });
      }
      await flushEffects();

      const formPropsKey = form && Object.keys(form).find((k) => k.startsWith('__reactProps$'));
      if (formPropsKey && form[formPropsKey]?.onSubmit) {
        await form[formPropsKey].onSubmit({ preventDefault() {} });
      }
    });

    const hasValidGeneratedId =
      typeof capturedOrderPayload?.id === 'string' &&
      capturedOrderPayload.id.startsWith('ORD-') &&
      !capturedOrderPayload.id.includes('ORD-NEW');

    const modalItemsAligned =
      capturedItemsPayload.length > 0 &&
      capturedItemsPayload.every(
        (it) =>
          it.orderId === capturedOrderPayload.id &&
          it.id.startsWith(`ITM-${capturedOrderPayload.id}-`) &&
          !it.id.includes('ORD-NEW')
      );

    // Also persist into Dexie via repository with multi-colour + custom size and verify saved DB records
    const multiColorOrderId = capturedOrderPayload.id;
    const savedResult = await repos.orders.createOrder(
      {
        ...capturedOrderPayload,
        id: multiColorOrderId,
        orderQuantity: 1500,
        producedQuantity: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: 'ITM-ORD-NEW-Charcoal-M', orderId: 'ORD-NEW', color: 'Charcoal', size: 'M', quantity: 500, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: 'ITM-ORD-NEW-Charcoal-3XL', orderId: 'ORD-NEW', color: 'Charcoal', size: '3XL', quantity: 400, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: 'ITM-ORD-NEW-Olive-L', orderId: 'ORD-NEW', color: 'Olive', size: 'L', quantity: 600, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    const dbItems = await repos.orders.getOrderItems(savedResult.order.id);
    const dbForeignKeysValid =
      dbItems.length === 3 &&
      dbItems.every(
        (it) =>
          it.orderId === savedResult.order.id &&
          it.id.startsWith(`ITM-${savedResult.order.id}-`) &&
          !it.id.includes('ORD-NEW')
      );
    const orphanedNewItems = await repos.orders.getOrderItems('ORD-NEW');

    const passed =
      hasValidGeneratedId &&
      modalItemsAligned &&
      dbForeignKeysValid &&
      orphanedNewItems.length === 0;

    results.push({
      testNumber: 16,
      name: 'New Order Foreign Key & Multi-Colour/Size Alignment',
      passed,
      message: passed
        ? `Modal generated parent ID "${savedResult.order.id}" and bound all ${dbItems.length} multi-colour/size items cleanly (0 orphaned ORD-NEW items).`
        : `FK alignment failed: hasValidGeneratedId=${hasValidGeneratedId}, modalItemsAligned=${modalItemsAligned}, dbForeignKeysValid=${dbForeignKeysValid}, orphaned=${orphanedNewItems.length}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 16,
      name: 'New Order Foreign Key & Multi-Colour/Size Alignment',
      passed: false,
      message: `Test 16 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 17: Creating Two Separate Orders With Identical Colour/Size Combinations (No PK Collision + Distinct Breakdowns)
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_TwoOrdersIdenticalMatrix');
    const repos = createRepositories(db);
    await db.open();

    const buyer = await repos.master.createBuyer({
      id: 'BUY-TWO-01',
      code: 'UNIQLO-T',
      name: 'Fast Retailing',
      country: 'Japan',
      contactPerson: 'Kenji',
      contactEmail: 'kenji@uniqlo.com',
      paymentTerms: 'TT 45',
      complianceRating: 'A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const style = await repos.master.createStyle({
      id: 'STY-TWO-01',
      buyerId: buyer.id,
      styleCode: 'UQ-SUP-01',
      description: 'Supima Crew Tee',
      garmentType: 'T-Shirt',
      fabricClassification: 'Cotton Jersey 190 GSM',
      samMinutes: 10.5,
      targetEfficiencyPercent: 90,
      season: 'Core 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const ord1Id = 'ORD-MULTI-001';
    const ord2Id = 'ORD-MULTI-002';

    await repos.orders.createOrder(
      {
        id: ord1Id,
        poNumber: 'PO-UQ-FIRST',
        buyerId: buyer.id,
        styleId: style.id,
        orderQuantity: 1000,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-01',
        status: 'DRAFT',
        assignedLineId: 'LINE-01',
        dhuPercent: 1.5,
        notes: 'First identical matrix order',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: `ITM-${ord1Id}-Black-S`, orderId: ord1Id, color: 'Black', size: 'S', quantity: 100, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: `ITM-${ord1Id}-Black-M`, orderId: ord1Id, color: 'Black', size: 'M', quantity: 200, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: `ITM-${ord1Id}-Black-L`, orderId: ord1Id, color: 'Black', size: 'L', quantity: 300, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: `ITM-${ord1Id}-Navy-XL`, orderId: ord1Id, color: 'Navy', size: 'XL', quantity: 400, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    await repos.orders.createOrder(
      {
        id: ord2Id,
        poNumber: 'PO-UQ-SECOND',
        buyerId: buyer.id,
        styleId: style.id,
        orderQuantity: 260,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-15',
        status: 'CONFIRMED',
        assignedLineId: 'LINE-02',
        dhuPercent: 1.5,
        notes: 'Second identical matrix order',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        { id: `ITM-${ord2Id}-Black-S`, orderId: ord2Id, color: 'Black', size: 'S', quantity: 50, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: `ITM-${ord2Id}-Black-M`, orderId: ord2Id, color: 'Black', size: 'M', quantity: 60, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: `ITM-${ord2Id}-Black-L`, orderId: ord2Id, color: 'Black', size: 'L', quantity: 70, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
        { id: `ITM-${ord2Id}-Navy-XL`, orderId: ord2Id, color: 'Navy', size: 'XL', quantity: 80, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      ]
    );

    const ord1Items = await repos.orders.getOrderItems(ord1Id);
    const ord2Items = await repos.orders.getOrderItems(ord2Id);

    const ord1QtyMap = Object.fromEntries(ord1Items.map((i) => [`${i.color}-${i.size}`, i.quantity]));
    const ord2QtyMap = Object.fromEntries(ord2Items.map((i) => [`${i.color}-${i.size}`, i.quantity]));

    // Verify rendering Order 1 and Order 2 in OrderDetailDrawer displays their distinct breakdowns
    let drawerText1 = '';
    let drawerText2 = '';
    await withMountedReactRoot(async ({ container, renderSync, flushEffects }) => {
      const baseDetails: Omit<OrderWithDetails, 'id' | 'poNumber' | 'orderQuantity'> = {
        buyerId: buyer.id,
        styleId: style.id,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-01',
        status: 'CONFIRMED',
        assignedLineId: 'LINE-01',
        dhuPercent: 1.5,
        notes: 'Drawer breakdown check',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        buyerName: buyer.name,
        buyerCode: buyer.code,
        styleCode: style.styleCode,
        styleDescription: style.description,
        fabricSpec: style.fabricClassification,
        samMinutes: style.samMinutes,
      };
      renderSync(
        React.createElement(OrderDetailDrawer, {
          order: { ...baseDetails, id: ord1Id, poNumber: 'PO-UQ-FIRST', orderQuantity: 1000 },
          onClose: () => {},
          onEdit: () => {},
          onUpdateStatus: async () => {},
          onCancelOrder: async () => {},
          fetchItems: (id) => repos.orders.getOrderItems(id),
        })
      );
      await flushEffects();
      drawerText1 = container.textContent || '';

      renderSync(
        React.createElement(OrderDetailDrawer, {
          order: { ...baseDetails, id: ord2Id, poNumber: 'PO-UQ-SECOND', orderQuantity: 260 },
          onClose: () => {},
          onEdit: () => {},
          onUpdateStatus: async () => {},
          onCancelOrder: async () => {},
          fetchItems: (id) => repos.orders.getOrderItems(id),
        })
      );
      await flushEffects();
      drawerText2 = container.textContent || '';
    });

    const ord1Ok =
      ord1Items.length === 4 &&
      ord1QtyMap['Black-S'] === 100 &&
      ord1QtyMap['Black-M'] === 200 &&
      ord1QtyMap['Black-L'] === 300 &&
      ord1QtyMap['Navy-XL'] === 400 &&
      drawerText1.includes('1,000') &&
      drawerText1.includes('600'); // Black row total = 100+200+300 = 600

    const ord2Ok =
      ord2Items.length === 4 &&
      ord2QtyMap['Black-S'] === 50 &&
      ord2QtyMap['Black-M'] === 60 &&
      ord2QtyMap['Black-L'] === 70 &&
      ord2QtyMap['Navy-XL'] === 80 &&
      drawerText2.includes('260') &&
      drawerText2.includes('180'); // Black row total = 50+60+70 = 180

    results.push({
      testNumber: 17,
      name: 'Multiple Orders Identical Colour/Size Breakdowns Without PK Collision',
      passed: ord1Ok && ord2Ok,
      message:
        ord1Ok && ord2Ok
          ? 'Created two orders with identical Black (S/M/L) + Navy (XL) SKU matrixes without primary-key collisions; each drawer view verified its exact size breakdown.'
          : `Breakdown mismatch: ord1Ok=${ord1Ok}, ord2Ok=${ord2Ok}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 17,
      name: 'Multiple Orders Identical Colour/Size Breakdowns Without PK Collision',
      passed: false,
      message: `Test 17 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 18: Editing Existing Order Preserves Original ID & Restores Custom Sizes
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_EditPreserveID');
    const repos = createRepositories(db);
    await db.open();

    const buyer = await repos.master.createBuyer({
      id: 'BUY-EP-01',
      code: 'HM-EP',
      name: 'H&M Hennes',
      country: 'Sweden',
      contactPerson: 'Sven',
      contactEmail: 'sven@hm.com',
      paymentTerms: 'LC 60',
      complianceRating: 'A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const style = await repos.master.createStyle({
      id: 'STY-EP-01',
      buyerId: buyer.id,
      styleCode: 'HM-CARGO-28',
      description: 'Utility Trouser',
      garmentType: 'Woven Bottom',
      fabricClassification: 'Cotton Twill',
      samMinutes: 22.0,
      targetEfficiencyPercent: 84,
      season: 'AW 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const originalId = 'ORD-ORIG-PRESERVE-99';
    const initialOrderItems: OrderItemEntity[] = [
      { id: `ITM-${originalId}-Khaki-M`, orderId: originalId, color: 'Khaki', size: 'M', quantity: 400, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
      { id: `ITM-${originalId}-Khaki-3XL`, orderId: originalId, color: 'Khaki', size: '3XL', quantity: 150, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: new Date().toISOString() },
    ];

    const created = await repos.orders.createOrder(
      {
        id: originalId,
        poNumber: 'PO-HM-EDIT-99',
        internalOrderNumber: 'SO-2026-399',
        buyerId: buyer.id,
        styleId: style.id,
        orderQuantity: 550,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-20',
        status: 'DRAFT',
        assignedLineId: 'LINE-03',
        dhuPercent: 1.5,
        notes: 'Custom 3XL size test',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      initialOrderItems
    );

    let customSizeRestored = false;
    let submittedEditOrder: any = null;
    let submittedEditItems: OrderItemEntity[] = [];

    await withMountedReactRoot(async ({ container, renderSync, flushEffects }) => {
      renderSync(
        React.createElement(OrderCreateEditModal, {
          isOpen: true,
          onClose: () => {},
          orderToEdit: created.order,
          initialItems: initialOrderItems,
          buyers: [buyer],
          styles: [style],
          onSaveOrder: async (ord, items) => {
            submittedEditOrder = ord;
            submittedEditItems = items;
          },
        })
      );
      await flushEffects();

      const headers = Array.from(container.querySelectorAll('th') as Iterable<any>).map(
        (th: any) => th.textContent
      );
      customSizeRestored = headers.includes('3XL');

      const form = container.querySelector('form');
      const formPropsKey = form && Object.keys(form).find((k) => k.startsWith('__reactProps$'));
      if (formPropsKey && form[formPropsKey]?.onSubmit) {
        await form[formPropsKey].onSubmit({ preventDefault() {} });
      }
    });

    await repos.orders.updateOrder(originalId, submittedEditOrder, submittedEditItems);
    const updatedOrder = await repos.orders.getOrderById(originalId);
    const updatedItems = await repos.orders.getOrderItems(originalId);

    const passed =
      customSizeRestored &&
      submittedEditOrder?.id === originalId &&
      updatedOrder?.id === originalId &&
      updatedItems.length === 2 &&
      updatedItems.every((i) => i.orderId === originalId && i.id.startsWith(`ITM-${originalId}-`)) &&
      updatedItems.some((i) => i.size === 'M' && i.quantity === 400) &&
      updatedItems.some((i) => i.size === '3XL' && i.quantity === 150);

    results.push({
      testNumber: 18,
      name: 'Editing Order Preserves Original ID & Custom-Size Item Relationships',
      passed,
      message: passed
        ? `Custom size column "3XL" restored in matrix; edit preserved original order ID "${originalId}" and all item foreign keys.`
        : `Edit preservation failed: customSizeRestored=${customSizeRestored}, submittedId=${submittedEditOrder?.id}, itemCount=${updatedItems.length}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 18,
      name: 'Editing Order Preserves Original ID & Custom-Size Item Relationships',
      passed: false,
      message: `Test 18 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 19: Switching Between Two Different Orders in Edit Modal Without Stale Form Values
  // ==========================================
  try {
    const buyers: BuyerEntity[] = [
      { id: 'BUY-SW-1', code: 'A', name: 'Buyer Alpha', country: 'US', contactPerson: 'A', contactEmail: 'a@a.com', paymentTerms: 'LC', complianceRating: 'A', status: 'ACTIVE', isSimulated: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'BUY-SW-2', code: 'B', name: 'Buyer Beta', country: 'UK', contactPerson: 'B', contactEmail: 'b@b.com', paymentTerms: 'TT', complianceRating: 'A', status: 'ACTIVE', isSimulated: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ];
    const styles: StyleEntity[] = [
      { id: 'STY-SW-1', buyerId: 'BUY-SW-1', styleCode: 'ST-A', description: 'Alpha Style', garmentType: 'Tee', fabricClassification: 'Cotton', samMinutes: 10, targetEfficiencyPercent: 85, season: 'Core 2026', status: 'ACTIVE', isSimulated: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'STY-SW-2', buyerId: 'BUY-SW-2', styleCode: 'ST-B', description: 'Beta Style', garmentType: 'Hoodie', fabricClassification: 'Fleece', samMinutes: 18, targetEfficiencyPercent: 85, season: 'AW 2026', status: 'ACTIVE', isSimulated: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ];

    const orderA: OrderEntity = {
      id: 'ORD-SW-A',
      poNumber: 'PO-ALPHA-101',
      internalOrderNumber: 'SO-ALPHA-1',
      buyerId: 'BUY-SW-1',
      styleId: 'STY-SW-1',
      orderQuantity: 300,
      producedQuantity: 0,
      targetExFactoryDate: '2026-11-15',
      status: 'DRAFT',
      assignedLineId: 'LINE-01',
      dhuPercent: 1.5,
      notes: 'Alpha special trim instructions',
      isSimulated: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const itemsA: OrderItemEntity[] = [
      { id: 'ITM-SW-A-Red-M', orderId: 'ORD-SW-A', color: 'Crimson Red', size: 'M', quantity: 300, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: '2026-01-01T00:00:00Z' },
    ];

    const orderB: OrderEntity = {
      id: 'ORD-SW-B',
      poNumber: 'PO-BETA-202',
      internalOrderNumber: 'SO-BETA-2',
      buyerId: 'BUY-SW-2',
      styleId: 'STY-SW-2',
      orderQuantity: 950,
      producedQuantity: 0,
      targetExFactoryDate: '2026-12-22',
      status: 'CONFIRMED',
      assignedLineId: 'LINE-04',
      dhuPercent: 1.2,
      notes: 'Beta carton barcoding required',
      isSimulated: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const itemsB: OrderItemEntity[] = [
      { id: 'ITM-SW-B-Teal-XL', orderId: 'ORD-SW-B', color: 'Ocean Teal', size: 'XL', quantity: 950, cutQuantity: 0, sewnQuantity: 0, packedQuantity: 0, isSimulated: true, createdAt: '2026-01-01T00:00:00Z' },
    ];

    let stateAOk = false;
    let stateBOk = false;
    let stateNewOk = false;

    await withMountedReactRoot(async ({ container, renderSync, flushEffects }) => {
      // 1. Open Order A
      renderSync(
        React.createElement(OrderCreateEditModal, {
          isOpen: true,
          onClose: () => {},
          orderToEdit: orderA,
          initialItems: itemsA,
          buyers,
          styles,
          onSaveOrder: async () => {},
        })
      );
      await flushEffects();
      const poA = container.querySelectorAll('input')[0]?.value;
      const notesA = container.querySelector('textarea')?.value;
      const colorA = container.querySelectorAll('input')[3]?.value;
      stateAOk = poA === 'PO-ALPHA-101' && notesA === 'Alpha special trim instructions' && colorA === 'Crimson Red';

      // 2. Switch directly to Order B
      renderSync(
        React.createElement(OrderCreateEditModal, {
          isOpen: true,
          onClose: () => {},
          orderToEdit: orderB,
          initialItems: itemsB,
          buyers,
          styles,
          onSaveOrder: async () => {},
        })
      );
      await flushEffects();
      const poB = container.querySelectorAll('input')[0]?.value;
      const notesB = container.querySelector('textarea')?.value;
      const colorB = container.querySelectorAll('input')[3]?.value;
      stateBOk =
        poB === 'PO-BETA-202' &&
        notesB === 'Beta carton barcoding required' &&
        colorB === 'Ocean Teal' &&
        !container.textContent.includes('PO-ALPHA-101');

      // 3. Switch to New Order (null)
      renderSync(
        React.createElement(OrderCreateEditModal, {
          isOpen: true,
          onClose: () => {},
          orderToEdit: null,
          initialItems: [],
          buyers,
          styles,
          onSaveOrder: async () => {},
        })
      );
      await flushEffects();
      const poNew = container.querySelectorAll('input')[0]?.value;
      const notesNew = container.querySelector('textarea')?.value;
      const colorNew = container.querySelectorAll('input')[3]?.value;
      stateNewOk = poNew === '' && notesNew === '' && colorNew === 'Black Core';
    });

    const passed = stateAOk && stateBOk && stateNewOk;
    results.push({
      testNumber: 19,
      name: 'Switching Between Orders in Edit Modal Without Stale State',
      passed,
      message: passed
        ? 'Verified clean state synchronization: Order A -> Order B -> New Order reset all PO numbers, notes, and matrix colourways with zero stale values.'
        : `Stale state check failed: stateAOk=${stateAOk}, stateBOk=${stateBOk}, stateNewOk=${stateNewOk}`,
    });
  } catch (err: any) {
    results.push({
      testNumber: 19,
      name: 'Switching Between Orders in Edit Modal Without Stale State',
      passed: false,
      message: `Test 19 threw error: ${err.message}`,
    });
  }

  // ==========================================
  // Test 20: Failed Transaction Rollback Leaves Zero Orphaned Order Items
  // ==========================================
  try {
    const customIDB = new IDBFactory();
    const db = createIsolatedTestDatabase(customIDB, IDBKeyRange, 'TestDB_Phase2B_RollbackCheck');
    const repos = createRepositories(db);
    await db.open();

    const buyer = await repos.master.createBuyer({
      id: 'BUY-RB-01',
      code: 'RB-BUY',
      name: 'Rollback Apparel',
      country: 'UK',
      contactPerson: 'Sam',
      contactEmail: 'sam@rb.com',
      paymentTerms: 'LC',
      complianceRating: 'A',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const style = await repos.master.createStyle({
      id: 'STY-RB-01',
      buyerId: buyer.id,
      styleCode: 'RB-01',
      description: 'Rollback Tee',
      garmentType: 'Tee',
      fabricClassification: 'Cotton',
      samMinutes: 10,
      targetEfficiencyPercent: 85,
      season: 'Core 2026',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Seed an existing pre-registered item ID to simulate a primary-key constraint failure during bulkAdd
    const existingGoodOrderId = 'ORD-RB-GOOD';
    await repos.orders.createOrder(
      {
        id: existingGoodOrderId,
        poNumber: 'PO-RB-GOOD',
        buyerId: buyer.id,
        styleId: style.id,
        orderQuantity: 500,
        producedQuantity: 0,
        targetExFactoryDate: '2026-12-20',
        status: 'DRAFT',
        assignedLineId: 'LINE-01',
        dhuPercent: 1.5,
        notes: 'Good seed order for PK collision rollback test',
        isSimulated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [
        {
          id: 'ITM-COLLISION-PK',
          orderId: existingGoodOrderId,
          color: 'Black',
          size: 'M',
          quantity: 500,
          cutQuantity: 0,
          sewnQuantity: 0,
          packedQuantity: 0,
          isSimulated: true,
          createdAt: new Date().toISOString(),
        },
      ]
    );

    // Attempt creating a second order whose 2nd item collides on PK 'ITM-COLLISION-PK' mid-transaction
    const failedOrderId = 'ORD-RB-FAIL';
    let transactionFailed = false;
    try {
      await repos.orders.createOrder(
        {
          id: failedOrderId,
          poNumber: 'PO-RB-FAIL',
          buyerId: buyer.id,
          styleId: style.id,
          orderQuantity: 700,
          producedQuantity: 0,
          targetExFactoryDate: '2026-12-25',
          status: 'DRAFT',
          assignedLineId: 'LINE-01',
          dhuPercent: 1.5,
          notes: 'Order expected to roll back on mid-transaction bulkAdd failure',
          isSimulated: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        [
          {
            id: `ITM-${failedOrderId}-White-S`,
            orderId: failedOrderId,
            color: 'White',
            size: 'S',
            quantity: 300,
            cutQuantity: 0,
            sewnQuantity: 0,
            packedQuantity: 0,
            isSimulated: true,
            createdAt: new Date().toISOString(),
          },
          {
            // Forces bulkAdd ConstraintError AFTER orders.add(failedOrderId) already ran inside the transaction
            id: 'ITM-COLLISION-PK',
            orderId: failedOrderId,
            color: 'White',
            size: 'M',
            quantity: 400,
            cutQuantity: 0,
            sewnQuantity: 0,
            packedQuantity: 0,
            isSimulated: true,
            createdAt: new Date().toISOString(),
          },
        ]
      );
    } catch {
      transactionFailed = true;
    }

    const failedOrderPersisted = await repos.orders.getOrderById(failedOrderId);
    const orphanedItemsForFailed = await repos.orders.getOrderItems(failedOrderId);
    const totalOrders = (await repos.orders.getAllOrders()).length;
    const totalItems = await db.order_items.count();

    const passed =
      transactionFailed &&
      failedOrderPersisted === undefined &&
      orphanedItemsForFailed.length === 0 &&
      totalOrders === 1 &&
      totalItems === 1;

    results.push({
      testNumber: 20,
      name: 'Failed Transaction Rollback Leaves Zero Orphaned Items',
      passed,
      message: passed
        ? 'Mid-transaction bulkAdd failure rolled back orders.add cleanly: 0 partial orders and 0 orphaned order_items persisted.'
        : `Rollback failed: transactionFailed=${transactionFailed}, persisted=${Boolean(failedOrderPersisted)}, orphans=${orphanedItemsForFailed.length}, totalOrders=${totalOrders}, totalItems=${totalItems}`,
    });
    db.close();
  } catch (err: any) {
    results.push({
      testNumber: 20,
      name: 'Failed Transaction Rollback Leaves Zero Orphaned Items',
      passed: false,
      message: `Test 20 threw error: ${err.message}`,
    });
  }

  const allPassed = results.length === 20 && results.every((r) => r.passed);
  return { allPassed, results };
}

// CLI direct runner
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('runPhase2BTests')) {
  runPhase2BTests().then((output) => {
    console.log('\n===============================================================');
    console.log('STITCHPILOT ENTERPRISE — PHASE 2B TEST SUITE: MERCHANDISING');
    console.log('===============================================================\n');
    output.results.forEach((r) => {
      console.log(`[${r.passed ? 'PASS' : 'FAIL'}] Test ${r.testNumber}: ${r.name}`);
      console.log(`  ${r.message.replace(/\n/g, '\n  ')}\n`);
    });
    console.log('---------------------------------------------------------------');
    console.log(
      `Summary: ${output.allPassed ? `ALL ${output.results.length} TESTS PASSED PERFECTLY` : 'SOME TESTS FAILED'} (${
        output.results.filter((r) => r.passed).length
      }/${output.results.length})`
    );
    console.log('===============================================================\n');
    if (!output.allPassed) {
      process.exit(1);
    }
  });
}
