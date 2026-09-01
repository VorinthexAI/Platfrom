import { useEffect, useRef, useState } from "react";
import { ScrollView, Share as NativeShare, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { Button } from "@vorinthex/shared/ui/button";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { useToast } from "@vorinthex/shared/ui/toast";
import { CloseIcon } from "@vorinthex/shared/ui/icons-mobile";

import {
  createGalleryCollectionShareLink,
  filterGalleryShareLinks,
  isGalleryCollectionOwned,
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
import { galleryQueryKeys, setCachedGalleryMembers, setCachedGalleryShareLinks } from "@/lib/workspace-query-cache";
import { fonts, palette, spacing } from "@/theme/tokens";
import { subscribeAppEvent } from "@/lib/app-events";

type SharingView = "access" | "members" | "memberRemoveConfirm" | "invites" | "inviteConfirm" | "links" | "member" | "link" | "createLink";
type ShareRole = Exclude<GalleryCollectionRole, "owner">;

const dateTime = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const shareWasCancelled = (error: unknown) => {
  const failure = error as { code?: unknown; message?: unknown };
  return failure?.code === "ECANCELLED" || failure?.code === "E_CANCELLED" || typeof failure?.message === "string" && /cancel(?:led|ed)/i.test(failure.message);
};

function useNotice() {
  const { showToast } = useToast();
  return (title: string) => showToast({ title, duration: 2_000 });
}

export function GalleryCollectionSharing({ collection, context, memberKeys, onClose, open }: {
  collection: GalleryCollection;
  context: { organizationKey: string; scopeKey: string };
  memberKeys: string[];
  onClose: () => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const notify = useNotice();
  const owner = isGalleryCollectionOwned(collection);
  const [view, setView] = useState<SharingView>("access");
  const [tab, setTab] = useState<GalleryCollectionRole>("owner");
  const [members, setMembers] = useState<GalleryCollectionMember[]>([]);
  const [invites, setInvites] = useState<GalleryCollectionInvite[]>([]);
  const [links, setLinks] = useState<GalleryCollectionShareLink[]>([]);
  const [linkTab, setLinkTab] = useState<"active" | "inactive">("active");
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
  const deferredRefresh = useRef(false);
  const refreshInFlight = useRef(false);
  const contextGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const incomingInvitesQueryKey = galleryQueryKeys.incomingInvites(context);

  useEffect(() => {
    contextGeneration.current += 1;
    requestGeneration.current += 1;
    deferredRefresh.current = false;
    refreshInFlight.current = false;
    setBusy(false);
    setLoadError(undefined);
    if (open) setView("access");
  }, [open, collection.key, context.organizationKey, context.scopeKey, memberKeys.join("|")]);

  useEffect(() => {
    if (owner) return;
    if (view === "invites" || view === "inviteConfirm" || view === "member" || view === "memberRemoveConfirm" || view === "links" || view === "link" || view === "createLink") {
      contextGeneration.current += 1;
      requestGeneration.current += 1;
      deferredRefresh.current = false;
      refreshInFlight.current = false;
      setBusy(false);
      setSelectedInvite(undefined);
      setSelectedLink(undefined);
      setView("access");
    }
  }, [owner, view]);

  function finishLoad(generation: number, request: number) {
    if (generation !== contextGeneration.current || request !== requestGeneration.current) return;
    refreshInFlight.current = false;
    setLoading(false);
    if (deferredRefresh.current && !busyRef.current) { deferredRefresh.current = false; setTimeout(scheduleSharingRefresh, 0); }
  }

  async function loadMembers(navigate = true) {
    const generation = contextGeneration.current;
    const request = ++requestGeneration.current;
    refreshInFlight.current = true;
    if (navigate) { setMembers([]); setTab("owner"); setView("members"); } setLoading(true); setLoadError(undefined);
    try {
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.members(context, collection.key), exact: true, refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.members(context, collection.key), queryFn: () => listGalleryCollectionMembers(collection.key), staleTime: 0 });
      if (generation !== contextGeneration.current || request !== requestGeneration.current) return;
      setMembers(result.members); setCachedGalleryMembers(queryClient, context, collection.key, result.members);
      if (!navigate && selectedMember) {
        const rebound = result.members.find(({ key }) => key === selectedMember.key);
        setSelectedMember(rebound);
        if (!rebound) setView("members");
        else { setRole(rebound.role === "owner" ? "viewer" : rebound.role); }
      }
    } catch { if (generation === contextGeneration.current && request === requestGeneration.current) setLoadError("Members could not be loaded."); }
    finally { finishLoad(generation, request); }
  }

  async function loadInvites(navigate = true) {
    if (!owner) return;
    const generation = contextGeneration.current;
    const request = ++requestGeneration.current;
    refreshInFlight.current = true;
    if (navigate) { setInvites([]); setView("invites"); } setLoading(true); setLoadError(undefined);
    try {
      await queryClient.invalidateQueries({ queryKey: incomingInvitesQueryKey, exact: true, refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey: incomingInvitesQueryKey, queryFn: () => listGalleryCollectionInvites(memberKeys), staleTime: 0 });
      if (generation !== contextGeneration.current || request !== requestGeneration.current || !owner) return;
      setInvites(result.invites);
      if (!navigate && selectedInvite) {
        const rebound = result.invites.find(({ key }) => key === selectedInvite.key);
        setSelectedInvite(rebound);
        if (!rebound) setView("invites");
      }
    } catch { if (generation === contextGeneration.current && request === requestGeneration.current) setLoadError("Invites could not be loaded."); }
    finally { finishLoad(generation, request); }
  }

  async function loadLinks(navigate = true) {
    if (!owner) return;
    const generation = contextGeneration.current;
    const request = ++requestGeneration.current;
    refreshInFlight.current = true;
    if (navigate) { setLinks([]); setLinkTab("active"); setView("links"); } setLoading(true); setLoadError(undefined);
    try {
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.shareLinks(context, collection.key), exact: true, refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.shareLinks(context, collection.key), queryFn: () => listGalleryCollectionShareLinks(collection.key), staleTime: 0 });
      if (generation !== contextGeneration.current || request !== requestGeneration.current || !owner) return;
      setLinks(result.links); setCachedGalleryShareLinks(queryClient, context, collection.key, result.links);
      if (!navigate && view === "links" && filterGalleryShareLinks(result.links, linkTab === "active").length === 0 && filterGalleryShareLinks(result.links, linkTab !== "active").length > 0) setLinkTab(linkTab === "active" ? "inactive" : "active");
      if (!navigate && selectedLink) {
        const rebound = result.links.find(({ key }) => key === selectedLink.key);
        setSelectedLink(rebound);
        if (!rebound) setView("links");
        else { setRole(rebound.role); setActive(rebound.active); setLinkTab(rebound.active ? "active" : "inactive"); }
      }
    } catch { if (generation === contextGeneration.current && request === requestGeneration.current) setLoadError("Share links could not be loaded."); }
    finally { finishLoad(generation, request); }
  }

  function openMember(member: GalleryCollectionMember) { if (!owner || member.role === "owner") return; setSelectedMember(member); setRole(member.role); setView("member"); }
  function openLink(link: GalleryCollectionShareLink) { setSelectedLink(link); setRole(link.role); setActive(link.active); setView("link"); }
  function newLink() { setSelectedLink(undefined); setRole("viewer"); setActive(true); setView("createLink"); }

  async function saveMember() {
    if (!selectedMember || !owner || selectedMember.role === "owner") return;
    const generation = contextGeneration.current;
    setBusy(true);
    try {
      const result = await updateGalleryCollectionMember(collection.key, selectedMember.memberKey, role);
      if (generation !== contextGeneration.current) return;
      const next = members.map((member) => member.memberKey === result.memberKey ? { ...member, role: result.role, joinedAt: result.joinedAt } : member);
      setMembers(next); setCachedGalleryMembers(queryClient, context, collection.key, next); setView("members");
      notify("Member updated");
    } catch { if (generation === contextGeneration.current) reportFailure("Member update failed"); }
    finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  async function removeMember() {
    if (!selectedMember || !owner || selectedMember.role === "owner") return;
    const generation = contextGeneration.current;
    setBusy(true);
    const previous = members;
    const next = members.filter(({ key }) => key !== selectedMember.key);
    setMembers(next); setCachedGalleryMembers(queryClient, context, collection.key, next);
    try { await removeGalleryCollectionMember(collection.key, selectedMember.memberKey); if (generation === contextGeneration.current) { setView("members"); notify("Member removed"); } }
    catch { if (generation === contextGeneration.current) { setMembers(previous); setCachedGalleryMembers(queryClient, context, collection.key, previous); notify("Member removal failed"); } }
    finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  async function respondInvite() {
    if (!selectedInvite) return;
    const generation = contextGeneration.current;
    setBusy(true);
    try {
      await respondToGalleryCollectionInvite(selectedInvite.key, inviteResponse);
      if (generation !== contextGeneration.current) return;
      const next = invites.filter(({ key }) => key !== selectedInvite.key);
      setInvites(next); queryClient.setQueryData(incomingInvitesQueryKey, { invites: next }); setView("invites");
      notify(inviteResponse === "accept" ? "Invite accepted" : "Invite rejected");
    } catch { if (generation === contextGeneration.current) reportFailure("Invite response failed"); }
    finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  async function saveLink() {
    if (!selectedLink || !owner) return undefined;
    const generation = contextGeneration.current;
    if (active === selectedLink.active) return selectedLink;
    setBusy(true);
    try {
      const result = await updateGalleryCollectionShareLink(collection.key, selectedLink.key, active);
      if (generation !== contextGeneration.current) return undefined;
      const next = links.map((link) => link.key === result.link.key ? result.link : link);
      setLinks(next); setCachedGalleryShareLinks(queryClient, context, collection.key, next); setSelectedLink(result.link); setLinkTab(result.link.active ? "active" : "inactive");
      notify("Share link updated");
      return result.link;
    } catch { if (generation === contextGeneration.current) reportFailure("Share link update failed"); return undefined; }
    finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  async function openNativeShare(link: GalleryCollectionShareLink, generation: number) {
    if (generation !== contextGeneration.current) return;
    try {
      const result = await NativeShare.share({
        title: `Share ${collection.name}`,
        message: `Open ${collection.name} with this secure link: ${link.url}`,
        url: link.url,
      }, { dialogTitle: `Share ${collection.name}` });
      if (result.action === NativeShare.dismissedAction) return;
      notify("Share link shared");
    } catch (error) {
      if (generation !== contextGeneration.current) return;
      if (shareWasCancelled(error)) return;
      reportFailure("Share chooser could not be opened");
    }
  }

  async function shareSelectedLink() {
    if (!selectedLink || !owner) return;
    const generation = contextGeneration.current;
    const link = await saveLink();
    if (!link || generation !== contextGeneration.current) return;
    await openNativeShare(link, generation);
  }

  async function createLink() {
    if (!owner) return;
    const generation = contextGeneration.current;
    const optimistic: GalleryCollectionShareLink = { key: `optimistic-${Date.now()}`, url: "Creating share link...", role, active, createdAt: new Date().toISOString() };
    const previous = links;
    const pending = [optimistic, ...links];
    setLinks(pending); setCachedGalleryShareLinks(queryClient, context, collection.key, pending); setBusy(true);
    try {
      const result = await createGalleryCollectionShareLink(collection.key, role, active);
      if (generation !== contextGeneration.current) return;
      const next = [result.link, ...previous];
      setLinks(next); setCachedGalleryShareLinks(queryClient, context, collection.key, next); setSelectedLink(result.link); setLinkTab(result.link.active ? "active" : "inactive"); setView("link"); notify("Share link created"); if (result.token) await openNativeShare(result.link, generation);
    } catch {
      if (generation === contextGeneration.current) { setLinks(previous); setCachedGalleryShareLinks(queryClient, context, collection.key, previous); reportFailure("Share link creation failed"); }
    } finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  function refreshOpenView() {
    if (view === "members" || view === "member" || view === "memberRemoveConfirm") void loadMembers(false);
    else if (view === "invites" || view === "inviteConfirm") void loadInvites(false);
    else if (view === "links" || view === "link") void loadLinks(false);
  }

  function scheduleSharingRefresh() {
    if (busyRef.current || refreshInFlight.current) { deferredRefresh.current = true; return; }
    deferredRefresh.current = false;
    refreshOpenView();
  }

  useEffect(() => subscribeAppEvent((event) => {
    if (!open) return;
    if (event.type === "inbox.changed" || event.type === "conversation.changed") return;
    const relevant = event.type === "event-stream.connected"
      || event.slug === "collection.access.changed" && (view === "members" || view === "member" || view === "memberRemoveConfirm")
      || event.slug === "collection.invites.changed" && (view === "invites" || view === "inviteConfirm")
      || event.slug === "collection.shares.changed" && (view === "links" || view === "link");
    if (!relevant) return;
    scheduleSharingRefresh();
  }), [busy, open, view, collection.key, memberKeys.join("|"), selectedMember?.key, selectedInvite?.key, selectedLink?.key]);

  useEffect(() => {
    if (!busy && open && deferredRefresh.current && !refreshInFlight.current) scheduleSharingRefresh();
  }, [busy, loading, open]);

  const title = view === "members" ? "Members" : view === "invites" ? "Pending invites" : view === "member" ? selectedMember?.name ?? "Member" : view === "memberRemoveConfirm" ? "Remove member?" : view === "inviteConfirm" ? `${inviteResponse === "accept" ? "Accept" : "Reject"} invite?` : view === "links" ? "Share links" : view === "link" ? "Share link" : view === "createLink" ? "Create share link" : "";
  const fullHeight = view === "members" || view === "invites" || view === "member" || view === "links" || view === "link" || view === "createLink";
  const visibleMembers = members.filter((member) => member.role === tab);
  const visibleLinks = filterGalleryShareLinks(links, linkTab === "active");
  const footer = view === "members" && owner ? <><Button onPress={() => void loadLinks()} size="md" variant="primary">Invite</Button><Button onPress={onClose} size="md" variant="secondary">Close</Button></>
    : view === "links" && owner ? <><Button disabled={busy} onPress={newLink} size="md" variant="primary">Create</Button><Button disabled={busy} onPress={onClose} size="md" variant="secondary">Close</Button></>
      : view === "members" || view === "invites" || view === "links" ? <Button onPress={onClose} size="md" variant="secondary">Close</Button>
      : view === "member" ? <>{owner ? <Button disabled={busy || selectedMember?.role === "owner"} loading={busy} onPress={() => void saveMember()} size="md" variant="primary">Save</Button> : null}<Button disabled={busy} onPress={() => setView("members")} size="md" variant="secondary">Close</Button></>
        : view === "link" ? <><Button disabled={busy || !owner} loading={busy} onPress={() => void shareSelectedLink()} size="md" variant="primary">Share</Button><Button disabled={busy} onPress={() => setView("links")} size="md" variant="secondary">Close</Button></>
          : view === "createLink" ? <><Button disabled={busy} loading={busy} onPress={() => void createLink()} size="md" variant="primary">Create</Button><Button disabled={busy} onPress={() => setView("links")} size="md" variant="secondary">Close</Button></>
            : undefined;

  return <BottomSheet dismissible={!busy} footer={footer} height={fullHeight ? "full" : undefined} hideHeading={view === "access"} onOpenChange={(next) => { if (!next) onClose(); }} open={open} title={title}>
    {loadError && fullHeight ? <View style={styles.sheetEmptyContent}><Text accessibilityRole="alert" style={styles.error}>{loadError}</Text></View> : <>
    {loadError ? <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text> : null}
    {view === "access" ? <BottomSheetMenu><BottomSheetItem onPress={() => void loadMembers()} style={styles.menuItem} variant="secondary">Members</BottomSheetItem>{owner ? <><BottomSheetItem onPress={() => void loadLinks()} style={styles.menuItem} variant="secondary">Share links</BottomSheetItem><BottomSheetItem onPress={() => void loadInvites()} style={styles.menuItem} variant="secondary">Pending invites</BottomSheetItem></> : null}</BottomSheetMenu> : null}
    {view === "members" ? <View style={styles.full}>
      <Tabs accessibilityLabel="Member roles" accessibilityRole="tablist" style={styles.tabs}>{(["owner", "collaborator", "viewer"] as const).map((item) => <Button accessibilityRole="tab" key={item} accessibilityState={{ selected: tab === item }} onPress={() => setTab(item)} size="md" style={styles.tab} variant={tab === item ? "secondary" : "ghost"}>{item === "owner" ? "Owner" : item === "collaborator" ? "Collaborator" : "Viewer"}</Button>)}</Tabs>
      <ScrollView contentContainerStyle={[styles.list, !loading && visibleMembers.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.sheetList}>{loading ? <View accessibilityLabel="Loading members" accessibilityRole="progressbar" style={styles.skeletonList}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.pillSkeleton} />)}</View> : visibleMembers.length ? visibleMembers.map((member) => { const editable = owner && member.role !== "owner"; return <ActionPill action={editable ? <CloseIcon size="sm" /> : undefined} actionLabel={editable ? `Remove ${member.name}` : undefined} disabled={busy} key={member.key} onAction={editable ? () => { setSelectedMember(member); setView("memberRemoveConfirm"); } : undefined} onPress={editable ? () => openMember(member) : undefined} pressLabel={editable ? `Edit ${member.name}` : undefined}><View style={styles.pillCopy}><Text numberOfLines={1} style={styles.name}>{member.name}</Text><Text numberOfLines={1} style={styles.meta}>{member.email ?? member.role}</Text></View></ActionPill>; }) : <Text style={styles.emptyText}>No {tab} members.</Text>}</ScrollView>
    </View> : null}
    {view === "memberRemoveConfirm" ? <View style={styles.footer}><Button accessibilityHint="Removes this person from the collection." accessibilityLabel={`Remove ${selectedMember?.name ?? "member"} from collection`} disabled={busy} loading={busy} onPress={() => void removeMember()} size="md" variant="primary">Remove</Button><Button accessibilityHint="Returns to collection members without removing anyone." accessibilityLabel="Close member removal confirmation" disabled={busy} onPress={() => setView("members")} size="md" variant="secondary">Close</Button></View> : null}
    {view === "member" && selectedMember && owner && selectedMember.role !== "owner" ? <View style={styles.form}><Text style={styles.meta}>Joined {dateTime(selectedMember.joinedAt)}</Text><RoleTabs role={role} setRole={setRole} /></View> : null}
    {view === "invites" ? <View style={styles.full}><ScrollView contentContainerStyle={[styles.list, !loading && invites.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.sheetList}>{loading ? <View accessibilityLabel="Loading pending invites" accessibilityRole="progressbar" style={styles.skeletonList}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.pillSkeleton} />)}</View> : invites.length ? invites.map((invite) => <ActionPill action={<CloseIcon size="sm" />} actionLabel={`Reject invite to ${invite.collection.name}`} disabled={busy} key={invite.key} onAction={() => { setSelectedInvite(invite); setInviteResponse("reject"); setView("inviteConfirm"); }} onPress={() => { setSelectedInvite(invite); setInviteResponse("accept"); setView("inviteConfirm"); }} pressLabel={`Accept invite to ${invite.collection.name}`}><View style={styles.pillCopy}><Text numberOfLines={1} style={styles.name}>{invite.collection.name}</Text><Text numberOfLines={1} style={styles.meta}>From {invite.inviterDisplayName} · {invite.role}</Text></View></ActionPill>) : <Text style={styles.emptyText}>No pending invites.</Text>}</ScrollView></View> : null}
    {view === "inviteConfirm" ? <View style={styles.footer}><Button accessibilityHint={inviteResponse === "accept" ? "Adds this shared collection to Gallery." : "Rejects this pending invitation."} accessibilityLabel={`${inviteResponse === "accept" ? "Accept" : "Reject"} invite to ${selectedInvite?.collection.name ?? "collection"}`} disabled={busy} loading={busy} onPress={() => void respondInvite()} size="md" variant="primary">{inviteResponse === "accept" ? "Accept" : "Reject"}</Button><Button accessibilityHint="Returns to pending invites without responding." accessibilityLabel="Close invite confirmation" disabled={busy} onPress={() => setView("invites")} size="md" variant="secondary">Close</Button></View> : null}
    {view === "links" ? <View style={styles.full}>
      <Tabs accessibilityLabel="Share link status" accessibilityRole="tablist" style={styles.tabs}><Button accessibilityRole="tab" accessibilityState={{ selected: linkTab === "active" }} onPress={() => setLinkTab("active")} size="md" style={styles.tab} variant={linkTab === "active" ? "secondary" : "ghost"}>Active links</Button><Button accessibilityRole="tab" accessibilityState={{ selected: linkTab === "inactive" }} onPress={() => setLinkTab("inactive")} size="md" style={styles.tab} variant={linkTab === "inactive" ? "secondary" : "ghost"}>Inactive links</Button></Tabs>
      <ScrollView contentContainerStyle={[styles.list, !loading && visibleLinks.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.sheetList}>{loading ? <View accessibilityLabel="Loading share links" accessibilityRole="progressbar" style={styles.skeletonList}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.pillSkeleton} />)}</View> : visibleLinks.length ? visibleLinks.map((link) => <Button contentMode="raw" key={link.key} onPress={() => openLink(link)} size="md" style={styles.pillButton} variant="secondary"><View style={styles.pillCopy}><Text numberOfLines={1} style={styles.name}>{link.url}</Text><Text style={styles.meta}>{link.role} · {link.active ? "Active" : "Inactive"}</Text></View></Button>) : <Text style={styles.emptyText}>No {linkTab} share links.</Text>}</ScrollView>
    </View> : null}
    {view === "link" && selectedLink ? <View style={styles.form}><Text style={styles.meta}>Created {dateTime(selectedLink.createdAt)}</Text><Text style={styles.name}>{selectedLink.role === "viewer" ? "Viewer" : "Collaborator"}</Text><View style={styles.switchRow}><Switch accessibilityLabel="Share link active" checked={active} onCheckedChange={setActive} /><Text style={styles.meta}>Active</Text></View></View> : null}
    {view === "createLink" ? <View style={styles.form}><RoleTabs role={role} setRole={setRole} /><View style={styles.switchRow}><Switch accessibilityLabel="New share link active" checked={active} onCheckedChange={setActive} /><Text style={styles.meta}>Active</Text></View></View> : null}
    </>}
  </BottomSheet>;
}

function RoleTabs({ role, setRole }: { role: ShareRole; setRole: (role: ShareRole) => void }) {
  return <Tabs accessibilityLabel="Access role" accessibilityRole="tablist" style={styles.tabs}><Button accessibilityRole="tab" accessibilityState={{ selected: role === "viewer" }} onPress={() => setRole("viewer")} size="md" style={styles.tab} variant={role === "viewer" ? "secondary" : "ghost"}>Viewer</Button><Button accessibilityRole="tab" accessibilityState={{ selected: role === "collaborator" }} onPress={() => setRole("collaborator")} size="md" style={styles.tab} variant={role === "collaborator" ? "secondary" : "ghost"}>Collaborator</Button></Tabs>;
}

const styles = StyleSheet.create({
  menu: { gap: spacing.xs }, menuItem: { justifyContent: "center" }, full: { flex: 1, minHeight: 0, gap: spacing.md }, footer: { gap: spacing.sm }, form: { minHeight: 300, gap: spacing.md },
  tabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel }, tab: { flex: 1 },
  sheetList: { flex: 1 }, list: { gap: 6, paddingBottom: spacing.xl }, skeletonList: { gap: 6 }, pillSkeleton: { width: "100%", minHeight: 38, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  pillButton: { flex: 1, minHeight: 38, justifyContent: "flex-start", paddingHorizontal: 14 }, pillCopy: { flex: 1, alignItems: "flex-start", gap: 2 },
  name: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 13 }, meta: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11 },
  error: { color: palette.danger, fontFamily: fonts.medium, fontSize: 12 },
  emptyText: { paddingVertical: spacing.lg, color: palette.muted, fontFamily: fonts.regular, fontSize: 12, textAlign: "center" },
  sheetEmptyContent: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  switchRow: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
