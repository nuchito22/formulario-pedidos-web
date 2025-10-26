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

function init() {
  attachLiveValidation();
  initConditionalLogic();

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
