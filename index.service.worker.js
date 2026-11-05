// Service worker de WikiCartes. Il remplace celui de Godot à chaque export (tools\export_web.ps1).
// Celui de Godot servait la COPIE gardée sur l'appareil en priorité : après une mise à jour du
// site, un téléphone pouvait continuer à jouer à l'ancienne version. Ici :
//  - réseau d'abord : toujours la dernière version en ligne (le navigateur ne retélécharge
//    pas un fichier qui n'a pas changé : simple vérification) ; la copie ne sert que hors connexion ;
//  - une nouvelle version s'installe et s'active tout de suite, et recharge la page une fois.
const CACHE_VERSION = '1793909083|4107721';
const CACHE_PREFIX = 'WikiCartes-sw-cache-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const OFFLINE_URL = 'index.offline.html';
const CACHED_FILES = ['index.html', 'index.js', 'index.offline.html', 'index.icon.png', 'index.apple-touch-icon.png',
	'index.audio.worklet.js', 'index.audio.position.worklet.js'];
const CACHEABLE_FILES = ['index.wasm', 'index.pck'];
const FULL_CACHE = CACHED_FILES.concat(CACHEABLE_FILES);

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_NAME)
		.then((cache) => cache.addAll(CACHED_FILES))
		.catch(() => {})
		.then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const keys = await caches.keys();
		const old = keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME);
		await Promise.all(old.map((k) => caches.delete(k)));
		await self.clients.claim();
		if (old.length > 0) {
			// Une ancienne version tournait : on recharge la page sur la nouvelle.
			const wins = await self.clients.matchAll({ type: 'window' });
			wins.forEach((w) => { try { w.navigate(w.url); } catch (e) { /* (rien) */ } });
		}
	})());
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') {
		return;
	}
	const url = new URL(req.url);
	const scope = new URL(self.registration.scope);
	if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) {
		return;
	}
	const isNavigate = req.mode === 'navigate';
	const name = isNavigate ? 'index.html' : url.pathname.slice(scope.pathname.length);
	if (!isNavigate && !FULL_CACHE.includes(name)) {
		return;
	}
	event.respondWith((async () => {
		const cache = await caches.open(CACHE_NAME);
		try {
			const resp = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
			if (resp && resp.ok) {
				// (copie mise à jour seulement si le fichier a changé : évite de réécrire 80 Mo à chaque lancement)
				const old = await cache.match(name);
				const tag = resp.headers.get('etag') || resp.headers.get('last-modified') || '';
				const oldTag = old ? (old.headers.get('etag') || old.headers.get('last-modified') || '') : '';
				if (!old || tag === '' || tag !== oldTag) {
					await cache.put(name, resp.clone());
				}
			}
			return resp;
		} catch (e) {
			const cached = await cache.match(name);
			if (cached) {
				return cached;
			}
			return (await cache.match(OFFLINE_URL)) || Response.error();
		}
	})());
});

self.addEventListener('message', (event) => {
	if (event.data === 'update' || event.data === 'claim') {
		self.skipWaiting().then(() => self.clients.claim());
	}
});
