document.addEventListener('DOMContentLoaded', () => {
  const btnOpen=document.getElementById('bouton-sanctuaire');
  const btnMode=document.getElementById('btn-mode-mini');
  const btnVeil=document.getElementById('btn-veille-mini');
  const btnVocal=document.getElementById('btn-vocal');
  const input=document.getElementById('verbe');
  const btnGo=document.getElementById('btn-verbe');
  const zone=document.getElementById('zone-invocation');
  const tts=document.getElementById('tts-player');
  const bgm=document.getElementById('musique-sacree');
  const pap=document.getElementById('papyrus-zone');
  const ptxt=document.getElementById('papyrus-texte');

  const State={sanctuaire:false,mode:null,souffle:false,vocal:false,tts:false,souffleNext:null};

  if(bgm) bgm.volume=0.12;
  if(tts) tts.volume=1.0;
  tts?.addEventListener('play', ()=>{ if(bgm) bgm.volume=0.06; State.tts=true; State.vocal=false; });
  ['pause','ended'].forEach(ev=> tts?.addEventListener(ev, ()=>{ State.tts=false; if(bgm) bgm.volume=0.12; }));

  btnOpen?.addEventListener('click', ()=>{ State.sanctuaire=true; zone.style.display='grid'; btnOpen.style.display='none'; });
  btnMode?.addEventListener('click', ()=>{ document.getElementById('mode-overlay')?.classList.remove('overlay-hidden'); });

  function stopSpeaking(){ if(tts){ tts.pause(); tts.currentTime=0; } ptxt.textContent=''; pap.style.display='none'; }
  function stopSouffle(){ State.souffle=false; clearTimeout(State.souffleNext); }
  function stopVocal(){ State.vocal=false; }

  async function invokeServer(prompt){
    const mode=State.mode||"sentinelle8";
    const r=await fetch("/invoquer",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,mode})});
    const data=await r.json(); const segs=data?.segments||[];
    if(!segs.length) return;
    pap.style.display='flex'; ptxt.textContent='';
    for(const seg of segs){
      ptxt.textContent+=seg.text+" ";
      if(seg.audio_url){ tts.src=seg.audio_url+"?t="+Date.now(); await tts.play(); }
    }
  }

  async function send(){ if(!State.sanctuaire) return;
    stopSouffle(); stopVocal(); stopSpeaking();
    await invokeServer(input.value.trim()); input.value=""; }

  btnGo?.addEventListener('click', send);

  btnVeil?.addEventListener('click', ()=>{
    if(!State.sanctuaire) return;
    if(State.souffle){ stopSouffle(); stopSpeaking(); }
    else{ State.souffle=true; invokeServer("souffle sacré"); State.souffleNext=setTimeout(()=>{ if(State.souffle) invokeServer("souffle sacré"); },40000); }
  });

  btnVocal?.addEventListener('click', ()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR) return;
    const recog=new SR(); recog.lang="fr-FR";
    recog.onresult=e=>{ const txt=e.results[0][0].transcript; if(txt){ input.value=txt; send(); } };
    recog.start(); State.vocal=true;
    setTimeout(()=>{ try{recog.abort();}catch{}; State.vocal=false; },20000);
  });

  document.querySelectorAll('#mode-overlay .mode-option').forEach(b=> b.addEventListener('click', ()=>{ State.mode=b.dataset.mode; document.getElementById('mode-overlay')?.classList.add('overlay-hidden'); }));
});
