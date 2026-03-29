# Trace & Paint PWA

Standalone vanilla JS/HTML/CSS PWA for projecting watercolor tracing outlines over a live phone camera feed.

## Local Use

1. Serve the folder with any static file server.
2. Open `index.html` in Safari or Chrome on a phone.
3. Allow rear-camera access.
4. Use `Demo Mode` to test without a QR code.

## GitHub Pages

1. Publish the `trace_pwa` folder contents to the repository path you want to host.
2. If deploying under `/trace-and-paint/`, keep the files together and serve them as static assets without rewriting paths.
3. All internal links and asset references are relative, so the app works from a subdirectory.
4. Open the app once while online so the service worker can cache the shell for offline use.

## Notes

- QR outline downloads require the remote image host to allow CORS.
- For iPhone Safari, using `Add to Home Screen` gives the best full-screen experience.
- Downloaded outlines are saved in `localStorage` for offline reuse after the first fetch.
