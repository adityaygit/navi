#!/usr/bin/env python3
"""Draw Navi's icon and splash from the owner's artwork, then place every size the native projects need.
The icon (owner, 2026-11-16) is the black N on white: resources/navi-icon-source.jpg, used as is for the
square icon (its soft shading kept) and as an alpha mask for the Android foreground and notification icon. Re-run after changing the look:

    python3 mobile/scripts/make-icons.py

Needs Python 3 with Pillow (pip install pillow). Writes:
  mobile/resources/icon.png            1024x1024, opaque (iOS rejects alpha)
  mobile/resources/icon-foreground.png 1024x1024, transparent (Android adaptive)
  mobile/resources/splash.png          2732x2732, plain white (M6: the app plays the opening on it)
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
  ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png
  android/app/src/main/res/mipmap-*/ic_launcher*.png
  android/app/src/main/res/drawable*/splash.png, drawable-*/ic_stat_navi.png
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent  # mobile/
RES = ROOT / "resources"
IOS_ASSETS = ROOT / "ios/App/App/Assets.xcassets"
ANDROID_RES = ROOT / "android/app/src/main/res"

BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
SS = 4  # supersampling factor for smooth edges


ICON_SOURCE = RES / "navi-icon-source.jpg"  # owner-supplied: black N on white, square


def _mark_alpha() -> Image.Image:
    """The N as an alpha mask (dark on white -> opacity, the soft shading kept), cropped tight."""
    lum = ImageChops.invert(Image.open(ICON_SOURCE).convert("L"))
    lum = lum.point(lambda v: 0 if v < 12 else v)  # drop JPEG noise in the white
    box = lum.point(lambda v: 255 if v > 40 else 0).getbbox()
    return lum.crop(box)


def draw_mark(size: int, scale: float, color: tuple[int, int, int] = BLACK) -> Image.Image:
    """The Navi N in `color`, its longer side filling `scale` of a transparent square."""
    a = _mark_alpha()
    k = size * scale / max(a.size)
    a = a.resize((max(1, round(a.width * k)), max(1, round(a.height * k))), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (*color, 0))
    layer = Image.new("RGBA", a.size, (*color, 255))
    layer.putalpha(a)
    out.paste(layer, ((size - a.width) // 2, (size - a.height) // 2), layer)
    return out


def on_white(img: Image.Image) -> Image.Image:
    bg = Image.new("RGB", img.size, WHITE)
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

    # The square icon is the owner's artwork itself (opaque white, iOS rejects alpha).
    icon = Image.open(ICON_SOURCE).convert("RGB").resize((1024, 1024), Image.LANCZOS)
    fg_stone = draw_mark(1024, 0.47 * 66 / 108)  # adaptive: the same N, kept in the 66dp safe zone

    icon.save(RES / "icon.png", optimize=True)
    fg_stone.save(RES / "icon-foreground.png", optimize=True)

    # M6: the launch screen is plain white; the app's opening animation draws the N on it.
    splash = Image.new("RGB", (2732, 2732), WHITE)
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
            white = draw_mark(px, 0.9, WHITE)
            white.putalpha(white.getchannel("A").point(lambda v: 255 if v > 40 else 0))  # the shading reads as solid at 24 px
            white.save(d / "ic_stat_navi.png", optimize=True)

        # Pre-Android-12 launch background (Android 12+ shows the N on white).
        splash_px = {"mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280),
                     "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920)}
        for dpi, (w, h) in splash_px.items():
            for orient, (W, H) in (("port", (w, h)), ("land", (h, w))):
                d = ANDROID_RES / f"drawable-{orient}-{dpi}"
                d.mkdir(exist_ok=True)
                Image.new("RGB", (W, H), WHITE).save(d / "splash.png", optimize=True)
        Image.new("RGB", (480, 800), WHITE).save(ANDROID_RES / "drawable/splash.png", optimize=True)

    print("icons and splash written")


if __name__ == "__main__":
    main()
