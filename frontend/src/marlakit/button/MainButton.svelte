<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
    icon?: Snippet;
    trailingIcon?: Snippet;
    onclick?: (e: MouseEvent) => void;
    class?: string;
    size?: 'md' | 'sm';
    ariaLabel?: string;
    type?: 'button' | 'submit' | 'reset';
    loading?: boolean;
    disabled?: boolean;
  }

  let {
    children,
    icon,
    trailingIcon,
    onclick,
    class: className = '',
    size = 'md',
    ariaLabel,
    type = 'button',
    loading = false,
    disabled = false
  }: Props = $props();
</script>

<button
  {type}
  aria-label={ariaLabel}
  class="marlakit-btn-main is-size-{size} {className}"
  class:loading
  disabled={disabled || loading}
  {onclick}
>
  <span class="btn-content" class:is-loading={loading}>
    {#if icon}
      <span class="btn-icon">
        {@render icon()}
      </span>
    {/if}
    {#if children}
      <span class="btn-text">
        {@render children()}
      </span>
    {/if}
    {#if trailingIcon}
      <span class="btn-icon">
        {@render trailingIcon()}
      </span>
    {/if}
  </span>

  <span class="btn-spinner" class:is-visible={loading} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" class="spinner-svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" opacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
  </span>
</button>

<style>
  .marlakit-btn-main {
    position: relative;
    height: 43px;
    padding: 0 26px;
    background: var(--mila-buttons-mainBg, rgba(255, 255, 255, 0.96));
    color: var(--mila-buttons-mainText, #111111);
    border: none;
    outline: none;
    box-shadow: none;
    border-radius: 21px;
    font-family: 'Medeo Sans', 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    text-decoration: none;
    white-space: nowrap;
    line-height: 1;
    margin: 0;
    transition: background-color 0.2s ease, color 0.2s ease, transform 0.1s ease, opacity 0.15s ease;
  }

  .marlakit-btn-main.is-size-sm {
    height: 32px;
    padding: 0 14px;
    border-radius: 10px;
    font-size: 13px;
  }

  .marlakit-btn-main:hover:not(:disabled) {
    background: var(--mila-buttons-mainBgHover, rgba(255, 255, 255, 0.95));
  }

  .marlakit-btn-main:active:not(:disabled) {
    transform: scale(0.98);
  }

  .marlakit-btn-main:disabled {
    cursor: not-allowed;
  }

  .marlakit-btn-main.loading {
    cursor: default;
  }

  .btn-content {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .btn-content.is-loading {
    opacity: 0;
    transform: scale(0.85);
  }

  .btn-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transform: translateY(-1px);
  }

  .btn-text {
    display: inline-flex;
    align-items: center;
    line-height: 1;
  }

  .btn-spinner {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: scale(0.7);
    transition: opacity 0.2s ease, transform 0.2s ease;
    pointer-events: none;
    color: currentColor;
  }

  .btn-spinner.is-visible {
    opacity: 1;
    transform: scale(1);
    pointer-events: auto;
  }

  .spinner-svg {
    width: 20px;
    height: 20px;
    animation: marlakit-spin 0.75s linear infinite;
  }

  @keyframes marlakit-spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>