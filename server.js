require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Aktuelles Bildmodell (Stand 2026), vormals "Nano Banana" -> jetzt "Nano Banana 2".
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-image';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// Foto-Uploads im Arbeitsspeicher halten (kein Zwischenspeichern auf Platte nötig)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function buildPrompt(currentAge, targetAge) {
  const direction = Number(targetAge) >= Number(currentAge) ? 'älter' : 'jünger';
  return [
    `Bearbeite dieses echte Foto einer Person für eine professionelle Alters-Simulation an einem Messestand.`,
    `Die Person ist aktuell etwa ${currentAge} Jahre alt und soll so aussehen, als wäre sie ${targetAge} Jahre alt (also deutlich ${direction}).`,
    `Wichtig: Behalte exakt dieselbe Identität, Gesichtsstruktur, Kopfform, Blickrichtung, Frisurstil (nur Farbe/Fülle altersgerecht anpassen), Kleidung, Hintergrund, Bildausschnitt, Beleuchtung und Bildqualität bei.`,
    `Verändere ausschliesslich altersbedingte Merkmale realistisch und fotorealistisch (z.B. Hautstruktur, Falten, Ergrauen der Haare, Gesichtskontur), passend zum Zielalter ${targetAge}.`,
    `Füge keinerlei Text, Wasserzeichen, Rahmen oder grafische Elemente in das Bild ein. Gib ausschliesslich das bearbeitete Foto zurück, keine Textantwort.`
  ].join(' ');
}

// Extrahiert das generierte Bild robust aus der Gemini-Interactions-API-Antwort.
// Deckt die dokumentierte Struktur ab (output_image / steps[].content[]) plus
// Fallbacks, falls Google das Antwortformat geringfügig ändert.
function extractImageFromResponse(json) {
  if (json?.output_image?.data) {
    return { data: json.output_image.data, mimeType: json.output_image.mime_type };
  }
  const steps = json?.steps || [];
  for (const step of steps) {
    const content = step?.content || [];
    const imagePart = content.find(c => c.type === 'image' && c.data);
    if (imagePart) {
      return { data: imagePart.data, mimeType: imagePart.mime_type };
    }
  }
  // Fallback auf älteres generateContent-Format (falls Key auf altes Modell zeigt)
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const legacyPart = parts.find(p => p.inline_data || p.inlineData);
  const legacyInline = legacyPart?.inline_data || legacyPart?.inlineData;
  if (legacyInline?.data) {
    return { data: legacyInline.data, mimeType: legacyInline.mime_type || legacyInline.mimeType };
  }
  return null;
}

app.post('/api/age', upload.single('photo'), async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server ist nicht konfiguriert: GEMINI_API_KEY fehlt.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Kein Foto erhalten.' });
    }
    const { currentAge, targetAge } = req.body;
    if (!currentAge || !targetAge) {
      return res.status(400).json({ error: 'Aktuelles Alter und Wunschalter werden benötigt.' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';
    const prompt = buildPrompt(currentAge, targetAge);

    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: [
          { type: 'text', text: prompt },
          { type: 'image', mime_type: mimeType, data: base64Image }
        ],
        response_format: { type: 'image', mime_type: 'image/jpeg' }
      })
    });

    const geminiJson = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('Gemini API Fehler:', JSON.stringify(geminiJson));
      const message = geminiJson?.error?.message || 'Unbekannter Fehler beim Bilddienst.';
      return res.status(502).json({ error: `KI-Bilddienst hat einen Fehler gemeldet: ${message}` });
    }

    const inline = extractImageFromResponse(geminiJson);

    if (!inline?.data) {
      console.error('Keine Bilddaten in Gemini-Antwort:', JSON.stringify(geminiJson).slice(0, 2000));
      return res.status(502).json({
        error: 'Der KI-Dienst hat kein Bild zurückgegeben (evtl. wurde kein Gesicht erkannt oder die Anfrage wurde blockiert). Bitte anderes Foto versuchen.'
      });
    }

    res.json({
      imageBase64: inline.data,
      mimeType: inline.mimeType || 'image/jpeg'
    });
  } catch (err) {
    console.error('Serverfehler in /api/age:', err);
    res.status(500).json({ error: 'Unerwarteter Serverfehler. Bitte erneut versuchen.' });
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true, configured: !!GEMINI_API_KEY }));

app.listen(PORT, () => {
  console.log(`Age-Booth-App läuft auf Port ${PORT}`);
  if (!GEMINI_API_KEY) {
    console.warn('WARNUNG: GEMINI_API_KEY ist nicht gesetzt. /api/age wird fehlschlagen, bis der Key in .env eingetragen ist.');
  }
});
