// Sanctuaire Ankaa — JS V1 respecté + overlay modes (safe)
document.addEventListener('DOMContentLoaded', function () {
  // 2.5 — Purge du mode à chaque rechargement
  try { window.localStorage.removeItem('mode'); } catch(_) {}

  // Réfs essentielles (V1)
  const zoneInvocation   = document.getElementById('zone-invocation');
  const btnModeMini      = document.getElementById('btn-mode-mini');
  const btnVeilleMini    = document.getElementById('btn-veille-mini');
  const btnVerbe         = document.getElementById('btn-verbe');
  const promptInput      = document.getElementById('verbe');
  const boutonSanctuaire = document.getElementById('bouton-sanctuaire');

  // État initial (2.2)
  if (zoneInvocation) zoneInvocation.style.display = 'none';
  if (btnModeMini)    { btnModeMini.disabled = true; btnModeMini.style.visibility = 'hidden'; }
  if (btnVeilleMini)  btnVeilleMini.disabled = true;
  if (btnVerbe)       btnVerbe.disabled = true;
  if (promptInput)    promptInput.disabled = true;

  // Musique + SFX volumes doux
  const audio = document.getElementById('musique-sacree');
  if (audio) audio.volume = 0.14;

  const sfxOpen   = document.getElementById('sfx-portal-open');
  const sfxClose  = document.getElementById('sfx-portal-close');
  const sfxGold   = document.getElementById('sfx-mode-gold');
  const sfxBlue   = document.getElementById('sfx-mode-blue');
  const sfxIvory  = document.getElementById('sfx-mode-ivory');
  const sfxViolet = document.getElementById('sfx-mode-violet');
  [sfxOpen, sfxClose].forEach(a => a && (a.volume = 0.24));
  [sfxGold, sfxBlue, sfxIvory, sfxViolet].forEach(a => a && (a.volume = 0.18));
  const play = (a)=>{ try{ a && (a.currentTime=0); a && a.play().catch(()=>{});}catch(_){} };

  // Portail (ouverture via bouton Sanctuaire)
  if (boutonSanctuaire) boutonSanctuaire.addEventListener('click', activerSanctuaire);

  function activerSanctuaire() {
    if (audio) audio.play().catch(()=>{});
    if (zoneInvocation) zoneInvocation.style.display = 'flex';
    if (btnModeMini)   { btnModeMini.disabled = false; btnModeMini.style.visibility = 'visible'; }
    if (btnVeilleMini) btnVeilleMini.disabled = false;
    if (btnVerbe)      btnVerbe.disabled      = true;
    if (promptInput)   promptInput.disabled   = true;

    try { fetch('/activer-ankaa').catch(()=>{}); } catch(_){}
    if (boutonSanctuaire) boutonSanctuaire.style.display = 'none';

    overlay.open({blockInput:true});
  }

  // ===== Intouchables d’affichage (inchangés) =====
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
  zone.style.display = 'flex';
  span.textContent = '';
  let i=0, total=texte.length, delay=Math.max(10, duree_ms/Math.max(1,total));
  (function next(){ if(i<total){ span.textContent+=texte[i++]; setTimeout(next,delay);} })();

  // <<< AJOUT >>> fermeture auto un peu après la fin d'écriture
  if (Number.isFinite(duree_ms)) {
    const T = Math.max(duree_ms + 300, 2000); // marge douce
    setTimeout(closePapyrus, T);
  }
}

function closePapyrus() {
  try {
    const zone = document.getElementById('papyrus-zone');
    const span = document.getElementById('papyrus-texte');
    if (zone) zone.style.display = 'none';
    if (span) span.textContent = '';
  } catch(_) {}
}

  // ===== Envoi + garde-fou =====
  function getMode(){ try{ return window.localStorage.getItem('mode'); }catch(_){ return null; } }

  function envoyerVerbe(e){
    if(e) e.preventDefault();
    const prompt=(promptInput?.value||"").trim();
    if(!prompt) return;

    const mode=getMode();
    if(!mode){ overlay.open({blockInput:false}); return; } // GARDE-FOU

    btnVerbe?.classList.add('active'); afficherAttente();

    fetch("/invoquer",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ prompt, mode })
    })
    .then(r=>r.json())
    .then(data=>{
      btnVerbe?.classList.remove('active'); masquerAttente();
      if(data?.reponse){
        if(data.audio_url){
          const tts=document.getElementById('tts-player');
          if(tts){
            tts.src=data.audio_url+"?t="+Date.now();
            tts.onloadedmetadata=function(){
              const duree=Math.max(tts.duration*1000,1800);
              animeOeilVoix(duree); affichePapyrus(data.reponse,duree); tts.play().catch(()=>{});
            };
          }
        } else {
          const duree=Math.max(2200, data.reponse.length*50);
          animeOeilVoix(duree); affichePapyrus(data.reponse,duree);
        }
      } else { affichePapyrus("(Silence sacré)"); }
    })
    .catch(()=>{ btnVerbe?.classList.remove('active'); masquerAttente(); affichePapyrus("𓂀 Ankaa : Erreur de communication."); });

    if(promptInput) promptInput.value="";
  }

  if (btnVerbe && promptInput){
    btnVerbe.addEventListener('click', envoyerVerbe);
    promptInput.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyerVerbe(e); });
  }

  // ===== Souffle sacré (inchangé) =====
  let souffleInterval=null, veilleActive=false, souffleEnCours=false;
  const btnVeille=btnVeilleMini;
  if(btnVeille){
    btnVeille.addEventListener('click', function(){
      if(!veilleActive){
        veilleActive=true; btnVeille.classList.add('active'); lancerSouffle();
        souffleInterval=setInterval(lancerSouffle, 30000);
      } else {
        veilleActive=false; btnVeille.classList.remove('active');
        clearInterval(souffleInterval); souffleInterval=null;
      }
    });
  }

  function lancerSouffle(){
    if(souffleEnCours) return; souffleEnCours=true;
    const mode=getMode() || "sentinelle8"; // fallback non-bloquant
    fetch("/invoquer",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ prompt:"souffle sacré", mode })
    })
    .then(r=>r.json())
    .then(data=>{
      if(data?.reponse){
        if(data.audio_url){
          const tts=document.getElementById('tts-player');
          if(tts){
            tts.src=data.audio_url+"?t="+Date.now();
            tts.onloadedmetadata=function(){
              const duree=Math.max(tts.duration*1000,1800);
              animeOeilVoix(duree); affichePapyrus(data.reponse,duree); tts.play().catch(()=>{});
              setTimeout(()=>{ souffleEnCours=false; }, duree+500);
            };
          }
        } else {
          const duree=Math.max(2200, data.reponse.length*50);
          animeOeilVoix(duree); affichePapyrus(data.reponse,duree);
          setTimeout(()=>{ souffleEnCours=false; }, duree+500);
        }
      } else { affichePapyrus("(Silence sacré)"); souffleEnCours=false; }
    })
    .catch(()=>{ affichePapyrus("𓂀 Ankaa : Erreur de communication."); souffleEnCours=false; });
  }

  // ===== [MODE_OVERLAY_PROTOCOL_FINAL] =====
  const overlayEl = document.getElementById('mode-overlay');
  const optionBtns = Array.from(document.querySelectorAll('#mode-overlay .mode-option'));

  const overlay = {
    open({blockInput}={blockInput:false}){
      if(!overlayEl) return;
      overlayEl.classList.remove('overlay-hidden');
      overlayEl.setAttribute('aria-hidden','false');
      if(blockInput){ if(btnVerbe) btnVerbe.disabled=true; if(promptInput) promptInput.disabled=true; }
      play(sfxOpen);
    },
    close(){
      if(!overlayEl) return;
      overlayEl.classList.add('overlay-hidden');
      overlayEl.setAttribute('aria-hidden','true');
      play(sfxClose);
    }
  };
  window.overlay = overlay; // debug optionnel

  function setMode(modeKey){
    try{ window.localStorage.setItem('mode', modeKey); }catch(_){}
    // Thème dynamique discret
    const html = document.documentElement;
    if (html){
      html.setAttribute('data-mode', modeKey);
      html.classList.add('pulse-accent');
      setTimeout(()=> html.classList.remove('pulse-accent'), 950);
    }
    // Débloque input + Invoquer
    if(btnVerbe)    btnVerbe.disabled=false;
    if(promptInput) promptInput.disabled=false;

    // SFX par mode
    if (modeKey === 'sentinelle8')      play(sfxGold);
    else if (modeKey === 'dragosly23')  play(sfxBlue);
    else if (modeKey === 'invite')      play(sfxIvory);
    else if (modeKey === 'verbe')       play(sfxViolet);

    overlay.close();
  }

  optionBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{ const m=btn.getAttribute('data-mode'); if(m) setMode(m); });
  });

  // ☥ réouverture sans rebloquer
  if (btnModeMini){
    btnModeMini.addEventListener('click', ()=>{ overlay.open({blockInput:false}); });
  }

  // ESC pour fermer l’overlay (sans rebloquer l’input)
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      const ov = document.getElementById('mode-overlay');
      if(ov && !ov.classList.contains('overlay-hidden')){
        overlay.close();
      }
    }
  });
});
