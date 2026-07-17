export type AccessibleOrganizationOption = {
  key: string;
  name: string;
  alias: string | null;
};

export type AccessibleScopeOption = {
  key: string;
  name: string;
  position: number;
  parentKey: string | null;
  path: string[];
};

export type FoundersAccount = {
  user: { key: string; name: string | null; alias: string | null; email: string };
  rootOrganization: { key: string; name: string; alias: string | null };
  rootMembership: { role: string; title: string | null };
  applicationRole: string;
};

export type BeaconStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";
