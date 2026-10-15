/**
 * TimBre - UI Event Handlers, Analog Rotary Dials & Navigation Routing
 */

import { dspEngine } from './dsp-engine.js';
import { playerEngine } from './player.js';
import { lyricsEngine } from './lyrics.js';
import { libraryManager } from './library.js';
import { COREAUDIO_FREQS } from './presets.js';

export class UIEngine {
  constructor() {
    this.activeScreen = 'home';
  }

  init() {
    this._bindNavigation();
    this._bindDials();
    this._bindScrubber();
    this._bindEqualizerUI();
    this._bindReverbUI();
    this._startMeterLoop();
    this._bindLyricsFlip();
  }

  switchToScreen(screenId) {
    this.activeScreen = screenId;
    document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
    
    const target = document.getElementById(`screen-${screenId}`);
    if (target) {
      target.classList.add('active');
      target.scrollTop = 0;
    }

    // Sync bottom navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      const isTarget = item.getAttribute('data-screen') === screenId;
      item.classList.toggle('active', isTarget);
    });

    // Toggle mini-player visibility: hidden on now-playing screen, shown elsewhere if track is loaded
    const miniPlayer = document.getElementById('floatingMiniPlayer');
    if (miniPlayer) {
      const hasTrack = playerEngine.getCurrentTrack() !== null;
      miniPlayer.style.display = (screenId !== 'now-playing' && hasTrack) ? 'flex' : 'none';
    }
  }

  _bindNavigation() {
    document.querySelectorAll('.nav-item[data-screen]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const screen = btn.getAttribute('data-screen');
        this.switchToScreen(screen);
      });
    });

    // Mini-player click -> open now-playing
    document.getElementById('floatingMiniPlayer')?.addEventListener('click', () => {
      this.switchToScreen('now-playing');
    });

    // Close now-playing button -> back to previous screen
    document.getElementById('closeNowPlayingBtn')?.addEventListener('click', () => {
      this.switchToScreen('home');
    });
  }

  _bindScrubber() {
    const track = document.getElementById('scrubberTrack');
    const fill = document.getElementById('scrubberFill');
    const timeCur = document.getElementById('timeCurrent');
    const timeTotal = document.getElementById('timeTotal');

    playerEngine.onTimeUpdateCallbacks.push((cur, dur) => {
      if (fill && dur > 0) {
        fill.style.width = `${(cur / dur) * 100}%`;
      }
      if (timeCur) timeCur.textContent = playerEngine.formatTime(cur);
      if (timeTotal) timeTotal.textContent = playerEngine.formatTime(dur);
    });

    if (track) {
      const handleSeek = (e) => {
        const rect = track.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const dur = playerEngine.audioEl.duration || 0;
        playerEngine.seek(frac * dur);
      };

      track.addEventListener('click', handleSeek);
    }
  }

  _bindDials() {
    const dials = [
      { id: 'eqBassDialRing', knobId: 'eqBassKnob', valId: 'eqBassVal', type: 'bass', min: -12, max: 12, unit: ' dB' },
      { id: 'eqVolumeDialRing', knobId: 'eqVolumeKnob', valId: 'eqVolVal', type: 'volume', min: 0, max: 100, unit: '%' },
      { id: 'eqTrebleDialRing', knobId: 'eqTrebleKnob', valId: 'eqTrebleVal', type: 'treble', min: -12, max: 12, unit: ' dB' }
    ];

    dials.forEach(dial => {
      const ring = document.getElementById(dial.id);
      const knob = document.getElementById(dial.knobId);
      const valBadge = document.getElementById(dial.valId);
      if (!ring || !knob) return;

      let isDragging = false;

      const updateAngle = (clientX, clientY) => {
        const rect = ring.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const rad = Math.atan2(clientY - cy, clientX - cx);
        let deg = rad * (180 / Math.PI) + 90;
        if (deg < 0) deg += 360;

        // Map to -135deg to +135deg arc (270 total sweep)
        let clampedDeg = Math.max(45, Math.min(315, deg));
        const frac = (clampedDeg - 45) / 270;
        knob.style.transform = `rotate(${clampedDeg - 180}deg)`;

        const mappedVal = dial.min + frac * (dial.max - dial.min);

        if (dial.type === 'bass') {
          dspEngine.setBass(mappedVal);
          if (valBadge) valBadge.textContent = (mappedVal >= 0 ? '+' : '') + mappedVal.toFixed(1) + dial.unit;
        } else if (dial.type === 'treble') {
          dspEngine.setTreble(mappedVal);
          if (valBadge) valBadge.textContent = (mappedVal >= 0 ? '+' : '') + mappedVal.toFixed(1) + dial.unit;
        } else if (dial.type === 'volume') {
          dspEngine.setVolume(mappedVal / 100);
          if (valBadge) valBadge.textContent = Math.round(mappedVal) + dial.unit;
        }
      };

      const start = (e) => {
        isDragging = true;
        const pt = e.touches ? e.touches[0] : e;
        updateAngle(pt.clientX, pt.clientY);
      };

      const move = (e) => {
        if (!isDragging) return;
        const pt = e.touches ? e.touches[0] : e;
        updateAngle(pt.clientX, pt.clientY);
      };

      const end = () => { isDragging = false; };

      ring.addEventListener('mousedown', start);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', end);

      ring.addEventListener('touchstart', start, { passive: true });
      window.addEventListener('touchmove', move, { passive: true });
      window.addEventListener('touchend', end);
    });
  }

  _bindEqualizerUI() {
    const container = document.getElementById('eq10BandContainer');
    if (!container) return;

    container.innerHTML = '';
    COREAUDIO_FREQS.forEach((freq, idx) => {
      const col = document.createElement('div');
      col.className = 'eq-fader-col';

      const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      col.innerHTML = `
        <div class="eq-gain-badge" id="eqBadge_${idx}">+0.0 dB</div>
        <div class="eq-fader-track" id="eqTrack_${idx}">
          <div class="eq-thumb" id="eqThumb_${idx}" style="top: 50%;"></div>
        </div>
        <div class="eq-freq-label">${label}</div>
      `;

      const track = col.querySelector(`#eqTrack_${idx}`);
      const thumb = col.querySelector(`#eqThumb_${idx}`);
      const badge = col.querySelector(`#eqBadge_${idx}`);

      let isDragging = false;
      const setGainFromY = (clientY) => {
        const rect = track.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        // frac 0 = +12 dB (top), frac 1 = -12 dB (bottom)
        const db = 12 - frac * 24;
        dspEngine.setBandGain(idx, db);
        thumb.style.top = `${frac * 100}%`;
        badge.textContent = (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
      };

      track.addEventListener('mousedown', (e) => { isDragging = true; setGainFromY(e.clientY); });
      window.addEventListener('mousemove', (e) => { if (isDragging) setGainFromY(e.clientY); });
      window.addEventListener('mouseup', () => { isDragging = false; });

      track.addEventListener('touchstart', (e) => { isDragging = true; setGainFromY(e.touches[0].clientY); }, { passive: true });
      window.addEventListener('touchmove', (e) => { if (isDragging) setGainFromY(e.touches[0].clientY); }, { passive: true });
      window.addEventListener('touchend', () => { isDragging = false; });

      container.appendChild(col);
    });

    // Preset selector
    const presetSel = document.getElementById('archangelPresetSelect');
    presetSel?.addEventListener('change', (e) => {
      dspEngine.applyPreset(e.target.value);
      this.syncEqualizerFaders();
    });

    // Reset Eq
    document.getElementById('resetEqBtn')?.addEventListener('click', () => {
      dspEngine.applyPreset('Flat');
      this.syncEqualizerFaders();
    });
  }

  syncEqualizerFaders() {
    COREAUDIO_FREQS.forEach((freq, idx) => {
      const db = dspEngine.eqGains[idx] || 0;
      const frac = (12 - db) / 24;
      const thumb = document.getElementById(`eqThumb_${idx}`);
      const badge = document.getElementById(`eqBadge_${idx}`);
      if (thumb) thumb.style.top = `${frac * 100}%`;
      if (badge) badge.textContent = (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
    });
  }

  _bindReverbUI() {
    document.querySelectorAll('.pill-opt-btn[data-reverb]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pill-opt-btn[data-reverb]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const profile = btn.getAttribute('data-reverb');
        dspEngine.setReverb(profile);
      });
    });
  }

  _bindLyricsFlip() {
    const artCard = document.getElementById('nowPlayingAlbumCard');
    const lyricsCard = document.getElementById('nowPlayingLyricsCard');
    const closeBtn = document.getElementById('closeLyricsCardBtn');

    artCard?.addEventListener('click', () => {
      artCard.style.display = 'none';
      if (lyricsCard) lyricsCard.style.display = 'flex';
    });

    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (lyricsCard) lyricsCard.style.display = 'none';
      if (artCard) artCard.style.display = 'block';
    });
  }

  _startMeterLoop() {
    const fillL = document.getElementById('meterFillL');
    const fillR = document.getElementById('meterFillR');
    const clipBadge = document.getElementById('meterClipBadge');

    const updateMeter = () => {
      const levels = dspEngine.getStereoDecibels();
      // Map -48dB to 0dBFS -> 0% to 100%
      const pctL = Math.max(0, Math.min(100, ((levels.leftDb + 48) / 48) * 100));
      const pctR = Math.max(0, Math.min(100, ((levels.rightDb + 48) / 48) * 100));

      if (fillL) fillL.style.width = `${pctL}%`;
      if (fillR) fillR.style.width = `${pctR}%`;

      if (clipBadge) {
        if (levels.clip) {
          clipBadge.textContent = 'PEAK CLIP (+0.1 dBFS)';
          clipBadge.style.color = '#ef4444';
        } else {
          clipBadge.textContent = 'CLEAN (0.0 dBFS)';
          clipBadge.style.color = '#10b981';
        }
      }

      requestAnimationFrame(updateMeter);
    };

    requestAnimationFrame(updateMeter);
  }
}

export const uiEngine = new UIEngine();
