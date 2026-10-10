/**
 * Lifecycle contract every reading mode implements. The runtime guarantees the call order:
 *   enable(s) → update(s)* → disable()   (and may repeat the cycle)
 * - enable is only called while the mode is off; update and disable only while it is on.
 * - disable must leave the page exactly as it was before enable.
 * Modes receive their own settings slice only.
 */
import type { ModeId, ModeSettings } from '../shared/settings';

export interface Mode {
  readonly id: ModeId;
  enable(settings: ModeSettings): void;
  update(settings: ModeSettings): void;
  disable(): void;
  /** Re-applies the mode's open shadow root sheets (see RuntimeHandle.restyle). Optional. */
  restyleShadow?(): void;
}
