/**
 * TimBre - Playback Engine & Native Android MediaSession Bridge
 */

import { dspEngine } from './dsp-engine.js';
import { lyricsEngine } from './lyrics.js';

export class PlayerEngine {
  constructor() {
    this.audioEl = new Audio();
    this.playlist = [];
    this.currentIdx = 0;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 0; // 0 = off, 1 = all, 2 = one

    this.onTrackChangeCallbacks = [];
    this.onTimeUpdateCallbacks = [];
    this.onStateChangeCallbacks = [];

    this._bindAudioEvents();
  }

  _bindAudioEvents() {
    this.audioEl.addEventListener('play', () => {
      this.isPlaying = true;
      dspEngine.init(this.audioEl);
      this._notifyState();
      this._syncNativeBridge();
    });

    this.audioEl.addEventListener('pause', () => {
      this.isPlaying = false;
      this._notifyState();
      this._syncNativeBridge();
    });

    this.audioEl.addEventListener('timeupdate', () => {
      const cur = this.audioEl.currentTime;
      const dur = this.audioEl.duration || 0;
      lyricsEngine.update(cur);
      this.onTimeUpdateCallbacks.forEach(cb => cb(cur, dur));
    });

    this.audioEl.addEventListener('ended', () => {
      if (this.repeatMode === 2) {
        // Repeat one
        this.audioEl.currentTime = 0;
        this.audioEl.play().catch(console.warn);
      } else {
        this.next();
      }
    });

    this.audioEl.addEventListener('error', (e) => {
      console.warn('[PlayerEngine] Audio error:', e);
      // Attempt loopback HTTP fallback if local Android streaming fails
      const currentTrack = this.getCurrentTrack();
      if (currentTrack && currentTrack.httpSrc && this.audioEl.src !== currentTrack.httpSrc) {
        console.log('[PlayerEngine] Retrying with loopback HTTP streaming:', currentTrack.httpSrc);
        this.audioEl.src = currentTrack.httpSrc;
        this.audioEl.play().catch(console.warn);
      }
    });
  }

  setPlaylist(tracks, startIndex = 0) {
    this.playlist = tracks || [];
    this.currentIdx = Math.max(0, Math.min(startIndex, this.playlist.length - 1));
    if (this.playlist.length > 0) {
      this.loadTrack(this.currentIdx, false);
    }
  }

  getCurrentTrack() {
    return this.playlist[this.currentIdx] || null;
  }

  loadTrack(index, autoPlay = true) {
    if (!this.playlist.length) return;
    this.currentIdx = (index + this.playlist.length) % this.playlist.length;
    const track = this.playlist[this.currentIdx];

    this.audioEl.src = track.src || track.contentUri || track.path;
    this.audioEl.load();

    this.onTrackChangeCallbacks.forEach(cb => cb(track, this.currentIdx));
    this._syncNativeBridge();

    if (autoPlay) {
      this.play();
    }
  }

  play() {
    dspEngine.init(this.audioEl);
    this.audioEl.play().catch(err => {
      console.warn('[PlayerEngine] Autoplay prevented, waiting for interaction:', err);
    });
  }

  pause() {
    this.audioEl.pause();
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  next() {
    if (!this.playlist.length) return;
    if (this.isShuffle && this.playlist.length > 1) {
      let nextIdx = Math.floor(Math.random() * this.playlist.length);
      while (nextIdx === this.currentIdx) {
        nextIdx = Math.floor(Math.random() * this.playlist.length);
      }
      this.loadTrack(nextIdx, true);
    } else {
      this.loadTrack(this.currentIdx + 1, true);
    }
  }

  previous() {
    if (this.audioEl.currentTime > 3.0) {
      this.audioEl.currentTime = 0;
      return;
    }
    this.loadTrack(this.currentIdx - 1, true);
  }

  seek(seconds) {
    if (!isNaN(seconds)) {
      this.audioEl.currentTime = seconds;
      this._syncNativeBridge();
    }
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    return this.isShuffle;
  }

  cycleRepeat() {
    this.repeatMode = (this.repeatMode + 1) % 3;
    return this.repeatMode;
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  _syncNativeBridge() {
    const track = this.getCurrentTrack();
    if (!track) return;

    if (window.TimbreNativeBridge && typeof window.TimbreNativeBridge.updateTrack === 'function') {
      try {
        const title = track.title || 'TimBre Track';
        const artist = track.artist || 'Hi-Fi Audio';
        const album = track.album || 'Device Library';
        const art = track.art || track.albumArt || 'assets/icon-512.png';
        const durationMs = Math.round((this.audioEl.duration || track.durationMs || 0) * 1000);
        const positionMs = Math.round((this.audioEl.currentTime || 0) * 1000);

        window.TimbreNativeBridge.updateTrack(title, artist, album, art, this.isPlaying, durationMs, positionMs);
      } catch (e) {
        console.warn('Native Bridge updateTrack note:', e);
      }
    }
  }

  _notifyState() {
    this.onStateChangeCallbacks.forEach(cb => cb(this.isPlaying));
  }
}

export const playerEngine = new PlayerEngine();
