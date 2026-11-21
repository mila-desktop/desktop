import type { PageId } from '../pages';
import { settingsState } from './settings.svelte';

const DEFAULT_PAGE: PageId = settingsState.startupPage || 'home';
const MAX_HISTORY_ENTRIES = 64;

export interface RouteParams {
  shikiId?: number;
  alias?: string;
  title?: string;
  searchQueries?: string[];
  autoPlay?: boolean;
  episode?: number;
  episodeOrdinal?: number;
  resumeTime?: number;
}

export type RouteDirection = 'push' | 'back' | 'forward' | 'replace';

export interface RouteEntry {
  key: string;
  page: PageId;
  params?: RouteParams;
  scrollTop: number;
  timestamp: number;
}

export type RouteTarget =
  | PageId
  | ({ page: PageId; params?: RouteParams } & Partial<RouteParams>);

type RouteRestoreListener = (entry: RouteEntry, direction: RouteDirection) => void;

let scrollReader: (() => number) | null = null;
let smoothScrollWriter: ((top: number) => void) | null = null;
const restoreListeners = new Set<RouteRestoreListener>();
const scrollByPage = new Map<PageId, number>();
let lastHistoryNavTs = 0;

function isDetailPage(page: PageId): boolean {
  return page === 'anime' || page === 'player' || page === 'watch-together-player';
}

function cloneParams(params?: RouteParams): RouteParams | undefined {
  if (!params) return undefined;
  return {
    shikiId: params.shikiId,
    alias: params.alias,
    title: params.title,
    searchQueries: params.searchQueries ? [...params.searchQueries] : undefined,
    autoPlay: params.autoPlay,
    episode: params.episode,
    episodeOrdinal: params.episodeOrdinal,
    resumeTime: params.resumeTime
  };
}

export function buildRouteKey(page: PageId, params?: RouteParams): string {
  if (!isDetailPage(page)) {
    return page;
  }
  const aliasPart = params?.alias?.trim().toLowerCase() || '';
  const shikiPart = params?.shikiId && params.shikiId > 0 ? String(params.shikiId) : '';
  const titlePart = !aliasPart && !shikiPart ? (params?.title?.trim().toLowerCase() || 'default') : '';
  return `${page}:${shikiPart}:${aliasPart}:${titlePart}`;
}

function normalizeTarget(target: RouteTarget): { page: PageId; params?: RouteParams } {
  if (typeof target === 'string') {
    return { page: target };
  }
  const { page, params, ...inlineParams } = target;
  const merged: RouteParams = {
    ...inlineParams,
    ...(params ?? {})
  };
  const hasParams =
    merged.shikiId !== undefined ||
    Boolean(merged.alias) ||
    Boolean(merged.title) ||
    Boolean(merged.searchQueries?.length) ||
    merged.autoPlay !== undefined ||
    merged.episode !== undefined ||
    merged.episodeOrdinal !== undefined ||
    merged.resumeTime !== undefined;

  return {
    page,
    params: hasParams ? cloneParams(merged) : undefined
  };
}

const initialEntry: RouteEntry = {
  key: DEFAULT_PAGE,
  page: DEFAULT_PAGE,
  scrollTop: 0,
  timestamp: Date.now()
};

export const router = $state<{
  current: PageId;
  previous: PageId;
  params?: RouteParams;
  routeKey: string;
  stack: RouteEntry[];
  index: number;
  canGoBack: boolean;
  canGoForward: boolean;
  direction: RouteDirection;
  targetScrollTop: number;
}>({
  current: DEFAULT_PAGE,
  previous: DEFAULT_PAGE,
  params: undefined,
  routeKey: DEFAULT_PAGE,
  stack: [initialEntry],
  index: 0,
  canGoBack: false,
  canGoForward: false,
  direction: 'push',
  targetScrollTop: 0
});

function syncBrowserHistory(mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined' || !window.history) return;
  const active = router.stack[router.index];
  if (!active) return;
  const statePayload = {
    milaIdx: router.index,
    key: active.key,
    page: active.page
  };
  try {
    if (mode === 'push') {
      window.history.pushState(statePayload, '');
    } else {
      window.history.replaceState(statePayload, '');
    }
  } catch {
    // Ignore history API restrictions in embedded contexts
  }
}

function saveOutgoingScroll(): void {
  if (!scrollReader) return;
  const top = Math.max(0, Math.round(scrollReader()));
  const currentEntry = router.stack[router.index];
  if (currentEntry) {
    currentEntry.scrollTop = top;
    if (!isDetailPage(currentEntry.page)) {
      scrollByPage.set(currentEntry.page, top);
    }
  }
}

function applyEntryAtIndex(nextIndex: number, direction: RouteDirection, syncMode: 'push' | 'replace' | 'none'): void {
  const entry = router.stack[nextIndex];
  if (!entry) return;

  if (!isDetailPage(router.current) && router.current !== entry.page) {
    router.previous = router.current;
  } else if (direction === 'back' || direction === 'forward') {
    for (let i = nextIndex - 1; i >= 0; i--) {
      if (!isDetailPage(router.stack[i].page)) {
        router.previous = router.stack[i].page;
        break;
      }
    }
  }

  router.index = nextIndex;
  router.current = entry.page;
  router.params = cloneParams(entry.params);
  router.routeKey = entry.key;
  router.direction = direction;
  router.canGoBack = nextIndex > 0;
  router.canGoForward = nextIndex < router.stack.length - 1;
  router.targetScrollTop = entry.scrollTop;
  lastHistoryNavTs = performance.now();

  if (syncMode !== 'none') {
    syncBrowserHistory(syncMode);
  }

  if (direction === 'back' || direction === 'forward') {
    for (const listener of restoreListeners) {
      listener(entry, direction);
    }
  }
}

export function registerScrollBridge(getScrollTop: () => number, smoothTo?: (top: number) => void): () => void {
  scrollReader = getScrollTop;
  if (smoothTo) {
    smoothScrollWriter = smoothTo;
  }
  syncBrowserHistory('replace');
  return () => {
    if (scrollReader === getScrollTop) {
      scrollReader = null;
    }
    if (smoothTo && smoothScrollWriter === smoothTo) {
      smoothScrollWriter = null;
    }
  };
}

export function triggerScrollTransitionDown(deltaPx = 280): void {
  if (!scrollReader || !smoothScrollWriter) return;
  const current = Math.max(0, scrollReader());
  smoothScrollWriter(current + Math.max(0, deltaPx));
}

export function onRouteRestore(listener: RouteRestoreListener): () => void {
  restoreListeners.add(listener);
  return () => {
    restoreListeners.delete(listener);
  };
}

export function getSavedPageScroll(pageId: PageId): number {
  const active = router.stack[router.index];
  if (active && active.page === pageId) {
    return router.targetScrollTop;
  }
  return isDetailPage(pageId) ? 0 : (scrollByPage.get(pageId) ?? 0);
}

export function updateCurrentRouteParams(partial: Partial<RouteParams>): void {
  const active = router.stack[router.index];
  if (!active) return;
  const nextParams: RouteParams = {
    ...(active.params ?? {}),
    ...partial
  };
  const nextKey = buildRouteKey(active.page, nextParams);
  active.params = nextParams;
  active.key = nextKey;
  router.params = cloneParams(nextParams);
  router.routeKey = nextKey;
  syncBrowserHistory('replace');
}

export function navigate(target: RouteTarget, opts?: { replace?: boolean }): void {
  const { page, params } = normalizeTarget(target);
  const nextKey = buildRouteKey(page, params);
  const active = router.stack[router.index];

  if (active && active.key === nextKey) {
    if (params) {
      updateCurrentRouteParams(params);
    }
    return;
  }

  saveOutgoingScroll();

  const initialScroll = isDetailPage(page) ? 0 : (scrollByPage.get(page) ?? 0);
  const newEntry: RouteEntry = {
    key: nextKey,
    page,
    params,
    scrollTop: initialScroll,
    timestamp: Date.now()
  };

  if (opts?.replace) {
    router.stack[router.index] = newEntry;
    applyEntryAtIndex(router.index, 'replace', 'replace');
    return;
  }

  const head = router.stack.slice(0, router.index + 1);
  head.push(newEntry);
  if (head.length > MAX_HISTORY_ENTRIES) {
    head.shift();
  }
  router.stack = head;
  applyEntryAtIndex(router.stack.length - 1, 'push', 'push');
}

export function back(): boolean {
  if (router.index > 0) {
    saveOutgoingScroll();
    applyEntryAtIndex(router.index - 1, 'back', 'replace');
    return true;
  }
  if (router.current !== DEFAULT_PAGE) {
    navigate(DEFAULT_PAGE, { replace: true });
    return true;
  }
  return false;
}

export function forward(): boolean {
  if (router.index < router.stack.length - 1) {
    saveOutgoingScroll();
    applyEntryAtIndex(router.index + 1, 'forward', 'replace');
    return true;
  }
  return false;
}

export function stepToHistoryIndex(targetIndex: number): boolean {
  if (
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= router.stack.length ||
    targetIndex === router.index
  ) {
    return false;
  }
  saveOutgoingScroll();
  const dir: RouteDirection = targetIndex < router.index ? 'back' : 'forward';
  applyEntryAtIndex(targetIndex, dir, 'none');
  return true;
}

export function getLastHistoryNavTimestamp(): number {
  return lastHistoryNavTs;
}

// Backward-compatible aliases
export const goBack = back;
export const goForward = forward;

export interface ParsedShareLink {
  shikiId?: number;
  alias?: string;
  episodeOrdinal?: number;
  title?: string;
  raw: string;
}

export function encodeMilaShareLink(params: {
  shikiId?: number;
  alias?: string;
  episodeOrdinal?: number;
}): string {
  const ep =
    params.episodeOrdinal && Number.isFinite(params.episodeOrdinal) && params.episodeOrdinal > 0
      ? `?ep=${Math.floor(params.episodeOrdinal)}`
      : '';
  if (params.shikiId && Number.isFinite(params.shikiId) && params.shikiId > 0) {
    return `mila://anime/${Math.floor(params.shikiId)}${ep}`;
  }
  const cleanAlias = params.alias?.trim();
  if (cleanAlias) {
    return `mila://anime/alias/${encodeURIComponent(cleanAlias)}${ep}`;
  }
  return `mila://anime${ep}`;
}

export function parseMilaShareLink(input: string): ParsedShareLink | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. Canonical share link: mila://anime/52991?ep=3 or mila://anime/alias/frieren?ep=3
  const milaMatch = trimmed.match(/^mila:\/\/anime\/(?:(alias)\/([^?#\s]+)|(\d+))(?:\?([^#\s]*))?/i);
  if (milaMatch) {
    const query = new URLSearchParams(milaMatch[4] ?? '');
    const epRaw = Number(query.get('ep'));
    const ep = Number.isFinite(epRaw) && epRaw > 0 ? Math.floor(epRaw) : undefined;
    if (milaMatch[1] && milaMatch[2]) {
      return {
        alias: decodeURIComponent(milaMatch[2]),
        episodeOrdinal: ep,
        raw: trimmed
      };
    }
    const id = Number(milaMatch[3]);
    if (Number.isFinite(id) && id > 0) {
      return {
        shikiId: id,
        episodeOrdinal: ep,
        raw: trimmed
      };
    }
  }

  // 2. Compact code: anime:52991 or anime:52991#3 or shiki:52991
  const codeMatch = trimmed.match(/^(?:anime|shiki)[:#](\d+)(?:[#:](\d+))?$/i);
  if (codeMatch) {
    const id = Number(codeMatch[1]);
    const ep = codeMatch[2] ? Number(codeMatch[2]) : undefined;
    if (Number.isFinite(id) && id > 0) {
      return {
        shikiId: id,
        episodeOrdinal: ep && ep > 0 ? ep : undefined,
        raw: trimmed
      };
    }
  }

  // 3. Shikimori URL: https://shikimori.io/animes/52991-sousou-no-frieren
  const shikiUrlMatch = trimmed.match(/^https?:\/\/(?:shikimori\.(?:one|io)|shiki\.one)\/animes\/[a-z]?(\d+)/i);
  if (shikiUrlMatch) {
    const id = Number(shikiUrlMatch[1]);
    if (Number.isFinite(id) && id > 0) {
      return { shikiId: id, raw: trimmed };
    }
  }

  return null;
}
