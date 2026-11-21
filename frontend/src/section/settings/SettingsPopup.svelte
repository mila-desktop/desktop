<script lang="ts">
  import { cubicOut } from 'svelte/easing';
  import { fade, scale, type TransitionConfig } from 'svelte/transition';
  import {
    AudioLines,
    Cpu,
    Database,
    FastForward,
    HardDriveDownload,
    Info,
    Keyboard,
    Maximize2,
    Palette,
    Play,
    RotateCcw,
    Search,
    SlidersHorizontal,
    Subtitles,
    Users,
    Volume2,
    Monitor
  } from 'lucide';
  import { MorphIcon } from 'morphicons/svelte';

  import GitButton from '../../marlakit/button/GitButton.svelte';
  import KeybindButton from '../../marlakit/keybind/KeybindButton.svelte';
  import SidebarItem from '../../marlakit/nav/SidebarItem.svelte';
  import ScrollArea from '../../marlakit/scroll/ScrollArea.svelte';
  import SecondButton from '../../marlakit/button/SecondButton.svelte';
  import SegmentedControl from '../../marlakit/segmented/SegmentedControl.svelte';
  import RgbLine from '../../marlakit/slider/RgbLine.svelte';
  import Slider from '../../marlakit/slider/Slider.svelte';
  import Toggle from '../../marlakit/toggle/Toggle.svelte';
  import { portal } from '../../marlakit/portal';

  import { exportDiagnosticLogs } from '../../api/bridge';
  import {
    bindings,
    getWailsMilaBindings,
    invokeCheckAndInstallUpdate,
    invokeGetUpdateStatus,
    subscribeAppUpdateStatus,
    type AppUpdateStatus
  } from '../../app/bindings.svelte';
  import { clearWatchHistory, watchHistory } from '../../app/history.svelte';
  import { i18n, setLocale, t, type LocaleCode } from '../../app/i18n.svelte';
  import { player, setPipCorner, type PipCorner } from '../../app/player.svelte';
  import {
    clearAppCache,
    closeSettingsPopup,
    getCacheStats,
    resetAllShortcuts,
    resetAllSystemSettings,
    setSettingPref,
    setShortcutBinding,
    settingsState,
    type CardRadiusPref,
    type DefaultTorQualityPref,
    type EpisodesViewPref,
    type QualityPref,
    type SettingsSectionId,
    type ShortcutActionId,
    type StartupPagePref,
    type StreamProviderPref,
    type TorrentRemuxMode
  } from '../../app/settings.svelte';
  import { setCustomHue, setThemeMode, theme, type ThemeMode } from '../../app/theme.svelte';

  function tabRevealBlur(
    _node: Element,
    params?: { duration?: number; blur?: number; y?: number }
  ): TransitionConfig {
    const duration = settingsState.reducedMotion ? 0 : (params?.duration ?? 220);
    const maxBlur = params?.blur ?? 8;
    const dy = params?.y ?? 6;
    return {
      duration,
      easing: cubicOut,
      css: (progress) => {
        const inv = 1 - progress;
        const blur = (inv * maxBlur).toFixed(2);
        const y = (inv * dy).toFixed(2);
        return `opacity: ${progress}; filter: blur(${blur}px); transform: translate3d(0, ${y}px, 0);`;
      }
    };
  }

  let shortcutTab = $state<'all' | 'player' | 'app'>('all');
  let cacheStats = $state(getCacheStats());
  let cacheFeedback = $state('');
  let historyFeedback = $state('');
  let resetFeedback = $state('');
  let exportFeedback = $state('');
  let appVersion = $state('dev');
  let updateChecking = $state(false);
  let updateProgress = $state<number | null>(null);

  const navGroups = $derived([
    {
      id: 'interface',
      label: 'Interface',
      items: [{ id: 'appearance' as SettingsSectionId, label: 'Appearance', icon: Palette }]
    },
    {
      id: 'player',
      label: 'Player',
      items: [
        { id: 'playback' as SettingsSectionId, label: 'Playback Engine', icon: Play },
        { id: 'audioSubs' as SettingsSectionId, label: 'Audio & Subtitles', icon: AudioLines },
        { id: 'shortcuts' as SettingsSectionId, label: 'Shortcuts', icon: Keyboard }
      ]
    },
    {
      id: 'network',
      label: 'Sync & Torrents',
      items: [
        { id: 'watchTogether' as SettingsSectionId, label: 'Watch Together', icon: Users },
        { id: 'torrents' as SettingsSectionId, label: 'Torrents & Stream', icon: HardDriveDownload }
      ]
    },
    {
      id: 'system',
      label: 'System',
      items: [
        { id: 'windowPerf' as SettingsSectionId, label: 'Window & Behavior', icon: Monitor },
        { id: 'storage' as SettingsSectionId, label: 'Cache & Storage', icon: Database },
        { id: 'about' as SettingsSectionId, label: 'About', icon: Info }
      ]
    }
  ]);

  const activeSectionMeta = $derived.by(() => {
    switch (settingsState.section) {
      case 'appearance':
        return {
          title: 'Appearance',
          sub: 'Theme palette, accent hue, frosted blur, geometry corners and motion behavior.'
        };
      case 'audioSubs':
        return {
          title: 'Audio & Subtitles',
          sub: 'Master volume, brightness filter, subtitle scaling, audio track routing and OSD.'
        };
      case 'shortcuts':
        return {
          title: 'Shortcuts',
          sub: 'Click any keycap to rebind live player, window and search keyboard shortcuts.'
        };
      case 'watchTogether':
        return {
          title: 'Watch Together',
          sub: 'Rave-style adaptive sync tolerances, hard-seek limits and room chat layout.'
        };
      case 'torrents':
        return {
          title: 'Torrents & Stream',
          sub: 'FFmpeg remux pipeline, 2K/4K resolution priority, filters and episode prefetching.'
        };
      case 'windowPerf':
        return {
          title: 'Window & Behavior',
          sub: 'Startup landing route, Mini Picture-in-Picture triggers and screen anchor.'
        };
      case 'storage':
        return {
          title: 'Cache & Storage',
          sub: 'Inspect local metadata cache, clear watch history and export diagnostic archives.'
        };
      case 'about':
        return {
          title: 'About',
          sub: 'Application build details, streaming runtime stack and GitHub releases.'
        };
      default:
        return {
          title: 'Playback Engine',
          sub: 'Preferred anime source, default speed, seek jumps, HLS buffer and automation.'
        };
    }
  });

  const themeModeOptions = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'custom', label: 'Accent' }
  ];

  const localeOptions = [
    { value: 'en', label: 'EN' },
    { value: 'ru', label: 'RU' },
    { value: 'uk', label: 'UK' },
    { value: 'zh', label: 'ZH' }
  ];

  const radiusOptions = [
    { value: 'sharp', label: 'Sharp 8px' },
    { value: 'default', label: 'Default 16px' },
    { value: 'round', label: 'Round 22px' }
  ];

  const episodesViewOptions = [
    { value: 'grid', label: 'Grid' },
    { value: 'list', label: 'List' }
  ];

  const qualityOptions = [
    { value: '1080p', label: '1080p' },
    { value: '720p', label: '720p' },
    { value: 'auto', label: 'Auto' }
  ];

  const providerOptions = [
    { value: 'auto', label: 'Auto' },
    { value: 'aniliberty', label: 'AniLibria' },
    { value: 'dreamcast', label: 'DreamCast' },
    { value: 'animego', label: 'AnimeGO' },
    { value: 'kodik', label: 'Kodik' }
  ];

  const speedOptions = [
    { value: 0.5, label: '0.5x' },
    { value: 0.75, label: '0.75x' },
    { value: 1, label: '1x' },
    { value: 1.25, label: '1.25x' },
    { value: 1.5, label: '1.5x' },
    { value: 2, label: '2x' }
  ];

  const seekStepOptions = [
    { value: 5, label: '5s' },
    { value: 10, label: '10s' },
    { value: 15, label: '15s' },
    { value: 30, label: '30s' }
  ];

  const holdBoostOptions = [
    { value: 1.5, label: '1.5x' },
    { value: 2, label: '2x' },
    { value: 2.5, label: '2.5x' }
  ];

  const bufferOptions = [
    { value: 15, label: '15s' },
    { value: 30, label: '30s' },
    { value: 60, label: '60s' }
  ];

  const volumeStepOptions = [
    { value: 2, label: '2%' },
    { value: 5, label: '5%' },
    { value: 10, label: '10%' }
  ];

  const subScaleOptions = [
    { value: 85, label: '85%' },
    { value: 100, label: '100%' },
    { value: 120, label: '120%' },
    { value: 140, label: '140%' }
  ];

  const audioPriorityOptions = [
    { value: 'ru', label: 'Russian' },
    { value: 'orig', label: 'Original' },
    { value: 'first', label: 'First' }
  ];

  const driftOptions = [
    { value: 0.25, label: '0.25s' },
    { value: 0.45, label: '0.45s' },
    { value: 1.0, label: '1.0s' }
  ];

  const catchupRateOptions = [
    { value: 1.2, label: '1.2x' },
    { value: 1.35, label: '1.35x' },
    { value: 1.5, label: '1.5x' }
  ];

  const hardSeekOptions = [
    { value: 15, label: '15s' },
    { value: 30, label: '30s' },
    { value: 60, label: '60s' }
  ];

  const wtChatOptions = [
    { value: 'floating', label: 'Floating' },
    { value: 'split', label: 'Split' }
  ];

  const remuxOptions = [
    { value: 'auto', label: 'Auto' },
    { value: 'always', label: 'Always' },
    { value: 'direct', label: 'Direct' }
  ];

  const defaultTorQualityOptions = [
    { value: 'all', label: 'All' },
    { value: '2160p', label: '2160p' },
    { value: '1440p', label: '1440p' },
    { value: '1080p', label: '1080p' }
  ];

  const pipCornerOptions = [
    { value: 'top-left', label: 'Top-L' },
    { value: 'top-right', label: 'Top-R' },
    { value: 'bottom-left', label: 'Bot-L' },
    { value: 'bottom-right', label: 'Bot-R' }
  ];

  const startupPageOptions = [
    { value: 'home', label: 'Home' },
    { value: 'library', label: 'Library' },
    { value: 'news', label: 'News' },
    { value: 'watch-together', label: 'Rooms' }
  ];

  const shortcutMeta: Array<{
    id: ShortcutActionId;
    label: string;
    scope: 'player' | 'app';
    scopeLabel: string;
    icon: typeof Play;
  }> = [
    { id: 'playPause', label: 'Play / Pause', scope: 'player', scopeLabel: 'Player', icon: Play },
    { id: 'fullscreen', label: 'Player Fullscreen', scope: 'player', scopeLabel: 'Player', icon: Maximize2 },
    { id: 'seekForward', label: 'Seek forward', scope: 'player', scopeLabel: 'Player', icon: FastForward },
    { id: 'seekBack', label: 'Seek backward', scope: 'player', scopeLabel: 'Player', icon: FastForward },
    { id: 'jumpForward', label: 'Jump forward (2x)', scope: 'player', scopeLabel: 'Player', icon: FastForward },
    { id: 'jumpBack', label: 'Jump backward (-2x)', scope: 'player', scopeLabel: 'Player', icon: FastForward },
    { id: 'volUp', label: 'Volume up', scope: 'player', scopeLabel: 'Audio', icon: Volume2 },
    { id: 'volDown', label: 'Volume down', scope: 'player', scopeLabel: 'Audio', icon: Volume2 },
    { id: 'mute', label: 'Mute / Unmute', scope: 'player', scopeLabel: 'Audio', icon: Volume2 },
    { id: 'skipOp', label: 'Skip OP / ED', scope: 'player', scopeLabel: 'Player', icon: SlidersHorizontal },
    { id: 'subtitles', label: 'Toggle subtitles', scope: 'player', scopeLabel: 'Player', icon: Subtitles },
    { id: 'nextEp', label: 'Next episode', scope: 'app', scopeLabel: 'Episode', icon: Play },
    { id: 'prevEp', label: 'Previous episode', scope: 'app', scopeLabel: 'Episode', icon: Play },
    { id: 'appSearch', label: 'Quick search', scope: 'app', scopeLabel: 'Global', icon: Search },
    { id: 'appFullscreen', label: 'Window Fullscreen', scope: 'app', scopeLabel: 'Window', icon: Maximize2 }
  ];

  const shortcutFilterOptions = $derived([
    { value: 'all', label: 'All', badge: shortcutMeta.length },
    { value: 'player', label: 'Player', badge: shortcutMeta.filter((s) => s.scope === 'player').length },
    { value: 'app', label: 'Window & Nav', badge: shortcutMeta.filter((s) => s.scope === 'app').length }
  ]);

  const filteredShortcuts = $derived(
    shortcutTab === 'all' ? shortcutMeta : shortcutMeta.filter((s) => s.scope === shortcutTab)
  );

  $effect(() => {
    if (!settingsState.open) return;
    cacheStats = getCacheStats();
    cacheFeedback = '';
    historyFeedback = '';
    resetFeedback = '';
    exportFeedback = '';
    const goMila = getWailsMilaBindings();
    if (goMila?.GetAppVersion) {
      void goMila
        .GetAppVersion()
        .then((v) => {
          if (v) appVersion = v;
        })
        .catch(() => {});
    }
  });

  $effect(() => {
    const applyStatus = (status: AppUpdateStatus | null) => {
      if (!status) return;
      if (status.state === 'downloading' || status.state === 'installing') {
        updateChecking = false;
        const pct = typeof status.progress === 'number' ? status.progress : 0;
        updateProgress = updateProgress !== null ? Math.max(updateProgress, pct) : pct;
        return;
      }
      if (status.state === 'up_to_date' || status.state === 'error' || status.state === 'idle') {
        updateChecking = false;
        updateProgress = null;
      }
    };
    return subscribeAppUpdateStatus(applyStatus);
  });

  $effect(() => {
    if (!updateChecking && updateProgress === null) return;
    const id = window.setInterval(() => {
      void invokeGetUpdateStatus().then((status) => {
        if (!status) return;
        if (status.state === 'downloading' || status.state === 'installing') {
          updateChecking = false;
          const pct = typeof status.progress === 'number' ? status.progress : 0;
          updateProgress = updateProgress !== null ? Math.max(updateProgress, pct) : pct;
          return;
        }
        if (status.state === 'up_to_date' || status.state === 'error' || status.state === 'idle') {
          updateChecking = false;
          updateProgress = null;
        }
      });
    }, 180);
    return () => window.clearInterval(id);
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!settingsState.open || e.key !== 'Escape') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('.marla-keybind.is-recording')) return;
    e.preventDefault();
    closeSettingsPopup();
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  async function handleExportLogs() {
    try {
      const report = await exportDiagnosticLogs('');
      exportFeedback = `Exported ${report.files} files (${formatBytes(report.bytes)})`;
    } catch {
      exportFeedback = 'Desktop build required for log archive';
    }
  }

  async function handleCheckReleases() {
    if (updateChecking || updateProgress !== null) return;
    updateChecking = true;
    updateProgress = null;
    try {
      const res = await invokeCheckAndInstallUpdate();
      if (!res) {
        await fetch('https://api.github.com/repos/mila-desktop/desktop/releases/latest', {
          headers: { Accept: 'application/vnd.github+json' }
        }).catch(() => {});
        updateChecking = false;
        updateProgress = null;
        return;
      }
      if (res.state === 'downloading' || res.state === 'installing') {
        updateChecking = false;
        updateProgress = typeof res.progress === 'number' ? res.progress : 0;
        return;
      }
      updateChecking = false;
      updateProgress = null;
    } catch {
      updateChecking = false;
      updateProgress = null;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if settingsState.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    use:portal
    class="settings-backdrop"
    transition:fade={{ duration: settingsState.reducedMotion ? 0 : 180, easing: cubicOut }}
    onclick={(e) => {
      if (e.target === e.currentTarget) closeSettingsPopup();
    }}
  >
    <div
      class="settings-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      transition:scale={{ start: 0.965, duration: settingsState.reducedMotion ? 0 : 220, easing: cubicOut }}
    >
      <aside class="settings-sidebar" aria-label="Settings categories">
        <ScrollArea maxHeight={null}>
          <nav class="settings-nav">
            {#each navGroups as grp (grp.id)}
              <div class="settings-nav-group">
                <span class="settings-nav-heading">{grp.label}</span>
                {#each grp.items as item (item.id)}
                  <SidebarItem
                    label={item.label}
                    active={settingsState.section === item.id}
                    onclick={() => {
                      settingsState.section = item.id;
                    }}
                  >
                    {#snippet icon()}
                      <MorphIcon icon={item.icon} size={15} strokeWidth={1.85} />
                    {/snippet}
                  </SidebarItem>
                {/each}
              </div>
            {/each}
          </nav>
        </ScrollArea>
      </aside>

      <section class="settings-content">
        <header class="settings-content-head">
          <div class="settings-head-stage">
            {#key settingsState.section}
              <div
                class="settings-head-titles"
                in:tabRevealBlur={{ duration: 200, blur: 6, y: 4 }}
                out:tabRevealBlur={{ duration: 130, blur: 5, y: -3 }}
              >
                <h2 class="settings-section-title">{activeSectionMeta.title}</h2>
                <p class="settings-section-sub">{activeSectionMeta.sub}</p>
              </div>
            {/key}
          </div>
        </header>

        <div class="settings-content-scroll">
          <ScrollArea maxHeight={null}>
            <div class="settings-pane-stage">
              {#key settingsState.section}
                <div
                  class="settings-tab-pane"
                  in:tabRevealBlur={{ duration: 220, blur: 8, y: 6 }}
                  out:tabRevealBlur={{ duration: 150, blur: 6, y: -4 }}
                >
                  {#if settingsState.section === 'appearance'}
                    <div class="settings-list">
                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Theme mode</span>
                          <span class="setting-sub">Switch between pure dark obsidian, light paper or live accent canvas.</span>
                        </div>
                        <SegmentedControl
                          value={theme.mode}
                          options={themeModeOptions}
                          ariaLabel="Theme mode"
                          onchange={(val) => setThemeMode(String(val) as ThemeMode)}
                        />
                      </div>

                      <div class="setting-row is-stacked">
                        <div class="setting-row-top">
                          <div class="setting-copy">
                            <span class="setting-title">Accent color hue</span>
                            <span class="setting-sub">Tint highlights, canvas glow and Accent theme chrome.</span>
                          </div>
                          <span class="setting-value-pill">
                            <span class="hue-swatch" style:background={`hsl(${theme.hue}, 82%, 58%)`}></span>
                            {theme.hue}°
                          </span>
                        </div>
                        <RgbLine
                          hue={theme.hue}
                          ariaLabel="Accent color hue"
                          onchange={(h) => {
                            if (theme.mode !== 'custom') {
                              setThemeMode('custom');
                            }
                            setCustomHue(h);
                          }}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Interface language</span>
                          <span class="setting-sub">Instant hot-swap across navigation, player HUD and metadata tags.</span>
                        </div>
                        <SegmentedControl
                          value={i18n.locale}
                          options={localeOptions}
                          ariaLabel="Interface language"
                          onchange={(val) => setLocale(String(val) as LocaleCode)}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Card corner roundness</span>
                          <span class="setting-sub">Adjust border radius token used by cards, tiles and video stage.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.cardRadius}
                          options={radiusOptions}
                          ariaLabel="Card corner roundness"
                          onchange={(val) =>
                            setSettingPref('cardRadius', String(val) as CardRadiusPref, 'mila.sys.cardRadius')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Default episodes layout</span>
                          <span class="setting-sub">Display release episodes as wide thumbnail grid cards or compact list rows.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.episodesView}
                          options={episodesViewOptions}
                          ariaLabel="Default episodes layout"
                          onchange={(val) =>
                            setSettingPref('episodesView', String(val) as EpisodesViewPref, 'mila.anime.episodesViewMode')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Ambient poster blur glow</span>
                          <span class="setting-sub">Render diffused cover artwork backdrop behind pages and popups.</span>
                        </div>
                        <Toggle
                          checked={settingsState.ambientBlur}
                          ariaLabel="Ambient poster blur glow"
                          onchange={(v) => setSettingPref('ambientBlur', v, 'mila.sys.ambientBlur')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Frosted glass backdrop blur</span>
                          <span class="setting-sub">Apply GPU backdrop-filter blur to modals, menus and header bar.</span>
                        </div>
                        <Toggle
                          checked={settingsState.glassBlur}
                          ariaLabel="Frosted glass backdrop blur"
                          onchange={(v) => setSettingPref('glassBlur', v, 'mila.sys.glassBlur')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Auto-hide top bar on scroll</span>
                          <span class="setting-sub">Tuck away floating navigation header while scrolling down long feeds.</span>
                        </div>
                        <Toggle
                          checked={settingsState.autoHideHeader}
                          ariaLabel="Auto-hide top bar on scroll"
                          onchange={(v) => setSettingPref('autoHideHeader', v, 'mila.sys.autoHideHeader')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Reduce interface motion</span>
                          <span class="setting-sub">Minimize blur reveals, transitions and hover animations across screens.</span>
                        </div>
                        <Toggle
                          checked={settingsState.reducedMotion}
                          ariaLabel="Reduce interface motion"
                          onchange={(v) => setSettingPref('reducedMotion', v, 'mila.sys.reducedMotion')}
                        />
                      </div>
                    </div>
                  {:else if settingsState.section === 'playback'}
                    <div class="settings-list">
                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Default stream resolution</span>
                          <span class="setting-sub">Preferred HLS/MP4 quality tier locked when opening an episode.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.defaultQuality}
                          options={qualityOptions}
                          ariaLabel="Default stream resolution"
                          onchange={(val) =>
                            setSettingPref('defaultQuality', String(val) as QualityPref, 'mila.setup.quality')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Preferred release source</span>
                          <span class="setting-sub">Priority streaming provider queried first when opening new titles.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.preferredProvider}
                          options={providerOptions}
                          ariaLabel="Preferred release source"
                          onchange={(val) =>
                            setSettingPref('preferredProvider', String(val) as StreamProviderPref, 'mila.sys.preferredProvider')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Default playback speed</span>
                          <span class="setting-sub">Base speed rate applied to new episodes and live player sessions.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.defaultSpeed}
                          options={speedOptions}
                          ariaLabel="Default playback speed"
                          onchange={(val) => setSettingPref('defaultSpeed', Number(val), 'mila.player.speed')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Arrow seek step interval</span>
                          <span class="setting-sub">Seconds skipped on seek keys (doubled for quick jump shortcut).</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.seekStepSec}
                          options={seekStepOptions}
                          ariaLabel="Arrow seek step interval"
                          onchange={(val) => setSettingPref('seekStepSec', Number(val), 'mila.sys.seekStepSec')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Hold-Space speed boost</span>
                          <span class="setting-sub">Temporary playback speed multiplier while holding Spacebar.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.holdBoostRate}
                          options={holdBoostOptions}
                          ariaLabel="Hold-Space speed boost"
                          onchange={(val) => setSettingPref('holdBoostRate', Number(val), 'mila.sys.holdBoostRate')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">HLS read-ahead buffer target</span>
                          <span class="setting-sub">Forward segment buffer size in seconds to resist network spikes.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.hlsBufferSec}
                          options={bufferOptions}
                          ariaLabel="HLS read-ahead buffer target"
                          onchange={(val) => setSettingPref('hlsBufferSec', Number(val), 'mila.sys.hlsBufferSec')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Auto-play next episode</span>
                          <span class="setting-sub">Automatically advance to the next episode once playback finishes.</span>
                        </div>
                        <Toggle
                          checked={settingsState.autoNext}
                          ariaLabel="Auto-play next episode"
                          onchange={(v) => setSettingPref('autoNext', v)}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Auto-skip OP / ED markers</span>
                          <span class="setting-sub">Automatically jump past tagged opening and ending sequences.</span>
                        </div>
                        <Toggle
                          checked={settingsState.autoSkip}
                          ariaLabel="Auto-skip OP / ED markers"
                          onchange={(v) => setSettingPref('autoSkip', v)}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Auto-play on episode open</span>
                          <span class="setting-sub">Start video immediately upon entering Player instead of paused preview.</span>
                        </div>
                        <Toggle
                          checked={settingsState.autoPlayOnOpen}
                          ariaLabel="Auto-play on episode open"
                          onchange={(v) => setSettingPref('autoPlayOnOpen', v, 'mila.sys.autoPlayOpen')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Pause when tab or window hidden</span>
                          <span class="setting-sub">Automatically pause active playback when app loses visibility.</span>
                        </div>
                        <Toggle
                          checked={settingsState.pauseOnMinimize}
                          ariaLabel="Pause when tab or window hidden"
                          onchange={(v) => setSettingPref('pauseOnMinimize', v, 'mila.sys.pauseOnMinimize')}
                        />
                      </div>
                    </div>
                  {:else if settingsState.section === 'audioSubs'}
                    <div class="settings-list">
                      <div class="setting-row is-stacked">
                        <div class="setting-row-top">
                          <div class="setting-copy">
                            <span class="setting-title">Master player volume</span>
                            <span class="setting-sub">Default loudness applied across episodes and synced immediately.</span>
                          </div>
                          <span class="setting-value-pill">{Math.round(settingsState.defaultVolume * 100)}%</span>
                        </div>
                        <Slider
                          value={Math.round(settingsState.defaultVolume * 100)}
                          min={0}
                          max={100}
                          step={1}
                          ariaLabel="Master player volume"
                          onchange={(pct) => setSettingPref('defaultVolume', Number((pct / 100).toFixed(2)), 'mila.player.volume')}
                        />
                      </div>

                      <div class="setting-row is-stacked">
                        <div class="setting-row-top">
                          <div class="setting-copy">
                            <span class="setting-title">Video brightness filter</span>
                            <span class="setting-sub">Real-time luminance multiplier applied directly to the video canvas.</span>
                          </div>
                          <span class="setting-value-pill">{Math.round(settingsState.brightness * 100)}%</span>
                        </div>
                        <Slider
                          value={Math.round(settingsState.brightness * 100)}
                          min={60}
                          max={140}
                          step={5}
                          ariaLabel="Video brightness filter"
                          onchange={(pct) => setSettingPref('brightness', Number((pct / 100).toFixed(2)))}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Subtitle font scale</span>
                          <span class="setting-sub">CSS font scale applied to embedded WebVTT and ASS subtitle cues.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.subtitleScale}
                          options={subScaleOptions}
                          ariaLabel="Subtitle font scale"
                          onchange={(val) => setSettingPref('subtitleScale', Number(val), 'mila.sys.subtitleScale')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Multi-track audio priority</span>
                          <span class="setting-sub">Preferred embedded track chosen in HLS manifests and MKV remuxes.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.audioPriority}
                          options={audioPriorityOptions}
                          ariaLabel="Multi-track audio priority"
                          onchange={(val) =>
                            setSettingPref('audioPriority', String(val) as 'ru' | 'orig' | 'first', 'mila.sys.audioPriority')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Keyboard volume step</span>
                          <span class="setting-sub">Percentage adjustment per Up / Down volume shortcut keypress.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.volumeStepPct}
                          options={volumeStepOptions}
                          ariaLabel="Keyboard volume step"
                          onchange={(val) => setSettingPref('volumeStepPct', Number(val), 'mila.sys.volumeStepPct')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Start episodes muted</span>
                          <span class="setting-sub">Keep audio muted until explicitly unmuted in player controls.</span>
                        </div>
                        <Toggle
                          checked={settingsState.startMuted}
                          ariaLabel="Start episodes muted"
                          onchange={(v) => setSettingPref('startMuted', v, 'mila.sys.startMuted')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">In-player OSD feedback</span>
                          <span class="setting-sub">Display translucent HUD pills inside the stage on seek, mute and speed.</span>
                        </div>
                        <Toggle
                          checked={settingsState.showPlayerOsd}
                          ariaLabel="In-player OSD feedback"
                          onchange={(v) => setSettingPref('showPlayerOsd', v, 'mila.sys.showOsd')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Hardware media keys & OS overlay</span>
                          <span class="setting-sub">Publish now-playing artwork and transport handlers to OS Media Session.</span>
                        </div>
                        <Toggle
                          checked={settingsState.hardwareMediaKeys}
                          ariaLabel="Hardware media keys"
                          onchange={(v) => setSettingPref('hardwareMediaKeys', v, 'mila.sys.mediaKeys')}
                        />
                      </div>
                    </div>
                  {:else if settingsState.section === 'shortcuts'}
                    <div class="shortcuts-toolbar">
                      <SegmentedControl
                        value={shortcutTab}
                        options={shortcutFilterOptions}
                        ariaLabel="Filter shortcuts"
                        onchange={(val) => {
                          shortcutTab = String(val) as 'all' | 'player' | 'app';
                        }}
                      />
                      <SecondButton
                        size="icon"
                        ariaLabel="Reset shortcuts to default"
                        title="Reset shortcuts to default"
                        onclick={resetAllShortcuts}
                      >
                        {#snippet icon()}
                          <MorphIcon icon={RotateCcw} size={14} strokeWidth={1.9} />
                        {/snippet}
                      </SecondButton>
                    </div>

                    <div class="shortcuts-grid">
                      {#each filteredShortcuts as item (item.id)}
                        <div class="shortcut-tile">
                          <span class="shortcut-tile-icon" aria-hidden="true">
                            <MorphIcon icon={item.icon} size={15} strokeWidth={1.85} />
                          </span>
                          <div class="shortcut-tile-copy">
                            <span class="shortcut-tile-title">{item.label}</span>
                            <span class="shortcut-tile-scope">{item.scopeLabel}</span>
                          </div>
                          <KeybindButton
                            value={settingsState.shortcuts[item.id]}
                            ariaLabel={`Rebind ${item.label}`}
                            onchange={(combo) => setShortcutBinding(item.id, combo)}
                          />
                        </div>
                      {/each}
                    </div>
                  {:else if settingsState.section === 'watchTogether'}
                    <div class="settings-list">
                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Sync deadband threshold</span>
                          <span class="setting-sub">Ignore drift smaller than this window so 1x playback never jitters.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.wtDriftDeadband}
                          options={driftOptions}
                          ariaLabel="Sync deadband threshold"
                          onchange={(val) => setSettingPref('wtDriftDeadband', Number(val), 'mila.sys.wtDriftDeadband')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Max catch-up playback speed</span>
                          <span class="setting-sub">Ceiling speed multiplier during smooth Rave-style host catch-up.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.wtMaxCatchupRate}
                          options={catchupRateOptions}
                          ariaLabel="Max catch-up playback speed"
                          onchange={(val) => setSettingPref('wtMaxCatchupRate', Number(val), 'mila.sys.wtMaxCatchupRate')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Hard-seek jump threshold</span>
                          <span class="setting-sub">Drift limit before forcing an instant timeline jump instead of speed ramp.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.wtHardSeekSec}
                          options={hardSeekOptions}
                          ariaLabel="Hard-seek jump threshold"
                          onchange={(val) => setSettingPref('wtHardSeekSec', Number(val), 'mila.sys.wtHardSeekSec')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Default room chat layout</span>
                          <span class="setting-sub">Open Watch Together rooms with floating glass overlay or right split-screen.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.wtChatPinned ? 'split' : 'floating'}
                          options={wtChatOptions}
                          ariaLabel="Default room chat layout"
                          onchange={(val) => setSettingPref('wtChatPinned', val === 'split', 'mila.wt.chatPinned')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Auto-open chat when joining room</span>
                          <span class="setting-sub">Start Watch Together sessions with the chat panel already expanded.</span>
                        </div>
                        <Toggle
                          checked={settingsState.wtChatAutoOpen}
                          ariaLabel="Auto-open chat when joining room"
                          onchange={(v) => setSettingPref('wtChatAutoOpen', v, 'mila.sys.wtChatAutoOpen')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Show system join/leave events</span>
                          <span class="setting-sub">Display room join, leave and host transfer notices inline in chat.</span>
                        </div>
                        <Toggle
                          checked={settingsState.wtShowSystemMsgs}
                          ariaLabel="Show system join/leave events"
                          onchange={(v) => setSettingPref('wtShowSystemMsgs', v, 'mila.sys.wtShowSystem')}
                        />
                      </div>
                    </div>
                  {:else if settingsState.section === 'torrents'}
                    <div class="settings-list">
                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">MKV / HEVC FFmpeg remux mode</span>
                          <span class="setting-sub">Choose when containers are remuxed locally before WebView2 playback.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.torrentRemuxMode}
                          options={remuxOptions}
                          ariaLabel="Torrent remux mode"
                          onchange={(val) =>
                            setSettingPref('torrentRemuxMode', String(val) as TorrentRemuxMode, 'mila.sys.torrentRemux')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Default torrent quality filter</span>
                          <span class="setting-sub">Pre-filter torrent popup results by target video resolution tier.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.defaultTorrentQuality}
                          options={defaultTorQualityOptions}
                          ariaLabel="Default torrent quality filter"
                          onchange={(val) =>
                            setSettingPref(
                              'defaultTorrentQuality',
                              String(val) as DefaultTorQualityPref,
                              'mila.sys.defaultTorQuality'
                            )}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Prioritize 2K / 4K in Best sort</span>
                          <span class="setting-sub">Boost 2160p, 4K and 1440p torrents above standard 1080p web-rips.</span>
                        </div>
                        <Toggle
                          checked={settingsState.preferHiResTorrents}
                          ariaLabel="Prioritize 2K / 4K releases"
                          onchange={(v) => setSettingPref('preferHiResTorrents', v, 'mila.sys.preferHiResTorrents')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Boost Russian multi-dub packs</span>
                          <span class="setting-sub">Rank AniLibria, RuTor and StudioBand packs near top results.</span>
                        </div>
                        <Toggle
                          checked={settingsState.preferRuTorrents}
                          ariaLabel="Boost Russian multi-dub packs"
                          onchange={(v) => setSettingPref('preferRuTorrents', v, 'mila.sys.preferRuTorrents')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Background next-episode prefetch</span>
                          <span class="setting-sub">Pre-resolve metadata and stream URLs before the current episode ends.</span>
                        </div>
                        <Toggle
                          checked={settingsState.prefetchNextEpisode}
                          ariaLabel="Background next-episode prefetch"
                          onchange={(v) => setSettingPref('prefetchNextEpisode', v, 'mila.sys.prefetchNextEp')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Hover episode video preview</span>
                          <span class="setting-sub">Stream short silent HLS excerpt frames when hovering episode cards.</span>
                        </div>
                        <Toggle
                          checked={settingsState.hoverEpisodePreview}
                          ariaLabel="Hover episode video preview"
                          onchange={(v) => setSettingPref('hoverEpisodePreview', v, 'mila.sys.hoverEpPreview')}
                        />
                      </div>
                    </div>
                  {:else if settingsState.section === 'windowPerf'}
                    <div class="settings-list">
                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Startup landing tab</span>
                          <span class="setting-sub">Initial section opened when launching Mila Desktop.</span>
                        </div>
                        <SegmentedControl
                          value={settingsState.startupPage}
                          options={startupPageOptions}
                          ariaLabel="Startup landing tab"
                          onchange={(val) =>
                            setSettingPref('startupPage', String(val) as StartupPagePref, 'mila.sys.startupPage')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Auto-enter Mini PiP on navigation</span>
                          <span class="setting-sub">Shrink active playback into corner PiP automatically when browsing away.</span>
                        </div>
                        <Toggle
                          checked={settingsState.autoEnterPip}
                          ariaLabel="Auto-enter Mini PiP"
                          onchange={(v) => setSettingPref('autoEnterPip', v, 'mila.sys.autoEnterPip')}
                        />
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">In-app PiP anchor corner</span>
                          <span class="setting-sub">Default screen corner used when shrinking player into Picture-in-Picture.</span>
                        </div>
                        <SegmentedControl
                          value={player.pipCorner}
                          options={pipCornerOptions}
                          ariaLabel="In-app PiP anchor corner"
                          onchange={(val) => setPipCorner(String(val) as PipCorner)}
                        />
                      </div>
                    </div>
                  {:else if settingsState.section === 'storage'}
                    <div class="settings-list">
                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Metadata & catalog cache</span>
                          <span class="setting-sub">
                            {#if cacheFeedback}
                              {cacheFeedback}
                            {:else if cacheStats.entries > 0}
                              {cacheStats.entries} cached entries ({formatBytes(cacheStats.bytes)})
                            {:else}
                              Local cache is currently empty.
                            {/if}
                          </span>
                        </div>
                        <SecondButton
                          size="sm"
                          disabled={cacheStats.entries === 0}
                          onclick={() => {
                            const n = clearAppCache();
                            cacheStats = getCacheStats();
                            cacheFeedback = `Cleared ${n} entries`;
                          }}
                        >
                          Clear Cache
                        </SecondButton>
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Local watch history & episode progress</span>
                          <span class="setting-sub">
                            {historyFeedback || `${watchHistory.entries.length} titles recorded locally.`}
                          </span>
                        </div>
                        <SecondButton
                          size="sm"
                          disabled={watchHistory.entries.length === 0}
                          onclick={() => {
                            clearWatchHistory();
                            historyFeedback = 'Watch history cleared';
                          }}
                        >
                          Clear History
                        </SecondButton>
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Diagnostic logs archive</span>
                          <span class="setting-sub">
                            {exportFeedback || 'Bundle redacted runtime and Go backend logs into a .zip archive.'}
                          </span>
                        </div>
                        <SecondButton
                          size="sm"
                          disabled={!bindings.isApp}
                          onclick={() => void handleExportLogs()}
                        >
                          Export Logs
                        </SecondButton>
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Reset all system settings</span>
                          <span class="setting-sub">
                            {resetFeedback || 'Restore default keybinds, sync tolerances, buffer and appearance prefs.'}
                          </span>
                        </div>
                        <SecondButton
                          size="sm"
                          onclick={() => {
                            resetAllSystemSettings();
                            resetFeedback = 'All system settings restored';
                          }}
                        >
                          Reset All
                        </SecondButton>
                      </div>
                    </div>
                  {:else if settingsState.section === 'about'}
                    <div class="settings-list">
                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Mila Desktop Version</span>
                          <span class="setting-sub">
                            {bindings.isApp ? 'Native Windows Wails + WebView2 build' : 'Browser Vite Dev Preview'}
                          </span>
                        </div>
                        <span class="setting-badge">{appVersion}</span>
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Streaming & Sync Stack</span>
                          <span class="setting-sub">hls.js MSE · FFmpeg MKV Remux · LibTorrent · QUIC Watch Together</span>
                        </div>
                        <span class="setting-badge">
                          <MorphIcon icon={Cpu} size={13} strokeWidth={1.9} />
                          <span>amd64</span>
                        </span>
                      </div>

                      <div class="setting-row">
                        <div class="setting-copy">
                          <span class="setting-title">Application updates</span>
                          <span class="setting-sub">Check GitHub Releases for newer signed builds.</span>
                        </div>
                        <GitButton
                          loading={updateChecking}
                          progress={updateProgress}
                          onclick={() => void handleCheckReleases()}
                        >
                          {t('header.checkReleases')}
                        </GitButton>
                      </div>
                    </div>
                  {/if}
                </div>
              {/key}
            </div>
          </ScrollArea>
        </div>
      </section>
    </div>
  </div>
{/if}

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    z-index: 270;
    background: var(--mila-popup-backdrop, rgba(4, 4, 6, 0.72));
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .settings-modal {
    position: relative;
    width: min(860px, 94vw);
    height: min(600px, 86vh);
    border-radius: 18px;
    background: var(--mila-popup-bgExpanded, rgba(14, 14, 17, 0.95));
    box-shadow: var(--mila-popup-shadow, 0 28px 80px rgba(0, 0, 0, 0.78));
    display: grid;
    grid-template-columns: 204px minmax(0, 1fr);
    overflow: hidden;
    color: var(--mila-text-primary, #ffffff);
  }

  @media (max-width: 740px) {
    .settings-modal {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
      height: min(660px, 90vh);
    }
  }

  .settings-sidebar {
    display: flex;
    flex-direction: column;
    padding: 16px 8px 16px 14px;
    background: transparent;
    min-height: 0;
  }

  .settings-nav {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 2px 0;
  }

  .settings-nav-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .settings-nav-heading {
    padding: 4px 10px 3px;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 11px;
    font-weight: 500;
    color: var(--mila-popup-comboSectionText, var(--mila-text-muted, rgba(255, 255, 255, 0.4)));
    letter-spacing: 0.01em;
    user-select: none;
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    padding: 20px 6px 12px 10px;
  }

  .settings-content-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 0 26px 8px 10px;
    margin-bottom: 0;
    flex-shrink: 0;
  }

  .settings-head-stage {
    flex: 1 1 0;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-head-titles {
    grid-area: 1 / 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    will-change: opacity, filter, transform;
  }

  .settings-section-title {
    margin: 0;
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--mila-text-primary, #ffffff);
  }

  .settings-section-sub {
    margin: 0;
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12px;
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.48));
  }

  .settings-content-scroll {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .settings-content-scroll :global(.marlakit-scroll-viewport) {
    padding: 8px 24px 16px 10px;
    box-sizing: border-box;
    mask-image: linear-gradient(
      to bottom,
      transparent 0px,
      #000 12px,
      #000 calc(100% - 14px),
      transparent 100%
    );
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent 0px,
      #000 12px,
      #000 calc(100% - 14px),
      transparent 100%
    );
  }

  .settings-content-scroll :global(.marlakit-scroll-track) {
    top: 12px;
    right: 4px;
    bottom: 14px;
  }

  .settings-pane-stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-tab-pane {
    grid-area: 1 / 1;
    min-width: 0;
    will-change: opacity, filter, transform;
  }

  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-bottom: 6px;
  }

  .setting-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    padding: 8px 2px;
    min-height: 48px;
    box-sizing: border-box;
  }

  .setting-row.is-stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .setting-row-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .setting-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 200px;
  }

  .setting-title {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--mila-text-primary, #ffffff);
  }

  .setting-sub {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 11.5px;
    line-height: 1.35;
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.46));
  }

  .setting-value-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border-radius: 8px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.06));
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--mila-text-primary, #ffffff);
    flex-shrink: 0;
  }

  .hue-swatch {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .shortcuts-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 0 12px;
  }

  .shortcuts-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 0 0 8px;
  }

  @media (max-width: 640px) {
    .shortcuts-grid {
      grid-template-columns: 1fr;
    }
  }

  .shortcut-tile {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--mila-popup-itemBg, var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.038)));
  }

  .shortcut-tile-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.05));
    color: var(--mila-accent-highlight, var(--mila-text-secondary, rgba(255, 255, 255, 0.8)));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .shortcut-tile-copy {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .shortcut-tile-title {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--mila-text-primary, #ffffff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shortcut-tile-scope {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 11px;
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.44));
  }

  .setting-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: ui-monospace, 'Cascadia Mono', monospace;
    font-size: 12px;
    color: var(--mila-accent-highlight, var(--mila-text-primary, #ffffff));
    padding: 5px 10px;
    border-radius: 9px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.055));
    flex-shrink: 0;
  }
</style>
