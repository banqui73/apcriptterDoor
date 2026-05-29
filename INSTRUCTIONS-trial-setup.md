// ═══════════════════════════════════════════
// TRIAL VIA EMAIL (Firebase Cloud Functions)
// ═══════════════════════════════════════════
// 🔧 REEMPLAZA en tu index.html la sección:
// document.getElementById('btnRequestTrial').addEventListener('click', async()=>{...

document.getElementById('btnRequestTrial').addEventListener('click', async()=>{
  const email = document.getElementById('trialEmail').value.trim();
  const status = document.getElementById('trialStatus');
  
  if(!email||!email.includes('@')){toast('Email inválido','warn');return;}
  if(!fbReady){toast('Firebase requerido','warn');status.textContent='Firebase no disponible';return;}

  // Deshabilitar botón durante el envío
  const btn = document.getElementById('btnRequestTrial');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Enviando...';
  status.textContent = 'Validando y enviando...';
  status.style.color = 'var(--p2)';

  try {
    // Llamar a la Cloud Function
    const requestTrial = firebase.functions().httpsCallable('requestTrial');
    const result = await requestTrial({ email });

    // Éxito
    status.innerHTML = `
      ✅ <strong>¡Código enviado!</strong><br>
      <span style="color:var(--tx3); font-size:12px; margin-top:5px; display:block;">
        Revisa tu email <strong>${result.data.email}</strong>
      </span>
    `;
    status.style.color = 'var(--g)';
    
    // Limpiar campo
    document.getElementById('trialEmail').value = '';
    
    toast('🎁 Código de prueba enviado a tu email','success',5000);
    
  } catch (error) {
    // Error
    const errorMsg = error.message || 'Error desconocido';
    status.textContent = '❌ ' + errorMsg;
    status.style.color = 'var(--r)';
    toast(errorMsg, 'error', 4000);
    console.error('Trial error:', error);
  } finally {
    // Restaurar botón
    btn.disabled = false;
    btn.textContent = originalText;
  }
});
