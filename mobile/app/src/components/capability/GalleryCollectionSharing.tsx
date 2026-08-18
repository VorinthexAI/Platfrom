import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { copyToClipboard } from "@vorinthex/shared/ui/clipboard";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { useToast } from "@vorinthex/shared/ui/toast";
import { CloseIcon, PlusIcon } from "@vorinthex/shared/ui/icons-mobile";

import {
  createGalleryCollectionShareLink,
  listGalleryCollectionInvites,
  listGalleryCollectionMembers,
  listGalleryCollectionShareLinks,
  removeGalleryCollectionMember,
  respondToGalleryCollectionInvite,
  updateGalleryCollectionMember,
  updateGalleryCollectionShareLink,
  type GalleryCollection,
  type GalleryCollectionInvite,
  type GalleryCollectionMember,
  type GalleryCollectionRole,
  type GalleryCollectionShareLink,
} from "@/lib/gallery-client";
import { galleryQueryKeys, setCachedGalleryInvites, setCachedGalleryMembers, setCachedGalleryShareLinks } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing } from "@/theme/tokens";
import { subscribeAppEvent } from "@/lib/app-events";

type SharingView = "access" | "members" | "memberRemoveConfirm" | "invites" | "inviteConfirm" | "links" | "member" | "link" | "createLink";
type ShareRole = Exclude<GalleryCollectionRole, "owner">;

const dateTime = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function useNotice() {
  const { showToast } = useToast();
  return (title: string) => showToast({ title, duration: 2_000 });
}

export function GalleryCollectionSharing({ collection, context, onClose, open }: {
  collection: GalleryCollection;
  context: { organizationKey: string; scopeKey: string };
  onClose: () => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const notify = useNotice();
  const owner = collection.role === "owner" || !collection.role;
  const [view, setView] = useState<SharingView>("access");
  const [tab, setTab] = useState<GalleryCollectionRole>("owner");
  const [members, setMembers] = useState<GalleryCollectionMember[]>([]);
  const [invites, setInvites] = useState<GalleryCollectionInvite[]>([]);
  const [links, setLinks] = useState<GalleryCollectionShareLink[]>([]);
  const [selectedMember, setSelectedMember] = useState<GalleryCollectionMember>();
  const [selectedInvite, setSelectedInvite] = useState<GalleryCollectionInvite>();
  const [selectedLink, setSelectedLink] = useState<GalleryCollectionShareLink>();
  const [inviteResponse, setInviteResponse] = useState<"accept" | "reject">("accept");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const reportFailure = (title: string) => notify(title);

  useEffect(() => {
    if (open) setView("access");
  }, [open]);

  async function loadMembers() {
    setView("members"); setLoading(true); setLoadError(undefined);
    try {
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.members(context, collection.key), refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.members(context, collection.key), queryFn: () => listGalleryCollectionMembers(collection.key), staleTime: 0 });
      setMembers(result.members); setCachedGalleryMembers(queryClient, context, collection.key, result.members);
    } catch { setLoadError("Members could not be loaded."); }
    finally { setLoading(false); }
  }

  async function loadInvites() {
    setView("invites"); setLoading(true); setLoadError(undefined);
    await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.invites(context, collection.key), refetchType: "none" });
    try {
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.invites(context, collection.key), queryFn: () => listGalleryCollectionInvites([collection.memberKey]), staleTime: 0 });
      setInvites(result.invites); setCachedGalleryInvites(queryClient, context, collection.key, result.invites);
    } catch { setLoadError("Invites could not be loaded."); }
    finally { setLoading(false); }
  }

  async function loadLinks() {
    setView("links"); setLoading(true); setLoadError(undefined);
    await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.shareLinks(context, collection.key), refetchType: "none" });
    try {
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.shareLinks(context, collection.key), queryFn: () => listGalleryCollectionShareLinks(collection.key), staleTime: 0 });
      setLinks(result.links); setCachedGalleryShareLinks(queryClient, context, collection.key, result.links);
    } catch { setLoadError("Share links could not be loaded."); }
    finally { setLoading(false); }
  }

  function openMember(member: GalleryCollectionMember) { setSelectedMember(member); setRole(member.role === "owner" ? "viewer" : member.role); setView("member"); }
  function openLink(link: GalleryCollectionShareLink) { setSelectedLink(link); setRole(link.role); setActive(link.active); setView("link"); }
  function newLink() { setSelectedLink(undefined); setRole("viewer"); setActive(true); setView("createLink"); }

  async function saveMember() {
    if (!selectedMember || !owner) return;
    setBusy(true);
    try {
      const result = await updateGalleryCollectionMember(collection.key, selectedMember.memberKey, role);
      const next = members.map((member) => member.memberKey === result.memberKey ? { ...member, role: result.role, joinedAt: result.joinedAt } : member);
      setMembers(next); setCachedGalleryMembers(queryClient, context, collection.key, next); setView("members");
      notify("Member updated");
    } catch { reportFailure("Member update failed"); }
    finally { setBusy(false); }
  }

  async function removeMember() {
    if (!selectedMember || !owner) return;
    setBusy(true);
    const previous = members;
    const next = members.filter(({ key }) => key !== selectedMember.key);
    setMembers(next); setCachedGalleryMembers(queryClient, context, collection.key, next);
    try { await removeGalleryCollectionMember(collection.key, selectedMember.memberKey); setView("members"); notify("Member removed"); }
    catch { setMembers(previous); setCachedGalleryMembers(queryClient, context, collection.key, previous); notify("Member removal failed"); }
    finally { setBusy(false); }
  }

  async function respondInvite() {
    if (!selectedInvite) return;
    setBusy(true);
    try {
      await respondToGalleryCollectionInvite(selectedInvite.key, inviteResponse);
      const next = invites.filter(({ key }) => key !== selectedInvite.key);
      setInvites(next); setCachedGalleryInvites(queryClient, context, collection.key, next); setView("invites");
      notify(inviteResponse === "accept" ? "Invite accepted" : "Invite rejected");
    } catch { reportFailure("Invite response failed"); }
    finally { setBusy(false); }
  }

  async function copy(url: string, successTitle = "Share link copied to clipboard", failureTitle = "Clipboard unavailable") {
    try { await copyToClipboard(url); notify(successTitle); }
    catch { notify(failureTitle); }
  }

  async function saveLink() {
    if (!selectedLink) return undefined;
    if (active === selectedLink.active) return { link: selectedLink, updated: false };
    setBusy(true);
    try {
      const result = await updateGalleryCollectionShareLink(collection.key, selectedLink.key, active);
      const next = links.map((link) => link.key === result.link.key ? result.link : link);
      setLinks(next); setCachedGalleryShareLinks(queryClient, context, collection.key, next); setSelectedLink(result.link);
      return { link: result.link, updated: true };
    } catch { reportFailure("Share link update failed"); return undefined; }
    finally { setBusy(false); }
  }

  async function createLink() {
    const optimistic: GalleryCollectionShareLink = { key: `optimistic-${Date.now()}`, url: "Creating share link...", role, active, createdAt: new Date().toISOString() };
    const previous = links;
    const pending = [optimistic, ...links];
    setLinks(pending); setCachedGalleryShareLinks(queryClient, context, collection.key, pending); setBusy(true);
    try {
      const result = await createGalleryCollectionShareLink(collection.key, role, active);
      const next = [result.link, ...previous];
      setLinks(next); setCachedGalleryShareLinks(queryClient, context, collection.key, next); setSelectedLink(result.link); setView("link"); await copy(result.link.url, "Share link created and copied", "Share link created; clipboard unavailable");
    } catch {
      setLinks(previous); setCachedGalleryShareLinks(queryClient, context, collection.key, previous); reportFailure("Share link creation failed");
    } finally { setBusy(false); }
  }

  useEffect(() => subscribeAppEvent((event) => {
    if (!open || busy || event.type !== "collection.changed" && event.type !== "event-stream.connected") return;
    if (view === "members") void loadMembers();
    else if (view === "invites") void loadInvites();
    else if (view === "links") void loadLinks();
  }), [busy, open, view, collection.key, collection.memberKey]);

  const title = view === "members" ? "Members" : view === "invites" ? "Pending invites" : view === "member" ? selectedMember?.name ?? "Member" : view === "links" ? "Share links" : view === "link" ? "Share link" : view === "createLink" ? "Create share link" : "";
  const tall = view === "members" || view === "invites" || view === "links" || view === "member" || view === "link" || view === "createLink";
  const mutation = view === "member" || view === "link" || view === "createLink";
  const confirmation = view === "inviteConfirm" || view === "memberRemoveConfirm";
  const footer = view === "members" && owner ? <View style={styles.footer}><Button onPress={() => void loadLinks()} size="lg" variant="primary">Invite</Button><Button onPress={onClose} size="lg" variant="secondary">Close</Button></View>
    : view === "members" || view === "invites" || view === "links" ? <Button onPress={onClose} size="lg" variant="secondary">Close</Button>
      : view === "member" ? <View style={styles.footer}>{owner ? <Button disabled={busy || selectedMember?.role === "owner"} loading={busy} onPress={() => void saveMember()} size="lg" variant="primary">Save</Button> : null}<Button disabled={busy} onPress={() => setView("members")} size="lg" variant="secondary">Close</Button></View>
          : view === "link" ? <View style={styles.footer}><Button disabled={busy} loading={busy} onPress={() => void saveLink().then((result) => { if (result) void copy(result.link.url, result.updated ? "Share link updated and copied" : undefined, result.updated ? "Share link updated; clipboard unavailable" : undefined); })} size="lg" variant="primary">Copy</Button><Button disabled={busy} onPress={() => setView("links")} size="lg" variant="secondary">Close</Button></View>
          : view === "createLink" ? <View style={styles.footer}><Button disabled={busy} loading={busy} onPress={() => void createLink()} size="lg" variant="primary">Create</Button><Button disabled={busy} onPress={() => setView("links")} size="lg" variant="secondary">Close</Button></View>
            : undefined;

  return <BottomSheet dismissible={!busy && !mutation && !confirmation} footer={footer} hideHeading={view === "access" || confirmation} mutation={mutation} onOpenChange={(next) => { if (!next) onClose(); }} open={open} tall={tall} title={title}>
    {loadError ? <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text> : null}
    {view === "access" ? <View style={styles.menu}><BottomSheetItem onPress={() => void loadMembers()} size="lg" variant="secondary">Members</BottomSheetItem>{owner ? <BottomSheetItem onPress={() => void loadInvites()} size="lg" variant="secondary">Pending invites</BottomSheetItem> : null}</View> : null}
    {view === "members" ? <View style={styles.full}>
      <Tabs accessibilityLabel="Member roles" style={styles.tabs}>{(["owner", "collaborator", "viewer"] as const).map((item) => <Button key={item} accessibilityState={{ selected: tab === item }} onPress={() => setTab(item)} size="sm" style={styles.tab} variant={tab === item ? "primary" : "ghost"}>{item === "owner" ? "Owner" : item === "collaborator" ? "Collaborators" : "Viewers"}</Button>)}</Tabs>
      {loading ? <View accessibilityLabel="Loading members" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.pillSkeleton} />)}</View> : <ScrollView contentContainerStyle={styles.list}>{members.filter((member) => member.role === tab).map((member) => <View key={member.key} style={styles.row}><Button contentMode="raw" onPress={() => openMember(member)} size="lg" style={styles.rowMain} variant="ghost"><View><Text style={styles.name}>{member.name}</Text><Text style={styles.meta}>{member.email ?? member.role}</Text></View></Button>{owner && member.role !== "owner" ? <Button accessibilityLabel={`Remove ${member.name}`} contentMode="raw" disabled={busy} onPress={() => { setSelectedMember(member); setView("memberRemoveConfirm"); }} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}</View>)}</ScrollView>}
    </View> : null}
    {view === "memberRemoveConfirm" ? <View style={styles.footer}><Button accessibilityHint="Removes this person from the collection." accessibilityLabel={`Remove ${selectedMember?.name ?? "member"} from collection`} disabled={busy} loading={busy} onPress={() => void removeMember()} size="lg" variant="primary">Remove</Button><Button accessibilityHint="Returns to collection members without removing anyone." accessibilityLabel="Close member removal confirmation" disabled={busy} onPress={() => setView("members")} size="lg" variant="secondary">Close</Button></View> : null}
    {view === "member" && selectedMember ? <View style={styles.form}><Text style={styles.name}>{selectedMember.name}</Text><Text style={styles.meta}>Joined {dateTime(selectedMember.joinedAt)}</Text>{owner && selectedMember.role !== "owner" ? <RoleButtons role={role} setRole={setRole} /> : null}</View> : null}
    {view === "invites" ? <View style={styles.full}>{loading ? <View accessibilityLabel="Loading pending invites" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.rowSkeleton} />)}</View> : <ScrollView contentContainerStyle={styles.list}>{invites.map((invite) => <View key={invite.key} style={styles.row}><Button contentMode="raw" onPress={() => { setSelectedInvite(invite); setInviteResponse("accept"); setView("inviteConfirm"); }} size="lg" style={styles.rowMain} variant="ghost"><View><Text style={styles.name}>{invite.recipient}</Text><Text style={styles.meta}>{invite.role}</Text></View></Button><Button accessibilityLabel={`Reject invite for ${invite.recipient}`} contentMode="raw" onPress={() => { setSelectedInvite(invite); setInviteResponse("reject"); setView("inviteConfirm"); }} size="xs" variant="icon"><CloseIcon size="sm" /></Button></View>)}</ScrollView>}</View> : null}
    {view === "inviteConfirm" ? <View style={styles.footer}><Button accessibilityHint={`${inviteResponse === "accept" ? "Adds" : "Does not add"} this shared collection to Gallery.`} accessibilityLabel={`${inviteResponse === "accept" ? "Accept" : "Reject"} invite to ${selectedInvite?.collection.name ?? "collection"}`} disabled={busy} loading={busy} onPress={() => void respondInvite()} size="lg" variant="primary">{inviteResponse === "accept" ? "Accept" : "Reject"}</Button><Button accessibilityHint="Returns to pending invites without responding." accessibilityLabel="Close invite confirmation" disabled={busy} onPress={() => setView("invites")} size="lg" variant="secondary">Close</Button></View> : null}
    {view === "links" ? <View style={styles.full}>{loading ? <View accessibilityLabel="Loading share links" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.rowSkeleton} />)}</View> : <ScrollView contentContainerStyle={styles.list}>{links.map((link) => <BottomSheetItem key={link.key} contentMode="raw" onPress={() => openLink(link)} size="lg" variant="ghost"><View><Text numberOfLines={1} style={styles.name}>{link.url}</Text><Text style={styles.meta}>{link.role} · {link.active ? "Active" : "Inactive"}</Text></View></BottomSheetItem>)}{owner ? <Button icon={<PlusIcon size="sm" />} onPress={newLink} size="lg" variant="secondary">Create new</Button> : null}</ScrollView>}</View> : null}
    {view === "link" && selectedLink ? <View style={styles.form}><Text style={styles.meta}>Created {dateTime(selectedLink.createdAt)}</Text><Text style={styles.name}>{selectedLink.role === "viewer" ? "Viewer" : "Collaborator"}</Text><View style={styles.switchRow}><Switch accessibilityLabel="Share link active" checked={active} onCheckedChange={setActive} /><Text style={styles.meta}>Active</Text></View></View> : null}
    {view === "createLink" ? <View style={styles.form}><RoleButtons role={role} setRole={setRole} /><View style={styles.switchRow}><Switch accessibilityLabel="New share link active" checked={active} onCheckedChange={setActive} /><Text style={styles.meta}>Active</Text></View></View> : null}
  </BottomSheet>;
}

function RoleButtons({ role, setRole }: { role: ShareRole; setRole: (role: ShareRole) => void }) {
  return <View accessibilityLabel="Access role" style={styles.roles}><Button accessibilityState={{ selected: role === "viewer" }} onPress={() => setRole("viewer")} size="sm" variant={role === "viewer" ? "primary" : "secondary"}>Viewer</Button><Button accessibilityState={{ selected: role === "collaborator" }} onPress={() => setRole("collaborator")} size="sm" variant={role === "collaborator" ? "primary" : "secondary"}>Collaborator</Button></View>;
}

export function GalleryPendingInvites({ context, memberKeys, onAccepted, onClose, open }: {
  context: { organizationKey: string; scopeKey: string };
  memberKeys: string[];
  onAccepted: () => void;
  onClose: () => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const notify = useNotice();
  const [invites, setInvites] = useState<GalleryCollectionInvite[]>([]);
  const [selected, setSelected] = useState<GalleryCollectionInvite>();
  const [response, setResponse] = useState<"accept" | "reject">("accept");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const queryKey = galleryQueryKeys.invites(context, "incoming");

  async function load() {
    setLoading(true); setLoadError(undefined);
    try {
      await queryClient.invalidateQueries({ queryKey, refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey, queryFn: () => listGalleryCollectionInvites(memberKeys), staleTime: 0 });
      setInvites(result.invites);
      setCachedGalleryInvites(queryClient, context, "incoming", result.invites);
    } catch { setLoadError("Invites could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (open) { setConfirming(false); void load(); } }, [open]);
  useEffect(() => subscribeAppEvent((event) => { if (open && !busy && (event.type === "collection.changed" || event.type === "event-stream.connected")) void load(); }), [busy, open, memberKeys.join("|")]);

  async function respond() {
    if (!selected) return;
    setBusy(true);
    try {
      await respondToGalleryCollectionInvite(selected.key, response);
      if (response === "accept") onAccepted();
      setConfirming(false);
      notify(response === "accept" ? "Invite accepted" : "Invite rejected");
      await load();
    } catch {
      notify("Invite response failed");
    } finally { setBusy(false); }
  }

  return <BottomSheet dismissible={!busy && !confirming} footer={!confirming ? <Button disabled={busy} onPress={onClose} size="lg" variant="secondary">Close</Button> : undefined} hideHeading={confirming} onOpenChange={(next) => { if (!next) onClose(); }} open={open} tall={!confirming} title={confirming ? "" : "Pending invites"}>
    {loadError ? <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text> : null}
    {confirming ? <View style={styles.footer}><Button accessibilityHint={`${response === "accept" ? "Adds" : "Does not add"} this shared collection to Gallery.`} accessibilityLabel={`${response === "accept" ? "Accept" : "Reject"} invite to ${selected?.collection.name ?? "collection"}`} disabled={busy} loading={busy} onPress={() => void respond()} size="lg" variant="primary">{response === "accept" ? "Accept" : "Reject"}</Button><Button accessibilityHint="Returns to pending invites without responding." accessibilityLabel="Close invite confirmation" disabled={busy} onPress={() => setConfirming(false)} size="lg" variant="secondary">Close</Button></View> : <View style={styles.full}>{loading ? <View accessibilityLabel="Loading pending invites" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.rowSkeleton} />)}</View> : <ScrollView contentContainerStyle={styles.list}>{invites.map((invite) => <View key={invite.key} style={styles.row}><Button accessibilityLabel={`Accept invite to ${invite.collection.name}`} contentMode="raw" onPress={() => { setSelected(invite); setResponse("accept"); setConfirming(true); }} size="lg" style={styles.rowMain} variant="ghost"><View><Text style={styles.name}>{invite.collection.name}</Text><Text style={styles.meta}>From {invite.inviterDisplayName} · {invite.role}</Text></View></Button><Button accessibilityLabel={`Reject invite to ${invite.collection.name}`} contentMode="raw" onPress={() => { setSelected(invite); setResponse("reject"); setConfirming(true); }} size="xs" variant="icon"><CloseIcon size="sm" /></Button></View>)}</ScrollView>}</View>}
  </BottomSheet>;
}

const styles = StyleSheet.create({
  menu: { gap: spacing.xs }, full: { minHeight: 430, gap: spacing.sm }, footer: { gap: spacing.sm }, form: { minHeight: 300, gap: spacing.md },
  tabs: { padding: 4, flexDirection: "row", borderWidth: 1, backgroundColor: palette.panel }, tab: { flex: 1, paddingHorizontal: 6 },
  list: { gap: 3, paddingBottom: spacing.lg }, pillSkeleton: { height: 34, borderRadius: 999 }, rowSkeleton: { height: 48, borderRadius: radii.md },
  row: { minHeight: 48, paddingLeft: 4, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.hairline }, rowMain: { flex: 1, alignItems: "flex-start", paddingHorizontal: 6 },
  name: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 13 }, meta: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11 }, error: { color: palette.danger, fontFamily: fonts.medium, fontSize: 12 },
  roles: { flexDirection: "row", gap: spacing.xs }, switchRow: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
