// Sanctuaire Ankaa — script.js (toggles fiables + stop souffle + vocal propre)
document.addEventListener('DOMContentLoaded', () => {
  // ===== Raccourcis DOM =====
  const $ = (sel) => document.querySelector(sel);

  const btnModeMini   = $('#btn-mode-mini');     // choisir un mode (overlay/feedback)
  const btnSanctuaire = $('#btn-sanctuaire');    // ouvrir le sanctuaire (inchangé)
  const btnVeille     = $('#btn-veille-mini');   // Souffle sacré (toggle)
  const btnVocal      = $('#btn-vocal');         // Lecture auto (toggle)

  const zoneInvocation= $('#zone-invocation');   // si présent dans ton HTML
  const papyrusZone   = $('#papyrus-zone');
  const papyrusTexte  = $('#papyrus-texte');

  const musique       = $('#musique-sacree');
  const sfxClick      = $('#s-click');
  const sfxOpen       = $('#s-open');
  const sfxClose      = $('#s-close');
  const sfxMode       = $('#s-mode');
  const tts           = $('#tts-player');        // <audio id="tts-player" preload="auto" style="display:none">

  // ===== Volumes doux =====
  try { if (musique) musique.volume = 0.08; } catch(_){}
  [sfxClick, sfxOpen, sfxClose, sfxMode].forEach(a => { try { if (a) a.volume = 0.22; } catch(_){} });

  // ===== État global =====
  const State = {
    sanctuaire: false,
    veille: false,          // souffle ON/OFF
    vocal: false,           // lecture auto ON/OFF
    souffleEnCours: false,  // un souffle est en train d’être joué
    souffleTimer: null
  };

  // ===== Helpers UI =====
  const setActive = (btn, on) => {
    if (!btn) return;
    btn.classList.toggle('active', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  const play = (a) => { try { a && (a.currentTime = 0); a && a.play().catch(()=>{}); } catch(_){} };

  // Papyrus
  function affichePapyrus(texte, dureeMs = 2500){
    if(!papyrusZone || !papyrusTexte) return;
    papyrusZone.style.display = 'flex';
    papyrusTexte.textContent = '';
    const chars = [...(texte || '')];
    const step  = Math.max(10, Math.floor(dureeMs / Math.max(1, chars.length)));
    let i = 0;
    (function next(){ if (i < chars.length){ papyrusTexte.textContent += chars[i++]; setTimeout(next, step);} })();
    setTimeout(closePapyrus, Math.max(dureeMs + 300, 1800));
  }
  function closePapyrus(){ if(papyrusZone&&papyrusTexte){ papyrusZone.style.display='none'; papyrusTexte.textContent=''; } }

  // OEIL anim (si classes existantes)
  function animeOeilVoix(ms){
    const oeil = document.querySelector('.oeil-centre');
    const aura = $('#aura-ankaa');
    if(oeil) oeil.classList.add('playing');
    if(aura) aura.classList.add('active');
    setTimeout(()=>{ if(oeil) oeil.classList.remove('playing'); if(aura) aura.classList.remove('active'); }, ms || 1800);
  }

  // Anti “jaune bloqué” (sync visuel <- état)
  setInterval(() => {
    setActive(btnVeille, State.sanctuaire && State.veille);
    setActive(btnVocal,  State.sanctuaire && State.vocal);
    if (!State.sanctuaire){
      setActive(btnModeMini, false);
      setActive(btnVeille,   false);
      setActive(btnVocal,    false);
    }
  }, 500);

  // ===== Ouverture Sanctuaire (inchangé, juste un peu de garde-fou) =====
  if (btnSanctuaire){
    // masque l’UI avant ouverture
    if (zoneInvocation) zoneInvocation.style.display = 'none';
    [btnModeMini, btnVeille, btnVocal].forEach(b => { if(b){ b.disabled = true; b.style.visibility = 'hidden'; } });

    btnSanctuaire.addEventListener('click', () => {
      State.sanctuaire = true;
      play(musique); play(sfxOpen);

      [btnModeMini, btnVeille, btnVocal].forEach(b => { if(b){ b.disabled = false; b.style.visibility = 'visible'; } });
      if (zoneInvocation) zoneInvocation.style.display = 'flex';

      try { fetch('/activer-ankaa',{method:'POST'}).catch(()=>{}); } catch(_){}
      btnSanctuaire.style.display = 'none';
    });
  }

  // ===== Choix de mode (feedback simple / overlay si tu en as un) =====
  if (btnModeMini){
    btnModeMini.addEventListener('click', () => {
      if (!State.sanctuaire) return;
      play(sfxMode);
      btnModeMini.classList.add('pulse'); setTimeout(()=>btnModeMini.classList.remove('pulse'), 600);
      // si tu as un overlay, appelle-le ici (window.overlay.open()…)
    });
  }

  // ===== Mode VOCAL (toggle) =====
  if (btnVocal){
    btnVocal.addEventListener('click', () => {
      if (!State.sanctuaire) return;
      State.vocal = !State.vocal;
      setActive(btnVocal, State.vocal);
      // couper immédiatement si OFF
      if (!State.vocal && tts){ try { tts.pause(); tts.currentTime = 0; } catch(_){} }
      play(sfxClick);
    });
  }

  // ===== SOUFFLE (toggle + relance périodique) =====
  if (btnVeille){
    btnVeille.addEventListener('click', () => {
      if (!State.sanctuaire) return;

      // re-clic => OFF immédiat
      if (State.veille){
        stopSouffle();
        return;
      }

      // ON
      State.veille = true;
      setActive(btnVeille, true);
      lancerSouffle();

      // relance périodique pendant ON
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
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ prompt:'souffle sacré', mode: getMode() || 'sentinelle8' })
    })
    .then(r => r.json())
    .then(data => {
      if (!State.veille){ State.souffleEnCours = false; return; } // OFF entre-temps
      if (data?.reponse){
        if (data.audio_url && tts){
          tts.src = data.audio_url + '?t=' + Date.now();
          tts.onloadedmetadata = () => {
            const duree = Math.max(1800, (tts.duration || 1) * 1000);
            animeOeilVoix(duree);
            affichePapyrus(data.reponse, duree);
            if (State.vocal){ tts.play().catch(()=>{}); }
            setTimeout(()=>{ State.souffleEnCours = false; }, duree + 300);
          };
        } else {
          const duree = Math.max(2000, data.reponse.length * 45);
          animeOeilVoix(duree);
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
      stopSouffle(); // évite le jaune bloqué
    });
  }

  // ===== Mode courant (si tu utilises localStorage pour le choix) =====
  function getMode(){
    try { return window.localStorage.getItem('mode') || 'sentinelle8'; }
    catch(_) { return 'sentinelle8'; }
  }
});
