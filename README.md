# Captain's Voyage

A standalone WebXR trade-route experience for 5th graders, built with IWSDK.

The student captains a trade ship along the triangular trade route
(Virginia → England → West Africa → Virginia). The single interactive mechanic
is loading trade goods into a fixed 6-slot cargo hold at the Virginia port;
every other element is static content or narration.

This is a self-contained project with no dependencies on any other module. It is
designed to be deployed as a static site (via GitHub Pages) and opened in the
Meta Quest browser.

## Running locally

```bash
npm install      # first time only — installs dependencies
npm run dev      # starts the dev server and opens the app
```

The dev server also works with the Meta XR Simulator for testing without a headset.

## Building

```bash
npm run build    # produces a static site in dist/
```
