"use strict";

// Reemplaza este número por el destinatario real (formato internacional sin signos ni espacios).
const WHATSAPP_NUMBER = '5492494205880';

const TANDIL_CENTER = { lat: -37.3217, lng: -59.1333 };
const PLACE_BIAS_RADIUS_METERS = 20000;
const PICKER_ITEM_BLOCK_SIZE = 5;
const PICKER_ITEM_SURCHARGE = 100;
const PICKER_SURCHARGE_THRESHOLD = 10000;

if (typeof window !== 'undefined') {
  console.info('Recuerda restringir la API key de Google Maps a referrers HTTPS del dominio donde publiques este formulario.');
}

let isDomReady = false;
let isGoogleReady = false;
let googleFeaturesInitialized = false;

function initializeGoogleFeatures() {
  if (googleFeaturesInitialized) return;
  if (!isDomReady || !isGoogleReady) return;
  const success = setupAutocomplete();
  if (success) {
    googleFeaturesInitialized = true;
  }
}

if (typeof window !== 'undefined') {
  window.initGoogleServices = function initGoogleServices() {
    isGoogleReady = true;
    initializeGoogleFeatures();
  };
}

const form = document.getElementById('pedidoForm');
const previewBtn = document.getElementById('previewBtn');
const previewSection = document.getElementById('previewSection');
const previewMessage = document.getElementById('previewMessage');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');
const backdrop = document.getElementById('backdrop');
const closeDialogBtn = document.getElementById('closeDialogBtn');
const urgencySelect = document.getElementById('urgencia');
const urgencyIndicator = document.querySelector('[data-urgency-indicator]');
const pricingValue = document.getElementById('pricingValue');
const pricingDetails = document.getElementById('pricingDetails');
const routeMap = document.getElementById('routeMap');
const pickerItemsContainer = document.getElementById('pickerItemsContainer');
const addPickerItemBtn = document.getElementById('addPickerItemBtn');
const pickerListError = document.querySelector('[data-error-for="pickerList"]');

const firestoreAvailable = typeof db !== 'undefined' && Boolean(db);
const serverTimestamp = firestoreAvailable ? firebase.firestore.FieldValue.serverTimestamp : undefined;

const conditionalGroups = Array.from(document.querySelectorAll('[data-conditional]'));

const PHONE_PATTERN = /^(\+?\d[\d\s-]{6,16})$/;

const urgencyMeta = {
  Normal: {
    label: 'Entrega estándar (20 - 30 min)',
  },
  Urgente: {
    label: 'Entrega prioritaria (15 - 20 min)',
  },
  'Muy urgente': {
    label: 'Salida inmediata (0 - 10 min)',
  },
};

const requiredFields = [
  'nombre',
  'telefono',
  'direccionRecogida',
  'direccionEntrega',
  'urgencia',
  'descripcion',
];

let mapsService = null;
let directionsService = null;
let directionsRenderer = null;
let geocoder = null;
let tandilBounds = null;
let map = null;
let pickupPlaceData = null;
let dropoffPlaceData = null;
let lastDistanceMeters = 0;

const pickerItemsState = [];

const pricingParams = {
  PRECIO_BASE: 2250,
  DISTANCIA_BASE_METROS: 800,
  COSTO_INICIAL_KM_EXTRA: 600,
  DEGRADEZ_POR_KM: 20,
  COSTO_MINIMO_KM_EXTRA: 350,
  CARGO_EXTRA_PICKER: 750,
  CARGO_POR_PARADA_ADICIONAL: 400,
};

function showToast(message) {
  toastMessage.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => {
    toast.dataset.visible = 'true';
  });
  setTimeout(() => {
    toast.dataset.visible = 'false';
    setTimeout(() => {
      toast.hidden = true;
    }, 220);
  }, 2600);
}

function updateUrgencyIndicator(value) {
  if (!value) {
    urgencyIndicator.removeAttribute('data-level');
    urgencyIndicator.textContent = 'Selecciona una opción';
    return;
  }
  urgencyIndicator.dataset.level = value;
  const meta = urgencyMeta[value];
  urgencyIndicator.textContent = meta ? meta.label : value;
}

function toggleConditionalFields(triggerName, isActive) {
  conditionalGroups
    .filter((group) => group.dataset.conditional === triggerName)
    .forEach((group) => {
      group.hidden = !isActive;
      if (!isActive) {
        if (triggerName === 'esPicker') {
          resetPickerItems();
        }
        group.querySelectorAll('input, textarea').forEach((field) => {
          field.value = '';
          clearError(field);
        });
      } else if (triggerName === 'esPicker' && pickerItemsState.length === 0) {
        addPickerItem();
      }
    });
}

function clearError(field) {
  field.classList.remove('error');
  const helper = document.querySelector(`[data-error-for="${field.id}"]`);
  if (helper) helper.textContent = '';
}

function setError(field, message) {
  field.classList.add('error');
  const helper = document.querySelector(`[data-error-for="${field.id}"]`);
  if (helper) helper.textContent = message;
}

function resetPickerItems() {
  pickerItemsState.length = 0;
  renderPickerItems();
  if (pickerListError) {
    pickerListError.textContent = '';
  }
}

function renderPickerItems() {
  if (!pickerItemsContainer) return;
  pickerItemsContainer.innerHTML = '';

  pickerItemsState.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'picker-item-row';
    row.dataset.index = String(index);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Producto';
    nameInput.value = item.name;
    nameInput.required = true;
    nameInput.addEventListener('input', (event) => {
      pickerItemsState[index].name = event.target.value;
      validatePickerItems();
    });

    const quantityInput = document.createElement('input');
    quantityInput.type = 'number';
    quantityInput.min = '1';
    quantityInput.value = String(item.quantity);
    quantityInput.addEventListener('input', (event) => {
      const parsed = Math.max(1, parseInt(event.target.value || '1', 10));
      pickerItemsState[index].quantity = parsed;
      event.target.value = String(parsed);
      validatePickerItems();
      recalculatePricing();
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'picker-item-remove';
    removeButton.innerHTML = '&times;';
    removeButton.setAttribute('aria-label', 'Eliminar ítem');
    removeButton.addEventListener('click', () => {
      pickerItemsState.splice(index, 1);
      renderPickerItems();
      validatePickerItems();
      recalculatePricing();
    });

    nameInput.addEventListener('blur', validatePickerItems);

    row.append(nameInput, quantityInput, removeButton);
    pickerItemsContainer.appendChild(row);
  });

  recalculatePricing();
}

function addPickerItem(initial = { name: '', quantity: 1 }) {
  pickerItemsState.push({
    name: initial.name ?? '',
    quantity: Math.max(1, parseInt(initial.quantity ?? 1, 10)),
  });
  renderPickerItems();
  validatePickerItems();
}

function getPickerItems() {
  return pickerItemsState
    .map((item) => ({
      name: item.name.trim(),
      quantity: Math.max(1, Number(item.quantity) || 1),
    }))
    .filter((item) => item.name.length > 0);
}

function validatePickerItems() {
  if (!pickerListError) return true;

  if (!form.esPicker.checked) {
    pickerListError.textContent = '';
    return true;
  }

  const items = getPickerItems();
  if (!items.length) {
    pickerListError.textContent = 'Añadí al menos un producto para el servicio picker.';
    return false;
  }

  const hasInvalid = items.some((item) => item.name.length < 2 || item.quantity < 1);
  if (hasInvalid) {
    pickerListError.textContent = 'Completá nombre y cantidad (mínimo 1 unidad) en cada ítem.';
    return false;
  }

  pickerListError.textContent = '';
  return true;
}

function validateField(field) {
  const value = field.value.trim();
  clearError(field);

  if (requiredFields.includes(field.id) && !value) {
    setError(field, 'Este campo es obligatorio');
    return false;
  }

  if (field.id === 'detallesTamano' && form.esGrande.checked && value.length < 3) {
    setError(field, 'Detallá medidas o peso aproximado');
    return false;
  }

  if (
    (field.id === 'horarioRetiro' || field.id === 'horarioEntrega') &&
    form.usarHorarios.checked &&
    value.length < 3
  ) {
    setError(field, 'Indicá un rango horario claro');
    return false;
  }

  if (field.id === 'telefono' && value && !PHONE_PATTERN.test(value)) {
    setError(field, 'Ingresa un teléfono válido (solo números, espacios o guiones)');
    return false;
  }

  if (field.id === 'descripcion' && value.length < 3) {
    setError(field, 'Describe el paquete en al menos 3 caracteres');
    return false;
  }

  if (field.tagName === 'SELECT' && !value) {
    setError(field, 'Selecciona una opción');
    return false;
  }

  return true;
}

function validateForm() {
  const inputs = Array.from(form.elements).filter((el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  let valid = true;

  inputs.forEach((field) => {
    if (field.closest('.conditional')?.hidden) return;
    if (!validateField(field)) valid = false;
  });

  if (!validatePickerItems()) {
    valid = false;
  }

  return valid;
}

function normalize(value, fallback = 'No especificado') {
  return value && value.trim() ? value.trim() : fallback;
}

function extractFormData() {
  const data = new FormData(form);
  const esGrande = data.get('esGrande') === 'on';
  const usarHorarios = data.get('usarHorarios') === 'on';
  const esPicker = data.get('esPicker') === 'on';
  const numeroParadas = Math.max(1, parseInt(data.get('numeroParadas') || '1', 10));
  const pickerItems = esPicker ? getPickerItems() : [];

  const direccionRecogidaInput = data.get('direccionRecogida')?.trim() ?? '';
  const direccionEntregaInput = data.get('direccionEntrega')?.trim() ?? '';

  const resolvedPickup = pickupPlaceData?.address || direccionRecogidaInput;
  const resolvedDropoff = dropoffPlaceData?.address || direccionEntregaInput;

  const fare = calculateFare(lastDistanceMeters || 0, {
    esPicker,
    numeroParadas,
    pickerItems,
  });

  return {
    nombre: data.get('nombre')?.trim() ?? '',
    telefono: data.get('telefono')?.trim() ?? '',
    direccionRecogida: resolvedPickup,
    direccionEntrega: resolvedDropoff,
    urgencia: data.get('urgencia') ?? '',
    descripcion: data.get('descripcion')?.trim() ?? '',
    esGrande,
    detallesTamano: normalize(data.get('detallesTamano'), esGrande ? 'No detallado' : 'No aplica'),
    usarHorarios,
    horarioRetiro: normalize(data.get('horarioRetiro')),
    horarioEntrega: normalize(data.get('horarioEntrega')),
    indicaciones: normalize(data.get('indicaciones'), 'Sin indicaciones'),
    esPicker,
    numeroParadas,
    pickerItems,
    costoEstimado: fare.total,
    costoEstimadoDetalle: fare,
    distanciaMetros: lastDistanceMeters,
    resolvedLocations: {
      pickup: pickupPlaceData?.location ? {
        lat: pickupPlaceData.location.lat(),
        lng: pickupPlaceData.location.lng(),
      } : null,
      dropoff: dropoffPlaceData?.location ? {
        lat: dropoffPlaceData.location.lat(),
        lng: dropoffPlaceData.location.lng(),
      } : null,
    },
  };
}

function formatWhatsAppMessage(order) {
  const urgencyEmoji = {
    Normal: '🟢',
    Urgente: '🟠',
    'Muy urgente': '🔴',
  };

  const grandeInfo = order.esGrande ? `Sí (${order.detallesTamano})` : 'No';
  const horarios = order.usarHorarios
    ? `🕘 Retiro: ${order.horarioRetiro}\n🕔 Entrega: ${order.horarioEntrega}`
    : 'Sin horario definido';

  const pickerLines = [];
  if (order.esPicker) {
    pickerLines.push('🛒 *Servicio picker*');
    if (order.pickerItems?.length) {
      pickerLines.push(
        order.pickerItems
          .map((item) => `• ${item.quantity}x ${item.name}`)
          .join('\n')
      );
    } else {
      pickerLines.push('• Productos: sin detallar');
    }

    if (order.costoEstimadoDetalle?.pickerItemsSurcharge) {
      pickerLines.push(`• Cargo extra ítems: ${formatCurrency(order.costoEstimadoDetalle.pickerItemsSurcharge)}`);
    } else if (order.costoEstimadoDetalle?.waivedItemSurcharge) {
      pickerLines.push('• Extra ítems bonificado por superar $10.000');
    }
  }

  const timestamp = new Date().toLocaleString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return [
    '🚚 *Nuevo pedido de mandado*',
    '',
    '👤 *Cliente*',
    `• Nombre: ${order.nombre}`,
    `• Teléfono: ${order.telefono}`,
    '',
    '📍 *Direcciones*',
    `• Retiro: ${order.direccionRecogida}`,
    `• Entrega: ${order.direccionEntrega}`,
    '',
    '📦 *Detalles del paquete*',
    `• Urgencia: ${urgencyEmoji[order.urgencia] ?? '⚪'} ${order.urgencia}`,
    `• Descripción: ${order.descripcion}`,
    `• ¿Voluminoso?: ${grandeInfo}`,
    '',
    '⏱️ *Horarios*',
    horarios,
    '',
    '💬 *Indicaciones*',
    order.indicaciones,
    '',
    ...pickerLines,
    pickerLines.length ? '' : null,
    '💰 *Costo estimado*',
  `• Aproximado: ${formatCurrency(order.costoEstimado)}${order.distanciaMetros ? ` (${(order.distanciaMetros / 1000).toFixed(2)} km)` : ''}`,
  order.costoEstimadoDetalle?.pickerBase ? `• Servicio picker: ${formatCurrency(order.costoEstimadoDetalle.pickerBase)}` : null,
  order.costoEstimadoDetalle?.pickerItemsSurcharge
    ? `• Extra ítems (${order.costoEstimadoDetalle.pickerItemCount}): ${formatCurrency(order.costoEstimadoDetalle.pickerItemsSurcharge)}`
    : null,
  order.costoEstimadoDetalle?.waivedItemSurcharge ? '• Extra ítems bonificado por total > $10.000' : null,
  order.costoEstimadoDetalle?.stopsExtra ? `• Paradas adicionales: ${formatCurrency(order.costoEstimadoDetalle.stopsExtra)}` : null,
  '',
    `🗓️ *Solicitud registrada:* ${timestamp}`,
  ].filter(Boolean).join('\n');
}

function buildWhatsAppLink(message) {
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encoded}`;
}

function openWhatsApp(message) {
  const link = buildWhatsAppLink(message);
  window.open(link, '_blank', 'noopener');
  backdrop.hidden = false;
}

function renderPreview(order) {
  const message = formatWhatsAppMessage(order);
  previewMessage.textContent = message;
  previewSection.hidden = false;
  return message;
}

function handlePreview() {
  if (!validateForm()) {
    showToast('Revisá los campos resaltados antes de previsualizar.');
    return;
  }
  const order = extractFormData();
  renderPreview(order);
  previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function persistOrder(order) {
  if (!firestoreAvailable) {
    return false;
  }
  try {
    await db.collection('pedidos').add({
      ...order,
      createdAt: serverTimestamp ? serverTimestamp() : new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error('Error al guardar pedido en Firestore', error);
    showToast('No pudimos guardar el pedido en la base, pero seguimos con WhatsApp.');
    return false;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validateForm()) {
    showToast('No pudimos preparar el pedido: falta información obligatoria.');
    return;
  }

  const order = extractFormData();
  const message = renderPreview(order);
  await persistOrder(order);
  openWhatsApp(message);
  showToast('Pedido listo. Completa el envío desde WhatsApp.');
  form.reset();
  updateUrgencyIndicator('');
  toggleConditionalFields('esGrande', false);
  toggleConditionalFields('usarHorarios', false);
  toggleConditionalFields('esPicker', false);
  pickupPlaceData = null;
  dropoffPlaceData = null;
  lastDistanceMeters = 0;
  clearRoute();
  updatePricingDisplay({
    amount: 0,
    details: 'Selecciona direcciones para ver el cálculo.',
  });
}

function attachLiveValidation() {
  const fields = Array.from(form.elements).filter((el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  fields.forEach((field) => {
    if (field.type === 'checkbox') return;
    field.addEventListener('input', () => {
      if (field.closest('.conditional')?.hidden) return;
      validateField(field);
    });
    field.addEventListener('blur', () => validateField(field));
  });
}

function initConditionalLogic() {
  form.esGrande.addEventListener('change', (event) => {
    toggleConditionalFields('esGrande', event.target.checked);
  });

  form.usarHorarios.addEventListener('change', (event) => {
    toggleConditionalFields('usarHorarios', event.target.checked);
  });

  form.esPicker.addEventListener('change', (event) => {
    toggleConditionalFields('esPicker', event.target.checked);
    validatePickerItems();
    recalculatePricing();
  });

  toggleConditionalFields('esGrande', form.esGrande.checked);
  toggleConditionalFields('usarHorarios', form.usarHorarios.checked);
  toggleConditionalFields('esPicker', form.esPicker.checked);
}

function initPricingControls() {
  form.numeroParadas.addEventListener('input', (event) => {
    const value = Math.max(1, parseInt(event.target.value || '1', 10));
    event.target.value = value;
    recalculatePricing();
  });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount);
}

function calculateDistanceMatrix(origin, destination) {
  return new Promise((resolve, reject) => {
    if (!mapsService) {
      reject(new Error('Servicio de Maps no disponible'));
      return;
    }

    mapsService.getDistanceMatrix(
      {
        origins: [origin],
        destinations: [destination],
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.METRIC,
      },
      (response, status) => {
        if (status !== google.maps.DistanceMatrixStatus.OK) {
          reject(new Error(`Error DistanceMatrix: ${status}`));
          return;
        }

        const element = response.rows?.[0]?.elements?.[0];
        if (!element || element.status !== 'OK') {
          reject(new Error('No se pudo calcular la distancia.'));
          return;
        }

        resolve({
          distance: element.distance.value,
          duration: element.duration.value,
          originAddress: response.originAddresses[0],
          destinationAddress: response.destinationAddresses[0],
        });
      }
    );
  });
}

function clearRoute() {
  if (directionsRenderer) {
    directionsRenderer.set('directions', null);
  }
  if (routeMap) {
    routeMap.setAttribute('aria-hidden', 'true');
  }
}

function drawRoute() {
  if (!directionsService || !directionsRenderer || !pickupPlaceData || !dropoffPlaceData) {
    return;
  }

  directionsService.route(
    {
      origin: pickupPlaceData.location,
      destination: dropoffPlaceData.location,
      travelMode: google.maps.TravelMode.DRIVING,
    },
    (response, status) => {
      if (status === 'OK') {
        directionsRenderer.setDirections(response);
        if (routeMap) {
          routeMap.removeAttribute('aria-hidden');
        }
      } else {
        console.error('Error al generar la ruta:', status);
        clearRoute();
      }
    }
  );
}

function calculateFare(distanceMeters, { esPicker, numeroParadas, pickerItems }) {
  const {
    PRECIO_BASE,
    DISTANCIA_BASE_METROS,
    COSTO_INICIAL_KM_EXTRA,
    DEGRADEZ_POR_KM,
    COSTO_MINIMO_KM_EXTRA,
    CARGO_EXTRA_PICKER,
    CARGO_POR_PARADA_ADICIONAL,
  } = pricingParams;

  if (distanceMeters <= 0) {
    return {
      total: 0,
      base: PRECIO_BASE,
      distanceExtra: 0,
      pickerBase: 0,
      pickerItemsSurcharge: 0,
      stopsExtra: 0,
      pickerItemCount: 0,
      waivedItemSurcharge: false,
    };
  }

  let distanceCost = PRECIO_BASE;

  if (distanceMeters > DISTANCIA_BASE_METROS) {
    const distanciaAdicionalMetros = distanceMeters - DISTANCIA_BASE_METROS;
    const distanciaAdicionalKm = distanciaAdicionalMetros / 1000;

    let costoAdicionalAcumulado = 0;
    let tarifaActual = COSTO_INICIAL_KM_EXTRA;
    let kmRecorridos = 0;

    const kmCompletos = Math.floor(distanciaAdicionalKm);
    for (let i = 0; i < kmCompletos; i += 1) {
      costoAdicionalAcumulado += tarifaActual;
      tarifaActual = Math.max(COSTO_MINIMO_KM_EXTRA, tarifaActual - DEGRADEZ_POR_KM);
      kmRecorridos += 1;
    }

    const fraccionKm = distanciaAdicionalKm - kmRecorridos;
    costoAdicionalAcumulado += fraccionKm * tarifaActual;

    distanceCost += costoAdicionalAcumulado;
  }

  const pickerBase = esPicker ? CARGO_EXTRA_PICKER : 0;
  const stopsExtra = numeroParadas > 1 ? (numeroParadas - 1) * CARGO_POR_PARADA_ADICIONAL : 0;

  const pickerItemCount = Array.isArray(pickerItems)
    ? pickerItems.reduce((acc, item) => acc + Math.max(1, Number(item.quantity) || 1), 0)
    : 0;

  const subtotalSinItems = distanceCost + pickerBase + stopsExtra;

  let pickerItemsSurcharge = 0;
  let waivedItemSurcharge = false;

  if (esPicker && pickerItemCount > 0) {
    if (subtotalSinItems > PICKER_SURCHARGE_THRESHOLD) {
      waivedItemSurcharge = true;
    } else {
      pickerItemsSurcharge = Math.ceil(pickerItemCount / PICKER_ITEM_BLOCK_SIZE) * PICKER_ITEM_SURCHARGE;
    }
  }

  const total = Math.round(subtotalSinItems + pickerItemsSurcharge);

  return {
    total,
    base: PRECIO_BASE,
    distanceExtra: distanceCost - PRECIO_BASE,
    pickerBase,
    pickerItemsSurcharge,
    stopsExtra,
    pickerItemCount,
    waivedItemSurcharge,
  };
}

function updatePricingDisplay({ amount, details }) {
  pricingValue.textContent = formatCurrency(amount);
  pricingDetails.textContent = details;
}

async function recalculatePricing() {
  if (!pickupPlaceData || !dropoffPlaceData) {
    updatePricingDisplay({
      amount: 0,
      details: 'Selecciona direcciones para ver el cálculo.',
    });
    lastDistanceMeters = 0;
    clearRoute();
    return;
  }

  updatePricingDisplay({ amount: 0, details: 'Calculando distancia...' });
  try {
    const result = await calculateDistanceMatrix(pickupPlaceData.location, dropoffPlaceData.location);
    lastDistanceMeters = result.distance;

    const esPicker = form.esPicker.checked;
    const numeroParadas = Math.max(1, parseInt(form.numeroParadas.value || '1', 10));
    const pickerItems = esPicker ? getPickerItems() : [];
    const fare = calculateFare(result.distance, { esPicker, numeroParadas, pickerItems });

    const detailPieces = [`Distancia estimada: ${(result.distance / 1000).toFixed(2)} km · ${Math.round(result.duration / 60)} min aprox.`];

    if (fare.pickerBase > 0) {
      detailPieces.push(`Servicio picker: ${formatCurrency(fare.pickerBase)}`);
    }
    if (fare.pickerItemsSurcharge > 0) {
      detailPieces.push(`Extra ítems (${fare.pickerItemCount}): ${formatCurrency(fare.pickerItemsSurcharge)}`);
    }
    if (fare.waivedItemSurcharge) {
      detailPieces.push('Extra ítems bonificado por superar $10.000.');
    }
    if (fare.stopsExtra > 0) {
      detailPieces.push(`Paradas adicionales: ${formatCurrency(fare.stopsExtra)}`);
    }

    updatePricingDisplay({
      amount: fare.total,
      details: detailPieces.join(' · '),
    });

    drawRoute();
  } catch (error) {
    console.error(error);
    showToast('No pudimos calcular la distancia. Revísá las direcciones.');
    updatePricingDisplay({
      amount: 0,
      details: 'No se pudo obtener una ruta válida. Revisá las direcciones.',
    });
    clearRoute();
  }
}

function setupAutocomplete() {
  if (!window.google || !google.maps || !google.maps.places?.PlaceAutocompleteElement) {
    console.warn('La API de Google Maps todavía no está lista.');
    return false;
  }

  mapsService = mapsService ?? new google.maps.DistanceMatrixService();
  directionsService = directionsService ?? new google.maps.DirectionsService();
  geocoder = geocoder ?? new google.maps.Geocoder();

  const biasCircle = new google.maps.Circle({ center: TANDIL_CENTER, radius: PLACE_BIAS_RADIUS_METERS });
  tandilBounds = biasCircle.getBounds();

  if (routeMap && !map) {
    map = new google.maps.Map(routeMap, {
      center: TANDIL_CENTER,
      zoom: 13,
      disableDefaultUI: true,
    });
    directionsRenderer = new google.maps.DirectionsRenderer({ map });
    routeMap.setAttribute('aria-hidden', 'true');
  } else if (routeMap && directionsRenderer) {
    directionsRenderer.setMap(map);
  }

  const pickupInput = document.getElementById('direccionRecogida');
  const dropoffInput = document.getElementById('direccionEntrega');
  const pickupAutocomplete = document.getElementById('pickupAutocomplete');
  const dropoffAutocomplete = document.getElementById('dropoffAutocomplete');

  configureAutocompleteElement('pickup', pickupAutocomplete, pickupInput);
  configureAutocompleteElement('dropoff', dropoffAutocomplete, dropoffInput);

  pickupInput.addEventListener('input', () => {
    pickupPlaceData = null;
  });

  dropoffInput.addEventListener('input', () => {
    dropoffPlaceData = null;
  });

  pickupInput.addEventListener('blur', () => {
    if (!pickupInput.value.trim()) {
      pickupPlaceData = null;
      clearRoute();
      recalculatePricing();
    } else if (!pickupPlaceData) {
      geocodeAddress(pickupInput.value, 'pickup');
    }
  });

  dropoffInput.addEventListener('blur', () => {
    if (!dropoffInput.value.trim()) {
      dropoffPlaceData = null;
      clearRoute();
      recalculatePricing();
    } else if (!dropoffPlaceData) {
      geocodeAddress(dropoffInput.value, 'dropoff');
    }
  });

  return true;
}

function configureAutocompleteElement(target, element, input) {
  if (!element || !input) return;

  element.addEventListener('gmp-placeautocomplete-select', async (event) => {
    await handlePlaceSelection(target, input, event);
  });

  element.addEventListener('gmp-placeautocomplete-error', (event) => {
    console.error('Error en Place Autocomplete:', event.detail);
    showToast('Hubo un problema consultando direcciones. Intentá de nuevo.');
  });
}

async function handlePlaceSelection(target, input, event) {
  const placeLike = event.detail?.place ?? event.detail;
  if (!placeLike) {
    geocodeAddress(input.value, target);
    return;
  }

  let place = placeLike;

  if ((!place.geometry || !place.geometry.location) && typeof place.fetchFields === 'function') {
    try {
      await place.fetchFields({ fields: ['formatted_address', 'geometry', 'name'] });
    } catch (error) {
      console.error('No se pudieron obtener detalles del lugar', error);
    }
  }

  if (!place.geometry || !place.geometry.location) {
    geocodeAddress(input.value, target);
    return;
  }

  const formatted = place.formatted_address || ensureTandilContext(place.name || input.value);
  setPlaceData(target, formatted, place.geometry.location);
  input.value = formatted;
  clearError(input);
  recalculatePricing();
}

function ensureTandilContext(address) {
  const trimmed = (address || '').trim();
  if (!trimmed) return '';
  return trimmed.toLowerCase().includes('tandil')
    ? trimmed
    : `${trimmed}, Tandil, Buenos Aires, Argentina`;
}

function setPlaceData(target, address, location) {
  const data = {
    address,
    location,
  };

  if (target === 'pickup') {
    pickupPlaceData = data;
    form.direccionRecogida.value = address;
  } else {
    dropoffPlaceData = data;
    form.direccionEntrega.value = address;
  }
}

function geocodeAddress(rawAddress, target) {
  if (!geocoder) return;

  const request = {
    address: ensureTandilContext(rawAddress),
    componentRestrictions: { country: 'AR' },
  };

  if (tandilBounds) {
    request.bounds = tandilBounds;
  }

  geocoder.geocode(request, (results, status) => {
    if (status === 'OK' && results[0]) {
      setPlaceData(target, results[0].formatted_address, results[0].geometry.location);
      recalculatePricing();
    } else {
      showToast('No pudimos ubicar esa dirección en Tandil. Verificá la calle y número.');
    }
  });
}

function init() {
  isDomReady = true;
  attachLiveValidation();
  initConditionalLogic();
  initPricingControls();

  if (addPickerItemBtn) {
    addPickerItemBtn.addEventListener('click', () => {
      addPickerItem();
      addPickerItemBtn.focus();
    });
  }

  urgencySelect.addEventListener('change', (event) => updateUrgencyIndicator(event.target.value));
  updateUrgencyIndicator(urgencySelect.value);

  previewBtn.addEventListener('click', handlePreview);
  form.addEventListener('submit', handleSubmit);

  closeDialogBtn.addEventListener('click', () => {
    backdrop.hidden = true;
    previewSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      backdrop.hidden = true;
    }
  });

  initializeGoogleFeatures();
}

document.addEventListener('DOMContentLoaded', init);
