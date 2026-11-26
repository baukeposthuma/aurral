import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { playlistWorkerClient } from "../../../../utils/api/clients/playlistWorker.ts";
import { parseResponse } from "hono/client";
import { queryClient, queryKeys } from "../../../../queryClient.ts";
import { SettingsGroup, SettingsNote, SettingsRow } from "../../SettingsLayout";
import {
  DOWNLOAD_CONCURRENCY,
  SOULSEEK_ONLY_CONCURRENCY,
} from "../../../../../../lib/downloadConcurrency.ts";

export function ParallelDownloadsGroup({ soulseekOnly }: { soulseekOnly: boolean }) {
  const { data } = useQuery({
    queryKey: queryKeys.workerSettings,
    queryFn: () => parseResponse(playlistWorkerClient.worker.settings.$get()),
  });
  const saved = data?.concurrency ?? DOWNLOAD_CONCURRENCY.default;
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? saved;
  const save = useMutation({
    mutationFn: (concurrency: number) =>
      parseResponse(playlistWorkerClient.worker.settings.$put({ json: { concurrency } })),
    onSuccess: ({ settings }) => queryClient.setQueryData(queryKeys.workerSettings, settings),
    onSettled: (_, __, sent) => setDraft((current) => (current === sent ? null : current)),
  });
  const commit = () => {
    if (draft === null) return;
    if (draft === saved) setDraft(null);
    else save.mutate(draft);
  };

  return (
    <SettingsGroup title="Parallel downloads">
      <SettingsRow
        label="Downloads at once"
        htmlFor="parallel-downloads"
        help={`How many songs and albums Aurral searches and downloads at the same time. Default ${DOWNLOAD_CONCURRENCY.default}.`}
      >
        <div className="downloads-parallel">
          <input
            id="parallel-downloads"
            type="range"
            min={DOWNLOAD_CONCURRENCY.min}
            max={DOWNLOAD_CONCURRENCY.max}
            step={1}
            value={value}
            disabled={!data}
            onChange={(event) => setDraft(Number(event.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
            className="downloads-parallel__slider"
          />
          <output htmlFor="parallel-downloads" className="downloads-parallel__value">
            {value}
          </output>
        </div>
      </SettingsRow>
      {soulseekOnly && value > SOULSEEK_ONLY_CONCURRENCY ? (
        <SettingsNote tone="warning">
          With only Soulseek, more than {SOULSEEK_ONLY_CONCURRENCY} mostly queues extra searches.
          Soulseek limits how often you can search, so downloads won&apos;t get much faster.
        </SettingsNote>
      ) : soulseekOnly ? (
        <SettingsNote>
          Using Usenet, Tidarr, deemix, or qBittorrent? Those can handle more downloads at once.
        </SettingsNote>
      ) : null}
      {save.isError ? (
        <SettingsNote tone="error">Couldn&apos;t save. Try again.</SettingsNote>
      ) : null}
    </SettingsGroup>
  );
}
