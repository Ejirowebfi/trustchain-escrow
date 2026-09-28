import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const cacheMock = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
};

const ALL_EVENTS = [
  { id: 1, ledger: 100n, contractId: 'c1', eventType: 'esc_crt', escrowId: 42n, topics: [], data: {}, txHash: 'a', eventIndex: 0 },
  { id: 2, ledger: 101n, contractId: 'c1', eventType: 'esc_fnd', escrowId: 42n, topics: [], data: {}, txHash: 'b', eventIndex: 0 },
  { id: 3, ledger: 102n, contractId: 'c1', eventType: 'esc_rel', escrowId: 42n, topics: [], data: {}, txHash: 'c', eventIndex: 0 },
];

const prismaMock = {
  contractEvent: {
    findMany: jest.fn(async ({ take, cursor }) => {
      const startIndex = cursor ? ALL_EVENTS.findIndex((e) => e.id === cursor.id) + 1 : 0;
      return ALL_EVENTS.slice(startIndex, startIndex + take);
    }),
  },
};

jest.unstable_mockModule('../lib/cache.js', () => ({ default: cacheMock }));
jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));

const { default: eventController } = await import('../api/controllers/eventController.js');

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

describe('eventController.listEscrowEvents (cursor pagination)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheMock.get.mockResolvedValue(null);
  });

  it('defaults the page size to 20 and returns a nextCursor', async () => {
    const req = { params: { escrowId: '42' }, query: {} };
    const res = createRes();

    await eventController.listEscrowEvents(req, res);

    expect(res.body.events).toHaveLength(3);
    expect(res.body.nextCursor).toBeNull();
  });

  it('caps limit at 100 and returns nextCursor when a page is full', async () => {
    const req = { params: { escrowId: '42' }, query: { limit: '2' } };
    const res = createRes();

    await eventController.listEscrowEvents(req, res);

    expect(res.body.events).toHaveLength(2);
    expect(res.body.events.map((e) => e.id)).toEqual([1, 2]);
    expect(res.body.nextCursor).toBe('2');
  });

  it('returns the next page when a cursor is provided', async () => {
    const req = { params: { escrowId: '42' }, query: { limit: '2', cursor: '2' } };
    const res = createRes();

    await eventController.listEscrowEvents(req, res);

    expect(res.body.events.map((e) => e.id)).toEqual([3]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('rejects a non-numeric cursor', async () => {
    const req = { params: { escrowId: '42' }, query: { cursor: 'not-a-number' } };
    const res = createRes();

    await eventController.listEscrowEvents(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid escrow id', async () => {
    const req = { params: { escrowId: 'not-an-id' }, query: {} };
    const res = createRes();

    await eventController.listEscrowEvents(req, res);

    expect(res.statusCode).toBe(400);
  });
});
