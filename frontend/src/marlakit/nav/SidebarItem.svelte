<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    active?: boolean;
    badge?: string;
    disabled?: boolean;
    icon?: Snippet;
    onclick?: (e: MouseEvent) => void;
    class?: string;
  }

  let {
    label,
    active = false,
    badge = '',
    disabled = false,
    icon,
    onclick,
    class: className = ''
  }: Props = $props();
</script>

<button
  type="button"
  {disabled}
  aria-current={active ? 'page' : undefined}
  class="marla-sidebar-item {className}"
  class:is-active={active}
  {onclick}
>
  {#if icon}
    <span class="marla-sidebar-icon" aria-hidden="true">
      {@render icon()}
    </span>
  {/if}
  <span class="marla-sidebar-label">{label}</span>
  {#if badge}
    <span class="marla-sidebar-badge">{badge}</span>
  {/if}
</button>

<style>
  .marla-sidebar-item {
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border: none;
    outline: none;
    border-radius: 9px;
    background: transparent;
    color: var(--mila-popup-itemText, var(--mila-text-secondary, rgba(255, 255, 255, 0.62)));
    font-family: 'Medeo Sans Display', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    text-align: left;
    cursor: pointer;
    transition:
      background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1),
      color 0.16s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
    -webkit-tap-highlight-color: transparent;
    --wails-draggable: no-drag;
  }

  .marla-sidebar-item:hover:not(:disabled) {
    background: var(--mila-popup-itemHover, var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.055)));
    color: var(--mila-popup-itemTextActive, var(--mila-text-primary, #ffffff));
  }

  .marla-sidebar-item.is-active {
    background: var(--mila-popup-itemActive, var(--mila-app-surfaceActive, rgba(255, 255, 255, 0.11)));
    color: var(--mila-popup-itemTextActive, var(--mila-text-primary, #ffffff));
  }

  .marla-sidebar-item:active:not(:disabled) {
    transform: scale(0.985);
  }

  .marla-sidebar-item:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .marla-sidebar-icon {
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.72;
    transition: color 0.16s ease, opacity 0.16s ease;
  }

  .marla-sidebar-item.is-active .marla-sidebar-icon {
    color: var(--mila-accent-primary, currentColor);
    opacity: 1;
  }

  .marla-sidebar-label {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .marla-sidebar-badge {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.08));
    color: var(--mila-text-muted, rgba(255, 255, 255, 0.52));
    font-size: 11px;
    font-weight: 500;
  }
</style>
