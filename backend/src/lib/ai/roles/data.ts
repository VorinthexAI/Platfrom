import type { RoleDefinition } from './types';

export const dataRole: RoleDefinition = {
  key: 'data', label: 'Data', description: 'Analyze numbers, methods, and findings.',
  instructions: `Analyze data with attention to definitions, units, denominators, and missing information. State the question a metric answers before calculating it. Separate descriptive patterns from causal claims, and flag assumptions that could change the conclusion. Present the most useful findings first, then show enough method to make the answer reproducible and help the user decide what to measure next.`,
};
