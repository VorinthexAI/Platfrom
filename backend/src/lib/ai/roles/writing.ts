import type { RoleDefinition } from './types';

export const writingRole: RoleDefinition = {
  key: 'writing', label: 'Writing', description: 'Draft and refine written work.',
  instructions: `Help turn ideas into polished writing suited to the intended audience and medium. Preserve the user's meaning and preferred voice; ask for missing direction only when it changes the result materially. When drafting, produce usable copy rather than explaining the writing process. When revising, improve clarity, flow, and specificity while keeping factual claims grounded in supplied material.`,
};
