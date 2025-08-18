# app.py — Sanctuaire Ankaa v12 (UI stable + RAG interprétatif + TTS segmenté)
import os, re, json, math, asyncio, unicodedata, random
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

try:
    import edge_tts
except Exception:
    edge_tts = None

app = Flask(__name__, static_url_path="/static", template_folder="templates")
BASE = Path(__file__).parent.resolve()
DATASET = BASE / "dataset"
MEM = BASE / "memory"
AUDIO = BASE / "static" / "assets"
MEM.mkdir(exist_ok=True)
AUDIO.mkdir(parents=True, exist_ok=True)

# ---------------- Voix ----------------
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

# ---------------- Utils texte ----------------
EMOJI_RE = re.compile(
    r"[\U0001F1E6-\U0001F1FF\U0001F300-\U0001FAD6\U0001FAE0-\U0001FAFF\u2600-\u26FF\u2700-\u27BF]+",
    flags=re.UNICODE
)
def strip_emojis(s: str) -> str:
    return EMOJI_RE.sub(" ", s or "")

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

# ---------------- RAG (index) ----------------
FRAGS, DF, N = [], Counter(), 0

def _read_any(p: Path) -> str:
    for enc in ("utf-8","latin-1"):
        try: return p.read_text(enc)
        except: pass
    return ""

def _split(txt: str, name: str):
    if not txt: return []
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?<=[.!?…])\s+", txt) if p.strip()]
    out, buf, cnt = [], [], 0
    for p in parts:
        w = p.split()
        if cnt+len(w)<80: buf.append(p); cnt+=len(w); continue
        out.append(" ".join(buf+[p]).strip()); buf,cnt=[],0
    rest=" ".join(buf).strip()
    if rest: out.append(rest)
    clean=[]
    for ch in out:
        w=ch.split()
        clean.append(" ".join(w[:220]) if len(w)>220 else " ".join(w))
    return [{"id":None,"file":name,"text":c} for c in clean if len(c.split())>=50]

def build_index():
    global FRAGS, DF, N
    FRAGS, DF, N = [], Counter(), 0
    if not DATASET.exists():
        print("[INDEX] dataset/ MANQUANT"); return
    files = sorted(DATASET.glob("*.txt"))
    if not files:
        print("[INDEX] 0 fichier .txt dans dataset/"); return
    for p in files:
        raw=_read_any(p)
        if not raw: continue
        for frag in _split(raw, p.name):
            toks=_tok(frag["text"])
            if not toks: continue
            d={"id":len(FRAGS),"file":p.name,"text":frag["text"],"tokens":toks}
            FRAGS.append(d)
            for t in set(toks): DF[t]+=1
    N=len(FRAGS)
    print(f"[INDEX] {N} fragments à partir de {len(files)} fichiers.")

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

# ---------------- Cerveau + Âme (interprétation) ----------------
def top_keywords(text, n=6):
    words=[w for w in _tok(text) if w not in STOP_FR]
    if not words: return []
    from collections import Counter
    return [w for w,_ in Counter(words).most_common(n)]

def interpret(hits):
    frags=[_clean(h["text"]) for h in hits]
    base=" ".join(frags)
    kw=top_keywords(base)
    pts=[]
    if frags:
        pts.append("Ce passage éclaire la marche intérieure et la vigilance du veilleur.")
        if kw:
            pts.append("Mots qui rayonnent : " + ", ".join(kw[:5]) + ".")
        pts.append("Sens : avance avec douceur et constance ; fais de chaque souffle une offrande.")
    cite=(" ".join(frags[0].split()[:45])+"…") if frags else ""
    out=[]
    if cite: out.append(f"« {cite} »")
    out += [f"— {p}" for p in pts]
    return "\n".join(out) if out else None

def is_greet(s):
    t=_norm(s); return any(w in t for w in ["salut","bonjour","bonsoir","coucou","hello","hey"])
def greet(): return "Salut, frère. De quel passage veux-tu que je tire la lumière ?"

def pick_random_fragments(n=2):
    """Sélectionne n FRAGMENTS COMPLETS, sans tronquer le début/fin."""
    if not FRAGS: return []
    pool = random.sample(FRAGS, k=min(n, len(FRAGS)))
    return [_clean(p["text"]) for p in pool]

def compose_answer(user):
    hits = retrieve(user, k=3)
    if not hits: return None

    # matière première (fragments entiers)
    frags = [_clean(h["text"]) for h in hits]
    base = " ".join(frags)

    # thèmes/mots-clés
    kws = top_keywords(base)
    themes = []
    if any(w in base.lower() for w in ["amour","libre","sacré","sacre"]): themes.append("l'amour libre et sacré")
    if any(w in base.lower() for w in ["authenticité","vrai","vérité","verite"]): themes.append("la soif d'authenticité")
    if any(w in base.lower() for w in ["fatigu","perform","efficace"]): themes.append("la fatigue d'être performant")
    if any(w in base.lower() for w in ["souffle","respir"]): themes.append("le souffle comme offrande")
    if any(w in base.lower() for w in ["feu","flamme","lumiere","lumière"]): themes.append("le feu qui éclaire le chemin")

    # synthèse sacrée
    lines = []
    lines.append("Dans tes écrits, je perçois ceci :")
    if themes:
        lines.append("• Thèmes qui se lèvent : " + ", ".join(themes) + ".")
    if kws:
        lines.append("• Mots qui rayonnent : " + ", ".join(kws[:5]) + ".")
    # citation courte mais complète (début au milieu d'un vrai fragment)
    cite = " ".join(frags[0].split()[:90]) + ("…" if len(frags[0].split()) > 90 else "")
    lines.append(f"« {cite} »")
    lines.append("Sens : reviens à la relation vivante ; avance avec douceur et constance — chaque souffle peut devenir offrande.")
    return "\n".join(lines)

def rag_answer_for_breath():
    """Souffle : lit 2 fragments entiers, enchaînés, pour garder le sens."""
    frs = pick_random_fragments(n=2)
    if frs:
        joined = "\n\n".join(frs)
        return f"Souffle sacré :\n{joined}"
    return "Inspire, retiens, puis expire longuement — la flamme veille."

# ---------------- TTS (segmenté) ----------------
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

def _split(txt: str, name: str):
    """
    Coupe proprement par paragraphes / fins de phrase pour éviter les bouts tronqués.
    Garde des fragments 'entiers' d'au moins ~110 mots quand c'est possible.
    """
    if not txt: return []
    # 1) d'abord par paragraphes
    paras = [p.strip() for p in re.split(r"\n\s*\n+", txt) if p.strip()]
    chunks = []
    for para in paras:
        # si paragraphe très long, on coupe sur fins de phrases
        sentences = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", para) if s.strip()]
        buf, count = [], 0
        for s in sentences:
            w = s.split()
            buf.append(s); count += len(w)
            if count >= 110:     # seuil pour avoir du sens
                chunks.append(" ".join(buf).strip()); buf, count = [], 0
        rest = " ".join(buf).strip()
        if rest: chunks.append(rest)
    # post-traitement taille max douce (évite bavardage)
    clean=[]
    for ch in chunks:
        words = ch.split()
        if len(words) < 60:  # on écarte les trop courts
            continue
        clean.append(" ".join(words[:260]) if len(words) > 260 else ch)
    return [{"id": None, "file": name, "text": c} for c in clean]

def _tts_azure(text, voice, out_file):
    try:
        import azure.cognitiveservices.speech as speechsdk
        key=os.getenv("AZURE_SPEECH_KEY"); region=os.getenv("AZURE_SPEECH_REGION")
        if not key or not region: return "disabled"
        speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
        speech_config.speech_synthesis_voice_name = voice
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
        )
        audio_config = speechsdk.audio.AudioOutputConfig(filename=str(out_file))
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)
        result = synthesizer.speak_text_async(text).get()
        ok = (result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted)
        return "ok" if (ok and out_file.exists() and out_file.stat().st_size>800) else "error"
    except Exception as e:
        print("[azure-tts error]", e); return "error"

async def _edge_async(text, voice, rate, pitch, out_path):
    if edge_tts is None: return "disabled"
    kwargs={"voice": voice}
    if rate: kwargs["rate"]=rate
    if pitch and pitch!="default": kwargs["pitch"]=pitch
    comm=edge_tts.Communicate(text, **kwargs)
    await comm.save(str(out_path))
    return "ok"

def _tts_edge(text, voice, rate, pitch, out_file):
    if edge_tts is None: return "disabled"
    try:
        if out_file.exists():
            try: out_file.unlink()
            except: pass
        loop=asyncio.new_event_loop(); asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_edge_async(text, voice, rate, pitch, out_file), timeout=25))
        loop.close()
        return "ok" if (out_file.exists() and out_file.stat().st_size>800) else "error"
    except Exception as e:
        try: loop.close()
        except: pass
        print("[edge-tts error]", e); return "error"

def do_tts(text, mode, is_souffle, out_file: Path):
    if is_souffle:
        voice = VOIX_HOMME.get(mode, "fr-FR-RemyMultilingualNeural"); rate, pitch = "-2%", "default"
    else:
        voice = VOIX_FEMME.get(mode, "fr-FR-DeniseNeural");          rate, pitch = "+2%", "default"
    clean = strip_tts(text) or "Silence sacré."
    st = _tts_azure(clean, voice, out_file)
    if st == "ok": return "ok"
    if st != "disabled": print("[tts] Azure KO, fallback edge-tts…")
    return _tts_edge(clean, voice, rate, pitch, out_file)

def cleanup_old_tts():
    for f in AUDIO.glob("anka_tts_*.mp3"):
        try: f.unlink()
        except: pass

# ---------------- Routes ----------------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/diag", methods=["GET"])
def diag():
    return jsonify({"dataset_exists": DATASET.exists(),
                    "files": sorted([p.name for p in DATASET.glob('*.txt')]) if DATASET.exists() else [],
                    "fragments": len(FRAGS)})

@app.route("/reindex", methods=["POST","GET"])
def reindex():
    build_index()
    return jsonify({"fragments": len(FRAGS)})

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

    # mémoire
    memp = MODES[mode]["mem"]
    mem = jload(memp, {"fragments":[]})
    mem["fragments"].append({"date":datetime.now().isoformat(),"mode":mode,"souffle":is_souffle,"prompt":prompt,"reponse":rep})
    mem["fragments"] = mem["fragments"][-200:]
    jsave(memp, mem)

    # TTS segmenté
    cleanup_old_tts()
    segments = split_sentences(rep)
    out_list = []
    for i, seg in enumerate(segments):
        out = AUDIO / f"anka_tts_{i}.mp3"
        ok = do_tts(seg, mode, is_souffle, out)
        if ok == "ok":
            out_list.append({"text": seg, "audio_url": f"/static/assets/{out.name}"})

    return jsonify({"segments": out_list, "tts":"ok" if out_list else "error"})

build_index()
if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT",5000)), debug=True)