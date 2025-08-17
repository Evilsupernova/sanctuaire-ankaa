document.addEventListener('DOMContentLoaded', () => {
  // iOS audio unlock
  (function unlockIOS(){
    const ids=['musique-sacree','tts-player'];
    function arm(){
      ids.forEach(id=>{
        const a=document.getElementById(id);
        if(!a) return;
        a.muted=true;
        const p=a.play();
        if(p && p.finally) p.finally(()=>{ a.pause(); a.currentTime=0; a.muted=false; });
      });
      window.removeEventListener('touchstart', arm, {passive:true});
      window.removeEventListener('click', arm, {passive:true});
    }
    window.addEventListener('touchstart', arm, {once:true, passive:true});
    window.addEventListener('click', arm, {once:true, passive:true});
  })();

  // Refs
  const input=document.getElementById('verbe');
  const btnGo=document.getElementById('btn-verbe');
  const btnOpen=document.getElementById('bouton-sanctuaire');
  const btnMode=document.getElementById('btn-mode-mini');
  const btnSouffle=document.getElementById('btn-veille-mini');
  const btnVocal=document.getElementById('btn-vocal');
  const overlay=document.getElementById('mode-overlay');
  const pap=document.getElementById('papyrus-zone');
  const ptxt=document.getElementById('papyrus-texte');
  const tts=document.getElementById('tts-player');
  const bgm=document.getElementById('musique-sacree');

  // État
  try{ localStorage.removeItem('mode'); }catch(_){}
  let mode=null, talking=false;

  if(bgm) bgm.volume=0.22;

  function showPap(text, ms){
    pap.style.display='block';
    ptxt.textContent=text || '';
    const d = ms || Math.max(2000, (text||'').length*40);
    setTimeout(()=>{ pap.style.display='none'; ptxt.textContent=''; }, d);
  }

  // --- [MODE_OVERLAY_PROTOCOL_FINAL] ---
  const overlayAPI = {
    open(block=false){
      overlay.classList.remove('overlay-hidden');
      overlay.setAttribute('aria-hidden','false');
      if(block){ input.disabled=true; btnGo.disabled=true; }
    },
    close(){
      overlay.classList.add('overlay-hidden');
      overlay.setAttribute('aria-hidden','true');
    }
  };

  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    try{ bgm && bgm.play().catch(()=>{}); }catch{}
    overlayAPI.open(true);     // on force le choix d’un mode au début
    btnOpen.style.display='none';
  });

  btnMode?.addEventListener('click', ()=> overlayAPI.open(false));

  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click', ()=>{
      mode = b.getAttribute('data-mode');
      try{ localStorage.setItem('mode', mode); }catch(_){}
      input.disabled=false; btnGo.disabled=false;
      overlayAPI.close();
    });
  });

  document.addEventListener('keydown', (e)=>{
    if(e.key==='Escape' && !overlay.classList.contains('overlay-hidden')) overlayAPI.close();
  });

  // Start/Stop même bouton (Invocation)
  if(tts){
    tts.addEventListener('play', ()=>{ talking=true; });
    tts.addEventListener('pause',()=>{ talking=false; });
    tts.addEventListener('ended',()=>{ talking=false; });
  }

  async function invoquer(e){
    e && e.preventDefault();
    if(talking){ tts.pause(); tts.currentTime=0; talking=false; return; }
    const prompt=(input.value||'').trim();
    if(!prompt) return;
    if(!mode){ overlayAPI.open(false); return; } // garde-fou

    btnGo.classList.add('active');
    try{
      const r=await fetch('/invoquer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,mode})});
      const data=await r.json();
      const rep=data?.reponse || '(Silence sacré)';
      showPap(rep);
      if(data?.audio_url){ tts.src=data.audio_url+'?t='+Date.now(); tts.play().catch(()=>{}); }
    }catch{ showPap('𓂀 Erreur de communication.'); }
    btnGo.classList.remove('active');
    input.value='';
  }
  btnGo?.addEventListener('click', invoquer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') invoquer(e); });

  // Souffle sacré (homme + fragments dataset)
  btnSouffle?.addEventListener('click', async ()=>{
    if(!mode){ overlayAPI.open(false); return; }
    try{
      const r=await fetch('/invoquer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'souffle sacré',mode})});
      const data=await r.json();
      const rep=data?.reponse || '(Souffle silencieux)';
      showPap(rep);
      if(data?.audio_url){ tts.src=data.audio_url+'?t='+Date.now(); tts.play().catch(()=>{}); }
    }catch{ showPap('𓂀 Erreur de communication.'); }
  });

  // Mode vocal (si supporté)
  btnVocal?.addEventListener('click', ()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){ showPap('Micro non supporté.'); return; }
    const rec=new SR(); rec.lang='fr-FR'; rec.interimResults=false; rec.continuous=false;
    rec.onresult=(e)=>{ const t=e.results?.[0]?.[0]?.transcript||''; if(t){ input.value=t; btnGo.click(); } };
    try{ rec.start(); }catch{}
  });
});
