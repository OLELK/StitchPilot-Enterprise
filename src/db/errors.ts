/**
 * StitchPilot Enterprise — Domain & Database Errors
 */

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class InventoryAccountingError extends DomainError {
  constructor(
    message: string,
    public readonly materialId: string,
    public readonly details?: {
      physicalStock?: number;
      reservedStock?: number;
      availableStock?: number;
      requestedQuantity?: number;
      transactionType?: string;
    }
  ) {
    super(`[Inventory Accounting Rule Violation] ${message}`);
    this.name = 'InventoryAccountingError';
  }
}

export class DuplicateTransactionError extends DomainError {
  constructor(
    public readonly idempotencyKey: string,
    message?: string
  ) {
    super(
      message ||
        `[Duplicate Transaction] Transaction with idempotency key "${idempotencyKey}" has already been posted to the ledger.`
    );
    this.name = 'DuplicateTransactionError';
  }
}

export class EntityNotFoundError extends DomainError {
  constructor(
    public readonly entityName: string,
    public readonly entityId: string
  ) {
    super(`[Entity Not Found] ${entityName} with ID "${entityId}" does not exist in the database.`);
    this.name = 'EntityNotFoundError';
  }
}

export class RelationshipValidationError extends DomainError {
  constructor(
    public readonly sourceEntity: string,
    public readonly targetEntity: string,
    public readonly targetId: string,
    reason: string
  ) {
    super(
      `[Foreign Key Validation Failure] ${sourceEntity} references invalid ${targetEntity} ("${targetId}"): ${reason}`
    );
    this.name = 'RelationshipValidationError';
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly details?: any
  ) {
    super(`[Validation Error] ${message}`);
    this.name = 'ValidationError';
  }
}

export class InvalidStatusTransitionError extends DomainError {
  constructor(
    public readonly orderId: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
    reason?: string
  ) {
    super(
      `[Invalid Status Transition] Order "${orderId}" cannot transition from "${fromStatus}" to "${toStatus}". ${
        reason || 'Transition violates lifecycle constraints.'
      }`
    );
    this.name = 'InvalidStatusTransitionError';
  }
}

