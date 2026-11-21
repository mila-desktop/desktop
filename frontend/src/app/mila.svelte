<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Header from '../section/header/Header.svelte';
  import ScrollArea from '../marlakit/scroll/ScrollArea.svelte';
  import PageHost from './PageHost.svelte';
  import PlayerDock from './PlayerDock.svelte';
  import SearchPopup from '../section/search/SearchPopup.svelte';
  import SettingsPopup from '../section/settings/SettingsPopup.svelte';
  import SetupScene from '../section/setup/SetupScene.svelte';
  import { bootState, initBootGate } from './boot.svelte';
  import { bindings, mountBindingsController } from './bindings.svelte';
  import { getSavedPageScroll, registerScrollBridge, router } from './router.svelte';
  import { settingsState } from './settings.svelte';
  import './theme.svelte';
  import type { PageId } from '../pages';

  const SETUP_COMPLETED_KEY = 'mila.setup.completed';

  function isSetupCompleted(): boolean {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(SETUP_COMPLETED_KEY) === '1';
    } catch {
      return false;
    }
  }

  let setupOpen = $state(!isSetupCompleted());
  let scrollArea = $state<ReturnType<typeof ScrollArea> | null>(null);
  let headerHidden = $state(false);
  let headerScrolled = $state(false);
  let lastScrollTop = 0;
  let downScrollAccum = 0;
  let upScrollAccum = 0;

  function handleViewportScroll(scrollTop: number) {
    const top = Math.max(0, scrollTop);
    headerScrolled = top > 28;

    if (!settingsState.autoHideHeader) {
      headerHidden = false;
      lastScrollTop = top;
      downScrollAccum = 0;
      upScrollAccum = 0;
      return;
    }

    if (top <= 18) {
      headerHidden = false;
      downScrollAccum = 0;
      upScrollAccum = 0;
      lastScrollTop = top;
      return;
    }

    const delta = top - lastScrollTop;
    lastScrollTop = top;
    if (Math.abs(delta) < 0.5) return;

    if (delta > 0) {
      upScrollAccum = 0;
      downScrollAccum += delta;
      if (top > 48 && downScrollAccum >= 14) {
        headerHidden = true;
      }
    } else {
      downScrollAccum = 0;
      upScrollAccum += -delta;
      if (upScrollAccum >= 4) {
        headerHidden = false;
      }
    }
  }

  $effect(() => {
    if (!settingsState.autoHideHeader) {
      headerHidden = false;
    }
  });

  function handlePageBeforeEnter(pageId: PageId) {
    const targetTop = getSavedPageScroll(pageId);
    lastScrollTop = targetTop;
    downScrollAccum = 0;
    upScrollAccum = 0;
    headerHidden = false;
    headerScrolled = targetTop > 28;
    scrollArea?.setScrollTop(targetTop);
  }

  onMount(() => {
    initBootGate();
    const unregisterScroll = registerScrollBridge(
      () => scrollArea?.getScrollTop() ?? 0,
      (top) => scrollArea?.smoothScrollTo(top)
    );
    const unmountBindings = mountBindingsController();

    return () => {
      unregisterScroll();
      unmountBindings();
    };
  });
</script>

<div
  class="viewport"
  class:is-app={bindings.isApp}
  class:is-setup={setupOpen}
  class:is-fullscreen={bindings.isWindowSharp}
  class:is-os-pip={bindings.osPipActive}
>
  <div class="content-layer" class:is-setup-active={setupOpen}>
    <Header
      hidden={headerHidden || router.current === 'player'}
      scrolled={headerScrolled}
    />
    <ScrollArea bind:this={scrollArea} onscroll={handleViewportScroll}>
      <PageHost
        onBeforeEnter={handlePageBeforeEnter}
        onAfterSettle={() => scrollArea?.syncMetrics()}
      />
    </ScrollArea>
  </div>

  <!-- global popups (above everything) -->
  <PlayerDock />
  <SearchPopup />
  <SettingsPopup />

  {#if setupOpen}
    <SetupScene
      ready={bootState.ready}
      onContinue={() => {
        try {
          window.localStorage.setItem(SETUP_COMPLETED_KEY, '1');
        } catch {
          // Ignore storage quota / restricted context errors
        }
        setupOpen = false;
      }}
    />
  {:else if !bootState.ready}
    <div
      class="app-boot-screen"
      role="status"
      aria-live="polite"
      aria-label="Loading application"
      out:fade={{ duration: 360, easing: cubicOut }}
    >
      <div class="app-boot-spinner" aria-hidden="true"></div>
    </div>
  {/if}
</div>

<style>
  /* Base viewport: sharp corners (0px) when opened in a web browser */
  .viewport {
    width: 100vw;
    height: 100vh;
    min-width: 858px;
    min-height: 651px;
    border-radius: 0;
    overflow: hidden;
    position: relative;
    user-select: none;
    display: flex;
    flex-direction: column;
    background-color: var(--mila-app-canvas, #0c0c0c);
    color: var(--mila-text-primary, #ffffff);
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
    transform: translateZ(0);
    transition: background-color 360ms cubic-bezier(0.22, 1, 0.36, 1), color 320ms ease;
  }

  /* 15px rounded corners ONLY inside the native desktop app */
  .viewport.is-app {
    border-radius: 15px;
  }

  .viewport.is-setup {
    background-color: transparent;
  }

  .viewport.is-os-pip {
    min-width: 0 !important;
    min-height: 0 !important;
    border-radius: 15px !important;
  }

  .viewport.is-os-pip > .content-layer {
    opacity: 0;
    pointer-events: none;
  }

  :global(body.is-player-fullscreen) .viewport.is-app,
  :global(body.is-window-fullscreen) .viewport.is-app,
  .viewport.is-app.is-fullscreen {
    border-radius: 0 !important;
    transform: none;
  }

  .content-layer {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--mila-app-canvas, #0c0c0c);
    color: var(--mila-text-primary, #ffffff);
    transition:
      background-color 360ms cubic-bezier(0.22, 1, 0.36, 1),
      color 320ms ease,
      opacity 580ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 580ms cubic-bezier(0.22, 1, 0.36, 1),
      filter 580ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .content-layer.is-setup-active {
    opacity: 0;
    transform: translate3d(0, 8px, 0) scale(0.985);
    filter: blur(6px);
    pointer-events: none;
  }

  .content-layer > :global(.marlakit-scroll-area) > :global(.marlakit-scroll-track) {
    top: 14px;
    right: 7px;
    bottom: 14px;
  }

  .app-boot-screen {
    position: absolute;
    inset: 0;
    z-index: 9999;
    background: var(--mila-app-canvas, #0c0c0c);
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: drag;
  }

  .app-boot-spinner {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 2.5px solid var(--mila-app-spinnerTrack, rgba(255, 255, 255, 0.14));
    border-top-color: var(--mila-app-spinnerHead, #ffffff);
    animation: app-boot-spin 0.75s linear infinite;
    -webkit-app-region: no-drag;
  }

  @keyframes app-boot-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>