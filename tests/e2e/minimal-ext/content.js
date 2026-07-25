// Minimal content script - logs and sends bridge request
console.log('MINIMAL_CS_LOADED', location.href);
window.postMessage({ source: 'minimal-ext', type: 'READY' }, window.location.origin);
