const APP_VERSION = "1.0.2";
const DEMO_OUTLINE_PATH = "./assets/demo-outline.svg";
const DEMO_OUTLINE_CACHE_BUST = "2026-03-29-v3";
const DEFAULT_OVERLAY_SIZE = { width: 400, height: 600 };
const MAX_LOCAL_CACHE_ITEMS = 12;
const MAX_OUTLINE_BLOB_SIZE = 2 * 1024 * 1024;
const DRAG_THRESHOLD = 8;
const OPACITY_LEVELS = [
  { label: "Medium", value: 0.6, backing: 0.3 },
  { label: "Bold", value: 0.9, backing: 0.42 },
  { label: "Light", value: 0.3, backing: 0.18 }
];
const STORAGE_KEYS = {
  currentOutline: "tracepwa-current-outline",
  outlineCache: "tracepwa-outline-cache",
  brightnessPrompted: "tracepwa-brightness-prompted",
  onboardingComplete: "tracepwa-onboarding-complete"
};
const ONBOARDING_STEPS = [
  {
    title: "Step 1",
    body: "Drag to move the outline."
  },
  {
    title: "Step 2",
    body: "Pinch to resize the outline."
  },
  {
    title: "Step 3",
    body: "Tap anywhere on the stage to change opacity."
  }
];

const state = {
  currentScreen: "launch",
  currentOutline: null,
  opacityIndex: 0,
  locked: false,
  transform: { x: 0, y: 0, scale: 1 },
  topBarTimer: null,
  toastTimer: null,
  hintTimer: null,
  wakeLock: null,
  deferredPrompt: null,
  mediaStream: null,
  qrScanner: null,
  qrRunning: false,
  qrStarting: false,
  activePointers: new Map(),
  gesture: null,
  dragMoved: false,
  onboardingStep: 0,
  onboardingVisible: false
};

const els = {
  screens: {
    launch: document.getElementById("launch-screen"),
    scanner: document.getElementById("scanner-screen"),
    tracing: document.getElementById("tracing-screen")
  },
  launchActions: document.getElementById("launch-actions"),
  continueBtn: document.getElementById("continue-btn"),
  scanLaunchBtn: document.getElementById("scan-launch-btn"),
  demoBtn: document.getElementById("demo-btn"),
  installBtn: document.getElementById("install-btn"),
  scannerCancelBtn: document.getElementById("scanner-cancel-btn"),
  qrReader: document.getElementById("qr-reader"),
  backBtn: document.getElementById("back-btn"),
  outlineTitle: document.getElementById("outline-title"),
  cameraStage: document.getElementById("camera-stage"),
  cameraFeed: document.getElementById("camera-feed"),
  overlayViewport: document.getElementById("overlay-viewport"),
  overlayTransform: document.getElementById("overlay-transform"),
  overlayBacking: document.getElementById("overlay-backing"),
  outlineImage: document.getElementById("outline-image"),
  opacityBtn: document.getElementById("opacity-btn"),
  lockBtn: document.getElementById("lock-btn"),
  lockedIndicator: document.getElementById("locked-indicator"),
  menuBtn: document.getElementById("menu-btn"),
  topBar: document.getElementById("top-bar"),
  cameraHint: document.getElementById("camera-hint"),
  menuSheet: document.getElementById("menu-sheet"),
  menuBackdrop: document.getElementById("menu-backdrop"),
  menuScanBtn: document.getElementById("menu-scan-btn"),
  menuResetBtn: document.getElementById("menu-reset-btn"),
  menuAboutBtn: document.getElementById("menu-about-btn"),
  menuCloseBtn: document.getElementById("menu-close-btn"),
  aboutSheet: document.getElementById("about-sheet"),
  aboutBackdrop: document.getElementById("about-backdrop"),
  aboutCloseBtn: document.getElementById("about-close-btn"),
  onboardingOverlay: document.getElementById("onboarding-overlay"),
  onboardingStepLabel: document.getElementById("onboarding-step-label"),
  onboardingBody: document.getElementById("onboarding-body"),
  onboardingNextBtn: document.getElementById("onboarding-next-btn"),
  toast: document.getElementById("toast")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  await registerServiceWorker();
  restoreLastOutline();
  maybePromptBrightness();
  updateOpacityUI();
  updateLockUI();
  resetTransform(false);
  syncLaunchActions();
  showScreen("launch");
}

function bindEvents() {
  els.continueBtn.addEventListener("click", continueTracing);
  els.scanLaunchBtn.addEventListener("click", openScanner);
  els.demoBtn.addEventListener("click", loadDemoMode);
  els.installBtn.addEventListener("click", installApp);
  els.scannerCancelBtn.addEventListener("click", () => showScreen("launch"));
  els.backBtn.addEventListener("click", () => showScreen("launch"));
  els.opacityBtn.addEventListener("click", cycleOpacity);
  els.lockBtn.addEventListener("click", toggleLock);
  els.menuBtn.addEventListener("click", openMenu);
  els.menuBackdrop.addEventListener("click", closeMenu);
  els.menuCloseBtn.addEventListener("click", closeMenu);
  els.menuScanBtn.addEventListener("click", async () => {
    closeMenu();
    await openScanner();
  });
  els.menuResetBtn.addEventListener("click", () => {
    resetTransform();
    closeMenu();
  });
  els.menuAboutBtn.addEventListener("click", () => {
    closeMenu();
    openAbout();
  });
  els.aboutBackdrop.addEventListener("click", closeAbout);
  els.aboutCloseBtn.addEventListener("click", closeAbout);
  els.onboardingNextBtn.addEventListener("click", advanceOnboarding);

  els.cameraStage.addEventListener("click", handleStageTap);
  els.cameraStage.addEventListener("pointerdown", onPointerDown, { passive: false });
  els.cameraStage.addEventListener("pointermove", onPointerMove, { passive: false });
  els.cameraStage.addEventListener("pointerup", onPointerUp, { passive: false });
  els.cameraStage.addEventListener("pointercancel", onPointerUp, { passive: false });
  els.cameraStage.addEventListener("pointerleave", onPointerUp, { passive: false });

  els.outlineImage.addEventListener("load", handleOutlineImageLoad);
  els.outlineImage.addEventListener("error", handleOutlineImageError);
  window.addEventListener("resize", syncOverlayDimensions);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", () => {
    state.deferredPrompt = null;
    els.installBtn.classList.add("hidden");
    showToast("App installed");
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

function restoreLastOutline() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.currentOutline);
    if (!saved) {
      return;
    }
    state.currentOutline = JSON.parse(saved);
    hydrateCurrentOutlineFromCache();
    updateOutlineTitle(state.currentOutline?.name);
  } catch (error) {
    console.warn("Failed to restore outline", error);
  }
}

function hydrateCurrentOutlineFromCache() {
  if (!state.currentOutline || state.currentOutline.source) {
    return;
  }

  const cached = loadOutlineCache().find((item) => item.id === state.currentOutline.id);
  if (cached) {
    state.currentOutline = cached;
  }
}

function syncLaunchActions() {
  const hasSavedOutline = Boolean(getSavedOutline());
  els.continueBtn.classList.toggle("hidden", !hasSavedOutline);

  if (hasSavedOutline) {
    els.scanLaunchBtn.classList.remove("button-primary");
    els.scanLaunchBtn.classList.add("button-secondary");
    els.demoBtn.classList.remove("button-secondary");
    els.demoBtn.classList.add("button-tertiary");
  } else {
    els.scanLaunchBtn.classList.add("button-primary");
    els.scanLaunchBtn.classList.remove("button-secondary");
    els.demoBtn.classList.add("button-secondary");
    els.demoBtn.classList.remove("button-tertiary");
  }
}

function getSavedOutline() {
  hydrateCurrentOutlineFromCache();
  return state.currentOutline && state.currentOutline.source ? state.currentOutline : null;
}

function maybePromptBrightness() {
  if (localStorage.getItem(STORAGE_KEYS.brightnessPrompted)) {
    return;
  }

  localStorage.setItem(STORAGE_KEYS.brightnessPrompted, "1");
  setTimeout(() => {
    showToast("For best tracing, turn screen brightness up to maximum.");
  }, 450);
}

function handleBeforeInstallPrompt(event) {
  event.preventDefault();
  state.deferredPrompt = event;
  els.installBtn.classList.remove("hidden");
}

async function installApp() {
  if (!state.deferredPrompt) {
    showToast("Use your browser menu to add this app to your Home Screen.");
    return;
  }

  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice;
  state.deferredPrompt = null;
  els.installBtn.classList.add("hidden");
}

function showScreen(screenName) {
  Object.values(els.screens).forEach((screen) => screen.classList.add("hidden"));
  state.currentScreen = screenName;
  els.screens[screenName].classList.remove("hidden");

  if (screenName === "launch") {
    cleanupScanner();
    stopCamera();
    releaseWakeLock();
    closeMenu();
    closeAbout();
    hideOnboarding();
    syncLaunchActions();
    return;
  }

  if (screenName === "scanner") {
    stopCamera();
    releaseWakeLock();
    closeMenu();
    closeAbout();
    hideOnboarding();
    startScanner().catch((error) => {
      console.error(error);
      showToast(getUserMediaErrorMessage(error));
      showScreen("launch");
    });
    return;
  }

  if (screenName === "tracing") {
    closeMenu();
    closeAbout();
    startTracingView().catch((error) => {
      console.error(error);
      showToast(getUserMediaErrorMessage(error));
      showScreen("launch");
    });
  }
}

async function continueTracing() {
  const outline = getSavedOutline();
  if (!outline) {
    showToast("No saved outline found.");
    syncLaunchActions();
    return;
  }

  applyOutline(outline);
  showToast(`Continuing ${outline.name}`);
  showScreen("tracing");
}

async function loadDemoMode() {
  try {
    const demoUrl = new URL(DEMO_OUTLINE_PATH, window.location.href);
    demoUrl.searchParams.set("v", DEMO_OUTLINE_CACHE_BUST);
    console.log("[trace-pwa] demo mode requested", demoUrl.href);

    const response = await fetch(demoUrl.href, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Demo outline request failed: ${response.status}`);
    }

    const svgText = await response.text();
    const dimensions = parseSvgDimensions(svgText);
    const outline = {
      id: "demo-outline",
      slug: "demo-outline",
      name: "Demo Flower",
      source: svgTextToDataUrl(svgText),
      remoteUrl: demoUrl.href,
      savedAt: Date.now(),
      width: dimensions.width,
      height: dimensions.height,
      isDemo: true
    };

    console.log("[trace-pwa] demo outline prepared", {
      width: outline.width,
      height: outline.height,
      sourcePrefix: outline.source.slice(0, 48)
    });

    applyOutline(outline);
    showToast("Demo outline loaded");
    showScreen("tracing");
  } catch (error) {
    console.error(error);
    showToast("Could not load the demo outline.");
  }
}

async function openScanner() {
  showScreen("scanner");
}

async function startTracingView() {
  await cleanupScanner();
  await ensureCameraStream();
  await requestWakeLock();
  await lockOrientationIfPossible();
  attachCameraStream();
  showTopBarTemporarily();
  hideHintAfterDelay();
  syncOverlayDimensions();
  debugOverlayState("startTracingView");
  maybeShowOnboarding();
}

async function ensureCameraStream() {
  if (state.mediaStream) {
    return state.mediaStream;
  }

  state.mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  });
  return state.mediaStream;
}

function attachCameraStream() {
  if (!state.mediaStream) {
    return;
  }

  els.cameraFeed.srcObject = state.mediaStream;
  els.cameraFeed.play().catch(() => {});
}

function stopCamera() {
  if (!state.mediaStream) {
    return;
  }

  state.mediaStream.getTracks().forEach((track) => track.stop());
  state.mediaStream = null;
  els.cameraFeed.srcObject = null;
}

async function startScanner() {
  if (state.qrStarting || state.qrRunning) {
    return;
  }
  if (typeof Html5Qrcode === "undefined") {
    throw new Error("html5-qrcode failed to load");
  }

  state.qrStarting = true;
  state.qrScanner = new Html5Qrcode("qr-reader");

  try {
    await state.qrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
      onQrScanSuccess,
      () => {}
    );
    state.qrRunning = true;
  } finally {
    state.qrStarting = false;
  }
}

async function cleanupScanner() {
  if (!state.qrScanner) {
    state.qrRunning = false;
    return;
  }

  try {
    if (state.qrRunning) {
      await state.qrScanner.stop();
    }
  } catch (error) {
    console.warn("Failed to stop QR scanner cleanly", error);
  }

  try {
    await state.qrScanner.clear();
  } catch (error) {
    console.warn("Failed to clear QR scanner", error);
  }

  state.qrScanner = null;
  state.qrRunning = false;
}

async function onQrScanSuccess(decodedText) {
  if (!decodedText) {
    return;
  }

  vibrateSuccess();
  await cleanupScanner();

  try {
    const parsed = parseOutlineQr(decodedText);
    const outline = await fetchAndStoreOutline(parsed);
    applyOutline(outline);
    showToast(`Loaded ${outline.name}`);
    showScreen("tracing");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not load the outline from that QR code.");
    showScreen("launch");
  }
}

function parseOutlineQr(rawValue) {
  let url;
  try {
    url = new URL(rawValue);
  } catch (error) {
    throw new Error("QR code did not contain a valid URL.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const rawSlug = parts[parts.length - 1];
  const slug = rawSlug ? rawSlug.replace(/\.png$/i, "") : "";
  if (!slug) {
    throw new Error("Could not extract an outline slug from the QR code.");
  }

  const candidates = [];
  if (url.pathname.endsWith(".png")) {
    candidates.push(url.toString());
  } else {
    candidates.push(new URL(`${url.pathname}.png`, url.origin).toString());
    candidates.push(url.toString());
  }

  return {
    slug,
    name: slugToTitle(slug),
    sourceUrl: url.toString(),
    fetchCandidates: [...new Set(candidates)]
  };
}

async function fetchAndStoreOutline(parsed) {
  let response = null;
  let finalUrl = null;

  for (const candidate of parsed.fetchCandidates) {
    const attempt = await fetch(candidate, { mode: "cors" }).catch(() => null);
    if (attempt && attempt.ok) {
      response = attempt;
      finalUrl = candidate;
      break;
    }
  }

  if (!response) {
    throw new Error("Outline download failed. Check that the QR URL serves a PNG with CORS enabled.");
  }

  const blob = await response.blob();
  if (blob.size > MAX_OUTLINE_BLOB_SIZE) {
    throw new Error("Outline too large");
  }
  if (!blob.type.includes("image")) {
    throw new Error("Downloaded outline was not an image.");
  }

  const outline = {
    id: parsed.slug,
    slug: parsed.slug,
    name: parsed.name,
    source: await blobToDataUrl(blob),
    savedAt: Date.now(),
    remoteUrl: finalUrl || parsed.sourceUrl
  };

  saveOutlineToLocalCache(outline);
  return outline;
}

function applyOutline(outline) {
  state.currentOutline = outline;
  state.opacityIndex = 0;
  state.locked = false;
  updateLockUI();
  updateOpacityUI();
  updateOutlineTitle(outline.name);
  els.outlineImage.src = outline.source;
  console.log("[trace-pwa] outline applied", {
    id: outline.id,
    name: outline.name,
    src: outline.source,
    width: outline.width,
    height: outline.height
  });
  persistCurrentOutline(outline);
  saveOutlineToLocalCache(outline);
  resetTransform(false);
  syncOverlayDimensions();
  syncLaunchActions();
  debugOverlayState("applyOutline");
}

function persistCurrentOutline(outline) {
  localStorage.setItem(STORAGE_KEYS.currentOutline, JSON.stringify(outline));
}

function saveOutlineToLocalCache(outline) {
  try {
    const items = loadOutlineCache()
      .filter((item) => item.id !== outline.id)
      .sort((a, b) => b.savedAt - a.savedAt);
    items.unshift(outline);
    localStorage.setItem(
      STORAGE_KEYS.outlineCache,
      JSON.stringify(items.slice(0, MAX_LOCAL_CACHE_ITEMS))
    );
  } catch (error) {
    console.warn("Could not store outline cache", error);
  }
}

function loadOutlineCache() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.outlineCache) || "[]");
  } catch (error) {
    return [];
  }
}

function updateOutlineTitle(title) {
  els.outlineTitle.textContent = title || "Outline";
}

function cycleOpacity(event) {
  if (event) {
    event.stopPropagation();
  }

  state.opacityIndex = (state.opacityIndex + 1) % OPACITY_LEVELS.length;
  updateOpacityUI();
  showTopBarTemporarily();
}

function updateOpacityUI() {
  const current = OPACITY_LEVELS[state.opacityIndex];
  els.opacityBtn.textContent = current.label;
  els.outlineImage.style.opacity = String(current.value);
  els.overlayBacking.style.opacity = String(current.backing);
}

function toggleLock() {
  state.locked = !state.locked;
  updateLockUI();
  showTopBarTemporarily();
  showToast(
    state.locked
      ? "Position locked — drag and pinch disabled"
      : "Position unlocked — you can reposition"
  );
}

function updateLockUI() {
  els.lockBtn.textContent = state.locked ? "Locked" : "Lock";
  els.lockedIndicator.classList.toggle("hidden", !state.locked);
}

function resetTransform(showFeedback = true) {
  state.transform = { x: 0, y: 0, scale: 1 };
  applyTransform();
  if (showFeedback) {
    showToast("Size and position reset");
  }
}

function applyTransform() {
  const { x, y, scale } = state.transform;
  els.overlayTransform.style.transform =
    `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`;
}

function syncOverlayDimensions() {
  const width =
    els.outlineImage.naturalWidth ||
    state.currentOutline?.width ||
    DEFAULT_OVERLAY_SIZE.width;
  const height =
    els.outlineImage.naturalHeight ||
    state.currentOutline?.height ||
    DEFAULT_OVERLAY_SIZE.height;

  els.overlayBacking.style.width = `${width}px`;
  els.overlayBacking.style.height = `${height}px`;
  els.outlineImage.style.width = `${width}px`;
  els.outlineImage.style.height = `${height}px`;
  applyTransform();
}

function handleOutlineImageLoad() {
  syncOverlayDimensions();
  debugOverlayState("outlineImage.load");
}

function handleOutlineImageError() {
  console.error("Outline image failed to load", state.currentOutline);
  debugOverlayState("outlineImage.error");
  showToast("Outline image failed to load.");
}

function debugOverlayState(reason) {
  const imageStyle = window.getComputedStyle(els.outlineImage);
  const viewportStyle = window.getComputedStyle(els.overlayViewport);
  const stageStyle = window.getComputedStyle(els.cameraStage);
  const feedStyle = window.getComputedStyle(els.cameraFeed);
  console.log("[trace-pwa] overlay diagnostics", {
    reason,
    screen: state.currentScreen,
    outlineSrc: els.outlineImage.currentSrc || els.outlineImage.src,
    imageDisplay: imageStyle.display,
    imageVisibility: imageStyle.visibility,
    imageOpacity: imageStyle.opacity,
    imageWidth: imageStyle.width,
    imageHeight: imageStyle.height,
    naturalWidth: els.outlineImage.naturalWidth,
    naturalHeight: els.outlineImage.naturalHeight,
    clientWidth: els.outlineImage.clientWidth,
    clientHeight: els.outlineImage.clientHeight,
    viewportDisplay: viewportStyle.display,
    viewportVisibility: viewportStyle.visibility,
    viewportWidth: viewportStyle.width,
    viewportHeight: viewportStyle.height,
    stageDisplay: stageStyle.display,
    stageVisibility: stageStyle.visibility,
    stageWidth: stageStyle.width,
    stageHeight: stageStyle.height,
    feedZIndex: feedStyle.zIndex,
    overlayZIndex: viewportStyle.zIndex,
    imageZIndex: imageStyle.zIndex
  });
}

function handleStageTap(event) {
  if (event.target.closest(".control-strip, .top-bar, .onboarding-overlay")) {
    return;
  }

  showTopBarTemporarily();
  if (state.dragMoved) {
    state.dragMoved = false;
    return;
  }
  cycleOpacity();
}

function onPointerDown(event) {
  if (event.target.closest(".control-strip, .top-bar, .onboarding-overlay")) {
    return;
  }

  els.cameraStage.setPointerCapture(event.pointerId);
  state.activePointers.set(event.pointerId, pointFromEvent(event));

  if (state.locked) {
    return;
  }

  if (state.activePointers.size === 1) {
    state.dragMoved = false;
    state.gesture = {
      type: "drag",
      startX: event.clientX,
      startY: event.clientY,
      originX: state.transform.x,
      originY: state.transform.y
    };
  } else if (state.activePointers.size === 2) {
    state.dragMoved = false;
    state.gesture = createPinchGesture();
  }

  event.preventDefault();
}

function onPointerMove(event) {
  if (!state.activePointers.has(event.pointerId)) {
    return;
  }

  state.activePointers.set(event.pointerId, pointFromEvent(event));
  if (state.locked || !state.gesture) {
    return;
  }

  if (state.activePointers.size >= 2) {
    if (state.gesture.type !== "pinch") {
      state.gesture = createPinchGesture();
    }
    applyPinchGesture();
    state.dragMoved = true;
    event.preventDefault();
    return;
  }

  if (state.gesture.type === "drag") {
    const dx = event.clientX - state.gesture.startX;
    const dy = event.clientY - state.gesture.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      state.dragMoved = true;
    }
    state.transform.x = state.gesture.originX + dx;
    state.transform.y = state.gesture.originY + dy;
    applyTransform();
    event.preventDefault();
  }
}

function onPointerUp(event) {
  if (state.activePointers.has(event.pointerId)) {
    state.activePointers.delete(event.pointerId);
  }

  if (state.activePointers.size === 0) {
    state.gesture = null;
  } else if (state.activePointers.size === 1 && !state.locked) {
    const [remainingPointer] = [...state.activePointers.values()];
    state.gesture = {
      type: "drag",
      startX: remainingPointer.x,
      startY: remainingPointer.y,
      originX: state.transform.x,
      originY: state.transform.y
    };
  }
}

function createPinchGesture() {
  const points = [...state.activePointers.values()];
  return {
    type: "pinch",
    startDistance: getDistance(points[0], points[1]) || 1,
    startScale: state.transform.scale,
    startX: state.transform.x,
    startY: state.transform.y,
    midpoint: getMidpoint(points[0], points[1])
  };
}

function applyPinchGesture() {
  const points = [...state.activePointers.values()];
  if (points.length < 2) {
    return;
  }

  const distance = getDistance(points[0], points[1]) || 1;
  const midpoint = getMidpoint(points[0], points[1]);
  const gesture = state.gesture;

  state.transform.scale = clamp(
    gesture.startScale * (distance / gesture.startDistance),
    0.5,
    3
  );
  state.transform.x = gesture.startX + (midpoint.x - gesture.midpoint.x);
  state.transform.y = gesture.startY + (midpoint.y - gesture.midpoint.y);
  applyTransform();
}

function pointFromEvent(event) {
  return { x: event.clientX, y: event.clientY };
}

function getDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function getMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function openMenu() {
  els.menuSheet.classList.remove("hidden");
}

function closeMenu() {
  els.menuSheet.classList.add("hidden");
}

function openAbout() {
  els.aboutSheet.classList.remove("hidden");
}

function closeAbout() {
  els.aboutSheet.classList.add("hidden");
}

function closeOpenSheets() {
  let closed = false;
  if (!els.aboutSheet.classList.contains("hidden")) {
    closeAbout();
    closed = true;
  }
  if (!els.menuSheet.classList.contains("hidden")) {
    closeMenu();
    closed = true;
  }
  return closed;
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape") {
    return;
  }

  if (closeOpenSheets()) {
    event.preventDefault();
  }
}

function maybeShowOnboarding() {
  if (state.onboardingVisible) {
    return;
  }
  if (localStorage.getItem(STORAGE_KEYS.onboardingComplete)) {
    return;
  }

  state.onboardingVisible = true;
  state.onboardingStep = 0;
  els.onboardingOverlay.classList.remove("hidden");
  renderOnboardingStep();
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[state.onboardingStep];
  els.onboardingStepLabel.textContent = step.title;
  els.onboardingBody.textContent = step.body;
  els.onboardingNextBtn.textContent =
    state.onboardingStep === ONBOARDING_STEPS.length - 1 ? "Got it" : "Next";
}

function advanceOnboarding() {
  if (state.onboardingStep < ONBOARDING_STEPS.length - 1) {
    state.onboardingStep += 1;
    renderOnboardingStep();
    return;
  }

  localStorage.setItem(STORAGE_KEYS.onboardingComplete, "1");
  hideOnboarding();
}

function hideOnboarding() {
  state.onboardingVisible = false;
  els.onboardingOverlay.classList.add("hidden");
}

function showTopBarTemporarily() {
  els.topBar.classList.add("visible");
  clearTimeout(state.topBarTimer);
  state.topBarTimer = setTimeout(() => {
    els.topBar.classList.remove("visible");
  }, 3000);
}

function hideHintAfterDelay() {
  els.cameraHint.classList.remove("hidden");
  clearTimeout(state.hintTimer);
  state.hintTimer = setTimeout(() => {
    els.cameraHint.classList.add("hidden");
  }, 3200);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || state.wakeLock) {
    return;
  }

  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
    });
  } catch (error) {
    console.warn("Wake lock failed", error);
  }
}

async function releaseWakeLock() {
  if (!state.wakeLock) {
    return;
  }

  try {
    await state.wakeLock.release();
  } catch (error) {
    console.warn("Wake lock release failed", error);
  } finally {
    state.wakeLock = null;
  }
}

async function lockOrientationIfPossible() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock(getCurrentOrientationType());
    }
  } catch (error) {
    console.warn("Orientation lock not available", error);
  }
}

function getCurrentOrientationType() {
  return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
}

async function handleVisibilityChange() {
  if (document.visibilityState === "visible" && state.currentScreen === "tracing") {
    await requestWakeLock();
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2600);
}

function vibrateSuccess() {
  if (navigator.vibrate) {
    navigator.vibrate(40);
  }
}

function slugToTitle(slug) {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function svgTextToDataUrl(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

function parseSvgDimensions(svgText) {
  const parser = new DOMParser();
  const svg = parser.parseFromString(svgText, "image/svg+xml").documentElement;
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const [, , width, height] = viewBox.trim().split(/[\s,]+/).map(Number);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return { width, height };
    }
  }

  const width = parseFloat(svg.getAttribute("width"));
  const height = parseFloat(svg.getAttribute("height"));
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }

  return DEFAULT_OVERLAY_SIZE;
}

function getUserMediaErrorMessage(error) {
  const name = error && error.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow camera permission and try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Rear camera not available on this device.";
  }
  return "Could not start the camera.";
}

window.addEventListener("load", () => {
  hydrateCurrentOutlineFromCache();
  syncLaunchActions();
});
