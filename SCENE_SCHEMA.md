# Scene format (shared by the engine, the API and the web app)

All geometry is in **local metres** around the bus stop: origin = the stop, **x = east, y = north, z = up**.
Angles in degrees. `rotation_deg` rotates a box counter-clockwise around its centre, seen from above.

```json
{
  "id": "hackney-mare-st-n",
  "name": "Mare Street (Stop N)",
  "lat": 51.5450, "lon": -0.0553,
  "date": "2026-07-19",                 // day to analyse (heatwave day)
  "hours": [9, 18],                     // local-time window to score
  "utc_offset": 1,                      // local time = UTC + this (BST = 1)
  "waiting_area": [[-3,-1],[3,-1],[3,1],[-3,1]],   // polygon where people stand/sit
  "buildable_area": [[-4,-2],[4,-2],[4,2],[-4,2]], // where a canopy/tree may go (optional)
  "occluders": [
    {
      "id": "b1", "kind": "building",   // building | shelter_roof | wall | tree | canopy
      "shape": "prism",                 // prism (polygon footprint) | box | cylinder | sphere
      "footprint": [[5,4],[25,4],[25,20],[5,20]],   // prism only
      "z0": 0, "z1": 12,
      "opacity": 1.0,                   // 1 = blocks all sun, 0.1 = clear glass, ~0.7 = tree foliage
      "source": "osm",                  // osm | argon | measured | proposal
      "confidence": 0.9,
      "note": "OSM building, 4 levels x 3 m"
    },
    { "id": "roof", "kind": "shelter_roof", "shape": "box",
      "center": [0, 0.5], "size": [4, 1.5], "rotation_deg": 0, "z0": 2.4, "z1": 2.5,
      "opacity": 0.1, "source": "argon", "confidence": 0.8, "note": "clear polycarbonate roof" },
    { "id": "t1", "kind": "tree", "shape": "sphere",
      "center": [-6, 3], "radius": 2.5, "z0": 3, "z1": 8, "opacity": 0.7, "source": "argon" },
    { "id": "pole", "kind": "wall", "shape": "cylinder",
      "center": [2, -1], "radius": 0.05, "z0": 0, "z1": 3, "opacity": 1.0, "source": "measured" }
  ],
  "proposals": [ /* same shape as occluders, kind "canopy" or "tree", source "proposal" */ ]
}
```

- **sphere**: `center` is [x,y]; sphere centre height is `(z0+z1)/2`, `radius` horizontal and vertical.
- **cylinder**: vertical, from `z0` to `z1`.
- **box**: oriented in plan by `rotation_deg`, flat between `z0` and `z1`.
- **prism**: any polygon footprint extruded from `z0` to `z1`.

## Engine outputs (`POST /api/score`)
```json
{
  "score": 0.11,                 // shaded fraction of waiting-area-hours, 0..1
  "by_time": [{"t": "09:00", "shade": 0.0, "sun_az": 98.1, "sun_el": 31.2}, ...],
  "cells": [{"x": -2.5, "y": -0.5, "shade": 0.05}, ...],   // per-cell daily shade (heatmap)
  "worst_time": "15:00",         // time with least shade while sun is up (the counterexample)
  "grid_step": 0.5, "minutes_step": 15
}
```
`GET /api/sun?lat&lon&date&time&utc_offset` → `{ "azimuth": deg clockwise from north, "elevation": deg, "dir": [x,y,z] unit vector towards the sun }`.
