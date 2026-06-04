import re
from pathlib import Path
html = Path("liner.html").read_text(encoding="utf-8", errors="ignore")

# hero triptych card backgrounds
idx = html.find("Everyday search")
if idx >= 0:
    chunk = html[idx:idx+8000]
    bgs = re.findall(r'bg-\[[^\]]+\]|bg-[a-z\-]+', chunk)
    print("Hero triptych backgrounds:", sorted(set(bgs)))

# product section inner demo colors
for name, id_ in [("liner","root-liner-section"),("scholar","root-scholar-section"),("write","root-write-section")]:
    m = re.search(id_ + r'.{0,5000}', html)
    if m:
        bgs = sorted(set(re.findall(r'bg-\[[^\]]+\]', m.group())))
        print(f"\n{name} demo colors:", bgs[:15])

# padding values
for cls in ["py-component-1700", "pt-component-1300", "px-component-800"]:
    if cls in html:
        print("spacing class found:", cls)

# animate-marquee css
css = Path("liner.css").read_text(encoding="utf-8", errors="ignore")
idx = css.find(".animate-marquee")
print("\nmarquee rule:", css[idx:idx+200] if idx>=0 else "not found")

# hero card rgb backgrounds - search in hero area
for rgb in ["237,243,237", "198,217,197", "231,233,213", "195,217,230", "rgb(237", "rgb(8,44"]:
    if rgb in html:
        print("found rgb pattern:", rgb)
