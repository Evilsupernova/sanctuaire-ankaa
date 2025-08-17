# app.py — Sanctuaire Ankaa (V10 stable + garde-fous + fix TTS)
import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

try:
    import edge_tts
except Exception:
    edge_tts = None

app = Flask(__name__, static_url_path="/static")
BASE = Path(__file__).parent.resolve()
DATASET = BASE / "dataset"
MEM = BASE / "memory"
AUDIO = BASE / "static" / "assets"
MEM.mkdir(exist_ok=True)
AUDIO.mkdir(parents=True, exist_ok=True)

# Voix : FEMME = invocation ; HOMME = souffle
VOIX_FEMME = {
    "sentinelle8": "fr-FR-DeniseNeural",
    "dragosly23":  "fr-CA-SylvieNeural",
    "invite":      "fr-FR-VivienneMultilingualNeural",
    "verbe":       "fr-FR-BrigitteMultilingualNeural",
}
VOIX_HOMME = {
    "sentinelle8": "fr-FR-RemyMultilingualNeural",
    "dragosly23":  "fr-CA-JeanNeural",
    "invite":      "fr-FR-HenriNeural",
    "verbe":       "fr-FR-AntoineNeural",
}
MODES = {m: {"mem": MEM / f"memoire_{m}.json"} for m in VOIX_FEMME}

def _clean(s):
    if not s: return ""
    s = s.replace("\u200b","").replace("\ufeff","")
    return re.sub(r"\s+"," ", s.replace("\n"," ")).strip()

def _norm(s):
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]"," ", s)
    return re.sub(r"\s+"," ", s).strip()

def _tok(s): return [t for t in _norm(s).split() if len(t)>2]

STOP_FR = set("au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont".split())

def jload(p, d):
    try: return json.loads(Path(p).read_text("utf-8")) if Path(p).exists() else d
    except: return d
def jsave(p, x): Path(p).write_text(json.dumps(x, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------- RAG pour SOUFFLE ----------
FRAGS, DF, N = [], Counter(), 0
def _read_any(p):
    for enc in ("utf-8","latin-1"):
        try: return p.read_text(enc)
        except: pass
    return ""
def _split(txt, name):
    if not txt: return []
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?:[.!?…]\s+)", txt) if p.strip()]
    out, buf, cnt = [], [], 0
    for p in parts:
        w = p.split()
        if cnt+len(w)<80: buf.append(p); cnt+=len(w); continue
        chunk=" ".join(buf+[p]).strip()
        if chunk: out.append(chunk)
        buf,cnt=[],0
    rest=" ".join(buf).strip()
    if rest: out.append(rest)
    clean=[]
    for ch in out:
        w=ch.split()
        clean.append(" ".join(w[:200]) if len(w)>200 else " ".join(w))
    return [{"file":name,"text":c} for c in clean if len(c.split())>=60]
def build_index():
    global FRAGS, DF, N
    FRAGS, DF, N = [], Counter(), 0
    if not DATASET.exists():
        print("[INDEX] dataset/ manquant"); return
    for p in sorted(DATASET.glob("*.txt")):
        raw=_read_any(p)
        if not raw: continue
        for frag in _split(raw, p.name):
            toks=_tok(frag["text"])
            if not toks: continue
            d={"id":len(FRAGS),"file":p.name,"text":frag["text"],"tokens":toks}
            FRAGS.append(d)
            for t in set(toks): DF[t]+=1
    N=len(FRAGS); print(f"[INDEX] {N} fragments.")
def _bm25(q, k1=1.5, b=0.75):
    if not FRAGS: return []
    avgdl=sum(len(d["tokens"]) for d in FRAGS)/len(FRAGS)
    sc=defaultdict(float)
    for t in q:
        df=DF.get(t,0)
        if not df: continue
        idf=math.log(1+(N-df+0.5)/(df+0.5))
        for d in FRAGS:
            tf=d["tokens"].count(t)
            if not tf: continue
            denom=tf + k1*(1 - b + b*(len(d["tokens"])/avgdl))
            sc[d["id"]] += idf*((tf*(k1+1))/denom)
    return sorted(sc.items(), key=lambda x:x[1], reverse=True)
def retrieve(q, k=3, min_score=1.02):
    qt=[t for t in _tok(q) if t not in STOP_FR]
    if not qt or not FRAGS: return []
    ranked=_bm25(qt)
    out=[]
    for did,sc in ranked[:max(12,k*3)]:
        if sc<min_score: continue
        d=FRAGS[did]
        out.append({"file":d["file"],"text":d["text"],"score":round(sc,2)})
        if len(out)>=k: break
    return out
build_index()

# ---------- Génération de réponse ----------
def is_greet(s):
    t=_norm(s); return any(w in t for w in ["salut","bonjour","bonsoir","coucou","hello","hey"])
def greet(): return "Salut, frère 🌙. Je t’écoute — qu’est-ce qu’on éclaire ?"

def rag_answer(u):
    src=retrieve(u, k=3)
    if not src: return "Je n’ai rien de net dans les écrits. Donne-moi un indice précis et je fouille mieux."
    return "\n".join([f"• {' '.join(_clean(s['text']).split()[:80])}…" for s in src])

def dialogue_answer(user):
    user = _clean(user)
    if len(user) < 4:
        return "Dis-m’en un peu plus et je te réponds franchement."
    lead = random.choice(["Je comprends.","D’accord.","Je te suis.","Je vois."])
    ask  = random.choice([
        "Qu’est-ce qui compte le plus pour toi là-dedans ?",
        "Tu veux qu’on clarifie, ou qu’on passe direct à une action concrète ?",
        "Tu veux un plan en 3 étapes ?",
        "On commence par le plus simple, ou on vise le cœur du sujet ?"
    ])
    return f"{lead} {ask}"

def answer(user, mode):
    if is_greet(user): return greet()
    if _norm(user)=="souffle sacre":
        base=rag_answer("souffle méditation paix respiration calme")
        fin=random.choice(["— Respire, je suis là.","— Laisse la lumière s’asseoir dans le souffle.","— Reste doux avec toi, la flamme veille."])
        return f"{base}\n\n{fin}"
    return dialogue_answer(user)

# ---------- Anti-lecture TTS ----------
BAD = [
    r"(?mi)^```.*?$", r"(?mi)^---.*?$", r"(?mi)^#.*?$",
    r"<\/?[^>]+>", r"\b(?:speech|speak|voice|pitch|rate|prosody)\s*=\s*[^,\s]+",
    r"(?mi)^\s*(?:Dialogue\s*:|S\d+\])\s*", r"[𓂀☥]\s*[A-ZÉÈÊÎÂÔÛ][^:]{0,20}:\s*",
    r"[\/\\]{1,}", r"\[[^\]]+\]", r"\([^)]+\)"
]
def strip_tts(txt):
    t=txt or ""
    for p in BAD: t=re.sub(p, " ", t)
    return re.sub(r"\s+"," ", t).strip(" .")

# ---------- TTS edge-tts ----------
async def _tts_async(text, voice, rate, pitch, out_path: Path):
    if edge_tts is None: return "disabled"
    kwargs = {"voice": voice}
    if rate:  kwargs["rate"]  = rate
    if pitch and pitch != "default": kwargs["pitch"] = pitch
    comm = edge_tts.Communicate(text, **kwargs)
    await comm.save(str(out_path))
    return "ok"

def do_tts(text, mode, is_souffle, out_file: Path):
    if edge_tts is None:
        print("[TTS] edge-tts indisponible -> audio désactivé")
        return "disabled"
    try:
        if is_souffle:
            voice = VOIX_HOMME.get(mode, "fr-FR-RemyMultilingualNeural")
            rate, pitch = "-2%", "default"
        else:
            voice = VOIX_FEMME.get(mode, "fr-FR-DeniseNeural")
            rate, pitch = "+2%", "default"

        clean = strip_tts(text) or "Silence sacré."
        if out_file.exists():
            try: out_file.unlink()
            except: pass
        loop=asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_tts_async(clean, voice, rate, pitch, out_file), timeout=20))
        loop.close()
        return "ok" if (out_file.exists() and out_file.stat().st_size>800) else "error"
    except Exception as e:
        try: loop.close()
        except: pass
        print("[TTS error]", e)
        return "error"

# ---------- Routes ----------
@app.route("/")
def index():
    return render_template("index.html")

# Bouton sanctuaire (ping no-op pour logs/monitoring si besoin)
@app.route("/activer-ankaa", methods=["GET"])
def activer_ankaa():
    return jsonify({"ok": True, "ts": datetime.now().isoformat()})

@app.route("/invoquer", methods=["POST"])
def invoquer():
    data = request.get_json(force=True) or {}
    mode = (data.get("mode") or "sentinelle8").strip().lower()
    if mode not in MODES: mode="sentinelle8"
    prompt = data.get("prompt") or ""
    is_souffle = (_norm(prompt)=="souffle sacre")

    rep = answer(prompt, mode)

    memp = MODES[mode]["mem"]
    mem = jload(memp, {"fragments":[]})
    mem["fragments"].append({"date":datetime.now().isoformat(),"mode":mode,"souffle":is_souffle,"prompt":prompt,"reponse":rep})
    mem["fragments"] = mem["fragments"][-200:]
    jsave(memp, mem)

    out = AUDIO / "anka_tts.mp3"
    ok = do_tts(rep, mode, is_souffle, out)
    url = f"/static/assets/{out.name}" if ok=="ok" else None

    return jsonify({"reponse":rep, "audio_url":url, "tts":ok})

@app.route("/service-worker.js")
def sw():
    return app.send_static_file("service-worker.js")

if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT",5000)), debug=True)
