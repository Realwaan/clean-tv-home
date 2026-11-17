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

  window.addEventListener('keydown', (e) => {
    // Ignore input tags if any
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
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

  // Status Polling
  async function updateStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.device) {
        tvName.textContent = `${data.device.name} (${data.device.model})`;
      }
      if (data.isConnected) {
        statusPill.className = 'status-pill connected';
        statusText.textContent = data.token ? 'Connected' : 'Waiting for Auth';
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
