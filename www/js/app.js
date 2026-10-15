/**
 * TimBre - Application Bootstrapper & Lifecycle Controller
 */

import { dspEngine } from './dsp-engine.js';
import { playerEngine } from './player.js';
import { lyricsEngine } from './lyrics.js';
import { libraryManager } from './library.js';
import { uiEngine } from './ui.js';

// Default Fallback Demo Playlist
const DEMO_PLAYLIST = [
  {
    id: 1,
    title: "Blinding Lights",
    artist: "The Weeknd",
    album: "After Hours (Studio Master)",
    duration: "3:20",
    durationMs: 200000,
    art: "assets/blinding_lights.jpg",
    src: "assets/blinding_lights.jpg"
  }
];

class TimBreApp {
  init() {
    console.log('[TimBre] Booting Archangel Hi-Fi Engine...');

    // 1. Initialize UI & Subsystems
    uiEngine.init();
    lyricsEngine.init('lyricsScrollArea');

    // 2. Global Native Bridge Callback for Phone Audio Scanner
    window.onDeviceAudioLoaded = (tracks) => {
      console.log(`[TimBre] Received ${tracks ? tracks.length : 0} tracks from device scanner.`);
      if (tracks && tracks.length > 0) {
        libraryManager.setTracks(tracks);
        this.renderTrackLists();
        const first = playerEngine.getCurrentTrack();
        if (!first) {
          playerEngine.setPlaylist(tracks, 0);
        }
      }
    };

    // 3. Load Cached or Initial Tracks
    const cached = libraryManager.loadCachedTracks();
    if (cached.length > 0) {
      playerEngine.setPlaylist(cached, 0);
      this.renderTrackLists();
    } else {
      playerEngine.setPlaylist(DEMO_PLAYLIST, 0);
      this.renderTrackLists();
    }

    // 4. Request Phone Media Store Scan
    libraryManager.requestDeviceScan((tracks) => {
      if (tracks.length) {
        playerEngine.setPlaylist(tracks, 0);
        this.renderTrackLists();
      }
    });

    // 5. Bind Player Engine Callbacks to UI
    this._bindPlayerCallbacks();

    // 6. Bind Global Playback Control Buttons
    this._bindControls();

    // 7. Initialize Lucide Icons
    if (window.lucide) {
      window.lucide.createIcons();
    }

    console.log('[TimBre] App successfully initialized.');
  }

  _bindPlayerCallbacks() {
    // When track changes -> update artwork, title, artist across Home, Now Playing, and Mini-player
    playerEngine.onTrackChangeCallbacks.push((track) => {
      const titleEls = document.querySelectorAll('.current-track-title');
      const artistEls = document.querySelectorAll('.current-track-artist');
      const artEls = document.querySelectorAll('.current-track-art');

      titleEls.forEach(el => el.textContent = track.title || 'Unknown Track');
      artistEls.forEach(el => el.textContent = track.artist || 'Unknown Artist');
      artEls.forEach(img => {
        if (img.tagName === 'IMG') {
          img.src = track.art || 'assets/icon-512.png';
        }
      });

      // Update lyrics if available
      if (track.lyrics) {
        lyricsEngine.parseLRC(track.lyrics);
        lyricsEngine.render((seekSec) => playerEngine.seek(seekSec));
      }
    });

    // Play/Pause State Sync
    playerEngine.onStateChangeCallbacks.push((isPlaying) => {
      document.querySelectorAll('.play-toggle-btn').forEach(btn => {
        const icon = btn.querySelector('i') || btn.querySelector('svg');
        if (icon) {
          icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
        }
      });
      if (window.lucide) window.lucide.createIcons();
    });
  }

  _bindControls() {
    // Play/Pause toggles across UI
    document.querySelectorAll('.play-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        playerEngine.togglePlay();
      });
    });

    // Skip Next
    document.querySelectorAll('.next-track-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        playerEngine.next();
      });
    });

    // Skip Previous
    document.querySelectorAll('.prev-track-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        playerEngine.previous();
      });
    });

    // Shuffle
    document.getElementById('shuffleBtn')?.addEventListener('click', (e) => {
      const active = playerEngine.toggleShuffle();
      e.currentTarget.classList.toggle('active', active);
    });

    // Repeat
    document.getElementById('repeatBtn')?.addEventListener('click', (e) => {
      const mode = playerEngine.cycleRepeat();
      e.currentTarget.classList.toggle('active', mode > 0);
    });

    // Search Input in Library
    const searchInput = document.getElementById('librarySearchInput');
    searchInput?.addEventListener('input', (e) => {
      const filtered = libraryManager.search(e.target.value);
      this.renderTrackListWithTracks('libraryTrackList', filtered);
    });
  }

  renderTrackLists() {
    this.renderTrackListWithTracks('libraryTrackList', libraryManager.allTracks);
    this.renderTrackListWithTracks('queueTrackList', playerEngine.playlist);
  }

  renderTrackListWithTracks(containerId, tracks) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    if (!tracks || !tracks.length) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 24px;">No tracks found</div>`;
      return;
    }

    tracks.forEach((track, idx) => {
      const card = document.createElement('div');
      card.className = 'track-item-card';
      if (idx === playerEngine.currentIdx) card.classList.add('active-playing');

      card.innerHTML = `
        <img class="track-art-sm" src="${track.art || 'assets/icon-192.png'}" alt="Art">
        <div class="track-meta-item">
          <div class="track-title-item">${track.title}</div>
          <div class="track-artist-item">${track.artist}</div>
        </div>
        <div class="track-duration-item">${track.duration || '3:30'}</div>
      `;

      card.addEventListener('click', () => {
        playerEngine.loadTrack(idx, true);
        uiEngine.switchToScreen('now-playing');
      });

      container.appendChild(card);
    });
  }
}

export const app = new TimBreApp();

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
