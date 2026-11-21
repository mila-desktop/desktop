<script lang="ts">
  import { tick } from 'svelte';

  export interface SegmentedOption<T extends string | number = string> {
    value: T;
    label: string;
    badge?: string | number;
    disabled?: boolean;
  }

  interface Props {
    value: string | number;
    options: readonly SegmentedOption<string | number>[];
    ariaLabel?: string;
    disabled?: boolean;
    class?: string;
    onchange?: (value: string | number) => void;
  }

  let {
    value,
    options,
    ariaLabel = 'Select option',
    disabled = false,
    class: className = '',
    onchange
  }: Props = $props();

  let groupEl = $state<HTMLDivElement | null>(null);
  let btnEls = $state<Record<string, HTMLButtonElement | null>>({});
  let pillLeft = $state(0);
  let pillWidth = $state(0);
  let pillReady = $state(false);

  function updatePillGeometry() {
    const activeEl = btnEls[String(value)];
    if (!activeEl) {
      pillReady = false;
      return;
    }
    pillLeft = activeEl.offsetLeft;
    pillWidth = activeEl.offsetWidth;
    pillReady = pillWidth > 0;
  }

  $effect(() => {
    void value;
    void options.length;
    let alive = true;
    void tick().then(() => {
      if (alive) updatePillGeometry();
    });
    return () => {
      alive = false;
    };
  });

  $effect(() => {
    const el = groupEl;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      updatePillGeometry();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  });

  function select(opt: SegmentedOption<string | number>) {
    if (disabled || opt.disabled || opt.value === value) return;
    onchange?.(opt.value);
  }
</script>

<div
  bind:this={groupEl}
  class="marla-segmented {className}"
  class:is-disabled={disabled}
  role="radiogroup"
  aria-label={ariaLabel}
>
  <span
    class="marla-seg-pill"
    class:is-ready={pillReady}
    aria-hidden="true"
    style:width="{pillWidth}px"
    style:transform="translate3d({pillLeft}px, 0, 0)"
  ></span>

  {#each options as opt (opt.value)}
    {@const active = opt.value === value}
    <button
      bind:this={btnEls[String(opt.value)]}
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled || opt.disabled}
      class="marla-seg-btn"
      class:is-active={active}
      onclick={() => select(opt)}
    >
      <span>{opt.label}</span>
      {#if opt.badge !== undefined}
        <span class="marla-seg-badge">{opt.badge}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  /* Zero-padding Library-style sliding segmented pill */
  .marla-segmented {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0;
    height: 32px;
    padding: 0;
    border-radius: 10px;
    overflow: hidden;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.04));
    user-select: none;
    flex-shrink: 0;
    box-sizing: border-box;
    --wails-draggable: no-drag;
  }

  .marla-segmented.is-disabled {
    opacity: 0.45;
    pointer-events: none;
  }

  .marla-seg-pill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: 10px;
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.1));
    pointer-events: none;
    opacity: 0;
    transition:
      transform 0.32s cubic-bezier(0.22, 1, 0.36, 1),
      width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.18s ease;
  }

  .marla-seg-pill.is-ready {
    opacity: 1;
  }

  .marla-seg-btn {
    position: relative;
    z-index: 1;
    height: 100%;
    min-width: 34px;
    margin: 0;
    padding: 0 11px;
    border: none;
    outline: none;
    border-radius: 10px;
    background: transparent;
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.44));
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color 0.2s ease,
      transform 0.1s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .marla-seg-btn:hover:not(:disabled):not(.is-active) {
    color: var(--mila-text-secondary, rgba(255, 255, 255, 0.78));
  }

  .marla-seg-btn.is-active {
    color: var(--mila-accent-highlight, var(--mila-text-primary, #ffffff));
  }

  .marla-seg-btn:active:not(:disabled) {
    transform: scale(0.96);
  }

  .marla-seg-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .marla-seg-badge {
    font-size: 10.5px;
    opacity: 0.62;
    font-weight: 500;
  }
</style>
