/**
 * TimBre - Device Audio Library & MediaStore Discovery Engine
 */

export class LibraryManager {
  constructor() {
    this.allTracks = [];
    this.artists = {};
    this.albums = {};
  }

  loadCachedTracks() {
    try {
      const cached = localStorage.getItem('timbre_device_tracks');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.setTracks(parsed);
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[LibraryManager] Error reading cached tracks:', e);
    }
    return [];
  }

  setTracks(tracks) {
    this.allTracks = tracks || [];
    this._indexArtistsAndAlbums();
    try {
      localStorage.setItem('timbre_device_tracks', JSON.stringify(this.allTracks));
    } catch (e) {}
  }

  _indexArtistsAndAlbums() {
    this.artists = {};
    this.albums = {};

    this.allTracks.forEach(track => {
      const artist = track.artist || 'Unknown Artist';
      const album = track.album || 'Unknown Album';

      if (!this.artists[artist]) this.artists[artist] = [];
      this.artists[artist].push(track);

      if (!this.albums[album]) {
        this.albums[album] = {
          name: album,
          artist: artist,
          art: track.art,
          tracks: []
        };
      }
      this.albums[album].tracks.push(track);
    });
  }

  search(query) {
    if (!query || !query.trim()) return this.allTracks;
    const q = query.toLowerCase().trim();
    return this.allTracks.filter(track => {
      const t = (track.title || '').toLowerCase();
      const a = (track.artist || '').toLowerCase();
      const alb = (track.album || '').toLowerCase();
      return t.includes(q) || a.includes(q) || alb.includes(q);
    });
  }

  requestDeviceScan(callback) {
    if (window.TimbreNativeBridge && typeof window.TimbreNativeBridge.getDeviceAudioTracks === 'function') {
      try {
        const jsonStr = window.TimbreNativeBridge.getDeviceAudioTracks();
        if (jsonStr && jsonStr.length > 5) {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.setTracks(parsed);
            if (typeof callback === 'function') callback(parsed);
            return;
          }
        }
      } catch (e) {
        console.warn('[LibraryManager] Native getDeviceAudioTracks error:', e);
      }
    }

    if (window.TimbreNativeBridge && typeof window.TimbreNativeBridge.scanDeviceAudio === 'function') {
      window.TimbreNativeBridge.scanDeviceAudio();
    }
  }
}

export const libraryManager = new LibraryManager();
