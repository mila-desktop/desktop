<script module lang="ts">
  const MAX_BLUR_CACHE = 40;
  const blurredUrlCache = new Map<string, string>();
  const blurredInflight = new Map<string, Promise<string | null>>();

  function getCachedBlurredUrl(key: string): string | undefined {
    const hit = blurredUrlCache.get(key);
    if (!hit) return undefined;
    // Promote in LRU order
    blurredUrlCache.delete(key);
    blurredUrlCache.set(key, hit);
    return hit;
  }

  function setCachedBlurredUrl(key: string, blobUrl: string): void {
    const existing = blurredUrlCache.get(key);
    if (existing && existing !== blobUrl) {
      URL.revokeObjectURL(existing);
      blurredUrlCache.delete(key);
    }
    blurredUrlCache.set(key, blobUrl);
    while (blurredUrlCache.size > MAX_BLUR_CACHE) {
      const oldest = blurredUrlCache.entries().next();
      if (oldest.done) break;
      const [oldKey, oldUrl] = oldest.value;
      blurredUrlCache.delete(oldKey);
      URL.revokeObjectURL(oldUrl);
    }
  }

  async function bakeOffscreenBlur(src: string, blurPx: number): Promise<string | null> {
    if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Image === 'undefined') {
      return null;
    }
    const cacheKey = `${src}|${Math.round(blurPx)}`;
    const cached = getCachedBlurredUrl(cacheKey);
    if (cached) return cached;

    const pending = blurredInflight.get(cacheKey);
    if (pending) return pending;

    const job = (async (): Promise<string | null> => {
      try {
        // Cross-origin CDNs (Shikimori / AniLibria) omit Access-Control-Allow-Origin,
        // so only bake offscreen canvas for same-origin/blob/data assets and use lightweight CSS blur otherwise.
        const sameOrigin =
          src.startsWith('/') ||
          src.startsWith('data:') ||
          src.startsWith('blob:') ||
          src.startsWith(window.location.origin);
        if (!sameOrigin) {
          return null;
        }
        const img = new Image();
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('img load failed'));
          img.src = src;
        });

        const natW = img.naturalWidth || 96;
        const natH = img.naturalHeight || 96;
        const maxDim = 96;
        const ratio = Math.min(1, maxDim / Math.max(natW, natH));
        const w = Math.max(24, Math.round(natW * ratio));
        const h = Math.max(24, Math.round(natH * ratio));
        const scaledRadius = Math.max(1.5, Math.min(24, (blurPx * w) / Math.max(natW, 480)));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx || typeof ctx.filter !== 'string') return null;

        ctx.filter = `blur(${scaledRadius.toFixed(1)}px)`;
        // Overscan edges slightly so canvas blur does not darken borders
        const pad = Math.ceil(scaledRadius);
        ctx.drawImage(img, -pad, -pad, w + pad * 2, h + pad * 2);

        const blob = await new Promise<Blob | null>((resolve) => {
          if (typeof canvas.toBlob === 'function') {
            canvas.toBlob((b) => resolve(b), 'image/webp', 0.82);
          } else {
            resolve(null);
          }
        });
        if (!blob) return null;

        const blobUrl = URL.createObjectURL(blob);
        setCachedBlurredUrl(cacheKey, blobUrl);
        return blobUrl;
      } catch {
        return null;
      } finally {
        blurredInflight.delete(cacheKey);
      }
    })();

    blurredInflight.set(cacheKey, job);
    return job;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
    src?: string;
    blur?: number;
    opacity?: number;
    scale?: number;
    offsetY?: number;
    offsetX?: number;
    class?: string;
    style?: string;
  }

  let {
    children,
    src,
    blur = 40,
    opacity = 0.6,
    scale = 1.05,
    offsetY = 0,
    offsetX = 0,
    class: className = '',
    style = ''
  }: Props = $props();

  let bakedSrc = $state<string | null>(null);

  $effect(() => {
    const targetSrc = src?.trim() ?? '';
    const radius = blur;
    if (!targetSrc) {
      bakedSrc = null;
      return;
    }
    const immediate = getCachedBlurredUrl(`${targetSrc}|${Math.round(radius)}`);
    if (immediate) {
      bakedSrc = immediate;
      return;
    }
    bakedSrc = null;
    let cancelled = false;
    void bakeOffscreenBlur(targetSrc, radius).then((url) => {
      if (!cancelled && url) {
        bakedSrc = url;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const isBaked = $derived(Boolean(src && bakedSrc));
  // Fallback: downsample image blurs to 1/4 linear size (1/16th pixel area) and GPU-upscale back.
  const sampledBlur = $derived(src ? Math.max(2, Number((blur / 4).toFixed(2))) : blur);
  const sampledTransform = $derived(
    isBaked
      ? `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`
      : src
        ? `translate3d(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px), 0) scale(${Number((scale * 4).toFixed(3))})`
        : `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`
  );
  const displaySrc = $derived(bakedSrc || src);
</script>

{#if children}
  <div class="marlakit-layer-blur-wrapper {className}" {style}>
    <!-- Underlay blur -->
    <div
      class="layer-blur-underlay"
      class:is-downsampled={Boolean(src) && !isBaked}
      style="
        filter: {isBaked ? 'none' : `blur(${sampledBlur}px)`};
        -webkit-filter: {isBaked ? 'none' : `blur(${sampledBlur}px)`};
        opacity: {opacity};
        transform: {sampledTransform};
      "
      aria-hidden="true"
    >
      {#if src}
        <img src={displaySrc} alt="" class="blur-img" decoding="async" referrerpolicy="no-referrer" />
      {:else}
        {@render children()}
      {/if}
    </div>

    <!-- Foreground -->
    <div class="layer-blur-foreground">
      {@render children()}
    </div>
  </div>
{:else}
  <!-- Standalone blur layer -->
  <div
    class="marlakit-layer-blur-standalone {className}"
    class:is-downsampled={Boolean(src) && !isBaked}
    style="
      filter: {isBaked ? 'none' : `blur(${sampledBlur}px)`};
      -webkit-filter: {isBaked ? 'none' : `blur(${sampledBlur}px)`};
      opacity: {opacity};
      transform: {sampledTransform};
      {style}
    "
    aria-hidden="true"
  >
    {#if src}
      <img src={displaySrc} alt="" class="blur-img" decoding="async" referrerpolicy="no-referrer" />
    {/if}
  </div>
{/if}

<style>
  .marlakit-layer-blur-wrapper {
    position: relative;
    box-sizing: border-box;
    contain: layout style;
  }

  .layer-blur-underlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    user-select: none;
    z-index: 0;
    contain: layout style paint;
    backface-visibility: hidden;
  }

  .layer-blur-foreground {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
  }

  .marlakit-layer-blur-standalone {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    user-select: none;
    z-index: 0;
    contain: layout style paint;
    backface-visibility: hidden;
  }

  .layer-blur-underlay.is-downsampled,
  .marlakit-layer-blur-standalone.is-downsampled {
    inset: auto;
    top: 50%;
    left: 50%;
    width: 25%;
    height: 25%;
    transform-origin: center center;
  }

  .blur-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: inherit;
  }
</style>
