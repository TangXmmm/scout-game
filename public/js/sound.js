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
   * 翻牌确认（游戏开始时所有人确认手牌后触发，由 phase_changed 调用）
   */
  function playFlip() {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    playTone(440, 'triangle', t, 0.08, 0.2, 0.01);
    playTone(880, 'sine', t + 0.06, 0.12, 0.18, 0.01);
    playNoise(t, 0.06, 0.12, { type: 'highpass', freq: 3000, Q: 0.5 });
  }

  /**
   * 翻转手牌音效：模拟翻书/洗牌声
   * 由 doFlip()（翻转 / 撤销翻转）调用
   */
  function playPageFlip(isFlipping = true) {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    // 快速白噪声扫过（纸张摩擦感）
    const bufSize = Math.floor(ctx.sampleRate * 0.18);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      // 用 shaped 噪声：振幅先升后降，模拟翻页弧度
      const env = Math.sin(Math.PI * i / bufSize);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // 带通滤波：突出纸张频段
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = isFlipping ? 2800 : 2000;
    bpf.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bpf); bpf.connect(g); g.connect(sfxGain);
    src.start(t);
    // 轻微的低频撞击感（模拟牌落桌）
    playNoise(t + 0.05, 0.06, 0.08, { type: 'lowpass', freq: 300, Q: 1.5 });
    // 翻转：加一个上扬确认音；撤销：加一个下降音
    if (isFlipping) {
      playTone(660, 'sine', t + 0.10, 0.09, 0.12, 0.001);
      playTone(880, 'sine', t + 0.16, 0.08, 0.1,  0.001);
    } else {
      playTone(440, 'sine', t + 0.10, 0.09, 0.1, 0.001);
      playTone(330, 'sine', t + 0.16, 0.08, 0.08, 0.001);
    }
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
  //   背景音乐 v2 — 多段变奏 + 精确排程（无卡顿）
  //
  //   解决原版两个问题：
  //   1. 卡顿：原版用 setTimeout 触发下一轮，JS 线程抖动导致衔接有缝隙。
  //      新版：用 Web Audio 时间轴锚点（nextSectionStart）精确预排，
  //            每段结束前 LOOKAHEAD 秒就已完成下一段的全部排程，零缝隙。
  //   2. 单调：设计 A/B/C/D 四段变奏轮换（主题/副歌/钢琴段/转调段），
  //            加入装饰音、铃音层、动态速度微变，听感丰富。
  // ══════════════════════════════════════════════════════════════

  const BGM_TEMPO   = 0.375;  // 每拍时长(s)，约 160bpm
  const BGM_BEATS   = 32;     // 每段小节数（8小节×4拍）
  const LOOKAHEAD   = 1.0;    // 提前多少秒排程下一段

  let bgmStopFlag      = false;
  // bgmPlaying 已在顶部声明，此处不重复声明
  let bgmScheduleTimer = null;
  let bgmSectionIdx    = 0;   // 当前段落索引（决定变奏）
  let bgmNextStart     = 0;   // 下一段的 AudioContext 绝对起点

  // ── 辅助：用振荡器模拟钟琴/马林巴音色（快速衰减）──────────
  function playBell(freq, startTime, dur, gainVal, destination) {
    if (!ctx) return;
    const osc  = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g    = ctx.createGain();
    osc.type  = 'sine';
    osc2.type = 'sine';
    osc.frequency.value  = freq;
    osc2.frequency.value = freq * 2.756; // 非谐波泛音，让音色更像敲击乐
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
    osc.connect(g);  osc2.connect(g);
    g.connect(destination || bgmGain);
    osc.start(startTime);  osc2.start(startTime);
    osc.stop(startTime + dur + 0.01);
    osc2.stop(startTime + dur + 0.01);
  }

  // ── 打击乐模板（共用）──────────────────────────────────────
  function scheduleDrums(t, beats, tempo) {
    // kick
    [0, 4, 8, 12, 16, 20, 24, 28].forEach(b => {
      if (b >= beats) return;
      playNoise(t + b * tempo, tempo * 0.28, 0.11,
        { type: 'lowpass', freq: 110, Q: 2.5 }, bgmGain);
      // kick 音调
      playTone(80, 'sine', t + b * tempo, tempo * 0.18, 0.12, 0.001, bgmGain);
    });
    // snare
    [2, 6, 10, 14, 18, 22, 26, 30].forEach(b => {
      if (b >= beats) return;
      playNoise(t + b * tempo, tempo * 0.14, 0.055,
        { type: 'bandpass', freq: 900, Q: 0.6 }, bgmGain);
    });
    // hihat（每半拍一次）
    for (let i = 0; i < beats; i++) {
      playNoise(t + i * tempo, tempo * 0.08, 0.018,
        { type: 'highpass', freq: 7000, Q: 1 }, bgmGain);
    }
    // open hihat（每4拍）
    [3, 7, 11, 15, 19, 23, 27, 31].forEach(b => {
      if (b >= beats) return;
      playNoise(t + b * tempo, tempo * 0.35, 0.03,
        { type: 'highpass', freq: 5000, Q: 0.8 }, bgmGain);
    });
  }

  // ── A段：主题段（D小调，轻快）────────────────────────────────
  // 调性：D minor  根音 D=147Hz, A=220, C=131, F=175, Bb=117
  function scheduleSectionA(t, tempo) {
    // 低音线 Dm–Dm–C–Dm
    const bass = [
      [147,0],[147,1],[147,2],[165,3],   // Dm
      [147,4],[147,5],[131,6],[147,7],   // Dm→C
      [131,8],[131,9],[131,10],[147,11], // C
      [147,12],[165,13],[147,14],[131,15],
      [117,16],[117,17],[131,18],[117,19],// Bb
      [131,20],[131,21],[147,22],[131,23],// C
      [147,24],[147,25],[165,26],[147,27],// Dm
      [131,28],[147,29],[131,30],[110,31],
    ];
    bass.forEach(([f, b]) => {
      playTone(f, 'triangle', t + b * tempo, tempo * 0.88, 0.14, 0.01, bgmGain);
    });

    // 和弦衬底（每4拍换一次）
    [[147,175,220], [147,175,220], [131,165,196], [117,147,175]].forEach(([f1,f2,f3], i) => {
      const st = t + i * 8 * tempo;
      [f1, f2, f3].forEach(f => {
        playTone(f, 'sine', st, 8 * tempo * 0.92, 0.04, 0.003, bgmGain);
      });
    });

    // 旋律（D minor pentatonic）
    const mel = [
      [294,0],[330,2],[392,4],[440,6],
      [392,8],[349,10],[330,12],[294,14],
      [262,16],[294,18],[330,20],[392,22],
      [440,24],[392,26],[349,28],[294,30],
    ];
    mel.forEach(([f, b]) => {
      playTone(f, 'sine', t + b * tempo, tempo * 1.7, 0.038, 0.001, bgmGain);
    });

    // 钟琴装饰
    [[880,1],[1047,5],[880,9],[784,13],[880,17],[1047,21],[784,25],[880,29]].forEach(([f,b]) => {
      playBell(f, t + b * tempo, tempo * 2.5, 0.022, bgmGain);
    });

    scheduleDrums(t, 32, tempo);
  }

  // ── B段：副歌（同调升八度，密集节奏，活泼）──────────────────
  function scheduleSectionB(t, tempo) {
    // 低音线加密（每半拍）
    const bassB = [
      147,165,175,165, 147,131,147,131,
      131,147,131,117, 131,147,165,147,
      117,131,117,110, 131,117,131,147,
      147,165,196,165, 147,131,147,131,
    ];
    bassB.forEach((f, b) => {
      playTone(f, 'triangle', t + b * tempo, tempo * 0.75, 0.12, 0.01, bgmGain);
    });

    // 旋律（高八度，跳跃感）
    const melB = [
      [587,0],[659,1],[784,2],[880,3],
      [784,4],[698,5],[659,6],[587,7],
      [523,8],[587,9],[659,10],[784,11],
      [880,12],[784,13],[698,14],[659,15],
      [523,16],[587,17],[659,18],[523,19],
      [494,20],[523,21],[587,22],[659,23],
      [784,24],[880,25],[784,26],[698,27],
      [659,28],[587,29],[523,30],[587,31],
    ];
    melB.forEach(([f, b]) => {
      playTone(f, 'sine', t + b * tempo, tempo * 0.9, 0.042, 0.001, bgmGain);
    });

    // 和弦（更密，每2拍换）
    [[294,349,440],[262,330,392],[233,294,349],[262,330,392],
     [294,349,440],[262,330,392],[247,311,370],[262,330,392]].forEach(([f1,f2,f3], i) => {
      const st = t + i * 4 * tempo;
      [f1,f2,f3].forEach(f =>
        playTone(f, 'sine', st, 4 * tempo * 0.88, 0.035, 0.002, bgmGain));
    });

    // 钟琴密集装饰
    [0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30].forEach((b, i) => {
      const bells = [1047, 880, 988, 1047, 880, 784, 880, 988,
                     1047, 988, 880, 784, 880, 988, 1047, 880];
      playBell(bells[i], t + b * tempo, tempo * 1.8, 0.018, bgmGain);
    });

    scheduleDrums(t, 32, tempo);
  }

  // ── C段：间奏（安静，只有钢琴+打击乐，减半密度）────────────
  function scheduleSectionC(t, tempo) {
    // 低音（稀疏）
    [[147,0],[131,4],[117,8],[131,12],[147,16],[165,20],[147,24],[131,28]].forEach(([f,b]) => {
      playTone(f, 'triangle', t + b * tempo, tempo * 1.8, 0.1, 0.005, bgmGain);
    });

    // 钟琴主旋律（担纲，当"钢琴"用）
    const melC = [
      [392,0],[440,4],[494,8],[523,12],
      [494,16],[440,20],[392,24],[349,28],
    ];
    melC.forEach(([f, b]) => {
      playBell(f, t + b * tempo, tempo * 3.8, 0.055, bgmGain);
      // 加低一个八度的共鸣
      playBell(f / 2, t + b * tempo, tempo * 2.5, 0.025, bgmGain);
    });

    // 和弦（非常轻柔）
    [[147,175,220]].forEach(([f1,f2,f3]) => {
      playTone(f1, 'sine', t, 32 * tempo * 0.95, 0.025, 0.001, bgmGain);
      playTone(f2, 'sine', t, 32 * tempo * 0.95, 0.018, 0.001, bgmGain);
    });

    // 极轻的踩镲
    for (let i = 0; i < 32; i++) {
      playNoise(t + i * tempo, tempo * 0.06, 0.01,
        { type: 'highpass', freq: 8000, Q: 1 }, bgmGain);
    }
    // 轻kick
    [0, 8, 16, 24].forEach(b => {
      playNoise(t + b * tempo, tempo * 0.2, 0.07,
        { type: 'lowpass', freq: 100, Q: 2 }, bgmGain);
    });
  }

  // ── D段：转调段（上移小三度到 F minor，情绪起伏）────────────
  // F minor: F=175, C=262, Db=139, Ab=208, Eb=156
  function scheduleSectionD(t, tempo) {
    const bass = [
      [175,0],[175,1],[196,2],[175,3],
      [175,4],[156,5],[175,6],[156,7],
      [139,8],[139,9],[156,10],[139,11],
      [156,12],[175,13],[156,14],[139,15],
      [117,16],[131,17],[117,18],[110,19],
      [131,20],[131,21],[139,22],[131,23],
      [175,24],[175,25],[196,26],[175,27],
      [156,28],[175,29],[156,30],[131,31],
    ];
    bass.forEach(([f, b]) => {
      playTone(f, 'triangle', t + b * tempo, tempo * 0.85, 0.15, 0.01, bgmGain);
    });

    // 和弦
    [[175,208,262],[139,175,208],[117,156,196],[131,175,208]].forEach(([f1,f2,f3], i) => {
      const st = t + i * 8 * tempo;
      [f1,f2,f3].forEach(f =>
        playTone(f, 'sine', st, 8 * tempo * 0.9, 0.045, 0.003, bgmGain));
    });

    // 旋律（F minor pentatonic，忧郁感）
    const melD = [
      [349,0],[392,2],[440,4],[523,6],
      [494,8],[440,10],[392,12],[349,14],
      [311,16],[349,18],[392,20],[440,22],
      [523,24],[494,26],[440,28],[392,30],
    ];
    melD.forEach(([f, b]) => {
      playTone(f, 'sine', t + b * tempo, tempo * 1.9, 0.04, 0.001, bgmGain);
    });

    // 钟琴（高音装饰，稀疏）
    [[880,3],[784,7],[698,11],[784,15],[880,19],[988,23],[880,27],[784,31]].forEach(([f,b]) => {
      playBell(f, t + b * tempo, tempo * 2.2, 0.02, bgmGain);
    });

    scheduleDrums(t, 32, tempo);
  }

  // ── 段落表：A-A-B-C-A-D-A-B 循环，8段一大循环 ──────────────
  const BGM_SECTIONS = [
    scheduleSectionA,
    scheduleSectionA,
    scheduleSectionB,
    scheduleSectionC,
    scheduleSectionA,
    scheduleSectionD,
    scheduleSectionA,
    scheduleSectionB,
  ];

  // ── 核心排程器：精确锚点，提前 LOOKAHEAD 秒排程下一段 ────────
  function bgmScheduleTick() {
    if (bgmStopFlag || !ctx || !bgmGain) return;

    const now = ctx.currentTime;
    const sectionDur = BGM_BEATS * BGM_TEMPO;

    // 只要距下一段开始不足 LOOKAHEAD 秒，就立即排程
    if (bgmNextStart - now < LOOKAHEAD) {
      const tempo  = BGM_TEMPO * (1 + (Math.random() * 0.012 - 0.006)); // ±0.6% 微小速度抖动，增加人味
      const secFn  = BGM_SECTIONS[bgmSectionIdx % BGM_SECTIONS.length];
      const startAt = Math.max(bgmNextStart, now + 0.02); // 保证不在过去

      secFn(startAt, tempo);

      bgmNextStart = startAt + BGM_BEATS * tempo;
      bgmSectionIdx++;
    }

    // 用 setTimeout 轮询（间隔远小于 LOOKAHEAD，保证不遗漏）
    bgmScheduleTimer = setTimeout(bgmScheduleTick, 200);
  }

  function startBgm() {
    if (bgmPlaying) return;
    if (!ensureCtx()) return;
    bgmStopFlag  = false;
    bgmPlaying   = true;
    bgmNextStart = ctx.currentTime + 0.1; // 稍作延迟后启动第一段
    bgmScheduleTick();
  }

  function stopBgm() {
    bgmStopFlag = true;
    bgmPlaying  = false;
    if (bgmScheduleTimer) {
      clearTimeout(bgmScheduleTimer);
      bgmScheduleTimer = null;
    }
    // 淡出 0.6s
    if (bgmGain && ctx) {
      bgmGain.gain.setValueAtTime(bgmGain.gain.value, ctx.currentTime);
      bgmGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      setTimeout(() => {
        if (!bgmPlaying && bgmGain) bgmGain.gain.value = _bgmVolume;
      }, 700);
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
    pageFlip:      playPageFlip,
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
