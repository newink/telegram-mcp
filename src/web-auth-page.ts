export function getAuthPageHtml(token: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telegram MCP — Connect</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --neon: #00d4ff;
      --neon-mid: #29b6f6;
      --neon-dim: rgba(0, 212, 255, 0.12);
      --neon-glow: rgba(0, 212, 255, 0.35);
      --purple: #7c5bf5;
      --purple-dim: rgba(124, 91, 245, 0.15);
      --bg: #060612;
      --surface: #0c0c1d;
      --card: #0a0a1a;
      --card-border: rgba(0, 212, 255, 0.1);
      --text: #c8d6e5;
      --text-dim: #5a6a7e;
      --text-bright: #e8f0fe;
    }
    html, body { height: 100%; }
    body {
      font-family: 'Chakra Petch', sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }

    /* ---- Circuit board background ---- */
    .circuit-bg {
      position: fixed;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      opacity: 0.25;
    }
    .circuit-bg svg { width: 100%; height: 100%; }

    /* ---- Binary rain columns ---- */
    .binary-rain {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .binary-col {
      position: absolute;
      top: -100%;
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      line-height: 1.6;
      color: var(--neon);
      opacity: 0.06;
      writing-mode: vertical-rl;
      animation: rain-fall linear infinite;
      white-space: nowrap;
    }
    @keyframes rain-fall {
      from { transform: translateY(-10%); }
      to { transform: translateY(110vh); }
    }

    /* ---- Ambient glow orbs ---- */
    .glow-orb {
      position: fixed;
      border-radius: 50%;
      filter: blur(100px);
      pointer-events: none;
      z-index: 0;
    }
    .glow-orb.cyan {
      width: 500px; height: 400px;
      background: radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%);
      top: -120px; left: 50%;
      transform: translateX(-50%);
      animation: orb-pulse 6s ease-in-out infinite;
    }
    .glow-orb.purple {
      width: 350px; height: 350px;
      background: radial-gradient(circle, rgba(124,91,245,0.06) 0%, transparent 70%);
      bottom: -100px; right: -80px;
      animation: orb-pulse 8s ease-in-out 2s infinite;
    }
    @keyframes orb-pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }

    /* ---- Main card ---- */
    .card {
      position: relative;
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 32px;
      box-shadow:
        0 0 60px -15px rgba(0, 212, 255, 0.07),
        0 0 1px 0 rgba(0, 212, 255, 0.2),
        inset 0 1px 0 0 rgba(0, 212, 255, 0.05);
    }
    .card::before {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 17px;
      padding: 1px;
      background: linear-gradient(160deg, rgba(0,212,255,0.2) 0%, transparent 40%, transparent 60%, rgba(124,91,245,0.15) 100%);
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }

    /* ---- Neon paper plane icon ---- */
    .neon-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 72px; height: 72px;
      position: relative;
    }
    .neon-icon svg {
      filter: drop-shadow(0 0 8px rgba(0,212,255,0.6)) drop-shadow(0 0 20px rgba(0,212,255,0.3));
    }
    .neon-icon::after {
      content: '';
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%);
      animation: icon-breathe 3s ease-in-out infinite;
    }
    @keyframes icon-breathe {
      0%, 100% { opacity: 0.5; transform: scale(0.95); }
      50% { opacity: 1; transform: scale(1.05); }
    }

    /* ---- Step system ---- */
    .step { display: none; animation: step-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
    .step.active { display: block; }
    @keyframes step-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ---- Data label (like "MCP PROTOCOL" / "DATA STREAM" in cover) ---- */
    .data-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--neon);
      opacity: 0.5;
    }
    .data-label::before {
      content: '';
      width: 5px; height: 5px;
      border-radius: 50%;
      background: var(--neon);
      box-shadow: 0 0 6px var(--neon-glow);
    }
    .data-label.purple { color: var(--purple); }
    .data-label.purple::before { background: var(--purple); box-shadow: 0 0 6px var(--purple-dim); }

    /* ---- Buttons ---- */
    .btn {
      cursor: pointer;
      border: none;
      font-family: 'Chakra Petch', sans-serif;
      font-weight: 500;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-neon {
      background: linear-gradient(135deg, rgba(0,212,255,0.15) 0%, rgba(0,212,255,0.05) 100%);
      border: 1px solid rgba(0,212,255,0.25);
      color: var(--neon);
      border-radius: 12px;
      padding: 14px 20px;
      font-size: 14px;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .btn-neon:hover:not(:disabled) {
      background: linear-gradient(135deg, rgba(0,212,255,0.22) 0%, rgba(0,212,255,0.08) 100%);
      border-color: rgba(0,212,255,0.45);
      box-shadow: 0 0 25px -5px rgba(0,212,255,0.15), inset 0 0 20px -10px rgba(0,212,255,0.05);
      transform: translateY(-1px);
    }
    .btn-neon:active:not(:disabled) { transform: translateY(0); }
    .btn-neon:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }
    .btn-neon .icon-box {
      width: 36px; height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: rgba(0,212,255,0.08);
      border: 1px solid rgba(0,212,255,0.12);
    }
    .btn-neon.secondary {
      background: rgba(255,255,255,0.02);
      border-color: rgba(255,255,255,0.08);
      color: var(--text);
    }
    .btn-neon.secondary .icon-box {
      background: rgba(255,255,255,0.04);
      border-color: rgba(255,255,255,0.06);
    }
    .btn-neon.secondary:hover:not(:disabled) {
      border-color: rgba(124,91,245,0.3);
      background: rgba(124,91,245,0.04);
      box-shadow: 0 0 20px -5px rgba(124,91,245,0.1);
    }
    .btn-solid {
      background: var(--neon);
      color: #060612;
      border: none;
      border-radius: 12px;
      padding: 13px 20px;
      font-size: 14px;
      font-weight: 600;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      letter-spacing: 0.02em;
    }
    .btn-solid:hover:not(:disabled) {
      background: var(--neon-mid);
      box-shadow: 0 0 30px -5px var(--neon-glow), 0 0 60px -15px rgba(0,212,255,0.2);
      transform: translateY(-1px);
    }
    .btn-solid:active:not(:disabled) { transform: translateY(0); }
    .btn-solid:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    /* ---- Inputs ---- */
    .input-field {
      width: 100%;
      padding: 13px 16px;
      border-radius: 12px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 14px;
      color: var(--text-bright);
      background: var(--surface);
      border: 1px solid rgba(0,212,255,0.08);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-field::placeholder { color: var(--text-dim); }
    .input-field:focus {
      border-color: rgba(0,212,255,0.4);
      box-shadow: 0 0 0 3px var(--neon-dim), 0 0 20px -5px rgba(0,212,255,0.1);
    }

    /* ---- QR frame ---- */
    .qr-frame {
      display: inline-block;
      padding: 12px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(0,212,255,0.04) 0%, rgba(124,91,245,0.03) 100%);
      border: 1px solid rgba(0,212,255,0.12);
      position: relative;
    }
    .qr-frame::before {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 15px;
      padding: 1px;
      background: linear-gradient(135deg, rgba(0,212,255,0.3) 0%, rgba(124,91,245,0.2) 100%);
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }

    /* ---- Pulse dots ---- */
    @keyframes dot-pulse {
      0%, 80%, 100% { transform: scale(0.4); opacity: 0.3; }
      40% { transform: scale(1); opacity: 1; }
    }
    .pulse-dots { display: flex; gap: 5px; align-items: center; }
    .pulse-dots span {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--neon);
      box-shadow: 0 0 6px var(--neon-glow);
    }
    .pulse-dots span:nth-child(1) { animation: dot-pulse 1.4s infinite 0s; }
    .pulse-dots span:nth-child(2) { animation: dot-pulse 1.4s infinite 0.15s; }
    .pulse-dots span:nth-child(3) { animation: dot-pulse 1.4s infinite 0.3s; }

    /* ---- Success check ---- */
    @keyframes draw-circle { to { stroke-dashoffset: 0; } }
    @keyframes draw-check { to { stroke-dashoffset: 0; } }
    .check-circle {
      stroke-dasharray: 176;
      stroke-dashoffset: 176;
      animation: draw-circle 0.7s cubic-bezier(0.65, 0, 0.35, 1) forwards;
    }
    .check-path {
      stroke-dasharray: 50;
      stroke-dashoffset: 50;
      animation: draw-check 0.35s cubic-bezier(0.65, 0, 0.35, 1) 0.5s forwards;
    }

    /* ---- Spinner ---- */
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      width: 20px; height: 20px;
      border: 2px solid rgba(0,212,255,0.15);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      display: inline-block;
    }
    .spinner-lg { width: 32px; height: 32px; border-width: 2.5px; }

    /* ---- Toast ---- */
    @keyframes toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes toast-out { to { opacity: 0; transform: translateX(20px); } }
    .toast {
      animation: toast-in 0.3s ease-out, toast-out 0.3s ease-in 4.7s forwards;
      background: rgba(30, 10, 10, 0.9);
      border: 1px solid rgba(255, 60, 60, 0.2);
      color: #ff8a8a;
      padding: 10px 16px;
      border-radius: 10px;
      font-size: 13px;
      max-width: 320px;
      backdrop-filter: blur(12px);
      font-family: 'Share Tech Mono', monospace;
    }

    /* ---- Link ---- */
    .link-back {
      font-family: 'Share Tech Mono', monospace;
      font-size: 12px;
      color: var(--text-dim);
      background: none;
      border: none;
      cursor: pointer;
      transition: color 0.15s;
      display: block;
      margin: 20px auto 0;
    }
    .link-back:hover { color: var(--neon); }

    /* ---- Page load stagger ---- */
    .load-1 { animation: step-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both; }
    .load-2 { animation: step-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both; }
    .load-3 { animation: step-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.35s both; }
  </style>
</head>
<body>
  <!-- Ambient glow -->
  <div class="glow-orb cyan"></div>
  <div class="glow-orb purple"></div>

  <!-- Circuit board background -->
  <div class="circuit-bg">
    <svg viewBox="0 0 800 600" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="800" y2="600" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#00d4ff" stop-opacity="0.3"/>
          <stop offset="50%" stop-color="#00d4ff" stop-opacity="0.05"/>
          <stop offset="100%" stop-color="#7c5bf5" stop-opacity="0.2"/>
        </linearGradient>
      </defs>
      <!-- Horizontal traces -->
      <path d="M0 150 H200 L220 170 H380 L400 150 H600" stroke="url(#cg)" stroke-width="0.5"/>
      <path d="M0 300 H150 L170 280 H350" stroke="url(#cg)" stroke-width="0.5"/>
      <path d="M450 300 H650 L670 320 H800" stroke="url(#cg)" stroke-width="0.5"/>
      <path d="M0 450 H250 L270 430 H500 L520 450 H800" stroke="url(#cg)" stroke-width="0.5"/>
      <!-- Vertical traces -->
      <path d="M200 0 V150" stroke="url(#cg)" stroke-width="0.5"/>
      <path d="M400 150 V300" stroke="url(#cg)" stroke-width="0.5"/>
      <path d="M600 0 V150" stroke="url(#cg)" stroke-width="0.5"/>
      <path d="M150 300 V450" stroke="url(#cg)" stroke-width="0.5"/>
      <path d="M650 300 V600" stroke="url(#cg)" stroke-width="0.5"/>
      <!-- Nodes -->
      <circle cx="200" cy="150" r="3" fill="#00d4ff" opacity="0.4"/>
      <circle cx="400" cy="150" r="3" fill="#00d4ff" opacity="0.3"/>
      <circle cx="600" cy="150" r="2.5" fill="#00d4ff" opacity="0.35"/>
      <circle cx="150" cy="300" r="2.5" fill="#7c5bf5" opacity="0.4"/>
      <circle cx="650" cy="300" r="3" fill="#7c5bf5" opacity="0.35"/>
      <circle cx="250" cy="450" r="2.5" fill="#00d4ff" opacity="0.3"/>
      <circle cx="520" cy="450" r="3" fill="#00d4ff" opacity="0.25"/>
      <!-- Diagonal traces -->
      <path d="M350 280 L380 250 V180" stroke="url(#cg)" stroke-width="0.5"/>
      <path d="M500 430 L530 400 H620" stroke="url(#cg)" stroke-width="0.5"/>
    </svg>
  </div>

  <!-- Binary rain -->
  <div class="binary-rain" id="binary-rain"></div>

  <!-- Toasts -->
  <div id="toasts" style="position:fixed;top:20px;right:20px;z-index:50;display:flex;flex-direction:column;gap:8px;pointer-events:none;"></div>

  <!-- Main content -->
  <div style="position:relative;z-index:10;width:100%;max-width:440px;padding:0 20px;">

    <!-- Header -->
    <header class="load-1" style="text-align:center;margin-bottom:28px;">
      <div class="neon-icon" style="margin:0 auto 16px;">
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 2 11 13"/>
          <path d="M22 2 15 22 11 13 2 9z"/>
        </svg>
      </div>
      <h1 style="font-size:1.5rem;font-weight:600;color:#e8f0fe;letter-spacing:-0.01em;">Connect Telegram</h1>
    </header>

    <!-- Card -->
    <div class="card load-2">

      <!-- Step: Choose Method -->
      <div id="step-choose" class="step active">
        <p style="font-size:13px;color:var(--text-dim);text-align:center;margin-bottom:20px;font-weight:300;">Choose authentication method</p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button onclick="startQr()" class="btn btn-neon">
            <span class="icon-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 14h3v3h-3zM14 18h3v3h-3zM18 18h3v3h-3z"/></svg>
            </span>
            <span style="text-align:left;">
              <span style="display:block;font-size:14px;font-weight:500;color:var(--text-bright);">QR Code</span>
              <span style="display:block;font-size:11px;color:var(--text-dim);margin-top:2px;font-family:'Share Tech Mono',monospace;">RECOMMENDED &middot; SCAN WITH PHONE</span>
            </span>
          </button>
          <button onclick="showStep('phone')" class="btn btn-neon secondary">
            <span class="icon-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c5bf5" stroke-width="2" stroke-linecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="18" r="0.5" fill="#7c5bf5"/></svg>
            </span>
            <span style="text-align:left;">
              <span style="display:block;font-size:14px;font-weight:500;color:var(--text-bright);">Phone Number</span>
              <span style="display:block;font-size:11px;color:var(--text-dim);margin-top:2px;font-family:'Share Tech Mono',monospace;">RECEIVE CODE VIA SMS OR APP</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Step: QR Code -->
      <div id="step-qr" class="step">
        <div style="text-align:center;">
          <div class="qr-frame" style="margin-bottom:20px;">
            <div id="qr-placeholder" style="width:232px;height:232px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(0,212,255,0.02);">
              <span class="spinner spinner-lg" style="color:var(--neon);"></span>
            </div>
            <img id="qr-img" style="display:none;border-radius:8px;" width="232" height="232" alt="QR Code"/>
          </div>
          <p style="font-size:14px;font-weight:500;color:var(--text-bright);margin-bottom:4px;">Scan with Telegram</p>
          <p style="font-size:11px;font-family:'Share Tech Mono',monospace;color:var(--text-dim);line-height:1.6;">SETTINGS &rarr; DEVICES &rarr; LINK DESKTOP DEVICE</p>
          <div id="qr-status" style="margin-top:16px;display:flex;align-items:center;justify-content:center;gap:8px;">
            <span class="pulse-dots"><span></span><span></span><span></span></span>
            <span style="font-size:11px;font-family:'Share Tech Mono',monospace;color:var(--text-dim);">WAITING FOR SCAN</span>
          </div>
        </div>
        <button onclick="resetFlow()" class="link-back">&larr; BACK</button>
      </div>

      <!-- Step: Phone Input -->
      <div id="step-phone" class="step">
        <div class="data-label" style="margin-bottom:12px;">Phone Authentication</div>
        <p style="font-size:13px;color:var(--text-dim);margin-bottom:16px;font-weight:300;">Enter your number in international format</p>
        <form id="form-phone">
          <input id="inp-phone" type="tel" placeholder="+1 234 567 8900" class="input-field"/>
          <button type="submit" id="btn-phone" class="btn btn-solid" style="margin-top:12px;">Send Code</button>
        </form>
        <button onclick="resetFlow()" class="link-back">&larr; BACK</button>
      </div>

      <!-- Step: Code Input -->
      <div id="step-code" class="step">
        <div class="data-label" style="margin-bottom:12px;">Verification</div>
        <p style="font-size:13px;color:var(--text-dim);margin-bottom:2px;font-weight:300;">Enter the verification code</p>
        <p id="code-hint" style="font-size:11px;font-family:'Share Tech Mono',monospace;color:var(--text-dim);margin-bottom:16px;"></p>
        <form id="form-code">
          <input id="inp-code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;" class="input-field" style="text-align:center;letter-spacing:0.3em;"/>
          <button type="submit" id="btn-code" class="btn btn-solid" style="margin-top:12px;">Verify</button>
        </form>
      </div>

      <!-- Step: 2FA Password -->
      <div id="step-password" class="step">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c5bf5" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span style="font-size:14px;font-weight:500;color:var(--text-bright);">Two-Factor Auth</span>
        </div>
        <p style="font-size:11px;font-family:'Share Tech Mono',monospace;color:var(--text-dim);margin-bottom:16px;">2FA ENABLED &middot; ENTER CLOUD PASSWORD</p>
        <form id="form-password">
          <input id="inp-password" type="password" placeholder="Password" class="input-field" style="font-family:'Chakra Petch',sans-serif;"/>
          <button type="submit" id="btn-password" class="btn btn-solid" style="margin-top:12px;">Continue</button>
        </form>
      </div>

      <!-- Step: Success -->
      <div id="step-success" class="step">
        <div style="text-align:center;padding:12px 0;">
          <svg style="margin:0 auto 16px;filter:drop-shadow(0 0 12px rgba(0,212,255,0.4));" width="60" height="60" viewBox="0 0 60 60" fill="none">
            <circle class="check-circle" cx="30" cy="30" r="27" stroke="#00d4ff" stroke-width="2"/>
            <path class="check-path" d="M18 31l8 8 16-17" stroke="#00d4ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h2 style="font-size:16px;font-weight:600;color:var(--text-bright);margin-bottom:6px;">Connected</h2>
          <p id="success-user" style="font-size:14px;color:var(--text);"></p>
          <p style="font-size:11px;font-family:'Share Tech Mono',monospace;color:var(--text-dim);margin-top:16px;">SESSION SAVED &middot; CLOSE THIS TAB</p>
        </div>
      </div>
    </div>

  </div>

  <script>
    // Binary rain generator
    (function() {
      var container = document.getElementById('binary-rain');
      var cols = 12;
      for (var i = 0; i < cols; i++) {
        var col = document.createElement('div');
        col.className = 'binary-col';
        var chars = '';
        for (var j = 0; j < 60; j++) chars += Math.random() > 0.5 ? '1' : '0';
        col.textContent = chars;
        col.style.left = (Math.random() * 100) + '%';
        col.style.animationDuration = (15 + Math.random() * 25) + 's';
        col.style.animationDelay = (-Math.random() * 30) + 's';
        col.style.opacity = (0.03 + Math.random() * 0.04).toString();
        container.appendChild(col);
      }
    })();

    var TOKEN = '${token}';
    var sse = null;
    var currentStep = 'choose';

    function showStep(id) {
      document.querySelectorAll('.step').forEach(function(s) { s.classList.remove('active'); });
      var el = document.getElementById('step-' + id);
      if (el) { el.classList.add('active'); currentStep = id; }
      var focusable = el && el.querySelector('input');
      if (focusable) setTimeout(function() { focusable.focus(); }, 50);
    }

    function resetFlow() {
      if (sse) { sse.close(); sse = null; }
      document.getElementById('qr-placeholder').style.display = 'flex';
      document.getElementById('qr-img').style.display = 'none';
      document.getElementById('qr-status').innerHTML =
        '<span class="pulse-dots"><span></span><span></span><span></span></span>' +
        '<span style="font-size:11px;font-family:Share Tech Mono,monospace;color:var(--text-dim)">WAITING FOR SCAN</span>';
      resetBtn('btn-phone', 'Send Code');
      resetBtn('btn-code', 'Verify');
      resetBtn('btn-password', 'Continue');
      showStep('choose');
    }

    function resetBtn(id, label) {
      var b = document.getElementById(id);
      if (b) { b.disabled = false; b.innerHTML = label; }
    }

    function setLoading(id) {
      var b = document.getElementById(id);
      if (b) { b.disabled = true; b.innerHTML = '<span class="spinner" style="color:#060612"></span>'; }
    }

    function connectSSE() {
      if (sse) sse.close();
      sse = new EventSource('/auth/status?token=' + TOKEN);
      sse.onmessage = function(e) {
        try { handleEvent(JSON.parse(e.data)); } catch(err) { console.error('SSE parse error', err); }
      };
    }

    function handleEvent(ev) {
      switch (ev.type) {
        case 'waiting':
          if (currentStep === 'qr') {
            document.getElementById('qr-status').innerHTML =
              '<span class="spinner" style="color:var(--neon);width:14px;height:14px;border-width:1.5px"></span>' +
              '<span style="font-size:11px;font-family:Share Tech Mono,monospace;color:var(--text)">SCANNED \\u2014 CONNECTING\\u2026</span>';
          }
          break;
        case 'qr':
          showStep('qr');
          var img = document.getElementById('qr-img');
          var ph = document.getElementById('qr-placeholder');
          var url = 'https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(ev.url) + '&size=256x256&bgcolor=0a0a1a&color=00d4ff&format=png';
          img.onload = function() { ph.style.display = 'none'; img.style.display = 'block'; };
          img.src = url;
          document.getElementById('qr-status').innerHTML =
            '<span class="pulse-dots"><span></span><span></span><span></span></span>' +
            '<span style="font-size:11px;font-family:Share Tech Mono,monospace;color:var(--text-dim)">WAITING FOR SCAN</span>';
          break;
        case 'code_sent':
          showStep('code');
          var hints = { app: 'CHECK TELEGRAM APP', sms: 'SENT VIA SMS', call: 'INCOMING CALL', missed_call: 'CHECK MISSED CALL', flash_call: 'CHECK INCOMING CALL' };
          document.getElementById('code-hint').textContent = (hints[ev.delivery] || 'CODE SENT VIA ' + ev.delivery.toUpperCase()) + ' \\u00b7 ' + ev.length + ' DIGITS';
          resetBtn('btn-phone', 'Send Code');
          break;
        case 'password_required':
          showStep('password');
          resetBtn('btn-code', 'Verify');
          break;
        case 'success':
          showStep('success');
          document.getElementById('success-user').textContent = 'Authenticated as ' + ev.user;
          if (sse) { sse.close(); sse = null; }
          break;
        case 'error':
          showToast(ev.message);
          break;
      }
    }

    function post(path, body) {
      return fetch(path + '?token=' + TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function(res) {
        return res.json().then(function(data) {
          if (!res.ok) throw new Error(data.error || 'Request failed');
          return data;
        });
      });
    }

    function startQr() {
      connectSSE();
      post('/auth/start', { method: 'qr' }).then(function() {
        showStep('qr');
      }).catch(function(err) {
        showToast(err.message);
        resetFlow();
      });
    }

    document.getElementById('form-phone').onsubmit = function(e) {
      e.preventDefault();
      var phone = document.getElementById('inp-phone').value.trim();
      if (!phone) return;
      setLoading('btn-phone');
      connectSSE();
      post('/auth/start', { method: 'phone', phone: phone }).catch(function(err) {
        showToast(err.message);
        resetBtn('btn-phone', 'Send Code');
      });
    };

    document.getElementById('form-code').onsubmit = function(e) {
      e.preventDefault();
      var code = document.getElementById('inp-code').value.trim();
      if (!code) return;
      setLoading('btn-code');
      post('/auth/code', { code: code }).catch(function(err) {
        showToast(err.message);
        resetBtn('btn-code', 'Verify');
      });
    };

    document.getElementById('form-password').onsubmit = function(e) {
      e.preventDefault();
      var pw = document.getElementById('inp-password').value;
      if (!pw) return;
      setLoading('btn-password');
      post('/auth/password', { password: pw }).catch(function(err) {
        showToast(err.message);
        resetBtn('btn-password', 'Continue');
      });
    };

    function showToast(msg) {
      var c = document.getElementById('toasts');
      var d = document.createElement('div');
      d.className = 'toast';
      d.style.pointerEvents = 'auto';
      d.textContent = msg;
      c.appendChild(d);
      setTimeout(function() { if (d.parentNode) d.remove(); }, 5200);
    }
  </script>
</body>
</html>`;
}
