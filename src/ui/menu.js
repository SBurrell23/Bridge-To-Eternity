// Title screen and lobby.

import { $, el, clear, show, setScreen, toast } from './dom.js';
import { chatLine, openHelp } from './hud.js';
import { normaliseCode } from '../net/net.js';
import { ROLE_TABLE, handSizeFor } from '../game/cards.js';

const NAME_KEY = 'bte.name';

export function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch (err) {
    return '';
  }
}

export function saveName(n) {
  try { localStorage.setItem(NAME_KEY, n); } catch (err) { /* ignore */ }
}

const LOBBY_OPTIONS = [
  {
    key: 'rounds',
    label: 'Rounds',
    hint: 'Grace carries across every round; the highest total wins.',
    type: 'select',
    options: [[1, '1'], [2, '2'], [3, '3 (standard)'], [4, '4'], [5, '5']],
  },
  {
    key: 'turnSeconds',
    label: 'Turn timer',
    hint: 'When the sand runs out a card is cast away for you.',
    type: 'select',
    options: [[0, 'Untimed'], [20, '20 seconds'], [30, '30 seconds'], [45, '45 seconds'],
      [60, '60 seconds'], [90, '90 seconds'], [120, '2 minutes']],
  },
  {
    key: 'handSize',
    label: 'Hand size',
    hint: 'Automatic follows the classic table: 6 cards up to five pilgrims, then 5, then 4.',
    type: 'select',
    options: [[0, 'Automatic'], [4, '4 cards'], [5, '5 cards'], [6, '6 cards'], [7, '7 cards']],
  },
  {
    key: 'fallenCount',
    label: 'How many Fallen',
    hint: 'Automatic follows the player count. One role card is always left undealt.',
    type: 'select',
    options: [[0, 'Automatic'], [1, '1'], [2, '2'], [3, '3'], [4, '4']],
  },
  {
    key: 'botSkill',
    label: 'Acolyte skill',
    hint: 'How sharply the computer-controlled pilgrims play — and how convincingly they lie.',
    type: 'select',
    parse: String,
    options: [['meek', 'Meek'], ['steady', 'Steady'], ['cunning', 'Cunning']],
  },
  {
    key: 'noDeadEnds',
    label: 'Remove broken spans',
    hint: 'A gentler deck: every bridge card can be crossed.',
    type: 'toggle',
  },
  {
    key: 'revealRoles',
    label: 'Reveal allegiances at the end of a round',
    hint: 'Turn this off for a longer, colder game.',
    type: 'toggle',
  },
];

export class Menu {
  constructor(handlers) {
    this.h = handlers;
    this.view = null;
    this.lastChatLen = -1;
    this.bind();
  }

  bind() {
    const nameInput = $('#name-input');
    nameInput.value = savedName();
    nameInput.addEventListener('change', () => saveName(nameInput.value.trim()));

    const codeInput = $('#code-input');
    codeInput.addEventListener('input', () => {
      codeInput.value = normaliseCode(codeInput.value);
    });

    $('#btn-host').addEventListener('click', () => {
      this.h.onHost(this.playerName());
    });
    $('#btn-join').addEventListener('click', () => this.tryJoin());
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.tryJoin();
    });
    $('#btn-title-settings').addEventListener('click', () => this.h.onOpenSettings());
    $('#btn-title-help').addEventListener('click', () => openHelp());

    $('#btn-start').addEventListener('click', () => this.h.onStart());
    $('#btn-lobby-leave').addEventListener('click', () => this.h.onLeave());
    $('#btn-copy-code').addEventListener('click', () => this.copyLink());

    $('#lobby-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#lobby-chat-input');
      const text = input.value.trim();
      if (text) this.h.onChat(text);
      input.value = '';
    });

    // A shared link drops straight into the code box.
    const params = new URLSearchParams(location.search);
    const room = normaliseCode(params.get('room') || params.get('r') || '');
    if (room) {
      codeInput.value = room;
      this.setStatus('Room ' + room + ' is ready — enter a name and join.');
    }
  }

  playerName() {
    const n = $('#name-input').value.trim();
    const name = n || 'Pilgrim';
    saveName(name);
    return name;
  }

  tryJoin() {
    const code = normaliseCode($('#code-input').value);
    if (code.length < 4) {
      this.setStatus('That code looks short. Codes are four letters.', true);
      return;
    }
    this.h.onJoin(code, this.playerName());
  }

  setStatus(text, isError = false) {
    const s = $('#title-status');
    s.textContent = text || '';
    s.classList.toggle('error', !!isError);
  }

  setLobbyStatus(text, isError = false) {
    const s = $('#lobby-status');
    s.textContent = text || '';
    s.classList.toggle('error', !!isError);
  }

  setBusy(busy, label) {
    $('#btn-host').disabled = busy;
    $('#btn-join').disabled = busy;
    if (busy && label) this.setStatus(label);
  }

  copyLink() {
    const code = this.view && this.view.code;
    if (!code) return;
    const url = location.origin + location.pathname + '?room=' + code;
    const done = () => toast('Invite link copied.', 'good');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => this.fallbackCopy(url, done));
    } else {
      this.fallbackCopy(url, done);
    }
  }

  fallbackCopy(text, done) {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { toast(text, '', 6000); }
    ta.remove();
  }

  showLobby(view) {
    this.view = view;
    setScreen('lobby');
    this.renderLobby(view);
  }

  renderLobby(view) {
    this.view = view;
    $('#room-code').textContent = view.code || '····';

    const list = clear($('#lobby-list'));
    const isHost = view.you && view.you.isHost;
    for (const p of view.players) {
      list.appendChild(el('li', { class: p.isBot ? 'is-bot' : '' }, [
        el('span', { class: 'dot', style: { background: p.color, color: p.color } }),
        el('span', { class: 'pname', text: p.name }),
        p.isBot ? el('span', { class: 'tag bot-tag', text: 'Acolyte' }) : null,
        p.isHost ? el('span', { class: 'tag', text: 'Host' }) : null,
        view.you && p.id === view.you.id ? el('span', { class: 'tag', text: 'You' }) : null,
        isHost && (!view.you || p.id !== view.you.id)
          ? el('button', { class: 'ghost-btn kick-btn', text: 'Remove', onclick: () => this.h.onKick(p.id) })
          : null,
      ]));
    }
    $('#lobby-count').textContent = '(' + view.players.length + ')';

    const addWrap = clear($('#lobby-add-bot'));
    if (isHost) {
      const full = view.players.length >= 10;
      addWrap.appendChild(el('button', {
        class: 'ghost-btn add-bot-btn',
        disabled: full,
        title: full ? 'The cloud is full.' : 'Summon a computer-controlled pilgrim',
        onclick: () => this.h.onAddBot(),
      }, ['+ Summon an Acolyte']));
      const bots = view.players.filter((p) => p.isBot).length;
      if (bots) {
        addWrap.appendChild(el('span', {
          class: 'hint',
          text: bots + (bots === 1 ? ' acolyte' : ' acolytes') + ' will play alongside you.',
        }));
      }
    }

    this.renderOptions(view, isHost);

    const chat = view.chat || [];
    if (chat.length !== this.lastChatLen) {
      this.lastChatLen = chat.length;
      const cl = clear($('#lobby-chat-list'));
      for (const m of chat) cl.appendChild(chatLine(m));
      cl.scrollTop = cl.scrollHeight;
    }

    const n = view.players.length;
    const start = $('#btn-start');
    show(start, !!isHost);
    start.disabled = n < 3;
    show($('#lobby-host-note'), !isHost);

    if (n < 3) {
      this.setLobbyStatus('Waiting for ' + (3 - n) + ' more pilgrim' + (3 - n === 1 ? '' : 's') + '…');
    } else {
      const table = ROLE_TABLE[n];
      const fallen = view.settings.fallenCount > 0 ? view.settings.fallenCount : table.fallen;
      const hand = view.settings.handSize > 0 ? view.settings.handSize : handSizeFor(n);
      this.setLobbyStatus(n + ' pilgrims · ' + fallen + ' will be Fallen · ' + hand + ' cards each'
        + (isHost ? '' : ' · waiting for the host'));
    }
  }

  renderOptions(view, isHost) {
    const wrap = clear($('#lobby-options'));
    for (const opt of LOBBY_OPTIONS) {
      const value = view.settings[opt.key];
      let control;
      if (opt.type === 'select') {
        const parse = opt.parse || Number;
        control = el('select', {
          disabled: !isHost,
          onchange: (e) => this.h.onSetting(opt.key, parse(e.target.value)),
        }, opt.options.map(([v, label]) => el('option', {
          value: v, text: label, selected: String(v) === String(value),
        })));
      } else {
        control = el('label', { class: 'switch' }, [
          el('input', {
            type: 'checkbox',
            checked: !!value,
            disabled: !isHost,
            onchange: (e) => this.h.onSetting(opt.key, e.target.checked),
          }),
          el('span', { text: value ? 'On' : 'Off' }),
        ]);
      }
      wrap.appendChild(el('div', { class: 'opt-row' }, [
        el('label', { text: opt.label }),
        el('div', { class: 'opt-controls' }, [control]),
        el('span', { class: 'hint', text: opt.hint }),
      ]));
    }
  }

  showTitle() {
    setScreen('title');
    this.setStatus('');
    this.setBusy(false);
    this.lastChatLen = -1;
  }
}
