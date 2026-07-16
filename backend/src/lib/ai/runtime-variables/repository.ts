import { aql } from 'arangojs';
import type { z } from 'zod';
import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { AiError } from '@/lib/ai/shared/result';
import { RUNTIME_VARIABLES_COLLECTION, runtimeVariableSchema, type RuntimeVariable } from './schema';

export type RuntimeVariableInsert = Omit<z.input<typeof runtimeVariableSchema>, 'key'> & { key?: string };

export class DuplicateRuntimeVariableError extends AiError {
  constructor(name: string) {
    super('duplicate_runtime_variable', `Runtime variable already exists at this precedence level: ${name}`);
  }
}

export interface RuntimeVariableRepository {
  insertVariable(input: RuntimeVariableInsert): Promise<RuntimeVariable>;
  listVariablesForContext(organizationKey: string, scopeKey: string, agentKey: string): Promise<readonly RuntimeVariable[]>;
}

export function createRuntimeVariableRepository(database = db): RuntimeVariableRepository {
  return {
    async insertVariable(input) {
      const variable = runtimeVariableSchema.parse({ ...input, key: input.key ?? newId() });
      try {
        const result = await database.collection(RUNTIME_VARIABLES_COLLECTION).save(toArangoDoc(variable), { returnNew: true });
        return runtimeVariableSchema.parse(withArangoKey(result.new as Record<string, unknown>));
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new DuplicateRuntimeVariableError(variable.name);
        throw error;
      }
    },
    async listVariablesForContext(organizationKey, scopeKey, agentKey) {
      const parsed = runtimeVariableSchema.pick({ organizationKey: true, scopeKey: true, agentKey: true }).parse({ organizationKey, scopeKey, agentKey });
      const cursor = await database.query(aql`
        FOR variable IN ${database.collection(RUNTIME_VARIABLES_COLLECTION)}
          FILTER variable.organizationKey == ${parsed.organizationKey}
          FILTER variable.scopeKey == null || variable.scopeKey == ${parsed.scopeKey}
          FILTER variable.agentKey == null || variable.agentKey == ${parsed.agentKey}
          SORT (variable.agentKey != null ? 2 : variable.scopeKey != null ? 1 : 0) ASC, variable._key ASC
          RETURN variable
      `);
      return (await cursor.all()).map((doc) => runtimeVariableSchema.parse(withArangoKey(doc)));
    },
  };
}

let cached: RuntimeVariableRepository | null = null;
export function getDefaultRuntimeVariableRepository() { return cached ??= createRuntimeVariableRepository(); }
