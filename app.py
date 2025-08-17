# app.py — Sanctuaire Ankaa (RAG dataset + TTS FR robuste + PWA)
import os, re, json, math, asyncio, unicodedata
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify

app = Flask(__name__, static_url_path="/static")
BASE_DIR    = Path(__file__).parent.resolve()
DATASET_DIR = BASE_DIR / "dataset"
MEMORY_DIR  = BASE_DIR / "memory"
AUDIO_DIR   = BASE_DIR / "static" / "assets"
MEMORY_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ---------- TTS (edge-tts) ----------
try:
    import edge_tts
except Exception:
    edge_tts = None

MODES = {
    "sentinelle8": {"voice": "fr-FR-VivienneMultilingualNeural", "mem": MEMORY_DIR / "memoire_sentinelle.json"},
    "dragosly23":  {"voice": "fr-CA-SylvieNeural",               "mem": MEMORY_DIR / "memoire_dragosly.json"},
    "invite":      {"voice": "fr-FR-DeniseNeural",               "mem": MEMORY_DIR / "memoire_invite.json"},
    "verbe":       {"voice": "fr-FR-RemyMultilingualNeural",     "mem": MEMORY_DIR / "memoire_verbe.json"},
}

# ---------- utils ----------
def _clean(s: str) -> str:
    if not s: return ""
    s = s.replace("\u200b","").replace("\ufeff","")
    return re.sub(r"\s+", " ", s.replace("\n"," ")).strip()

def _load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
    except Exception:
        return default

def _save_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------- normalisation FR ----------
def _norm(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _tok(s: str):
    return [t for t in _norm(s).split() if len(t) > 2]

STOP_FR = set("""
au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont était étaient serai serais serions seraient
""".strip().split())

# ---------- index RAG ----------
FRAGMENTS, DF, N_DOCS = [], Counter(), 0

def _read_any(p: Path) -> str:
    for enc in ("utf-8", "latin-1"):
        try: return p.read_text(encoding=enc)
        except Exception: pass
    return ""

def _split(txt: str, file_name: str):
    if not txt: return []
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?:[.!?…]\s+)", txt) if p.strip()]
    out, buf, cnt = [], [], 0
    for p in parts:
        w = p.split()
        if cnt + len(w) < 80:
            buf.append(p); cnt += len(w); continue
        chunk = " ".join(buf + [p]).strip()
        if chunk: out.append(chunk)
        buf, cnt = [], 0
    rest = " ".join(buf).strip()
    if rest: out.append(rest)
    clean = []
    for ch in out:
        words = ch.split()
        clean.append(" ".join(words[:200]) if len(words) > 200 else " ".join(words))
    return [{"file": file_name, "text": c} for c in clean if len(c.split()) >= 40]

def build_index():
    global FRAGMENTS, DF, N_DOCS
    FRAGMENTS, DF, N_DOCS = [], Counter(), 0
    if not DATASET_DIR.exists():
        print("[INDEX] dataset/ introuvable.")
        return
    for p in sorted(DATASET_DIR.glob("*.txt")):
        raw = _read_any(p)
        if not raw: continue
        for frag in _split(raw, p.name):
            toks = _tok(frag["text"])
            if not toks: continue
            doc = {"id": len(FRAGMENTS), "file": frag["file"], "text": frag["text"], "tokens": toks}
            FRAGMENTS.append(doc)
            for t in set(toks): DF[t] += 1
    N_DOCS = len(FRAGMENTS)
    print(f"[INDEX] {N_DOCS} fragments indexés, {len(list(DATASET_DIR.glob('*.txt')))} fichiers.")

def _bm25(qt, k1=1.5, b=0.75):
    if not FRAGMENTS: return []
    avgdl = sum(len(d["tokens"]) for d in FRAGMENTS)/len(FRAGMENTS)
    scores = defaultdict(float)
    for q in qt:
        df = DF.get(q, 0)
        if df == 0: continue
        idf = math.log(1 + (N_DOCS - df + 0.5)/(df + 0.5))
        for d in FRAGMENTS:
            tf = d["tokens"].count(q)
            if tf == 0: continue
            denom = tf + k1*(1 - b + b*(len(d["tokens"])/avgdl))
            scores[d["id"]] += idf * ((tf*(k1+1))/denom)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)

def retrieve(q: str, k: int = 4, min_score: float = 1.02):
    qt = [t for t in _tok(q) if t not in STOP_FR]
    if not qt or not FRAGMENTS: return []
    ranked = _bm25(qt)
    out = []
    for doc_id, sc in ranked[:max(12, k*3)]:
        if sc < min_score: continue
        d = FRAGMENTS[doc_id]
        out.append({"file": d["file"], "text": d["text"], "score": round(sc, 2)})
        if len(out) >= k: break
    return out

build_index()

def rag_answer_only(prompt: str, k: int = 4):
    src = retrieve(prompt, k=k, min_score=1.02)
    if not src:
        return ("Je n'ai rien trouvé de net dans les écrits. Donne-moi un indice précis et je fouille à nouveau.", [])
    lignes, sources = [], []
    for s in src:
        extrait = " ".join(_clean(s["text"]).split()[:80])
        lignes.append(f"• {extrait}…")
        sources.append({"file": s["file"], "score": s["score"]})
    return ("\n".join(lignes), sources)

# ---------- TTS robuste ----------
def _build_ssml(text: str, mode_key: str, voice: str) -> str:
    s = re.sub(r"\s+", " ", (text or "").strip())
    styles = {
        "sentinelle8": ("narration-relaxed", "+0%", "-1st"),
        "dragosly23":  ("chat",              "+4%", "+2st"),
        "invite":      ("empathetic",        "+2%", "+1st"),
        "verbe":       ("assistant",         "+0%", "+0st"),
    }
    style, rate, pitch = styles.get(mode_key, ("narration-relaxed", "+0%", "+0st"))
    return f"""
<speak version="1.0" xml:lang="fr-FR" xmlns:mstts="https://www.w3.org/2001/mstts">
  <voice name="{voice}">
    <mstts:express-as style="{style}" styledegree="1.0">
      <prosody rate="{rate}" pitch="{pitch}">
        <break time="200ms"/>{s}<break time="240ms"/>
      </prosody>
    </mstts:express-as>
  </voice>
</speak>
""".strip()

async def _tts_async(text: str, out_file: Path, mode_key: str, voice: str):
    comm = edge_tts.Communicate(_build_ssml(text, mode_key, voice), voice)
    await comm.save(str(out_file))

def synthesize_tts(text: str, out_file: Path, mode_key: str, voice: str, timeout_s: int = 12) -> str:
    if edge_tts is None: return "disabled"
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(asyncio.wait_for(_tts_async(text, out_file, mode_key, voice), timeout=timeout_s))
        loop.close()
        return "ok"
    except Exception as e:
        try:
            loop.close()
        except Exception:
            pass
        return f"error: {e}"

# ---------- Routes ----------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/invoquer", methods=["POST"])
def invoquer():
    data = request.get_json(force=True) or {}
    mode = (data.get("mode") or "sentinelle8").strip().lower()
    if mode not in MODES: mode = "sentinelle8"
    prompt = data.get("prompt") or ""

    reponse, sources = rag_answer_only(prompt, k=4)

    # mémoire (éphemere en Free)
    mem_path = MODES[mode]["mem"]
    mem = _load_json(mem_path, {"fragments": []})
    mem["fragments"].append({
        "date": datetime.now().isoformat(),
        "mode": mode, "prompt": prompt, "reponse": reponse, "sources": sources
    })
    mem["fragments"] = mem["fragments"][-200:]
    _save_json(mem_path, mem)

    # TTS
    audio_url, tts_status = None, "disabled"
    out_file = AUDIO_DIR / "derniere_voix.mp3"
    voice = MODES[mode]["voice"]
    tts_status = synthesize_tts(reponse, out_file, mode, voice)
    if tts_status == "ok" and out_file.exists():
        audio_url = f"/static/assets/{out_file.name}"

    return jsonify({"reponse": reponse, "audio_url": audio_url, "sources": sources, "tts": tts_status})

@app.route("/activer-ankaa")
def activer():
    return ("", 204)

@app.route("/service-worker.js")
def sw():
    return app.send_static_file("service-worker.js")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
