// Sanctuaire Ankaa — V10 UI fix : outils empilés, audio iOS, RAG FR
document.addEventListener('DOMContentLoaded', () => {
  // ----- viewport iOS fiable -----
  function setVh(){ const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', `${vh/100}px`); }
  setVh(); window.addEventListener('resize', setVh);
  window.visualViewport && window.visualViewport.addEventListener('resize', setVh);

  // ----- déverrouillage audio iOS au 1er tap -----
  (function unlockAudioOnce(){
    const bgm=document.getElementById('musique-sacree'), tts=document.getElementById('tts-player');
    const sfx=[document.getElementById('s-click'),document.getElementById('s-open'),
               document.getElementById('s-close'),document.getElementById('s-mode')];
    function arm(){
      const poke=a=>{ if(!a) return; a.muted=true; const p=a.play(); if(p&&p.finally) p.finally(()=>{a.pause();a.muted=false;}); };
      [bgm,tts,...sfx].forEach(poke);
      window.removeEventListener('touchstart',arm,{passive:true});
      window.removeEventListener('click',arm,{passive:true});
    }
    window.addEventListener('touchstart',arm,{once:true,passive:true});
    window.addEventListener('click',arm,{once:true,passive:true});
  })();

  // ----- refs -----
  try{ localStorage.removeItem('mode'); }catch(_){}
  const input=document.getElementById('verbe'), btnGo=document.getElementById('btn-verbe');
  const zone=document.getElementById('zone-invocation');
  const btnOpen=document.getElementById('bouton-sanctuaire');
  const btnMini=document.getElementById('btn-mode-mini');
  const btnVeil=document.getElementById('btn-veille-mini');
  const tts=document.getElementById('tts-player');
  const bgm=document.getElementById('musique-sacree');
  const sClick=document.getElementById('s-click'), sOpen=document.getElementById('s-open'),
        sClose=document.getElementById('s-close'), sMode=document.getElementById('s-mode');
  const eye=document.querySelector('.oeil-centre'), aura=document.getElementById('aura-ankaa');
  const pap=document.getElementById('papyrus-zone'), ptxt=document.getElementById('papyrus-texte');
  const pts=document.getElementById('points-sacrés');
  const overlayEl=document.getElementById('mode-overlay');

  if(zone) zone.style.display='none';
  [btnGo,input].forEach(el=> el && (el.disabled=true));
  if(btnMini) btnMini.disabled=true;

  if(bgm) bgm.volume=0.22; [sClick,sOpen,sClose,sMode].forEach(a=>{ if(a) a.volume=0.30; });
  const safePlay=a=>{ if(!a) return; a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); };

  // Hauteur zone chat -> évite chevauchements
  function syncChatHeight(){
    const z=document.getElementById('zone-invocation'); if(!z) return;
    const h=Math.ceil(z.getBoundingClientRect().height||56);
    document.documentElement.style.setProperty('--chat-h', h+'px');
  }
  syncChatHeight();
  window.addEventListener('resize', syncChatHeight);
  window.visualViewport && window.visualViewport.addEventListener('resize', syncChatHeight);

  // Overlay
  const overlay={
    open({blockInput}={blockInput:false}){ overlayEl?.classList.remove('overlay-hidden');
      overlayEl?.setAttribute('aria-hidden','false');
      if(blockInput){ btnGo&&(btnGo.disabled=true); input&&(input.disabled=true); }
      safePlay(sOpen); },
    close(){ overlayEl?.classList.add('overlay-hidden');
      overlayEl?.setAttribute('aria-hidden','true'); safePlay(sClose); }
  };
  window.overlay=overlay;

  // OUVRIR SANCTUAIRE (même symbole ☥ que sélection mode, demandé)
  btnOpen?.addEventListener('click', ()=>{
    fetch('/activer-ankaa').catch(()=>{});
    safePlay(sOpen);
    if(zone) zone.style.display='grid';
    if(btnMini) btnMini.disabled=false;
    if(btnVeil) btnVeil.disabled=false;
    if(btnGo) btnGo.disabled=true;
    if(input) input.disabled=true;
    if(bgm) safePlay(bgm);
    overlay.open({blockInput:true});
    syncChatHeight();
  });

  // Sélection de mode
  function setMode(key){
    try{ localStorage.setItem('mode', key); }catch(_){}
    btnGo&&(btnGo.disabled=false); input&&(input.disabled=false);
    overlay.close(); safePlay(sMode);
  }
  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=>{
    b.addEventListener('click',()=> setMode(b.getAttribute('data-mode')));
  });
  btnMini?.addEventListener('click', ()=> overlay.open({blockInput:false}));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && overlayEl && !overlayEl.classList.contains('overlay-hidden')) overlay.close(); });

  // Visuel
  const wait=on=>{ if(!pts) return; pts.style.display = on ? 'block' : 'none'; };
  function playVisu(d){ if(eye) eye.classList.add('playing'); if(aura) aura.classList.add('active');
    setTimeout(()=>{eye?.classList.remove('playing'); aura?.classList.remove('active');}, Math.max(d,1200)); }
  function showPap(text,d){ if(!pap||!ptxt) return; pap.style.display='flex'; ptxt.textContent='';
    let i=0, L=text.length, step=Math.max(8,d/Math.max(1,L));
    (function loop(){ if(i<L){ ptxt.textContent+=text[i++]; setTimeout(loop,step);} })();
    setTimeout(()=>{ pap.style.display='none'; ptxt.textContent=''; }, Math.max(d+300,2000)); }

  // Envoi
  async function envoyer(e){
    e && e.preventDefault();
    const prompt=(input?.value||"").trim(); if(!prompt) return;
    const mode=localStorage.getItem('mode')||null;
    if(!mode){ overlay.open({blockInput:false}); return; }

    safePlay(sClick); wait(true); btnGo?.classList.add('active');
    try{
      const r=await fetch("/invoquer",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ prompt, mode })});
      const data=await r.json(); wait(false); btnGo?.classList.remove('active');
      const rep=data?.reponse||"(Silence sacré)";
      if(data?.audio_url && tts){
        tts.src=data.audio_url+"?t="+Date.now();
        tts.onloadedmetadata=function(){ const d=Math.max(1800,(tts.duration||2)*1000);
          playVisu(d); showPap(rep,d); safePlay(tts); };
      } else {
        const d=Math.max(2200, rep.length*42); playVisu(d); showPap(rep,d);
      }
    }catch(err){ wait(false); btnGo?.classList.remove('active'); showPap("𓂀 Ankaa : Erreur de communication."); }
    if(input) input.value="";
  }
  btnGo?.addEventListener('click', envoyer);
  input?.addEventListener('keypress', e=>{ if(e.key==='Enter') envoyer(e); });

  // Souffle (bouton empilé)
  let souffleLock=false, souffleTimer=null;
  btnVeil?.addEventListener('click', ()=>{
    if(btnVeil.classList.contains('active')){
      btnVeil.classList.remove('active'); clearInterval(souffleTimer); souffleTimer=null; safePlay(sClose);
    } else {
      btnVeil.classList.add('active'); lancerSouffle(); souffleTimer=setInterval(lancerSouffle, 30000); safePlay(sOpen);
    }
  });
  function lancerSouffle(){
    if(souffleLock) return; souffleLock=true;
    const mode=localStorage.getItem('mode')||"sentinelle8";
    fetch("/invoquer",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ prompt:"souffle sacré", mode })})
      .then(r=>r.json()).then(data=>{
        const rep=data?.reponse||"(Silence sacré)";
        if(data?.audio_url && tts){
          tts.src=data.audio_url+"?t="+Date.now();
          tts.onloadedmetadata=function(){ const d=Math.max(1800,(tts.duration||2)*1000);
            playVisu(d); showPap(rep,d); safePlay(tts); setTimeout(()=>souffleLock=false, d+400); };
        } else {
          const d=Math.max(2200, rep.length*42); playVisu(d); showPap(rep,d); setTimeout(()=>souffleLock=false, d+400);
        }
      })
      .catch(()=>{ showPap("𓂀 Ankaa : Erreur de communication."); souffleLock=false; });
  }
});
