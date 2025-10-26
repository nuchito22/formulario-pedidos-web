"use strict";

// Reemplaza este número por el destinatario real (formato internacional sin signos ni espacios).
const WHATSAPP_NUMBER = '549XXXXXXXXXX';

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
let pickupPlace = null;
let dropoffPlace = null;
let lastDistanceMeters = 0;

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
        group.querySelectorAll('input, textarea').forEach((field) => {
          field.value = '';
          clearError(field);
        });
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

  return valid;
}

function normalize(value, fallback = 'No especificado') {
  return value && value.trim() ? value.trim() : fallback;
}

function extractFormData() {
  const data = new FormData(form);
  const esGrande = data.get('esGrande') === 'on';
  const usarHorarios = data.get('usarHorarios') === 'on';

  return {
    nombre: data.get('nombre')?.trim() ?? '',
    telefono: data.get('telefono')?.trim() ?? '',
    direccionRecogida: data.get('direccionRecogida')?.trim() ?? '',
    direccionEntrega: data.get('direccionEntrega')?.trim() ?? '',
    urgencia: data.get('urgencia') ?? '',
    descripcion: data.get('descripcion')?.trim() ?? '',
    esGrande,
    detallesTamano: normalize(data.get('detallesTamano'), esGrande ? 'No detallado' : 'No aplica'),
    usarHorarios,
    horarioRetiro: normalize(data.get('horarioRetiro')),
    horarioEntrega: normalize(data.get('horarioEntrega')),
    indicaciones: normalize(data.get('indicaciones'), 'Sin indicaciones'),
    esPicker: data.get('esPicker') === 'on',
    numeroParadas: Math.max(1, parseInt(data.get('numeroParadas') || '1', 10)),
    costoEstimado: calculateFare(lastDistanceMeters || 0, data.get('esPicker') === 'on', Math.max(1, parseInt(data.get('numeroParadas') || '1', 10))),
    distanciaMetros: lastDistanceMeters,
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
    '💰 *Costo estimado*',
    `• Aproximado: ${formatCurrency(order.costoEstimado)} (${(order.distanciaMetros / 1000).toFixed(2)} km)`,
    '',
    `🗓️ *Solicitud registrada:* ${timestamp}`,
  ].join('\n');
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
  pickupPlace = null;
  dropoffPlace = null;
  lastDistanceMeters = 0;
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

  toggleConditionalFields('esGrande', form.esGrande.checked);
  toggleConditionalFields('usarHorarios', form.usarHorarios.checked);
}

function initPricingControls() {
  form.esPicker.addEventListener('change', () => {
    recalculatePricing();
  });

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

function calculateFare(distanceMeters, esPicker, numeroParadas) {
  const {
    PRECIO_BASE,
    DISTANCIA_BASE_METROS,
    COSTO_INICIAL_KM_EXTRA,
    DEGRADEZ_POR_KM,
    COSTO_MINIMO_KM_EXTRA,
    CARGO_EXTRA_PICKER,
    CARGO_POR_PARADA_ADICIONAL,
  } = pricingParams;

  if (distanceMeters <= 0) return 0;

  let costoBaseDistancia = PRECIO_BASE;

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

    costoBaseDistancia += costoAdicionalAcumulado;
  }

  let costoExtras = 0;

  if (esPicker) {
    costoExtras += CARGO_EXTRA_PICKER;
  }

  if (numeroParadas > 1) {
    costoExtras += (numeroParadas - 1) * CARGO_POR_PARADA_ADICIONAL;
  }

  return Math.round(costoBaseDistancia + costoExtras);
}

function updatePricingDisplay({ amount, details }) {
  pricingValue.textContent = formatCurrency(amount);
  pricingDetails.textContent = details;
}

async function recalculatePricing() {
  if (!pickupPlace || !dropoffPlace) {
    updatePricingDisplay({
      amount: 0,
      details: 'Selecciona direcciones para ver el cálculo.',
    });
    lastDistanceMeters = 0;
    return;
  }

  updatePricingDisplay({ amount: 0, details: 'Calculando distancia...' });
  try {
    const result = await calculateDistanceMatrix(pickupPlace, dropoffPlace);
    lastDistanceMeters = result.distance;

    const esPicker = form.esPicker.checked;
    const numeroParadas = Math.max(1, parseInt(form.numeroParadas.value || '1', 10));
    const fare = calculateFare(result.distance, esPicker, numeroParadas);

    updatePricingDisplay({
      amount: fare,
      details: `Distancia estimada: ${(result.distance / 1000).toFixed(2)} km · ${Math.round(result.duration / 60)} min aprox.`,
    });
  } catch (error) {
    console.error(error);
    showToast('No pudimos calcular la distancia. Revísá las direcciones.');
    updatePricingDisplay({
      amount: 0,
      details: 'No se pudo obtener una ruta válida. Revisá las direcciones.',
    });
  }
}

function setupAutocomplete() {
  if (!window.google || !google.maps) {
    showToast('Google Maps no pudo inicializarse.');
    return;
  }

  mapsService = new google.maps.DistanceMatrixService();
  directionsService = new google.maps.DirectionsService();

  const pickupInput = document.getElementById('direccionRecogida');
  const dropoffInput = document.getElementById('direccionEntrega');

  const pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput, {
    componentRestrictions: { country: ['ar'] },
    fields: ['geometry', 'formatted_address'],
  });

  const dropoffAutocomplete = new google.maps.places.Autocomplete(dropoffInput, {
    componentRestrictions: { country: ['ar'] },
    fields: ['geometry', 'formatted_address'],
  });

  pickupAutocomplete.addListener('place_changed', () => {
    const place = pickupAutocomplete.getPlace();
    if (!place.geometry) {
      showToast('Seleccioná una dirección válida de recogida.');
      return;
    }
    pickupPlace = place.formatted_address;
    recalculatePricing();
  });

  dropoffAutocomplete.addListener('place_changed', () => {
    const place = dropoffAutocomplete.getPlace();
    if (!place.geometry) {
      showToast('Seleccioná una dirección válida de entrega.');
      return;
    }
    dropoffPlace = place.formatted_address;
    recalculatePricing();
  });

  pickupInput.addEventListener('blur', () => {
    if (!pickupInput.value.trim()) {
      pickupPlace = null;
      recalculatePricing();
    }
  });

  dropoffInput.addEventListener('blur', () => {
    if (!dropoffInput.value.trim()) {
      dropoffPlace = null;
      recalculatePricing();
    }
  });
}

function init() {
  attachLiveValidation();
  initConditionalLogic();
  initPricingControls();
  setupAutocomplete();

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
}

document.addEventListener('DOMContentLoaded', init);
