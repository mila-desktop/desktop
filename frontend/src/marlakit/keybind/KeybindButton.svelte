<script lang="ts">
  interface Props {
    value: string;
    ariaLabel?: string;
    disabled?: boolean;
    class?: string;
    onchange?: (combo: string) => void;
  }

  let {
    value,
    ariaLabel = 'Edit shortcut',
    disabled = false,
    class: className = '',
    onchange
  }: Props = $props();

  let recording = $state(false);

  function formatKeyToken(code: string, key: string): string | null {
    if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(key)) {
      return null;
    }
    if (code === 'Space' || key === ' ') return 'Space';
    if (key === 'ArrowLeft') return 'Left';
    if (key === 'ArrowRight') return 'Right';
    if (key === 'ArrowUp') return 'Up';
    if (key === 'ArrowDown') return 'Down';
    if (code.startsWith('Key') && code.length === 4) {
      return code.slice(3).toUpperCase();
    }
    if (code.startsWith('Digit') && code.length === 6) {
      return code.slice(5);
    }
    if (key.length === 1) return key.toUpperCase();
    return key;
  }

  function splitCombo(raw: string): string[] {
    return raw
      .split('+')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      recording = false;
      return;
    }
    const base = formatKeyToken(e.code, e.key);
    if (!base) return;
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(base);
    recording = false;
    onchange?.(parts.join('+'));
  }

  function startRecording() {
    if (disabled) return;
    recording = true;
  }
</script>

<button
  type="button"
  {disabled}
  aria-label={ariaLabel}
  class="marla-keybind {className}"
  class:is-recording={recording}
  onclick={startRecording}
  onkeydown={handleKeydown}
  onblur={() => {
    recording = false;
  }}
>
  {#if recording}
    <span class="marla-keybind-prompt">Press keys...</span>
  {:else}
    {#each splitCombo(value) as part, idx (idx)}
      <kbd class="marla-keybind-cap">{part}</kbd>
    {/each}
  {/if}
</button>

<style>
  .marla-keybind {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
    border: none;
    outline: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.12s ease, opacity 0.16s ease;
    -webkit-tap-highlight-color: transparent;
    --wails-draggable: no-drag;
  }

  .marla-keybind:active:not(:disabled) {
    transform: scale(0.96);
  }

  .marla-keybind-cap,
  .marla-keybind-prompt {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    height: 24px;
    padding: 0 8px;
    border-radius: 7px;
    background: var(--mila-app-surfaceGlass, rgba(255, 255, 255, 0.065));
    color: var(--mila-text-secondary, rgba(255, 255, 255, 0.85));
    font-family: 'Medeo Sans Display', ui-monospace, system-ui, sans-serif;
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1;
    transition: background-color 0.16s ease, color 0.16s ease;
  }

  .marla-keybind:hover .marla-keybind-cap {
    background: var(--mila-app-surfaceHover, rgba(255, 255, 255, 0.12));
    color: var(--mila-text-primary, #ffffff);
  }

  .marla-keybind.is-recording .marla-keybind-prompt {
    background: var(--mila-accent-soft, rgba(255, 255, 255, 0.14));
    color: var(--mila-accent-highlight, #ffffff);
  }
</style>
