// Clean TV Cast — PC Sender Client
(function () {
  'use strict';

  const tvPill = document.getElementById('tvPill');
  const tvPillText = document.getElementById('tvPillText');
  const receiverPill = document.getElementById('receiverPill');
  const receiverPillText = document.getElementById('receiverPillText');
  const receiverUrlText = document.getElementById('receiverUrlText');
  const qualitySelect = document.getElementById('qualitySelect');
  const modeSelect = document.getElementById('modeSelect');
  const audioCheck = document.getElementById('audioCheck');
  const autoOpenTvCheck = document.getElementById('autoOpenTvCheck');
  const btnStartCast = document.getElementById('btnStartCast');
  const btnStopCast = document.getElementById('btnStopCast');
  const btnOpenTv = document.getElementById('btnOpenTv');
  const btnCopyUrl = document.getElementById('btnCopyUrl');
  const btnMiracast = document.getElementById('btnMiracast');
  const localPreview = document.getElementById('localPreview');
  const previewPlaceholder = document.getElementById('previewPlaceholder');
  const castStatusText = document.getElementById('castStatusText');
  const castModeText = document.getElementById('castModeText');
  const toastEl = document.getElementById('toast');

  let toastTimer = null;
  let lanIp = '127.0.0.1';
  let receiverUrl = '';
  let ws = null;
  let localStream = null;
  let currentEngine = null; // 'webrtc' | 'mse'
  let mediaRecorder = null;
  let activeReceivers = new Set();
  const peers = new Map(); // receiverId -> RTCPeerConnection

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2400);
  }

  function updateReceiverBadge() {
    const count = activeReceivers.size;
    receiverPillText.textContent = `${count} TV${count === 1 ? '' : 's'} connected`;
    receiverPill.className = count > 0 ? 'pill live' : 'pill';
  }

  async function refreshInfo() {
    try {
      const res = await fetch('/api/cast/info');
      const info = await res.json();
      lanIp = info.lanIp || lanIp;
      receiverUrl = info.receiverUrl;
      receiverUrlText.textContent = receiverUrl;
      const subInfo = document.getElementById('subInfo');
      if (subInfo && info.tvName) {
        subInfo.textContent = `Target: ${info.tvName} (${info.brandLabel || info.brand || 'Smart TV'}) · LAN Screen Cast`;
      }
      if (info.tvOnline) {
        tvPill.className = 'pill live';
        tvPillText.textContent = info.wsAuthorized ? 'TV Ready' : 'TV Online';
      } else {
        tvPill.className = 'pill';
        tvPillText.textContent = 'TV Offline / Asleep';
      }
    } catch (e) {
      tvPill.className = 'pill';
      tvPillText.textContent = 'Server Offline';
    }
  }

  function connectSignaling() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(`${proto}${location.host}/ws/cast?role=sender`);

    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      if (msg.type === 'welcome') {
        if (msg.lanIp) lanIp = msg.lanIp;
        activeReceivers = new Set(msg.receivers || []);
        updateReceiverBadge();
        if (localStream && activeReceivers.size > 0) {
          startStreamingToAll();
        }
      } else if (msg.type === 'receiver-joined') {
        activeReceivers.add(msg.id);
        updateReceiverBadge();
        showToast('TV receiver connected');
        if (localStream) {
          if (currentEngine === 'mse') {
            restartMseStream();
          } else {
            createOfferForReceiver(msg.id);
          }
        }
      } else if (msg.type === 'receiver-left') {
        activeReceivers.delete(msg.id);
        updateReceiverBadge();
        closePeer(msg.id);
      } else if (msg.type === 'answer') {
        const pc = peers.get(msg.from);
        if (pc && msg.sdp) {
          try { await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)); } catch (e) {}
        }
      } else if (msg.type === 'ice') {
        const pc = peers.get(msg.from);
        if (pc && msg.candidate) {
          try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (e) {}
        }
      } else if (msg.type === 'fallback-mse') {
        if (localStream && modeSelect.value === 'auto' && currentEngine !== 'mse') {
          showToast('Switching to MSE Compatibility Stream...');
          closeAllPeers();
          startMseStream();
        }
      }
    };

    ws.onclose = () => {
      setTimeout(connectSignaling, 2000);
    };
  }

  function sendSignal(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function closePeer(id) {
    const pc = peers.get(id);
    if (pc) {
      try { pc.close(); } catch (e) {}
      peers.delete(id);
    }
  }

  function closeAllPeers() {
    for (const id of Array.from(peers.keys())) {
      closePeer(id);
    }
  }

  function rewriteMdnsCandidate(candidateObj) {
    if (!candidateObj || !candidateObj.candidate) return null;
    if (/\.local\b/i.test(candidateObj.candidate) && lanIp && lanIp !== '127.0.0.1') {
      return {
        ...candidateObj,
        candidate: candidateObj.candidate.replace(/[a-f0-9-]+\.local\b/gi, lanIp)
      };
    }
    return null;
  }

  async function createOfferForReceiver(receiverId) {
    if (!localStream) return;
    closePeer(receiverId);
    currentEngine = 'webrtc';
    castModeText.textContent = 'WebRTC (Low Latency)';

    const pc = new RTCPeerConnection({ iceServers: [] });
    peers.set(receiverId, pc);

    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const cand = ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate;
      sendSignal({ type: 'ice', to: receiverId, candidate: cand });
      const patched = rewriteMdnsCandidate(cand);
      if (patched) {
        sendSignal({ type: 'ice', to: receiverId, candidate: patched });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        castStatusText.textContent = 'Live on TV (WebRTC)';
      } else if (pc.iceConnectionState === 'failed' && modeSelect.value === 'auto') {
        closeAllPeers();
        startMseStream();
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'offer', to: receiverId, sdp: pc.localDescription });
      castStatusText.textContent = 'Handshaking with TV...';
    } catch (err) {
      if (modeSelect.value === 'auto') {
        closeAllPeers();
        startMseStream();
      }
    }
  }

  function pickMseMimeType() {
    const hasAudio = localStream && localStream.getAudioTracks().length > 0;
    const candidates = hasAudio
      ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8', 'video/webm']
      : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  }

  function stopMseStream() {
    if (mediaRecorder) {
      try {
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      } catch (e) {}
      mediaRecorder = null;
    }
  }

  function startMseStream() {
    if (!localStream) return;
    stopMseStream();
    currentEngine = 'mse';
    const mimeType = pickMseMimeType();
    castModeText.textContent = `MSE (${mimeType.split(';')[1] || 'webm'})`;
    castStatusText.textContent = activeReceivers.size > 0 ? 'Live on TV (MSE Stream)' : 'Waiting for TV browser...';

    sendSignal({ type: 'stream-config', mode: 'mse', mimeType });

    const bitrate = qualitySelect.value === '720p30' ? 2_500_000 : 4_500_000;
    try {
      mediaRecorder = new MediaRecorder(localStream, { mimeType, videoBitsPerSecond: bitrate });
    } catch (e) {
      mediaRecorder = new MediaRecorder(localStream);
    }

    mediaRecorder.ondataavailable = async (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        const buf = await ev.data.arrayBuffer();
        ws.send(buf);
      } catch (e) {}
    };
    mediaRecorder.start(120);
  }

  function restartMseStream() {
    stopMseStream();
    setTimeout(() => {
      if (localStream && currentEngine === 'mse') {
        startMseStream();
      }
    }, 60);
  }

  function startStreamingToAll() {
    if (!localStream) return;
    const selectedMode = modeSelect.value;
    if (selectedMode === 'mse') {
      closeAllPeers();
      startMseStream();
      return;
    }
    if (activeReceivers.size === 0) {
      castStatusText.textContent = 'Capture active · Waiting for TV receiver...';
      castModeText.textContent = selectedMode === 'webrtc' ? 'WebRTC Ready' : 'Auto Ready';
      return;
    }
    for (const id of activeReceivers) {
      createOfferForReceiver(id);
    }
  }

  function getVideoConstraints() {
    const q = qualitySelect.value;
    if (q === '720p60') {
      return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60, max: 60 } };
    }
    if (q === '720p30') {
      return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
    }
    return { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } };
  }

  async function startCast() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showToast('Screen capture requires http://localhost:5050 in Chrome or Edge');
      return;
    }

    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: getVideoConstraints(),
        audio: audioCheck.checked
      });
    } catch (err) {
      showToast('Screen capture cancelled');
      return;
    }

    localPreview.srcObject = localStream;
    localPreview.className = 'active';
    previewPlaceholder.hidden = true;
    btnStartCast.hidden = true;
    btnStopCast.hidden = false;

    const vTrack = localStream.getVideoTracks()[0];
    if (vTrack) {
      vTrack.onended = () => stopCast();
    }

    connectSignaling();
    startStreamingToAll();

    if (autoOpenTvCheck.checked) {
      openOnTv();
    }
  }

  function stopCast() {
    stopMseStream();
    closeAllPeers();
    sendSignal({ type: 'stop' });
    if (localStream) {
      for (const t of localStream.getTracks()) t.stop();
      localStream = null;
    }
    localPreview.srcObject = null;
    localPreview.className = '';
    previewPlaceholder.hidden = false;
    btnStartCast.hidden = false;
    btnStopCast.hidden = true;
    currentEngine = null;
    castStatusText.textContent = 'Idle';
    castModeText.textContent = '—';
  }

  async function openOnTv() {
    showToast('Opening receiver on Samsung TV...');
    try {
      const res = await fetch('/api/cast/open-tv');
      const data = await res.json();
      if (data.error) {
        showToast(data.error);
      } else {
        showToast('TV Browser opening receiver!');
      }
    } catch (e) {
      showToast('Could not reach TV');
    }
  }

  btnStartCast.addEventListener('click', startCast);
  btnStopCast.addEventListener('click', stopCast);
  btnOpenTv.addEventListener('click', openOnTv);

  btnCopyUrl.addEventListener('click', async () => {
    if (!receiverUrl) return;
    try {
      await navigator.clipboard.writeText(receiverUrl);
      showToast(`Copied: ${receiverUrl}`);
    } catch (e) {
      showToast(receiverUrl);
    }
  });

  btnMiracast.addEventListener('click', async () => {
    try {
      await fetch('/api/cast/miracast');
      showToast('Opened Windows Cast flyout (select Samsung BU8100 55 TV)');
    } catch (e) {
      showToast('Press Win + K on your keyboard to open Windows Cast');
    }
  });

  document.querySelectorAll('[data-tv-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-tv-key');
      fetch(`/api/key?key=${encodeURIComponent(key)}`).then(() => showToast(`Sent ${key.replace('KEY_', '')}`));
    });
  });

  document.querySelectorAll('[data-tv-launch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const appId = btn.getAttribute('data-tv-launch');
      fetch(`/api/launch?appId=${encodeURIComponent(appId)}`).then(() => showToast('Exiting to Clean TV Home'));
    });
  });

  connectSignaling();
  refreshInfo();
  setInterval(refreshInfo, 8000);
})();
