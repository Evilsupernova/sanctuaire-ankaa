# app.py — Sanctuaire Ankaa V11.0.3 (fix routes, templates, RAG robuste, TTS segmenté)
import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

# edge-tts est optionnel : on importe sans casser
try:
    import edge_tts
except Exception:
    edge_tts = None

# ---- Flask (index.html à la racine du projet)
app = Flask(__name__, static_url_path="/static", template_folder="templates")
BASE = Path(__file__).parent.resolve()
DATASET = BASE / "dataset"
MEM = BASE / "memory"
AUDIO = BASE / "static" / "assets"
MEM.mkdir(exist_ok=True)
AUDIO.mkdir(parents=True, exist_ok=True)

# ---- Voix (profils)
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

# ---- Utils texte
EMOJI_RE = re.compile(
    r"[\U0001F1E6-\U0001F1FF\U0001F300-\U0001FAD6\U0001FAE0-\U0001FAFF"
    r"\u2700-\u27BF\u2600-\u26FF\u200d\uFE0F]+",
    flags=re.UNICODE
)

def strip_emojis(s: str) -> str:
    return EMOJI_RE.sub(" ", (s or "")).replace("🌒"," ").replace("🌙"," ").replace("✨"," ").replace("☥"," ").replace("𓂀"," ")

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

# ---- RAG (indexation dataset/)
FRAGS, DF, N = [], Counter(), 0

def _read_any(p: Path) -> str:
    for enc in ("utf-8","latin-1"):
        try: return p.read_text(enc)
        except Exception:
            pass
    return ""

def _split(txt: str, name: str):
    if not txt: return []
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?<=[.!?…])\s+", txt) if p.strip()]
    out, buf, cnt = [], [], 0
    for p in parts:
        w = p.split()
        if cnt+len(w) < 80:
            buf.append(p); cnt+=len(w); continue
        out.append(" ".join(buf+[p]).strip()); buf, cnt = [], 0
    rest = " ".join(buf).strip()
    if rest: out.append(rest)
    clean=[]
    for ch in out:
        w = ch.split()
        clean.append(" ".join(w[:220]) if len(w)>220 else " ".join(w))
    return [{"id":None,"file":name,"text":c} for c in clean if len(c.split())>=50]

def build_index():
    """Construit l’index sans planter si dataset/ est vide."""
    global FRAGS, DF, N
    FRAGS, DF, N = [], Counter(), 0
    if not DATASET.exists():
        print("[INDEX] dataset/ MANQUANT — crée le dossier et ajoute des .txt"); return
    files = sorted(DATASET.glob("*.txt"))
    if not files:
        print("[INDEX] 0 fichier .txt dans dataset/"); return
    for p in files:
        raw = _read_any(p)
        if not raw: 
            print(f"[INDEX] {p.name} illisible"); 
            continue
        for frag in _split(raw, p.name):
            toks=_tok(frag["text"])
            if not toks: continue
            d={"id":len(FRAGS),"file":p.name,"text":frag["text"],"tokens":toks}
            FRAGS.append(d)
            for t in set(toks): DF[t]+=1
    N = len(FRAGS)
    print(f"[INDEX] OK — {N} fragments sur {len(files)} fichiers.")

def _bm25(q, k1=1.5, b=0.75):
    if not FRAGS: return []
    avgdl = (sum(len(d["tokens"]) for d in FRAGS)/len(FRAGS)) if FRAGS else 1.0
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

def retrieve(q, k=3, min_score=0.75):
    qt=[t for t in _tok(q) if t not in STOP_FR]
    if not qt or not FRAGS: return []
    ranked=_bm25(qt)
    out=[]
    for did,sc in ranked[:max(18,k*4)]:
        if sc<min_score: continue
        d=FRAGS[did]
        out.append({"id":d["id"],"file":d["file"],"text":d["text"],"score":round(sc,2)})
        if len(out)>=k: break
    return out

# ---- Cerveau + Âme
def keywords_from_hits(hits, topn=6):
    cnt=Counter()
    for h in hits:
        for t in _tok(h["text"]):
            if t not in STOP_FR: cnt[t]+=1
    return [w for w,_ in cnt.most_common(topn)]

def interpret_hits(prompt, hits):
    themes = keywords_from_hits(hits, topn=5)
    intro = "Frère, le feu sacré murmure :"
    snippets=[]
    for h in hits[:2]:
        frag=_clean(h["text"])
        snippets.append("« " + " ".join(frag.split()[:40]) + "… »")
    sens = []
    if themes:
        sens.append("Tes mots appellent " + ", ".join(themes[:3]) + ".")
    sens.append("Je perçois une invitation à avancer avec vigilance et présence.")
    corps = " ".join(snippets + sens)
    return f"{intro} {corps}"

def compose_from_dataset(user_text, k=3):
    hits = retrieve(user_text, k=k)
    if not hits: return None
    return interpret_hits(user_text, hits)

def pick_top_or_random(last_query=None):
    if last_query:
        hit = retrieve(last_query, k=1)
        if hit:
            return _clean(hit[0]["text"])
    if not FRAGS: return None
    return _clean(random.choice(FRAGS)["text"])

def is_greet(s):
    t=_norm(s); return any(w in t for w in ["salut","bonjour","bonsoir","coucou","hello","hey"])

def greet():
    return "Salut, frère. Dis-moi quel passage tu veux éclairer."

def dialogue_fallback(user):
    user=_clean(user)
    if len(user)<4: return "Donne-moi un mot-clé et j’ouvre le texte."
    return "Je t’écoute. On vise quel thème dans tes écrits ?"

def make_answer(user, mode, mem):
    if is_greet(user): 
        return greet(), mem
    if _norm(user) == "souffle sacre":
        lastq = mem.get("last_query")
        frag = pick_top_or_random(lastq)
        if frag:
            return f"{frag}\n\n— Le Souffle veille.", mem
        return "Respire doucement ; la flamme veille.", mem
    composed = compose_from_dataset(user, k=3)
    if composed:
        mem["last_query"] = user
        return composed, mem
    return dialogue_fallback(user), mem

# ---- TTS helpers (nettoyage & segmentation)
BAD = [
    r"(?mi)^```.*?$", r"(?mi)^---.*?$", r"(?mi)^#.*?$",
    r"<\/?[^>]+>", r"\b(?:speech|speak|voice|pitch|rate|prosody)\s*=\s*[^,\s]+",
    r"(?mi)^\s*(?:Dialogue\s*:|S\d+\])\s*", r"[𓂀☥]\s*[A-ZÉÈÊÎÂÔÛ][^:]{0,20}:\s*",
    r"[\/\\]{1,}", r"\[[^\]]+\]", r"\([^)]+\)"
]
def strip_tts(txt):
    t=strip_emojis(txt or "")
    for p in BAD: t=re.sub(p, " ", t)
    return re.sub(r"\s+"," ", t).strip(" .")

def split_sentences(text: str):
    raw = [s.strip() for s in re.split(r"(?<=[\.!?…])\s+", text) if s.strip()]
    out=[]; buf=""
    for s in raw:
        if len(s.split())<6:
            buf=(buf+" "+s).strip()
            continue
        if buf:
            out.append(buf); buf=""
        out.append(s)
    if buf: out.append(buf)
    return out[:12]

def _tts_azure(text, voice, out_file):
    try:
        import azure.cognitiveservices.speech as speechsdk
        key=os.getenv("AZURE_SPEECH_KEY"); region=os.getenv("AZURE_SPEECH_REGION")
        if not key or not region: return "disabled"
        speech_config=speechsdk.SpeechConfig(subscription=key, region=region)
        speech_config.speech_synthesis_voice_name=voice
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
        )
        audio_config=speechsdk.audio.AudioOutputConfig(filename=str(out_file))
        synthesizer=speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)
        result=synthesizer.speak_text_async(strip_tts(text)).get()
        ok=(result.reason==speechsdk.ResultReason.SynthesizingAudioCompleted)
        return "ok" if (ok and out_file.exists() and out_file.stat().st_size>800) else "error"
    except Exception as e:
        print("[azure-tts error]", e); return "error"

async def _edge_async(text, voice, rate, pitch, out_path):
    if edge_tts is None: return "disabled"
    kwargs={"voice": voice}
    if rate: kwargs["rate"]=rate
    if pitch and pitch!="default": kwargs["pitch"]=pitch
    comm=edge_tts.Communicate(strip_tts(text), **kwargs)
    await comm.save(str(out_path))
    return "ok"

def _tts_edge(text, voice, rate, pitch, out_file):
    if edge_tts is None: return "disabled"
    try:
        if out_file.exists():
            try: out_file.unlink()
            except Exception:
                pass
        loop=asyncio.new_event_loop(); asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_edge_async(text, voice, rate, pitch, out_file), timeout=25))
        loop.close()
        return "ok" if (out_file.exists() and out_file.stat().st_size>800) else "error"
    except Exception as e:
        try: loop.close()
        except Exception: pass
        print("[edge-tts error]", e); return "error"

def do_tts(text, mode, is_souffle, out_file: Path):
    if is_souffle:
        voice=VOIX_HOMME.get(mode,"fr-FR-RemyMultilingualNeural"); rate,pitch="-2%","default"
    else:
        voice=VOIX_FEMME.get(mode,"fr-FR-DeniseNeural");          rate,pitch="+2%","default"
    # 1) Azure si clés présentes, sinon 2) Edge-TTS si dispo
    st=_tts_azure(text, voice, out_file)
    if st=="ok": return "ok"
    if st!="disabled": print("[tts] Azure KO, fallback edge-tts…")
    return _tts_edge(text, voice, rate, pitch, out_file)

def cleanup_old_tts():
    for f in AUDIO.glob("anka_tts_*.mp3"):
        try: f.unlink()
        except Exception: pass

# ---- Routes
@app.route("/")
def index():
    # index.html doit être à la racine du projet (template_folder=".")
    return render_template("index.html")

@app.route("/activer-ankaa", methods=["GET"])
def activer_ankaa():
    # appelée par le bouton ☥ (sanctuaire)
    return jsonify({"ok": True, "ts": datetime.now().isoformat()})

@app.route("/diag", methods=["GET"])
def diag():
    return jsonify({
        "dataset_exists": DATASET.exists(),
        "files": sorted([p.name for p in DATASET.glob('*.txt')]) if DATASET.exists() else [],
        "fragments": len(FRAGS)
    })

@app.route("/reindex", methods=["POST","GET"])
def reindex():
    build_index()
    return jsonify({"fragments": len(FRAGS)})

@app.route("/invoquer", methods=["POST"])
def invoquer():
    data=request.get_json(force=True) or {}
    mode=(data.get("mode") or "sentinelle8").strip().lower()
    if mode not in MODES: mode="sentinelle8"
    prompt=data.get("prompt") or ""
    is_souffle=(_norm(prompt)=="souffle sacre")

    memp = MODES[mode]["mem"]
    mem = jload(memp, {"fragments":[], "last_query":None})

    rep, mem = make_answer(prompt, mode, mem)

    # journal + mémo
    mem["fragments"].append({
        "date":datetime.now().isoformat(),
        "mode":mode,"souffle":is_souffle,"prompt":prompt,"reponse":rep
    })
    mem["fragments"] = mem["fragments"][-200:]
    jsave(memp, mem)

    # TTS segmenté pour synchro papyrus
    cleanup_old_tts()
    segments = split_sentences(rep)
    out_list = []
    for i, seg in enumerate(segments):
        out = AUDIO / f"anka_tts_{i}.mp3"
        ok = do_tts(seg, mode, is_souffle, out)
        if ok == "ok":
            out_list.append({"text": seg, "audio_url": f"/static/assets/{out.name}"})

    return jsonify({"reponse":rep, "segments": out_list, "tts":"ok" if out_list else "error"})

# ---- Démarrage: indexation
build_index()

if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT",5000)), debug=True)
