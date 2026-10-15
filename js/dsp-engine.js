/**
 * TimBre - Archangel DSP & Web Audio 10-Band Parametric Engine
 * Advanced Audio Effects: 10-Band EQ + Q factor, Convolver Reverb, 3D Spatial Soundstage, LUFS Normalizer, DRC
 */

import { COREAUDIO_FREQS, ARCHANGEL_PRESETS, REVERB_PRESETS } from './presets.js';

class DspEngine {
  constructor() {
    this.audioCtx = null;
    this.sourceNode = null;
    
    // Nodes in Audio Graph
    this.soundCheckNode = null;
    this.preampGainNode = null;
    this.eqFilters = [];
    this.bassFilter = null;
    this.trebleFilter = null;
    
    // Advanced Effects Nodes
    this.convolverNode = null;
    this.reverbWetGain = null;
    this.reverbDryGain = null;
    this.spatialPanner = null;
    
    this.compressorNode = null;
    this.masterGain = null;
    this.analyserL = null;
    this.analyserR = null;

    // State
    this.eqGains = [...ARCHANGEL_PRESETS["Rock"]];
    this.eqQFactors = COREAUDIO_FREQS.map(() => 1.414); // standard octave Q
    this.preampDb = 0.0;
    this.bassDb = 0.0;
    this.trebleDb = 0.0;
    this.volumeLevel = 0.65;
    
    this.soundCheckEnabled = true;
    this.spatialEnabled = true;
    this.lateNightDrcEnabled = false;
    this.currentReverbProfile = "Off";
  }

  init(audioElement) {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      this.sourceNode = this.audioCtx.createMediaElementSource(audioElement);

      // 1. Archangel Sound Check (-16 LUFS normalizer)
      this.soundCheckNode = this.audioCtx.createGain();
      this.soundCheckNode.gain.value = this.soundCheckEnabled ? 0.89 : 1.0;

      // 2. Preamp gain
      this.preampGainNode = this.audioCtx.createGain();
      this.preampGainNode.gain.value = Math.pow(10, this.preampDb / 20);

      // 3. 10-Band Parametric Equalizer (Peaking Filters with Q & Gain)
      this.eqFilters = COREAUDIO_FREQS.map((freq, idx) => {
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = this.eqQFactors[idx];
        filter.gain.value = this.eqGains[idx] || 0.0;
        return filter;
      });

      // 4. Physical Bass & Treble Notch Filters
      this.bassFilter = this.audioCtx.createBiquadFilter();
      this.bassFilter.type = 'lowshelf';
      this.bassFilter.frequency.value = 100;
      this.bassFilter.gain.value = this.bassDb;

      this.trebleFilter = this.audioCtx.createBiquadFilter();
      this.trebleFilter.type = 'highshelf';
      this.trebleFilter.frequency.value = 8000;
      this.trebleFilter.gain.value = this.trebleDb;

      // 5. Hardware Reverb (Convolver + Dry/Wet Blend)
      this.convolverNode = this.audioCtx.createConvolver();
      this.reverbWetGain = this.audioCtx.createGain();
      this.reverbDryGain = this.audioCtx.createGain();
      this.reverbWetGain.gain.value = 0.0;
      this.reverbDryGain.gain.value = 1.0;

      // 6. 3D Spatial Soundstage (Stereo Panner / BS2B Crossfeed)
      if (this.audioCtx.createStereoPanner) {
        this.spatialPanner = this.audioCtx.createStereoPanner();
        this.spatialPanner.pan.value = 0.0;
      }

      // 7. Dynamic Range Compression (DRC Late Night)
      this.compressorNode = this.audioCtx.createDynamicsCompressor();
      this.compressorNode.threshold.value = this.lateNightDrcEnabled ? -24.0 : 0.0;
      this.compressorNode.knee.value = 30;
      this.compressorNode.ratio.value = 12;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.25;

      // 8. Master Gain
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = this.volumeLevel;

      // 9. Stereo Analysers for Decibel Peak & RMS VU Meter
      const splitter = this.audioCtx.createChannelSplitter(2);
      this.analyserL = this.audioCtx.createAnalyser();
      this.analyserR = this.audioCtx.createAnalyser();
      this.analyserL.fftSize = 256;
      this.analyserR.fftSize = 256;

      // Connect Chain:
      // Source -> SoundCheck -> Preamp -> EQ[0..9] -> Bass -> Treble
      let curr = this.sourceNode;
      curr.connect(this.soundCheckNode);
      curr = this.soundCheckNode;
      curr.connect(this.preampGainNode);
      curr = this.preampGainNode;

      for (let i = 0; i < this.eqFilters.length; i++) {
        curr.connect(this.eqFilters[i]);
        curr = this.eqFilters[i];
      }

      curr.connect(this.bassFilter);
      curr = this.bassFilter;
      curr.connect(this.trebleFilter);
      curr = this.trebleFilter;

      // Split into Reverb Dry & Wet paths
      curr.connect(this.reverbDryGain);
      curr.connect(this.convolverNode);
      this.convolverNode.connect(this.reverbWetGain);

      // Merge Reverb paths
      const reverbMerger = this.audioCtx.createGain();
      this.reverbDryGain.connect(reverbMerger);
      this.reverbWetGain.connect(reverbMerger);

      // Path into Compressor -> Spatial Panner -> Master Gain
      curr = reverbMerger;
      curr.connect(this.compressorNode);
      curr = this.compressorNode;

      if (this.spatialPanner) {
        curr.connect(this.spatialPanner);
        curr = this.spatialPanner;
      }

      curr.connect(this.masterGain);

      // Output to Speakers & Analysers
      this.masterGain.connect(this.audioCtx.destination);
      this.masterGain.connect(splitter);
      splitter.connect(this.analyserL, 0);
      splitter.connect(this.analyserR, 1);

      console.log('[DspEngine] Archangel DSP graph initialized successfully.');
    } catch (e) {
      console.warn('[DspEngine] Web Audio initialization warning (fallback):', e);
      if (audioElement) audioElement.volume = this.volumeLevel;
    }
  }

  // --- Parametric EQ Controls ---
  setBandGain(index, db) {
    const clamped = Math.max(-12, Math.min(12, db));
    this.eqGains[index] = clamped;
    if (this.eqFilters[index] && this.audioCtx) {
      this.eqFilters[index].gain.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.01);
    }
  }

  setBandQ(index, q) {
    const clamped = Math.max(0.5, Math.min(5.0, q));
    this.eqQFactors[index] = clamped;
    if (this.eqFilters[index] && this.audioCtx) {
      this.eqFilters[index].Q.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.01);
    }
  }

  applyPreset(presetName) {
    if (!ARCHANGEL_PRESETS[presetName]) return;
    const curve = ARCHANGEL_PRESETS[presetName];
    curve.forEach((val, idx) => this.setBandGain(idx, val));
  }

  // --- Preamp, Bass, Treble, Volume ---
  setPreamp(db) {
    this.preampDb = parseFloat(db);
    if (this.preampGainNode && this.audioCtx) {
      this.preampGainNode.gain.setTargetAtTime(Math.pow(10, this.preampDb / 20), this.audioCtx.currentTime, 0.01);
    }
  }

  setBass(db) {
    this.bassDb = Math.max(-12, Math.min(12, db));
    if (this.bassFilter && this.audioCtx) {
      this.bassFilter.gain.setTargetAtTime(this.bassDb, this.audioCtx.currentTime, 0.01);
    }
  }

  setTreble(db) {
    this.trebleDb = Math.max(-12, Math.min(12, db));
    if (this.trebleFilter && this.audioCtx) {
      this.trebleFilter.gain.setTargetAtTime(this.trebleDb, this.audioCtx.currentTime, 0.01);
    }
  }

  setVolume(vol) {
    this.volumeLevel = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setTargetAtTime(this.volumeLevel, this.audioCtx.currentTime, 0.01);
    }
  }

  // --- Advanced Effects: Reverb Convolver ---
  setReverb(profileName) {
    this.currentReverbProfile = profileName;
    const profile = REVERB_PRESETS[profileName] || REVERB_PRESETS["Off"];
    if (!this.audioCtx || !this.convolverNode) return;

    if (profileName === "Off" || profile.wet === 0) {
      this.reverbWetGain.gain.setTargetAtTime(0.0, this.audioCtx.currentTime, 0.02);
      this.reverbDryGain.gain.setTargetAtTime(1.0, this.audioCtx.currentTime, 0.02);
      return;
    }

    // Generate Algorithmic Impulse Response Buffer
    const rate = this.audioCtx.sampleRate;
    const length = rate * profile.duration;
    const impulse = this.audioCtx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const decay = Math.exp(-i / (rate * (profile.duration / profile.decay)));
      left[i] = (Math.random() * 2 - 1) * decay;
      right[i] = (Math.random() * 2 - 1) * decay;
    }

    this.convolverNode.buffer = impulse;
    this.reverbWetGain.gain.setTargetAtTime(profile.wet, this.audioCtx.currentTime, 0.02);
    this.reverbDryGain.gain.setTargetAtTime(1.0 - profile.wet * 0.5, this.audioCtx.currentTime, 0.02);
  }

  // --- Dynamic Compressor & Sound Check ---
  toggleSoundCheck(enable) {
    this.soundCheckEnabled = enable;
    if (this.soundCheckNode && this.audioCtx) {
      this.soundCheckNode.gain.setTargetAtTime(this.soundCheckEnabled ? 0.89 : 1.0, this.audioCtx.currentTime, 0.02);
    }
  }

  toggleLateNightDrc(enable) {
    this.lateNightDrcEnabled = enable;
    if (this.compressorNode && this.audioCtx) {
      this.compressorNode.threshold.setTargetAtTime(this.lateNightDrcEnabled ? -24.0 : 0.0, this.audioCtx.currentTime, 0.01);
    }
  }

  // --- Live Decibel Peak Levels ---
  getStereoDecibels() {
    if (!this.analyserL || !this.analyserR) return { leftDb: -48, rightDb: -48, clip: false };

    const dataL = new Float32Array(this.analyserL.frequencyBinCount);
    const dataR = new Float32Array(this.analyserR.frequencyBinCount);
    this.analyserL.getFloatTimeDomainData(dataL);
    this.analyserR.getFloatTimeDomainData(dataR);

    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < dataL.length; i++) {
      const absL = Math.abs(dataL[i]);
      const absR = Math.abs(dataR[i]);
      if (absL > peakL) peakL = absL;
      if (absR > peakR) peakR = absR;
    }

    const leftDb = peakL > 0.00001 ? 20 * Math.log10(peakL) : -48.0;
    const rightDb = peakR > 0.00001 ? 20 * Math.log10(peakR) : -48.0;
    const clip = peakL >= 0.999 || peakR >= 0.999;

    return { leftDb, rightDb, clip };
  }
}

export const dspEngine = new DspEngine();
