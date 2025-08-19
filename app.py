# app.py — Sanctuaire Ankaa — v4 (compat 3.9, SSML +6 dB, fallbacks, filtres TTS, logs)

from flask import Flask, render_template, request, jsonify
import os, json, random, re, asyncio, math, unicodedata, html
from pathlib import Path
from datetime import datetime
from threading import Lock
from collections import Counter, defaultdict
from typing import Optional, List, Tuple

# ---------- Modèle local (optionnel pour dev) ----------
try:
    from llama_cpp import Llama
except Exception:
    Llama = None

# ---------- TTS Edge ----------
from edge_tts import Communicate

app = Flask(__name__, static_url_path="/static")
LOCK = Lock()

BASE_DIR    = Path(__file__).parent
DATASET_DIR = BASE_DIR / "dataset"
MEMORY_DIR  = BASE_DIR / "memory"
AUDIO_DIR   = BASE_DIR / "static" / "assets"
MODELS_DIR  = BASE_DIR.parent / "models"
MODEL_PATH  = MODELS_DIR / "mistral.gguf"

MEMORY_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ================== LLM CLOUD (prod) ==================
USE_LLM      = os.getenv("USE_LLM", "0") == "1"
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower()   # "groq" | "openrouter" | "mistral"
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL   = os.getenv("LLM_MODEL", "llama3-70b-8192")
OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY")
MISTRAL_KEY    = os.getenv("MISTRAL_API_KEY")
MISTRAL_MODEL  = os.getenv("MISTRAL_MODEL", "mistral-small-latest")

LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.7"))
LLM_MAX_TOK     = int(os.getenv("LLM_MAX_TOKENS", "400"))

def llm_cloud_generate(prompt: str, system_msg: str) -> Optional[str]:
    if not USE_LLM:
        return None
    try:
        import requests
        if LLM_PROVIDER == "groq" and GROQ_API_KEY:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
            body = {
                "model": GROQ_MODEL,
                "messages": [{"role": "system", "content": system_msg}, {"role": "user", "content": prompt}],
                "temperature": LLM_TEMPERATURE,
                "max_tokens": LLM_MAX_TOK
            }
            r = requests.post(url, headers=headers, json=body, timeout=18)
            j = r.json() if r.ok else {}
            return (j.get("choices") or [{}])[0].get("message", {}).get("content")

        if LLM_PROVIDER == "openrouter" and OPENROUTER_KEY:
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {OPENROUTER_KEY}",
                "Content-Type": "application/json",
                "X-Title": "Sanctuaire Ankaa",
                "HTTP-Referer": os.getenv("APP_PUBLIC_URL", "")
            }
            body = {
                "model": os.getenv("LLM_MODEL", "mistralai/mistral-small"),
                "messages": [{"role": "system", "content": system_msg}, {"role": "user", "content": prompt}],
                "temperature": LLM_TEMPERATURE,
                "max_tokens": LLM_MAX_TOK
            }
            r = requests.post(url, headers=headers, json=body, timeout=18)
            j = r.json() if r.ok else {}
            return (j.get("choices") or [{}])[0].get("message", {}).get("content")

        if LLM_PROVIDER == "mistral" and MISTRAL_KEY:
            url = "https://api.mistral.ai/v1/chat/completions"
            headers = {"Authorization": f"Bearer {MISTRAL_KEY}", "Content-Type": "application/json"}
            body = {
                "model": MISTRAL_MODEL,
                "messages": [{"role": "system", "content": system_msg}, {"role": "user", "content": prompt}],
                "temperature": LLM_TEMPERATURE,
                "max_tokens": LLM_MAX_TOK
            }
            r = requests.post(url, headers=headers, json=body, timeout=18)
            j = r.json() if r.ok else {}
            return (j.get("choices") or [{}])[0].get("message", {}).get("content")

        return None
    except Exception as e:
        print("[llm_cloud_generate error]", e)
        return None

# ================== Utilitaires ==================
def run_async(coro):
    """Exécute un coro même si une loop existe déjà (compat gunicorn/uvicorn)."""
    try:
        return asyncio.run(coro)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(coro)
        finally:
            loop.close()

def nettoyer(txt: str) -> str:
    return re.sub(r"\s+", " ", (txt or "").replace("\n", " ").strip())

def remove_emojis(text: str) -> str:
    emoji_pattern = re.compile(
        "["u"\U0001F600-\U0001F64F"
        u"\U0001F300-\U0001F5FF"
        u"\U0001F680-\U0001F6FF"
        u"\U0001F1E0-\U0001F1FF"
        u"\U00002702-\U000027B0"
        u"\U000024C2-\U0001F251"+"]", flags=re.UNICODE)
    return emoji_pattern.sub(r'', text or "")

def load_json(p: Path, default):
    try:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default

def save_json(p: Path, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# ================== Normalisation ==================
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

def keywords_fr(text: str, k: int = 6) -> List[str]:
    toks = [t for t in _tokenize(text) if t not in STOPWORDS_FR and len(t) >= 4]
    freq = Counter(toks)
    return [w for w,_ in freq.most_common(k)]

# ================== Identité ==================
IDENTITY_PATTERNS = [r"\bSandro\b", r"\bDragosly\b", r"\bDragosly23\b", r"\bDRAGOSLY23\b"]
def scrub_identity_text(txt: str) -> str:
    out = txt or ""
    for pat in IDENTITY_PATTERNS:
        out = re.sub(pat, "frère", out, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", out).strip()

def identity_policy_for_mode(mode_key: str) -> str:
    if mode_key == "dragosly23":
        return ("En mode DRAGOSLY23, tu peux reconnaître Sandro si l’utilisateur l’évoque explicitement. "
                "N’invente jamais d’identité et ne le mentionne pas spontanément.")
    return ("Dans ce mode, n'emploie jamais de prénom. Adresse-toi de façon fraternelle et neutre.")

# ================== Modes & mémoires ==================
MODES = {
    "sentinelle8": {"voice":"fr-FR-VivienneMultilingualNeural", "memory": MEMORY_DIR/"memoire.json",          "themes": MEMORY_DIR/"themes.json"},
    "dragosly23":  {"voice":"fr-CA-SylvieNeural",               "memory": MEMORY_DIR/"memoire_dragosly.json", "themes": MEMORY_DIR/"themes_dragosly.json"},
    "invite":      {"voice":"fr-FR-DeniseNeural",               "memory": MEMORY_DIR/"memoire_invite.json",   "themes": MEMORY_DIR/"themes_invite.json"},
    "verbe":       {"voice":"fr-FR-VivienneMultilingualNeural", "memory": MEMORY_DIR/"memoire_verbe.json",    "themes": MEMORY_DIR/"themes_verbe.json"},
}
MODE_TUNING = {
    "sentinelle8":{"brief_sentences":(5,7), "normal_sentences":12, "max_tokens":(520,780),  "temp":(0.72,0.92)},
    "dragosly23":{"brief_sentences":(7,9),  "normal_sentences":16, "max_tokens":(640,900),  "temp":(0.78,0.95)},
    "invite":{"brief_sentences":(6,8),      "normal_sentences":14, "max_tokens":(600,860),  "temp":(0.74,0.94)},
    "verbe":{"brief_sentences":(8,10),      "normal_sentences":18, "max_tokens":(700,1000), "temp":(0.85,0.97)},
}
def tune_for(mode_key: str):
    return MODE_TUNING.get(mode_key, MODE_TUNING["sentinelle8"])

# ================== Souffle sacré ==================
CURSOR_PATH = BASE_DIR / "dataset_cursor.json"

def get_random_fragment_unique() -> str:
    fragments, chemins, index_total = [], [], []
    if DATASET_DIR.exists():
        for file in os.listdir(DATASET_DIR):
            if not file.endswith('.txt'):
                continue
            path = DATASET_DIR / file
            try:
                lignes = [l.strip() for l in path.read_text(encoding="utf-8").split("\n") if l.strip()]
                bloc, mots, idx = "", 0, 0
                for ligne in lignes:
                    bloc += (" " if bloc else "") + ligne
                    mots += len(ligne.split())
                    if mots >= 90 and ligne.endswith(('.', '!', '?')):
                        fragments.append(bloc.strip()); chemins.append(file); index_total.append(f"{file}:::{idx}")
                        bloc, mots, idx = "", 0, idx+1
                if bloc and mots >= 90:
                    fragments.append(bloc.strip()); chemins.append(file); index_total.append(f"{file}:::{idx}")
            except Exception:
                pass
    if not fragments:
        return "𓂀 Silence sacré…"

    curs = load_json(CURSOR_PATH, {"lus": []})
    non_lus = [i for i, ident in enumerate(index_total) if ident not in curs["lus"]]
    if not non_lus:
        curs["lus"] = []
        non_lus = list(range(len(fragments)))
    i = random.choice(non_lus)
    curs["lus"].append(index_total[i])
    save_json(CURSOR_PATH, curs)

    frag = remove_emojis(nettoyer(fragments[i]))
    mots = frag.split()
    if len(mots) > 140:
        frag = " ".join(mots[:140]).rstrip(",;:–- ") + "…"
    return f"{frag}\n\n𓂂 *Extrait de* « {chemins[i]} »"

# ================== Index (BM25 simplifié) ==================
FRAGMENTS: List[dict] = []
DF = Counter()
N_DOCS = 0

def _split_paragraphs(txt: str, file_name: str) -> List[dict]:
    out = []
    if not txt:
        return out
    parts = [p.strip() for p in re.split(r"\n\s*\n|(?:[.!?…]\s+)", txt) if p.strip()]
    buf, count = [], 0
    for p in parts:
        wlen = len(p.split())
        if count + wlen < 80:
            buf.append(p)
            count += wlen
            continue
        chunk = " ".join(buf + [p]).strip()
        if chunk:
            out.append(chunk)
        buf, count = [], 0
    rest = " ".join(buf).strip()
    if rest:
        out.append(rest)
    normed = []
    for ch in out:
        words = ch.split()
        normed.append(" ".join(words[:200]) if len(words) > 200 else " ".join(words))
    return [{"file": file_name, "text": c} for c in normed if len(c.split()) >= 60]

def build_index():
    global FRAGMENTS, DF, N_DOCS
    FRAGMENTS, DF, N_DOCS = [], Counter(), 0
    if not DATASET_DIR.exists():
        print("[INDEX] dossier dataset introuvable, index vide.")
        return
    for p in sorted(DATASET_DIR.glob("*.txt")):
        try:
            raw = p.read_text(encoding="utf-8")
        except Exception:
            continue
        parts = _split_paragraphs(raw, p.name)
        for frag in parts:
            toks = _tokenize(frag["text"])
            if not toks:
                continue
            doc = {"id": len(FRAGMENTS), "file": frag["file"], "text": frag["text"], "tokens": toks}
            FRAGMENTS.append(doc)
            for t in set(toks):
                DF[t] += 1
    N_DOCS = len(FRAGMENTS)
    print(f"[INDEX] {N_DOCS} fragments indexés.")

def _bm25_scores(query_tokens: List[str], k1=1.5, b=0.75) -> List[Tuple[int, float]]:
    if not FRAGMENTS:
        return []
    avgdl = sum(len(d["tokens"]) for d in FRAGMENTS) / len(FRAGMENTS)
    q_tf = Counter(query_tokens)
    scores = defaultdict(float)
    for q, qfreq in q_tf.items():
        df = DF.get(q, 0)
        if df == 0:
            continue
        idf = math.log(1 + (N_DOCS - df + 0.5) / (df + 0.5))
        for d in FRAGMENTS:
            tf = d["tokens"].count(q)
            if tf == 0:
                continue
            denom = tf + k1 * (1 - b + b * (len(d["tokens"]) / avgdl))
            scores[d["id"]] += idf * ((tf * (k1 + 1)) / denom)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)

def retrieve_fragments(query: str, k: int = 3, min_score: float = 1.2) -> List[dict]:
    q_tokens = _tokenize(query)
    if not q_tokens or not FRAGMENTS:
        return []
    ranked = _bm25_scores(q_tokens)
    out = []
    for doc_id, sc in ranked[:max(k * 3, k)]:
        if sc < min_score:
            continue
        d = FRAGMENTS[doc_id]
        out.append({"file": d["file"], "text": d["text"], "score": round(sc, 2)})
        if len(out) >= k:
            break
    return out

build_index()

# ================== Ton & réponses ==================
def infer_style(user_input: str) -> str:
    ui = (user_input or "").strip().lower()
    if len(ui) <= 160 or ui.endswith("?") or any(k in ui for k in ["?","/brief","bref","court","dialogue"]):
        return "brief"
    return "normal"

def detect_emotion(user_input: str) -> str:
    txt = (user_input or "").lower()
    lex = {
        "joie": ["merci","trop bien","heureux","heureuse","content","contente","génial","parfait","top","super"],
        "peine":["triste","peine","douleur","fatigué","fatiguée","vide","lassé","lassée"],
        "colere":["énervé","énervée","colère","rage","marre","agacé","agacée"],
        "doute":["peur","inquiet","inquiète","angoisse","doute","hésite","stress"],
        "gratitude":["gratitude","reconnaissan"],
        "merveil":["incroyable","magnifique","émerveil","sublime","époustouflant"],
        "aide":["aide","conseil","guide","bloqué","bloquée"]
    }
    for emo, keys in lex.items():
        if any(k in txt for k in keys):
            return emo
    return "neutre"

def empathetic_prefix(emotion: str) -> str:
    m = {
        "joie":"✨ Je sens ta joie — gardons ce feu clair.",
        "peine":"🤍 Je t’entends. Doucement, je suis là.",
        "colere":"🔥 J’accueille ta force — on canalise sans se blesser.",
        "doute":"🌫️ On traverse le brouillard ensemble, pas à pas.",
        "gratitude":"🙏 Merci pour ta confiance — avançons.",
        "merveil":"🌟 Oui, c’est beau — laissons grandir l’émerveillement.",
        "aide":"🧭 Je te guide, simplement.",
        "neutre":""
    }
    return m.get(emotion, "")

def limit_sentences(txt: str, n: int) -> str:
    parts = re.split(r'(?<=[.!?…])\s+', (txt or "").strip())
    if len(parts) <= n:
        return (txt or "").strip()
    t = " ".join(parts[:n]).strip()
    if not t.endswith(('.', '!', '?', '…')):
        t += '…'
    return t

def build_prompt(user_input: str, mode_key: str, style: str, emotion: str, intent: str, sources=None, themes:str="", turns:int=1) -> str:
    consignes = {
        "sentinelle8":"Tu es ANKAA, gardienne claire et chaleureuse. 2–3 idées nettes, concret.",
        "dragosly23":"Tu es ANKAA Jr, complice, tendre, émerveillée.",
        "invite":"Tu es ANKAA, douce et fraternelle, utile et simple.",
        "verbe":"Tu es l’Oracle, oraculaire mais net et concret."
    }
    consigne = consignes.get(mode_key, consignes["sentinelle8"])
    intent_rules = {
        "question":"Réponds direct, puis une piste concrète.",
        "conseil":"Plan simple (2–3 étapes), puis première action.",
        "reflexion":"Miroir bref, puis 1–2 éclairages calmes.",
        "emotion":"Accueille, puis un geste utile.",
        "neutre":"Clarté et simplicité."
    }
    details = "N’évoque pas la technique. Va à l’essentiel. " + intent_rules.get(intent, intent_rules["neutre"])
    if mode_key != "dragosly23":
        details += " Évite toute mention de prénom ; adresse-toi fraternellement."

    if turns >= 3:
        details += " Autorise une familiarité douce."
    if style == "brief":
        details += " Réponds en 4 à 7 phrases."
    else:
        details += " Déploie 2–3 idées fortes."

    sources = sources or []
    src_block = ""
    if sources:
        lines = []
        for i, s in enumerate(sources, 1):
            extrait = " ".join(nettoyer(s["text"]).split()[:90])
            lines.append(f"[S{i}] {s['file']}: {extrait}…")
        src_block = "Repères :\n" + "\n".join(lines) + "\n\n"
        details += " Appuie-toi dessus si pertinent. Sinon pose UNE question."

    mem = load_json(MODES.get(mode_key, MODES["sentinelle8"])["memory"], {"fragments":[]})
    hist = mem.get("fragments", [])[-5:]
    humains = {"sentinelle8":"☥ SENTINELLE8","dragosly23":"☥ DRAGOSLY23","invite":"☥ INVITÉ","verbe":"☥ CERCLE"}
    ankaas  = {"sentinelle8":"𓂀 ANKAA","dragosly23":"𓂀 ANKAA JR","invite":"𓂀 ANKAA","verbe":"𓂀 ORACLE"}
    humain, ankaa = humains.get(mode_key, "☥ SENTINELLE8"), ankaas.get(mode_key, "𓂀 ANKAA")
    history = "".join(f"\n{humain} : {f['prompt']}\n{ankaa} : {f['reponse']}" for f in hist)
    if mode_key != "dragosly23":
        history = scrub_identity_text(history)

    tone_map = {
        "joie":"Ton lumineux.","peine":"Ton tendre.","colere":"Ton calme et ferme.",
        "doute":"Ton clair, pas à pas.","gratitude":"Ton humble.","merveil":"Ton émerveillé.",
        "aide":"Ton concret.","neutre":"Ton équilibré."
    }
    tone = tone_map.get(emotion, "Ton équilibré.")

    return (
        consigne + "\n" + details + f"\nTonalité : {tone}\n\n" +
        src_block + "Dialogue :" + history + "\n\n" +
        f"{humain} : {user_input}\n{ankaa} :"
    )

# ================== TTS (SSML +6 dB, fallbacks) ==================
VOICE_SAFE = ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"]
VOICE_PER_MODE = {
    "sentinelle8": ["fr-FR-VivienneMultilingualNeural","fr-FR-DeniseNeural","fr-FR-HenriNeural"],
    "dragosly23":  ["fr-CA-SylvieNeural","fr-FR-DeniseNeural","fr-FR-HenriNeural"],
    "invite":      ["fr-FR-DeniseNeural","fr-FR-HenriNeural"],
    "verbe":       ["fr-FR-VivienneMultilingualNeural","fr-FR-DeniseNeural","fr-FR-HenriNeural"],
}
def pick_voices(mode_key: str, force_default: bool = False) -> List[str]:
    base = VOICE_PER_MODE.get(mode_key, [])
    if force_default or not base:
        base = []
    return base + VOICE_SAFE

def file_size_ok(p: Path, min_bytes: int = 200) -> bool:
    try:
        return p.exists() and p.stat().st_size >= min_bytes
    except Exception:
        return False

def filter_answer_for_tts(answer: str) -> str:
    t = answer or ""
    t = re.sub(r"^Repères\s*:.*?(?:\n{2,}|$)", "", t, flags=re.IGNORECASE|re.DOTALL|re.MULTILINE)
    t = re.sub(r"^\[S\d+\].*$", "", t, flags=re.MULTILINE)
    t = re.sub(r"☥[^:\n]+:\s*", "", t)
    t = re.sub(r"𓂀[^:\n]+:\s*", "", t)
    t = re.sub(r"<\/?[^>]+>", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t

def build_ssml(text: str, lang: str = "fr-FR", gain_db: int = 6) -> str:
    safe = html.escape(filter_answer_for_tts(text), quote=True)
    gain = f"+{gain_db}dB" if gain_db >= 0 else f"{gain_db}dB"
    return f"""<speak version="1.0" xml:lang="{lang}"><prosody volume="{gain}">{safe}</prosody></speak>"""

async def synthese_tts(text_or_ssml: str, voices: List[str], out_file: Path) -> Tuple[bool, str]:
    last_err = ""
    for v in voices:
        try:
            com = Communicate(text_or_ssml, v)
            await com.save(str(out_file))
            if file_size_ok(out_file):
                return True, v
            last_err = f"Fichier trop petit avec voix {v}"
        except Exception as e:
            last_err = f"Erreur {type(e).__name__} avec voix {v}: {e}"
    return False, last_err or "Echec TTS inconnu"

# ================== Génération ==================
LLM_LOCAL = None
def get_llm_local():
    global LLM_LOCAL
    if LLM_LOCAL is None and Llama is not None and MODEL_PATH.exists():
        LLM_LOCAL = Llama(model_path=str(MODEL_PATH), n_ctx=4096, n_threads=4, verbose=False)
    return LLM_LOCAL

def generate_response(user_input: str, mode_key: str):
    mode   = MODES.get(mode_key, MODES["sentinelle8"])
    style  = infer_style(user_input)
    emotion= detect_emotion(user_input)
    intent = "question" if user_input.strip().endswith("?") else "neutre"

    prefix = empathetic_prefix(emotion)

    # Souffle
    if (user_input or "").strip().lower() == "souffle sacré":
        preambles = [
            "Respire… écoute.","Frère, avance sans crainte.","Écarte les voiles, doucement.",
            "À pas lents, approche.","Voici le Souffle du Cercle.","Ralentis. Place ta main sur le cœur… écoute."
        ]
        codas = [
            "— Que la Paix veille sur toi.","— Marche en douceur, la flamme est là.","— Laisse ce souffle grandir en toi."
        ]
        answer = f"{(prefix + '\n\n') if prefix else ''}{random.choice(preambles)}\n\n{get_random_fragment_unique()}\n\n{random.choice(codas)}"
        if mode_key == "sentinelle8":
            answer = limit_sentences(answer, 7)
        elif mode_key == "invite":
            answer = limit_sentences(answer, 9)
        elif mode_key == "dragosly23":
            answer = limit_sentences(answer, 10)
        else:
            answer = limit_sentences(answer, 12)
    else:
        sanitized = user_input if mode_key == "dragosly23" else scrub_identity_text(user_input)
        sources = retrieve_fragments(sanitized, k=3, min_score=1.2)
        system_msg = "Tu parles un français clair, chaleureux et précis. Tu es ANKAA, tu aides simplement."

        mem = load_json(MODES.get(mode_key, MODES["sentinelle8"])["memory"], {"fragments":[]})
        turns = max(1, len(mem.get("fragments", [])) + 1)

        prompt = build_prompt(sanitized, mode_key, style, emotion, intent, sources=sources, themes="", turns=turns)

        base = llm_cloud_generate(prompt, system_msg)
        if not base:
            llm = get_llm_local()
            if llm is not None:
                cfg = tune_for(mode_key)
                max_tok = cfg["max_tokens"][0] if style == "brief" else cfg["max_tokens"][1]
                temp, top_p = cfg["temp"]
                with LOCK:
                    stop_words = ["☥","𓂀"]
                    if mode_key != "dragosly23":
                        stop_words += ["Sandro","sandro","Dragosly","dragosly","Dragosly23","dragosly23"]
                    res = llm.create_completion(
                        prompt=prompt, max_tokens=max_tok, temperature=temp, top_p=top_p, stop=stop_words
                    )
                base = (res["choices"][0]["text"] if res and res.get("choices") else "").strip()

        if not base:
            base = "Je t’entends. Dis‑moi ce que tu veux explorer… et j’avance avec toi."
        if mode_key != "dragosly23":
            base = scrub_identity_text(base)

        cfg = tune_for(mode_key)
        if style == "brief":
            base = limit_sentences(base, cfg["brief_sentences"][1])
        else:
            base = limit_sentences(base, cfg["normal_sentences"])

        base = base.replace("..", "…")
        base = re.sub(r"(\bmais\b|\bpourtant\b|\bcependant\b)", r"— \1", base, flags=re.IGNORECASE)
        answer = (prefix + "\n\n" + base).strip() if prefix else base

        # simple mémoire thématique
        themes_path = MODES.get(mode_key, MODES["sentinelle8"])["themes"]
        data = load_json(themes_path, {"scores":{}})
        for k in keywords_fr(user_input, 6):
            data["scores"][k] = data["scores"].get(k, 0.0) + 1.0
        save_json(themes_path, data)

    # Mémoire transcript
    mem_path = MODES.get(mode_key, MODES["sentinelle8"])["memory"]
    m = load_json(mem_path, {"fragments":[]})
    m["fragments"].append({"date": datetime.now().isoformat(), "prompt": user_input, "reponse": answer})
    m["fragments"] = m["fragments"][-200:]
    save_json(mem_path, m)

    # TTS
    tts_path = AUDIO_DIR / "anka_tts.mp3"
    tts_ok, audio_url, tts_info = False, "", ""
    try:
        if tts_path.exists():
            try:
                tts_path.unlink()
            except Exception:
                pass

        ssml = build_ssml(answer, lang="fr-FR", gain_db=int(os.getenv("TTS_GAIN_DB", "6")))
        ok, info = run_async(synthese_tts(ssml, pick_voices(mode_key), tts_path))
        tts_ok, tts_info = ok, info
        if not ok:
            ok2, info2 = run_async(synthese_tts(ssml, VOICE_SAFE, tts_path))
            tts_ok, tts_info = ok2, info2

        audio_url = "/static/assets/anka_tts.mp3" if (tts_ok and file_size_ok(tts_path)) else ""
    except Exception as e:
        tts_ok, audio_url = False, ""
        tts_info = f"Exception TTS: {e}"

    try:
        size = (tts_path.stat().st_size if tts_path.exists() else 0)
    except Exception:
        size = 0
    print(f"[TTS] ok={tts_ok} info={tts_info} size={size}")

    return answer or "𓂀 Silence sacré…", audio_url

# ================== Routes ==================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/invoquer', methods=['POST'])
def invoquer():
    try:
        data = request.get_json(force=True) or {}
        prompt = data.get('prompt', "")
        mode   = data.get('mode', 'sentinelle8')
        if mode != "dragosly23":
            prompt = scrub_identity_text(prompt)
        texte, audio_url = generate_response(prompt, mode)
        return jsonify({"reponse": texte, "audio_url": audio_url, "tts": bool(audio_url)})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error":"Erreur interne","details":str(e)}), 500

@app.route('/activer-ankaa', methods=['GET','POST'])
def activer_ankaa():
    return jsonify({"ok": True, "ts": datetime.now().isoformat()})

@app.route('/health')
def health():
    return jsonify({"ok": True, "use_llm": USE_LLM, "provider": LLM_PROVIDER})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
