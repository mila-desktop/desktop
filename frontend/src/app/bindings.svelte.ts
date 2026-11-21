import {
  getWailsMilaBridge,
  getWailsRuntimeBridge,
  isDesktopWailsApp,
  type WailsMilaGoBindings,
  type WailsRuntimeBridge
} from '../api/bridge';
import { flushBeforeClose } from './lifecycle';
import {
  back,
  forward,
  getLastHistoryNavTimestamp,
  parseMilaShareLink,
  router,
  stepToHistoryIndex
} from './router.svelte';
import { closeSearch, openSearch, search } from './search.svelte';
import { matchesShortcut, settingsState } from './settings.svelte';

export type BindingActionId =
  | 'nav.back'
  | 'nav.forward'
  | 'app.fullscreen'
  | 'search.open'
  | 'search.close';

export interface BindingDescriptor {
  id: BindingActionId;
  label: string;
  keys: string[];
  mouseButton?: number;
  allowInInput?: boolean;
  handler: () => void | boolean | Promise<void | boolean>;
}

export function getWailsMilaBindings(): WailsMilaGoBindings | null {
  return getWailsMilaBridge();
}

export function getWailsRuntime(): WailsRuntimeBridge | null {
  return getWailsRuntimeBridge();
}

export function detectDesktopApp(): boolean {
  return isDesktopWailsApp();
}

export const bindings = $state<{
  isApp: boolean;
  isWindowSharp: boolean;
  appFullscreen: boolean;
  osPipActive: boolean;
}>({
  isApp: detectDesktopApp(),
  isWindowSharp: false,
  appFullscreen: false,
  osPipActive: false
});

export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export async function refreshWindowCornerState(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  bindings.isApp = detectDesktopApp();
  const runtime = getWailsRuntime();

  if (bindings.osPipActive) {
    bindings.isWindowSharp = false;
    document.body.classList.remove('is-window-fullscreen');
    return false;
  }

  let sharp =
    document.body.classList.contains('is-player-fullscreen') ||
    document.fullscreenElement !== null ||
    Boolean(window.matchMedia?.('(display-mode: fullscreen)').matches) ||
    bindings.appFullscreen;

  if (!sharp && bindings.isApp && window.screen) {
    if (
      window.innerWidth >= window.screen.width - 2 &&
      window.innerHeight >= window.screen.height - 2
    ) {
      sharp = true;
    }
    if (!sharp && typeof runtime?.WindowIsFullscreen === 'function') {
      sharp = Boolean(await runtime.WindowIsFullscreen().catch(() => false));
    }
    if (!sharp && typeof runtime?.WindowIsMaximised === 'function') {
      sharp = Boolean(await runtime.WindowIsMaximised().catch(() => false));
    }
  }

  bindings.isWindowSharp = sharp;
  document.body.classList.toggle('is-window-fullscreen', sharp);
  return sharp;
}

export async function setAppFullscreen(
  next: boolean,
  opts?: { playerMode?: boolean; domTarget?: HTMLElement | null }
): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  bindings.isApp = detectDesktopApp();
  if (opts?.playerMode !== undefined) {
    document.body.classList.toggle('is-player-fullscreen', next && opts.playerMode);
  } else if (!next) {
    document.body.classList.remove('is-player-fullscreen');
  }
  document.body.classList.toggle('is-window-fullscreen', next);
  bindings.appFullscreen = next;
  bindings.isWindowSharp = next;

  const goMila = getWailsMilaBindings();
  const runtime = getWailsRuntime();

  if (typeof goMila?.SetFullscreen === 'function') {
    await goMila.SetFullscreen(next).catch(() => {});
  } else if (next && typeof runtime?.WindowFullscreen === 'function') {
    runtime.WindowFullscreen();
  } else if (!next && typeof runtime?.WindowUnfullscreen === 'function') {
    runtime.WindowUnfullscreen();
  }

  const domEl = opts?.domTarget ?? (!bindings.isApp ? document.documentElement : null);
  if (next && domEl && document.fullscreenElement !== domEl && typeof domEl.requestFullscreen === 'function') {
    await domEl.requestFullscreen().catch(() => {});
  } else if (!next && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
    await document.exitFullscreen().catch(() => {});
  }

  await refreshWindowCornerState();
}

export async function toggleAppFullscreen(): Promise<boolean> {
  const next = !bindings.isWindowSharp && !document.fullscreenElement;
  await setAppFullscreen(next);
  return next;
}

export function minimizeAppWindow(): void {
  const runtime = getWailsRuntime();
  if (typeof runtime?.WindowMinimise === 'function') {
    runtime.WindowMinimise();
  }
}

export function closeAppWindow(): void {
  flushBeforeClose();
  const runtime = getWailsRuntime();
  if (typeof runtime?.Quit === 'function') {
    runtime.Quit();
    return;
  }
  if (typeof window !== 'undefined' && typeof window.close === 'function') {
    window.close();
  }
}

export async function setAppFullscreenFocus(focused: boolean): Promise<void> {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.SetFullscreenFocus === 'function') {
    await goMila.SetFullscreenFocus(focused).catch(() => {});
  }
}

export async function setOsPipWindowMode(enabled: boolean): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  bindings.isApp = detectDesktopApp();
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.SetPipMode === 'function') {
    bindings.osPipActive = enabled;
    document.body.classList.toggle('is-os-pip', enabled);
    await goMila.SetPipMode(enabled).catch(() => {});
    await refreshWindowCornerState();
    return true;
  }
  return false;
}

export function startOsPipWindowDrag(): void {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.StartPipDrag === 'function') {
    void goMila.StartPipDrag().catch(() => {});
  }
}

export function openExternalUrl(url: string): void {
  const clean = url.trim();
  if (!clean || typeof window === 'undefined') return;
  const runtime = getWailsRuntime();
  if (typeof runtime?.BrowserOpenURL === 'function') {
    runtime.BrowserOpenURL(clean);
    return;
  }
  window.open(clean, '_blank', 'noopener,noreferrer');
}

export async function invokeAnimeVostSearch(query: string): Promise<string | null> {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.AnimeVostSearch !== 'function') return null;
  try {
    return await goMila.AnimeVostSearch(query);
  } catch {
    return null;
  }
}

export async function invokeAnimeVostPlaylist(id: number): Promise<string | null> {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.AnimeVostPlaylist !== 'function') return null;
  try {
    return await goMila.AnimeVostPlaylist(id);
  } catch {
    return null;
  }
}

export async function invokeHentaiSearch(query: string): Promise<string | null> {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.HentaiSearch !== 'function') return null;
  try {
    return await goMila.HentaiSearch(query);
  } catch {
    return null;
  }
}

export async function invokeHentaiGetEpisodes(provider: string, target: string): Promise<string | null> {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.HentaiGetEpisodes !== 'function') return null;
  try {
    return await goMila.HentaiGetEpisodes(provider, target);
  } catch {
    return null;
  }
}

export async function invokeZokoProbe(
  malID: number,
  episodeCount: number,
  query: string
): Promise<string | null> {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.ZokoProbe !== 'function') return null;
  try {
    return await goMila.ZokoProbe(malID, episodeCount, query);
  } catch {
    return null;
  }
}

const bindingRegistry: BindingDescriptor[] = [
  {
    id: 'nav.back',
    label: 'Navigate Back',
    keys: ['Alt+ArrowLeft', 'BrowserBack'],
    mouseButton: 3,
    allowInInput: false,
    handler: () => back()
  },
  {
    id: 'nav.forward',
    label: 'Navigate Forward',
    keys: ['Alt+ArrowRight', 'BrowserForward'],
    mouseButton: 4,
    allowInInput: false,
    handler: () => forward()
  },
  {
    id: 'app.fullscreen',
    label: 'Toggle Fullscreen',
    keys: ['F11'],
    allowInInput: true,
    handler: () => toggleAppFullscreen()
  },
  {
    id: 'search.open',
    label: 'Open Search',
    keys: ['Ctrl+KeyK', 'Meta+KeyK', '/'],
    allowInInput: false,
    handler: () => openSearch()
  },
  {
    id: 'search.close',
    label: 'Close Search',
    keys: ['Escape'],
    allowInInput: true,
    handler: () => {
      if (search.open) {
        closeSearch();
        return true;
      }
      return false;
    }
  }
];

export function getRegisteredBindings(): readonly BindingDescriptor[] {
  return bindingRegistry;
}

export function triggerBinding(id: BindingActionId): void | boolean | Promise<void | boolean> {
  const found = bindingRegistry.find((b) => b.id === id);
  return found?.handler();
}

export function mountBindingsController(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  bindings.isApp = detectDesktopApp();
  void refreshWindowCornerState();

  let lastSideMouseTriggerTs = 0;

  const handleSideMouseButton = (e: MouseEvent, execute: boolean) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    e.stopPropagation();

    if (!execute) return;
    const now = performance.now();
    if (now - lastSideMouseTriggerTs < 90) return;
    lastSideMouseTriggerTs = now;

    if (search.open) {
      closeSearch();
    }

    if (e.button === 3) {
      back();
    } else if (e.button === 4) {
      forward();
    }
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) {
      handleSideMouseButton(e, false);
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) {
      handleSideMouseButton(e, true);
    }
  };

  const onAuxClick = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) {
      handleSideMouseButton(e, true);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;

    if (matchesShortcut(e, settingsState.shortcuts.appFullscreen)) {
      e.preventDefault();
      void toggleAppFullscreen();
      return;
    }

    if (e.key === 'Escape' && search.open) {
      e.preventDefault();
      closeSearch();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      if (search.open) {
        closeSearch();
      } else {
        openSearch();
      }
      return;
    }

    if (isEditableElement(e.target)) {
      return;
    }

    if (e.key === 'BrowserBack' || (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft')) {
      e.preventDefault();
      if (search.open) closeSearch();
      back();
      return;
    }

    if (e.key === 'BrowserForward' || (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowRight')) {
      e.preventDefault();
      if (search.open) closeSearch();
      forward();
      return;
    }

    if (matchesShortcut(e, settingsState.shortcuts.appSearch) && !search.open) {
      e.preventDefault();
      openSearch();
    }
  };

  const onPopState = (e: PopStateEvent) => {
    const now = performance.now();
    // Ignore duplicate browser popstate when Mouse4/Mouse5 already handled the step.
    if (now - getLastHistoryNavTimestamp() < 140 || now - lastSideMouseTriggerTs < 140) {
      try {
        const active = router.stack[router.index];
        if (active) {
          window.history.replaceState({ milaIdx: router.index, key: active.key, page: active.page }, '');
        }
      } catch {
        // Ignore
      }
      return;
    }

    const state = e.state as { milaIdx?: number } | null;
    if (state && typeof state.milaIdx === 'number') {
      if (search.open) closeSearch();
      stepToHistoryIndex(state.milaIdx);
    }
  };

  const onCheck = () => void refreshWindowCornerState();
  const onFocus = () => {
    void setAppFullscreenFocus(true);
    onCheck();
  };
  const onBlur = () => {
    void setAppFullscreenFocus(false);
  };
  const onBeforeCloseFlush = () => {
    flushBeforeClose();
  };

  const runtime = getWailsRuntime();
  const offWailsBeforeClose =
    typeof runtime?.EventsOn === 'function'
      ? runtime.EventsOn('mila:before-close', onBeforeCloseFlush)
      : undefined;

  const handleDeepLink = (link: unknown) => {
    if (typeof link !== 'string' || !link.trim()) return;
    const parsed = parseMilaShareLink(link);
    if (!parsed || (!parsed.shikiId && !parsed.alias)) return;
    if (search.open) closeSearch();
    void import('./player.svelte').then(({ openWatch }) =>
      openWatch(
        {
          title: parsed.title ?? '',
          shikiId: parsed.shikiId,
          releaseAlias: parsed.alias,
          searchQueries: []
        },
        {
          episodeOrdinal: parsed.episodeOrdinal,
          autoPlay: Boolean(parsed.episodeOrdinal),
          directPlayer: Boolean(parsed.episodeOrdinal)
        }
      )
    );
  };

  const offDeepLink =
    typeof runtime?.EventsOn === 'function'
      ? runtime.EventsOn('mila:deep-link', handleDeepLink)
      : undefined;

  const offTrayPlay =
    typeof runtime?.EventsOn === 'function'
      ? runtime.EventsOn('mila:tray-toggle-play', () => {
          void import('./player.svelte').then(({ toggleActivePlayback }) => toggleActivePlayback());
        })
      : undefined;

  const goMila = getWailsMilaBindings();
  if (typeof goMila?.ConsumePendingDeepLink === 'function') {
    void goMila
      .ConsumePendingDeepLink()
      .then(handleDeepLink)
      .catch(() => {});
  }

  window.addEventListener('mousedown', onMouseDown, { capture: true });
  window.addEventListener('mouseup', onMouseUp, { capture: true });
  window.addEventListener('auxclick', onAuxClick, { capture: true });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('resize', onCheck);
  document.addEventListener('fullscreenchange', onCheck);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  window.addEventListener('beforeunload', onBeforeCloseFlush);
  window.addEventListener('pagehide', onBeforeCloseFlush);

  return () => {
    offWailsBeforeClose?.();
    offDeepLink?.();
    offTrayPlay?.();
    window.removeEventListener('mousedown', onMouseDown, { capture: true });
    window.removeEventListener('mouseup', onMouseUp, { capture: true });
    window.removeEventListener('auxclick', onAuxClick, { capture: true });
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('resize', onCheck);
    document.removeEventListener('fullscreenchange', onCheck);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('beforeunload', onBeforeCloseFlush);
    window.removeEventListener('pagehide', onBeforeCloseFlush);
  };
}

export interface AppUpdateStatus {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  state: 'idle' | 'checking' | 'up_to_date' | 'downloading' | 'installing' | 'error' | string;
  progress: number;
  releaseUrl?: string;
  error?: string;
}

export function subscribeAppUpdateStatus(
  handler: (status: AppUpdateStatus) => void
): () => void {
  const runtime = getWailsRuntime();
  if (typeof runtime?.EventsOn !== 'function') {
    return () => {};
  }
  return runtime.EventsOn('mila:update-status', (payload) => {
    if (payload && typeof payload === 'object') {
      handler(payload as AppUpdateStatus);
    }
  });
}

/** Reads the running desktop build version tag; returns an empty string in browser dev mode. */
export async function invokeGetAppVersion(): Promise<string> {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.GetAppVersion !== 'function') {
    return '';
  }
  try {
    const raw = await goMila.GetAppVersion();
    return typeof raw === 'string' ? raw.trim() : '';
  } catch {
    return '';
  }
}

export async function invokeCheckAndInstallUpdate(): Promise<AppUpdateStatus | null> {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.CheckAndInstallUpdate !== 'function') {
    return null;
  }
  try {
    const raw = await goMila.CheckAndInstallUpdate();
    const parsed = JSON.parse(raw) as { data?: AppUpdateStatus };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

export async function invokeGetUpdateStatus(): Promise<AppUpdateStatus | null> {
  const goMila = getWailsMilaBindings();
  if (typeof goMila?.GetUpdateStatus !== 'function') {
    return null;
  }
  try {
    const raw = await goMila.GetUpdateStatus();
    const parsed = JSON.parse(raw) as { data?: AppUpdateStatus };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}
