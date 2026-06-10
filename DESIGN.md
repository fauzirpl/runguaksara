---
version: alpha
name: Tesla Minimal Motion
description: A high-contrast, product-forward system with restrained chrome, spacious composition, and confident electric-blue calls to action.
colors:
  primary: "#3E6AE1"
  secondary: "#FFFFFF"
  tertiary: "#393C41"
  neutral: "#121212"
  surface: "#FFFFFF"
  on-surface: "#FFFFFF"
  on-surface-muted: "#D0D1D2"
  border: "#374151"
  error: "#D92D20"
typography:
  headline-display:
    fontFamily: Universal Sans Display
    fontSize: 40px
    fontWeight: 500
    lineHeight: 48px
    letterSpacing: 0px
  headline-lg:
    fontFamily: Universal Sans Display
    fontSize: 32px
    fontWeight: 500
    lineHeight: 36px
    letterSpacing: 0px
  headline-md:
    fontFamily: Universal Sans Text
    fontSize: 25px
    fontWeight: 500
    lineHeight: 30px
    letterSpacing: 0px
  headline-sm:
    fontFamily: Universal Sans Display
    fontSize: 20px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: 0px
  body-lg:
    fontFamily: Universal Sans Text
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: 0px
  body-md:
    fontFamily: Universal Sans Text
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: 0px
  body-sm:
    fontFamily: Universal Sans Text
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  label-lg:
    fontFamily: Universal Sans Text
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: 0px
  label-md:
    fontFamily: Universal Sans Text
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0px
  label-sm:
    fontFamily: Universal Sans Text
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0px
  button:
    fontFamily: Universal Sans Text
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0px
  nav:
    fontFamily: Universal Sans Text
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0px
  caption:
    fontFamily: Universal Sans Text
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0px
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  xs: 4px
  sm: 16px
  md: 24px
  lg: 36px
  xl: 48px
  gutter: 32px
  section: 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-surface}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 4px
    size: 164px
    height: 40px
  button-primary-hover:
    backgroundColor: "#2F5BD2"
    textColor: "{colors.on-surface}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 4px
    size: 164px
    height: 40px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.tertiary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 4px
    size: 164px
    height: 40px
  button-secondary-hover:
    backgroundColor: "#F3F4F6"
    textColor: "{colors.tertiary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 4px
    size: 164px
    height: 40px
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: 0px
  card:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 16px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.tertiary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 12px
  chip:
    backgroundColor: "#F4F4F4"
    textColor: "{colors.tertiary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 8px
---

# Tesla Minimal Motion

## Overview
Tesla’s interface feels restrained, premium, and performance-oriented, with very little decorative chrome. It is built for a broad consumer audience but speaks most strongly to shoppers already intent on comparing vehicles and taking action. The tone is clean, confident, and slightly editorial, with high contrast and large imagery doing most of the emotional work. Spacing is generous, but the UI still feels efficient rather than airy.

## Colors
- **Primary (#3E6AE1):** The signature electric blue used for the most important call to action, signaling action, energy, and forward motion.
- **Secondary (#FFFFFF):** A crisp white used for secondary buttons, icon treatments, and text over dark imagery when contrast is needed.
- **Tertiary (#393C41):** A restrained graphite tone for secondary text and neutral button labels, keeping attention on product imagery and primary actions.
- **Neutral (#121212):** The deep near-black base used for dark surfaces, grounding cards and supporting Tesla’s premium, high-contrast feel.
- **Surface (#FFFFFF):** The primary light surface for buttons and page chrome, creating a clean contrast against photography.
- **On-surface (#FFFFFF):** White text used on dark or image-heavy areas for maximum legibility.
- **On-surface-muted (#D0D1D2):** A softer neutral for less prominent text, indicators, and subtle UI details.
- **Border (#374151):** A quiet structural border color that appears only when separation is necessary.
- **Error (#D92D20):** A standard alert color reserved for destructive or failure states; it should remain rare in the UI.

## Typography
Universal Sans Display carries the larger headline work, while Universal Sans Text supports navigation, labels, and body copy. The system uses medium weights most often, which keeps the voice authoritative without feeling heavy or editorially ornate. Headlines are compact and highly legible, with tight letter spacing and no visible uppercase-tracking conventions beyond the naturally clean sans-serif forms. Body text stays at 16px/24px for comfortable reading, and labels/buttons use 14px with medium weight to feel crisp and functional.

## Layout & Spacing
The layout is built around wide, edge-to-edge hero treatments with centered messaging and strong visual hierarchy. Navigation sits in a thin top bar, while primary content is anchored by large imagery and a small set of action buttons. The spacing rhythm is simple and systematic: 4px for micro-gaps, then 16px, 24px, 36px, and 48px for progressively larger separations. Use generous section spacing and consistent internal padding rather than dense nested containers.

## Elevation & Depth
Depth is intentionally minimal. The design relies more on contrast, image layering, and clear separation between white chrome and photographic content than on heavy shadows. Where elevation appears, it is subtle and practical, as in button surfaces or card edges. This makes the interface feel modern and fast, with hierarchy expressed through scale and color instead of dramatic dimensional effects.

## Shapes
The shape language is soft but disciplined. Interactive elements use small radii, especially the 4px corner treatment on buttons, which keeps the UI crisp and automotive. Cards can open up slightly to 8px for a more contained container feel, but the overall system remains rectilinear and precise. Full pill shapes should be reserved for indicators and chips only when necessary.

## Components
Buttons are the clearest expression of the system. `button-primary` is a blue-filled, high-emphasis CTA with white text, medium-weight 14px type, 4px radius, and a compact 40px height. `button-secondary` inverts that relationship with a white surface and dark text, remaining visually calm but still prominent. `button-link` is minimal and underline-based, used for tertiary actions or inline navigation rather than conversion-focused tasks.

Cards should feel quiet and structural, not glossy. Use dark surfaces, subtle borders, and modest 16px internal padding when a container must be distinct from the page. Avoid strong shadows; the card should separate itself through edge contrast and tonal difference.

Inputs should be simple, legible, and low-friction, with neutral surfaces, small radii, and clear text contrast. Their styling should remain closer to the secondary button than to a decorative form field. Focus states can be expressed through border color or a blue accent rather than shadow.

Chips, badges, and compact controls should stay understated, using neutral backgrounds and small text. Icons are thin and functional, with enough breathing room to remain readable at small sizes. Navigation items use the same compact, medium-weight label treatment as buttons, reinforcing the system’s consistency.

## Do's and Don'ts
- Do keep primary actions unmistakable with Tesla blue and white text.
- Do preserve generous whitespace around hero copy and CTA clusters.
- Do use medium-weight sans-serif typography for almost everything.
- Do rely on scale and contrast more than shadows for hierarchy.
- Don't add decorative gradients, ornate borders, or heavy texture.
- Don't use rounded corners larger than the system suggests for core controls.
- Don't overcrowd pages with too many simultaneous CTA buttons.
- Don't let body copy drift into overly light weights or wide tracking.