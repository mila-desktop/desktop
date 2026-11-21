import {
  buildMetaTags,
  buildPrimaryVoiceOption,
  ensureShikimoriArtwork,
  findVoiceOptions,
  getCachedAnimePageExtras,
  getCachedArtwork,
  loadAnimePageExtras,
  loadFranchiseSeasons,
  resolvePlayableRelease,
  resolveVoiceTrackRelease,
  type AnimePageExtras,
  type AnimeSeasonEntry,
  type PlayableRelease,
  type ShikiArtwork,
  type WatchTarget
} from '../api/anime';
import { getWailsMilaBridge } from '../api/bridge';
import { fetchAniSkipTimes, hasSkipInterval, mergeEpisodeSkipFallback } from '../api/aniskip';
import { NextEpisodePrefetcher } from './prefetch';
import { createLazyModuleLoader } from '../api/providers/lazy';
import type { TorrentSearchItem } from '../api/providers/torrent';
import { settingsState } from './settings.svelte';

const torrentLoader = createLazyModuleLoader(() => import('../api/providers/torrent'));
import type { VoiceTrackOption } from '../marlakit/player/types';
import { flushHistoryPersistence, recordHistoryEntry } from './history.svelte';
import { t } from './i18n.svelte';
import {
  installMediaSessionHandlers,
  setMediaSessionPlaybackState,
  updateNowPlaying,
  updateNowPlayingPosition
} from './mediaSession';
import {
  createDebouncedStorageWriter,
  registerBeforeCloseFlush,
  safeStorageSet,
  setBoundedMapEntry
} from './lifecycle';
import {
  navigate,
  onRouteRestore,
  router,
  updateCurrentRouteParams,
  type RouteParams
} from './router.svelte';

export type PipCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

const PIP_CORNER_STORAGE_KEY = 'mila.player.pipCorner';
const DUB_OFFSET_STORAGE_PREFIX = 'mila.player.dubOffset:';

const MAX_TORRENT_RELEASE_CACHE = 20;
const MAX_VOICE_RELEASE_CACHE = 24;

const dubOffsetWriter = createDebouncedStorageWriter<{ key: string; value: string }>(
  250,
  ({ key, value }) => safeStorageSet(key, value)
);

function readSavedDubOffset(releaseAlias: string, dubId: string): number {
  if (typeof localStorage === 'undefined' || !dubId) return 0;
  try {
    const raw = Number(localStorage.getItem(`${DUB_OFFSET_STORAGE_PREFIX}${releaseAlias}:${dubId}`));
    return Number.isFinite(raw) ? Math.max(-5, Math.min(5, raw)) : 0;
  } catch {
    return 0;
  }
}

function saveDubOffset(releaseAlias: string, dubId: string, sec: number): void {
  if (typeof localStorage === 'undefined' || !dubId) return;
  dubOffsetWriter.schedule({
    key: `${DUB_OFFSET_STORAGE_PREFIX}${releaseAlias}:${dubId}`,
    value: String(sec)
  });
}

registerBeforeCloseFlush(() => dubOffsetWriter.flush());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => dubOffsetWriter.flush());
  window.addEventListener('pagehide', () => dubOffsetWriter.flush());
}

function readSavedPipCorner(): PipCorner {
  if (typeof localStorage === 'undefined') return 'bottom-right';
  const raw = localStorage.getItem(PIP_CORNER_STORAGE_KEY);
  if (raw === 'bottom-right' || raw === 'bottom-left' || raw === 'top-right' || raw === 'top-left') {
    return raw;
  }
  return 'bottom-right';
}

export const player = $state<{
  loading: boolean;
  error: string;
  title: string;
  target: WatchTarget | null;
  shikiArt: ShikiArtwork | null;
  release: PlayableRelease | null;
  seasons: AnimeSeasonEntry[];
  voices: VoiceTrackOption[];
  selectedVoiceId: string;
  dubRelease: PlayableRelease | null;
  dubVoiceId: string;
  dubOffsetSec: number;
  episodeIndex: number;
  resumeTime: number;
  liveTime: number;
  liveDuration: number;
  autoplay: boolean;
  isPlaying: boolean;
  pipMode: boolean;
  pipManual: boolean;
  pipDismissed: boolean;
  pipCorner: PipCorner;
  extras: AnimePageExtras | null;
  extrasLoading: boolean;
  inlineStageEl: HTMLElement | null;
  wtChatOpen: boolean;
  wtChatUnread: number;
  wtChatToggle: (() => void) | null;
  wtControlsLocked: boolean;
}>({
  loading: false,
  error: '',
  title: '',
  target: null,
  shikiArt: null,
  release: null,
  seasons: [],
  voices: [],
  selectedVoiceId: '',
  dubRelease: null,
  dubVoiceId: '',
  dubOffsetSec: 0,
  episodeIndex: 0,
  resumeTime: 0,
  liveTime: 0,
  liveDuration: 0,
  autoplay: false,
  isPlaying: false,
  pipMode: false,
  pipManual: false,
  pipDismissed: false,
  pipCorner: readSavedPipCorner(),
  extras: null,
  extrasLoading: false,
  inlineStageEl: null,
  wtChatOpen: true,
  wtChatUnread: 0,
  wtChatToggle: null,
  wtControlsLocked: false
});

let activeRequestToken = 0;
let dubRequestToken = 0;
let extrasRequestToken = 0;
let lastLoadedExtrasShikiId = 0;
let lastHistorySyncMs = 0;
let voiceDiscoveryPromise: Promise<VoiceTrackOption[]> | null = null;
let playControlCallback: (() => void) | null = null;
let pauseControlCallback: (() => void) | null = null;
let seekControlCallback: ((seconds: number) => void) | null = null;
let syncStateCallback: ((paused: boolean, positionSec?: number, rate?: number) => void) | null = null;
let playbackSnapshotGetter: (() => { currentTime: number; duration: number; paused: boolean; playbackRate: number; ready: boolean } | null) | null = null;
let wtLocalPlaybackListener: ((ev: { kind: 'play' | 'pause' | 'seek' | 'rate'; currentTime: number; duration: number; paused: boolean; playbackRate: number }) => void) | null = null;
const failedVoiceIds = new Set<string>();
const torrentReleaseCache = new Map<string, PlayableRelease>();
const voiceReleaseCache = new Map<string, PlayableRelease>();

function resolveCurrentMalId(): number {
  return player.shikiArt?.id || player.target?.shikiId || 0;
}

async function applyEpisodeSkipByOrdinal(
  malId: number,
  episodeOrdinal: number,
  signal?: AbortSignal
): Promise<void> {
  if (!malId || malId <= 0 || episodeOrdinal <= 0) return;
  const rel = player.release;
  if (!rel) return;
  const idx = rel.episodes.findIndex((e) => e.ordinal === episodeOrdinal);
  if (idx < 0) return;
  const targetEp = rel.episodes[idx];
  if (hasSkipInterval(targetEp.opening) && hasSkipInterval(targetEp.ending)) return;

  const skip = await fetchAniSkipTimes(malId, episodeOrdinal, signal);
  if (!skip || !skip.found || signal?.aborted) return;

  const activeRel = player.release;
  if (!activeRel || activeRel.alias !== rel.alias) return;
  const activeIdx = activeRel.episodes.findIndex((e) => e.ordinal === episodeOrdinal);
  if (activeIdx < 0) return;
  const current = activeRel.episodes[activeIdx];
  const merged = mergeEpisodeSkipFallback(current, skip);
  if (merged === current) return;
  current.opening = merged.opening;
  current.ending = merged.ending;
}

function ensureCurrentEpisodeSkipFallback(): void {
  const rel = player.release;
  const malId = resolveCurrentMalId();
  if (!rel || !malId) return;
  const ep = rel.episodes[player.episodeIndex];
  if (!ep) return;
  if (hasSkipInterval(ep.opening) && hasSkipInterval(ep.ending)) return;
  void applyEpisodeSkipByOrdinal(malId, ep.ordinal);
}

const episodePrefetcher = new NextEpisodePrefetcher({
  onAniSkipPrefetch: (malId, episodeOrdinal, signal) =>
    applyEpisodeSkipByOrdinal(malId, episodeOrdinal, signal)
});

// OS media keys / lock-screen controls are wired once per session; handlers stay dumb.
installMediaSessionHandlers({
  play: () => playControlCallback?.(),
  pause: () => pauseControlCallback?.(),
  next: () => nextEpisode(),
  previous: () => prevEpisode(),
  seek: (seconds) => seekControlCallback?.(seconds)
});

function syncPlayerHistory(currentTime?: number, duration?: number): void {
  const rel = player.release;
  const art = player.shikiArt;
  const target = player.target;
  if (!rel && !target) return;

  const ep = rel?.episodes[player.episodeIndex];
  const episodeOrdinal = ep?.ordinal ?? player.episodeIndex + 1;
  const title = art?.english || art?.name || rel?.title || player.title || target?.title || '';
  if (!title) return;

  const poster = art?.posterOriginal || art?.posterMain || rel?.poster || '';
  const tags = buildMetaTags(art ?? undefined);
  const score = art?.score && art.score > 0 ? Number(art.score.toFixed(1)) : undefined;

  recordHistoryEntry({
    shikiId: art?.id ?? target?.shikiId,
    releaseAlias: rel?.alias ?? target?.releaseAlias,
    searchQueries: target?.searchQueries,
    title,
    description: art?.description?.trim() || '',
    poster,
    score,
    tags,
    episodeOrdinal,
    episodeIndex: player.episodeIndex,
    totalEpisodes: rel?.episodes.length,
    currentTime,
    duration: duration && duration > 0 ? duration : ep?.duration
  });
}

export function reportPlaybackProgress(currentTime: number, duration: number, force = false): void {
  if (Number.isFinite(currentTime) && currentTime >= 0) {
    player.liveTime = currentTime;
  }
  if (Number.isFinite(duration) && duration > 0) {
    player.liveDuration = duration;
  }
  if (settingsState.prefetchNextEpisode) {
    episodePrefetcher.maybePrefetch({
      release: player.release,
      episodeIndex: player.episodeIndex,
      currentTime,
      duration,
      dubRelease: player.dubRelease,
      dubVoiceId: player.dubVoiceId,
      malId: resolveCurrentMalId()
    });
  }

  const now = Date.now();
  if (!force && now - lastHistorySyncMs < 3000) return;
  lastHistorySyncMs = now;
  syncPlayerHistory(currentTime, duration);
  syncNowPlaying();
  updateNowPlayingPosition(currentTime, duration);
  if (force) {
    flushHistoryPersistence();
  }
}

function syncNowPlaying(): void {
  const rel = player.release;
  const art = player.shikiArt;
  const title = art?.english || art?.name || rel?.title || player.title || player.target?.title || '';
  if (!rel || !title) {
    updateNowPlaying(null);
    return;
  }

  const ep = rel.episodes[player.episodeIndex];
  const episodeOrdinal = ep?.ordinal ?? player.episodeIndex + 1;
  const releaseTitle = rel.title?.trim() || '';

  updateNowPlaying({
    title,
    artist: t('player.episode', { n: episodeOrdinal }),
    album: releaseTitle && releaseTitle !== title ? releaseTitle : undefined,
    artwork: art?.posterOriginal || art?.posterMain || rel.poster || ''
  });
}

function applyPreservedEpisode(
  rel: PlayableRelease,
  preserveEpisodeOrdinal?: number,
  preserveEpisodeIndex?: number
): number {
  if (preserveEpisodeOrdinal != null) {
    const idx = rel.episodes.findIndex((e) => e.ordinal === preserveEpisodeOrdinal);
    if (idx >= 0) return idx;
  }
  if (preserveEpisodeIndex != null) {
    return Math.min(preserveEpisodeIndex, Math.max(0, rel.episodes.length - 1));
  }
  return 0;
}

function refreshAnimeExtras(shikiId?: number): void {
  const id = shikiId && shikiId > 0 ? shikiId : 0;
  if (!id) {
    lastLoadedExtrasShikiId = 0;
    extrasRequestToken += 1;
    player.extras = null;
    player.extrasLoading = false;
    return;
  }
  if (lastLoadedExtrasShikiId === id && player.extras?.shikiId === id) {
    return;
  }
  lastLoadedExtrasShikiId = id;
  const cached = getCachedAnimePageExtras(id);
  if (cached) {
    player.extras = cached;
    player.extrasLoading = false;
    return;
  }

  const token = ++extrasRequestToken;
  player.extras = null;
  player.extrasLoading = true;
  loadAnimePageExtras(id)
    .then((extras) => {
      if (token !== extrasRequestToken) return;
      player.extras = extras;
    })
    .catch(() => {
      if (token === extrasRequestToken) {
        player.extras = { shikiId: id, videos: [], related: [], characters: [], similar: [] };
      }
    })
    .finally(() => {
      if (token === extrasRequestToken) {
        player.extrasLoading = false;
      }
    });
}

async function loadTargetIntoPlayer(
  token: number,
  target: WatchTarget,
  opts?: {
    preserveEpisodeOrdinal?: number;
    preserveEpisodeIndex?: number;
    preserveTime?: number;
    keepVoices?: boolean;
    autoplay?: boolean;
  }
): Promise<PlayableRelease | null> {
  episodePrefetcher.reset();
  player.loading = true;
  player.error = '';
  player.title = target.title;
  player.target = target;
  player.shikiArt = target.shikiId ? getCachedArtwork(target.shikiId) ?? null : null;
  refreshAnimeExtras(target.shikiId);
  player.release = null;
  if (!opts?.keepVoices) {
    player.voices = [];
    player.selectedVoiceId = '';
    player.dubRelease = null;
    player.dubVoiceId = '';
    player.dubOffsetSec = 0;
    voiceDiscoveryPromise = null;
    failedVoiceIds.clear();
  }
  player.episodeIndex = opts?.preserveEpisodeIndex ?? 0;
  player.resumeTime = opts?.preserveTime ?? 0;
  player.autoplay = Boolean(opts?.autoplay);

  if (target.shikiId && !player.shikiArt) {
    ensureShikimoriArtwork([target.shikiId])
      .then((map) => {
        if (token !== activeRequestToken) return;
        const art = map.get(target.shikiId!);
        if (art) {
          player.shikiArt = art;
          syncNowPlaying();
          refreshAnimeExtras(art.id);
          if (player.release) {
            syncPlayerHistory();
            ensureCurrentEpisodeSkipFallback();
          }
        }
      })
      .catch(() => {});
  }

  try {
    const rel = await resolvePlayableRelease(target);
    if (token !== activeRequestToken) return null;
    player.release = rel;
    player.title = player.shikiArt?.english || player.shikiArt?.name || rel.title || target.title;
    player.selectedVoiceId = rel.alias;
    setBoundedMapEntry(voiceReleaseCache, rel.alias, rel, MAX_VOICE_RELEASE_CACHE);
    if (!opts?.keepVoices || player.voices.length === 0) {
      player.voices = [buildPrimaryVoiceOption(rel)];
      const extraTitles = [target.title, ...(target.searchQueries ?? [])];
      const discovery = findVoiceOptions(rel, target.shikiId, extraTitles)
        .then((voices) => {
          if (token === activeRequestToken && voices.length > 0) {
            player.voices = voices;
          }
          return voices;
        })
        .catch(() => player.voices);
      voiceDiscoveryPromise = discovery;
    }

    player.episodeIndex = applyPreservedEpisode(
      rel,
      opts?.preserveEpisodeOrdinal,
      opts?.preserveEpisodeIndex
    );

    const activeEp = rel.episodes[player.episodeIndex];
    if (router.current === 'anime') {
      updateCurrentRouteParams({
        shikiId: player.shikiArt?.id ?? target.shikiId,
        alias: rel.alias,
        title: player.title,
        searchQueries: target.searchQueries,
        episode: player.episodeIndex,
        episodeOrdinal: activeEp?.ordinal
      });
    }
    syncPlayerHistory(player.resumeTime, activeEp?.duration ?? 0);
    lastHistorySyncMs = Date.now();
    ensureCurrentEpisodeSkipFallback();
    return rel;
  } catch (err) {
    if (token !== activeRequestToken) return null;
    player.error = err instanceof Error ? err.message : 'Failed to load stream';
    return null;
  } finally {
    if (token === activeRequestToken) {
      player.loading = false;
    }
  }
}

export async function switchVoice(voice: VoiceTrackOption, preserveTime = 0): Promise<void> {
  if (voice.id === player.selectedVoiceId) return;
  const currentEp = player.release?.episodes[player.episodeIndex];
  const prevOrdinal = currentEp?.ordinal;
  const prevIndex = player.episodeIndex;
  const baseRelease = player.release;
  const baseTarget: WatchTarget = player.target ?? {
    title: player.title,
    shikiId: player.shikiArt?.id
  };
  const token = ++activeRequestToken;
  episodePrefetcher.reset();

  player.loading = true;
  player.error = '';
  player.resumeTime = Number.isFinite(preserveTime) && preserveTime > 0.5 ? preserveTime : 0;
  player.autoplay = player.isPlaying || player.autoplay;

  try {
    const cachedRelease =
      voice.provider === 'torrent'
        ? torrentReleaseCache.get(voice.id)
        : voiceReleaseCache.get(voice.id);
    const nextRel =
      cachedRelease ?? (await resolveVoiceTrackRelease(voice, baseRelease, baseTarget));
    if (token !== activeRequestToken) return;
    setBoundedMapEntry(voiceReleaseCache, voice.id, nextRel, MAX_VOICE_RELEASE_CACHE);
    setBoundedMapEntry(voiceReleaseCache, nextRel.alias, nextRel, MAX_VOICE_RELEASE_CACHE);
    player.release = nextRel;
    player.selectedVoiceId = voice.id;
    if (player.dubVoiceId === voice.id) {
      player.dubVoiceId = '';
      player.dubRelease = null;
      player.dubOffsetSec = 0;
    } else if (player.dubVoiceId) {
      player.dubOffsetSec = readSavedDubOffset(nextRel.alias, player.dubVoiceId);
    }
    player.episodeIndex = applyPreservedEpisode(nextRel, prevOrdinal, prevIndex);
    ensureCurrentEpisodeSkipFallback();
  } catch (err) {
    if (token !== activeRequestToken) return;
    if (baseRelease && baseRelease.episodes.length > 0) {
      player.release = baseRelease;
    } else {
      player.error = err instanceof Error ? err.message : 'Failed to switch voiceover';
    }
  } finally {
    if (token === activeRequestToken) {
      player.loading = false;
    }
  }
}

export async function openTorrentStream(
  magnetOrItem: string | TorrentSearchItem,
  opts?: { preserveTime?: number }
): Promise<void> {
  const magnet = typeof magnetOrItem === 'string' ? magnetOrItem : magnetOrItem.magnet;
  const label =
    typeof magnetOrItem === 'string'
      ? 'Torrent 1080p'
      : `Torrent · ${magnetOrItem.quality || '1080p'}`;
  const currentEp = player.release?.episodes[player.episodeIndex];
  const prevOrdinal = currentEp?.ordinal;
  const prevIndex = player.episodeIndex;
  const baseRelease = player.release;
  const shikiArt = player.shikiArt;
  const token = ++activeRequestToken;
  episodePrefetcher.reset();

  player.loading = true;
  player.error = '';
  player.resumeTime = opts?.preserveTime ?? 0;
  player.autoplay = true;

  try {
    const { openTorrentMagnet } = await torrentLoader.load();
    const info = await openTorrentMagnet(magnet);
    if (token !== activeRequestToken) return;

    const voiceId = `torrent:${info.infoHash}`;
    const episodes = info.files.map((f) => ({
      id: `${voiceId}:${f.fileIndex}`,
      ordinal: f.ordinal,
      name: `Episode ${f.ordinal}`,
      duration: 0,
      preview: baseRelease?.episodes.find((ep) => ep.ordinal === f.ordinal)?.preview,
      opening: baseRelease?.episodes.find((ep) => ep.ordinal === f.ordinal)?.opening,
      ending: baseRelease?.episodes.find((ep) => ep.ordinal === f.ordinal)?.ending,
      remux: {
        hash: info.infoHash,
        fileIndex: f.fileIndex,
        needsRemux:
          settingsState.torrentRemuxMode === 'always'
            ? true
            : settingsState.torrentRemuxMode === 'direct'
              ? false
              : f.needsRemux,
        label: typeof magnetOrItem === 'string' ? 'BDRip 1080p' : magnetOrItem.quality || '1080p'
      }
    }));

    const torrentRel: PlayableRelease = {
      id: -1,
      alias: voiceId,
      title: shikiArt?.english || shikiArt?.name || baseRelease?.title || info.name || player.title,
      titleEnglish: shikiArt?.english || shikiArt?.name,
      year: shikiArt?.year ?? baseRelease?.year,
      provider: 'torrent',
      voiceLabel: label,
      poster: shikiArt?.posterOriginal || shikiArt?.posterMain || baseRelease?.poster,
      banner: shikiArt?.screenshots?.[0] || baseRelease?.banner,
      episodes
    };

    setBoundedMapEntry(torrentReleaseCache, voiceId, torrentRel, MAX_TORRENT_RELEASE_CACHE);
    const torrentVoice: VoiceTrackOption = {
      id: voiceId,
      label,
      sublabel: `${episodes.length} ep · ${info.files.some((f) => f.needsRemux) ? 'MKV Remux' : 'MP4 Direct'}`,
      provider: 'torrent',
      sourceId: info.infoHash,
      kind: 'mp4'
    };
    if (!player.voices.some((v) => v.id === voiceId)) {
      player.voices = [torrentVoice, ...player.voices];
    }

    player.release = torrentRel;
    player.selectedVoiceId = voiceId;
    player.dubVoiceId = '';
    player.dubRelease = null;
    player.dubOffsetSec = 0;
    player.episodeIndex = applyPreservedEpisode(torrentRel, prevOrdinal, prevIndex);
    ensureCurrentEpisodeSkipFallback();
  } catch (err) {
    if (token !== activeRequestToken) return;
    player.error = err instanceof Error ? err.message : 'Failed to open torrent stream';
  } finally {
    if (token === activeRequestToken) {
      player.loading = false;
    }
  }
}

export async function selectDubVoice(voice: VoiceTrackOption | null): Promise<void> {
  const myDubToken = ++dubRequestToken;
  episodePrefetcher.reset();
  if (!voice) {
    player.dubVoiceId = '';
    player.dubRelease = null;
    player.dubOffsetSec = 0;
    return;
  }
  const baseRelease = player.release;
  const baseTarget: WatchTarget = player.target ?? {
    title: player.title,
    shikiId: player.shikiArt?.id
  };
  const token = activeRequestToken;
  try {
    const dubRel = await resolveVoiceTrackRelease(voice, baseRelease, baseTarget);
    if (token !== activeRequestToken || myDubToken !== dubRequestToken) return;
    player.dubVoiceId = voice.id;
    player.dubRelease = dubRel;
    player.dubOffsetSec = readSavedDubOffset(baseRelease?.alias ?? '', voice.id);
  } catch (err) {
    if (token !== activeRequestToken || myDubToken !== dubRequestToken) return;
    player.error = err instanceof Error ? err.message : 'Failed to attach dub audio stream';
  }
}

export function setDubAudioOffset(sec: number): void {
  const rounded = Math.max(-5, Math.min(5, Math.round(sec * 10) / 10));
  player.dubOffsetSec = rounded;
  if (player.dubVoiceId) {
    saveDubOffset(player.release?.alias ?? '', player.dubVoiceId, rounded);
  }
}

export async function fallbackVoice(autoFromFailure = false): Promise<boolean> {
  const activeId = player.selectedVoiceId;
  const activeProvider = player.release?.provider ?? 'aniliberty';
  if (activeId) {
    failedVoiceIds.add(activeId);
  }

  const startToken = activeRequestToken;
  if (voiceDiscoveryPromise) {
    await voiceDiscoveryPromise.catch(() => {});
  }
  if (startToken !== activeRequestToken) return false;

  const candidates = player.voices.filter((v) => {
    if (v.id === activeId || failedVoiceIds.has(v.id)) return false;
    if (autoFromFailure && activeProvider === 'aniliberty' && v.provider === 'aniliberty') {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) return false;

  // Prefer native Dream Cast 1080p HLS, then native AnimeVost MP4, then any remaining internal source.
  const chosen =
    candidates.find((v) => v.provider === 'dreamcast') ??
    candidates.find((v) => v.provider === 'animevost') ??
    candidates[0];

  await switchVoice(chosen, player.resumeTime);
  return player.selectedVoiceId === chosen.id;
}

export async function openWatch(
  target: WatchTarget,
  opts?: {
    episodeOrdinal?: number;
    episodeIndex?: number;
    resumeTime?: number;
    autoPlay?: boolean;
    directPlayer?: boolean;
    targetPage?: 'anime' | 'player' | 'watch-together-player';
  }
): Promise<void> {
  const token = ++activeRequestToken;
  const shouldAutoPlay = opts?.autoPlay !== undefined ? Boolean(opts.autoPlay) : settingsState.autoPlayOnOpen;
  player.seasons = [];
  player.pipMode = false;
  player.pipManual = false;
  player.pipDismissed = false;
  navigate({
    page: opts?.targetPage ?? (opts?.directPlayer ? 'player' : 'anime'),
    shikiId: target.shikiId,
    alias: target.releaseAlias,
    title: target.title,
    searchQueries: target.searchQueries,
    autoPlay: shouldAutoPlay,
    episode: opts?.episodeIndex,
    episodeOrdinal: opts?.episodeOrdinal,
    resumeTime: opts?.resumeTime
  });

  const rel = await loadTargetIntoPlayer(token, target, {
    preserveEpisodeOrdinal: opts?.episodeOrdinal,
    preserveEpisodeIndex: opts?.episodeIndex,
    preserveTime: opts?.resumeTime,
    autoplay: shouldAutoPlay
  });
  if (!rel || token !== activeRequestToken) return;

  loadFranchiseSeasons(rel.id)
    .then((seasons) => {
      if (token === activeRequestToken) {
        player.seasons = seasons;
      }
    })
    .catch(() => {});
}

export function openAnimePlayer(opts?: { episodeIndex?: number; episodeOrdinal?: number }): void {
  const rel = player.release;
  const target = player.target;
  if (!rel && !target) return;

  if (rel && opts?.episodeIndex != null && opts.episodeIndex >= 0 && opts.episodeIndex < rel.episodes.length) {
    player.episodeIndex = opts.episodeIndex;
    player.resumeTime = 0;
  } else if (rel && opts?.episodeOrdinal != null) {
    const idx = rel.episodes.findIndex((e) => e.ordinal === opts.episodeOrdinal);
    if (idx >= 0) {
      player.episodeIndex = idx;
      player.resumeTime = 0;
    }
  }

  player.autoplay = settingsState.autoPlayOnOpen;
  player.pipMode = false;
  player.pipManual = false;
  player.pipDismissed = false;

  const ep = rel?.episodes[player.episodeIndex];
  navigate({
    page: 'player',
    shikiId: player.shikiArt?.id ?? target?.shikiId,
    alias: rel?.alias ?? target?.releaseAlias,
    title: player.shikiArt?.english || player.shikiArt?.name || rel?.title || target?.title || player.title,
    searchQueries: target?.searchQueries,
    autoPlay: settingsState.autoPlayOnOpen,
    episode: player.episodeIndex,
    episodeOrdinal: opts?.episodeOrdinal ?? ep?.ordinal,
    resumeTime: player.resumeTime
  });
}

export async function switchSeason(season: AnimeSeasonEntry): Promise<void> {
  if (player.release && (player.release.id === season.id || player.release.alias === season.alias)) {
    return;
  }
  const token = ++activeRequestToken;
  const target: WatchTarget = {
    title: season.titleEnglish || season.title,
    shikiId: season.shikiId,
    releaseAlias: season.alias,
    searchQueries: [season.titleEnglish ?? '', season.title].filter(Boolean)
  };
  navigate({
    page: 'anime',
    shikiId: target.shikiId,
    alias: target.releaseAlias,
    title: target.title,
    searchQueries: target.searchQueries,
    autoPlay: false,
    episode: 0
  });
  const rel = await loadTargetIntoPlayer(token, target, { autoplay: false });
  if (rel && token === activeRequestToken && player.seasons.length === 0) {
    loadFranchiseSeasons(rel.id)
      .then((seasons) => {
        if (token === activeRequestToken) {
          player.seasons = seasons;
        }
      })
      .catch(() => {});
  }
}

async function restoreRouteTarget(params: RouteParams): Promise<void> {
  const shouldAutoPlay = Boolean(params.autoPlay);
  const matchesCurrentRelease = Boolean(
    player.release &&
      ((params.alias && player.release.alias === params.alias) ||
        (!params.alias &&
          params.shikiId &&
          (player.shikiArt?.id === params.shikiId || player.target?.shikiId === params.shikiId)))
  );

  if (matchesCurrentRelease && player.release) {
    player.autoplay = shouldAutoPlay;
    const nextIdx = applyPreservedEpisode(
      player.release,
      params.episodeOrdinal,
      params.episode ?? player.episodeIndex
    );
    if (nextIdx !== player.episodeIndex) {
      episodePrefetcher.reset();
      player.episodeIndex = nextIdx;
      ensureCurrentEpisodeSkipFallback();
    }
    return;
  }

  const title = params.title || params.alias || player.title || 'Anime';
  const target: WatchTarget = {
    title,
    shikiId: params.shikiId,
    releaseAlias: params.alias,
    searchQueries: params.searchQueries
  };
  const token = ++activeRequestToken;
  player.seasons = [];
  const rel = await loadTargetIntoPlayer(token, target, {
    preserveEpisodeOrdinal: params.episodeOrdinal,
    preserveEpisodeIndex: params.episode,
    preserveTime: params.resumeTime,
    autoplay: shouldAutoPlay
  });
  if (!rel || token !== activeRequestToken) return;

  loadFranchiseSeasons(rel.id)
    .then((seasons) => {
      if (token === activeRequestToken) {
        player.seasons = seasons;
      }
    })
    .catch(() => {});
}

onRouteRestore((entry) => {
  if ((entry.page === 'anime' || entry.page === 'player') && entry.params) {
    void restoreRouteTarget(entry.params);
  }
});

export async function retryWatch(): Promise<void> {
  if (!player.target) return;
  const token = ++activeRequestToken;
  const rel = await loadTargetIntoPlayer(token, player.target, { autoplay: player.autoplay });
  if (rel && token === activeRequestToken && player.seasons.length === 0) {
    loadFranchiseSeasons(rel.id)
      .then((seasons) => {
        if (token === activeRequestToken) {
          player.seasons = seasons;
        }
      })
      .catch(() => {});
  }
}

export function selectEpisode(index: number): void {
  if (!player.release) return;
  if (index < 0 || index >= player.release.episodes.length) return;
  const isSameEpisode = index === player.episodeIndex;
  failedVoiceIds.clear();
  if (!isSameEpisode) {
    episodePrefetcher.reset();
    player.resumeTime = 0;
  }
  player.autoplay = true;
  player.pipDismissed = false;
  player.episodeIndex = index;
  syncNowPlaying();
  ensureCurrentEpisodeSkipFallback();
  const ep = player.release.episodes[index];
  if (isSameEpisode) {
    playControlCallback?.();
    return;
  }
  if (router.current === 'anime' || router.current === 'player') {
    updateCurrentRouteParams({
      episode: index,
      episodeOrdinal: ep?.ordinal,
      resumeTime: 0
    });
  }
  syncPlayerHistory(0, ep?.duration ?? 0);
  lastHistorySyncMs = Date.now();
}

export function prevEpisode(): void {
  if (!player.release) return;
  if (player.episodeIndex > 0) {
    selectEpisode(player.episodeIndex - 1);
  }
}

export function nextEpisode(): void {
  if (!player.release) return;
  if (player.episodeIndex + 1 < player.release.episodes.length) {
    episodePrefetcher.reset();
    failedVoiceIds.clear();
    player.resumeTime = 0;
    player.autoplay = true;
    player.pipDismissed = false;
    player.episodeIndex += 1;
    syncNowPlaying();
    ensureCurrentEpisodeSkipFallback();
    const ep = player.release.episodes[player.episodeIndex];
    if (router.current === 'anime' || router.current === 'player') {
      updateCurrentRouteParams({
        episode: player.episodeIndex,
        episodeOrdinal: ep?.ordinal,
        resumeTime: 0
      });
    }
    syncPlayerHistory(0, ep?.duration ?? 0);
    lastHistorySyncMs = Date.now();
  }
}

export function setInlinePlayerStage(el: HTMLElement | null): void {
  player.inlineStageEl = el;
}

export function setWatchTogetherChatControl(
  ctrl: { open: boolean; unread: number; toggle: () => void } | null
): void {
  if (!ctrl) {
    player.wtChatToggle = null;
    player.wtChatUnread = 0;
    return;
  }
  player.wtChatOpen = ctrl.open;
  player.wtChatUnread = ctrl.unread;
  player.wtChatToggle = ctrl.toggle;
}

export function registerPlayerPauseControl(
  fn: (() => void) | null,
  playFn?: (() => void) | null
): void {
  pauseControlCallback = fn;
  playControlCallback = playFn ?? null;
}

export function registerPlayerSeekControl(fn: ((seconds: number) => void) | null): void {
  seekControlCallback = fn;
}

export function toggleActivePlayback(): void {
  if (player.isPlaying) {
    pauseControlCallback?.();
  } else {
    playControlCallback?.();
  }
}

export function registerPlayerSyncBridge(
  syncFn: ((paused: boolean, positionSec?: number, rate?: number) => void) | null,
  snapGetter: (() => { currentTime: number; duration: number; paused: boolean; playbackRate: number; ready: boolean } | null) | null
): void {
  syncStateCallback = syncFn;
  playbackSnapshotGetter = snapGetter;
}

export function setWatchTogetherPlaybackListener(
  fn: ((ev: { kind: 'play' | 'pause' | 'seek' | 'rate'; currentTime: number; duration: number; paused: boolean; playbackRate: number }) => void) | null
): void {
  wtLocalPlaybackListener = fn;
}

export function notifyLocalPlayerAction(ev: {
  kind: 'play' | 'pause' | 'seek' | 'rate';
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
}): void {
  player.liveTime = ev.currentTime;
  if (ev.duration > 0) {
    player.liveDuration = ev.duration;
  }
  wtLocalPlaybackListener?.(ev);
}

export function getPlayerPlaybackSnapshot(): {
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  ready: boolean;
} | null {
  return playbackSnapshotGetter?.() ?? null;
}

export function setWatchTogetherControlsLocked(locked: boolean): void {
  player.wtControlsLocked = locked;
}

export function applyRemotePlaybackSync(paused: boolean, positionSec?: number, playbackRate?: number): void {
  if (typeof positionSec === 'number' && Number.isFinite(positionSec) && positionSec >= 0) {
    player.liveTime = positionSec;
    if (!syncStateCallback || player.loading) {
      player.resumeTime = positionSec;
    }
  }
  if (!syncStateCallback || player.loading) {
    player.autoplay = !paused;
  }
  if (syncStateCallback) {
    syncStateCallback(paused, positionSec, playbackRate);
    return;
  }
  if (typeof positionSec === 'number' && Number.isFinite(positionSec) && positionSec >= 0) {
    seekControlCallback?.(positionSec);
  }
  if (paused) {
    pauseControlCallback?.();
  } else {
    playControlCallback?.();
  }
}

export function setPlayerPlaying(playing: boolean): void {
  player.isPlaying = playing;
  setMediaSessionPlaybackState(playing ? 'playing' : 'paused');
  const goMila = getWailsMilaBridge();
  if (typeof goMila?.SetTrayPlaying === 'function') {
    void goMila.SetTrayPlaying(playing).catch(() => {});
  }
  if (playing) {
    player.pipDismissed = false;
  }
}

export function setPipCorner(corner: PipCorner): void {
  player.pipCorner = corner;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PIP_CORNER_STORAGE_KEY, corner);
    } catch {
      // Ignore storage errors
    }
  }
}

export function toggleCustomPip(): void {
  if (player.pipMode) {
    expandCustomPip();
  } else {
    player.pipMode = true;
    player.pipManual = true;
    player.pipDismissed = false;
  }
}

export function expandCustomPip(): void {
  const wasPlaying = player.isPlaying;
  player.pipMode = false;
  player.pipManual = false;
  player.pipDismissed = false;
  if (router.current !== 'player' && router.current !== 'watch-together-player') {
    navigate({
      page: 'player',
      shikiId: player.shikiArt?.id ?? player.target?.shikiId,
      alias: player.release?.alias ?? player.target?.releaseAlias,
      title: player.title,
      searchQueries: player.target?.searchQueries,
      autoPlay: wasPlaying,
      episode: player.episodeIndex,
      episodeOrdinal: player.release?.episodes[player.episodeIndex]?.ordinal
    });
  }
}

export function closeCustomPip(): void {
  player.pipMode = false;
  player.pipManual = false;
  player.pipDismissed = true;
  player.isPlaying = false;
  pauseControlCallback?.();
}

export function resetPlayer(): void {
  episodePrefetcher.reset();
  activeRequestToken += 1;
  dubRequestToken += 1;
  extrasRequestToken += 1;
  lastLoadedExtrasShikiId = 0;
  voiceDiscoveryPromise = null;
  failedVoiceIds.clear();
  dubOffsetWriter.flush();
  flushHistoryPersistence();
  player.loading = false;
  player.release = null;
  player.seasons = [];
  player.extras = null;
  player.extrasLoading = false;
  player.voices = [];
  player.selectedVoiceId = '';
  player.dubRelease = null;
  player.dubVoiceId = '';
  player.dubOffsetSec = 0;
  player.resumeTime = 0;
  player.error = '';
  player.isPlaying = false;
  player.pipMode = false;
  player.pipManual = false;
  player.pipDismissed = false;
  updateNowPlaying(null);
}
