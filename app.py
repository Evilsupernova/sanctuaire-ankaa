# Sanctuaire Ankaa v12.4 — RAG stable + TTS + multi-fragments + interprétation sacrée
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
MODES = {m: {"mem": MEM / f"memoire_{m}.json"} for m in VOIX_FEMME}

EMOJI_RE = re.compile(r"[🌒🌑🌘✨☥𓂀]", re.UNICODE)
def strip_emojis(s): return EMOJI_RE.sub(" ", s or "")
def _clean(s): return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip()
def _norm(s):
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]", " ", s).strip()
def _tok(s): return [t for t in _norm(s).split() if len(t) > 2]

STOP_FR = set("au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont".split())

FRAGS, DF, N = [], Counter(), 0
def _split(txt, name):
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?<=[.!?…])\s+", txt) if p.strip()]
    out, buf, cnt = [], [], 0
    for p in parts:
        w = p.split()
        if cnt+len(w) < 80: buf.append(p); cnt += len(w); continue
        out.append(" ".join(buf+[p])); buf, cnt = [], 0
    rest = " ".join(buf).strip()
    if rest: out.append(rest)
    return [{"id": None, "file": name, "text": c} for c in out if len(c.split()) >= 50]

def build_index():
    global FRAGS, DF, N
    FRAGS, DF, N = [], Counter(), 0
    if not DATASET.exists(): return
    for p in DATASET.glob("*.txt"):
        txt = p.read_text("utf-8", errors="ignore")
        for frag in _split(txt, p.name):
            toks = _tok(frag["text"])
            if not toks: continue
            d = {"id": len(FRAGS), "file": p.name, "text": frag["text"], "tokens": toks}
            FRAGS.append(d)
            for t in set(toks): DF[t] += 1
    N = len(FRAGS)

def _bm25(q):
    avgdl = sum(len(d["tokens"]) for d in FRAGS)/len(FRAGS)
    sc = defaultdict(float)
    for t in q:
        df = DF.get(t,0)
        if not df: continue
        idf = math.log(1+(N-df+0.5)/(df+0.5))
        for d in FRAGS:
            tf = d["tokens"].count(t)
            if not tf: continue
            denom = tf + 1.5*(1-0.75+0.75*len(d["tokens"])/avgdl)
            sc[d["id"]] += idf*((tf*2.5)/denom)
    return sorted(sc.items(), key=lambda x:x[1], reverse=True)

def retrieve(q, k=3):
    qt = [t for t in _tok(q) if t not in STOP_FR]
    if not qt or not FRAGS: return []
    ranked = _bm25(qt)
    out = []
    for did, sc in ranked[:k*3]:
        d = FRAGS[did]
        out.append({"id":d["id"],"file":d["file"],"text":d["text"]})
        if len(out) >= k: break
    return out

def join_consecutive(i, min_words=90, max_words=220):
    cur = FRAGS[i]; text = _clean(cur["text"]); words = len(text.split())
    j = i+1
    while words < min_words and j < len(FRAGS) and FRAGS[j]["file"] == cur["file"]:
        nxt = _clean(FRAGS[j]["text"]); text += " " + nxt; words = len(text.split()); j+=1
        if words >= max_words: break
    return text

def pick_multi_fragments(n=2): return [join_consecutive(random.randrange(0,len(FRAGS))) for _ in range(n)]

def interpret(hits):
    frags = [_clean(h["text"]) for h in hits]
    base = " ".join(frags)
    out = []
    if frags: out.append("« " + " ".join(frags[0].split()[:55])+"… »")
    if "amour" in base: out.append("Je lis un appel à l’amour libre et vrai.")
    if "souffle" in base: out.append("Je perçois un retour au souffle vivant.")
    if "fatigu" in base: out.append("Cela exprime la fatigue d’être performant et la soif de sens.")
    if "sacré" in base or "flamme" in base: out.append("Un réveil du sacré, une flamme intérieure.")
    out.append("Sens : retrouve le feu qui relie et donne vie.")
    return "\n".join(out)

def compose_answer(user, mode):
    hits = retrieve(user, k=3)
    if not hits: return None
    intro = "Dans tes écrits, voici ce qui se lève :" if mode=="sentinelle8" else "Dans ce passage, voici ce qui se lève :"
    return intro + "\n" + interpret(hits)

def answer(user, mode):
    if _norm(user) == "souffle sacre":
        multi = pick_multi_fragments(2)
        return "Souffle sacré :\n" + "\n\n".join(multi)
    composed = compose_answer(user, mode)
    return composed or "Parle-moi, et je descends dans le Verbe."

def strip_tts(txt): return strip_emojis(txt)

def split_sentences(text): return [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]

def _tts_edge(text, voice, rate, pitch, out_file):
    if edge_tts is None: return "disabled"
    loop=asyncio.new_event_loop(); asyncio.set_event_loop(loop)
    loop.run_until_complete(edge_tts.Communicate(strip_tts(text), voice=voice, rate=rate, pitch=pitch).save(str(out_file)))
    loop.close()
    return "ok" if out_file.exists() else "error"

def do_tts(text, mode, souffle, out_file):
    voice = VOIX_HOMME[mode] if souffle else VOIX_FEMME[mode]
    return _tts_edge(text, voice, "+2%", "default", out_file)

def cleanup_old_tts():
    for f in AUDIO.glob("anka_tts_*.mp3"):
        try: f.unlink()
        except: pass

@app.route("/")
def index(): return render_template("index.html")

@app.route("/diag")
def diag(): return jsonify({"fragments": len(FRAGS)})

@app.route("/invoquer", methods=["POST"])
def invoquer():
    data=request.get_json(force=True) or {}
    mode=(data.get("mode") or "sentinelle8").lower()
    prompt=data.get("prompt") or ""
    souffle=(_norm(prompt)=="souffle sacre")

    rep=answer(prompt, mode)
    cleanup_old_tts()
    segs = split_sentences(rep)
    out_list=[]
    for i, seg in enumerate(segs):
        out=AUDIO/f"anka_tts_{i}.mp3"
        st=do_tts(seg, mode, souffle, out)
        out_list.append({"text": seg, "audio_url": f"/static/assets/{out.name}" if st=="ok" else None})
    return jsonify({"segments": out_list})

build_index()
if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT",5000)), debug=True)
