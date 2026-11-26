import { DEFAULT_NEW_USER_FLOWS } from "../../../lib/flows.ts";
import { asAppError } from "../../../lib/errors.ts";
import { dbOps } from "../../db/helpers/index.ts";
import { hasPermission } from "../auth.ts";
import { isAnyDownloadSourceConfigured } from "../downloadSourceService.ts";
import { logger } from "../logger.ts";
import { flowPlaylistConfig } from "../playlists/flowPlaylistConfig.ts";
import { playlistManager } from "../playlists/playlistManager.ts";
import { buildFlowFromTemplate } from "./flowTemplates.ts";
import { queueFlowSideEffect } from "./flowMutations.ts";
import type { RequestUser } from "../../middleware/requestUser.ts";

export const newUserFlowTemplateIds = () =>
  dbOps.getSettings().security.defaultFlows ?? DEFAULT_NEW_USER_FLOWS;

// Gives a new account the flows an admin picked, turned on, so it has
// music waiting instead of an empty Flows page. Never blocks sign-up.
export async function startNewUserFlows(user: RequestUser | null) {
  if (!user || !hasPermission(user, "accessPlaylists")) return;
  for (const templateId of newUserFlowTemplateIds()) {
    try {
      const flow = flowPlaylistConfig.createFlow({
        ...buildFlowFromTemplate(user, templateId),
        autoDownload: isAnyDownloadSourceConfigured(),
        ownerUserId: user.id,
      });
      flowPlaylistConfig.setEnabled(flow.id, true);
      flowPlaylistConfig.scheduleNextRun(flow.id);
      await playlistManager.ensurePlaylistArtwork(flow.id);
      playlistManager.requestPlaylistSync([flow.id]);
      queueFlowSideEffect("enable-flow-refresh", "enable", flow.id);
    } catch (error) {
      logger.warn("flows", `Could not start ${templateId} for new user ${user.username}`, {
        message: asAppError(error)?.message,
      });
    }
  }
}
