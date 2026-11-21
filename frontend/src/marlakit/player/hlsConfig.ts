import type { HlsConfig } from 'hls.js';
import type { HlsSources, QualityVariant, TorrentRemuxConfig } from './types';
import { settingsState } from '../../app/settings.svelte';

// Maximum-quality HLS configuration tuned for desktop anime VOD playback.
export function createMaxQualityHlsConfig(overrides: Partial<HlsConfig> = {}): Partial<HlsConfig> {
  const bufSec = settingsState.hlsBufferSec || 30;
  return {
    enableWorker: true,
    lowLatencyMode: false,
    capLevelToPlayerSize: false,
    abrEwmaDefaultEstimate: 25_000_000,
    abrEwmaDefaultEstimateMax: 100_000_000,
    maxBufferLength: bufSec,
    maxMaxBufferLength: Math.max(90, bufSec * 3),
    backBufferLength: 30,
    maxBufferHole: 0.5,
    fragLoadingMaxRetry: 4,
    manifestLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
    fragLoadingRetryDelay: 700,
    manifestLoadingRetryDelay: 700,
    levelLoadingRetryDelay: 700,
    ...overrides
  };
}

// Normalizes AniLiberty-style multi-URL episode sources, ordered highest quality first.
export function normalizeQualitySources(sources?: HlsSources | null): QualityVariant[] {
  if (!sources) {
    return [];
  }
  const variants: QualityVariant[] = [];
  if (sources.hls_1080) {
    variants.push({
      label: '1080p',
      width: 1920,
      height: 1080,
      bandwidth: 8_000_000,
      url: sources.hls_1080
    });
  }
  if (sources.hls_720) {
    variants.push({
      label: '720p',
      width: 1280,
      height: 720,
      bandwidth: 3_500_000,
      url: sources.hls_720
    });
  }
  if (sources.hls_480) {
    variants.push({
      label: '480p',
      width: 854,
      height: 480,
      bandwidth: 1_500_000,
      url: sources.hls_480
    });
  }
  return variants;
}

export interface ResolvedSource {
  url: string;
  revoke?: () => void;
}

export interface Mp4Variant {
  label: string;
  height: number;
  bitrate: number;
  url: string;
}

export type ResolvedPlayback =
  | { mode: 'hls'; url: string; revoke?: () => void }
  | { mode: 'mp4'; variants: Mp4Variant[] }
  | { mode: 'remux'; remux: TorrentRemuxConfig };

export function normalizeMp4Sources(sources?: HlsSources | null): Mp4Variant[] {
  if (!sources) return [];
  const variants: Mp4Variant[] = [];
  if (sources.mp4_1080) {
    variants.push({ label: '1080p', height: 1080, bitrate: 5_000_000, url: sources.mp4_1080 });
  }
  if (sources.mp4_720) {
    variants.push({ label: '720p', height: 720, bitrate: 2_800_000, url: sources.mp4_720 });
  }
  if (sources.mp4_480) {
    variants.push({ label: '480p', height: 480, bitrate: 1_500_000, url: sources.mp4_480 });
  }
  return variants;
}

// Builds a synthesized #EXTM3U master playlist Blob URL when multiple quality URLs are provided,
// enabling seamless quality switching inside hls.js without reloading from scratch.
export function resolveHlsSource(src?: string | null, sources?: HlsSources | null): ResolvedSource | null {
  const direct = src?.trim();
  if (direct) {
    return { url: direct };
  }

  const variants = normalizeQualitySources(sources);
  if (variants.length === 0) {
    return null;
  }
  if (variants.length === 1) {
    return { url: variants[0].url };
  }

  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const v of variants) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=${v.width}x${v.height},NAME="${v.label}"`
    );
    lines.push(v.url);
  }

  const blob = new Blob([lines.join('\n') + '\n'], {
    type: 'application/vnd.apple.mpegurl'
  });
  const blobUrl = URL.createObjectURL(blob);
  return {
    url: blobUrl,
    revoke: () => URL.revokeObjectURL(blobUrl)
  };
}

export function resolvePlaybackSource(src?: string | null, sources?: HlsSources | null): ResolvedPlayback | null {
  const direct = src?.trim();
  if (direct) {
    if (/\.mp4(?:$|\?)/i.test(direct)) {
      return {
        mode: 'mp4',
        variants: [{ label: 'HD', height: 720, bitrate: 2_800_000, url: direct }]
      };
    }
    return { mode: 'hls', url: direct };
  }

  if (sources?.remux) {
    if (!sources.remux.needsRemux) {
      return {
        mode: 'mp4',
        variants: [
          {
            label: sources.remux.label || '1080p',
            height: 1080,
            bitrate: 15_000_000,
            url: `/torrent/stream/${encodeURIComponent(sources.remux.hash)}/${encodeURIComponent(String(sources.remux.fileIndex))}`
          }
        ]
      };
    }
    return { mode: 'remux', remux: sources.remux };
  }

  const hlsResolved = resolveHlsSource(null, sources);
  if (hlsResolved) {
    return { mode: 'hls', url: hlsResolved.url, revoke: hlsResolved.revoke };
  }

  const mp4Variants = normalizeMp4Sources(sources);
  if (mp4Variants.length > 0) {
    return { mode: 'mp4', variants: mp4Variants };
  }

  return null;
}

export function formatQualityLabel(height: number, bitrate?: number): string {
  if (height >= 2160) return '4K';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height > 0) return `${height}p`;
  if (bitrate && bitrate > 0) return `${Math.round(bitrate / 1000)}k`;
  return 'HD';
}
