// Sanctuaire Ankaa — script.js (compatible avec TON index.html)
document.addEventListener('DOMContentLoaded', () => {
  // ===== Raccourcis DOM (sécures) =====
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ----- Éléments selon TON HTML -----
  const btnSanctuaire = $('#bouton-sanctuaire');
  const btnModeMini   = $('#btn-mode-mini');
  const btnVeille     = $('#btn-veille-mini');     // Souffle
  const btnVerbe      = $('#btn-verbe');           // Invocation
  const inputVerbe    = $('#verbe');               // Champ texte

  const zoneInvocation= $('#zone-invocation');     // bloc d’input/bouton
  const overlay       = $('#mode-overlay');        // overlay de choix de mode
  const optionBtns    = $$('#mode-overlay .mode-option');

  // Audio
  const musique       = $('#musique-sacree');
  const tts           = $('#tts-player');
  const sfxOpen       = $('#sfx-portal-open')   || $('#s-open');
  const sfxClose      = $('#sfx-portal-close')  || $('#s-close');
  const sfxMode       = $('#sfx-mode')          || $('#s-mode');
  const sfxClick      = $('#sfx-click')         || $('#s-click');

  // Visuels
  const papyrusZone   = $('#papyrus-zone');
  const papyrusTexte  = $('#papyrus-texte');
  const oeil          = $('.oeil-centre');
  const aura          = $('#aura-ankaa');

  // ===== Volumes doux (optionnels) =====
  try { if (musique) musique.volume = 0.14; } catch(_){}
  ;[sfxOpen, sfxClose, sfxMode, sfxClick].forEach(a => { try{ if(a) a.volume = 0.22; }catch(_){} });

  // ===== État global =====
  const State = {
    sanctuaire: false,
    veille: false,             // Souffle ON/OFF
    souffleEnCours: false,
    souffleTimer: null,
    invocationEnCours: false   // toggle pour le bouton Invocation
  };

  // ===== Helpers UI & Audio =====
  const play = (a) => { try{ a && (a.currentTime = 0); a && a.play().catch(()=>{}); }catch(_){} };
  const setActive = (btn, on) => {
    if (!btn) return;
    btn.classList.toggle('active', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  function affichePapyrus(texte, dureeMs = 2500){
    if(!papyrusZone || !papyrusTexte) return;
    papyrusZone.style.display = 'flex';
    papyrusTexte.textContent = '';
    const chars = [...(texte || '')];
    const step  = Math.max(10, Math.floor(dureeMs / Math.max(1, chars.length)));
    let i = 0;
    (function next(){ if(i<chars.length){ papyrusTexte.textContent+=chars[i++]; setTimeout(next,step);} })();
    setTimeout(closePapyrus, Math.max(dureeMs + 300, 1800));
  }
  function closePapyrus(){
    if (papyrusZone) papyrusZone.style.display = 'none';
    if (papyrusTexte) papyrusTexte.textContent = '';
  }
  function animeOeil(ms){
    if(oeil) oeil.classList.add('playing');
    if(aura) aura.classList.add('active');
    setTimeout(()=>{ if(oeil) oeil.classList.remove('playing'); if(aura) aura.classList.remove('active'); }, ms || 1800);
  }

  // Sync visuel (anti-bouton-jaune)
  setInterval(() => {
    setActive(btnVeille, State.sanctuaire && State.veille);
    setActive(btnVerbe,  State.sanctuaire && State.invocationEnCours);
    if (!State.sanctuaire) {
      [btnModeMini, btnVeille, btnVerbe].forEach(b => setActive(b, false));
    }
  }, 500);

  // ===== Ouverture du Sanctuaire (clé d’Ankh) =====
  if (btnSanctuaire){
    // Masque l’UI avant ouverture (tu l’avais déjà, je renforce)
    try {
      if (zoneInvocation) zoneInvocation.style.display = 'none';
      [btnModeMini, btnVeille, btnVerbe, inputVerbe].forEach(b => { if(b){ b.disabled = true; b.style.visibility = 'hidden'; } });
    } catch(_){}

    btnSanctuaire.addEventListener('click', () => {
      State.sanctuaire = true;
      play(musique); play(sfxOpen);

      // Active l’UI
      [btnModeMini, btnVeille, btnVerbe, inputVerbe].forEach(b => { if(b){ b.disabled = false; b.style.visibility = 'visible'; } });
      if (zoneInvocation) zoneInvocation.style.display = 'flex';

      // ping back
      try { fetch('/activer-ankaa', {method:'POST'}).catch(()=>{}); } catch(_){}

      // Disparition de la clé d’Ankh
      btnSanctuaire.style.display = 'none';
    });
  }

  // ===== Overlay de modes =====
  function setMode(modeKey){
    try { localStorage.setItem('mode', modeKey); } catch(_) {}
    const html = document.documentElement;
    if (html){
      html.setAttribute('data-mode', modeKey);
      html.classList.add('pulse-accent');
      setTimeout(()=> html.classList.remove('pulse-accent'), 900);
    }
  }
  function getMode(){
    try { return localStorage.getItem('mode') || 'sentinelle8'; }
    catch(_){ return 'sentinelle8'; }
  }
  if (btnModeMini){
    btnModeMini.addEventListener('click', () => {
      if (!State.sanctuaire) return;
      if (!overlay) return play(sfxMode);
      overlay.classList.remove('overlay-hidden');
      overlay.setAttribute('aria-hidden','false');
      play(sfxMode);
    });
  }
  if (overlay){
    optionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-mode');
        if (!m) return;
        setMode(m);
        // Ferme overlay
        overlay.classList.add('overlay-hidden');
        overlay.setAttribute('aria-hidden','true');
        play(sfxClose);
      });
    });
    // ESC pour fermer
    document.addEventListener('keydown', (e)=> {
      if(e.key === 'Escape' && !overlay.classList.contains('overlay-hidden')){
        overlay.classList.add('overlay-hidden');
        overlay.setAttribute('aria-hidden','true');
        play(sfxClose);
      }
    });
  }

  // ===== SOUFFLE (btn-veille-mini) =====
  if (btnVeille){
    btnVeille.addEventListener('click', () => {
      if (!State.sanctuaire) return;

      // Re-clic => OFF immédiat
      if (State.veille){
        stopSouffle();
        return;
      }

      // ON
      State.veille = true;
      setActive(btnVeille, true);
      lancerSouffle();

      // Relance périodique (30s) tant que ON
      State.souffleTimer = setInterval(() => {
        if (State.veille && !State.souffleEnCours) lancerSouffle();
      }, 30000);

      play(sfxClick);
    });
  }

  function stopSouffle(){
    State.veille = false;
    setActive(btnVeille, false);
    if (State.souffleTimer){ clearInterval(State.souffleTimer); State.souffleTimer = null; }
    State.souffleEnCours = false;
    try { if (tts){ tts.pause(); tts.currentTime = 0; } } catch(_){}
    closePapyrus();
    play(sfxClose);
  }

  function lancerSouffle(){
    if (!State.veille || State.souffleEnCours) return;
    State.souffleEnCours = true;

    fetch('/invoquer', {
      method : 'POST',
      headers: { 'Content-Type':'application/json' },
      body   : JSON.stringify({ prompt: 'souffle sacré', mode: getMode() })
    })
    .then(r => r.json())
    .then(data => {
      if (!State.veille){ State.souffleEnCours = false; return; } // OFF entre-temps
      if (data?.reponse){
        if (data.audio_url && tts){
          tts.src = data.audio_url + '?t=' + Date.now();
          tts.onloadedmetadata = () => {
            const duree = Math.max(1800, (tts.duration || 1) * 1000);
            animeOeil(duree);
            affichePapyrus(data.reponse, duree);
            // le Souffle ne force pas la lecture auto : si tu veux toujours lire, dé-commente :
            // tts.play().catch(()=>{});
            setTimeout(()=>{ State.souffleEnCours = false; }, duree + 300);
          };
        } else {
          const duree = Math.max(2000, data.reponse.length * 45);
          animeOeil(duree);
          affichePapyrus(data.reponse, duree);
          setTimeout(()=>{ State.souffleEnCours = false; }, duree + 300);
        }
      } else {
        affichePapyrus('(Silence sacré)');
        State.souffleEnCours = false;
      }
    })
    .catch(() => {
      affichePapyrus('𓂀 Ankaa : Erreur de communication.');
      State.souffleEnCours = false;
      stopSouffle(); // évite le bouton bloqué
    });
  }

  // ===== INVOCATION (btn-verbe + champ #verbe) =====
  if (btnVerbe && inputVerbe){
    btnVerbe.addEventListener('click', () => {
      if (!State.sanctuaire) return;

      // OFF immédiat si re-clic pendant lecture
      if (State.invocationEnCours){
        finInvocation(true); // true = dur (stop audio + papyrus)
        return;
      }

      const prompt = (inputVerbe.value || '').trim();
      if (!prompt) return;

      State.invocationEnCours = true;
      setActive(btnVerbe, true);
      play(sfxClick);

      fetch('/invoquer', {
        method : 'POST',
        headers: { 'Content-Type':'application/json' },
        body   : JSON.stringify({ prompt, mode: getMode() })
      })
      .then(r => r.json())
      .then(data => {
        if (data?.reponse){
          if (data.audio_url && tts){
            tts.src = data.audio_url + '?t=' + Date.now();
            tts.onloadedmetadata = () => {
              const duree = Math.max(2000, (tts.duration || 1) * 1000);
              animeOeil(duree);
              affichePapyrus(data.reponse, duree);
              // l’invocation joue l’audio (par design)
              tts.play().catch(()=>{});
              setTimeout(()=> finInvocation(false), duree + 300);
            };
          } else {
            const duree = Math.max(2200, data.reponse.length * 50);
            animeOeil(duree);
            affichePapyrus(data.reponse, duree);
            setTimeout(()=> finInvocation(false), duree + 300);
          }
        } else {
          affichePapyrus('𓂀 Ankaa : Silence…');
          finInvocation(false);
        }
      })
      .catch(() => { affichePapyrus('𓂀 Ankaa : Erreur invocation.'); finInvocation(false); });

      inputVerbe.value = '';
    });

    // Entrée ↩︎
    inputVerbe.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') btnVerbe.click();
    });
  }

  function finInvocation(stopDur){
    State.invocationEnCours = false;
    setActive(btnVerbe, false);
    if (stopDur && tts){ try{ tts.pause(); tts.currentTime = 0; }catch(_){ } }
    if (stopDur) closePapyrus();
  }
});
