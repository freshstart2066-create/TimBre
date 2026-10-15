/**
 * TimBre - Real-Time Synced Lyrics Engine (LRC Parser & Auto-Scroll)
 */

export class LyricsEngine {
  constructor() {
    this.lyricsData = [];
    this.currentLineIdx = -1;
    this.autoScrollEnabled = true;
    this.containerEl = null;
  }

  init(containerId) {
    this.containerEl = document.getElementById(containerId);
  }

  parseLRC(lrcText) {
    this.lyricsData = [];
    if (!lrcText || typeof lrcText !== 'string') return;

    const lines = lrcText.split('\n');
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

    for (let line of lines) {
      const match = line.match(timeRegex);
      if (match) {
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        const msStr = match[3].padEnd(3, '0').slice(0, 3);
        const ms = parseInt(msStr, 10);
        const timeSec = mins * 60 + secs + ms / 1000;
        const text = match[4].trim();

        if (text) {
          this.lyricsData.push({ time: timeSec, text });
        }
      }
    }

    this.lyricsData.sort((a, b) => a.time - b.time);
  }

  render(onLineClick) {
    if (!this.containerEl) return;
    this.containerEl.innerHTML = '';

    if (!this.lyricsData.length) {
      this.containerEl.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 13px; margin-top: 40px; font-weight: 600;">
          No synced lyrics available for this track
        </div>
      `;
      return;
    }

    this.lyricsData.forEach((line, idx) => {
      const div = document.createElement('div');
      div.className = 'live-lyric-line';
      div.id = `lyricLine_${idx}`;
      div.textContent = line.text;
      div.addEventListener('click', () => {
        if (typeof onLineClick === 'function') onLineClick(line.time);
      });
      this.containerEl.appendChild(div);
    });
  }

  update(currentTimeSec) {
    if (!this.lyricsData.length || !this.containerEl) return;

    let activeIdx = -1;
    for (let i = 0; i < this.lyricsData.length; i++) {
      if (currentTimeSec >= this.lyricsData[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx !== this.currentLineIdx) {
      this.currentLineIdx = activeIdx;

      // Update classes
      const allLines = this.containerEl.querySelectorAll('.live-lyric-line');
      allLines.forEach((el, idx) => {
        el.classList.toggle('active', idx === activeIdx);
        el.classList.toggle('passed', idx < activeIdx);
      });

      // Smooth auto-scroll
      if (this.autoScrollEnabled && activeIdx >= 0) {
        const activeEl = document.getElementById(`lyricLine_${activeIdx}`);
        if (activeEl) {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }

  toggleAutoScroll() {
    this.autoScrollEnabled = !this.autoScrollEnabled;
    return this.autoScrollEnabled;
  }
}

export const lyricsEngine = new LyricsEngine();
