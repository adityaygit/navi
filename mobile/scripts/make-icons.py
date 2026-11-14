#!/usr/bin/env python3
"""Draw Navi's icon and splash from the owner's mark (resources/navi-mark-source.png) and splash, then place every size the native
projects need. Re-run after changing the look:

    python3 mobile/scripts/make-icons.py

Needs Python 3 with Pillow (pip install pillow). Writes:
  mobile/resources/icon.png            1024x1024, opaque (iOS rejects alpha)
  mobile/resources/icon-foreground.png 1024x1024, transparent (Android adaptive)
  mobile/resources/splash.png          2732x2732, black with a small stone
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
  ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png
  android/app/src/main/res/mipmap-*/ic_launcher*.png
  android/app/src/main/res/drawable*/splash.png, drawable-*/ic_stat_navi.png
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent  # mobile/
RES = ROOT / "resources"
IOS_ASSETS = ROOT / "ios/App/App/Assets.xcassets"
ANDROID_RES = ROOT / "android/app/src/main/res"

BLACK = (0, 0, 0)
# Light lavender centre -> mid lavender -> deep violet edge.
STOPS = [
    (0.00, (0xF4, 0xF2, 0xFF)),
    (0.45, (0xB9, 0xB2, 0xFF)),
    (1.00, (0x4B, 0x3F, 0x9A)),
]
SS = 4  # supersampling factor for smooth edges


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def gradient_color(t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0)
            # Smoothstep keeps the bands soft.
            u = u * u * (3 - 2 * u)
            return tuple(round(lerp(c0[i], c1[i], u)) for i in range(3))  # type: ignore[return-value]
    return STOPS[-1][1]


def stone_outline(cx: float, cy: float, r: float, n: int = 720) -> list[tuple[float, float]]:
    """A pebble: a slightly wide ellipse with gentle organic wobble."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        wobble = (
            1
            + 0.022 * math.sin(2 * a + 0.6)
            + 0.018 * math.sin(3 * a + 1.9)
            + 0.012 * math.sin(5 * a + 0.3)
        )
        rx = r * 1.08 * wobble
        ry = r * 0.90 * wobble
        pts.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    return pts


def draw_stone(size: int, scale: float) -> Image.Image:
    """Transparent RGBA canvas of `size` with the stone filling `scale` of it."""
    big = size * SS
    r = big * scale / 2
    cx = cy = big / 2

    # Radial gradient centred up and to the left, so the stone looks lit.
    gx, gy = cx - r * 0.35, cy - r * 0.40
    reach = r * 1.55
    grad_small = Image.new("RGB", (256, 256))
    px = grad_small.load()
    for y in range(256):
        for x in range(256):
            X = x / 255 * big
            Y = y / 255 * big
            d = math.hypot(X - gx, Y - gy) / reach
            px[x, y] = gradient_color(d)
    grad = grad_small.resize((big, big), Image.BICUBIC)

    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).polygon(stone_outline(cx, cy, r), fill=255)

    # Subtle highlight top-left: a soft white glow inside the stone.
    hl = Image.new("L", (big, big), 0)
    hr = r * 0.32
    hx, hy = cx - r * 0.38, cy - r * 0.42
    ImageDraw.Draw(hl).ellipse((hx - hr * 1.2, hy - hr * 0.8, hx + hr * 1.2, hy + hr * 0.8), fill=150)
    hl = hl.filter(ImageFilter.GaussianBlur(r * 0.18))
    hl = ImageChops.multiply(hl, mask)
    white = Image.new("RGB", (big, big), (255, 255, 255))
    grad = Image.composite(white, grad, hl)

    # Soft inner shade along the lower-right rim for depth: the blurred
    # edge band of the mask, weighted toward the bottom right.
    inner = mask.filter(ImageFilter.GaussianBlur(r * 0.10))
    rim = ImageChops.subtract(mask, inner)
    ramp = Image.linear_gradient("L").rotate(45).resize((big, big))
    rim = ImageChops.multiply(rim, ramp).point(lambda v: int(v * 0.55))
    dark = Image.new("RGB", (big, big), (0x2A, 0x22, 0x60))
    grad = Image.composite(dark, grad, rim)

    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)

SOURCE = RES / "navi-mark-source.png"  # owner-supplied "N" mark, white on black


def _mark_alpha() -> Image.Image:
    """The mark as an alpha mask (white on black -> opacity), cropped tight."""
    lum = Image.open(SOURCE).convert("L")
    box = lum.point(lambda v: 255 if v > 24 else 0).getbbox()
    return lum.crop(box)


def draw_mark(size: int, scale: float) -> Image.Image:
    """White Navi mark whose longer side fills `scale` of a transparent square."""
    a = _mark_alpha()
    k = size * scale / max(a.size)
    a = a.resize((max(1, round(a.width * k)), max(1, round(a.height * k))), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    layer = Image.new("RGBA", a.size, (255, 255, 255, 255))
    layer.putalpha(a)
    out.paste(layer, ((size - a.width) // 2, (size - a.height) // 2), layer)
    return out


def on_black(img: Image.Image) -> Image.Image:
    bg = Image.new("RGB", img.size, BLACK)
    bg.paste(img, (0, 0), img)
    return bg


def fit(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size * SS - 1, size * SS - 1), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def main() -> None:
    RES.mkdir(parents=True, exist_ok=True)

    icon_stone = draw_mark(1024, 0.50)           # icon: stone fills ~62%
    fg_stone = draw_mark(1024, 0.50 * 66 / 108)  # adaptive: keep in the 66dp safe zone
    splash_stone = draw_mark(1024, 0.80)

    icon = on_black(icon_stone)
    icon.save(RES / "icon.png", optimize=True)
    fg_stone.save(RES / "icon-foreground.png", optimize=True)

    splash = Image.new("RGB", (2732, 2732), BLACK)
    s = 360  # small stone in the middle of a big canvas (aspect-fill crops edges)
    splash.paste(fit(splash_stone, s), ((2732 - s) // 2, (2732 - s) // 2), fit(splash_stone, s))
    splash.save(RES / "splash.png", optimize=True)

    # ---- iOS ----
    if IOS_ASSETS.exists():
        icon.save(IOS_ASSETS / "AppIcon.appiconset/AppIcon-512@2x.png", optimize=True)
        for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
            splash.save(IOS_ASSETS / "Splash.imageset" / name, optimize=True)

    # ---- Android ----
    if ANDROID_RES.exists():
        legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
        adaptive = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
        for dpi, px in legacy.items():
            d = ANDROID_RES / f"mipmap-{dpi}"
            d.mkdir(exist_ok=True)
            sq = fit(icon, px)
            sq.save(d / "ic_launcher.png", optimize=True)
            rnd = Image.new("RGBA", (px, px), (0, 0, 0, 0))
            rnd.paste(sq, (0, 0), circle_mask(px))
            rnd.save(d / "ic_launcher_round.png", optimize=True)
            fit(fg_stone, adaptive[dpi]).save(d / "ic_launcher_foreground.png", optimize=True)

        # Notification icon: Android shows only the alpha channel, white.
        notif = {"mdpi": 24, "hdpi": 36, "xhdpi": 48, "xxhdpi": 72, "xxxhdpi": 96}
        for dpi, px in notif.items():
            d = ANDROID_RES / f"drawable-{dpi}"
            d.mkdir(exist_ok=True)
            white = draw_mark(px, 0.9)
            white.putalpha(white.getchannel("A").point(lambda v: 255 if v > 110 else 0))
            white.save(d / "ic_stat_navi.png", optimize=True)

        # Pre-Android-12 launch background (Android 12+ uses the icon on black).
        splash_px = {"mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280),
                     "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920)}
        for dpi, (w, h) in splash_px.items():
            for orient, (W, H) in (("port", (w, h)), ("land", (h, w))):
                d = ANDROID_RES / f"drawable-{orient}-{dpi}"
                d.mkdir(exist_ok=True)
                img = Image.new("RGB", (W, H), BLACK)
                st = fit(splash_stone, round(min(W, H) * 0.28))
                img.paste(st, ((W - st.width) // 2, (H - st.height) // 2), st)
                img.save(d / "splash.png", optimize=True)
        base = Image.new("RGB", (480, 800), BLACK)
        st = fit(splash_stone, 134)
        base.paste(st, ((480 - 134) // 2, (800 - 134) // 2), st)
        base.save(ANDROID_RES / "drawable/splash.png", optimize=True)

    print("icons and splash written")


if __name__ == "__main__":
    main()
