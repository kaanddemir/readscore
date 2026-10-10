/** Popup entry: Chrome wiring only. */
import { chromeApi } from './client';
import { startPopup } from './app';

const root = document.getElementById('app');
if (root) void startPopup(root, chromeApi);
