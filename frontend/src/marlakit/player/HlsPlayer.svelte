<script lang="ts">
  import type HlsType from 'hls.js';
  import type { ErrorData } from 'hls.js';
  import { MorphIcon } from 'morphicons/svelte';
  import {
    Play,
    Pause,
    Volume1,
    Volume2,
    VolumeX,
    Maximize,
    Minimize,
    PictureInPicture2,
    Settings,
    SlidersHorizontal,
    SkipBack,
    SkipForward,
    AudioLines,
    FastForward,
    MessageSquare,
    RotateCcw,
    ArrowRightLeft,
    ArrowUpLeft,
    X
  } from 'lucide';
  import { onDestroy, untrack } from 'svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  import ComboBox from '../combo/ComboBox.svelte';
  import type { ComboSection } from '../combo/types';
  import Slider from '../slider/Slider.svelte';
  import Toggle from '../toggle/Toggle.svelte';
  import { t } from '../../app/i18n.svelte';
  import { getLoadedHls, loadHls } from '../../app/hlsLoader';
  import { releaseVideoElementBuffers, safeStorageSet } from '../../app/lifecycle';
  import { matchesShortcut, settingsState } from '../../app/settings.svelte';
  import { createLazyModuleLoader } from '../../api/providers/lazy';
  import {
    createMaxQualityHlsConfig,
    formatQualityLabel,
    resolvePlaybackSource,
    type Mp4Variant
  } from './hlsConfig';

  const torrentLoader = createLazyModuleLoader(() => import('../../api/providers/torrent'));
  import type {
    AudioTrackOption,
    DubAudioSource,
    HlsSources,
    QualityLevelOption,
    SkipRange,
    SubtitleTrackOption,
    TorrentRemuxConfig,
    VoiceTrackOption
  } from './types';

  interface Props {
    src?: string;
    sources?: HlsSources | null;
    dubAudio?: DubAudioSource | null;
    dubVoiceId?: string;
    dubOffsetSec?: number;
    poster?: string;
    title?: string;
    subtitle?: string;
    autoplay?: boolean;
    initialTime?: number;
    voices?: VoiceTrackOption[];
    selectedVoiceId?: string;
    preferMaxQuality?: boolean;
    opening?: SkipRange | null;
    ending?: SkipRange | null;
    hasPrev?: boolean;
    hasNext?: boolean;
    hasFallback?: boolean;
    isPip?: boolean;
    keyboardEnabled?: boolean;
    controlsLocked?: boolean;
    chatOpen?: boolean;
    chatUnread?: number;
    ontogglechat?: () => void;
    onprev?: () => void;
    onnext?: () => void;
    onended?: () => void;
    ontimeprogress?: (currentTime: number, duration: number, force?: boolean) => void;
    onplaybackaction?: (event: {
      kind: 'play' | 'pause' | 'seek' | 'rate';
      currentTime: number;
      duration: number;
      paused: boolean;
      playbackRate: number;
    }) => void;
    onselectvoice?: (voice: VoiceTrackOption, currentTime: number) => void;
    onselectdubvoice?: (voice: VoiceTrackOption | null) => void;
    onduboffsetchange?: (offsetSec: number) => void;
    onfallback?: () => void;
    onerror?: (message: string) => void;
    onpip?: () => void;
    onexpandpip?: () => void;
    onclosepip?: () => void;
    onplaychange?: (playing: boolean) => void;
    onpipdragstart?: (e: PointerEvent) => void;
    class?: string;
  }

  let {
    src = '',
    sources = null,
    dubAudio = null,
    dubVoiceId = '',
    dubOffsetSec = 0,
    poster = '',
    title = '',
    subtitle = '',
    autoplay = false,
    initialTime = 0,
    voices = [],
    selectedVoiceId = '',
    preferMaxQuality = true,
    opening = null,
    ending = null,
    hasPrev = false,
    hasNext = false,
    hasFallback = false,
    isPip = false,
    keyboardEnabled = true,
    controlsLocked = false,
    chatOpen = false,
    chatUnread = 0,
    ontogglechat,
    onprev,
    onnext,
    onended,
    ontimeprogress,
    onplaybackaction,
    onselectvoice,
    onselectdubvoice,
    onduboffsetchange,
    onfallback,
    onerror,
    onpip,
    onexpandpip,
    onclosepip,
    onplaychange,
    onpipdragstart,
    class: className = ''
  }: Props = $props();

  interface VideoPrefs {
    brightness: number;
    autoNext: boolean;
    autoSkip: boolean;
  }

  const VOLUME_KEY = 'mila.player.volume';
  const MUTED_KEY = 'mila.player.muted';
  const SPEED_KEY = 'mila.player.speed';
  const VIDEO_PREFS_KEY = 'mila.player.videoPrefs';
  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const DEFAULT_VIDEO_PREFS: VideoPrefs = {
    brightness: 1,
    autoNext: true,
    autoSkip: false
  };

  let rootEl = $state<HTMLDivElement | null>(null);
  let videoEl = $state<HTMLVideoElement | null>(null);
  let dubAudioEl = $state<HTMLVideoElement | null>(null);
  let previewVideoEl = $state<HTMLVideoElement | null>(null);
  let previewCanvasEl = $state<HTMLCanvasElement | null>(null);
  let seekEl = $state<HTMLDivElement | null>(null);

  let hls: HlsType | null = null;
  let dubHls: HlsType | null = null;
  let previewHls: HlsType | null = null;
  let playing = $state(false);
  let buffering = $state(false);
  let dubReady = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let bufferedEnd = $state(0);

  let volume = $state(readSavedVolume());
  let muted = $state(readSavedMuted());
  let playbackRate = $state(readSavedSpeed());
  let videoPrefs = $state<VideoPrefs>(readSavedVideoPrefs());
  let spaceHoldBoostActive = $state(false);

  let isFullscreen = $state(false);
  let controlsVisible = $state(true);
  let activeMenu = $state<'none' | 'voice' | 'quality' | 'speed' | 'appearance'>('none');
  let errorText = $state('');

  let osdText = $state('');
  let osdKind = $state<'volume' | 'mute' | 'seek' | 'speed' | 'play' | 'info'>('info');
  let osdVisible = $state(false);
  let osdTimer: number | undefined;

  let levels = $state<QualityLevelOption[]>([]);
  let selectedLevel = $state(-1); // -1 = Auto ABR, >=0 = pinned level index
  let activeLevelIndex = $state(-1);
  let audioTracks = $state<AudioTrackOption[]>([]);
  let activeAudioTrack = $state(-1);
  let subtitleTracks = $state<SubtitleTrackOption[]>([]);
  let activeSubtitleTrack = $state(-1);
  let playbackMode = $state<'hls' | 'mp4' | 'remux'>('hls');
  let activeRemuxConfig = $state<TorrentRemuxConfig | null>(null);
  let remuxSeekOffset = $state(0);
  let remuxTotalDuration = $state(0);
  let remuxStreamOptions = $state<{ videoCodec?: string; transcode?: boolean }>({});
  let ffmpegNotice = $state('');
  let mp4Variants = $state<Mp4Variant[]>([]);
  let reloadTick = $state(0);

  let hoverTime = $state<number | null>(null);
  let hoverPct = $state(0);
  let previewHasFrame = $state(false);
  let previewMediaSpec = $state<{ mode: 'hls' | 'mp4' | 'none'; url: string }>({ mode: 'none', url: '' });
  let previewAttachedUrl = '';
  let previewSeekTimer: number | undefined;
  let previewLastRequestedSec = -1;
  let draggingSeek = $state(false);
  let hideTimer: number | undefined;
  let lastHideArmMs = 0;
  let spaceHoldTimer: number | undefined;
  let pipClickTimer: number | undefined;
  let volumePersistTimer: number | undefined;
  let videoPrefsPersistTimer: number | undefined;
  let seekHoverRaf = 0;
  let pendingHoverSeekSec: number | null = null;
  let cachedSeekRect: DOMRect | null = null;
  let cachedSeekRectAt = 0;
  let spaceIsDown = false;
  let networkRetries = 0;
  let reparentingGuard = false;
  let suppressSyncUntil = 0;
  let suppressNextVideoClick = false;
  let activeBlobRevoke: (() => void) | null = null;
  let pendingRestoreSeek: (() => void) | null = null;
  let autoSkippedOp = false;
  let autoSkippedEd = false;

  function emitLocalPlaybackAction(
    kind: 'play' | 'pause' | 'seek' | 'rate',
    overrides?: { paused?: boolean; currentTime?: number; playbackRate?: number }
  ): void {
    if (!onplaybackaction || Date.now() < suppressSyncUntil) return;
    const now = overrides?.currentTime ?? streamTimeNow();
    const tot = remuxTotalDuration > 0 ? remuxTotalDuration : videoEl?.duration || duration || 0;
    const isPaused = overrides?.paused ?? (videoEl ? videoEl.paused : !playing);
    const rate = overrides?.playbackRate ?? playbackRate;
    onplaybackaction({
      kind,
      currentTime: Number.isFinite(now) ? now : 0,
      duration: Number.isFinite(tot) ? tot : 0,
      paused: isPaused,
      playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1
    });
  }

  export function getPlaybackSnapshot(): {
    currentTime: number;
    duration: number;
    paused: boolean;
    playbackRate: number;
    ready: boolean;
  } {
    const now = streamTimeNow();
    const tot = remuxTotalDuration > 0 ? remuxTotalDuration : videoEl?.duration || duration || 0;
    const ready = Boolean(videoEl && (playbackMode === 'remux' || videoEl.readyState >= 2));
    return {
      currentTime: Number.isFinite(now) ? now : 0,
      duration: Number.isFinite(tot) ? tot : 0,
      paused: videoEl ? videoEl.paused : !playing,
      playbackRate,
      ready
    };
  }

  let lastRemoteHardSeekAt = 0;

  export function applySyncState(paused: boolean, positionSec?: number, rate?: number): void {
    if (!videoEl) return;
    suppressSyncUntil = Date.now() + 700;

    const baseRate =
      typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : playbackRate || 1;
    if (Math.abs(baseRate - playbackRate) > 0.01) {
      playbackRate = baseRate;
    }

    if (typeof positionSec === 'number' && Number.isFinite(positionSec) && positionSec >= 0) {
      const cur = streamTimeNow();
      const tot = remuxTotalDuration > 0 ? remuxTotalDuration : videoEl.duration || duration || 0;
      const clamped = tot > 0 ? Math.max(0, Math.min(tot, positionSec)) : Math.max(0, positionSec);
      const signedDrift = clamped - cur;
      const absDrift = Math.abs(signedDrift);
      const now = Date.now();

      if (paused) {
        applyPlaybackRate(baseRate);
        if (absDrift > 1.5 && now - lastRemoteHardSeekAt > 1500) {
          lastRemoteHardSeekAt = now;
          seekTo(clamped, true);
        }
      } else {
        // Playing: Rave-style adaptive speed catch-up.
        // - Up to ~0.45s deadband: keep normal 1x speed (no teleports, no speed jitter).
        // - From 0.45s up to 30s drift: NEVER teleport/seek (which causes buffer flush & loader spinner);
        //   instead smoothly accelerate or decelerate playbackRate until caught up with host.
        // - Only hard-seek if drift > 30s (e.g. host scrubbed across the episode timeline).
        const deadband = settingsState.wtDriftDeadband || 0.45;
        const maxCatchup = settingsState.wtMaxCatchupRate || 1.35;
        const hardSeekThreshold = settingsState.wtHardSeekSec || 30;
        if (absDrift > hardSeekThreshold && now - lastRemoteHardSeekAt > 3000) {
          lastRemoteHardSeekAt = now;
          applyPlaybackRate(baseRate);
          seekTo(clamped, true);
        } else if (absDrift > deadband) {
          const factor =
            absDrift > 10.0
              ? 0.35
              : absDrift > 5.0
                ? 0.24
                : absDrift > 2.2
                  ? 0.14
                  : absDrift > 1.0
                    ? 0.08
                    : 0.04;
          const catchupRate = Math.max(
            0.7,
            Math.min(maxCatchup, Number((baseRate * (1 + Math.sign(signedDrift) * factor)).toFixed(3)))
          );
          if (Math.abs((videoEl.playbackRate || 1) - catchupRate) > 0.008) {
            applyPlaybackRate(catchupRate);
          }
        } else if (Math.abs((videoEl.playbackRate || 1) - baseRate) > 0.008) {
          applyPlaybackRate(baseRate);
        }
      }
    } else if (!spaceHoldBoostActive && Math.abs((videoEl.playbackRate || 1) - baseRate) > 0.008) {
      applyPlaybackRate(baseRate);
    }

    if (paused && !videoEl.paused) {
      playing = false;
      videoEl.pause();
      dubAudioEl?.pause();
    } else if (!paused && videoEl.paused) {
      playing = true;
      void videoEl.play().catch(() => {});
    }
  }

  export function play(): void {
    if (controlsLocked) {
      showOsd('Host controls playback', 'info');
      return;
    }
    if (videoEl && videoEl.paused) {
      void videoEl.play().catch(() => {});
    }
  }

  export function pause(): void {
    if (controlsLocked) {
      showOsd('Host controls playback', 'info');
      return;
    }
    playing = false;
    videoEl?.pause();
    dubAudioEl?.pause();
  }

  export function beginReparent(): boolean {
    const wasPlaying = videoEl ? !videoEl.paused : playing;
    reparentingGuard = true;
    return wasPlaying;
  }

  export function endReparent(wasPlaying: boolean): void {
    reparentingGuard = false;
    if (wasPlaying && videoEl && videoEl.paused) {
      void videoEl.play().catch(() => {});
    }
  }

  function readSavedVolume(): number {
    if (typeof localStorage === 'undefined') return 1;
    const raw = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
  }

  function readSavedMuted(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(MUTED_KEY) === '1';
  }

  function readSavedSpeed(): number {
    if (typeof localStorage === 'undefined') return 1;
    const raw = Number(localStorage.getItem(SPEED_KEY));
    return SPEED_OPTIONS.includes(raw) ? raw : 1;
  }

  function readSavedVideoPrefs(): VideoPrefs {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_VIDEO_PREFS };
    try {
      const parsed = JSON.parse(localStorage.getItem(VIDEO_PREFS_KEY) || '{}') as Partial<VideoPrefs>;
      const brightness =
        typeof parsed.brightness === 'number' && Number.isFinite(parsed.brightness)
          ? Math.max(0.6, Math.min(1.4, parsed.brightness))
          : DEFAULT_VIDEO_PREFS.brightness;
      const autoNext =
        typeof parsed.autoNext === 'boolean' ? parsed.autoNext : DEFAULT_VIDEO_PREFS.autoNext;
      const autoSkip =
        typeof parsed.autoSkip === 'boolean' ? parsed.autoSkip : DEFAULT_VIDEO_PREFS.autoSkip;
      return { brightness, autoNext, autoSkip };
    } catch {
      return { ...DEFAULT_VIDEO_PREFS };
    }
  }

  function flushVideoPrefsStorage(next: VideoPrefs) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(VIDEO_PREFS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }

  function saveVideoPrefs(next: VideoPrefs) {
    videoPrefs = next;
    if (typeof window === 'undefined') return;
    window.clearTimeout(videoPrefsPersistTimer);
    videoPrefsPersistTimer = window.setTimeout(() => {
      videoPrefsPersistTimer = undefined;
      flushVideoPrefsStorage(videoPrefs);
    }, 180);
  }

  const progressPct = $derived(duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0);
  const bufferedPct = $derived(duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0);

  const activeVoiceLabel = $derived.by(() => {
    const activeVoice = voices.find((v) => v.id === selectedVoiceId) ?? voices[0];
    if (dubAudio) {
      const base = activeVoice?.isSub ? '1080p Video' : activeVoice?.label || 'Video';
      return `${base} + ${dubAudio.label}`;
    }
    if (audioTracks.length > 1) {
      const track = audioTracks.find((t) => t.index === activeAudioTrack);
      if (track) return track.label;
    }
    return activeVoice?.label ?? '';
  });

  const activeQualityLabel = $derived.by(() => {
    const found = levels.find((l) => l.index === activeLevelIndex);
    if (found) return found.label;
    if (levels.length > 0 && selectedLevel >= 0) {
      const pinned = levels.find((l) => l.index === selectedLevel);
      if (pinned) return pinned.label;
    }
    return 'HD';
  });

  function classifyVoiceLanguage(v: VoiceTrackOption): 'ru' | 'en' | 'orig' {
    const lbl = v.label.trim().toLowerCase();
    if (
      v.isSub ||
      lbl.startsWith('original') ||
      lbl.startsWith('sub ') ||
      lbl.startsWith('sub·') ||
      lbl.includes('eng sub') ||
      lbl.includes('субтит')
    ) {
      return 'orig';
    }
    if (v.provider === 'zoko' || /\benglish\b/.test(lbl)) {
      return 'en';
    }
    return 'ru';
  }

  const voiceComboSections = $derived.by<ComboSection[]>(() => {
    const out: ComboSection[] = [];
    const activeId = selectedVoiceId || voices[0]?.id;
    const activeVoice = voices.find((v) => v.id === activeId);
    const activeLang = activeVoice ? classifyVoiceLanguage(activeVoice) : null;

    if (voices.length > 0) {
      const ruVoices: VoiceTrackOption[] = [];
      const enVoices: VoiceTrackOption[] = [];
      const origVoices: VoiceTrackOption[] = [];

      for (const v of voices) {
        const lang = classifyVoiceLanguage(v);
        if (lang === 'en') {
          enVoices.push(v);
        } else if (lang === 'orig') {
          origVoices.push(v);
        } else {
          ruVoices.push(v);
        }
      }

      const toVoiceOption = (v: VoiceTrackOption) => ({
        value: `voice:${v.id}`,
        label: v.label,
        sublabel: v.sublabel,
        selected: activeId === v.id
      });

      const sourceOptions = [];
      if (ruVoices.length > 0) {
        sourceOptions.push({
          value: 'cat:ru',
          label: t('player.voiceRu'),
          selected: activeLang === 'ru',
          subMinWidth: 210,
          subMaxWidth: 276,
          children: ruVoices.map(toVoiceOption)
        });
      }
      if (enVoices.length > 0) {
        sourceOptions.push({
          value: 'cat:en',
          label: t('player.voiceEn'),
          selected: activeLang === 'en',
          subMinWidth: 204,
          subMaxWidth: 276,
          children: enVoices.map(toVoiceOption)
        });
      }
      if (origVoices.length > 0) {
        sourceOptions.push({
          value: 'cat:orig',
          label: t('player.voiceOrig'),
          selected: activeLang === 'orig',
          subMinWidth: 204,
          subMaxWidth: 276,
          children: origVoices.map(toVoiceOption)
        });
      }

      if (sourceOptions.length > 0) {
        out.push({
          id: 'sources',
          options: sourceOptions
        });
      }
    }

    const overlayOptions = [];
    if (onselectdubvoice && voices.length > 1) {
      const dubCandidates = voices
        .filter((v) => !v.isSub && v.id !== activeId && v.provider !== 'torrent')
        .sort((a, b) => {
          const aLang = classifyVoiceLanguage(a) === 'ru' ? 0 : 1;
          const bLang = classifyVoiceLanguage(b) === 'ru' ? 0 : 1;
          return aLang - bLang;
        });

      if (dubCandidates.length > 0 || dubAudio) {
        const dubChildren = [
          ...(dubAudio
            ? [
                {
                  value: 'dub:none',
                  label: t('player.mixOff'),
                  selected: false
                }
              ]
            : []),
          ...dubCandidates.map((v) => ({
            value: `dub:${v.id}`,
            label: v.label,
            sublabel: t('player.mixSublabel'),
            selected: dubVoiceId === v.id
          }))
        ];
        overlayOptions.push({
          value: 'cat:mix',
          label: t('player.voiceMixOver'),
          selected: Boolean(dubAudio),
          subMinWidth: 210,
          subMaxWidth: 276,
          children: dubChildren
        });
      }
    }

    if (audioTracks.length > 1) {
      overlayOptions.push({
        value: 'cat:audio',
        label: t('player.audioTrack'),
        selected: activeAudioTrack >= 0,
        subMinWidth: 184,
        subMaxWidth: 260,
        children: audioTracks.map((tr) => ({
          value: `audio:${tr.index}`,
          label: tr.label,
          selected: activeAudioTrack === tr.index
        }))
      });
    }

    if (subtitleTracks.length > 0) {
      overlayOptions.push({
        value: 'cat:sub',
        label: t('player.subtitles'),
        selected: activeSubtitleTrack >= 0,
        subMinWidth: 184,
        subMaxWidth: 260,
        children: [
          { value: 'sub:-1', label: t('player.subtitlesOff'), selected: activeSubtitleTrack === -1 },
          ...subtitleTracks.map((s) => ({
            value: `sub:${s.index}`,
            label: s.label,
            selected: activeSubtitleTrack === s.index
          }))
        ]
      });
    }

    if (overlayOptions.length > 0) {
      out.push({
        id: 'tracks',
        options: overlayOptions
      });
    }

    return out;
  });

  const speedComboOptions = SPEED_OPTIONS.map((rate) => ({
    value: rate,
    label: `${rate}x`
  }));

  const qualityComboOptions = $derived.by(() => {
    const items = levels.map((lvl) => ({
      value: lvl.index,
      label: lvl.label
    }));
    if (playbackMode === 'hls' && levels.length > 1) {
      items.push({ value: -1, label: 'Auto' });
    }
    return items;
  });

  const skipTarget = $derived.by(() => {
    if (
      opening?.start != null &&
      opening?.stop != null &&
      currentTime >= opening.start &&
      currentTime < opening.stop - 1
    ) {
      return { label: 'Skip Opening', to: opening.stop };
    }
    if (
      ending?.start != null &&
      ending?.stop != null &&
      currentTime >= ending.start &&
      currentTime < ending.stop - 1
    ) {
      return { label: 'Skip Ending', to: ending.stop };
    }
    return null;
  });

  const hoverSegmentLabel = $derived.by(() => {
    if (hoverTime === null) return '';
    if (opening?.start != null && opening?.stop != null && hoverTime >= opening.start && hoverTime <= opening.stop) {
      return 'Opening';
    }
    if (ending?.start != null && ending?.stop != null && hoverTime >= ending.start && hoverTime <= ending.stop) {
      return 'Ending';
    }
    return '';
  });

  const openingMarkerPct = $derived.by(() => {
    if (duration <= 0 || opening?.start == null || opening?.stop == null || opening.stop <= opening.start) {
      return null;
    }
    const left = Math.max(0, Math.min(100, (opening.start / duration) * 100));
    const right = Math.max(left, Math.min(100, (opening.stop / duration) * 100));
    return { left, width: right - left };
  });

  const endingMarkerPct = $derived.by(() => {
    if (duration <= 0 || ending?.start == null || ending?.stop == null || ending.stop <= ending.start) {
      return null;
    }
    const left = Math.max(0, Math.min(100, (ending.start / duration) * 100));
    const right = Math.max(left, Math.min(100, (ending.stop / duration) * 100));
    return { left, width: right - left };
  });

  const videoFilterCss = $derived(`brightness(${videoPrefs.brightness.toFixed(2)})`);

  function showOsd(text: string, kind: 'volume' | 'mute' | 'seek' | 'speed' | 'play' | 'info' = 'info') {
    if ((isPip && !isFullscreen) || !settingsState.showPlayerOsd) return;
    osdText = text;
    osdKind = kind;
    osdVisible = true;
    window.clearTimeout(osdTimer);
    osdTimer = window.setTimeout(() => {
      osdVisible = false;
    }, 1050);
  }

  function scheduleHideControls() {
    if (!controlsVisible) {
      controlsVisible = true;
    } else if (activeMenu === 'none' && !draggingSeek) {
      const now = Date.now();
      if (now - lastHideArmMs < 150) return;
      lastHideArmMs = now;
    }
    window.clearTimeout(hideTimer);
    if (activeMenu !== 'none' || draggingSeek) {
      lastHideArmMs = 0;
      return;
    }
    lastHideArmMs = Date.now();
    hideTimer = window.setTimeout(() => {
      if (activeMenu === 'none' && !draggingSeek) {
        controlsVisible = false;
      }
      lastHideArmMs = 0;
    }, playing ? 2600 : 3000);
  }

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  }

  function destroyDubHls() {
    if (dubHls) {
      dubHls.destroy();
      dubHls = null;
    }
  }

  function destroyPreviewHls() {
    if (previewHls) {
      previewHls.destroy();
      previewHls = null;
    }
  }

  function resetPreviewScrubber() {
    window.clearTimeout(previewSeekTimer);
    previewSeekTimer = undefined;
    previewAttachedUrl = '';
    previewLastRequestedSec = -1;
    previewHasFrame = false;
    destroyPreviewHls();
    releaseVideoElementBuffers(previewVideoEl);
  }

  function attachPreviewWithHls(HlsCtor: typeof HlsType, pVideo: HTMLVideoElement, url: string) {
    if (previewAttachedUrl !== url || previewVideoEl !== pVideo || isPip) return;
    if (HlsCtor.isSupported()) {
      destroyPreviewHls();
      const pHls = new HlsCtor(
        createMaxQualityHlsConfig({
          capLevelToPlayerSize: false,
          startLevel: 0,
          abrEwmaDefaultEstimate: 450_000,
          maxBufferLength: 2,
          maxMaxBufferLength: 4
        })
      );
      previewHls = pHls;
      pHls.on(HlsCtor.Events.MANIFEST_PARSED, (_ev, data) => {
        if (data.levels.length > 0) {
          const minIdx = pickLowestLevelIndex(data.levels);
          pHls.startLevel = minIdx;
          pHls.currentLevel = minIdx;
        }
      });
      pHls.loadSource(url);
      pHls.attachMedia(pVideo);
    } else {
      destroyPreviewHls();
      pVideo.src = url;
      pVideo.load();
    }
  }

  function ensurePreviewAttached() {
    const pVideo = previewVideoEl;
    const spec = previewMediaSpec;
    if (!pVideo || spec.mode === 'none' || !spec.url || isPip) return;
    if (previewAttachedUrl === spec.url) return;

    previewAttachedUrl = spec.url;
    previewHasFrame = false;
    previewLastRequestedSec = -1;

    if (spec.mode === 'hls') {
      const CachedHls = getLoadedHls();
      if (CachedHls) {
        attachPreviewWithHls(CachedHls, pVideo, spec.url);
      } else {
        void loadHls()
          .then((LoadedHls) => attachPreviewWithHls(LoadedHls, pVideo, spec.url))
          .catch(() => {});
      }
    } else {
      destroyPreviewHls();
      pVideo.src = spec.url;
      pVideo.load();
    }
  }

  function requestPreviewSeek(targetSec: number) {
    if (previewMediaSpec.mode === 'none' || !previewMediaSpec.url || isPip) return;
    ensurePreviewAttached();
    const pVideo = previewVideoEl;
    if (!pVideo) return;

    const quantized = Math.max(0, Math.round(targetSec * 2) / 2);
    if (Math.abs(quantized - previewLastRequestedSec) < 0.45 && previewHasFrame) {
      return;
    }

    window.clearTimeout(previewSeekTimer);
    const delayMs = !previewHasFrame && previewVideoEl && previewVideoEl.readyState >= 1 ? 0 : 45;
    previewSeekTimer = window.setTimeout(() => {
      if (!previewVideoEl || previewVideoEl.readyState < 1 || previewVideoEl.seeking) return;
      previewLastRequestedSec = quantized;
      const maxDur =
        Number.isFinite(previewVideoEl.duration) && previewVideoEl.duration > 0
          ? previewVideoEl.duration
          : duration;
      const clamped = Math.max(0, Math.min(quantized, maxDur > 0.5 ? maxDur - 0.25 : quantized));
      try {
        previewVideoEl.currentTime = clamped;
      } catch {
        // Ignore seek before metadata
      }
    }, delayMs);
  }

  function handlePreviewSeeked() {
    const pVideo = previewVideoEl;
    const canvas = previewCanvasEl;
    if (!pVideo || !canvas || pVideo.videoWidth <= 0 || pVideo.videoHeight <= 0) return;
    const targetW = 160;
    const targetH = Math.max(72, Math.min(110, Math.round((pVideo.videoHeight / pVideo.videoWidth) * targetW)));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      ctx.drawImage(pVideo, 0, 0, canvas.width, canvas.height);
      previewHasFrame = true;
    } catch {
      // Ignore cross-origin draw failures gracefully
    }
  }

  function applySubtitleTrackModes() {
    if (!videoEl) return;
    const tracks = videoEl.textTracks;
    const targetPos = activeSubtitleTrack >= 0 ? subtitleTracks.findIndex((s) => s.index === activeSubtitleTrack) : -1;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = i === targetPos ? 'showing' : 'disabled';
    }
  }

  function effectivePlaybackRate(): number {
    return spaceHoldBoostActive ? 2 : (videoEl?.playbackRate || playbackRate);
  }

  function streamTimeNow(): number {
    if (!videoEl) return currentTime;
    return playbackMode === 'remux'
      ? remuxSeekOffset + (videoEl.currentTime || 0)
      : videoEl.currentTime || 0;
  }

  function syncDubTime(force = false) {
    if (!dubAudio || !dubAudioEl || !videoEl || dubAudioEl.readyState < 1) return;
    const targetRate = effectivePlaybackRate();
    const rawTarget = streamTimeNow() + dubOffsetSec;
    const maxDur =
      Number.isFinite(dubAudioEl.duration) && dubAudioEl.duration > 0
        ? dubAudioEl.duration
        : Infinity;
    const clamped = Math.max(0, Math.min(rawTarget, maxDur));
    const currentDub = dubAudioEl.currentTime || 0;
    const delta = clamped - currentDub;
    const absDrift = Math.abs(delta);

    // Avoid micro-seeks that flush decoder buffers and leave the dub channel silent.
    const hardSeekThreshold = force ? 0.14 : 0.45;
    if (absDrift > hardSeekThreshold) {
      try {
        dubAudioEl.currentTime = clamped;
      } catch {
        // Metadata not ready yet
      }
      if (Math.abs(dubAudioEl.playbackRate - targetRate) > 0.001) {
        dubAudioEl.playbackRate = targetRate;
      }
      return;
    }

    if (!videoEl.paused && absDrift > 0.09) {
      dubAudioEl.playbackRate = delta > 0 ? targetRate * 1.04 : Math.max(0.25, targetRate * 0.96);
    } else if (Math.abs(dubAudioEl.playbackRate - targetRate) > 0.001) {
      dubAudioEl.playbackRate = targetRate;
    }
  }

  function pickLowestLevelIndex(rawLevels: Array<{ height: number; bitrate: number }>): number {
    let bestIdx = 0;
    let bestHeight = Infinity;
    let bestBitrate = Infinity;
    for (let i = 0; i < rawLevels.length; i++) {
      const h = rawLevels[i].height || 99999;
      const b = rawLevels[i].bitrate || 999_999_999;
      if (h < bestHeight || (h === bestHeight && b < bestBitrate)) {
        bestHeight = h;
        bestBitrate = b;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function pickHighestLevelIndex(rawLevels: Array<{ height: number; bitrate: number }>): number {
    let bestIdx = 0;
    let bestHeight = -1;
    let bestBitrate = -1;
    for (let i = 0; i < rawLevels.length; i++) {
      const h = rawLevels[i].height || 0;
      const b = rawLevels[i].bitrate || 0;
      if (h > bestHeight || (h === bestHeight && b > bestBitrate)) {
        bestHeight = h;
        bestBitrate = b;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function serializeHlsSources(item?: HlsSources | null): string {
    if (!item) return 'none';
    const r = item.remux ? `remux:${item.remux.hash}:${item.remux.fileIndex}` : '';
    return [
      item.hls_1080 || '',
      item.hls_720 || '',
      item.hls_480 || '',
      item.mp4_1080 || '',
      item.mp4_720 || '',
      item.mp4_480 || '',
      r
    ].join('|');
  }

  const playbackSourceSignature = $derived.by(() => {
    const s = (src || '').trim();
    return `${s}::${serializeHlsSources(sources)}::${reloadTick}`;
  });

  const dubSourceSignature = $derived.by(() => {
    if (!dubAudio) return 'none';
    return `${dubAudio.id}::${serializeHlsSources(dubAudio.sources)}`;
  });

  // Attach and configure hls.js or native MP4 ONLY when the resolved stream signature actually changes.
  $effect(() => {
    const video = videoEl;
    void playbackSourceSignature;
    if (!video) return;

    const directSrc = untrack(() => src);
    const epSources = untrack(() => sources);
    const shouldAutoplay = untrack(() => autoplay);
    const lockMax = untrack(() => preferMaxQuality);
    const resumeOffset = untrack(() => initialTime);

    const resolved = resolvePlaybackSource(directSrc, epSources);
    errorText = '';
    ffmpegNotice = '';
    levels = [];
    selectedLevel = -1;
    activeLevelIndex = -1;
    audioTracks = [];
    activeAudioTrack = -1;
    subtitleTracks = [];
    activeSubtitleTrack = -1;
    previewMediaSpec = { mode: 'none', url: '' };
    resetPreviewScrubber();
    activeRemuxConfig = null;
    remuxSeekOffset = 0;
    remuxTotalDuration = 0;
    remuxStreamOptions = {};
    mp4Variants = [];
    playing = false;
    autoSkippedOp = false;
    autoSkippedEd = false;
    currentTime = 0;
    duration = 0;
    bufferedEnd = 0;
    networkRetries = 0;
    let appliedResumeSeek = false;

    const applyInitialResume = () => {
      if (appliedResumeSeek || resumeOffset <= 0.5 || !video) return;
      appliedResumeSeek = true;
      const targetTime =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(resumeOffset, Math.max(0, video.duration - 0.5))
          : resumeOffset;
      video.currentTime = targetTime;
      currentTime = targetTime;
    };

    const handleNativeLoaded = () => {
      buffering = false;
      applyInitialResume();
    };

    const handleNativeError = () => {
      if (playbackMode === 'mp4' && activeLevelIndex + 1 < mp4Variants.length) {
        const nextIdx = activeLevelIndex + 1;
        const nextVariant = mp4Variants[nextIdx];
        if (nextVariant) {
          activeLevelIndex = nextIdx;
          selectedLevel = nextIdx;
          buffering = true;
          video.src = nextVariant.url;
          video.load();
          if (shouldAutoplay) {
            void video.play().catch(() => {});
          }
          return;
        }
      }
      buffering = false;
      errorText = 'Playback error: failed to load video stream';
      onerror?.(errorText);
    };

    if (!resolved) {
      destroyHls();
      activeBlobRevoke?.();
      activeBlobRevoke = null;
      playbackMode = 'hls';
      releaseVideoElementBuffers(video);
      return;
    }

    untrack(() => {
      video.volume = volume;
      video.muted = (Boolean(dubAudio) && dubReady) || muted || settingsState.startMuted;
      video.playbackRate = playbackRate;
    });

    if (resolved.mode === 'mp4') {
      destroyHls();
      playbackMode = 'mp4';
      const variants = [...resolved.variants].sort(
        (a, b) => b.height - a.height || b.bitrate - a.bitrate
      );
      mp4Variants = variants;
      levels = variants.map((v, idx) => ({
        index: idx,
        height: v.height,
        bitrate: v.bitrate,
        label: v.label
      }));
      selectedLevel = 0;
      activeLevelIndex = 0;
      previewMediaSpec = { mode: 'mp4', url: variants[variants.length - 1]?.url || variants[0].url };
      buffering = true;
      video.addEventListener('loadedmetadata', handleNativeLoaded);
      video.addEventListener('error', handleNativeError);
      video.src = variants[0].url;
      video.load();
      if (shouldAutoplay) {
        void video.play().catch(() => {});
      }
      return () => {
        window.clearTimeout(hideTimer);
        hideTimer = undefined;
        resetPreviewScrubber();
        if (pendingRestoreSeek) {
          video.removeEventListener('loadedmetadata', pendingRestoreSeek);
          pendingRestoreSeek = null;
        }
        video.removeEventListener('loadedmetadata', handleNativeLoaded);
        video.removeEventListener('error', handleNativeError);
        releaseVideoElementBuffers(video);
      };
    }

    if (resolved.mode === 'remux') {
      destroyHls();
      playbackMode = 'remux';
      const remuxCfg = resolved.remux;
      activeRemuxConfig = remuxCfg;
      const startPos = resumeOffset > 0.5 ? resumeOffset : 0;
      remuxSeekOffset = startPos;
      currentTime = startPos;
      levels = [{ index: 0, height: 1080, bitrate: 0, label: remuxCfg.label || '1080p' }];
      selectedLevel = 0;
      activeLevelIndex = 0;
      buffering = true;

      let cancelled = false;
      let ffPoll: number | undefined;
      let ffSawDownloading = false;
      const stopFfPoll = () => {
        if (ffPoll !== undefined) {
          window.clearInterval(ffPoll);
          ffPoll = undefined;
        }
      };
      const onRemuxReady = () => {
        buffering = false;
        ffmpegNotice = '';
        stopFfPoll();
      };
      const onRemuxErr = () => {
        buffering = false;
        ffmpegNotice = '';
        stopFfPoll();
        errorText = 'Playback error: FFmpeg remux failed for torrent stream';
        onerror?.(errorText);
      };
      video.addEventListener('loadeddata', onRemuxReady);
      video.addEventListener('canplay', onRemuxReady);
      video.addEventListener('canplaythrough', onRemuxReady);
      video.addEventListener('error', onRemuxErr);

      const shouldTranscodeVideo = (codec?: string, pixFmt?: string): boolean => {
        const c = (codec || '').toLowerCase();
        const pf = (pixFmt || '').toLowerCase();
        if (pf.includes('10') && c === 'h264') {
          return true;
        }
        if (c === 'hevc' || c === 'h265') {
          return !video.canPlayType('video/mp4; codecs="hvc1.1.6.L150.90"');
        }
        if (c === 'mpeg4' || c === 'msmpeg4v3' || c === 'vc1' || c === 'wmv3') {
          return true;
        }
        return false;
      };

      const startRemux = async (torrentMod: Awaited<ReturnType<typeof torrentLoader.load>>) => {
        if (cancelled) return;
        ffPoll = window.setInterval(() => {
          void torrentMod.getFFmpegStatus().then((st) => {
            if (cancelled) return;
            if (st.downloading) {
              ffSawDownloading = true;
              ffmpegNotice = `Preparing FFmpeg (${st.progressPct}%)…`;
            } else {
              ffmpegNotice = '';
              if (ffSawDownloading) {
                stopFfPoll();
              }
            }
          });
        }, 600);

        await torrentMod.ensureTorrentMediaBaseUrl();
        if (cancelled) return;

        let probeTimer: number | undefined;
        const probePromise = torrentMod
          .probeTorrentFile(remuxCfg.hash, remuxCfg.fileIndex)
          .catch(() => null);
        const probeTimeout = new Promise<null>((resolve) => {
          probeTimer = window.setTimeout(() => resolve(null), 5000);
        });
        const probe = await Promise.race([probePromise, probeTimeout]);
        if (probeTimer !== undefined) {
          window.clearTimeout(probeTimer);
        }
        if (cancelled) return;

        let initAudio = 0;
        if (probe) {
          if (probe.duration > 0) {
            remuxTotalDuration = probe.duration;
            duration = probe.duration;
          }
          if (probe.height && probe.height > 0) {
            const qLabel = formatQualityLabel(probe.height, 0);
            levels = [{ index: 0, height: probe.height, bitrate: 0, label: qLabel }];
          }
          if (probe.audioTracks.length > 0) {
            audioTracks = probe.audioTracks.map((t) => ({
              index: t.ordinal,
              label: t.label,
              lang: t.language
            }));
            const matchRu = (t: (typeof probe.audioTracks)[number]) =>
              /rus|ru/i.test(t.language || '') || /бан|dub|libria|cast|рус|студ/i.test(t.title || '');
            const matchOrig = (t: (typeof probe.audioTracks)[number]) =>
              /jpn|ja|jap|eng|en|orig/i.test(t.language || '') || /ориг|orig|jap|jpn|sub|raw/i.test(t.title || '');
            let picked = probe.audioTracks[0];
            if (settingsState.audioPriority === 'ru') {
              picked = probe.audioTracks.find(matchRu) ?? probe.audioTracks[0];
            } else if (settingsState.audioPriority === 'orig') {
              picked = probe.audioTracks.find(matchOrig) ?? probe.audioTracks[probe.audioTracks.length - 1] ?? probe.audioTracks[0];
            }
            initAudio = picked.ordinal;
            activeAudioTrack = initAudio;
          }
          if (probe.subtitles.length > 0) {
            subtitleTracks = probe.subtitles.map((s) => ({
              index: s.ordinal,
              label: s.label,
              lang: s.language,
              src: torrentMod.buildTorrentSubtitleUrl(remuxCfg.hash, remuxCfg.fileIndex, s.ordinal)
            }));
          }
          remuxStreamOptions = {
            videoCodec: probe.videoCodec,
            transcode: shouldTranscodeVideo(probe.videoCodec, probe.pixFmt)
          };
        } else {
          remuxStreamOptions = {};
        }

        video.src = torrentMod.buildTorrentMediaUrl(
          remuxCfg.hash,
          remuxCfg.fileIndex,
          true,
          initAudio,
          startPos,
          remuxStreamOptions
        );
        video.load();
        if (shouldAutoplay) {
          void video.play().catch(() => {});
        }
      };

      const cachedTorrent = torrentLoader.getLoaded();
      if (cachedTorrent) {
        void startRemux(cachedTorrent);
      } else {
        void torrentLoader
          .load()
          .then((mod) => startRemux(mod))
          .catch(() => {
            if (!cancelled) onRemuxErr();
          });
      }

      return () => {
        cancelled = true;
        if (ffPoll !== undefined) {
          window.clearInterval(ffPoll);
          ffPoll = undefined;
        }
        window.clearTimeout(hideTimer);
        hideTimer = undefined;
        video.removeEventListener('loadeddata', onRemuxReady);
        video.removeEventListener('canplay', onRemuxReady);
        video.removeEventListener('canplaythrough', onRemuxReady);
        video.removeEventListener('error', onRemuxErr);
        releaseVideoElementBuffers(video);
      };
    }

    playbackMode = 'hls';
    previewMediaSpec = { mode: 'hls', url: resolved.url };
    activeBlobRevoke = resolved.revoke ?? null;
    let hlsCancelled = false;

    const setupHlsPlayback = (HlsCtor: typeof HlsType) => {
      if (hlsCancelled) return;
      if (HlsCtor.isSupported()) {
        destroyHls();
        const instance = new HlsCtor(createMaxQualityHlsConfig());
        hls = instance;
        buffering = true;

        instance.on(HlsCtor.Events.MANIFEST_PARSED, (_event, data) => {
          const mapped: QualityLevelOption[] = data.levels.map((lvl, idx) => ({
            index: idx,
            height: lvl.height || 0,
            bitrate: lvl.bitrate || 0,
            label: formatQualityLabel(lvl.height || 0, lvl.bitrate)
          }));

          // Sort highest resolution first for the quality selector UI.
          mapped.sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
          levels = mapped;

          if (data.levels.length > 0) {
            const maxIdx = pickHighestLevelIndex(data.levels);
            const prefQual = settingsState.defaultQuality;
            if (prefQual === 'auto') {
              instance.startLevel = -1;
              instance.currentLevel = -1;
              selectedLevel = -1;
              activeLevelIndex = maxIdx;
            } else if (prefQual === '720p') {
              let best720 = -1;
              let bestHeight = -1;
              data.levels.forEach((lvl, idx) => {
                const h = lvl.height || 0;
                if (h > 0 && h <= 720 && h > bestHeight) {
                  bestHeight = h;
                  best720 = idx;
                }
              });
              const targetIdx = best720 >= 0 ? best720 : maxIdx;
              instance.startLevel = targetIdx;
              instance.currentLevel = targetIdx;
              selectedLevel = targetIdx;
              activeLevelIndex = targetIdx;
            } else {
              instance.startLevel = maxIdx;
              if (lockMax) {
                instance.currentLevel = maxIdx;
                selectedLevel = maxIdx;
              } else {
                instance.currentLevel = -1;
                selectedLevel = -1;
              }
              activeLevelIndex = maxIdx;
            }
          }

          applyInitialResume();

          if (shouldAutoplay) {
            void video.play().catch(() => {});
          }
        });

        instance.on(HlsCtor.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
          audioTracks = (data.audioTracks ?? []).map((t, i) => ({
            index: t.id ?? i,
            label: t.name || t.lang || `Audio ${i + 1}`,
            lang: t.lang
          }));
          if (audioTracks.length > 1 && settingsState.audioPriority !== 'first') {
            const matchPref =
              settingsState.audioPriority === 'ru'
                ? (tr: AudioTrackOption) => /rus|ru/i.test(tr.lang || '') || /рус|бан|dub|libria/i.test(tr.label || '')
                : (tr: AudioTrackOption) => /jpn|ja|jap|eng|en|orig/i.test(tr.lang || '') || /ориг|orig|jap|jpn/i.test(tr.label || '');
            const wanted = audioTracks.find(matchPref);
            if (wanted && wanted.index !== instance.audioTrack) {
              instance.audioTrack = wanted.index;
            }
          }
          activeAudioTrack = instance.audioTrack;
        });

        instance.on(HlsCtor.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
          activeAudioTrack = data.id;
        });

        instance.on(HlsCtor.Events.LEVEL_SWITCHED, (_event, data) => {
          activeLevelIndex = data.level;
        });

        instance.on(HlsCtor.Events.ERROR, (_event, data: ErrorData) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
            networkRetries += 1;
            instance.startLoad();
            return;
          }
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
            instance.recoverMediaError();
            return;
          }
          const status = (data.response as { code?: number } | undefined)?.code;
          errorText = status
            ? `Playback error: CDN returned HTTP ${status}`
            : 'Playback error: failed to load HLS stream';
          buffering = false;
          onerror?.(errorText);
        });

        instance.loadSource(resolved.url);
        instance.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        destroyHls();
        video.src = resolved.url;
        video.addEventListener('loadedmetadata', handleNativeLoaded, { once: true });
        video.addEventListener('error', handleNativeError, { once: true });
        if (shouldAutoplay) {
          void video.play().catch(() => {});
        }
      } else {
        errorText = 'HLS playback is not supported in this environment';
        onerror?.(errorText);
      }
    };

    const cachedHls = getLoadedHls();
    if (cachedHls) {
      setupHlsPlayback(cachedHls);
    } else {
      buffering = true;
      void loadHls()
        .then(setupHlsPlayback)
        .catch(() => {
          if (hlsCancelled) return;
          buffering = false;
          errorText = 'Playback error: failed to load HLS engine';
          onerror?.(errorText);
        });
    }

    return () => {
      hlsCancelled = true;
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
      resetPreviewScrubber();
      if (pendingRestoreSeek) {
        video.removeEventListener('loadedmetadata', pendingRestoreSeek);
        pendingRestoreSeek = null;
      }
      video.removeEventListener('loadedmetadata', handleNativeLoaded);
      video.removeEventListener('error', handleNativeError);
      destroyHls();
      releaseVideoElementBuffers(video);
      if (activeBlobRevoke === resolved.revoke) {
        activeBlobRevoke = null;
      }
      resolved.revoke?.();
    };
  });

  // Attach and synchronize the second Russian voiceover stream in Dual-Stream mode.
  $effect(() => {
    const dubEl = dubAudioEl;
    const video = videoEl;
    void dubSourceSignature;

    if (!dubEl || !video) return;
    const activeDub = untrack(() => dubAudio);

    if (!activeDub) {
      destroyDubHls();
      dubReady = false;
      dubEl.pause();
      dubEl.removeAttribute('src');
      dubEl.load();
      untrack(() => {
        video.muted = muted;
        video.volume = volume;
      });
      return;
    }

    const resolvedDub = resolvePlaybackSource(undefined, activeDub.sources);
    if (!resolvedDub) {
      dubReady = false;
      video.muted = muted;
      return;
    }

    dubReady = false;
    let didInitialSeek = false;
    let mp4TriedProxy = false;
    let hlsNetRetries = 0;

    untrack(() => {
      dubEl.volume = volume;
      dubEl.muted = muted;
      dubEl.playbackRate = playbackRate;
    });

    const markDubReadyAndSync = (forceSeek = false) => {
      dubReady = true;
      video.muted = true;
      if (!didInitialSeek) {
        didInitialSeek = true;
        const startTarget = streamTimeNow() + dubOffsetSec;
        if (startTarget > 0.25 && dubEl.readyState >= 1) {
          try {
            dubEl.currentTime = startTarget;
          } catch {
            // Ignore seek before metadata
          }
        }
      } else if (forceSeek) {
        syncDubTime(true);
      }
      if (!video.paused && dubEl.paused) {
        void dubEl.play().catch(() => {});
      }
    };

    const onDubMeta = () => {
      markDubReadyAndSync(false);
    };
    const onDubCanPlay = () => {
      markDubReadyAndSync(false);
    };
    const onDubPlaying = () => {
      dubReady = true;
      video.muted = true;
      syncDubTime(false);
    };
    const onDubError = () => {
      if (resolvedDub.mode === 'mp4' && !mp4TriedProxy && rawMp4Url) {
        mp4TriedProxy = true;
        const proxied = `/ext/stream?url=${encodeURIComponent(rawMp4Url)}`;
        dubEl.src = proxied;
        dubEl.load();
        if (!video.paused) {
          void dubEl.play().catch(() => {});
        }
        return;
      }
      dubReady = false;
      video.muted = muted;
    };

    dubEl.addEventListener('loadedmetadata', onDubMeta);
    dubEl.addEventListener('canplay', onDubCanPlay);
    dubEl.addEventListener('playing', onDubPlaying);
    dubEl.addEventListener('error', onDubError);

    // Pick lowest MP4/HLS bitrate variant since video pixels of the dub channel are hidden;
    // audio bitrate is the same while buffering is ~4-8x faster and never starves main 1080p video.
    const rawMp4Url =
      resolvedDub.mode === 'mp4'
        ? resolvedDub.variants[resolvedDub.variants.length - 1]?.url
        : undefined;
    const dubUrl = resolvedDub.mode === 'hls' ? resolvedDub.url : rawMp4Url;

    let dubCancelled = false;

    const setupDubHls = (HlsCtor: typeof HlsType) => {
      if (dubCancelled || !dubUrl) return;
      if (HlsCtor.isSupported()) {
        destroyDubHls();
        const dHls = new HlsCtor(
          createMaxQualityHlsConfig({
            capLevelToPlayerSize: false,
            startLevel: 0,
            abrEwmaDefaultEstimate: 500_000,
            maxBufferLength: 25,
            maxMaxBufferLength: 60
          })
        );
        dubHls = dHls;
        dHls.on(HlsCtor.Events.MANIFEST_PARSED, (_ev, data) => {
          if (data.levels.length > 0) {
            const minIdx = pickLowestLevelIndex(data.levels);
            dHls.startLevel = minIdx;
            dHls.currentLevel = minIdx;
          }
          markDubReadyAndSync(true);
        });
        dHls.on(HlsCtor.Events.ERROR, (_ev, data: ErrorData) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && hlsNetRetries < 4) {
            hlsNetRetries += 1;
            dHls.startLoad();
            return;
          }
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
            dHls.recoverMediaError();
            return;
          }
          dubReady = false;
          video.muted = muted;
        });
        dHls.loadSource(dubUrl);
        dHls.attachMedia(dubEl);
      } else {
        destroyDubHls();
        dubEl.src = dubUrl;
        dubEl.load();
        if (!video.paused) {
          void dubEl.play().catch(() => {});
        }
      }
    };

    if (resolvedDub.mode === 'hls' && dubUrl) {
      const cachedHls = getLoadedHls();
      if (cachedHls) {
        setupDubHls(cachedHls);
      } else {
        void loadHls()
          .then(setupDubHls)
          .catch(() => {
            if (dubCancelled) return;
            dubReady = false;
            video.muted = muted;
          });
      }
    } else if (dubUrl) {
      destroyDubHls();
      dubEl.src = dubUrl;
      dubEl.load();
      if (!video.paused) {
        void dubEl.play().catch(() => {});
      }
    }

    const driftTimer = window.setInterval(() => {
      if (dubEl.readyState >= 2) {
        if (!dubReady) {
          dubReady = true;
          video.muted = true;
        }
        if (!video.paused) {
          syncDubTime(false);
          if (dubEl.paused) {
            void dubEl.play().catch(() => {});
          }
        }
      }
    }, 350);

    return () => {
      dubCancelled = true;
      window.clearInterval(driftTimer);
      dubEl.removeEventListener('loadedmetadata', onDubMeta);
      dubEl.removeEventListener('canplay', onDubCanPlay);
      dubEl.removeEventListener('playing', onDubPlaying);
      dubEl.removeEventListener('error', onDubError);
      destroyDubHls();
      releaseVideoElementBuffers(dubEl);
      if (resolvedDub.mode === 'hls') {
        resolvedDub.revoke?.();
      }
    };
  });

  $effect(() => {
    void dubOffsetSec;
    syncDubTime(true);
  });

  let nativeFsActive = false;

  function resolveFullscreenContainer(): HTMLElement | null {
    return (rootEl?.closest('[data-player-fs-root]') as HTMLElement | null) ?? rootEl;
  }

  async function setNativeWindowFullscreen(next: boolean) {
    if (typeof window === 'undefined') return;
    const fsContainer = resolveFullscreenContainer();
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('is-player-fullscreen', next);
      document.body.classList.toggle('is-window-fullscreen', next);
      document.querySelectorAll('[data-player-fs-root].is-fs-active').forEach((el) => {
        if (!next || el !== fsContainer) {
          el.classList.remove('is-fs-active');
        }
      });
      if (fsContainer && fsContainer !== rootEl) {
        fsContainer.classList.toggle('is-fs-active', next);
      }
    }
    if (nativeFsActive === next) return;
    nativeFsActive = next;
    const { setAppFullscreen } = await import('../../app/bindings.svelte');
    await setAppFullscreen(next, { playerMode: true, domTarget: fsContainer });
  }

  async function enterFullscreen() {
    if (!rootEl) return;
    isFullscreen = true;
    await setNativeWindowFullscreen(true);
  }

  async function exitFullscreen() {
    isFullscreen = false;
    await setNativeWindowFullscreen(false);
  }

  $effect(() => {
    function onFsChange() {
      const fsContainer = resolveFullscreenContainer();
      const domFs =
        document.fullscreenElement !== null &&
        (document.fullscreenElement === rootEl || document.fullscreenElement === fsContainer);
      if (domFs) {
        isFullscreen = true;
        setNativeWindowFullscreen(true);
      } else if (isFullscreen) {
        isFullscreen = false;
        setNativeWindowFullscreen(false);
      }
    }
    function onWinKeydown(e: KeyboardEvent) {
      const fsContainer = resolveFullscreenContainer();
      if (
        e.key === 'Escape' &&
        isFullscreen &&
        document.fullscreenElement !== rootEl &&
        document.fullscreenElement !== fsContainer
      ) {
        e.preventDefault();
        void exitFullscreen();
      }
    }
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onWinKeydown);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onWinKeydown);
      if (nativeFsActive) {
        setNativeWindowFullscreen(false);
      }
    };
  });

  function togglePlay() {
    if (!videoEl) return;
    if (controlsLocked) {
      showOsd('Host controls playback', 'info');
      scheduleHideControls();
      return;
    }
    if (videoEl.paused) {
      void videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
    scheduleHideControls();
  }

  function applyRemuxStreamSource(
    video: HTMLVideoElement,
    cfg: TorrentRemuxConfig,
    audioIdx: number,
    posSec: number,
    shouldPlay: boolean
  ) {
    const torrentMod = torrentLoader.getLoaded();
    if (torrentMod) {
      video.src = torrentMod.buildTorrentMediaUrl(
        cfg.hash,
        cfg.fileIndex,
        true,
        audioIdx,
        posSec,
        remuxStreamOptions
      );
      video.load();
      if (shouldPlay) {
        void video.play().catch(() => {});
      }
      return;
    }
    void torrentLoader.load().then((mod) => {
      if (videoEl !== video || activeRemuxConfig !== cfg || playbackMode !== 'remux') return;
      void mod.ensureTorrentMediaBaseUrl().then(() => {
        if (videoEl !== video || activeRemuxConfig !== cfg || playbackMode !== 'remux') return;
        video.src = mod.buildTorrentMediaUrl(
          cfg.hash,
          cfg.fileIndex,
          true,
          audioIdx,
          posSec,
          remuxStreamOptions
        );
        video.load();
        if (shouldPlay) {
          void video.play().catch(() => {});
        }
      });
    });
  }

  export function seek(seconds: number): void {
    seekTo(seconds);
  }

  function seekTo(seconds: number, fromRemoteSync = false) {
    if (!videoEl) return;
    if (!fromRemoteSync && controlsLocked) {
      showOsd('Host controls playback', 'info');
      return;
    }
    const tot = remuxTotalDuration > 0 ? remuxTotalDuration : videoEl.duration || duration || 0;
    const clamped = tot > 0 ? Math.max(0, Math.min(tot, seconds)) : Math.max(0, seconds);
    if (playbackMode === 'remux' && activeRemuxConfig) {
      const wasPlaying = !videoEl.paused;
      remuxSeekOffset = clamped;
      currentTime = clamped;
      buffering = true;
      applyRemuxStreamSource(videoEl, activeRemuxConfig, Math.max(0, activeAudioTrack), clamped, wasPlaying);
      syncDubTime(true);
      scheduleHideControls();
      if (!fromRemoteSync) {
        emitLocalPlaybackAction('seek', { currentTime: clamped });
      }
      return;
    }
    videoEl.currentTime = clamped;
    currentTime = clamped;
    syncDubTime(true);
    scheduleHideControls();
    if (!fromRemoteSync) {
      emitLocalPlaybackAction('seek', { currentTime: clamped });
    }
  }

  function setQuality(levelIdx: number) {
    selectedLevel = levelIdx;
    if (hls) {
      hls.currentLevel = levelIdx;
      if (levelIdx >= 0) {
        activeLevelIndex = levelIdx;
      }
    } else if (playbackMode === 'mp4' && videoEl) {
      const target = mp4Variants[levelIdx];
      if (target && videoEl.src !== target.url) {
        const savedTime = videoEl.currentTime || currentTime;
        const wasPlaying = !videoEl.paused;
        activeLevelIndex = levelIdx;
        buffering = true;
        if (pendingRestoreSeek) {
          videoEl.removeEventListener('loadedmetadata', pendingRestoreSeek);
        }
        const restoreSeek = () => {
          pendingRestoreSeek = null;
          if (!videoEl) return;
          if (savedTime > 0.25 && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
            videoEl.currentTime = Math.min(savedTime, Math.max(0, videoEl.duration - 0.5));
          }
          buffering = false;
          if (wasPlaying) {
            void videoEl.play().catch(() => {});
          }
        };
        pendingRestoreSeek = restoreSeek;
        videoEl.addEventListener('loadedmetadata', restoreSeek, { once: true });
        videoEl.src = target.url;
        videoEl.load();
      }
    }
    activeMenu = 'none';
    scheduleHideControls();
  }

  function applyPlaybackRate(rate: number) {
    if (videoEl) {
      videoEl.playbackRate = rate;
    }
    if (dubAudioEl) {
      dubAudioEl.playbackRate = rate;
    }
  }

  function setSpeed(rate: number, withOsd = false) {
    if (controlsLocked) {
      showOsd('Host controls playback', 'info');
      activeMenu = 'none';
      return;
    }
    playbackRate = rate;
    if (!spaceHoldBoostActive) {
      applyPlaybackRate(rate);
    }
    safeStorageSet(SPEED_KEY, String(rate));
    if (withOsd) {
      showOsd(`${rate}x`, 'speed');
    }
    emitLocalPlaybackAction('rate', { playbackRate: rate });
    activeMenu = 'none';
    scheduleHideControls();
  }

  function selectVoice(voice: VoiceTrackOption) {
    activeMenu = 'none';
    scheduleHideControls();
    onselectvoice?.(voice, videoEl?.currentTime ?? currentTime);
  }

  function setAudioTrack(trackIdx: number) {
    if (playbackMode === 'remux' && activeRemuxConfig && videoEl) {
      const curPos = streamTimeNow();
      const wasPlaying = !videoEl.paused;
      activeAudioTrack = trackIdx;
      remuxSeekOffset = curPos;
      buffering = true;
      applyRemuxStreamSource(videoEl, activeRemuxConfig, Math.max(0, trackIdx), curPos, wasPlaying);
      activeMenu = 'none';
      scheduleHideControls();
      return;
    }
    if (hls) {
      hls.audioTrack = trackIdx;
      activeAudioTrack = trackIdx;
    }
    activeMenu = 'none';
    scheduleHideControls();
  }

  function setSubtitleTrack(trackIdx: number, withOsd = false) {
    activeSubtitleTrack = trackIdx;
    applySubtitleTrackModes();
    if (withOsd) {
      const label =
        trackIdx < 0
          ? 'Subtitles: Off'
          : `Subtitles: ${subtitleTracks.find((s) => s.index === trackIdx)?.label || 'On'}`;
      showOsd(label, 'info');
    }
    activeMenu = 'none';
    scheduleHideControls();
  }

  $effect(() => {
    void subtitleTracks;
    void activeSubtitleTrack;
    if (!videoEl) return;
    queueMicrotask(() => {
      applySubtitleTrackModes();
    });
  });

  function flushVolumeStorage() {
    safeStorageSet(VOLUME_KEY, String(volume));
    safeStorageSet(MUTED_KEY, muted ? '1' : '0');
  }

  function setVolume(val: number) {
    const clamped = Math.max(0, Math.min(1, val));
    volume = clamped;
    muted = clamped === 0;
    if (videoEl) {
      videoEl.volume = clamped;
      videoEl.muted = (Boolean(dubAudio) && dubReady) || muted;
    }
    if (dubAudioEl) {
      dubAudioEl.volume = clamped;
      dubAudioEl.muted = muted;
    }
    window.clearTimeout(volumePersistTimer);
    volumePersistTimer = window.setTimeout(() => {
      volumePersistTimer = undefined;
      flushVolumeStorage();
    }, 180);
  }

  function toggleMute() {
    muted = !muted;
    if (!muted && volume === 0) {
      volume = 0.5;
    }
    if (videoEl) {
      videoEl.muted = (Boolean(dubAudio) && dubReady) || muted;
      videoEl.volume = volume;
    }
    if (dubAudioEl) {
      dubAudioEl.muted = muted;
      dubAudioEl.volume = volume;
    }
    window.clearTimeout(volumePersistTimer);
    volumePersistTimer = undefined;
    flushVolumeStorage();
    scheduleHideControls();
  }

  async function toggleFullscreen() {
    if (!rootEl) return;
    if (isFullscreen || document.fullscreenElement === rootEl) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
    scheduleHideControls();
  }

  async function togglePiP() {
    if (onpip) {
      onpip();
      scheduleHideControls();
      return;
    }
    if (!videoEl || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement === videoEl) {
      await document.exitPictureInPicture().catch(() => {});
    } else {
      await videoEl.requestPictureInPicture().catch(() => {});
    }
  }

  function handlePipDragTrigger(e: PointerEvent) {
    if (!isPip || !onpipdragstart || e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, .seek-track, .volume-track, .combo-root')) return;
    onpipdragstart(e);
  }

  export function notifyPipDragged(): void {
    suppressNextVideoClick = true;
    window.clearTimeout(pipClickTimer);
    pipClickTimer = window.setTimeout(() => {
      pipClickTimer = undefined;
      suppressNextVideoClick = false;
    }, 80);
  }

  function getSeekRect(): DOMRect | null {
    if (!seekEl) return null;
    const now = performance.now();
    if (!cachedSeekRect || now - cachedSeekRectAt > 250) {
      cachedSeekRect = seekEl.getBoundingClientRect();
      cachedSeekRectAt = now;
    }
    return cachedSeekRect;
  }

  function seekFromPointer(clientX: number) {
    const rect = getSeekRect();
    if (!rect || rect.width <= 0 || duration <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    hoverPct = ratio * 100;
    hoverTime = ratio * duration;
    pendingHoverSeekSec = hoverTime;
    if (!seekHoverRaf) {
      seekHoverRaf = window.requestAnimationFrame(() => {
        seekHoverRaf = 0;
        const sec = pendingHoverSeekSec;
        pendingHoverSeekSec = null;
        if (sec !== null) {
          requestPreviewSeek(sec);
        }
      });
    }
    if (draggingSeek) {
      seekTo(hoverTime);
    }
  }

  function handleSeekPointerDown(e: PointerEvent) {
    if (controlsLocked) {
      showOsd('Host controls playback', 'info');
      return;
    }
    if (!seekEl) return;
    cachedSeekRect = seekEl.getBoundingClientRect();
    cachedSeekRectAt = performance.now();
    draggingSeek = true;
    seekEl.setPointerCapture(e.pointerId);
    seekFromPointer(e.clientX);
  }

  function handleSeekPointerUp(e: PointerEvent) {
    if (!draggingSeek || !seekEl) return;
    seekFromPointer(e.clientX);
    draggingSeek = false;
    seekEl.releasePointerCapture(e.pointerId);
  }

  function releaseSpaceHoldBoost() {
    window.clearTimeout(spaceHoldTimer);
    spaceHoldTimer = undefined;
    if (spaceHoldBoostActive) {
      spaceHoldBoostActive = false;
      applyPlaybackRate(playbackRate);
    }
  }

  function isHotkeyBlocked(e: KeyboardEvent): boolean {
    if (!keyboardEnabled && !isFullscreen) return true;
    if (e.ctrlKey || e.metaKey || e.altKey) return true;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"][aria-modal="true"], .lightbox, .combo-menu'
      )
    ) {
      return true;
    }
    const interactive = target?.closest('a, button, [role="button"]');
    if (interactive && rootEl && !rootEl.contains(interactive) && (e.code === 'Space' || e.key === ' ')) {
      return true;
    }
    if (document.querySelector('[role="dialog"][aria-modal="true"], .lightbox')) {
      return true;
    }
    return false;
  }

  function stepSeekHotkey(deltaSec: number) {
    if (controlsLocked) {
      showOsd('Host controls playback', 'info');
      return;
    }
    const base = streamTimeNow();
    const next = Math.max(0, Math.min(duration || 0, base + deltaSec));
    seekTo(next);
    showOsd(`${deltaSec > 0 ? `+${deltaSec}` : deltaSec}s · ${formatTime(next)}`, 'seek');
  }

  function stepVolumeHotkey(delta: number) {
    const base = muted ? 0 : volume;
    const next = Math.max(0, Math.min(1, Math.round((base + delta) * 20) / 20));
    setVolume(next);
    scheduleHideControls();
    showOsd(next === 0 ? 'Muted' : `Volume ${Math.round(next * 100)}%`, next === 0 ? 'mute' : 'volume');
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (activeMenu !== 'none') {
        e.preventDefault();
        activeMenu = 'none';
        return;
      }
      if (isFullscreen) {
        e.preventDefault();
        void exitFullscreen();
      }
      return;
    }

    if (isHotkeyBlocked(e)) return;

    const sc = settingsState.shortcuts;
    const seekSec = settingsState.seekStepSec || 5;
    const volStep = (settingsState.volumeStepPct || 5) / 100;

    if (matchesShortcut(e, sc.playPause) && (e.code === 'Space' || e.key === ' ')) {
      e.preventDefault();
      if (controlsLocked) {
        showOsd('Host controls playback', 'info');
        return;
      }
      if (e.repeat || spaceIsDown) return;
      spaceIsDown = true;
      window.clearTimeout(spaceHoldTimer);
      spaceHoldTimer = window.setTimeout(() => {
        if (!spaceIsDown || !videoEl || videoEl.ended) return;
        spaceHoldBoostActive = true;
        applyPlaybackRate(settingsState.holdBoostRate || 2);
        if (videoEl.paused) {
          void videoEl.play().catch(() => {});
        }
      }, 240);
      return;
    }

    const digitMatch = /^Digit([0-9])$/.exec(e.code) || /^Numpad([0-9])$/.exec(e.code);
    if (digitMatch && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (controlsLocked) {
        e.preventDefault();
        showOsd('Host controls playback', 'info');
        return;
      }
      if (duration > 0) {
        e.preventDefault();
        const pct = Number(digitMatch[1]) * 10;
        const target = (duration * pct) / 100;
        seekTo(target);
        showOsd(`${pct}% · ${formatTime(target)}`, 'seek');
      }
      return;
    }

    if (matchesShortcut(e, sc.playPause) || e.code === 'KeyK') {
      e.preventDefault();
      if (controlsLocked) {
        showOsd('Host controls playback', 'info');
        return;
      }
      if (videoEl) {
        const willPlay = videoEl.paused;
        togglePlay();
        showOsd(willPlay ? 'Play' : 'Pause', 'play');
      }
    } else if (matchesShortcut(e, sc.seekBack)) {
      e.preventDefault();
      stepSeekHotkey(-seekSec);
    } else if (matchesShortcut(e, sc.seekForward)) {
      e.preventDefault();
      stepSeekHotkey(seekSec);
    } else if (matchesShortcut(e, sc.jumpBack)) {
      e.preventDefault();
      stepSeekHotkey(-seekSec * 2);
    } else if (matchesShortcut(e, sc.jumpForward)) {
      e.preventDefault();
      stepSeekHotkey(seekSec * 2);
    } else if (matchesShortcut(e, sc.volUp)) {
      e.preventDefault();
      stepVolumeHotkey(volStep);
    } else if (matchesShortcut(e, sc.volDown)) {
      e.preventDefault();
      stepVolumeHotkey(-volStep);
    } else if (matchesShortcut(e, sc.mute)) {
      e.preventDefault();
      toggleMute();
      showOsd(muted ? 'Muted' : `Volume ${Math.round(volume * 100)}%`, muted ? 'mute' : 'volume');
    } else if (matchesShortcut(e, sc.fullscreen)) {
      e.preventDefault();
      void toggleFullscreen();
    } else if (matchesShortcut(e, sc.nextEp)) {
      if (hasNext && onnext) {
        e.preventDefault();
        showOsd('Next Episode', 'info');
        onnext();
      }
    } else if (matchesShortcut(e, sc.prevEp)) {
      if (hasPrev && onprev) {
        e.preventDefault();
        showOsd('Previous Episode', 'info');
        onprev();
      }
    } else if (matchesShortcut(e, sc.skipOp)) {
      if (skipTarget) {
        e.preventDefault();
        const label = skipTarget.label;
        seekTo(skipTarget.to);
        showOsd(label, 'seek');
      }
    } else if (matchesShortcut(e, sc.subtitles)) {
      if (subtitleTracks.length > 0) {
        e.preventDefault();
        if (activeSubtitleTrack >= 0) {
          setSubtitleTrack(-1, true);
        } else {
          setSubtitleTrack(subtitleTracks[0].index, true);
        }
      }
    }
  }

  function handleGlobalKeyup(e: KeyboardEvent) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (!spaceIsDown) return;
    e.preventDefault();
    spaceIsDown = false;
    const wasHoldBoost = spaceHoldBoostActive;
    releaseSpaceHoldBoost();
    if (!wasHoldBoost && !isHotkeyBlocked(e) && videoEl) {
      const willPlay = videoEl.paused;
      togglePlay();
      showOsd(willPlay ? 'Play' : 'Pause', 'play');
    }
  }

  function handleWindowBlur() {
    spaceIsDown = false;
    releaseSpaceHoldBoost();
  }

  $effect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const handleVisibility = () => {
      if (document.hidden && settingsState.pauseOnMinimize && videoEl && !videoEl.paused) {
        videoEl.pause();
        if (dubAudioEl && !dubAudioEl.paused) {
          dubAudioEl.pause();
        }
      }
    };
    const handleSysPrefsChanged = () => {
      videoPrefs = readSavedVideoPrefs();
      const targetVol = settingsState.defaultVolume;
      if (Number.isFinite(targetVol) && Math.abs(volume - targetVol) > 0.005) {
        volume = targetVol;
        if (videoEl) videoEl.volume = targetVol;
        if (dubAudioEl) dubAudioEl.volume = targetVol;
      }
      if (settingsState.startMuted && !muted) {
        muted = true;
        if (videoEl) videoEl.muted = true;
        if (dubAudioEl) dubAudioEl.muted = true;
      }
      const targetSpeed = settingsState.defaultSpeed;
      if (Number.isFinite(targetSpeed) && Math.abs(playbackRate - targetSpeed) > 0.01) {
        playbackRate = targetSpeed;
        applyPlaybackRate(targetSpeed);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('mila:sys-prefs-changed', handleSysPrefsChanged);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('mila:sys-prefs-changed', handleSysPrefsChanged);
    };
  });

  function updateBuffered() {
    if (!videoEl || videoEl.buffered.length === 0) {
      bufferedEnd = 0;
      return;
    }
    bufferedEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
  }

  function formatTime(sec: number): string {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const whole = Math.floor(sec);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  onDestroy(() => {
    if (videoEl) {
      const pos = streamTimeNow();
      const tot = remuxTotalDuration > 0 ? remuxTotalDuration : videoEl.duration || duration || 0;
      if (pos > 0 && tot > 0) {
        ontimeprogress?.(pos, tot, true);
      }
      if (pendingRestoreSeek) {
        videoEl.removeEventListener('loadedmetadata', pendingRestoreSeek);
        pendingRestoreSeek = null;
      }
    }
    window.clearTimeout(osdTimer);
    osdTimer = undefined;
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
    window.clearTimeout(previewSeekTimer);
    previewSeekTimer = undefined;
    window.clearTimeout(spaceHoldTimer);
    spaceHoldTimer = undefined;
    window.clearTimeout(pipClickTimer);
    pipClickTimer = undefined;
    if (volumePersistTimer !== undefined) {
      window.clearTimeout(volumePersistTimer);
      volumePersistTimer = undefined;
      flushVolumeStorage();
    }
    if (videoPrefsPersistTimer !== undefined) {
      window.clearTimeout(videoPrefsPersistTimer);
      videoPrefsPersistTimer = undefined;
      flushVideoPrefsStorage(videoPrefs);
    }
    if (seekHoverRaf) {
      window.cancelAnimationFrame(seekHoverRaf);
      seekHoverRaf = 0;
    }
    spaceIsDown = false;
    spaceHoldBoostActive = false;
    destroyHls();
    destroyDubHls();
    resetPreviewScrubber();
    releaseVideoElementBuffers(videoEl);
    releaseVideoElementBuffers(dubAudioEl);
    activeBlobRevoke?.();
    activeBlobRevoke = null;
    if (nativeFsActive) {
      void setNativeWindowFullscreen(false);
    }
  });
</script>

<svelte:window
  onkeydown={handleGlobalKeydown}
  onkeyup={handleGlobalKeyup}
  onblur={handleWindowBlur}
  onclick={(e) => {
    if (activeMenu === 'appearance' && !(e.target as HTMLElement | null)?.closest('.appearance-wrap')) {
      activeMenu = 'none';
    }
  }}
/>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={rootEl}
  class="hls-player {className}"
  class:is-fullscreen={isFullscreen}
  class:is-pip={isPip && !isFullscreen}
  class:controls-hidden={!controlsVisible && activeMenu === 'none' && !draggingSeek}
  tabindex="0"
  role="region"
  aria-label={title || 'Video player'}
  onmousemove={scheduleHideControls}
  onmouseleave={() => {
    if (activeMenu === 'none' && !draggingSeek) controlsVisible = false;
  }}
>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoEl}
    class="hls-video"
    style:filter={videoFilterCss}
    {poster}
    playsinline
    preload="metadata"
    onpointerdown={handlePipDragTrigger}
    onclick={() => {
      if (suppressNextVideoClick) {
        suppressNextVideoClick = false;
        return;
      }
      if (activeMenu !== 'none') {
        activeMenu = 'none';
        return;
      }
      togglePlay();
    }}
    ondblclick={() => {
      if (isPip && onexpandpip) {
        onexpandpip();
        return;
      }
      void toggleFullscreen();
    }}
    onplay={() => {
      playing = true;
      buffering = false;
      onplaychange?.(true);
      emitLocalPlaybackAction('play', { paused: false });
      if (dubAudio && dubAudioEl) {
        syncDubTime(false);
        if (dubAudioEl.readyState >= 2) {
          void dubAudioEl.play().catch(() => {});
        }
      }
      scheduleHideControls();
    }}
    onpause={() => {
      if (reparentingGuard && videoEl) {
        void videoEl.play().catch(() => {});
        return;
      }
      playing = false;
      controlsVisible = true;
      dubAudioEl?.pause();
      onplaychange?.(false);
      emitLocalPlaybackAction('pause', { paused: true });
      scheduleHideControls();
      if (videoEl) {
        ontimeprogress?.(videoEl.currentTime || 0, videoEl.duration || duration || 0, true);
      }
    }}
    onwaiting={() => {
      buffering = true;
      dubAudioEl?.pause();
    }}
    onloadeddata={() => {
      if (playbackMode === 'remux' || (videoEl && videoEl.readyState >= 2)) {
        buffering = false;
      }
    }}
    oncanplay={() => (buffering = false)}
    oncanplaythrough={() => (buffering = false)}
    onplaying={() => {
      buffering = false;
      if (dubAudio && dubAudioEl) {
        syncDubTime(false);
        void dubAudioEl.play().catch(() => {});
      }
    }}
    onseeked={() => {
      syncDubTime(true);
    }}
    ontimeupdate={() => {
      if (!draggingSeek && videoEl) {
        if (buffering && videoEl.readyState >= 3) {
          buffering = false;
        }
        const now = streamTimeNow();
        currentTime = now;
        const tot = remuxTotalDuration > 0 ? remuxTotalDuration : videoEl.duration || duration || 0;
        ontimeprogress?.(now, tot, false);

        if (videoPrefs.autoSkip && playing) {
          if (
            !autoSkippedOp &&
            opening?.start != null &&
            opening?.stop != null &&
            opening.stop > opening.start + 1 &&
            now >= opening.start &&
            now < opening.stop - 1.5
          ) {
            autoSkippedOp = true;
            seekTo(opening.stop);
            showOsd(t('player.skippedOp'), 'seek');
          } else if (
            !autoSkippedEd &&
            ending?.start != null &&
            ending?.stop != null &&
            ending.stop > ending.start + 1 &&
            now >= ending.start &&
            now < ending.stop - 1.5
          ) {
            autoSkippedEd = true;
            if (videoPrefs.autoNext && hasNext && onnext && tot > 0 && ending.stop >= tot - 3) {
              showOsd(t('player.skippedEd'), 'seek');
              onnext();
            } else {
              seekTo(tot > 0 ? Math.min(ending.stop, Math.max(0, tot - 0.35)) : ending.stop);
              showOsd(t('player.skippedEd'), 'seek');
            }
          }
        }
      }
    }}
    ondurationchange={() => {
      if (!videoEl) return;
      if (playbackMode === 'remux') {
        duration = remuxTotalDuration > 0 ? remuxTotalDuration : remuxSeekOffset + (videoEl.duration || 0);
      } else {
        duration = videoEl.duration || 0;
      }
    }}
    onprogress={updateBuffered}
    onended={() => {
      playing = false;
      controlsVisible = true;
      dubAudioEl?.pause();
      onplaychange?.(false);
      if (videoEl) {
        const tot = remuxTotalDuration > 0 ? remuxTotalDuration : videoEl.duration || duration || 0;
        ontimeprogress?.(tot || streamTimeNow(), tot, true);
      }
      if (videoPrefs.autoNext && hasNext && onnext) {
        onnext();
      }
      onended?.();
    }}
  >
    {#each subtitleTracks as sub (sub.index)}
      <track
        kind="subtitles"
        label={sub.label}
        srclang={sub.lang || 'ru'}
        src={activeSubtitleTrack === sub.index ? sub.src : undefined}
        default={activeSubtitleTrack === sub.index}
      />
    {/each}
  </video>

  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={dubAudioEl} class="dub-media-sink" playsinline preload="auto" aria-hidden="true"></video>

  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={previewVideoEl}
    class="preview-media-sink"
    muted
    playsinline
    preload="metadata"
    onseeked={handlePreviewSeeked}
    aria-hidden="true"
  ></video>

  {#if spaceHoldBoostActive}
    <div class="speed-boost-pill" transition:scale={{ start: 0.9, duration: 140, easing: cubicOut }}>
      <span>2x</span>
      <MorphIcon icon={FastForward} size={14} fill="currentColor" strokeWidth={0} />
    </div>
  {:else if osdVisible && osdText}
    <div class="player-osd-pill" transition:scale={{ start: 0.92, duration: 140, easing: cubicOut }}>
      {#if osdKind === 'mute' || osdKind === 'volume'}
        <MorphIcon
          icon={osdKind === 'mute' ? VolumeX : Volume2}
          size={15}
          strokeWidth={2}
          spring="snappy"
        />
      {:else if osdKind === 'speed'}
        <MorphIcon icon={FastForward} size={15} strokeWidth={2} />
      {/if}
      <span>{osdText}</span>
    </div>
  {/if}

  {#if buffering}
    <div class="center-overlay" aria-hidden="true">
      <div class="loader-ring"></div>
      {#if ffmpegNotice}
        <span class="ffmpeg-status">{ffmpegNotice}</span>
      {/if}
    </div>
  {:else if !playing && !errorText && controlsVisible}
    <button
      type="button"
      class="center-play"
      aria-label="Play"
      onclick={togglePlay}
      transition:scale={{ start: 0.72, duration: 200, easing: cubicOut }}
    >
      <MorphIcon icon={Play} size={54} fill="currentColor" strokeWidth={0} />
    </button>
  {/if}

  {#if errorText}
    <div class="error-banner" role="alert">
      <span class="error-msg">{errorText}</span>
      <div class="error-actions">
        <button
          type="button"
          class="error-btn"
          onclick={() => {
            reloadTick += 1;
          }}
        >
          <MorphIcon icon={RotateCcw} size={14} strokeWidth={2} />
          <span>Retry</span>
        </button>
        {#if hasFallback && onfallback}
          <button
            type="button"
            class="error-btn error-btn-primary"
            onclick={() => onfallback?.()}
          >
            <MorphIcon icon={ArrowRightLeft} size={14} strokeWidth={2} />
            <span>Switch voice</span>
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if skipTarget}
    <button
      type="button"
      class="skip-pill"
      class:raised={controlsVisible}
      onclick={() => seekTo(skipTarget.to)}
      transition:fly={{ y: 16, duration: 260, easing: cubicOut }}
    >
      <span>{skipTarget.label}</span>
      <MorphIcon icon={SkipForward} size={14} strokeWidth={2.1} class="skip-arrow" />
    </button>
  {/if}

  {#if title || subtitle || isPip}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="top-bar"
      class:visible={controlsVisible}
      onpointerdown={handlePipDragTrigger}
    >
      <div class="title-stack">
        {#if title}
          <span class="player-title">{title}</span>
        {/if}
        {#if subtitle}
          <span class="player-subtitle">{subtitle}</span>
        {/if}
      </div>
      <div class="top-bar-right">
        <span class="quality-badge">{activeQualityLabel}</span>
        {#if isPip && !isFullscreen}
          {#if onexpandpip}
            <button
              type="button"
              class="pip-top-btn"
              aria-label="Return to page"
              title="Return to page"
              onpointerdown={(e) => e.stopPropagation()}
              onmousedown={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation();
                onexpandpip?.();
              }}
            >
              <MorphIcon icon={ArrowUpLeft} size={15} strokeWidth={2.1} />
            </button>
          {/if}
          {#if onclosepip}
            <button
              type="button"
              class="pip-top-btn"
              aria-label="Close mini-player"
              title="Close mini-player"
              onpointerdown={(e) => e.stopPropagation()}
              onmousedown={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation();
                onclosepip?.();
              }}
            >
              <MorphIcon icon={X} size={15} strokeWidth={2.1} />
            </button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  <div class="controls-dock" class:visible={controlsVisible}>
    <!-- Timeline -->
    <div
      bind:this={seekEl}
      class="seek-track"
      role="slider"
      tabindex="0"
      aria-label="Seek timeline"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
      onpointerdown={handleSeekPointerDown}
      onpointermove={(e) => seekFromPointer(e.clientX)}
      onpointerup={handleSeekPointerUp}
      onpointerleave={() => {
        cachedSeekRect = null;
        if (!draggingSeek) hoverTime = null;
      }}
    >
      {#if hoverTime !== null}
        {@const canPreviewFrame = previewMediaSpec.mode !== 'none' && !isPip}
        <div
          class="seek-tooltip"
          class:has-frame={canPreviewFrame}
          in:fly={{ y: 6, duration: 150, easing: cubicOut }}
          out:fade={{ duration: 100 }}
          style:left={canPreviewFrame
            ? `clamp(88px, ${hoverPct}%, calc(100% - 88px))`
            : `clamp(34px, ${hoverPct}%, calc(100% - 34px))`}
        >
          {#if canPreviewFrame}
            <div class="seek-preview-frame" class:is-ready={previewHasFrame}>
              <canvas bind:this={previewCanvasEl} class="seek-preview-canvas" width="160" height="90"></canvas>
            </div>
          {/if}
          <div class="seek-tooltip-meta">
            {#if hoverSegmentLabel}
              <span class="seek-segment-tag">{hoverSegmentLabel}</span>
            {/if}
            <span class="seek-time-text">{formatTime(hoverTime)}</span>
          </div>
        </div>
      {/if}
      <div class="seek-rail">
        <div class="seek-buffered" style:width="{bufferedPct}%"></div>
        {#if openingMarkerPct}
          <div
            class="seek-marker"
            style:left="{openingMarkerPct.left}%"
            style:width="{openingMarkerPct.width}%"
          ></div>
        {/if}
        {#if endingMarkerPct}
          <div
            class="seek-marker"
            style:left="{endingMarkerPct.left}%"
            style:width="{endingMarkerPct.width}%"
          ></div>
        {/if}
        <div class="seek-fill" style:width="{progressPct}%"></div>
      </div>
      <div class="seek-thumb" style:left="{progressPct}%"></div>
    </div>

    <div class="controls-row">
      <div class="controls-left">
        <button
          type="button"
          class="icon-btn"
          aria-label={playing ? 'Pause' : 'Play'}
          onclick={togglePlay}
        >
          <MorphIcon
            icon={playing ? Pause : Play}
            size={18}
            fill="currentColor"
            strokeWidth={0}
            spring="snappy"
          />
        </button>

        {#if hasPrev && (!isPip || isFullscreen)}
          <button
            type="button"
            class="icon-btn"
            aria-label="Previous episode"
            title="Previous episode (P)"
            onclick={() => onprev?.()}
          >
            <MorphIcon icon={SkipBack} size={17} strokeWidth={1.8} />
          </button>
        {/if}

        {#if hasNext}
          <button
            type="button"
            class="icon-btn"
            aria-label="Next episode"
            title="Next episode (N)"
            onclick={() => onnext?.()}
          >
            <MorphIcon icon={SkipForward} size={18} strokeWidth={1.8} />
          </button>
        {/if}

        <div
          class="volume-group"
          onwheel={(e) => {
            e.preventDefault();
            setVolume((muted ? 0 : volume) + (e.deltaY < 0 ? 0.05 : -0.05));
          }}
        >
          <button
            type="button"
            class="icon-btn"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onclick={toggleMute}
          >
            <MorphIcon
              icon={muted || volume === 0 ? VolumeX : volume <= 0.5 ? Volume1 : Volume2}
              size={18}
              strokeWidth={1.8}
              spring="snappy"
            />
          </button>
          <Slider
            class="volume-slider"
            value={muted ? 0 : volume}
            min={0}
            max={1}
            step={0.01}
            ariaLabel="Volume"
            onchange={(v) => setVolume(v)}
          />
        </div>

        <span class="time-readout">
          {formatTime(currentTime)} <span class="time-sep">/</span> {formatTime(duration)}
        </span>
      </div>

      <div class="controls-right">
        {#if !isPip || isFullscreen}
          <!-- Voiceover / Audio track selector -->
          {#if voiceComboSections.length > 0}
            <ComboBox
              open={activeMenu === 'voice'}
              sections={voiceComboSections}
              label={activeVoiceLabel || 'Audio'}
              ariaLabel="Voiceover and audio track"
              placement="top-right"
              minWidth={168}
              maxWidth={210}
              maxHeight={280}
              ontoggle={(isOpen) => {
                activeMenu = isOpen ? 'voice' : 'none';
                scheduleHideControls();
              }}
              onselect={(opt) => {
                const raw = String(opt.value);
                if (raw.startsWith('voice:')) {
                  const voiceId = raw.slice('voice:'.length);
                  const found = voices.find((v) => v.id === voiceId);
                  if (found) selectVoice(found);
                } else if (raw.startsWith('dub:')) {
                  const dubId = raw.slice('dub:'.length);
                  if (dubId === 'none' || dubId === dubVoiceId) {
                    onselectdubvoice?.(null);
                  } else {
                    const found = voices.find((v) => v.id === dubId);
                    if (found) onselectdubvoice?.(found);
                  }
                  activeMenu = 'none';
                  scheduleHideControls();
                } else if (raw.startsWith('audio:')) {
                  const idx = Number(raw.slice('audio:'.length));
                  if (Number.isFinite(idx)) setAudioTrack(idx);
                } else if (raw.startsWith('sub:')) {
                  const idx = Number(raw.slice('sub:'.length));
                  if (Number.isFinite(idx)) setSubtitleTrack(idx);
                }
              }}
            >
              {#snippet icon()}
                <MorphIcon icon={AudioLines} size={14} strokeWidth={1.9} />
              {/snippet}
              {#snippet subFooter(parentOpt)}
                {#if parentOpt.value === 'cat:mix' && dubAudio && onduboffsetchange}
                  <div class="mix-sync-bar" role="group" aria-label={t('player.mixSync')}>
                    <span class="mix-sync-label">{t('player.mixSync')}</span>
                    <div class="mix-sync-controls">
                      <button
                        type="button"
                        class="mix-sync-btn"
                        onclick={() => onduboffsetchange(Number((dubOffsetSec - 0.5).toFixed(1)))}
                      >
                        -0.5s
                      </button>
                      <button
                        type="button"
                        class="mix-sync-val"
                        onclick={() => onduboffsetchange(0)}
                        title="Reset sync offset"
                      >
                        {dubOffsetSec > 0 ? `+${dubOffsetSec.toFixed(1)}s` : `${dubOffsetSec.toFixed(1)}s`}
                      </button>
                      <button
                        type="button"
                        class="mix-sync-btn"
                        onclick={() => onduboffsetchange(Number((dubOffsetSec + 0.5).toFixed(1)))}
                      >
                        +0.5s
                      </button>
                    </div>
                  </div>
                {/if}
              {/snippet}
            </ComboBox>
          {/if}

          <!-- Speed & Quality -->
          <ComboBox
            open={activeMenu === 'speed'}
            value={playbackRate}
            options={speedComboOptions}
            label={`${playbackRate}x`}
            ariaLabel="Playback speed"
            placement="top-right"
            minWidth={112}
            ontoggle={(isOpen) => {
              activeMenu = isOpen ? 'speed' : 'none';
              scheduleHideControls();
            }}
            onselect={(opt) => setSpeed(Number(opt.value), true)}
          />

          <!-- Quality selector (defaults to highest fixed resolution) -->
          {#if levels.length > 0}
            <ComboBox
              open={activeMenu === 'quality'}
              value={selectedLevel}
              options={qualityComboOptions}
              label={selectedLevel === -1 ? `Auto (${activeQualityLabel})` : activeQualityLabel}
              ariaLabel="Video quality"
              placement="top-right"
              minWidth={112}
              ontoggle={(isOpen) => {
                activeMenu = isOpen ? 'quality' : 'none';
                scheduleHideControls();
              }}
              onselect={(opt) => setQuality(Number(opt.value))}
            >
              {#snippet icon()}
                <MorphIcon icon={Settings} size={14} strokeWidth={1.9} />
              {/snippet}
            </ComboBox>
          {/if}

          <!-- Playback settings -->
          <div class="appearance-wrap">
            <button
              type="button"
              class="icon-btn"
              class:is-active={activeMenu === 'appearance'}
              aria-label={t('player.settings')}
              aria-expanded={activeMenu === 'appearance'}
              title={t('player.settings')}
              onclick={() => {
                activeMenu = activeMenu === 'appearance' ? 'none' : 'appearance';
                scheduleHideControls();
              }}
            >
              <MorphIcon icon={SlidersHorizontal} size={16} strokeWidth={1.9} />
            </button>

            {#if activeMenu === 'appearance'}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="appearance-popover"
                onclick={(e) => e.stopPropagation()}
                transition:fly={{ y: 6, duration: 170, easing: cubicOut }}
              >
                <div class="ap-head">
                  <span class="ap-title">{t('player.settings')}</span>
                  <button
                    type="button"
                    class="ap-reset"
                    onclick={() => saveVideoPrefs({ ...DEFAULT_VIDEO_PREFS })}
                  >
                    {t('player.reset')}
                  </button>
                </div>

                <div class="ap-toggles">
                  <label class="ap-toggle-row">
                    <span class="ap-toggle-label">{t('player.autoNext')}</span>
                    <Toggle
                      checked={videoPrefs.autoNext}
                      ariaLabel={t('player.autoNext')}
                      onchange={(checked) => saveVideoPrefs({ ...videoPrefs, autoNext: checked })}
                    />
                  </label>
                  <label class="ap-toggle-row">
                    <span class="ap-toggle-label">{t('player.autoSkip')}</span>
                    <Toggle
                      checked={videoPrefs.autoSkip}
                      ariaLabel={t('player.autoSkip')}
                      onchange={(checked) => saveVideoPrefs({ ...videoPrefs, autoSkip: checked })}
                    />
                  </label>
                </div>

                <div class="ap-group ap-slider-group">
                  <div class="ap-label-row">
                    <span class="ap-label">{t('player.brightness')}</span>
                    <span class="ap-value">{Math.round(videoPrefs.brightness * 100)}%</span>
                  </div>
                  <Slider
                    class="ap-brightness-slider"
                    value={videoPrefs.brightness}
                    min={0.6}
                    max={1.4}
                    step={0.05}
                    ariaLabel={t('player.brightness')}
                    onchange={(val) => saveVideoPrefs({ ...videoPrefs, brightness: val })}
                  />
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if ontogglechat && (!isPip || isFullscreen)}
          <button
            type="button"
            class="icon-btn"
            class:is-active={chatOpen}
            aria-label={chatOpen ? 'Hide chat' : 'Open chat'}
            title={chatOpen ? 'Hide chat' : 'Open chat'}
            onclick={() => {
              ontogglechat?.();
              scheduleHideControls();
            }}
          >
            <MorphIcon icon={MessageSquare} size={17} strokeWidth={1.85} />
            {#if !chatOpen && chatUnread > 0}
              <span class="chat-unread-dot" aria-hidden="true"></span>
            {/if}
          </button>
        {/if}

        <button
          type="button"
          class="icon-btn"
          class:is-active={isPip && !isFullscreen}
          aria-label={isPip ? 'Exit picture in picture' : 'Picture in picture'}
          title={isPip ? 'Return to page player' : 'Mini-player (Picture in picture)'}
          onclick={() => void togglePiP()}
        >
          <MorphIcon icon={PictureInPicture2} size={18} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          class="icon-btn"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          onclick={() => void toggleFullscreen()}
        >
          <MorphIcon
            icon={isFullscreen ? Minimize : Maximize}
            size={18}
            strokeWidth={1.8}
            spring="snappy"
          />
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .hls-player {
    position: relative;
    width: 100%;
    height: 100%;
    aspect-ratio: 16 / 9;
    background: #070707;
    border-radius: var(--radius-card, 16px);
    overflow: hidden;
    outline: none;
    user-select: none;
    font-family: 'Medeo Sans', 'Medeo Sans Display', system-ui, sans-serif;
  }

  .hls-player.controls-hidden {
    cursor: none;
  }

  .hls-player:fullscreen,
  .hls-player.is-fullscreen {
    width: 100vw !important;
    height: 100vh !important;
    max-width: none !important;
    max-height: none !important;
    aspect-ratio: auto !important;
    border-radius: 0 !important;
  }

  .hls-player.is-fullscreen:not(:fullscreen) {
    position: fixed !important;
    inset: 0 !important;
    z-index: 99999 !important;
  }

  :global([data-player-fs-root].is-fs-active) .hls-player.is-fullscreen,
  :global([data-player-fs-root]:fullscreen) .hls-player.is-fullscreen {
    position: relative !important;
    inset: auto !important;
    width: 100% !important;
    height: 100% !important;
    z-index: 1 !important;
  }

  .hls-player.is-pip {
    border-radius: 18px !important;
    clip-path: inset(0 round 18px);
  }

  .hls-player.is-pip .top-bar {
    padding: 12px 14px 24px;
    pointer-events: auto;
    cursor: grab;
    --wails-draggable: drag;
  }

  .hls-player.is-pip:hover .top-bar {
    opacity: 1;
  }

  .hls-player.is-pip .top-bar:active {
    cursor: grabbing;
  }

  .hls-player.is-pip .controls-dock,
  .hls-player.is-pip .center-play,
  .hls-player.is-pip .skip-pill,
  .hls-player.is-pip .top-bar-right,
  .hls-player.is-pip .pip-top-btn {
    --wails-draggable: no-drag;
  }

  .hls-player.is-pip .player-title {
    font-size: 13.5px;
  }

  .hls-player.is-pip .player-subtitle {
    font-size: 11.5px;
  }

  .hls-player.is-pip .center-play {
    transform: translate(-50%, -50%) scale(0.76);
  }

  .hls-player.is-pip .center-play:hover {
    transform: translate(-50%, -50%) scale(0.84);
  }

  .hls-player.is-pip .center-play:active {
    transform: translate(-50%, -50%) scale(0.7);
  }

  .hls-player.is-pip .controls-dock {
    padding: 14px 12px 8px;
    gap: 2px;
  }

  .hls-player.is-pip .skip-pill {
    left: 12px;
    bottom: 12px;
    height: 30px;
    padding: 0 11px;
    font-size: 11.5px;
  }

  .hls-player.is-pip .skip-pill.raised {
    bottom: 52px;
  }

  .hls-player.is-pip :global(.volume-slider) {
    width: 44px;
  }

  .hls-player.is-pip .time-readout {
    margin-left: 2px;
    font-size: 11.5px;
  }

  .top-bar-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    pointer-events: auto;
  }

  .pip-top-btn {
    position: relative;
    z-index: 2;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: rgba(255, 255, 255, 0.88);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
  }

  .pip-top-btn :global(svg) {
    pointer-events: none;
  }

  .pip-top-btn:hover {
    background: rgba(255, 255, 255, 0.22);
    color: #ffffff;
    transform: translateY(-1px);
  }

  .hls-video {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
    background: #000000;
  }

  .hls-video::cue {
    font-size: calc(1em * var(--mila-sub-scale, 1));
  }

  .top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 6;
    padding: 20px 24px 36px;
    background: linear-gradient(180deg, rgba(7, 7, 7, 0.82) 0%, rgba(7, 7, 7, 0) 100%);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s var(--ease-out, ease);
  }

  .top-bar.visible {
    opacity: 1;
  }

  .title-stack {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .player-title {
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .player-subtitle {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.65);
  }

  .quality-badge {
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .center-overlay,
  .center-play {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .center-play {
    padding: 12px;
    border: none;
    outline: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.94);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    filter: drop-shadow(0 6px 24px rgba(0, 0, 0, 0.72));
    transition: transform 0.22s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)), color 0.18s ease, opacity 0.18s ease;
  }

  .center-play:hover {
    transform: translate(-50%, -50%) scale(1.12);
    color: #ffffff;
  }

  .center-play:active {
    transform: translate(-50%, -50%) scale(0.92);
  }

  .loader-ring {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.18);
    border-top-color: #ffffff;
    animation: hls-spin 0.75s linear infinite;
  }

  @keyframes hls-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-banner {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 5;
    padding: 14px 18px;
    border-radius: 14px;
    background: rgba(20, 12, 14, 0.92);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: none;
    color: #ffb4b4;
    font-size: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    max-width: min(420px, 86%);
  }

  .error-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .error-btn {
    height: 32px;
    padding: 0 12px;
    border: none;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: background-color 0.18s ease, transform 0.16s ease;
  }

  .error-btn:hover {
    background: rgba(255, 255, 255, 0.22);
    transform: translateY(-1px);
  }

  .error-btn-primary {
    background: rgba(255, 255, 255, 0.2);
  }

  .skip-pill {
    position: absolute;
    left: 24px;
    bottom: 24px;
    z-index: 4;
    height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    border: none;
    outline: none;
    background: rgba(14, 14, 16, 0.54);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    color: rgba(255, 255, 255, 0.92);
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    transition:
      bottom 0.25s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
      background-color 0.2s ease,
      color 0.2s ease,
      transform 0.2s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
  }

  .skip-pill.raised {
    bottom: 68px;
  }

  .skip-pill :global(.skip-arrow) {
    transition: transform 0.2s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
  }

  .skip-pill:hover {
    background: rgba(255, 255, 255, 0.18);
    color: #ffffff;
    transform: translateY(-1px);
  }

  .skip-pill:hover :global(.skip-arrow) {
    transform: translateX(2px);
  }

  .controls-dock {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 20px 20px 10px;
    background: linear-gradient(0deg, rgba(7, 7, 7, 0.88) 0%, rgba(7, 7, 7, 0) 100%);
    display: flex;
    flex-direction: column;
    gap: 4px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s var(--ease-out, ease);
  }

  .controls-dock.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .seek-track {
    position: relative;
    width: 100%;
    height: 12px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }

  .seek-rail {
    position: relative;
    width: 100%;
    height: 3px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
    transition: height 0.15s ease;
  }

  .seek-track:hover .seek-rail {
    height: 5px;
  }

  .seek-buffered {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgba(255, 255, 255, 0.3);
  }

  .seek-marker {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(255, 200, 110, 0.55);
    pointer-events: none;
  }

  .seek-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: #ffffff;
  }

  .seek-thumb {
    position: absolute;
    top: 50%;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #ffffff;
    transform: translate(-50%, -50%) scale(0);
    transition: transform 0.15s ease;
    pointer-events: none;
  }

  .seek-track:hover .seek-thumb {
    transform: translate(-50%, -50%) scale(1);
  }

  .seek-tooltip {
    position: absolute;
    bottom: 20px;
    transform: translateX(-50%);
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(14, 14, 17, 0.94);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.58);
    color: #ffffff;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12px;
    line-height: 1;
    pointer-events: none;
    white-space: nowrap;
    z-index: 6;
  }

  .seek-tooltip.has-frame {
    gap: 7px;
    padding: 6px 6px 7px;
    border-radius: 12px;
  }

  .seek-preview-frame {
    display: block;
    width: 164px;
    aspect-ratio: 16 / 9;
    border-radius: 8px;
    overflow: hidden;
    background: #101014;
  }

  .seek-preview-canvas {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.16s ease-out;
  }

  .seek-preview-frame.is-ready .seek-preview-canvas {
    opacity: 1;
  }

  .seek-tooltip-meta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0;
    line-height: 1;
  }

  .seek-time-text {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    line-height: 1;
    color: rgba(255, 255, 255, 0.94);
  }

  .seek-segment-tag {
    padding: 0;
    background: transparent;
    color: #ffc86e;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
  }

  .controls-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .controls-left,
  .controls-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: rgba(255, 255, 255, 0.88);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .icon-btn:hover,
  .icon-btn.is-active {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .volume-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .volume-group :global(.volume-slider) {
    width: 60px;
    height: 24px;
    margin-right: 4px;
  }

  .time-readout {
    margin-left: 6px;
    font-size: 13px;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
  }

  .time-sep {
    color: rgba(255, 255, 255, 0.45);
  }

  .dub-media-sink,
  .preview-media-sink {
    position: fixed;
    left: -10px;
    top: -10px;
    width: 2px;
    height: 2px;
    opacity: 0.001;
    pointer-events: none;
  }

  .speed-boost-pill,
  .player-osd-pill {
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    height: 32px;
    padding: 0 13px;
    border-radius: 999px;
    background: rgba(14, 14, 17, 0.78);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    color: #ffffff;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    pointer-events: none;
    white-space: nowrap;
  }

  .appearance-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .icon-btn {
    position: relative;
  }

  .chat-unread-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 0 0 2px rgba(7, 7, 7, 0.85);
    pointer-events: none;
  }

  .appearance-popover {
    position: absolute;
    right: 0;
    bottom: 36px;
    width: 242px;
    padding: 13px 14px;
    border-radius: 15px;
    background: var(--mila-popup-comboBg, rgba(10, 10, 10, 0.9));
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: none;
    box-shadow: var(--mila-popup-shadow, 0 22px 52px rgba(0, 0, 0, 0.78));
    display: flex;
    flex-direction: column;
    gap: 10px;
    transform-origin: bottom right;
    z-index: 40;
    color: var(--mila-text-primary, #ffffff);
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
  }

  .ap-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .ap-title {
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: var(--mila-text-primary, #ffffff);
    letter-spacing: -0.01em;
    line-height: 1;
  }

  .ap-reset {
    height: auto;
    padding: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.44));
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .ap-reset:hover {
    color: var(--mila-text-primary, #ffffff);
  }

  .ap-toggles {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ap-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 28px;
    padding: 3px 0;
    cursor: pointer;
  }

  .ap-toggle-label {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--mila-popup-itemText, rgba(255, 255, 255, 0.78));
    user-select: none;
    transition: color 0.14s ease;
  }

  .ap-toggle-row:hover .ap-toggle-label {
    color: var(--mila-text-primary, #ffffff);
  }

  .ap-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ap-slider-group {
    gap: 6px;
    padding: 2px 0 0;
  }

  .ap-slider-group :global(.ap-brightness-slider) {
    height: 18px;
  }

  .ap-slider-group :global(.ap-brightness-slider .marla-slider-rail) {
    height: 6px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.08));
  }

  .ap-slider-group :global(.ap-brightness-slider:hover:not(.is-disabled) .marla-slider-rail),
  .ap-slider-group :global(.ap-brightness-slider:focus-visible:not(.is-disabled) .marla-slider-rail),
  .ap-slider-group :global(.ap-brightness-slider.is-dragging .marla-slider-rail) {
    height: 6px;
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.12));
  }

  .ap-slider-group :global(.ap-brightness-slider .marla-slider-fill) {
    background: var(--mila-toggle-trackOn, var(--mila-accent-primary, #ffffff));
  }

  .ap-slider-group :global(.ap-brightness-slider .marla-slider-thumb) {
    display: none;
  }

  .ap-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .ap-label {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--mila-popup-itemText, rgba(255, 255, 255, 0.78));
    user-select: none;
  }

  .ap-value {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: var(--mila-text-secondary, rgba(255, 255, 255, 0.78));
    font-variant-numeric: tabular-nums;
    user-select: none;
  }

  .mix-sync-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 4px 8px 2px;
    padding: 4px 8px;
    border-radius: 9px;
    background: var(--mila-popup-itemBg, rgba(255, 255, 255, 0.06));
  }

  .mix-sync-label {
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--mila-popup-comboSectionText, rgba(255, 255, 255, 0.2));
    user-select: none;
  }

  .mix-sync-controls {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .mix-sync-btn,
  .mix-sync-val {
    height: 24px;
    padding: 0 7px;
    border: none;
    outline: none;
    border-radius: 7px;
    background: transparent;
    color: var(--mila-popup-itemText, rgba(255, 255, 255, 0.78));
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 11.5px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background-color 0.14s ease, color 0.14s ease;
  }

  .mix-sync-btn:hover,
  .mix-sync-val:hover {
    background: var(--mila-popup-itemHover, rgba(255, 255, 255, 0.11));
    color: var(--mila-text-primary, #ffffff);
  }

  .ffmpeg-status {
    margin-top: 12px;
    padding: 5px 12px;
    border-radius: 999px;
    background: rgba(14, 14, 17, 0.88);
    color: rgba(255, 255, 255, 0.88);
    font-size: 12.5px;
    font-weight: 400;
  }
</style>
