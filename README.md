# La Cajita TV (Web Client) 📺

Aplicación web moderna y responsiva para el consumo de contenido en vivo, series y películas, conectada a la API de TV App Builder.

## 🚀 Características
- **PWA (Progressive Web App):** Instalable en móviles y PC, soporte básico offline (Service Worker).
- **Diseño Responsivo:** Interfaz adaptativa con Flexbox/CSS Grid. Soporte para pantallas horizontales (Landscape) en móviles.
- **Reproductor Integrado:** Soporte para transmisiones en vivo (HLS) mediante `hls.js`, y videos On-Demand (iFrames).
- **Picture-in-Picture (PiP):** Reproducción flotante en la cabecera.
- **Modo Oscuro Elegante:** UI de estética premium basada en tokens (`--bg`, `--brand`, etc.).
- **Favoritos & Compartir:** Guardado local con `localStorage` y API nativa `navigator.share`.
- **Seguridad:** XSS mitigado mediante escape estricto de HTML y Content-Security-Policy (CSP) robusto.

## 🛠️ Stack Tecnológico
- **Frontend:** Vanilla HTML5, CSS3, ES6 JavaScript. No requiere *build steps* complicados.
- **Dependencias Estáticas:**
  - `hls.min.js` (Fijado y verificado criptográficamente con SRI).
- **Herramientas de Desarrollo:** `ESLint` y `Prettier` configurados para mantener el código uniforme.

## 💻 Entorno Local
Para correr y editar este proyecto en tu entorno local:

1. Instala las dependencias de desarrollo:
   ```bash
   npm install
   ```
2. Inicia el servidor de desarrollo en el puerto 3000:
   ```bash
   npm run dev
   ```
3. Formatea y limpia el código (Opcional):
   ```bash
   npm run format
   npm run lint
   ```

## 📄 Estructura Principal
*   `/index.html`: Punto de entrada, declaraciones de meta-tags, CSP y UI base.
*   `/styles.css`: +1,500 líneas de estilos modulares organizados por componentes.
*   `/app.js`: Cerebro de la aplicación (Lógica de API, renderizado del DOM, reproductor HLS).
*   `/manifest.json` y `/sw.js`: Archivos de configuración de PWA.

> **Nota para futuros desarrolladores:** El archivo `app.js` maneja múltiples responsabilidades. Si el proyecto crece considerablemente, se recomienda introducir un bundler (ej. Vite) para separar `app.js` en módulos de ES6 de forma escalable sin perder control de las variables de estado global.

## 🛡️ Configuración
El canal o iglesia conectada a la aplicación se define en las primeras líneas de `app.js`:
```javascript
const CONFIG = {
    churchId: 141, // <--- Modificar para cambiar de canal en TVAppBuilder
    apiBase: 'https://tvappbuilder.com/API/V1/embed',
    pageSize: 12,
    carouselInterval: 6000,
};
```
