// Clean TV Remote Client
(function () {
  'use strict';

  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const tvName = document.getElementById('tvName');
  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1800);
  }

  function triggerHaptic() {
    if (navigator.vibrate) {
      try { navigator.vibrate(15); } catch (e) {}
    }
  }

  async function sendKey(keyName, label) {
    triggerHaptic();
    showToast(label || keyName);
    try {
      const res = await fetch(`/api/key?key=${encodeURIComponent(keyName)}`);
      const data = await res.json();
      if (data.error) {
        showToast(`Error: ${data.error}`);
      }
    } catch (e) {
      showToast(`Network error sending ${keyName}`);
    }
  }

  async function launchApp(appId, label) {
    triggerHaptic();
    showToast(`Launching ${label || appId}...`);
    try {
      const res = await fetch(`/api/launch?appId=${encodeURIComponent(appId)}`);
      const data = await res.json();
      if (data.error) {
        showToast(`Launch failed: ${data.error}`);
      } else {
        showToast(`Opened ${label || appId}`);
      }
    } catch (e) {
      showToast(`Error launching ${label || appId}`);
    }
  }

  // Bind key buttons
  document.querySelectorAll('[data-key]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const key = btn.getAttribute('data-key');
      const label = btn.getAttribute('title') || btn.innerText;
      sendKey(key, label);
    });
  });

  // Bind app buttons
  document.querySelectorAll('[data-launch]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const appId = btn.getAttribute('data-launch');
      const label = btn.getAttribute('title') || btn.querySelector('.app-label')?.innerText || appId;
      launchApp(appId, label);
    });
  });

  // Power Button
  document.getElementById('btnPower').addEventListener('click', () => {
    sendKey('KEY_POWER', 'Power (Toggle)');
  });

  // Numeric Keypad Drawer Toggle
  const toggleBtn = document.getElementById('toggleKeypad');
  const keypadGrid = document.getElementById('keypadGrid');
  toggleBtn.addEventListener('click', () => {
    const isHidden = keypadGrid.hidden;
    keypadGrid.hidden = !isHidden;
    toggleBtn.classList.toggle('open', isHidden);
  });

  // Keyboard Navigation Listener
  const KEY_MAP = {
    'ArrowUp': 'KEY_UP',
    'ArrowDown': 'KEY_DOWN',
    'ArrowLeft': 'KEY_LEFT',
    'ArrowRight': 'KEY_RIGHT',
    'Enter': 'KEY_ENTER',
    'Backspace': 'KEY_RETURN',
    'Escape': 'KEY_RETURN',
    'h': 'KEY_HOME',
    'H': 'KEY_HOME',
    'm': 'KEY_MUTE',
    'M': 'KEY_MUTE',
    '+': 'KEY_VOLUP',
    '=': 'KEY_VOLUP',
    '-': 'KEY_VOLDOWN',
    '_': 'KEY_VOLDOWN',
    ' ': 'KEY_PLAY',
    '0': 'KEY_0',
    '1': 'KEY_1',
    '2': 'KEY_2',
    '3': 'KEY_3',
    '4': 'KEY_4',
    '5': 'KEY_5',
    '6': 'KEY_6',
    '7': 'KEY_7',
    '8': 'KEY_8',
    '9': 'KEY_9'
  };

  const tvBrandBadge = document.getElementById('tvBrandBadge');
  const btnToggleSwitcher = document.getElementById('btnToggleSwitcher');
  const tvSwitcherDrawer = document.getElementById('tvSwitcherDrawer');
  const tvIpInput = document.getElementById('tvIpInput');
  const tvBrandSelect = document.getElementById('tvBrandSelect');
  const btnConnectTv = document.getElementById('btnConnectTv');
  const btnScanTvs = document.getElementById('btnScanTvs');
  const scanList = document.getElementById('scanList');
  const pinDrawer = document.getElementById('pinDrawer');
  const pinInput = document.getElementById('pinInput');
  const btnSubmitPin = document.getElementById('btnSubmitPin');
  const btnShowPin = document.getElementById('btnShowPin');

  window.addEventListener('keydown', (e) => {
    // Ignore input/select tags if typing IP or PIN
    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    const tvKey = KEY_MAP[e.key];
    if (tvKey) {
      e.preventDefault();
      const matchBtn = document.querySelector(`[data-key="${tvKey}"]`);
      if (matchBtn) {
        matchBtn.classList.add('pressed');
        setTimeout(() => matchBtn.classList.remove('pressed'), 120);
      }
      sendKey(tvKey, tvKey.replace('KEY_', ''));
    }
  });

  if (btnToggleSwitcher) {
    btnToggleSwitcher.addEventListener('click', () => {
      tvSwitcherDrawer.hidden = !tvSwitcherDrawer.hidden;
    });
  }

  async function selectTvTarget(ip, brand) {
    showToast(`Switching to ${ip}...`);
    try {
      const res = await fetch('/api/tv/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, brand })
      });
      const data = await res.json();
      if (data.error) {
        showToast(`Error: ${data.error}`);
      } else {
        tvSwitcherDrawer.hidden = true;
        updateStatus();
      }
    } catch (e) {
      showToast('Failed to switch TV');
    }
  }

  if (btnConnectTv) {
    btnConnectTv.addEventListener('click', () => {
      const ip = tvIpInput.value.trim();
      if (!ip) return showToast('Enter a TV IP address');
      selectTvTarget(ip, tvBrandSelect.value);
    });
  }

  if (btnScanTvs) {
    btnScanTvs.addEventListener('click', async () => {
      btnScanTvs.textContent = 'Scanning...';
      btnScanTvs.disabled = true;
      scanList.hidden = false;
      scanList.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:4px;">Scanning Wi-Fi / LAN for Samsung &amp; LG TVs...</div>';
      try {
        const res = await fetch('/api/tv/scan');
        const data = await res.json();
        const tvs = data.tvs || [];
        scanList.innerHTML = '';
        if (!tvs.length) {
          scanList.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:4px;">No TVs responded. Ensure TV is powered on &amp; enter IP above.</div>';
        } else {
          tvs.forEach((tv) => {
            const btn = document.createElement('button');
            btn.className = 'scan-item';
            btn.innerHTML = `<strong>${tv.name}</strong><span>${tv.brand.toUpperCase()} · ${tv.ip}</span>`;
            btn.addEventListener('click', () => selectTvTarget(tv.ip, tv.brand));
            scanList.appendChild(btn);
          });
        }
      } catch (e) {
        scanList.innerHTML = '<div style="font-size:11px;color:var(--red);padding:4px;">Scan failed</div>';
      } finally {
        btnScanTvs.textContent = 'Scan Wi-Fi / LAN';
        btnScanTvs.disabled = false;
      }
    });
  }

  async function pairPin(pin) {
    try {
      const res = await fetch('/api/tv/pair-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (data.error) {
        showToast(data.error);
      } else {
        showToast(pin ? 'LG TV paired!' : 'Check your LG TV screen for the 6-digit PIN');
        pinInput.value = '';
        updateStatus();
      }
    } catch (e) {
      showToast('PIN request failed');
    }
  }

  if (btnSubmitPin) {
    btnSubmitPin.addEventListener('click', () => {
      const pin = pinInput.value.trim();
      if (!pin) return showToast('Enter the 6-digit PIN from your TV');
      pairPin(pin);
    });
  }
  if (btnShowPin) {
    btnShowPin.addEventListener('click', () => pairPin(''));
  }

  // Status Polling
  async function updateStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.ip && tvIpInput && !tvIpInput.value) tvIpInput.value = data.ip;
      if (data.configuredBrand && tvBrandSelect && document.activeElement !== tvBrandSelect) {
        tvBrandSelect.value = data.configuredBrand;
      }
      if (tvBrandBadge) {
        const isLg = String(data.brand || '').startsWith('lg');
        tvBrandBadge.textContent = data.brandLabel || (isLg ? 'LG TV' : 'SAMSUNG');
        tvBrandBadge.className = isLg ? 'brand-badge lg' : 'brand-badge';
      }
      if (data.device) {
        tvName.textContent = data.device.model ? `${data.device.name} (${data.device.model})` : data.device.name;
      } else if (data.ip) {
        tvName.textContent = data.ip;
      }
      if (pinDrawer) {
        pinDrawer.hidden = !(data.requiresPin || data.state === 'pin_required');
      }
      if (data.isConnected) {
        statusPill.className = 'status-pill connected';
        if (data.state === 'pairing_prompt') statusText.textContent = 'Press Allow on TV';
        else if (data.state === 'pin_required') statusText.textContent = 'Enter TV PIN';
        else statusText.textContent = data.token ? 'Connected' : 'Waiting for Auth';
      } else {
        statusPill.className = 'status-pill';
        statusText.textContent = 'Connecting...';
      }
    } catch (e) {
      statusPill.className = 'status-pill error';
      statusText.textContent = 'Offline';
    }
  }

  updateStatus();
  setInterval(updateStatus, 4000);
})();
