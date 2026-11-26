import { lazy, Suspense, useState, type DragEvent, type SyntheticEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import RouteLink from "./RouteLink";
import { SortableList } from "./SortableList";
import { LibraryItemMenu } from "./LibraryItemMenu";
import { ListMusic, RotateCcw, Upload } from "./icons";
import { usePlaylistArtwork } from "../hooks/usePlaylistArtwork.ts";
import { flowPath, playlistPath } from "../navigation/playlistPaths.ts";
import { PlaylistArtworkThumb } from "./PlaylistArtworkThumb.tsx";
import type { Flow, PlaylistStatus, StaticPlaylist } from "../utils/playlistStats.ts";
import { applyCustomOrder } from "../utils/playlistOrder.ts";
import { playlistOrderQueryOptions } from "../queryOptions.ts";
import { usersClient } from "../utils/api/clients/users.ts";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useTrackSaveActions } from "../hooks/useTrackSaveActions.ts";
import {
  activePlaylistDrag,
  useActivePlaylistDrag,
  type PlaylistDrag,
} from "../utils/playlistDrag.ts";
import {
  canAddTracksToPlaylist,
  normalizePlaylistTrackEntry,
  reserveUniquePlaylistName,
} from "../utils/staticPlaylists.ts";
import { staticPlaylistsClient } from "../utils/api/clients/staticPlaylists.ts";
import { getApiErrorMessage } from "../utils/api/errors.ts";
import { queryKeys } from "../queryClient.ts";

type SidebarPlaylistsProps = {
  status: PlaylistStatus | undefined;
  iconsOnly: boolean;
  onTooltip?: (event: SyntheticEvent<HTMLElement>) => void;
};

type Entry = {
  id: string;
  name: string;
  kind: string;
  path: string;
  droppable: boolean;
  playlist?: StaticPlaylist;
  flow?: Flow;
};

function usePlaylistOrder() {
  const { user } = useAuth();
  const { showError } = useToast();
  const queryClient = useQueryClient();
  const options = playlistOrderQueryOptions(user?.id);
  const { data, isLoading } = useQuery(options);
  const [dropped, setDropped] = useState<string[]>();
  const { mutate } = useMutation({
    scope: { id: "playlist-order" },
    mutationFn: (ids: string[]) =>
      parseResponse(usersClient.me["playlist-order"].$put({ json: { ids } })),
    onSuccess: (saved) => queryClient.setQueryData(options.queryKey, saved),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: options.queryKey });
      showError("Couldn't save playlist order");
    },
    onSettled: (_saved, _error, ids) =>
      setDropped((current) => (current === ids ? undefined : current)),
  });
  const saveOrder = (ids: string[]) => {
    setDropped(ids);
    mutate(ids);
  };
  return { order: dropped ?? data?.ids ?? [], isLoading, saveOrder };
}

// The menus load on the first right-click, keeping them out of the first page load.
const SidebarStaticPlaylistMenu = lazy(() =>
  import("./SidebarPlaylistMenu.tsx").then((m) => ({ default: m.SidebarStaticPlaylistMenu })),
);
const SidebarFlowMenu = lazy(() =>
  import("./SidebarPlaylistMenu.tsx").then((m) => ({ default: m.SidebarFlowMenu })),
);

type DropZone = "into" | "before" | "after";

const dropZoneClass: Record<DropZone, string> = {
  into: " is-drop-target",
  before: " is-drop-before",
  after: " is-drop-after",
};

function SidebarPlaylistRow({
  entry,
  iconsOnly,
  onTooltip,
  dragActive,
  onDropTracks,
  onDropNewPlaylist,
  onOpenMenu,
}: {
  entry: Entry;
  iconsOnly: boolean;
  onTooltip?: SidebarPlaylistsProps["onTooltip"];
  dragActive: PlaylistDrag | null;
  onDropTracks: (playlistId: string, drag: PlaylistDrag) => void;
  onDropNewPlaylist: (where: "before" | "after", drag: PlaylistDrag) => void;
  onOpenMenu: (entry: Entry, at: { x: number; y: number }) => void;
}) {
  const { pathname } = useLocation();
  const { artworkUrlFor } = usePlaylistArtwork();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  });
  const [zone, setZone] = useState<DropZone | null>(null);
  const active = pathname === entry.path;
  const acceptsTracks = (drag: PlaylistDrag) =>
    entry.droppable && !drag.excludedPlaylistIds?.includes(entry.id);
  // The edges of a row drop between playlists and make a new one; the middle
  // adds to the playlist itself when it takes tracks.
  const zoneAt = (event: DragEvent<HTMLElement>, drag: PlaylistDrag): DropZone => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = (event.clientY - rect.top) / rect.height;
    if (acceptsTracks(drag) && position >= 0.25 && position <= 0.75) return "into";
    return position < 0.5 ? "before" : "after";
  };
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    const drag = activePlaylistDrag();
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setZone(zoneAt(event, drag));
  };
  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node && event.currentTarget.contains(next))) setZone(null);
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    const drag = activePlaylistDrag();
    setZone(null);
    if (!drag) return;
    event.preventDefault();
    const target = zoneAt(event, drag);
    if (target === "into") onDropTracks(entry.id, drag);
    else onDropNewPlaylist(target, drag);
  };
  const muted = dragActive !== null && !acceptsTracks(dragActive);
  return (
    <RouteLink
      ref={setNodeRef}
      to={entry.path}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`sidebar-link sidebar-link--${iconsOnly ? "icons" : "full"} sidebar-playlist${active ? " is-active" : ""}${isDragging ? " is-dragging" : ""}${dragActive && zone ? dropZoneClass[zone] : ""}${muted ? " is-drop-muted" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={iconsOnly ? entry.name : undefined}
      aria-roledescription={attributes["aria-roledescription"]}
      aria-describedby={attributes["aria-describedby"]}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={(event) => {
        if (!entry.playlist && !entry.flow) return;
        event.preventDefault();
        onOpenMenu(entry, { x: event.clientX, y: event.clientY });
      }}
      onMouseEnter={onTooltip}
      onFocus={onTooltip}
      {...listeners}
    >
      <PlaylistArtworkThumb
        sizes="2rem"
        artworkUrl={artworkUrlFor(entry.id)}
        name={entry.name}
        className="sidebar-playlist__art"
      />
      {iconsOnly ? (
        <span className="sidebar-tooltip">{entry.name}</span>
      ) : (
        <span className="sidebar-player__copy">
          <span className="sidebar-player__title">{entry.name}</span>
          <span className="sidebar-player__subtitle">{entry.kind}</span>
        </span>
      )}
    </RouteLink>
  );
}

async function loadDraggedTracks(drag: PlaylistDrag, showError: (message: string) => void) {
  try {
    const tracks = await drag.load();
    if (tracks.length === 0) showError(`Nothing to add from ${drag.label}`);
    return tracks;
  } catch {
    showError(`Couldn't load ${drag.label}. Nothing was added.`);
    return [];
  }
}

function useDropTracks() {
  const { showError } = useToast();
  const { onBulkAddToPlaylist } = useTrackSaveActions();
  return async (playlistId: string, drag: PlaylistDrag) => {
    if (!onBulkAddToPlaylist) return;
    const tracks = await loadDraggedTracks(drag, showError);
    if (tracks.length) await onBulkAddToPlaylist(tracks, { playlistId });
  };
}

const PLAYLIST_APPEAR_TIMEOUT_MS = 30_000;

function playlistAppears(queryClient: QueryClient, playlistId: string) {
  const present = () =>
    queryClient
      .getQueryData<PlaylistStatus>(queryKeys.playlistStatus)
      ?.staticPlaylists.some((playlist) => playlist.id === playlistId) === true;
  return new Promise<boolean>((resolve) => {
    if (present()) return resolve(true);
    const stop = (found: boolean) => {
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(found);
    };
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (present()) stop(true);
    });
    const timeout = window.setTimeout(() => stop(false), PLAYLIST_APPEAR_TIMEOUT_MS);
    void queryClient.invalidateQueries({ queryKey: queryKeys.playlistStatus });
  });
}

function useDropNewPlaylist(
  playlists: PlaylistStatus["staticPlaylists"],
  saveOrder: (ids: string[]) => void,
) {
  const { showSuccess, showError } = useToast();
  const queryClient = useQueryClient();
  return async (drag: PlaylistDrag, orderWithNew: (playlistId: string) => string[]) => {
    const tracks = (await loadDraggedTracks(drag, showError))
      .map(normalizePlaylistTrackEntry)
      .filter((track) => track !== null);
    if (tracks.length === 0) return;
    const name = reserveUniquePlaylistName(playlists, drag.newPlaylistName ?? drag.label);
    try {
      const { playlistId } = await parseResponse(
        staticPlaylistsClient["static-playlists"].$post({ json: { name, tracks } }),
      );
      showSuccess(`Created ${name}`);
      // The server creates the playlist in its queue, and the saved order keeps
      // only playlists that exist, so the order waits until the new one shows up.
      if (playlistId && (await playlistAppears(queryClient, playlistId))) {
        saveOrder(orderWithNew(playlistId));
      }
    } catch (error) {
      showError(getApiErrorMessage(error, "Couldn't create the playlist. Nothing was added."));
    }
  };
}

function SidebarPlaylists({ status, iconsOnly, onTooltip }: SidebarPlaylistsProps) {
  const { order, isLoading, saveOrder } = usePlaylistOrder();
  const navigate = useNavigate();
  const { user } = useAuth();
  const dragActive = useActivePlaylistDrag();
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const dropTracks = useDropTracks();
  const dropNewPlaylist = useDropNewPlaylist(status?.staticPlaylists ?? [], saveOrder);
  if (!status || isLoading) return null;
  const entries = applyCustomOrder(
    [
      ...status.staticPlaylists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        kind: "Playlist",
        path: playlistPath(playlist.id),
        droppable: canAddTracksToPlaylist(playlist, user?.id),
        playlist,
      })),
      ...status.flows.map((flow) => ({
        id: flow.id,
        name: flow.name,
        kind: "Flow",
        path: flowPath(flow.id),
        droppable: false,
        flow,
      })),
    ],
    order,
  );

  if (entries.length === 0) return null;
  const menuEntry: Entry | undefined = menu
    ? entries.find((entry) => entry.id === menu.id)
    : undefined;

  return (
    <nav className="sidebar-playlists" aria-label="Your playlists">
      {iconsOnly ? null : (
        <div className="sidebar-playlists__head-row" data-library-menu-target>
          <RouteLink to="/library/playlists" className="sidebar-playlists__head">
            Playlists
          </RouteLink>
          <LibraryItemMenu
            label="Playlists"
            triggerLabel="Playlist options"
            triggerClassName="native-library-item-menu__trigger sidebar-playlists__menu"
            items={[
              {
                id: "new",
                label: "New playlist",
                icon: ListMusic,
                onSelect: () => navigate("/library/playlists", { state: { openCreate: true } }),
              },
              {
                id: "import",
                label: "Import playlist",
                icon: Upload,
                onSelect: () => navigate("/library/playlists", { state: { openImport: true } }),
              },
              ...(order.length > 0
                ? [
                    {
                      id: "reset",
                      label: "Reset order",
                      icon: RotateCcw,
                      onSelect: () => saveOrder([]),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}
      <SortableList
        ids={entries.map(({ id }) => id)}
        titleOf={(id) => entries.find((entry) => entry.id === id)?.name ?? "Playlist"}
        onReorder={saveOrder}
      >
        <div className="sidebar-playlists__list">
          {entries.map((entry, index) => (
            <SidebarPlaylistRow
              key={entry.id}
              entry={entry}
              iconsOnly={iconsOnly}
              onTooltip={onTooltip}
              dragActive={dragActive}
              onOpenMenu={(menuEntry, at) => setMenu({ id: menuEntry.id, at })}
              onDropTracks={(playlistId, drag) => void dropTracks(playlistId, drag)}
              onDropNewPlaylist={(where, drag) =>
                void dropNewPlaylist(drag, (playlistId) => {
                  const ids = entries.map(({ id }) => id);
                  ids.splice(where === "before" ? index : index + 1, 0, playlistId);
                  return ids;
                })
              }
            />
          ))}
        </div>
      </SortableList>
      <Suspense fallback={null}>
        {menuEntry?.playlist && menu ? (
          <SidebarStaticPlaylistMenu key={menu.id} playlist={menuEntry.playlist} at={menu.at} />
        ) : menuEntry?.flow && menu ? (
          <SidebarFlowMenu key={menu.id} flow={menuEntry.flow} at={menu.at} />
        ) : null}
      </Suspense>
    </nav>
  );
}

export default SidebarPlaylists;
