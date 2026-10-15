const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MUSIC_DIR = path.join(__dirname, 'music');
if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

const TUNING_FILE = path.join(DATA_DIR, 'tuning_config.json');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
const TRACKS_INDEX_FILE = path.join(DATA_DIR, 'tracks_index.json');
const LYRICS_CACHE_FILE = path.join(DATA_DIR, 'lyrics_cache.json');

// ==========================================
// 🍎 ARCHANGEL COREAUDIO & DEEP TUNING CONSTANTS
// ==========================================
const COREAUDIO_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const ARCHANGEL_EQ_PRESETS = {
  "Flat": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  "Acoustic": [4.0, 3.5, 2.5, 1.0, 1.5, 1.5, 2.5, 3.5, 3.0, 2.0],
  "Bass Booster": [6.0, 5.0, 4.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  "Bass Reducer": [-6.0, -5.0, -4.0, -2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  "Classical": [5.0, 4.0, 3.0, 2.0, -2.0, -2.0, 0.0, 2.0, 3.0, 3.0],
  "Electronic": [4.0, 3.0, 0.0, -2.0, -2.0, 2.0, 1.0, 2.0, 4.0, 5.0],
  "Hip-Hop": [6.0, 5.0, 1.0, 3.0, -2.0, -2.0, 1.0, -1.0, 2.0, 3.0],
  "Jazz": [4.0, 3.0, 1.0, 2.0, -2.0, -2.0, 0.0, 1.0, 3.0, 4.0],
  "Late Night": [3.0, 2.0, 0.0, 0.0, 1.0, 2.0, 1.0, 0.0, -2.0, -4.0],
  "Pop": [-1.0, 1.0, 3.0, 4.0, 4.0, 2.0, -1.0, -1.0, -1.0, -1.0],
  "R&B": [3.0, 7.0, 5.0, 1.0, -2.0, 2.0, 3.0, 3.0, 4.0, 4.0],
  "Rock": [5.0, 4.0, 3.0, 1.0, -1.0, -1.0, 1.0, 3.0, 4.0, 5.0],
  "Spoken Word": [-3.0, 0.0, 1.0, 1.0, 3.0, 5.0, 4.5, 3.0, 1.0, -2.0],
  "Treble Booster": [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 3.0, 5.0, 6.0, 7.0],
  "Vocal Booster": [-2.0, -3.0, -3.0, 1.0, 4.0, 4.0, 3.0, 1.0, 0.0, -2.0],
  "Audiophile Pure": [4.5, 3.5, 1.5, 0.0, -0.5, 0.0, 1.0, 2.5, 4.0, 4.5]
};

const DEFAULT_TUNING = {
  // Archangel Sound Check (ITU-R BS.1770 / EBU R128 Loudness Normalization)
  soundCheck: {
    enabled: true,
    targetLUFS: -16.0, // Archangel Music standard -16 LUFS
    preampGainDb: 0.0  // -12.0 dB to +12.0 dB
  },
  // Archangel Headphone Accommodations & Audiogram Tuning
  headphoneAccommodations: {
    enabled: true,
    tuningProfile: "balanced", // "balanced" | "vocal" | "brightness"
    softSoundsBoostDb: 3.0,    // 0 = Off, 3 = Slight, 6 = Moderate, 9 = Strong
    customAudiogram: {
      enabled: false,
      compensationBands: {
        "125": 0.0,
        "250": 0.0,
        "500": 2.0,
        "1000": 3.5,
        "2000": 4.0,
        "4000": 2.5,
        "8000": 0.5
      }
    }
  },
  // Archangel CoreAudio 10-Band Professional Equalizer
  coreAudioEQ: {
    enabled: true,
    activePreset: "Rock",
    preampDb: 0.0,
    bands: COREAUDIO_FREQUENCIES.map((freq, idx) => ({
      freq,
      gainDb: ARCHANGEL_EQ_PRESETS["Rock"][idx] || 0.0
    }))
  },
  // Archangel Spatial Audio & Bauer Stereophonic-to-Binaural Crossfeed (BS2B)
  spatialAudio: {
    enabled: true,
    mode: "crossfeed", // "off" | "crossfeed" | "room" | "concert"
    crossfeedLevel: "default", // "subtle" (-6dB, 650Hz) | "default" (-4.5dB, 700Hz) | "wide" (-3dB, 750Hz)
    headDelayMs: 0.45,
    filterFreqHz: 700
  },
  // Archangel Late Night Mode / Dynamic Range Compressor (DRC)
  lateNightDRC: {
    enabled: false,
    thresholdDb: -24.0,
    kneeDb: 30.0,
    ratio: 12.0,
    attackSec: 0.003,
    releaseSec: 0.25
  },
  // Master Decibels Gain & Balance
  masterGainDb: 0.0,
  channelBalanceDb: 0.0
};

// ==========================================
// 💾 CONFIG PERSISTENCE HELPERS
// ==========================================
function loadJson(file, defaultVal) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    console.error(`Error loading ${file}:`, err);
  }
  return defaultVal;
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error saving ${file}:`, err);
    return false;
  }
}

let tuningConfig = loadJson(TUNING_FILE, DEFAULT_TUNING);
let playlists = loadJson(PLAYLISTS_FILE, [
  { id: "fav", name: "Favorites", tracks: [] },
  { id: "hifi", name: "Hi-Fi Master Lossless", tracks: [] },
  { id: "chill", name: "Late Night Chill", tracks: [] }
]);
let favorites = loadJson(FAVORITES_FILE, []);
let tracksIndex = loadJson(TRACKS_INDEX_FILE, []);
let lyricsCache = loadJson(LYRICS_CACHE_FILE, {
  "demo-1": {
    synced: true,
    source: "curated",
    lrc: `[00:00.00] (Astro, yeah)
[00:04.20] Sun is down, freezin' cold
[00:08.50] That's how we already know winter's here
[00:13.10] My dawg would probably do it for a Louis belt
[00:16.80] That's just all he know, he don't know nothin' else
[00:20.50] I tried to show 'em, yeah
[00:23.20] I tried to show 'em, yeah, yeah, yeah
[00:26.50] Goin' on you with the pick and roll
[00:29.80] Young LaFlame, he in sicko mode
[00:33.20] Woo, made this here with all the ice on in the booth
[00:38.10] At the gate outside, when they pull up, give me the loose
[00:43.00] Yeah, Jumpman, Jumpman 23, woo
[00:47.50] She's in love with who I am
[00:51.20] Back in high school, I used to bus it to the dance
[00:55.80] Now I hit the FBO with duffels in my hands
[01:00.40] I did half a Xan, thirteen hours 'til I land
[01:05.10] Had me out like a light, ayy, yeah
[01:09.50] Like a light, ayy, yeah
[01:14.00] Like a light, ayy
[01:18.20] Slept through the flight, ayy
[01:22.50] Knocked for the night, ayy, 767, man
[01:27.50] This shit got double bedroom, man
[01:31.80] I still got scores to settle, man
[01:36.00] Creepin' down the block, made a right
[01:40.50] Cut the lights, paid the price
[01:44.20] Nothin' nice, baguettes in the ice
[01:48.00] Jesus Christ, checks over stripes
[01:52.00] That's what I like, that's what we like`
  },
  "demo-2": {
    synced: true,
    source: "curated",
    lrc: `[00:00.00] (80s Synth Intro)
[00:12.50] Yeah
[00:16.20] I've been tryna call
[00:20.00] I've been on my own for long enough
[00:24.50] Maybe you can show me how to love, maybe
[00:32.00] I'm goin' through withdrawals
[00:36.00] You don't even have to do too much
[00:40.20] You can turn me on with just a touch, baby
[00:48.00] I look around and Sin City's cold and empty
[00:54.00] No one's around to judge me
[00:58.20] I cannot see clearly when you're gone
[01:04.00] I said, ooh, I'm blinded by the lights
[01:12.50] No, I can't sleep until I feel your touch
[01:20.00] I said, ooh, I'm drownin' in the night
[01:28.50] Oh, when I'm like this, you're the one I trust
[01:36.00] Hey, hey, hey
[01:44.00] I'm running out of time
[01:48.00] 'Cause I can see the sun light up the sky
[01:52.00] So I hit the road in overdrive, baby, oh`
  },
  "demo-3": {
    synced: true,
    source: "curated",
    lrc: `[00:00.00] (Ugh, you're a monster)
[00:04.00] I can swallow a bottle of alcohol and I'll feel like Godzilla
[00:08.50] Better hit the deck like the card dealer
[00:12.00] My whole squad's in here, walking around the party
[00:16.00] A cross between a zombie apocalypse and big Bobby The
[00:20.00] Brain Heenan which is probably the
[00:24.00] Same reason I wrestle with mania
[00:28.00] Shady's in this, you're finna witness murder
[00:32.00] Don't wanna hurt nobody, but I did it anyway
[00:36.00] Monster, what have you become?`
  },
  "demo-4": {
    synced: true,
    source: "curated",
    lrc: `[00:00.00] (Baby, back, ayy, couple racks, ayy)
[00:04.00] Couple Gucci bags, yeah, couple snacks, ayy
[00:08.00] You was never on my side, yeah
[00:12.00] Baby back then, didn't want me then, now you want me now
[00:16.00] I told you long ago, on the road
[00:20.00] I got what they waitin' for
[00:24.00] I don't run from nothin', dog
[00:28.00] Get your soldiers, tell 'em that the break is over`
  },
  "demo-5": {
    synced: true,
    source: "curated",
    lrc: `[00:00.00] (Vibez)
[00:03.00] Another banger
[00:06.00] Baby, calm down, calm down
[00:10.00] Girl, this your body e put in my heart down, heart down
[00:15.00] Oh, no, tell me wetin you want, girl
[00:19.00] Lock down, lock down
[00:24.00] Yeah, I want you to be mine`
  },
  "demo-6": {
    synced: true,
    source: "curated",
    lrc: `[00:00.00] (Come on, Harry, we wanna say goodnight to you)
[00:05.00] Holdin' me back
[00:08.00] Gravity's holdin' me back
[00:12.00] I want you to hold out the palm of your hand
[00:16.00] Why don't we leave it at that?
[00:20.00] Nothin' to say
[00:24.00] When everything gets in the way
[00:28.00] Seems you cannot be replaced
[00:32.00] And I'm the one who will stay, oh-oh-oh
[00:36.00] You know it's not the same as it was
[00:40.00] In this world, it's just us
[00:44.00] You know it's not the same as it was`
  }
});

// Sample Demo Songs in case user hasn't imported device files yet
const SAMPLE_TRACKS = [
  {
    id: "demo-1",
    title: "Sicko Mode",
    artist: "Travis Scott",
    album: "Astroworld",
    duration: "5:12",
    format: "MP3 320kbps",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    art: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80",
    isLocal: false
  },
  {
    id: "demo-2",
    title: "Blinding Lights",
    artist: "The Weeknd",
    album: "After Hours",
    duration: "3:20",
    format: "FLAC 24-bit/96kHz",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    art: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80",
    isLocal: false
  },
  {
    id: "demo-3",
    title: "Godzilla (feat. Juice WRLD)",
    artist: "Eminem",
    album: "Music To Be Murdered By",
    duration: "3:30",
    format: "ALAC Lossless",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    art: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80",
    isLocal: false
  },
  {
    id: "demo-4",
    title: "Industry Baby",
    artist: "Lil Nas X",
    album: "Montero",
    duration: "3:32",
    format: "Hi-Res 192kHz",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    art: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=600&q=80",
    isLocal: false
  },
  {
    id: "demo-5",
    title: "Calm Down",
    artist: "Rema",
    album: "Rave & Roses",
    duration: "3:59",
    format: "FLAC Lossless",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
    art: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=600&q=80",
    isLocal: false
  },
  {
    id: "demo-6",
    title: "As It Was",
    artist: "Harry Styles",
    album: "Harry's House",
    duration: "2:47",
    format: "Lossless Audio",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
    art: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
    isLocal: false
  }
];

// ==========================================
// 📁 LOCAL AUDIO SCANNER & ID3 EXTRACTOR
// ==========================================
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.alac', '.wma']);

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Lightweight ID3v2 tag parser to read Artist, Title, Album and APIC artwork
function extractMetadataSync(filePath) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);
  
  let title = baseName;
  let artist = "Local Device File";
  let album = "Phone Storage";
  let hasCover = false;

  try {
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(10);
    fs.readSync(fd, headerBuf, 0, 10, 0);

    if (headerBuf.slice(0, 3).toString('ascii') === 'ID3') {
      const tagSize = ((headerBuf[6] & 0x7f) << 21) |
                      ((headerBuf[7] & 0x7f) << 14) |
                      ((headerBuf[8] & 0x7f) << 7)  |
                      (headerBuf[9] & 0x7f);

      const readSize = Math.min(tagSize, 64 * 1024); // read up to 64KB
      const tagBuf = Buffer.alloc(readSize);
      fs.readSync(fd, tagBuf, 0, readSize, 10);

      // Simple frame finder for TIT2, TPE1, TALB, APIC
      let offset = 0;
      while (offset < readSize - 10) {
        const frameId = tagBuf.slice(offset, offset + 4).toString('latin1');
        if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
        const frameSize = tagBuf.readUInt32BE(offset + 4);
        if (frameSize <= 0 || offset + 10 + frameSize > readSize) break;

        const frameData = tagBuf.slice(offset + 10, offset + 10 + frameSize);
        // String encoding: byte 0 is encoding flag (0 = ISO, 1 = UTF-16)
        if (frameId === 'TIT2') {
          title = frameData.slice(1).toString('utf8').replace(/\0/g, '').trim() || title;
        } else if (frameId === 'TPE1') {
          artist = frameData.slice(1).toString('utf8').replace(/\0/g, '').trim() || artist;
        } else if (frameId === 'TALB') {
          album = frameData.slice(1).toString('utf8').replace(/\0/g, '').trim() || album;
        } else if (frameId === 'APIC') {
          hasCover = true;
        }

        offset += 10 + frameSize;
      }
    }
    fs.closeSync(fd);
  } catch (err) {
    // Fall back to filename parsing
  }

  // Fallback title formatting: "Artist - Title"
  if (title === baseName && baseName.includes(' - ')) {
    const parts = baseName.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  }

  // Estimated duration (approx 128-320 kbps)
  const estSec = Math.max(30, Math.floor(stat.size / (192 * 1024 / 8)));

  const id = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 12);
  return {
    id,
    title,
    artist,
    album,
    duration: formatDuration(estSec),
    format: `${ext.replace('.', '').toUpperCase()} Audio`,
    size: stat.size,
    path: filePath,
    src: `/api/stream/${id}`,
    art: hasCover ? `/api/art/${id}` : "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80",
    isLocal: true
  };
}

// Scan directories for audio files
function scanDirectory(dirPath, maxFiles = 100) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;

  function traverse(currentDir) {
    if (results.length >= maxFiles) return;
    try {
      const items = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const item of items) {
        if (results.length >= maxFiles) break;
        const fullPath = path.join(currentDir, item.name);
        if (item.isDirectory() && !item.name.startsWith('.')) {
          traverse(fullPath);
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (AUDIO_EXTS.has(ext)) {
            try {
              results.push(extractMetadataSync(fullPath));
            } catch (e) {
              console.warn('Error reading file:', fullPath, e.message);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Directory traversal warning:', currentDir, err.message);
    }
  }

  traverse(dirPath);
  return results;
}

// Initial system scan
function performSystemScan() {
  const defaultDirs = [
    path.join(__dirname, 'music'),
    path.join(os.homedir(), 'Music'),
    path.join(os.homedir(), 'Downloads')
  ];

  const scanned = [];
  const seenPaths = new Set();

  for (const d of defaultDirs) {
    if (fs.existsSync(d)) {
      const tracks = scanDirectory(d, 50);
      for (const t of tracks) {
        if (!seenPaths.has(t.path)) {
          seenPaths.add(t.path);
          scanned.push(t);
        }
      }
    }
  }

  const blindingTrack = {
    id: "blinding-lights-weeknd",
    title: "Blinding Lights",
    artist: "The Weeknd",
    album: "After Hours",
    duration: "3:20",
    format: "Lossless FLAC 24-bit/96kHz",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    art: "assets/blinding_lights.jpg",
    isLocal: false
  };

  tracksIndex = [blindingTrack, ...scanned.filter(t => !t.title.includes('studio_test')), ...SAMPLE_TRACKS.filter(t => t.id !== "demo-2")];
  saveJson(TRACKS_INDEX_FILE, tracksIndex);
  console.log(`🎵 Audio scan complete: Indexed ${scanned.length} local device tracks (+ ${SAMPLE_TRACKS.length} demo tracks). Blinding Lights set as Track 0.`);
}

performSystemScan();

// ==========================================
// 🚀 HTTP API & AUDIO STREAMING ROUTER
// ==========================================
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers for local/cross-origin apps
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. Health check & Capabilities
  if (pathname === '/api/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      version: '2.4.0',
      system: os.type(),
      uptimeSec: Math.floor(process.uptime()),
      coreAudioDSP: true,
      features: [
        'Sound Check (ITU-R BS.1770 / EBU R128)',
        'Headphone Accommodations (Balanced, Vocal, Brightness)',
        'CoreAudio 10-Band Pro Parametric EQ with Precision dB Tuning',
        'Spatial Audio & Bauer Stereophonic-to-Binaural Crossfeed (BS2B)',
        'Late Night Dynamic Range Compression (DRC)',
        'Lossless Audio Range Streaming (HTTP 206)'
      ]
    }));
  }

  // 2. Tracks listing
  if (pathname === '/api/tracks' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      tracks: tracksIndex,
      total: tracksIndex.length,
      favorites
    }));
  }

  // 3. Audio Streaming with HTTP 206 Partial Content (Range Requests)
  if (pathname.startsWith('/api/stream/')) {
    const trackId = pathname.replace('/api/stream/', '');
    const track = tracksIndex.find(t => t.id === trackId);

    if (!track) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Track not found');
    }

    // If it's a remote URL, redirect
    if (!track.isLocal && track.src && track.src.startsWith('http')) {
      res.writeHead(302, { 'Location': track.src });
      return res.end();
    }

    const filePath = track.path;
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Local audio file missing from storage');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg'
    };
    const contentType = mimeTypes[ext] || 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        return res.end();
      }

      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      return fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      return fs.createReadStream(filePath).pipe(res);
    }
  }

  // 4. Embedded Cover Art Extractor
  if (pathname.startsWith('/api/art/')) {
    const trackId = pathname.replace('/api/art/', '');
    const track = tracksIndex.find(t => t.id === trackId);
    if (!track || !track.path || !fs.existsSync(track.path)) {
      res.writeHead(302, { 'Location': 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80' });
      return res.end();
    }

    try {
      const fd = fs.openSync(track.path, 'r');
      const headerBuf = Buffer.alloc(10);
      fs.readSync(fd, headerBuf, 0, 10, 0);

      if (headerBuf.slice(0, 3).toString('ascii') === 'ID3') {
        const tagSize = ((headerBuf[6] & 0x7f) << 21) |
                        ((headerBuf[7] & 0x7f) << 14) |
                        ((headerBuf[8] & 0x7f) << 7)  |
                        (headerBuf[9] & 0x7f);

        const readSize = Math.min(tagSize, 2 * 1024 * 1024); // read up to 2MB for artwork
        const tagBuf = Buffer.alloc(readSize);
        fs.readSync(fd, tagBuf, 0, readSize, 10);
        fs.closeSync(fd);

        let offset = 0;
        while (offset < readSize - 10) {
          const frameId = tagBuf.slice(offset, offset + 4).toString('latin1');
          if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
          const frameSize = tagBuf.readUInt32BE(offset + 4);
          if (frameSize <= 0 || offset + 10 + frameSize > readSize) break;

          if (frameId === 'APIC') {
            const picData = tagBuf.slice(offset + 10, offset + 10 + frameSize);
            // APIC structure: Encoding(1) + MIME(null-terminated) + PictureType(1) + Description(null-terminated) + BinaryImage
            let mimeEnd = 1;
            while (mimeEnd < picData.length && picData[mimeEnd] !== 0) mimeEnd++;
            const mime = picData.slice(1, mimeEnd).toString('ascii') || 'image/jpeg';
            
            let descEnd = mimeEnd + 2; // skip mime null and picture type byte
            while (descEnd < picData.length && picData[descEnd] !== 0) descEnd++;
            const imageStart = descEnd + 1;

            const imageBuf = picData.slice(imageStart);
            res.writeHead(200, {
              'Content-Type': mime,
              'Content-Length': imageBuf.length,
              'Cache-Control': 'public, max-age=86400'
            });
            return res.end(imageBuf);
          }
          offset += 10 + frameSize;
        }
      } else {
        fs.closeSync(fd);
      }
    } catch (err) {
      // fallback redirect
    }

    res.writeHead(302, { 'Location': 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80' });
    return res.end();
  }

  // 5. Trigger Folder Scan
  if (pathname === '/api/scan' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const scanPath = payload.directory || path.join(os.homedir(), 'Music');
        const newTracks = scanDirectory(scanPath, 150);

        const seen = new Set(tracksIndex.map(t => t.path));
        for (const t of newTracks) {
          if (!seen.has(t.path)) {
            tracksIndex.unshift(t);
            seen.add(t.path);
          }
        }
        saveJson(TRACKS_INDEX_FILE, tracksIndex);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: newTracks.length, total: tracksIndex.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 6. 🍎 Archangel Deep Tuning Settings API (GET / POST)
  if (pathname === '/api/tuning') {
    if (method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        tuning: tuningConfig,
        presets: ARCHANGEL_EQ_PRESETS,
        frequencies: COREAUDIO_FREQUENCIES
      }));
    } else if (method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const updated = JSON.parse(body);
          tuningConfig = { ...tuningConfig, ...updated };
          saveJson(TUNING_FILE, tuningConfig);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, tuning: tuningConfig }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 7. Archangel Presets
  if (pathname === '/api/presets' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      presets: ARCHANGEL_EQ_PRESETS,
      frequencies: COREAUDIO_FREQUENCIES
    }));
  }

  // 8. Playlists (GET / POST)
  if (pathname === '/api/playlists') {
    if (method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ playlists }));
    } else if (method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload.name) {
            const newPl = {
              id: 'pl-' + Date.now(),
              name: payload.name,
              tracks: payload.tracks || []
            };
            playlists.push(newPl);
            saveJson(PLAYLISTS_FILE, playlists);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, playlists }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 8b. Playlist Actions (DELETE, ADD track)
  if (pathname.startsWith('/api/playlists/')) {
    const parts = pathname.split('/');
    const plId = parts[3];
    const subAction = parts[4]; // 'add', 'remove'

    if (method === 'DELETE' && plId) {
      playlists = playlists.filter(p => p.id !== plId);
      saveJson(PLAYLISTS_FILE, playlists);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, playlists }));
    }

    if (method === 'POST' && subAction === 'add') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const pl = playlists.find(p => p.id === plId);
          if (pl && payload.trackId) {
            if (!pl.tracks.includes(payload.trackId)) {
              pl.tracks.push(payload.trackId);
              saveJson(PLAYLISTS_FILE, playlists);
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, playlist: pl, playlists }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 9. Favorites (POST)
  if (pathname.startsWith('/api/favorites/') && method === 'POST') {
    const trackId = pathname.replace('/api/favorites/', '');
    const idx = favorites.indexOf(trackId);
    let isLiked = false;
    if (idx >= 0) {
      favorites.splice(idx, 1);
    } else {
      favorites.push(trackId);
      isLiked = true;
    }
    saveJson(FAVORITES_FILE, favorites);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, isLiked, favorites }));
  }

  // 10. Folder discovery & browsing
  if (pathname === '/api/folders' && method === 'GET') {
    const foldersList = [
      {
        id: 'music-app',
        name: 'Internal Storage / Music',
        subtext: 'App Audio Storage & Uploads',
        path: MUSIC_DIR,
        icon: 'folder',
        count: tracksIndex.filter(t => t.path && t.path.startsWith(MUSIC_DIR)).length
      },
      {
        id: 'system-music',
        name: 'Phone Music Library',
        subtext: 'OS Media Storage',
        path: path.join(os.homedir(), 'Music'),
        icon: 'music',
        count: tracksIndex.filter(t => t.path && t.path.startsWith(path.join(os.homedir(), 'Music'))).length
      },
      {
        id: 'downloads',
        name: 'Downloads',
        subtext: 'Device Downloads Folder',
        path: path.join(os.homedir(), 'Downloads'),
        icon: 'download',
        count: tracksIndex.filter(t => t.path && t.path.startsWith(path.join(os.homedir(), 'Downloads'))).length
      }
    ];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ folders: foldersList }));
  }

  if (pathname === '/api/browse' && method === 'GET') {
    const folderId = parsedUrl.query.folderId;
    let targetDir = MUSIC_DIR;
    if (folderId === 'system-music') targetDir = path.join(os.homedir(), 'Music');
    else if (folderId === 'downloads') targetDir = path.join(os.homedir(), 'Downloads');

    const folderTracks = tracksIndex.filter(t => t.path && t.path.startsWith(targetDir));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ folderId, targetDir, tracks: folderTracks }));
  }

  // 11. Audio File Upload
  if (pathname === '/api/upload' && method === 'POST') {
    const filenameHeader = req.headers['x-filename'];
    const contentType = req.headers['content-type'] || '';

    // Direct binary upload with X-Filename header
    if (filenameHeader) {
      const safeName = path.basename(decodeURIComponent(filenameHeader));
      const targetPath = path.join(MUSIC_DIR, safeName);
      const writeStream = fs.createWriteStream(targetPath);
      req.pipe(writeStream);
      writeStream.on('finish', () => {
        try {
          const newTrack = extractMetadataSync(targetPath);
          tracksIndex = tracksIndex.filter(t => t.id !== newTrack.id);
          tracksIndex.unshift(newTrack);
          saveJson(TRACKS_INDEX_FILE, tracksIndex);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, track: newTrack, total: tracksIndex.length }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      writeStream.on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    // Multipart form-data handling
    if (contentType.includes('multipart/form-data')) {
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!boundaryMatch) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing boundary in multipart request' }));
      }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          const boundaryBuf = Buffer.from('--' + boundary);
          let startIdx = buffer.indexOf(boundaryBuf);
          if (startIdx === -1) throw new Error('Invalid multipart body');

          const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), startIdx);
          if (headerEnd === -1) throw new Error('Invalid multipart headers');

          const headerStr = buffer.slice(startIdx, headerEnd).toString('latin1');
          const fnMatch = headerStr.match(/filename="([^"]+)"/i);
          const originalName = fnMatch ? fnMatch[1] : `uploaded_track_${Date.now()}.mp3`;
          const safeName = path.basename(originalName);

          const fileStart = headerEnd + 4;
          const nextBoundary = buffer.indexOf(boundaryBuf, fileStart);
          const fileEnd = nextBoundary !== -1 ? nextBoundary - 2 : buffer.length;

          const fileData = buffer.slice(fileStart, fileEnd);
          const targetPath = path.join(MUSIC_DIR, safeName);
          fs.writeFileSync(targetPath, fileData);

          const newTrack = extractMetadataSync(targetPath);
          tracksIndex = tracksIndex.filter(t => t.id !== newTrack.id);
          tracksIndex.unshift(newTrack);
          saveJson(TRACKS_INDEX_FILE, tracksIndex);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, track: newTrack, total: tracksIndex.length }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unsupported upload format' }));
  }

  // 12. Synced Lyrics Engine (Local sidecar .lrc, cached, and live LRCLIB lookup)
  if (pathname === '/api/lyrics' && method === 'GET') {
    const trackId = parsedUrl.query.id;
    const trackTitle = (parsedUrl.query.title || '').trim();
    const trackArtist = (parsedUrl.query.artist || '').trim();

    // 1. Check in-memory / JSON cache
    if (trackId && lyricsCache[trackId]) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...lyricsCache[trackId] }));
    }

    // 2. Check local sidecar .lrc file next to audio file
    const track = tracksIndex.find(t => t.id === trackId);
    if (track && track.path) {
      const ext = path.extname(track.path);
      const lrcPath = track.path.slice(0, -ext.length) + '.lrc';
      if (fs.existsSync(lrcPath)) {
        try {
          const lrcContent = fs.readFileSync(lrcPath, 'utf8');
          const result = { synced: true, source: 'sidecar_lrc', lrc: lrcContent };
          if (trackId) lyricsCache[trackId] = result;
          saveJson(LYRICS_CACHE_FILE, lyricsCache);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, ...result }));
        } catch (e) {}
      }
    }

    // 3. Query online open LRCLIB database (lrclib.net)
    const cleanTitle = (track ? track.title : trackTitle).replace(/\.[^/.]+$/, '').trim();
    const cleanArtist = (track ? track.artist : trackArtist).replace(/Local Device File/i, '').trim();

    if (cleanTitle && cleanArtist) {
      const apiUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;

      const reqLrc = https.get(apiUrl, { headers: { 'User-Agent': 'PulsePlayer/2.4' }, timeout: 3500 }, (apiRes) => {
        let rawData = '';
        apiRes.on('data', chunk => rawData += chunk);
        apiRes.on('end', () => {
          try {
            if (apiRes.statusCode === 200) {
              const parsed = JSON.parse(rawData);
              if (parsed.syncedLyrics || parsed.plainLyrics) {
                const result = {
                  synced: !!parsed.syncedLyrics,
                  source: 'lrclib',
                  lrc: parsed.syncedLyrics || parsed.plainLyrics,
                  plainLyrics: parsed.plainLyrics
                };
                if (trackId) lyricsCache[trackId] = result;
                saveJson(LYRICS_CACHE_FILE, lyricsCache);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, ...result }));
              }
            }
          } catch (e) {}
          returnFallbackLyrics();
        });
      });

      reqLrc.on('error', () => returnFallbackLyrics());
      reqLrc.on('timeout', () => { reqLrc.destroy(); returnFallbackLyrics(); });
      return;
    }

    returnFallbackLyrics();

    function returnFallbackLyrics() {
      const fallback = {
        synced: true,
        source: 'generator',
        lrc: `[00:00.00] 🎵 ${cleanTitle || 'Audio Track'}
[00:04.00] Playing from device file storage
[00:08.50] High-Fidelity Neumorphic Sound Engine
[00:13.00] Archangel CoreAudio 10-Band EQ Active
[00:18.00] Sound Check LUFS Normalization Enabled
[00:23.00] Bauer Binaural Crossfeed (BS2B) Engaged
[00:28.00] Pure Hardware Decibel Precision
[00:34.00] ♫ (Deep Acoustic Resonance) ♫
[00:42.00] Enjoy the pure neumorphic soundscape`
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...fallback }));
    }
    return;
  }

  // 13. Static File Serving (SPA) & Showcase
  if (pathname === '/showcase' || pathname === '/showcase/') {
    const scPath = path.join(__dirname, 'showcase', 'showcase_advert.html');
    if (fs.existsSync(scPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(scPath).pipe(res);
    }
  }

  let staticPath = pathname === '/' ? '/index.html' : pathname;
  let fullStaticPath = path.join(__dirname, staticPath);

  if (fs.existsSync(fullStaticPath) && fs.statSync(fullStaticPath).isFile()) {
    const ext = path.extname(fullStaticPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.webmanifest': 'application/manifest+json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.wav': 'audio/wav',
      '.svg': 'image/svg+xml'
    };
    const cType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': cType, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(fullStaticPath).pipe(res);
  }

  // SPA fallback
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(indexPath).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎵 TIMBRE - PURE NEUMORPHIC HI-FI AUDIO ENGINE`);
  console.log(`======================================================`);
  console.log(`🚀 Server listening on: http://localhost:${PORT}`);
  console.log(`🎛️  Archangel Sound Check, CoreAudio 10-Band EQ & Synced Lyrics.`);
  console.log(`======================================================\n`);
});
