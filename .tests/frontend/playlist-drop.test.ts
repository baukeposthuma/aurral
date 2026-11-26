import { test } from "vite-plus/test";
import assert from "node:assert/strict";

import { canAddTracksToPlaylist } from "../../frontend/src/utils/staticPlaylists.ts";

test("tracks drop only on playlists the user owns or collaborates on and that don't sync", () => {
  const mine = { ownerUserId: 2, members: [], importSource: null };
  const cases: [string, Parameters<typeof canAddTracksToPlaylist>[0], boolean][] = [
    ["own playlist", mine, true],
    ["collaborator", { ownerUserId: 1, members: [{ id: 2 }], importSource: null }, true],
    ["someone else's", { ownerUserId: 1, members: [{ id: 3 }], importSource: null }, false],
    ["synced from Spotify", { ...mine, importSource: { syncEnabled: true } }, false],
    ["imported once", { ...mine, importSource: { syncEnabled: false } }, true],
  ];
  for (const [name, playlist, expected] of cases) {
    assert.equal(canAddTracksToPlaylist(playlist, 2), expected, name);
  }
  assert.equal(canAddTracksToPlaylist(mine, null), false, "signed out");
});
