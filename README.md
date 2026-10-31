# Orthotics Builder

Design 3D-printable foot orthotics from a tape measure. No 3D scan, no CAD skills, no install. Start from your foot's length and widths, photograph a tracing and let the page read them off, or measure an orthotic you already have. Then shape the arch, heel cup, posts and met pad with sliders, and download an STL ready for your slicer.

**Use it:** https://markusg1234.github.io/Orthotics-builder/

![Orthotics Builder showing a pair of full-length orthotics coloured by height](docs/screenshot.png)

## What you can adjust

| Area | Settings |
|---|---|
| Your foot | Foot length, ball width, heel width, from a tape measure, a photo, or a starting point from your shoe size (AU/UK, US, EU) |
| Length | 3/4 (ends behind the ball of the foot), sulcus (ends at the toe crease) or full length |
| Arch | Height, peak position, how far across the foot it reaches, outer arch |
| Heel | Heel cup depth, heel lift, rearfoot post angle |
| Forefoot | Metatarsal pad height and position, forefoot post angle |
| Print | Solid flat base or shell, heel/arch and forefoot thickness, material (TPU, PETG, PLA) |

The preview updates live. You can view one foot or the pair, switch to top, inner-side and heel views, and colour the surface by height. The page warns you about measurements or settings that look unusual.

**Download** gives a binary STL in millimetres. The base sits flat on Z = 0 and the toes point along +X. Choosing **Pair** puts both feet side by side in one file. **Save settings** and **Load settings** keep your values in a small JSON file so you can come back and tweak them.

## How to measure

1. Stand on a sheet of paper against a wall, with your weight on that foot.
2. Trace around the foot with the pen held upright.
3. **Length:** heel line to the tip of the longest toe.
4. **Ball width:** widest point across the ball, from the big-toe joint to the little-toe joint.
5. **Heel width:** widest point of the heel, 2–3 cm in from the back.
6. Measure both feet. They often differ by a few millimetres, so design each one with its own numbers.

The page also draws the outline it generated from your numbers, so you can lay it against your tracing.

## Photograph it instead

**Measure from a photo** at the top of the settings reads the measurements off a photo, so you need a phone and a sheet of paper rather than a tape measure. The sheet is a known size, so marking its four corners cancels out the angle you held the camera at, instead of just scaling by a reference length. Expect about a millimetre or two, which is as good as a careful tape measure.

Photograph the sheet so it fills the frame, in even light, avoiding an ultra-wide lens. The page tries to find the sheet by itself and puts four markers on its corners; drag any that are off, or nudge them with the arrow keys. Four things it can read:

| What you photograph | What it gives you |
|---|---|
| **A foot tracing** | Foot length, ball width and heel width. Trace with the pen held upright, then lay the sheet flat. |
| **A wet footprint** | Which way your arch leans, from how wide the middle of the print is next to the widest part. Standing flattens the arch, and that is the point: the index is defined on a loaded print, and it is the flattening that tells a high arch from a flat one. A print leaves the toes out, so it will not set your foot length. |
| **An insole or orthotic** | Its outline, matched through the same solver as *Copy an existing orthotic*. An insole out of a shoe that fits you is the easiest thing to photograph. |
| **A side view** | Arch height and where the arch peaks, which nothing else here can measure. No paper and nothing to prop up: your own foot length is the ruler. |

A4 holds a foot up to about 290 mm. Longer than that will not fit, so tape two A4 sheets together along their long edges and mark the corners of the whole rectangle.

The side view needs no reference object at all, because your foot is one. Lay a sheet of white paper on the floor on the **far** side of that foot, so the gap under the arch shows up bright against it, then put the phone on the floor on the near side about half a metre away and take the photo square on. Then mark three points: **H** on the back of your heel and **T** on the tip of your longest toe, both right down where they meet the floor, and **A** on the highest point of the arch underneath.

Heel and toe are both on the floor, so the line between them *is* the floor, and the distance between them is the foot length you have already measured. The arch height is then how far **A** stands off that line. Because the floor comes from your own two marks rather than from the picture, it does not matter how big your foot lands in the frame or whether you held the phone level.

What does matter is being square on. Nothing here corrects for perspective, so a camera turned or tilted about 15° away reads the arch roughly 3% high. It also means the arch height is only as good as the foot length it is scaled from, so measure that first.

The arch you have to support is the one you stand on, and the page builds all of it
by default, so the orthotic meets your arch along its whole length.

Say whether you were standing on that foot, because that is a different arch:

- **Standing**, your arch is already pressed down as far as it goes. The gap under
  it is at its smallest, but for most feet it is still there — it is the same gap
  that leaves the narrow waist in a wet footprint. Smaller means harder to see,
  which is what the paper is for, but what you measure is the arch you actually
  have to support, and it is built whole. If the arch really does flatten onto the
  floor, that is a flat foot under load: widen the arch spread rather than raising
  the arch.
- **Sitting**, with no weight on the foot, the arch springs back up — usually 6–9 mm,
  the navicular drop. That is an arch you will never stand on, so about 7 mm comes
  off before building. This is the same correction as the arch fill of plaster
  casting, and it is not less support: measure one foot both ways and you get the
  same orthotic. Build the sitting height in full instead and it would lift your
  arch rather than meet it.

Standing measures your own arch instead of estimating it, so it is the more accurate
of the two; sitting is worth reaching for when you simply cannot make the gap out.
The slider runs
from 60% to 130% of the arch you stand on: under it leaves a gap in quiet standing
that closes again as the foot flattens in walking, which is a gentler way to break a
first orthotic in, and over it lifts the arch above where it stands. Photographs read
arch height a little high compared with calipers, so treat a first fit as a starting
point and go up 2 mm at a time.

## Copy an existing orthotic

Have an orthotic that already works for you, from a podiatrist or a shop? Open **Copy an existing orthotic** at the top of the settings, measure it, and the designer sets itself to match. You need a flat table, paper, a pen, a steel rule, and digital calipers if you have them. All measurements are in millimetres.

1. Note where it ends: behind the ball of the foot (3/4), at the toe crease (sulcus) or full length. Check whether the underside is flat or hollow under the arch.
2. Lay it flat on paper and trace around it with the pen held upright. From the tracing, measure:
   1. **Overall length:** back of the heel to the front tip.
   2. **Widest width:** the widest point of the tracing.
   3. **Heel width:** across the heel, 2–3 cm in from the back.
3. Put the orthotic on the table. Measure these heights from the table up to the top surface, with the calipers' depth rod or a steel rule stood on end:
   4. **Heel seat height:** the middle of the heel seat.
   5. **Heel rim height:** the top of the heel cup at the very back.
   6. **Arch height:** the top of the inner edge where the arch is highest.
4. Measure along the tracing:
   7. **Arch position:** from the back of the heel to that highest point.
5. For toe-crease and full-length orthotics, measure the **forefoot thickness** (8) under the ball with calipers.
6. Optional, only if your orthotic has them:
   - **Met pad height and position** (9, 10): the dome's height above the surface around it, and the distance from the back of the heel to its centre.
   - **Heel lift pad** (11): the thickness of a separate pad stuck under the heel.
   - **Wedges** (12, 13): for a wedge under the heel or the forefoot, its thickness at the inner and outer edges and its width across the foot. The tool turns these into post angles.
7. Press **Match this orthotic**. The tool works out the settings, then shows your measurements next to the same measurements of the new design so you can check they line up. Fine-tune with the sliders afterwards.

The match is as good as the measurements. Shapes this tool doesn't model, such as a deep skive or an unusual outline, come out as the closest design it can make.

## Printing

| Material | Suggested settings |
|---|---|
| TPU 95A | 2–3 walls, 15–25% gyroid infill, 20–30 mm/s. Flexible and durable, the best all-round choice. |
| PETG | 4 walls, 30–40% infill. Firm shell, add a foam top cover for comfort. |
| PLA | Good for test fits only. It cracks under repeated flexing. |

Print with the flat base on the bed. The solid style needs no supports. The shell style is hollow under the arch and needs supports there.

Start with a modest arch (10–15 mm for most adults), wear the orthotic for a few days, then go up 2 mm at a time.

## How it works

The geometry engine (`src/geometry.js`) is plain JavaScript with no dependencies:

- **Outline.** The inner and outer edges come from monotone cubic curves fitted through stations along the foot, scaled from your length, ball width and heel width. The heel is rounded, and the end of the orthotic is shaped for the length you chose. The big toe is longest at full length, and the 3/4 and sulcus ends follow the slant of the metatarsal heads.
- **Height field.** The top surface adds up the base thickness, the posts and lifts, the arch (a cosine profile along the foot times a smooth ramp across it), the heel cup (a function of true distance to the edge), and the met pad (a teardrop dome). The heel cup and the arch are blended with a smooth maximum so the cup wall flows into the arch instead of stacking on it.
- **Mesh.** A 150 × 56 grid, denser near the ends and edges, becomes a top surface, a bottom surface (flat, or following the arch for the shell style) and side walls. The result is a closed, consistently wound mesh. Left feet are mirrored from right feet.

The photo engine (`src/photo.js`) has no dependencies either, and works on a plain pixel buffer so the tests can run it without a browser:

- **The sheet.** A quadrilateral fitted to the convex hull of the brightest large region, then refined by least-squares fitting lines to each side and intersecting them. If it does not look like the paper you chose, the page says so and you place the corners yourself.
- **Millimetres.** The four corners give a homography, solved as an 8x8 system, which resamples the sheet into a grid at four pixels per millimetre.
- **The outline.** Otsu's threshold, then a flood fill from the edge of the sheet. A pen line is closed up first to bridge gaps, and what the line encloses is grown back out to its inner edge, which is where the foot was. A footprint or an insole is already a filled shape, so it is taken as it is.
- **The measurements.** The boundary is traced, simplified, and turned onto the axis between the back of the heel and the longest toe, then measured the same way the instructions tell you to measure by hand.

The page (`src/app.html`) uses [three.js](https://threejs.org/) for the preview and [JSZip](https://stuk.github.io/jszip/) for packaged downloads, both loaded from public CDNs.

## Development

```bash
python3 build.py              # inline the src/*.js engines into src/app.html → index.html
node tests/check_mesh.js      # watertightness and sanity checks across many settings
node tests/check_photo.js     # photo pipeline, against synthesised photos of known designs
python3 build.py --check      # confirm index.html matches the sources
```

`tests/check_photo.js` draws a known design onto a sheet, warps it through a perspective
transform, adds a lighting gradient and noise, and checks the pipeline measures the design back
out of it.

Edit the files in `src/`, then run `build.py`. `index.html` is generated and is what GitHub Pages serves. CI runs the mesh checks and the up-to-date check on every push.

To run it locally, open `index.html` in a browser, or serve the folder with `python3 -m http.server`.

## Safety

These are general-purpose supports, not a medical device, and this tool does not diagnose or treat anything. If you have diabetes, poor circulation, numbness or ongoing foot pain, see a podiatrist before using orthotics you have made yourself. A podiatrist can also give you the arch height and post angles to enter here. The arch type a footprint suggests is a place to start from, not a diagnosis: the published thresholds for it vary widely and most of the research behind them is in children.

## Licence

MIT. See [LICENSE](LICENSE).
