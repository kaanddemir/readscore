/**
 * Calm, page side. One master mode with two independent parts:
 *  - Reduce motion: the stylesheet is USER CSS inserted by the service worker; here only the
 *    background video guard runs (src/content/calm/video.ts).
 *  - Blur images: marking, reveal and shadow root sheets (src/content/calm/images.ts); the document
 *    blur rule is USER CSS inserted by the service worker.
 * Show all images is a temporary page state: it lives in this runtime, so it resets on reload,
 * navigation and when Calm or Blur images is turned off.
 */
import type { CalmSettings, ModeSettings } from '../../shared/settings';
import type { Mode } from '../mode';
import { createImageBlur, type ImageStats } from './images';
import { createVideoGuard, type VideoStats } from './video';

export interface CalmState {
  blurActive: boolean;
  motionActive: boolean;
  showAll: boolean;
  images: ImageStats;
  video: VideoStats;
}

export interface CalmMode extends Mode {
  setShowAll(on: boolean): void;
  state(): CalmState;
}

export function createCalmMode(doc: Document = document): CalmMode {
  const video = createVideoGuard(doc);
  const images = createImageBlur(doc, (sr) => video.addShadowRoot(sr));
  let blurOn = false;
  let motionOn = false;

  // `images` runs while Calm is on (it owns the shadow root sheets that carry BOTH rules);
  // it marks visuals only while Blur images is on. The video guard follows Reduce motion.
  let imagesOn = false;
  function apply(s: CalmSettings): void {
    // Each part is independent: a failure in one never takes the other down.
    try {
      if (!imagesOn) (images.enable(s), (imagesOn = true));
      else images.update(s);
      blurOn = s.blurImages;
    } catch {
      blurOn = false;
    }
    try {
      if (s.reduceMotion && !motionOn) (video.enable(), (motionOn = true));
      else if (!s.reduceMotion && motionOn) (video.disable(), (motionOn = false));
    } catch {
      motionOn = false;
    }
  }

  return {
    id: 'calm',
    enable: (s: ModeSettings) => apply(s as CalmSettings),
    update: (s: ModeSettings) => apply(s as CalmSettings),
    disable() {
      if (imagesOn) images.disable();
      if (motionOn) video.disable();
      imagesOn = blurOn = motionOn = false;
    },
    restyleShadow() {
      if (imagesOn) images.refreshShadowSheets();
    },
    setShowAll(on: boolean) {
      if (blurOn) images.setShowAll(on);
    },
    state: () => ({ blurActive: blurOn, motionActive: motionOn, showAll: blurOn && images.showAll, images: images.stats(), video: video.stats() }),
  };
}
