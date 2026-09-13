// Player-local preferences: audio levels and graphics quality. Persisted to
// localStorage so a returning pilgrim keeps their setup.

import { el, clear, openModal } from './dom.js';

const STORE_KEY = 'bte.settings.v1';

export const DEFAULTS = {
  // audio
  master: 0.8,
  sfx: 0.85,
  music: 0.4,
  muted: false,
  // graphics
  preset: 'balanced',
  fpsCap: 60,
  antialias: true,
  resolution: 1,        // multiplier on devicePixelRatio, capped at 2
  shadows: true,
  cloudCount: 60,
  godRays: true,
  motes: true,
  fogFar: 260,
  showFps: false,
  // comfort
  cameraShake: true,
};

export const PRESETS = {
  low:      { fpsCap: 30, antialias: false, resolution: 0.7, shadows: false, cloudCount: 18, godRays: false, motes: false, fogFar: 180 },
  balanced: { fpsCap: 60, antialias: true,  resolution: 1,   shadows: true,  cloudCount: 60, godRays: true,  motes: true,  fogFar: 260 },
  high:     { fpsCap: 120, antialias: true, resolution: 1.3, shadows: true,  cloudCount: 110, godRays: true, motes: true,  fogFar: 340 },
  ultra:    { fpsCap: 0,  antialias: true,  resolution: 2,   shadows: true,  cloudCount: 170, godRays: true, motes: true,  fogFar: 420 },
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch (err) { /* private mode; preferences just won't persist */ }
}

export function qualityOf(s = settings) {
  return {
    shadows: s.shadows,
    cloudCount: s.cloudCount,
    godRays: s.godRays,
    motes: s.motes,
    fogFar: s.fogFar,
    antialias: s.antialias,
    resolution: s.resolution,
    fpsCap: s.fpsCap,
  };
}

function matchPreset(s) {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (Object.entries(p).every(([k, v]) => s[k] === v)) return name;
  }
  return 'custom';
}

function row(label, hint, control) {
  return el('div', { class: 'opt-row' }, [
    el('label', { text: label }),
    el('div', { class: 'opt-controls' }, [].concat(control)),
    hint ? el('span', { class: 'hint', text: hint }) : null,
  ]);
}

function slider(key, min, max, step, format, onChange) {
  const val = el('span', { class: 'val', text: format(settings[key]) });
  const input = el('input', {
    type: 'range', min, max, step, value: settings[key],
    oninput: (e) => {
      settings[key] = parseFloat(e.target.value);
      val.textContent = format(settings[key]);
      onChange(key);
    },
  });
  return [input, val];
}

function toggle(key, onChange) {
  return el('label', { class: 'switch' }, [
    el('input', {
      type: 'checkbox',
      checked: settings[key],
      onchange: (e) => { settings[key] = e.target.checked; onChange(key); },
    }),
    el('span', { text: settings[key] ? 'On' : 'Off' }),
  ]);
}

function select(key, options, onChange, parse = Number) {
  return el('select', {
    onchange: (e) => { settings[key] = parse(e.target.value); onChange(key); },
  }, options.map(([value, label]) => el('option', {
    value, text: label, selected: String(settings[key]) === String(value),
  })));
}

/**
 * @param onChange  called with the key that changed; the app applies it live.
 */
export function openSettingsModal(onChange) {
  const apply = (key) => {
    settings.preset = matchPreset(settings);
    saveSettings();
    onChange(key);
    if (presetSelect) presetSelect.value = settings.preset;
    refreshSwitchLabels();
  };

  let presetSelect = null;
  const body = el('div', { class: 'settings-grid' });

  body.appendChild(el('h3', { text: 'Sound' }));
  body.appendChild(row('Master volume', null, slider('master', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', apply)));
  body.appendChild(row('Effects', 'Synthesised live — no sound files.',
    slider('sfx', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', apply)));
  body.appendChild(row('Music', null, slider('music', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', apply)));
  body.appendChild(row('Mute everything', null, toggle('muted', apply)));

  body.appendChild(el('h3', { text: 'Graphics' }));
  presetSelect = el('select', {
    onchange: (e) => {
      const name = e.target.value;
      if (name !== 'custom') {
        Object.assign(settings, PRESETS[name]);
        settings.preset = name;
        saveSettings();
        onChange('preset');
        rebuild();
      }
    },
  }, [['low', 'Low'], ['balanced', 'Balanced'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']]
    .map(([v, l]) => el('option', { value: v, text: l, selected: matchPreset(settings) === v })));
  body.appendChild(row('Quality preset', null, presetSelect));

  body.appendChild(row('Frame rate cap', 'Lower caps save battery.',
    select('fpsCap', [[30, '30 fps'], [45, '45 fps'], [60, '60 fps'], [120, '120 fps'], [0, 'Unlimited']], apply)));
  body.appendChild(row('Anti-aliasing', 'Smooths jagged edges.', toggle('antialias', apply)));
  body.appendChild(row('Resolution scale', 'Below 100% renders smaller and upscales.',
    slider('resolution', 0.5, 2, 0.1, (v) => Math.round(v * 100) + '%', apply)));

  body.appendChild(row('Shadows', null, toggle('shadows', apply)));
  body.appendChild(row('Cloud density', null,
    slider('cloudCount', 0, 200, 10, (v) => String(Math.round(v)), apply)));
  body.appendChild(row('Shafts of light', null, toggle('godRays', apply)));
  body.appendChild(row('Drifting motes', null, toggle('motes', apply)));
  body.appendChild(row('View distance', null,
    slider('fogFar', 120, 500, 10, (v) => Math.round(v) + 'm', apply)));
  body.appendChild(row('Show FPS counter', null, toggle('showFps', apply)));

  function refreshSwitchLabels() {
    body.querySelectorAll('.switch').forEach((sw) => {
      const cb = sw.querySelector('input');
      sw.querySelector('span').textContent = cb.checked ? 'On' : 'Off';
    });
  }

  function rebuild() {
    // Preset changes touch many controls at once; redraw the whole sheet.
    clear(body);
    openSettingsModal(onChange);
  }

  openModal({
    title: 'Settings',
    wide: true,
    body,
    actions: [
      {
        label: 'Restore defaults',
        close: false,
        onClick: () => {
          Object.assign(settings, DEFAULTS);
          saveSettings();
          onChange('preset');
          rebuild();
        },
      },
      { label: 'Done', primary: true },
    ],
  });
}
