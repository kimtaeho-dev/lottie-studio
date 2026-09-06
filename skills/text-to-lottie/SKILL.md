---
name: text-to-lottie
description: Create, edit, or fix Lottie/Bodymovin JSON animations for the local Skia Skottie player. Use for text-to-Lottie, SVG/logo/type animation, loaders/icons, state feedback, UI microinteractions, lower thirds, diagrams, data/stat/chart animations, product promos, scene/camera motion, visual effects, scene edits, slots/controls, and Skottie debugging.
---

# Text To Lottie

Author production-ready Lottie JSON for the official local Skia Skottie player.
The deliverable is a renderable scene in the player, not isolated JSON.

## Operating Model

- Use the official player project and verify in Skia Skottie. Do not hand-roll a
  custom viewer or switch renderers for verification.
- Keep the skill portable across Agent Skills clients. Avoid host-specific
  commands, command modes, or orchestration conventions in skill instructions.
- Prefer fewer questions and stronger defaults. Ask only when a decision changes
  the output materially, such as transparent vs full-frame background, brand
  constraints, target format, or supplied source assets.
- Prioritize clean, intentional, professional motion over merely satisfying the
  literal prompt.

## Reference Loading

This `SKILL.md` is the thin control plane. Load only one-level references that
match the task. Do not open the whole reference library.

Always read `references/player-contract.md` and
`references/renderer-constraints.md` before creating, editing, fixing, or
verifying a scene. If a routed reference is unavailable, continue using the
inline rules in this file.

| User intent | References to read when present |
| --- | --- |
| Any new/edit/fix Lottie scene | `references/player-contract.md`, `references/renderer-constraints.md` |
| JSON structure, keyframes, slots, shapes, assets | `references/lottie-spec-map.md` |
| Logo animation | `references/recipe-logo.md`, `references/motion-taste.md`, `references/design-taste.md` |
| Typography, title, quote, text reveal | `references/recipe-typography.md`, `references/design-taste.md`, `references/motion-taste.md` |
| Lower third, name tag, caption bar, overlay | `references/recipe-lower-thirds.md`, `references/design-taste.md`, `references/motion-taste.md` |
| Loader, icon, spinner, badge animation | `references/recipe-loaders-icons.md`, `references/motion-taste.md` |
| Success, error, warning, completion, empty state | `references/recipe-loaders-icons.md`, `references/design-taste.md`, `references/motion-taste.md` |
| UI microinteraction | `references/recipe-ui-microinteractions.md`, `references/design-taste.md`, `references/motion-taste.md` |
| Generic "animate this SVG" or SVG-to-Lottie | `references/recipe-svg-animation.md`, `references/svg-compatibility.md`, `references/motion-taste.md` |
| Camera follow, pan, zoom, parallax, scene motion | `references/recipe-camera-scene-motion.md`, `references/design-taste.md`, `references/motion-taste.md` |
| Diagram, technical line animation, callout, flow trace | `references/recipe-diagram-technical.md`, `references/design-taste.md`, `references/motion-taste.md` |
| Data, stats, KPIs, charts, metrics, dashboard figures | `references/recipe-data-stats.md`, `references/design-taste.md`, `references/motion-taste.md` |
| Product launch, feature announcement, social promo | `references/recipe-product-promo.md`, `references/design-taste.md`, `references/motion-taste.md` |
| Long text, multiple ideas, list/features/steps, timeline, before/after, problem/solution, quote+proof, recap/story, product walkthrough, multi-language variations, chapters, multi-beat sequence, episode, jump/hard cuts, transition grammar | `references/chapterization-transition-grammar.md`, `references/motion-taste.md` |
| Glow, glass, metal, gradient, fill, bubble/burst effects | `references/recipe-visual-effects.md`, `references/design-taste.md`, `references/motion-taste.md` |
| SVG input inside logo/icon/UI/lower-third work | The task recipe plus `references/svg-compatibility.md` |
| Starter brief or reusable project direction | `references/recipe-starter-projects.md`, `references/design-taste.md`, `references/motion-taste.md` |
| Any "premium", "clean", "minimal", "modern", "sleek", or "polished" qualifier | `references/design-taste.md` (restraint defaults), plus the routed recipe |

For mixed prompts, choose one primary recipe from the main deliverable, then add
secondary references for source format or visual treatment. Examples: SVG logo
with glow uses logo as primary plus SVG compatibility and visual effects;
product launch with pan/zoom uses product promo plus camera scene motion;
technical SVG diagram tracing uses diagram/technical plus SVG compatibility;
kinetic title with glass sweep uses typography plus visual effects.

## Workflow

1. Route the task using the table above. Read only the relevant references that
   exist.
2. Locate the official player project and resolve the target scene using the
   target precedence below. Before editing, verify the resolved path is
   `public/projects/<project>/<scene-N>/lottie.json`; re-read that current file
   immediately before overwriting because the UI can write slot edits back to
   source.
3. Decide the background policy before authoring.
4. Write or update `public/projects/<project>/<scene-N>/lottie.json` and, when
   useful, `controls.json`.
5. Validate JSON, run or reuse the dev server, inspect exact frames with
   `?frame=N`, and fix render/design/motion issues before finishing.

## Inline Rules

### Design Defaults (always apply)

These few defaults are non-negotiable and apply to every designed scene. Load
`references/design-taste.md` for the full reasoning, especially for any
"premium", "clean", "minimal", "modern", or "card" prompt.

- Premium means subtract, not add. When a prompt says premium, clean, minimal,
  modern, sleek, or sophisticated, default to restraint: remove chrome before
  adding it. Premium is carried by scale, weight, brightness, spacing, and
  timing, never by cards, borders, dividers, shadows, glow, or stacked tints.
- Chrome/container budget is `0` by default. Do not add a framing card,
  container, border, or divider unless it does a job that whitespace and
  alignment cannot. Separate grids and columns with negative space and alignment
  first, a single hairline second, and a filled or bordered card last and only
  when explicitly warranted.
- One surface tone. Use one background tone. Do not stack two near-black or two
  near-white tints to fake a "surface"; it reads muddy. If a card surface must
  differ from the background, make it one deliberate step with a clear purpose.
- One divider treatment, one color. If dividers are truly needed, use one weight
  and one color for all of them, title rule and column rules included. Never use
  slightly different colors or weights per divider.

### Scene Rules

- Scene files live at `public/projects/<project>/<scene-N>/lottie.json`.
- Resolve target scenes by authority: an explicit file path wins; a browser URL
  route like `/<project>/<scene>` wins next; an already-known project/scene for
  the task wins next; otherwise create a new safe scene. Use `/__context` only
  for discovery, verification, or playback state unless the task explicitly says
  to edit what is currently on screen and no more specific target exists. Do not
  let `/__context.live` override a known file path, URL, or project/scene.
  Overwrite `main-project/scene-1` only if it is still the untouched placeholder;
  otherwise create a new scene.
- Full-frame standalone compositions should include a visible background layer
  with a `bgColor` slot and `controls.json` entry.
- Transparent-by-default outputs include logos, icons, loaders, overlays, lower
  thirds, and SVG-derived assets unless the user asks for a background.
- Include top-level `v`, `fr`, `ip`, `op`, `w`, `h`, `nm`, `assets`, and
  `layers`. Treat `op` as exclusive.
- Use purposeful easing and staging. Avoid defaulting to linear motion. Derive
  easing from the behavior-based anchors in `motion-taste.md` (chosen by motion
  behavior, focal element strongest); do not fall back to one uniform ease for
  every layer.
- Use slots for important editable values and add `controls.json` labels/ranges
  when they improve the properties panel.
- For SVG input, preserve the viewBox, normalize styling, watch fill rules and
  intersections, and verify the result in Skottie.
- Convert text to outlines. Native Lottie text (`ty:5`) renders in this player's
  Skottie preview, but our production playback is lottie-web 5.x SVG, which shapes
  text through CSS `@font-face` instead of the scene's embedded font file. Letter
  spacing, baselines, and wrap points land differently, and a font that fails to
  load falls back to a system face with no error. So bake glyphs to `ty:"sh"`
  outlines for anything shipped as a production asset. This costs the text-slot
  editing affordance — that trade is correct here, and when copy is still in flux,
  author with native text and outline it as the last step before delivery. The
  compatibility scanner treats `ty:5` as BLOCK. See
  `references/renderer-constraints.md`.

## Verification

A scene is done only when the completion conditions in
`references/renderer-constraints.md` all pass, in order. Do not stop early:
"it looks right in the preview" is not done, because the preview is not the
renderer that ships.

1. Confirm the intended target file path is
   `public/projects/<project>/<scene-N>/lottie.json`.
2. Validate JSON:

   ```bash
   node -e "JSON.parse(require('fs').readFileSync('public/projects/<project>/<scene-N>/lottie.json','utf8'))"
   ```

3. Run the lottie-web compatibility scanner and get **zero BLOCK findings**
   (exit code 0):

   ```bash
   node scripts/check-lottie-web-compat.mjs public/projects/<project>/<scene-N>/lottie.json
   ```

   WARN findings do not fail the run. Each one marks a construct the two
   renderers may draw differently — carry it into step 5 and look at it.
4. Run the motion smoothness check to catch easing-curve defects that no
   still-frame check can see (e.g. a keyframe's time-axis derivative
   stalling mid-segment while the value keeps changing, which snaps on
   playback):

   ```bash
   node scripts/check-motion-smoothness.mjs public/projects/<project>/<scene-N>/lottie.json
   ```

   This is headless — no browser needed — so it still runs where browser
   automation (e.g. the Claude in Chrome extension) is unavailable.
5. Open the comparison page and pin frames `0`, the midpoint, and `op - 1`
   (when a browser is available — see the note below if it is not):

   ```
   /compare.html?src=/projects/<project>/<scene-N>/lottie.json
   ```

   Inspect **both** panels at each frame — Skottie on the left, lottie-web SVG
   on the right. Checking only one panel is not verification. At the same time
   check for blank canvas, missing assets, unstyled shapes, wrong layer order,
   bad easing, awkward timing, cropped content, text overflow, and visible SVG
   artifacts. This is a still-frame check, not a playback check — it does not
   replace step 4.

   > If no browser automation is available, skip this step and rely on steps
   > 1–4 (all headless). They catch most authoring mistakes, but purely visual
   > judgment calls (color, layout, typography) still need a human to open the
   > player.
6. Remove the cause of any difference between the panels. If the difference
   traces to a WARN finding, replace that construct with the alternative given
   in `references/renderer-constraints.md`.
7. Confirm the background policy matches the use case. Use the comparison
   page's checkerboard to confirm transparency.

## Maintenance Evals

Do not read eval files during normal animation work. Use them only when testing
or changing this skill:

- `evals/trigger-prompts.json`
- `evals/routing-prompts.json`
- `evals/reference-loading-prompts.json`
- `evals/output-rubric.md`
