import { describe, expect, test } from 'bun:test';
import { createPaymentCheckout, processPolarWebhookPayload } from './payments';

describe('payment webhook dispatch', () => {
  test('does not fulfill unpaid order.created events', async () => {
    await expect(processPolarWebhookPayload({
      type: 'order.created',
      data: {
        id: 'ord_pending',
        paid: false,
        product_id: 'polar_product',
        metadata: { userId: 'usr_test' },
      },
    })).resolves.toEqual({ ignored: true });
  });

  test('ignores subscription events with unknown lifecycle statuses', async () => {
    await expect(processPolarWebhookPayload({
      type: 'subscription.updated',
      data: {
        id: 'sub_test',
        status: 'incomplete',
        product_id: 'polar_product',
        metadata: { userId: 'usr_test' },
      },
    })).resolves.toEqual({ ignored: true });
  });

  test('ignores unknown event types', async () => {
    await expect(processPolarWebhookPayload({
      type: 'benefit.granted',
      data: { id: 'ben_test' },
    })).resolves.toEqual({ ignored: true });
  });

  test('acknowledges product.updated events without fulfillment side effects', async () => {
    await expect(processPolarWebhookPayload({
      type: 'product.updated',
      data: { id: 'prod_test' },
    })).resolves.toEqual({ ignored: true });
  });

  test('ignores checkout.updated statuses that do not terminate the checkout', async () => {
    await expect(processPolarWebhookPayload({
      type: 'checkout.updated',
      data: { id: '', status: 'open' },
    })).resolves.toEqual({ processed: true });
  });

  test('rejects payloads without a type or data', async () => {
    await expect(processPolarWebhookPayload({ type: 'order.paid' })).rejects.toThrow('invalid Polar webhook payload');
    await expect(processPolarWebhookPayload({ data: { id: 'ord_test' } })).rejects.toThrow('invalid Polar webhook payload');
  });
});

describe('payment checkout identity resolution', () => {
  function context(body: unknown, headers: Record<string, string> = {}) {
    return {
      req: {
        header(name: string) {
          return headers[name.toLowerCase()];
        },
        async json() {
          return body;
        },
      },
      json(payload: unknown, status?: number) {
        return { payload, status: status ?? 200 };
      },
      get() {
        return undefined;
      },
    } as any;
  }

  test('requires auth or email_hash before checkout creation', async () => {
    const response = await createPaymentCheckout(context(
      { product_id: 'private.beta.access' },
      { 'idempotency-key': 'idem_test' },
    )) as any;

    expect(response).toEqual({
      payload: { error: 'authentication or email_hash required' },
      status: 401,
    });
  });

});
