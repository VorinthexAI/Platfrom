import { describe, expect, test } from 'bun:test';
import {
  createOnboardingSandboxService,
  ONBOARDING_SANDBOX_PROMPTS,
  OnboardingSandboxError,
  type OnboardingSandboxRepository,
} from './service';

function memoryRepository(): OnboardingSandboxRepository {
  let installation = '';
  let exists = false;
  const leases = new Map<string, string>();
  const answers = new Map<string, string>();
  return {
    async create(_tokenHash, installationHash) { installation = installationHash; exists = true; },
    async claim(_tokenHash, installationHash, promptId, leaseId) {
      if (!exists) return { status: 'expired' };
      if (installationHash !== installation) return { status: 'forbidden' };
      const answer = answers.get(promptId);
      if (answer) return { status: 'completed', answer, answeredCount: answers.size };
      if (answers.size >= 3) return { status: 'limit' };
      if (leases.has(promptId)) return { status: 'processing' };
      leases.set(promptId, leaseId);
      return { status: 'claimed', leaseId };
    },
    async complete(_tokenHash, promptId, leaseId, answer) {
      if (leases.get(promptId) !== leaseId) return -1;
      leases.delete(promptId);
      answers.set(promptId, answer);
      return answers.size;
    },
    async release(_tokenHash, promptId, leaseId) {
      if (leases.get(promptId) === leaseId) leases.delete(promptId);
    },
  };
}

const identifier = 'a'.repeat(128);
const token = 'A'.repeat(43);

describe('onboarding sandbox service', () => {
  test('offers ten server-owned prompts and completes after exactly three distinct answers', async () => {
    const generated: string[] = [];
    let guideCalls = 0;
    const service = createOnboardingSandboxService({
      repository: memoryRepository(),
      now: () => Date.parse('2026-09-05T12:00:00.000Z'),
      token: () => token,
      guide: async () => { guideCalls += 1; return { mode: 'recommend', apps: [{ slug: 'core' }] }; },
      generate: async (system, question) => { generated.push(question); expect(system).toContain('"mode":"recommend"'); return `Answer for ${question}`; },
    });

    const session = await service.createSession(identifier);
    expect(session.prompts).toHaveLength(10);
    expect(session.prompts).toEqual([...ONBOARDING_SANDBOX_PROMPTS]);
    expect(session.prompts.every(({ label }) => label.endsWith('?'))).toBe(true);
    expect(session.prompts.find(({ id }) => id === 'different-from-ai-apps')).toMatchObject({
      label: 'How is Vorinthex AI different from other tools?',
      question: 'How is Vorinthex AI different from other tools?',
    });
    expect(session.questionLimit).toBe(3);

    const first = await service.answer(identifier, token, 'why-vorinthex');
    const replay = await service.answer(identifier, token, 'why-vorinthex');
    const second = await service.answer(identifier, token, 'apps-work-together');
    const third = await service.answer(identifier, token, 'what-is-core');

    expect(first).toMatchObject({ answeredCount: 1, complete: false });
    expect(replay).toEqual(first);
    expect(second).toMatchObject({ answeredCount: 2, complete: false });
    expect(third).toMatchObject({ answeredCount: 3, complete: true });
    expect(generated).toHaveLength(3);
    expect(guideCalls).toBe(3);
    await expect(service.answer(identifier, token, 'what-is-ascend')).rejects.toMatchObject({ code: 'limit' });
  });

  test('binds sessions to the installation and releases a failed generation for retry', async () => {
    let attempts = 0;
    const service = createOnboardingSandboxService({
      repository: memoryRepository(), token: () => token, guide: async () => ({ mode: 'recommend', apps: [] }),
      generate: async () => { attempts += 1; if (attempts === 1) throw new Error('provider unavailable'); return 'Recovered answer'; },
    });
    await service.createSession(identifier);
    await expect(service.answer('b'.repeat(128), token, 'why-vorinthex')).rejects.toBeInstanceOf(OnboardingSandboxError);
    await expect(service.answer(identifier, token, 'why-vorinthex')).rejects.toThrow('provider unavailable');
    await expect(service.answer(identifier, token, 'why-vorinthex')).resolves.toMatchObject({ answer: 'Recovered answer', answeredCount: 1 });
  });
});
