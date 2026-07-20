// Redirecci\u00f3n m\u00f3vil (comentada porque la app principal es responsive)
// if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
//     window.location.href = "https://m.lacajita.tv";
// }

/* ============================================================
   CONFIG
============================================================ */
const CONFIG = {
    churchId: 141,
    apiBase: 'https://tvappbuilder.com/API/V1/embed',
    pageSize: 12,           // ítems por petición API por categoría
    carouselInterval: 6000, // ms
};

/* ============================================================
   STATE
============================================================ */
let allCategories = [];
let activeCatId = 'all';
let currentSort = 'newest';
let searchQuery = '';
let fetchOffset = 0;     // offset actual (para el próximo fetch)
let feedHasMore = false; // ¿quedan más ítems en la API?
let isFetchingMore = false; // bloquea doble-click en "Cargar más"
let hlsInstance = null;
let pipHlsInstance = null; // HLS del widget PiP
let lastFocus = null;      // Para restaurar foco al cerrar modal
let trapHandler = null;    // Handler del focus trap del modal
let currentModalItem = null; // Ítem abierto actualmente en el modal
let toastTimer = null;       // Timer de la notificación toast

// Carousel state
let carouselSlides = [];
let carouselIndex = 0;
let carouselTimer = null;

/* ============================================================
   UTILITIES
============================================================ */
const $ = id => document.getElementById(id);

function formatDuration(sec) {
    if (!sec) return '';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Normaliza barras invertidas escapadas en URLs de la API */
function cleanUrl(url) {
    return url ? url.replace(/\\/g, '/') : '';
}

/** Valida que una URL sea segura (solo http/https) */
function isValidUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u);
}

/**
 * Sanitiza un ítem de la API: garantiza tipos correctos y valida URLs.
 * Previene XSS por URLs javascript: o datos malformados.
 */
function sanitizeItem(item) {
    if (!item || typeof item !== 'object') return null;
    return {
        id:            String(item.id ?? ''),
        title:         String(item.title ?? 'Sin título').slice(0, 300),
        description:   String(item.description ?? '').slice(0, 3000),
        thumbnail:     isValidUrl(item.thumbnail)  ? item.thumbnail  : '',
        stream_url:    isValidUrl(item.stream_url) ? item.stream_url : '',
        file_url:      isValidUrl(item.file_url)   ? item.file_url   : '',
        embed_url:     isValidUrl(item.embed_url)  ? item.embed_url  : '',
        type:          String(item.type || 'video'),
        is_series:     Boolean(item.is_series),
        duration:      Number(item.duration)       || 0,
        episode_count: Number(item.episode_count)  || 0,
    };
}

/** Sanitiza una categoría completa del feed */
function sanitizeCat(cat) {
    return {
        ...cat,
        content: (cat.content || []).map(sanitizeItem).filter(Boolean),
    };
}

/* ============================================================
   FAVORITOS — localStorage
============================================================ */
const FAV_KEY = 'lctv_favorites';

function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); }
    catch (_) { return []; }
}

function saveFavorites(favs) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch (_) {}
}

function isFavorite(id) {
    return getFavorites().some(f => f.id === id);
}

/**
 * Agrega o elimina un ítem de favoritos.
 * @returns {boolean} true si fue añadido, false si fue eliminado.
 */
function toggleFavorite(item) {
    const favs = getFavorites();
    const idx  = favs.findIndex(f => f.id === item.id);
    if (idx >= 0) { favs.splice(idx, 1); }
    else { favs.push(item); }
    saveFavorites(favs);
    return idx < 0;
}

/* ============================================================
   COMPARTIR
============================================================ */
function getShareUrl(item) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash   = '';
    url.searchParams.set('play', item.id);
    return url.toString();
}

async function shareItem(item) {
    const url = getShareUrl(item);
    if (navigator.share) {
        try {
            await navigator.share({ title: item.title, text: item.description || item.title, url });
        } catch (_) { /* usuario canceló */ }
    } else {
        try {
            await navigator.clipboard.writeText(url);
            showToast('¡Enlace copiado al portapapeles! 🔗');
        } catch (_) {
            showToast('No se pudo copiar el enlace.');
        }
    }
}

/* ============================================================
   TOAST
============================================================ */
function showToast(msg, duration = 3000) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

/* ============================================================
   FETCH
============================================================ */
async function fetchFeed(sort = 'newest', offset = 0) {
    const url = `${CONFIG.apiBase}/feed.php?church=${CONFIG.churchId}` +
        `&limit=${CONFIG.pageSize}&include_live=true&sort=${sort}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('API error ' + res.status);
    return res.json();
}

async function fetchSearch(q) {
    const url = `${CONFIG.apiBase}/search.php?church=${CONFIG.churchId}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Search error ' + res.status);
    return res.json();
}

async function fetchEpisodes(seriesId) {
    const url = `${CONFIG.apiBase}/episodes.php?series_id=${seriesId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Episodes error ' + res.status);
    return res.json();
}

/* ============================================================
   CACHE — sessionStorage con TTL de 5 minutos
============================================================ */
const CACHE_TTL = 5 * 60 * 1000;

async function fetchFeedCached(sort, offset) {
    const key = `lctv_feed_${sort}_${offset}`;
    try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
            const { data, ts } = JSON.parse(raw);
            if (Date.now() - ts < CACHE_TTL) return data;
        }
    } catch (_) { /* sessionStorage no disponible */ }
    const data = await fetchFeed(sort, offset);
    try {
        sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
    } catch (_) { /* cuota excedida, continuar sin caché */ }
    return data;
}

/* ============================================================
   PAGINATION — fusionar página nueva sin duplicados
============================================================ */
/**
 * Fusiona las categorías de una nueva página en allCategories.
 * Actualiza has_more por categoría para saber si hay más.
 * @returns {boolean} true si al menos una categoría tiene has_more = true
 */
function mergeCategories(newCats) {
    let anyHasMore = false;

    for (const newCat of newCats) {
        if (newCat.has_more) anyHasMore = true;

        const existing = allCategories.find(c => c.id === newCat.id);
        if (existing) {
            // Agrega solo los ítems que aún no están
            const seenIds = new Set(existing.content.map(i => i.id));
            for (const item of newCat.content) {
                if (!seenIds.has(item.id)) {
                    existing.content.push(item);
                    seenIds.add(item.id);
                }
            }
            existing.has_more = newCat.has_more;
            existing.total = newCat.total;
        }
    }
    return anyHasMore;
}

/**
 * Comprueba si alguna categoría visible aún tiene más ítems en la API.
 */
function computeFeedHasMore() {
    if (activeCatId === 'all') {
        return allCategories.some(c => c.has_more);
    }
    const cat = allCategories.find(c => c.id === activeCatId);
    return cat ? cat.has_more : false;
}

/* ============================================================
   INIT
============================================================ */
async function init() {
    showGridLoading();
    try {
        const data = await fetchFeedCached(currentSort, 0);

        // Brand color / nombre
        if (data.branding?.brand_color) {
            document.documentElement.style.setProperty('--brand', data.branding.brand_color);
        }
        if (data.branding?.church_name) {
            const logoImg = $('church-name-nav');
            if (logoImg) logoImg.alt = data.branding.church_name;
            document.title = data.branding.church_name;
        }

        allCategories = (data.categories || []).map(sanitizeCat);
        fetchOffset = CONFIG.pageSize;            // próximo offset
        feedHasMore = allCategories.some(c => c.has_more);

        // Carousel: primer ítem con thumbnail de cada categoría
        carouselSlides = [];
        for (const cat of allCategories) {
            const item = cat.content.find(c => c.thumbnail);
            if (item) carouselSlides.push({ item, catName: cat.name });
        }
        buildCarousel();
        buildTabs();
        renderGrid();

        // Deep-link: ?play=<id> → abrir modal automáticamente
        const playId = new URLSearchParams(window.location.search).get('play');
        if (playId) {
            for (const cat of allCategories) {
                const found = cat.content.find(i => i.id === playId);
                if (found) { openModal(found); break; }
            }
        }

        // Lanzar el widget PiP con un ligero retraso
        setTimeout(initLivePip, 800);

    } catch (e) {
        $('content-grid').innerHTML =
            `<div class="state-msg">⚠️ Error al cargar contenido. Intenta refrescar la página.</div>`;
        console.error(e);
    }
}

/* ============================================================
   LOAD MORE — paginación real via API
============================================================ */
async function loadMoreFromAPI() {
    if (isFetchingMore || !feedHasMore) return;
    isFetchingMore = true;
    showLoadMoreSpinner(true);

    try {
        const data = await fetchFeedCached(currentSort, fetchOffset);
        const newCats = (data.categories || []).map(sanitizeCat);

        mergeCategories(newCats);
        fetchOffset += CONFIG.pageSize;
        feedHasMore = computeFeedHasMore();

        renderGrid();
    } catch (e) {
        console.error('Error cargando más contenido:', e);
    } finally {
        isFetchingMore = false;
        showLoadMoreSpinner(false);
    }
}

function showLoadMoreSpinner(show) {
    const btn = $('load-more-btn');
    if (!btn) return;
    btn.disabled = show;
    btn.textContent = show ? 'Cargando…' : 'Cargar más';
}

/* ============================================================
   CAROUSEL
============================================================ */
function buildCarousel() {
    if (!carouselSlides.length) return;

    const track = $('carousel-track');
    const dots = $('carousel-dots');
    const thumbs = $('carousel-thumbs');
    track.innerHTML = '';
    dots.innerHTML = '';
    thumbs.innerHTML = '';

    carouselSlides.forEach(({ item, catName }, i) => {
        const slide = document.createElement('div');
        slide.className = 'carousel-slide' + (i === 0 ? ' active' : '');

        const isLive = item.type === 'live_feed';
        const badgeClass = isLive ? 'carousel-cat-badge live-badge' : 'carousel-cat-badge';
        const badgeText = isLive ? 'EN VIVO' : catName;

        slide.innerHTML = `
            <img class="carousel-slide-bg" src="${esc(item.thumbnail)}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}" />
            <div class="carousel-content">
                <span class="${badgeClass}">${esc(badgeText)}</span>
                <h2 class="carousel-title">${esc(item.title)}</h2>
                <p class="carousel-desc">${esc(item.description || '')}</p>
                <button class="carousel-play-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Ver ahora
                </button>
            </div>`;

        slide.querySelector('.carousel-play-btn').addEventListener('click', () => openModal(item));
        track.appendChild(slide);

        // Dot
        const dot = document.createElement('button');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Slide ${i + 1}: ${item.title}`);
        dot.addEventListener('click', () => goToSlide(i));
        dots.appendChild(dot);

        // Thumb (solo si hay pocos slides)
        if (carouselSlides.length <= 8) {
            const thumb = document.createElement('div');
            thumb.className = 'carousel-thumb' + (i === 0 ? ' active' : '');
            thumb.innerHTML = `<img src="${esc(item.thumbnail)}" alt="${esc(item.title)}" loading="lazy" />`;
            thumb.addEventListener('click', () => goToSlide(i));
            thumbs.appendChild(thumb);
        }
    });

    startCarouselTimer();
}

function goToSlide(idx) {
    const slides = document.querySelectorAll('.carousel-slide');
    const dots = document.querySelectorAll('.carousel-dot');
    const thumbs = document.querySelectorAll('.carousel-thumb');

    slides[carouselIndex]?.classList.remove('active');
    dots[carouselIndex]?.classList.remove('active');
    thumbs[carouselIndex]?.classList.remove('active');

    carouselIndex = (idx + carouselSlides.length) % carouselSlides.length;

    slides[carouselIndex]?.classList.add('active');
    dots[carouselIndex]?.classList.add('active');
    thumbs[carouselIndex]?.classList.add('active');

    $('carousel-track').style.transform = `translateX(-${carouselIndex * 100}%)`;
    resetProgressBar();
}

function startCarouselTimer() {
    clearInterval(carouselTimer);
    resetProgressBar();
    carouselTimer = setInterval(() => goToSlide(carouselIndex + 1), CONFIG.carouselInterval);
}

function resetProgressBar() {
    const bar = $('carousel-progress');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    bar.offsetWidth; // force reflow
    bar.style.transition = `width ${CONFIG.carouselInterval}ms linear`;
    bar.style.width = '100%';
}

/* ============================================================
   TABS
============================================================ */
function buildTabs() {
    const container = $('category-tabs');
    container.innerHTML = '';

    const favs = getFavorites();
    const ALL  = { id: 'all', name: 'Todo' };
    const FAV  = { id: 'favorites', name: `♥ Favoritos${favs.length ? ` (${favs.length})` : ''}` };
    const tabs = [ALL, ...(favs.length ? [FAV] : []), ...allCategories];

    // Si estamos en favoritos pero ya no hay ninguno, regresar a "all"
    if (activeCatId === 'favorites' && !favs.length) activeCatId = 'all';

    tabs.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn' + (cat.id === activeCatId ? ' active' : '');
        btn.textContent = cat.name;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', cat.id === activeCatId);
        btn.addEventListener('click', () => {
            activeCatId = cat.id;
            document.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-selected', b === btn);
            });
            feedHasMore = computeFeedHasMore();
            renderGrid();
        });
        container.appendChild(btn);
    });
}

/* ============================================================
   GRID
============================================================ */
function getVisibleItems() {
    if (searchQuery) return [];

    let items = [];
    if (activeCatId === 'favorites') {
        items = getFavorites();
    } else if (activeCatId === 'all') {
        const seen = new Set();
        for (const cat of allCategories) {
            for (const item of cat.content) {
                if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
            }
        }
    } else {
        const cat = allCategories.find(c => c.id === activeCatId);
        if (cat) items = [...cat.content];
    }

    if (currentSort === 'a-z') items.sort((a, b) => a.title.localeCompare(b.title));
    else if (currentSort === 'z-a') items.sort((a, b) => b.title.localeCompare(a.title));

    return items;
}

function getCategoryName() {
    if (activeCatId === 'all') return 'Todo el contenido';
    if (activeCatId === 'favorites') {
        const n = getFavorites().length;
        return `♥ Favoritos (${n})`;
    }
    return allCategories.find(c => c.id === activeCatId)?.name ?? 'Contenido';
}

function renderGrid(searchResults) {
    const grid = $('content-grid');
    const heading = $('section-heading');
    const lmWrap = $('load-more-wrap');

    const items = searchResults ?? getVisibleItems();

    // Heading
    if (searchQuery) {
        heading.textContent = searchResults !== undefined
            ? `Resultados para "${searchQuery}" (${items.length})`
            : `Buscando "${searchQuery}"…`;
    } else {
        heading.textContent = getCategoryName();
    }

    if (!items.length) {
        grid.innerHTML = `<div class="state-msg">Sin resultados.</div>`;
        lmWrap.style.display = 'none';
        return;
    }

    grid.innerHTML = items.map(item => cardHTML(item)).join('');

    // Abrir modal al clicar tarjeta
    grid.querySelectorAll('.card').forEach(card => {
        const handler = () => {
            const id   = card.dataset.id;
            const item = items.find(i => i.id === id);
            if (item) openModal(item);
        };
        card.addEventListener('click', handler);
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
        });
    });

    // Toggle favorito sin abrir modal
    grid.querySelectorAll('.fav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id   = btn.dataset.favId;
            const item = items.find(i => i.id === id);
            if (!item) return;
            const added = toggleFavorite(item);
            btn.classList.toggle('active', added);
            btn.setAttribute('aria-label', added ? 'Quitar de favoritos' : 'Agregar a favoritos');
            const svg = btn.querySelector('svg');
            if (svg) svg.style.fill = added ? 'currentColor' : 'none';
            showToast(added ? '\u2665 A\u00f1adido a favoritos' : 'Eliminado de favoritos');
            buildTabs();
            if (activeCatId === 'favorites') renderGrid();
        });
    });

    // "Cargar más" solo si la API tiene más ítems (no para búsqueda)
    if (searchResults !== undefined) {
        lmWrap.style.display = 'none';
    } else {
        lmWrap.style.display = feedHasMore ? 'block' : 'none';
    }
}

function cardHTML(item) {
    const isLive   = item.type === 'live_feed';
    const isSeries = item.is_series;
    const dur      = formatDuration(item.duration);
    const isFav    = isFavorite(item.id);

    let badge = '';
    if (isLive)   badge = `<span class="badge badge-live">EN VIVO</span>`;
    if (isSeries) badge = `<span class="badge badge-series">SERIE</span>`;

    const epCount = isSeries && item.episode_count
        ? `<span class="ep-count">${item.episode_count} ep.</span>` : '';

    return `
<div class="card-wrap">
<button class="card" data-id="${esc(item.id)}" aria-label="${esc(item.title)}">
  <div class="card-thumb">
    <img src="${esc(item.thumbnail)}" alt="${esc(item.title)}" loading="lazy"
         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 360%22><rect width=%22640%22 height=%22360%22 fill=%22%231a1a2e%22/><text x=%2250%%25%22 y=%2250%%25%22 fill=%22%238585aa%22 font-size=%2248%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22>📺</text></svg>'" />
    ${badge}${epCount}
    <div class="play-overlay">
      <div class="play-circle">
        <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
    </div>
  </div>
  <div class="card-info">
    <div class="card-title">${esc(item.title)}</div>
    <div class="card-meta">${dur ? dur : (isSeries ? 'Serie' : isLive ? 'En Vivo' : 'Video')}</div>
  </div>
</button>
<button class="fav-btn${isFav ? ' active' : ''}" data-fav-id="${esc(item.id)}"
        aria-label="${isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" title="Favoritos">
  <svg viewBox="0 0 24 24">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
</button>
</div>`;
}

function showGridLoading() {
    $('content-grid').innerHTML = `
<div class="state-msg" style="grid-column:1/-1">
  <div class="spinner"></div>
  Cargando contenido…
</div>`;
}

/* ============================================================
   PiP LIVE TV WIDGET
============================================================ */
const PIP_DEFAULT = {
    title: 'Emfravision',
    stream_url: 'https://edge.essastream.com/emfravision/index.m3u8',
};

function findLiveChannel(nameSubstring) {
    const lower = nameSubstring.toLowerCase();
    for (const cat of allCategories) {
        for (const i of cat.content) {
            if (i.type === 'live_feed' && i.title.toLowerCase().includes(lower) && i.stream_url) {
                return i;
            }
        }
    }
    return null;
}

function initLivePip() {
    const widget = $('pip-widget');
    const player = $('pip-player');
    const titleEl = $('pip-title');
    if (!widget || !player) return;

    // Buscar canales por prioridad usando el nombre
    const emfravision = findLiveChannel('emfravision');
    const olmTv       = findLiveChannel('olm tv') || findLiveChannel('olmtv');
    
    // Si no hay ninguno de los dos, buscar cualquier canal en vivo
    let anyLive = null;
    if (!emfravision && !olmTv) {
        for (const cat of allCategories) {
            anyLive = cat.content.find(i => i.type === 'live_feed' && i.stream_url);
            if (anyLive) break;
        }
    }

    // Lista de canales a intentar reproducir (del más prioritario al menos)
    const channelsToTry = [emfravision, olmTv, anyLive, PIP_DEFAULT].filter(Boolean);
    let currentTryIndex = 0;

    function tryPlayChannel() {
        if (currentTryIndex >= channelsToTry.length) {
            widget.hidden = true; // Ningún canal funcionó
            return;
        }

        const activeItem = channelsToTry[currentTryIndex];
        const streamUrl  = activeItem.stream_url;
        titleEl.textContent = activeItem.title;

        if (pipHlsInstance) { pipHlsInstance.destroy(); pipHlsInstance = null; }
        player.innerHTML = '';

        const vid = document.createElement('video');
        vid.muted = true;  // autoplay requiere muted
        vid.autoplay = true;
        vid.playsInline = true;
        player.appendChild(vid);

        let errorHandled = false;
        const handlePlaybackError = () => {
            if (errorHandled) return;
            errorHandled = true;
            console.warn(`PiP: Falló ${activeItem.title}, intentando fallback...`);
            currentTryIndex++;
            tryPlayChannel();
        };

        if (Hls.isSupported()) {
            pipHlsInstance = new Hls({ lowLatencyMode: true });
            
            // Manejar errores de HLS (404, CORS, etc)
            pipHlsInstance.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR || data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        handlePlaybackError();
                    } else {
                        pipHlsInstance.destroy();
                    }
                }
            });

            pipHlsInstance.loadSource(streamUrl);
            pipHlsInstance.attachMedia(vid);
            pipHlsInstance.on(Hls.Events.MANIFEST_PARSED, () => vid.play().catch(handlePlaybackError));
        } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
            vid.src = streamUrl;
            vid.addEventListener('error', handlePlaybackError);
            vid.play().catch(handlePlaybackError);
        }

        widget.hidden = false;
    }

    tryPlayChannel();
}

function closePip() {
    const widget = $('pip-widget');
    if (pipHlsInstance) { pipHlsInstance.destroy(); pipHlsInstance = null; }
    $('pip-player').innerHTML = '';
    if (widget) widget.hidden = true;
}

/* ============================================================
   PLAYER (funciones auxiliares compartidas)
============================================================ */
function attachHlsOrNative(videoEl, url) {
    if (Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => { }));
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = url;
        videoEl.play().catch(() => { });
    } else {
        videoEl.parentElement.innerHTML =
            `<div class="state-msg">Tu navegador no soporta HLS.</div>`;
    }
}

function playInPlayer(container, ep) {
    container.innerHTML = '';
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    if (ep.embed_url) {
        container.innerHTML = `<iframe src="${ep.embed_url}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture"></iframe>`;
        return;
    }

    const streamSrc = cleanUrl(ep.stream_url);
    const fileSrc = cleanUrl(ep.file_url);
    const src = streamSrc || fileSrc;

    if (src) {
        const vid = document.createElement('video');
        vid.controls = true; vid.autoplay = true; vid.playsInline = true;
        container.appendChild(vid);
        if (src.includes('.m3u8') || streamSrc) {
            attachHlsOrNative(vid, src);
        } else {
            container.innerHTML = `<iframe src="${src}" allowfullscreen allow="autoplay"></iframe>`;
        }
        return;
    }

    container.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:center;background:var(--bg3);position:absolute;inset:0;color:var(--muted);">
    No hay reproductor disponible para este contenido.
  </div>`;
}

/* ============================================================
   MODAL / PLAYER
============================================================ */
function openModal(item) {
    const overlay = $('modal-overlay');
    const player  = $('modal-player');
    const epSec   = $('episodes-section');

    // Guardar referencia al ítem actual (para compartir)
    currentModalItem = item;

    // Guardar foco actual para restaurarlo al cerrar
    lastFocus = document.activeElement;

    // Cerrar el PiP para evitar audio doble
    closePip();

    $('modal-title').textContent = item.title || '';
    $('modal-desc').textContent = item.description || '';

    player.innerHTML = '';
    epSec.style.display = 'none';
    epSec.classList.remove('episodes-open');
    $('episodes-list').innerHTML = '';
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    if (item.is_series) {
        player.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:center;background:var(--bg3);position:absolute;inset:0;">
    <img src="${item.thumbnail}" alt="${esc(item.title)}" style="max-height:100%;max-width:100%;object-fit:contain;opacity:.4" />
    <span style="position:absolute;color:var(--muted);font-size:.9rem">Selecciona un episodio ↓</span>
  </div>`;
        loadEpisodes(item.id);
    } else {
        playInPlayer(player, item);
    }

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Mover foco al botón de cerrar
    requestAnimationFrame(() => $('modal-close').focus());

    // Instalar focus trap dentro del modal
    const modal = $('modal');
    trapHandler = (e) => {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(modal.querySelectorAll(
            'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
            if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
        }
    };
    modal.addEventListener('keydown', trapHandler);
}

async function loadEpisodes(seriesId) {
    const epSec = $('episodes-section');
    const epList = $('episodes-list');
    epSec.style.display = 'block';
    epSec.classList.add('episodes-open');
    epList.innerHTML = `<div class="ep-loading"><div class="spinner" style="width:24px;height:24px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px"></div>Cargando episodios…</div>`;

    try {
        const data = await fetchEpisodes(seriesId);
        const eps = data.episodes || data.content || [];
        if (!eps.length) {
            epList.innerHTML = `<div class="ep-loading">Sin episodios disponibles.</div>`;
            return;
        }
        epList.innerHTML = eps.map((ep, i) => `
  <div class="ep-item" tabindex="0" role="button"
       data-embed="${esc(ep.embed_url || '')}"
       data-file="${esc(ep.file_url || '')}" data-stream="${esc(ep.stream_url || '')}"
       data-title="${esc(ep.title || '')}" data-thumb="${esc(ep.thumbnail || '')}"
       data-desc="${esc(ep.description || '')}" aria-label="${esc(ep.title || '')}">
    <div class="ep-thumb">
      <img src="${esc(ep.thumbnail || '')}" alt="${esc(ep.title)}" loading="lazy" onerror="this.style.opacity=0" />
    </div>
    <div class="ep-info">
      <div class="ep-num">Ep. ${i + 1}</div>
      <div class="ep-title">${esc(ep.title)}</div>
      <div class="ep-desc">${esc(ep.description || '')}</div>
    </div>
  </div>`).join('');

        epList.querySelectorAll('.ep-item').forEach(el => {
            const handler = () => {
                // Resaltar episodio activo
                epList.querySelectorAll('.ep-item').forEach(e => e.classList.remove('ep-active'));
                el.classList.add('ep-active');

                const ep = {
                    title:      el.dataset.title,
                    embed_url:  el.dataset.embed,
                    file_url:   el.dataset.file,
                    stream_url: el.dataset.stream,
                    thumbnail:  el.dataset.thumb,
                };
                $('modal-title').textContent = ep.title;
                $('modal-desc').textContent = el.dataset.desc || '';
                playInPlayer($('modal-player'), ep);
                $('modal-overlay').scrollTop = 0;
            };
            el.addEventListener('click', handler);
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
            });
        });

        epList.querySelector('.ep-item')?.click();

    } catch (e) {
        epList.innerHTML = `<div class="ep-loading">Error al cargar episodios.</div>`;
        console.error(e);
    }
}

function closeModal() {
    const modal = $('modal');
    $('modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
    // Desinstalar focus trap
    if (trapHandler) { modal.removeEventListener('keydown', trapHandler); trapHandler = null; }
    // Restaurar foco previo
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
    setTimeout(() => {
        $('modal-player').innerHTML = '';
        if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    }, 300);
}

/* ============================================================
   SEARCH
============================================================ */
const doSearch = debounce(async (q) => {
    searchQuery = q.trim();

    if (!searchQuery) {
        feedHasMore = computeFeedHasMore();
        renderGrid();
        return;
    }
    showGridLoading();
    try {
        const data = await fetchSearch(searchQuery);
        const results = data.results || data.content || data.items || [];
        renderGrid(results);
    } catch (e) {
        $('content-grid').innerHTML = `<div class="state-msg">Error en la búsqueda.</div>`;
    }
}, 400);

/* ============================================================
   SORT (re-fetch desde cero)
============================================================ */
async function onSortChange(sort) {
    currentSort = sort;
    fetchOffset = 0;
    feedHasMore = false;
    showGridLoading();
    try {
        const data = await fetchFeedCached(sort, 0);
        allCategories = (data.categories || []).map(sanitizeCat);
        fetchOffset = CONFIG.pageSize;
        feedHasMore = allCategories.some(c => c.has_more);

        buildTabs();
        renderGrid();
    } catch (e) {
        $('content-grid').innerHTML = `<div class="state-msg">Error al cambiar orden.</div>`;
    }
}

/* ============================================================
   EVENTS — dentro de DOMContentLoaded para seguridad
============================================================ */
document.addEventListener('DOMContentLoaded', () => {

    // Carousel arrows
    $('carousel-prev').addEventListener('click', () => { goToSlide(carouselIndex - 1); startCarouselTimer(); });
    $('carousel-next').addEventListener('click', () => { goToSlide(carouselIndex + 1); startCarouselTimer(); });

    // Pausa al hacer hover
    $('hero-carousel').addEventListener('mouseenter', () => {
        clearInterval(carouselTimer);
        $('carousel-progress').style.transition = 'none';
    });
    $('hero-carousel').addEventListener('mouseleave', () => startCarouselTimer());

    // Swipe táctil — touchStartX en scope local
    let touchStartX = 0;
    $('hero-carousel').addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    $('hero-carousel').addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 40) { goToSlide(carouselIndex + (dx < 0 ? 1 : -1)); startCarouselTimer(); }
    }, { passive: true });

    // Búsqueda, orden y modal
    $('search-input').addEventListener('input', e => doSearch(e.target.value));
    $('sort-select').addEventListener('change', e => onSortChange(e.target.value));
    $('modal-share').addEventListener('click', () => {
        if (currentModalItem) shareItem(currentModalItem);
    });
    $('modal-close').addEventListener('click', closeModal);
    $('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    // Cargar más — paginación real con API
    $('load-more-btn').addEventListener('click', loadMoreFromAPI);

    // Botones del widget PiP
    $('pip-close').addEventListener('click', closePip);
    $('pip-expand').addEventListener('click', () => {
        // Buscar el item live en el feed para abrirlo en el modal completo
        let defaultItem = null;
        let anyLiveItem = null;
        for (const cat of allCategories) {
            for (const i of cat.content) {
                if (i.type === 'live_feed') {
                    if (!anyLiveItem) anyLiveItem = i;
                    if (cleanUrl(i.stream_url) === PIP_DEFAULT.stream_url) {
                        defaultItem = i;
                        break;
                    }
                }
            }
            if (defaultItem) break;
        }
        const activeItem = defaultItem || anyLiveItem || {
            title: PIP_DEFAULT.title,
            stream_url: PIP_DEFAULT.stream_url,
            type: 'live_feed',
            description: '',
            is_series: false,
        };
        closePip();
        openModal(activeItem);
    });

    // START
    init();
});
