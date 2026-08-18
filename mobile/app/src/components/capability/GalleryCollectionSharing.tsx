import { useEffect, useRef, useState } from "react";
import { ScrollView, Share as NativeShare, StyleSheet, Text, View } from "react-native";
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
  filterGalleryShareLinks,
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
import { fonts, palette, radii, spacing } from "@/theme/tokens";
import { subscribeAppEvent } from "@/lib/app-events";

type SharingView = "access" | "members" | "memberRemoveConfirm" | "invites" | "inviteConfirm" | "links" | "member" | "link" | "createLink";
type ShareRole = Exclude<GalleryCollectionRole, "owner">;

const dateTime = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const shareWasCancelled = (error: unknown) => {
  const failure = error as { code?: unknown; message?: unknown };
  return failure?.code === "ECANCELLED" || failure?.code === "E_CANCELLED" || typeof failure?.message === "string" && /cancel(?:led|ed)/i.test(failure.message);
};

export function GalleryCollectionSharing({ collection, context, memberKeys, onClose, open }: {
  collection: GalleryCollection;
  context: { organizationKey: string; scopeKey: string };
  memberKeys: string[];
  onClose: () => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const owner = collection.role === "owner" || !collection.role;
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
  const deferredRefresh = useRef(false);
  const refreshInFlight = useRef(false);
  const contextGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const incomingInvitesQueryKey = galleryQueryKeys.incomingInvites(context);
  const reportFailure = (title: string, error: unknown) => showToast({ title, description: error instanceof Error ? error.message : "Try again." });

  useEffect(() => {
    contextGeneration.current += 1;
    requestGeneration.current += 1;
    deferredRefresh.current = false;
    refreshInFlight.current = false;
    setBusy(false);
    if (open) setView("access");
  }, [open, collection.key, context.organizationKey, context.scopeKey, memberKeys.join("|")]);

  useEffect(() => {
    if (owner) return;
    if (view === "invites" || view === "inviteConfirm" || view === "memberRemoveConfirm" || view === "links" || view === "link" || view === "createLink") {
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
    if (navigate) setView("members"); setLoading(true);
    try {
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.members(context, collection.key), refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.members(context, collection.key), queryFn: () => listGalleryCollectionMembers(collection.key), staleTime: 0 });
      if (generation !== contextGeneration.current || request !== requestGeneration.current) return;
      setMembers(result.members); setCachedGalleryMembers(queryClient, context, collection.key, result.members);
      if (!navigate && selectedMember) {
        const rebound = result.members.find(({ key }) => key === selectedMember.key);
        setSelectedMember(rebound);
        if (!rebound) setView("members");
        else { setRole(rebound.role === "owner" ? "viewer" : rebound.role); }
      }
    } catch (error) { if (generation === contextGeneration.current && request === requestGeneration.current) reportFailure("Members could not be loaded", error); }
    finally { finishLoad(generation, request); }
  }

  async function loadInvites(navigate = true) {
    if (!owner) return;
    const generation = contextGeneration.current;
    const request = ++requestGeneration.current;
    refreshInFlight.current = true;
    if (navigate) setView("invites"); setLoading(true);
    await queryClient.invalidateQueries({ queryKey: incomingInvitesQueryKey, refetchType: "none" });
    try {
      const result = await queryClient.fetchQuery({ queryKey: incomingInvitesQueryKey, queryFn: () => listGalleryCollectionInvites(memberKeys), staleTime: 0 });
      if (generation !== contextGeneration.current || request !== requestGeneration.current || !owner) return;
      setInvites(result.invites);
      if (!navigate && selectedInvite) {
        const rebound = result.invites.find(({ key }) => key === selectedInvite.key);
        setSelectedInvite(rebound);
        if (!rebound) setView("invites");
      }
    } catch (error) { if (generation === contextGeneration.current && request === requestGeneration.current) reportFailure("Invites could not be loaded", error); }
    finally { finishLoad(generation, request); }
  }

  async function loadLinks(navigate = true) {
    if (!owner) return;
    const generation = contextGeneration.current;
    const request = ++requestGeneration.current;
    refreshInFlight.current = true;
    if (navigate) { setLinkTab("active"); setView("links"); } setLoading(true);
    await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.shareLinks(context, collection.key), refetchType: "none" });
    try {
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
    } catch (error) { if (generation === contextGeneration.current && request === requestGeneration.current) reportFailure("Share links could not be loaded", error); }
    finally { finishLoad(generation, request); }
  }

  function openMember(member: GalleryCollectionMember) { setSelectedMember(member); setRole(member.role === "owner" ? "viewer" : member.role); setView("member"); }
  function openLink(link: GalleryCollectionShareLink) { setSelectedLink(link); setRole(link.role); setActive(link.active); setView("link"); }
  function newLink() { setSelectedLink(undefined); setRole("viewer"); setActive(true); setView("createLink"); }

  async function saveMember() {
    if (!selectedMember || !owner) return;
    const generation = contextGeneration.current;
    setBusy(true);
    try {
      const result = await updateGalleryCollectionMember(collection.key, selectedMember.memberKey, role);
      if (generation !== contextGeneration.current) return;
      const next = members.map((member) => member.memberKey === result.memberKey ? { ...member, role: result.role, joinedAt: result.joinedAt } : member);
      setMembers(next); setCachedGalleryMembers(queryClient, context, collection.key, next); setView("members");
    } catch (error) { if (generation === contextGeneration.current) reportFailure("Member update failed", error); }
    finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  async function removeMember() {
    if (!selectedMember || !owner) return;
    const generation = contextGeneration.current;
    setBusy(true);
    const previous = members;
    const next = members.filter(({ key }) => key !== selectedMember.key);
    setMembers(next); setCachedGalleryMembers(queryClient, context, collection.key, next);
    try { await removeGalleryCollectionMember(collection.key, selectedMember.memberKey); if (generation === contextGeneration.current) setView("members"); }
    catch (error) { if (generation === contextGeneration.current) { setMembers(previous); setCachedGalleryMembers(queryClient, context, collection.key, previous); showToast({ title: "Member removal failed", description: error instanceof Error ? error.message : "Try again." }); } }
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
    } catch (error) { if (generation === contextGeneration.current) reportFailure("Invite response failed", error); }
    finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  async function copy(url: string, generation = contextGeneration.current) {
    try { await copyToClipboard(url); if (generation === contextGeneration.current) showToast({ title: "Share link copied to clipboard" }); }
    catch (error) { if (generation === contextGeneration.current) showToast({ title: "Clipboard unavailable", description: error instanceof Error ? error.message : "Try again." }); }
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
      return result.link;
    } catch (error) { if (generation === contextGeneration.current) reportFailure("Share link update failed", error); return undefined; }
    finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  async function shareSelectedLink() {
    if (!selectedLink || !owner) return;
    const generation = contextGeneration.current;
    const link = await saveLink();
    if (!link || generation !== contextGeneration.current) return;
    try {
      const result = await NativeShare.share({
        title: `Share ${collection.name}`,
        message: `Open ${collection.name} with this secure link: ${link.url}`,
        url: link.url,
      }, { dialogTitle: `Share ${collection.name}` });
      if (result.action === NativeShare.dismissedAction) return;
    } catch (error) {
      if (generation !== contextGeneration.current) return;
      if (shareWasCancelled(error)) return;
      reportFailure("Share chooser could not be opened", error);
    }
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
      setLinks(next); setCachedGalleryShareLinks(queryClient, context, collection.key, next); setSelectedLink(result.link); setLinkTab(result.link.active ? "active" : "inactive"); setView("link"); await copy(result.link.url, generation);
    } catch (error) {
      if (generation === contextGeneration.current) { setLinks(previous); setCachedGalleryShareLinks(queryClient, context, collection.key, previous); reportFailure("Share link creation failed", error); }
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

  const title = view === "members" ? "Members" : view === "invites" ? "Pending invites" : view === "member" ? selectedMember?.name ?? "Member" : view === "links" ? "Share links" : view === "link" ? "Share link" : view === "createLink" ? "Create share link" : "";
  const tall = view === "members" || view === "invites" || view === "links" || view === "member" || view === "link" || view === "createLink";
  const mutation = view === "member" || view === "links" || view === "link" || view === "createLink";
  const confirmation = view === "inviteConfirm" || view === "memberRemoveConfirm";
  const footer = view === "members" && owner ? <View style={styles.footer}><Button onPress={() => void loadLinks()} size="lg" variant="primary">Invite</Button><Button onPress={onClose} size="lg" variant="secondary">Close</Button></View>
    : view === "members" || view === "invites" || view === "links" ? <Button onPress={onClose} size="lg" variant="secondary">Close</Button>
      : view === "member" ? <View style={styles.footer}>{owner ? <Button disabled={busy || selectedMember?.role === "owner"} loading={busy} onPress={() => void saveMember()} size="lg" variant="primary">Save</Button> : null}<Button disabled={busy} onPress={() => setView("members")} size="lg" variant="secondary">Close</Button></View>
        : view === "link" ? <View style={styles.footer}><Button disabled={busy || !owner} loading={busy} onPress={() => void shareSelectedLink()} size="lg" variant="primary">Share</Button><Button disabled={busy} onPress={() => setView("links")} size="lg" variant="secondary">Close</Button></View>
          : view === "createLink" ? <View style={styles.footer}><Button disabled={busy} loading={busy} onPress={() => void createLink()} size="lg" variant="primary">Create</Button><Button disabled={busy} onPress={() => setView("links")} size="lg" variant="secondary">Close</Button></View>
            : undefined;

  return <BottomSheet dismissible={!busy && !mutation && !confirmation} footer={footer} hideHeading={view === "access" || confirmation} mutation={mutation} onOpenChange={(next) => { if (!next) onClose(); }} open={open} tall={tall} title={title}>
    {view === "access" ? <View style={styles.menu}><BottomSheetItem onPress={() => void loadMembers()} size="lg" variant="secondary">Members</BottomSheetItem>{owner ? <><BottomSheetItem onPress={() => void loadLinks()} size="lg" variant="secondary">Share links</BottomSheetItem><BottomSheetItem onPress={() => void loadInvites()} size="lg" variant="secondary">Pending invites</BottomSheetItem></> : null}</View> : null}
    {view === "members" ? <View style={styles.full}>
      <Tabs accessibilityLabel="Member roles" style={styles.tabs}>{(["owner", "collaborator", "viewer"] as const).map((item) => <Button key={item} accessibilityState={{ selected: tab === item }} onPress={() => setTab(item)} size="sm" style={styles.tab} variant={tab === item ? "primary" : "ghost"}>{item === "owner" ? "Owner" : item === "collaborator" ? "Collaborators" : "Viewers"}</Button>)}</Tabs>
      {loading ? <View accessibilityLabel="Loading members" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.pillSkeleton} />)}</View> : <ScrollView contentContainerStyle={styles.list}>{members.filter((member) => member.role === tab).map((member) => <View key={member.key} style={styles.row}><Button contentMode="raw" onPress={() => openMember(member)} size="lg" style={styles.rowMain} variant="ghost"><View><Text style={styles.name}>{member.name}</Text><Text style={styles.meta}>{member.email ?? member.role}</Text></View></Button>{owner && member.role !== "owner" ? <Button accessibilityLabel={`Remove ${member.name}`} contentMode="raw" disabled={busy} onPress={() => { setSelectedMember(member); setView("memberRemoveConfirm"); }} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}</View>)}</ScrollView>}
    </View> : null}
    {view === "memberRemoveConfirm" ? <View style={styles.footer}><Button accessibilityHint="Removes this person from the collection." accessibilityLabel={`Remove ${selectedMember?.name ?? "member"} from collection`} disabled={busy} loading={busy} onPress={() => void removeMember()} size="lg" variant="primary">Remove</Button><Button accessibilityHint="Returns to collection members without removing anyone." accessibilityLabel="Close member removal confirmation" disabled={busy} onPress={() => setView("members")} size="lg" variant="secondary">Close</Button></View> : null}
    {view === "member" && selectedMember ? <View style={styles.form}><Text style={styles.name}>{selectedMember.name}</Text><Text style={styles.meta}>Joined {dateTime(selectedMember.joinedAt)}</Text>{owner && selectedMember.role !== "owner" ? <RoleButtons role={role} setRole={setRole} /> : null}</View> : null}
    {view === "invites" ? <View style={styles.full}>{loading ? <View accessibilityLabel="Loading pending invites" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.rowSkeleton} />)}</View> : <ScrollView contentContainerStyle={styles.list}>{invites.map((invite) => <View key={invite.key} style={styles.row}><Button contentMode="raw" onPress={() => { setSelectedInvite(invite); setInviteResponse("accept"); setView("inviteConfirm"); }} size="lg" style={styles.rowMain} variant="ghost"><View><Text style={styles.name}>{invite.recipient}</Text><Text style={styles.meta}>{invite.role}</Text></View></Button><Button accessibilityLabel={`Reject invite for ${invite.recipient}`} contentMode="raw" onPress={() => { setSelectedInvite(invite); setInviteResponse("reject"); setView("inviteConfirm"); }} size="xs" variant="icon"><CloseIcon size="sm" /></Button></View>)}</ScrollView>}</View> : null}
    {view === "inviteConfirm" ? <View style={styles.footer}><Button accessibilityHint={`${inviteResponse === "accept" ? "Adds" : "Does not add"} this shared collection to Gallery.`} accessibilityLabel={`${inviteResponse === "accept" ? "Accept" : "Reject"} invite to ${selectedInvite?.collection.name ?? "collection"}`} disabled={busy} loading={busy} onPress={() => void respondInvite()} size="lg" variant="primary">{inviteResponse === "accept" ? "Accept" : "Reject"}</Button><Button accessibilityHint="Returns to pending invites without responding." accessibilityLabel="Close invite confirmation" disabled={busy} onPress={() => setView("invites")} size="lg" variant="secondary">Close</Button></View> : null}
    {view === "links" ? <View style={styles.full}>
      <Tabs accessibilityLabel="Share link status" style={styles.tabs}><Button accessibilityState={{ selected: linkTab === "active" }} onPress={() => setLinkTab("active")} size="sm" style={styles.tab} variant={linkTab === "active" ? "primary" : "ghost"}>Active links</Button><Button accessibilityState={{ selected: linkTab === "inactive" }} onPress={() => setLinkTab("inactive")} size="sm" style={styles.tab} variant={linkTab === "inactive" ? "primary" : "ghost"}>Inactive links</Button></Tabs>
      {loading ? <View accessibilityLabel="Loading share links" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.rowSkeleton} />)}</View> : <ScrollView contentContainerStyle={styles.list}>{filterGalleryShareLinks(links, linkTab === "active").map((link) => <BottomSheetItem key={link.key} contentMode="raw" onPress={() => openLink(link)} size="lg" variant="ghost"><View><Text numberOfLines={1} style={styles.name}>{link.url}</Text><Text style={styles.meta}>{link.role} · {link.active ? "Active" : "Inactive"}</Text></View></BottomSheetItem>)}{filterGalleryShareLinks(links, linkTab === "active").length === 0 ? <Text style={styles.emptyText}>No {linkTab} share links.</Text> : null}{owner ? <Button icon={<PlusIcon size="sm" />} onPress={newLink} size="lg" variant="secondary">Create new</Button> : null}</ScrollView>}
    </View> : null}
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
  const { showToast } = useToast();
  const [invites, setInvites] = useState<GalleryCollectionInvite[]>([]);
  const [selected, setSelected] = useState<GalleryCollectionInvite>();
  const [response, setResponse] = useState<"accept" | "reject">("accept");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryKey = galleryQueryKeys.incomingInvites(context);
  const deferredRefresh = useRef(false);
  const refreshInFlight = useRef(false);
  const contextGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  async function load() {
    const generation = contextGeneration.current;
    const request = ++requestGeneration.current;
    refreshInFlight.current = true;
    setLoading(true);
    try {
      await queryClient.invalidateQueries({ queryKey, refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey, queryFn: () => listGalleryCollectionInvites(memberKeys), staleTime: 0 });
      if (generation !== contextGeneration.current || request !== requestGeneration.current) return;
      setInvites(result.invites);
      if (selected) {
        const rebound = result.invites.find(({ key }) => key === selected.key);
        setSelected(rebound);
        if (!rebound) setConfirming(false);
      }
    } catch (error) {
      if (generation !== contextGeneration.current || request !== requestGeneration.current) return;
      showToast({ title: "Invites could not be loaded", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      if (generation === contextGeneration.current && request === requestGeneration.current) {
        refreshInFlight.current = false;
        setLoading(false);
        if (deferredRefresh.current && !busyRef.current) { deferredRefresh.current = false; setTimeout(() => { void load(); }, 0); }
      }
    }
  }

  useEffect(() => {
    contextGeneration.current += 1;
    requestGeneration.current += 1;
    refreshInFlight.current = false;
    deferredRefresh.current = false;
    setBusy(false);
    if (open) { setConfirming(false); void load(); }
  }, [open, context.organizationKey, context.scopeKey, memberKeys.join("|")]);
  useEffect(() => subscribeAppEvent((event) => {
    if (!open || event.type === "gallery.changed" && event.slug !== "collection.invites.changed") return;
    if (busyRef.current || refreshInFlight.current) { deferredRefresh.current = true; return; }
    void load();
  }), [busy, open, memberKeys.join("|"), selected?.key]);
  useEffect(() => { if (!busy && !loading && open && deferredRefresh.current && !refreshInFlight.current) { deferredRefresh.current = false; void load(); } }, [busy, loading, open]);

  async function respond() {
    if (!selected) return;
    const generation = contextGeneration.current;
    setBusy(true);
    try {
      await respondToGalleryCollectionInvite(selected.key, response);
      if (generation !== contextGeneration.current) return;
      if (response === "accept") onAccepted();
      setConfirming(false);
      await load();
    } catch (error) {
      if (generation === contextGeneration.current) showToast({ title: "Invite response failed", description: error instanceof Error ? error.message : "Try again." });
    } finally { if (generation === contextGeneration.current) setBusy(false); }
  }

  return <BottomSheet dismissible={!busy && !confirming} footer={!confirming ? <Button disabled={busy} onPress={onClose} size="lg" variant="secondary">Close</Button> : undefined} hideHeading={confirming} onOpenChange={(next) => { if (!next) onClose(); }} open={open} tall={!confirming} title={confirming ? "" : "Pending invites"}>
    {confirming ? <View style={styles.footer}><Button accessibilityHint={`${response === "accept" ? "Adds" : "Does not add"} this shared collection to Gallery.`} accessibilityLabel={`${response === "accept" ? "Accept" : "Reject"} invite to ${selected?.collection.name ?? "collection"}`} disabled={busy} loading={busy} onPress={() => void respond()} size="lg" variant="primary">{response === "accept" ? "Accept" : "Reject"}</Button><Button accessibilityHint="Returns to pending invites without responding." accessibilityLabel="Close invite confirmation" disabled={busy} onPress={() => setConfirming(false)} size="lg" variant="secondary">Close</Button></View> : <View style={styles.full}>{loading ? <View accessibilityLabel="Loading pending invites" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.rowSkeleton} />)}</View> : <ScrollView contentContainerStyle={styles.list}>{invites.map((invite) => <View key={invite.key} style={styles.row}><Button accessibilityLabel={`Accept invite to ${invite.collection.name}`} contentMode="raw" onPress={() => { setSelected(invite); setResponse("accept"); setConfirming(true); }} size="lg" style={styles.rowMain} variant="ghost"><View><Text style={styles.name}>{invite.collection.name}</Text><Text style={styles.meta}>From {invite.inviterDisplayName} · {invite.role}</Text></View></Button><Button accessibilityLabel={`Reject invite to ${invite.collection.name}`} contentMode="raw" onPress={() => { setSelected(invite); setResponse("reject"); setConfirming(true); }} size="xs" variant="icon"><CloseIcon size="sm" /></Button></View>)}</ScrollView>}</View>}
  </BottomSheet>;
}

const styles = StyleSheet.create({
  menu: { gap: spacing.xs }, full: { minHeight: 430, gap: spacing.sm }, footer: { gap: spacing.sm }, form: { minHeight: 300, gap: spacing.md },
  tabs: { padding: 4, flexDirection: "row", borderWidth: 1, backgroundColor: palette.panel }, tab: { flex: 1, paddingHorizontal: 6 },
  list: { gap: 3, paddingBottom: spacing.lg }, pillSkeleton: { height: 34, borderRadius: 999 }, rowSkeleton: { height: 48, borderRadius: radii.md },
  row: { minHeight: 48, paddingLeft: 4, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.hairline }, rowMain: { flex: 1, alignItems: "flex-start", paddingHorizontal: 6 },
  name: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 13 }, meta: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11 },
  emptyText: { paddingVertical: spacing.lg, color: palette.muted, fontFamily: fonts.regular, fontSize: 12, textAlign: "center" },
  roles: { flexDirection: "row", gap: spacing.xs }, switchRow: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
