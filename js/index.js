// ==========================================
// js/index.js - Lógica de Autenticación, PWA y OneSignal (Panita Rides)
// ==========================================

// MODO DESARROLLO / PRODUCCIÓN:
// false = Permite usar y probar desde navegador web en PC
// true  = Bloquea el navegador web y exige que la PWA esté instalada
const BLOQUEO_PWA_ESTRICTO = false;

// Configuración e Inicialización de Supabase para Panita Rides (proyecto: taxi)
const SUPABASE_URL = 'https://pmzrflneqkgcztnexvam.supabase.co';
const SUPABASE_KEY = 'sb_publishable_83f9zZpk1K8vbczw6MNWKQ_x1a30-Ip';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Variables globales para la PWA
let deferredPrompt = null;
const overlay = document.getElementById('pwa-install-overlay');
const appContent = document.getElementById('app-content');
const iosBanner = document.getElementById('ios-installer-banner');

// Elementos del DOM
const btnTabLogin = document.getElementById('btn-tab-login');
const btnTabRegister = document.getElementById('btn-tab-register');
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');
const statusMsg = document.getElementById('status-message');

// Arranque al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
  // 1. Verificamos el estado de la PWA (solo bloquea si BLOQUEO_PWA_ESTRICTO = true)
  checkPWAState();

  // 2. Si el bloqueo estricto está activo y NO está instalada como PWA, detenemos la ejecución
  if (BLOQUEO_PWA_ESTRICTO && !isRunningStandalone()) {
    console.warn("Acceso bloqueado: Panita Rides debe instalarse como PWA para ser utilizada.");
    return;
  }

  // 3. Validación de sesión activa contra Supabase
  supabaseClient.auth.getUser().then(async ({ data: { user }, error }) => {
    if (user && !error) {
      vincularOneSignalUsuario(user.id);
      mostrarMensaje("Sesión activa verificada. Redirigiendo...", "success");
      window.location.href = 'selector.html';
    } else {
      await supabaseClient.auth.signOut();
    }
  }).catch(async (err) => {
    console.warn("Sin conexión o sesión inválida:", err);
    await supabaseClient.auth.signOut();
  });
});

// Vincular el ID del usuario de Supabase con OneSignal para agrupar dispositivos
function vincularOneSignalUsuario(userId) {
  if (!userId) return;
  if (typeof OneSignalDeferred !== 'undefined') {
    OneSignalDeferred.push(async function(OneSignal) {
      try {
        if (OneSignal.User) {
          await OneSignal.login(userId);
          console.log("✅ OneSignal vinculado al External ID:", userId);
        }
      } catch (err) {
        console.warn("Error al vincular OneSignal login:", err);
      }
    });
  }
}

// Control de Tabs (Login / Registro)
if (btnTabLogin && btnTabRegister) {
  btnTabLogin.addEventListener('click', () => {
    btnTabLogin.className = "flex-1 py-2.5 text-xs font-bold rounded-xl bg-white text-orange-600 shadow-sm transition-all duration-200";
    btnTabRegister.className = "flex-1 py-2.5 text-xs font-bold rounded-xl text-slate-500 hover:text-slate-800 transition-all duration-200";
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
    statusMsg.classList.add('hidden');
  });

  btnTabRegister.addEventListener('click', () => {
    btnTabRegister.className = "flex-1 py-2.5 text-xs font-bold rounded-xl bg-white text-orange-600 shadow-sm transition-all duration-200";
    btnTabLogin.className = "flex-1 py-2.5 text-xs font-bold rounded-xl text-slate-500 hover:text-slate-800 transition-all duration-200";
    formRegister.classList.remove('hidden');
    formLogin.classList.add('hidden');
    statusMsg.classList.add('hidden');
  });
}

// Manejo de Inicio de Sesión
if (formLogin) {
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (BLOQUEO_PWA_ESTRICTO && !isRunningStandalone()) {
      checkPWAState();
      return;
    }

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    mostrarMensaje("Iniciando sesión...", "info");

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      mostrarMensaje(error.message, "error");
    } else {
      if (data && data.user) {
        vincularOneSignalUsuario(data.user.id);
      }
      mostrarMensaje("¡Sesión iniciada! Redirigiendo...", "success");
      setTimeout(() => window.location.href = 'selector.html', 800);
    }
  });
}

// Registro + Documento + Celular + Código de Referido + Notificación Push Directa
if (formRegister) {
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (BLOQUEO_PWA_ESTRICTO && !isRunningStandalone()) {
      checkPWAState();
      return;
    }

    const nombre = document.getElementById('reg-name').value;
    const dni = document.getElementById('reg-dni').value;
    const telefono = document.getElementById('reg-telefono').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const inputRef = document.getElementById('reg-referido');
    const referido = inputRef ? inputRef.value.trim().toUpperCase() : '';

    if (!/^9[0-9]{8}$/.test(telefono)) {
      mostrarMensaje("El celular debe tener 9 dígitos empezando por 9 (Ej. 912345678)", "error");
      return;
    }

    mostrarMensaje("Creando cuenta en Panita Rides...", "info");

    // 1. Alta en Supabase con metadatos
    const metadata = { full_name: nombre, dni: dni, telefono: telefono };
    if (referido) {
      metadata.referral_code = referido;
    }

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: metadata
      }
    });

    if (error) {
      mostrarMensaje(error.message, "error");
      return;
    }

    if (referido) {
      localStorage.removeItem('panita_codigo_referido');
    }

    if (data && data.user) {
      vincularOneSignalUsuario(data.user.id);
    }

    mostrarMensaje("¡Registro completado! Redirigiendo...", "success");

    // 2. Disparo de Notificación Push mediante Edge Function (si existe)
    try {
      let subscriptionId = null;
      if (typeof OneSignal !== 'undefined' && OneSignal.User && OneSignal.User.PushSubscription) {
        subscriptionId = OneSignal.User.PushSubscription.id;
      }

      await fetch(`${SUPABASE_URL}/functions/v1/enviar-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: "¡Bienvenido a Panita Rides! 🚗",
          mensaje: `Hola ${nombre}, tu cuenta asociada al celular ${telefono} ha sido registrada correctamente.`,
          subscription_id: subscriptionId
        })
      });
    } catch (pushErr) {
      console.warn("Error al enviar notificación push de bienvenida:", pushErr);
    }

    setTimeout(() => {
      window.location.href = 'selector.html';
    }, 1500);
  });
}

// Funciones de Soporte e Interfaz
function mostrarMensaje(texto, tipo) {
  if (!statusMsg) return;
  statusMsg.textContent = texto;
  statusMsg.classList.remove('hidden', 'bg-red-50', 'text-red-600', 'border-red-200', 'bg-emerald-50', 'text-emerald-600', 'border-emerald-200', 'bg-slate-50', 'text-slate-600', 'border-slate-200');

  if (tipo === 'error') {
    statusMsg.classList.add('bg-red-50', 'text-red-600', 'border-red-200');
  } else if (tipo === 'success') {
    statusMsg.classList.add('bg-emerald-50', 'text-emerald-600', 'border-emerald-200');
  } else {
    statusMsg.classList.add('bg-slate-50', 'text-slate-600', 'border-slate-200');
  }
}

function togglePassword(idInput, idIcon) {
  const input = document.getElementById(idInput);
  const icon = document.getElementById(idIcon);
  if (!input || !icon) return;

  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.05 10.05 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18"/>`;
  } else {
    input.type = 'password';
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />`;
  }
}

// Manejo inteligente de PWA para Android vs iOS
function isRunningStandalone() {
  return (window.matchMedia('(display-mode: standalone)').matches) ||
         (window.navigator.standalone === true) ||
         document.referrer.includes('android-app://');
}

function checkPWAState() {
  // Si el bloqueo estricto está apagado, siempre mostramos la app en web
  if (!BLOQUEO_PWA_ESTRICTO) {
    if (overlay) overlay.classList.add('hidden');
    if (iosBanner) iosBanner.classList.add('hidden');
    if (appContent) appContent.classList.remove('hidden');
    return;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const standalone = isRunningStandalone();

  if (standalone) {
    if (overlay) overlay.classList.add('hidden');
    if (iosBanner) iosBanner.classList.add('hidden');
    if (appContent) appContent.classList.remove('hidden');
  } else {
    // Bloquear uso en navegador web normal hasta que esté instalada
    if (appContent) appContent.classList.add('hidden');

    if (isIOS) {
      if (overlay) overlay.classList.add('hidden');
      if (iosBanner) iosBanner.classList.remove('hidden');
    } else {
      if (overlay) overlay.classList.remove('hidden');
      if (iosBanner) iosBanner.classList.add('hidden');
    }
  }
}

// Captura oficial del evento de instalación nativo de Chrome / Android
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log('✅ Evento beforeinstallprompt capturado y listo para usar.');
});

// Acción del botón de instalación con respaldo de seguridad
document.addEventListener('click', async (e) => {
  const target = e.target.closest('#btn-pwa-install');
  if (!target) return;

  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      console.log('Usuario aceptó instalar la PWA');
      if (overlay) overlay.classList.add('hidden');
      checkPWAState();
    } else {
      console.log('Usuario canceló la instalación');
    }
    deferredPrompt = null;
  } else {
    alert("Para instalar Panita Rides en tu dispositivo, toca los tres puntos (⋮) en la esquina superior derecha de tu navegador y selecciona 'Instalar aplicación' o 'Agregar a la pantalla principal'.");
  }
});

// Registro del Service Worker y Seguridad
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(err => console.error('SW Error:', err));
  });
}

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
  if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) || (e.ctrlKey && e.key === 'U')) {
    e.preventDefault();
  }
});
