/* =========================================================
   Sanctuaire Ankaa - Front Web / PWA
   Respecte V1/V2 : souffle, double canal écrit+voix, papyrus, œil, aura, Invoquer
   Ajouts : Overlay mode, garde-fou, ESC, ducking audio, PWA-safe
   ========================================================= */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const btnSanctuaire = $('#btn-sanctuaire');
  const btnModeMini   = $('#btn-mode-mini');   // ☥
  const overlay       = $('#mode-overlay');
  const modeOptions   = Array.from(document.querySelectorAll('.mode-option'));
  const input         = $('#user-input');
  const btnInvoke     = $('#btn-invoquer');
  const zone          = $('#papyrus-content');
  const music         = $('#musique-sacree');
  const voice         = $('#voix-ankaa');

  // Purge du mode à chaque rechargement
  try { localStorage.removeItem('mode'); } catch(e) {}

  // Overlay hidden par défaut
  const hideOverlay = () => overlay?.classList.add('overlay-hidden');
  const showOverlay = () => overlay?.classList.remove('overlay-hidden');
  hideOverlay();

  // Verrou tant qu’aucun mode n’est choisi
  const lockIO = (lock) => {
    if (!input || !btnInvoke) return;
    input.disabled = !!lock;
    btnInvoke.disabled = !!lock;
    btnInvoke.classList.toggle('disabled', !!lock);
  };
  lockIO(true);

  // Ouvrir overlay
  btnSanctuaire?.addEventListener('click', (e) => {
    e.preventDefault();
    showOverlay();
  });

  // Ré-ouvrir overlay via ☥ (sans tout re-bloquer)
  btnModeMini?.addEventListener('click', (e) => {
    e.preventDefault();
    showOverlay();
  });

  // ESC pour fermer
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      if(overlay && !overlay.classList.contains('overlay-hidden')){
        hideOverlay();
      }
    }
  });

  // Choix d’un mode
  modeOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const chosen = opt.getAttribute('data-mode');
      if (!chosen) return;
      try { localStorage.setItem('mode', chosen); } catch(e) {}
      lockIO(false);
      hideOverlay();
      modeOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      setTimeout(() => input?.focus(), 120);
    });
  });

  // Garde-fou
  const ensureModeOrOpen = () => {
    let mode = '';
    try { mode = localStorage.getItem('mode') || ''; } catch(e) {}
    if (!mode) { showOverlay(); return null; }
    return mode;
  };

  // Ajout au papyrus
  function appendToPapyrus(text, who='ankaa') {
    if (!zone) return;
    const item = document.createElement('div');
    item.className = `ligne ${who}`;
    item.innerHTML = (text || '').replace(/\n/g, '<br>');
    zone.appendChild(item);
    zone.scrollTop = zone.scrollHeight;
  }

  // Ducking musique pendant la voix
  function playVoiceWithDucking() {
    if (!voice) return;
    const original = music ? music.volume : null;
    const safePlay = () => {
      voice.currentTime = 0;
      voice.play().catch(()=>{});
    };
    if (music) {
      music.volume = Math.max(0, Math.min(1, 0.25));
      voice.onended = () => { music.volume = (original ?? 0.6); };
    }
    safePlay();
  }

  // API
  async function invoquerSanctuaire(prompt) {
    const mode = ensureModeOrOpen();
    if (!mode) return;

    try {
      const res = await fetch('/invoquer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode })
      });
      if (!res.ok) throw new Error('Erreur réseau');
      const data = await res.json();

      if (data.reponse) appendToPapyrus(data.reponse, 'ankaa');

      if (data.audio_url && voice) {
        voice.src = data.audio_url + '?t=' + Date.now();
        playVoiceWithDucking();
      }
    } catch (err) {
      appendToPapyrus("𓂀 Le vent s’est tu un instant. Réessaie, frère.", 'ankaa');
      console.error(err);
    }
  }

  // Clique Invoquer
  btnInvoke?.addEventListener('click', (e) => {
    e.preventDefault();
    const txt = (input?.value || '').trim();
    if (!txt) return;
    appendToPapyrus(txt, 'humain');
    input.value = '';
    invoquerSanctuaire(txt);
  });

  // Entrée clavier
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      btnInvoke?.click();
    }
  });

  // Démarre la musique après 1ère interaction (mobile policy)
  const startMusicIfNeeded = () => {
    if (music && music.paused) { music.volume = 0.6; music.play().catch(()=>{}); }
  };
  ['click','touchstart'].forEach(evt => {
    window.addEventListener(evt, startMusicIfNeeded, { once:true, passive:true });
  });

  // Bouton Souffle (optionnel)
  const btnSouffle = $('#btn-souffle');
  btnSouffle?.addEventListener('click', (e) => {
    e.preventDefault();
    const mode = ensureModeOrOpen();
    if (!mode) return;
    appendToPapyrus("souffle sacré", 'humain');
    invoquerSanctuaire('souffle sacré');
  });
})();
