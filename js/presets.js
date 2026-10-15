/**
 * TimBre - Archangel DSP Tuning Presets & Acoustic Impulse Data
 */

export const COREAUDIO_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const ARCHANGEL_PRESETS = {
  "Audiophile Pure": [4.5, 3.5, 1.5, 0.0, -0.5, 0.0, 1.0, 2.5, 4.0, 4.5],
  "Acoustic": [4.0, 3.5, 2.5, 1.0, 1.5, 1.5, 2.5, 3.5, 3.0, 2.0],
  "Bass Booster": [6.0, 5.0, 4.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  "Bass Reducer": [-6.0, -5.0, -4.0, -2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  "Classical": [5.0, 4.0, 3.0, 2.0, -2.0, -2.0, 0.0, 2.0, 3.0, 3.0],
  "Electronic": [4.0, 3.0, 0.0, -2.0, -2.0, 2.0, 1.0, 2.0, 4.0, 5.0],
  "Flat": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  "Hip-Hop": [6.0, 5.0, 1.0, 3.0, -2.0, -2.0, 1.0, -1.0, 2.0, 3.0],
  "Jazz": [4.0, 3.0, 1.0, 2.0, -2.0, -2.0, 0.0, 1.0, 3.0, 4.0],
  "Late Night": [3.0, 2.0, 0.0, 0.0, 1.0, 2.0, 1.0, 0.0, -2.0, -4.0],
  "Pop": [-1.0, 1.0, 3.0, 4.0, 4.0, 2.0, -1.0, -1.0, -1.0, -1.0],
  "R&B": [3.0, 7.0, 5.0, 1.0, -2.0, 2.0, 3.0, 3.0, 4.0, 4.0],
  "Rock": [5.0, 4.0, 3.0, 1.0, -1.0, -1.0, 1.0, 3.0, 4.0, 5.0],
  "Spoken Word": [-3.0, 0.0, 1.0, 1.0, 3.0, 5.0, 4.5, 3.0, 1.0, -2.0],
  "Treble Booster": [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 3.0, 5.0, 6.0, 7.0],
  "Vocal Booster": [-2.0, -3.0, -3.0, 1.0, 4.0, 4.0, 3.0, 1.0, 0.0, -2.0]
};

export const REVERB_PRESETS = {
  "Off": { duration: 0.01, decay: 0.01, wet: 0.0 },
  "Acoustic Studio": { duration: 1.2, decay: 2.0, wet: 0.25 },
  "Concert Hall": { duration: 2.5, decay: 2.8, wet: 0.40 },
  "Cathedral 3D": { duration: 4.0, decay: 3.5, wet: 0.55 },
  "Plate Reverb": { duration: 1.8, decay: 1.5, wet: 0.35 }
};

export const SPATIAL_PROFILES = {
  "Subtle": { crossfeedDb: -6.0, separation: 0.8 },
  "Default (Bauer BS2B)": { crossfeedDb: -4.5, separation: 1.0 },
  "Wide Stage (Concert)": { crossfeedDb: -3.0, separation: 1.4 }
};
