<script lang="ts">
  interface Props {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    ariaLabel?: string;
    disabled?: boolean;
    variant?: 'capsule' | 'classic';
    class?: string;
    onchange?: (value: number) => void;
    oncommit?: (value: number) => void;
  }

  let {
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    ariaLabel = 'Slider',
    disabled = false,
    variant = 'capsule',
    class: className = '',
    onchange,
    oncommit
  }: Props = $props();

  let trackEl = $state<HTMLDivElement | null>(null);
  let dragging = $state(false);

  const safeSpan = $derived(max > min ? max - min : 1);
  const clampedValue = $derived(Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)));
  const pct = $derived(Math.max(0, Math.min(100, ((clampedValue - min) / safeSpan) * 100)));

  function quantize(raw: number): number {
    const clamped = Math.max(min, Math.min(max, raw));
    if (step <= 0) return clamped;
    const steps = Math.round((clamped - min) / step);
    const snapped = min + steps * step;
    const decimals = (String(step).split('.')[1] || '').length;
    return Number(Math.max(min, Math.min(max, snapped)).toFixed(decimals));
  }

  function applyValue(next: number) {
    const normalized = quantize(next);
    if (normalized !== value) {
      value = normalized;
    }
    onchange?.(normalized);
  }

  function updateFromClientX(clientX: number) {
    if (!trackEl || disabled) return;
    const rect = trackEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    applyValue(min + ratio * safeSpan);
  }

  function handlePointerDown(e: PointerEvent) {
    if (disabled || !trackEl || e.button !== 0) return;
    e.stopPropagation();
    dragging = true;
    trackEl.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    updateFromClientX(e.clientX);
  }

  function handlePointerUp(e: PointerEvent) {
    if (!dragging || !trackEl) return;
    updateFromClientX(e.clientX);
    dragging = false;
    try {
      trackEl.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture already released
    }
    oncommit?.(value);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (disabled) return;
    const delta = step > 0 ? step : safeSpan / 20;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      applyValue(clampedValue - delta);
      oncommit?.(value);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      applyValue(clampedValue + delta);
      oncommit?.(value);
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      applyValue(min);
      oncommit?.(value);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      applyValue(max);
      oncommit?.(value);
    }
  }
</script>

<div
  bind:this={trackEl}
  class="marla-slider {className}"
  class:is-capsule={variant === 'capsule'}
  class:is-dragging={dragging}
  class:is-disabled={disabled}
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={ariaLabel}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={clampedValue}
  aria-disabled={disabled}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  onkeydown={handleKeydown}
>
  <div class="marla-slider-rail">
    <div class="marla-slider-fill" style:width="{pct}%"></div>
  </div>
  {#if variant !== 'capsule'}
    <div class="marla-slider-thumb" style:left="{pct}%"></div>
  {/if}
</div>

<style>
  .marla-slider {
    position: relative;
    width: 100%;
    height: 22px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
    outline: none;
    user-select: none;
  }

  .marla-slider.is-capsule {
    height: 18px;
  }

  .marla-slider.is-disabled {
    opacity: 0.45;
    cursor: default;
  }

  .marla-slider-rail {
    position: relative;
    width: 100%;
    height: 3px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
    overflow: hidden;
    transition: height 0.16s ease, background-color 0.16s ease;
  }

  .marla-slider.is-capsule .marla-slider-rail {
    height: 6px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.08));
  }

  .marla-slider:hover:not(.is-disabled) .marla-slider-rail,
  .marla-slider:focus-visible:not(.is-disabled) .marla-slider-rail,
  .marla-slider.is-dragging .marla-slider-rail {
    height: 4px;
    background: rgba(255, 255, 255, 0.3);
  }

  .marla-slider.is-capsule:hover:not(.is-disabled) .marla-slider-rail,
  .marla-slider.is-capsule:focus-visible:not(.is-disabled) .marla-slider-rail,
  .marla-slider.is-capsule.is-dragging .marla-slider-rail {
    height: 6px;
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.12));
  }

  .marla-slider-fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 999px;
    background: #ffffff;
  }

  .marla-slider.is-capsule .marla-slider-fill {
    background: var(--mila-toggle-trackOn, var(--mila-accent-primary, #ffffff));
  }

  .marla-slider-thumb {
    position: absolute;
    top: 50%;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
    transform: translate(-50%, -50%) scale(0);
    transition: transform 0.16s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
    pointer-events: none;
  }

  .marla-slider:hover:not(.is-disabled) .marla-slider-thumb,
  .marla-slider:focus-visible:not(.is-disabled) .marla-slider-thumb,
  .marla-slider.is-dragging .marla-slider-thumb {
    transform: translate(-50%, -50%) scale(1);
  }
</style>
