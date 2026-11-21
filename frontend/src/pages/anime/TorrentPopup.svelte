<script lang="ts">
  import { cubicOut } from 'svelte/easing';
  import { fade, scale } from 'svelte/transition';
  import { MorphIcon } from 'morphicons/svelte';
  import { Link2, Play, ChevronDown } from 'lucide';

  import LayerBlur from '../../marlakit/blur/LayerBlur.svelte';
  import Input from '../../marlakit/input/Input.svelte';
  import ScrollArea from '../../marlakit/scroll/ScrollArea.svelte';
  import ComboBox from '../../marlakit/combo/ComboBox.svelte';
  import { portal } from '../../marlakit/portal';
  import type { TorrentSearchItem } from '../../api/providers/torrent';
  import { settingsState } from '../../app/settings.svelte';

  interface Props {
    open: boolean;
    title: string;
    poster?: string;
    loading: boolean;
    error: string;
    results: TorrentSearchItem[];
    onclose: () => void;
    onselect: (itemOrMagnet: TorrentSearchItem | string) => void;
  }

  type SourceFilter = 'all' | 'nyaa' | 'anilibria' | 'rutor';
  type QualityFilter = 'all' | '2160p' | '1440p' | '1080p' | '720p' | '480p';
  type FormatFilter = 'all' | 'bdrip' | 'hevc' | 'avc' | 'dual' | 'rus';
  type SortMode = 'best' | 'seeds' | 'size-asc' | 'size-desc';

  let {
    open,
    title,
    poster = '',
    loading,
    error,
    results,
    onclose,
    onselect
  }: Props = $props();

  let customMagnet = $state('');
  let sourceFilter = $state<SourceFilter>('all');
  let qualityFilter = $state<QualityFilter>('all');
  let formatFilter = $state<FormatFilter>('all');
  let sortBy = $state<SortMode>('best');
  let activeMenu = $state<'quality' | 'format' | 'sort' | null>(null);

  const QUALITY_OPTIONS: Array<{ value: QualityFilter; label: string }> = [
    { value: 'all', label: 'All Quality' },
    { value: '2160p', label: '4K / 2160p' },
    { value: '1440p', label: '2K / 1440p' },
    { value: '1080p', label: '1080p' },
    { value: '720p', label: '720p' },
    { value: '480p', label: '480p' }
  ];

  const FORMAT_OPTIONS: Array<{ value: FormatFilter; label: string }> = [
    { value: 'all', label: 'All Formats' },
    { value: 'bdrip', label: 'BDRip / Blu-Ray' },
    { value: 'hevc', label: 'HEVC / x265' },
    { value: 'avc', label: 'AVC / x264' },
    { value: 'dual', label: 'Dual Audio' },
    { value: 'rus', label: 'RUS Dub' }
  ];

  const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
    { value: 'best', label: 'Sort: Best' },
    { value: 'seeds', label: 'Most Seeds' },
    { value: 'size-asc', label: 'Smallest Size' },
    { value: 'size-desc', label: 'Largest Size' }
  ];

  const trimmedMagnet = $derived(customMagnet.trim());
  const isValidMagnet = $derived(trimmedMagnet.startsWith('magnet:'));

  function detectQuality(tor: TorrentSearchItem): QualityFilter | '' {
    const text = `${tor.quality ?? ''} ${tor.title}`.toLowerCase();
    if (text.includes('2160') || text.includes('4k') || text.includes('uhd')) return '2160p';
    if (text.includes('1440') || text.includes('qhd') || /(?:^|[^a-z0-9])2k(?:[^a-z0-9]|$)/.test(text)) return '1440p';
    if (text.includes('1080')) return '1080p';
    if (text.includes('720')) return '720p';
    if (text.includes('480')) return '480p';
    return '';
  }

  function matchesFormat(tor: TorrentSearchItem, mode: FormatFilter): boolean {
    if (mode === 'all') return true;
    const text = `${tor.quality ?? ''} ${tor.title} ${tor.source}`.toLowerCase();
    switch (mode) {
      case 'bdrip':
        return text.includes('bdrip') || text.includes('bd-rip') || text.includes('blu-ray') || text.includes('bluray') || text.includes('bdremux');
      case 'hevc':
        return text.includes('hevc') || text.includes('x265') || text.includes('h265') || text.includes('h.265') || text.includes('10bit') || text.includes('10-bit');
      case 'avc':
        return text.includes('avc') || text.includes('x264') || text.includes('h264') || text.includes('h.264');
      case 'dual':
        return text.includes('dual') || text.includes('multi-audio') || text.includes('multiaudio');
      case 'rus': {
        const src = tor.source.toLowerCase();
        return (
          src === 'anilibria' ||
          src === 'rutor' ||
          text.includes('rus') ||
          text.includes('anilibria') ||
          text.includes('studioband') ||
          text.includes('dream cast') ||
          text.includes('russian') ||
          /[а-яё]/i.test(tor.title)
        );
      }
    }
  }

  function parseByteSize(raw: string): number {
    const m = String(raw || '').match(/([\d.]+)\s*(ti?b|gi?b|mi?b|ki?b|b)/i);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    if (!Number.isFinite(val)) return 0;
    const unit = m[2].toLowerCase();
    if (unit.startsWith('t')) return val * 1024 ** 4;
    if (unit.startsWith('g')) return val * 1024 ** 3;
    if (unit.startsWith('m')) return val * 1024 ** 2;
    if (unit.startsWith('k')) return val * 1024;
    return val;
  }

  const qualityLabel = $derived(
    QUALITY_OPTIONS.find((o) => o.value === qualityFilter)?.label ?? 'All Quality'
  );
  const formatLabel = $derived(
    FORMAT_OPTIONS.find((o) => o.value === formatFilter)?.label ?? 'All Formats'
  );
  const sortLabel = $derived(
    SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? 'Sort: Best'
  );

  const hasCustomFilters = $derived(
    sourceFilter !== 'all' || qualityFilter !== 'all' || formatFilter !== 'all' || sortBy !== 'best'
  );

  function resetFilters() {
    sourceFilter = 'all';
    qualityFilter = 'all';
    formatFilter = 'all';
    sortBy = 'best';
    activeMenu = null;
  }

  $effect(() => {
    if (open) {
      qualityFilter = settingsState.defaultTorrentQuality || 'all';
    } else {
      activeMenu = null;
    }
  });

  function scoreBestTorrent(item: TorrentSearchItem): number {
    let score = Math.min(item.seeders, 300);
    const qual = detectQuality(item);
    if (settingsState.preferHiResTorrents) {
      if (qual === '2160p') score += 450;
      else if (qual === '1440p') score += 320;
      else if (qual === '1080p') score += 160;
    }
    if (settingsState.preferRuTorrents) {
      const src = item.source.toLowerCase();
      const txt = `${item.title} ${item.quality ?? ''}`.toLowerCase();
      if (src === 'anilibria' || src === 'rutor' || /rus|dub|band|libria|дубляж|рут|[а-яё]/i.test(txt)) {
        score += 360;
      }
    }
    return score;
  }

  const filteredResults = $derived.by(() => {
    let base = results;
    if (sourceFilter !== 'all') {
      base = base.filter((item) => item.source.toLowerCase() === sourceFilter);
    }
    if (qualityFilter !== 'all') {
      base = base.filter((item) => detectQuality(item) === qualityFilter);
    }
    if (formatFilter !== 'all') {
      base = base.filter((item) => matchesFormat(item, formatFilter));
    }
    if (sortBy === 'best') {
      base = [...base].sort((a, b) => scoreBestTorrent(b) - scoreBestTorrent(a));
    } else if (sortBy === 'seeds') {
      base = [...base].sort((a, b) => b.seeders - a.seeders);
    } else if (sortBy === 'size-asc') {
      base = [...base].sort((a, b) => {
        const sa = parseByteSize(a.size) || Number.MAX_SAFE_INTEGER;
        const sb = parseByteSize(b.size) || Number.MAX_SAFE_INTEGER;
        return sa - sb;
      });
    } else if (sortBy === 'size-desc') {
      base = [...base].sort((a, b) => parseByteSize(b.size) - parseByteSize(a.size));
    }
    return base.slice(0, 50);
  });

  function formatSourceName(source: string): string {
    switch (source.toLowerCase()) {
      case 'anilibria':
        return 'AniLibria';
      case 'rutor':
        return 'RuTor';
      case 'torrentscsv':
        return 'Global';
      case 'knaben':
        return 'Knaben';
      default:
        return 'Nyaa';
    }
  }

  function formatMetaParts(tor: TorrentSearchItem): string[] {
    const parts: string[] = [formatSourceName(tor.source)];
    if (tor.quality) parts.push(tor.quality);
    if (tor.size) parts.push(tor.size);
    parts.push(`${tor.seeders} seeds`);
    return parts;
  }

  function handleMagnetSubmit(e: Event) {
    e.preventDefault();
    if (!isValidMagnet) return;
    const magnet = trimmedMagnet;
    customMagnet = '';
    onselect(magnet);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    use:portal
    class="torrent-backdrop"
    transition:fade={{ duration: 180, easing: cubicOut }}
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        onclose();
      }
    }}
  >
    <div
      class="torrent-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Torrents"
      transition:scale={{ start: 0.96, duration: 220, easing: cubicOut }}
    >
      {#if poster}
        <div class="torrent-ambient" aria-hidden="true">
          <LayerBlur src={poster} blur={64} opacity={0.28} scale={1.24} />
        </div>
      {/if}

      <div class="torrent-head">
        <div class="torrent-head-text">
          <h2 class="torrent-heading">Torrents</h2>
          {#if title}
            <span class="torrent-subtitle">{title}</span>
          {/if}
        </div>
        <button type="button" class="esc-chip" onclick={onclose}>Esc</button>
      </div>

      <form class="torrent-magnet-form" onsubmit={handleMagnetSubmit}>
        <Input
          bind:value={customMagnet}
          placeholder="Paste magnet:?xt=urn:btih:... or pick a release"
          class="torrent-magnet-input"
        >
          {#snippet icon()}
            <MorphIcon icon={Link2} size={15} strokeWidth={1.9} />
          {/snippet}
          {#snippet trailingIcon()}
            {#if isValidMagnet}
              <button type="submit" class="magnet-submit-chip">Stream</button>
            {/if}
          {/snippet}
        </Input>
      </form>

      <div class="torrent-toolbar">
        <div class="torrent-source-tabs" role="tablist" aria-label="Torrent source filter">
          <button
            type="button"
            role="tab"
            aria-selected={sourceFilter === 'all'}
            class="source-chip"
            class:active={sourceFilter === 'all'}
            onclick={() => { sourceFilter = 'all'; }}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceFilter === 'nyaa'}
            class="source-chip"
            class:active={sourceFilter === 'nyaa'}
            onclick={() => { sourceFilter = 'nyaa'; }}
          >
            Nyaa
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceFilter === 'anilibria'}
            class="source-chip"
            class:active={sourceFilter === 'anilibria'}
            onclick={() => { sourceFilter = 'anilibria'; }}
          >
            AniLibria
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceFilter === 'rutor'}
            class="source-chip"
            class:active={sourceFilter === 'rutor'}
            onclick={() => { sourceFilter = 'rutor'; }}
          >
            RuTor
          </button>
        </div>

        <div class="torrent-filters">
          <ComboBox
            open={activeMenu === 'quality'}
            value={qualityFilter}
            options={QUALITY_OPTIONS}
            label={qualityLabel}
            ariaLabel="Quality filter"
            placement="bottom-left"
            minWidth={138}
            ontoggle={(isOpen) => {
              activeMenu = isOpen ? 'quality' : activeMenu === 'quality' ? null : activeMenu;
            }}
            onselect={(opt) => {
              qualityFilter = opt.value as QualityFilter;
              activeMenu = null;
            }}
          >
            {#snippet trigger({ open, toggle, label })}
              <button
                type="button"
                class="filter-pill"
                class:is-open={open}
                class:is-active={qualityFilter !== 'all'}
                onclick={toggle}
              >
                <span>{label}</span>
                <MorphIcon icon={ChevronDown} size={12} strokeWidth={2} class="filter-chevron" />
              </button>
            {/snippet}
          </ComboBox>

          <ComboBox
            open={activeMenu === 'format'}
            value={formatFilter}
            options={FORMAT_OPTIONS}
            label={formatLabel}
            ariaLabel="Format filter"
            placement="bottom-left"
            minWidth={154}
            ontoggle={(isOpen) => {
              activeMenu = isOpen ? 'format' : activeMenu === 'format' ? null : activeMenu;
            }}
            onselect={(opt) => {
              formatFilter = opt.value as FormatFilter;
              activeMenu = null;
            }}
          >
            {#snippet trigger({ open, toggle, label })}
              <button
                type="button"
                class="filter-pill"
                class:is-open={open}
                class:is-active={formatFilter !== 'all'}
                onclick={toggle}
              >
                <span>{label}</span>
                <MorphIcon icon={ChevronDown} size={12} strokeWidth={2} class="filter-chevron" />
              </button>
            {/snippet}
          </ComboBox>

          <ComboBox
            open={activeMenu === 'sort'}
            value={sortBy}
            options={SORT_OPTIONS}
            label={sortLabel}
            ariaLabel="Sort releases"
            placement="bottom-right"
            minWidth={146}
            ontoggle={(isOpen) => {
              activeMenu = isOpen ? 'sort' : activeMenu === 'sort' ? null : activeMenu;
            }}
            onselect={(opt) => {
              sortBy = opt.value as SortMode;
              activeMenu = null;
            }}
          >
            {#snippet trigger({ open, toggle, label })}
              <button
                type="button"
                class="filter-pill"
                class:is-open={open}
                class:is-active={sortBy !== 'best'}
                onclick={toggle}
              >
                <span>{label}</span>
                <MorphIcon icon={ChevronDown} size={12} strokeWidth={2} class="filter-chevron" />
              </button>
            {/snippet}
          </ComboBox>

          {#if hasCustomFilters}
            <button type="button" class="filter-reset" onclick={resetFilters}>Reset</button>
          {/if}
        </div>

        {#if !loading && !error && filteredResults.length > 0}
          <span class="torrent-count">{filteredResults.length} releases</span>
        {/if}
      </div>

      <div class="torrent-body">
        {#if loading}
          <div class="torrent-skeletons" aria-hidden="true">
            {#each [0, 1, 2, 3] as idx (idx)}
              <div class="skeleton-row">
                <div class="skeleton-line title shimmer"></div>
                <div class="skeleton-line sub shimmer"></div>
              </div>
            {/each}
          </div>
        {:else if error}
          <div class="torrent-empty is-error">{error}</div>
        {:else if filteredResults.length === 0}
          <div class="torrent-empty">
            {#if hasCustomFilters && results.length > 0}
              No releases match these filters.
            {:else}
              No active seeded torrents found. Paste a magnet link above.
            {/if}
          </div>
        {:else}
          <ScrollArea maxHeight={340}>
            <div class="torrent-list">
              {#each filteredResults as tor (tor.infoHash)}
                {@const parts = formatMetaParts(tor)}
                <button
                  type="button"
                  class="torrent-row"
                  onclick={() => onselect(tor)}
                >
                  <div class="torrent-row-main">
                    <span class="torrent-row-title" title={tor.title}>{tor.title}</span>
                    <div class="torrent-row-meta">
                      {#each parts as part, idx (idx)}
                        {#if idx > 0}
                          <span class="meta-dot" aria-hidden="true"></span>
                        {/if}
                        <span class="meta-part">{part}</span>
                      {/each}
                    </div>
                  </div>
                  <span class="torrent-row-play" aria-hidden="true">
                    <MorphIcon icon={Play} size={14} fill="currentColor" strokeWidth={0} />
                  </span>
                </button>
              {/each}
            </div>
          </ScrollArea>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .torrent-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(5, 5, 7, 0.66);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .torrent-modal {
    position: relative;
    width: min(740px, 100%);
    max-height: calc(100vh - 40px);
    padding: clamp(16px, 2.2vw, 22px);
    border: none;
    border-radius: var(--radius-card, 16px);
    background: rgba(12, 12, 14, 0.96);
    box-shadow: 0 36px 100px rgba(0, 0, 0, 0.85);
    overflow: visible;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .torrent-ambient {
    position: absolute;
    inset: 0 0 auto 0;
    height: 190px;
    border-top-left-radius: inherit;
    border-top-right-radius: inherit;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
    -webkit-mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.9) 0%, transparent 100%);
    mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.9) 0%, transparent 100%);
  }

  .torrent-head,
  .torrent-magnet-form,
  .torrent-body {
    position: relative;
    z-index: 2;
  }

  .torrent-toolbar {
    position: relative;
    z-index: 20;
  }

  .torrent-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }

  .torrent-head-text {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }

  .torrent-heading {
    margin: 0;
    font-family: 'PP Monument Extended', system-ui, sans-serif;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: -0.01em;
    color: #ffffff;
    flex-shrink: 0;
  }

  .torrent-subtitle {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13.5px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.46);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .esc-chip {
    height: 24px;
    padding: 0 9px;
    border: none;
    outline: none;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.5);
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 11.5px;
    font-weight: 400;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s ease, background-color 0.15s ease;
  }

  .esc-chip:hover {
    color: var(--mila-text-primary, #ffffff);
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.14));
  }

  .torrent-magnet-form :global(.torrent-magnet-input) {
    width: 100%;
    height: 44px;
    border-radius: 12px;
    background: var(--mila-inputs-bg, rgba(255, 255, 255, 0.08));
  }

  .torrent-magnet-form :global(.torrent-magnet-input:focus-within) {
    background: var(--mila-inputs-bgFocus, rgba(255, 255, 255, 0.11));
  }

  .magnet-submit-chip {
    height: 26px;
    padding: 0 11px;
    border: none;
    outline: none;
    border-radius: 7px;
    background: var(--mila-accent-primary, #ffffff);
    color: var(--mila-text-onAccent, #0c0c0c);
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s ease, transform 0.1s ease;
  }

  .magnet-submit-chip:hover {
    opacity: 0.9;
  }

  .magnet-submit-chip:active {
    transform: scale(0.96);
  }

  .torrent-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px 12px;
  }

  .torrent-filters {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-right: auto;
  }

  .filter-pill {
    height: 30px;
    padding: 0 10px;
    border: none;
    outline: none;
    border-radius: 9px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.06));
    color: var(--mila-text-secondary, rgba(255, 255, 255, 0.72));
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 400;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    transition: background-color 0.16s var(--ease-out, ease), color 0.16s ease, transform 0.1s ease;
  }

  .filter-pill:hover,
  .filter-pill.is-open {
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.12));
    color: var(--mila-text-primary, #ffffff);
  }

  .filter-pill.is-active {
    background: var(--mila-accent-primary, #ffffff);
    color: var(--mila-text-onAccent, #0c0c0c);
  }

  .filter-pill :global(.filter-chevron) {
    opacity: 0.6;
    transition: transform 0.16s ease, opacity 0.16s ease;
  }

  .filter-pill.is-open :global(.filter-chevron) {
    transform: rotate(180deg);
    opacity: 0.95;
  }

  .filter-reset {
    height: 28px;
    padding: 0 9px;
    border: none;
    outline: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.56);
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 11.5px;
    font-weight: 400;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .filter-reset:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .torrent-source-tabs {
    display: inline-flex;
    align-items: center;
    gap: 0;
    height: 34px;
    padding: 0;
    border-radius: 10px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);
  }

  .source-chip {
    height: 34px;
    padding: 0 12px;
    border: none;
    outline: none;
    border-radius: 10px;
    background: transparent;
    color: rgba(255, 255, 255, 0.46);
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12.5px;
    font-weight: 400;
    cursor: pointer;
    transition: color 0.18s ease, background-color 0.18s ease;
  }

  .source-chip:hover {
    color: rgba(255, 255, 255, 0.84);
  }

  .source-chip.active {
    background: rgba(255, 255, 255, 0.11);
    color: #ffffff;
  }

  .torrent-count {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12.5px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.38);
    font-variant-numeric: tabular-nums;
  }

  .torrent-body {
    min-height: 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
  }

  .torrent-body :global(.marlakit-scroll-area),
  .torrent-body :global(.marlakit-scroll-viewport) {
    max-height: min(340px, calc(100vh - 250px)) !important;
  }

  .torrent-body :global(.marlakit-scroll-track) {
    top: 4px;
    bottom: 4px;
    right: 2px;
  }

  .torrent-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-right: 12px;
  }

  .torrent-row {
    width: 100%;
    padding: 12px 14px;
    border: none;
    outline: none;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.035);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.18s var(--ease-out, ease), transform 0.14s ease;
  }

  .torrent-row:hover {
    background: rgba(255, 255, 255, 0.085);
  }

  .torrent-row:active {
    transform: scale(0.992);
  }

  .torrent-row-main {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .torrent-row-title {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.25;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .torrent-row-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 400;
    line-height: 1;
    color: rgba(255, 255, 255, 0.48);
    font-variant-numeric: tabular-nums;
  }

  .meta-dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.28);
    flex-shrink: 0;
  }

  .torrent-row-play {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: scale(0.88);
    transition: opacity 0.18s ease, transform 0.18s ease, background-color 0.18s ease;
  }

  .torrent-row:hover .torrent-row-play {
    opacity: 1;
    transform: scale(1);
  }

  .torrent-skeletons {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-right: 10px;
  }

  .skeleton-row {
    height: 62px;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.035);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
  }

  .skeleton-line {
    border-radius: 6px;
  }

  .skeleton-line.title {
    width: 72%;
    height: 14px;
  }

  .skeleton-line.sub {
    width: 38%;
    height: 11px;
  }

  .shimmer {
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.1) 50%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: torrentShimmer 1.3s ease-in-out infinite;
  }

  @keyframes torrentShimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  .torrent-empty {
    padding: 36px 16px;
    text-align: center;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 14px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.48);
  }

  .torrent-empty.is-error {
    color: #f87171;
  }
</style>
