import re
from pathlib import Path

html = Path("liner.html").read_text(encoding="utf-8", errors="ignore")
css = Path("liner.css").read_text(encoding="utf-8", errors="ignore")

# Resolve lp-pri token values from css
tokens = {}
for m in re.finditer(r"--lp-pri-[a-zA-Z0-9\-]+:\s*([^;}{]+)", css):
    k, v = m.group(0).split(":", 1)
    tokens[k.strip()] = v.strip()

interesting = [k for k in tokens if any(x in k for x in ("neutral", "brand-original", "white", "990", "50"))]
for k in sorted(interesting)[:40]:
    print(f"{k}: {tokens[k]}")

print("\n=== neutral-fill token definitions ===")
for m in re.finditer(r"--neutral-fill-overlay-(?:lowest|low|mid)[^:]*:[^;]+", css):
    print(m.group()[:120])

print("\n=== slideUpFadeIn keyframe ===")
idx = css.find("@keyframes slideUpFadeIn")
if idx >= 0:
    print(css[idx:idx+400])

print("\n=== animate-shimmer ===")
idx = css.find("@keyframes shimmer")
if idx >= 0:
    print(css[idx:idx+300])

# motion classes in html
print("\n=== motion-related classes (unique) ===")
motion = set()
for cls in re.findall(r'class="([^"]+)"', html):
    for part in cls.split():
        if any(x in part for x in ("opacity", "translate", "animate", "transition", "duration", "ease", "motion", "scroll")):
            motion.add(part)
for m in sorted(motion):
    print(m)

print("\n=== opacity-0 + translate patterns ===")
for m in re.finditer(r'class="[^"]*(?:opacity-0|translate-y)[^"]*"', html):
    s = m.group()
    if s.count("opacity") or "translate" in s:
        print(s[:220])

print("\n=== section order with backgrounds ===")
sections = [
    ("hero/trusted", r'bg-neutral-fill-overlay-lowest'),
    ("liner (search)", r'id="root-liner-section"[^>]*class="([^"]+)"'),
    ("scholar", r'id="root-scholar-section"[^>]*class="([^"]+)"'),
    ("write", r'id="root-write-section"[^>]*class="([^"]+)"'),
    ("security", r'id="root-security-section"[^>]*class="([^"]+)"'),
    ("learn", r'id="root-learn-section"[^>]*class="([^"]+)"'),
    ("faq", r'id="faq-section"[^>]*class="([^"]+)"'),
]
for name, pat in sections:
    m = re.search(pat, html)
    if m:
        print(f"\n{name}:")
        print(m.group()[:250])

# sticky / scroll snap
print("\n=== sticky / snap ===")
for pat in ["sticky", "snap-", "scroll-snap", "schoolScroll"]:
    if pat in html or pat in css:
        print("found", pat)

# duration-380 easing
print("\n=== custom durations ===")
for m in sorted(set(re.findall(r"duration-\[[^\]]+\]|duration-[0-9]+|ease-\[[^\]]+\]", html))):
    print(m)
