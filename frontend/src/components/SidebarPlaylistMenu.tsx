import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { parseResponse } from "hono/client";
import {
  LibraryItemMenu,
  type LibraryItemMenuHandle,
  type LibraryMenuItem,
} from "./LibraryItemMenu";
import { ConfirmModal } from "./ConfirmModal.tsx";
import {
  Ban,
  ListEnd,
  ListStart,
  LogOut,
  Pencil,
  Play,
  Share,
  Shuffle,
  Trash2,
  Users,
} from "./icons";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useAudioQueue } from "../contexts/audioQueueContext";
import { useShareAction } from "../hooks/useShareAction.ts";
import { queryClient, queryKeys } from "../queryClient.ts";
import { playlistJobsQueryOptions } from "../queryOptions.ts";
import { normalizePlaylistQueueTrack } from "../utils/audioQueue";
import { canPlayTrack, queueTrackOverrides } from "../utils/trackAvailability.ts";
import { staticPlaylistsClient } from "../utils/api/clients/staticPlaylists.ts";
import { flowsClient } from "../utils/api/clients/flows.ts";
import { getApiErrorMessage } from "../utils/api/errors.ts";
import { flowPath, playlistPath } from "../navigation/playlistPaths.ts";
import { useFlowEnabled } from "../pages/playlists/FlowEnabledSwitch.tsx";
import type { Flow, StaticPlaylist } from "../utils/playlistStats.ts";

const PlaylistEditModal = lazy(() =>
  import("../pages/playlists/PlaylistEditModal.tsx").then((m) => ({
    default: m.PlaylistEditModal,
  })),
);
const PlaylistMembersModal = lazy(() =>
  import("../pages/playlists/PlaylistMembersModal.tsx").then((m) => ({
    default: m.PlaylistMembersModal,
  })),
);
const FlowEditor = lazy(() => import("../pages/playlists/FlowEditor.tsx"));

const sharedPlaylist = staticPlaylistsClient["static-playlists"][":playlistId"];
const refreshStatus = () => queryClient.invalidateQueries({ queryKey: queryKeys.playlistStatus });

type MenuPoint = { x: number; y: number };
type Confirm = "delete" | "leave" | null;

// Play, shuffle and queue load the tracks only when chosen, so a right-click
// costs nothing.
function usePlayItems(source: {
  type: "playlist" | "flow";
  id: string;
  label: string;
  recordHistory: boolean;
}): LibraryMenuItem[] {
  const { playQueue, queueNext, addToQueue } = useAudioQueue();
  const { showSuccess, showError } = useToast();
  const withTracks =
    (run: (tracks: ReturnType<typeof normalizePlaylistQueueTrack>[]) => unknown) => async () => {
      try {
        const tracks = (await queryClient.fetchQuery(playlistJobsQueryOptions(source.id)))
          .filter(canPlayTrack)
          .map((track) =>
            normalizePlaylistQueueTrack(track, queueTrackOverrides(track, source.recordHistory)),
          );
        if (tracks.length === 0) showError(`Nothing in ${source.label} can play yet`);
        else run(tracks);
      } catch (error) {
        showError(getApiErrorMessage(error, `Couldn't load ${source.label}`));
      }
    };
  return [
    {
      id: "play",
      label: "Play",
      icon: Play,
      onSelect: withTracks((tracks) => playQueue(tracks, { source })),
    },
    {
      id: "shuffle",
      label: "Shuffle",
      icon: Shuffle,
      onSelect: withTracks((tracks) => playQueue(tracks, { source, shuffle: true })),
    },
    {
      id: "queue-next",
      label: "Play next",
      icon: ListStart,
      onSelect: withTracks((tracks) => {
        if (queueNext(tracks, { source }) === "queued") showSuccess("Playing next");
      }),
    },
    {
      id: "queue-add",
      label: "Add to queue",
      icon: ListEnd,
      onSelect: withTracks((tracks) => {
        if (addToQueue(tracks, { source }) === "queued") showSuccess("Added to queue");
      }),
    },
  ];
}

// After removing what the current page shows, go to its list instead.
function useLeavePage(path: string, fallback: string) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return () => {
    if (pathname === path) navigate(fallback, { replace: true });
  };
}

// Mounted by a right-click, so it opens where the pointer is. It stays
// mounted after closing so its dialogs can finish.
function ContextMenu({
  at,
  label,
  items,
}: {
  at: MenuPoint;
  label: string;
  items: LibraryMenuItem[];
}) {
  const menuRef = useRef<LibraryItemMenuHandle>(null);
  useEffect(() => {
    menuRef.current?.openAt(at.x, at.y);
  }, [at]);
  return (
    <div className="sidebar-playlist__menu" hidden>
      <LibraryItemMenu ref={menuRef} label={label} contextMenu={false} items={items} />
    </div>
  );
}

export function SidebarStaticPlaylistMenu({
  playlist,
  at,
}: {
  playlist: StaticPlaylist;
  at: MenuPoint;
}) {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  const share = useShareAction();
  const leavePage = useLeavePage(playlistPath(playlist.id), "/library/playlists");
  const [editOpen, setEditOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const canManage = user?.role === "admin" || playlist.ownerUserId === user?.id;
  const playItems = usePlayItems({
    type: "playlist",
    id: playlist.id,
    label: playlist.name || "Playlist",
    recordHistory: playlist.recordHistory !== false,
  });
  const param = { playlistId: encodeURIComponent(playlist.id) };

  const remove = async () => {
    setBusy(true);
    try {
      if (confirm === "delete") {
        const result = await parseResponse(sharedPlaylist.$delete({ param }));
        showSuccess(
          result?.queued ? `Removal of ${playlist.name} queued` : `Deleted ${playlist.name}`,
        );
      } else if (user?.id != null) {
        await parseResponse(
          sharedPlaylist.members[":userId"].$delete({
            param: { ...param, userId: String(user.id) },
          }),
        );
        showSuccess(`Left ${playlist.name}`);
      }
      leavePage();
      setConfirm(null);
      void refreshStatus();
    } catch (error) {
      showError(
        getApiErrorMessage(
          error,
          confirm === "delete" ? "Failed to delete playlist" : "Couldn't leave the playlist",
        ),
      );
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const items: LibraryMenuItem[] = [
    ...playItems,
    {
      id: "share",
      label: "Share playlist",
      icon: Share,
      separatorBefore: true,
      onSelect: () =>
        share({ kind: "playlist", playlistId: playlist.id, title: playlist.name }, playlist.name),
    },
    ...(canManage
      ? [
          { id: "edit", label: "Edit details", icon: Pencil, onSelect: () => setEditOpen(true) },
          {
            id: "collaborators",
            label: "Collaborators",
            icon: Users,
            onSelect: () => setMembersOpen(true),
          },
          {
            id: "delete",
            label: "Delete playlist",
            icon: Trash2,
            danger: true,
            separatorBefore: true,
            onSelect: () => setConfirm("delete"),
          },
        ]
      : [
          {
            id: "leave",
            label: "Leave playlist",
            icon: LogOut,
            danger: true,
            separatorBefore: true,
            onSelect: () => setConfirm("leave"),
          },
        ]),
  ];

  return (
    <>
      <ContextMenu at={at} label={playlist.name || "Playlist"} items={items} />
      <Suspense fallback={null}>
        {editOpen ? (
          <PlaylistEditModal
            entry={playlist}
            title="Edit playlist"
            onClose={() => setEditOpen(false)}
            onRename={async (name: string) => {
              await parseResponse(sharedPlaylist.$put({ param, json: { name } }));
              await refreshStatus();
            }}
          />
        ) : null}
        {membersOpen ? (
          <PlaylistMembersModal
            playlist={playlist}
            userId={user?.id ?? null}
            canManage={canManage}
            onChanged={refreshStatus}
            onLeave={() => {
              setMembersOpen(false);
              setConfirm("leave");
            }}
            onClose={() => setMembersOpen(false)}
          />
        ) : null}
      </Suspense>
      <ConfirmModal
        open={confirm === "delete"}
        title={`Delete ${playlist.name}?`}
        body="Its tracks stay in your Library."
        confirmLabel="Delete playlist"
        busyLabel="Deleting…"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={remove}
      />
      <ConfirmModal
        open={confirm === "leave"}
        title={`Leave ${playlist.name}?`}
        body={`${playlist.ownerUsername || "The owner"} can add you back.`}
        confirmLabel="Leave playlist"
        busyLabel="Leaving…"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={remove}
      />
    </>
  );
}

export function SidebarFlowMenu({ flow, at }: { flow: Flow; at: MenuPoint }) {
  const { showSuccess, showError } = useToast();
  const leavePage = useLeavePage(flowPath(flow.id), "/flows");
  const onOff = useFlowEnabled(flow, { onChanged: refreshStatus });
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const playItems = usePlayItems({
    type: "flow",
    id: flow.id,
    label: flow.name || "Flow",
    recordHistory: flow.recordHistory !== false,
  });

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const result = await parseResponse(
        flowsClient.flows[":flowId"].$delete({ param: { flowId: encodeURIComponent(flow.id) } }),
      );
      showSuccess(result?.queued ? `Removal of ${flow.name} queued` : `Deleted ${flow.name}`);
      leavePage();
      setConfirmDelete(false);
      void refreshStatus();
    } catch (error) {
      showError(getApiErrorMessage(error, "Failed to delete flow"));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const items: LibraryMenuItem[] = [
    ...playItems,
    {
      id: "edit",
      label: "Edit",
      icon: Pencil,
      separatorBefore: true,
      onSelect: () => setEditOpen(true),
    },
    onOff.enabled
      ? {
          id: "turn-off",
          label: "Turn off",
          icon: Ban,
          disabled: onOff.pending,
          onSelect: () => onOff.setEnabled(false),
        }
      : {
          id: "turn-on",
          label: "Turn on",
          icon: Play,
          disabled: onOff.pending,
          onSelect: () => onOff.setEnabled(true),
        },
    {
      id: "delete",
      label: "Delete flow",
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      onSelect: () => setConfirmDelete(true),
    },
  ];

  return (
    <>
      <ContextMenu at={at} label={flow.name || "Flow"} items={items} />
      {editOpen ? (
        <Suspense fallback={null}>
          <FlowEditor flowId={flow.id} onClose={() => setEditOpen(false)} />
        </Suspense>
      ) : null}
      {onOff.confirmModal}
      <ConfirmModal
        open={confirmDelete}
        title={`Delete ${flow.name}?`}
        body="Removes this flow, its tracks, and its schedule."
        confirmLabel="Delete flow"
        busyLabel="Deleting…"
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
