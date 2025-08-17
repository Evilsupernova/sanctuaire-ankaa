# app.py — Sanctuaire Ankaa (RAG dataset + TTS FR + sons)
import os, re, json, asyncio, math, unicodedata
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from flask import Flask, render_template, request, jsonify, send_from_directory

app = Flask(__name__, static_url_path="/static")
BASE_DIR    = Path(__file__).parent.resolve()
DATASET_DIR = BASE_DIR / "dataset"
MEMORY_DIR  = BASE_DIR / "memory"
AUDIO_DIR   = BASE_DIR / "static" / "assets"
MEMORY_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ----- TTS (optionnel : edge-tts) -----
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

# ---------- util ----------
def nettoyer(txt: str) -> str:
    if not txt: return ""
    txt = txt.replace("\u200b","")  # zero-width
    txt = txt.replace("\ufeff","")  # BOM
    return re.sub(r"\s+", " ", txt.replace("\n", " ")).strip()

def load_json(p: Path, default):
    try:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default

def save_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------- normalisation FR ----------
def _norm(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9àâäéèêëîïôöùûüç'\-\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _tokenize(s: str):
    return [t for t in _norm(s).split() if len(t) > 2]

STOPWORDS_FR = set("""
au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d l j m n s t c qu est suis es sommes êtes sont était étaient serai serais serions seraient
""".strip().split())

# ---------- Index dataset (BM25 simple) ----------
FRAGMENTS, DF, N_DOCS = [], Counter(), 0

def _read_text_any(p: Path) -> str:
    # lit en utf-8, sinon latin-1 (évite charabia)
    try:
        return p.read_text(encoding="utf-8")
    except Exception:
        try:
            return p.read_text(encoding="latin-1")
        except Exception:
            return ""

def _split_paragraphs(txt: str, file_name: str):
    if not txt: return []
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?:[.!?…]\s+)", txt) if p.strip()]
    out, buf, count = [], [], 0
    for p in parts:
        w = p.split()
        if count + len(w) < 80:
            buf.append(p); count += len(w); continue
        chunk = " ".join(buf+[p]).strip()
        if chunk: out.append(chunk)
        buf, count = [], 0
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
        raw = _read_text_any(p)
        if not raw: continue
        for frag in _split_paragraphs(raw, p.name):
            toks = _tokenize(frag["text"])
            if not toks: continue
            doc = {"id": len(FRAGMENTS), "file": frag["file"], "text": frag["text"], "tokens": toks}
            FRAGMENTS.append(doc)
            for t in set(toks):
                DF[t] += 1
    N_DOCS = len(FRAGMENTS)
    print(f"[INDEX] {N_DOCS} fragments indexés, {len(list(DATASET_DIR.glob('*.txt')))} fichiers.")

def _bm25_scores(query_tokens, k1=1.5, b=0.75):
    if not FRAGMENTS: return []
    avgdl = sum(len(d["tokens"]) for d in FRAGMENTS)/len(FRAGMENTS)
    scores = defaultdict(float)
    for q in query_tokens:
        df = DF.get(q, 0)
        if df == 0: continue
        idf = math.log(1 + (N_DOCS - df + 0.5)/(df + 0.5))
        for d in FRAGMENTS:
            tf = d["tokens"].count(q)
            if tf == 0: continue
            denom = tf + k1*(1 - b + b*(len(d["tokens"])/avgdl))
            scores[d["id"]] += idf * ((tf*(k1+1))/denom)
    return sorted(scores.items(), key=lambda x:x[1], reverse=True)

def retrieve_fragments(q: str, k: int = 4, min_score: float = 1.02):
    q_tokens = [t for t in _tokenize(q) if t not in STOPWORDS_FR]
    if not q_tokens or not FRAGMENTS: return []
    ranked = _bm25_scores(q_tokens)
    out = []
    for doc_id, sc in ranked[:max(12, k*3)]:
        if sc < min_score: continue
        d = FRAGMENTS[doc_id]
        out.append({"file": d["file"], "text": d["text"], "score": round(sc,2)})
        if len(out) >= k: break
    return out

build_index()

# ---------- RAG FR only ----------
def rag_answer_only(user_input: str, k: int = 4):
    src = retrieve_fragments(user_input, k=k, min_score=1.02)
    if not src:
        return ("Je n'ai rien trouvé de net dans les écrits. Donne-moi un indice précis et je fouille à nouveau.", [])
    lignes, sources = [], []
    for s in src:
        extrait = " ".join(nettoyer(s["text"]).split()[:80])
        lignes.append(f"• {extrait}…")
        sources.append({"file": s["file"], "score": s["score"]})
    return ("\n".join(lignes), sources)

# ---------- TTS ----------
def build_ssml(text: str, mode_key: str, voice: str) -> str:
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
        <break time="220ms"/>{s}<break time="280ms"/>
      </prosody>
    </mstts:express-as>
  </voice>
</speak>
""".strip()

async def synthese_tts(text: str, out_file: Path, mode_key: str, voice: str):
    if edge_tts is None:  # pas de TTS dispo
        return
    comm = edge_tts.Communicate(build_ssml(text, mode_key, voice), voice)
    await comm.save(str(out_file))

# ---------- routes ----------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/invoquer", methods=["POST"])
def invoquer():
    data = request.get_json(force=True) or {}
    mode_key = (data.get("mode") or "sentinelle8").strip().lower()
    if mode_key not in MODES: mode_key = "sentinelle8"
    prompt = data.get("prompt") or ""

    reponse, sources = rag_answer_only(prompt, k=4)

    # mémoire (éphémère sur Render Free)
    mem_path = MODES[mode_key]["mem"]
    mem = load_json(mem_path, {"fragments": []})
    mem["fragments"].append({"date": datetime.now().isoformat(), "mode": mode_key, "prompt": prompt, "reponse": reponse, "sources": sources})
    mem["fragments"] = mem["fragments"][-200:]
    save_json(mem_path, mem)

    # TTS FR
    audio_url = None
    out_file = AUDIO_DIR / "derniere_voix.mp3"
    voice = MODES[mode_key]["voice"]
    try:
        asyncio.run(synthese_tts(reponse, out_file, mode_key, voice))
        if out_file.exists():
            audio_url = f"/static/assets/{out_file.name}"
    except Exception as e:
        print("[TTS] erreur:", e)

    return jsonify({"reponse": reponse, "audio_url": audio_url, "sources": sources})

@app.route("/service-worker.js")
def sw():
    return app.send_static_file("service-worker.js")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
