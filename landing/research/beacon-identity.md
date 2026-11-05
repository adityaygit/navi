# Beacon — identity exploration (landing page sprint)

Scope: an exploration for the public landing page only. Nothing here is a requirement for the app yet.

## Three directions (generated with Gemini `gemini-3-pro-image`, originals in `assets-src/`, not committed)

| Direction | Form and material | As a hero object | As a small UI mark | As an animated presence | Verdict |
|---|---|---|---|---|---|
| A. Lodestone (`beacon-lodestone-*`) | Tall faceted spire of smoked obsidian with an inner seam of light | Dramatic, but busy; reads as "AI crystal" | Lean and facets collapse into a generic shard below 24px | Seam can pulse, but facets fight the light | Rejected: closest to the generic look we want to avoid |
| B. Lantern (`beacon-lantern-*`) | Rounded alabaster monolith; a slot splits its crown; light comes from inside the stone | Calm, physical, museum-like; beautiful unlit (veined stone) | Arch + slit is a clean, ownable glyph at 16px | Light inside the stone can change colour and intensity without the form changing | **Selected** |
| C. Fold (`beacon-fold-*`) | One pane of frosted glass folded into an arrowhead | Elegant, ties to the old mark | Strong as a mark | Cold; reads as display glass; little warmth or presence | Rejected for now; the arrowhead mark can retire |

## Why the Lantern
- **Silhouette first.** The split crown is recognisable in a 16px icon and in a full-bleed photograph.
- **Beautiful without glow.** Unlit, it is just pale stone (see `beacon-rest`), so the light feels like a choice, not decoration.
- **Contextual colour lives inside it.** Black stays constant; the stone's inner light carries the context (warm for morning guidance, cool for listening, jade for confirmation, violet for evening review). The UI around it stays monochrome.
- **Kinship with the protected rock section.** Both are stone objects on black; the rock is the world, the Beacon is the guide in it.
- **Navigation without literal maps.** The slot is a path through the stone: direction implied, never drawn as a compass.

## States (landing page implementation)
| State | Image | Code behaviour |
|---|---|---|
| Resting | `beacon-rest` | No inner light; slow ambient breathing on the floor pool only |
| Listening | `beacon-listen` | Cool light, intensity follows a voice-like envelope |
| Thinking | `beacon-listen` → `beacon-dawn` | Light slowly travels up the slot (masked gradient) |
| Speaking | `beacon-dawn` | Light pulses with speech rhythm |
| Guiding | `beacon-dawn` | Steady warm light; floor pool extends toward the content |
| Confirming | `beacon-confirm` | One jade bloom, then settles to rest |
| Evening review | `beacon-evening` | Dim violet, steady |

The small mark (`BeaconMark` in code) is an SVG arch with a slit; its slit carries the same state colour.

## Waypoints vocabulary (light touch)
Used sparingly in copy and UI labels on the landing page only: a plan is a route through the day; Navi's suggestions are signals. Product terms stay as they are in the app (tasks, plan, inbox, review).
