import { asAppError } from "../../../lib/errors.ts";
import { logger } from "../logger.ts";
import { playlistOperationQueue } from "../playlists/playlistOperationQueue.ts";
import {
  createPlaylistOperationToken,
  getLatestPlaylistOperationToken,
  markLatestPlaylistOperationToken,
  restorePlaylistOperationToken,
} from "../playlists/playlistOperations.ts";

export const markFlowMutationToken = (flowId: string) => {
  const tokenScope = `flow:${flowId}:mutation`;
  const previousToken = getLatestPlaylistOperationToken(tokenScope);
  const token = createPlaylistOperationToken();
  markLatestPlaylistOperationToken(tokenScope, token);
  return { token, tokenScope, previousToken };
};

type FlowMutation = ReturnType<typeof markFlowMutationToken>;

export const isFlowMutationTokenCurrent = (mutation: FlowMutation) =>
  Boolean(mutation?.token) &&
  getLatestPlaylistOperationToken(mutation.tokenScope) === mutation.token;

export const restoreFlowMutationToken = (mutation: FlowMutation) =>
  restorePlaylistOperationToken({
    scope: mutation?.tokenScope,
    token: mutation?.token,
    previousToken: mutation?.previousToken,
  });

export const queueFlowSideEffect = (kind: string, labelPrefix: string, flowId: string) => {
  const mutation = markFlowMutationToken(flowId);
  const { token, tokenScope } = mutation;
  playlistOperationQueue
    .enqueuePayload({
      kind,
      label: `${labelPrefix}:${flowId}`,
      flowId,
      tokenScope,
      token,
    })
    .catch((error) => {
      restoreFlowMutationToken(mutation);
      logger.error("flows", `Failed to ${labelPrefix} flow ${flowId}:`, {
        message: asAppError(error)?.message,
      });
    });
};
