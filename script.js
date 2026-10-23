/* ============================================
   ANTI-PULL-TO-REFRESH  (Chrome/Android)
   ============================================ */
let touchStartY = 0;
document.addEventListener('touchstart', e => {
  touchStartY = e.touches[0].screenY;
}, { passive: true });

document.addEventListener('touchmove', e => {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const deltaY    = e.touches[0].screenY - touchStartY;
  if (scrollTop === 0 && deltaY > 0) e.preventDefault();
}, { passive: false });
/* ============================================ */
/* ============================================
   CONVERSIÓN UTM → LAT/LON (WGS84) - España (Comunidad Valenciana)
   ============================================ */
function utmToLatLon(easting, northing, zoneNumber, northernHemisphere = true) {
    const a = 6378137.0;
    const eccSquared = 0.00669438;
    const k0 = 0.9996;

    const eccPrimeSquared = eccSquared / (1 - eccSquared);
    const e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared));
    const rad2deg = 180 / Math.PI;

    easting -= 500000.0;
    let arcLength = northing / k0;
    if (!northernHemisphere) arcLength -= 10000000.0;

    const mu = arcLength / (a * (1 - eccSquared / 4.0 - 3 * eccSquared * eccSquared / 64.0 - 5 * eccSquared * eccSquared * eccSquared / 256.0));
    const ei = (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32.0) * Math.sin(2 * mu) +
               (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32.0) * Math.sin(4 * mu) +
               (151 * e1 * e1 * e1 / 96.0) * Math.sin(6 * mu);
    const phi1 = mu + ei;

    const n = a / Math.sqrt(1 - eccSquared * Math.sin(phi1) * Math.sin(phi1));
    const t = Math.tan(phi1) * Math.tan(phi1);
    const c = eccPrimeSquared * Math.cos(phi1) * Math.cos(phi1);
    const r = a * (1 - eccSquared) / Math.pow(1 - eccSquared * Math.sin(phi1) * Math.sin(phi1), 1.5);
    const d = easting / (n * k0);

    let lat = phi1 - (n * Math.tan(phi1) / r) *
        (d * d / 2.0 -
         d * d * d * d / 24.0 * (5 + 3 * t + 10 * c - 4 * c * c - 9 * eccPrimeSquared) +
         d * d * d * d * d * d / 720.0 * (61 + 90 * t + 298 * c + 45 * t * t - 252 * eccPrimeSquared - 3 * c * c));

    let lon = (d -
        d * d * d / 6.0 * (1 + 2 * t + c) +
        d * d * d * d * d / 120.0 * (5 - 2 * c + 28 * t - 3 * c * c + 8 * eccPrimeSquared + 24 * t * t)) / Math.cos(phi1);

    const lonOrigin = (zoneNumber - 1) * 6 - 180 + 3;
    lat = lat * rad2deg;
    lon = lonOrigin + lon * rad2deg;

    return { lat, lon };
}

function parseUTM(input) {
    let clean = input.trim().toUpperCase();
    clean = clean.replace(/,/g, ' ').replace(/\s+/g, ' ');

    const parts = clean.split(' ');
    const nums = [];
    let zonePart = null;

    for (const p of parts) {
        if (/^\d{5,7}$/.test(p)) {
            nums.push(parseInt(p, 10));
        } else if (/^\d{1,2}[NS]$/.test(p)) {
            zonePart = p;
        }
    }

    if (nums.length < 2) return null;

    const easting = nums[0];
    const northing = nums[1];

    if (easting < 100000 || easting > 999999 || northing < 4000000 || northing > 5000000) {
        return null;
    }

    let zoneNumber = 30;
    let northern = true;

    if (zonePart) {
        zoneNumber = parseInt(zonePart.slice(0, -1), 10);
        northern = zonePart.endsWith('N');
        if (zoneNumber < 1 || zoneNumber > 60) return null;
    }

    return { easting, northing, zoneNumber, northern };
}

/* ============================================
   FECHA LOCAL CORRECTA (sin problema UTC)
   ============================================ */
function getFechaLocalISO() {
    const ahora = new Date();
    const año = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');
    return `${año}-${mes}-${dia}`;
}
// Función para obtener el municipio a partir de coordenadas
async function obtenerMunicipio(lat, lng) {
  try {
    // ✅ AÑADIR accept-language=ca para pedir datos en valenciano
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1&countrycodes=ES&accept-language=ca`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data && data.address) {
      // Prioridad: municipio > ciudad > pueblo > county
      const address = data.address;
      const municipio = 
        address.town || 
        address.city || 
        address.village || 
        address.county || 
        address.state_district || 
        "Desconocido";
      
      const provincia = address.state || "";
      return { municipio, provincia };
    }
    return { municipio: "No encontrado", provincia: "" };
  } catch (error) {
    console.error("Error al obtener municipio:", error);
    return { municipio: "Error", provincia: "" };
  }
}
/* ============================================
   INDEXEDDB - GESTIÓN DE REGISTROS LOCALES
   ============================================ */
const DB_NAME = 'RecogidasDB';
const DB_VERSION = 2;
const STORE_NAME = 'registros';
const DB_APERTURA_TIMEOUT_MS = 15000;

/* ============================================
   AISLAMIENTO DE DESARROLLO - BACKEND CRF ALICANTE
   ============================================ */
// Bloqueo local deliberado: el backend propio de CRF Alicante aún no está
// desplegado ni verificado. Mantener en false hasta disponer de su URL /exec.
// Las URLs de La Granja se han retirado de este archivo.
const BACKEND_ALICANTE_CONFIGURADO = true;

// URL del despliegue propio de CRF Alicante. Debe ser la URL /exec del
// proyecto Apps Script de Alicante, verificada antes de activar el flag.
// Se deja vacía a propósito: no se reutiliza ninguna URL de La Granja.
const API_ALICANTE_URL = "https://script.google.com/macros/s/AKfycbzAd2jU6knA3K0WdmP-SeY1uzewCWPzqu0fihejjCroh6cCdY9nH8pwOnicGN-egfn1AA/exec";

function avisarBackendDeshabilitado(operacion) {
    console.warn(`Backend de CRF Alicante deshabilitado (${operacion}). No se ejecuta fetch.`);
    try {
        alert(`La conexión con el backend está deshabilitada en esta copia de desarrollo de CRF Alicante.\n\nNo se ha realizado ninguna petición, no se ha creado ni actualizado ningún registro local y no se ha marcado ninguno como enviado.\n\nOperación bloqueada: ${operacion}.\n\nEl formulario no se ha restablecido.`);
    } catch (errAviso) {
        console.error('No se pudo mostrar el aviso de backend deshabilitado:', errAviso);
    }
}

// Inicializar IndexedDB (una única promesa compartida: nunca abre la base dos veces)
let db;
let dbLista = null;
const initDB = () => {
    if (dbLista) return dbLista;
    dbLista = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined' || !indexedDB) {
            reject(new Error('IndexedDB no está disponible en este navegador'));
            return;
        }
        let avisoBloqueoMostrado = false;
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onblocked = () => {
            // No se rechaza la apertura: sigue esperando a que se libere el bloqueo.
            // El aviso se muestra una sola vez por apertura.
            if (avisoBloqueoMostrado) return;
            avisoBloqueoMostrado = true;
            alert('La base de datos local está bloqueada por otra pestaña de esta aplicación. Cierra las demás pestañas para permitir que se abra. Si la operación en curso ha fallado por tiempo de espera, tendrás que volver a intentarla.');
        };
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('fecha', 'fecha', { unique: false });
                store.createIndex('municipio', 'municipio', { unique: false });
                store.createIndex('envio_id', 'envio_id', { unique: false });
            }
        };
    });
    return dbLista;
};

// Esperar a que la base esté disponible (con límite de tiempo).
// No cancela indexedDB.open(): si la apertura termina más tarde, las operaciones
// nuevas podrán usar la base ya abierta. No hay reintentos automáticos.
const obtenerDB = () => {
    const apertura = Promise.resolve(initDB());
    let temporizador = null;
    const limiteTiempo = new Promise((resolve, reject) => {
        temporizador = setTimeout(() => {
            const err = new Error('Tiempo de espera agotado al abrir la base de datos local');
            err.baseLocalNoDisponible = true;
            reject(err);
        }, DB_APERTURA_TIMEOUT_MS);
    });

    return Promise.race([apertura, limiteTiempo])
        .catch((causa) => {
            // El timeout ya devuelve un error normalizado: se conserva tal cual.
            if (causa && causa.baseLocalNoDisponible) throw causa;
            const err = new Error('No se pudo abrir la base de datos local');
            err.baseLocalNoDisponible = true;
            err.causa = causa;
            throw err;
        })
        .finally(() => {
            if (temporizador !== null) {
                clearTimeout(temporizador);
                temporizador = null;
            }
        });
};

// Generar envio_id con crypto.randomUUID() + fallback
function generarEnvioId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback para WebViews antiguos
    return 'env-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
}

// ===== INICIO HELPERS TESTABLES DE ENVÍO (sin red ni IndexedDB) =====
// Este bloque se extrae tal cual en 04_PRUEBAS/pruebas_frontend_alicante_jjs.js.
// No debe depender de IndexedDB, fetch, localStorage ni del DOM, salvo
// aplicarModoSoloLectura(), que solo usa document/window.
//
// Mismo contrato que validarEnvioId() del backend: no vacío, máximo 64
// caracteres y solo letras, números, guion y guion bajo.
//
// Tope anual idéntico al del backend (MAX_NUMERO_ENTRADA_ANUAL).
var MAX_NUMERO_ENTRADA_ANUAL = 1000000;

function esEnvioIdValido(envioId) {
    if (typeof envioId !== 'string') return false;
    const id = envioId.trim();
    return id.length > 0 && id.length <= 64 && /^[a-zA-Z0-9\-_]+$/.test(id);
}

// Valida números de entrada sin modificar el array recibido. La
// consecutividad se comprueba sobre una copia ordenada.
function validarNumerosAsignados(numeros, cantidad) {
    if (!Array.isArray(numeros)) return false;
    if (typeof cantidad !== 'number' || !isFinite(cantidad) ||
        Math.floor(cantidad) !== cantidad || cantidad < 1) {
        return false;
    }
    if (numeros.length !== cantidad) return false;

    const vistos = {};
    for (let i = 0; i < numeros.length; i++) {
        const numero = numeros[i];
        if (typeof numero !== 'number' || !isFinite(numero) ||
            Math.floor(numero) !== numero || numero <= 0 ||
            numero > MAX_NUMERO_ENTRADA_ANUAL) {
            return false;
        }
        if (vistos[numero]) return false;
        vistos[numero] = true;
    }

    const ordenados = numeros.slice().sort(function (a, b) { return a - b; });
    for (let i = 1; i < ordenados.length; i++) {
        if (ordenados[i] !== ordenados[i - 1] + 1) return false;
    }
    return true;
}

// Decide si un registro local se puede reenviar y cuál es su envio_id y su
// cantidad autoritativos. Devuelve un motivo estable para poder probarlo y
// para que enviarDatos() muestre el aviso correspondiente.
function validarRegistroLocalParaEnvio(registroLocal, existingEnvioId, cantidadFormulario) {
    if (!registroLocal) return { ok: false, motivo: 'NO_EXISTE' };
    if (registroLocal.estado === 'enviado') return { ok: false, motivo: 'REGISTRO_ENVIADO' };
    if (!registroLocal.envio_id) return { ok: false, motivo: 'ENVIO_ID_AUSENTE' };
    if (!esEnvioIdValido(registroLocal.envio_id)) return { ok: false, motivo: 'ENVIO_ID_INVALIDO' };
    if (existingEnvioId && existingEnvioId !== registroLocal.envio_id) {
        return { ok: false, motivo: 'ENVIO_ID_CAMBIADO' };
    }

    const cantidadLocal = parseInt(registroLocal.cantidad_animales, 10);
    if (isNaN(cantidadLocal) || Math.floor(cantidadLocal) !== cantidadLocal || cantidadLocal < 1) {
        return { ok: false, motivo: 'CANTIDAD_LOCAL_INVALIDA' };
    }
    if (cantidadLocal !== cantidadFormulario) {
        return { ok: false, motivo: 'CANTIDAD_CAMBIADA' };
    }

    return { ok: true, envioId: registroLocal.envio_id, cantidad: cantidadLocal };
}

// Campos que forman la huella de un envío. Se excluyen a propósito el número
// de entrada (lo asigna el backend), la foto (no se puede reponer tras recargar)
// y los campos de control (id, estado, envio_id, timestamp, numerosAsignados).
var CAMPOS_HUELLA_ENVIO = [
    'especie_comun', 'especie_cientifico', 'cantidad_animales', 'fecha',
    'municipio', 'posible_causa', 'remitente', 'estado_animal',
    'coordenadas', 'coordenadas_mapa', 'apoyo', 'cra_km', 'observaciones',
    'cumplimentado_por', 'telefono_remitente', 'tipo_salida'
];

// La "clave" identifica el envío SIN la cantidad de animales, de modo que un
// cambio de cantidad entre intentos se pueda detectar por separado y bloquear
// en lugar de tratarse como un envío nuevo.
var CAMPOS_CLAVE_ENVIO = (function () {
    var campos = [];
    for (var i = 0; i < CAMPOS_HUELLA_ENVIO.length; i++) {
        if (CAMPOS_HUELLA_ENVIO[i] !== 'cantidad_animales') campos.push(CAMPOS_HUELLA_ENVIO[i]);
    }
    return campos;
})();

function normalizarValorHuella_(valor) {
    if (Array.isArray(valor)) {
        return valor.map(function (v) {
            return String(v === null || v === undefined ? '' : v);
        }).join('\u0001');
    }
    if (valor === null || valor === undefined) return '';
    return String(valor);
}

function componerHuella_(datos, campos) {
    if (!datos) return '';
    var partes = [];
    for (var i = 0; i < campos.length; i++) {
        partes.push(campos[i] + '=' + normalizarValorHuella_(datos[campos[i]]));
    }
    return partes.join('\u0002');
}

// Huella determinista completa (incluye la cantidad de animales).
function calcularHuellaEnvio(datos) {
    return componerHuella_(datos, CAMPOS_HUELLA_ENVIO);
}

// Clave determinista del envío (excluye la cantidad de animales).
function calcularClaveEnvio(datos) {
    return componerHuella_(datos, CAMPOS_CLAVE_ENVIO);
}

// Snapshot inmutable de los campos que identifican el contenido de un envío.
// Se guarda SOLO en el primer intento de una operación y no se sobrescribe en
// los reintentos: sirve para detectar si el usuario ha cambiado algo entre
// intentos sin confundir ese cambio con una operación nueva.
function construirDatosOriginales_(datos) {
    var copia = {};
    if (!datos) return copia;
    for (var i = 0; i < CAMPOS_HUELLA_ENVIO.length; i++) {
        var campo = CAMPOS_HUELLA_ENVIO[i];
        var valor = datos[campo];
        copia[campo] = Array.isArray(valor) ? valor.slice() : valor;
    }
    return copia;
}

// Decide el estado que se puede aplicar a un registro local sin degradarlo.
// Un registro ya 'enviado' NUNCA se puede devolver a 'guardado' ni a
// 'pendiente_confirmacion'. Devuelve un motivo estable y probable.
function resolverEstadoRegistroLocal(estadoActual, estadoDeseado) {
    if (estadoActual === 'enviado' && estadoDeseado !== 'enviado') {
        return { ok: false, motivo: 'REGISTRO_ENVIADO', estado: 'enviado' };
    }
    return { ok: true, motivo: 'OK', estado: estadoDeseado };
}

// Mensajes de bloqueo de la recuperación de un envío. Explican siempre cómo
// reconciliar el estado local. No modifican nada por sí solos.
function mensajeBloqueoRecuperacion(resolucion) {
    var motivo = resolucion && resolucion.motivo ? resolucion.motivo : 'DESCONOCIDO';
    var cierre = '\n\nNo se ha enviado nada y no se ha generado ningún envio_id nuevo.';
    var reconciliar = '\n\nAbre «Ver registros guardados» y usa «Comprobar si ya fue registrada»; si estás seguro de que el envío pendiente no llegó a registrarse, elimínalo desde ahí y vuelve a intentarlo.';
    switch (motivo) {
        case 'ENVIADO_EXISTE':
            return '⚠️ Ya existe un registro local ENVIADO con estos mismos datos. No se ha enviado nada para no duplicar en el servidor.' + cierre +
                '\n\nSi es un envío realmente nuevo, cámbialo para distinguirlo, o consúltalo en «Ver registros guardados».';
        case 'MULTIPLES':
            return '⚠️ Hay varios registros locales sin confirmar que podrían corresponder a este envío y no se puede decidir con seguridad cuál es.' + cierre + reconciliar;
        case 'IRRESOLUBLE':
            return '⚠️ Existe al menos un envío anterior SIN CONFIRMAR, pero no se puede demostrar que corresponda a este formulario.' + cierre + reconciliar;
        case 'CANTIDAD_CAMBIADA':
            return '⚠️ Hay un registro local pendiente de este mismo envío pero con distinta cantidad de animales. No se ha enviado nada para no duplicar.' + cierre +
                '\n\nAbre «Ver registros guardados» y reenvíalo desde allí con su cantidad original, o corrige la cantidad del formulario.';
        case 'CANTIDAD_LOCAL_INVALIDA':
            return '⚠️ El registro local pendiente tiene una cantidad de animales inválida y no se puede reutilizar.' + cierre + reconciliar;
        case 'ENVIO_ID_AUSENTE':
            return '⚠️ El registro local que corresponde a este envío no tiene un envio_id válido y no se puede reutilizar.' + cierre + reconciliar;
        case 'SIN_DATOS':
        case 'SIN_HUELLA':
            return '⚠️ No se pudieron preparar los datos de este envío.' + cierre;
        default:
            return '⚠️ No se ha podido determinar el registro local de este envío (motivo: ' + motivo + ').' + cierre + reconciliar;
    }
}

// Decide a qué registro local corresponde un envío nuevo ANTES de generar
// cualquier envio_id. La identidad es persistente (puntero con operacion_id en
// localStorage + operacion_id en el propio registro) y NO depende de los campos
// del formulario: así, si el usuario edita observaciones u otro campo entre
// intentos, se sigue reconociendo el MISMO envío incierto y se reutiliza su
// envio_id en lugar de crear uno nuevo.
//
// Devuelve:
//   { accion: 'NUEVO' }                                       -> sin envío previo: envio_id nuevo
//   { accion: 'REUTILIZAR', registro, datosCambiados, viaIdentidad } -> reutilizar id y envio_id
//   { accion: 'BLOQUEAR', motivo, ... }                       -> no decidible con seguridad
//
// Motivos de bloqueo: SIN_DATOS, SIN_HUELLA, ENVIADO_EXISTE, MULTIPLES,
// IRRESOLUBLE, ENVIO_ID_AUSENTE, CANTIDAD_LOCAL_INVALIDA, CANTIDAD_CAMBIADA.
// Nunca devuelve un registro 'enviado' para reutilizar.
function resolverEnvioEnCurso(registros, datos, puntero) {
    if (!Array.isArray(registros)) return { accion: 'BLOQUEAR', motivo: 'SIN_DATOS' };
    if (!datos) return { accion: 'BLOQUEAR', motivo: 'SIN_DATOS' };
    var claveActual = calcularClaveEnvio(datos);
    if (!claveActual) return { accion: 'BLOQUEAR', motivo: 'SIN_HUELLA' };
    var cantidadActual = parseInt(datos.cantidad_animales, 10);

    var noConfirmados = [];
    for (var i = 0; i < registros.length; i++) {
        var r = registros[i];
        if (!r) continue;
        if (r.estado === 'guardado' || r.estado === 'pendiente_confirmacion') noConfirmados.push(r);
    }

    // 0) Un envío ya confirmado con la misma clave impide crear un ID nuevo.
    for (var m = 0; m < registros.length; m++) {
        var re = registros[m];
        if (!re || re.estado !== 'enviado') continue;
        var claveEnviado = re.clave_envio || calcularClaveEnvio(re);
        if (claveEnviado === claveActual) {
            return { accion: 'BLOQUEAR', motivo: 'ENVIADO_EXISTE', registro: re };
        }
    }

    // 1) Identidad persistente: el puntero identifica sin ambigüedad el envío
    //    en curso, aunque hayan cambiado los campos del formulario.
    var candidato = null;
    var viaIdentidad = false;
    if (puntero && typeof puntero === 'object' &&
        puntero.registroId !== null && puntero.registroId !== undefined &&
        esEnvioIdValido(puntero.operacion_id)) {
        for (var j = 0; j < registros.length; j++) {
            var rp = registros[j];
            if (!rp) continue;
            if (rp.id === puntero.registroId &&
                rp.operacion_id === puntero.operacion_id &&
                rp.envio_id === puntero.envioId) {
                if (rp.estado === 'enviado') {
                    return { accion: 'BLOQUEAR', motivo: 'ENVIADO_EXISTE', registro: rp };
                }
                candidato = rp;
                viaIdentidad = true;
                break;
            }
        }
    }

    // 2) Sin identidad persistente: candidatos por clave exacta (mismos datos
    //    salvo la cantidad). Más de uno es ambiguo y se bloquea.
    if (!candidato) {
        var porClave = [];
        for (var k = 0; k < noConfirmados.length; k++) {
            var rc = noConfirmados[k];
            var clave = rc.clave_envio || calcularClaveEnvio(rc);
            if (clave === claveActual) porClave.push(rc);
        }
        if (porClave.length > 1) {
            return { accion: 'BLOQUEAR', motivo: 'MULTIPLES', registros: porClave };
        }
        if (porClave.length === 1) {
            candidato = porClave[0];
        }
    }

    // 3) Sin candidato inequívoco. Cualquier envío sin confirmar del que no se
    //    pueda demostrar que NO corresponde a esta operación bloquea un ID nuevo.
    if (!candidato) {
        if (noConfirmados.length > 0) {
            return { accion: 'BLOQUEAR', motivo: 'IRRESOLUBLE', registros: noConfirmados };
        }
        return { accion: 'NUEVO' };
    }

    // 4) Comprobaciones del candidato elegido.
    if (candidato.estado === 'enviado') {
        return { accion: 'BLOQUEAR', motivo: 'ENVIADO_EXISTE', registro: candidato };
    }
    if (!esEnvioIdValido(candidato.envio_id)) {
        return { accion: 'BLOQUEAR', motivo: 'ENVIO_ID_AUSENTE', registro: candidato };
    }
    var cantidadCandidato = parseInt(candidato.cantidad_animales, 10);
    if (isNaN(cantidadCandidato) || Math.floor(cantidadCandidato) !== cantidadCandidato || cantidadCandidato < 1) {
        return { accion: 'BLOQUEAR', motivo: 'CANTIDAD_LOCAL_INVALIDA', registro: candidato };
    }
    if (cantidadCandidato !== cantidadActual) {
        return {
            accion: 'BLOQUEAR', motivo: 'CANTIDAD_CAMBIADA', registro: candidato,
            cantidadCandidato: cantidadCandidato, cantidadFormulario: cantidadActual
        };
    }

    // Contenido original inmutable: detecta cambios posteriores (observaciones u
    // otros campos) sin confundirlos con una operación nueva. Para registros
    // antiguos sin snapshot se usa la huella almacenada o los propios campos.
    var huellaOriginal = '';
    if (candidato.huella_original) huellaOriginal = candidato.huella_original;
    else if (candidato.datos_originales) huellaOriginal = calcularHuellaEnvio(candidato.datos_originales);
    else huellaOriginal = candidato.huella_envio || calcularHuellaEnvio(candidato);
    var datosCambiados = huellaOriginal !== calcularHuellaEnvio(datos);

    return {
        accion: 'REUTILIZAR', registro: candidato,
        viaIdentidad: viaIdentidad, datosCambiados: datosCambiados
    };
}

// Solo se puede borrar un registro en estado 'guardado' o
// 'pendiente_confirmacion'. Un 'enviado' no se borra y un estado desconocido
// tampoco (podría necesitar reconciliación). El botón ya no se renderiza para
// enviados, pero esta comprobación también cubre llamadas manuales.
function puedeEliminarRegistroLocal(registroLocal) {
    return !!registroLocal &&
        (registroLocal.estado === 'guardado' || registroLocal.estado === 'pendiente_confirmacion');
}

// La eliminación de un pendiente exige exactamente la palabra ELIMINAR.
function esConfirmacionEliminarPendienteValida(valor) {
    return valor === 'ELIMINAR';
}

// Solo se borra un pendiente si SweetAlert confirmó y el texto es exacto.
function debeEliminarRegistroPendiente(resultado) {
    return !!resultado &&
        resultado.isConfirmed === true &&
        esConfirmacionEliminarPendienteValida(resultado.value);
}

// Activa o desactiva el modo de solo lectura real del formulario. No toca
// los botones de consulta, importación o exportación.
window.modoSoloLectura = false;
function aplicarModoSoloLectura(activo) {
    window.modoSoloLectura = !!activo;
    const formulario = document.getElementById('formulario');
    if (!formulario) return;

    const excluir = { btnVerRegistros: true, btnImportar: true, btnExportar: true, importarJSON: true };
    formulario.querySelectorAll('input, select, textarea, button').forEach(function (el) {
        if (el.id && excluir[el.id]) return;
        const esCampo = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
        const esAccionFormulario = el.id === 'enviarBtn' || el.id === 'btnLocalizar' || el.id === 'btnBorrarCoords';
        if (esCampo || esAccionFormulario) {
            el.disabled = !!activo;
        }
    });

    const btnEnviar = document.getElementById('enviarBtn');
    if (btnEnviar) {
        btnEnviar.textContent = activo ? 'Solo lectura' : 'Enviar';
        btnEnviar.title = activo ? 'Registro enviado: solo lectura' : '';
    }
}
// ===== FIN HELPERS TESTABLES DE ENVÍO =====

// PUNTERO PERSISTENTE DEL ENVÍO EN CURSO.
// Identifica la operación de envío que está pendiente de confirmación, con
// independencia de los campos del formulario. Vive en localStorage para
// sobrevivir a la recarga de la página y se apoya en el operacion_id guardado
// en el propio registro de IndexedDB. Si el puntero se pierde (por ejemplo, al
// limpiar el almacenamiento del sitio), la recuperación NO improvisa un ID
// nuevo: bloquea y pide reconciliar con «Ver registros guardados».
var CLAVE_PUNTERO_ENVIO_EN_CURSO = 'crf_alicante_envio_en_curso_v1';

function leerPunteroEnvioEnCurso() {
    try {
        const crudo = localStorage.getItem(CLAVE_PUNTERO_ENVIO_EN_CURSO);
        if (!crudo) return null;
        const puntero = JSON.parse(crudo);
        if (!puntero || typeof puntero !== 'object') return null;
        return puntero;
    } catch (err) {
        console.error('No se pudo leer el puntero de envío en curso:', err);
        return null;
    }
}

function guardarPunteroEnvioEnCurso(operacionId, registroId, envioId) {
    try {
        if (!esEnvioIdValido(operacionId) || registroId === null || registroId === undefined) return;
        localStorage.setItem(CLAVE_PUNTERO_ENVIO_EN_CURSO, JSON.stringify({
            v: 1, operacion_id: operacionId, registroId: registroId, envioId: envioId || null
        }));
    } catch (err) {
        console.error('No se pudo guardar el puntero de envío en curso:', err);
    }
}

// Limpia el puntero cuando su operación ya está resuelta (confirmada o borrada).
// Si se indica un registroId, solo se limpia si es el apuntado.
function limpiarPunteroEnvioEnCurso(registroId) {
    try {
        const puntero = leerPunteroEnvioEnCurso();
        if (!puntero) return;
        if (registroId === null || registroId === undefined || puntero.registroId === registroId) {
            localStorage.removeItem(CLAVE_PUNTERO_ENVIO_EN_CURSO);
        }
    } catch (err) {
        console.error('No se pudo limpiar el puntero de envío en curso:', err);
    }
}

// Confirmación explícita para continuar un envío pendiente cuando el contenido
// del formulario ha cambiado respecto al primer intento. Nunca se reutiliza ni
// se crea un ID nuevo sin pasar por aquí (o sin bloquear).
async function confirmarContinuarEnvioPendiente(registro, datos) {
    const originales = (registro && registro.datos_originales) || {};
    const resumenPartes = [];
    if (originales.especie_comun) resumenPartes.push('Especie: ' + originales.especie_comun);
    if (originales.fecha) resumenPartes.push('Fecha: ' + originales.fecha);
    if (originales.municipio) resumenPartes.push('Municipio: ' + originales.municipio);
    if (originales.cantidad_animales) resumenPartes.push('Animales: ' + originales.cantidad_animales);
    const resumen = resumenPartes.join('<br>');
    let resultado;
    try {
        resultado = await Swal.fire({
            icon: 'warning',
            title: 'Envío pendiente de confirmar',
            html:
                'Existe un envío anterior <strong>sin confirmar</strong> que se reconoce como la misma operación:<br><br>' +
                (resumen ? '<strong>' + resumen + '</strong><br><br>' : '') +
                'Se reenviará con el <strong>mismo envio_id</strong>, así que no se duplicará en el servidor.<br><br>' +
                'Si el servidor ya lo había recibido, se conservará lo enviado la primera vez: los cambios que hayas hecho en el formulario (por ejemplo, observaciones) <strong>no se guardarán</strong>.',
            showCancelButton: true,
            confirmButtonText: 'Continuar el mismo envío',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#3085d6'
        });
    } catch (err) {
        console.error('No se pudo confirmar la continuación del envío pendiente:', err);
        return false;
    }
    return !!resultado && resultado.isConfirmed === true;
}

// Serializa el formulario con EXACTAMENTE el mismo criterio que usa el
// autoguardado del borrador. Se reutiliza para que un borrador solo sea
// elegible para limpieza si coincide con la serialización actual del formulario.
// No cambia el formato guardado en localStorage.
function serializarFormulario(form) {
    const obj = {};
    Array.from(form.elements).forEach(el => {
        if (!el.name) return;
        if (el.type === 'checkbox') {
            if (!Array.isArray(obj[el.name])) {
                obj[el.name] = obj[el.name] ? [obj[el.name]] : [];
            }
            if (el.checked) obj[el.name].push(el.value);
        } else if (el.type === 'radio') {
            if (el.checked) obj[el.name] = el.value;
        } else {
            obj[el.name] = el.value;
        }
    });
    return obj;
}

// Mientras es true, el listener de autoguardado NO escribe 'recogidasForm'.
// Solo se activa de forma síncrona y temporal al cargar un registro en el
// formulario, para no sobrescribir el borrador de otra operación pendiente.
let suprimirAutoGuardadoBorrador = false;

// Guardar registro en IndexedDB (sin número de entrada al guardar localmente antes del envío)
const guardarRegistroLocal = async (datos) => {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const datosParaGuardar = { ...datos };
        delete datosParaGuardar.numero_entrada;
        datosParaGuardar.timestamp = new Date().toISOString();
        // CORRECCIÓN: conservar id si se proporciona, si no generar uno
        if (!datosParaGuardar.id) {
            datosParaGuardar.id = Date.now() + Math.floor(Math.random() * 1000);
        }
        let finalizado = false;
        const request = store.add(datosParaGuardar);
        request.onsuccess = () => { /* se resuelve al completar la transacción */ };
        request.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(request.error);
        };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            resolve(request.result);
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error || new Error('Transacción abortada'));
        };
    });
};

// Nueva función auxiliar para guardar con número (solo usada tras el envío)
const guardarRegistroLocalConNumero = async (datos) => {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const datosParaGuardar = { ...datos };
        datosParaGuardar.timestamp = new Date().toISOString();
        // CORRECCIÓN: conservar id si se proporciona, si no generar uno
        if (!datosParaGuardar.id) {
            datosParaGuardar.id = Date.now() + Math.floor(Math.random() * 1000);
        }
        let finalizado = false;
        const request = store.add(datosParaGuardar);
        request.onsuccess = () => { /* se resuelve al completar la transacción */ };
        request.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(request.error);
        };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            resolve(request.result);
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error || new Error('Transacción abortada'));
        };
    });
};

// Guardar registro con estado (guardado, pendiente_confirmacion, enviado)
const guardarRegistroLocalConEstado = async (datos, estado = "guardado") => {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const datosParaGuardar = { ...datos, estado };
        datosParaGuardar.timestamp = new Date().toISOString();
        // CORRECCIÓN: conservar id si se proporciona, si no generar uno
        if (!datosParaGuardar.id) {
            datosParaGuardar.id = Date.now() + Math.floor(Math.random() * 1000);
        }
        let finalizado = false;
        const request = store.add(datosParaGuardar);
        request.onsuccess = () => { /* se resuelve al completar la transacción */ };
        request.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(request.error);
        };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            resolve(request.result);
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error || new Error('Transacción abortada'));
        };
    });
};

// Obtener todos los registros
const obtenerRegistros = async () => {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        let finalizado = false;
        let resultado;
        let errorSolicitud = null;
        request.onsuccess = () => { resultado = request.result; };
        request.onerror = () => { errorSolicitud = request.error; };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            if (errorSolicitud) { reject(errorSolicitud); return; }
            resolve(resultado);
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(errorSolicitud || transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(errorSolicitud || transaction.error || new Error('Transacción abortada'));
        };
    });
};

// Buscar registro por envio_id
const buscarRegistroPorEnvioId = async (envioId) => {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('envio_id');
        const request = index.get(envioId);
        let finalizado = false;
        let resultado;
        let errorSolicitud = null;
        request.onsuccess = () => { resultado = request.result; };
        request.onerror = () => { errorSolicitud = request.error; };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            if (errorSolicitud) { reject(errorSolicitud); return; }
            resolve(resultado);
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(errorSolicitud || transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(errorSolicitud || transaction.error || new Error('Transacción abortada'));
        };
    });
};

// Actualiza el estado de un registro local revalidando DENTRO de la transacción
// la identidad, el envio_id (si se indica) y el estado actual. Nunca degrada un
// registro ya marcado como 'enviado' a 'guardado' o 'pendiente_confirmacion'.
const cambiarEstadoRegistroCondicional = async (id, estado, envioIdEsperado = null, numerosAsignados = null) => {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        let finalizado = false;
        let rechazo = null;
        const request = store.get(id);
        request.onsuccess = () => {
            try {
                const registro = request.result;
                if (!registro) {
                    rechazo = new Error('REGISTRO_NO_EXISTE');
                    return;
                }
                if (envioIdEsperado && registro.envio_id !== envioIdEsperado) {
                    rechazo = new Error('ENVIO_ID_CAMBIADO');
                    return;
                }
                const decisionEstado = resolverEstadoRegistroLocal(registro.estado, estado);
                if (!decisionEstado.ok) {
                    rechazo = new Error(decisionEstado.motivo);
                    return;
                }
                registro.estado = decisionEstado.estado;
                if (numerosAsignados) {
                    registro.numerosAsignados = numerosAsignados;
                }
                registro.timestamp = new Date().toISOString();
                store.put(registro);
            } catch (errSync) {
                rechazo = errSync;
            }
        };
        request.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(request.error);
        };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            if (rechazo) { reject(rechazo); return; }
            resolve();
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error || new Error('Transacción abortada'));
        };
    });
};

// Actualizar estado de un registro. Se conserva por compatibilidad, pero
// delega en la versión condicional: ya no puede degradar un 'enviado'.
const actualizarEstadoRegistro = async (id, estado, numerosAsignados = null) => {
    return cambiarEstadoRegistroCondicional(id, estado, null, numerosAsignados);
};

// Actualizar datos de un registro EXISTENTE conservando su id local (reenvíos sin duplicar)
// Espera a que la transacción termine (oncomplete) antes de resolver
const actualizarDatosRegistro = async (id, datos) => {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        let finalizado = false;
        const request = store.get(id);
        request.onsuccess = () => {
            try {
                const existente = request.result || { id };
                const putRequest = store.put({ ...existente, ...datos, id, timestamp: new Date().toISOString() });
                putRequest.onerror = () => {
                    if (finalizado) return;
                    finalizado = true;
                    reject(putRequest.error);
                };
            } catch (errSync) {
                if (finalizado) return;
                finalizado = true;
                reject(errSync);
            }
        };
        request.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(request.error);
        };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            resolve(id);
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error || new Error('Transacción abortada'));
        };
    });
};

// Lectura de un registro local por su id. Se usa antes de reenviar un
// registro cargado y antes de decidir cómo proteger su borrado.
async function obtenerRegistroLocalPorId(id) {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);
        let finalizado = false;
        let resultado;
        let errorSolicitud = null;
        request.onsuccess = () => { resultado = request.result; };
        request.onerror = () => { errorSolicitud = request.error; };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            if (errorSolicitud) { reject(errorSolicitud); return; }
            resolve(resultado === undefined ? null : resultado);
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(errorSolicitud || transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(errorSolicitud || transaction.error || new Error('Transacción abortada'));
        };
    });
}

// Actualización condicional para reenvíos. Vuelve a comprobar el estado y el
// envio_id dentro de la misma transacción de escritura: si otra operación ha
// marcado el registro como enviado, lo ha borrado o ha cambiado su
// identificador, no se sobrescribe nada.
const actualizarDatosRegistroParaEnvio = async (id, datos, envioIdEsperado) => {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        let finalizado = false;
        let rechazo = null;
        const request = store.get(id);
        request.onsuccess = () => {
            try {
                const existente = request.result;
                if (!existente) {
                    rechazo = new Error('REGISTRO_NO_EXISTE');
                    return;
                }
                if (existente.estado === 'enviado') {
                    rechazo = new Error('REGISTRO_ENVIADO');
                    return;
                }
                if (!existente.envio_id) {
                    rechazo = new Error('ENVIO_ID_AUSENTE');
                    return;
                }
                if (existente.envio_id !== envioIdEsperado) {
                    rechazo = new Error('ENVIO_ID_CAMBIADO');
                    return;
                }
                store.put({ ...existente, ...datos, id, envio_id: envioIdEsperado, timestamp: new Date().toISOString() });
            } catch (errSync) {
                rechazo = errSync;
            }
        };
        request.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(request.error);
        };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            if (rechazo) { reject(rechazo); return; }
            resolve(id);
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error || new Error('Transacción abortada'));
        };
    });
};

function esCambioRegistroLocalParaEnvio(err) {
    return !!(err && (
        err.message === 'REGISTRO_NO_EXISTE' ||
        err.message === 'REGISTRO_ENVIADO' ||
        err.message === 'ENVIO_ID_AUSENTE' ||
        err.message === 'ENVIO_ID_CAMBIADO'
    ));
}

// Eliminar registro
const eliminarRegistro = async (id) => {
    const database = await obtenerDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        let finalizado = false;
        request.onsuccess = () => { /* se resuelve al completar la transacción */ };
        request.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(request.error);
        };
        transaction.oncomplete = () => {
            if (finalizado) return;
            finalizado = true;
            resolve();
        };
        transaction.onerror = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error);
        };
        transaction.onabort = () => {
            if (finalizado) return;
            finalizado = true;
            reject(transaction.error || new Error('Transacción abortada'));
        };
    });
};

// Exportar registros a JSON
const exportarRegistrosJSON = async () => {
    try {
        const registros = await obtenerRegistros();
        const dataStr = JSON.stringify(registros, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `registros_recogidas_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Error al exportar los registros:', err);
        alert('❌ No se pudieron exportar los registros locales.');
    }
};

// Importar registros desde JSON (conserva envio_id si existe)
const importarRegistrosJSON = (archivo) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const registros = JSON.parse(e.target.result);
                if (!Array.isArray(registros)) throw new Error('El archivo no contiene un array válido');
                for (const registro of registros) {
                    if (registro.fecha && registro.especie_comun) {
                        // ✅ CONSERVAR envio_id si existe (no generar uno nuevo)
                        const registroParaGuardar = { ...registro };
                        if (!registroParaGuardar.envio_id) {
                            // Si no tiene envio_id, generar uno nuevo (registro histórico importado)
                            registroParaGuardar.envio_id = generarEnvioId();
                        }
                        // Asegurar que tenga estado válido
                        if (!registroParaGuardar.estado) {
                            registroParaGuardar.estado = 'guardado';
                        }
                        await guardarRegistroLocal(registroParaGuardar);
                    }
                }
                resolve();
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(archivo);
    });
};

// Formatear fecha/hora legible
const formatearFechaHora = (fechaISO) => {
    const fecha = new Date(fechaISO);
    const dia = fecha.getDate().toString().padStart(2, '0');
    const mes = (fecha.getMonth() + 1).toString().padStart(2, '0');
    const año = fecha.getFullYear();
    const horas = fecha.getHours().toString().padStart(2, '0');
    const minutos = fecha.getMinutes().toString().padStart(2, '0');
    const segundos = fecha.getSeconds().toString().padStart(2, '0');
    return `${dia}/${mes}/${año} ${horas}:${minutos}:${segundos}`;
};

// Mostrar registros en el modal (con botón CARGAR y diferenciación de estados)
const mostrarRegistros = async () => {
    let registros;
    try {
        registros = await obtenerRegistros();
    } catch (err) {
        console.error('Error al leer los registros locales:', err);
        const contenedorError = document.getElementById('contenidoRegistros');
        if (contenedorError) {
            contenedorError.innerHTML = '<p style="color:#c0392b;">⚠️ No se pudieron leer los registros guardados en este dispositivo. Vuelve a intentarlo.</p>';
        }
        return;
    }
    const contenedor = document.getElementById('contenidoRegistros');
    const importarEnModal = document.getElementById('importarEnModal');
    const btnExportar = document.getElementById('btnExportarRegistros');

    if (registros.length === 0) {
        contenedor.innerHTML = '<p style="color:#666;">No hay registros guardados localmente.</p>';
        if (btnExportar) btnExportar.style.display = 'none';
    } else {
        if (btnExportar) btnExportar.style.display = 'inline-block';
    }

    if (importarEnModal) importarEnModal.style.display = 'inline-block';
    registros.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const html = registros.map(reg => {
        // Determinar color y texto según estado
        let estadoColor = '#6c757d';
        let estadoTexto = 'Desconocido';
        let estadoIcono = '❓';

        if (reg.estado === 'guardado') {
            estadoColor = '#ffc107';
            estadoTexto = 'Guardado (no enviado)';
            estadoIcono = '💾';
        } else if (reg.estado === 'pendiente_confirmacion') {
            estadoColor = '#fd7e14';
            estadoTexto = 'Pendiente de confirmación';
            estadoIcono = '⏳';
        } else if (reg.estado === 'enviado') {
            estadoColor = '#28a745';
            estadoTexto = 'Enviado ✓';
            estadoIcono = '✅';
        }

        // Botones según estado
        let botones = '';
        if (reg.estado === 'guardado') {
            botones = `
                <button onclick="comprobarSiFueRegistradaPorId(${reg.id})" 
                        style="background:#17a2b8; color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:13px; flex-shrink:0;" 
                        title="Comprobar si ya fue registrada (sin reenviar)">🔍 Comprobar</button>
                <button onclick="cargarRegistroEnFormulario(${reg.id})" 
                        style="background:#28a745; color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:13px; flex-shrink:0;" 
                        title="Cargar y editar registro">📋 Cargar</button>
            `;
        } else if (reg.estado === 'pendiente_confirmacion') {
            botones = `
                <button onclick="comprobarSiFueRegistradaPorId(${reg.id})" 
                        style="background:#17a2b8; color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:13px; flex-shrink:0;" 
                        title="Comprobar si ya fue registrada">🔍 Comprobar</button>
                <button onclick="cargarRegistroEnFormulario(${reg.id})" 
                        style="background:#6c757d; color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:13px; flex-shrink:0;" 
                        title="Cargar registro">📋 Cargar</button>
            `;
        } else if (reg.estado === 'enviado') {
            botones = `
                <button onclick="cargarRegistroEnFormulario(${reg.id})" 
                        style="background:#6c757d; color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:13px; flex-shrink:0;" 
                        title="Ver registro (solo lectura)">👁️ Ver</button>
            `;
        }

        // Mostrar número si está enviado
        let numeroHtml = '';
        if (reg.estado === 'enviado' && reg.numerosAsignados && reg.numerosAsignados.length > 0) {
            numeroHtml = `<div style="margin-top:8px; padding:8px; background:#d4edda; border-radius:4px; font-weight:bold; color:#155724;">
                📋 Número(s): ${reg.numerosAsignados.join(', ')}
            </div>`;
        }

        // Mostrar envio_id si existe
        let envioIdHtml = '';
        if (reg.envio_id) {
            envioIdHtml = `<small style="color:#999; font-size:0.8em;">envio_id: ${reg.envio_id.substring(0, 20)}...</small>`;
        }

        // El botón de borrado no se muestra en registros enviados. Se calcula
        // aparte para no anidar plantillas dentro de la plantilla principal.
        let botonEliminarHtml = '';
        if (reg.estado !== 'enviado') {
            botonEliminarHtml = `<button onclick="eliminarYActualizar(${reg.id})" 
                            style="background:#dc3545; color:white; border:none; padding:4px; border-radius:3px; cursor:pointer; font-size:14px; flex-shrink:0; width:30px; height:30px;" 
                            title="Eliminar registro">×</button>`;
        }

        return `
        <div style="border:1px solid #ddd; padding:12px; margin-bottom:12px; border-radius:6px; background:#f9f9f9; border-left: 4px solid ${estadoColor};">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <div style="flex:1;">
                  <strong style="color:#333; font-size:1.1em;">
${reg.especie_comun || 'Sin especie'}
</strong><br>
                    <small style="color:#666;">📅 ${formatearFechaHora(reg.timestamp)}</small><br>
                    <span style="display:inline-block; margin-top:4px; padding:2px 8px; border-radius:12px; font-size:0.85em; font-weight:bold; color:white; background:${estadoColor};">
                        ${estadoIcono} ${estadoTexto}
                    </span>
                    ${envioIdHtml}
                </div>
                <div style="display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px;">
                    ${botones}
                    ${botonEliminarHtml}
                </div>
            </div>
            ${numeroHtml}
            <details style="font-size:0.9em; color:#555; margin-top:8px;">
                <summary style="cursor:pointer; color:#17a2b8;">Ver detalles completos</summary>
                <pre style="margin:8px 0 0 0; padding:10px; background:#fff; border:1px solid #e0e0e0; border-radius:4px; white-space: pre-wrap; word-wrap: break-word; font-size:0.85em;">${JSON.stringify(reg, null, 2)}</pre>
            </details>
        </div>
        `;
    }).join('');
    contenedor.innerHTML = html;
};

// Función auxiliar para comprobar por ID (usada en mostrarRegistros)
window.comprobarSiFueRegistradaPorId = async function(id) {
    try {
        const database = await obtenerDB();
        const registro = await new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);
            let finalizado = false;
            let resultado;
            let errorSolicitud = null;
            request.onsuccess = () => { resultado = request.result; };
            request.onerror = () => { errorSolicitud = request.error; };
            transaction.oncomplete = () => {
                if (finalizado) return;
                finalizado = true;
                if (errorSolicitud) { reject(errorSolicitud); return; }
                resolve(resultado);
            };
            transaction.onerror = () => {
                if (finalizado) return;
                finalizado = true;
                reject(errorSolicitud || transaction.error);
            };
            transaction.onabort = () => {
                if (finalizado) return;
                finalizado = true;
                reject(errorSolicitud || transaction.error || new Error('Transacción abortada'));
            };
        });
        if (registro) {
            await comprobarSiFueRegistrada(registro);
            await mostrarRegistros(); // Actualizar vista
        }
    } catch (err) {
        console.error('Error al comprobar el registro por id:', err);
        alert('❌ No se pudo comprobar el registro local.');
    }
};
// Función para eliminar un registro y actualizar la vista
window.eliminarYActualizar = async function(id) {
  try {
    const registro = await obtenerRegistroLocalPorId(id);
    if (!registro) {
      alert('❌ No se encontró el registro que se quería eliminar.');
      await mostrarRegistros();
      return;
    }

    // Defensa adicional: el botón no se muestra para enviados, pero tampoco
    // se permite borrar uno si la acción se invoca desde la consola.
    if (!puedeEliminarRegistroLocal(registro)) {
      if (registro.estado === 'enviado') {
        alert('❌ Este registro ya fue enviado y no se puede eliminar desde aquí.');
      } else {
        alert('❌ Este registro tiene un estado no reconocido y no se puede eliminar desde aquí. Consúltalo con «Ver registros guardados».');
      }
      return;
    }

    if (registro.estado === 'pendiente_confirmacion') {
      const resultado = await Swal.fire({
        icon: 'warning',
        title: 'Eliminar registro pendiente',
        html:
          'El servidor podría haber guardado ya este envío, aunque la confirmación no llegara.<br><br>' +
          'El borrado es <strong>solo local</strong> y se perderá la clave de idempotencia ' +
          '(<code>envio_id</code>). No se borrará nada en el servidor.<br><br>' +
          'Si quieres eliminar el registro local, escribe exactamente <strong>ELIMINAR</strong>.',
        input: 'text',
        inputPlaceholder: 'Escribe ELIMINAR',
        showCancelButton: true,
        confirmButtonText: 'Eliminar solo en local',
        confirmButtonColor: '#dc3545',
        cancelButtonText: 'Cancelar',
        preConfirm: (valor) => {
          if (!esConfirmacionEliminarPendienteValida(valor)) {
            Swal.showValidationMessage('Debes escribir exactamente ELIMINAR. No se ha borrado nada.');
            return false;
          }
          return true;
        }
      });
      if (!debeEliminarRegistroPendiente(resultado)) return;
    } else if (!confirm('¿Seguro que quieres eliminar este registro?')) {
      return;
    }

    await eliminarRegistro(id);
    // El envío en curso (si lo era) ya no existe: se retira su puntero para no
    // bloquear futuros envíos con una referencia muerta.
    limpiarPunteroEnvioEnCurso(id);
    await mostrarRegistros(); // Actualiza la lista tras eliminar
  } catch (err) {
    console.error("Error al eliminar:", err);
    alert("❌ Error al eliminar el registro.");
  }
};

// Función para cargar un registro guardado en el formulario
window.cargarRegistroEnFormulario = async function(id) {
    try {
        // Obtener registro de IndexedDB (esperando a que la base esté disponible)
        const database = await obtenerDB();
        const registro = await new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);
            let finalizado = false;
            let resultado;
            let errorSolicitud = null;
            request.onsuccess = () => { resultado = request.result; };
            request.onerror = () => { errorSolicitud = request.error; };
            transaction.oncomplete = () => {
                if (finalizado) return;
                finalizado = true;
                if (errorSolicitud) { reject(errorSolicitud); return; }
                resolve(resultado);
            };
            transaction.onerror = () => {
                if (finalizado) return;
                finalizado = true;
                reject(errorSolicitud || transaction.error);
            };
            transaction.onabort = () => {
                if (finalizado) return;
                finalizado = true;
                reject(errorSolicitud || transaction.error || new Error('Transacción abortada'));
            };
        });

        if (!registro) {
            alert('❌ No se encontró el registro');
            return;
        }

            // Cerrar modal
            document.getElementById('modalRegistros').style.display = 'none';

            // Al cargar otro registro, restaurar primero los controles normales.
            aplicarModoSoloLectura(false);

            // Limpiar formulario
            document.getElementById('formulario').reset();

            // Rellenar campos simples
            document.getElementById('especie_comun').value = registro.especie_comun || '';
            document.getElementById('especie_cientifico').value = registro.especie_cientifico || '';
            document.getElementById('cantidad_animales').value = registro.cantidad_animales || '';
            document.getElementById('fecha').value = registro.fecha || '';
            document.getElementById('municipio').value = registro.municipio || '';
            document.getElementById('coordenadas').value = registro.coordenadas || '';
            document.getElementById('coordenadas_mapa').value = registro.coordenadas_mapa || '';
            document.getElementById('apoyo').value = registro.apoyo || '';
            document.getElementById('cra_km').value = registro.cra_km || '';
            document.getElementById('observaciones').value = registro.observaciones || '';
            document.getElementById('cumplimentado_por').value = registro.cumplimentado_por || '';
            document.getElementById('telefono_remitente').value = registro.telefono_remitente || '';

            // Activar autocompletado. Se suprime temporalmente el autoguardado
            // del borrador para no sobrescribir el de otra operación pendiente.
            suprimirAutoGuardadoBorrador = true;
            try {
                document.getElementById('especie_comun').dispatchEvent(new Event('input'));
            } finally {
                suprimirAutoGuardadoBorrador = false;
            }

                                  // ✅ CORRECCIÓN POSIBLE CAUSA (búsqueda case-insensitive)
            document.querySelectorAll('input[name="posible_causa"]').forEach(rb => rb.checked = false);
            const otrasCausaSelect = document.getElementById('otrasCausaSelect');
            const chkOtrasCausa = document.getElementById('otras');
            const wrapperOtrasCausa = document.getElementById('otrasCausaWrapper');
            
            if (registro.posible_causa) {
                const valorCausa = registro.posible_causa.trim();
                const valorCausaUpper = valorCausa.toUpperCase();
                
                // Buscar el radio button comparando en MAYÚSCULAS (case-insensitive)
                let rbEncontrado = null;
                document.querySelectorAll('input[name="posible_causa"]').forEach(rb => {
                    if (rb.value.toUpperCase() === valorCausaUpper) {
                        rbEncontrado = rb;
                    }
                });
                
                if (rbEncontrado) {
                    // ✅ Encontró el radio button correcto (ej. "Cría")
                    rbEncontrado.checked = true;
                    
                    // Si es el radio "Otras", mostrar el wrapper
                    if (rbEncontrado.value === 'Otras' || rbEncontrado.id === 'otras') {
                        if (chkOtrasCausa) chkOtrasCausa.checked = true;
                        if (wrapperOtrasCausa) wrapperOtrasCausa.style.display = 'block';
                    }
                } else if (otrasCausaSelect) {
                    // Solo llega aquí si NO hay ningún radio button que coincida
                    // (es decir, realmente era una opción del desplegable "Otras")
                    otrasCausaSelect.value = valorCausa;
                    if (chkOtrasCausa) {
                        chkOtrasCausa.checked = true;
                        chkOtrasCausa.dispatchEvent(new Event('change'));
                    }
                }
            } else {
                if (wrapperOtrasCausa) wrapperOtrasCausa.style.display = 'none';
                if (chkOtrasCausa) chkOtrasCausa.checked = false;
            }

            // ✅ CORRECCIÓN REMITENTE (Se guarda como String, no como Array)
            document.querySelectorAll('input[name="remitente"]').forEach(rb => rb.checked = false);
            const remitenteSelect = document.querySelector('select[name="remitente"]');
            
            if (registro.remitente) {
                if (remitenteSelect) {
                    // Si en tu HTML remitente es un desplegable <select>
                    remitenteSelect.value = registro.remitente;
                } else {
                    // Si son radio buttons o un input de texto
                    const rbRemitente = document.querySelector(`input[name="remitente"][value="${registro.remitente}"]`);
                    if (rbRemitente && rbRemitente.type === 'radio') {
                        rbRemitente.checked = true;
                    } else {
                        // Fallback para input de texto
                        const inputRemitente = document.querySelector('input[name="remitente"]');
                        if (inputRemitente && inputRemitente.type !== 'radio') {
                            inputRemitente.value = registro.remitente;
                        }
                    }
                }
            }

            // Rellenar estado_animal
            document.querySelectorAll('input[name="estado_animal"]').forEach(cb => cb.checked = false);
            if (Array.isArray(registro.estado_animal)) {
                registro.estado_animal.forEach(valor => {
                    // Para checkbox "Recoge Centro"
                    if (valor === 'Recoge Centro') {
                        const cb = document.querySelector('input[type="checkbox"][name="estado_animal"][value="Recoge Centro"]');
                        if (cb) cb.checked = true;
                    }
                    // Para radio "Animal Vivo" o "Cadáver"
                    if (valor === 'Animal Vivo' || valor === 'Cadáver') {
                        const radio = document.querySelector(`input[type="radio"][name="estado_animal"][value="${valor}"]`);
                        if (radio) radio.checked = true;
                    }
                    // Para checkbox "Recuperación"
                    if (valor === 'Recuperación') {
                        const cb = document.getElementById('recuperacion');
                        if (cb) cb.checked = true;
                        document.getElementById('anillaWrapper').style.display = 'inline-block';
                        
                        // Extraer anilla de observaciones si existe
                        const match = (registro.observaciones || '').match(/Anilla: (\w+)/);
                        if (match) {
                            document.getElementById('anilla').value = match[1];
                        }
                    }
                });
            }

            // Limpiar foto (no se puede pre-rellenar)
            document.getElementById('foto').value = '';

            // ✅ CONSERVAR envio_id: se guarda en variable global para reutilizarlo al reenviar
            window.envioIdCargado = registro.envio_id || null;
            // ✅ CONSERVAR id local: al reenviar se actualizará ESTE registro (sin crear duplicado)
            window.registroIdCargado = registro.id || null;

            // Si está enviado, aplicar solo lectura real antes de avisar.
            if (registro.estado === 'enviado') {
                aplicarModoSoloLectura(true);
                const ver = confirm('⚠️ Este registro ya fue enviado y tiene número asignado.\n\nLos registros enviados son de SOLO LECTURA: no se pueden modificar ni reenviar.\n\n¿Quieres verlo?');
                if (!ver) return;
            }

            // Si está pendiente_confirmacion, avisar
            if (registro.estado === 'pendiente_confirmacion') {
                alert(`⚠️ Registro cargado (pendiente de confirmación).\n\nSi lo vuelves a enviar, se usará el mismo envio_id: ${registro.envio_id || 'N/A'}\n\nPrimero comprueba si ya fue registrada con el botón "Comprobar".`);
            } else if (registro.estado === 'guardado') {
                alert(`✅ Registro cargado (guardado).\nSe reenviará con el mismo envio_id: ${registro.envio_id || 'N/A'}`);
            } else {
                alert(`✅ Registro cargado:\n${registro.especie_comun || 'Sin especie'}`);
            }
    } catch (error) {
        console.error('Error al cargar registro:', error);
        alert('❌ Error al cargar el registro');
    }
};

// Inicializar DB al cargar (una única apertura compartida para toda la aplicación)
dbLista = initDB();
dbLista.then(() => {
    console.log('IndexedDB inicializada correctamente');
}).catch(err => {
    console.error('Error inicializando IndexedDB:', err);
    alert('Error al inicializar base de datos local. Los registros no se guardarán.');
});
/* ============================================ */

document.addEventListener("DOMContentLoaded", function () {
    /* ---------- CONFIRMACIÓN DE CANTIDAD DE EJEMPLARES ---------- */
    const cantidadInput = document.getElementById('cantidad_animales');
    if (cantidadInput) {
        cantidadInput.addEventListener('change', function () {
            const cant = parseInt(this.value, 10);
            if (isNaN(cant) || cant <= 0) return;
            const mensaje = `¿Seguro que son ${cant} animales?`;
            const ok = confirm(mensaje);
            if (!ok) {
                this.value = "";
                this.focus();
            }
        });
    }
  /* ---------- AVISO PARA MURCIÉLAGOS ---------- */
const especieComunInput = document.getElementById('especie_comun');
if (especieComunInput) {
    especieComunInput.addEventListener('change', function () {
        const especie = this.value.toLowerCase();
        // Verificar si es un murciélago (pero no "murciélago no identificado")
        if (especie.includes('murci') && 
            !especie.includes('no identificado') && 
            !especie.includes('indet')) {
            
            const mensaje = "Si no estás seguro de la especie de murciélago, selecciona 'Murciélago no identificado'. ¿Estás completamente seguro de la identificación?";
            
            if (!confirm(mensaje)) {
                // Usuario ha pulsado "Cancelar" → interpretamos como "No estoy seguro"
                this.value = "Murciélago no identificado";
                this.dispatchEvent(new Event('input')); // Disparar autocompletado del campo científico
            }
            // Si pulsa "Aceptar", se mantiene la especie original
        }
    });
}

    // FASE 5.7: aislar Leaflet para que un fallo del mapa no aborte el formulario.
    var map = null;
    let mapaDisponible = false;
    try {
    map = L.map("map").setView([39.4699, -0.3763], 10);
        // Capa OpenStreetMap (estándar)
    const osmMap = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors"
    });
    
    // ORTOFOTO OFICIAL IGN ESPAÑA (PNOA) + TOPÓNIMOS
    const pnoaBase = L.tileLayer(
        'https://www.ign.es/wmts/pnoa-ma?layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}', 
        {
            attribution: 'Ortofoto © <a href="https://www.ign.es">IGN</a> (PNOA)',
            maxZoom: 20,
            maxNativeZoom: 19
        }
    );

    // Topónimos y límites administrativos oficiales (transparente)
    const toponimosIGN = L.tileLayer(
        'https://www.ign.es/wmts/ign-base?layer=IGNBaseOrto&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}', 
        {
            attribution: 'Topónimos © IGN',
            maxZoom: 20,
            transparent: true
        }
    );

    // Grupo combinado: ortofoto + topónimos siempre van juntos
    const ortofotoOficial = L.layerGroup([pnoaBase, toponimosIGN]);

    // Control de capas actualizado
    L.control.layers({ 
        "Mapa estándar": osmMap, 
        "Ortofoto España + nombres": ortofotoOficial 
    }).addTo(map);
    
    // Capa por defecto al cargar
    osmMap.addTo(map);
    mapaDisponible = true;
    } catch (errMapa) {
        console.error('No se pudo inicializar el mapa Leaflet:', errMapa);
        map = null;
        mapaDisponible = false;
        const contenedorMapa = document.getElementById('map');
        if (contenedorMapa) contenedorMapa.innerHTML = '';
        mostrarEstadoGPS('Mapa no disponible. El formulario sigue funcionando; puedes escribir las coordenadas manualmente.', 'error');
    }

    let marker, watchId = null, seguimientoActivo = true, forzarZoomInicial = false, ultimaPosicion = null;

    /* Botón Borrar Coordenadas del Mapa */
    const btnBorrar = document.getElementById("btnBorrarCoords");
    if (btnBorrar) {
        btnBorrar.addEventListener("click", () => {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
                seguimientoActivo = false;
            }
            document.getElementById("coordenadas_mapa").value = "";
            document.getElementById("coordenadas").value = "";
            if (marker) {
                map.removeLayer(marker);
                marker = null;
            }
        });
    }
// ✅ NUEVA FUNCIÓN: Obtener posición rápida con fallback
function obtenerPosicionRapida() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocalización no soportada'));
            return;
        }
        // Intento 1: Posición rápida (WiFi/IP)
        navigator.geolocation.getCurrentPosition(
            pos => resolve(pos),
            err => {
                // Si falla, intentar con alta precisión
                navigator.geolocation.getCurrentPosition(
                    pos => resolve(pos),
                    err2 => reject(err2),
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
                );
            },
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
        );
    });
}

// ✅ NUEVA FUNCIÓN: Mostrar mensaje de estado (toast)
function mostrarEstadoGPS(mensaje, tipo = 'info') {
    const existente = document.getElementById('gpsStatus');
    if (existente) existente.remove();

    const div = document.createElement('div');
    div.id = 'gpsStatus';
    div.textContent = mensaje;
    Object.assign(div.style, {
        position: 'fixed',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 20px',
        borderRadius: '6px',
        zIndex: '10000',
        fontWeight: 'bold',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        backgroundColor: tipo === 'error' ? '#dc3545' : tipo === 'success' ? '#28a745' : '#17a2b8',
        color: 'white',
        fontSize: '14px'
    });
    document.body.appendChild(div);

    setTimeout(() => {
        if (div.parentNode) div.remove();
    }, 4000);
}
    /* Mostrar/ocultar campo "Código anilla" */
    const chkRec = document.getElementById('recuperacion');
    const wrap   = document.getElementById('anillaWrapper');
    const inpAni = document.getElementById('anilla');
    if (chkRec && wrap && inpAni) {
        function toggleAnillaField() {
            wrap.style.display = chkRec.checked ? 'inline-block' : 'none';
            if (!chkRec.checked) inpAni.value = '';
        }
        chkRec.addEventListener('change', toggleAnillaField);
        toggleAnillaField();
    }
// Mostrar/ocultar desplegable de "Otras" en Posible causa
const chkOtrasCausa = document.getElementById('otras');
const wrapperOtrasCausa = document.getElementById('otrasCausaWrapper');

if (chkOtrasCausa && wrapperOtrasCausa) {
    // Función para ocultar el desplegable y limpiar selección
    function ocultarDesplegableOtras() {
        wrapperOtrasCausa.style.display = 'none';
        const select = document.getElementById('otrasCausaSelect');
        if (select) select.value = '';
    }

    // Evento para mostrar/ocultar cuando cambia CUALQUIER radio de posible_causa
    const todasCausasRadios = document.querySelectorAll('input[name="posible_causa"]');
    todasCausasRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.id === 'otras' && this.checked) {
                wrapperOtrasCausa.style.display = 'block';
            } else {
                ocultarDesplegableOtras();
            }
        });
    });
}
        function iniciarSeguimiento() {
        if (!navigator.geolocation) return;
        if (!mapaDisponible) return;
        
        // Detener seguimiento anterior si existe
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
        }
        
        watchId = navigator.geolocation.watchPosition(
            pos => {
                if (!seguimientoActivo) return;
                const lat = pos.coords.latitude, lng = pos.coords.longitude;
                ultimaPosicion = [lat, lng];
                map.setView([lat, lng], forzarZoomInicial ? 13 : map.getZoom());
                forzarZoomInicial = false;
                marker ? marker.setLatLng([lat, lng])
                       : marker = L.marker([lat, lng]).addTo(map).bindPopup("Estás aquí").openPopup();
            },
            err => {
                console.error("Error GPS:", err);
            },
            { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 }
        );
    }

    function detenerSeguimiento() {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = null; seguimientoActivo = false;
    }
// ✅ NUEVA FUNCIÓN: Convertir municipio a valenciano de forma robusta
function convertirAVaenciano(municipioNominatim) {
    if (!municipioNominatim || municipioNominatim === "Desconocido" || municipioNominatim === "No encontrado") {
        return municipioNominatim;
    }

    // Función para normalizar (quitar acentos y pasar a minúsculas)
    const normalizar = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    const municipioNorm = normalizar(municipioNominatim);

    // 1. Buscar en las CLAVES del mapeo (normalizadas)
    if (window.mapeoMunicipios) {
        for (const clave in window.mapeoMunicipios) {
            if (normalizar(clave) === municipioNorm) {
                return window.mapeoMunicipios[clave]; // Devuelve el valor en valenciano
            }
        }
    }

    // 2. Buscar en los VALORES del mapeo (por si Nominatim devuelve algo que ya está en valenciano)
    if (window.mapeoMunicipios) {
        for (const clave in window.mapeoMunicipios) {
            const valor = window.mapeoMunicipios[clave];
            if (normalizar(valor) === municipioNorm) {
                return valor; // Ya está en valenciano
            }
        }
    }

    // 3. Buscar directamente en municipiosData (normalizado)
    if (window.municipiosData) {
        const encontrado = window.municipiosData.find(m => normalizar(m) === municipioNorm);
        if (encontrado) {
            return encontrado; // Devuelve la versión con acentos correctos
        }
    }

    // 4. Si no se encuentra, devolver el original (con warning en consola)
    console.warn(`⚠️ No se pudo convertir "${municipioNominatim}" a valenciano`);
    return municipioNominatim;
}
// Contador para descartar respuestas de geolocalización inversa obsoletas:
// si se selecciona otro punto antes de que llegue la respuesta, la antigua
// no sobrescribe ni el popup ni los campos.
// Función reutilizable para mostrar popup y actualizar municipio
let seqPeticionMunicipio = 0;
function mostrarPopupYActualizarMunicipio(lat, lng, nombreForzado = null, rellenarDireccion = false) {
    if (!mapaDisponible) return;
    const miPeticion = ++seqPeticionMunicipio;
    obtenerMunicipio(lat, lng).then(({ municipio, provincia }) => {
        // Respuesta antigua: ignorar por completo (no tocar popup ni campos)
        if (miPeticion !== seqPeticionMunicipio) return;
        const popupContent = `
            <div style="font-family:sans-serif; font-size:14px;">
                <strong>📍 Coordenadas:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>
                <strong>🏙️ Municipio:</strong> ${municipio}<br>
                ${provincia ? `<strong>🗺️ Provincia:</strong> ${provincia}<br>` : ''}
                <small style="color:#666;">Datos de OpenStreetMap</small>
            </div>
        `;
        
        // Actualizar/crear popup
        if (marker.getPopup()) {
            marker.setPopupContent(popupContent);
        } else {
            marker.bindPopup(popupContent);
        }
        marker.openPopup();
        
        const municipioInput = document.getElementById('municipio');
        if (municipioInput && municipio !== "Desconocido" && municipio !== "No encontrado") {
            // ✅ Si hay nombre forzado, usarlo; si no, convertir desde Nominatim
            const nombreFinal = nombreForzado || convertirAVaenciano(municipio);
            municipioInput.value = nombreFinal;
            municipioInput.dispatchEvent(new Event('input'));
            // Solo al pulsar el mapa: reflejar el municipio identificado también
            // en "Coordenadas dadas o Dirección". No es un campo de solo lectura
            // y la entrada manual se conserva intacta en el resto de flujos.
            if (rellenarDireccion) {
                const campoDireccion = document.getElementById('coordenadas');
                if (campoDireccion) campoDireccion.value = nombreFinal;
            }
        }
    });
}

// onMapClick corregido
function onMapClick(e) {
    if (!mapaDisponible) return;
    detenerSeguimiento();
    const latlng = e.latlng;
    
    // Actualizar campo de coordenadas
    document.getElementById("coordenadas_mapa").value = latlng.lat.toFixed(5) + ", " + latlng.lng.toFixed(5);
    
    // Mostrar/actualizar marcador
    if (marker) {
        marker.setLatLng(latlng);
    } else {
        marker = L.marker(latlng).addTo(map);
    }
    
    // Llamar a la función reutilizable (rellena también Dirección con el municipio)
    mostrarPopupYActualizarMunicipio(latlng.lat, latlng.lng, null, true);
}
if (mapaDisponible && map) map.on("click", onMapClick);
  /* ---------- BUSCAR COORDENADAS O DIRECCIÓN ---------- */
function buscarOCoordenadas(raw) {
    raw = raw.trim();
    if (!raw) return;
    if (!mapaDisponible) {
        mostrarEstadoGPS('Mapa no disponible. El formulario sigue funcionando; puedes escribir las coordenadas manualmente.', 'error');
        return;
    }

    // 1. Intentar UTM primero
    const utm = parseUTM(raw);
    if (utm) {
        try {
            const { lat, lon } = utmToLatLon(utm.easting, utm.northing, utm.zoneNumber, utm.northern);
            detenerSeguimiento();
            if (marker) marker.setLatLng([lat, lon]);
            else marker = L.marker([lat, lon]).addTo(map);
            map.setView([lat, lon], 13);
            document.getElementById("coordenadas_mapa").value = lat.toFixed(5) + ", " + lon.toFixed(5);
            
            mostrarPopupYActualizarMunicipio(lat, lon);
            return;
        } catch (err) {
            console.error("Error convirtiendo UTM:", err);
        }
    }

    // 2. Intentar coordenadas decimales (lat, lng)
    const partes = raw.includes(",") ? raw.split(",").map(n => n.trim()) : raw.split(" ").map(n => n.trim());
    if (partes.length === 2 && !isNaN(parseFloat(partes[0])) && !isNaN(parseFloat(partes[1]))) {
        const lat = parseFloat(partes[0]);
        const lng = parseFloat(partes[1]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            detenerSeguimiento();
            if (marker) marker.setLatLng([lat, lng]);
            else marker = L.marker([lat, lng]).addTo(map);
            map.setView([lat, lng], 13);
            document.getElementById("coordenadas_mapa").value = lat.toFixed(5) + ", " + lng.toFixed(5);
            
            mostrarPopupYActualizarMunicipio(lat, lng);
            return;
        }
    }

    // 3. ✅ BÚSQUEDA POR DIRECCIÓN CON PRIORIDADES GEOGRÁFICAS
    buscarDireccionConPrioridad(raw);
}

// ✅ FUNCIÓN MEJORADA: Con detección parcial de municipios y selección múltiple
async function buscarDireccionConPrioridad(query) {
    if (!mapaDisponible) return;
    const queryEncoded = encodeURIComponent(query);
    
    // Normalizar query (sin acentos, minúsculas)
    const queryNormalizado = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    
    // ✅ 1. BUSCAR MUNICIPIO (exacto o parcial)
    const resultadoMunicipio = await buscarMunicipio(query, queryNormalizado);
    
if (resultadoMunicipio) {
    // Si encontramos municipio, buscarlo en Nominatim
    console.log(`🏙️ Municipio seleccionado: "${resultadoMunicipio}"`);
    const urlMunicipio = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ES&accept-language=ca&q=${encodeURIComponent(resultadoMunicipio)}, Comunitat Valenciana`;
    
    try {
        const response = await fetch(urlMunicipio);
        const data = await response.json();
        
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            
            detenerSeguimiento();
            if (marker) marker.setLatLng([lat, lng]);
            else marker = L.marker([lat, lng]).addTo(map);
            map.setView([lat, lng], 14);
            
            // ✅ Mostrar popup manualmente con el nombre correcto
            const popupContent = `
                <div style="font-family:sans-serif; font-size:14px;">
                    <strong>📍 Coordenadas:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>
                    <strong>🏙️ Municipio:</strong> ${resultadoMunicipio}<br>
                    <small style="color:#666;">Datos de OpenStreetMap</small>
                </div>
            `;
            
            if (marker.getPopup()) {
                marker.setPopupContent(popupContent);
            } else {
                marker.bindPopup(popupContent);
            }
            marker.openPopup();
            
            // ✅ Establecer el nombre correcto directamente en el campo
            const municipioInput = document.getElementById('municipio');
            if (municipioInput) {
                municipioInput.value = resultadoMunicipio;
                municipioInput.dispatchEvent(new Event('input'));
            }
            
            document.getElementById("coordenadas").value = lat.toFixed(5) + ", " + lng.toFixed(5);
            document.getElementById("coordenadas_mapa").value = lat.toFixed(5) + ", " + lng.toFixed(5);
            
            return;
        }
    } catch (err) {
        console.warn(`Error buscando municipio ${resultadoMunicipio}:`, err);
    }
}
    
    // ✅ 2. Detectar si contiene palabra de vía
    const palabrasVia = [
        'calle', 'c/', 'cl/', 'carrer', 'av.', 'avda', 'avenida', 'avinguda',
        'plaza', 'plaça', 'placa', 'placeta', 'camino', 'cno', 'carretera', 'ctra',
        'paseo', 'pg', 'ronda', 'travesia', 'travessia', 'callejon', 'callejo',
        'alameda', 'bulevar', 'via', 'vía', 'rambla', 'glorieta', 'rotonda',
        'camí', 'cami', 'senda', 'vereda', 'autovia', 'autopista'
    ];
    
    const queryMinusculas = query.toLowerCase();
    const contieneVia = palabrasVia.some(palabra => queryMinusculas.includes(palabra));
    
    // Si NO contiene palabra de vía, búsqueda genérica
    if (!contieneVia) {
        console.log(`🔍 Búsqueda genérica: "${query}"`);
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ES&accept-language=ca&q=${queryEncoded}`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                
                detenerSeguimiento();
                if (marker) marker.setLatLng([lat, lng]);
                else marker = L.marker([lat, lng]).addTo(map);
                map.setView([lat, lng], 14);
                
                mostrarPopupYActualizarMunicipio(lat, lng);
                
                document.getElementById("coordenadas").value = lat.toFixed(5) + ", " + lng.toFixed(5);
                document.getElementById("coordenadas_mapa").value = lat.toFixed(5) + ", " + lng.toFixed(5);
                
                return;
            }
        } catch (err) {
            console.warn("Error en búsqueda genérica:", err);
        }
        
        alert("No se ha encontrado la dirección ni se reconocieron coordenadas válidas.");
        return;
    }
    
    // ✅ 3. Búsqueda de calles por prioridades
    console.log(`🛣️ Buscando calle con prioridades: "${query}"`);
    
    const BBOX_VALENCIA_CIUDAD = "-0.40,39.45,-0.35,39.48";
    const BBOX_PROVINCIA_VALENCIA = "-1.5,38.7,0.2,40.0";
    const BBOX_PROVINCIA_ALICANTE = "-1.0,37.8,0.2,38.9";
    const BBOX_PROVINCIA_CASTELLON = "-0.5,39.5,0.5,40.8";
    const BBOX_COMUNITAT_VALENCIANA = "-1.5,37.8,0.5,40.8";
    
    const intentos = [
        { nombre: "Valencia ciudad", url: `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ES&accept-language=ca&viewbox=${BBOX_VALENCIA_CIUDAD}&bounded=1&q=${queryEncoded}` },
        { nombre: "Provincia de Valencia", url: `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ES&accept-language=ca&viewbox=${BBOX_PROVINCIA_VALENCIA}&bounded=1&q=${queryEncoded}` },
        { nombre: "Provincia de Alicante", url: `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ES&accept-language=ca&viewbox=${BBOX_PROVINCIA_ALICANTE}&bounded=1&q=${queryEncoded}` },
        { nombre: "Provincia de Castellón", url: `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ES&accept-language=ca&viewbox=${BBOX_PROVINCIA_CASTELLON}&bounded=1&q=${queryEncoded}` },
        { nombre: "Comunitat Valenciana", url: `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ES&accept-language=ca&viewbox=${BBOX_COMUNITAT_VALENCIANA}&bounded=1&q=${queryEncoded}` },
        { nombre: "España", url: `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ES&accept-language=ca&q=${queryEncoded}` }
    ];
    
    for (const intento of intentos) {
        try {
            const response = await fetch(intento.url);
            const data = await response.json();
            
            if (data && data.length > 0) {
                console.log(`✅ Encontrado en: ${intento.nombre}`);
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                
                detenerSeguimiento();
                if (marker) marker.setLatLng([lat, lng]);
                else marker = L.marker([lat, lng]).addTo(map);
                map.setView([lat, lng], 16);
                
                mostrarPopupYActualizarMunicipio(lat, lng);
                
                document.getElementById("coordenadas").value = lat.toFixed(5) + ", " + lng.toFixed(5);
                document.getElementById("coordenadas_mapa").value = lat.toFixed(5) + ", " + lng.toFixed(5);
                
                return;
            }
        } catch (err) {
            console.warn(`Error en búsqueda ${intento.nombre}:`, err);
        }
    }
    
    alert("No se ha encontrado la dirección ni se reconocieron coordenadas válidas.");
}

// ✅ NUEVA FUNCIÓN: Buscar municipio (exacto o parcial) con selección si hay varios
async function buscarMunicipio(query, queryNormalizado) {
    let coincidencias = [];
    
    // 1. Búsqueda exacta en municipiosData
    if (window.municipiosData) {
        const exacto = window.municipiosData.find(m => {
            const mNorm = m.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
            return mNorm === queryNormalizado;
        });
        
        if (exacto) {
            return exacto; // Coincidencia exacta directa
        }
        
        // 2. Búsqueda parcial (empieza con)
        coincidencias = window.municipiosData.filter(m => {
            const mNorm = m.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
            return mNorm.startsWith(queryNormalizado);
        });
    }
    
    // 3. También buscar en las claves del mapeo (nombres en castellano)
    if (window.mapeoMunicipios) {
        for (const clave in window.mapeoMunicipios) {
            const claveNorm = clave.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
            
            // Coincidencia exacta
            if (claveNorm === queryNormalizado) {
                return window.mapeoMunicipios[clave];
            }
            
            // Coincidencia parcial (si no la tenemos ya)
            if (claveNorm.startsWith(queryNormalizado)) {
                const valor = window.mapeoMunicipios[clave];
                if (!coincidencias.includes(valor)) {
                    coincidencias.push(valor);
                }
            }
        }
    }
    
    // 4. Si hay una sola coincidencia parcial, usarla directamente
    if (coincidencias.length === 1) {
        console.log(`🏙️ Coincidencia parcial única: "${query}" → "${coincidencias[0]}"`);
        return coincidencias[0];
    }
    
    // 5. Si hay varias coincidencias, mostrar diálogo de selección
    if (coincidencias.length > 1) {
        console.log(`🤔 Múltiples coincidencias para "${query}":`, coincidencias);
        const seleccion = await mostrarSelectorMunicipios(coincidencias, query);
        return seleccion; // Puede ser null si el usuario cancela
    }
    
    // 6. Sin coincidencias
    return null;
}

// ✅ NUEVA FUNCIÓN: Mostrar diálogo para elegir entre varios municipios
function mostrarSelectorMunicipios(municipios, queryOriginal) {
    return new Promise((resolve) => {
        // Crear modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); display: flex; align-items: center;
            justify-content: center; z-index: 10000;
        `;
        
        const contenido = document.createElement('div');
        contenido.style.cssText = `
            background: white; border-radius: 8px; padding: 20px;
            max-width: 400px; width: 90%; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        
        let html = `
            <h3 style="margin-top:0; color:#2c3e50;">🏙️ Varios municipios encontrados</h3>
            <p style="color:#666;">Para "<strong>${queryOriginal}</strong>" se han encontrado ${municipios.length} municipios. Elige uno:</p>
            <div style="max-height: 300px; overflow-y: auto;">
        `;
        
        municipios.forEach((municipio, index) => {
    html += `
        <button class="opcion-municipio" data-indice="${index}" 
                style="display:block; width:100%; text-align:left; padding:10px; margin:5px 0;
                       background:#f8f9fa; border:1px solid #ddd; border-radius:4px; cursor:pointer;
                       font-size:14px; color:#2c3e50; font-weight:500;">
            📍 ${municipio}
        </button>
    `;
});
        
        html += `
            </div>
            <button id="cancelarSelector" style="margin-top:10px; padding:8px 16px; background:#dc3545; 
                    color:white; border:none; border-radius:4px; cursor:pointer; width:100%;">
                Cancelar
            </button>
        `;
        
        contenido.innerHTML = html;
        modal.appendChild(contenido);
        document.body.appendChild(modal);
        
        // Eventos
        contenido.querySelectorAll('.opcion-municipio').forEach(btn => {
            btn.addEventListener('click', () => {
                const indice = parseInt(btn.dataset.indice);
                document.body.removeChild(modal);
                resolve(municipios[indice]);
            });
        });
        
        contenido.querySelector('#cancelarSelector').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(null);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(null);
            }
        });
    });
}
    document.getElementById("coordenadas").addEventListener("change", e => buscarOCoordenadas(e.target.value));
    const btnLocalizar = document.getElementById("btnLocalizar");
    if (btnLocalizar) {
        btnLocalizar.addEventListener("click", () => buscarOCoordenadas(document.getElementById("coordenadas").value));
    }

       const locateButton = document.createElement("button");
    locateButton.textContent = "📍 Volver a mi ubicación";
    locateButton.type = "button";
    Object.assign(locateButton.style, { 
        marginTop: "10px", 
        marginBottom: "15px", 
        padding: "10px 15px", 
        backgroundColor: "#28a745", 
        color: "white", 
        border: "none", 
        borderRadius: "4px", 
        cursor: "pointer", 
        fontSize: "16px",
        display: "flex",
        alignItems: "center",
        gap: "5px"
    });

    locateButton.addEventListener("click", async e => {
        e.preventDefault();
        if (!mapaDisponible) {
            mostrarEstadoGPS('Mapa no disponible. El formulario sigue funcionando; puedes escribir las coordenadas manualmente.', 'error');
            return;
        }
        
        // Si ya tenemos una última posición, ir ahí inmediatamente
       if (ultimaPosicion) {
    const [lat, lng] = ultimaPosicion;
    seguimientoActivo = true;
    forzarZoomInicial = true;
    if (marker) marker.setLatLng([lat, lng]);
    else marker = L.marker([lat, lng]).addTo(map).bindPopup("Estás aquí").openPopup();
    map.setView([lat, lng], 13);
    document.getElementById("coordenadas_mapa").value = lat.toFixed(5) + ", " + lng.toFixed(5);
    
    // ✅ AÑADIR: Actualizar municipio
    mostrarPopupYActualizarMunicipio(lat, lng);
    
    iniciarSeguimiento();
    return;
}
        
        // Si no, buscar posición nueva
        mostrarEstadoGPS('🔍 Buscando tu ubicación...', 'info');
        locateButton.disabled = true;
        locateButton.textContent = '⏳ Buscando...';
        
        try {
    const pos = await obtenerPosicionRapida();
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    ultimaPosicion = [lat, lng];
    
    seguimientoActivo = true;
    forzarZoomInicial = true;
    
    if (marker) marker.setLatLng([lat, lng]);
    else marker = L.marker([lat, lng]).addTo(map).bindPopup("Estás aquí").openPopup();
    
    map.setView([lat, lng], 13);
    document.getElementById("coordenadas_mapa").value = lat.toFixed(5) + ", " + lng.toFixed(5);
    
    // ✅ AÑADIR: Actualizar municipio
    mostrarPopupYActualizarMunicipio(lat, lng);
    
    mostrarEstadoGPS('✅ Ubicación encontrada', 'success');
    
    // Iniciar seguimiento continuo
    iniciarSeguimiento();
    
} catch (err) {
            console.error("Error al obtener ubicación:", err);
            
            let mensaje = '❌ No se pudo obtener tu ubicación';
            if (err.code === 1) {
                mensaje = '❌ Permiso de ubicación denegado. Actívalo en la configuración.';
            } else if (err.code === 2) {
                mensaje = '❌ No hay señal GPS. Intenta en exterior.';
            } else if (err.code === 3) {
                mensaje = '❌ Tiempo de espera agotado. Intenta de nuevo.';
            }
            
            mostrarEstadoGPS(mensaje, 'error');
        } finally {
            locateButton.disabled = false;
            locateButton.textContent = "📍 Volver a mi ubicación";
        }
    });

    const mapElement = document.getElementById("map");
    mapElement.parentNode.insertBefore(locateButton, mapElement.nextSibling);

    // ✅ ELIMINADO: la llamada a getNumeroEntrada al cargar la página
    // El campo numero_entrada quedará vacío (como debe ser)

    function validarInputDatalist(inputId, datalistId, mensajeError) {
        const input = document.getElementById(inputId);
        const datalist = document.getElementById(datalistId);
        input.addEventListener('blur', function () {
            const opciones = Array.from(datalist.options).map(opt => opt.value.trim());
            if (input.value.trim() === "") return;
            if (!opciones.includes(input.value.trim())) {
                alert(mensajeError);
                input.value = "";
                input.focus();
            }
        });
    }

    validarInputDatalist('especie_comun', 'especies-comun-list', 'Debes seleccionar una especie (nombre común) existente.');
    validarInputDatalist('especie_cientifico', 'especies-cientifico-list', 'Debes seleccionar una especie (nombre científico) existente.');
   validarInputDatalist('municipio', 'municipios-list', 'Debes seleccionar un municipio existente.');

    // ============================================
    // VALIDACIÓN DE COHERENCIA: MUNICIPIO vs COORDENADAS (restaurada de GitHub,
    // adaptada al código actual: usa obtenerMunicipio y convertirAVaenciano locales).
    // Solo LEE los campos: nunca mueve el mapa ni borra/sobrescribe coordenadas.
    // ============================================
    // Comprobación PURA de coherencia municipio-coordenadas (sin avisos):
    // devuelve el detalle para que cada llamante decida si avisa con su mensaje.
    // Solo LEE los campos: nunca mueve el mapa ni borra/sobrescribe coordenadas.
    // Fail-open: datos ausentes, inválidos o errores devuelven coinciden:true.
    async function validarCoherenciaMunicipioCoordenadas() {
        const municipioInput = document.getElementById('municipio');
        const coordenadasMapaInput = document.getElementById('coordenadas_mapa');

        if (!municipioInput || !coordenadasMapaInput) return { coinciden: true };

        const municipioEscrito = municipioInput.value.trim();
        const coordenadasMapa = coordenadasMapaInput.value.trim();

        if (!municipioEscrito || !coordenadasMapa) {
            return { coinciden: true };
        }

        const partes = coordenadasMapa.split(',').map(v => parseFloat(v.trim()));
        if (partes.length !== 2 || isNaN(partes[0]) || isNaN(partes[1])) {
            return { coinciden: true };
        }

        const lat = partes[0];
        const lng = partes[1];

        try {
            const resultado = await obtenerMunicipio(lat, lng);

            if (!resultado || !resultado.municipio ||
                ["Desconocido", "No encontrado", "Error"].includes(resultado.municipio)) {
                return { coinciden: true };
            }

            const municipioCoordenadas = convertirAVaenciano(resultado.municipio);

            const normalizar = texto =>
                texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

            const coinciden = normalizar(municipioEscrito) === normalizar(municipioCoordenadas);
            return { coinciden, municipioEscrito, municipioCoordenadas };

        } catch (error) {
            console.warn("No se pudo comprobar la coherencia municipio/coordenadas:", error);
            return { coinciden: true };
        }
    }

    // Resultado COMPARTIDO entre blur y submit: misma instantánea de valores →
    // MISMA consulta (sin fetch duplicado). No muestra avisos: cada llamante
    // decide si avisa con el detalle devuelto.
    // Propiedad del aviso: varios blur sobre la misma instantánea encolan una
    // continuación cada uno; solo el primero que la reclama avisa. Así, pulsar
    // Aceptar nunca hace reaparecer el mismo aviso sin un gesto nuevo.
    let coherenciaEnCurso = null; // {clave, promesa, alertado}
    function coherenciaCompartida() {
        const campoMun = document.getElementById('municipio');
        const campoCoo = document.getElementById('coordenadas_mapa');
        const clave = ((campoMun && campoMun.value) || '').trim() + '||' + ((campoCoo && campoCoo.value) || '').trim();
        if (!coherenciaEnCurso || coherenciaEnCurso.clave !== clave) {
            coherenciaEnCurso = { clave, promesa: validarCoherenciaMunicipioCoordenadas(), alertado: false };
        }
        return coherenciaEnCurso.promesa;
    }
    // Reclama en exclusiva el aviso de la instantánea en curso (atómico en
    // hilo único: las continuaciones encoladas se ejecutan en secuencia).
    function reclamarAvisoCoherencia() {
        const e = coherenciaEnCurso;
        if (e && !e.alertado) {
            e.alertado = true;
            return true;
        }
        return false;
    }

    // Supresión de UN SOLO USO del aviso de blur ligado al botón Enviar:
    // mousedown la arma; el SIGUIENTE blur la consume (tenga o no que avisar
    // ese blur por otras causas). mouseup/pointerup/pointercancel/mouseleave
    // y el finally del submit la liberan. Un mousedown aislado (real o
    // sintético desde consola) como máximo omite UN aviso posterior y jamás
    // silencia los siguientes: no puede retener el formulario.
    let supresionBlurEnvio = false;
    const btnEnviarCoherencia = document.getElementById('enviarBtn');
    if (btnEnviarCoherencia) {
        // Un solo disparador (mousedown, sintetizado también en táctil):
        // no se duplica con pointerdown para evitar manejadores redundantes.
        btnEnviarCoherencia.addEventListener('mousedown', () => { supresionBlurEnvio = true; });
        // Liberaciones idempotentes: clic completado, interrupción táctil,
        // arrastre fuera del botón; el submit también libera en su finally.
        btnEnviarCoherencia.addEventListener('mouseup', () => { supresionBlurEnvio = false; });
        btnEnviarCoherencia.addEventListener('pointerup', () => { supresionBlurEnvio = false; });
        btnEnviarCoherencia.addEventListener('pointercancel', () => { supresionBlurEnvio = false; });
        // Sin clic posterior (arrastre fuera del botón): liberar la bandera.
        btnEnviarCoherencia.addEventListener('mouseleave', () => { supresionBlurEnvio = false; });
    }

    // Comprobar coherencia al salir del campo municipio (avisa, no bloquea ni mueve el mapa).
    // No se usa 'change' para no duplicar esta validación: 'blur' ya cubre el cambio manual.
    document.getElementById('municipio').addEventListener('blur', async function () {
        // Consumo SÍNCRONO de la supresión de un solo uso: si este blur nace
        // del mousedown sobre Enviar, el submit mostrará su único aviso.
        // Se decide aquí (no tras la red): un mousedown aislado solo puede
        // omitir este blur, nunca los siguientes.
        const omitirPorEnvio = supresionBlurEnvio;
        supresionBlurEnvio = false;
        if (omitirPorEnvio) return;
        const r = await coherenciaCompartida();
        // Si mientras tanto empezó un intento de envío, él avisará por su cuenta.
        // La reclamación evita que varios blur encolados avisen en cadena tras Aceptar.
        if (!r.coinciden && !envioEnCurso && reclamarAvisoCoherencia()) {
            alert(
                `⚠️ El municipio no coincide con la ubicación.\n\n` +
                `Municipio indicado: ${r.municipioEscrito}\n` +
                `Municipio según las coordenadas: ${r.municipioCoordenadas}\n\n` +
                `Por favor, corrige el municipio o vuelve a localizar la ubicación en el mapa.`
            );
        }
    });

    // Guardia síncrona anti-doble-envío: una segunda invocación (doble clic / Intro)
    // mientras hay un envío en curso se ignora sin generar otro envio_id ni otro POST.
    let envioEnCurso = false;

    /* ---------- ENVÍO DEL FORMULARIO (UNIFICADO Y CORREGIDO) ---------- */
    document.getElementById("formulario").addEventListener("submit", async function (e) {
        // 0. PRIMERO: cancelar sincrónicamente el envío nativo, antes de cualquier await.
        e.preventDefault();

        // Un registro enviado está en solo lectura real. Este guardia impide
        // el envío incluso si se intenta activar el submit desde la consola.
        if (window.modoSoloLectura) {
            alert('⚠️ Este registro ya fue enviado y está en modo solo lectura. No se puede modificar ni reenviar.');
            return;
        }

        // Segunda invocación concurrente: ignorar (conserva el envio_id del proceso en curso).
        if (envioEnCurso) return;
        envioEnCurso = true;
        const btn = document.getElementById("enviarBtn");
        btn.disabled = true;
        btn.textContent = "Enviando...";
        let envioIniciado = false;
        try {
        
        // 1. PRIMERO: Validación nativa del navegador (muestra "Completa este campo")
        if (!this.checkValidity()) {
            e.preventDefault();
            this.reportValidity();
            return;
        }

        // 2. SEGUNDO: Validaciones personalizadas de especies
        const especieComunInput = document.getElementById("especie_comun");
        const especieComunList = Array.from(document.getElementById("especies-comun-list").options).map(opt => opt.value.trim());
        if (!especieComunInput.value.trim() || !especieComunList.includes(especieComunInput.value.trim())) {
            alert("Debes seleccionar una especie (nombre común) válida.");
            especieComunInput.focus();
            e.preventDefault();
            return;
        }
        
        const especieCientificoInput = document.getElementById("especie_cientifico");
        const especieCientificoList = Array.from(document.getElementById("especies-cientifico-list").options).map(opt => opt.value.trim());
        if (!especieCientificoInput.value.trim() || !especieCientificoList.includes(especieCientificoInput.value.trim())) {
            alert("Debes seleccionar una especie (nombre científico) válida.");
            especieCientificoInput.focus();
            e.preventDefault();
            return;
        }

        // 3. TERCERO (restaurado de GitHub): coherencia municipio-coordenadas.
        // Bloquea el envío hasta corregir, sin mover el mapa ni tocar coordenadas.
        // Comparte la consulta con blur, pero el aviso del envío es propio:
        // aparece exactamente una vez por intento bloqueado, explique o no blur antes.
        const coherencia = await coherenciaCompartida();
        if (!coherencia.coinciden) {
            // Reclamar para que un blur posterior con los mismos valores no
            // reavise; el aviso de ESTE intento se muestra siempre debajo.
            reclamarAvisoCoherencia();
            alert(
                `⚠️ No se puede enviar: el municipio no coincide con las coordenadas.\n\n` +
                `Municipio indicado: ${coherencia.municipioEscrito}\n` +
                `Municipio según las coordenadas: ${coherencia.municipioCoordenadas}\n\n` +
                `Corrige el municipio antes de continuar.`
            );
            document.getElementById('municipio').focus();
            e.preventDefault();
            return;
        }
// Validación eliminada: ya no hay campo "Especificar"
        // 4. CUARTO: Si todo es válido, proceder con el envío AJAX
        e.preventDefault(); // Prevenir envío normal solo ahora
        // El borrador NO se borra aquí: solo se limpia tras un guardado
        // offline correcto o un envío confirmado con registro local en "enviado".

        const fd = new FormData(this);
        // Capturar el borrador solo si coincide EXACTAMENTE con la
        // serialización fresca del formulario en este momento. Si no coincide,
        // falta, no se puede leer o falla cualquier paso, se conserva
        // (borradorEnviado queda en null y la limpieza no lo tocará).
        let borradorEnviado = null;
        try {
            const borradorActual = JSON.stringify(serializarFormulario(this));
            const borradorGuardado = localStorage.getItem('recogidasForm');
            if (borradorGuardado !== null && borradorGuardado === borradorActual) {
                borradorEnviado = borradorGuardado;
            }
        } catch (errBorrador) {
            console.error('No se pudo verificar el borrador al iniciar el envío:', errBorrador);
        }
       // Recoger valor de "Posible causa" (radio button)
const posibleCausaRadio = document.querySelector('input[name="posible_causa"]:checked');
let posibleCausaValue = posibleCausaRadio?.value || "";

// Si está seleccionado "Otras", usar el valor del desplegable
if (posibleCausaValue === "Otras") {
    const otrasCausaSelect = document.getElementById('otrasCausaSelect');
    if (otrasCausaSelect?.value) {
        posibleCausaValue = otrasCausaSelect.value;
    }
}
// ✅ CONVERTIR A MAYÚSCULAS PARA GOOGLE SHEETS
const posibleCausaMayusculas = posibleCausaValue.toUpperCase();
// Detectar tipo de salida desde Observaciones
const observacionesTexto = (() => {
    let txt = fd.get("observaciones")?.trim() || "";
    // Añadir anilla si aplica
    const anillaInput = document.getElementById('anilla');
    const recuperacionChecked = document.getElementById('recuperacion')?.checked;
    if (recuperacionChecked && anillaInput) {
        const anilla = anillaInput.value.trim();
        if (anilla) txt += (txt ? " | " : "") + `Anilla: ${anilla}`;
    }
    return txt;
})();

// Detectar Tipo de Salida
let tipoSalida = "";
const euPattern = /\([Ee][Uu]\)/;
const muPattern = /\([Mm][Uu]\)/;

if (euPattern.test(observacionesTexto)) {
    tipoSalida = "SACRIFICIO";
} else if (muPattern.test(observacionesTexto)) {
    tipoSalida = "MUERTE";
}

const data = {
    numero_entrada: document.getElementById("numero_entrada").value,
    especie_comun: fd.get("especie_comun"),
    especie_cientifico: fd.get("especie_cientifico"),
    cantidad_animales: fd.get("cantidad_animales"),
    fecha: fd.get("fecha"),
    municipio: fd.get("municipio"),
    posible_causa: posibleCausaMayusculas,
    remitente: fd.get("remitente") || "",
    estado_animal: fd.getAll("estado_animal"),
    coordenadas: fd.get("coordenadas"),
    coordenadas_mapa: fd.get("coordenadas_mapa"),
    apoyo: fd.get("apoyo"),
    cra_km: fd.get("cra_km"),
    observaciones: observacionesTexto,
    cumplimentado_por: fd.get("cumplimentado_por"),
    telefono_remitente: fd.get("telefono_remitente"),
    foto: "",
    tipo_salida: tipoSalida  // ← NUEVO CAMPO
};
        const file = fd.get("foto");
        if (file && file.size) {
            try {
                data.foto = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = ev => resolve(ev.target.result);
                    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
                    reader.readAsDataURL(file);
                });
            } catch (errFoto) {
                console.error("Error al leer la foto:", errFoto);
                alert("⚠️ No se pudo leer la foto seleccionada. Revisa el archivo e inténtalo de nuevo.");
                return;
            }
        }
        envioIniciado = true;
        await enviarDatos(data, btn, window.envioIdCargado, window.registroIdCargado, borradorEnviado);
        } finally {
            envioEnCurso = false;
            supresionBlurEnvio = false;
            // Si el envío real no llegó a iniciarse, reabrir aquí el botón;
            // si se inició, enviarDatos lo restaura al terminar de verdad.
            if (!envioIniciado && !window.modoSoloLectura) {
                btn.disabled = false;
                btn.textContent = "Enviar";
            }
        }
    });

// ✅ FUNCIÓN ACTUALIZADA: implementa envio_id y estados guardado/pendiente_confirmacion/enviado
async function enviarDatos(data, btn, existingEnvioId = null, registroLocalId = null, borradorEnviado = null) {
  let registroPendienteId = null;
  // El servidor confirmó el envío (respuesta válida + números válidos).
  let envioConfirmadoPorServidor = false;
  // La escritura local del estado "enviado" terminó correctamente.
  let registroLocalMarcadoEnviado = false;
  // Mensaje específico para un reenvío cuyo registro anterior no se pudo
  // actualizar antes del POST. No afirma que el registro anterior no exista.
  const mensajeReenvioNoActualizado = "⚠️ No se ha podido actualizar el registro local existente para preparar el envío. No se ha enviado nada. Este intento no ha borrado ni modificado el registro anterior; su envio_id y estado no se han cambiado desde aquí.\n\nCopia los datos del formulario antes de cerrar o recargar la aplicación para no perderlos.";
  const cantidad = Math.max(1, parseInt(data.cantidad_animales) || 1);
  // Para un reenvío se toma la cantidad del registro local; para un envío
  // nuevo, la del registro que se acaba de guardar antes del POST.
  let cantidadEsperada = cantidad;

  // Huella y clave deterministas de este envío, para reconocer el mismo intento
  // tras un fallo incierto o una recarga, sin depender de variables de window.
  const huellaEnvio = calcularHuellaEnvio(data);
  const claveEnvio = calcularClaveEnvio(data);

  // IDENTIDAD PERSISTENTE DEL ENVÍO EN CURSO.
  // Antes de generar CUALQUIER envio_id se resuelve a qué envío previo
  // corresponde este formulario. La identidad vive en el puntero persistente
  // (localStorage) más el operacion_id del registro, de modo que un envío
  // incierto se sigue reconociendo aunque cambien observaciones u otros campos,
  // o aunque se recargue la página. Si no se puede decidir con seguridad, se
  // bloquea: nunca se crea un ID nuevo mientras pueda existir un envío anterior
  // sin confirmar que corresponda a la misma operación.
  let operacionId = null;
  let estadoLocalParaOffline = null;
  // Snapshot inmutable del primer intento. Solo se rellena al ADOPTAR o CREAR
  // una operación; en los reintentos se conserva el ya guardado.
  let datosOriginalesInmutables = null;
  let huellaOriginalInmutable = null;

  if (!registroLocalId && !existingEnvioId) {
    let registrosLocales;
    try {
      registrosLocales = await obtenerRegistros();
    } catch (errLista) {
      console.error('No se pudo leer la lista de registros locales para recuperar un pendiente:', errLista);
      alert('⚠️ No se pudo comprobar si este envío tenía un intento anterior. No se ha enviado nada. Vuelve a intentarlo desde «Ver registros guardados».');
      return;
    }
    const punteroEnCurso = leerPunteroEnvioEnCurso();
    const resolucion = resolverEnvioEnCurso(registrosLocales, data, punteroEnCurso);
    if (resolucion.accion === 'BLOQUEAR') {
      alert(mensajeBloqueoRecuperacion(resolucion));
      return;
    }
    if (resolucion.accion === 'REUTILIZAR') {
      if (resolucion.datosCambiados) {
        const continuar = await confirmarContinuarEnvioPendiente(resolucion.registro, data);
        if (!continuar) {
          alert("ℹ️ No se ha enviado nada. El formulario se ha conservado tal cual.\n\nSi querías enviar un registro NUEVO distinto, abre «Ver registros guardados», resuelve o elimina el envío pendiente anterior y vuelve a intentarlo.");
          return;
        }
      }
      registroLocalId = resolucion.registro.id;
      existingEnvioId = resolucion.registro.envio_id;
      operacionId = resolucion.registro.operacion_id || generarEnvioId();
      estadoLocalParaOffline = resolucion.registro.estado;
      // Si el registro adoptado no tenía snapshot original, se fija ahora.
      if (!resolucion.registro.huella_original && !resolucion.registro.datos_originales) {
        huellaOriginalInmutable = huellaEnvio;
        datosOriginalesInmutables = construirDatosOriginales_(data);
      }
    } else {
      // Envío nuevo: identidad persistente para reconocerlo si la respuesta es incierta.
      operacionId = generarEnvioId();
      huellaOriginalInmutable = huellaEnvio;
      datosOriginalesInmutables = construirDatosOriginales_(data);
    }
  }

  // Generar o conservar envio_id. En un reenvío se sustituye por el valor
  // autoritativo leído de IndexedDB antes de continuar.
  let envioId = existingEnvioId || generarEnvioId();

  // Campos de identidad de la operación que se añaden a la escritura del
  // registro sin sobrescribir el snapshot original ya existente.
  const camposIdentidadOperacion = () => {
    const campos = { operacion_id: operacionId };
    if (huellaOriginalInmutable) campos.huella_original = huellaOriginalInmutable;
    if (datosOriginalesInmutables) campos.datos_originales = datosOriginalesInmutables;
    return campos;
  };

  // Limpia el borrador solo si sigue siendo exactamente el capturado al
  // iniciar el envío. Si cambió durante el envío (por ejemplo, porque el
  // usuario siguió editando), se conserva: pertenece a otra operación.
  const limpiarBorradorSiNoCambio = (etapa) => {
    try {
      if (borradorEnviado !== null &&
          localStorage.getItem('recogidasForm') === borradorEnviado) {
        localStorage.removeItem('recogidasForm');
      }
    } catch (errBorrador) {
      console.error(`No se pudo limpiar el borrador (${etapa}):`, errBorrador);
    }
  };

  // Aplica un estado al registro pendiente sin degradar un 'enviado' ya fijado
  // por otra operación. Devuelve 'OK', 'YA_ENVIADO', 'SIN_REGISTRO' o 'ERROR'.
  const marcarEstadoSinDegradar = async (estado) => {
    if (!registroPendienteId) return 'SIN_REGISTRO';
    try {
      await cambiarEstadoRegistroCondicional(registroPendienteId, estado, envioId);
      return 'OK';
    } catch (errEstado) {
      if (errEstado && errEstado.message === 'REGISTRO_ENVIADO') return 'YA_ENVIADO';
      console.error('No se pudo actualizar el estado del registro local:', errEstado);
      return 'ERROR';
    }
  };
  const avisoYaEnviado = "⚠️ No se pudo confirmar aquí, pero el registro local ya figura como enviado (confirmado en otra operación o pestaña).\n\nNo lo reenvíes. Usa «Comprobar si ya fue registrada» desde «Ver registros guardados».";

  try {
    // Un envío con envio_id pero sin id local no se puede verificar contra
    // IndexedDB: se aborta antes de cualquier escritura o POST.
    if (existingEnvioId && !registroLocalId) {
      alert('⚠️ No se puede verificar el registro local de este envío. No se ha enviado nada. Vuelve a cargarlo desde «Ver registros guardados».');
      return;
    }

    // Antes de enviar un registro cargado, se lee su copia local y se usa el
    // envio_id almacenado como valor autoritativo. Si el formulario tiene otro
    // identificador, no se continúa: hay que volver a cargar el registro.
    if (registroLocalId) {
      let registroLocal;
      try {
        registroLocal = await obtenerRegistroLocalPorId(registroLocalId);
      } catch (errLecturaLocal) {
        console.error('No se pudo leer el registro local antes del envío:', errLecturaLocal);
        alert('⚠️ No se pudo leer el registro local. No se ha enviado nada. Vuelve a intentarlo desde «Ver registros guardados».');
        return;
      }

      const validacionLocal = validarRegistroLocalParaEnvio(registroLocal, existingEnvioId, cantidad);
      if (!validacionLocal.ok) {
        const avisos = {
          NO_EXISTE: '⚠️ El registro local ya no existe. No se ha enviado nada.',
          REGISTRO_ENVIADO: '⚠️ Este registro ya está marcado como enviado. No se puede reenviar ni modificar.',
          ENVIO_ID_AUSENTE: '⚠️ Este registro local no tiene envio_id y no se puede reenviar. Puedes consultarlo, pero no enviarlo de nuevo.',
          ENVIO_ID_INVALIDO: '⚠️ El envio_id guardado en el registro local no tiene un formato válido. No se ha enviado nada.',
          ENVIO_ID_CAMBIADO: '⚠️ El envio_id en memoria no coincide con el guardado. No se ha enviado nada: vuelve a cargar el registro desde «Ver registros guardados».',
          CANTIDAD_LOCAL_INVALIDA: '⚠️ La cantidad de animales del registro local no es válida. No se ha enviado nada.',
          CANTIDAD_CAMBIADA: '⚠️ La cantidad de animales del formulario no coincide con la del registro local. No se ha enviado nada: vuelve a cargar el registro desde «Ver registros guardados».'
        };
        alert(avisos[validacionLocal.motivo] || '⚠️ El registro local no se puede reenviar. No se ha enviado nada.');
        return;
      }
      cantidadEsperada = validacionLocal.cantidad;
      envioId = validacionLocal.envioId;
      estadoLocalParaOffline = registroLocal.estado;
      // Adopción del registro cargado dentro de la identidad persistente: si no
      // tenía operacion_id ni snapshot original, se fijan ahora (una sola vez).
      operacionId = registroLocal.operacion_id || generarEnvioId();
      if (!registroLocal.huella_original && !registroLocal.datos_originales) {
        huellaOriginalInmutable = huellaEnvio;
        datosOriginalesInmutables = construirDatosOriginales_(data);
      }
    }

    // REGLA FUNDAMENTAL: si NO hay conexión antes del fetch → guardado
    if (!navigator.onLine) {
      if (registroLocalId) {
        // Reenvío (cargado o recuperado): NO se degrada un pendiente_confirmacion,
        // porque el servidor podría haber recibido ya este envío. Se conserva su
        // envio_id original dentro de la misma transacción.
        const estadoOffline = (estadoLocalParaOffline === 'pendiente_confirmacion')
          ? 'pendiente_confirmacion' : 'guardado';
        try {
          await actualizarDatosRegistroParaEnvio(registroLocalId, { ...data, envio_id: envioId, ...camposIdentidadOperacion(), estado: estadoOffline, huella_envio: huellaEnvio, clave_envio: claveEnvio }, envioId);
        } catch (errActualizar) {
          if (esCambioRegistroLocalParaEnvio(errActualizar)) {
            alert('⚠️ El registro local ha cambiado o ya no está disponible. No se ha enviado nada. Vuelve a cargarlo desde «Ver registros guardados».');
            return;
          }
          throw errActualizar;
        }
        guardarPunteroEnvioEnCurso(operacionId, registroLocalId, envioId);
        if (estadoOffline === 'pendiente_confirmacion') {
          alert("⚠️ No hay conexión. El registro sigue como 'pendiente de confirmación' con su envio_id original (puede que ya estuviera registrado). Comprueba con «Comprobar si ya fue registrada».");
        } else {
          alert("❌ No hay conexión. El registro se guardó localmente (estado: guardado) y puede enviarse manualmente cuando tengas conexión.");
        }
      } else {
        const idGuardadoOffline = await guardarRegistroLocalConEstado({ ...data, envio_id: envioId, ...camposIdentidadOperacion(), huella_envio: huellaEnvio, clave_envio: claveEnvio }, "guardado");
        guardarPunteroEnvioEnCurso(operacionId, idGuardadoOffline, envioId);
        alert("❌ No hay conexión. El registro se guardó localmente (estado: guardado) y puede enviarse manualmente cuando tengas conexión.");
      }
      // Guardado offline correcto: limpiar solo si el borrador no cambió
      // desde que se capturaron los datos del envío.
      limpiarBorradorSiNoCambio('guardado offline');
      return;
    }

    // BLOQUEO DE DESARROLLO: no se prepara ni se envía nada si el backend
    // propio de Alicante todavía no está configurado. Se comprueba antes del
    // guardado local previo al POST para no dejar registros "pendientes" de
    // un envío que nunca llegó a intentarse.
    if (!BACKEND_ALICANTE_CONFIGURADO) {
      avisarBackendDeshabilitado("envío");
      return;
    }

    // Protección adicional: si alguien activa el flag sin poner la URL real,
    // no se envía nada a ningún destino.
    if (!API_ALICANTE_URL) {
      avisarBackendDeshabilitado("envío (URL de Alicante no configurada)");
      return;
    }

    // 1. GUARDAR REGISTRO COMO "pendiente_confirmacion" ANTES DE INTENTAR ENVIAR
    if (registroLocalId) {
      // Reenvío: se conserva el id local y el envio_id originales (sin crear duplicado)
      try {
        await actualizarDatosRegistroParaEnvio(registroLocalId, { ...data, envio_id: envioId, ...camposIdentidadOperacion(), estado: "pendiente_confirmacion", huella_envio: huellaEnvio, clave_envio: claveEnvio }, envioId);
      } catch (errActualizar) {
        if (esCambioRegistroLocalParaEnvio(errActualizar)) {
          alert('⚠️ El registro local ha cambiado o ya no está disponible. No se ha enviado nada. Vuelve a cargarlo desde «Ver registros guardados».');
          return;
        }
        throw errActualizar;
      }
      registroPendienteId = registroLocalId;
      guardarPunteroEnvioEnCurso(operacionId, registroLocalId, envioId);
    } else {
      const registroPendiente = {
        ...data,
        envio_id: envioId,
        ...camposIdentidadOperacion(),
        estado: "pendiente_confirmacion",
        huella_envio: huellaEnvio,
        clave_envio: claveEnvio
      };
      registroPendienteId = await guardarRegistroLocalConEstado(registroPendiente, "pendiente_confirmacion");
      // El puntero persistente queda fijado ANTES del POST: si la respuesta es
      // incierta (o se recarga la página), el siguiente intento lo recupera.
      guardarPunteroEnvioEnCurso(operacionId, registroPendienteId, envioId);
    }

    // 2. Enviar el formulario (CORS: se lee la respuesta real de doPost())
    // Caso a: si la petición no produce una respuesta fiable (fallo de red,
    // lectura o parseo), el envío NO se considera confirmado.
    let response;
    try {
      response = await fetch(API_ALICANTE_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
        body: JSON.stringify({ ...data, envio_id: envioId })
      });
    } catch (redErr) {
      // Caso a: fallo de comunicación tras emitir el fetch → pendiente_confirmacion
      const estadoAplicado = await marcarEstadoSinDegradar("pendiente_confirmacion");
      if (estadoAplicado === 'YA_ENVIADO') { alert(avisoYaEnviado); return; }
      alert("⚠️ No se pudo confirmar el envío. El registro está como 'pendiente de confirmación'.\nUsa 'Comprobar si ya fue registrada' desde 'Ver registros guardados'.");
      return;
    }

    // 2b. Caso a: un estado HTTP no satisfactorio tampoco confirma el envío,
    // aunque el cuerpo pudiera contener un JSON con "result": "success".
    if (!response.ok) {
      const estadoAplicado = await marcarEstadoSinDegradar("pendiente_confirmacion");
      if (estadoAplicado === 'YA_ENVIADO') { alert(avisoYaEnviado); return; }
      alert(`⚠️ El servidor respondió con un estado HTTP ${response.status}. No se puede confirmar el envío. El registro está como 'pendiente de confirmación'.\nUsa 'Comprobar si ya fue registrada' desde 'Ver registros guardados'.`);
      return;
    }

    // 3. Leer el cuerpo de la respuesta
    let textoRespuesta;
    try {
      textoRespuesta = await response.text();
    } catch (lecturaErr) {
      // Caso a: no se pudo leer el cuerpo de la respuesta → pendiente_confirmacion
      const estadoAplicado = await marcarEstadoSinDegradar("pendiente_confirmacion");
      if (estadoAplicado === 'YA_ENVIADO') { alert(avisoYaEnviado); return; }
      alert("⚠️ Se perdió la respuesta después de enviar. El registro está como 'pendiente de confirmación'.\nUsa 'Comprobar si ya fue registrada' desde 'Ver registros guardados'.");
      return;
    }

    // 4. Parsear el JSON de la respuesta
    let resultado;
    try {
      resultado = JSON.parse(textoRespuesta);
    } catch (parseErr) {
      // Caso a: el cuerpo no es JSON válido → pendiente_confirmacion
      const estadoAplicado = await marcarEstadoSinDegradar("pendiente_confirmacion");
      if (estadoAplicado === 'YA_ENVIADO') { alert(avisoYaEnviado); return; }
      alert("⚠️ Respuesta inesperada del servidor. El registro está como 'pendiente de confirmación'.\nUsa 'Comprobar si ya fue registrada' desde 'Ver registros guardados'.");
      return;
    }

    // 5. El backend devuelve HTTP 200 también en error: hay que mirar "result"
    if (!resultado || resultado.result !== "success") {
      // Si el backend garantiza que no escribió → guardado
      if (resultado && resultado.escrito === false) {
        const estadoAplicado = await marcarEstadoSinDegradar("guardado");
        if (estadoAplicado === 'YA_ENVIADO') { alert(avisoYaEnviado); return; }
        alert("❌ El servidor rechazó el envío (no escribió):\n" + (resultado.message || resultado.error || "Error desconocido") + "\n\nEl registro está como 'guardado' y puede reenviarse.");
      } else {
        // No sabemos si escribió → pendiente_confirmacion
        const estadoAplicado = await marcarEstadoSinDegradar("pendiente_confirmacion");
        if (estadoAplicado === 'YA_ENVIADO') { alert(avisoYaEnviado); return; }
        alert("⚠️ No se pudo confirmar el envío. El registro está como 'pendiente de confirmación'.\nUsa 'Comprobar si ya fue registrada' desde 'Ver registros guardados'.");
      }
      return;
    }

    // 6. Números asignados EXCLUSIVAMENTE a este envío (los devuelve el backend)
    // Caso b: respuesta de éxito con datos incompletos o inválidos. No se
    // confirma el envío.
    const numerosAsignados = resultado.numerosAsignados;
    if (!validarNumerosAsignados(numerosAsignados, cantidadEsperada)) {
      const estadoAplicado = await marcarEstadoSinDegradar("pendiente_confirmacion");
      if (estadoAplicado === 'YA_ENVIADO') { alert(avisoYaEnviado); return; }
      alert("⚠️ El servidor no devolvió números válidos, únicos, consecutivos y con la cantidad esperada. El registro está como 'pendiente de confirmación'.\n\nNo se ha marcado como enviado. Usa «Comprobar si ya fue registrada» para reconciliarlo.");
      return;
    }

    // 7. ACTUALIZAR EL REGISTRO A "enviado" (con los números asignados)
    // Caso c: respuesta válida y números válidos. Se confirma el envío y se
    // actualiza el registro local a "enviado".
    envioConfirmadoPorServidor = true;
    try {
      await cambiarEstadoRegistroCondicional(registroPendienteId, "enviado", envioId, numerosAsignados);
      registroLocalMarcadoEnviado = true;
      // Operación resuelta: el puntero de envío en curso ya no es necesario.
      limpiarPunteroEnvioEnCurso(registroPendienteId);
    } catch (errDb) {
      // Caso d: respuesta válida, pero fallo de IndexedDB. El envío está
      // confirmado por el servidor; el registro local no se marca como "enviado".
      console.error("DISCREPANCIA: el servidor confirmó pero no se pudo actualizar IndexedDB:", errDb);
      alert("⚠️ DISCREPANCIA: el servidor confirmó el envío (número(s): " + numerosAsignados.join(", ") + ") pero NO se pudo actualizar el registro local.\n\nEl registro seguirá como 'pendiente de confirmación'. Usa «Comprobar» para reconciliarlo.");
      return;
    }

    // Envío confirmado por el servidor y registro local en "enviado": limpiar
    // solo si el borrador no cambió desde que se capturaron los datos del envío.
    limpiarBorradorSiNoCambio('envío confirmado');

    // 8. Mostrar resultado al usuario.
    // Estas operaciones son posteriores a la confirmación del servidor y a la
    // escritura local de "enviado". Sus fallos NO deben degradar el estado ni
    // llegar al catch exterior como si el envío no se hubiera confirmado.
    let errorInterfaz = null;
    const registrarErrorInterfaz = (etapa, error) => {
      console.error(`Error de interfaz tras envío confirmado (${etapa}):`, error);
      if (!errorInterfaz) errorInterfaz = error;
    };

    const numeros = numerosAsignados;
    let mensajeNumeros;
    if (numeros.length === 1) {
      mensajeNumeros = `Número de entrada: <span class="numeros-grandes">${numeros[0]}</span>`;
    } else {
      const esConsecutivo = numeros.every((num, i) => i === 0 || num === numeros[i - 1] + 1);
      if (esConsecutivo && numeros.length >= 5) {
        mensajeNumeros = `Rango asignado: <span class="numeros-grandes">${numeros[0]}-${numeros[numeros.length - 1]}</span> (${numeros.length} animales)`;
      } else if (esConsecutivo && numeros.length <= 4) {
        mensajeNumeros = `Números de entrada: <span class="numeros-grandes">${numeros.join(", ")}</span>`;
      } else {
        mensajeNumeros = `Números asignados: <span class="numeros-grandes">${numeros[0]}, ${numeros[1]}, …, ${numeros[numeros.length - 1]}</span> (${numeros.length} animales)`;
      }
    }

    // Marcador de sesión conservado por compatibilidad. El borrador ya no se
    // borra al arrancar; su limpieza se hace solo tras un guardado seguro.
    try {
      sessionStorage.setItem('formEnviadoOK', '1');
    } catch (errSesion) {
      registrarErrorInterfaz('almacenamiento de sesión', errSesion);
    }

    try {
      // Se espera la alerta para que un rechazo asíncrono quede dentro de este
      // try/catch. La confirmación y el estado local ya están fijados.
      await Swal.fire({
        icon: 'success',
        title: `${cantidad} registro(s) guardado(s)`,
        html: mensajeNumeros + (resultado.duplicado ? '<br><small>(envío repetido - ya existía)</small>' : ''),
        confirmButtonText: 'Aceptar',
        confirmButtonColor: '#28a745',
        width: '600px'
      });
    } catch (errSwal) {
      registrarErrorInterfaz('alerta de éxito', errSwal);
    }

    try {
      document.getElementById("formulario").reset();
      document.getElementById('fecha').value = getFechaLocalISO();
      window.envioIdCargado = null;
      window.registroIdCargado = null;
      aplicarModoSoloLectura(false);
    } catch (errFormulario) {
      registrarErrorInterfaz('restablecimiento del formulario', errFormulario);
    }

    if (errorInterfaz) {
      try {
        alert("⚠️ El servidor confirmó el envío (número(s): " + numerosAsignados.join(", ") + ") y el registro local está como 'enviado', pero no se pudo completar alguna actualización visual (alerta, sesión o formulario).\n\nNo vuelvas a enviar este registro. Usa 'Ver registros guardados' para comprobarlo.");
      } catch (errAvisoInterfaz) {
        console.error('No se pudo mostrar el aviso de error de interfaz:', errAvisoInterfaz);
      }
    }

  } catch (err) {
    console.error("Error al enviar:", err);
    if (envioConfirmadoPorServidor) {
      // El servidor confirmó el envío. Un error posterior NUNCA debe degradar
      // el estado local a "pendiente_confirmacion" ni afirmar que no se envió.
      if (registroLocalMarcadoEnviado) {
        console.error("Error posterior a la confirmación con el registro local ya en 'enviado':", err);
        try {
          alert("⚠️ El servidor confirmó el envío y el registro local está como 'enviado', pero se produjo un error posterior.\n\nNo vuelvas a enviar este registro. Usa 'Ver registros guardados' para comprobarlo.");
        } catch (errAviso) {
          console.error("No se pudo mostrar el aviso de error posterior a la confirmación:", errAviso);
        }
      } else {
        console.error("El servidor confirmó el envío, pero no se completó la actualización local a 'enviado':", err);
        try {
          alert("⚠️ El servidor confirmó el envío, pero no se pudo actualizar el registro local a 'enviado'.\n\nNo vuelvas a enviar automáticamente. Usa 'Comprobar si ya fue registrada' desde 'Ver registros guardados' para reconciliarlo.");
        } catch (errAviso) {
          console.error("No se pudo mostrar el aviso de discrepancia:", errAviso);
        }
      }
    } else if (err && err.baseLocalNoDisponible && !registroPendienteId) {
      // 1. La base local no está disponible y todavía no se ha ejecutado el envío.
      if (registroLocalId) {
        alert(mensajeReenvioNoActualizado);
      } else {
        alert("⚠️ No se ha podido guardar el registro en el dispositivo y no se ha enviado.\n\nCopia los datos del formulario antes de cerrar o recargar la aplicación para no perderlos.");
      }
    } else if (registroPendienteId) {
      // 2. Existe un registro local pendiente: conservar su envio_id e intentar
      //    actualizar el estado sin degradar un 'enviado' fijado en otra pestaña.
      const estadoAplicado = await marcarEstadoSinDegradar("pendiente_confirmacion");
      if (estadoAplicado === 'YA_ENVIADO') {
        alert(avisoYaEnviado);
      } else {
        alert("⚠️ Error inesperado. El registro está como 'pendiente de confirmación'.\nUsa 'Comprobar si ya fue registrada' desde 'Ver registros guardados'.");
      }
    } else {
      // 3. No existe un registro local nuevo. Si era un reenvío, el registro
      // anterior puede seguir existiendo aunque su actualización haya fallado.
      if (registroLocalId) {
        alert(mensajeReenvioNoActualizado);
      } else {
        alert("⚠️ El registro no se ha guardado localmente ni se ha enviado.\n\nCopia los datos del formulario antes de cerrar o recargar la aplicación para no perderlos.");
      }
    }
  } finally {
    if (!window.modoSoloLectura) {
      btn.disabled = false;
      btn.textContent = "Enviar";
    }
  }
}

window.enviarDatos = enviarDatos;

// ✅ Función para comprobar si un registro pendiente ya fue registrado en el servidor
async function comprobarSiFueRegistrada(registro) {
  if (!registro.envio_id) {
    alert("Este registro no tiene envio_id (registro histórico). No se puede comprobar automáticamente.");
    return;
  }

  // BLOQUEO DE DESARROLLO: la consulta tampoco puede contactar con el backend
  // de producción. Se comprueba antes de construir la URL y de ejecutar fetch.
  if (!BACKEND_ALICANTE_CONFIGURADO) {
    avisarBackendDeshabilitado("consulta");
    return;
  }

  if (!API_ALICANTE_URL) {
    avisarBackendDeshabilitado("consulta (URL de Alicante no configurada)");
    return;
  }

  try {
    const cantidadEsperada = Math.max(1, parseInt(registro.cantidad_animales, 10) || 1);
    const url = API_ALICANTE_URL + "?funcion=consultarPorEnvio&envio_id=" + encodeURIComponent(registro.envio_id);
    const response = await fetch(url, { method: 'GET', mode: 'cors' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const resultado = await response.json();

    // Solo se acepta existe === true o existe === false como respuesta válida.
    // Cualquier otra forma (existe ausente, valor no booleano, result de error)
    // es NO concluyente: se conserva el estado incierto y NO se marca enviado.
    const esRespuestaValida = !!resultado &&
      resultado.result === "success" &&
      (resultado.existe === true || resultado.existe === false);

    if (!esRespuestaValida) {
      const detalleError = (resultado && (resultado.message || resultado.error))
        ? " (" + (resultado.message || resultado.error) + ")"
        : "";
      Swal.fire({
        icon: 'warning',
        title: 'No se pudo confirmar el envío',
        text: 'La respuesta del servidor no es concluyente' + detalleError + '. El registro NO se ha marcado como enviado ni se ha generado ningún envio_id nuevo. Vuelve a intentarlo o consúltalo más tarde.',
        confirmButtonText: 'Aceptar'
      });
      return;
    }

    if (resultado.existe === true) {
      if (!validarNumerosAsignados(resultado.numerosAsignados, cantidadEsperada)) {
        // No se marca como enviado ante una respuesta incoherente. Si el
        // registro seguía como "guardado", pasa a incertidumbre sin
        // sobrescribir otro estado que haya podido fijar otra operación.
        if (registro.estado !== 'enviado') {
          try {
            await actualizarDatosRegistroParaEnvio(registro.id, { estado: 'pendiente_confirmacion' }, registro.envio_id);
          } catch (errEstado) {
            console.error('No se pudo pasar el registro a pendiente_confirmacion:', errEstado);
          }
        }
        Swal.fire({
          icon: 'warning',
          title: 'No se pudo confirmar el envío',
          text: 'El servidor dice que el envío existe, pero los números no son válidos, únicos, consecutivos o no coinciden con la cantidad esperada. El registro NO se ha marcado como enviado.',
          confirmButtonText: 'Aceptar'
        });
        return;
      }
      // Actualizar registro local a "enviado" (sin pisar otro envio_id).
      await cambiarEstadoRegistroCondicional(registro.id, "enviado", registro.envio_id, resultado.numerosAsignados);
      limpiarPunteroEnvioEnCurso(registro.id);
      Swal.fire({
        icon: 'success',
        title: '¡Ya estaba registrada!',
        html: `Número(s) de entrada: <span class="numeros-grandes">${resultado.numerosAsignados.join(", ")}</span>`,
        confirmButtonText: 'Aceptar'
      });
      return;
    }

    // resultado.existe === false: no está registrada. Se conservan el estado y
    // el envio_id actuales (no se genera ningún ID nuevo).
    Swal.fire({
      icon: 'info',
      title: 'Aún no registrada',
      text: 'El servidor aún no tiene este registro. Puedes reenviarlo manualmente con el mismo envio_id. Dale al botón cargar y reenvía de nuevo el registro cargado',
      confirmButtonText: 'Aceptar'
    });
  } catch (err) {
    console.error("Error al comprobar:", err);
    alert("❌ Error al comprobar si fue registrada: " + err.message);
  }
}

window.comprobarSiFueRegistrada = comprobarSiFueRegistrada;

    // Auto-guardado temporal (localStorage) mientras se rellena el formulario
    const form = document.getElementById("formulario");
   // Prevenir envío al pulsar Enter en el campo Teléfono Remitente
const telefonoInput = document.getElementById('telefono_remitente');
if (telefonoInput) {
    telefonoInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault(); // Evita que se envíe el formulario
            this.blur(); // Opcional: quita el foco del campo
        }
    });
}
    form.addEventListener('input', () => {
        // Al cargar un registro en el formulario se dispara 'input' de forma
        // sintética; en ese caso no se sobrescribe el borrador pendiente.
        if (suprimirAutoGuardadoBorrador) return;
        localStorage.setItem('recogidasForm', JSON.stringify(serializarFormulario(form)));
    });

    // Modal de registros
    const modal = document.getElementById('modalRegistros');
    const btnVerRegistros = document.getElementById('btnVerRegistros');
    const btnImportar = document.getElementById('btnImportar');
    const btnCerrarModal = document.getElementById('btnCerrarModal');
    const inputImportarJSON = document.getElementById('importarJSON');
    const btnImportarModal = document.getElementById('btnImportarModal');

    btnVerRegistros.addEventListener('click', async () => {
        modal.style.display = 'block';
        await mostrarRegistros();
    });

    btnCerrarModal.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    btnImportar.addEventListener('click', () => {
        inputImportarJSON.click();
    });

    btnImportarModal.addEventListener('click', () => {
        inputImportarJSON.click();
    });

    inputImportarJSON.addEventListener('change', async (e) => {
        const archivo = e.target.files[0];
        if (!archivo) return;
        if (!confirm('¿Importar este archivo? Esto añadirá los registros a la base de datos local.')) return;
        try {
            await importarRegistrosJSON(archivo);
            alert('✅ Registros importados correctamente');
            if (modal.style.display === 'block') {
                await mostrarRegistros();
            }
            inputImportarJSON.value = '';
        } catch (error) {
            console.error('Error importando:', error);
            alert('❌ Error al importar el archivo. Asegúrate de que sea un JSON válido.');
        }
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });
   // ==================================================
// 🐦 ASISTENTE DE USUARIO - "PÁJARO AYUDANTE" CON SONIDO Y VUELO (versión 2)
// Gestión de Recogidas - Aparece tras 10s de inactividad
// ==================================================
(function() {
    if (document.getElementById('birdAssistant')) return;

    // ====== 1. Sonido suave ======
    function playChime() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 1.2);
        } catch (e) {
            console.warn("Audio no disponible:", e);
        }
    }

    // ====== 2. Nuevo pájaro: SVG de gorrión claro y bonito ======
    const bird = document.createElement('div');
    bird.id = 'birdAssistant';
    bird.innerHTML = `
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style="pointer-events:none;">
            <path d="M12 5C9.2 5 7 7.2 7 10C7 11.5 7.7 12.8 8.8 13.6L7.5 16C7.2 16.5 7.5 17.1 8 17.3C8.2 17.4 8.4 17.4 8.6 17.4C8.9 17.4 9.2 17.3 9.4 17.1L10.7 15.8C11.2 15.9 11.6 16 12 16C14.8 16 17 13.8 17 11C17 8.2 14.8 6 12 6C12 5.7 12 5.3 12 5Z" fill="#27ae60"/>
            <circle cx="10" cy="9" r="1" fill="#fff"/>
            <circle cx="10" cy="9" r="0.5" fill="#000"/>
            <path d="M15 10C15 11.1 14.1 12 13 12C11.9 12 11 11.1 11 10C11 8.9 11.9 8 13 8C14.1 8 15 8.9 15 10Z" fill="#f39c12"/>
        </svg>
    `;
    Object.assign(bird.style, {
        position: 'fixed',
        bottom: '-100px',
        right: '-50px',
        cursor: 'pointer',
        zIndex: '10000',
        background: '#fff',
        borderRadius: '50%',
        padding: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        opacity: '0',
        transition: 'all 0.5s cubic-bezier(0.18, 0.89, 0.32, 1.28)'
    });
    document.body.appendChild(bird);

    // ====== 3. Modal con nombre único ======
    const birdModalContainer = document.createElement('div');
    birdModalContainer.id = 'birdModal';
    birdModalContainer.innerHTML = `
        <div style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10001; opacity:0; pointer-events:none; transition:opacity 0.3s;">
            <div style="background:#fff; border-radius:12px; width:90%; max-width:500px; max-height:80vh; overflow:auto; box-shadow:0 6px 20px rgba(0,0,0,0.3);">
                <div style="background:#2c3e50; color:white; padding:16px; border-radius:12px 12px 0 0; font-weight:bold; display:flex; justify-content:space-between; align-items:center;">
                    🆘 ¿Necesitas ayuda?
                    <button id="closeBirdModal" style="background:none; border:none; color:white; font-size:20px; cursor:pointer;">×</button>
                </div>
                <div id="birdModalContent" style="padding:16px; font-size:15px; line-height:1.5; color:#2c3e50;">
                    <!-- Contenido dinámico -->
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(birdModalContainer);

    // ====== 4. Contenido de ayuda (sin cambios) ======
    const helpSections = {
  direccionPrecisa: `
    <h3>📍 Cómo buscar direcciones correctamente</h3>
    <p>Para que el mapa ubique bien la dirección, <strong>escribe siempre el nombre de la ciudad o pueblo completo</strong>.</p>
    <ul style="padding-left:20px; margin-top:8px;">
      <li>✅ <strong>Bien:</strong> <code>Calle Colon</code></li>
      <li>✅ <strong>Bien:</strong> <code>La Torre, Valencia</code></li>
      <li>✅ <strong>Bien:</strong> <code>Urbanizacion la cañada</code></li>
      <li>✅ <strong>Bien:</strong> <code>Plaza Mayor, Xàtiva</code></li>
      <li>✅ <strong>Bien:</strong> <code>Avenida Elche, Alicante</code></li>
      <li>❌ <strong>Evita:</strong> <code>La cañada</code> → no es un Municipio, el sistema puede que lo busque en otro lugar de España</li>
      <li>❌ <strong>Evita:</strong> <code>La Torre</code> → es una pedanía de Valencia, pero el sistema busca por defecto un Municipio con ese nombre y lo encuentra en otra Provincia</li>
    </ul>
    <p style="margin-top:12px; font-weight:bold; color:#27ae60;">
      💡 Las calles y los Municipios, el sistema los busca por defecto en Valencia.
    </p>
  `,
  coordsFormat: `
    <h3>📍 Formatos admitidos en "Coordenadas dadas o dirección"</h3>
    <p><strong>1. Dirección:</strong> Ej. <code>Ayuntamiento de Valencia ciudad</code></p>
    <p><strong>2. Grados decimales:</strong> Ej. <code>39.47, -0.38</code> (usa punto como separador decimal)</p>
    <p><strong>3. Coordenadas UTM (WGS84):</strong></p>
    <ul style="margin-top:8px; padding-left:20px;">
      <li><code>731053 4413603</code> → asume zona 30N (Comunidad Valenciana)</li>
      <li><code>731053 4413603 30N</code> → zona explícita</li>
      <li>No uses comas decimales ni letras "E/N" sueltas</li>
    </ul>
    <p style="margin-top:12px;"><em>Tras escribir, pulsa ENTER o el botón "Localizar".</em></p>
  `,
  coordsNoMarker: `
    <h3>🔍 No aparece el marcador en el mapa</h3>
    <ul style="padding-left:20px;">
      <li>Asegúrate de pulsar ENTER o "Localizar"</li>
      <li>Verifica que las coordenadas estén en formato válido</li>
      <li>Si usas UTM, deben ser números enteros (ej. 731053 4413603)</li>
      <li>Prueba con una dirección conocida para descartar fallos de red</li>
    </ul>
  `,
  especiesComo: `
    <h3>🦉 Cómo elegir especie común/científica</h3>
    <p>Escribe parte del nombre común (ej. "búho") y selecciona de la lista desplegable.</p>
    <p>El campo científico se rellena automáticamente.</p>
    <p><strong>Importante:</strong> Solo puedes elegir especies de la lista oficial. No se admiten nombres libres.</p>
  `,
  especiesNoAparece: `
    <h3>⚠️ Mi especie no aparece en la lista</h3>
    <ul style="padding-left:20px;">
      <li>Revisa ortografía</li>
      <li>Si sigue sin aparecer, contacta con Alberto ;) para añadirla al fichero <code>especies.json</code></li>
    </ul>
  `,
  numeroEntrada: `
    <h3>🔢 ¿Dónde está mi número de entrada?</h3>
    <p>Se genera <strong>automáticamente tras enviar</strong> el formulario.</p>
    <p>Aparece en la alerta de confirmación y se guarda en "Registros locales".</p>
  `,
  falloEnvio: `
    <h3>📡 ¿Qué pasa si falla el envío?</h3>
    <p>Si no hay conexión a internet:</p>
    <ul style="padding-left:20px;">
      <li>El registro se guarda <strong>localmente en tu dispositivo</strong></li>
      <li>Puedes verlo y reenviarlo desde el botón <strong>"Ver registros guardados"</strong></li>
      <li>¡Nunca se pierde un registro!</li>
    </ul>
  `,
  registrosLocales: `
    <h3>💾 Cómo ver o enviar registros guardados</h3>
    <p>Pulsa el botón <strong>"Ver registros guardados"</strong> (abajo del formulario).</p>
    <p>Allí puedes:</p>
    <ul style="padding-left:20px;">
      <li>Ver detalles completos</li>
      <li>Eliminar registros</li>
      <li>Reenviar a Google Sheets</li>
      <li>Exportar/importar como copia de seguridad (JSON)</li>
    </ul>
  `,
  recuperacionAnilla: `
    <h3>🪶 ¿Cuándo marcar "Recuperación con anilla"?</h3>
    <p>Márcalo <strong>solo si el animal llevaba anilla identificativa</strong>.</p>
    <p>Luego introduce el código de la anilla en el campo que aparece.</p>
    <p>Esta información se añadirá automáticamente a "Observaciones".</p>
  `,
  camposAdicionales: `
    <h3>📋 ¿Qué poner en "Posible causa" o "Remitente"?</h3>
    <p><strong>Posible causa:</strong> Elige una o varias opciones (ej. atropello, electrocución, colisión).</p>
    <p><strong>Remitente:</strong> Quién encontró/comunicó el animal (ciudadano, agente forestal, veterinario, etc.).</p>
    <p><strong>Municipio:</strong> Empieza a escribir para autocompletar (debe coincidir con la lista oficial).</p>
  `
};

    // ====== 5. Funciones de interacción (usando birdModalContainer) ======
    function showHelp(contentKey) {
        document.getElementById('birdModalContent').innerHTML = helpSections[contentKey];
        birdModalContainer.style.display = 'block';
        setTimeout(() => {
            birdModalContainer.children[0].style.opacity = '1';
            birdModalContainer.children[0].style.pointerEvents = 'auto';
        }, 10);
    }

    function closeModal() {
        birdModalContainer.children[0].style.opacity = '0';
        birdModalContainer.children[0].style.pointerEvents = 'none';
        setTimeout(() => birdModalContainer.style.display = 'none', 300);
    }

    document.getElementById('closeBirdModal').addEventListener('click', closeModal);
    birdModalContainer.addEventListener('click', (e) => {
        if (e.target === birdModalContainer) closeModal();
    });

    function showMainMenu() {
  const menu = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      <div onclick="showHelp('direccionPrecisa')" style="cursor:pointer; padding:10px; background:#e8f5e9; border-radius:8px; border:1px solid #27ae60;">
        <strong>📍 Direcciones precisas</strong><br><small>Evita errores de ubicación</small>
      </div>
      <div onclick="showHelp('coordsFormat')" style="cursor:pointer; padding:10px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd;">
        <strong>Coordenadas</strong><br><small>Formatos admitidos</small>
      </div>
      <div onclick="showHelp('coordsNoMarker')" style="cursor:pointer; padding:10px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd;">
        <strong>Coordenadas</strong><br><small>No aparece marcador</small>
      </div>
      <div onclick="showHelp('especiesComo')" style="cursor:pointer; padding:10px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd;">
        <strong>Especies</strong><br><small>Cómo elegir</small>
      </div>
      <div onclick="showHelp('especiesNoAparece')" style="cursor:pointer; padding:10px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd;">
        <strong>Especies</strong><br><small>No aparece mi especie</small>
      </div>
      <div onclick="showHelp('numeroEntrada')" style="cursor:pointer; padding:10px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd;">
        <strong>Número entrada</strong><br><small>¿Dónde está?</small>
      </div>
      <div onclick="showHelp('falloEnvio')" style="cursor:pointer; padding:10px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd;">
        <strong>Fallo de envío</strong><br><small>¿Qué hago?</small>
      </div>
      <div onclick="showHelp('registrosLocales')" style="cursor:pointer; padding:10px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd;">
        <strong>Registros locales</strong><br><small>Ver/reenviar</small>
      </div>
      <div onclick="showHelp('recuperacionAnilla')" style="cursor:pointer; padding:10px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd;">
        <strong>Recuperación</strong><br><small>Anilla</small>
      </div>
      <div onclick="showHelp('camposAdicionales')" style="cursor:pointer; padding:10px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd; grid-column: span 2;">
        <strong>Otros campos</strong><br><small>Posible causa, remitente, etc.</small>
      </div>
    </div>
    <button onclick="closeModal()" style="width:100%; margin-top:16px; padding:8px; background:#7f8c8d; color:white; border:none; border-radius:6px; font-weight:bold;">
      Cerrar
    </button>
  `;
  document.getElementById('birdModalContent').innerHTML = menu;
  birdModalContainer.style.display = 'block';
  setTimeout(() => {
    birdModalContainer.children[0].style.opacity = '1';
    birdModalContainer.children[0].style.pointerEvents = 'auto';
  }, 10);
}

    window.showHelp = showHelp;
    window.closeModal = closeModal;

    bird.addEventListener('click', (e) => {
        e.stopPropagation();
        showMainMenu();
    });

    // ====== 6. Animación con sonido (SOLO UNA VEZ) ======
let sonidoReproducido = false;

function showBird() {
  if (localStorage.getItem('birdDismissed') === 'true') return;
  
  // ✅ Reproducir sonido SOLO LA PRIMERA VEZ
  if (!sonidoReproducido) {
    playChime();
    sonidoReproducido = true;
  }
  
  bird.style.bottom = '-100px';
  bird.style.right = '-50px';
  bird.style.opacity = '0';
  bird.style.display = 'block';
  
  setTimeout(() => {
    bird.style.bottom = '20px';
    bird.style.right = '20px';
    bird.style.opacity = '1';
    
    // Efecto de aleteo sutil
    const svg = bird.querySelector('svg');
    svg.style.transition = 'transform 0.2s';
    
    bird.addEventListener('mouseenter', () => {
      svg.style.transform = 'rotate(-8deg)';
    });
    
    bird.addEventListener('mouseleave', () => {
      svg.style.transform = 'rotate(0deg)';
    });
  }, 50);
}
    // ====== 7. Inactividad ======
    let inactivityTimer;
    const ACTIVATION_DELAY = 10000;
    function resetTimer() {
        clearTimeout(inactivityTimer);
        if (localStorage.getItem('birdDismissed') !== 'true') {
            inactivityTimer = setTimeout(showBird, ACTIVATION_DELAY);
        }
    }
    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, resetTimer, true);
    });
    resetTimer();

    // Ocultar permanentemente con clic derecho
    bird.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm("¿Quieres ocultar este ayudante permanentemente?")) {
            localStorage.setItem('birdDismissed', 'true');
            bird.style.opacity = '0';
            setTimeout(() => bird.style.display = 'none', 500);
        }
    });
})();
});

/* =====  AL ARRANCAR: conservar el borrador; solo se limpia tras guardado seguro  ===== */
(() => {
    // La limpieza del borrador se hace tras un guardado offline correcto o un
    // envío confirmado con registro local en "enviado". No se borra al arrancar
    // para no perder borradores de operaciones bloqueadas o fallidas.
    sessionStorage.removeItem('formEnviadoOK');
})();

// Carga de municipios con normalización de acentos
document.addEventListener("DOMContentLoaded", () => {
    fetch("municipios.json")
        .then(r => r.json())
        .then(d => {
            // Función para quitar acentos (igual que en especies)
            function quitarAcentos(str) {
                return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            }
            
            window.municipiosData = d.municipios; // Guardar datos para búsqueda
            const list = document.getElementById("municipios-list");
            
            // Rellenar datalist con ambas versiones (con y sin acento)
            d.municipios.forEach(municipio => {
                const sinAcento = quitarAcentos(municipio);
                
                // Opción sin acento (para que aparezca al buscar)
                const opt1 = document.createElement("option");
                opt1.value = sinAcento;
                list.appendChild(opt1);
                
                // Opción con acento (para insertar el valor correcto)
                const opt2 = document.createElement("option");
                opt2.value = municipio;
                list.appendChild(opt2);
            });
            
            // Autocorrección al escribir
            const municipioInput = document.getElementById("municipio");
            municipioInput.addEventListener("input", () => {
                const valorEscrito = municipioInput.value.trim();
                if (!valorEscrito) return;
                
                const encontrado = window.municipiosData.find(m => 
                    quitarAcentos(m) === quitarAcentos(valorEscrito)
                );
                
                if (encontrado) {
                    municipioInput.value = encontrado; // Asigna versión con acento correcto
                }
            });
        })
        .catch(console.error);
});
// ✅ Carga del mapeo castellano-valenciano (AÑADIR ESTO)
document.addEventListener("DOMContentLoaded", () => {
    fetch("mapeo_municipios.json")
        .then(r => r.json())
        .then(d => {
            window.mapeoMunicipios = d;
        })
        .catch(console.error);
});
// ---------- Carga de especies + autocompletado INTELIGENTE ----------
document.addEventListener("DOMContentLoaded", () => {
    const comInput  = document.getElementById("especie_comun");
    const cienInput = document.getElementById("especie_cientifico");
    let especiesData = [];

    // Función para quitar acentos
    function quitarAcentos(str) {
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    }

    fetch("especies.json")
        .then(r => r.json())
        .then(d => {
            especiesData = d;
            const comList = document.getElementById("especies-comun-list");
            const cienList = document.getElementById("especies-cientifico-list");

            // Rellenar datalists: versión SIN acento para buscar y CON acento para insertar
            d.forEach(e => {
                const comSin  = quitarAcentos(e.nombreComun);
                const cienSin = quitarAcentos(e.nombreCientifico);

                const opt1 = document.createElement("option");
                opt1.value = comSin;          // sin acento → aparece al buscar
                comList.appendChild(opt1);

                const opt1b = document.createElement("option");
                opt1b.value = e.nombreComun;  // con acento → se inserta al seleccionar
                comList.appendChild(opt1b);

                const opt2 = document.createElement("option");
                opt2.value = cienSin;
                cienList.appendChild(opt2);

                const opt2b = document.createElement("option");
                opt2b.value = e.nombreCientifico;
                cienList.appendChild(opt2b);
            });

            // Autocompletado cruzado (común → científico)
            comInput.addEventListener("input", () => {
                const found = especiesData.find(x => quitarAcentos(x.nombreComun) === quitarAcentos(comInput.value.trim()));
                if (found) {
                    comInput.value  = found.nombreComun;   // muestra versión con tilde
                    cienInput.value = found.nombreCientifico;
                }
            });

            cienInput.addEventListener("input", () => {
                const found = especiesData.find(x => quitarAcentos(x.nombreCientifico) === quitarAcentos(cienInput.value.trim()));
                if (found) {
                    cienInput.value = found.nombreCientifico;
                    comInput.value  = found.nombreComun;
                }
            });
        })
        .catch(console.error);
});

// Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(() => console.log('Service Worker registrado correctamente'))
        .catch(error => console.error('Error al registrar el Service Worker:', error));
}

// Botón cerrar aplicación
const btnCerrar = document.getElementById('btnCerrar');
if (btnCerrar) {
    btnCerrar.addEventListener('click', () => {
        window.close();
        if (!window.closed) {
            alert('Puedes cerrar esta pestaña desde el navegador.');
        }
    });
}

// Fecha actual por defecto
const hoy = getFechaLocalISO();
document.getElementById('fecha').value = hoy;

// La fecha se establece al abrir un formulario nuevo (arriba) y al
// restablecerlo tras un envío correcto. No se actualiza al recuperar foco
// o visibilidad: eso sobrescribía la fecha elegida manualmente y podía
// cambiar el año usado para la numeración anual.





