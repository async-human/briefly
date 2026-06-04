import re
from pathlib import Path

html = Path("liner.html").read_text(encoding="utf-8", errors="ignore")
css = Path("liner.css").read_text(encoding="utf-8", errors="ignore")

# CSS custom properties for fills
vars_found = set(re.findall(r"--[a-zA-Z0-9\-]+(?:-fill|-container|-background)[^;]{0,80}", css))
for v in sorted(vars_found)[:60]:
    print(v[:120])

print("\n=== bg utility classes in HTML ===")
bgs = sorted(set(re.findall(r'bg-[a-zA-Z0-9\[\]\(\),\.%#\-]+', html)))
for b in bgs:
    if any(k in b for k in ("neutral", "brand", "rgb", "fill", "white", "gray", "slate")):
        print(b)

print("\n=== inline style backgrounds ===")
for m in re.finditer(r'style="[^"]*background[^"]*"', html):
    print(m.group()[:200])

print("\n=== section-like wrappers with bg ===")
for m in re.finditer(r'<(?:section|div)[^>]{0,300}bg-[^>]{0,200}>', html):
    s = m.group().replace("\n", " ")
    if len(s) > 20:
        print(s[:250])

print("\n=== motion hints in HTML ===")
for pat in ["framer", "gsap", "lenis", "IntersectionObserver", "opacity-0", "translate-y", "animate-", "data-aos", "motion"]:
    if pat.lower() in html.lower() or pat.lower() in css.lower():
        print("found:", pat)

print("\n=== keyframes in css ===")
for m in re.findall(r"@keyframes\s+[a-zA-Z0-9_-]+", css):
    print(m)

print("\n=== CSS vars :root sample ===")
root = re.search(r":root\{[^}]{0,8000}\}", css)
if root:
    chunk = root.group()
    for token in re.findall(r"--(?:neutral|brand|inverse|label|fill)[^:;]+:[^;]+", chunk):
        print(token[:100])

# Extract color-theme inline styles from head
style_blocks = re.findall(r"<style[^>]*>(.*?)</style>", html, re.DOTALL)
print(f"\n=== inline style blocks: {len(style_blocks)} ===")
for i, block in enumerate(style_blocks[:3]):
    for line in block.split("}"):
        if "fill" in line.lower() or "background" in line.lower() or "--" in line:
            if len(line) < 300:
                print(line.strip()[:200])
