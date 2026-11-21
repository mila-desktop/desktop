<script lang="ts">
  import { onDestroy } from 'svelte';
  import type HlsType from 'hls.js';
  import { getLoadedHls, loadHls } from '../../app/hlsLoader';
  import { releaseVideoElementBuffers } from '../../app/lifecycle';
  import { MorphIcon } from 'morphicons/svelte';
  import { Play, Check } from 'lucide';
  import type { PlayableEpisode } from '../../api/anime';
  import { settingsState } from '../../app/settings.svelte';

  interface Props {
    episode: PlayableEpisode;
    index: number;
    variant?: 'grid' | 'list';
    isCurrent?: boolean;
    isWatched?: boolean;
    progressRatio?: number;
    cornerTL?: boolean;
    cornerTR?: boolean;
    cornerBL?: boolean;
    cornerBR?: boolean;
    fallbackImages?: string[];
    onchoose?: () => void;
  }

  let {
    episode,
    index,
    variant = 'grid',
    isCurrent = false,
    isWatched = false,
    progressRatio = 0,
    cornerTL = false,
    cornerTR = false,
    cornerBL = false,
    cornerBR = false,
    fallbackImages = [],
    onchoose
  }: Props = $props();

  let hoverTimer: number | undefined;
  let hoverActive = $state(false);
  let videoReady = $state(false);
  let videoEl = $state<HTMLVideoElement | null>(null);
  let hlsInstance: HlsType | null = null;
  let capturedFrameUrl = $state<string | null>(null);
  let failedUrls = $state<Record<string, boolean>>({});
  let excerptStart = $state(0);

  function formatDuration(sec: number): string {
    if (!sec || sec <= 0) return '';
    const mins = Math.round(sec / 60);
    return mins > 0 ? `${mins}m` : `${sec}s`;
  }

  function formatDurationFull(sec: number): string {
    if (!sec || sec <= 0) return '';
    const mins = Math.round(sec / 60);
    return mins > 0 ? `${mins} min` : `${sec} sec`;
  }

  function formatClock(sec: number): string {
    const s = Math.max(0, Math.round(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
  }

  const remainingLabel = $derived.by(() => {
    if (isWatched) return 'Completed';
    if (progressRatio > 0.02 && episode.duration > 0) {
      const remSec = Math.max(0, Math.round(episode.duration * (1 - progressRatio)));
      const remMin = Math.max(1, Math.round(remSec / 60));
      return `${Math.round(progressRatio * 100)}% · ${remMin}m left`;
    }
    return isCurrent ? 'Now playing' : 'Unwatched';
  });

  const coverUrl = $derived.by(() => {
    const candidates: string[] = [];
    if (capturedFrameUrl) candidates.push(capturedFrameUrl);
    if (episode.preview?.trim()) candidates.push(episode.preview.trim());

    if (fallbackImages.length > 0) {
      const len = fallbackImages.length;
      for (let offset = 0; offset < len; offset++) {
        const u = fallbackImages[(index + offset) % len];
        if (u && !candidates.includes(u)) {
          candidates.push(u);
        }
      }
    }

    for (const url of candidates) {
      if (!failedUrls[url]) return url;
    }
    return '';
  });

  const previewStream = $derived.by(() => {
    const hlsUrl = episode.hls_480 || episode.hls_720 || episode.hls_1080;
    if (hlsUrl?.trim()) return { kind: 'hls' as const, url: hlsUrl.trim() };
    const mp4Url = episode.mp4_480 || episode.mp4_720 || episode.mp4_1080;
    if (mp4Url?.trim()) return { kind: 'mp4' as const, url: mp4Url.trim() };
    return null;
  });

  function computeExcerptStart(totalSec: number): number {
    const base =
      episode.opening?.stop != null
        ? Math.round(episode.opening.stop + 45)
        : episode.duration > 180
          ? Math.round(episode.duration * 0.25)
          : 130;
    if (totalSec > 20) {
      return Math.max(0, Math.min(base, Math.floor(totalSec - 12)));
    }
    return Math.max(0, base);
  }

  function isSameOriginUrl(rawUrl: string): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const parsed = new URL(rawUrl, window.location.href);
      return parsed.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  let capturedBlobUrl = '';

  function revokeCapturedFrame() {
    if (capturedBlobUrl) {
      URL.revokeObjectURL(capturedBlobUrl);
      capturedBlobUrl = '';
    }
  }

  function tryCaptureVideoFrame(video: HTMLVideoElement, streamUrl: string) {
    if (capturedFrameUrl || episode.preview || !isSameOriginUrl(streamUrl)) return;
    if (!video.videoWidth || !video.videoHeight) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 270;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(
          (blob) => {
            if (!blob || capturedFrameUrl) return;
            const nextUrl = URL.createObjectURL(blob);
            capturedBlobUrl = nextUrl;
            capturedFrameUrl = nextUrl;
          },
          'image/jpeg',
          0.82
        );
      } else {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        if (dataUrl.startsWith('data:image/')) {
          capturedFrameUrl = dataUrl;
        }
      }
    } catch {
      // Ignore tainted canvas errors on third-party media CDNs
    }
  }

  function cleanupPreview() {
    window.clearTimeout(hoverTimer);
    hoverTimer = undefined;
    videoReady = false;
    if (hlsInstance) {
      try {
        hlsInstance.destroy();
      } catch {
        // Ignore already destroyed instance
      }
      hlsInstance = null;
    }
    releaseVideoElementBuffers(videoEl);
  }

  $effect(() => {
    void episode.id;
    capturedFrameUrl = null;
    failedUrls = {};
  });

  function handleMouseEnter() {
    if (!settingsState.hoverEpisodePreview || typeof window === 'undefined' || !previewStream) return;
    if (window.matchMedia && !window.matchMedia('(hover: hover)').matches) return;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      hoverActive = true;
    }, 180);
  }

  function handleMouseLeave() {
    window.clearTimeout(hoverTimer);
    hoverTimer = undefined;
    hoverActive = false;
  }

  $effect(() => {
    const active = hoverActive;
    const video = videoEl;
    const stream = previewStream;
    const epId = episode.id;

    void epId;
    if (!active || !video || !stream) {
      return;
    }

    let cancelled = false;
    const startSec = computeExcerptStart(episode.duration);
    excerptStart = startSec;
    let initialSeekApplied = false;

    const applyInitialSeek = () => {
      if (cancelled || initialSeekApplied) return;
      initialSeekApplied = true;
      const clamped = computeExcerptStart(Number.isFinite(video.duration) ? video.duration : episode.duration);
      excerptStart = clamped;
      if (clamped > 1 && Math.abs(video.currentTime - clamped) > 3) {
        try {
          video.currentTime = clamped;
        } catch {
          // Seek deferred
        }
      }
      void video.play().catch(() => {});
    };

    const handlePlaying = () => {
      if (cancelled) return;
      videoReady = true;
      tryCaptureVideoFrame(video, stream.url);
    };

    const handleTimeUpdate = () => {
      if (cancelled) return;
      if (video.currentTime >= excerptStart + 10) {
        try {
          video.currentTime = excerptStart;
        } catch {
          // Ignore seek failures during teardown
        }
      }
    };

    video.muted = true;
    video.playsInline = true;
    video.addEventListener('loadedmetadata', applyInitialSeek);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('canplay', handlePlaying);
    video.addEventListener('timeupdate', handleTimeUpdate);

    const attachThumbHls = (HlsCtor: typeof HlsType) => {
      if (cancelled) return;
      if (HlsCtor.isSupported()) {
        const hls = new HlsCtor({
          enableWorker: true,
          lowLatencyMode: false,
          capLevelToPlayerSize: true,
          startPosition: startSec,
          maxBufferLength: 10,
          maxMaxBufferLength: 16,
          fragLoadingMaxRetry: 1,
          manifestLoadingMaxRetry: 1
        });
        hlsInstance = hls;
        hls.loadSource(stream.url);
        hls.attachMedia(video);
        hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
          if (!cancelled) {
            void video.play().catch(() => {});
          }
        });
        hls.on(HlsCtor.Events.ERROR, (_ev, data) => {
          if (data.fatal) {
            try {
              hls.destroy();
            } catch {
              // Ignore destroy errors
            }
            if (hlsInstance === hls) hlsInstance = null;
          }
        });
      } else {
        video.src = stream.url;
        video.load();
      }
    };

    if (stream.kind === 'hls') {
      const CachedHls = getLoadedHls();
      if (CachedHls) {
        attachThumbHls(CachedHls);
      } else {
        void loadHls()
          .then(attachThumbHls)
          .catch(() => {
            if (!cancelled) {
              video.src = stream.url;
              video.load();
            }
          });
      }
    } else {
      video.src = stream.url;
      video.load();
    }

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', applyInitialSeek);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplay', handlePlaying);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      cleanupPreview();
    };
  });

  onDestroy(() => {
    hoverActive = false;
    cleanupPreview();
    revokeCapturedFrame();
  });
</script>

<button
  type="button"
  class="ep-card"
  class:is-grid={variant === 'grid'}
  class:is-list={variant === 'list'}
  class:is-active={isCurrent}
  class:is-previewing={hoverActive && videoReady}
  class:corner-tl={cornerTL}
  class:corner-tr={cornerTR}
  class:corner-bl={cornerBL}
  class:corner-br={cornerBR}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onclick={() => onchoose?.()}
>
  {#if variant === 'list'}
    {#if coverUrl}
      <div class="ep-list-bg" aria-hidden="true">
        <img src={coverUrl} alt="" class="ep-list-bg-img" loading="lazy" decoding="async" />
        <div class="ep-list-bg-scrim"></div>
      </div>
    {/if}

    <div class="ep-list-thumb-box">
      {#if coverUrl}
        <img
          src={coverUrl}
          alt="Episode {episode.ordinal}"
          class="ep-thumb"
          loading="lazy"
          decoding="async"
          onerror={() => {
            failedUrls = { ...failedUrls, [coverUrl]: true };
          }}
        />
      {:else}
        <div class="ep-thumb-fallback" aria-hidden="true">
          <MorphIcon icon={Play} size={18} fill="currentColor" strokeWidth={0} />
        </div>
      {/if}

      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoEl}
        class="ep-preview-video"
        class:is-visible={hoverActive && videoReady}
        muted
        playsinline
        preload="none"
        aria-hidden="true"
      ></video>

      {#if progressRatio > 0.02}
        <div class="ep-progress-track" aria-hidden="true">
          <div class="ep-progress-fill" style:width={`${Math.min(100, Math.round(progressRatio * 100))}%`}></div>
        </div>
      {/if}
    </div>

    <div class="ep-list-info">
      <div class="ep-list-title-line">
        <span class="ep-num">Episode {episode.ordinal}</span>
        {#if episode.name}
          <span class="ep-list-name">{episode.name}</span>
        {/if}
        {#if isCurrent}
          <span class="ep-list-tag is-current">Playing</span>
        {/if}
        {#if isWatched}
          <span class="ep-list-tag is-watched">
            <MorphIcon icon={Check} size={11} strokeWidth={2.5} />
            <span>Watched</span>
          </span>
        {/if}
      </div>
      <div class="ep-list-meta">
        {#if episode.duration > 0}
          <span>{formatDurationFull(episode.duration)}</span>
        {/if}
        {#if episode.opening}
          <span>OP skip</span>
        {/if}
        {#if episode.ending}
          <span>ED skip</span>
        {/if}
      </div>
    </div>

    <div class="ep-list-aside" aria-hidden="true">
      <div class="ep-aside-row">
        {#if episode.opening?.start != null}
          <span>OP {formatClock(episode.opening.start)}</span>
        {/if}
        {#if episode.ending?.start != null}
          <span>ED {formatClock(episode.ending.start)}</span>
        {/if}
        {#if episode.duration > 0}
          <span>{formatClock(episode.duration)}</span>
        {/if}
      </div>
      <div class="ep-aside-row is-sub">
        <span>EP {String(episode.ordinal).padStart(2, '0')}</span>
        <span>{remainingLabel}</span>
      </div>
    </div>
  {:else}
    <div class="ep-thumb-wrap">
      {#if coverUrl}
        <img
          src={coverUrl}
          alt="Episode {episode.ordinal}"
          class="ep-thumb"
          loading="lazy"
          decoding="async"
          onerror={() => {
            failedUrls = { ...failedUrls, [coverUrl]: true };
          }}
        />
      {:else}
        <div class="ep-thumb-fallback" aria-hidden="true">
          <MorphIcon icon={Play} size={20} fill="currentColor" strokeWidth={0} />
        </div>
      {/if}

      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoEl}
        class="ep-preview-video"
        class:is-visible={hoverActive && videoReady}
        muted
        playsinline
        preload="none"
        aria-hidden="true"
      ></video>
    </div>

    <div class="ep-thumb-fade" aria-hidden="true"></div>
    {#if isWatched || isCurrent}
      <div class="ep-status-row" aria-hidden="true">
        {#if isCurrent}
          <span class="ep-badge-now">Playing</span>
        {/if}
        {#if isWatched}
          <span class="ep-badge-watched" title="Watched">
            <MorphIcon icon={Check} size={12} strokeWidth={2.6} />
          </span>
        {/if}
      </div>
    {/if}
    <div class="ep-overlay-bottom">
      <div class="ep-title-row">
        {#if episode.name}
          <span class="ep-num">EP {episode.ordinal}</span>
          <span class="ep-name">{episode.name}</span>
        {:else}
          <span class="ep-num">Episode {episode.ordinal}</span>
        {/if}
      </div>
      {#if episode.duration > 0}
        <span class="ep-duration">{formatDuration(episode.duration)}</span>
      {/if}
    </div>
    {#if progressRatio > 0.02}
      <div class="ep-progress-track" aria-hidden="true">
        <div class="ep-progress-fill" style:width={`${Math.min(100, Math.round(progressRatio * 100))}%`}></div>
      </div>
    {/if}
  {/if}
</button>

<style>
  .ep-card {
    position: relative;
    display: block;
    padding: 0;
    border: none;
    outline: none;
    --ep-r-tl: 0px;
    --ep-r-tr: 0px;
    --ep-r-br: 0px;
    --ep-r-bl: 0px;
    border-radius: var(--ep-r-tl) var(--ep-r-tr) var(--ep-r-br) var(--ep-r-bl);
    overflow: hidden;
    background: var(--mila-app-canvas, #0c0c0c);
    isolation: isolate;
    contain: layout style paint;
    cursor: pointer;
    text-align: left;
    transition: background-color 0.24s var(--ease-out);
  }

  .ep-card.corner-tl {
    --ep-r-tl: var(--radius-card);
  }

  .ep-card.corner-tr {
    --ep-r-tr: var(--radius-card);
  }

  .ep-card.corner-bl {
    --ep-r-bl: var(--radius-card);
  }

  .ep-card.corner-br {
    --ep-r-br: var(--radius-card);
  }

  /* List variant: zero inner thumbnail padding, left-only rounding, blurred screenshot full-row background */
  .ep-card.is-list {
    width: 100%;
    height: 92px;
    padding: 0 16px 0 0;
    display: flex;
    align-items: center;
    gap: 16px;
    --ep-r-tl: var(--radius-card);
    --ep-r-tr: 0px;
    --ep-r-br: 0px;
    --ep-r-bl: var(--radius-card);
    border-radius: 0;
    background: #0e0e11;
    overflow: hidden;
  }

  .ep-list-bg {
    position: absolute;
    inset: -2px;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .ep-list-bg-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(30px) saturate(1.22) brightness(0.42);
    transform: scale(1.22);
    opacity: 0.72;
    transition: opacity 0.3s var(--ease-out), filter 0.3s var(--ease-out);
  }

  .ep-card.is-list:hover .ep-list-bg-img {
    opacity: 0.94;
    filter: blur(28px) saturate(1.28) brightness(0.5);
  }

  .ep-list-bg-scrim {
    position: absolute;
    inset: -2px;
    background: linear-gradient(
      90deg,
      rgba(var(--mila-app-canvasRgb, 12, 12, 12), 0.25) 0%,
      rgba(var(--mila-app-canvasRgb, 12, 12, 12), 0.72) 38%,
      rgba(var(--mila-app-canvasRgb, 12, 12, 12), 0.88) 100%
    );
  }

  .ep-list-thumb-box {
    position: relative;
    z-index: 1;
    width: 164px;
    height: 100%;
    flex-shrink: 0;
    border-radius: var(--radius-card) 0 0 var(--radius-card);
    overflow: hidden;
    background: var(--mila-app-canvas, #09090b);
  }

  .ep-list-info {
    position: relative;
    z-index: 1;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ep-list-title-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    min-width: 0;
  }

  .ep-list-name {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.82);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ep-list-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 999px;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.2;
  }

  .ep-list-tag.is-current {
    padding: 0;
    border-radius: 0;
    background: transparent;
    color: #ffffff;
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .ep-list-tag.is-watched {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.86);
  }

  .ep-list-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12.5px;
    color: rgba(255, 255, 255, 0.56);
  }

  .ep-list-aside {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
    padding-left: 12px;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .ep-aside-row {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 11.5px;
    line-height: 1.2;
    color: rgba(255, 255, 255, 0.4);
    transition: color 0.2s var(--ease-out);
  }

  .ep-aside-row.is-sub {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.26);
  }

  .ep-card.is-list:hover .ep-aside-row {
    color: rgba(255, 255, 255, 0.62);
  }

  .ep-card.is-list:hover .ep-aside-row.is-sub {
    color: rgba(255, 255, 255, 0.42);
  }

  .ep-thumb-wrap {
    position: relative;
    z-index: 0;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: inherit;
    overflow: hidden;
    background: var(--mila-app-canvas, #0c0c0c);
  }

  .ep-card::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 4;
    background: linear-gradient(155deg, rgba(255, 255, 255, 0.085) 0%, rgba(255, 255, 255, 0) 46%);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.28s var(--ease-out);
  }

  .ep-card:hover::after {
    opacity: 1;
  }

  .ep-thumb {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: inherit;
    transition: filter 0.34s var(--ease-out);
  }

  .ep-card:not(.is-list) .ep-thumb,
  .ep-card:not(.is-list) .ep-preview-video {
    -webkit-mask-image: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.86) 0%,
      rgba(0, 0, 0, 0.78) 44%,
      rgba(0, 0, 0, 0.14) 76%,
      rgba(0, 0, 0, 0.03) 89%,
      transparent 95%,
      transparent 100%
    );
    mask-image: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.86) 0%,
      rgba(0, 0, 0, 0.78) 44%,
      rgba(0, 0, 0, 0.14) 76%,
      rgba(0, 0, 0, 0.03) 89%,
      transparent 95%,
      transparent 100%
    );
  }

  .ep-card:hover .ep-thumb {
    filter: brightness(1.08) contrast(1.04);
  }

  .ep-preview-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.34s var(--ease-out);
    z-index: 1;
  }

  .ep-preview-video.is-visible {
    opacity: 1;
  }

  .ep-thumb-fallback {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.24);
    background: radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.06) 0%, #0c0c0c 78%);
    transition: color 0.25s var(--ease-out);
  }

  .ep-card:hover .ep-thumb-fallback {
    color: rgba(255, 255, 255, 0.55);
  }

  .ep-thumb-fade {
    position: absolute;
    inset: -2px;
    z-index: 2;
    border-radius: inherit;
    background: linear-gradient(
      180deg,
      rgba(var(--mila-app-canvasRgb, 12, 12, 12), 0.16) 0%,
      rgba(var(--mila-app-canvasRgb, 12, 12, 12), 0.24) 44%,
      rgba(var(--mila-app-canvasRgb, 12, 12, 12), 0.86) 76%,
      rgba(var(--mila-app-canvasRgb, 12, 12, 12), 0.97) 89%,
      var(--mila-app-canvas, #0c0c0c) 95%,
      var(--mila-app-canvas, #0c0c0c) 100%
    );
    pointer-events: none;
  }

  .ep-overlay-bottom {
    position: absolute;
    z-index: 3;
    left: 12px;
    right: 12px;
    bottom: 10px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }

  .ep-title-row {
    display: flex;
    align-items: baseline;
    gap: 7px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .ep-num {
    flex-shrink: 0;
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #ffffff;
  }

  .ep-name {
    min-width: 0;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 400;
    line-height: 1.3;
    color: rgba(255, 255, 255, 0.74);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ep-card.is-active .ep-name {
    color: rgba(255, 255, 255, 0.92);
  }

  .ep-duration {
    flex-shrink: 0;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.56);
    font-variant-numeric: tabular-nums;
  }

  .ep-status-row {
    position: absolute;
    top: 10px;
    left: 10px;
    right: 10px;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    pointer-events: none;
  }

  .ep-badge-now {
    margin-right: auto;
    padding: 0;
    border-radius: 0;
    background: transparent;
    color: #ffffff;
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }

  .ep-badge-watched {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(12, 12, 12, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: rgba(255, 255, 255, 0.92);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .ep-progress-track {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    z-index: 4;
    background: rgba(255, 255, 255, 0.14);
    pointer-events: none;
  }

  .ep-progress-fill {
    height: 100%;
    background: rgba(255, 255, 255, 0.92);
    transition: width 0.25s var(--ease-out);
  }
</style>
