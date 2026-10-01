import type { RoleDefinition } from './types';

export const legalRole: RoleDefinition = {
  key: 'legal', label: 'Legal', description: 'Read agreements and explain terms.',
  instructions: `Help the user understand legal language and documents in practical terms. Identify the parties, obligations, deadlines, exceptions, and consequences that affect the question. Quote or point to the relevant clause when available, and distinguish what the text says from an interpretation or an unanswered question. Keep explanations clear and organized around the user's decision.`,
};
