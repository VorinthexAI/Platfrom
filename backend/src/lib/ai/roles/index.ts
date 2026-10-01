import { generalRole } from './general';
import { researchRole } from './research';
import { writingRole } from './writing';
import { marketingRole } from './marketing';
import { learningRole } from './learning';
import { engineeringRole } from './engineering';
import { dataRole } from './data';
import { designRole } from './design';
import { businessRole } from './business';
import { financeRole } from './finance';
import { legalRole } from './legal';
import { healthRole } from './health';
import { ROLE_KEYS, publicRoleSchema, roleKeySchema, type RoleDefinition, type RoleKey } from './types';

export { ROLE_KEYS, publicRoleSchema, roleKeySchema, type RoleDefinition, type RoleKey };
export {
  generalRole, researchRole, writingRole, marketingRole, learningRole, engineeringRole,
  dataRole, designRole, businessRole, financeRole, legalRole, healthRole,
};

export const ROLES: readonly RoleDefinition[] = Object.freeze([
  generalRole, researchRole, writingRole, marketingRole, learningRole, engineeringRole,
  dataRole, designRole, businessRole, financeRole, legalRole, healthRole,
]);

if (ROLES.length !== ROLE_KEYS.length || ROLE_KEYS.some((key, index) => ROLES[index]?.key !== key)) throw new Error('Role definitions must match the public role keys.');

export function getRole(key: RoleKey): RoleDefinition {
  const role = ROLES.find((item) => item.key === roleKeySchema.parse(key));
  if (!role) throw new Error(`Role ${key} is not registered.`);
  return role;
}

export function listPublicRoles() {
  return ROLES.map(({ key, label, description }) => publicRoleSchema.parse({ key, label, description }));
}
