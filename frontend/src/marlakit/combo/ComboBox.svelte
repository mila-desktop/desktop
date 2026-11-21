<script lang="ts">
  import { Check, ChevronRight } from 'lucide';
  import { MorphIcon } from 'morphicons/svelte';
  import type { Snippet } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import ScrollArea from '../scroll/ScrollArea.svelte';
  import type { ComboAnchor, ComboOption, ComboPlacement, ComboSection, ComboValue } from './types';

  function comboTransition(_node: HTMLElement, params: { dirY: number }) {
    return {
      duration: 190,
      easing: cubicOut,
      css: (t: number) => {
        const inv = 1 - t;
        const y = inv * params.dirY;
        const s = 0.95 + 0.05 * t;
        return `opacity: ${t}; transform: translate3d(0, ${y.toFixed(2)}px, 0) scale(${s.toFixed(4)});`;
      }
    };
  }

  function submenuTransition(_node: HTMLElement, params: { dirX: number }) {
    return {
      duration: 170,
      easing: cubicOut,
      css: (t: number) => {
        const inv = 1 - t;
        const x = inv * params.dirX;
        const s = 0.96 + 0.04 * t;
        return `opacity: ${t}; transform: translate3d(${x.toFixed(2)}px, 0, 0) scale(${s.toFixed(4)});`;
      }
    };
  }

  interface Props {
    open?: boolean;
    value?: ComboValue | null;
    options?: ComboOption[];
    sections?: ComboSection[];
    label?: string;
    placeholder?: string;
    ariaLabel?: string;
    placement?: ComboPlacement;
    anchor?: ComboAnchor;
    minWidth?: number;
    maxWidth?: number | null;
    maxHeight?: number | null;
    closeOnSelect?: boolean;
    disabled?: boolean;
    icon?: Snippet;
    trigger?: Snippet<[{ open: boolean; toggle: () => void; label: string }]>;
    header?: Snippet;
    footer?: Snippet;
    subFooter?: Snippet<[ComboOption]>;
    class?: string;
    menuClass?: string;
    onselect?: (option: ComboOption) => void;
    ontoggle?: (open: boolean) => void;
  }

  let {
    open = $bindable(false),
    value = null,
    options = [],
    sections = [],
    label = '',
    placeholder = 'Select',
    ariaLabel,
    placement = 'top-right',
    anchor,
    minWidth = 112,
    maxWidth = null,
    maxHeight = null,
    closeOnSelect = true,
    disabled = false,
    icon,
    trigger,
    header,
    footer,
    subFooter,
    class: className = '',
    menuClass = '',
    onselect,
    ontoggle
  }: Props = $props();

  let wrapEl = $state<HTMLDivElement | null>(null);
  let popoverEl = $state<HTMLDivElement | null>(null);
  let submenuEl = $state<HTMLDivElement | null>(null);
  let activeSubValue = $state<ComboValue | null>(null);
  let subSide = $state<'right' | 'left'>('right');
  let subItemCenterY = $state<number>(18);
  let subComputedTop = $state<number>(0);
  let subCloseTimer: number | undefined;

  const normalizedSections = $derived.by<ComboSection[]>(() => {
    if (sections.length > 0) return sections;
    if (options.length > 0) return [{ options }];
    return [];
  });

  const flatOptions = $derived.by<ComboOption[]>(() => {
    const out: ComboOption[] = [];
    for (const sec of normalizedSections) {
      for (const opt of sec.options) {
        out.push(opt);
      }
    }
    return out;
  });

  const activeSubParent = $derived.by<ComboOption | null>(() => {
    if (activeSubValue === null) return null;
    const found = flatOptions.find((o) => o.value === activeSubValue);
    if (!found || !found.children || found.children.length === 0) return null;
    return found;
  });

  const resolvedLabel = $derived.by(() => {
    if (label) return label;
    const found = flatOptions.find((o) => o.value === value);
    return found?.label ?? placeholder;
  });

  const resolvedTransformOrigin = $derived.by(() => {
    if (anchor) {
      return anchor.replace('-', ' ');
    }
    switch (placement) {
      case 'top-center':
        return 'bottom center';
      case 'top-left':
        return 'bottom left';
      case 'top-right':
        return 'bottom right';
      case 'bottom-center':
        return 'top center';
      case 'bottom-left':
        return 'top left';
      case 'bottom-right':
      default:
        return 'top right';
    }
  });

  function clearSubTimer() {
    window.clearTimeout(subCloseTimer);
  }

  function scheduleSubClose() {
    clearSubTimer();
    subCloseTimer = window.setTimeout(() => {
      activeSubValue = null;
    }, 120);
  }

  function updateSubVerticalPosition(centerY: number, estimatedH?: number) {
    const subH = submenuEl?.offsetHeight || estimatedH || 144;
    let idealTop = Math.round(centerY - subH / 2);
    if (popoverEl && typeof window !== 'undefined') {
      const popRect = popoverEl.getBoundingClientRect();
      const minTop = 10 - popRect.top;
      const maxTop = window.innerHeight - 10 - popRect.top - subH;
      if (maxTop >= minTop) {
        idealTop = Math.max(minTop, Math.min(maxTop, idealTop));
      }
    }
    subComputedTop = idealTop;
  }

  function openSubmenu(opt: ComboOption, itemEl?: HTMLElement | null) {
    clearSubTimer();
    if (!opt.children || opt.children.length === 0) {
      activeSubValue = null;
      return;
    }
    let centerY = 18;
    if (popoverEl && typeof window !== 'undefined') {
      const popRect = popoverEl.getBoundingClientRect();
      const targetSubWidth = opt.subMinWidth ?? 196;
      const spaceRight = window.innerWidth - popRect.right + 14;
      const spaceLeft = popRect.left + 14;
      subSide = spaceRight >= targetSubWidth + 10 || spaceRight >= spaceLeft ? 'right' : 'left';
      if (itemEl) {
        const itemRect = itemEl.getBoundingClientRect();
        centerY = itemRect.top - popRect.top + itemRect.height / 2;
      }
    } else {
      subSide = 'right';
    }
    subItemCenterY = centerY;
    const estH = Math.min(maxHeight ?? 280, opt.children.length * 38);
    updateSubVerticalPosition(centerY, estH);
    activeSubValue = opt.value;
  }

  $effect(() => {
    const el = submenuEl;
    const centerY = subItemCenterY;
    void activeSubParent;
    if (!el) return;
    updateSubVerticalPosition(centerY, el.offsetHeight);
  });

  function setOpen(next: boolean) {
    if (open === next) return;
    open = next;
    if (!next) {
      clearSubTimer();
      activeSubValue = null;
    }
    ontoggle?.(next);
  }

  function toggle() {
    if (disabled) return;
    setOpen(!open);
  }

  function choose(opt: ComboOption) {
    if (opt.disabled) return;
    onselect?.(opt);
    if (closeOnSelect && !opt.keepOpen) {
      setOpen(false);
    }
  }

  function handleParentClick(opt: ComboOption, e: MouseEvent) {
    if (opt.disabled) return;
    if (opt.children && opt.children.length > 0) {
      const targetEl = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
      if (activeSubValue === opt.value) {
        activeSubValue = null;
      } else {
        openSubmenu(opt, targetEl);
      }
      return;
    }
    choose(opt);
  }

  $effect(() => {
    if (!open) {
      clearSubTimer();
      activeSubValue = null;
      return;
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (!wrapEl) return;
      if (e.target instanceof Node && !wrapEl.contains(e.target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      clearSubTimer();
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  });
</script>

<div bind:this={wrapEl} class="marla-combo {className}">
  {#if trigger}
    {@render trigger({ open, toggle, label: resolvedLabel })}
  {:else}
    <button
      type="button"
      class="marla-combo-trigger"
      class:is-open={open}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel ?? resolvedLabel}
      {disabled}
      onclick={toggle}
    >
      {#if icon}
        {@render icon()}
      {/if}
      <span>{resolvedLabel}</span>
    </button>
  {/if}

  {#if open && (normalizedSections.length > 0 || header || footer)}
    <div
      class="marla-combo-layer placement-{placement} {menuClass}"
      role="presentation"
      transition:comboTransition={{ dirY: placement.startsWith('top') ? 6 : -6 }}
      style:transform-origin={resolvedTransformOrigin}
      onmouseleave={scheduleSubClose}
    >
      <div
        bind:this={popoverEl}
        class="marla-combo-popover"
        role="listbox"
        style:min-width="{minWidth}px"
        style:max-width={maxWidth ? `${maxWidth}px` : undefined}
      >
        {#if header}
          <div class="marla-combo-header">
            {@render header()}
          </div>
        {/if}
        <ScrollArea maxHeight={maxHeight ?? 280}>
          <div class="marla-combo-list">
            {#each normalizedSections as sec, secIdx (sec.id ?? sec.title ?? secIdx)}
              {#if sec.title}
                <div class="marla-combo-section-label">{sec.title}</div>
              {/if}
              {#each sec.options as opt (opt.value)}
                {@const hasChildren = Boolean(opt.children && opt.children.length > 0)}
                {@const isSubActive = hasChildren && activeSubParent?.value === opt.value}
                {@const isSelected = opt.selected ?? (value !== null && value !== undefined && opt.value === value)}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  class="marla-combo-item"
                  class:has-sub={Boolean(opt.sublabel)}
                  class:active={isSelected}
                  class:sub-open={isSubActive}
                  onmouseenter={(e) => {
                    if (hasChildren) {
                      openSubmenu(opt, e.currentTarget);
                    } else {
                      clearSubTimer();
                      activeSubValue = null;
                    }
                  }}
                  onclick={(e) => handleParentClick(opt, e)}
                >
                  {#if opt.sublabel}
                    <span class="marla-combo-meta">
                      <span class="marla-combo-title">{opt.label}</span>
                      <span class="marla-combo-sub">{opt.sublabel}</span>
                    </span>
                  {:else}
                    <span class="marla-combo-label">{opt.label}</span>
                  {/if}
                  {#if hasChildren}
                    <span class="marla-combo-tail">
                      {#if isSelected}
                        <span class="marla-combo-dot" aria-hidden="true"></span>
                      {/if}
                      <MorphIcon icon={ChevronRight} size={13} strokeWidth={2} class="marla-combo-chevron" />
                    </span>
                  {:else if isSelected}
                    <MorphIcon icon={Check} size={14} strokeWidth={2.2} />
                  {/if}
                </button>
              {/each}
            {/each}
          </div>
        </ScrollArea>
        {#if footer}
          <div class="marla-combo-footer">
            {@render footer()}
          </div>
        {/if}
      </div>

      {#if activeSubParent?.children}
        {#key activeSubParent.value}
          <div
            bind:this={submenuEl}
            class="marla-combo-submenu side-{subSide}"
            role="listbox"
            tabindex="-1"
            style:top={`${subComputedTop}px`}
            style:min-width="{activeSubParent.subMinWidth ?? 196}px"
            style:max-width={activeSubParent.subMaxWidth ? `${activeSubParent.subMaxWidth}px` : undefined}
            style:transform-origin={subSide === 'right' ? 'left center' : 'right center'}
            onmouseenter={clearSubTimer}
            onmouseleave={scheduleSubClose}
            transition:submenuTransition={{ dirX: subSide === 'right' ? -8 : 8 }}
          >
            <ScrollArea maxHeight={maxHeight ?? 280}>
              <div class="marla-combo-list">
                {#each activeSubParent.children as subOpt (subOpt.value)}
                  {@const subSelected = Boolean(subOpt.selected)}
                  <button
                    type="button"
                    role="option"
                    aria-selected={subSelected}
                    disabled={subOpt.disabled}
                    class="marla-combo-item"
                    class:has-sub={Boolean(subOpt.sublabel)}
                    class:active={subSelected}
                    onclick={() => choose(subOpt)}
                  >
                    {#if subOpt.sublabel}
                      <span class="marla-combo-meta">
                        <span class="marla-combo-title">{subOpt.label}</span>
                        <span class="marla-combo-sub">{subOpt.sublabel}</span>
                      </span>
                    {:else}
                      <span class="marla-combo-label">{subOpt.label}</span>
                    {/if}
                    {#if subSelected}
                      <MorphIcon icon={Check} size={14} strokeWidth={2.2} />
                    {/if}
                  </button>
                {/each}
              </div>
            </ScrollArea>
            {#if subFooter}
              {@render subFooter(activeSubParent)}
            {/if}
          </div>
        {/key}
      {/if}
    </div>
  {/if}
</div>

<style>
  .marla-combo {
    position: relative;
    display: inline-flex;
  }

  .marla-combo-trigger {
    height: 28px;
    padding: 0 8px;
    border: none;
    outline: none;
    border-radius: 8px;
    background: transparent;
    color: var(--mila-text-secondary, rgba(255, 255, 255, 0.88));
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12.5px;
    font-weight: 400;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .marla-combo-trigger:hover:not(:disabled),
  .marla-combo-trigger.is-open:not(:disabled) {
    background: var(--mila-popup-itemHover, rgba(255, 255, 255, 0.1));
    color: var(--mila-text-primary, #ffffff);
  }

  .marla-combo-trigger:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .marla-combo-layer {
    position: absolute;
    z-index: 40;
  }

  .placement-top-right {
    right: 0;
    bottom: 36px;
    transform-origin: bottom right;
  }

  .placement-top-left {
    left: 0;
    bottom: 36px;
    transform-origin: bottom left;
  }

  .placement-top-center {
    left: 50%;
    bottom: 36px;
    translate: -50% 0;
    transform-origin: bottom center;
  }

  .placement-bottom-right {
    right: 0;
    top: 36px;
    transform-origin: top right;
  }

  .placement-bottom-left {
    left: 0;
    top: 36px;
    transform-origin: top left;
  }

  .placement-bottom-center {
    left: 50%;
    top: 36px;
    translate: -50% 0;
    transform-origin: top center;
  }

  .placement-bottom-center {
    left: 50%;
    top: 36px;
    translate: -50% 0;
    transform-origin: top center;
  }

  .marla-combo-popover,
  .marla-combo-submenu {
    padding: 0;
    border-radius: 15px;
    background: var(--mila-popup-comboBg, rgba(10, 10, 10, 0.9));
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: none;
    box-shadow: var(--mila-popup-shadow, none);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .marla-combo-popover {
    position: relative;
  }

  .marla-combo-submenu {
    position: absolute;
    z-index: 42;
    box-shadow: 0 18px 46px rgba(0, 0, 0, 0.56);
  }

  /* Overlap the parent popover edge slightly for layered continuity without covering the chevron. */
  .marla-combo-submenu.side-right {
    left: calc(100% - 10px);
  }

  .marla-combo-submenu.side-left {
    right: calc(100% - 10px);
  }

  .marla-combo-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
  }

  .marla-combo-section-label {
    flex-shrink: 0;
    margin-top: 8px;
    padding: 6px 14px;
    font-family: 'RF Dewi Extended', system-ui, sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--mila-popup-comboSectionText, rgba(255, 255, 255, 0.2));
    user-select: none;
  }

  .marla-combo-section-label:first-child {
    margin-top: 0;
    padding-top: 11px;
  }

  .marla-combo-item {
    flex-shrink: 0;
    width: 100%;
    min-height: 36px;
    height: 36px;
    padding: 0 14px;
    border: none;
    outline: none;
    border-radius: 0;
    background: transparent;
    color: var(--mila-popup-itemText, rgba(255, 255, 255, 0.72));
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    cursor: pointer;
    transition: background-color 0.14s ease, color 0.14s ease;
  }

  .marla-combo-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .marla-combo-item.has-sub {
    height: auto;
    min-height: 40px;
    padding: 7px 14px;
  }

  .marla-combo-item:hover:not(:disabled),
  .marla-combo-item.sub-open:not(:disabled) {
    background: var(--mila-popup-itemHover, rgba(255, 255, 255, 0.1));
    color: var(--mila-text-primary, #ffffff);
  }

  .marla-combo-item:disabled {
    opacity: 0.42;
    cursor: default;
  }

  .marla-combo-item.active {
    background: var(--mila-popup-itemActive, rgba(255, 255, 255, 0.06));
    color: var(--mila-popup-itemTextActive, #ffffff);
    font-weight: 500;
  }

  .marla-combo-tail {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .marla-combo-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.85;
  }

  .marla-combo-item :global(.marla-combo-chevron) {
    opacity: 0.45;
    transition: opacity 0.14s ease, transform 0.14s ease;
  }

  .marla-combo-item:hover :global(.marla-combo-chevron),
  .marla-combo-item.sub-open :global(.marla-combo-chevron) {
    opacity: 0.9;
    transform: translateX(1px);
  }

  .marla-combo-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    gap: 1px;
    text-align: left;
  }

  .marla-combo-title {
    font-size: 13px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 205px;
  }

  .marla-combo-sub {
    font-size: 11px;
    line-height: 1.25;
    font-weight: 400;
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.45));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 205px;
  }

  .marla-combo-header {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px 4px;
  }

  .marla-combo-footer {
    margin-top: 2px;
    padding: 4px 8px 8px;
  }
</style>
