# Velix Feature Implementation Audit

Status legend:

- **Full**: the feature is implemented end to end in the current app.
- **Half**: there is visible or code-level support, but the implementation is incomplete, limited, or missing important expected behavior.
- **Missing**: no meaningful implementation was found.

Evidence reviewed: `src/routes/+page.svelte`, `src/routes/page-route.svelte.spec.ts`, `src/routes/api/route/+server.ts`, `src/lib/server/graphhopper.ts`, `src/lib/route-planning.ts`, `src/lib/route-gpx-import.ts`, `src/lib/route-export.ts`, `src/lib/saved-routes.svelte.ts`, `src/routes/routes/+page.svelte`, `src/routes/settings/+page.svelte`, `src/lib/map/basemaps.ts`, `src/lib/map-style-settings.svelte.ts`, `src/lib/components/map-view.svelte`, and `src/lib/components/map-view.svelte.spec.ts`.

## 1. Routing & Route Builder

### 1.1 Route planning entry

| Feature | Status | Notes |
| --- | --- | --- |
| Set a start point via search, map click, or current location | Full | Start input supports search suggestions, map-click assignment, and explicit browser geolocation with reverse-geocode fallback. |
| Set a destination via search, map click, or current location | Full | Destination input supports search suggestions, map-click assignment, and explicit browser geolocation in point-to-point mode. |
| Create a loop instead of a point-to-point route | Full | Round-course mode generates loop routes. |
| Derive a route from a saved route | Half | Saved routes can be reopened into the planner via `?savedRoute=...`; no explicit "derive from" workflow/version split. |
| Import a GPX route and edit it | Half | GPX import exists and imported stops can be edited then rerouted; direct geometry editing is not implemented. |
| Build a route from multiple waypoints | Half | Up to three intermediate waypoints are supported, not arbitrary multi-waypoint route building. |
| Generate an out-and-back route | Missing | No out-and-back mode or share control. |
| Plan a route within a specific area or corridor | Missing | No area/corridor constraint controls. |

### 1.2 Routing modes

| Feature | Status | Notes |
| --- | --- | --- |
| A-to-B route | Full | Point-to-point mode is implemented. |
| Loop by distance | Full | Round-course target distance is implemented. |
| Loop by time | Half | UI accepts target time and estimates a distance; GraphHopper still receives a distance-based round trip. |
| Loop by elevation gain | Half | UI accepts climb target and searches distance candidates; no native elevation-constrained routing. |
| Fully manual planning | Missing | No manual segment drawing or manual/automatic section modes. |
| Training route based on a workout goal | Missing | No workout-goal route generator. |
| Route based on existing heatmap/popularity data | Missing | No heatmap/popularity data source. |
| "Best roads near me" quick generator | Missing | Current-location support exists for route endpoints, but there is no quick generator/discovery workflow. |

### 1.3 Road-cycling-specific optimization

| Feature | Status | Notes |
| --- | --- | --- |
| Prefer asphalt | Half | GraphHopper custom model strongly penalizes unpaved and rough surfaces; no user control or guarantee. |
| Avoid poor surfaces | Half | Rough surface penalties exist via `surface` and `smoothness` rules. |
| Avoid cobblestones | Half | Cobblestone-like surfaces are penalized, not strictly avoided. |
| Minimize stop-and-go | Missing | No stop/turn/interruption model. |
| Minimize traffic lights | Missing | No traffic-light data or parameter. |
| Avoid city traffic | Half | Residential/service/main road classes are penalized, but no city traffic model. |
| Use main roads only when they are fast and rideable | Missing | Main roads are simply penalized; no speed/rideability exception logic. |
| Avoid small, poor-quality farm/service roads | Half | Service roads and poor surfaces are penalized, but farm-road quality is not modeled. |
| Prefer roads with good riding flow | Missing | No flow score or uninterrupted-road model. |
| Handle descents/climbs deliberately | Missing | No climb/descent routing strategy beyond elevation metrics. |
| Prefer flatter routes | Missing | No flat preference control. |
| Prefer hillier routes | Half | Loop by climb approximates this for round courses only. |
| Prefer even effort distribution | Missing | No effort distribution model. |
| Prefer long uninterrupted sections | Missing | No uninterrupted-section optimizer. |

### 1.4 Training-focused routing profiles

| Feature | Status | Notes |
| --- | --- | --- |
| Recovery Ride | Missing | No training profiles. |
| Endurance / Zone 2 | Missing | No training profiles. |
| Tempo | Missing | No training profiles. |
| Threshold | Missing | No training profiles. |
| Sweet Spot | Missing | No training profiles. |
| VO2max-oriented route | Missing | No training profiles. |
| Sprint-oriented route | Missing | No training profiles. |
| Climbing Session | Missing | No training profiles. |
| Long Ride | Missing | No training profiles. |
| Race Simulation | Missing | No training profiles. |
| Group Ride / fast ride | Missing | No training profiles. |
| Commute / practical route | Missing | No training profiles. |

### 1.5 Advanced routing parameters

| Feature | Status | Notes |
| --- | --- | --- |
| Target distance | Full | Implemented for round-course planning. |
| Target ride time | Half | Implemented as an estimated-distance loop target, not a true time-constrained route. |
| Target elevation gain | Half | Implemented as an estimated-distance loop search target, not a true elevation-constrained route. |
| Maximum gradient | Missing | No max-gradient parameter. |
| Minimum/desired number of climbs | Missing | No climb count parameter. |
| Maximum number of stops | Missing | No stop-count parameter. |
| Maximum urban share | Missing | No urban-share parameter. |
| Minimum share of quiet roads | Missing | No quiet-road parameter. |
| Desired surface mix | Missing | Surface mix is analyzed, not parameterized. |
| Consider wind direction | Missing | A wind button exists visually, but no wind logic. |
| Start and end elevation | Missing | Elevation is analyzed from route geometry, not specified by user. |
| Same start/end point or different | Full | Point-to-point and round-course modes cover this. |
| Route should be more direct or higher quality | Missing | No directness/quality tradeoff control. |
| Loop share / out-and-back share | Missing | No share controls. |
| Route should avoid or include cafés / water / services | Missing | No POI inclusion/exclusion controls. |

### 1.6 Alternative routes

| Feature | Status | Notes |
| --- | --- | --- |
| Generate 2-5 alternatives | Half | Requests up to three alternatives; actual count depends on GraphHopper/deduping. |
| Sort alternatives by criteria | Half | Round-course candidates are internally ranked by target fit; no user-facing sort criteria. |
| Show differences between alternatives | Half | Alternative cards compare distance, duration, and climb only. |
| Alternative with more climbing / less traffic / better asphalt | Missing | No targeted alternative-generation options. |
| Compare two routes side by side | Missing | Alternatives are listed, but no side-by-side comparison view. |
| Quickly switch between variants | Full | Alternative cards switch the selected route. |

### 1.7 Interactive route editing

| Feature | Status | Notes |
| --- | --- | --- |
| Add waypoint | Full | Waypoints can be added from the form or map click. |
| Move waypoint | Half | Waypoints can be reordered in the form; markers cannot be dragged on the map. |
| Drag the route along segments | Missing | No route dragging. |
| Lock / pin a segment | Missing | No segment locking. |
| Recalculate a subsection | Missing | Only the full route can be recalculated. |
| Force a specific road | Missing | No forced-road segment control. |
| Avoid a specific road | Missing | No avoid-road control. |
| Plan sections manually or automatically | Missing | No per-section mode. |
| Undo / Redo | Missing | No undo/redo. |
| History of recent editing steps | Missing | No edit history. |

## 2. Map & Map Experience

### 2.1 Basemap system

| Feature | Status | Notes |
| --- | --- | --- |
| Multiple selectable basemaps | Full | Five basemap definitions are present, gated by provider API keys. |
| Light Road | Full | Stadia Alidade Smooth. |
| Dark Road | Full | Stadia Alidade Smooth Dark. |
| Terrain / Outdoor | Full | Stadia Stamen Terrain and MapTiler Outdoor. |
| Satellite / Hybrid | Full | MapTiler Satellite Hybrid. |
| Basemap selection in settings | Full | Settings page has a basemap radiogroup. |
| Quick basemap switching inside the planner | Missing | Planner only shows attribution, not a basemap switcher. |
| Save basemap per device/account | Half | Saved per browser/device in `localStorage`; no account sync. |

### 2.2 Map interactions

| Feature | Status | Notes |
| --- | --- | --- |
| Zoom, pan, recenter | Half | MapLibre provides zoom/pan and current-location centering; no general recenter-to-route or recenter-to-start control. |
| Double-click / click to place points | Full | Click opens a menu to set start, destination, or waypoint. |
| Hover on roads/segments | Missing | No road/segment hover inspection. |
| Context menu for routing actions | Half | A click popover exists; no right-click/context menu. |
| Show current location | Full | Explicit geolocation control requests permission, centers the map, and renders a current-position marker with optional accuracy ring. |
| Show coordinates | Half | Click popover shows coordinate fallback when reverse geocoding is unavailable. |
| Scale bar | Missing | No scale control. |
| Fullscreen map | Half | Planner is map-first/full viewport, but no browser fullscreen toggle. |
| Mini control bar | Missing | No compact map control bar beyond overlay buttons. |

### 2.3 Map layers / overlays

| Feature | Status | Notes |
| --- | --- | --- |
| Route | Full | Selected route line is rendered. |
| Alternative route | Full | Unselected alternatives are rendered as subdued lines. |
| Surface overlay | Missing | Surface is analyzed in panel, not rendered as map overlay. |
| Traffic stress overlay | Missing | No traffic stress data. |
| Wind overlay | Missing | No wind overlay. |
| Gradient overlay | Missing | No gradient overlay. |
| Heatmap of popular road cycling roads | Missing | No heatmap layer. |
| Contours / terrain | Half | Available only through terrain/outdoor basemap styles, not a separate overlay. |
| Road classification | Missing | Road class is requested from GraphHopper details but not exposed as overlay. |
| Hillshade | Half | May be present in terrain basemap; no dedicated overlay control. |
| Weather overlay | Missing | No weather data. |
| Hazard / warning overlay | Missing | No hazard layer. |
| Mark OSM data issues | Missing | No OSM issue layer. |
| Show saved routes as overlays | Missing | Saved routes are listed separately, not overlaid on the planner map. |

### 2.4 Map elements

| Feature | Status | Notes |
| --- | --- | --- |
| Start and destination markers | Full | Rendered for selected point-to-point route. |
| Current location marker | Full | Rendered independently of route overlays after explicit geolocation, including style-change rehydration. |
| Waypoints | Full | Rendered for selected route. |
| Climb markers | Missing | No climb detection/markers. |
| Supply points | Missing | No supply POIs. |
| Hazard points | Missing | No hazards. |
| Favorites | Missing | No favorite places/markers. |
| Segment markers | Missing | No segment markers. |
| Route direction arrows | Missing | No direction arrows. |
| Kilometer markers | Missing | No kilometer markers. |

## 3. Route Analysis

### 3.1 Basic metrics

| Feature | Status | Notes |
| --- | --- | --- |
| Distance | Full | Shown in summary and alternative cards. |
| Estimated ride time | Full | GraphHopper time shown for generated routes; GPX time shown if timestamps exist. |
| Elevation gain | Full | Shown in summary and analysis. |
| Elevation loss | Full | Shown in summary. |
| Average gradient | Missing | Not calculated/displayed. |
| Maximum gradient | Missing | Not calculated/displayed. |
| Minimum/maximum elevation | Full | Elevation panel shows min/max. |
| Number of turns | Missing | Route requests set `instructions: false`; no turn count. |
| Number of waypoints | Half | Waypoints are visible/listed, but no explicit count metric. |
| Loop quality | Missing | No loop-quality metric. |

### 3.2 Road-cycling-specific quality metrics

| Feature | Status | Notes |
| --- | --- | --- |
| Asphalt share | Half | Surface mix groups "smooth" surfaces, but not asphalt specifically. |
| Smooth surface share | Full | Surface mix calculates smooth share from surface/smoothness details. |
| Poor surface share | Full | Surface mix calculates coarse share. |
| Traffic stress score | Missing | No traffic stress score. |
| Stop-and-go score | Missing | No stop-and-go score. |
| Flow score | Missing | No flow score. |
| Safety score | Missing | No safety score. |
| Road quality score | Missing | No aggregate road-quality score. |
| Scenic score optional | Missing | No scenic model. |
| Training suitability score | Missing | No training score. |
| Interruption risk | Missing | No interruption model. |
| Urban exposure | Missing | No urban exposure metric. |
| Climb density | Missing | No climb-density metric. |
| Descent quality | Missing | No descent-quality metric. |
| Route efficiency | Missing | No efficiency metric. |

### 3.3 Segment analysis

| Feature | Status | Notes |
| --- | --- | --- |
| Sections by surface | Half | Surface details are fetched and summarized as mix, but section-by-section list/map is absent. |
| Sections by gradient | Missing | No gradient section analysis. |
| Sections by road type | Missing | Road class details are fetched from GraphHopper but not stored/displayed in `PlannedRoute`. |
| Sections with high interruption probability | Missing | No interruption probability analysis. |
| Sections suitable for intervals | Missing | No interval suitability analysis. |
| Sections with headwind / tailwind | Missing | No wind analysis. |
| Segment-level duration and distance estimates | Missing | No segment list with durations/distances. |

### 3.4 Elevation profile

| Feature | Status | Notes |
| --- | --- | --- |
| Full elevation profile | Full | Elevation chart is rendered from route coordinates. |
| Interactive hover linking chart and map | Full | Pointer hover/scrub updates a highlighted map point. |
| Climb detection | Missing | No climb detection. |
| Climb classification | Missing | No climb classification. |
| Gradient by section | Missing | No gradient section display. |
| Descent analysis | Missing | No descent analysis. |
| Highlight key climbs | Missing | No key climb highlighting. |
| Compare profiles of two routes | Missing | Only selected route profile is shown. |

### 3.5 Weather and environmental analysis

| Feature | Status | Notes |
| --- | --- | --- |
| Wind direction | Missing | Wind icon exists, no data/logic. |
| Headwind / tailwind share | Missing | No wind analysis. |
| Wind-critical sections | Missing | No wind analysis. |
| Temperature | Missing | No weather data. |
| Rain probability | Missing | No weather data. |
| Weather warnings | Missing | No weather data. |
| Time-of-day-based hints | Missing | No time-of-day logic. |
| Sun position / lighting conditions optional | Missing | No lighting/sun logic. |

## 4. Training-Oriented Features

### 4.1 Training goal selection

| Feature | Status | Notes |
| --- | --- | --- |
| Recovery | Missing | No training goal selector. |
| Endurance | Missing | No training goal selector. |
| Tempo | Missing | No training goal selector. |
| Threshold | Missing | No training goal selector. |
| VO2max | Missing | No training goal selector. |
| Sprint | Missing | No training goal selector. |
| Long Ride | Missing | No training goal selector. |
| Climbing | Missing | No training goal selector. |
| Race Prep | Missing | No training goal selector. |

### 4.2 Training-specific route suitability

| Feature | Status | Notes |
| --- | --- | --- |
| Suitable for steady Zone 2 work | Missing | No suitability model. |
| Suitable for long tempo intervals | Missing | No suitability model. |
| Suitable for short hard intervals | Missing | No suitability model. |
| Suitable for hill repeats | Missing | No suitability model. |
| Suitable for sprint sections | Missing | No suitability model. |
| Suitable for recovery rides with few interruptions | Missing | No suitability model. |
| Suitable for long endurance rides | Missing | No suitability model. |

### 4.3 Session-oriented planning

| Feature | Status | Notes |
| --- | --- | --- |
| "I have 75 minutes" | Half | Loop-by-time can approximate this, but no natural-language/session workflow. |
| "I want 90 km with few stops" | Half | Distance target exists for loops; "few stops" is not modeled. |
| "I need 3x15 min tempo" | Missing | No interval/session block planner. |
| "I want 5x5 min uphill" | Missing | No hill interval planner. |
| "I need an easy recovery loop" | Missing | No recovery loop profile. |
| Generate a suitable route from that | Missing | No session-to-route suitability generator. |

### 4.4 Route-level training metrics

| Feature | Status | Notes |
| --- | --- | --- |
| Estimated training load | Missing | No training load model. |
| Estimated intensity distribution | Missing | No intensity model. |
| Interruption risk for interval sessions | Missing | No interruption model. |
| Expected variability of effort | Missing | No effort variability model. |
| Suitability for pacing | Missing | No pacing suitability score. |
| Aero / speed suitability | Missing | No aero/speed suitability score. |
| Group-ride suitable vs solo-ride suitable | Missing | No group/solo suitability model. |

## 5. Save, Organize, and Reuse Routes

### 5.1 Saving

| Feature | Status | Notes |
| --- | --- | --- |
| Save route | Full | Active route can be saved locally. |
| Save as draft | Full | Button is labeled "Save Draft"; saved locally. |
| Publish final route | Missing | No publish/public route flow. |
| Auto-save while editing | Missing | No auto-save. |
| Save route variants | Half | User can select an alternative and save it; no grouped variant set. |

### 5.2 Organization

| Feature | Status | Notes |
| --- | --- | --- |
| Folders / collections | Missing | No collections. |
| Tags | Missing | No tags. |
| Favorites | Missing | No favorites. |
| Recently planned | Half | Saved routes are ordered by created date; unsaved recent plans are not tracked. |
| Seasonal collections | Missing | No seasonal collections. |
| Training-specific collections | Missing | No training collections. |
| Search saved routes | Missing | No route-library search. |
| Filter by distance, elevation, region, purpose | Missing | No filters. |

### 5.3 Versioning

| Feature | Status | Notes |
| --- | --- | --- |
| Duplicate route | Half | Opening a saved route and saving after edits creates another saved route, but no explicit duplicate action. |
| Compare changes | Missing | No diff/compare. |
| Restore previous version | Missing | No versions. |
| Show change history | Missing | No history. |

### 5.4 Personal library

| Feature | Status | Notes |
| --- | --- | --- |
| Favorite loops | Missing | No categorization/favorites. |
| Fast after-work rides | Missing | No categorization. |
| Long weekend routes | Missing | No categorization. |
| Mountain routes | Missing | No categorization. |
| Flat aero routes | Missing | No categorization. |
| Proven interval loops | Missing | No categorization. |

## 6. Export, Devices, and Integrations

### 6.1 Exports

| Feature | Status | Notes |
| --- | --- | --- |
| GPX export | Full | GPX download is implemented. |
| FIT export optional | Missing | No FIT export. |
| TCX optional | Missing | No TCX export. |
| Download with waypoints / cue sheet | Half | GPX includes waypoint entries; no cue sheet. |
| Export with climb metadata | Missing | No climb metadata. |
| Export with simplified or full geometry | Missing | Always exports full track geometry. |

### 6.2 Device sync

| Feature | Status | Notes |
| --- | --- | --- |
| Garmin | Missing | No Garmin integration. |
| Wahoo | Missing | No Wahoo integration. |
| Hammerhead optional | Missing | No Hammerhead integration. |
| Komoot / Strava import optional | Missing | No Komoot/Strava integration. |
| Automatic sync of new routes | Missing | No device sync. |
| Send route to device | Missing | No device sync. |
| Show sync status | Missing | No device sync. |

### 6.3 Training platforms

| Feature | Status | Notes |
| --- | --- | --- |
| Intervals.icu export/import | Missing | No Intervals.icu integration. |
| Strava export | Missing | No Strava integration. |
| Link a planned session to a route | Missing | No session model. |
| Training calendar integration | Missing | No calendar integration. |
| Match completed rides against planned routes | Missing | No activity ingestion/matching. |

### 6.4 Import

| Feature | Status | Notes |
| --- | --- | --- |
| Upload GPX | Full | GPX file picker and parser are implemented. |
| Import external route | Half | GPX import exists; no external service import. |
| Use a past ride as a new planning basis | Missing | No activity history import. |
| Create route from activity | Missing | No activity import. |
| Clean up / simplify GPX | Missing | GPX is parsed, not cleaned/simplified. |

## 7. In-Route Navigation

### 7.1 Cue sheet & turn-by-turn

| Feature | Status | Notes |
| --- | --- | --- |
| Show turns | Missing | GraphHopper instructions are disabled. |
| Generate cue sheet | Missing | No cue sheet. |
| Mark important instructions | Missing | No instructions. |
| Highlight critical intersections | Missing | No intersection analysis. |
| Show navigation section by section | Missing | No section navigation. |

### 7.2 Pre-ride route review

| Feature | Status | Notes |
| --- | --- | --- |
| Critical points | Missing | No critical point analysis. |
| Major climbs | Missing | No climb detection. |
| Dangerous road transitions | Missing | No transition/hazard analysis. |
| Gravel / poor-surface warnings | Half | Rough surfaces are penalized and surface mix is shown; no explicit route warning by section. |
| Long exposed headwind sections | Missing | No wind analysis. |
| Supply points along the route | Missing | No supply POIs. |

### 7.3 Ride-readiness checks

| Feature | Status | Notes |
| --- | --- | --- |
| Are there implausible segments? | Missing | No implausible-segment validator. |
| Does the route contain closed or unsuitable paths? | Half | Custom model avoids/penalizes unsuitable classes during routing; no post-route readiness check. |
| Are there poor OSM data areas? | Missing | No OSM data-quality check. |
| Is the route appropriate for the planned session? | Missing | No session suitability model. |

## 8. Explore & Discovery

### 8.1 Discover section

| Feature | Status | Notes |
| --- | --- | --- |
| Popular road cycling routes in the area | Missing | Sidebar has an Explore link placeholder only. |
| Curated classics | Missing | No discovery content. |
| "Best smooth roads near me" | Missing | No discovery generator. |
| Popular loops | Missing | No discovery content. |
| Climb-based discovery | Missing | No discovery content. |
| Flat speed routes | Missing | No discovery content. |
| "Best after-work rides" | Missing | No discovery content. |
| "Best long rides" | Missing | No discovery content. |

### 8.2 Search and filters

| Feature | Status | Notes |
| --- | --- | --- |
| Region / place | Missing | Place search exists only inside planner fields, not discovery filters. |
| Distance range | Missing | No discovery filters. |
| Elevation range | Missing | No discovery filters. |
| Training goal | Missing | No discovery filters. |
| Surface quality | Missing | No discovery filters. |
| Traffic stress | Missing | No discovery filters. |
| Basemap region | Missing | No discovery filters. |
| Most popular / newest / best-rated | Missing | No discovery content. |

### 8.3 Inspiration features

| Feature | Status | Notes |
| --- | --- | --- |
| Route of the day | Missing | No inspiration system. |
| Wind-optimized recommendation | Missing | No wind system. |
| Seasonal recommendations | Missing | No recommendation system. |
| Regional highlights | Missing | No recommendation system. |
| Nearby suggestions | Missing | No current-location/nearby recommendation system. |

## 9. Community & Social Features

### 9.1 Route sharing

| Feature | Status | Notes |
| --- | --- | --- |
| Share route via link | Missing | Saved routes are local only. |
| Public route page | Missing | No public route pages. |
| Private route with share link | Missing | No share links. |
| Embed a route | Missing | No embed support. |
| Static route preview image | Missing | No static preview generation. |

### 9.2 Community content

| Feature | Status | Notes |
| --- | --- | --- |
| Like a route | Missing | No community model. |
| Save a route | Missing | Personal local save exists, but not community route save. |
| Comment on a route | Missing | No comments. |
| Rate a route | Missing | No ratings. |
| Rate difficulty | Missing | No ratings. |
| Rate surface quality | Missing | No ratings. |
| Report issues | Missing | No reporting flow. |

### 9.3 Profiles

| Feature | Status | Notes |
| --- | --- | --- |
| User profile | Missing | No account/profile system. |
| Favorite regions | Missing | No profile preferences. |
| Preferred distance/elevation | Missing | No profile preferences. |
| Personal route collection | Half | Local saved routes exist; no account-backed collection. |
| Public collections | Missing | No public collections. |

### 9.4 Group features

| Feature | Status | Notes |
| --- | --- | --- |
| Club / team collections | Missing | No groups. |
| Shared planning | Missing | No collaboration. |
| Share a group route | Missing | No groups/sharing. |
| Plan group rides | Missing | No group ride planning. |
| Collaborative editing optional | Missing | No collaboration. |

## 10. Personalization

### 10.1 User preferences

| Feature | Status | Notes |
| --- | --- | --- |
| Default basemap | Full | Basemap preference is saved in local storage. |
| Default routing profile | Missing | Road-bike strategy is fixed. |
| Preferred distance categories | Missing | No preference. |
| Preferred surfaces | Missing | No preference. |
| Weight traffic lights / traffic more or less strongly | Missing | No traffic-light/traffic weighting control. |
| Dark / light app theme | Missing | No theme setting found. |
| Units km/mi | Missing | UI is kilometers/meters only. |
| Default export format | Missing | GPX only, no setting. |

### 10.2 Regional customization

| Feature | Status | Notes |
| --- | --- | --- |
| Save home region | Missing | No home region. |
| Default start point | Missing | No default start point. |
| Known training areas | Missing | No training areas. |
| Prioritize local heatmaps | Missing | No heatmaps. |
| Preferred riding direction / wind logic optional | Missing | No direction/wind preference. |

### 10.3 Performance and training profile

| Feature | Status | Notes |
| --- | --- | --- |
| FTP optional | Missing | No performance profile. |
| Experience level | Missing | No performance profile. |
| Preferred training types | Missing | No performance profile. |
| Preferred ride duration | Missing | No performance profile. |
| Climber vs flat-route orientation | Missing | No performance profile. |
| Solo vs group ride focus | Missing | No performance profile. |

## 11. Search

### 11.1 Place and POI search

| Feature | Status | Notes |
| --- | --- | --- |
| Place | Full | GraphHopper geocoding suggestions support place search. |
| Street | Half | Geocoder may return streets, but there is no dedicated street mode. |
| Address | Half | Geocoder may return addresses, but there is no dedicated address validation UI. |
| Coordinates | Half | Map clicks and coordinate fallback exist; typed coordinate parsing was not found. |
| Mountain / pass | Half | May work through geocoder results, but no dedicated mountain/pass search. |
| Café / water / bike shop | Missing | No POI category search. |
| Saved places | Missing | No saved places. |
| Recent searches | Missing | No search history. |

### 11.2 Route search

| Feature | Status | Notes |
| --- | --- | --- |
| Search personal routes | Missing | Saved-route list has no search. |
| Search community routes | Missing | No community route system. |
| Filter by tags / distance / region / training goal | Missing | No route filters/tags. |

## 12. Account & Settings

### 12.1 Account

| Feature | Status | Notes |
| --- | --- | --- |
| Sign up / login | Missing | No authentication. |
| OAuth optional | Missing | No authentication. |
| Edit profile | Missing | No profile. |
| Change password | Missing | No account system. |
| Privacy settings | Missing | No account/privacy settings. |
| Delete account | Missing | No account system. |
| Email preferences | Missing | No email settings. |

### 12.2 App settings

| Feature | Status | Notes |
| --- | --- | --- |
| Basemap selection | Full | Implemented in settings. |
| Language | Missing | No language setting. |
| Units | Missing | No units setting. |
| Default homepage | Missing | No default homepage setting. |
| Theme | Missing | No theme setting. |
| Map interaction options | Missing | No map interaction settings. |
| Default overlay | Missing | No overlay system/settings. |
| Default export settings | Missing | No export settings. |

### 12.3 Device management

| Feature | Status | Notes |
| --- | --- | --- |
| Show connected devices | Missing | Sidebar item is a placeholder only. |
| Connect / disconnect devices | Missing | No device management. |
| Last sync | Missing | No sync. |
| Set default device | Missing | No devices. |
| Show sync errors | Missing | No sync. |

## 13. Mobile & Responsive Experience

### 13.1 Mobile planner

| Feature | Status | Notes |
| --- | --- | --- |
| Fullscreen map | Half | Planner uses a full-screen map layout; no native fullscreen action. |
| Bottom sheet for route builder | Missing | Mobile still uses an overlay panel/sidebar pattern, not a bottom sheet. |
| Touch-optimized map controls | Half | Map click and elevation scrub have pointer/touch handling; no dedicated touch control set. |
| Expandable metrics sheet | Half | Analysis panel can expand/collapse; not implemented as a mobile sheet. |
| Simple waypoint editing | Full | Add/remove/reorder waypoint controls work in the planner UI. |
| Reduced but functional planner | Half | Layout has mobile adaptations, but no purpose-built reduced planner. |

### 13.2 Cross-device continuity

| Feature | Status | Notes |
| --- | --- | --- |
| Start a draft on desktop, continue on mobile | Missing | Local storage only; no account sync. |
| Continue the last route on another device | Missing | No cross-device sync. |
| Sync personal settings | Missing | Settings are local only. |

## 14. Notifications & Smart Suggestions

### 14.1 Productive alerts

| Feature | Status | Notes |
| --- | --- | --- |
| Weather warning for a planned route | Missing | No weather system. |
| Major wind change | Missing | No weather/wind system. |
| Sync successful / failed | Missing | No sync. |
| Export ready | Half | Export downloads immediately; no notification system. |
| Route contains potentially unsuitable sections | Half | Routing fallback warnings exist; no section-level unsuitable alerts. |

### 14.2 Intelligent suggestions

| Feature | Status | Notes |
| --- | --- | --- |
| Good conditions today for a flat fast ride | Missing | No weather/recommendation system. |
| Suggest a new route based on past preferences | Missing | No preference learning/recommendations. |
| Alternative with less traffic | Missing | No targeted alternative suggestion. |
| Alternative with better asphalt | Missing | No targeted alternative suggestion. |
| Shorter version of the same route | Missing | No route resizing suggestion. |
| Longer extension of the same loop | Missing | No route extension suggestion. |

## 15. Route Quality Assurance

### 15.1 Data validation

| Feature | Status | Notes |
| --- | --- | --- |
| Detect broken geometry | Half | GPX parser validates minimum geometry; no generated-route geometry QA beyond GraphHopper response normalization. |
| Detect routing errors | Half | API handles GraphHopper failures and missing keys, but no semantic routing QA. |
| Mark poor data sections | Missing | No poor-data section marking. |
| Detect unusual loops | Missing | No loop-shape QA. |
| Detect illogical U-turns | Missing | No U-turn detection. |
| Detect connectivity issues | Missing | No connectivity QA beyond routing failure. |

### 15.2 User-facing warnings

| Feature | Status | Notes |
| --- | --- | --- |
| "This section appears unsuitable for road bikes" | Missing | No section-level suitability warnings. |
| "High interruption probability" | Missing | No interruption model. |
| "Gravel section included" | Missing | Surface mix exists, but no explicit gravel warning. |
| "Gradient exceeds your target profile" | Missing | No gradient target profile. |
| "Major urban crossing" | Missing | No urban crossing warning. |

## 16. Admin / Platform Features

### 16.1 Internal tools

| Feature | Status | Notes |
| --- | --- | --- |
| Basemap configuration | Half | Basemaps are configured in code/env, no admin UI. |
| Routing profile configuration | Half | Routing strategy/custom model is configured in code, no admin UI. |
| Feature flags | Missing | No feature flag system found. |
| Provider / API key management | Half | Provider keys are environment variables, no management UI. |
| Regional activation | Missing | No regional activation. |
| A/B tests | Missing | No A/B testing. |
| Health monitoring | Missing | No monitoring. |

### 16.2 Data management

| Feature | Status | Notes |
| --- | --- | --- |
| OSM data updates | Missing | Uses external GraphHopper/basemap providers; no OSM data pipeline. |
| Climb data generation | Missing | No climb data pipeline. |
| Heatmap data processing | Missing | No heatmap pipeline. |
| Route caching | Missing | No cache layer found. |
| Regional tiles | Missing | No tile pipeline. |
| Data cleanup | Missing | No data management tools. |

### 16.3 Moderation

| Feature | Status | Notes |
| --- | --- | --- |
| Reported routes | Missing | No community/reporting system. |
| Reported comments | Missing | No comments/moderation. |
| Problematic content | Missing | No moderation system. |
| Community quality assurance | Missing | No community QA. |

## 17. Product Analytics & Telemetry

### 17.1 Usage measurement

| Feature | Status | Notes |
| --- | --- | --- |
| Which routing profiles are used | Missing | No analytics. |
| Which basemaps are chosen | Missing | Preference is stored locally only; no telemetry. |
| Where users drop off | Missing | No analytics. |
| Which alternatives are selected | Missing | No analytics. |
| How often routes are exported | Missing | No analytics. |
| Most-used regions | Missing | No analytics. |

### 17.2 Quality measurement

| Feature | Status | Notes |
| --- | --- | --- |
| Route generation success rate | Missing | No telemetry. |
| Average computation time | Missing | No telemetry. |
| Route satisfaction | Missing | No feedback/telemetry. |
| Export / sync failure rate | Missing | No telemetry and no sync. |
| Route-to-ride conversion | Missing | No completed ride tracking. |

## 18. Possible Premium / Future Features

### 18.1 Advanced training logic

| Feature | Status | Notes |
| --- | --- | --- |
| AI route planner | Missing | No AI planner. |
| Readiness-based route suggestions | Missing | No readiness model. |
| Calendar-based recommendations | Missing | No calendar integration. |
| Training plan integration | Missing | No training plan integration. |
| Session-specific route blocks | Missing | No session block modeling. |

### 18.2 Advanced environment logic

| Feature | Status | Notes |
| --- | --- | --- |
| Time-dependent traffic routing | Missing | No traffic-time model. |
| Seasonal road-quality logic | Missing | No seasonal model. |
| Construction / closure integration | Missing | No closure integration. |
| Live wind along the route | Missing | No live wind data. |
| Lighting / night-riding logic | Missing | No lighting logic. |

### 18.3 Personal performance layer

| Feature | Status | Notes |
| --- | --- | --- |
| Suggest routes based on your riding history | Missing | No ride history. |
| Learn preferences from completed rides | Missing | No completed rides/preference learning. |
| Automatically detect favored road types | Missing | No preference learning. |
| Avoid over-repetition | Missing | No ride history. |
| Suggest new but suitable roads | Missing | No preference learning/discovery. |

## 19. UX Detail Features That Are Often Forgotten

| Feature | Status | Notes |
| --- | --- | --- |
| Auto-save during planning | Missing | No auto-save. |
| Empty states with meaningful quick actions | Full | Saved routes page has an empty state linking to the planner; planner has empty metric states. |
| Keyboard shortcuts | Half | Search suggestion menus support keyboard navigation; no app-level shortcut system. |
| Loading skeletons | Missing | Skeleton component exists, but route planner uses text loading states. |
| Route generation progress state | Half | Buttons and summary text show calculating states; no detailed progress. |
| Failure recovery for routing errors | Half | Errors are shown; no guided recovery beyond manual edits. |
| "Try again with relaxed constraints" | Missing | No constraint relaxation action. |
| Copy route | Missing | No copy action. |
| Duplicate and edit | Half | Saved route can be opened and saved as a new local route, but there is no explicit duplicate action. |
| Remember last-used preferences | Half | Basemap is remembered; routing inputs/profile preferences are not. |
| Remember map position when returning | Missing | No map position persistence. |
| Quick presets for common training profiles | Missing | No training profile presets. |
| Tooltips for technical terms | Half | Sidebar/tooling includes tooltip components, but route-analysis technical terms mostly lack tooltips. |
| Debug mode for internal development | Missing | No debug mode found. |
