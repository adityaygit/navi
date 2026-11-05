# Reference layout notes (desktop)

Source: Refero's 21 s scroll recording of the old landing page, 1600×1000 viewport, 30 fps.
The recording and frames stay in the session scratchpad and are not committed.
These notes cover geometry and behavior only. All copy, brand marks, imagery and logos in the build are original Navi substitutes.

Page height ≈ 8,100 px at 1600 wide. Container ≈ 1140 px (x 230 → 1368), centered. Canvas near-black (#000 → #0b0b0b; some bands slightly lifted, ~#0e0e0e with fine noise).
The nav is not sticky: it scrolls away with the hero.

| # | Page y (approx) | Section | Layout | Motion seen |
|---|---|---|---|---|
| 1 | 0–1000 | Nav + hero | Nav at y≈55: logo mark, 5 links (first has a chevron), right-aligned pill holding a short note plus a white "learn more" pill button (glow). Hero: device-frame card x 230→1368, y 175→~720, 24px+ radius, dark bezel; inside, a dashboard mockup (left: portfolio value + line chart + sector list; right: stacked recap/news cards, fading out at the bottom). Below: small gray label (~22px) and a large headline (~48px, bold, gray-to-white gradient) at x 230, y≈760–820. | Hero content fades in; lower part of the mockup is masked into black. |
| 2 | ~1030–1800 | Highlights carousel | Orange 15px label, 3-line ~20px semibold paragraph (max ≈ 620px). Prev/next round ghost buttons (≈44px) right-aligned at y≈158. Card row starts y≈230, height ≈500, gap ≈20: card 1 ≈650 wide (product screenshot), card 2 ≈456 (people list with pill tags, warm red glow at bottom), card 3 overflows the right edge. Captions 20px gray-white under each card, y≈772. | Horizontal carousel; row bleeds right past the container. |
| 3 | ~1960–2900 | Dock over sculpture | Headline left (x 230, ~48px gradient text). Centered 3D stone render (~430×500) on black with floor shadow. Glass dock pill (≈745×115, radius full) overlapping it with 7 monoline icons (active one in a filled circle), plus a separate round search button (≈115). Dotted leader line from the active icon down then right to an annotation block (title 14px white + 4 lines 13px gray) at x≈1126. | Active icon cycles; annotation text changes with it. |
| 4 | ~2980–3700 | Real-time alerts | Centered: "learn more ›" link (15px), headline with orange-to-brown gradient (~48px), 2-line 16px paragraph (≈520 wide). Dark portrait image (person wearing headphones, low key light) centered under the text, a notification card (≈485×64, radius 14, blurred glass) overlapping it at the forehead line. | Notification slides/fades in; portrait fades in. |
| 5 | ~3100–3700 | Sync orbit | Centered: link, headline with yellow-green gradient, 2-line paragraph. Below: grid of ~9 rows of small round logo chips paired with a provider glyph, vignetted to black at the edges; center: large black circle with a neon ring glow and an app icon. | Ring glow color cycles (blue → green → yellow-green); chips shimmer. Pinned for ~1 s. |
| 6 | ~4050–5100 | Display mockup | Centered white headline (~48px) + 2-line gray paragraph. Large monitor (≈1124×650 screen on stand) with a landscape wallpaper and menu bar; a black app window inside. | Screen content scroll-animates; stand continues into next band. |
| 7 | ~5300–6300 | Command + weekly | Band background lifts slightly (~#0e0e0e with noise). Row 1: left headline + 3-line gray paragraph; right: two 3D keycaps (wide one with symbol + word, square one with a letter), dark glossy with rim light. Row 2: left newsletter card (envelope icon, meta line, title, 2-line excerpt fading right); right headline + 3-line paragraph with a white highlighted phrase. | Keycaps press; card text fades. |
| 8 | ~6400–7900 | News breakdown | Centered: small green pill tag, headline, 2-line paragraph. Then a tall app panel (≈760 wide, x 420→1180) with a top bar (close icon, timestamp, three tabs with underline on active), ticker pill, title, summary, three suggestion chips, a chart card, then a long article body and a quote card. Callout labels with dotted leaders sit outside the panel (left, right). | Panel content scrolls inside a sticky frame as the page scrolls. |
| 9 | ~7850–8100+ | Final CTA | Centered: orange 15px trial note, headline (~48px gradient), one-line gray paragraph, outlined pill button with glow. | — |
| 10 | (not in video) | Footer | From Mobbin capture: thin row, copyright left, link list right with a separator. | — |

Gaps: no mobile or tablet capture, no hover states, footer seen only as a low-res capture. Responsive behavior will be inferred from the desktop structure and the Refero tokens, and recorded as unverified.
