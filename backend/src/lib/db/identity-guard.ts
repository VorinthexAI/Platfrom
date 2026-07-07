import type { Member } from './members.node';
import {
  getMemberByEmailHash,
  upsertMemberByKey as rawUpsertMemberByKey,
} from './members.node';
import type { SuperAdmin } from './super-admins.node';
import {
  getSuperAdminByEmailHash,
  upsertSuperAdminByKey as rawUpsertSuperAdminByKey,
} from './super-admins.node';

export async function upsertMemberByKeyGuarded(input: Member): Promise<Member> {
  const existing = await getSuperAdminByEmailHash(input.emailHash);
  if (existing) throw new Error('email is already registered as a super admin');
  return rawUpsertMemberByKey(input);
}

export async function upsertSuperAdminByKeyGuarded(input: SuperAdmin): Promise<SuperAdmin> {
  const existing = await getMemberByEmailHash(input.emailHash);
  if (existing) throw new Error('email is already registered as a member');
  return rawUpsertSuperAdminByKey(input);
}
