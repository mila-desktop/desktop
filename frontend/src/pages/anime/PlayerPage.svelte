<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { MorphIcon } from 'morphicons/svelte';
  import {
    ArrowLeft,
    ArrowUp,
    ArrowDown,
    Clock,
    EyeOff,
    LayoutGrid,
    LayoutList,
    ListOrdered,
    PictureInPicture2,
    RefreshCw,
    HardDriveDownload
  } from 'lucide';

  import MainButton from '../../marlakit/button/MainButton.svelte';
  import SecondButton from '../../marlakit/button/SecondButton.svelte';
  import EpisodeThumb from './EpisodeThumb.svelte';
  import TorrentPopup from './TorrentPopup.svelte';
  import type { TorrentSearchItem } from '../../api/providers/torrent';
  import { episodeProgressMap, getEpisodeProgress } from '../../app/history.svelte';
  import { goBack } from '../../app/router.svelte';
  import {
    expandCustomPip,
    openTorrentStream,
    player,
    retryWatch,
    selectEpisode,
    setInlinePlayerStage
  } from '../../app/player.svelte';
  import { t } from '../../app/i18n.svelte';
  import { setSettingPref, settingsState } from '../../app/settings.svelte';

  const EP_PAGE_SIZE = 16;
  const EP_VIEW_MODE_KEY = 'mila.anime.episodesViewMode';

  type EpSortKey = 'order' | 'duration' | 'unwatched';

  function readSavedViewMode(key: string, fallback: 'grid' | 'list'): 'grid' | 'list' {
    if (typeof localStorage === 'undefined') return fallback;
    return localStorage.getItem(key) === 'list' ? 'list' : 'grid';
  }

  let viewportW = $state(typeof window !== 'undefined' ? window.innerWidth : 1440);
  let playerSectionEl = $state<HTMLElement | null>(null);
  let inlineStageEl = $state<HTMLDivElement | null>(null);

  let epViewMode = $state<'grid' | 'list'>(settingsState.episodesView || readSavedViewMode(EP_VIEW_MODE_KEY, 'grid'));
  $effect(() => {
    epViewMode = settingsState.episodesView;
  });
  let epSortBy = $state<EpSortKey>('order');
  let epSortDir = $state<'asc' | 'desc'>('asc');
  let epRangeIndex = $state(0);

  let torrentsOpen = $state(false);
  let torrentsLoading = $state(false);
  let torrentsError = $state('');
  let torrentResults = $state<TorrentSearchItem[]>([]);
  let torrentResultsFor = $state('');
  let torrentReqToken = 0;

  const currentShikiId = $derived(player.shikiArt?.id ?? player.target?.shikiId ?? 0);

  const displayTitle = $derived(
    player.shikiArt?.english || player.shikiArt?.name || player.release?.title || player.title || 'Anime'
  );

  const posterUrl = $derived(
    player.shikiArt?.posterOriginal ||
      player.shikiArt?.posterMain ||
      player.release?.poster ||
      ''
  );

  const backdropUrl = $derived(
    player.shikiArt?.screenshots[0] ||
      player.release?.banner ||
      posterUrl
  );

  const galleryShots = $derived((player.shikiArt?.screenshots ?? []).slice(0, 6));
  const episodes = $derived(player.release?.episodes ?? []);
  const currentEpisode = $derived(episodes[player.episodeIndex] ?? null);

  $effect(() => {
    setInlinePlayerStage(inlineStageEl);
    return () => {
      setInlinePlayerStage(null);
    };
  });

  function gridCornerFlags(index: number, total: number, cols: number) {
    if (total <= 0) {
      return { tl: false, tr: false, bl: false, br: false };
    }
    const safeCols = Math.max(1, cols);
    const col = index % safeCols;
    const row = Math.floor(index / safeCols);
    const lastRow = Math.floor((total - 1) / safeCols);
    return {
      tl: index === 0,
      tr: index === Math.min(safeCols - 1, total - 1),
      bl: row === lastRow && col === 0,
      br: index === total - 1
    };
  }

  const epCols = $derived(viewportW <= 960 ? 2 : viewportW <= 1220 ? 3 : 4);

  const sortedEpisodes = $derived.by(() => {
    const dir = epSortDir === 'asc' ? 1 : -1;
    const list = episodes.map((ep, idx) => ({ ep, idx }));
    if (epSortBy === 'order' && epSortDir === 'asc') {
      return list;
    }
    if (epSortBy === 'unwatched') {
      episodeProgressMap.items;
      return [...list].sort((a, b) => {
        const wa = getEpProgressInfo(a.idx, a.ep.ordinal).watched ? 1 : 0;
        const wb = getEpProgressInfo(b.idx, b.ep.ordinal).watched ? 1 : 0;
        if (wa !== wb) return (wa - wb) * dir;
        return a.ep.ordinal - b.ep.ordinal;
      });
    }
    if (epSortBy === 'duration') {
      return [...list].sort((a, b) => {
        const da = a.ep.duration || 0;
        const db = b.ep.duration || 0;
        if (da !== db) return (da - db) * dir;
        return a.ep.ordinal - b.ep.ordinal;
      });
    }
    return [...list].sort((a, b) => (a.ep.ordinal - b.ep.ordinal) * dir);
  });

  const episodeRanges = $derived.by(() => {
    if (sortedEpisodes.length <= EP_PAGE_SIZE) return [];
    const ranges: Array<{ label: string; start: number; end: number }> = [];
    for (let start = 0; start < sortedEpisodes.length; start += EP_PAGE_SIZE) {
      const end = Math.min(start + EP_PAGE_SIZE, sortedEpisodes.length);
      if (epSortBy === 'order' && epSortDir === 'asc') {
        const firstOrd = sortedEpisodes[start]?.ep.ordinal ?? start + 1;
        const lastOrd = sortedEpisodes[end - 1]?.ep.ordinal ?? end;
        ranges.push({ label: `${firstOrd}–${lastOrd}`, start, end });
      } else {
        ranges.push({ label: `${start + 1}–${end}`, start, end });
      }
    }
    return ranges;
  });

  const visibleEpisodes = $derived.by(() => {
    if (episodeRanges.length === 0) {
      return sortedEpisodes;
    }
    const range = episodeRanges[epRangeIndex] ?? episodeRanges[0];
    return sortedEpisodes.slice(range.start, range.end);
  });

  const episodeFallbackImages = $derived.by(() => {
    const out: string[] = [];
    for (const url of [...galleryShots, backdropUrl, posterUrl]) {
      const clean = url?.trim();
      if (clean && !out.includes(clean)) {
        out.push(clean);
      }
    }
    return out;
  });

  $effect(() => {
    if (episodes.length > EP_PAGE_SIZE) {
      epRangeIndex = Math.floor(player.episodeIndex / EP_PAGE_SIZE);
    } else {
      epRangeIndex = 0;
    }
  });

  $effect(() => {
    void currentShikiId;
    void player.target?.releaseAlias;
    torrentReqToken += 1;
    torrentsLoading = false;
    torrentsOpen = false;
    torrentResults = [];
    torrentResultsFor = '';
    torrentsError = '';
    epSortBy = 'order';
    epSortDir = 'asc';
    epRangeIndex = 0;
  });

  onDestroy(() => {
    torrentReqToken += 1;
    torrentResults = [];
  });

  function toggleEpSort(key: EpSortKey) {
    if (epSortBy === key) {
      epSortDir = epSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      epSortBy = key;
      epSortDir = 'asc';
    }
    epRangeIndex = 0;
  }

  function setEpisodeViewMode(mode: 'grid' | 'list') {
    if (epViewMode === mode) return;
    epViewMode = mode;
    setSettingPref('episodesView', mode, EP_VIEW_MODE_KEY);
  }

  function getEpProgressInfo(epIdx: number, ordinal: number) {
    episodeProgressMap.items;
    const ep = episodes[epIdx];
    const entry = getEpisodeProgress(
      {
        shikiId: currentShikiId || undefined,
        releaseAlias: player.release?.alias ?? player.target?.releaseAlias,
        title: displayTitle
      },
      ordinal
    );
    if (!entry) return { ratio: 0, watched: false, currentTime: 0 };
    const dur = entry.duration > 0 ? entry.duration : ep?.duration ?? 0;
    const ratio = dur > 0 ? Math.min(1, Math.max(0, entry.currentTime / dur)) : 0;
    return {
      ratio: entry.watched && ratio < 0.85 ? 1 : ratio,
      watched: entry.watched || ratio >= 0.85,
      currentTime: entry.currentTime
    };
  }

  function scrollToPlayer() {
    playerSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleChooseEpisode(index: number) {
    selectEpisode(index);
    scrollToPlayer();
  }

  async function toggleTorrentsDrawer() {
    torrentsOpen = !torrentsOpen;
    if (!torrentsOpen) {
      torrentReqToken += 1;
      torrentsLoading = false;
      return;
    }
    const key = `${player.shikiArt?.id ?? 0}:${displayTitle}`;
    if (torrentResultsFor === key && torrentResults.length > 0) return;

    const reqToken = ++torrentReqToken;
    torrentsLoading = true;
    torrentsError = '';
    try {
      const q = (player.shikiArt?.english || player.shikiArt?.name || displayTitle || '').trim();
      const libId = player.release?.provider === 'aniliberty' ? player.release.id : 0;
      const { searchTorrents } = await import('../../api/providers/torrent');
      const items = await searchTorrents(q, libId);
      if (reqToken !== torrentReqToken) return;
      torrentResults = items;
      torrentResultsFor = key;
    } catch (err) {
      if (reqToken !== torrentReqToken) return;
      torrentsError = err instanceof Error ? err.message : 'Failed to search torrents';
    } finally {
      if (reqToken === torrentReqToken) {
        torrentsLoading = false;
      }
    }
  }

  async function handleLaunchTorrent(item: TorrentSearchItem | string) {
    torrentsOpen = false;
    await openTorrentStream(item);
    scrollToPlayer();
  }
</script>

<svelte:window bind:innerWidth={viewportW} />

<div class="player-page">
  <section
    class="player-section"
    bind:this={playerSectionEl}
    aria-label="Video player"
  >
    <div class="player-frame-wrap">
      <div class="player-stage">
        <div class="player-top-drag" aria-hidden="true"></div>

        {#if player.loading}
          <div class="stage-state" role="status" aria-label={t('anime.loading')} transition:fade={{ duration: 180 }}>
            <div class="spinner" aria-hidden="true"></div>
          </div>
        {:else if player.error}
          <div class="stage-state stage-error">
            <p class="error-text">{player.error}</p>
            <MainButton onclick={retryWatch}>
              {#snippet icon()}
                <MorphIcon icon={RefreshCw} size={15} strokeWidth={2} />
              {/snippet}
              {t('anime.retry')}
            </MainButton>
          </div>
        {:else if currentEpisode}
          <div
            class="player-inline-slot"
            class:is-hidden={player.pipMode && !player.pipDismissed}
            bind:this={inlineStageEl}
          ></div>
          {#if player.pipMode && !player.pipDismissed}
            <div class="stage-state" transition:fade={{ duration: 180 }}>
              <span>Playing in Picture-in-Picture</span>
              <SecondButton onclick={expandCustomPip}>
                {#snippet icon()}
                  <MorphIcon icon={PictureInPicture2} size={15} strokeWidth={2} />
                {/snippet}
                Return to player
              </SecondButton>
            </div>
          {/if}
        {:else}
          <div class="stage-state">
            <span>Select a title with Watch to begin playback.</span>
          </div>
        {/if}
      </div>
    </div>
  </section>

  <div class="player-body">
    {#if episodes.length > 0}
      <section class="episodes-section" aria-label="Episodes">
        <div class="section-head">
          <div class="section-head-left">
            <button
              type="button"
              class="episodes-back-btn"
              onclick={goBack}
              aria-label={t('anime.back')}
              title={t('anime.back')}
            >
              <MorphIcon icon={ArrowLeft} size={18} strokeWidth={2} />
            </button>
            <h2 class="section-heading">{t('anime.episodes')}</h2>
            <span class="section-count">{episodes.length}</span>
          </div>

          <div class="range-tabs" role="tablist" aria-label="Episode controls">
            {#if episodeRanges.length > 1}
              {#each episodeRanges as range, i (range.label)}
                <button
                  type="button"
                  class="range-pill"
                  class:is-active={epRangeIndex === i}
                  onclick={() => { epRangeIndex = i; }}
                >
                  {range.label}
                </button>
              {/each}
            {/if}

            <div class="lib-sort-group" role="group" aria-label="Sort episodes">
              <button
                type="button"
                class="sort-chip-btn"
                class:active={epSortBy === 'order'}
                aria-label="Order"
                title="Order"
                onclick={() => toggleEpSort('order')}
              >
                <MorphIcon icon={ListOrdered} size={14} strokeWidth={1.85} />
                {#if epSortBy === 'order'}
                  <MorphIcon
                    icon={epSortDir === 'asc' ? ArrowUp : ArrowDown}
                    size={11}
                    strokeWidth={2.2}
                    spring="snappy"
                  />
                {/if}
              </button>
              <button
                type="button"
                class="sort-chip-btn"
                class:active={epSortBy === 'duration'}
                aria-label="Duration"
                title="Duration"
                onclick={() => toggleEpSort('duration')}
              >
                <MorphIcon icon={Clock} size={14} strokeWidth={1.85} />
                {#if epSortBy === 'duration'}
                  <MorphIcon
                    icon={epSortDir === 'asc' ? ArrowUp : ArrowDown}
                    size={11}
                    strokeWidth={2.2}
                    spring="snappy"
                  />
                {/if}
              </button>
              <button
                type="button"
                class="sort-chip-btn"
                class:active={epSortBy === 'unwatched'}
                aria-label="Unwatched"
                title="Unwatched"
                onclick={() => toggleEpSort('unwatched')}
              >
                <MorphIcon icon={EyeOff} size={14} strokeWidth={1.85} />
                {#if epSortBy === 'unwatched'}
                  <MorphIcon
                    icon={epSortDir === 'asc' ? ArrowUp : ArrowDown}
                    size={11}
                    strokeWidth={2.2}
                    spring="snappy"
                  />
                {/if}
              </button>
            </div>

            <button
              type="button"
              class="range-pill torrent-toggle-pill"
              class:is-active={torrentsOpen || player.release?.provider === 'torrent'}
              onclick={() => void toggleTorrentsDrawer()}
            >
              <MorphIcon icon={HardDriveDownload} size={14} strokeWidth={1.9} />
              <span>Torrents</span>
            </button>

            <div class="ep-view-modes" class:is-grid={epViewMode === 'grid'} role="group" aria-label="Episodes layout">
              <div class="ep-view-pill" aria-hidden="true"></div>
              <button
                type="button"
                class="ep-view-btn"
                class:active={epViewMode === 'list'}
                aria-label="List view"
                aria-pressed={epViewMode === 'list'}
                onclick={() => setEpisodeViewMode('list')}
              >
                <MorphIcon icon={LayoutList} size={17} strokeWidth={1.7} />
              </button>
              <button
                type="button"
                class="ep-view-btn"
                class:active={epViewMode === 'grid'}
                aria-label="Grid view"
                aria-pressed={epViewMode === 'grid'}
                onclick={() => setEpisodeViewMode('grid')}
              >
                <MorphIcon icon={LayoutGrid} size={17} strokeWidth={1.7} />
              </button>
            </div>
          </div>
        </div>

        {#if epViewMode === 'grid'}
          <div class="episodes-grid" in:fade={{ duration: 180, easing: cubicOut }}>
            {#each visibleEpisodes as entry, i (entry.ep.id)}
              {@const epProg = getEpProgressInfo(entry.idx, entry.ep.ordinal)}
              {@const corners = gridCornerFlags(i, visibleEpisodes.length, epCols)}
              <EpisodeThumb
                episode={entry.ep}
                index={entry.idx}
                variant="grid"
                isCurrent={entry.idx === player.episodeIndex}
                isWatched={epProg.watched}
                progressRatio={epProg.ratio}
                cornerTL={corners.tl}
                cornerTR={corners.tr}
                cornerBL={corners.bl}
                cornerBR={corners.br}
                fallbackImages={episodeFallbackImages}
                onchoose={() => handleChooseEpisode(entry.idx)}
              />
            {/each}
          </div>
        {:else}
          <div class="episodes-list" in:fade={{ duration: 180, easing: cubicOut }}>
            {#each visibleEpisodes as entry (entry.ep.id)}
              {@const epProg = getEpProgressInfo(entry.idx, entry.ep.ordinal)}
              <EpisodeThumb
                episode={entry.ep}
                index={entry.idx}
                variant="list"
                isCurrent={entry.idx === player.episodeIndex}
                isWatched={epProg.watched}
                progressRatio={epProg.ratio}
                cornerTL={true}
                cornerBL={true}
                fallbackImages={episodeFallbackImages}
                onchoose={() => handleChooseEpisode(entry.idx)}
              />
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</div>

<TorrentPopup
  open={torrentsOpen}
  title={displayTitle}
  poster={posterUrl}
  loading={torrentsLoading}
  error={torrentsError}
  results={torrentResults}
  onclose={() => { torrentsOpen = false; }}
  onselect={(item) => void handleLaunchTorrent(item)}
/>

<style>
  .player-page {
    width: 100%;
    min-height: 100%;
    padding: 0;
    margin: 0;
    background: var(--mila-app-canvas, #0c0c0c);
    color: var(--mila-text-primary, #ffffff);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }

  .player-section {
    position: relative;
    width: 100%;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  .player-frame-wrap {
    position: relative;
    width: 100%;
  }

  .player-stage {
    position: relative;
    z-index: 1;
    width: 100%;
    aspect-ratio: 16 / 9;
    max-height: min(82vh, 56.25vw);
    border-radius: 0;
    clip-path: inset(0);
    overflow: hidden;
    background: #070709;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .player-top-drag {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 22px;
    z-index: 12;
    --wails-draggable: drag;
  }

  .episodes-back-btn {
    width: 30px;
    height: 30px;
    padding: 0;
    margin: 0 2px 0 -4px;
    border: none;
    outline: none;
    border-radius: 8px;
    background: transparent;
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.48));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      color 0.2s var(--ease-out),
      transform 0.2s var(--ease-out);
  }

  .episodes-back-btn:hover {
    color: var(--mila-text-primary, #ffffff);
    transform: translateX(-2px);
  }

  .episodes-back-btn:active {
    transform: translateX(-3px) scale(0.94);
  }

  :global(body.is-player-fullscreen) .player-top-drag {
    opacity: 0;
    pointer-events: none;
  }

  .player-stage :global(.hls-player) {
    border-radius: 0;
  }

  .player-inline-slot {
    width: 100%;
    height: 100%;
  }

  .player-inline-slot.is-hidden {
    display: none;
  }

  .player-body {
    padding: clamp(16px, 2vw, 22px) var(--page-pad-x) var(--page-pad-x) var(--page-pad-x);
    display: flex;
    flex-direction: column;
    gap: clamp(24px, 2.8vw, 32px);
  }

  .stage-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 24px;
    text-align: center;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 15px;
    color: rgba(255, 255, 255, 0.6);
  }

  .error-text {
    margin: 0;
    color: #f87171;
  }

  .spinner {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 2.5px solid rgba(255, 255, 255, 0.14);
    border-top-color: #ffffff;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }

  .section-head-left {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .section-heading {
    margin: 0;
    font-family: 'PP Monument Extended', system-ui, sans-serif;
    font-size: clamp(20px, 2vw, 24px);
    font-weight: 900;
    color: var(--mila-text-heading, #e4e4e7);
    letter-spacing: -0.01em;
  }

  .section-count {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 14px;
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.42));
  }

  .range-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .range-pill {
    height: 36px;
    padding: 0 13px;
    border: none;
    outline: none;
    border-radius: 11px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.04));
    color: var(--mila-text-secondary, rgba(255, 255, 255, 0.72));
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.18s var(--ease-out), color 0.18s var(--ease-out);
  }

  .range-pill:hover {
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.12));
    color: var(--mila-text-primary, #ffffff);
  }

  .range-pill.is-active {
    background: var(--mila-app-surfaceActive, rgba(255, 255, 255, 0.16));
    color: var(--mila-accent-highlight, #ffffff);
    font-weight: 500;
  }

  .torrent-toggle-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .lib-sort-group {
    display: inline-flex;
    align-items: center;
    gap: 0;
    height: 34px;
    padding: 0;
    border-radius: 10px;
    overflow: hidden;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.04));
    box-sizing: border-box;
  }

  .sort-chip-btn {
    height: 34px;
    min-width: 34px;
    padding: 0 9px;
    border: none;
    outline: none;
    border-radius: 10px;
    background: transparent;
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.44));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s var(--ease-out), color 0.2s var(--ease-out);
    white-space: nowrap;
  }

  .sort-chip-btn:hover {
    color: var(--mila-text-secondary, rgba(255, 255, 255, 0.8));
  }

  .sort-chip-btn.active {
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.1));
    color: var(--mila-accent-highlight, #ffffff);
  }

  .ep-view-modes {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0;
    height: 34px;
    padding: 0;
    border-radius: 10px;
    overflow: hidden;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.04));
    box-sizing: border-box;
  }

  .ep-view-pill {
    position: absolute;
    top: 0;
    left: 0;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.1));
    pointer-events: none;
    transition: transform 0.32s var(--ease-out);
  }

  .ep-view-modes.is-grid .ep-view-pill {
    transform: translate3d(34px, 0, 0);
  }

  .ep-view-btn {
    position: relative;
    z-index: 1;
    width: 34px;
    height: 34px;
    padding: 0;
    border: none;
    outline: none;
    border-radius: 10px;
    background: transparent;
    color: var(--mila-text-dim, rgba(255, 255, 255, 0.42));
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color 0.2s var(--ease-out);
  }

  .ep-view-btn:hover {
    color: var(--mila-text-secondary, rgba(255, 255, 255, 0.8));
  }

  .ep-view-btn.active {
    color: var(--mila-accent-highlight, #ffffff);
  }

  .episodes-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
  }

  @media (max-width: 1220px) {
    .episodes-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 960px) {
    .episodes-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .episodes-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
