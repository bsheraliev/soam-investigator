import sys, pypdf, os
src, out = sys.argv[1], sys.argv[2]
r = pypdf.PdfReader(src)
for i, p in enumerate(r.pages, 1):
    t = p.extract_text() or ""
    with open(os.path.join(out, f"p{i:02d}.txt"), "w", encoding="utf-8") as f:
        f.write(t)
print("done", len(r.pages))
