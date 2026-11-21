export type SettingsSectionId =
  | 'appearance'
  | 'playback'
  | 'audioSubs'
  | 'shortcuts'
  | 'watchTogether'
  | 'torrents'
  | 'windowPerf'
  | 'storage'
  | 'about';

export type QualityPref = '1080p' | '720p' | 'auto';
export type StreamProviderPref = 'auto' | 'aniliberty' | 'dreamcast' | 'animego' | 'animevost' | 'kodik';
export type TorrentRemuxMode = 'auto' | 'always' | 'direct';
export type StartupPagePref = 'home' | 'library' | 'news' | 'watch-together';
export type CardRadiusPref = 'sharp' | 'default' | 'round';
export type EpisodesViewPref = 'grid' | 'list';
export type DefaultTorQualityPref = 'all' | '2160p' | '1440p' | '1080p';

export type ShortcutActionId =
  | 'playPause'
  | 'seekBack'
  | 'seekForward'
  | 'jumpBack'
  | 'jumpForward'
  | 'volUp'
  | 'volDown'
  | 'mute'
  | 'fullscreen'
  | 'skipOp'
  | 'subtitles'
  | 'nextEp'
  | 'prevEp'
  | 'appSearch'
  | 'appFullscreen';

export type ShortcutMap = Record<ShortcutActionId, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  playPause: 'Space',
  seekBack: 'Left',
  seekForward: 'Right',
  jumpBack: 'J',
  jumpForward: 'L',
  volUp: 'Up',
  volDown: 'Down',
  mute: 'M',
  fullscreen: 'F',
  skipOp: 'S',
  subtitles: 'C',
  nextEp: 'N',
  prevEp: 'P',
  appSearch: '/',
  appFullscreen: 'F11'
};

const SYSTEM_KEY_PREFIX = 'mila.sys.';
const QUALITY_KEY = 'mila.setup.quality';
const SPEED_KEY = 'mila.player.speed';
const VOLUME_KEY = 'mila.player.volume';
const VIDEO_PREFS_KEY = 'mila.player.videoPrefs';
const EP_VIEW_MODE_KEY = 'mila.anime.episodesViewMode';
const WT_CHAT_PINNED_KEY = 'mila.wt.chatPinned';
const SHORTCUTS_KEY = 'mila.sys.shortcuts';

function safeGet(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, val: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, val);
  } catch {
    // Ignore storage errors
  }
}

function readBool(key: string, fallback: boolean): boolean {
  const v = safeGet(key);
  if (v === '1') return true;
  if (v === '0') return false;
  return fallback;
}

function readNum(key: string, allowed: number[], fallback: number): number {
  const n = Number(safeGet(key));
  return allowed.includes(n) ? n : fallback;
}

function readEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = safeGet(key) as T | null;
  return raw && allowed.includes(raw) ? raw : fallback;
}

function readVideoPrefs(): { brightness: number; autoNext: boolean; autoSkip: boolean } {
  const raw = safeGet(VIDEO_PREFS_KEY);
  if (!raw) return { brightness: 1, autoNext: true, autoSkip: false };
  try {
    const p = JSON.parse(raw) as Partial<{ brightness: number; autoNext: boolean; autoSkip: boolean }>;
    return {
      brightness:
        typeof p.brightness === 'number' && Number.isFinite(p.brightness)
          ? Math.max(0.6, Math.min(1.4, p.brightness))
          : 1,
      autoNext: typeof p.autoNext === 'boolean' ? p.autoNext : true,
      autoSkip: typeof p.autoSkip === 'boolean' ? p.autoSkip : false
    };
  } catch {
    return { brightness: 1, autoNext: true, autoSkip: false };
  }
}

function readVolume(): number {
  const raw = Number(safeGet(VOLUME_KEY));
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? Math.round(raw * 100) / 100 : 1;
}

function readShortcuts(): ShortcutMap {
  const raw = safeGet(SHORTCUTS_KEY);
  if (!raw) return { ...DEFAULT_SHORTCUTS };
  try {
    const parsed = JSON.parse(raw) as Partial<ShortcutMap>;
    return {
      ...DEFAULT_SHORTCUTS,
      ...Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
      )
    };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

const initVideoPrefs = readVideoPrefs();

export const settingsState = $state<{
  open: boolean;
  section: SettingsSectionId;
  // Appearance
  cardRadius: CardRadiusPref;
  ambientBlur: boolean;
  glassBlur: boolean;
  reducedMotion: boolean;
  autoHideHeader: boolean;
  episodesView: EpisodesViewPref;
  // Playback Engine
  defaultQuality: QualityPref;
  preferredProvider: StreamProviderPref;
  defaultSpeed: number;
  seekStepSec: number;
  holdBoostRate: number;
  hlsBufferSec: number;
  autoNext: boolean;
  autoSkip: boolean;
  autoPlayOnOpen: boolean;
  startMuted: boolean;
  pauseOnMinimize: boolean;
  // Audio & Subtitles
  defaultVolume: number;
  volumeStepPct: number;
  subtitleScale: number;
  brightness: number;
  audioPriority: 'ru' | 'orig' | 'first';
  showPlayerOsd: boolean;
  hardwareMediaKeys: boolean;
  // Shortcuts
  shortcuts: ShortcutMap;
  // Watch Together
  wtDriftDeadband: number;
  wtMaxCatchupRate: number;
  wtHardSeekSec: number;
  wtChatPinned: boolean;
  wtChatAutoOpen: boolean;
  wtShowSystemMsgs: boolean;
  // Torrents & Network
  torrentRemuxMode: TorrentRemuxMode;
  preferHiResTorrents: boolean;
  preferRuTorrents: boolean;
  defaultTorrentQuality: DefaultTorQualityPref;
  prefetchNextEpisode: boolean;
  hoverEpisodePreview: boolean;
  // Window & System
  startupPage: StartupPagePref;
  autoEnterPip: boolean;
}>({
  open: false,
  section: 'appearance',
  cardRadius: readEnum(`${SYSTEM_KEY_PREFIX}cardRadius`, ['sharp', 'default', 'round'], 'default'),
  ambientBlur: readBool(`${SYSTEM_KEY_PREFIX}ambientBlur`, true),
  glassBlur: readBool(`${SYSTEM_KEY_PREFIX}glassBlur`, true),
  reducedMotion: readBool(`${SYSTEM_KEY_PREFIX}reducedMotion`, false),
  autoHideHeader: readBool(`${SYSTEM_KEY_PREFIX}autoHideHeader`, true),
  episodesView: readEnum(EP_VIEW_MODE_KEY, ['grid', 'list'], 'grid'),
  defaultQuality: readEnum(QUALITY_KEY, ['1080p', '720p', 'auto'], '1080p'),
  preferredProvider: readEnum(
    `${SYSTEM_KEY_PREFIX}preferredProvider`,
    ['auto', 'aniliberty', 'dreamcast', 'animego', 'animevost', 'kodik'],
    'auto'
  ),
  defaultSpeed: readNum(SPEED_KEY, [0.5, 0.75, 1, 1.25, 1.5, 2], 1),
  seekStepSec: readNum(`${SYSTEM_KEY_PREFIX}seekStepSec`, [5, 10, 15, 30], 5),
  holdBoostRate: readNum(`${SYSTEM_KEY_PREFIX}holdBoostRate`, [1.5, 2, 2.5], 2),
  hlsBufferSec: readNum(`${SYSTEM_KEY_PREFIX}hlsBufferSec`, [15, 30, 60], 30),
  autoNext: initVideoPrefs.autoNext,
  autoSkip: initVideoPrefs.autoSkip,
  autoPlayOnOpen: readBool(`${SYSTEM_KEY_PREFIX}autoPlayOpen`, true),
  startMuted: readBool(`${SYSTEM_KEY_PREFIX}startMuted`, false),
  pauseOnMinimize: readBool(`${SYSTEM_KEY_PREFIX}pauseOnMinimize`, false),
  defaultVolume: readVolume(),
  volumeStepPct: readNum(`${SYSTEM_KEY_PREFIX}volumeStepPct`, [2, 5, 10], 5),
  subtitleScale: readNum(`${SYSTEM_KEY_PREFIX}subtitleScale`, [85, 100, 120, 140], 100),
  brightness: initVideoPrefs.brightness,
  audioPriority: readEnum(`${SYSTEM_KEY_PREFIX}audioPriority`, ['ru', 'orig', 'first'], 'ru'),
  showPlayerOsd: readBool(`${SYSTEM_KEY_PREFIX}showOsd`, true),
  hardwareMediaKeys: readBool(`${SYSTEM_KEY_PREFIX}mediaKeys`, true),
  shortcuts: readShortcuts(),
  wtDriftDeadband: readNum(`${SYSTEM_KEY_PREFIX}wtDriftDeadband`, [0.25, 0.45, 1.0], 0.45),
  wtMaxCatchupRate: readNum(`${SYSTEM_KEY_PREFIX}wtMaxCatchupRate`, [1.2, 1.35, 1.5], 1.35),
  wtHardSeekSec: readNum(`${SYSTEM_KEY_PREFIX}wtHardSeekSec`, [15, 30, 60], 30),
  wtChatPinned: readBool(WT_CHAT_PINNED_KEY, false),
  wtChatAutoOpen: readBool(`${SYSTEM_KEY_PREFIX}wtChatAutoOpen`, true),
  wtShowSystemMsgs: readBool(`${SYSTEM_KEY_PREFIX}wtShowSystem`, true),
  torrentRemuxMode: readEnum(`${SYSTEM_KEY_PREFIX}torrentRemux`, ['auto', 'always', 'direct'], 'auto'),
  preferHiResTorrents: readBool(`${SYSTEM_KEY_PREFIX}preferHiResTorrents`, true),
  preferRuTorrents: readBool(`${SYSTEM_KEY_PREFIX}preferRuTorrents`, true),
  defaultTorrentQuality: readEnum(
    `${SYSTEM_KEY_PREFIX}defaultTorQuality`,
    ['all', '2160p', '1440p', '1080p'],
    'all'
  ),
  prefetchNextEpisode: readBool(`${SYSTEM_KEY_PREFIX}prefetchNextEp`, true),
  hoverEpisodePreview: readBool(`${SYSTEM_KEY_PREFIX}hoverEpPreview`, true),
  startupPage: readEnum(`${SYSTEM_KEY_PREFIX}startupPage`, ['home', 'library', 'news', 'watch-together'], 'home'),
  autoEnterPip: readBool(`${SYSTEM_KEY_PREFIX}autoEnterPip`, true)
});

function radiusPxForPref(pref: CardRadiusPref): string {
  switch (pref) {
    case 'sharp':
      return '8px';
    case 'round':
      return '22px';
    default:
      return '16px';
  }
}

export function applySystemDomPreferences(): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const root = document.documentElement;
  root.style.setProperty('--mila-sub-scale', `${(settingsState.subtitleScale / 100).toFixed(2)}`);
  root.style.setProperty('--radius-card', radiusPxForPref(settingsState.cardRadius));
  root.toggleAttribute('data-reduced-motion', settingsState.reducedMotion);
  root.toggleAttribute('data-no-ambient', !settingsState.ambientBlur);
  root.toggleAttribute('data-no-glass-blur', !settingsState.glassBlur);
}

applySystemDomPreferences();

export function syncVideoPrefsStorage(): void {
  safeSet(
    VIDEO_PREFS_KEY,
    JSON.stringify({
      brightness: settingsState.brightness,
      autoNext: settingsState.autoNext,
      autoSkip: settingsState.autoSkip
    })
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mila:sys-prefs-changed'));
  }
}

export function openSettingsPopup(section?: SettingsSectionId): void {
  const vp = readVideoPrefs();
  settingsState.brightness = vp.brightness;
  settingsState.autoNext = vp.autoNext;
  settingsState.autoSkip = vp.autoSkip;
  settingsState.defaultVolume = readVolume();
  settingsState.episodesView = readEnum(EP_VIEW_MODE_KEY, ['grid', 'list'], 'grid');
  settingsState.wtChatPinned = readBool(WT_CHAT_PINNED_KEY, false);
  if (section) {
    settingsState.section = section;
  }
  settingsState.open = true;
}

export function closeSettingsPopup(): void {
  settingsState.open = false;
}

export function setSettingPref<K extends keyof typeof settingsState>(
  key: K,
  value: (typeof settingsState)[K],
  storageKey?: string
): void {
  settingsState[key] = value;
  if (storageKey) {
    if (typeof value === 'boolean') {
      safeSet(storageKey, value ? '1' : '0');
    } else {
      safeSet(storageKey, String(value));
    }
  }
  if (key === 'brightness' || key === 'autoNext' || key === 'autoSkip') {
    syncVideoPrefsStorage();
  } else if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mila:sys-prefs-changed'));
  }
  applySystemDomPreferences();
}

export function setShortcutBinding(action: ShortcutActionId, combo: string): void {
  settingsState.shortcuts = {
    ...settingsState.shortcuts,
    [action]: combo
  };
  safeSet(SHORTCUTS_KEY, JSON.stringify(settingsState.shortcuts));
}

export function resetAllShortcuts(): void {
  settingsState.shortcuts = { ...DEFAULT_SHORTCUTS };
  safeSet(SHORTCUTS_KEY, JSON.stringify(settingsState.shortcuts));
}

export function matchesShortcut(e: KeyboardEvent, combo: string): boolean {
  const parts = combo
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;
  const wantCtrl = parts.includes('ctrl');
  const wantAlt = parts.includes('alt');
  const wantShift = parts.includes('shift');
  if (e.ctrlKey !== wantCtrl || e.altKey !== wantAlt || e.shiftKey !== wantShift) {
    return false;
  }
  const target = parts[parts.length - 1];
  const code = e.code.toLowerCase();
  const key = e.key.toLowerCase();
  if (target === 'space') return code === 'space' || key === ' ';
  if (target === 'left') return key === 'arrowleft' || code === 'arrowleft';
  if (target === 'right') return key === 'arrowright' || code === 'arrowright';
  if (target === 'up') return key === 'arrowup' || code === 'arrowup';
  if (target === 'down') return key === 'arrowdown' || code === 'arrowdown';
  if (target === '/') return key === '/' || code === 'slash';
  if (/^f([1-9]|1[0-2])$/.test(target)) return key === target || code === target;
  return key === target || code === `key${target}` || code === `digit${target}`;
}

export function resetAllSystemSettings(): void {
  settingsState.cardRadius = 'default';
  settingsState.ambientBlur = true;
  settingsState.glassBlur = true;
  settingsState.reducedMotion = false;
  settingsState.autoHideHeader = true;
  settingsState.episodesView = 'grid';
  settingsState.defaultQuality = '1080p';
  settingsState.preferredProvider = 'auto';
  settingsState.defaultSpeed = 1;
  settingsState.seekStepSec = 5;
  settingsState.holdBoostRate = 2;
  settingsState.hlsBufferSec = 30;
  settingsState.autoNext = true;
  settingsState.autoSkip = false;
  settingsState.autoPlayOnOpen = true;
  settingsState.startMuted = false;
  settingsState.pauseOnMinimize = false;
  settingsState.defaultVolume = 1;
  settingsState.volumeStepPct = 5;
  settingsState.subtitleScale = 100;
  settingsState.brightness = 1;
  settingsState.audioPriority = 'ru';
  settingsState.showPlayerOsd = true;
  settingsState.hardwareMediaKeys = true;
  settingsState.wtDriftDeadband = 0.45;
  settingsState.wtMaxCatchupRate = 1.35;
  settingsState.wtHardSeekSec = 30;
  settingsState.wtChatPinned = false;
  settingsState.wtChatAutoOpen = true;
  settingsState.wtShowSystemMsgs = true;
  settingsState.torrentRemuxMode = 'auto';
  settingsState.preferHiResTorrents = true;
  settingsState.preferRuTorrents = true;
  settingsState.defaultTorrentQuality = 'all';
  settingsState.prefetchNextEpisode = true;
  settingsState.hoverEpisodePreview = true;
  settingsState.startupPage = 'home';
  settingsState.autoEnterPip = true;
  resetAllShortcuts();

  if (typeof localStorage !== 'undefined') {
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(SYSTEM_KEY_PREFIX) && k !== SHORTCUTS_KEY) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(QUALITY_KEY, '1080p');
      localStorage.setItem(SPEED_KEY, '1');
      localStorage.setItem(VOLUME_KEY, '1');
      localStorage.setItem(EP_VIEW_MODE_KEY, 'grid');
      localStorage.setItem(WT_CHAT_PINNED_KEY, '0');
    } catch {
      // Ignore storage errors
    }
  }
  syncVideoPrefsStorage();
  applySystemDomPreferences();
}

const CACHE_KEY_PREFIXES = ['mila.cache.', 'mila.news.', 'mila.shiki.', 'mila.libria.', 'mila.anime.cache'];

export function getCacheStats(): { entries: number; bytes: number } {
  if (typeof localStorage === 'undefined') return { entries: 0, bytes: 0 };
  let entries = 0;
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (CACHE_KEY_PREFIXES.some((p) => key.startsWith(p))) {
        entries += 1;
        bytes += (localStorage.getItem(key)?.length ?? 0) * 2;
      }
    }
  } catch {
    // Ignore storage inspection failures
  }
  return { entries, bytes };
}

export function clearAppCache(): number {
  if (typeof localStorage === 'undefined') return 0;
  const targets: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && CACHE_KEY_PREFIXES.some((p) => key.startsWith(p))) {
        targets.push(key);
      }
    }
    for (const key of targets) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore removal errors
  }
  return targets.length;
}
