<script lang="ts">
  import { onMount } from 'svelte';
  import HlsPlayer from '../marlakit/player/HlsPlayer.svelte';
  import type { DubAudioSource } from '../marlakit/player/types';
  import { episodeSources } from '../api/anime';
  import {
    bindings,
    setOsPipWindowMode,
    startOsPipWindowDrag
  } from './bindings.svelte';
  import { settingsState } from './settings.svelte';
  import {
    closeCustomPip,
    expandCustomPip,
    fallbackVoice,
    nextEpisode,
    notifyLocalPlayerAction,
    prevEpisode,
    player,
    registerPlayerPauseControl,
    registerPlayerSeekControl,
    registerPlayerSyncBridge,
    reportPlaybackProgress,
    selectDubVoice,
    setDubAudioOffset,
    setPipCorner,
    setPlayerPlaying,
    switchVoice,
    toggleCustomPip,
    type PipCorner
  } from './player.svelte';
  import { router } from './router.svelte';

  let hlsPlayerRef = $state<ReturnType<typeof HlsPlayer> | null>(null);
  let liveNodeEl = $state<HTMLDivElement | null>(null);
  let pipShellEl = $state<HTMLDivElement | null>(null);
  let parkingEl = $state<HTMLDivElement | null>(null);
  let docPipWindow = $state<Window | null>(null);

  let isDragging = $state(false);
  let dragDx = $state(0);
  let dragDy = $state(0);

  const episodes = $derived(player.release?.episodes ?? []);
  const currentEpisode = $derived(episodes[player.episodeIndex] ?? null);
  const currentEpisodeSources = $derived(currentEpisode ? episodeSources(currentEpisode) : null);
  const currentDubAudio = $derived.by<DubAudioSource | null>(() => {
    if (!currentEpisode || !player.dubRelease || !player.dubVoiceId) return null;
    const dubEp =
      player.dubRelease.episodes.find((ep) => ep.ordinal === currentEpisode.ordinal) ??
      player.dubRelease.episodes[player.episodeIndex];
    if (!dubEp) return null;
    return {
      id: player.dubVoiceId,
      label: player.dubRelease.voiceLabel || 'RU Dub',
      sources: episodeSources(dubEp)
    };
  });
  const hasPrev = $derived(Boolean(player.release && player.episodeIndex > 0));
  const hasNext = $derived(Boolean(player.release && player.episodeIndex + 1 < episodes.length));

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

  let prevPage = router.current;
  const isInlinePlayerPage = (page: string) =>
    page === 'player' || page === 'watch-together-player';

  $effect.pre(() => {
    const curPage = router.current;
    if (isInlinePlayerPage(prevPage) && !isInlinePlayerPage(curPage)) {
      if (settingsState.autoEnterPip && currentEpisode && player.isPlaying && !player.pipDismissed) {
        player.pipMode = true;
      }
    } else if (!isInlinePlayerPage(prevPage) && isInlinePlayerPage(curPage)) {
      if (!player.pipManual && !bindings.osPipActive && !docPipWindow) {
        player.pipMode = false;
      }
    }
    prevPage = curPage;
  });

  const isPipVisible = $derived(
    Boolean(
      currentEpisode &&
        !player.loading &&
        !player.error &&
        !player.pipDismissed &&
        (bindings.osPipActive ||
          Boolean(docPipWindow) ||
          player.pipMode ||
          (!isInlinePlayerPage(router.current) && player.isPlaying))
    )
  );

  const isInlineVisible = $derived(
    Boolean(
      currentEpisode &&
        !player.loading &&
        !player.error &&
        isInlinePlayerPage(router.current) &&
        !isPipVisible &&
        player.inlineStageEl
    )
  );

  $effect.pre(() => {
    const node = liveNodeEl;
    if (!node) return;

    let targetParent: HTMLElement | null = parkingEl;
    if (docPipWindow && !docPipWindow.closed && docPipWindow.document?.body) {
      targetParent = docPipWindow.document.body;
    } else if (isInlineVisible && player.inlineStageEl) {
      targetParent = player.inlineStageEl;
    } else if (isPipVisible && pipShellEl) {
      targetParent = pipShellEl;
    }

    if (targetParent && node.parentElement !== targetParent) {
      const wasInParking = node.parentElement === parkingEl;
      const shouldPreservePlay = targetParent !== parkingEl && !player.pipDismissed;
      const wasPlaying = shouldPreservePlay ? (hlsPlayerRef?.beginReparent() ?? player.isPlaying) : false;
      const shouldPlayAfterAttach =
        shouldPreservePlay && (wasPlaying || (wasInParking && targetParent === player.inlineStageEl && player.autoplay));
      targetParent.appendChild(node);
      if (shouldPreservePlay) {
        hlsPlayerRef?.endReparent(shouldPlayAfterAttach);
      }
    }
  });

  function copyStylesToDocPip(targetDoc: Document) {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (sheet.href) {
          const link = targetDoc.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          targetDoc.head.appendChild(link);
        } else if (sheet.cssRules) {
          const style = targetDoc.createElement('style');
          style.textContent = Array.from(sheet.cssRules)
            .map((rule) => rule.cssText)
            .join('\n');
          targetDoc.head.appendChild(style);
        }
      } catch {
        // Ignore cross-origin stylesheet rules
      }
    }
    const baseStyle = targetDoc.createElement('style');
    baseStyle.textContent = `
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #070707;
        overflow: hidden;
      }
      .player-live-node {
        width: 100vw;
        height: 100vh;
      }
      .hls-player.is-pip {
        border-radius: 16px !important;
        clip-path: inset(0 round 16px);
      }
    `;
    targetDoc.head.appendChild(baseStyle);
  }

  async function closeDocPipIfOpen() {
    const win = docPipWindow;
    if (!win) return;
    docPipWindow = null;
    if (!win.closed) {
      try {
        win.close();
      } catch {
        // Ignore
      }
    }
  }

  async function handleToggleSystemPip() {
    // 1. Native Wails Desktop App -> transform HWND into OS-wide Always-On-Top rounded PiP window!
    if (bindings.isApp) {
      if (bindings.osPipActive) {
        await setOsPipWindowMode(false);
        expandCustomPip();
      } else {
        player.pipMode = true;
        player.pipManual = true;
        player.pipDismissed = false;
        await setOsPipWindowMode(true);
      }
      return;
    }

    // 2. Website in Browser -> use Document Picture-in-Picture API if available for OS-wide Always-On-Top custom UI!
    const docPipApi = (window as unknown as {
      documentPictureInPicture?: {
        requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
      };
    }).documentPictureInPicture;

    if (docPipWindow) {
      await closeDocPipIfOpen();
      expandCustomPip();
      return;
    }

    if (docPipApi && typeof docPipApi.requestWindow === 'function' && !player.pipMode) {
      try {
        const pipWin = await docPipApi.requestWindow({ width: 480, height: 270 });
        copyStylesToDocPip(pipWin.document);
        player.pipMode = true;
        player.pipManual = true;
        player.pipDismissed = false;
        docPipWindow = pipWin;
        pipWin.addEventListener(
          'pagehide',
          () => {
            docPipWindow = null;
            player.pipMode = false;
            player.pipManual = false;
          },
          { once: true }
        );
        return;
      } catch {
        // Fall through to in-app custom PiP
      }
    }

    toggleCustomPip();
  }

  async function handleExpandPip() {
    if (bindings.osPipActive) {
      await setOsPipWindowMode(false);
    }
    if (docPipWindow) {
      await closeDocPipIfOpen();
    }
    expandCustomPip();
  }

  async function handleClosePip() {
    closeCustomPip();
    try {
      if (bindings.osPipActive) {
        await setOsPipWindowMode(false);
      }
      if (docPipWindow) {
        await closeDocPipIfOpen();
      }
    } catch {
      // Ignore OS/Document PiP cleanup errors
    }
  }

  let activeDragCleanup: (() => void) | null = null;

  onMount(() => {
    registerPlayerSeekControl((seconds) => hlsPlayerRef?.seek(seconds));
    registerPlayerSyncBridge(
      (paused, pos, rate) => hlsPlayerRef?.applySyncState(paused, pos, rate),
      () => hlsPlayerRef?.getPlaybackSnapshot() ?? null
    );
    return () => {
      registerPlayerSeekControl(null);
      registerPlayerSyncBridge(null, null);
    };
  });

  onMount(() => {
    registerPlayerPauseControl(
      () => {
        hlsPlayerRef?.pause();
      },
      () => {
        hlsPlayerRef?.play();
      }
    );
    return () => {
      activeDragCleanup?.();
      activeDragCleanup = null;
      registerPlayerPauseControl(null, null);
    };
  });

  function handlePipDragStart(e: PointerEvent) {
    if (!isPipVisible) return;
    activeDragCleanup?.();
    activeDragCleanup = null;

    // In OS-wide Always-On-Top mode inside Wails app, dragging >= 5px moves the actual Windows OS window!
    if (bindings.osPipActive) {
      const startX = e.clientX;
      const startY = e.clientY;
      const cleanupOsDrag = () => {
        window.removeEventListener('pointermove', onOsMove);
        window.removeEventListener('pointerup', onOsUp);
        if (activeDragCleanup === cleanupOsDrag) activeDragCleanup = null;
      };
      const onOsMove = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        cleanupOsDrag();
        hlsPlayerRef?.notifyPipDragged();
        startOsPipWindowDrag();
      };
      const onOsUp = () => {
        cleanupOsDrag();
      };
      activeDragCleanup = cleanupOsDrag;
      window.addEventListener('pointermove', onOsMove);
      window.addEventListener('pointerup', onOsUp);
      return;
    }

    if (!pipShellEl) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const initialRect = pipShellEl.getBoundingClientRect();
    let moved = false;

    const detachDrag = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (activeDragCleanup === detachDrag) activeDragCleanup = null;
    };

    const onMove = (ev: PointerEvent) => {
      const rawDx = ev.clientX - startX;
      const rawDy = ev.clientY - startY;
      if (!moved && Math.hypot(rawDx, rawDy) < 5) {
        return;
      }
      moved = true;
      isDragging = true;

      const minDx = 16 - initialRect.left;
      const maxDx = window.innerWidth - 16 - initialRect.right;
      const minDy = 16 - initialRect.top;
      const maxDy = window.innerHeight - 16 - initialRect.bottom;

      dragDx = Math.max(minDx, Math.min(maxDx, rawDx));
      dragDy = Math.max(minDy, Math.min(maxDy, rawDy));
    };

    const onUp = () => {
      detachDrag();

      if (!moved || !pipShellEl) {
        isDragging = false;
        dragDx = 0;
        dragDy = 0;
        return;
      }

      hlsPlayerRef?.notifyPipDragged();
      const finalRect = pipShellEl.getBoundingClientRect();
      const centerX = finalRect.left + finalRect.width / 2;
      const centerY = finalRect.top + finalRect.height / 2;

      const isLeft = centerX < window.innerWidth / 2;
      const isTop = centerY < window.innerHeight / 2;
      const nextCorner: PipCorner = isTop
        ? isLeft
          ? 'top-left'
          : 'top-right'
        : isLeft
          ? 'bottom-left'
          : 'bottom-right';

      setPipCorner(nextCorner);
      isDragging = false;
      dragDx = 0;
      dragDy = 0;
    };

    activeDragCleanup = detachDrag;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }
</script>

<!-- Hidden parking container when player is neither inline nor in PiP -->
<div class="player-parking" bind:this={parkingEl} aria-hidden="true">
  <div class="player-live-node" bind:this={liveNodeEl}>
    {#if currentEpisode}
      <HlsPlayer
        bind:this={hlsPlayerRef}
        sources={currentEpisodeSources}
        dubAudio={currentDubAudio}
        dubVoiceId={player.dubVoiceId}
        dubOffsetSec={player.dubOffsetSec}
        poster={currentEpisode.preview || backdropUrl}
        title={`Episode ${currentEpisode.ordinal}`}
        subtitle={isPipVisible ? displayTitle : ''}
        autoplay={player.autoplay}
        initialTime={player.resumeTime}
        voices={player.voices}
        selectedVoiceId={player.selectedVoiceId}
        preferMaxQuality={true}
        opening={currentEpisode.opening}
        ending={currentEpisode.ending}
        {hasPrev}
        {hasNext}
        hasFallback={player.voices.some((v) => v.id !== player.selectedVoiceId)}
        isPip={isPipVisible}
        keyboardEnabled={Boolean(
          ((router.current === 'player' || router.current === 'watch-together-player') &&
            !player.pipMode) ||
            isPipVisible
        )}
        controlsLocked={player.wtControlsLocked}
        chatOpen={player.wtChatOpen}
        chatUnread={player.wtChatUnread}
        ontogglechat={router.current === 'watch-together-player'
          ? (player.wtChatToggle ?? undefined)
          : undefined}
        onprev={prevEpisode}
        onnext={nextEpisode}
        ontimeprogress={(sec, dur, force) => reportPlaybackProgress(sec, dur, force)}
        onplaybackaction={(ev) => notifyLocalPlayerAction(ev)}
        onselectvoice={(voice, sec) => void switchVoice(voice, sec)}
        onselectdubvoice={(voice) => void selectDubVoice(voice)}
        onduboffsetchange={(offset) => setDubAudioOffset(offset)}
        onfallback={() => void fallbackVoice(false)}
        onpip={() => void handleToggleSystemPip()}
        onexpandpip={() => void handleExpandPip()}
        onclosepip={() => void handleClosePip()}
        onplaychange={setPlayerPlaying}
        onpipdragstart={handlePipDragStart}
        onerror={() => {
          if ((player.release?.provider ?? 'aniliberty') === 'aniliberty') {
            void fallbackVoice(true);
          }
        }}
      />
    {/if}
  </div>
</div>

<!-- Custom rounded-corner Picture-in-Picture floating dock (in-app AND OS-level Always-On-Top) -->
<div
  bind:this={pipShellEl}
  class="pip-floating-shell corner-{player.pipCorner}"
  class:is-visible={isPipVisible && !docPipWindow}
  class:is-os-pip={bindings.osPipActive}
  class:is-dragging={isDragging}
  style:transform={isDragging && !bindings.osPipActive
    ? `translate3d(${dragDx}px, ${dragDy}px, 0)`
    : undefined}
  aria-label="Picture in picture mini-player"
></div>

<style>
  .player-parking {
    position: fixed;
    width: 0;
    height: 0;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    z-index: -1;
  }

  .player-live-node {
    width: 100%;
    height: 100%;
  }

  .pip-floating-shell {
    position: fixed;
    z-index: 9400;
    width: clamp(340px, 27vw, 436px);
    aspect-ratio: 16 / 9;
    border-radius: 18px;
    overflow: hidden;
    clip-path: inset(0 round 18px);
    background: #070707;
    box-shadow:
      0 24px 60px rgba(0, 0, 0, 0.78),
      0 6px 20px rgba(0, 0, 0, 0.52);
    opacity: 0;
    pointer-events: none;
    transform: translate3d(0, 14px, 0) scale(0.95);
    transition:
      opacity 0.24s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
      top 0.3s cubic-bezier(0.22, 1, 0.36, 1),
      right 0.3s cubic-bezier(0.22, 1, 0.36, 1),
      bottom 0.3s cubic-bezier(0.22, 1, 0.36, 1),
      left 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .pip-floating-shell.is-visible {
    opacity: 1;
    pointer-events: auto;
    transform: translate3d(0, 0, 0) scale(1);
  }

  .pip-floating-shell.is-os-pip {
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    aspect-ratio: auto !important;
    border-radius: 15px !important;
    clip-path: inset(0 round 15px) !important;
    box-shadow: none !important;
    transform: none !important;
    transition: none !important;
  }

  .pip-floating-shell.is-dragging {
    transition: opacity 0.18s ease !important;
    cursor: grabbing;
  }

  .pip-floating-shell.corner-bottom-right {
    right: 26px;
    bottom: 26px;
  }

  .pip-floating-shell.corner-bottom-left {
    left: 26px;
    bottom: 26px;
  }

  .pip-floating-shell.corner-top-right {
    right: 26px;
    top: 86px;
  }

  .pip-floating-shell.corner-top-left {
    left: 26px;
    top: 86px;
  }
</style>
