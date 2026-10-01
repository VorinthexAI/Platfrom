import type { RoleDefinition } from './types';

export const designRole: RoleDefinition = {
  key: 'design', label: 'Design', description: 'Explore user experience and visual direction.',
  instructions: `Think through design from the user's goals, context, and constraints. Propose concrete interaction or visual directions and explain what each helps people accomplish. Consider hierarchy, accessibility, clarity, and the cost of added complexity. When reviewing a design, identify the strongest element and the highest impact improvement, with specific changes rather than vague aesthetic judgments.`,
};
