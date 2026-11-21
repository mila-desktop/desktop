import { fetchJsonWithTimeout } from './providers/shared';

export interface BackendContractInfo {
  status: string;
  mode: 'wails' | 'http' | string;
  apiBase: string;
  extBase: string;
  capabilities: string[];
  time?: string;
}

export interface DiagnosticsReport {
  path: string;
  files: number;
  bytes: number;
  exportedAt: string;
  redacted: boolean;
}

export interface WailsMilaGoBindings {
  SetFullscreen?: (fullscreen: boolean) => Promise<void>;
  SetFullscreenFocus?: (focused: boolean) => Promise<void>;
  SetPipMode?: (pip: boolean) => Promise<void>;
  StartPipDrag?: () => Promise<void>;
  SetTrayPlaying?: (playing: boolean) => Promise<void>;
  GetAniSkipTimes?: (malID: number, episode: number) => Promise<string>;
  SaveWindowState?: (
    x: number,
    y: number,
    width: number,
    height: number,
    maximized: boolean
  ) => Promise<void>;
  GetContractInfo?: () => Promise<string>;
  ExportDiagnosticsLogs?: (destDir: string) => Promise<string>;
  AnimeVostSearch?: (query: string) => Promise<string>;
  AnimeVostPlaylist?: (id: number) => Promise<string>;
  AnimeGOSearch?: (query: string) => Promise<string>;
  AnimeGOPlayer?: (animeId: number) => Promise<string>;
  HentaiSearch?: (query: string) => Promise<string>;
  HentaiGetEpisodes?: (provider: string, target: string) => Promise<string>;
  ZokoProbe?: (malID: number, episodeCount: number, query: string) => Promise<string>;
  TorrentSearch?: (query: string, aniLibriaID: number) => Promise<string>;
  TorrentOpen?: (magnet: string) => Promise<string>;
  TorrentProbeFile?: (infoHash: string, fileIndex: number) => Promise<string>;
  GetFFmpegStatus?: () => Promise<string>;
  GetTorrentMediaBase?: () => Promise<string>;
  CloudPing?: () => Promise<string>;
  CloudRequest?: (method: string, path: string, bodyJSON: string) => Promise<string>;
  CloudLoginWithGoogle?: () => Promise<string>;
  CloudGetSession?: () => Promise<string>;
  CloudLogout?: () => Promise<string>;
  CloudSetUsername?: (username: string) => Promise<string>;
  CloudSearchUsers?: (query: string, limit: number) => Promise<string>;
  CloudListFriends?: () => Promise<string>;
  CloudSendFriendRequest?: (target: string) => Promise<string>;
  CloudAcceptFriendRequest?: (target: string) => Promise<string>;
  CloudDeclineFriendRequest?: (target: string) => Promise<string>;
  CloudRemoveFriend?: (target: string) => Promise<string>;
  CloudBlockUser?: (target: string) => Promise<string>;
  CloudUnblockUser?: (target: string) => Promise<string>;
  CloudConnectWatchTogether?: (activity: string) => Promise<string>;
  CloudDisconnectWatchTogether?: () => Promise<string>;
  CloudHeartbeatPresence?: (status: string, activity: string) => Promise<string>;
  CloudGetWatchRoom?: () => Promise<string>;
  CloudCreateWatchRoom?: (payloadJSON: string) => Promise<string>;
  CloudJoinWatchRoom?: (payloadJSON: string) => Promise<string>;
  CloudLeaveWatchRoom?: () => Promise<string>;
  CloudSetWatchRoomMedia?: (payloadJSON: string) => Promise<string>;
  CloudSyncWatchRoomPlayback?: (payloadJSON: string) => Promise<string>;
  CloudUpdateWatchRoomMember?: (payloadJSON: string) => Promise<string>;
  CloudSendWatchRoomChat?: (text: string, kind: string) => Promise<string>;
  CloudInviteFriendToWatchRoom?: (target: string) => Promise<string>;
  CloudCancelWatchRoomInvite?: (target: string) => Promise<string>;
  CloudDeclineWatchRoomInvite?: (target: string) => Promise<string>;
  CloudKickWatchRoomMember?: (target: string) => Promise<string>;
  CloudTransferWatchRoomHost?: (target: string) => Promise<string>;
  CloudUpdateWatchRoomSettings?: (payloadJSON: string) => Promise<string>;
  GetAppVersion?: () => Promise<string>;
  GetUpdateStatus?: () => Promise<string>;
  CheckAndInstallUpdate?: () => Promise<string>;
  ConsumePendingDeepLink?: () => Promise<string>;
}

export interface WailsRuntimeBridge {
  WindowFullscreen?: () => void;
  WindowUnfullscreen?: () => void;
  WindowIsFullscreen?: () => Promise<boolean>;
  WindowIsMaximised?: () => Promise<boolean>;
  WindowMinimise?: () => void;
  Quit?: () => void;
  BrowserOpenURL?: (url: string) => void;
  EventsOn?: (eventName: string, callback: (...data: unknown[]) => void) => () => void;
}

interface WindowWithGoBridges extends Window {
  chrome?: { webview?: unknown };
  runtime?: WailsRuntimeBridge;
  go?: {
    mila?: {
      Mila?: WailsMilaGoBindings;
    };
  };
}

const HEALTH_PROBE_CACHE_MS = 15_000;
let cachedApiBase: string | null | undefined;
let cacheExpiresAt = 0;

function getWindowBridge(): WindowWithGoBridges | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as WindowWithGoBridges;
}

export function getWailsMilaBridge(): WailsMilaGoBindings | null {
  return getWindowBridge()?.go?.mila?.Mila ?? null;
}

export function getWailsRuntimeBridge(): WailsRuntimeBridge | null {
  return getWindowBridge()?.runtime ?? null;
}

export function isDesktopWailsApp(): boolean {
  const w = getWindowBridge();
  if (!w) return false;
  return Boolean(w.chrome?.webview || w.runtime || w.go?.mila?.Mila);
}

/**
 * Resolves the active Go HTTP API base identically for both `.exe` (same-origin Wails handler)
 * and `vite dev` (Vite proxy `/api/v1` -> `:8080`, or standalone `http://localhost:8080/api/v1`).
 */
export async function resolveBackendApiBase(
  probeFn: <T>(url: string, init?: RequestInit, timeoutMs?: number) => Promise<T> = fetchJsonWithTimeout
): Promise<string | null> {
  const now = Date.now();
  if (cachedApiBase !== undefined && now < cacheExpiresAt) {
    return cachedApiBase;
  }

  // Inside Wails runtime (or Wails dev server), Go IPC handles native routes directly; skip probing :8080 if unreachable.
  const hasWailsBridge = Boolean(getWailsMilaBridge());
  const candidates: Array<{ healthUrl: string; apiBase: string }> = hasWailsBridge
    ? [{ healthUrl: '/health', apiBase: '/api/v1' }]
    : [
        { healthUrl: '/health', apiBase: '/api/v1' },
        { healthUrl: 'http://localhost:8080/health', apiBase: 'http://localhost:8080/api/v1' }
      ];

  for (const candidate of candidates) {
    try {
      const payload = await probeFn<Record<string, unknown>>(candidate.healthUrl, undefined, 700);
      if (payload && payload.status === 'ok') {
        cachedApiBase = candidate.apiBase;
        cacheExpiresAt = now + HEALTH_PROBE_CACHE_MS;
        return cachedApiBase;
      }
    } catch {
      // Try next origin candidate
    }
  }

  cachedApiBase = null;
  cacheExpiresAt = now + HEALTH_PROBE_CACHE_MS * 4;
  return null;
}

export function resetBackendApiCacheForTest(): void {
  cachedApiBase = undefined;
  cacheExpiresAt = 0;
}

/** Unwraps `{ data: T }` envelopes or returns raw JSON cleanly. */
export function unwrapDataEnvelope<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export interface DualContractCallOptions<T> {
  wailsCall?: (bridge: WailsMilaGoBindings) => Promise<string>;
  httpPath: string;
  httpInit?: RequestInit;
  timeoutMs?: number;
  validate?: (value: unknown) => value is T;
}

/**
 * Executes a Go<->JS backend call uniformly across `.exe` (Wails IPC first) and `vite dev` (HTTP).
 */
export async function callUnifiedContract<T>(options: DualContractCallOptions<T>): Promise<T> {
  const bridge = getWailsMilaBridge();
  if (bridge && options.wailsCall) {
    try {
      const raw = await options.wailsCall(bridge);
      const parsed = unwrapDataEnvelope<unknown>(JSON.parse(raw));
      if (!options.validate || options.validate(parsed)) {
        return parsed as T;
      }
    } catch {
      // Fall through to same-origin HTTP endpoint if IPC failed or returned empty/invalid payload.
    }
  }

  const target =
    options.httpPath.startsWith('/') || options.httpPath.startsWith('http')
      ? options.httpPath
      : `/api/v1/${options.httpPath}`;

  const res = await fetchJsonWithTimeout<unknown>(target, options.httpInit, options.timeoutMs ?? 7500);
  const unwrapped = unwrapDataEnvelope<unknown>(res);
  if (options.validate && !options.validate(unwrapped)) {
    throw new Error(`Invalid contract response from ${target}`);
  }
  return unwrapped as T;
}

/** Fetches runtime contract capabilities (`mode`, `apiBase`, `extBase`, `capabilities`). */
export async function getBackendContractInfo(): Promise<BackendContractInfo> {
  return callUnifiedContract<BackendContractInfo>({
    wailsCall: (bridge) =>
      bridge.GetContractInfo ? bridge.GetContractInfo() : Promise.reject(new Error('missing GetContractInfo')),
    httpPath: '/health',
    timeoutMs: 1500
  });
}

/** Exports redacted rotating log files into a diagnostic `.zip` bundle on disk. */
export async function exportDiagnosticLogs(destDir = ''): Promise<DiagnosticsReport> {
  const query = destDir.trim() ? `?dir=${encodeURIComponent(destDir.trim())}` : '';
  return callUnifiedContract<DiagnosticsReport>({
    wailsCall: (bridge) =>
      bridge.ExportDiagnosticsLogs
        ? bridge.ExportDiagnosticsLogs(destDir)
        : Promise.reject(new Error('missing ExportDiagnosticsLogs')),
    httpPath: `/api/v1/diagnostics/logs${query}`,
    httpInit: { method: 'POST' },
    timeoutMs: 8000
  });
}
