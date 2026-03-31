/**
 * Scout 游戏音效系统 - 使用 Web Audio API 程序化合成
 * 无需外部音频文件，完全通过 AudioContext 生成音效
 */

const SoundFX = (() => {
  let ctx = null;
  let masterGain = null;
  let bgmGain = null;
  let sfxGain = null;
  let bgmNodes = [];
  let bgmPlaying = false;
  let _muted = false;
  let _volume = 0.7;
  let _bgmVolume = 0.3;

  // 尝试恢复被浏览器暂停的 AudioContext
  function ensureCtx() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = ctx.createGain();
        masterGain.gain.value = _muted ? 0 : _volume;
        masterGain.connect(ctx.destination);

        sfxGain = ctx.createGain();
        sfxGain.gain.value = 1.0;
        sfxGain.connect(masterGain);

        bgmGain = ctx.createGain();
        bgmGain.gain.value = _bgmVolume;
        bgmGain.connect(masterGain);
      } catch (e) {
        console.warn('[SoundFX] AudioContext 不可用', e);
      }
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  // ── 基础振荡器包装 ─────────────────────────────────────────────
  function playTone(freq, type, startTime, duration, gainVal, targetGain, destination) {
    if (!ctx) return null;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(Math.max(targetGain, 0.0001), startTime + duration);
    osc.connect(g);
    g.connect(destination || sfxGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
    return { osc, gain: g };
  }

  function playNoise(startTime, duration, gainVal, filter = null, destination = null) {
    if (!ctx) return;
    const bufSize = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'bandpass';
      f.frequency.value = filter.freq || 1000;
      f.Q.value = filter.Q || 1;
      src.connect(f);
      f.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(destination || sfxGain);
    src.start(startTime);
  }

  // ══════════════════════════════════════════════════════════════
  //   音效库
  // ══════════════════════════════════════════════════════════════

  /**
   * 选牌音效：轻快的"嗒"声
   */
  function playCardSelect() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    playTone(900, 'sine', t, 0.08, 0.25, 0.01);
    playTone(1200, 'sine', t + 0.02, 0.06, 0.15, 0.01);
  }

  /**
   * 取消选牌：较低的"嗒"声
   */
  function playCardDeselect() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    playTone(600, 'sine', t, 0.07, 0.18, 0.01);
  }

  /**
   * 出牌音效：干脆的投牌声 + 小音效
   */
  function playCardPlay() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    // 低沉投牌声
    playTone(180, 'triangle', t, 0.12, 0.4, 0.01);
    // 亮音点缀
    playTone(660, 'sine', t, 0.10, 0.2, 0.01);
    playTone(880, 'sine', t + 0.04, 0.08, 0.15, 0.01);
    // 轻微噪声（纸牌翻飞感）
    playNoise(t, 0.08, 0.15, { type: 'highpass', freq: 4000, Q: 0.5 });
  }

  /**
   * 挖角音效：神秘的上升音
   */
  function playScout() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.35);
    // 额外点缀
    playTone(1000, 'sine', t + 0.2, 0.1, 0.15, 0.01);
  }

  /**
   * 挖角并演出：更激烈的音效
   */
  function playScoutAndShow() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    // 上升扫频
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(1000, t + 0.3);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.4);
    // 出牌音效叠加
    setTimeout(() => playCardPlay(), 200);
  }

  /**
   * 轮到自己行动：提示铃声（悦耳清脆）
   */
  function playYourTurn() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    const notes = [523, 659, 784]; // C5 E5 G5
    notes.forEach((freq, i) => {
      playTone(freq, 'sine', t + i * 0.1, 0.18, 0.25, 0.01);
    });
  }

  /**
   * 发消息：轻柔的"叮"
   */
  function playChatSend() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    playTone(880, 'sine', t, 0.12, 0.18, 0.01);
    playTone(1100, 'sine', t + 0.05, 0.09, 0.12, 0.01);
  }

  /**
   * 收到消息：略有区别的双音
   */
  function playChatReceive() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    playTone(660, 'sine', t, 0.1, 0.15, 0.01);
    playTone(880, 'sine', t + 0.07, 0.09, 0.1, 0.01);
  }

  /**
   * 胜利音效：欢快的上升旋律 + 华彩
   */
  function playVictory() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    // 主旋律
    const melody = [
      [523, 0,    0.15],
      [659, 0.15, 0.15],
      [784, 0.30, 0.18],
      [1047,0.48, 0.3 ],
      [784, 0.65, 0.12],
      [1047,0.75, 0.5 ],
    ];
    melody.forEach(([freq, delay, dur]) => {
      playTone(freq, 'sine', t + delay, dur, 0.3, 0.01);
    });
    // 和弦底音
    [262, 330, 392].forEach(freq => {
      playTone(freq, 'triangle', t, 0.8, 0.15, 0.01);
    });
    // 打击音（鼓点感）
    playNoise(t, 0.06, 0.3, { type: 'lowpass', freq: 200, Q: 1 });
    playNoise(t + 0.3, 0.05, 0.25, { type: 'lowpass', freq: 200, Q: 1 });
    playNoise(t + 0.65, 0.06, 0.3, { type: 'lowpass', freq: 200, Q: 1 });
  }

  /**
   * 失败/落败音效：下沉音调
   */
  function playDefeat() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    const notes = [
      [440, 0,    0.2],
      [392, 0.22, 0.2],
      [330, 0.44, 0.3],
      [262, 0.7,  0.5],
    ];
    notes.forEach(([freq, delay, dur]) => {
      playTone(freq, 'sine', t + delay, dur, 0.25, 0.01);
    });
  }

  /**
   * 回合结束：短促的结束提示音
   */
  function playRoundEnd() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    playTone(660,  'sine', t,    0.15, 0.25, 0.01);
    playTone(523,  'sine', t + 0.18, 0.2, 0.2, 0.01);
    playTone(392,  'sine', t + 0.38, 0.3, 0.18, 0.01);
  }

  /**
   * 超时警告：急促的警报
   */
  function playTimeWarning() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      playTone(880, 'square', t + i * 0.18, 0.1, 0.2, 0.01);
    }
  }

  /**
   * 翻牌确认
   */
  function playFlip() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    playTone(440, 'triangle', t, 0.08, 0.2, 0.01);
    playTone(880, 'sine', t + 0.06, 0.12, 0.18, 0.01);
    playNoise(t, 0.06, 0.12, { type: 'highpass', freq: 3000, Q: 0.5 });
  }

  /**
   * 错误/非法操作
   */
  function playError() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    playTone(220, 'square', t,    0.08, 0.25, 0.01);
    playTone(180, 'square', t + 0.1, 0.1, 0.2, 0.01);
  }

  /**
   * 游戏开始
   */
  function playGameStart() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    const notes = [
      [330, 0,    0.1],
      [392, 0.1,  0.1],
      [494, 0.2,  0.1],
      [659, 0.3,  0.25],
    ];
    notes.forEach(([freq, delay, dur]) => {
      playTone(freq, 'sine', t + delay, dur, 0.28, 0.01);
    });
  }

  // ══════════════════════════════════════════════════════════════
  //   背景音乐（简约循环节奏 + 和弦）
  // ══════════════════════════════════════════════════════════════

  let bgmScheduled = false;
  let bgmStopFlag = false;
  let bgmLoopTimeout = null;

  /**
   * 背景音乐：轻松的卡牌游戏风格小循环
   * 使用定时排程方式循环播放
   */
  function scheduleBgmLoop() {
    if (bgmStopFlag || !ctx || !bgmGain) return;

    const t = ctx.currentTime;
    const tempo = 0.4; // 每拍时长（秒）
    const bars = 8;    // 循环小节数
    const totalDur = tempo * bars * 4;

    // ── 低音线 ──────────────────────────────────────────────────
    const bassNotes = [
      [98,  0],  [98,  1],  [110, 2],  [110, 3],
      [87,  4],  [87,  5],  [98,  6],  [98,  7],
      [110, 8],  [110, 9],  [123, 10], [123, 11],
      [98,  12], [98,  13], [87,  14], [87,  15],
      [98,  16], [98,  17], [110, 18], [110, 19],
      [87,  20], [87,  21], [98,  22], [98,  23],
      [110, 24], [110, 25], [98,  26], [98,  27],
      [87,  28], [98,  29], [110, 30], [87,  31],
    ];
    bassNotes.forEach(([freq, beat]) => {
      const st = t + beat * tempo;
      playTone(freq, 'triangle', st, tempo * 0.85, 0.18, 0.02, bgmGain);
    });

    // ── 和弦层（柔和衬底）──────────────────────────────────────
    const chords = [
      [[196, 247, 294], 0],
      [[196, 247, 294], 8],
      [[175, 220, 262], 16],
      [[196, 247, 294], 24],
    ];
    chords.forEach(([freqs, beat]) => {
      freqs.forEach(freq => {
        const st = t + beat * tempo;
        playTone(freq, 'sine', st, tempo * 4 * 0.9, 0.05, 0.005, bgmGain);
      });
    });

    // ── 打击乐（鼓感）──────────────────────────────────────────
    const kickBeats = [0, 4, 8, 12, 16, 20, 24, 28];
    kickBeats.forEach(beat => {
      playNoise(t + beat * tempo, tempo * 0.3, 0.12, { type: 'lowpass', freq: 120, Q: 2 }, bgmGain);
    });
    const snareBeats = [2, 6, 10, 14, 18, 22, 26, 30];
    snareBeats.forEach(beat => {
      playNoise(t + beat * tempo, tempo * 0.15, 0.06, { type: 'bandpass', freq: 800, Q: 0.5 }, bgmGain);
    });
    // 踩镲
    for (let i = 0; i < 32; i++) {
      playNoise(t + i * tempo, tempo * 0.1, 0.025, { type: 'highpass', freq: 6000, Q: 1 }, bgmGain);
    }

    // ── 旋律层（轻柔）──────────────────────────────────────────
    const melodyNotes = [
      [659, 0],  [784, 2],  [880, 4],  [784, 6],
      [659, 8],  [587, 10], [659, 12], [784, 14],
      [880, 16], [784, 18], [659, 20], [587, 22],
      [523, 24], [587, 26], [659, 28], [523, 30],
    ];
    melodyNotes.forEach(([freq, beat]) => {
      const st = t + beat * tempo;
      playTone(freq, 'sine', st, tempo * 1.8, 0.04, 0.001, bgmGain);
    });

    // 提前 0.2s 排程下一轮
    bgmLoopTimeout = setTimeout(() => {
      if (!bgmStopFlag) scheduleBgmLoop();
    }, (totalDur - 0.2) * 1000);
  }

  function startBgm() {
    if (bgmPlaying) return;
    if (!ensureCtx()) return;
    bgmStopFlag = false;
    bgmPlaying = true;
    scheduleBgmLoop();
  }

  function stopBgm() {
    bgmStopFlag = true;
    bgmPlaying = false;
    if (bgmLoopTimeout) {
      clearTimeout(bgmLoopTimeout);
      bgmLoopTimeout = null;
    }
    // 淡出
    if (bgmGain && ctx) {
      bgmGain.gain.setValueAtTime(bgmGain.gain.value, ctx.currentTime);
      bgmGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      setTimeout(() => {
        if (!bgmPlaying && bgmGain) bgmGain.gain.value = _bgmVolume;
      }, 600);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //   音量控制
  // ══════════════════════════════════════════════════════════════

  function setMuted(muted) {
    _muted = muted;
    if (masterGain && ctx) {
      masterGain.gain.setValueAtTime(muted ? 0 : _volume, ctx.currentTime);
    }
    // 存储偏好
    try { localStorage.setItem('scout_sfx_muted', muted ? '1' : '0'); } catch (e) {}
  }

  function setVolume(vol) {
    _volume = Math.max(0, Math.min(1, vol));
    if (masterGain && ctx && !_muted) {
      masterGain.gain.setValueAtTime(_volume, ctx.currentTime);
    }
    try { localStorage.setItem('scout_sfx_volume', String(_volume)); } catch (e) {}
  }

  function setBgmVolume(vol) {
    _bgmVolume = Math.max(0, Math.min(1, vol));
    if (bgmGain && ctx) {
      bgmGain.gain.setValueAtTime(_bgmVolume, ctx.currentTime);
    }
    try { localStorage.setItem('scout_bgm_volume', String(_bgmVolume)); } catch (e) {}
  }

  function isMuted() { return _muted; }
  function getVolume() { return _volume; }
  function isBgmPlaying() { return bgmPlaying; }

  // ══════════════════════════════════════════════════════════════
  //   初始化（读取偏好设置）
  // ══════════════════════════════════════════════════════════════

  function init() {
    try {
      const storedMuted = localStorage.getItem('scout_sfx_muted');
      if (storedMuted !== null) _muted = storedMuted === '1';
      const storedVol = localStorage.getItem('scout_sfx_volume');
      if (storedVol !== null) _volume = parseFloat(storedVol);
      const storedBgm = localStorage.getItem('scout_bgm_volume');
      if (storedBgm !== null) _bgmVolume = parseFloat(storedBgm);
    } catch (e) {}
  }

  init();

  // ══════════════════════════════════════════════════════════════
  //   公共 API
  // ══════════════════════════════════════════════════════════════
  return {
    // 音效
    cardSelect:    playCardSelect,
    cardDeselect:  playCardDeselect,
    cardPlay:      playCardPlay,
    scout:         playScout,
    scoutAndShow:  playScoutAndShow,
    yourTurn:      playYourTurn,
    chatSend:      playChatSend,
    chatReceive:   playChatReceive,
    victory:       playVictory,
    defeat:        playDefeat,
    roundEnd:      playRoundEnd,
    timeWarning:   playTimeWarning,
    flip:          playFlip,
    error:         playError,
    gameStart:     playGameStart,
    // 背景音乐
    startBgm,
    stopBgm,
    // 音量控制
    setMuted,
    setVolume,
    setBgmVolume,
    isMuted,
    getVolume,
    isBgmPlaying,
    // 初始化 AudioContext（需在用户交互时调用）
    unlock: ensureCtx,
  };
})();
