<script lang="ts">
  interface Props {
    checked?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    label?: string;
    onchange?: (checked: boolean) => void;
    class?: string;
  }

  let {
    checked = $bindable(false),
    disabled = false,
    ariaLabel = 'Toggle option',
    label = '',
    onchange,
    class: className = ''
  }: Props = $props();

  function handleClick() {
    if (disabled) return;
    const next = !checked;
    checked = next;
    onchange?.(next);
  }
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label || ariaLabel}
  {disabled}
  class="mk-toggle {className}"
  class:is-checked={checked}
  class:is-disabled={disabled}
  onclick={handleClick}
>
  <span class="mk-toggle-thumb" aria-hidden="true"></span>
</button>

<style>
  .mk-toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    width: 34px;
    height: 20px;
    padding: 3px;
    border: none;
    outline: none;
    border-radius: 999px;
    background: var(--mila-toggle-trackOff, rgba(255, 255, 255, 0.14));
    cursor: pointer;
    box-sizing: border-box;
    transition:
      background-color 0.22s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
      transform 0.12s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
    -webkit-tap-highlight-color: transparent;
  }

  .mk-toggle:hover:not(.is-disabled):not(.is-checked) {
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.2));
  }

  .mk-toggle:active:not(.is-disabled) {
    transform: scale(0.95);
  }

  .mk-toggle.is-checked {
    background: var(--mila-toggle-trackOn, rgba(255, 255, 255, 0.92));
  }

  .mk-toggle.is-checked:hover:not(.is-disabled) {
    background: var(--mila-toggle-trackOnHover, #ffffff);
  }

  .mk-toggle.is-disabled {
    opacity: 0.42;
    cursor: default;
  }

  .mk-toggle-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--mila-toggle-thumbOff, rgba(255, 255, 255, 0.88));
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.36);
    transform: translate3d(0, 0, 0);
    transition:
      transform 0.24s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
      background-color 0.2s ease;
  }

  .mk-toggle.is-checked .mk-toggle-thumb {
    background: var(--mila-toggle-thumbOn, #0c0c0c);
    transform: translate3d(14px, 0, 0);
  }
</style>
