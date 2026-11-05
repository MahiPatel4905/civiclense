"""
Second-opinion image classifier.

The YOLO model in best.pt stays the primary classifier. It is fast, runs
locally and costs nothing, but its own validation scores (precision 0.72,
recall 0.54) mean it fails to recognise roughly half of real complaints.

When YOLO cannot make a confident call, this module asks a hosted vision
model for a second opinion instead of sending the complaint straight to a
human. Only the uncertain complaints reach it, so the free quota of a
provider such as Google AI Studio is far more than enough.

Everything here fails soft and never raises. classify() always returns a
dict whose "status" is one of three DISTINCT outcomes:

    "category"     the model picked one of the known issues
    "none"         the model looked and said there is no civic issue
                   (this is evidence: the caller may drop a YOLO claim)
    "unavailable"  no key, no internet, quota, a bad or cut-off reply
                   (this is silence: the caller keeps YOLO's answer)

Treating "none" and "unavailable" the same was a real bug: a confident
false alarm from YOLO survived because a correct "no issue" looked like an
API failure.

Configure in Backend/.env:

    VISION_FALLBACK=on
    VISION_PROVIDER=groq            # or gemini / openrouter
    GROQ_API_KEY=your_key_here

Free keys: https://console.groq.com/keys  or  https://aistudio.google.com/apikey
"""

import base64
import io
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 25           # seconds; an upload must not hang on this

# Newer Gemini models spend part of this budget on hidden "thinking" before
# they write the answer. At 200 the JSON was cut off mid-way on most calls.
MAX_OUTPUT_TOKENS = 1024

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "%s:generateContent"
)
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

DEFAULT_MODELS = {
    "gemini": "gemini-3.5-flash-lite",
    "openrouter": "google/gemini-3.5-flash-lite",
    "groq": "qwen/qwen3.8-27b",
}

# Groq models that accept image input (checked against the live API; the
# gpt-oss models there are text-only and answer HTTP 400 to an image).
GROQ_FALLBACK_MODELS = [
    "qwen/qwen3.8-27b",
]

# Google retires model names over time (gemini-2.5-flash now answers 404
# "no longer available to new users") and the free tier has a small daily
# quota PER MODEL. So there is a rotation: when one model is gone (404) or
# out of quota (429) the next is tried. Tested working with image input.
GEMINI_FALLBACK_MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-flash-latest",
]

# A model that answered 404/429 is skipped for a while instead of being
# retried (and failing slowly) on every single upload.
GONE_COOLDOWN = 24 * 3600       # 404/403: name retired or no access
QUOTA_COOLDOWN = 15 * 60        # 429: rate limit or daily quota

_cooldowns = {}
_cooldown_lock = threading.Lock()


def _cool_down(name, seconds):
    with _cooldown_lock:
        _cooldowns[name] = time.time() + seconds


def _retry_after(error, default):
    """Seconds the provider asks us to wait (Retry-After), within bounds.

    Groq's free tier limits tokens per MINUTE, so a 429 there clears in
    seconds; a fixed 15 minute cooldown would wrongly shut it off.
    """
    try:
        wait = float(error.headers.get("retry-after", ""))
    except (AttributeError, TypeError, ValueError):
        return default

    return max(1.0, min(wait + 1.0, default))


def _is_cooling(name):
    with _cooldown_lock:
        return _cooldowns.get(name, 0) > time.time()


# ==================================================
# CONFIGURATION
# ==================================================

def _env(name, default=""):
    return str(os.getenv(name, default) or "").strip()


def provider():
    return _env("VISION_PROVIDER", "gemini").lower()


def api_key():
    name = {
        "gemini": "GEMINI_API_KEY",
        "groq": "GROQ_API_KEY",
    }.get(provider(), "OPENROUTER_API_KEY")
    return _env(name)


def model_name():
    return _env("VISION_MODEL") or DEFAULT_MODELS.get(provider(), "")


def is_enabled():
    """On only when switched on AND a key is present."""
    switch = _env("VISION_FALLBACK", "on").lower()
    if switch in ("0", "off", "false", "no"):
        return False
    return bool(api_key())


def status():
    """Human-readable state, for the health endpoint and start-up log."""
    if _env("VISION_FALLBACK", "on").lower() in ("0", "off", "false", "no"):
        return "disabled (VISION_FALLBACK is off)"
    if not api_key():
        return "disabled (no API key in Backend/.env)"
    return "enabled (%s / %s)" % (provider(), model_name())


# ==================================================
# PROMPT
# ==================================================

MAX_IMAGE_SIDE = 768            # px; plenty to tell a pothole from a bin


def _shrink(image_bytes, mime_type):
    """Downscale big photos before upload: fewer tokens, faster, cheaper.

    Phone photos are several MB. Providers bill and rate-limit by image
    size, and the classifier does not need 12 megapixels. Falls back to
    the original bytes if Pillow or the image itself misbehaves.
    """
    try:
        from PIL import Image

        with Image.open(io.BytesIO(image_bytes)) as source:
            if max(source.size) <= MAX_IMAGE_SIDE:
                return image_bytes, mime_type

            picture = source.convert("RGB")
            picture.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
            buffer = io.BytesIO()
            picture.save(buffer, "JPEG", quality=85)
            return buffer.getvalue(), "image/jpeg"
    except Exception:
        return image_bytes, mime_type


def _build_prompt(categories):
    listed = "\n".join("- " + name for name in categories)
    return (
        "You are classifying a photograph submitted to an Indian municipal "
        "complaint system. Decide which ONE of these civic issues the photo "
        "shows:\n"
        + listed
        + "\n\nRules:\n"
        "- Choose the single issue a citizen is most likely complaining "
        "about.\n"
        "- Only report an issue that is clearly visible. A working or "
        "intact fixture (a streetlight that looks undamaged, a tidy bin, "
        "a clean road), an ordinary scene, an animal, a person or an "
        'unrelated photo is "none".\n'
        "- If the photo shows no civic problem at all, or you cannot tell, "
        'answer "none".\n'
        "- confidence is your certainty from 0.0 to 1.0.\n\n"
        "Reply with JSON only, nothing else:\n"
        '{"category": "<one name from the list, or none>", '
        '"confidence": <0.0-1.0>, "reason": "<a few words>"}'
    )


# ==================================================
# PROVIDERS
# ==================================================

def _post(url, payload, headers=None):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("User-Agent", "civic-complaint-backend/1.0")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as reply:
        return json.loads(reply.read().decode("utf-8"))


def _gemini_candidates():
    """Configured model first, then the known-good rotation."""
    ordered = [model_name()] + [
        name for name in GEMINI_FALLBACK_MODELS if name != model_name()
    ]
    return [name for name in ordered if name]


def _call_gemini(encoded, prompt, mime_type):
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime_type, "data": encoded}},
            ]
        }],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
        },
    }
    # The key goes in the header only, so it never lands in a URL that a
    # proxy or an error log might record.
    headers = {"x-goog-api-key": api_key()}

    last_error = None
    tried = False

    for name in _gemini_candidates():
        if _is_cooling(name):
            continue

        tried = True

        try:
            data = _post(GEMINI_URL % name, payload, headers)
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except urllib.error.HTTPError as error:
            # 404/403: that model name is retired or not allowed.
            # 429: its quota is used up. Either way another model may
            # still work, so rotate. Anything else is a real failure.
            if error.code in (404, 403):
                _cool_down(name, GONE_COOLDOWN)
            elif error.code == 429:
                _cool_down(name, _retry_after(error, QUOTA_COOLDOWN))
            else:
                raise
            logger.warning(
                "Gemini model %s unavailable (HTTP %s), trying next",
                name, error.code,
            )
            last_error = error

    if last_error is not None:
        raise last_error

    if not tried:
        raise RuntimeError("every Gemini model is cooling down")

    raise RuntimeError("no Gemini model configured")


def _call_groq(encoded, prompt, mime_type):
    """Groq speaks the OpenAI chat format; rotate models like Gemini does."""
    ordered = [model_name()] + [
        name for name in GROQ_FALLBACK_MODELS if name != model_name()
    ]
    last_error = None
    tried = False

    for name in [n for n in ordered if n]:
        if _is_cooling(name):
            continue

        tried = True

        try:
            data = _post(
                GROQ_URL,
                {
                    "model": name,
                    "temperature": 0,
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {
                                "url": "data:%s;base64,%s"
                                % (mime_type, encoded)}},
                        ],
                    }],
                },
                {"Authorization": "Bearer " + api_key()},
            )
            return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as error:
            if error.code in (404, 403):
                _cool_down(name, GONE_COOLDOWN)
            elif error.code == 429:
                _cool_down(name, _retry_after(error, QUOTA_COOLDOWN))
            else:
                raise
            logger.warning(
                "Groq model %s unavailable (HTTP %s), trying next",
                name, error.code,
            )
            last_error = error

    if last_error is not None:
        raise last_error

    if not tried:
        raise RuntimeError("every Groq model is cooling down")

    raise RuntimeError("no Groq model configured")


def _call_openrouter(encoded, prompt, mime_type):
    data = _post(
        OPENROUTER_URL,
        {
            "model": model_name(),
            "temperature": 0,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {
                        "url": "data:%s;base64,%s" % (mime_type, encoded)}},
                ],
            }],
        },
        {"Authorization": "Bearer " + api_key()},
    )
    return data["choices"][0]["message"]["content"]


# ==================================================
# RESPONSE PARSING
# ==================================================

NONE_WORDS = ("none", "null", "unknown", "unclear", "no issue", "no_issue")


def _match_category(raw_category, categories):
    """Map a reply name onto a known category, tolerating _ vs space."""
    wanted = raw_category.casefold().replace("_", " ")
    return next(
        (name for name in categories
         if name.casefold().replace("_", " ") == wanted),
        None,
    )


def _parse(text, categories):
    """Return {"status": "category"|"none", ...} or None if unreadable.

    None means the reply could not be understood (cut off, not JSON, a name
    outside the list) and is treated as "unavailable" by the caller.
    """
    if not isinstance(text, str):
        return None

    parsed = None
    match = re.search(r"\{.*\}", text, re.S)

    if match:
        try:
            parsed = json.loads(match.group(0))
        except ValueError:
            parsed = None

    if not isinstance(parsed, dict):
        # A reply cut off mid-JSON usually still contains the category.
        found = re.search(r'"category"\s*:\s*"([^"]*)"', text)
        if not found:
            return None
        parsed = {"category": found.group(1)}
        conf = re.search(r'"confidence"\s*:\s*([0-9.]+)', text)
        if conf:
            parsed["confidence"] = conf.group(1)

    raw_category = str(parsed.get("category", "")).strip()

    try:
        confidence = float(parsed.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0.0

    confidence = max(0.0, min(1.0, confidence))
    reason = str(parsed.get("reason", "")).strip()[:120]

    # An explicit "none" is a real answer: the model looked and found no
    # civic issue. Keep it distinct from "no answer at all".
    if raw_category.lower() in NONE_WORDS:
        return {
            "status": "none",
            "category": None,
            "confidence": confidence,
            "reason": reason,
        }

    # Only ever accept a name the local model also knows, so the rest of
    # the backend keeps working with one fixed set of categories.
    matched = _match_category(raw_category, categories)

    if matched is None:
        return None

    return {
        "status": "category",
        "category": matched,
        "confidence": confidence,
        "reason": reason,
    }


# ==================================================
# ENTRY POINT
# ==================================================

def _unavailable(reason=""):
    return {
        "status": "unavailable",
        "category": None,
        "confidence": 0.0,
        "reason": reason,
    }


def classify(image_bytes, categories, mime_type="image/jpeg"):
    """Return {"status", "category", "confidence", "reason"}. Never raises.

    status "category"    -> category is one of `categories`
    status "none"        -> the model says no civic issue is shown
    status "unavailable" -> no usable answer; carry on without this module
    """
    if not is_enabled() or not image_bytes or not categories:
        return _unavailable("fallback disabled")

    image_bytes, mime_type = _shrink(image_bytes, mime_type)
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    prompt = _build_prompt(categories)
    caller = {
        "gemini": _call_gemini,
        "groq": _call_groq,
    }.get(provider(), _call_openrouter)

    try:
        text = caller(encoded, prompt, mime_type)
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            detail = error.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        logger.warning("Vision fallback HTTP %s: %s", error.code, detail)
        return _unavailable("HTTP %s" % error.code)
    except Exception:
        logger.warning("Vision fallback unavailable", exc_info=True)
        return _unavailable("request failed")

    result = _parse(text, categories)

    if result is None:
        logger.info("Vision fallback reply could not be read")
        return _unavailable("unreadable reply")

    return result
