export const DOWNLOAD_CONCURRENCY = { min: 1, default: 3, max: 8 } as const;

// Soulseek bans an account for 30 minutes after about 34 searches in 220
// seconds. Above this, a Soulseek-only setup mostly queues more searches.
export const SOULSEEK_ONLY_CONCURRENCY = 3;

export const clampDownloadConcurrency = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DOWNLOAD_CONCURRENCY.default;
  return Math.min(DOWNLOAD_CONCURRENCY.max, Math.max(DOWNLOAD_CONCURRENCY.min, Math.floor(parsed)));
};
