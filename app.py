# app.py — Sanctuaire Ankaa V10.2
import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from threading import Lock
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

try:
    import edge_tts
except Exception:
    edge_tts = None

app = Flask(__name__, static_url_path="/static")
LOCK = Lock()

BASE = Path(__file__).parent.resolve()
DATASET = BASE / "dataset"
MEMORY = BASE / "memory"
AUDIO = BASE / "static" / "assets"
MEMORY.mkdir(exist_ok=True)
AUDIO.mkdir(parents=True, exist_ok=True)

# ----- Modes -----
VOIX_FEMME = {
    "sentinelle8": "fr-FR-DeniseNeural",
    "dragosly23": "fr-CA-SylvieNeural",
    "invite": "fr-FR-VivienneMultilingualNeural",
    "verbe": "fr-FR-BrigitteMultilingualNeural",
}
VOIX_HOMME = {
    "sentinelle8": "fr-FR-RemyMultilingualNeural",
    "dragosly23": "fr-CA-JeanNeural",
    "invite": "fr-FR-HenriNeural",
    "verbe": "fr-FR-AntoineNeural",
}
MODES = {m: {"mem": MEMORY / f"memoire_{m}.json"} for m in VOIX_FEMME}

# ----- utils -----
def _clean(s): return re.sub(r"\s+"," ", (s or "").replace("\n"," ")).strip()

def load_json(p, d): 
    try: return json.loads(Path(p).read_text("utf-8")) if Path(p).exists() else d
    except: return d
def save_json(p, x): Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2), encoding="utf-8")

def _norm(s): return re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]"," ",unicodedata.normalize("NFD",(s or "").lower()))
def _tok(s): return [t for t in _norm(s).split() if len(t)>2]
STOP_FR=set("au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y".split())

# ----- dataset BM25 -----
FRAGS, DF, N=[],Counter(),0
def build_index():
    global FRAGS, DF, N
    if not DATASET.exists(): return
    for p in DATASET.glob("*.txt"):
        raw=p.read_text("utf-8",errors="ignore")
        parts=[x for x in re.split(r"\n\s*\n|[.!?…]\s+", raw) if len(x.split())>20]
        for frag in parts:
            toks=_tok(frag)
            if not toks: continue
            d={"id":len(FRAGS),"text":frag,"tokens":toks}
            FRAGS.append(d)
            for t in set(toks): DF[t]+=1
    N=len(FRAGS)
build_index()
def _bm25(q): 
    sc=defaultdict(float); avgdl=sum(len(d["tokens"]) for d in FRAGS)/max(1,len(FRAGS))
    for t in q:
        df=DF.get(t,0); 
        if not df: continue
        idf=math.log(1+(N-df+0.5)/(df+0.5))
        for d in FRAGS:
            tf=d["tokens"].count(t)
            if not tf: continue
            sc[d["id"]]+=idf*(tf*2.5)/(tf+1.5*(1+0.75*(len(d["tokens"])/avgdl)))
    return sorted(sc.items(), key=lambda x:x[1], reverse=True)
def retrieve(q): 
    toks=[t for t in _tok(q) if t not in STOP_FR]
    if not toks: return []
    ranked=_bm25(toks)
    return [FRAGS[i]["text"] for i,_ in ranked[:3]]

# ----- answer -----
def answer(prompt, is_souffle=False):
    if _norm(prompt) in ["salut","bonjour","bonsoir"]: return "Salut, frère 🌙. Je t’écoute."
    if is_souffle:
        base="\n".join("• "+t[:100]+"…" for t in retrieve("souffle paix méditation"))
        return f"{base}\n\n— Respire, je suis là."
    else:
        base="\n".join("• "+t[:100]+"…" for t in retrieve(prompt))
        return base or "Parle-moi mieux, frère, je t’écoute."

# ----- TTS -----
async def _tts_async(ssml, voice, out): 
    comm=edge_tts.Communicate(ssml, voice=voice, ssml=True); await comm.save(str(out))
def do_tts(txt, voice, out):
    if edge_tts is None: return "disabled"
    ssml=f"<speak>{_clean(txt)}</speak>"
    loop=asyncio.new_event_loop(); asyncio.set_event_loop(loop)
    loop.run_until_complete(_tts_async(ssml, voice, out)); loop.close()
    return "ok" if out.exists() else "error"

# ----- routes -----
@app.route("/")
def index(): return render_template("index.html")

@app.route("/invoquer", methods=["POST"])
def invoquer():
    d=request.get_json(force=True) or {}
    mode=d.get("mode","sentinelle8")
    txt=d.get("prompt","")
    is_souffle=_norm(txt)=="souffle sacre"
    rep=answer(txt,is_souffle)

    memp=MODES[mode]["mem"]; mem=load_json(memp,{"fragments":[]})
    mem["fragments"].append({"date":datetime.now().isoformat(),"prompt":txt,"reponse":rep})
    mem["fragments"]=mem["fragments"][-200:]; save_json(memp,mem)

    voice=VOIX_HOMME[mode] if is_souffle else VOIX_FEMME[mode]
    out=AUDIO/"anka_tts.mp3"; status=do_tts(rep,voice,out)
    return jsonify({"reponse":rep,"audio_url":f"/static/assets/{out.name}" if status=="ok" else None})

if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT",5000)),debug=True)
