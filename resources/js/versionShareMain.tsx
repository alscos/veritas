import { createRoot } from 'react-dom/client';
import VersionShareApp from './VersionShareApp';
import '../css/version-share.css';
// Strip the fragment synchronously, before React, fetch, listeners or any canje.
const fragment = window.location.hash;
window.history.replaceState(null, '', window.location.pathname + window.location.search);
const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
const root = document.getElementById('version-share');
if (root) createRoot(root).render(<VersionShareApp documentId={root.dataset.document} versionId={root.dataset.version} initialSecret={match?.[1] ?? ''} />);
