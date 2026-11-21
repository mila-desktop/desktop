<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { settingsState } from '../../app/settings.svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { MorphIcon } from 'morphicons/svelte';
  import {
    ArrowLeft,
    ArrowUp,
    ArrowDown,
    Clock,
    Crown,
    EyeOff,
    HardDriveDownload,
    LayoutGrid,
    LayoutList,
    ListOrdered,
    LogOut,
    PanelRight,
    PictureInPicture2,
    RefreshCw,
    Search,
    Send,
    Settings,
    UserPlus,
    X
  } from 'lucide';

  import MainButton from '../../marlakit/button/MainButton.svelte';
  import ComboBox from '../../marlakit/combo/ComboBox.svelte';
  import type { ComboSection } from '../../marlakit/combo/types';
  import EpisodeThumb from '../anime/EpisodeThumb.svelte';
  import TorrentPopup from '../anime/TorrentPopup.svelte';
  import type { TorrentSearchItem } from '../../api/providers/torrent';
  import { episodeProgressMap, getEpisodeProgress } from '../../app/history.svelte';
  import { auth } from '../../app/auth.svelte';
  import { openFriendsPopup } from '../../app/friends.svelte';
  import { revealBlur } from '../../app/reveal';
  import { navigate } from '../../app/router.svelte';
  import { openSearch } from '../../app/search.svelte';
  import {
    applyRemotePlaybackSync,
    getPlayerPlaybackSnapshot,
    openTorrentStream,
    openWatch,
    player,
    retryWatch,
    selectEpisode,
    setInlinePlayerStage,
    setWatchTogetherChatControl,
    setWatchTogetherControlsLocked,
    setWatchTogetherPlaybackListener
  } from '../../app/player.svelte';
  import {
    computeLiveRoomPosition,
    type RoomControlMode,
    type RoomVisibility
  } from '../../api/watchTogether';
  import {
    leaveWatchRoom,
    sendWatchRoomChat,
    setWatchRoomMedia,
    syncWatchRoomPlayback,
    updateWatchRoomSettings,
    watchTogetherState
  } from '../../app/watchTogether.svelte';
  import { t } from '../../app/i18n.svelte';

  const EP_PAGE_SIZE = 16;
  const EP_VIEW_MODE_KEY = 'mila.anime.episodesViewMode';
  const WT_CHAT_WIDTH_KEY = 'mila.wt.chatWidth';
  const WT_CHAT_HEIGHT_KEY = 'mila.wt.chatHeight';
  const WT_CHAT_PINNED_KEY = 'mila.wt.chatPinned';

  type EpSortKey = 'order' | 'duration' | 'unwatched';
  type ChatResizeDir = 'w' | 'e' | 's' | 'sw' | 'se';

  function readSavedViewMode(key: string, fallback: 'grid' | 'list'): 'grid' | 'list' {
    if (typeof localStorage === 'undefined') return fallback;
    return localStorage.getItem(key) === 'list' ? 'list' : 'grid';
  }

  function readSavedChatWidth(): number {
    if (typeof localStorage === 'undefined') return 320;
    const raw = Number(localStorage.getItem(WT_CHAT_WIDTH_KEY));
    return Number.isFinite(raw) && raw >= 250 && raw <= 540 ? raw : 320;
  }

  function readSavedChatHeight(): number {
    if (typeof localStorage === 'undefined') return 410;
    const raw = Number(localStorage.getItem(WT_CHAT_HEIGHT_KEY));
    return Number.isFinite(raw) && raw >= 240 && raw <= 680 ? raw : 410;
  }

  function readSavedChatPinned(): boolean {
    if (typeof localStorage === 'undefined') return settingsState.wtChatPinned;
    const raw = localStorage.getItem(WT_CHAT_PINNED_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return settingsState.wtChatPinned;
  }

  let viewportW = $state(typeof window !== 'undefined' ? window.innerWidth : 1440);
  let theaterFrameEl = $state<HTMLDivElement | null>(null);
  let playerSectionEl = $state<HTMLElement | null>(null);
  let episodesSectionEl = $state<HTMLElement | null>(null);
  let inlineStageEl = $state<HTMLDivElement | null>(null);
  let chatFeedEl = $state<HTMLDivElement | null>(null);
  let floatPanelEl = $state<HTMLElement | null>(null);

  let chatOpen = $state(settingsState.wtChatAutoOpen);
  let chatPinned = $state(readSavedChatPinned());
  let chatWidthPx = $state(readSavedChatWidth());
  let chatHeightPx = $state(readSavedChatHeight());
  let floatHeightCustom = $state(false);
  let settingsMenuOpen = $state(false);
  let resizingChat = $state(false);
  let resizeDir: ChatResizeDir = 'w';
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 320;
  let resizeStartH = 410;
  let resizeStartLeft = 0;
  let resizeStartTop = 14;

  // Floating chat position offset relative to default top-right anchor
  let floatOffset = $state<{ x: number; y: number } | null>(null);
  let draggingFloat = $state(false);
  let dragStartMouseX = 0;
  let dragStartMouseY = 0;
  let dragStartX = 0;
  let dragStartY = 0;

  let chatDraft = $state('');
  let chatSending = $state(false);
  let lastSeenChatCount = $state(0);
  let brokenAvatars = $state<Record<string, boolean>>({});

  let epViewMode = $state<'grid' | 'list'>(readSavedViewMode(EP_VIEW_MODE_KEY, 'grid'));
  let epSortBy = $state<EpSortKey>('order');
  let epSortDir = $state<'asc' | 'desc'>('asc');
  let epRangeIndex = $state(0);

  let torrentsOpen = $state(false);
  let torrentsLoading = $state(false);
  let torrentsError = $state('');
  let torrentResults = $state<TorrentSearchItem[]>([]);
  let torrentResultsFor = $state('');
  let torrentReqToken = 0;

  const activeRoom = $derived(watchTogetherState.room);
  const myPublicId = $derived(auth.user?.public_id || '');
  const isHost = $derived(
    Boolean(activeRoom && myPublicId && activeRoom.host_public_id === myPublicId)
  );
  const canControlPlayback = $derived(
    !activeRoom || isHost || activeRoom.control_mode === 'everyone'
  );

  const currentShikiId = $derived(player.shikiArt?.id ?? player.target?.shikiId ?? 0);
  const displayTitle = $derived(
    player.shikiArt?.english ||
      player.shikiArt?.name ||
      player.release?.title ||
      player.title ||
      activeRoom?.media?.title ||
      'Anime'
  );
  const roomHeadingTitle = $derived(activeRoom?.title || displayTitle);
  const showAnimeInSubtitle = $derived(
    Boolean(
      displayTitle &&
        displayTitle.trim().toLowerCase() !== roomHeadingTitle.trim().toLowerCase()
    )
  );
  const posterUrl = $derived(
    player.shikiArt?.posterOriginal ||
      player.shikiArt?.posterMain ||
      player.release?.poster ||
      activeRoom?.media?.poster ||
      ''
  );
  const backdropUrl = $derived(
    player.shikiArt?.screenshots[0] || player.release?.banner || posterUrl
  );
  const galleryShots = $derived((player.shikiArt?.screenshots ?? []).slice(0, 6));
  const episodes = $derived(player.release?.episodes ?? []);
  const currentEpisode = $derived(episodes[player.episodeIndex] ?? null);

  const chatMessages = $derived(activeRoom?.chat ?? []);
  const unreadCount = $derived(
    chatOpen ? 0 : Math.max(0, chatMessages.length - lastSeenChatCount)
  );

  const currentVisibility = $derived<RoomVisibility>(
    activeRoom ? activeRoom.visibility : watchTogetherState.draftVisibility
  );
  const currentControlMode = $derived<RoomControlMode>(
    activeRoom ? activeRoom.control_mode : watchTogetherState.draftControlMode
  );
  const currentMaxMembers = $derived<number>(
    activeRoom ? activeRoom.max_members : watchTogetherState.draftMaxMembers
  );

  const settingsComboSections = $derived.by<ComboSection[]>(() => {
    const visLabel =
      currentVisibility === 'public'
        ? 'Public'
        : currentVisibility === 'private'
          ? 'Private'
          : 'Friends';
    const ctrlLabel = currentControlMode === 'everyone' ? 'Everyone controls' : 'Host only';

    return [
      {
        id: 'room-settings',
        title: 'Room settings',
        options: [
          {
            value: 'cat:visibility',
            label: 'Visibility',
            sublabel: visLabel,
            subMinWidth: 192,
            children: [
              {
                value: 'vis:public',
                label: 'Public',
                sublabel: 'Anyone can join',
                selected: currentVisibility === 'public'
              },
              {
                value: 'vis:friends',
                label: 'Friends',
                sublabel: 'Friends can join',
                selected: currentVisibility === 'friends'
              },
              {
                value: 'vis:private',
                label: 'Private',
                sublabel: 'Invite only',
                selected: currentVisibility === 'private'
              }
            ]
          },
          {
            value: 'cat:control',
            label: 'Playback control',
            sublabel: ctrlLabel,
            subMinWidth: 214,
            children: [
              {
                value: 'ctrl:host_only',
                label: 'Host only',
                sublabel: 'Only host controls playback',
                selected: currentControlMode === 'host_only'
              },
              {
                value: 'ctrl:everyone',
                label: 'Everyone controls',
                sublabel: 'All members can pause & seek',
                selected: currentControlMode === 'everyone'
              }
            ]
          },
          {
            value: 'cat:seats',
            label: 'Seats',
            sublabel: `${currentMaxMembers} seats`,
            subMinWidth: 146,
            children: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
              value: `seats:${n}`,
              label: `${n} seats`,
              selected: currentMaxMembers === n
            }))
          }
        ]
      }
    ];
  });

  function handleSettingsSelect(rawValue: string | number) {
    const val = String(rawValue);
    if (val.startsWith('vis:')) {
      const next = val.slice('vis:'.length) as RoomVisibility;
      if (activeRoom && isHost) {
        void updateWatchRoomSettings({ visibility: next });
      } else if (!activeRoom) {
        watchTogetherState.draftVisibility = next;
      }
    } else if (val.startsWith('ctrl:')) {
      const next = val.slice('ctrl:'.length) as RoomControlMode;
      if (activeRoom && isHost) {
        void updateWatchRoomSettings({ control_mode: next });
      } else if (!activeRoom) {
        watchTogetherState.draftControlMode = next;
      }
    } else if (val.startsWith('seats:')) {
      const n = Number(val.slice('seats:'.length));
      if (Number.isFinite(n)) {
        if (activeRoom && isHost) {
          const safe = Math.max(activeRoom.members.length, n);
          void updateWatchRoomSettings({ max_members: safe });
        } else if (!activeRoom) {
          watchTogetherState.draftMaxMembers = n;
        }
      }
    }
  }

  function scrollToEpisodes() {
    episodesSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $effect(() => {
    setInlinePlayerStage(inlineStageEl);
    return () => {
      setInlinePlayerStage(null);
    };
  });

  $effect(() => {
    setWatchTogetherChatControl({
      open: chatOpen,
      unread: unreadCount,
      toggle: () => {
        chatOpen = !chatOpen;
      }
    });
    return () => {
      setWatchTogetherChatControl(null);
    };
  });

  $effect(() => {
    const count = chatMessages.length;
    if (chatOpen) {
      lastSeenChatCount = count;
      void tick().then(() => {
        if (chatFeedEl) {
          chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
        }
      });
    }
  });

  // Enforce host-only playback lock on viewers when room control_mode === 'host_only'
  $effect(() => {
    setWatchTogetherControlsLocked(Boolean(activeRoom && !canControlPlayback));
    return () => {
      setWatchTogetherControlsLocked(false);
    };
  });

  // Host resolved media/episode writeback so viewer always gets exact releaseAlias + shikiId + episode
  let lastHostWritebackKey = '';
  $effect(() => {
    const rm = activeRoom;
    const rel = player.release;
    if (!rm || !isHost || !rel || player.loading) return;
    const epOrd = currentEpisode?.ordinal ?? (player.episodeIndex + 1);
    const shikiId = currentShikiId || rm.media?.shiki_id || 0;
    const wbKey = `${rm.room_id}:${rel.alias}:${shikiId}:${epOrd}`;
    if (wbKey === lastHostWritebackKey) return;

    const needsSync =
      rm.media?.release_alias !== rel.alias ||
      (shikiId > 0 && !rm.media?.shiki_id) ||
      (rm.media?.episode_ordinal || 1) !== epOrd;

    lastHostWritebackKey = wbKey;
    if (needsSync) {
      void setWatchRoomMedia({
        shiki_id: shikiId || undefined,
        release_alias: rel.alias,
        title: displayTitle,
        poster: posterUrl,
        episode_ordinal: epOrd,
        episode_index: player.episodeIndex,
        search_queries: player.target?.searchQueries ?? rm.media?.search_queries ?? [displayTitle]
      }).catch(() => {});
    }
  });

  // Ensure media is loaded into player if room media changes or user entered WatchTogetherPlayerPage
  let lastSyncedMediaKey = '';
  $effect(() => {
    const rm = activeRoom;
    if (!rm || !rm.media?.title || player.loading) return;
    const mediaKey = `${rm.room_id}:${rm.media.shiki_id ?? 0}:${rm.media.release_alias ?? ''}:${rm.media.title}:${rm.media.episode_ordinal || 1}`;
    if (mediaKey === lastSyncedMediaKey) return;
    lastSyncedMediaKey = mediaKey;

    const curTitle = (player.release?.title || player.title || '').trim().toLowerCase();
    const targetTitle = rm.media.title.trim().toLowerCase();
    const targetStateTitle = (player.target?.title || '').trim().toLowerCase();
    const dispTitle = (displayTitle || '').trim().toLowerCase();
    const sameAnime =
      (rm.media.shiki_id && currentShikiId === rm.media.shiki_id) ||
      (rm.media.release_alias && player.release?.alias === rm.media.release_alias) ||
      (curTitle && curTitle === targetTitle) ||
      (targetStateTitle && targetStateTitle === targetTitle) ||
      (dispTitle && dispTitle === targetTitle);

    if (!sameAnime || !player.release) {
      void openWatch(
        {
          title: rm.media.title,
          shikiId: rm.media.shiki_id,
          releaseAlias: rm.media.release_alias,
          searchQueries: rm.media.search_queries ?? [rm.media.title]
        },
        {
          targetPage: 'watch-together-player',
          autoPlay: !rm.playback?.paused,
          episodeOrdinal: rm.media.episode_ordinal || 1,
          resumeTime: rm.playback ? computeLiveRoomPosition(rm.playback) : 0
        }
      );
    } else if (rm.media.episode_ordinal && currentEpisode?.ordinal !== rm.media.episode_ordinal) {
      const idx = episodes.findIndex((e) => e.ordinal === rm.media.episode_ordinal);
      if (idx >= 0 && idx !== player.episodeIndex) {
        selectEpisode(idx);
      }
    }
  });

  // Sync incoming room playback state (pause/resume/seek/rate) & reconcile via Rave-style smooth playbackRate catch-up
  let lastAppliedPlaybackSeq = 0;
  let suppressOutgoingPlaySyncUntil = 0;
  let lastHostHeartbeatAt = 0;

  function reconcileViewerPlayback(forceApply = false) {
    const rm = activeRoom;
    const pb = rm?.playback;
    if (!rm || !pb) return;
    if (pb.updated_by && pb.updated_by === myPublicId && !forceApply) return;
    if (player.loading) return;
    const snap = getPlayerPlaybackSnapshot();
    if (!snap || !snap.ready) return;

    const targetPos = computeLiveRoomPosition(pb);
    const targetRate = pb.playback_rate && pb.playback_rate > 0 ? pb.playback_rate : 1;
    suppressOutgoingPlaySyncUntil = Date.now() + 800;
    applyRemotePlaybackSync(pb.paused, targetPos, targetRate);
  }

  $effect(() => {
    const rm = activeRoom;
    const pb = rm?.playback;
    if (!rm || !pb) return;
    if (pb.seq <= lastAppliedPlaybackSeq) return;
    lastAppliedPlaybackSeq = pb.seq;
    if (pb.updated_by && pb.updated_by === myPublicId) return;
    reconcileViewerPlayback(true);
  });

  // Broadcast immediate play / pause / seek / speed changes when user is allowed to control playback
  $effect(() => {
    if (!activeRoom || !canControlPlayback) {
      setWatchTogetherPlaybackListener(null);
      return;
    }
    setWatchTogetherPlaybackListener((ev) => {
      if (Date.now() < suppressOutgoingPlaySyncUntil) return;
      lastHostHeartbeatAt = Date.now();
      void syncWatchRoomPlayback({
        paused: ev.paused,
        position_sec: ev.currentTime,
        playback_rate: ev.playbackRate
      }).catch(() => {});
    });
    return () => {
      setWatchTogetherPlaybackListener(null);
    };
  });

  // Continuous Rave-style sync loop:
  // - Viewers run smooth playbackRate PLL steering every 500ms (no hard seeks unless >4.5s off)
  // - Host only sends a quiet keep-alive heartbeat every 8s (or if host genuinely jumped >=2.4s)
  $effect(() => {
    if (!activeRoom) return;
    const timer = window.setInterval(() => {
      const rm = activeRoom;
      if (!rm) return;
      if (isHost) {
        if (player.loading || Date.now() < suppressOutgoingPlaySyncUntil) return;
        const snap = getPlayerPlaybackSnapshot();
        if (!snap || !snap.ready) return;
        const pb = rm.playback;
        const curRate = snap.playbackRate || 1;
        const pbRate = pb?.playback_rate || 1;
        const pbPos = pb ? computeLiveRoomPosition(pb) : 0;
        const posDiff = Math.abs(snap.currentTime - pbPos);
        const now = Date.now();
        const needsHeartbeat = !snap.paused && now - lastHostHeartbeatAt >= 8000;
        const stateDiff =
          !pb ||
          snap.paused !== pb.paused ||
          Math.abs(curRate - pbRate) > 0.02 ||
          posDiff >= 2.4 ||
          needsHeartbeat;
        if (stateDiff) {
          lastHostHeartbeatAt = now;
          void syncWatchRoomPlayback({
            paused: snap.paused,
            position_sec: snap.currentTime,
            playback_rate: curRate
          }).catch(() => {});
        }
      } else {
        reconcileViewerPlayback(false);
      }
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  });

  function toggleChatPinned() {
    chatPinned = !chatPinned;
    if (!chatPinned) {
      floatOffset = null;
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(WT_CHAT_PINNED_KEY, chatPinned ? '1' : '0');
      } catch {
        // ignore
      }
    }
  }

  function handleResizePointerDown(e: PointerEvent, dir: ChatResizeDir = 'w') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizingChat = true;
    resizeDir = dir;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = chatWidthPx;
    resizeStartH = chatHeightPx;
    if (!chatPinned && floatPanelEl && theaterFrameEl) {
      const frameRect = theaterFrameEl.getBoundingClientRect();
      const panelRect = floatPanelEl.getBoundingClientRect();
      resizeStartW = panelRect.width;
      resizeStartH = panelRect.height;
      resizeStartLeft = floatOffset?.x ?? Math.max(8, panelRect.left - frameRect.left);
      resizeStartTop = floatOffset?.y ?? Math.max(8, panelRect.top - frameRect.top);
      chatHeightPx = Math.round(panelRect.height);
    }
    (e.currentTarget as HTMLElement)?.setPointerCapture(e.pointerId);
  }

  function handleResizePointerMove(e: PointerEvent) {
    if (!resizingChat) return;
    if (chatPinned) {
      const delta = resizeStartX - e.clientX;
      const maxW = Math.min(560, Math.floor(viewportW * 0.46));
      chatWidthPx = Math.max(250, Math.min(maxW, resizeStartW + delta));
      return;
    }

    const frameW = theaterFrameEl?.clientWidth || viewportW;
    const frameH = theaterFrameEl?.clientHeight || 640;
    let nextW = chatWidthPx;
    let nextX = floatOffset?.x ?? resizeStartLeft;
    const nextY = floatOffset?.y ?? resizeStartTop;

    if (resizeDir.includes('w')) {
      const rightEdge = resizeStartLeft + resizeStartW;
      const maxW = Math.min(560, Math.max(250, rightEdge - 8));
      nextW = Math.max(250, Math.min(maxW, resizeStartW + (resizeStartX - e.clientX)));
      nextX = Math.max(8, rightEdge - nextW);
      chatWidthPx = Math.round(nextW);
      if (floatOffset) {
        floatOffset = { x: Math.round(nextX), y: Math.round(nextY) };
      }
    } else if (resizeDir.includes('e')) {
      const maxW = Math.min(560, Math.max(250, frameW - resizeStartLeft - 8));
      nextW = Math.max(250, Math.min(maxW, resizeStartW + (e.clientX - resizeStartX)));
      chatWidthPx = Math.round(nextW);
      floatOffset = { x: Math.round(resizeStartLeft), y: Math.round(nextY) };
    }

    if (resizeDir.includes('s')) {
      const maxH = Math.min(680, Math.max(240, frameH - nextY - 12));
      const nextH = Math.max(240, Math.min(maxH, resizeStartH + (e.clientY - resizeStartY)));
      chatHeightPx = Math.round(nextH);
      floatHeightCustom = true;
    }
  }

  function handleResizePointerUp(e: PointerEvent) {
    if (!resizingChat) return;
    resizingChat = false;
    try {
      (e.currentTarget as HTMLElement)?.releasePointerCapture(e.pointerId);
      localStorage.setItem(WT_CHAT_WIDTH_KEY, String(Math.round(chatWidthPx)));
      localStorage.setItem(WT_CHAT_HEIGHT_KEY, String(Math.round(chatHeightPx)));
    } catch {
      // ignore
    }
  }

  function handleFloatDragStart(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input')) return;
    if (!floatPanelEl || !theaterFrameEl) return;
    e.preventDefault();

    const frameRect = theaterFrameEl.getBoundingClientRect();
    const panelRect = floatPanelEl.getBoundingClientRect();
    const curX = floatOffset?.x ?? panelRect.left - frameRect.left;
    const curY = floatOffset?.y ?? panelRect.top - frameRect.top;

    floatOffset = { x: curX, y: curY };
    draggingFloat = true;
    dragStartMouseX = e.clientX;
    dragStartMouseY = e.clientY;
    dragStartX = curX;
    dragStartY = curY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleFloatDragMove(e: PointerEvent) {
    if (!draggingFloat || !theaterFrameEl || !floatPanelEl) return;
    const frameRect = theaterFrameEl.getBoundingClientRect();
    const panelRect = floatPanelEl.getBoundingClientRect();
    const maxX = Math.max(8, frameRect.width - panelRect.width - 8);
    const maxY = Math.max(8, frameRect.height - panelRect.height - 8);
    const nx = Math.max(8, Math.min(maxX, dragStartX + (e.clientX - dragStartMouseX)));
    const ny = Math.max(8, Math.min(maxY, dragStartY + (e.clientY - dragStartMouseY)));
    floatOffset = { x: nx, y: ny };
  }

  function handleFloatDragEnd(e: PointerEvent) {
    if (!draggingFloat) return;
    draggingFloat = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  async function handleSendChat(e?: Event) {
    e?.preventDefault();
    const text = chatDraft.trim();
    if (!text || !activeRoom || chatSending) return;
    chatDraft = '';
    chatSending = true;
    try {
      await sendWatchRoomChat(text, 'chat');
      await tick();
      if (chatFeedEl) {
        chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
      }
    } catch {
      chatDraft = text;
    } finally {
      chatSending = false;
    }
  }

  function formatChatTime(ms: number): string {
    if (!ms) return '';
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  async function handleLeaveRoom() {
    await leaveWatchRoom();
    navigate('watch-together');
  }

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

  onDestroy(() => {
    torrentReqToken += 1;
    torrentResults = [];
    setWatchTogetherControlsLocked(false);
    setWatchTogetherPlaybackListener(null);
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
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(EP_VIEW_MODE_KEY, mode);
    } catch {
      // ignore
    }
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

  async function handleChooseEpisode(index: number) {
    selectEpisode(index);
    scrollToPlayer();
    const ep = episodes[index];
    if (activeRoom && canControlPlayback && ep) {
      await setWatchRoomMedia({
        ...activeRoom.media,
        shiki_id: currentShikiId || activeRoom.media.shiki_id,
        release_alias: player.release?.alias || activeRoom.media.release_alias,
        title: displayTitle,
        poster: posterUrl,
        episode_ordinal: ep.ordinal,
        episode_index: index
      }).catch(() => {});
    }
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

<div class="wt-player-page">
  <section
    class="wt-player-section"
    bind:this={playerSectionEl}
    aria-label="Watch Together video theater"
  >
    <!-- Top Room Header Bar (above the rounded full-page player, matching Hero-style 100vh first fold) -->
    <header class="wt-stage-topbar">
      <div class="wt-topbar-left">
        <button
          type="button"
          class="wt-room-back-trigger"
          title="Back to room lobby"
          onclick={() => navigate('watch-together')}
        >
          <h1 class="wt-room-main-title">{roomHeadingTitle}</h1>
        </button>
        <span class="wt-seat-inline">
          {(activeRoom?.members.length ?? 1) + (activeRoom?.pending?.length ?? 0)}/{activeRoom?.max_members ?? currentMaxMembers}
        </span>
      </div>

      <!-- Center Mila-native Now Playing & Room Control Capsule (no AI-slop voice/mic pills) -->
      <div class="wt-topbar-center">
        <button
          type="button"
          class="wt-now-playing-btn"
          title={episodes.length > 0 ? 'Scroll to episodes' : displayTitle}
          onclick={scrollToEpisodes}
        >
          <span class="wt-np-title">{displayTitle}</span>
        </button>

        {#if canControlPlayback}
          <button
            type="button"
            class="wt-center-icon-btn"
            title="Change anime"
            aria-label="Change anime"
            onclick={() => openSearch()}
          >
            <MorphIcon icon={Search} size={14} strokeWidth={1.9} />
          </button>
        {/if}

        <ComboBox
          bind:open={settingsMenuOpen}
          sections={settingsComboSections}
          ariaLabel="Room settings"
          placement="bottom-center"
          minWidth={212}
          onselect={(opt) => handleSettingsSelect(opt.value)}
        >
          {#snippet trigger({ open, toggle })}
            <button
              type="button"
              class="wt-center-icon-btn"
              class:is-active={open}
              title="Room settings"
              aria-label="Room settings"
              aria-expanded={open}
              onclick={toggle}
            >
              <MorphIcon icon={Settings} size={14} strokeWidth={1.9} />
            </button>
          {/snippet}
        </ComboBox>

        {#if activeRoom}
          <button
            type="button"
            class="wt-center-icon-btn is-leave"
            title="Leave room"
            aria-label="Leave room"
            onclick={() => void handleLeaveRoom()}
          >
            <MorphIcon icon={LogOut} size={14} strokeWidth={1.9} />
          </button>
        {/if}
      </div>

      <!-- Right overlapping member & pending avatars -->
      <div class="wt-topbar-right">
        <div class="wt-top-avatars" aria-label="Room members">
          {#each activeRoom?.members ?? [] as m, idx (m.public_id)}
            <div
              class="wt-top-av-circle"
              style:z-index={idx + 1}
              title={m.role === 'host' ? `@${m.username} (Host)` : `@${m.username}`}
            >
              {#if m.avatar_url && !brokenAvatars[`top-${m.public_id}`]}
                <img
                  src={m.avatar_url}
                  alt={m.username}
                  referrerpolicy="no-referrer"
                  onerror={() => {
                    brokenAvatars = { ...brokenAvatars, [`top-${m.public_id}`]: true };
                  }}
                />
              {:else}
                <span>{(m.name || m.username || 'U').slice(0, 1).toUpperCase()}</span>
              {/if}

              {#if m.role === 'host'}
                <span class="wt-top-av-badge is-crown">
                  <MorphIcon icon={Crown} size={8} strokeWidth={2.5} />
                </span>
              {:else}
                <span class="wt-top-av-badge is-online"></span>
              {/if}
            </div>
          {/each}

          {#each activeRoom?.pending ?? [] as p, pIdx (p.public_id)}
            <div
              class="wt-top-av-circle is-pending"
              style:z-index={(activeRoom?.members.length ?? 1) + pIdx + 1}
              title={`Pending invite: @${p.username}`}
            >
              {#if p.avatar_url && !brokenAvatars[`top-p-${p.public_id}`]}
                <img
                  src={p.avatar_url}
                  alt={p.username}
                  referrerpolicy="no-referrer"
                  onerror={() => {
                    brokenAvatars = { ...brokenAvatars, [`top-p-${p.public_id}`]: true };
                  }}
                />
              {:else}
                <span>{(p.name || p.username || 'U').slice(0, 1).toUpperCase()}</span>
              {/if}
            </div>
          {/each}
        </div>

        <button
          type="button"
          class="wt-top-invite-btn"
          title="Invite friends"
          aria-label="Invite friends"
          onclick={() => openFriendsPopup()}
        >
          <MorphIcon icon={UserPlus} size={15} strokeWidth={1.9} />
        </button>
      </div>
    </header>

    <!-- data-player-fs-root ensures fullscreen includes BOTH the video player and split-screen / floating chat -->
    <div
      bind:this={theaterFrameEl}
      class="wt-theater-frame"
      class:is-split-chat={chatOpen && chatPinned}
      data-player-fs-root
    >
      <div class="wt-video-stage">
        {#if player.loading}
          <div class="stage-state">
            <div class="spinner"></div>
            <span>{t('anime.loadingRelease')}</span>
          </div>
        {:else if player.error}
          <div class="stage-state">
            <p class="error-text">{player.error}</p>
            <MainButton onclick={retryWatch}>
              {#snippet icon()}
                <MorphIcon icon={RefreshCw} size={15} strokeWidth={2} />
              {/snippet}
              {t('anime.tryAgain')}
            </MainButton>
          </div>
        {:else if !currentEpisode}
          <div class="stage-state">
            <span>{t('anime.noPlayableEpisodes')}</span>
          </div>
        {/if}

        <div
          bind:this={inlineStageEl}
          class="player-inline-slot"
          class:is-hidden={!currentEpisode || player.loading || Boolean(player.error) || player.pipMode}
        ></div>

        <!-- Floating draggable chat window (inside video stage so it works in fullscreen too) -->
        {#if chatOpen && !chatPinned}
          <aside
            bind:this={floatPanelEl}
            class="wt-chat-panel is-floating"
            class:is-dragging-float={draggingFloat}
            style:width="{chatWidthPx}px"
            style:left={floatOffset ? `${floatOffset.x}px` : undefined}
            style:top={floatOffset ? `${floatOffset.y}px` : '14px'}
            style:right={floatOffset ? 'auto' : '14px'}
            style:bottom={floatOffset || floatHeightCustom ? 'auto' : '64px'}
            style:height={floatOffset || floatHeightCustom ? `${chatHeightPx}px` : undefined}
            in:revealBlur={{ duration: 240, y: 8, scale: 0.96, blur: 8 }}
            out:revealBlur={{ duration: 180, y: 6, scale: 0.97, blur: 6 }}
          >
            <!-- Multi-edge & corner resize handles for floating chat -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="wt-float-resizer is-w"
              onpointerdown={(e) => handleResizePointerDown(e, 'w')}
              onpointermove={handleResizePointerMove}
              onpointerup={handleResizePointerUp}
              onpointercancel={handleResizePointerUp}
            ></div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="wt-float-resizer is-e"
              onpointerdown={(e) => handleResizePointerDown(e, 'e')}
              onpointermove={handleResizePointerMove}
              onpointerup={handleResizePointerUp}
              onpointercancel={handleResizePointerUp}
            ></div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="wt-float-resizer is-s"
              onpointerdown={(e) => handleResizePointerDown(e, 's')}
              onpointermove={handleResizePointerMove}
              onpointerup={handleResizePointerUp}
              onpointercancel={handleResizePointerUp}
            ></div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="wt-float-resizer is-sw"
              onpointerdown={(e) => handleResizePointerDown(e, 'sw')}
              onpointermove={handleResizePointerMove}
              onpointerup={handleResizePointerUp}
              onpointercancel={handleResizePointerUp}
            ></div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="wt-float-resizer is-se"
              onpointerdown={(e) => handleResizePointerDown(e, 'se')}
              onpointermove={handleResizePointerMove}
              onpointerup={handleResizePointerUp}
              onpointercancel={handleResizePointerUp}
            ></div>

            <!-- Draggable header bar -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="wt-chat-head is-draggable"
              onpointerdown={handleFloatDragStart}
              onpointermove={handleFloatDragMove}
              onpointerup={handleFloatDragEnd}
              onpointercancel={handleFloatDragEnd}
            >
              <span class="wt-chat-title">{activeRoom?.title || 'Room'} chat</span>

              <div class="wt-chat-head-right">
                <div class="wt-chat-avatars" aria-label="Room members">
                  {#each (activeRoom?.members ?? []).slice(0, 5) as m, idx (m.public_id)}
                    <div
                      class="wt-chat-av-circle"
                      style:z-index={idx + 1}
                      title="@{m.username}"
                    >
                      {#if m.avatar_url && !brokenAvatars[m.public_id]}
                        <img
                          src={m.avatar_url}
                          alt={m.username}
                          referrerpolicy="no-referrer"
                          onerror={() => {
                            brokenAvatars = { ...brokenAvatars, [m.public_id]: true };
                          }}
                        />
                      {:else}
                        <span>{(m.name || m.username || 'U').slice(0, 1).toUpperCase()}</span>
                      {/if}
                    </div>
                  {/each}
                </div>

                <button
                  type="button"
                  class="wt-chat-icon-btn"
                  title="Dock chat to right split-screen"
                  aria-label="Dock chat to right split-screen"
                  onclick={toggleChatPinned}
                >
                  <MorphIcon icon={PanelRight} size={14} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  class="wt-chat-icon-btn"
                  title="Close chat"
                  aria-label="Close chat"
                  onclick={() => (chatOpen = false)}
                >
                  <MorphIcon icon={X} size={15} strokeWidth={1.8} />
                </button>
              </div>
            </div>

            <div class="wt-chat-feed" bind:this={chatFeedEl}>
              {#if chatMessages.length === 0}
                <div class="wt-chat-empty">Say something to the room…</div>
              {:else}
                {#each chatMessages as msg (msg.id)}
                  {#if msg.kind === 'system'}
                    {#if settingsState.wtShowSystemMsgs}
                      <div class="wt-msg-system">
                        {msg.text}
                      </div>
                    {/if}
                  {:else}
                    {@const isMine = msg.sender_public_id === myPublicId}
                    <div class="wt-msg-item" class:is-mine={isMine}>
                      {#if isMine}
                        <div class="wt-bubble-mine">
                          <span class="wt-bubble-text">{msg.text}</span>
                        </div>
                      {:else}
                        <div class="wt-bubble-other">
                          <div class="wt-bubble-av" title="@{msg.sender_username}">
                            {#if msg.avatar_url && !brokenAvatars[`msg-${msg.id}`]}
                              <img
                                src={msg.avatar_url}
                                alt={msg.sender_username}
                                referrerpolicy="no-referrer"
                                onerror={() => {
                                  brokenAvatars = { ...brokenAvatars, [`msg-${msg.id}`]: true };
                                }}
                              />
                            {:else}
                              <span>{(msg.sender_name || msg.sender_username || 'U').slice(0, 1).toUpperCase()}</span>
                            {/if}
                          </div>
                          <span class="wt-bubble-text">{msg.text}</span>
                        </div>
                      {/if}
                      <span class="wt-msg-time">{formatChatTime(msg.created_at_ms)}</span>
                    </div>
                  {/if}
                {/each}
              {/if}
            </div>

            <form class="wt-chat-form" onsubmit={handleSendChat}>
              <input
                type="text"
                class="wt-chat-input"
                bind:value={chatDraft}
                placeholder="Type something..."
                maxlength={400}
              />
              <button
                type="submit"
                class="wt-chat-send"
                disabled={!chatDraft.trim() || chatSending}
                aria-label="Send message"
              >
                <MorphIcon icon={Send} size={13.5} strokeWidth={2} />
              </button>
            </form>
          </aside>
        {/if}
      </div>

      <!-- Smoothly Animated Split-Screen Resizable Chat on the Right -->
      {#if chatPinned}
        <div
          class="wt-split-shell"
          class:is-open={chatOpen}
          class:is-dragging={resizingChat}
          style:width={chatOpen ? `${chatWidthPx}px` : '0px'}
          aria-hidden={!chatOpen}
        >
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="wt-split-resizer"
            class:is-dragging={resizingChat}
            title="Drag to resize chat"
            onpointerdown={handleResizePointerDown}
            onpointermove={handleResizePointerMove}
            onpointerup={handleResizePointerUp}
            onpointercancel={handleResizePointerUp}
          >
            <span class="wt-resizer-grip"></span>
          </div>

          <aside class="wt-chat-panel is-split">
            <div class="wt-chat-head">
              <span class="wt-chat-title">{activeRoom?.title || 'Room'} chat</span>

              <div class="wt-chat-head-right">
                <div class="wt-chat-avatars" aria-label="Room members">
                  {#each (activeRoom?.members ?? []).slice(0, 5) as m, idx (m.public_id)}
                    <div
                      class="wt-chat-av-circle"
                      style:z-index={idx + 1}
                      title="@{m.username}"
                    >
                      {#if m.avatar_url && !brokenAvatars[m.public_id]}
                        <img
                          src={m.avatar_url}
                          alt={m.username}
                          referrerpolicy="no-referrer"
                          onerror={() => {
                            brokenAvatars = { ...brokenAvatars, [m.public_id]: true };
                          }}
                        />
                      {:else}
                        <span>{(m.name || m.username || 'U').slice(0, 1).toUpperCase()}</span>
                      {/if}
                    </div>
                  {/each}
                </div>

                <button
                  type="button"
                  class="wt-chat-icon-btn"
                  title="Undock to floating chat"
                  aria-label="Undock to floating chat"
                  onclick={toggleChatPinned}
                >
                  <MorphIcon icon={PictureInPicture2} size={14} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  class="wt-chat-icon-btn"
                  title="Close chat"
                  aria-label="Close chat"
                  onclick={() => (chatOpen = false)}
                >
                  <MorphIcon icon={X} size={15} strokeWidth={1.8} />
                </button>
              </div>
            </div>

            <div class="wt-chat-feed" bind:this={chatFeedEl}>
              {#if chatMessages.length === 0}
                <div class="wt-chat-empty">Say something to the room…</div>
              {:else}
                {#each chatMessages as msg (msg.id)}
                  {#if msg.kind === 'system'}
                    {#if settingsState.wtShowSystemMsgs}
                      <div class="wt-msg-system">
                        {msg.text}
                      </div>
                    {/if}
                  {:else}
                    {@const isMine = msg.sender_public_id === myPublicId}
                    <div class="wt-msg-item" class:is-mine={isMine}>
                      {#if isMine}
                        <div class="wt-bubble-mine">
                          <span class="wt-bubble-text">{msg.text}</span>
                        </div>
                      {:else}
                        <div class="wt-bubble-other">
                          <div class="wt-bubble-av" title="@{msg.sender_username}">
                            {#if msg.avatar_url && !brokenAvatars[`msg-${msg.id}`]}
                              <img
                                src={msg.avatar_url}
                                alt={msg.sender_username}
                                referrerpolicy="no-referrer"
                                onerror={() => {
                                  brokenAvatars = { ...brokenAvatars, [`msg-${msg.id}`]: true };
                                }}
                              />
                            {:else}
                              <span>{(msg.sender_name || msg.sender_username || 'U').slice(0, 1).toUpperCase()}</span>
                            {/if}
                          </div>
                          <span class="wt-bubble-text">{msg.text}</span>
                        </div>
                      {/if}
                      <span class="wt-msg-time">{formatChatTime(msg.created_at_ms)}</span>
                    </div>
                  {/if}
                {/each}
              {/if}
            </div>

            <form class="wt-chat-form" onsubmit={handleSendChat}>
              <input
                type="text"
                class="wt-chat-input"
                bind:value={chatDraft}
                placeholder="Type something..."
                maxlength={400}
              />
              <button
                type="submit"
                class="wt-chat-send"
                disabled={!chatDraft.trim() || chatSending}
                aria-label="Send message"
              >
                <MorphIcon icon={Send} size={13.5} strokeWidth={2} />
              </button>
            </form>
          </aside>
        </div>
      {/if}
    </div>
  </section>

  <!-- Below-the-fold Episode Browser (revealed on scroll, just like Home below Hero) -->
  <div class="wt-player-body" bind:this={episodesSectionEl}>
    {#if episodes.length > 0}
      <section class="episodes-section" aria-label={t('anime.episodes')}>
        <div class="section-head">
          <div class="section-head-left">
            <button
              type="button"
              class="episodes-back-btn"
              aria-label="Back to room lobby"
              title="Back to room overview"
              onclick={() => navigate('watch-together')}
            >
              <MorphIcon icon={ArrowLeft} size={19} strokeWidth={2} />
            </button>
            <h2 class="section-heading">{t('anime.episodes')}</h2>
            <span class="section-count">{episodes.length}</span>
          </div>

          <div class="range-tabs">
            {#if episodeRanges.length > 1}
              {#each episodeRanges as r, idx (r.label)}
                <button
                  type="button"
                  class="range-pill"
                  class:is-active={idx === epRangeIndex}
                  onclick={() => {
                    epRangeIndex = idx;
                  }}
                >
                  {r.label}
                </button>
              {/each}
            {/if}

            <button
              type="button"
              class="range-pill torrent-toggle-pill"
              class:is-active={torrentsOpen}
              onclick={() => void toggleTorrentsDrawer()}
            >
              <MorphIcon icon={HardDriveDownload} size={14} strokeWidth={1.9} />
              <span>Torrents</span>
            </button>

            <div class="lib-sort-group" role="group" aria-label="Sort episodes">
              <button
                type="button"
                class="sort-chip-btn"
                class:active={epSortBy === 'order'}
                title="Episode number"
                onclick={() => toggleEpSort('order')}
              >
                <MorphIcon icon={ListOrdered} size={14} strokeWidth={1.7} />
                {#if epSortBy === 'order'}
                  <MorphIcon
                    icon={epSortDir === 'asc' ? ArrowUp : ArrowDown}
                    size={11}
                    strokeWidth={2.1}
                    spring="snappy"
                  />
                {/if}
              </button>

              <button
                type="button"
                class="sort-chip-btn"
                class:active={epSortBy === 'unwatched'}
                title="Unwatched first"
                onclick={() => toggleEpSort('unwatched')}
              >
                <MorphIcon icon={EyeOff} size={14} strokeWidth={1.7} />
                {#if epSortBy === 'unwatched'}
                  <MorphIcon
                    icon={epSortDir === 'asc' ? ArrowUp : ArrowDown}
                    size={11}
                    strokeWidth={2.1}
                    spring="snappy"
                  />
                {/if}
              </button>

              <button
                type="button"
                class="sort-chip-btn"
                class:active={epSortBy === 'duration'}
                title="Duration"
                onclick={() => toggleEpSort('duration')}
              >
                <MorphIcon icon={Clock} size={14} strokeWidth={1.7} />
                {#if epSortBy === 'duration'}
                  <MorphIcon
                    icon={epSortDir === 'asc' ? ArrowUp : ArrowDown}
                    size={11}
                    strokeWidth={2.1}
                    spring="snappy"
                  />
                {/if}
              </button>
            </div>

            <div
              class="ep-view-modes"
              class:is-grid={epViewMode === 'grid'}
              role="group"
              aria-label="Episode view mode"
            >
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
                onchoose={() => void handleChooseEpisode(entry.idx)}
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
                onchoose={() => void handleChooseEpisode(entry.idx)}
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
  onclose={() => {
    torrentsOpen = false;
  }}
  onselect={(item) => void handleLaunchTorrent(item)}
/>

<style>
  .wt-player-page {
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

  .wt-player-section {
    position: relative;
    width: 100%;
    height: 100vh;
    min-height: 100vh;
    padding: calc(var(--header-height, 48px) + 6px) var(--page-pad-x, 16px)
      var(--page-pad-x, 16px);
    margin: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* Top Room Bar above the rounded full-page video player */
  .wt-stage-topbar {
    position: relative;
    z-index: 80;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    min-height: 40px;
    flex-shrink: 0;
  }

  .wt-topbar-left {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
    justify-self: start;
  }

  .wt-room-back-trigger {
    padding: 0;
    border: none;
    background: transparent;
    color: #ffffff;
    cursor: pointer;
    min-width: 0;
    display: inline-flex;
    align-items: baseline;
    transition: opacity 0.18s ease;
  }

  .wt-room-back-trigger:hover {
    opacity: 0.82;
  }

  .wt-topbar-center {
    justify-self: center;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 36px;
    padding: 0 5px 0 13px;
    border-radius: 999px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.055));
    max-width: min(440px, 44vw);
    min-width: 0;
  }

  .wt-now-playing-btn {
    padding: 0 4px 0 0;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.88);
    display: inline-flex;
    align-items: center;
    min-width: 0;
    cursor: pointer;
    transition: color 0.16s ease;
  }

  .wt-now-playing-btn:hover {
    color: #ffffff;
  }

  .wt-np-title {
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: clamp(90px, 18vw, 230px);
  }

  @media (max-width: 1080px) {
    .wt-topbar-center {
      padding: 0 5px;
    }

    .wt-now-playing-btn {
      display: none;
    }
  }

  .wt-center-icon-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.56);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background-color 0.16s ease,
      color 0.16s ease;
  }

  .wt-center-icon-btn:hover:not(:disabled),
  .wt-center-icon-btn.is-active:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .wt-center-icon-btn:disabled {
    opacity: 0.36;
    cursor: default;
  }

  .wt-center-icon-btn.is-leave:hover {
    background: rgba(255, 92, 92, 0.16);
    color: #ff9c9c;
  }

  .wt-topbar-right {
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .wt-top-avatars {
    display: inline-flex;
    align-items: center;
  }

  .wt-top-av-circle {
    position: relative;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    margin-left: -7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 11.5px;
    font-weight: 700;
    color: #ffffff;
    box-shadow: 0 0 0 2px var(--mila-app-canvas, #0c0c0c);
    flex-shrink: 0;
  }

  .wt-top-av-circle:first-child {
    margin-left: 0;
  }

  .wt-top-av-circle.is-pending {
    opacity: 0.56;
  }

  .wt-top-av-circle img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .wt-top-av-badge {
    position: absolute;
    right: -1px;
    bottom: -1px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--mila-app-canvas, #0c0c0c);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .wt-top-av-badge.is-crown {
    width: 13px;
    height: 13px;
    background: #e5c158;
    color: #0c0c0c;
  }

  .wt-top-av-badge.is-online {
    width: 8px;
    height: 8px;
    right: 0;
    bottom: 0;
    background: #34d399;
  }

  .wt-top-invite-btn {
    width: 34px;
    height: 34px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.06));
    color: rgba(255, 255, 255, 0.68);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      background-color 0.18s ease,
      color 0.18s ease;
  }

  .wt-top-invite-btn:hover {
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.14));
    color: #ffffff;
  }

  .wt-theater-frame {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    border-radius: 16px;
    background: transparent;
    display: flex;
    align-items: stretch;
    overflow: hidden;
  }

  /* When fullscreen is triggered inside data-player-fs-root, BOTH video and chat stay inside fullscreen! */
  .wt-theater-frame:fullscreen,
  :global(.wt-theater-frame.is-fs-active) {
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-height: none !important;
    border-radius: 0 !important;
    z-index: 99999 !important;
    background: var(--mila-app-canvas, #0c0c0c) !important;
  }

  .wt-video-stage {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    border-radius: 16px;
    background: #070709;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .wt-theater-frame:fullscreen .wt-video-stage,
  :global(.wt-theater-frame.is-fs-active) .wt-video-stage {
    border-radius: 0;
  }

  .wt-video-stage :global(.hls-player) {
    border-radius: 16px;
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
  }

  /* Smooth animated split-screen chat container */
  .wt-split-shell {
    position: relative;
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    opacity: 0;
    filter: blur(8px);
    pointer-events: none;
    background: transparent;
    transition:
      width 0.34s cubic-bezier(0.22, 1, 0.36, 1),
      padding-left 0.34s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1),
      filter 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .wt-split-shell.is-open {
    padding-left: 10px;
    opacity: 1;
    filter: blur(0px);
    pointer-events: auto;
  }

  .wt-split-shell.is-dragging {
    transition: none;
  }

  /* Invisible edge resize hit-target — no permanent separator line */
  .wt-split-resizer {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 7px;
    z-index: 25;
    cursor: col-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    touch-action: none;
  }

  .wt-resizer-grip {
    width: 2px;
    height: 36px;
    border-radius: 999px;
    opacity: 0;
    background: rgba(255, 255, 255, 0.28);
    transition:
      opacity 0.18s ease,
      height 0.18s ease,
      background 0.18s ease;
  }

  .wt-split-resizer:hover .wt-resizer-grip,
  .wt-split-resizer.is-dragging .wt-resizer-grip {
    opacity: 1;
    height: 52px;
    background: rgba(255, 255, 255, 0.42);
  }

  /* Chat Panel — exact same canvas background when docked, blurred glass when floating */
  .wt-chat-panel {
    display: flex;
    flex-direction: column;
    color: #ffffff;
    box-sizing: border-box;
    flex-shrink: 0;
    user-select: none;
    font-family: 'Medeo Sans', system-ui, sans-serif;
    --wails-draggable: no-drag;
  }

  .wt-chat-panel.is-split {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    padding: 10px 11px 10px;
    border-radius: 16px;
    overflow: hidden;
    background: var(--mila-app-surface, var(--mila-cards-bg, #121216));
  }

  .wt-chat-panel.is-floating {
    position: absolute;
    z-index: 35;
    padding: 10px 11px 10px;
    border-radius: 18px;
    background: var(--mila-popup-comboBg, rgba(12, 12, 15, 0.92));
    backdrop-filter: blur(28px) saturate(140%);
    -webkit-backdrop-filter: blur(28px) saturate(140%);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.72);
  }

  .wt-float-resizer {
    position: absolute;
    z-index: 4;
    touch-action: none;
  }

  .wt-float-resizer.is-w {
    top: 14px;
    bottom: 14px;
    left: -5px;
    width: 10px;
    cursor: ew-resize;
  }

  .wt-float-resizer.is-e {
    top: 14px;
    bottom: 14px;
    right: -5px;
    width: 10px;
    cursor: ew-resize;
  }

  .wt-float-resizer.is-s {
    left: 14px;
    right: 14px;
    bottom: -5px;
    height: 10px;
    cursor: ns-resize;
  }

  .wt-float-resizer.is-sw {
    left: -5px;
    bottom: -5px;
    width: 16px;
    height: 16px;
    cursor: nesw-resize;
  }

  .wt-float-resizer.is-se {
    right: -5px;
    bottom: -5px;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
  }

  .wt-chat-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 1px 2px 6px;
    flex-shrink: 0;
  }

  .wt-chat-head.is-draggable {
    cursor: grab;
    touch-action: none;
  }

  .wt-chat-panel.is-dragging-float .wt-chat-head.is-draggable {
    cursor: grabbing;
  }

  .wt-chat-title {
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: rgba(255, 255, 255, 0.9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wt-chat-head-right {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* Overlapping member avatars with genuine TRANSPARENT cutout gap (no black border!) */
  .wt-chat-avatars {
    display: inline-flex;
    align-items: center;
    margin-right: 2px;
  }

  .wt-chat-av-circle {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.08);
    border: none;
    margin-left: -6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 9.5px;
    font-weight: 700;
    color: #ffffff;
    box-sizing: border-box;
  }

  .wt-chat-av-circle:first-child {
    margin-left: 0;
  }

  .wt-chat-av-circle:not(:first-child) {
    -webkit-mask-image: radial-gradient(circle 14px at -6px 50%, transparent 99%, #000 100%);
    mask-image: radial-gradient(circle 14px at -6px 50%, transparent 99%, #000 100%);
  }

  .wt-chat-av-circle img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .wt-chat-icon-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.42);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color 0.16s ease;
  }

  .wt-chat-icon-btn:hover {
    color: #ffffff;
  }

  /* Simpler Mila-native Chat Feed & Bubbles (zero separators) */
  .wt-chat-feed {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding: 2px 0 4px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    scrollbar-width: none;
  }

  .wt-chat-feed > :first-child {
    margin-top: auto;
  }

  .wt-chat-feed::-webkit-scrollbar {
    display: none;
  }

  .wt-chat-empty {
    margin: auto 0;
    text-align: center;
    font-family: 'Medeo Sans', system-ui, sans-serif;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.22);
  }

  .wt-msg-system {
    align-self: center;
    font-family: 'Medeo Sans', system-ui, sans-serif;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.24);
    padding: 2px 6px;
    --wt-msg-dx: 0px;
    animation: wtMsgIn 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .wt-msg-item {
    align-self: flex-start;
    width: fit-content;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    max-width: 88%;
    --wt-msg-dx: -14px;
    animation: wtMsgIn 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .wt-msg-item.is-mine {
    align-self: flex-end;
    align-items: flex-end;
    --wt-msg-dx: 14px;
  }

  @keyframes wtMsgIn {
    from {
      opacity: 0;
      transform: translate3d(var(--wt-msg-dx, 0px), 6px, 0) scale(0.92);
      filter: blur(6px);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
      filter: blur(0px);
    }
  }

  /* Incoming message: dark rounded pill with circular avatar on the left */
  .wt-bubble-other {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px 6px 6px;
    border-radius: 20px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.075));
    color: var(--mila-text-primary, rgba(255, 255, 255, 0.92));
    max-width: 100%;
    box-sizing: border-box;
  }

  .wt-bubble-av {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.12);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 10.5px;
    font-weight: 700;
    color: #ffffff;
  }

  .wt-bubble-av img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Own message: colored in the user's selected accent color with contrasting text */
  .wt-bubble-mine {
    display: inline-flex;
    align-items: center;
    padding: 7px 14px;
    border-radius: 20px;
    background: var(--mila-accent-primary, var(--mila-buttons-mainBg, #ffffff));
    color: var(--mila-text-onAccent, var(--mila-buttons-mainText, #0c0c0c));
    max-width: 100%;
    box-sizing: border-box;
  }

  .wt-bubble-mine .wt-bubble-text {
    font-weight: 500;
    color: inherit;
  }

  .wt-bubble-text {
    font-family: 'Medeo Sans', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 400;
    line-height: 1.38;
    word-break: break-word;
    user-select: text;
  }

  .wt-msg-time {
    align-self: flex-end;
    padding: 1px 6px 0;
    font-family: 'Medeo Sans', system-ui, sans-serif;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.32);
    line-height: 1;
  }

  /* Minimalist Mila-native chat input bar */
  .wt-chat-form {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 5px 0 11px;
    margin-top: 6px;
    border: none;
    border-radius: 10px;
    background: var(--mila-inputs-bg, var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.055)));
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .wt-chat-input {
    flex: 1 1 0;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--mila-text-primary, #ffffff);
    font-family: 'Medeo Sans', system-ui, sans-serif;
    font-size: 12.5px;
  }

  .wt-chat-input::placeholder {
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.34));
  }

  .wt-chat-send {
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--mila-accent-primary, #ffffff);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: pointer;
    transition:
      color 0.16s ease,
      opacity 0.16s ease,
      transform 0.16s ease;
  }

  .wt-chat-send:disabled {
    color: var(--mila-text-dim, rgba(255, 255, 255, 0.24));
    opacity: 1;
    cursor: default;
  }

  .wt-chat-send:hover:not(:disabled) {
    transform: translateX(1px);
  }

  /* Below-the-fold Episodes Section (hidden on initial 100vh viewport, revealed on scroll) */
  .wt-player-body {
    padding: clamp(20px, 2.4vw, 28px) var(--page-pad-x, 16px)
      var(--page-pad-x, 16px) var(--page-pad-x, 16px);
    display: flex;
    flex-direction: column;
    gap: clamp(20px, 2.4vw, 28px);
  }

  .wt-room-main-title {
    margin: 0;
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: clamp(22px, 2.2vw, 28px);
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1.06;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: min(320px, 30vw);
  }

  .wt-seat-inline {
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: clamp(13px, 1.1vw, 16px);
    font-weight: 700;
    line-height: 1;
    color: rgba(255, 255, 255, 0.34);
    display: inline-flex;
    align-items: center;
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

  .player-inline-slot {
    width: 100%;
    height: 100%;
  }

  .player-inline-slot.is-hidden {
    display: none;
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
