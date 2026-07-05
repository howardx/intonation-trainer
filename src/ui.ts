export type Mode = 'short' | 'sustain';
export type LabelMode = 'names' | 'solfege' | 'both';

export interface Controls {
  element: HTMLElement;
}

export interface ControlHandlers {
  onMode: (mode: Mode) => void;
  onVolume: (v: number) => void;
  onWaveform: (w: OscillatorType) => void;
  onLabels: (l: LabelMode) => void;
}

function segmented<T extends string>(
  name: string,
  options: Array<{ value: T; label: string }>,
  initial: T,
  onChange: (v: T) => void,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', name);
  const buttons = new Map<T, HTMLButtonElement>();
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = opt.label;
    b.classList.toggle('selected', opt.value === initial);
    b.setAttribute('aria-pressed', String(opt.value === initial));
    b.addEventListener('click', () => {
      for (const [v, btn] of buttons) {
        btn.classList.toggle('selected', v === opt.value);
        btn.setAttribute('aria-pressed', String(v === opt.value));
      }
      onChange(opt.value);
    });
    buttons.set(opt.value, b);
    group.appendChild(b);
  }
  return group;
}

function field(labelText: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = labelText;
  wrap.append(caption, control);
  return wrap;
}

export function createControls(handlers: ControlHandlers): Controls {
  const bar = document.createElement('div');
  bar.className = 'controls';

  const mode = segmented<Mode>(
    'Mode',
    [
      { value: 'short', label: 'Short 短音' },
      { value: 'sustain', label: 'Sustain 持续' },
    ],
    'sustain',
    handlers.onMode,
  );

  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.01';
  volume.value = '0.3';
  volume.addEventListener('input', () => handlers.onVolume(Number(volume.value)));

  const waveform = segmented<OscillatorType>(
    'Waveform',
    [
      { value: 'sine', label: 'Sine 正弦' },
      { value: 'triangle', label: 'Tri 三角' },
      { value: 'square', label: 'Sq 方波' },
    ],
    'sine',
    handlers.onWaveform,
  );

  const labels = segmented<LabelMode>(
    'Labels',
    [
      { value: 'names', label: 'Names 音名' },
      { value: 'solfege', label: 'Solfège 唱名' },
      { value: 'both', label: 'Both 全部' },
    ],
    'both',
    handlers.onLabels,
  );

  bar.append(
    field('Mode 模式', mode),
    field('Volume 音量', volume),
    field('Tone 音色', waveform),
    field('Labels 标签', labels),
  );
  return { element: bar };
}

/**
 * Best-effort screen wake lock: request on first interaction, re-request
 * when the tab becomes visible again. Fails silently where unsupported.
 */
export function setupWakeLock(): { onFirstInteraction: () => void } {
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;

  const request = async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
    } catch {
      /* denied or unsupported — non-fatal */
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) void request();
  });
  window.addEventListener('pagehide', () => {
    void sentinel?.release().catch(() => {});
    sentinel = null;
  });

  return {
    onFirstInteraction() {
      if (wanted) return;
      wanted = true;
      void request();
    },
  };
}

/** Small dismissible add-to-home-screen hint for first-time mobile visitors. */
export function createInstallHint(): HTMLElement | null {
  const KEY = 'a2hs-hint-dismissed';
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  const isMobile = /iphone|ipad|android/i.test(navigator.userAgent);
  if (isStandalone || !isMobile || localStorage.getItem(KEY)) return null;

  const hint = document.createElement('div');
  hint.className = 'install-hint';
  const text = document.createElement('span');
  text.textContent = 'Tip: Add to Home Screen for offline use · 提示：添加到主屏幕即可离线使用';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'install-hint-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => {
    localStorage.setItem(KEY, '1');
    hint.remove();
  });
  hint.append(text, close);
  return hint;
}
