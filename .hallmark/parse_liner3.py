import re
from pathlib import Path

html = Path("liner.html").read_text(encoding="utf-8", errors="ignore")

# hero area
for pat in ["Meet AI tools", "Accurate AI tools", "Trusted by users", "Choose the right tool"]:
    i = html.find(pat)
    if i >= 0:
        print(f"\n=== context: {pat} ===")
        print(html[max(0,i-400):i+600].replace("\n"," ")[:900])

# find sticky elements
print("\n=== sticky classes ===")
for m in re.finditer(r'class="[^"]*sticky[^"]*"', html):
    print(m.group()[:300])

# snap
print("\n=== snap classes ===")
for m in re.finditer(r'class="[^"]*snap[^"]*"', html):
    print(m.group()[:300])

# transition flex-basis (tab expand)
print("\n=== flex-basis transition (product tabs) ===")
for m in re.finditer(r'class="[^"]*flex-basis[^"]*"', html):
    print(m.group()[:350])

# gray cool alpha values from css
css = Path("liner.css").read_text(encoding="utf-8", errors="ignore")
print("\n=== gray-cool alpha tokens ===")
for m in re.finditer(r"--lp-pri-gray-cool-dark-alpha-[0-9]+:\s*[^;]+", css):
    print(m.group())

print("\n=== brand-container-high resolved ===")
for m in re.finditer(r"--brand-container-high:\s*[^;]+", css):
    print(m.group()[:80])
