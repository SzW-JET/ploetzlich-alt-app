(() => {
  'use strict';

  // ---------- Elemente ----------
  const stepCamera = document.getElementById('step-camera');
  const stepAge = document.getElementById('step-age');
  const stepLoading = document.getElementById('step-loading');
  const stepResult = document.getElementById('step-result');

  const video = document.getElementById('video');
  const captureCanvas = document.getElementById('captureCanvas');
  const photoPreview = document.getElementById('photoPreview');
  const switchCameraBtn = document.getElementById('switchCameraBtn');
  const cameraError = document.getElementById('cameraError');

  const shootBtn = document.getElementById('shootBtn');
  const fileInput = document.getElementById('fileInput');
  const retakeRow = document.getElementById('retakeRow');
  const retakeBtn = document.getElementById('retakeBtn');
  const usePhotoBtn = document.getElementById('usePhotoBtn');

  const thumbPreview = document.getElementById('thumbPreview');
  const currentAgeInput = document.getElementById('currentAge');
  const targetAgeInput = document.getElementById('targetAge');
  const showAgeLabel = document.getElementById('showAgeLabel');
  const backToCameraBtn = document.getElementById('backToCameraBtn');
  const generateBtn = document.getElementById('generateBtn');

  const resultCanvas = document.getElementById('resultCanvas');
  const resultError = document.getElementById('resultError');
  const downloadBtn = document.getElementById('downloadBtn');
  const shareBtn = document.getElementById('shareBtn');
  const restartBtn = document.getElementById('restartBtn');

  // ---------- Status ----------
  let mediaStream = null;
  let facingMode = 'environment'; // Rückkamera als Standard (wir fotografieren andere Personen)
  let capturedBlob = null;   // aktuelles Foto als Blob (für Upload)
  let capturedDataUrl = null; // aktuelles Foto als DataURL (für Anzeige/Komposition)
  let lastPrintBlob = null;  // fertiges Ergebnisbild als Blob (für Download/Teilen)

  // ---------- Kamera ----------
  async function startCamera() {
    stopCamera();
    cameraError.hidden = true;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1080 }, height: { ideal: 1440 } },
        audio: false
      });
      video.srcObject = mediaStream;
      video.hidden = false;
      photoPreview.hidden = true;
      switchCameraBtn.hidden = false;
    } catch (err) {
      console.warn('Kamera nicht verfügbar:', err);
      switchCameraBtn.hidden = true;
      cameraError.hidden = false;
      cameraError.textContent = 'Kamera konnte nicht gestartet werden. Bitte Kamerazugriff erlauben oder ein Foto hochladen.';
    }
  }

  function stopCamera() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  }

  switchCameraBtn.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    startCamera();
  });

  shootBtn.addEventListener('click', () => {
    if (!mediaStream) {
      cameraError.hidden = false;
      cameraError.textContent = 'Keine aktive Kamera. Bitte Zugriff erlauben oder Foto hochladen.';
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    captureCanvas.width = w;
    captureCanvas.height = h;
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    captureCanvas.toBlob(blob => {
      capturedBlob = blob;
      capturedDataUrl = captureCanvas.toDataURL('image/jpeg', 0.92);
      showCapturedPhoto();
    }, 'image/jpeg', 0.92);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    capturedBlob = file;
    const reader = new FileReader();
    reader.onload = () => {
      capturedDataUrl = reader.result;
      showCapturedPhoto();
    };
    reader.readAsDataURL(file);
  });

  function showCapturedPhoto() {
    video.hidden = true;
    switchCameraBtn.hidden = true;
    photoPreview.src = capturedDataUrl;
    photoPreview.hidden = false;
    retakeRow.hidden = false;
  }

  retakeBtn.addEventListener('click', () => {
    capturedBlob = null;
    capturedDataUrl = null;
    retakeRow.hidden = true;
    photoPreview.hidden = true;
    fileInput.value = '';
    startCamera();
  });

  usePhotoBtn.addEventListener('click', () => {
    if (!capturedDataUrl) return;
    thumbPreview.src = capturedDataUrl;
    stopCamera();
    goToStep(stepAge);
  });

  backToCameraBtn.addEventListener('click', () => {
    goToStep(stepCamera);
    startCamera();
  });

  // ---------- Schritt-Navigation ----------
  function goToStep(step) {
    [stepCamera, stepAge, stepLoading, stepResult].forEach(s => { s.hidden = true; });
    step.hidden = false;
  }

  // ---------- Generieren ----------
  generateBtn.addEventListener('click', async () => {
    const currentAge = parseInt(currentAgeInput.value, 10);
    const targetAge = parseInt(targetAgeInput.value, 10);

    if (!currentAge || currentAge < 1 || currentAge > 110) {
      alert('Bitte ein gültiges aktuelles Alter eingeben (1–110).');
      return;
    }
    if (!targetAge || targetAge < 1 || targetAge > 110) {
      alert('Bitte ein gültiges Wunschalter eingeben (1–110).');
      return;
    }
    if (!capturedBlob) {
      alert('Es liegt kein Foto vor. Bitte zuerst ein Foto aufnehmen.');
      goToStep(stepCamera);
      return;
    }

    goToStep(stepLoading);
    resultError.hidden = true;

    try {
      const formData = new FormData();
      formData.append('photo', capturedBlob, 'photo.jpg');
      formData.append('currentAge', String(currentAge));
      formData.append('targetAge', String(targetAge));

      const res = await fetch('/api/age', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Unbekannter Fehler bei der Altersgenerierung.');
      }

      const agedDataUrl = `data:${data.mimeType};base64,${data.imageBase64}`;
      await composeResult({
        originalSrc: capturedDataUrl,
        agedSrc: agedDataUrl,
        currentAge,
        targetAge,
        showLabels: showAgeLabel.checked
      });

      goToStep(stepResult);
    } catch (err) {
      console.error(err);
      goToStep(stepResult);
      resultCanvas.getContext('2d') && resultCanvas.getContext('2d').clearRect(0, 0, resultCanvas.width, resultCanvas.height);
      resultError.hidden = false;
      resultError.textContent = err.message || 'Es ist ein Fehler aufgetreten. Bitte erneut versuchen.';
      downloadBtn.hidden = true;
      shareBtn.hidden = true;
    }
  });

  // ---------- Bildkomposition ----------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Zielformat: 10x15 cm bei 300 dpi (Querformat, druckfertig)
  const PRINT_W = 1772; // 15 cm
  const PRINT_H = 1181; // 10 cm

  function drawCover(ctx, img, x, y, w, h) {
    const imgRatio = img.width / img.height;
    const boxRatio = w / h;
    let sx, sy, sw, sh;
    if (imgRatio > boxRatio) {
      sh = img.height;
      sw = sh * boxRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / boxRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  async function composeResult({ originalSrc, agedSrc, currentAge, targetAge, showLabels }) {
    const [imgBefore, imgAfter] = await Promise.all([loadImage(originalSrc), loadImage(agedSrc)]);

    resultCanvas.width = PRINT_W;
    resultCanvas.height = PRINT_H;
    const ctx = resultCanvas.getContext('2d');

    // Hintergrund (dezentes Grau) – lässt den weissen Rahmen sichtbar hervortreten
    ctx.fillStyle = '#dcdad3';
    ctx.fillRect(0, 0, PRINT_W, PRINT_H);

    const outerMargin = 40;
    const gap = 26;
    const frameW = (PRINT_W - 2 * outerMargin - gap) / 2;
    const frameH = PRINT_H - 2 * outerMargin;

    const borderSide = 22;
    const borderTop = 22;
    const borderBottom = showLabels ? 64 : 22;

    const frames = [
      { x: outerMargin, img: imgBefore, age: currentAge },
      { x: outerMargin + frameW + gap, img: imgAfter, age: targetAge }
    ];

    frames.forEach(({ x, img, age }) => {
      const y = outerMargin;

      // Weisser Fotorahmen mit leichtem Schatten
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, x, y, frameW, frameH, 10);
      ctx.fill();
      ctx.restore();

      // Foto innerhalb des Rahmens (cover-crop)
      const photoX = x + borderSide;
      const photoY = y + borderTop;
      const photoW = frameW - borderSide * 2;
      const photoH = frameH - borderTop - borderBottom;

      ctx.save();
      roundRect(ctx, photoX, photoY, photoW, photoH, 4);
      ctx.clip();
      drawCover(ctx, img, photoX, photoY, photoW, photoH);
      ctx.restore();

      // Altersbeschriftung unten rechts im weissen Rahmenbereich
      if (showLabels) {
        ctx.fillStyle = '#333333';
        ctx.font = '600 30px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const labelY = y + frameH - borderBottom / 2;
        ctx.fillText(`${age} Jahre`, x + frameW - borderSide, labelY);
      }
    });

    // In Blob für Download/Teilen umwandeln
    await new Promise(resolve => {
      resultCanvas.toBlob(blob => {
        lastPrintBlob = blob;
        resolve();
      }, 'image/jpeg', 0.95);
    });

    downloadBtn.hidden = false;
    shareBtn.hidden = !(navigator.canShare && lastPrintBlob && navigator.canShare({ files: [new File([lastPrintBlob], 'ploetzlich-alt.jpg', { type: 'image/jpeg' })] }));
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Speichern / Teilen ----------
  downloadBtn.addEventListener('click', () => {
    if (!lastPrintBlob) return;
    const url = URL.createObjectURL(lastPrintBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ploetzlich-alt-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  shareBtn.addEventListener('click', async () => {
    if (!lastPrintBlob) return;
    try {
      const file = new File([lastPrintBlob], 'ploetzlich-alt.jpg', { type: 'image/jpeg' });
      await navigator.share({ files: [file], title: 'Plötzlich alt' });
    } catch (err) {
      console.warn('Teilen abgebrochen oder fehlgeschlagen:', err);
    }
  });

  restartBtn.addEventListener('click', () => {
    capturedBlob = null;
    capturedDataUrl = null;
    lastPrintBlob = null;
    retakeRow.hidden = true;
    photoPreview.hidden = true;
    fileInput.value = '';
    currentAgeInput.value = 35;
    targetAgeInput.value = 75;
    goToStep(stepCamera);
    startCamera();
  });

  // ---------- Start ----------
  startCamera();
})();
