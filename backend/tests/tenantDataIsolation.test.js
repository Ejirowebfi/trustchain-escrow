/**
 * Tenant Data Isolation Tests
 *
 * Verifies that GET /escrows (list) and GET /escrows/:id (detail) never
 * leak one tenant's escrows to another. Prisma is mocked with an in-memory
 * fixture set that is filtered by the currently active tenant context,
 * mirroring how the real tenant-scoping Prisma extension (lib/prisma.js)
 * merges `tenantId` into every query — see prismaTenantScope.test.js for
 * coverage of that extension in isolation.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getCurrentTenantId, runWithTenantContext } from '../lib/tenantContext.js';

const TENANT_A = { id: 'tenant_a', slug: 'alpha' };
const TENANT_B = { id: 'tenant_b', slug: 'beta' };

const ESCROWS = [
  {
    id: 1n,
    tenantId: TENANT_A.id,
    clientAddress: 'A-client',
    freelancerAddress: 'A-freelancer',
    status: 'Active',
    totalAmount: '100',
    remainingBalance: '100',
    deadline: null,
    createdAt: new Date('2026-01-01'),
    milestones: [],
    dispute: null,
  },
  {
    id: 2n,
    tenantId: TENANT_B.id,
    clientAddress: 'B-client',
    freelancerAddress: 'B-freelancer',
    status: 'Active',
    totalAmount: '200',
    remainingBalance: '200',
    deadline: null,
    createdAt: new Date('2026-01-02'),
    milestones: [],
    dispute: null,
  },
];

function tenantScopedEscrows() {
  const tenantId = getCurrentTenantId();
  return ESCROWS.filter((e) => e.tenantId === tenantId);
}

const cacheMock = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
  invalidate: jest.fn(),
  invalidatePrefix: jest.fn(),
  invalidateTags: jest.fn(),
};

const prismaMock = {
  $transaction: jest.fn(async (ops) => Promise.all(ops)),
  escrow: {
    findMany: jest.fn(async () => tenantScopedEscrows()),
    count: jest.fn(async () => tenantScopedEscrows().length),
    findUnique: jest.fn(async ({ where: { id } }) => tenantScopedEscrows().find((e) => e.id === id) ?? null),
  },
};

jest.unstable_mockModule('../lib/cache.js', () => ({ default: cacheMock }));
jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));

const { default: escrowController } = await import('../api/controllers/escrowController.js');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('tenant data isolation — escrow queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /escrows (list)', () => {
    it('only returns Tenant A escrows when scoped to Tenant A', async () => {
      const res = createRes();
      await runWithTenantContext(TENANT_A, () =>
        escrowController.listEscrows({ query: {} }, res),
      );

      const ids = res.body.data.map((e) => e.id);
      expect(ids).toEqual([1n]);
      expect(ids).not.toContain(2n);
    });

    it('only returns Tenant B escrows when scoped to Tenant B', async () => {
      const res = createRes();
      await runWithTenantContext(TENANT_B, () =>
        escrowController.listEscrows({ query: {} }, res),
      );

      const ids = res.body.data.map((e) => e.id);
      expect(ids).toEqual([2n]);
      expect(ids).not.toContain(1n);
    });
  });

  describe('GET /escrows/:id (detail)', () => {
    it('lets Tenant A fetch its own escrow', async () => {
      const res = createRes();
      await runWithTenantContext(TENANT_A, () =>
        escrowController.getEscrow({ params: { id: '1' } }, res),
      );

      expect(res.body.id).toBe(1n);
    });

    it('never lets Tenant A fetch Tenant B\'s escrow by id', async () => {
      const res = createRes();
      await runWithTenantContext(TENANT_A, () =>
        escrowController.getEscrow({ params: { id: '2' } }, res),
      );

      expect(res.statusCode).toBe(404);
    });

    it('never lets Tenant B fetch Tenant A\'s escrow by id', async () => {
      const res = createRes();
      await runWithTenantContext(TENANT_B, () =>
        escrowController.getEscrow({ params: { id: '1' } }, res),
      );

      expect(res.statusCode).toBe(404);
    });
  });
});
