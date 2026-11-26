import { useSyncExternalStore, type DragEvent } from "react";
import type { ImportedTrack } from "./staticPlaylists.ts";
import { queryClient } from "../queryClient.ts";
import { browsePlaylistQueryOptions, playlistJobsQueryOptions } from "../queryOptions.ts";
import { getArtistPreview } from "./api/endpoints/artists.ts";
import { discoveryClient } from "./api/clients/discovery.ts";
import { parseResponse } from "hono/client";
import { buildStaticPlaylistTrackPayload } from "./staticPlaylists.ts";
import type { BrowseProvider } from "../../../lib/browsePlaylists.ts";
import { MBID_PATTERN } from "../../../lib/mbid.ts";

// Tracks dragged onto a sidebar playlist. The browser's own drag and drop
// carries only strings, so the loader stays here for the drop to call.
export type PlaylistDrag = {
  label: string;
  load: () => Promise<ImportedTrack[]> | ImportedTrack[];
  excludedPlaylistIds?: string[];
  newPlaylistName?: string;
};

let active: PlaylistDrag | null = null;
const listeners = new Set<() => void>();

function setActive(next: PlaylistDrag | null) {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener();
}

// A drag can end without a dragend on its source, when the source unmounts
// mid-drag, so any drop or dragend in the window ends it.
const endDrag = () => setActive(null);

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("drop", endDrag);
    window.addEventListener("dragend", endDrag);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("drop", endDrag);
      window.removeEventListener("dragend", endDrag);
    }
  };
}

export const activePlaylistDrag = () => active;

export const useActivePlaylistDrag = () =>
  useSyncExternalStore(subscribe, activePlaylistDrag, () => null);

function showDragLabel(event: DragEvent<HTMLElement>, label: string) {
  const ghost = document.createElement("div");
  ghost.className = "playlist-drag-ghost";
  ghost.textContent = label;
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, -12, -12);
  requestAnimationFrame(() => ghost.remove());
}

export function playlistDragProps(drag: PlaylistDrag | null | undefined) {
  if (!drag) return {};
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/plain", drag.label);
      showDragLabel(event, drag.label);
      // Changing the page inside dragstart can cancel the drag in Chrome.
      requestAnimationFrame(() => setActive(drag));
    },
    onDragEnd: endDrag,
  };
}

export const tracksLabel = (count: number) => `${count} ${count === 1 ? "track" : "tracks"}`;

export const combinedDrag = (label: string, drags: (PlaylistDrag | null | undefined)[]) => {
  const sources = drags.filter((drag) => drag != null);
  return sources.length
    ? {
        label,
        load: async () => (await Promise.all(sources.map((drag) => drag.load()))).flat(),
      }
    : null;
};

export const savedPlaylistDrag = (playlistId: string, name: string): PlaylistDrag => ({
  label: name,
  load: () => queryClient.fetchQuery(playlistJobsQueryOptions(playlistId)),
  excludedPlaylistIds: [playlistId],
});

export const browsePlaylistDrag = (
  userId: number | null | undefined,
  provider: BrowseProvider,
  playlistId: string,
  name: string,
): PlaylistDrag => ({
  label: name,
  load: async () =>
    (await queryClient.fetchQuery(browsePlaylistQueryOptions(userId, provider, playlistId))).tracks,
});

// An artist brings its popular tracks, loaded only when dropped.
export const artistDrag = (mbid: string, name: string): PlaylistDrag => ({
  label: name,
  load: async () =>
    ((await getArtistPreview(mbid, name)).tracks ?? []).map((track) =>
      buildStaticPlaylistTrackPayload({
        artistName: name,
        trackName: track.title,
        albumName: track.album || "",
        artistMbid: mbid,
        albumMbid: ("albumMbid" in track && track.albumMbid) || "",
        trackMbid: ("trackMbid" in track && track.trackMbid) || "",
        releaseYear: null,
        durationMs: track.duration_ms,
        reason: "Artist preview",
      }),
    ),
});

// Charts name artists and albums without MusicBrainz ids, so the drop looks
// them up the way their links do.
export const resolveCatalogIds = (query: { artist: string; album?: string }) =>
  parseResponse(discoveryClient.playlists.links.$get({ query }));

export const namedArtistDrag = (name: string): PlaylistDrag => ({
  label: name,
  load: async () => {
    const { artistMbid } = await resolveCatalogIds({ artist: name });
    return artistMbid ? artistDrag(artistMbid, name).load() : [];
  },
});

export const catalogArtistDrag = (
  mbid: string | null | undefined,
  name: string | null | undefined,
): PlaylistDrag | null =>
  name ? (mbid && MBID_PATTERN.test(mbid) ? artistDrag(mbid, name) : namedArtistDrag(name)) : null;
