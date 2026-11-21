import type { HlsSources, SkipRange, TorrentRemuxConfig, VoiceTrackOption } from '../marlakit/player/types';
import { createLazyModuleLoader } from './providers/lazy';
import type { AnimeGODubOption } from './providers/animego';
import type { KodikDubOption } from './providers/kodik';

const animeGoLoader = createLazyModuleLoader(() => import('./providers/animego'));
const animeVostLoader = createLazyModuleLoader(() => import('./providers/animevost'));
const dreamCastLoader = createLazyModuleLoader(() => import('./providers/dreamcast'));
const hentaiLoader = createLazyModuleLoader(() => import('./providers/hentai'));
const kodikLoader = createLazyModuleLoader(() => import('./providers/kodik'));
const zokoLoader = createLazyModuleLoader(() => import('./providers/zoko'));
import {
  dedupeSearchQueries,
  fetchJsonWithTimeout,
  normalizeTitleText,
  SPECIAL_TITLE_RE,
  titleTokens
} from './providers/shared';
import { resolveBackendApiBase } from './bridge';
import { i18n, t } from '../app/i18n.svelte';
import { settingsState } from '../app/settings.svelte';

const SHIKI_GRAPHQL = 'https://shikimori.io/api/graphql';
const ANILIST_GRAPHQL = 'https://graphql.anilist.co';
const SHIKI_REST_ANIMES = 'https://shikimori.io/api/animes';

const RU_TO_EN_GENRE: Record<string, string> = {
  'экшен': 'Action',
  'боевые искусства': 'Martial Arts',
  'приключения': 'Adventure',
  'комедия': 'Comedy',
  'драма': 'Drama',
  'фэнтези': 'Fantasy',
  'фантастика': 'Sci-Fi',
  'научная фантастика': 'Sci-Fi',
  'романтика': 'Romance',
  'повседневность': 'Slice of Life',
  'сверхъестественное': 'Supernatural',
  'детектив': 'Mystery',
  'мистика': 'Mystery',
  'тайна': 'Mystery',
  'триллер': 'Thriller',
  'психологическое': 'Psychological',
  'психология': 'Psychological',
  'ужасы': 'Horror',
  'меха': 'Mecha',
  'музыка': 'Music',
  'спорт': 'Sports',
  'школа': 'School',
  'исекай': 'Isekai',
  'сёнен': 'Shounen',
  'сёнэн': 'Shounen',
  'сёдзё': 'Shoujo',
  'сэйнэн': 'Seinen',
  'дзёсэй': 'Josei',
  'исторический': 'Historical',
  'история': 'Historical',
  'военное': 'Military',
  'космос': 'Space',
  'пародия': 'Parody',
  'гарем': 'Harem',
  'этти': 'Ecchi',
  'демоны': 'Demons',
  'магия': 'Magic',
  'вампиры': 'Vampire',
  'самураи': 'Samurai',
  'игры': 'Game',
  'полиция': 'Police',
  'суперсила': 'Super Power',
  'безумие': 'Avant Garde',
  'авангард': 'Avant Garde',
  'гурман': 'Gourmet',
  'киберпанк': 'Cyberpunk',
  'работа': 'Workplace',
  'перерождение': 'Reincarnation',
  'выживание': 'Survival'
};

export function translateGenreName(raw?: string | null): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '';
  if (i18n.locale === 'ru') return trimmed;
  return RU_TO_EN_GENRE[trimmed.toLowerCase()] ?? trimmed;
}

export function cleanAnilistDescription(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\(\s*Source:\s*[^)]+\)\s*$/i, '')
    .replace(/\[Written by[^\]]+\]\s*$/i, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pickArtworkDescription(art?: ShikiArtwork | null): string {
  if (!art) return '';
  if (i18n.locale === 'ru') {
    return art.description || art.descriptionEnglish || '';
  }
  return art.descriptionEnglish || art.description || '';
}
// Official AniLibria v1 API (https://anilibria.top/api/docs/v1) with mirror and local proxy fallback.
const ANILIBRIA_API_BASES = [
  'https://anilibria.top/api/v1',
  'https://aniliberty.top/api/v1',
  '/ext/anilibria'
] as const;

async function fetchLibJson<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 6500
): Promise<T> {
  let lastError: unknown;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  for (const base of ANILIBRIA_API_BASES) {
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fetchJsonWithTimeout<T>(`${base}${cleanPath}`, init, timeoutMs);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`AniLibria API request failed: ${cleanPath}`);
}

export interface ShikiVideoItem {
  id: string;
  url: string;
  imageUrl: string;
  playerUrl: string;
  embedUrl: string;
  name: string;
  kind: string;
  kindLabel: string;
}

export interface ShikiArtwork {
  id: number;
  name: string;
  russian: string;
  english: string;
  description: string;
  descriptionEnglish?: string;
  score: number;
  year?: number;
  status?: string;
  episodes?: number;
  episodesAired?: number;
  genres: string[];
  posterOriginal: string;
  posterMain: string;
  screenshots: string[];
  videos?: ShikiVideoItem[];
}

export interface PlayableEpisode {
  id: string;
  ordinal: number;
  name?: string;
  duration: number;
  preview?: string;
  opening?: SkipRange | null;
  ending?: SkipRange | null;
  hls_1080?: string | null;
  hls_720?: string | null;
  hls_480?: string | null;
  mp4_1080?: string | null;
  mp4_720?: string | null;
  mp4_480?: string | null;
  remux?: TorrentRemuxConfig | null;
}

export interface PlayableRelease {
  id: number;
  alias: string;
  title: string;
  titleEnglish?: string;
  year?: number;
  typeLabel?: string;
  provider?: 'aniliberty' | 'dreamcast' | 'animevost' | 'animego' | 'kodik' | string;
  voiceLabel?: string;
  voiceActors?: string[];
  primarySourceId?: number | string;
  primaryIsSub?: boolean;
  poster?: string;
  banner?: string;
  episodes: PlayableEpisode[];
  fallbackNote?: string;
}

export interface HeroOpeningOption {
  number: number;
  label: string;
  title: string;
  alias?: string;
  episode: number;
  startOffsetSec?: number;
}

export interface HomeSpotlightItem {
  shikiId: number;
  title: string;
  releaseAlias?: string;
  openingAlias?: string;
  openingEpisode?: number;
  openingStartOffsetSec?: number;
  customPreviewUrl?: string;
  customPreviewAspect?: '16:9' | 'fill';
  openings?: HeroOpeningOption[];
  defaultOpeningNumber?: number;
  searchQueries: string[];
  bg: string;
  previews: string[];
  poster: string;
  score: number;
  metaTags: string[];
  description: string;
}

export interface HomeReleaseItem {
  id: string;
  shikiId?: number;
  releaseAlias: string;
  searchQueries: string[];
  title: string;
  titleLines: string[];
  description: string;
  poster: string;
  fallbackPoster?: string;
  score?: number;
  tags: string[];
}

export interface HomeRecommendationItem {
  id: string;
  shikiId?: number;
  releaseAlias?: string;
  searchQueries: string[];
  title: string;
  poster: string;
  fallbackPoster?: string;
  score?: number;
  tags: string[];
}

export interface HomeFeeds {
  spotlight: HomeSpotlightItem[];
  releases: HomeReleaseItem[];
  recommendations: HomeRecommendationItem[];
}

const HOME_CACHE_KEY = 'mila.cache.home.v3';
const HOME_CACHE_FRESH_MS = 20 * 60 * 1000;
const HOME_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SHIKI_CACHE_KEY = 'mila.cache.shiki.v1';
const SHIKI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SHIKI_CACHE_MAX_ITEMS = 240;
const GENRES_CACHE_KEY = 'mila.cache.genres.v1';
const GENRES_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

interface PersistedEnvelope<T> {
  ts: number;
  data: T;
}

function readPersistedCache<T>(key: string, maxAgeMs: number): PersistedEnvelope<T> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedEnvelope<T> | null;
    if (!parsed || typeof parsed.ts !== 'number' || Date.now() - parsed.ts > maxAgeMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedCache<T>(key: string, data: T): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const payload: PersistedEnvelope<T> = { ts: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage quota or serialization errors.
  }
}

const shikiCache = new Map<number, ShikiArtwork>();
let shikiPersistTimer: number | undefined;

function hydrateShikiCache(): void {
  const cached = readPersistedCache<ShikiArtwork[]>(SHIKI_CACHE_KEY, SHIKI_CACHE_TTL_MS);
  if (!cached || !Array.isArray(cached.data)) return;
  for (const item of cached.data) {
    if (item && typeof item.id === 'number' && item.id > 0) {
      shikiCache.set(item.id, item);
    }
  }
}

function schedulePersistShikiCache(): void {
  if (typeof window === 'undefined') return;
  if (shikiPersistTimer !== undefined) {
    window.clearTimeout(shikiPersistTimer);
  }
  shikiPersistTimer = window.setTimeout(() => {
    shikiPersistTimer = undefined;
    const entries = Array.from(shikiCache.values()).slice(-SHIKI_CACHE_MAX_ITEMS);
    writePersistedCache(SHIKI_CACHE_KEY, entries);
  }, 200);
}

function setShikiCached(art: ShikiArtwork): void {
  if (shikiCache.has(art.id)) {
    shikiCache.delete(art.id);
  }
  shikiCache.set(art.id, art);
  schedulePersistShikiCache();
}

hydrateShikiCache();

const initialHomeEnvelope = readPersistedCache<HomeFeeds>(HOME_CACHE_KEY, HOME_CACHE_MAX_AGE_MS);
let batchPromise: Promise<void> | null = null;
let homeFeedsCache: HomeFeeds | null = initialHomeEnvelope?.data ?? null;
let homeFeedsCacheTs = initialHomeEnvelope?.ts ?? 0;
let homeFeedsPromise: Promise<HomeFeeds> | null = null;

function cleanBBCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\[br\]/g, '\n')
    .replace(/\[\/?[a-zA-Z0-9_*]+(?:=[^\]]*)?\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildMetaTags(art?: {
  year?: number;
  episodes?: number;
  episodesAired?: number;
  genres?: readonly string[];
}): string[] {
  if (!art) return [];
  const tags: string[] = [];
  if (art.year && art.year > 1990) tags.push(String(art.year));
  const ep = art.episodes || art.episodesAired;
  if (ep && ep > 0) tags.push(`${ep} ep`);
  for (const g of (art.genres ?? []).slice(0, 3)) {
    if (g) tags.push(g);
  }
  return tags;
}

export function truncateDescription(raw: string | null | undefined, maxChars: number): string {
  const normalized = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[.,;:!?—-]+$/, '').trimEnd()}...`;
}

function resolveShikiUrl(raw?: string | null): string {
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `https://shikimori.io${raw}`;
  return raw;
}

function resolveLibUrl(raw?: string | null): string {
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('/')) return `https://anilibria.top${raw}`;
  return raw;
}

async function getBackendBase(): Promise<string | null> {
  return resolveBackendApiBase();
}

interface ShikiGqlNode {
  id: string;
  name: string;
  russian?: string;
  english?: string;
  description?: string;
  score?: number;
  status?: string;
  episodes?: number;
  episodesAired?: number;
  airedOn?: { year?: number | null } | null;
  genres?: Array<{ name?: string | null }> | null;
  poster?: {
    originalUrl?: string;
    main2xUrl?: string;
    mainUrl?: string;
  };
  screenshots?: Array<{ originalUrl?: string }>;
  videos?: Array<{
    id?: string | null;
    url?: string | null;
    imageUrl?: string | null;
    playerUrl?: string | null;
    name?: string | null;
    kind?: string | null;
  }> | null;
}

function extractYoutubeId(rawUrl?: string | null): string {
  if (!rawUrl) return '';
  const m = rawUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|watch\?(?:.*&)?v=))([A-Za-z0-9_-]{11})/i);
  return m?.[1] ?? '';
}

function formatVideoKindLabel(kind?: string | null): string {
  switch ((kind ?? '').toLowerCase()) {
    case 'pv':
    case 'promo':
      return 'Trailer';
    case 'op':
      return 'Opening';
    case 'ed':
      return 'Ending';
    case 'cm':
      return 'Teaser';
    case 'character_trailer':
      return 'Character PV';
    case 'episode_preview':
      return 'Preview';
    case 'op_ed_compilation':
      return 'OP / ED';
    default:
      return 'Video';
  }
}

function mapShikiVideos(
  rawVideos?: ShikiGqlNode['videos']
): ShikiVideoItem[] {
  const seen = new Set<string>();
  const items: Array<ShikiVideoItem & { rank: number }> = [];
  for (const v of rawVideos ?? []) {
    const rawUrl = resolveShikiUrl(v.url);
    const rawPlayer = resolveShikiUrl(v.playerUrl);
    const ytId = extractYoutubeId(rawPlayer) || extractYoutubeId(rawUrl);
    const embedUrl = ytId
      ? `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`
      : rawPlayer || rawUrl;
    if (!embedUrl) continue;
    const dedupeKey = ytId || embedUrl;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rawImg = resolveShikiUrl(v.imageUrl);
    const imageUrl = rawImg || (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : '');
    const kind = (v.kind ?? '').toLowerCase();
    let rank = 4;
    if (kind === 'pv' || kind === 'promo') rank = 0;
    else if (kind === 'character_trailer' || kind === 'cm') rank = 1;
    else if (kind === 'op' || kind === 'ed' || kind === 'op_ed_compilation') rank = 2;
    else if (kind === 'episode_preview') rank = 5;

    items.push({
      id: String(v.id ?? dedupeKey),
      url: rawUrl || embedUrl,
      imageUrl,
      playerUrl: rawPlayer || embedUrl,
      embedUrl,
      name: (v.name ?? '').trim() || formatVideoKindLabel(kind),
      kind,
      kindLabel: formatVideoKindLabel(kind),
      rank
    });
  }
  items.sort((a, b) => a.rank - b.rank);
  return items.map(({ rank: _rank, ...rest }) => rest);
}

function mapShikiNode(item: ShikiGqlNode): ShikiArtwork | null {
  const numId = Number(item.id);
  if (!Number.isFinite(numId) || numId <= 0) return null;
  return {
    id: numId,
    name: item.name,
    russian: item.russian ?? '',
    english: item.english ?? '',
    description: cleanBBCode(item.description),
    score: item.score ?? 0,
    year: item.airedOn?.year ?? undefined,
    status: item.status ?? undefined,
    episodes: item.episodes ?? undefined,
    episodesAired: item.episodesAired ?? undefined,
    genres: (item.genres ?? [])
      .map((g) => g.name ?? '')
      .filter(Boolean),
    posterOriginal: resolveShikiUrl(item.poster?.originalUrl),
    posterMain: resolveShikiUrl(item.poster?.main2xUrl || item.poster?.mainUrl || item.poster?.originalUrl),
    screenshots: (item.screenshots ?? [])
      .map((s) => resolveShikiUrl(s.originalUrl))
      .filter(Boolean),
    videos: mapShikiVideos(item.videos)
  };
}

const anilistEnrichedIds = new Set<number>();

async function enrichAnilistEnglish(ids: readonly number[]): Promise<void> {
  const missing = Array.from(
    new Set(
      ids.filter((id) => id > 0 && !anilistEnrichedIds.has(id) && !shikiCache.get(id)?.descriptionEnglish)
    )
  ).slice(0, 50);
  if (missing.length === 0) return;
  for (const id of missing) anilistEnrichedIds.add(id);

  try {
    const query = `query($ids:[Int]){Page(perPage:50){media(idMal_in:$ids,type:ANIME){idMal title{english romaji} description(asHtml:false)}}}`;
    const payload = await fetchJsonWithTimeout<{
      data?: {
        Page?: {
          media?: Array<{
            idMal?: number;
            title?: { english?: string | null; romaji?: string | null };
            description?: string | null;
          }>;
        };
      };
    }>(
      ANILIST_GRAPHQL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { ids: missing } })
      },
      5500
    );
    for (const item of payload.data?.Page?.media ?? []) {
      const id = item.idMal ?? 0;
      const existing = shikiCache.get(id);
      if (!id || !existing) continue;
      const descEn = cleanAnilistDescription(item.description);
      const updated: ShikiArtwork = {
        ...existing,
        english: existing.english || item.title?.english?.trim() || '',
        descriptionEnglish: descEn || existing.descriptionEnglish
      };
      setShikiCached(updated);
    }
  } catch {
    // Non-fatal: AniList English synopsis fallback is best-effort
  }
}

// Fetches Shikimori posters, screenshots (banners), and cleaned descriptions in a single batch call.
export async function ensureShikimoriArtwork(ids: readonly number[]): Promise<Map<number, ShikiArtwork>> {
  while (true) {
    const missing = ids.filter((id) => id > 0 && !shikiCache.has(id));
    if (missing.length === 0) {
      await enrichAnilistEnglish(ids);
      return shikiCache;
    }

    if (batchPromise) {
      await batchPromise;
      continue;
    }

    batchPromise = (async () => {
      try {
        const query = `query($ids: String, $limit: PositiveInt) {
          animes(ids: $ids, limit: $limit, censored: false) {
            id
            name
            russian
            english
            description
            score
            status
            episodes
            episodesAired
            airedOn { year }
            genres { name }
            poster { originalUrl main2xUrl mainUrl }
            screenshots { originalUrl }
            videos { id url imageUrl playerUrl name kind }
          }
        }`;
        const unique = Array.from(new Set(missing));
        const body = JSON.stringify({
          query,
          variables: { ids: unique.join(','), limit: unique.length }
        });
        const payload = await fetchJsonWithTimeout<{ data?: { animes?: ShikiGqlNode[] } }>(
          SHIKI_GRAPHQL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
          },
          8000
        );
        for (const item of payload.data?.animes ?? []) {
          const mapped = mapShikiNode(item);
          if (mapped) {
            setShikiCached(mapped);
          }
        }
      } finally {
        batchPromise = null;
      }
    })();

    await batchPromise;
    return shikiCache;
  }
}

export function getCachedArtwork(id: number): ShikiArtwork | undefined {
  return shikiCache.get(id);
}

function inferReleaseTypeValue(
  rawType?: string | null,
  ...titles: Array<string | null | undefined>
): string {
  const normalized = (rawType ?? '').trim().toUpperCase();
  if (normalized) return normalized;
  const combined = titles.filter(Boolean).join(' ');
  if (/(?:^|[^\p{L}\p{N}])(special|сп[еэ]шл|спецвыпуск)(?:$|[^\p{L}\p{N}])/iu.test(combined)) return 'SPECIAL';
  if (/(?:^|[^\p{L}\p{N}])ova(?:$|[^\p{L}\p{N}])/iu.test(combined)) return 'OVA';
  if (/(?:^|[^\p{L}\p{N}])(movie|film|фильм)(?:$|[^\p{L}\p{N}])/iu.test(combined)) return 'MOVIE';
  return 'TV';
}

interface RawLibRelease {
  id: number;
  alias: string;
  year?: number | null;
  type?: { value?: string | null; description?: string | null } | null;
  shikimori?: { id?: number | null } | null;
  name?: { main?: string; english?: string; alternative?: string | null };
  poster?: { src?: string; preview?: string };
  members?: Array<{
    role?: { value?: string | null; description?: string | null } | null;
    nickname?: string | null;
  }> | null;
  episodes?: Array<{
    id: string;
    ordinal: number;
    name?: string | null;
    name_english?: string | null;
    duration?: number;
    preview?: {
      src?: string | null;
      preview?: string | null;
      thumbnail?: string | null;
      optimized?: {
        src?: string | null;
        preview?: string | null;
        thumbnail?: string | null;
      } | null;
    } | null;
    opening?: SkipRange | null;
    ending?: SkipRange | null;
    hls_1080?: string | null;
    hls_720?: string | null;
    hls_480?: string | null;
  }>;
}

function mapLibRelease(r: RawLibRelease, shikiArt?: ShikiArtwork): PlayableRelease {
  const episodes: PlayableEpisode[] = (r.episodes ?? [])
    .filter((ep) => Boolean(ep.hls_1080 || ep.hls_720 || ep.hls_480))
    .map((ep) => ({
      id: ep.id,
      ordinal: ep.ordinal,
      name: ep.name || ep.name_english || undefined,
      duration: ep.duration ?? 0,
      preview: resolveLibUrl(
        ep.preview?.optimized?.preview ||
          ep.preview?.optimized?.src ||
          ep.preview?.preview ||
          ep.preview?.src ||
          ep.preview?.optimized?.thumbnail ||
          ep.preview?.thumbnail
      ),
      opening: ep.opening,
      ending: ep.ending,
      hls_1080: ep.hls_1080,
      hls_720: ep.hls_720,
      hls_480: ep.hls_480
    }));

  const voiceActors = Array.from(
    new Set(
      (r.members ?? [])
        .filter((m) => m.role?.value === 'voicing' && m.nickname?.trim())
        .map((m) => m.nickname!.trim())
    )
  );

  return {
    id: r.id,
    alias: r.alias,
    title: r.name?.main || shikiArt?.english || shikiArt?.name || 'Anime',
    titleEnglish: r.name?.english || shikiArt?.english,
    year: r.year ?? undefined,
    typeLabel: inferReleaseTypeValue(r.type?.value, r.name?.main, r.name?.english, r.alias),
    voiceLabel: 'AniLibria',
    voiceActors,
    poster: shikiArt?.posterOriginal || resolveLibUrl(r.poster?.src || r.poster?.preview),
    banner: shikiArt?.screenshots[0] || shikiArt?.posterOriginal || resolveLibUrl(r.poster?.src),
    episodes
  };
}

interface BackendDetailEnvelope {
  data?: {
    id: number;
    alias: string;
    shikimori_id?: number;
    title: string;
    title_english?: string;
    year?: number;
    type?: string;
    poster?: { original?: string; main?: string };
    banner?: string;
    episodes?: PlayableEpisode[];
  };
}

interface RawEpisodeTimecode {
  id?: string | null;
  opening?: SkipRange | null;
  ending?: SkipRange | null;
}

function mergeBaseEpisodeMetadata(
  episodes: PlayableEpisode[],
  baseEpisodes?: PlayableEpisode[]
): PlayableEpisode[] {
  if (!baseEpisodes || baseEpisodes.length === 0) return episodes;
  const byOrdinal = new Map<number, PlayableEpisode>();
  for (const b of baseEpisodes) {
    byOrdinal.set(b.ordinal, b);
  }
  return episodes.map((ep) => {
    const baseEp = byOrdinal.get(ep.ordinal);
    if (!baseEp) return ep;
    return {
      ...ep,
      name: ep.name || baseEp.name,
      duration: ep.duration || baseEp.duration,
      preview: ep.preview || baseEp.preview,
      opening: ep.opening?.stop != null ? ep.opening : baseEp.opening ?? ep.opening,
      ending: ep.ending?.stop != null ? ep.ending : baseEp.ending ?? ep.ending
    };
  });
}

async function fetchReleaseTimecodes(idOrAlias: string): Promise<RawEpisodeTimecode[]> {
  try {
    const res = await fetchLibJson<RawEpisodeTimecode[] | { data?: RawEpisodeTimecode[] }>(
      `/anime/releases/${encodeURIComponent(idOrAlias)}/episodes/timecodes`,
      undefined,
      3000
    );
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    return [];
  } catch {
    return [];
  }
}

async function fetchReleaseByIdOrAlias(
  idOrAlias: string,
  shikiArt?: ShikiArtwork,
  expectedShikiId?: number
): Promise<PlayableRelease | null> {
  const backendBase = await getBackendBase();
  if (backendBase) {
    try {
      const env = await fetchJsonWithTimeout<BackendDetailEnvelope>(
        `${backendBase}/anime/releases/${encodeURIComponent(idOrAlias)}`,
        undefined,
        7000
      );
      if (env.data && (env.data.episodes?.length ?? 0) > 0) {
        if (
          expectedShikiId &&
          env.data.shikimori_id &&
          env.data.shikimori_id !== expectedShikiId
        ) {
          return null;
        }
        let mappedEpisodes = env.data.episodes ?? [];
        const hasSkipRanges = mappedEpisodes.some(
          (ep) => ep.opening?.stop != null || ep.ending?.stop != null
        );
        if (!hasSkipRanges) {
          const timecodes = await fetchReleaseTimecodes(String(env.data.id || idOrAlias));
          if (timecodes.length > 0) {
            const tcById = new Map(timecodes.filter((t) => t.id).map((t) => [t.id!, t]));
            mappedEpisodes = mappedEpisodes.map((ep) => {
              const tc = tcById.get(ep.id);
              return tc
                ? {
                    ...ep,
                    opening: ep.opening ?? tc.opening,
                    ending: ep.ending ?? tc.ending
                  }
                : ep;
            });
          }
        }
        return {
          id: env.data.id,
          alias: env.data.alias,
          title: env.data.title,
          titleEnglish: env.data.title_english,
          year: env.data.year,
          typeLabel: inferReleaseTypeValue(
            env.data.type,
            env.data.title,
            env.data.title_english,
            env.data.alias
          ),
          poster: env.data.poster?.original || env.data.poster?.main || shikiArt?.posterOriginal,
          banner: env.data.banner || shikiArt?.screenshots[0],
          episodes: mappedEpisodes
        };
      }
    } catch {
      // Fall through to direct AniLibria v1 API request
    }
  }

  try {
    const raw = await fetchLibJson<RawLibRelease>(
      `/anime/releases/${encodeURIComponent(idOrAlias)}`,
      undefined,
      7000
    );
    if (expectedShikiId && raw.shikimori?.id && raw.shikimori.id !== expectedShikiId) {
      return null;
    }
    const mapped = mapLibRelease(raw, shikiArt);
    if (mapped.episodes.length === 0) return null;

    // Populate skip timecodes via AniLibria v1 /episodes/timecodes endpoint if omitted in release payload.
    const hasSkipRanges = mapped.episodes.some((ep) => ep.opening?.stop != null || ep.ending?.stop != null);
    if (!hasSkipRanges) {
      const timecodes = await fetchReleaseTimecodes(String(raw.id || idOrAlias));
      if (timecodes.length > 0) {
        const tcById = new Map(timecodes.filter((t) => t.id).map((t) => [t.id!, t]));
        mapped.episodes = mapped.episodes.map((ep) => {
          const tc = tcById.get(ep.id);
          return tc
            ? {
                ...ep,
                opening: ep.opening ?? tc.opening,
                ending: ep.ending ?? tc.ending
              }
            : ep;
        });
      }
    }
    return mapped;
  } catch {
    return null;
  }
}

export interface WatchTarget {
  title: string;
  releaseAlias?: string;
  shikiId?: number;
  searchQueries?: string[];
}

interface LibSearchCandidate {
  id: number;
  alias: string;
  year?: number | null;
  name?: { main?: string | null; english?: string | null; alternative?: string | null } | null;
  shikimori?: { id?: number | null } | null;
}

function scoreReleaseCandidate(
  cand: LibSearchCandidate,
  target: WatchTarget,
  shikiArt?: ShikiArtwork
): number {
  if (target.shikiId && cand.shikimori?.id) {
    return cand.shikimori.id === target.shikiId ? 10_000 : -1;
  }

  const candTitles = [cand.name?.main, cand.name?.english, cand.name?.alternative]
    .map((v) => v?.trim() ?? '')
    .filter(Boolean);
  const targetTitles = [
    target.title,
    shikiArt?.english,
    shikiArt?.name,
    shikiArt?.russian,
    ...(target.searchQueries ?? [])
  ]
    .map((v) => v?.trim() ?? '')
    .filter(Boolean);

  if (candTitles.length === 0 || targetTitles.length === 0) {
    return -1;
  }

  const candIsSpecial = candTitles.some((t) => SPECIAL_TITLE_RE.test(t));
  const targetIsSpecial = targetTitles.some((t) => SPECIAL_TITLE_RE.test(t));
  if (candIsSpecial !== targetIsSpecial) {
    return -1;
  }

  let best = -1;
  for (const cTitle of candTitles) {
    const cNorm = normalizeTitleText(cTitle);
    const cToks = titleTokens(cTitle);
    if (!cNorm || cToks.length === 0) continue;

    for (const tTitle of targetTitles) {
      const tNorm = normalizeTitleText(tTitle);
      const tToks = titleTokens(tTitle);
      if (!tNorm || tToks.length === 0) continue;

      if (cNorm === tNorm) {
        best = Math.max(best, 900);
        continue;
      }

      const tSet = new Set(tToks);
      let matches = 0;
      for (const tok of cToks) {
        if (tSet.has(tok)) matches += 1;
      }
      if (matches === 0) continue;

      const minLen = Math.min(cToks.length, tToks.length);
      const maxLen = Math.max(cToks.length, tToks.length);
      const containment = matches / minLen;
      const jaccard = matches / maxLen;

      if (containment >= 0.8 && jaccard >= 0.6) {
        let score = Math.round(500 * jaccard + 100 * containment);
        if (shikiArt?.year && cand.year && Math.abs(shikiArt.year - cand.year) <= 1) {
          score += 20;
        }
        best = Math.max(best, score);
      }
    }
  }

  return best;
}

// Resolves a playable release matching the exact target (AniLibria first, then Dream Cast / AnimeVost).
export async function resolvePlayableRelease(target: WatchTarget): Promise<PlayableRelease> {
  if (target.shikiId) {
    await ensureShikimoriArtwork([target.shikiId]).catch(() => {});
  }
  const shikiArt = target.shikiId ? shikiCache.get(target.shikiId) : undefined;

  if (target.releaseAlias) {
    const direct = await fetchReleaseByIdOrAlias(target.releaseAlias, shikiArt, target.shikiId);
    if (direct) return { ...direct, provider: direct.provider ?? 'aniliberty' };
  }

  const prefProvider = settingsState.preferredProvider;
  const providerTitles = dedupeSearchQueries([
    shikiArt?.russian,
    target.title,
    shikiArt?.english,
    shikiArt?.name,
    ...(target.searchQueries ?? [])
  ]);

  if (prefProvider === 'dreamcast') {
    const dcMatch = await dreamCastLoader
      .load()
      .then((m) => m.findDreamCastMatch(providerTitles, shikiArt?.year ?? null))
      .catch(() => null);
    if (dcMatch && dcMatch.episodes.length > 0) {
      return {
        id: dcMatch.releaseId,
        alias: dcMatch.voice.id,
        title: shikiArt?.english || shikiArt?.name || dcMatch.title || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year ?? dcMatch.year,
        provider: 'dreamcast',
        voiceLabel: dcMatch.voice.label,
        voiceActors: dcMatch.voiceActors,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain || dcMatch.poster,
        banner: shikiArt?.screenshots?.[0] || dcMatch.poster,
        episodes: dcMatch.episodes
      };
    }
  } else if (prefProvider === 'animego') {
    const agoMatch = await animeGoLoader
      .load()
      .then((m) => m.findAnimeGOMatch(providerTitles, shikiArt?.year ?? null))
      .catch(() => null);
    if (agoMatch && agoMatch.dubs.length > 0) {
      const preferredOrder = ['студийная банда', 'anilibria', 'dream cast', 'shiza', 'anidub'];
      let chosen: AnimeGODubOption | undefined;
      for (const kw of preferredOrder) {
        chosen = agoMatch.dubs.find((d) => !d.voice.isSub && d.voice.label.toLowerCase().includes(kw));
        if (chosen) break;
      }
      chosen = chosen ?? agoMatch.dubs.find((d) => !d.voice.isSub) ?? agoMatch.dubs[0];
      if (chosen.episodes.length > 0) {
        return {
          id: agoMatch.animeId,
          alias: chosen.voice.id,
          title: shikiArt?.english || shikiArt?.name || agoMatch.title || target.title,
          titleEnglish: shikiArt?.english || shikiArt?.name,
          year: shikiArt?.year ?? agoMatch.year,
          provider: 'animego',
          voiceLabel: chosen.voice.label,
          primarySourceId: chosen.voice.sourceId,
          primaryIsSub: chosen.voice.isSub,
          poster: shikiArt?.posterOriginal || shikiArt?.posterMain || agoMatch.poster,
          banner: shikiArt?.screenshots?.[0] || agoMatch.poster,
          episodes: chosen.episodes
        };
      }
    }
  } else if (prefProvider === 'animevost') {
    const avMatch = await animeVostLoader
      .load()
      .then((m) => m.findAnimeVostMatch(providerTitles, shikiArt?.year ?? null))
      .catch(() => null);
    if (avMatch && avMatch.episodes.length > 0) {
      return {
        id: avMatch.releaseId,
        alias: avMatch.voice.id,
        title: shikiArt?.english || shikiArt?.name || avMatch.title || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year ?? avMatch.year,
        provider: 'animevost',
        voiceLabel: avMatch.voice.label,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain || avMatch.poster,
        banner: shikiArt?.screenshots?.[0] || avMatch.poster,
        episodes: avMatch.episodes
      };
    }
  } else if (prefProvider === 'kodik') {
    const kodikMatch = await kodikLoader
      .load()
      .then((m) => m.findKodikMatch(providerTitles, shikiArt?.year ?? null, target.shikiId))
      .catch(() => null);
    if (kodikMatch && kodikMatch.dubs.length > 0) {
      const preferredOrder = ['anidub', 'студийная банда', 'anilibria', 'dream cast', 'shiza'];
      let chosen: KodikDubOption | undefined;
      for (const kw of preferredOrder) {
        chosen = kodikMatch.dubs.find((d) => !d.voice.isSub && d.voice.label.toLowerCase().includes(kw));
        if (chosen) break;
      }
      chosen = chosen ?? kodikMatch.dubs.find((d) => !d.voice.isSub) ?? kodikMatch.dubs[0];
      if (chosen.episodes.length > 0) {
        return {
          id: kodikMatch.animeId,
          alias: chosen.voice.id,
          title: shikiArt?.english || shikiArt?.name || kodikMatch.title || target.title,
          titleEnglish: shikiArt?.english || shikiArt?.name,
          year: shikiArt?.year ?? kodikMatch.year,
          provider: 'kodik',
          voiceLabel: chosen.voice.label,
          primarySourceId: chosen.voice.sourceId,
          primaryIsSub: chosen.voice.isSub,
          poster: shikiArt?.posterOriginal || shikiArt?.posterMain || kodikMatch.poster,
          banner: shikiArt?.screenshots?.[0] || kodikMatch.poster,
          episodes: chosen.episodes
        };
      }
    }
  }

  const queries = dedupeSearchQueries([
    ...(target.searchQueries ?? []),
    shikiArt?.russian ?? '',
    shikiArt?.english ?? '',
    shikiArt?.name ?? '',
    target.title
  ]);

  const candidatesById = new Map<number, { cand: LibSearchCandidate; score: number }>();

  for (const q of queries) {
    const [appRes, catRes] = await Promise.allSettled([
      fetchLibJson<LibSearchCandidate[]>(
        `/app/search/releases?query=${encodeURIComponent(q)}`,
        undefined,
        6000
      ),
      fetchLibJson<{ data?: LibSearchCandidate[] }>(
        `/anime/catalog/releases?f[search]=${encodeURIComponent(q)}&limit=10`,
        undefined,
        6000
      )
    ]);

    const batch: LibSearchCandidate[] = [
      ...(appRes.status === 'fulfilled' && Array.isArray(appRes.value) ? appRes.value : []),
      ...(catRes.status === 'fulfilled' && Array.isArray(catRes.value?.data) ? catRes.value.data : [])
    ];

    let foundExactShiki = false;
    for (const cand of batch) {
      if (!cand?.id) continue;
      const score = scoreReleaseCandidate(cand, target, shikiArt);
      if (score <= 0) continue;
      const prev = candidatesById.get(cand.id);
      if (!prev || score > prev.score) {
        candidatesById.set(cand.id, { cand, score });
      }
      if (score >= 10_000) {
        foundExactShiki = true;
      }
    }

    if (foundExactShiki) break;
  }

  const rankedCandidates = Array.from(candidatesById.values()).sort((a, b) => b.score - a.score);
  for (const { cand } of rankedCandidates.slice(0, 5)) {
    const rel = await fetchReleaseByIdOrAlias(String(cand.id), shikiArt, target.shikiId);
    if (rel) return { ...rel, provider: 'aniliberty' };
  }

  const [dcRes, agoRes, avRes, kodikRes] = await Promise.allSettled([
    dreamCastLoader
      .load()
      .then((m) => m.findDreamCastMatch(providerTitles, shikiArt?.year ?? null))
      .catch(() => null),
    animeGoLoader
      .load()
      .then((m) => m.findAnimeGOMatch(providerTitles, shikiArt?.year ?? null))
      .catch(() => null),
    animeVostLoader
      .load()
      .then((m) => m.findAnimeVostMatch(providerTitles, shikiArt?.year ?? null))
      .catch(() => null),
    kodikLoader
      .load()
      .then((m) => m.findKodikMatch(providerTitles, shikiArt?.year ?? null, target.shikiId))
      .catch(() => null)
  ]);

  const dcMatch = dcRes.status === 'fulfilled' ? dcRes.value : null;
  if (dcMatch && dcMatch.episodes.length > 0) {
    return {
      id: dcMatch.releaseId,
      alias: dcMatch.voice.id,
      title: shikiArt?.english || shikiArt?.name || dcMatch.title || target.title,
      titleEnglish: shikiArt?.english || shikiArt?.name,
      year: shikiArt?.year ?? dcMatch.year,
      provider: 'dreamcast',
      voiceLabel: dcMatch.voice.label,
      voiceActors: dcMatch.voiceActors,
      poster: shikiArt?.posterOriginal || shikiArt?.posterMain || dcMatch.poster,
      banner: shikiArt?.screenshots?.[0] || dcMatch.poster,
      episodes: dcMatch.episodes
    };
  }

  const agoMatch = agoRes.status === 'fulfilled' ? agoRes.value : null;
  if (agoMatch && agoMatch.dubs.length > 0) {
    const preferredOrder = ['студийная банда', 'anilibria', 'dream cast', 'shiza', 'anidub'];
    const pickBestDub = (): AnimeGODubOption => {
      for (const kw of preferredOrder) {
        const found = agoMatch.dubs.find((d) => !d.voice.isSub && d.voice.label.toLowerCase().includes(kw));
        if (found) return found;
      }
      return agoMatch.dubs.find((d) => !d.voice.isSub) ?? agoMatch.dubs[0];
    };
    const chosen = pickBestDub();
    if (chosen.episodes.length > 0) {
      return {
        id: agoMatch.animeId,
        alias: chosen.voice.id,
        title: shikiArt?.english || shikiArt?.name || agoMatch.title || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year ?? agoMatch.year,
        provider: 'animego',
        voiceLabel: chosen.voice.label,
        primarySourceId: chosen.voice.sourceId,
        primaryIsSub: chosen.voice.isSub,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain || agoMatch.poster,
        banner: shikiArt?.screenshots?.[0] || agoMatch.poster,
        episodes: chosen.episodes
      };
    }
  }

  const avMatch = avRes.status === 'fulfilled' ? avRes.value : null;
  if (avMatch && avMatch.episodes.length > 0) {
    return {
      id: avMatch.releaseId,
      alias: avMatch.voice.id,
      title: shikiArt?.english || shikiArt?.name || avMatch.title || target.title,
      titleEnglish: shikiArt?.english || shikiArt?.name,
      year: shikiArt?.year ?? avMatch.year,
      provider: 'animevost',
      voiceLabel: avMatch.voice.label,
      poster: shikiArt?.posterOriginal || shikiArt?.posterMain || avMatch.poster,
      banner: shikiArt?.screenshots?.[0] || avMatch.poster,
      episodes: avMatch.episodes
    };
  }

  const kodikMatch = kodikRes.status === 'fulfilled' ? kodikRes.value : null;
  if (kodikMatch && kodikMatch.dubs.length > 0) {
    const preferredOrder = ['anidub', 'студийная банда', 'anilibria', 'dream cast', 'shiza'];
    const pickBestKodik = (): KodikDubOption => {
      for (const kw of preferredOrder) {
        const found = kodikMatch.dubs.find((d) => !d.voice.isSub && d.voice.label.toLowerCase().includes(kw));
        if (found) return found;
      }
      return kodikMatch.dubs.find((d) => !d.voice.isSub) ?? kodikMatch.dubs[0];
    };
    const chosen = pickBestKodik();
    if (chosen.episodes.length > 0) {
      return {
        id: kodikMatch.animeId,
        alias: chosen.voice.id,
        title: shikiArt?.english || shikiArt?.name || kodikMatch.title || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year ?? kodikMatch.year,
        provider: 'kodik',
        voiceLabel: chosen.voice.label,
        primarySourceId: chosen.voice.sourceId,
        primaryIsSub: chosen.voice.isSub,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain || kodikMatch.poster,
        banner: shikiArt?.screenshots?.[0] || kodikMatch.poster,
        episodes: chosen.episodes
      };
    }
  }

  const zokoMatch = await zokoLoader
    .load()
    .then((m) => m.findZokoMatch(providerTitles, target.shikiId ?? null, shikiArt?.episodes ?? null))
    .catch(() => null);
  if (zokoMatch && zokoMatch.dubs.length > 0) {
    const chosen = zokoMatch.dubs.find((d) => d.mode === 'dub') ?? zokoMatch.dubs[0];
    if (chosen.episodes.length > 0) {
      return {
        id: zokoMatch.malId,
        alias: chosen.voice.id,
        title: shikiArt?.english || shikiArt?.name || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year,
        provider: 'zoko',
        voiceLabel: chosen.voice.label,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain,
        banner: shikiArt?.screenshots?.[0],
        episodes: chosen.episodes
      };
    }
  }

  const hentaiMatch = await hentaiLoader
    .load()
    .then((m) => m.findHentaiMatch(providerTitles, shikiArt?.year ?? null))
    .catch(() => null);
  if (hentaiMatch && hentaiMatch.episodes.length > 0) {
    return {
      id: hentaiMatch.releaseId,
      alias: hentaiMatch.voice.id,
      title: shikiArt?.english || shikiArt?.name || hentaiMatch.title || target.title,
      titleEnglish: shikiArt?.english || shikiArt?.name,
      year: shikiArt?.year ?? hentaiMatch.year,
      provider: hentaiMatch.provider,
      voiceLabel: hentaiMatch.voice.label,
      poster: shikiArt?.posterOriginal || shikiArt?.posterMain || hentaiMatch.poster,
      banner: shikiArt?.screenshots?.[0] || hentaiMatch.poster,
      episodes: hentaiMatch.episodes
    };
  }

  throw new Error(t('anime.unavailable', { title: target.title }));
}

export function episodeSources(ep: PlayableEpisode): HlsSources {
  return {
    hls_1080: ep.hls_1080,
    hls_720: ep.hls_720,
    hls_480: ep.hls_480,
    mp4_1080: ep.mp4_1080,
    mp4_720: ep.mp4_720,
    mp4_480: ep.mp4_480,
    remux: ep.remux
  };
}

interface RawLibFeedItem {
  id: number;
  alias: string;
  year?: number | null;
  is_ongoing?: boolean;
  type?: { value?: string | null; description?: string | null } | null;
  episodes_total?: number | null;
  description?: string | null;
  is_blocked_by_copyrights?: boolean;
  name?: { main?: string | null; english?: string | null } | null;
  shikimori?: { id?: number | null; rating?: number | null } | null;
  mal?: { rating?: number | null } | null;
  rating?: { average?: number | null } | null;
  poster?: {
    src?: string | null;
    preview?: string | null;
    optimized?: { src?: string | null } | null;
  } | null;
  genres?: Array<{ id?: number | null; name?: string | null }> | null;
  latest_episode?: { ordinal?: number | null } | null;
}

function franchiseKey(rawTitle: string): string {
  return rawTitle
    .toLowerCase()
    .replace(
      /(?<![a-z0-9а-яё])(\d+(st|nd|rd|th)\s+season|season\s+\d+|part\s+\d+|cour\s+\d+|the\s+final\s+season|the\s+final\s+chapters|final\s+season|сезон\s+\d+|\d+\s+сезон|часть\s+\d+|arc)(?![a-z0-9а-яё])/gi,
      ''
    )
    .replace(/\b(ii|iii|iv|v)\b$/gi, '')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .trim();
}

export function titleBasePart(rawTitle: string): string {
  const stripped = stripSeasonSuffix(rawTitle);
  const base = stripped.split(/:\s+|\s+[-–]\s+/)[0]?.trim() ?? '';
  return base || stripped;
}

export function titleGroupVariants(rawTitle: string): string[] {
  const variants = [
    normalizeTitleText(rawTitle),
    normalizeTitleText(stripSeasonSuffix(rawTitle)),
    normalizeTitleText(titleBasePart(rawTitle))
  ];
  return Array.from(new Set(variants.filter(Boolean)));
}

export function computeTitleGroupKey(rawTitle: string, rootTitles?: ReadonlySet<string>): string {
  const fKey = franchiseKey(rawTitle);
  if (!fKey) return '';
  const base = titleBasePart(rawTitle);
  if (base && normalizeTitleText(base) !== normalizeTitleText(rawTitle)) {
    const baseKey = franchiseKey(base);
    if (baseKey && rootTitles?.has(normalizeTitleText(base))) return baseKey;
  }
  return fKey;
}

function splitTitleLines(title: string): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1 || title.length <= 13) return [title];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= 16 || current.length === 0) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === 2) {
        const restIndex = words.indexOf(word);
        const remaining = words.slice(restIndex).join(' ');
        lines.push(remaining);
        return lines;
      }
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function pickHighlightPreviews(shots: readonly string[], posterOriginal: string): string[] {
  const n = shots.length;
  if (n >= 8) {
    const indices = [Math.floor(n * 0.25), Math.floor(n * 0.55), Math.floor(n * 0.82)];
    return indices.map((idx) => shots[idx] ?? shots[0] ?? posterOriginal);
  }
  if (n >= 4) {
    return shots.slice(1, 4);
  }
  if (n >= 3) {
    return shots.slice(0, 3);
  }
  return [shots[0] ?? posterOriginal, shots[1] ?? shots[0] ?? posterOriginal, shots[2] ?? shots[0] ?? posterOriginal];
}

const HERO_SPOTLIGHT_LIMIT = 6;

function mapShikiToSpotlight(art: ShikiArtwork, releaseAlias?: string): HomeSpotlightItem {
  const shots = art.screenshots;
  const previews = pickHighlightPreviews(shots, art.posterOriginal);

  return {
    shikiId: art.id,
    title: art.english || art.name || art.russian || 'Anime',
    releaseAlias,
    searchQueries: [art.name, art.english, art.russian].filter(Boolean),
    bg: shots[0] ?? art.posterOriginal ?? '',
    previews,
    poster: art.posterOriginal || art.posterMain || shots[0] || '',
    score: art.score > 0 ? Number(art.score.toFixed(1)) : 0,
    metaTags: buildMetaTags(art),
    description: truncateDescription(pickArtworkDescription(art), 330)
  };
}

export function getCachedHomeFeeds(): HomeFeeds | null {
  return homeFeedsCache;
}

export function isHomeFeedsStale(): boolean {
  return !homeFeedsCache || Date.now() - homeFeedsCacheTs > HOME_CACHE_FRESH_MS;
}

// Loads curated top-5 Spotlight plus live AniLiberty New Releases and Recommendations.
export async function loadHomeFeeds(forceRefresh = false): Promise<HomeFeeds> {
  if (!forceRefresh && homeFeedsCache) {
    if (isHomeFeedsStale() && !homeFeedsPromise) {
      void loadHomeFeeds(true);
    }
    return homeFeedsCache;
  }
  if (homeFeedsPromise) {
    return homeFeedsPromise;
  }

  homeFeedsPromise = (async () => {
    const shikiQuery = `{
      ongoing: animes(order: popularity, status: "ongoing", kind: "tv", limit: 18, censored: false) {
        id name russian english description score status episodes episodesAired
        airedOn { year } genres { name }
        poster { originalUrl main2xUrl mainUrl }
        screenshots { originalUrl }
      }
      ranked: animes(order: ranked, kind: "tv", limit: 24, censored: false) {
        id name russian english description score status episodes episodesAired
        airedOn { year } genres { name }
        poster { originalUrl main2xUrl mainUrl }
        screenshots { originalUrl }
      }
    }`;

    const [latestRes, recRes, topCatRes, shikiRes] = await Promise.allSettled([
      fetchLibJson<RawLibFeedItem[]>(
        `/anime/releases/latest?limit=14`,
        undefined,
        7000
      ),
      fetchLibJson<RawLibFeedItem[]>(
        `/anime/releases/recommended?limit=12`,
        undefined,
        7000
      ),
      fetchLibJson<{ data?: RawLibFeedItem[] }>(
        `/anime/catalog/releases?f[sorting]=RATING_DESC&limit=25`,
        undefined,
        7000
      ),
      fetchJsonWithTimeout<{ data?: { ongoing?: ShikiGqlNode[]; ranked?: ShikiGqlNode[] } }>(
        SHIKI_GRAPHQL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: shikiQuery })
        },
        8500
      )
    ]);

    const latestRaw = latestRes.status === 'fulfilled' && Array.isArray(latestRes.value) ? latestRes.value : [];
    const recRaw = recRes.status === 'fulfilled' && Array.isArray(recRes.value) ? recRes.value : [];
    const topCatRaw =
      topCatRes.status === 'fulfilled' && Array.isArray(topCatRes.value?.data) ? topCatRes.value.data : [];
    const ongoingNodes = shikiRes.status === 'fulfilled' ? shikiRes.value.data?.ongoing ?? [] : [];
    const rankedNodes = shikiRes.status === 'fulfilled' ? shikiRes.value.data?.ranked ?? [] : [];

    const ongoingArts: ShikiArtwork[] = [];
    for (const node of ongoingNodes) {
      const mapped = mapShikiNode(node);
      if (mapped) {
        setShikiCached(mapped);
        ongoingArts.push(mapped);
      }
    }

    const rankedArts: ShikiArtwork[] = [];
    for (const node of rankedNodes) {
      const mapped = mapShikiNode(node);
      if (mapped) {
        setShikiCached(mapped);
        rankedArts.push(mapped);
      }
    }

    const aliasByShikiId = new Map<number, string>();
    const libPosterByShikiId = new Map<number, string>();
    for (const item of [...latestRaw, ...recRaw, ...topCatRaw]) {
      if (item.is_blocked_by_copyrights) continue;
      const sid = item.shikimori?.id;
      if (sid && item.alias && !aliasByShikiId.has(sid)) {
        aliasByShikiId.set(sid, item.alias);
      }
      const libPoster = resolveLibUrl(item.poster?.src || item.poster?.optimized?.src || item.poster?.preview);
      if (sid && libPoster && !libPosterByShikiId.has(sid)) {
        libPosterByShikiId.set(sid, libPoster);
      }
    }

    const libShikiIds = [
      ...topCatRaw.slice(0, 16),
      ...latestRaw.slice(0, 8),
      ...recRaw.slice(0, 8)
    ]
      .filter((item) => !item.is_blocked_by_copyrights)
      .map((item) => item.shikimori?.id ?? 0)
      .filter((id) => id > 0 && !shikiCache.has(id));
    if (libShikiIds.length > 0) {
      await ensureShikimoriArtwork(libShikiIds).catch(() => {});
    }
    const spotlightEnrichIds = [
      ...ongoingArts.slice(0, 12).map((a) => a.id),
      ...rankedArts.slice(0, 10).map((a) => a.id)
    ];
    if (spotlightEnrichIds.length > 0) {
      await enrichAnilistEnglish(spotlightEnrichIds).catch(() => {});
    }

    const topLibArts: ShikiArtwork[] = [];
    for (const item of topCatRaw) {
      if (item.is_blocked_by_copyrights || !item.shikimori?.id) continue;
      const art = shikiCache.get(item.shikimori.id);
      if (art) topLibArts.push(art);
    }

    const usedShikiIds = new Set<number>();
    const usedFranchises = new Set<string>();

    // 1. Spotlight (fully dynamic live titles from Shikimori ongoing/ranked & AniLiberty top catalog)
    const spotlight: HomeSpotlightItem[] = [];
    const spotlightCandidates = [
      ...ongoingArts.filter(
        (a) => aliasByShikiId.has(a.id) && (a.year ?? 0) >= 2022 && a.screenshots.length >= 3 && a.posterOriginal
      ),
      ...topLibArts.filter((a) => a.screenshots.length >= 3 && a.posterOriginal),
      ...rankedArts.filter((a) => aliasByShikiId.has(a.id) && a.screenshots.length >= 3 && a.posterOriginal),
      ...ongoingArts.filter((a) => (a.year ?? 0) >= 2022 && a.screenshots.length >= 3 && a.posterOriginal),
      ...rankedArts.filter((a) => a.screenshots.length >= 3 && a.posterOriginal)
    ];
    for (const art of spotlightCandidates) {
      if (spotlight.length >= HERO_SPOTLIGHT_LIMIT) break;
      const key = franchiseKey(art.english || art.name);
      if (usedShikiIds.has(art.id) || (key && usedFranchises.has(key))) continue;
      usedShikiIds.add(art.id);
      if (key) usedFranchises.add(key);
      spotlight.push(mapShikiToSpotlight(art, aliasByShikiId.get(art.id)));
    }

    // 2. New Releases (4 live latest releases from AniLiberty, enriched with Shikimori metadata)
    const releases: HomeReleaseItem[] = [];
    const seenAliases = new Set<string>();
    for (const r of latestRaw) {
      if (releases.length >= 4) break;
      if (!r.alias || seenAliases.has(r.alias) || r.is_blocked_by_copyrights) continue;
      const shiki = r.shikimori?.id ? shikiCache.get(r.shikimori.id) : undefined;
      const libPoster = resolveLibUrl(r.poster?.src || r.poster?.optimized?.src || r.poster?.preview);
      const shikiPoster = shiki?.posterOriginal || shiki?.posterMain || '';
      const poster = libPoster || shikiPoster;
      if (!poster) continue;

      seenAliases.add(r.alias);
      const title = shiki?.english || r.name?.english || r.name?.main || 'Anime';
      const rawScore = shiki?.score && shiki.score > 0 ? shiki.score : (r.shikimori?.rating || r.mal?.rating || 0);
      const epCount = r.episodes_total || r.latest_episode?.ordinal || undefined;
      const libTags = [
        r.year ? String(r.year) : '',
        epCount ? `${epCount} ep` : '',
        ...(r.genres ?? []).slice(0, 3).map((g) => translateGenreName(g.name)).filter(Boolean)
      ].filter(Boolean);
      const tags = shiki ? buildMetaTags(shiki) : libTags;
      const descSource = pickArtworkDescription(shiki) || cleanBBCode(r.description);

      if (r.shikimori?.id) usedShikiIds.add(r.shikimori.id);
      const fKey = franchiseKey(title);
      if (fKey) usedFranchises.add(fKey);

      releases.push({
        id: r.alias,
        shikiId: r.shikimori?.id ?? undefined,
        releaseAlias: r.alias,
        searchQueries: [r.name?.english ?? '', r.name?.main ?? '', shiki?.name ?? ''].filter(Boolean),
        title,
        titleLines: splitTitleLines(title),
        description: truncateDescription(descSource, 380),
        poster,
        fallbackPoster: shikiPoster && shikiPoster !== poster ? shikiPoster : undefined,
        score: rawScore > 0 ? Number(rawScore.toFixed(1)) : undefined,
        tags: tags.length > 0 ? tags : libTags
      });
    }

    // 3. Recommendations (5 distinct high-rated posters from AniLiberty recommended + Shikimori ranked)
    const recommendations: HomeRecommendationItem[] = [];
    for (const r of recRaw) {
      if (recommendations.length >= 3) break;
      if (!r.alias || seenAliases.has(r.alias) || r.is_blocked_by_copyrights) continue;
      const sid = r.shikimori?.id ?? undefined;
      if (sid && usedShikiIds.has(sid)) continue;
      if ((r.year ?? 0) < 2018) continue;
      const shiki = sid ? shikiCache.get(sid) : undefined;
      const libPoster = resolveLibUrl(r.poster?.src || r.poster?.optimized?.src || r.poster?.preview);
      const shikiPoster = shiki?.posterOriginal || shiki?.posterMain || '';
      const poster = libPoster || shikiPoster;
      if (!poster) continue;

      const title = shiki?.english || r.name?.english || r.name?.main || 'Anime';
      const fKey = franchiseKey(title);
      if (fKey && usedFranchises.has(fKey)) continue;

      seenAliases.add(r.alias);
      if (sid) usedShikiIds.add(sid);
      if (fKey) usedFranchises.add(fKey);
      const rawScore = shiki?.score && shiki.score > 0 ? shiki.score : (r.shikimori?.rating || r.mal?.rating || 0);

      recommendations.push({
        id: r.alias,
        shikiId: sid,
        releaseAlias: r.alias,
        searchQueries: [r.name?.english ?? '', r.name?.main ?? '', shiki?.name ?? ''].filter(Boolean),
        title,
        poster,
        fallbackPoster: shikiPoster && shikiPoster !== poster ? shikiPoster : undefined,
        score: rawScore > 0 ? Number(rawScore.toFixed(1)) : undefined,
        tags: shiki ? buildMetaTags(shiki) : []
      });
    }

    for (const art of [...topLibArts, ...rankedArts]) {
      if (recommendations.length >= 5) break;
      if (!art.posterOriginal || usedShikiIds.has(art.id)) continue;
      const title = art.english || art.name || art.russian || 'Anime';
      const fKey = franchiseKey(title);
      if (fKey && usedFranchises.has(fKey)) continue;

      const libPoster = libPosterByShikiId.get(art.id) ?? '';
      const shikiPoster = art.posterOriginal || art.posterMain;
      const poster = libPoster || shikiPoster;

      usedShikiIds.add(art.id);
      if (fKey) usedFranchises.add(fKey);
      recommendations.push({
        id: `shiki-${art.id}`,
        shikiId: art.id,
        releaseAlias: aliasByShikiId.get(art.id),
        searchQueries: [art.name, art.english, art.russian].filter(Boolean),
        title,
        poster,
        fallbackPoster: shikiPoster && shikiPoster !== poster ? shikiPoster : undefined,
        score: art.score > 0 ? Number(art.score.toFixed(1)) : undefined,
        tags: buildMetaTags(art)
      });
    }

    const result: HomeFeeds = { spotlight, releases, recommendations };
    if (spotlight.length > 0 || releases.length > 0 || recommendations.length > 0) {
      homeFeedsCache = result;
      homeFeedsCacheTs = Date.now();
      writePersistedCache(HOME_CACHE_KEY, result);
    }
    return result;
  })().finally(() => {
    homeFeedsPromise = null;
  });

  return homeFeedsPromise;
}

export interface AnimeSeasonEntry {
  id: number;
  alias: string;
  shikiId?: number;
  title: string;
  titleEnglish?: string;
  shortLabel: string;
  year?: number;
  typeLabel?: string;
  episodesTotal?: number;
  poster: string;
}

export type SearchFilterMode = 'all' | 'library' | 'ongoing';

export interface CatalogGenreOption {
  id: number;
  name: string;
  totalReleases?: number;
}

export interface SearchQueryOptions {
  signal?: AbortSignal;
  filter?: SearchFilterMode;
  fromYear?: number;
  toYear?: number;
  minEpisodes?: number;
  maxEpisodes?: number;
  minScore?: number;
  type?: '' | 'TV' | 'MOVIE' | 'OVA';
  genreIds?: number[];
  sorting?: '' | 'RATING_DESC' | 'FRESH_AT_DESC';
}

export interface SearchGroupItem {
  id: string;
  title: string;
  subTitle?: string;
  year?: number;
  score?: number;
  typeLabel?: string;
  isOngoing?: boolean;
  episodesTotal?: number;
  genres?: string[];
  genreIds?: number[];
  poster: string;
  posterPosition?: string;
  shikiId?: number;
  releaseAlias?: string;
  searchQueries: string[];
  seasonCount: number;
}

interface RawFranchiseReleaseNode {
  sort_order?: number;
  release_id?: number;
  release?: (RawLibFeedItem & {
    type?: { value?: string | null; description?: string | null } | null;
    name?: { main?: string | null; english?: string | null; alternative?: string | null } | null;
    poster?: {
      src?: string | null;
      preview?: string | null;
      optimized?: { src?: string | null; preview?: string | null } | null;
    } | null;
  }) | null;
}

interface RawFranchise {
  id: string;
  name?: string | null;
  name_english?: string | null;
  first_year?: number | null;
  last_year?: number | null;
  total_releases?: number | null;
  franchise_releases?: RawFranchiseReleaseNode[] | null;
}

interface ResolvedFranchise {
  id: string;
  name?: string;
  nameEnglish?: string;
  seasons: AnimeSeasonEntry[];
}

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

const MAX_FRANCHISE_CACHE = 200;
const MAX_GROUPED_SEARCH_CACHE = 60;
const MAX_HERO_OPENING_CACHE = 120;

const franchiseByReleaseCache = new Map<number, ResolvedFranchise | null>();
const franchisePending = new Map<number, Promise<ResolvedFranchise | null>>();
const groupedSearchCache = new Map<string, SearchGroupItem[]>();

function mapFranchiseSeasons(rawList: RawFranchiseReleaseNode[]): AnimeSeasonEntry[] {
  const valid = rawList
    .filter((node) => node.release && !node.release.is_blocked_by_copyrights)
    .sort((a, b) => {
      const sortDiff = (a.sort_order ?? 9999) - (b.sort_order ?? 9999);
      if (sortDiff !== 0) return sortDiff;
      return (a.release?.year ?? 9999) - (b.release?.year ?? 9999);
    });

  let seasonOrdinal = 0;
  let movieOrdinal = 0;
  const movieCount = valid.filter((n) => n.release?.type?.value === 'MOVIE').length;

  return valid.map((node, index) => {
    const r = node.release!;
    const typeVal = inferReleaseTypeValue(
      r.type?.value,
      r.name?.main,
      r.name?.english,
      r.alias
    );
    let shortLabel: string;

    if (typeVal === 'MOVIE') {
      movieOrdinal += 1;
      shortLabel = movieCount > 1 ? `Movie ${movieOrdinal}` : 'Movie';
    } else if (typeVal === 'OVA' || typeVal === 'SPECIAL') {
      shortLabel = typeVal === 'OVA' ? 'OVA' : 'Special';
    } else if (typeVal === 'TV' || typeVal === 'ONA' || typeVal === 'WEB') {
      seasonOrdinal += 1;
      shortLabel = `Season ${seasonOrdinal}`;
    } else {
      shortLabel = `Part ${index + 1}`;
    }

    const poster = resolveLibUrl(
      r.poster?.optimized?.src || r.poster?.src || r.poster?.optimized?.preview || r.poster?.preview
    );

    return {
      id: r.id,
      alias: r.alias,
      shikiId: r.shikimori?.id ?? undefined,
      title: r.name?.english || r.name?.main || 'Anime',
      titleEnglish: r.name?.english || undefined,
      shortLabel,
      year: r.year ?? undefined,
      typeLabel: r.type?.value || r.type?.description || undefined,
      episodesTotal: r.episodes_total ?? undefined,
      poster
    };
  });
}

async function resolveFranchiseByReleaseId(releaseId: number): Promise<ResolvedFranchise | null> {
  if (franchiseByReleaseCache.has(releaseId)) {
    return franchiseByReleaseCache.get(releaseId) ?? null;
  }
  const existing = franchisePending.get(releaseId);
  if (existing) {
    return existing;
  }

  const req = (async (): Promise<ResolvedFranchise | null> => {
    try {
      const payload = await fetchLibJson<RawFranchise | RawFranchise[] | null>(
        `/anime/franchises/release/${releaseId}`,
        undefined,
        3500
      );
      const raw = Array.isArray(payload) ? payload[0] : payload;
      if (!raw || !Array.isArray(raw.franchise_releases) || raw.franchise_releases.length === 0) {
        setBoundedCache(franchiseByReleaseCache, releaseId, null, MAX_FRANCHISE_CACHE);
        return null;
      }

      const seasons = mapFranchiseSeasons(raw.franchise_releases);
      if (seasons.length === 0) {
        setBoundedCache(franchiseByReleaseCache, releaseId, null, MAX_FRANCHISE_CACHE);
        return null;
      }

      const resolved: ResolvedFranchise = {
        id: raw.id,
        name: raw.name ?? undefined,
        nameEnglish: raw.name_english ?? undefined,
        seasons
      };

      setBoundedCache(franchiseByReleaseCache, releaseId, resolved, MAX_FRANCHISE_CACHE);
      for (const s of seasons) {
        setBoundedCache(franchiseByReleaseCache, s.id, resolved, MAX_FRANCHISE_CACHE);
      }
      return resolved;
    } catch {
      return null;
    } finally {
      franchisePending.delete(releaseId);
    }
  })();

  franchisePending.set(releaseId, req);
  return req;
}

export async function loadFranchiseSeasons(releaseId: number): Promise<AnimeSeasonEntry[]> {
  const resolved = await resolveFranchiseByReleaseId(releaseId);
  return resolved?.seasons ?? [];
}

export function stripSeasonSuffix(title: string): string {
  return title
    .replace(
      /\s*[:\-–]?\s*(?:the\s+)?(\d+(?:st|nd|rd|th)\s+season|season\s+\d+|tv\s+\d+|part\s+\d+|cour\s+\d+|final\s+season|final\s+chapters|сезон\s+\d+|\d+\s+сезон|часть\s+\d+)(?![a-z0-9а-яё]).*$/i,
      ''
    )
    .replace(/\s+\b(II|III|IV|V)\b$/i, '')
    .trim();
}

function releaseCandidateToSearchItem(
  r: RawLibFeedItem,
  franchise: ResolvedFranchise | null,
  extraSeasonCount = 1
): SearchGroupItem {
  const seasons = franchise?.seasons ?? [];
  const rootSeason = seasons.find((s) => s.shortLabel.startsWith('Season')) ?? seasons[0];
  const isSingleSpecialOrOva =
    seasons.length === 1 &&
    (rootSeason?.shortLabel === 'Special' || rootSeason?.shortLabel === 'OVA');

  const baseTitle = isSingleSpecialOrOva
    ? rootSeason?.titleEnglish || rootSeason?.title || r.name?.english || r.name?.main || 'Anime'
    : franchise?.nameEnglish ||
      rootSeason?.titleEnglish ||
      rootSeason?.title ||
      r.name?.english ||
      r.name?.main ||
      'Anime';
  const cleanTitle = stripSeasonSuffix(baseTitle) || baseTitle;
  const targetSeason = rootSeason ?? null;

  const poster =
    targetSeason?.poster ||
    resolveLibUrl(r.poster?.optimized?.src || r.poster?.src || r.poster?.preview);

  const queries = [
    targetSeason?.titleEnglish ?? '',
    targetSeason?.title ?? '',
    franchise?.nameEnglish ?? '',
    franchise?.name ?? '',
    r.name?.english ?? '',
    r.name?.main ?? ''
  ].filter(Boolean);

  const shikiId = targetSeason?.shikiId ?? r.shikimori?.id ?? undefined;
  const shiki = shikiId ? shikiCache.get(shikiId) : undefined;

  const rawScore =
    (shiki?.score && shiki.score > 0 ? shiki.score : 0) ||
    r.shikimori?.rating ||
    r.mal?.rating ||
    r.rating?.average ||
    0;
  const libGenres = (r.genres ?? [])
    .map((g) => translateGenreName(g?.name))
    .filter((g): g is string => Boolean(g));
  const genres = libGenres.length > 0 ? libGenres : (shiki?.genres ?? []);
  const genreIds = (r.genres ?? [])
    .map((g) => g?.id)
    .filter((id): id is number => typeof id === 'number' && id > 0);
  const epCount =
    (typeof targetSeason?.episodesTotal === 'number' && targetSeason.episodesTotal > 0
      ? targetSeason.episodesTotal
      : undefined) ??
    (typeof r.episodes_total === 'number' && r.episodes_total > 0 ? r.episodes_total : undefined) ??
    (typeof r.latest_episode?.ordinal === 'number' && r.latest_episode.ordinal > 0
      ? r.latest_episode.ordinal
      : undefined) ??
    (shiki?.episodes && shiki.episodes > 0 ? shiki.episodes : undefined) ??
    (shiki?.episodesAired && shiki.episodesAired > 0 ? shiki.episodesAired : undefined);

  const fallbackTitle = targetSeason?.title || r.name?.main || '';
  return {
    id: franchise ? `fr-${franchise.id}` : `rel-${r.id}`,
    title: cleanTitle,
    subTitle:
      i18n.locale === 'ru' && fallbackTitle && fallbackTitle !== cleanTitle ? fallbackTitle : undefined,
    year: targetSeason?.year ?? r.year ?? shiki?.year ?? undefined,
    score: rawScore > 0 ? Number(rawScore.toFixed(1)) : undefined,
    typeLabel: targetSeason?.typeLabel ?? r.type?.value ?? r.type?.description ?? 'TV',
    isOngoing: r.is_ongoing,
    episodesTotal: epCount,
    genres: genres.length > 0 ? genres : undefined,
    genreIds: genreIds.length > 0 ? genreIds : undefined,
    poster,
    shikiId,
    releaseAlias: targetSeason?.alias ?? r.alias,
    searchQueries: Array.from(new Set(queries)),
    seasonCount: Math.max(seasons.length, extraSeasonCount)
  };
}

let catalogGenresCache: CatalogGenreOption[] | null =
  readPersistedCache<CatalogGenreOption[]>(GENRES_CACHE_KEY, GENRES_CACHE_TTL_MS)?.data ?? null;
let catalogGenresPending: Promise<CatalogGenreOption[]> | null = null;

export async function loadCatalogGenres(signal?: AbortSignal): Promise<CatalogGenreOption[]> {
  if (catalogGenresCache) return catalogGenresCache;
  if (catalogGenresPending) return catalogGenresPending;

  catalogGenresPending = (async () => {
    try {
      const raw = await fetchLibJson<
        Array<{ id?: number; name?: string | null; total_releases?: number | null }>
      >(`/anime/catalog/references/genres`, { signal }, 4500);
      if (!Array.isArray(raw)) return [];
      const mapped = raw
        .filter((g): g is { id: number; name: string; total_releases?: number | null } =>
          Boolean(g && typeof g.id === 'number' && g.name?.trim())
        )
        .map((g) => ({
          id: g.id,
          name: translateGenreName(g.name),
          totalReleases: typeof g.total_releases === 'number' ? g.total_releases : undefined
        }))
        .sort((a, b) => (b.totalReleases ?? 0) - (a.totalReleases ?? 0));
      if (mapped.length > 0) {
        catalogGenresCache = mapped;
        writePersistedCache(GENRES_CACHE_KEY, mapped);
      }
      return mapped;
    } catch {
      return [];
    } finally {
      catalogGenresPending = null;
    }
  })();

  return catalogGenresPending;
}

interface RawShikiRestAnime {
  id: number;
  name?: string | null;
  russian?: string | null;
  kind?: string | null;
  score?: string | number | null;
  status?: string | null;
  episodes?: number | null;
  episodes_aired?: number | null;
  aired_on?: string | null;
  image?: {
    original?: string | null;
    preview?: string | null;
  } | null;
}

const EN_TO_RU_KEY: Record<string, string> = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
  a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
  z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю'
};
const RU_TO_EN_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(EN_TO_RU_KEY).map(([en, ru]) => [ru, en])
);

function swapKeyboardLayout(raw: string): string {
  const lower = raw.toLowerCase();
  const hasCyr = /[а-яё]/i.test(lower);
  const map = hasCyr ? RU_TO_EN_KEY : EN_TO_RU_KEY;
  let out = '';
  let changed = false;
  for (let i = 0; i < lower.length; i += 1) {
    const ch = lower[i];
    if (map[ch]) {
      out += map[ch];
      changed = true;
    } else {
      out += ch;
    }
  }
  return changed ? out.trim() : '';
}

function parseYearFromDate(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^(\d{4})/);
  if (!m) return undefined;
  const y = Number(m[1]);
  return Number.isFinite(y) && y > 1900 ? y : undefined;
}

async function fetchShikimoriRestSearch(
  query: string,
  o: SearchQueryOptions,
  filter: SearchFilterMode,
  signal?: AbortSignal
): Promise<RawShikiRestAnime[]> {
  const params = new URLSearchParams({
    limit: '32',
    censored: 'false'
  });
  if (query.length >= 2) params.set('search', query);
  const order =
    o.sorting === 'RATING_DESC'
      ? 'ranked'
      : o.sorting === 'FRESH_AT_DESC'
        ? 'aired_on'
        : 'popularity';
  params.set('order', order);
  if (filter === 'ongoing') params.set('status', 'ongoing');
  if (o.type) params.set('kind', o.type.toLowerCase());
  if (o.minScore && o.minScore > 0) params.set('score', String(Math.floor(o.minScore)));

  try {
    const rows = await fetchJsonWithTimeout<RawShikiRestAnime[]>(
      `${SHIKI_REST_ANIMES}?${params.toString()}`,
      { signal },
      5500
    );
    return Array.isArray(rows) ? rows.filter((r) => r && r.id > 0) : [];
  } catch {
    return [];
  }
}

function scoreSearchRelevance(item: SearchGroupItem, rawQuery: string): number {
  const qNorm = normalizeTitleText(rawQuery);
  if (!qNorm) return item.score ?? 0;

  let best = 0;
  const fields = [item.title, item.subTitle, ...(item.searchQueries ?? [])]
    .map((s) => normalizeTitleText(s ?? ''))
    .filter(Boolean);

  for (const field of fields) {
    if (field === qNorm) {
      best = Math.max(best, 10_000);
    } else if (field.startsWith(qNorm)) {
      best = Math.max(best, 6_000);
    } else if (` ${field} `.includes(` ${qNorm} `)) {
      best = Math.max(best, 4_000);
    } else if (field.includes(qNorm)) {
      best = Math.max(best, 2_000);
    }
  }

  const qTokens = titleTokens(rawQuery);
  if (best === 0 && qTokens.length > 0) {
    for (const field of fields) {
      const fTokens = new Set(titleTokens(field));
      const matched = qTokens.filter((t) => fTokens.has(t)).length;
      if (matched > 0) {
        best = Math.max(best, Math.round((matched / qTokens.length) * 1_500));
      }
    }
  }

  const playableBoost = item.releaseAlias ? 180 : 0;
  const scoreBoost = (item.score ?? 0) * 20;
  return best + playableBoost + scoreBoost;
}

export async function searchGroupedAnime(
  rawQuery: string,
  opts?: AbortSignal | SearchQueryOptions
): Promise<SearchGroupItem[]> {
  const signal = opts instanceof AbortSignal ? opts : opts?.signal;
  const o: SearchQueryOptions = opts && !(opts instanceof AbortSignal) ? opts : {};
  const filter: SearchFilterMode = o.filter ?? 'all';
  const query = rawQuery.trim();
  const hasAdvancedFilter = Boolean(
    o.fromYear ||
      o.toYear ||
      o.minScore ||
      o.minEpisodes ||
      o.maxEpisodes ||
      o.type ||
      (o.genreIds && o.genreIds.length > 0) ||
      o.sorting
  );
  if (filter === 'library' || signal?.aborted) return [];

  const sortedGenres = o.genreIds?.length ? [...o.genreIds].sort((a, b) => a - b).join(',') : '';
  const cacheKey = [
    filter,
    query.toLowerCase(),
    o.fromYear ?? '',
    o.toYear ?? '',
    o.minEpisodes ?? '',
    o.maxEpisodes ?? '',
    o.minScore ?? '',
    o.type ?? '',
    sortedGenres,
    o.sorting ?? ''
  ].join('|');

  const cached = groupedSearchCache.get(cacheKey);
  if (cached) return cached;

  const catalogParams = new URLSearchParams({ limit: '50', page: '1' });
  if (query.length >= 2) catalogParams.set('f[search]', query);
  if (filter === 'ongoing') {
    catalogParams.set('f[publish_statuses]', 'IS_ONGOING');
  }
  if (o.fromYear) catalogParams.set('f[years][from_year]', String(o.fromYear));
  if (o.toYear) catalogParams.set('f[years][to_year]', String(o.toYear));
  if (o.type) catalogParams.set('f[types]', o.type);
  if (sortedGenres) catalogParams.set('f[genres]', sortedGenres);

  const effectiveSort =
    o.sorting ||
    (o.minScore && o.minScore > 0
      ? 'RATING_DESC'
      : filter === 'ongoing'
        ? 'FRESH_AT_DESC'
        : query.length === 0
          ? 'RATING_DESC'
          : '');
  if (effectiveSort) catalogParams.set('f[sorting]', effectiveSort);

  const catalogParamsPage2 = new URLSearchParams(catalogParams);
  catalogParamsPage2.set('page', '2');

  const catalogPath1 = `/anime/catalog/releases?${catalogParams.toString()}`;
  const catalogPath2 = `/anime/catalog/releases?${catalogParamsPage2.toString()}`;
  const useAppSearch = filter === 'all' && !hasAdvancedFilter && query.length >= 2;
  const needPage2 = query.length < 2 || hasAdvancedFilter || filter === 'ongoing';
  const hasGenreIds = Boolean(o.genreIds && o.genreIds.length > 0);
  const swappedQuery = query.length >= 3 ? swapKeyboardLayout(query) : '';

  const [appRes, catRes1, catRes2, shikiRestRes, shikiSwapRes, dcRes, avRes] = await Promise.allSettled([
    useAppSearch
      ? fetchLibJson<RawLibFeedItem[]>(
          `/app/search/releases?query=${encodeURIComponent(query)}`,
          { signal },
          4500
        )
      : Promise.resolve([] as RawLibFeedItem[]),
    fetchLibJson<{ data?: RawLibFeedItem[] }>(catalogPath1, { signal }, 5000),
    needPage2
      ? fetchLibJson<{ data?: RawLibFeedItem[] }>(catalogPath2, { signal }, 5000)
      : Promise.resolve({ data: [] as RawLibFeedItem[] }),
    !hasGenreIds && query.length >= 2
      ? fetchShikimoriRestSearch(query, o, filter, signal)
      : Promise.resolve([] as RawShikiRestAnime[]),
    !hasGenreIds && swappedQuery.length >= 3 && swappedQuery !== query.toLowerCase()
      ? fetchShikimoriRestSearch(swappedQuery, o, filter, signal)
      : Promise.resolve([] as RawShikiRestAnime[]),
    !hasGenreIds && filter !== 'ongoing' && query.length >= 2
      ? dreamCastLoader.load().then((m) => m.searchDreamCast(query)).catch(() => [])
      : Promise.resolve([]),
    !hasGenreIds && filter !== 'ongoing' && query.length >= 2
      ? animeVostLoader.load().then((m) => m.searchAnimeVost(query)).catch(() => [])
      : Promise.resolve([])
  ]);
  if (signal?.aborted) return [];

  const rawHits: RawLibFeedItem[] = [];
  const seenIds = new Set<number>();
  for (const item of [
    ...(catRes1.status === 'fulfilled' && Array.isArray(catRes1.value?.data) ? catRes1.value.data : []),
    ...(appRes.status === 'fulfilled' && Array.isArray(appRes.value) ? appRes.value : []),
    ...(catRes2.status === 'fulfilled' && Array.isArray(catRes2.value?.data) ? catRes2.value.data : [])
  ]) {
    if (!item?.id || !item.alias || item.is_blocked_by_copyrights || seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    rawHits.push(item);
  }

  const candidates = rawHits.slice(0, 90);

  // Prefetch franchise info so multi-season titles collapse into one root group.
  // One request per distinct title key; resolveFranchiseByReleaseId caches every
  // season of a franchise, so siblings resolve from cache afterwards.
  const prefetchByTitleKey = new Map<string, number>();
  for (const hit of candidates) {
    if (franchiseByReleaseCache.has(hit.id)) continue;
    const key = franchiseKey(hit.name?.english || hit.name?.main || '') || `rel:${hit.id}`;
    if (!prefetchByTitleKey.has(key)) prefetchByTitleKey.set(key, hit.id);
  }
  const prefetchIds = Array.from(prefetchByTitleKey.values()).slice(0, 20);
  if (prefetchIds.length > 0) {
    await Promise.allSettled(prefetchIds.map((id) => resolveFranchiseByReleaseId(id)));
  }
  if (signal?.aborted) return [];

  const rootTitles = new Set<string>();
  for (const hit of candidates) {
    const t = hit.name?.english || hit.name?.main || '';
    const n = normalizeTitleText(stripSeasonSuffix(t));
    if (n) rootTitles.add(n);
  }

  // Batch-enrich any candidates missing ratings that have a Shikimori ID
  const missingScoreShikiIds = candidates
    .filter((hit) => !(hit.shikimori?.rating || hit.mal?.rating || hit.rating?.average) && hit.shikimori?.id)
    .map((hit) => hit.shikimori!.id!)
    .filter((id) => id > 0 && !shikiCache.has(id))
    .slice(0, 40);
  if (missingScoreShikiIds.length > 0) {
    await ensureShikimoriArtwork(missingScoreShikiIds).catch(() => {});
  }
  if (signal?.aborted) return [];

  interface PendingGroup {
    item: SearchGroupItem;
    earliestYear: number;
    count: number;
    hasFranchise: boolean;
  }

  const groups = new Map<string, PendingGroup>();
  const orderedKeys: string[] = [];
  const shikiToGroupKey = new Map<number, string>();
  const normTitleToGroupKey = new Map<string, string>();

  const registerKeys = (groupKey: string, item: SearchGroupItem) => {
    if (item.shikiId && !shikiToGroupKey.has(item.shikiId)) {
      shikiToGroupKey.set(item.shikiId, groupKey);
    }
    for (const qTitle of [item.title, item.subTitle, ...(item.searchQueries ?? [])]) {
      for (const n of titleGroupVariants(qTitle ?? '')) {
        if (!normTitleToGroupKey.has(n)) {
          normTitleToGroupKey.set(n, groupKey);
        }
      }
    }
  };

  const findGroupKeyByTitle = (rawTitle: string): string | undefined => {
    for (const n of titleGroupVariants(rawTitle)) {
      const key = normTitleToGroupKey.get(n);
      if (key) return key;
    }
    return undefined;
  };

  for (let i = 0; i < candidates.length; i += 1) {
    const hit = candidates[i];
    const franchise = franchiseByReleaseCache.get(hit.id) ?? null;
    const fallbackTitle = hit.name?.english || hit.name?.main || '';
    const fKey = computeTitleGroupKey(fallbackTitle, rootTitles);
    const groupKey = franchise
      ? `fr:${franchise.id}`
      : fKey
        ? `title:${fKey}`
        : `rel:${hit.id}`;

    const candidateItem = releaseCandidateToSearchItem(hit, franchise, 1);
    const existing = groups.get(groupKey);
    if (!existing) {
      orderedKeys.push(groupKey);
      groups.set(groupKey, {
        item: candidateItem,
        earliestYear: hit.year ?? 9999,
        count: 1,
        hasFranchise: Boolean(franchise)
      });
      registerKeys(groupKey, candidateItem);
      continue;
    }

    existing.count += 1;
    if (!existing.item.score && candidateItem.score) {
      existing.item.score = candidateItem.score;
    }
    if (!existing.item.episodesTotal && candidateItem.episodesTotal) {
      existing.item.episodesTotal = candidateItem.episodesTotal;
    }
    if ((!existing.item.genres || existing.item.genres.length === 0) && candidateItem.genres) {
      existing.item.genres = candidateItem.genres;
    }
    if (!existing.hasFranchise) {
      const hitYear = hit.year ?? 9999;
      if (hitYear < existing.earliestYear) {
        const prevScore = existing.item.score;
        const prevEp = existing.item.episodesTotal;
        const prevGenres = existing.item.genres;
        existing.earliestYear = hitYear;
        existing.item = releaseCandidateToSearchItem(hit, franchise, existing.count);
        if (!existing.item.score && prevScore) existing.item.score = prevScore;
        if (!existing.item.episodesTotal && prevEp) existing.item.episodesTotal = prevEp;
        if ((!existing.item.genres || existing.item.genres.length === 0) && prevGenres) {
          existing.item.genres = prevGenres;
        }
      } else {
        existing.item.seasonCount = Math.max(existing.item.seasonCount, existing.count);
      }
    }
    registerKeys(groupKey, candidateItem);
  }

  // Merge comprehensive Shikimori catalog matches (Russian, English, Romaji & older classics)
  const shikiRestRows: RawShikiRestAnime[] = [
    ...(shikiRestRes.status === 'fulfilled' ? shikiRestRes.value : []),
    ...(shikiSwapRes.status === 'fulfilled' ? shikiSwapRes.value : [])
  ];
  const seenShikiIds = new Set<number>();
  for (const s of shikiRestRows) {
    if (!s?.id || seenShikiIds.has(s.id)) continue;
    seenShikiIds.add(s.id);
    if (s.status === 'anons') continue;

    const engTitle = (s.name ?? '').trim();
    const ruTitle = (s.russian ?? '').trim();
    const title = stripSeasonSuffix(engTitle || ruTitle) || engTitle || ruTitle || 'Anime';
    const subTitle = ruTitle && ruTitle !== title ? ruTitle : undefined;
    const queries = dedupeSearchQueries([ruTitle, engTitle]);
    const parsedScore = Number(s.score);
    const score = Number.isFinite(parsedScore) && parsedScore > 0 ? Number(parsedScore.toFixed(1)) : undefined;
    const year = parseYearFromDate(s.aired_on);
    const epCount =
      (typeof s.episodes === 'number' && s.episodes > 0 ? s.episodes : undefined) ??
      (typeof s.episodes_aired === 'number' && s.episodes_aired > 0 ? s.episodes_aired : undefined);

    const existingKey =
      shikiToGroupKey.get(s.id) ??
      findGroupKeyByTitle(engTitle) ??
      findGroupKeyByTitle(ruTitle);

    if (existingKey && groups.has(existingKey)) {
      const existing = groups.get(existingKey)!;
      if (!existing.item.shikiId) existing.item.shikiId = s.id;
      if (!existing.item.score && score) existing.item.score = score;
      if (!existing.item.subTitle && subTitle) existing.item.subTitle = subTitle;
      if (!existing.item.episodesTotal && epCount) existing.item.episodesTotal = epCount;
      existing.item.searchQueries = dedupeSearchQueries([
        ...(existing.item.searchQueries ?? []),
        ...queries
      ]);
      registerKeys(existingKey, existing.item);
      continue;
    }

    const groupKey = `shiki:${s.id}`;
    const item: SearchGroupItem = {
      id: `shiki-${s.id}`,
      title,
      subTitle,
      year,
      score,
      typeLabel: (s.kind ?? 'tv').toUpperCase(),
      isOngoing: s.status === 'ongoing',
      episodesTotal: epCount,
      poster: resolveShikiUrl(s.image?.original || s.image?.preview),
      shikiId: s.id,
      searchQueries: queries,
      seasonCount: 1
    };
    orderedKeys.push(groupKey);
    groups.set(groupKey, {
      item,
      earliestYear: year ?? 9999,
      count: 1,
      hasFranchise: false
    });
    registerKeys(groupKey, item);
  }

  // Merge Dream Cast hits for Russian/native dub matches
  if (dcRes.status === 'fulfilled' && Array.isArray(dcRes.value)) {
    for (const dc of dcRes.value.slice(0, 8)) {
      const ru = (dc.russian ?? '').trim();
      const orig = (dc.original ?? '').trim();
      const title = orig || ru;
      if (!title) continue;
      if (findGroupKeyByTitle(ru) || findGroupKeyByTitle(orig)) {
        continue;
      }
      const yearNum = Number(dc.dateissue) || undefined;
      const groupKey = `dc:${dc.id}`;
      const posterRaw = (dc.image ?? '').trim();
      const item: SearchGroupItem = {
        id: `dc-${dc.id}`,
        title,
        subTitle: ru && ru !== title ? ru : undefined,
        year: yearNum,
        typeLabel: 'TV',
        episodesTotal: (dc.series ?? dc.currentSeries) || undefined,
        poster: posterRaw.startsWith('//') ? `https:${posterRaw}` : posterRaw,
        searchQueries: dedupeSearchQueries([ru, orig]),
        seasonCount: 1
      };
      orderedKeys.push(groupKey);
      groups.set(groupKey, {
        item,
        earliestYear: yearNum ?? 9999,
        count: 1,
        hasFranchise: false
      });
      registerKeys(groupKey, item);
    }
  }

  // Merge AnimeVost hits for native MP4 & Russian titles
  if (avRes.status === 'fulfilled' && Array.isArray(avRes.value) && avRes.value.length > 0) {
    const { splitAnimeVostTitles } = await animeVostLoader.load();
    for (const av of avRes.value.slice(0, 8)) {
      const parts = splitAnimeVostTitles(av.title);
      const ru = parts[0] ?? '';
      const orig = parts[1] ?? '';
      const title = orig || ru;
      if (!title) continue;
      if (parts.some((p) => findGroupKeyByTitle(p))) {
        continue;
      }
      const yearNum = Number(av.year) || undefined;
      const groupKey = `av:${av.id}`;
      const item: SearchGroupItem = {
        id: `av-${av.id}`,
        title,
        subTitle: ru && ru !== title ? ru : undefined,
        year: yearNum,
        typeLabel: av.type || 'TV',
        poster: av.urlImagePreview || '',
        searchQueries: dedupeSearchQueries(parts),
        seasonCount: 1
      };
      orderedKeys.push(groupKey);
      groups.set(groupKey, {
        item,
        earliestYear: yearNum ?? 9999,
        count: 1,
        hasFranchise: false
      });
      registerKeys(groupKey, item);
    }
  }

  let grouped = orderedKeys
    .map((k) => groups.get(k)!.item)
    .filter((item) => {
      if (o.fromYear && item.year && item.year < o.fromYear) return false;
      if (o.toYear && item.year && item.year > o.toYear) return false;
      if (o.minScore && o.minScore > 0) {
        if (!item.score || item.score < o.minScore) return false;
      }
      if (o.minEpisodes && o.minEpisodes > 1) {
        if (item.episodesTotal != null && item.episodesTotal < o.minEpisodes) return false;
      }
      if (o.maxEpisodes && o.maxEpisodes > 0) {
        if (item.episodesTotal != null && item.episodesTotal > o.maxEpisodes) return false;
      }
      return true;
    });

  if (query.length >= 2 && !o.sorting) {
    grouped.sort((a, b) => scoreSearchRelevance(b, query) - scoreSearchRelevance(a, query));
  }

  grouped = grouped.slice(0, 50);
  if (grouped.length > 0) {
    setBoundedCache(groupedSearchCache, cacheKey, grouped, MAX_GROUPED_SEARCH_CACHE);
  }
  return grouped;
}

export function buildPrimaryVoiceOption(rel: PlayableRelease): VoiceTrackOption {
  const provider = rel.provider ?? 'aniliberty';
  const cast = rel.voiceActors?.slice(0, 3).join(', ');
  const epPart = rel.episodes.length > 0 ? `${rel.episodes.length} ep` : '';
  const kindTag =
    provider === 'dreamcast' || provider === 'hentaimama' || provider === 'zoko'
      ? '1080p HLS'
      : provider === 'animevost' || provider === 'hentaigasm'
        ? 'MP4'
        : '';
  const defaultLabel =
    provider === 'dreamcast'
      ? 'Dream Cast'
      : provider === 'animevost'
        ? 'AnimeVost'
        : provider === 'hentaimama'
          ? 'HentaiMama'
          : provider === 'hentaigasm'
            ? 'HentaiGasm'
            : provider === 'zoko'
              ? 'English Dub'
              : 'AniLibria';
  const sublabel = cast || [epPart, kindTag].filter(Boolean).join(' · ') || undefined;
  return {
    id: rel.alias,
    label: rel.voiceLabel || defaultLabel,
    sublabel,
    releaseAlias: provider === 'aniliberty' ? rel.alias : undefined,
    provider,
    providerId: rel.id,
    sourceId: rel.primarySourceId,
    isSub: rel.primaryIsSub,
    kind: provider === 'animevost' || provider === 'hentaigasm' ? 'mp4' : 'hls'
  };
}

export async function resolveVoiceTrackRelease(
  voice: VoiceTrackOption,
  baseRelease: PlayableRelease | null,
  target: WatchTarget
): Promise<PlayableRelease> {
  const shikiArt = target.shikiId ? shikiCache.get(target.shikiId) : undefined;
  if (voice.provider === 'dreamcast') {
    const releaseId = Number(voice.providerId);
    const releaseUrl = typeof voice.sourceId === 'string' ? voice.sourceId : '';
    const { fetchDreamCastEpisodes } = await dreamCastLoader.load();
    const episodes = await fetchDreamCastEpisodes(releaseId, releaseUrl);
    if (episodes.length === 0) {
      throw new Error(`Dream Cast: no episodes available for ${target.title}`);
    }
    return {
      ...(baseRelease ?? {
        id: releaseId,
        title: shikiArt?.english || shikiArt?.name || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain,
        banner: shikiArt?.screenshots?.[0]
      }),
      id: releaseId,
      alias: voice.id,
      provider: 'dreamcast',
      voiceLabel: voice.label,
      voiceActors: undefined,
      episodes: mergeBaseEpisodeMetadata(episodes, baseRelease?.episodes)
    };
  }

  if (voice.provider === 'animego') {
    const animeId = Number(voice.providerId);
    const rawSource = typeof voice.sourceId === 'string' ? voice.sourceId : '';
    const parts = rawSource.split('|');
    let providerSlug = '';
    let trId = rawSource;
    let embedUrl = '';
    if (parts.length >= 3 && (parts[0] === 'aniboom' || parts[0] === 'kodik')) {
      providerSlug = parts[0];
      trId = parts[1];
      embedUrl = parts.slice(2).join('|');
    } else if (parts.length >= 2) {
      trId = parts[0];
      embedUrl = parts.slice(1).join('|');
    }
    const { fetchAnimeGOEpisodes } = await animeGoLoader.load();
    const episodes = await fetchAnimeGOEpisodes(animeId, trId, embedUrl, providerSlug);
    if (episodes.length === 0) {
      throw new Error(`AnimeGO: no episodes available for ${target.title}`);
    }
    return {
      ...(baseRelease ?? {
        id: animeId,
        title: shikiArt?.english || shikiArt?.name || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain,
        banner: shikiArt?.screenshots?.[0]
      }),
      id: animeId,
      alias: voice.id,
      provider: 'animego',
      voiceLabel: voice.label,
      voiceActors: undefined,
      episodes: mergeBaseEpisodeMetadata(episodes, baseRelease?.episodes)
    };
  }

  if (voice.provider === 'kodik') {
    const yaniId = Number(voice.providerId);
    const studioKey = typeof voice.sourceId === 'string' ? voice.sourceId : '';
    const { fetchKodikEpisodes } = await kodikLoader.load();
    const episodes = await fetchKodikEpisodes(yaniId, studioKey);
    if (episodes.length === 0) {
      throw new Error(`Kodik: no episodes available for ${target.title}`);
    }
    return {
      ...(baseRelease ?? {
        id: yaniId,
        title: shikiArt?.english || shikiArt?.name || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain,
        banner: shikiArt?.screenshots?.[0]
      }),
      id: yaniId,
      alias: voice.id,
      provider: 'kodik',
      voiceLabel: voice.label,
      voiceActors: undefined,
      episodes: mergeBaseEpisodeMetadata(episodes, baseRelease?.episodes)
    };
  }

  if (voice.provider === 'animevost') {
    const releaseId = Number(voice.providerId);
    const { fetchAnimeVostEpisodes } = await animeVostLoader.load();
    const episodes = await fetchAnimeVostEpisodes(releaseId);
    if (episodes.length === 0) {
      throw new Error(`AnimeVost: no episodes available for ${target.title}`);
    }
    return {
      ...(baseRelease ?? {
        id: releaseId,
        title: shikiArt?.english || shikiArt?.name || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain,
        banner: shikiArt?.screenshots?.[0]
      }),
      id: releaseId,
      alias: voice.id,
      provider: 'animevost',
      voiceLabel: voice.label,
      voiceActors: undefined,
      episodes: mergeBaseEpisodeMetadata(episodes, baseRelease?.episodes)
    };
  }

  if (voice.provider === 'zoko') {
    const malId = Number(voice.providerId) || Number(target.shikiId) || 0;
    const mode = voice.sourceId === 'sub' ? 'sub' : 'dub';
    const { fetchZokoEpisodes } = await zokoLoader.load();
    const episodes = await fetchZokoEpisodes(
      malId,
      mode,
      shikiArt?.episodes ?? baseRelease?.episodes?.length ?? null,
      dedupeSearchQueries([shikiArt?.english, shikiArt?.name, target.title])
    );
      if (episodes.length === 0) {
      throw new Error(`${voice.label}: no episodes available for ${target.title}`);
    }
    return {
      ...(baseRelease ?? {
        id: malId,
        title: shikiArt?.english || shikiArt?.name || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain,
        banner: shikiArt?.screenshots?.[0]
      }),
      id: malId,
      alias: voice.id,
      provider: 'zoko',
      voiceLabel: voice.label,
      voiceActors: undefined,
      episodes: mergeBaseEpisodeMetadata(episodes, baseRelease?.episodes)
    };
  }

  if (voice.provider === 'hentaimama' || voice.provider === 'hentaigasm') {
    const hentaiTarget = typeof voice.sourceId === 'string' ? voice.sourceId : '';
    const { fetchHentaiEpisodes } = await hentaiLoader.load();
    const episodes = await fetchHentaiEpisodes(voice.provider, hentaiTarget);
      if (episodes.length === 0) {
      throw new Error(`${voice.label}: no episodes available for ${target.title}`);
    }
    const releaseId = Number(voice.providerId) || 900_000_001;
    return {
      ...(baseRelease ?? {
        id: releaseId,
        title: shikiArt?.english || shikiArt?.name || target.title,
        titleEnglish: shikiArt?.english || shikiArt?.name,
        year: shikiArt?.year,
        poster: shikiArt?.posterOriginal || shikiArt?.posterMain,
        banner: shikiArt?.screenshots?.[0]
      }),
      id: releaseId,
      alias: voice.id,
      provider: voice.provider,
      voiceLabel: voice.label,
      voiceActors: undefined,
      episodes: mergeBaseEpisodeMetadata(episodes, baseRelease?.episodes)
    };
  }

  const resolved = await resolvePlayableRelease({
    ...target,
    releaseAlias: voice.releaseAlias || voice.id
  });
  return {
    ...resolved,
    voiceLabel: resolved.voiceLabel || voice.label,
    episodes: mergeBaseEpisodeMetadata(resolved.episodes, baseRelease?.episodes)
  };
}

export async function findVoiceOptions(
  primary: PlayableRelease,
  shikiId?: number,
  extraTitles?: string[]
): Promise<VoiceTrackOption[]> {
  const base = buildPrimaryVoiceOption(primary);
  const options: VoiceTrackOption[] = [base];
  const seenIds = new Set<string>([base.id]);
  let shikiArt = shikiId ? shikiCache.get(shikiId) : undefined;
  if (shikiId && !shikiArt) {
    shikiArt = await ensureShikimoriArtwork([shikiId])
      .then((m) => m.get(shikiId))
      .catch(() => undefined);
  }
  const searchTitles = dedupeSearchQueries([
    shikiArt?.russian,
    primary.title,
    primary.titleEnglish,
    shikiArt?.english,
    shikiArt?.name,
    ...(extraTitles ?? [])
  ]);
  const primaryProvider = primary.provider ?? 'aniliberty';
  const isHentaiPrimary = primaryProvider === 'hentaimama' || primaryProvider === 'hentaigasm';
  const libQueries = dedupeSearchQueries([
    primary.titleEnglish,
    primary.title,
    shikiArt?.english,
    shikiArt?.name,
    shikiArt?.russian,
    ...(extraTitles ?? [])
  ]).slice(0, 3);

  const libPromise =
    !isHentaiPrimary && libQueries.length > 0
      ? Promise.allSettled([
          ...libQueries.map((q) =>
            fetchLibJson<LibSearchCandidate[]>(
              `/app/search/releases?query=${encodeURIComponent(q)}`,
              undefined,
              4500
            )
          ),
          ...libQueries.slice(0, 2).map((q) =>
            fetchLibJson<{ data?: LibSearchCandidate[] }>(
              `/anime/catalog/releases?f[search]=${encodeURIComponent(q)}&limit=12`,
              undefined,
              4500
            )
          )
        ])
      : Promise.resolve(null);

  const dcPromise =
    !isHentaiPrimary && primaryProvider !== 'dreamcast'
      ? dreamCastLoader.load().then((m) => m.findDreamCastMatch(searchTitles, shikiArt?.year ?? primary.year ?? null))
      : Promise.resolve(null);

  const avPromise =
    !isHentaiPrimary && primaryProvider !== 'animevost'
      ? animeVostLoader.load().then((m) => m.findAnimeVostMatch(searchTitles, shikiArt?.year ?? primary.year ?? null))
      : Promise.resolve(null);

  const agoPromise = !isHentaiPrimary
    ? animeGoLoader.load().then((m) => m.findAnimeGOMatch(searchTitles, shikiArt?.year ?? primary.year ?? null))
    : Promise.resolve(null);
  const kodikPromise = !isHentaiPrimary
    ? kodikLoader.load().then((m) => m.findKodikMatch(searchTitles, shikiArt?.year ?? primary.year ?? null, shikiId))
    : Promise.resolve(null);
  const zokoPromise = !isHentaiPrimary
    ? zokoLoader
        .load()
        .then((m) =>
          m.findZokoMatch(
            dedupeSearchQueries([
              shikiArt?.english,
              shikiArt?.name,
              primary.titleEnglish,
              primary.title,
              ...(extraTitles ?? [])
            ]),
            shikiId ?? null,
            shikiArt?.episodes ?? (primary.episodes.length > 0 ? primary.episodes.length : null)
          )
        )
    : Promise.resolve(null);

  const hentaiPromise = isHentaiPrimary
    ? hentaiLoader.load().then((m) => m.findAllHentaiTracks(searchTitles, shikiArt?.year ?? primary.year ?? null))
    : Promise.resolve([]);

  const [libSettled, dcSettled, avSettled, agoSettled, kodikSettled, zokoSettled, hentaiSettled] =
    await Promise.allSettled([
      libPromise,
      dcPromise,
      avPromise,
      agoPromise,
      kodikPromise,
      zokoPromise,
      hentaiPromise
    ]);

  if (libSettled.status === 'fulfilled' && libSettled.value) {
    const seenAliases = new Set<string>([primary.alias]);
    const scoredMatches: Array<{ cand: LibSearchCandidate; score: number }> = [];
    const libTarget: WatchTarget = {
      title: primary.title,
      shikiId,
      searchQueries: searchTitles
    };
    for (const res of libSettled.value) {
      if (res.status !== 'fulfilled' || !res.value) continue;
      const list = Array.isArray(res.value)
        ? res.value
        : Array.isArray((res.value as { data?: LibSearchCandidate[] }).data)
          ? (res.value as { data: LibSearchCandidate[] }).data
          : [];
      for (const cand of list) {
        if (!cand?.alias || seenAliases.has(cand.alias)) continue;
        const score = scoreReleaseCandidate(cand, libTarget, shikiArt);
        if (score <= 0) continue;
        seenAliases.add(cand.alias);
        scoredMatches.push({ cand, score });
      }
    }
    scoredMatches.sort((a, b) => b.score - a.score);
    const matching = scoredMatches.map((entry) => entry.cand);

    const extraReleases = await Promise.all(
      matching.slice(0, 3).map((cand) => fetchReleaseByIdOrAlias(cand.alias, undefined, shikiId))
    ).catch(() => []);

    for (const rel of extraReleases) {
      if (!rel || rel.alias === primary.alias || rel.episodes.length === 0 || seenIds.has(rel.alias)) continue;
      seenIds.add(rel.alias);
      const altCast = rel.voiceActors?.slice(0, 3).join(', ');
      const isPrimaryAnilibria = primaryProvider === 'aniliberty';
      const label = !isPrimaryAnilibria
        ? 'AniLibria'
        : rel.title && rel.title !== primary.title
          ? `AniLibria · ${rel.title}`
          : `AniLibria · ${rel.alias}`;
      options.push({
        id: rel.alias,
        label,
        sublabel: altCast || `${rel.episodes.length} ep`,
        releaseAlias: rel.alias,
        provider: 'aniliberty',
        providerId: rel.id,
        kind: 'hls'
      });
    }
  }

  if (dcSettled.status === 'fulfilled' && dcSettled.value && !seenIds.has(dcSettled.value.voice.id)) {
    seenIds.add(dcSettled.value.voice.id);
    options.push(dcSettled.value.voice);
  }

  if (avSettled.status === 'fulfilled' && avSettled.value && !seenIds.has(avSettled.value.voice.id)) {
    seenIds.add(avSettled.value.voice.id);
    options.push(avSettled.value.voice);
  }

  const kodikMod = await kodikLoader.load().catch(() => null);
  const normalizeStudio =
    kodikMod?.normalizeCanonicalStudioKey ??
    ((label: string, isSub?: boolean) => (isSub ? 'sub' : label.trim().toLowerCase()));

  const seenStudioKeys = new Set<string>(
    options.map((opt) => normalizeStudio(opt.label, opt.isSub)).filter(Boolean)
  );

  if (agoSettled.status === 'fulfilled' && agoSettled.value) {
    for (const dub of agoSettled.value.dubs) {
      if (seenIds.has(dub.voice.id)) continue;
      // Skip duplicate voice entries when the exact studio is already present natively (e.g., direct AniLibria or Dream Cast),
      // while always keeping Original (Sub) cleanly available for 1080p Dual-Stream pairing.
      const studioKey = normalizeStudio(dub.voice.label, dub.voice.isSub);
      if (!dub.voice.isSub && studioKey && seenStudioKeys.has(studioKey)) continue;
      seenIds.add(dub.voice.id);
      if (studioKey) seenStudioKeys.add(studioKey);
      options.push(dub.voice);
    }
  }

  if (kodikSettled.status === 'fulfilled' && kodikSettled.value) {
    for (const dub of kodikSettled.value.dubs) {
      if (seenIds.has(dub.voice.id)) continue;
      const studioKey = dub.studioKey || normalizeStudio(dub.voice.label, dub.voice.isSub);
      if (studioKey && seenStudioKeys.has(studioKey)) continue;
      seenIds.add(dub.voice.id);
      if (studioKey) seenStudioKeys.add(studioKey);
      options.push(dub.voice);
    }
  }

  if (zokoSettled.status === 'fulfilled' && zokoSettled.value) {
    for (const dub of zokoSettled.value.dubs) {
      if (seenIds.has(dub.voice.id)) continue;
      if (dub.mode === 'sub' && seenStudioKeys.has('sub')) continue;
      seenIds.add(dub.voice.id);
      options.push(dub.voice);
    }
  }

  if (hentaiSettled.status === 'fulfilled' && Array.isArray(hentaiSettled.value)) {
    for (const track of hentaiSettled.value) {
      if (seenIds.has(track.voice.id)) continue;
      seenIds.add(track.voice.id);
      options.push(track.voice);
    }
  }

  return options;
}

export interface HeroOpeningPreview {
  streamUrl: string;
  streamUrlFast?: string;
  startSec: number;
  endSec: number;
  episodeOrdinal: number;
  isDirectVideo?: boolean;
  aspectRatio?: '16:9' | 'fill';
}

export type HeroOpeningTarget = WatchTarget & {
  openingAlias?: string;
  openingEpisode?: number;
  openingStartOffsetSec?: number;
  customPreviewUrl?: string;
  customPreviewAspect?: '16:9' | 'fill';
};

const heroOpeningCache = new Map<string, HeroOpeningPreview | null>();
const heroOpeningPending = new Map<string, Promise<HeroOpeningPreview | null>>();
const warmedPlaylists = new Set<string>();

function buildOpeningCacheKey(target: HeroOpeningTarget): string {
  const previewAlias = target.openingAlias ?? target.releaseAlias;
  const offsetTag =
    target.openingStartOffsetSec != null ? String(Math.max(0, target.openingStartOffsetSec)) : 'mid';
  return `${previewAlias || (target.shikiId ? `shiki:${target.shikiId}` : target.title.toLowerCase())}#${target.openingEpisode ?? 'auto'}+${offsetTag}`;
}

export function getCachedHeroOpeningPreview(
  target: HeroOpeningTarget
): HeroOpeningPreview | null | undefined {
  if (target.customPreviewUrl) {
    return {
      streamUrl: target.customPreviewUrl,
      streamUrlFast: target.customPreviewUrl,
      startSec: 0,
      endSec: 48,
      episodeOrdinal: 0,
      isDirectVideo: true,
      aspectRatio: target.customPreviewAspect ?? 'fill'
    };
  }
  const key = buildOpeningCacheKey(target);
  if (!heroOpeningCache.has(key)) return undefined;
  return heroOpeningCache.get(key) ?? null;
}

export interface WarmOpeningOptions {
  quality?: 'hero' | 'fast';
  maxSeconds?: number;
}

function resolvePlaylistVariantUrl(playlistText: string, playlistUrl: string): string | null {
  const lines = playlistText.split(/\r?\n/);
  let expectUri = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      expectUri = true;
      continue;
    }
    if (expectUri && !line.startsWith('#')) {
      try {
        return new URL(line, playlistUrl).href;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function collectHlsWarmUrls(
  playlistText: string,
  playlistUrl: string,
  startSec: number,
  endSec: number,
  maxSeconds: number
): string[] {
  const lines = playlistText.split(/\r?\n/);
  const urls: string[] = [];
  const windowEnd = Math.min(endSec > startSec ? endSec : startSec + maxSeconds, startSec + maxSeconds);
  let accSec = 0;
  let pendingDur = 0;
  let pastWindowCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-MAP:')) {
      const uriMatch = line.match(/URI="([^"]+)"/i);
      if (uriMatch?.[1]) {
        try {
          urls.push(new URL(uriMatch[1], playlistUrl).href);
        } catch {}
      }
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      const durMatch = line.match(/#EXTINF:([\d.]+)/);
      pendingDur = durMatch ? parseFloat(durMatch[1]) || 0 : 0;
      continue;
    }
    if (line.startsWith('#')) continue;

    const segStart = accSec;
    const segEnd = accSec + pendingDur;
    accSec = segEnd;
    pendingDur = 0;

    if (segEnd >= startSec && segStart <= windowEnd) {
      try {
        urls.push(new URL(line, playlistUrl).href);
      } catch {}
    } else if (segStart > windowEnd && pastWindowCount < 1) {
      // Include one extra lookahead segment past windowEnd so loop boundaries never stall.
      try {
        urls.push(new URL(line, playlistUrl).href);
      } catch {}
      pastWindowCount += 1;
      break;
    }
  }

  return urls;
}

async function fetchWarmBatch(urls: string[], concurrency = 3): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const idx = cursor++;
      const url = urls[idx];
      if (!url) continue;
      await fetch(url).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
}

async function warmOpeningHlsCache(
  clip: HeroOpeningPreview,
  options?: WarmOpeningOptions
): Promise<void> {
  const quality = options?.quality ?? 'hero';
  const maxSeconds = Math.max(8, options?.maxSeconds ?? (quality === 'fast' ? 12 : 26));
  const url = quality === 'fast' ? clip.streamUrlFast || clip.streamUrl : clip.streamUrl;
  if (!url || clip.isDirectVideo) return;

  const cacheKey = `${url}#${Math.floor(clip.startSec)}:${maxSeconds}`;
  if (warmedPlaylists.has(cacheKey)) return;
  warmedPlaylists.add(cacheKey);

  try {
    let targetUrl = url;
    let res = await fetch(targetUrl);
    if (!res.ok) {
      warmedPlaylists.delete(cacheKey);
      return;
    }
    let text = await res.text();

    // If upstream points to a master playlist, resolve the primary variant first.
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variantUrl = resolvePlaylistVariantUrl(text, targetUrl);
      if (!variantUrl) return;
      targetUrl = variantUrl;
      res = await fetch(targetUrl);
      if (!res.ok) {
        warmedPlaylists.delete(cacheKey);
        return;
      }
      text = await res.text();
    }

    const segmentUrls = collectHlsWarmUrls(text, targetUrl, clip.startSec, clip.endSec, maxSeconds);
    if (segmentUrls.length > 0) {
      await fetchWarmBatch(segmentUrls, 3);
    }
  } catch {
    warmedPlaylists.delete(cacheKey);
  }
}

export function warmHeroOpeningPreview(
  target: HeroOpeningTarget,
  options?: WarmOpeningOptions
): void {
  const cached = getCachedHeroOpeningPreview(target);
  if (cached) {
    void warmOpeningHlsCache(cached, options);
    return;
  }
  if (cached === null) return;
  void resolveHeroOpeningPreview(target)
    .then((clip) => {
      if (clip) {
        void warmOpeningHlsCache(clip, options);
      }
    })
    .catch(() => {});
}

export function clampOpeningClipWindow(
  startSec: number,
  endSec: number,
  videoDuration: number
): { startSec: number; endSec: number } {
  const dur = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : Infinity;
  if (!Number.isFinite(dur)) {
    return {
      startSec: Math.max(0, startSec),
      endSec: Math.max(startSec + 4, endSec)
    };
  }
  const safeStart =
    startSec >= dur - 4
      ? Math.max(0, Math.min(dur * 0.25, Math.max(0, dur - 10)))
      : Math.max(0, startSec);
  const safeEnd = Math.max(safeStart + 2, Math.min(endSec, dur - 0.25));
  return { startSec: safeStart, endSec: safeEnd };
}

export async function resolveHeroOpeningPreview(
  target: HeroOpeningTarget
): Promise<HeroOpeningPreview | null> {
  if (target.customPreviewUrl) {
    return {
      streamUrl: target.customPreviewUrl,
      streamUrlFast: target.customPreviewUrl,
      startSec: 0,
      endSec: 48,
      episodeOrdinal: 0,
      isDirectVideo: true,
      aspectRatio: target.customPreviewAspect ?? 'fill'
    };
  }
  const previewAlias = target.openingAlias ?? target.releaseAlias;
  const key = buildOpeningCacheKey(target);
  if (heroOpeningCache.has(key)) {
    return heroOpeningCache.get(key) ?? null;
  }
  const existing = heroOpeningPending.get(key);
  if (existing) {
    return existing;
  }

  const req = (async (): Promise<HeroOpeningPreview | null> => {
    try {
      const rel = await resolvePlayableRelease({
        ...target,
        releaseAlias: previewAlias,
        shikiId: target.openingAlias ? undefined : target.shikiId
      });
      const pickEpisodeStream = (ep: (typeof rel.episodes)[number]) => {
        const hlsMain = ep.hls_720 || ep.hls_480 || ep.hls_1080 || '';
        const hlsFast = ep.hls_480 || ep.hls_720 || ep.hls_1080 || '';
        if (hlsMain) {
          return { streamUrl: hlsMain, streamUrlFast: hlsFast || hlsMain, isDirectVideo: false };
        }
        const mp4Main = ep.mp4_720 || ep.mp4_480 || ep.mp4_1080 || '';
        const mp4Fast = ep.mp4_480 || ep.mp4_720 || ep.mp4_1080 || '';
        if (mp4Main) {
          return { streamUrl: mp4Main, streamUrlFast: mp4Fast || mp4Main, isDirectVideo: true };
        }
        return null;
      };
      const hasValidOpening = (ep: (typeof rel.episodes)[number], minDuration: number) =>
        ep.opening?.start != null &&
        ep.opening?.stop != null &&
        ep.opening.stop > ep.opening.start + minDuration &&
        pickEpisodeStream(ep) !== null;

      // Prefer episodes 2+ with full openings (since Episode 1 often omits OP or places it over ending credits).
      const opEp =
        (target.openingEpisode != null
          ? rel.episodes.find((ep) => ep.ordinal === target.openingEpisode && hasValidOpening(ep, 6))
          : undefined) ??
        rel.episodes.find((ep) => ep.ordinal >= 2 && hasValidOpening(ep, 45)) ??
        rel.episodes.find((ep) => ep.ordinal >= 2 && hasValidOpening(ep, 18)) ??
        rel.episodes.find((ep) => ep.ordinal >= 2 && hasValidOpening(ep, 6)) ??
        rel.episodes.find((ep) => hasValidOpening(ep, 18)) ??
        rel.episodes.find((ep) => hasValidOpening(ep, 6));

      if (opEp?.opening?.start != null && opEp.opening.stop != null) {
        const picked = pickEpisodeStream(opEp);
        if (picked) {
          const opLen = Math.max(0, opEp.opening.stop - opEp.opening.start);
          // Start around the middle (~46%) of the opening by default to skip intro sponsor/staff credits and drop straight into the chorus.
          const defaultMidOffset =
            opLen >= 50
              ? Math.round(opLen * 0.46)
              : opLen >= 24
                ? Math.round(opLen * 0.4)
                : Math.max(0, Math.round(opLen * 0.25));
          const effectiveOffset =
            target.openingStartOffsetSec != null
              ? Math.max(0, target.openingStartOffsetSec)
              : defaultMidOffset;
          const trimmedStart = Math.min(
            opEp.opening.start + effectiveOffset,
            Math.max(opEp.opening.start, opEp.opening.stop - 14)
          );
          const result: HeroOpeningPreview = {
            streamUrl: picked.streamUrl,
            streamUrlFast: picked.streamUrlFast,
            startSec: trimmedStart,
            endSec: opEp.opening.stop,
            episodeOrdinal: opEp.ordinal,
            isDirectVideo: picked.isDirectVideo
          };
          setBoundedCache(heroOpeningCache, key, result, MAX_HERO_OPENING_CACHE);
          if (previewAlias && rel.alias && rel.alias !== previewAlias) {
            setBoundedCache(
              heroOpeningCache,
              buildOpeningCacheKey({ ...target, releaseAlias: rel.alias }),
              result,
              MAX_HERO_OPENING_CACHE
            );
          }
          return result;
        }
      }

      // If no opening markers exist on the release, prefer Episode 2 (where regular TV OP sits around 1:35) over Episode 1.
      const fallbackEp =
        rel.episodes.find((ep) => ep.ordinal >= 2 && pickEpisodeStream(ep) !== null) ??
        rel.episodes.find((ep) => pickEpisodeStream(ep) !== null);
      const fallbackStream = fallbackEp ? pickEpisodeStream(fallbackEp) : null;
      if (fallbackEp && fallbackStream && (fallbackEp.duration === 0 || fallbackEp.duration >= 150)) {
        const result: HeroOpeningPreview = {
          streamUrl: fallbackStream.streamUrl,
          streamUrlFast: fallbackStream.streamUrlFast,
          startSec: 96,
          endSec: 138,
          episodeOrdinal: fallbackEp.ordinal,
          isDirectVideo: fallbackStream.isDirectVideo
        };
        setBoundedCache(heroOpeningCache, key, result, MAX_HERO_OPENING_CACHE);
        return result;
      }

      return null;
    } catch {
      return null;
    } finally {
      heroOpeningPending.delete(key);
    }
  })();

  heroOpeningPending.set(key, req);
  return req;
}

// ---------- AnimePage extras: Videos / Trailers, Franchise / Related, Characters & Cast, Similar ----------

export interface ShikiRelatedAnime {
  id: number;
  relationKind: string;
  relationLabel: string;
  title: string;
  subTitle?: string;
  kind: string;
  year?: number;
  airedDate?: string;
  score?: number;
  episodes?: number;
  poster: string;
  isCurrent?: boolean;
}

export interface ShikiCharacterCast {
  id: number;
  name: string;
  russian: string;
  role: string;
  isMain: boolean;
  gender?: 'Female' | 'Male' | '';
  poster: string;
  voiceActor?: {
    id: number;
    name: string;
    poster?: string;
  };
}

export interface ShikiSimilarAnime {
  id: number;
  title: string;
  subTitle?: string;
  year?: number;
  score?: number;
  episodes?: number;
  kind: string;
  poster: string;
}

export interface AnimePageExtras {
  shikiId: number;
  videos: ShikiVideoItem[];
  related: ShikiRelatedAnime[];
  characters: ShikiCharacterCast[];
  similar: ShikiSimilarAnime[];
}

const ANIME_EXTRAS_CACHE_KEY = 'mila.cache.animeExtras.v3';
const ANIME_EXTRAS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const ANIME_EXTRAS_MAX_ITEMS = 60;

const animeExtrasCache = new Map<number, AnimePageExtras>();
const animeExtrasPending = new Map<number, Promise<AnimePageExtras>>();

function hydrateAnimeExtrasCache(): void {
  const cached = readPersistedCache<AnimePageExtras[]>(ANIME_EXTRAS_CACHE_KEY, ANIME_EXTRAS_CACHE_TTL_MS);
  if (!cached || !Array.isArray(cached.data)) return;
  for (const item of cached.data) {
    if (item && typeof item.shikiId === 'number' && item.shikiId > 0) {
      animeExtrasCache.set(item.shikiId, item);
    }
  }
}
hydrateAnimeExtrasCache();

let animeExtrasPersistTimer: number | undefined;

function persistAnimeExtras(extras: AnimePageExtras): void {
  if (animeExtrasCache.has(extras.shikiId)) {
    animeExtrasCache.delete(extras.shikiId);
  }
  animeExtrasCache.set(extras.shikiId, extras);
  while (animeExtrasCache.size > ANIME_EXTRAS_MAX_ITEMS) {
    const oldest = animeExtrasCache.keys().next();
    if (oldest.done) break;
    animeExtrasCache.delete(oldest.value);
  }
  if (typeof window === 'undefined' || typeof window.setTimeout !== 'function' || typeof window.clearTimeout !== 'function') {
    writePersistedCache(ANIME_EXTRAS_CACHE_KEY, Array.from(animeExtrasCache.values()));
    return;
  }
  if (animeExtrasPersistTimer !== undefined) {
    window.clearTimeout(animeExtrasPersistTimer);
  }
  animeExtrasPersistTimer = window.setTimeout(() => {
    animeExtrasPersistTimer = undefined;
    writePersistedCache(ANIME_EXTRAS_CACHE_KEY, Array.from(animeExtrasCache.values()));
  }, 350);
}

function formatRelationKindLabel(kind?: string | null): string {
  switch ((kind ?? '').toLowerCase()) {
    case 'prequel':
      return 'Prequel';
    case 'sequel':
      return 'Sequel';
    case 'side_story':
      return 'Side story';
    case 'parent_story':
      return 'Parent story';
    case 'summary':
      return 'Summary';
    case 'full_story':
      return 'Full story';
    case 'alternative_setting':
      return 'Alt. setting';
    case 'alternative_version':
      return 'Alt. version';
    case 'spin_off':
      return 'Spin-off';
    default:
      return 'Related';
  }
}

function relationOrderWeight(kind?: string | null): number {
  switch ((kind ?? '').toLowerCase()) {
    case 'prequel':
      return 1;
    case 'parent_story':
      return 2;
    case 'current':
      return 3;
    case 'sequel':
      return 4;
    case 'side_story':
      return 5;
    case 'spin_off':
      return 6;
    case 'summary':
      return 7;
    case 'alternative_setting':
    case 'alternative_version':
      return 8;
    default:
      return 9;
  }
}

function normalizeCastNameKey(raw?: string | null): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface RawShikiSimilarItem {
  id: number;
  name: string;
  russian?: string | null;
  image?: { original?: string | null; preview?: string | null } | null;
  score?: number | string | null;
  aired_on?: string | null;
  episodes?: number | null;
  kind?: string | null;
}

interface RawExtrasGqlAnime {
  id?: string;
  name?: string;
  russian?: string | null;
  english?: string | null;
  kind?: string | null;
  score?: number | null;
  episodes?: number | null;
  airedOn?: { year?: number | null; date?: string | null } | null;
  poster?: { main2xUrl?: string | null; mainUrl?: string | null; originalUrl?: string | null } | null;
  videos?: ShikiGqlNode['videos'];
  related?: Array<{
    id?: string;
    relationKind?: string | null;
    relationText?: string | null;
    anime?: {
      id?: string;
      name?: string;
      russian?: string | null;
      english?: string | null;
      kind?: string | null;
      score?: number | null;
      episodes?: number | null;
      airedOn?: { year?: number | null; date?: string | null } | null;
      poster?: { main2xUrl?: string | null; mainUrl?: string | null; originalUrl?: string | null } | null;
    } | null;
  }> | null;
  characterRoles?: Array<{
    id?: string;
    rolesEn?: string[] | null;
    rolesRu?: string[] | null;
    character?: {
      id?: string;
      name?: string;
      russian?: string | null;
      poster?: { mainUrl?: string | null; originalUrl?: string | null } | null;
    } | null;
  }> | null;
}

interface RawAniListVoiceResponse {
  data?: {
    Media?: {
      characters?: {
        edges?: Array<{
          node?: {
            name?: { full?: string | null } | null;
            gender?: string | null;
          } | null;
          voiceActors?: Array<{
            id?: number;
            name?: { full?: string | null } | null;
            image?: { medium?: string | null; large?: string | null } | null;
          }> | null;
        }> | null;
      } | null;
    } | null;
  } | null;
}

interface AniListCharacterEnrichment {
  gender: 'Female' | 'Male' | '';
  voiceActor?: { id: number; name: string; poster?: string };
}

async function fetchAniListSeiyuuMap(malId: number): Promise<Map<string, AniListCharacterEnrichment>> {
  const map = new Map<string, AniListCharacterEnrichment>();
  if (malId <= 0) return map;
  const query = `query($id: Int) {
    Media(idMal: $id, type: ANIME) {
      characters(sort: [ROLE, FAVOURITES_DESC], perPage: 45) {
        edges {
          node { name { full } gender }
          voiceActors(language: JAPANESE, sort: RELEVANCE) {
            id
            name { full }
            image { medium large }
          }
        }
      }
    }
  }`;
  try {
    const res = await fetchJsonWithTimeout<RawAniListVoiceResponse>(
      ANILIST_GRAPHQL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { id: malId } })
      },
      4500
    );
    for (const edge of res.data?.Media?.characters?.edges ?? []) {
      const charName = normalizeCastNameKey(edge.node?.name?.full);
      if (!charName) continue;
      const rawGender = (edge.node?.gender ?? '').trim().toLowerCase();
      const gender: 'Female' | 'Male' | '' =
        rawGender === 'female' ? 'Female' : rawGender === 'male' ? 'Male' : '';
      const va = edge.voiceActors?.[0];
      const vaName = va?.name?.full?.trim();
      const voiceActor = vaName
        ? {
            id: va?.id ?? 0,
            name: vaName,
            poster: va?.image?.medium || va?.image?.large || undefined
          }
        : undefined;
      map.set(charName, { gender, voiceActor });
    }
  } catch {
    // Non-critical enrichment: UI renders characters cleanly even if voice actor API is unavailable.
  }
  return map;
}

export function getCachedAnimePageExtras(shikiId: number): AnimePageExtras | undefined {
  return animeExtrasCache.get(shikiId);
}

export async function loadAnimePageExtras(shikiId: number): Promise<AnimePageExtras> {
  if (!Number.isFinite(shikiId) || shikiId <= 0) {
    return { shikiId: 0, videos: [], related: [], characters: [], similar: [] };
  }

  const cached = animeExtrasCache.get(shikiId);
  if (cached) {
    return cached;
  }

  const existing = animeExtrasPending.get(shikiId);
  if (existing) {
    return existing;
  }

  const req = (async (): Promise<AnimePageExtras> => {
    try {
      const gqlQuery = `query($ids: String) {
        animes(ids: $ids, limit: 1, censored: false) {
          id
          name
          russian
          english
          kind
          score
          episodes
          airedOn { year date }
          poster { main2xUrl mainUrl originalUrl }
          videos { id url imageUrl playerUrl name kind }
          related {
            id
            relationKind
            relationText
            anime {
              id
              name
              russian
              english
              kind
              score
              episodes
              airedOn { year date }
              poster { main2xUrl mainUrl originalUrl }
            }
          }
          characterRoles {
            id
            rolesEn
            rolesRu
            character {
              id
              name
              russian
              poster { mainUrl originalUrl }
            }
          }
        }
      }`;

      const [gqlRes, similarRes, seiyuuMap] = await Promise.all([
        fetchJsonWithTimeout<{ data?: { animes?: RawExtrasGqlAnime[] } }>(
          SHIKI_GRAPHQL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: gqlQuery, variables: { ids: String(shikiId) } })
          },
          7500
        ).catch(() => null),
        fetchJsonWithTimeout<RawShikiSimilarItem[]>(
          `${SHIKI_REST_ANIMES}/${shikiId}/similar`,
          undefined,
          6500
        ).catch(() => [] as RawShikiSimilarItem[]),
        fetchAniListSeiyuuMap(shikiId)
      ]);

      const node = gqlRes?.data?.animes?.[0];
      const videos = mapShikiVideos(node?.videos);

      // Update artwork videos cache if present
      const existingArt = shikiCache.get(shikiId);
      if (existingArt && !existingArt.videos?.length && videos.length > 0) {
        setShikiCached({ ...existingArt, videos });
      }

      // Related / Franchise timeline in chronological watch order
      const relSeen = new Set<number>([shikiId]);
      const relatedItems: ShikiRelatedAnime[] = [];
      for (const rel of node?.related ?? []) {
        const target = rel.anime;
        if (!target) continue;
        const id = Number(target.id);
        if (!Number.isFinite(id) || id <= 0 || relSeen.has(id)) continue;
        relSeen.add(id);
        const poster = resolveShikiUrl(
          target.poster?.main2xUrl || target.poster?.mainUrl || target.poster?.originalUrl
        );
        relatedItems.push({
          id,
          relationKind: (rel.relationKind ?? 'other').toLowerCase(),
          relationLabel: formatRelationKindLabel(rel.relationKind),
          title: target.english || target.name || target.russian || 'Anime',
          subTitle: target.name && target.english && target.name !== target.english ? target.name : undefined,
          kind: (target.kind ?? 'tv').toUpperCase(),
          year: target.airedOn?.year ?? undefined,
          airedDate: target.airedOn?.date ?? (target.airedOn?.year ? `${target.airedOn.year}-99-99` : undefined),
          score: target.score && target.score > 0 ? Number(target.score.toFixed(1)) : undefined,
          episodes: target.episodes && target.episodes > 0 ? target.episodes : undefined,
          poster
        });
      }

      if (relatedItems.length > 0 && node) {
        relatedItems.push({
          id: shikiId,
          relationKind: 'current',
          relationLabel: 'Current',
          title: node.english || node.name || node.russian || 'Anime',
          subTitle: node.name && node.english && node.name !== node.english ? node.name : undefined,
          kind: (node.kind ?? 'tv').toUpperCase(),
          year: node.airedOn?.year ?? undefined,
          airedDate: node.airedOn?.date ?? (node.airedOn?.year ? `${node.airedOn.year}-99-99` : undefined),
          score: node.score && node.score > 0 ? Number(node.score.toFixed(1)) : undefined,
          episodes: node.episodes && node.episodes > 0 ? node.episodes : undefined,
          poster: resolveShikiUrl(node.poster?.main2xUrl || node.poster?.mainUrl || node.poster?.originalUrl),
          isCurrent: true
        });

        relatedItems.sort((a, b) => {
          const da = a.airedDate ?? '9999-99-99';
          const db = b.airedDate ?? '9999-99-99';
          if (da !== db) return da.localeCompare(db);
          return relationOrderWeight(a.relationKind) - relationOrderWeight(b.relationKind);
        });
      }

      // Characters & Cast (filter placeholder missing posters gracefully in UI, Main first)
      const charSeen = new Set<number>();
      const characters: ShikiCharacterCast[] = [];
      for (const roleItem of node?.characterRoles ?? []) {
        const ch = roleItem.character;
        if (!ch) continue;
        const cid = Number(ch.id);
        if (!Number.isFinite(cid) || cid <= 0 || charSeen.has(cid)) continue;
        charSeen.add(cid);
        const roleEn = roleItem.rolesEn?.[0] ?? roleItem.rolesRu?.[0] ?? 'Supporting';
        const isMain = roleEn.toLowerCase() === 'main';
        const rawPoster = resolveShikiUrl(ch.poster?.mainUrl || ch.poster?.originalUrl);
        const cleanPoster = rawPoster.includes('/missing_') ? '' : rawPoster;

        const key = normalizeCastNameKey(ch.name);
        let enrich = seiyuuMap.get(key);
        if (!enrich && key.includes(' ')) {
          const reversed = key.split(' ').reverse().join(' ');
          enrich = seiyuuMap.get(reversed);
        }

        characters.push({
          id: cid,
          name: ch.name?.trim() || ch.russian?.trim() || 'Character',
          russian: ch.russian?.trim() || '',
          role: isMain ? 'Main' : 'Supporting',
          isMain,
          gender: enrich?.gender ?? '',
          poster: cleanPoster,
          voiceActor: enrich?.voiceActor
        });
      }
      characters.sort((a, b) => {
        if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
        return 0;
      });

      // Similar / More Like This (deduplicate & exclude current + any franchise entries)
      const excludedIds = new Set<number>([shikiId, ...relatedItems.map((r) => r.id)]);
      const similarCandidates: Array<{ item: RawShikiSimilarItem; fallbackPoster: string }> = [];
      for (const item of Array.isArray(similarRes) ? similarRes : []) {
        if (!item || !item.id || excludedIds.has(item.id)) continue;
        excludedIds.add(item.id);
        const fallbackPoster = resolveShikiUrl(item.image?.original || item.image?.preview);
        if (!fallbackPoster || fallbackPoster.includes('/missing_')) continue;
        similarCandidates.push({ item, fallbackPoster });
        if (similarCandidates.length >= 12) break;
      }

      // Enrich similar items with high-resolution GraphQL posters (REST original/preview is often low-res).
      const similarIds = similarCandidates.map((c) => c.item.id);
      const artMap =
        similarIds.length > 0
          ? await ensureShikimoriArtwork(similarIds).catch(() => shikiCache)
          : shikiCache;

      const similar: ShikiSimilarAnime[] = similarCandidates.map(({ item, fallbackPoster }) => {
        const art = artMap.get(item.id);
        const poster = art?.posterOriginal || art?.posterMain || fallbackPoster;
        const numScore = typeof item.score === 'string' ? Number(item.score) : (item.score ?? 0);
        const yearMatch = item.aired_on?.match(/^(\d{4})/);
        return {
          id: item.id,
          title: art?.english || art?.name || item.name,
          subTitle: i18n.locale === 'ru' ? item.russian?.trim() || undefined : undefined,
          year: yearMatch ? Number(yearMatch[1]) : undefined,
          score: Number.isFinite(numScore) && numScore > 0 ? Number(numScore.toFixed(1)) : undefined,
          episodes: item.episodes && item.episodes > 0 ? item.episodes : undefined,
          kind: (item.kind ?? 'tv').toUpperCase(),
          poster
        };
      });

      const result: AnimePageExtras = {
        shikiId,
        videos,
        related: relatedItems,
        characters,
        similar
      };

      if (videos.length > 0 || relatedItems.length > 0 || characters.length > 0 || similar.length > 0) {
        persistAnimeExtras(result);
      }
      return result;
    } finally {
      animeExtrasPending.delete(shikiId);
    }
  })();

  animeExtrasPending.set(shikiId, req);
  return req;
}
