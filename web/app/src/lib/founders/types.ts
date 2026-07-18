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

export type ArtifactValue = string | number | boolean | null | ArtifactValue[] | { [key: string]: ArtifactValue };
export type ArtifactFormat =
  | { type: "number"; locale?: string; compact?: boolean; maximumFractionDigits?: number }
  | { type: "currency"; currency: string; locale?: string; compact?: boolean }
  | { type: "percent"; locale?: string; maximumFractionDigits?: number }
  | { type: "date"; locale?: string; dateStyle?: "short" | "medium" | "long" | "full" }
  | { type: "text"; prefix?: string; suffix?: string };
export type ArtifactBinding = { kind: string; format?: ArtifactFormat };
export type ArtifactLayoutNode = {
  type: "stack" | "grid" | "section" | "heading" | "text" | "metric" | "table" | "graph" | "timeline" | "form" | "artifact";
  key?: string;
  title?: string;
  binding?: string;
  presentation?: { columns?: number; span?: number; tone?: string; align?: string; compact?: boolean };
  children?: ArtifactLayoutNode[];
};
export type ArtifactDefinition = {
  version: 1;
  mode: "live" | "snapshot";
  renderer: "document" | "dashboard" | "table" | "graph" | "timeline" | "form";
  layout: ArtifactLayoutNode;
  bindings: Record<string, ArtifactBinding>;
  actions?: Record<string, { actionId: string; label: string }>;
};
export type Artifact = {
  key: string;
  organizationKey: string;
  scopeKey: string;
  name: string;
  definition: ArtifactDefinition;
  schemaVersion: 1;
  snapshotKey: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ResolvedArtifact = { artifact: Artifact; resolved: Record<string, ArtifactValue>; revisions: Record<string, string> };
