// The in-game overlay: turn order, chronicle, chat, the action bar and every
// end-of-round ceremony.

import { $, el, clear, show, openModal, escapeHtml, hideTip } from './dom.js';
import { TOOLS, TOOL_INFO, cardTitle, cardDescription } from '../game/cards.js';
import { toolGlyphDataUrl, makeRoleTexture } from '../render/cardart.js';
import { gateName } from '../game/board.js';

const glyphCache = {};
function glyph(tool, broken) {
  const k = tool + (broken ? '-b' : '');
  if (!glyphCache[k]) glyphCache[k] = toolGlyphDataUrl(tool, broken, 96);
  return glyphCache[k];
}

export class Hud {
  constructor(handlers) {
    this.h = handlers;               // { onPickPlayer, onCancel, onDiscard, onRotate, onNextRound, onLeave }
    this.view = null;
    this.sel = null;
    this.lastLogLen = 0;
    this.lastChatLen = 0;
    this.shownRound = 0;
    this.activeTab = 'log';
    this.bind();
  }

  bind() {
    $('#btn-discard').addEventListener('click', () => this.h.onDiscard());
    $('#btn-cancel').addEventListener('click', () => this.h.onCancel());
    $('#btn-rotate').addEventListener('click', () => this.h.onRotate());
    $('#tp-cancel').addEventListener('click', () => this.h.onCancel());
    $('#btn-leave').addEventListener('click', () => this.h.onLeave());
    $('#btn-camera').addEventListener('click', () => this.h.onResetCamera());
    $('#btn-help').addEventListener('click', () => openHelp());

    $('#log-collapse').addEventListener('click', () => {
      $('#log-panel').classList.toggle('collapsed');
      $('#log-collapse').textContent = $('#log-panel').classList.contains('collapsed') ? '▸' : '▾';
    });

    for (const tab of document.querySelectorAll('#log-panel .tab')) {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        document.querySelectorAll('#log-panel .tab').forEach((t) => t.classList.toggle('active', t === tab));
        show($('#log-list'), this.activeTab === 'log');
        show($('#chat-list'), this.activeTab === 'chat');
        show($('#chat-form'), this.activeTab === 'chat');
        if (this.activeTab === 'chat') $('#chat-input').focus();
      });
    }

    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chat-input');
      const text = input.value.trim();
      if (text) this.h.onChat(text);
      input.value = '';
    });
  }

  setSelection(sel) {
    hideTip();
    this.sel = sel;
    this.renderActionBar();
    this.renderPlayers();
    this.renderTargetPicker();
  }

  update(view) {
    const prev = this.view;
    this.view = view;
    this.renderTop();
    this.renderPlayers();
    this.renderPeeks();
    this.renderLog();
    this.renderChat();
    this.renderActionBar();
    this.renderTargetPicker();

    if (view.phase === 'roundEnd' && (!prev || prev.phase !== 'roundEnd')) {
      this.showRoundEnd(view);
    }
    if (view.phase === 'gameEnd' && (!prev || prev.phase !== 'gameEnd')) {
      this.showGameEnd(view);
    }
  }

  renderTop() {
    const v = this.view;
    $('#round-label').textContent = 'Round ' + v.round + ' / ' + v.maxRounds;

    const me = v.you;
    const cur = v.players.find((p) => p.id === v.currentPlayerId);
    const line = $('#turn-line');
    if (v.phase !== 'playing') {
      line.textContent = v.phase === 'roundEnd' ? 'The round is over' : 'Waiting…';
      line.style.color = '';
    } else if (cur && me && cur.id === me.id) {
      line.textContent = 'Your move';
      line.style.color = '#fff4cf';
    } else if (cur) {
      line.textContent = cur.name + (cur.isBot ? ' is deliberating…' : ' is thinking…');
      line.style.color = cur.color;
    }

    // How far east the bridge actually reaches.
    let reach = 0;
    for (const k of v.connected || []) {
      const x = Number(k.split(',')[0]);
      if (x > reach) reach = x;
    }
    $('#reach-badge').firstChild.textContent = String(reach);

    const deck = $('#deck-count');
    deck.textContent = 'Deck ' + v.deckCount;
    deck.dataset.tipTitle = 'Cards left to draw';
    deck.dataset.tip = 'When the deck and every hand run dry, the Fallen win the round.';

    const reachBadge = $('#reach-badge');
    reachBadge.dataset.tipTitle = 'How far the bridge reaches';
    reachBadge.dataset.tip = 'The furthest column the bridge actually connects to from the '
      + 'Cornerstone. The Gates stand at column 8.';

    const chip = $('#my-role');
    if (me && me.role) {
      chip.textContent = me.role === 'builder' ? 'Builder' : 'Fallen';
      chip.className = 'role-chip ' + me.role;
      chip.dataset.tipTitle = me.role === 'builder' ? 'You are a Builder' : 'You are Fallen';
      chip.dataset.tip = me.role === 'builder'
        ? 'Reach the Gate to Heaven before the cards run out.'
        : 'Make sure the bridge never arrives — and never let it show.';
    } else {
      chip.textContent = '—';
      chip.className = 'role-chip';
    }
  }

  updateTimer() {
    const v = this.view;
    const wrap = $('#timer-wrap');
    if (!v || !v.turnEndsAt || v.phase !== 'playing') {
      show(wrap, false);
      return;
    }
    show(wrap, true);
    const total = (v.settings.turnSeconds || 1) * 1000;
    const left = Math.max(0, v.turnEndsAt - Date.now());
    const pct = Math.max(0, Math.min(1, left / total));
    const bar = $('#timer-bar');
    bar.style.width = (pct * 100).toFixed(1) + '%';
    bar.classList.toggle('urgent', pct < 0.25);
  }

  renderPlayers() {
    const v = this.view;
    if (!v) return;
    const list = clear($('#player-list'));
    const targetMode = this.sel && this.sel.mode === 'player';
    const targetable = new Set(targetMode ? this.targetablePlayers() : []);

    for (const p of v.players) {
      const classes = ['player-row'];
      if (p.id === v.currentPlayerId) classes.push('current');
      if (v.you && p.id === v.you.id) classes.push('me');
      if (!p.connected) classes.push('offline');
      if (p.isBot) classes.push('bot');
      if (p.isBot && p.id === v.currentPlayerId) classes.push('thinking');
      if (targetable.has(p.id)) classes.push('targetable');

      const tools = el('div', { class: 'tools' }, TOOLS.map((t) => el('span', {
        class: 'tool-icon' + (p.broken[t] ? ' broken' : ''),
        'data-tip-title': p.broken[t] ? TOOL_INFO[t].broken : TOOL_INFO[t].name + ' — intact',
        'data-tip': p.broken[t]
          ? p.name + ' cannot lay any span until this blessing is restored.'
          : 'One of the three blessings. Lose any one and you cannot lay spans.',
      }, [el('img', { src: glyph(t, p.broken[t]), alt: TOOL_INFO[t].name })])));

      const li = el('li', { class: classes.join(' ') }, [
        el('span', { class: 'dot', style: { background: p.color, color: p.color } }),
        el('span', { class: 'pname' }, [
          p.name + (p.isHost ? ' ' : ''),
          p.isHost ? el('span', { class: 'tag', text: '★' }) : null,
          p.role ? el('span', { class: 'tag', text: ' ' + (p.role === 'fallen' ? 'FALLEN' : 'BUILDER') }) : null,
        ]),
        el('span', { class: 'p-right' }, [
          tools,
          el('span', {
            class: 'hand-count',
            'data-tip-title': 'Cards in hand',
            'data-tip': p.name + ' is holding ' + p.handCount + ' card'
              + (p.handCount === 1 ? '' : 's') + '.',
            text: '✦' + p.handCount,
          }),
          el('span', {
            class: 'grace',
            'data-tip-title': 'Grace',
            'data-tip': 'Winnings so far, carried across every round. Most Grace wins.',
            text: String(p.grace),
          }),
        ]),
      ]);

      if (targetable.has(p.id)) {
        li.addEventListener('click', () => this.h.onPickPlayer(p.id));
      }
      list.appendChild(li);
    }
  }

  targetablePlayers() {
    const v = this.view;
    const sel = this.sel;
    if (!v || !sel || !sel.card || sel.card.type !== 'action') return [];
    const card = sel.card;
    if (card.action === 'break') {
      return v.players.filter((p) => !p.broken[card.tool]).map((p) => p.id);
    }
    if (card.action === 'repair') {
      return v.players.filter((p) => card.tools.some((t) => p.broken[t])).map((p) => p.id);
    }
    return [];
  }

  renderPeeks() {
    const wrap = clear($('#gate-peeks'));
    const v = this.view;
    if (!v || !v.you || !v.you.peeks) return;
    for (const [gi, isGold] of Object.entries(v.you.peeks)) {
      const where = gateName(gi);
      wrap.appendChild(el('div', {
        class: 'peek-chip ' + (isGold ? 'gold' : 'stone'),
        text: where + ' · ' + (isGold ? 'HEAVEN' : 'stone'),
        'data-tip-title': 'Your Revelation',
        'data-tip': 'You looked beyond this Gate. Nobody else knows what you saw.',
      }));
    }
  }

  renderLog() {
    const v = this.view;
    const list = $('#log-list');
    if (!v.log || v.log.length === this.lastLogLen) return;
    this.lastLogLen = v.log.length;
    clear(list);
    for (const entry of v.log) {
      list.appendChild(el('div', { class: 'log-line ' + (entry.kind || ''), html: escapeHtml(entry.text) }));
    }
    list.scrollTop = list.scrollHeight;
  }

  renderChat() {
    const v = this.view;
    const list = $('#chat-list');
    const chat = v.chat || [];
    if (chat.length === this.lastChatLen) return;
    const grew = chat.length > this.lastChatLen;
    this.lastChatLen = chat.length;
    clear(list);
    for (const m of chat) list.appendChild(chatLine(m));
    list.scrollTop = list.scrollHeight;
    if (grew && this.activeTab !== 'chat') {
      const tab = document.querySelector('#log-panel .tab[data-tab="chat"]');
      if (tab) tab.style.color = 'var(--gold-1)';
    }
  }

  renderActionBar() {
    const v = this.view;
    const bar = $('#action-bar');
    if (!v || v.phase !== 'playing' || !v.you) { show(bar, false); return; }
    const myTurn = v.currentPlayerId === v.you.id;
    show(bar, myTurn);
    if (!myTurn) return;

    const prompt = $('#action-prompt');
    const sel = this.sel;
    const blessed = !(v.you.broken.halo || v.you.broken.wings || v.you.broken.hammer);

    if (!sel) {
      prompt.innerHTML = blessed
        ? 'Choose a card from your hand.'
        : 'Your blessings are broken — you cannot lay spans until they are restored.';
    } else if (sel.mode === 'path') {
      prompt.innerHTML = '<strong>' + escapeHtml(cardTitle(sel.card)) + '</strong> — click a glowing space to lay it.';
    } else if (sel.mode === 'blocked') {
      prompt.innerHTML = '<strong>' + escapeHtml(cardTitle(sel.card)) + '</strong> — '
        + escapeHtml(sel.blockedWhy || 'this cannot be played')
        + ', so it can only be cast away.';
    } else if (sel.mode === 'player') {
      prompt.innerHTML = '<strong>' + escapeHtml(cardTitle(sel.card)) + '</strong> — choose a pilgrim.';
    } else if (sel.mode === 'tile') {
      prompt.innerHTML = '<strong>Smite</strong> — click a span to cast it down.';
    } else if (sel.mode === 'gate') {
      prompt.innerHTML = '<strong>Revelation</strong> — choose a Gate to look beyond.';
    } else if (sel.mode === 'tool') {
      prompt.innerHTML = '<strong>Benediction</strong> — which blessing should be restored?';
    }

    show($('#btn-rotate'), !!(sel && sel.mode === 'path'));
    $('#btn-discard').classList.toggle('primary-hint', !!(sel && sel.mode === 'blocked'));
    show($('#btn-cancel'), !!sel);
    $('#btn-discard').textContent = sel ? 'Cast This Away' : 'Cast Away a Card';
    $('#btn-discard').disabled = !sel;
  }

  renderTargetPicker() {
    const picker = $('#target-picker');
    const sel = this.sel;
    if (!sel || sel.mode !== 'tool') { show(picker, false); return; }
    show(picker, true);
    const opts = clear($('#tp-options'));
    for (const tool of sel.tools) {
      opts.appendChild(el('button', {
        class: 'ghost-btn tp-option',
        onclick: () => this.h.onPickTool(tool),
      }, [
        el('img', { src: glyph(tool, false), alt: '' }),
        TOOL_INFO[tool].name,
      ]));
    }
  }

  // -- ceremonies ----------------------------------------------------------
  showRoleReveal(role, onDone) {
    const canvas = makeRoleTexture(role);
    const wrap = el('div', { class: 'role-reveal' }, [
      canvas,
      el('div', { class: 'role-name ' + role, text: role === 'builder' ? 'You are a Builder' : 'You are Fallen' }),
      el('p', {
        text: role === 'builder'
          ? 'Work with the others. Reach the Gate to Heaven before the cards run out — but watch who lays a broken span.'
          : 'Smile. Help a little. Then make certain the bridge never arrives. Say nothing of this.',
      }),
    ]);
    openModal({
      title: 'Your allegiance',
      body: wrap,
      dismissable: false,
      actions: [{ label: 'I understand', primary: true, onClick: onDone }],
    });
  }

  showRoundEnd(v) {
    const r = v.roundResult;
    const builders = r.winner === 'builders';
    const body = el('div');

    body.appendChild(el('p', {
      text: builders
        ? 'The last span settles into place and the Gate to Heaven swings open. Light pours across the bridge.'
        : 'The cards run out. The span ends in empty air, and somewhere below, something laughs.',
    }));

    body.appendChild(el('h3', { text: 'The Gates' }));
    body.appendChild(el('div', { class: 'gate-row' }, r.goals.map((g) => {
      const where = gateName(g.index, false);
      return el('div', { class: 'gate-card ' + (g.isGold ? 'gold' : 'stone') }, [
        el('div', { class: 'gate-art', text: g.isGold ? '★' : '▪' }),
        where,
      ]);
    })));

    body.appendChild(el('h3', { text: 'Grace awarded' }));
    const rows = v.players.map((p) => {
      const award = r.awards.find((a) => a.id === p.id);
      const roleName = (r.roles.find((x) => x.id === p.id) || {}).role;
      return el('tr', { class: award ? 'win' : '' }, [
        el('td', {}, [
          el('span', { class: 'dot', style: { background: p.color, display: 'inline-block', marginRight: '7px' } }),
          p.name,
        ]),
        el('td', { class: 'role-cell ' + roleName, text: roleName === 'fallen' ? 'Fallen' : 'Builder' }),
        el('td', { class: 'num', text: award ? '+' + award.value : '—' }),
        el('td', { class: 'num', text: String(p.grace) }),
      ]);
    });
    body.appendChild(el('table', { class: 'score-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Pilgrim' }), el('th', { text: 'Was' }),
        el('th', { text: 'This round' }), el('th', { text: 'Total' }),
      ])]),
      el('tbody', {}, rows),
    ]));

    const isHost = v.you && v.you.isHost;
    const final = r.isFinalRound;
    openModal({
      title: builders ? 'The Gate Opens' : 'The Bridge Fails',
      body,
      dismissable: true,
      actions: isHost
        ? [{ label: final ? 'See the final tally' : 'Next round', primary: true, onClick: () => this.h.onNextRound() }]
        : [{ label: 'Waiting for the host…', close: true }],
    });
  }

  showGameEnd(v) {
    const g = v.gameResult;
    if (!g) return;
    const body = el('div');
    const winners = g.ranked.filter((r) => g.winners.includes(r.id));
    body.appendChild(el('p', {
      text: winners.length > 1
        ? 'The scales balance exactly. ' + winners.map((w) => w.name).join(' and ') + ' share the crossing.'
        : winners[0].name + ' gathered the most Grace and walks through first.',
    }));
    body.appendChild(el('table', { class: 'score-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: '#' }), el('th', { text: 'Pilgrim' }), el('th', { text: 'Grace' }),
      ])]),
      el('tbody', {}, g.ranked.map((r, i) => el('tr', { class: g.winners.includes(r.id) ? 'win' : '' }, [
        el('td', { text: String(i + 1) }),
        el('td', { text: r.name }),
        el('td', { class: 'num', text: String(r.grace) }),
      ]))),
    ]));

    const isHost = v.you && v.you.isHost;
    openModal({
      title: 'The Final Tally',
      body,
      dismissable: true,
      actions: isHost
        ? [
            { label: 'Back to the lobby', primary: true, onClick: () => this.h.onBackToLobby() },
            { label: 'Leave', onClick: () => this.h.onLeave() },
          ]
        : [{ label: 'Leave', onClick: () => this.h.onLeave() }],
    });
  }
}

export function chatLine(m) {
  if (m.kind === 'system') {
    return el('div', { class: 'chat-line system', text: m.text });
  }
  return el('div', { class: 'chat-line' }, [
    el('span', { class: 'who', style: { color: m.color || '#fff' }, text: m.name + ': ' }),
    m.text,
  ]);
}

const HELP_TABS = [
  {
    id: 'game',
    label: 'The game',
    html: `
      <p class="lead">Two crews stand on a cloud. The <b>Builders</b> are laying a bridge east to
      the Gate to Heaven. The <b>Fallen</b> are mixed in among them, helping just enough to stay
      above suspicion. Nobody knows who is who.</p>

      <h4>Your turn — do one thing, then draw</h4>
      <ul class="spaced">
        <li><b>Lay a span.</b> Every touching edge must match, and it must join a span that already
          reaches back to the Cornerstone.</li>
        <li><b>Play an action</b> on a pilgrim, a span or a Gate.</li>
        <li><b>Cast a card away</b> face down if you would rather do nothing.</li>
      </ul>

      <h4>How a round ends</h4>
      <ul class="spaced">
        <li>Reach the Gate to Heaven and the <b>Builders win</b>. Whoever laid the final span takes the
          richest share of Grace.</li>
        <li>If every hand empties first, the <b>Fallen win</b> and share the spoils.</li>
        <li>Three rounds. The most Grace at the end wins the crossing.</li>
      </ul>

      <p class="muted">Short of players? The host can summon Acolytes in the lobby. They are dealt
      allegiances like anyone else — the helpful one beside you may well be Fallen.</p>`,
  },
  {
    id: 'cards',
    label: 'The cards',
    html: `
      <div class="help-cards">
        <div><b>Bridge Span</b><span>Extends the bridge. Press <kbd>R</kbd> to turn it round before
          you place it.</span></div>
        <div><b>Broken Span</b><span>Attaches, but nothing crosses it. A quiet way to waste a
          space.</span></div>
        <div><b>Curse</b><span>Snuffed Halo, Shorn Wings or Shattered Hammer. That pilgrim may lay
          no spans until it is restored.</span></div>
        <div><b>Blessing</b><span>Restores one broken blessing on anyone, yourself included.</span></div>
        <div><b>Benediction</b><span>Restores either of two blessings — you choose which.</span></div>
        <div><b>Smite</b><span>Destroys one laid span. Never the Cornerstone, never a Gate.</span></div>
        <div><b>Revelation</b><span>Look secretly beyond one Gate — one of the three is the Gate
          to Heaven. Only you see what lies there.</span></div>
      </div>
      <p class="muted">A pilgrim with any blessing broken cannot lay spans at all — but can still
      play actions, and can still cast a card away.</p>`,
  },
  {
    id: 'controls',
    label: 'Controls',
    html: `
      <div class="key-list">
        <div><span>Pan the view</span><kbd>drag</kbd></div>
        <div><span>Orbit</span><kbd>right-drag</kbd></div>
        <div><span>Zoom</span><kbd>wheel</kbd></div>
        <div><span>Pan</span><kbd>W A S D</kbd></div>
        <div><span>Turn</span><kbd>Q E</kbd></div>
        <div><span>Reset the view</span><kbd>R</kbd></div>
        <div><span>Turn a held span round</span><kbd>R</kbd></div>
        <div><span>Pick a card</span><kbd>1 – 6</kbd></div>
        <div><span>Chat</span><kbd>Enter</kbd></div>
        <div><span>Help</span><kbd>H</kbd></div>
        <div><span>Cancel / settings</span><kbd>Esc</kbd></div>
      </div>
      <p class="muted">Cards in your hand are drawn the way the board looks from the Cornerstone:
      east — towards the Gates — is up.</p>`,
  },
];

export function openHelp() {
  const body = el('div', { class: 'help' });
  const bar = el('div', { class: 'help-tabs' });
  const pane = el('div', { class: 'help-pane' });

  HELP_TABS.forEach((tab, i) => {
    const btn = el('button', {
      class: 'help-tab' + (i === 0 ? ' active' : ''),
      text: tab.label,
      onclick: () => {
        bar.querySelectorAll('.help-tab').forEach((b) => b.classList.toggle('active', b === btn));
        pane.innerHTML = tab.html;
      },
    });
    bar.appendChild(btn);
  });
  pane.innerHTML = HELP_TABS[0].html;

  body.appendChild(bar);
  body.appendChild(pane);
  openModal({ title: 'How to Play', body, wide: true, actions: [{ label: 'Close', primary: true }] });
}

export { cardDescription };
