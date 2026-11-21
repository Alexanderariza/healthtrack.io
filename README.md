# HealthTrack

Aplicación web progresiva (PWA) personal para registrar presión arterial, frecuencia cardíaca, peso y factores asociados.

## Ejecutar en local

No abras `index.html` directamente con `file://`: los módulos JavaScript, IndexedDB y el Service Worker requieren un origen web seguro.

Desde la carpeta del proyecto:

```bash
python -m http.server 8000
```

Abre `http://localhost:8000`.

## Publicar en GitHub Pages

1. Sube el contenido de esta carpeta al repositorio.
2. En GitHub, abre **Settings → Pages**.
3. Selecciona la rama y la carpeta raíz (o `/docs`, si has colocado allí el proyecto).
4. Espera a que GitHub Pages publique el sitio y abre la URL HTTPS.

La aplicación utiliza rutas relativas y no depende de CDN para los gráficos. La primera carga necesita conexión; después el Service Worker almacena los recursos esenciales para uso offline.

## Datos y privacidad

- Las mediciones se guardan en IndexedDB en el navegador y dispositivo donde se introducen.
- No hay sincronización entre dispositivos ni envío automático a un servidor.
- Exporta copias JSON periódicamente y guárdalas en un lugar seguro.
- Borrar los datos del sitio o perder el dispositivo puede hacer que los registros locales sean irrecuperables si no existe una copia.

## Pruebas

Con Node.js 18 o superior:

```bash
node --experimental-default-type=module --test js/stats.test.js
```

## Alcance clínico

HealthTrack es un registro personal y una ayuda para preparar consultas. Sus avisos son orientativos, no diagnostican ni sustituyen la valoración profesional. No uses la aplicación para decidir por tu cuenta cambios de medicación o para retrasar atención urgente.
