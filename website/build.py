#!/usr/bin/env python3
"""Builds the marketing website into public/landing/.

The same files are what the Claude artifact preview shows and what www.meetnavi.app serves:
  public/landing/index.html     the page (signed-out "/" and the marketing paths are rewritten to it in src/proxy.ts)
  public/landing/site.js        the page script (a file, so the production CSP needs no inline-script exception)
  public/landing/fonts/         Figtree (OFL-1.1), self-hosted (the CSP only allows same-origin fonts)
  public/landing/a/, s/         images and app screens
  website/dist/navi-website.html  the artifact page: index.html without the document wrapper (the artifact host adds one)

All asset paths are relative ("landing/..."), so they resolve to /landing/... from "/" and from /about etc.
Run: python3 website/build.py
"""
import os, re, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'website')
OUT = os.path.join(ROOT, 'public', 'landing')
DIST = os.path.join(SRC, 'dist')

parts = sorted(f for f in os.listdir(os.path.join(SRC, 'parts')) if f.endswith('.html'))
html = ''.join(open(os.path.join(SRC, 'parts', f), encoding='utf-8').read() for f in parts)

# 1) Script -> landing/site.js
m = re.search(r'<script>\n(.*?)</script>\n?', html, re.S)
assert m and html.count('<script') == 1, 'expected exactly one inline <script> in the parts'
js = m.group(1)
html = html[:m.start()] + '<script src="landing/site.js"></script>\n' + html[m.end():]

# 2) Google Fonts -> self-hosted Figtree (from @fontsource-variable/figtree 5.3.0)
gf = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,500;1,600;1,700;1,800;1,900&display=swap">\n')
assert html.count(gf) == 1, 'Google Fonts link not found in the parts'
LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
faces = ''
for style in ('normal', 'italic'):
    for sub, rng in (('latin-ext', EXT), ('latin', LATIN)):
        faces += f"@font-face {{ font-family: 'Figtree'; font-style: {style}; font-display: swap; font-weight: 300 900; src: url(landing/fonts/figtree-{sub}-wght-{style}.woff2) format('woff2'); unicode-range: {rng}; }}\n"
html = html.replace(gf, '<link rel="preload" href="landing/fonts/figtree-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>\n<style>\n' + faces + '</style>\n')

# 3) Asset paths a/ s/ -> landing/a/ landing/s/
for pre in ('src="', 'srcset="', 'href="', 'url('):
    for d in ('a/', 's/'):
        html = html.replace(pre + d, pre + 'landing/' + d)
js = js.replace('\'<img src="s/\'', '\'<img src="landing/s/\'')
assert not re.search(r'["\'(,\s](a|s)/[\w.-]+\.(webp|png|jpg)', html), 'an asset path was not rewritten'
assert not re.search(r'["\'(](a|s)/[\w.-]+\.(webp|png|jpg)', js), 'an asset path in the script was not rewritten'

# The parts carry charset/viewport for local previews; the document wrapper supplies them.
html = re.sub(r'^<meta charset="utf-8">\n', '', html)
html = re.sub(r'^<meta name="viewport"[^\n]*\n', '', html, flags=re.M)
html = re.sub(r'<title>[^<]*</title>', '<title>Navi Website</title>', html, count=1)
assert '<meta charset' not in html and 'name="viewport"' not in html

HEAD = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')
cut = html.index('<a class="skip"')  # head = title, preload, styles; body starts at the skip link
page = HEAD + html[:cut] + '</head>\n<body>\n' + html[cut:] + '</body>\n</html>\n'
assert page.replace(HEAD, '', 1).replace('</head>\n<body>\n', '', 1).replace('</body>\n</html>\n', '') == html

# Write
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(os.path.join(OUT, 'fonts'))
os.makedirs(DIST, exist_ok=True)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(page)
open(os.path.join(DIST, 'navi-website.html'), 'w', encoding='utf-8').write(html)
open(os.path.join(OUT, 'site.js'), 'w', encoding='utf-8').write(js)
keys = set(k for lst in re.findall(r'data-s="([^"]+)"', html) for k in lst.split(','))
for d in ('a', 's'):
    os.makedirs(os.path.join(OUT, d))
    for f in sorted(os.listdir(os.path.join(SRC, 'assets', d))):
        if f in html or f in js or os.path.splitext(f)[0] in keys:
            shutil.copy(os.path.join(SRC, 'assets', d, f), os.path.join(OUT, d, f))
        else:
            print('  not used, left out:', d + '/' + f)
for f in os.listdir(os.path.join(SRC, 'fonts')):
    shutil.copy(os.path.join(SRC, 'fonts', f), os.path.join(OUT, 'fonts', f))
print('built public/landing:', len(page), 'bytes page,', len(js), 'bytes script')
