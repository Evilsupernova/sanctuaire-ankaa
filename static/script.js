// Sanctuaire Ankaa — mobile Render-safe (respect V7)
document.addEventListener('DOMContentLoaded', () => {
  // Purge du mode à chaque rechargement (cahier des charges)
  try { localStorage.removeItem('mode'); } catch(_) {}

  // Réfs
  const audioBG   = document.getElementById('musique-sacree');
  const tts       = document.getElementById('tts-player');
  const btnSanct  = document.getElementById('bouton-sanctuaire');
  const btnMode   = document.getElementById('btn-mode-mini');
  const btnSouff  = document.getElementById('btn-veille-mini');
  const btnVerbe  = document.getElementById('btn-verbe');
  const input     = document.getElementById('verbe');
  const zoneChat  = document.getElementById('zone-invocation');

  // SFX
  const sfxOpen   = document.getElementById('sfx-portal-open');
  const sfxClose  = document.getElementById('sfx-portal-close');
  const sfxSelect = document.getElementById('sfx-select');
  const sfxClick  = document.getElementById('sfx-click');

  if (audioBG)  audioBG.volume = 0.14;
  [sfxOpen, sfxClose].forEach(a => a && (a.volume = 0.26));
  [sfxSelect, sfxClick].forEach(a => a && (a.volume = 0.18));

  const play = a => { try { a && (a.currentTime = 0); a && a.play().catch(()=>{}); } catch(_){} };

  // iOS : "unlock" audio (musique + TTS) dès la 1ère interaction
  (function unlockIOS(){
    function arm(){
      [audioBG, tts, sfxOpen, sfxClose, sfxSelect, sfxClick].forEach(a=>{
        if(!a) return;
        a.muted = true;
        const p = a.play();
        if (p && p.finally) p.finally(()=>{ a.pause(); a.currentTime=0; a.muted=false; });
      });
      window.removeEventListener('touchstart', arm, {passive:true});
      window.removeEventListener('click', arm, {passive:true});
    }
    window.addEventListener('touchstart', arm, {once:true, passive:true});
    window.addEventListener('click', arm, {once:true, passive:true});
  })();

  // État initial : sanctuaire fermé, input/𓂀 bloqués tant qu’aucun mode
  if (zoneChat)  zoneChat.style.display = 'none';
  if (input)     input.disabled = true;
  if (btnVerbe)  btnVerbe.disabled = true;

  // Overlay
  const overlayEl = document.getElementById('mode-overlay');
  const modeBtns  = Array.from(document.querySelectorAll('#mode-overlay .mode-option'));
  const overlay = {
    open({blockInput}={blockInput:false}){
      if (!overlayEl) return;
      overlayEl.classList.remove('overlay-hidden');
      overlayEl.setAttribute('aria-hidden','false');
      if (blockInput){ if(input) input.disabled = true; if(btnVerbe) btnVerbe.disabled = true; }
      play(sfxOpen);
    },
    close(){
      if (!overlayEl) return;
      overlayEl.classList.add('overlay-hidden');
      overlayEl.setAttribute('aria-hidden','true');
      play(sfxClose);
    }
  };
  window.overlay = overlay; // debug

  // Ouverture du Sanctuaire
  if (btnSanct) btnSanct.addEventListener('click', () => {
    // musique
    if (audioBG) audioBG.play().catch(()=>{});
    // montre la zone d’invocation
    if (zoneChat) zoneChat.style.display = 'flex';
    // cache le bouton sanctuaire
    btnSanct.style.display = 'none';
    // ouverture overlay: il faut choisir un mode
    overlay.open({blockInput:true});
    // ping serveur
    fetch('/activer-ankaa').catch(()=>{});
  });

  // Choix mode
  function setMode(modeKey){
    try { localStorage.setItem('mode', modeKey); } catch(_){}
    if (input)    input.disabled   = false;
    if (btnVerbe) btnVerbe.disabled = false;
    play(sfxSelect);
    overlay.close();
  }
  modeBtns.forEach(b => b.addEventListener('click', () => {
    const key = b.getAttribute('data-mode'); if (!key) return;
    setMode(key);
  }));

  // Bouton ☥ (haut gauche) pour rouvrir le choix de mode
  if (btnMode) btnMode.addEventListener('click', () => overlay.open({blockInput:false}));

  // ESC ferme l’overlay
  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape'){
      const ov = document.getElementById('mode-overlay');
      if(ov && !ov.classList.contains('overlay-hidden')) overlay.close();
    }
  });

  // Animations Œil + Papyrus
  function afficherAttente(){ const a=document.getElementById("points-sacrés"); if(a) a.style.display="block"; }
  function masquerAttente(){ const a=document.getElementById("points-sacrés"); if(a) a.style.display="none"; }

  function animeOeilVoix(duree_ms){
    const oeil=document.querySelector('.oeil-centre');
    const aura=document.getElementById('aura-ankaa');
    if(oeil) oeil.classList.add('playing');
    if(aura) aura.classList.add('active');
    setTimeout(()=>{ if(oeil) oeil.classList.remove('playing'); if(aura) aura.classList.remove('active'); }, duree_ms);
  }

  function affichePapyrus(texte, duree_ms = 2500){
    const zone = document.getElementById('papyrus-zone');
    const span = document.getElementById('papyrus-texte');
    if(!zone || !span) return;
    zone.style.display = 'block';
    span.textContent = '';
    let i=0, total=texte.length, delay=Math.max(10, duree_ms/Math.max(1,total));
    (function next(){ if(i<total){ span.textContent+=texte[i++]; setTimeout(next,delay);} })();
    if (Number.isFinite(duree_ms)){
      const T = Math.max(duree_ms + 300, 2200);
      setTimeout(()=>{ try{ zone.style.display='none'; span.textContent=''; }catch(_){} }, T);
    }
  }

  // Garde-fou : pas de mode => overlay
  function getMode(){ try{ return localStorage.getItem('mode'); }catch(_){ return null; } }

  // Envoi invocation (𓂀)
  function envoyer(e){
    if(e) e.preventDefault();
    const prompt = (input?.value || "").trim();
    if(!prompt) return;

    const mode = getMode();
    if(!mode){ overlay.open({blockInput:false}); return; }

    btnVerbe?.classList.add('active'); afficherAttente();
    fetch('/invoquer', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt, mode })
    })
    .then(r=>r.json())
    .then(data=>{
      btnVerbe?.classList.remove('active'); masquerAttente();
      if(data?.reponse){
        if (data.audio_url && tts){
          tts.src = data.audio_url + '?t=' + Date.now();
          tts.onloadedmetadata = function(){
            const d = Math.max((tts.duration||2)*1000, 1800);
            animeOeilVoix(d); affichePapyrus(data.reponse, d);
            tts.play().catch(()=>{});
          };
        } else {
          const d = Math.max(2200, data.reponse.length*50);
          animeOeilVoix(d); affichePapyrus(data.reponse, d);
        }
      }
    })
    .catch(()=>{ btnVerbe?.classList.remove('active'); masquerAttente(); affichePapyrus("𓂀 Ankaa : erreur de communication."); });

    if (input) input.value = "";
  }
  if (btnVerbe && input){
    btnVerbe.addEventListener('click', envoyer);
    input.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyer(e); });
  }

  // Souffle sacré (𓆱) — voix homme, fragments dataset
  let souffleTimer = null, souffleEnCours = false;
  if (btnSouff){
    btnSouff.addEventListener('click', () => {
      if (btnSouff.classList.contains('active')){
        btnSouff.classList.remove('active');
        clearInterval(souffleTimer); souffleTimer=null;
      } else {
        btnSouff.classList.add('active');
        lancerSouffle();
        souffleTimer = setInterval(lancerSouffle, 30000);
      }
    });
  }
  function lancerSouffle(){
    if (souffleEnCours) return; souffleEnCours = true;
    const mode = getMode() || 'sentinelle8';
    fetch('/invoquer', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt: 'souffle sacré', mode })
    })
    .then(r=>r.json())
    .then(data=>{
      if(data?.reponse){
        if (data.audio_url && tts){
          tts.src = data.audio_url + '?t=' + Date.now();
          tts.onloadedmetadata = function(){
            const d = Math.max((tts.duration||2)*1000, 1800);
            animeOeilVoix(d); affichePapyrus(data.reponse, d);
            tts.play().catch(()=>{});
            setTimeout(()=>{ souffleEnCours=false; }, d+400);
          };
        } else {
          const d = Math.max(2200, data.reponse.length*50);
          animeOeilVoix(d); affichePapyrus(data.reponse, d);
          setTimeout(()=>{ souffleEnCours=false; }, d+400);
        }
      } else { souffleEnCours=false; }
    })
    .catch(()=>{ souffleEnCours=false; });
  }
});
