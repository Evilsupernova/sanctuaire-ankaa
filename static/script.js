// Sanctuaire Ankaa — Front mobile=web (musique, sons, RAG, papyrus)
document.addEventListener('DOMContentLoaded', () => {
  // --- Hauteur viewport fiable iOS (corrige 100vh / clavier) ---
function setVh() {
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${vh / 100}px`);
}
setVh();
window.addEventListener('resize', setVh);
window.visualViewport && window.visualViewport.addEventListener('resize', setVh);
  // Purge mode au chargement (CDC 2.5)
  try { localStorage.removeItem('mode'); } catch(_) {}

  // Refs
  const input   = document.getElementById('verbe');
  const btnGo   = document.getElementById('btn-verbe');
  const zone    = document.getElementById('zone-invocation');
  const btnOpen = document.getElementById('bouton-sanctuaire');
  const btnMini = document.getElementById('btn-mode-mini');
  const btnVeil = document.getElementById('btn-veille-mini');
  const tts     = document.getElementById('tts-player');
  const bgm     = document.getElementById('musique-sacree');
  const sClick  = document.getElementById('s-click');
  const sOpen   = document.getElementById('s-open');
  const sClose  = document.getElementById('s-close');
  const sMode   = document.getElementById('s-mode');

  // Etat init
  if (zone) zone.style.display = 'none';
  [btnGo, input].forEach(el => el && (el.disabled = true));
  if (btnMini) { btnMini.disabled = true; btnMini.style.visibility = 'hidden'; }

  // Sons — safePlay helper
  function safePlay(a){ if(!a) return; a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(()=>{}); }
  if (bgm) {
    bgm.volume = 0.25;
    ['click','touchstart'].forEach(evt => {
      window.addEventListener(evt, () => safePlay(bgm), { once:true, passive:true });
    });
  }
  [sClick,sOpen,sClose,sMode].forEach(a => { if (a) a.volume = 0.30; });

  // Overlay
  const overlayEl = document.getElementById('mode-overlay');
  const overlay = {
    open({blockInput}={blockInput:false}){
      overlayEl?.classList.remove('overlay-hidden');
      overlayEl?.setAttribute('aria-hidden','false');
      if(blockInput){ if(btnGo) btnGo.disabled=true; if(input) input.disabled=true; }
      safePlay(sOpen);
    },
    close(){
      overlayEl?.classList.add('overlay-hidden');
      overlayEl?.setAttribute('aria-hidden','true');
      safePlay(sClose);
    }
  };
  window.overlay = overlay;

  // Ouverture Sanctuaire
  btnOpen?.addEventListener('click', () => {
    fetch('/activer-ankaa').catch(()=>{});
    safePlay(sOpen);
    if (bgm) safePlay(bgm);
    if (zone) zone.style.display = 'grid';
    if (btnMini) { btnMini.disabled=false; btnMini.style.visibility='visible'; }
    if (btnVeil) btnVeil.disabled=false;
    if (btnGo) btnGo.disabled=true;
    if (input) input.disabled=true;
    btnOpen.style.display='none';
    overlay.open({blockInput:true});
  });

  // Sélection de mode
  function setMode(key){
    try { localStorage.setItem('mode', key); } catch(_){}
    if (btnGo) btnGo.disabled = false;
    if (input) input.disabled = false;
    overlay.close(); safePlay(sMode);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode')));
  });
  btnMini?.addEventListener('click', ()=> overlay.open({blockInput:false}));
  document.addEventListener('keydown', (e)=> {
    if (e.key === 'Escape' && overlayEl && !overlayEl.classList.contains('overlay-hidden')) overlay.close();
  });

  // Effets visuels (œil/aura/papyrus)
  const eye  = document.querySelector('.oeil-centre');
  const aura = document.getElementById('aura-ankaa');
  const pap  = document.getElementById('papyrus-zone');
  const ptxt = document.getElementById('papyrus-texte');
  const pts  = document.getElementById('points-sacrés');

  function waiting(on){ if(!pts) return; pts.style.display = on ? 'block' : 'none'; }
  function playVisu(durationMs){
    if (eye) eye.classList.add('playing');
    if (aura) aura.classList.add('active');
    setTimeout(()=>{ eye?.classList.remove('playing'); aura?.classList.remove('active'); }, Math.max(durationMs, 1200));
  }
  function showPapyrus(text, durationMs){
    if (!pap || !ptxt) return;
    pap.style.display='flex'; ptxt.textContent="";
    let i=0, total=text.length, step=Math.max(8, durationMs/Math.max(1,total));
    (function loop(){ if(i<total){ ptxt.textContent += text[i++]; setTimeout(loop, step);} })();
    setTimeout(()=>{ pap.style.display='none'; ptxt.textContent=""; }, Math.max(durationMs+300, 2000));
  }

  // Envoi (clé correcte: prompt)
  async function envoyer(e){
    e && e.preventDefault();
    const prompt = (input?.value || "").trim(); if (!prompt) return;
    const mode = localStorage.getItem('mode') || null;
    if (!mode) { overlay.open({blockInput:false}); return; }

    safePlay(sClick); waiting(true); btnGo?.classList.add('active');

    try {
      const r = await fetch("/invoquer", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ prompt, mode })
      });
      const data = await r.json();
      waiting(false); btnGo?.classList.remove('active');
      const rep = data?.reponse || "(Silence sacré)";
      if (data?.audio_url && tts){
        tts.src = data.audio_url + "?t=" + Date.now();
        tts.onloadedmetadata = function(){
          const d = Math.max(1800, (tts.duration||2)*1000);
          playVisu(d); showPapyrus(rep, d); safePlay(tts);
        };
      } else {
        const d = Math.max(2200, rep.length*42);
        playVisu(d); showPapyrus(rep, d);
      }
    } catch(err){
      waiting(false); btnGo?.classList.remove('active');
      showPapyrus("𓂀 Ankaa : Erreur de communication.");
    }
    if (input) input.value="";
  }

  btnGo?.addEventListener('click', envoyer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyer(e); });

  // Souffle (veille)
  let souffleLock=false, souffleTimer=null;
  btnVeil?.addEventListener('click', ()=>{
    if (btnVeil.classList.contains('active')){
      btnVeil.classList.remove('active'); clearInterval(souffleTimer); souffleTimer=null; safePlay(sClose);
    } else {
      btnVeil.classList.add('active'); lancerSouffle(); souffleTimer = setInterval(lancerSouffle, 30000); safePlay(sOpen);
    }
  });

  function lancerSouffle(){
    if (souffleLock) return; souffleLock = true;
    const mode = localStorage.getItem('mode') || "sentinelle8";
    fetch("/invoquer", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ prompt: "souffle sacré", mode })
    })
    .then(r=>r.json())
    .then(data=>{
      const rep = data?.reponse || "(Silence sacré)";
      if (data?.audio_url && tts){
        tts.src = data.audio_url + "?t=" + Date.now();
        tts.onloadedmetadata = function(){
          const d = Math.max(1800, (tts.duration||2)*1000);
          playVisu(d); showPapyrus(rep, d); safePlay(tts);
          setTimeout(()=> souffleLock=false, d+400);
        };
      } else {
        const d = Math.max(2200, rep.length*42);
        playVisu(d); showPapyrus(rep, d); setTimeout(()=> souffleLock=false, d+400);
      }
    })
    .catch(()=>{ showPapyrus("𓂀 Ankaa : Erreur de communication."); souffleLock=false; });
  }
});
