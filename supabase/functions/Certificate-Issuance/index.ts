// supabase/functions/Certificate-Issuance/index.ts
// Endpoint de emisión de certificados digitales para profesores autorizados.
// Valida el token del solicitante, verifica que el curso pertenezca al profesor,
// comprueba que el estudiante completó el curso, genera el PDF, lo guarda en storage,
// y finalmente firma y registra el certificado con la URL del PDF.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
// --- Configuración de Supabase y llaves ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PRIVATE_KEY_PEM = Deno.env.get("UNIVERSITY_PRIVATE_KEY");
const VERIFICATION_BASE_URL = Deno.env.get("VERIFICATION_BASE_URL") || "http://localhost:5173/verify?id=";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
// --- CORS ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// 🎨 Colores elegantes para certificados
function generateModernColors() {
  const elegantSchemes = [
    {
      primary: rgb(0.0, 0.2, 0.5),
      secondary: rgb(0.1, 0.4, 0.7),
      accent: rgb(0.0, 0.5, 0.8),
      background: rgb(0.98, 0.98, 1.0),
      gold: rgb(0.9, 0.75, 0.2)
    },
    {
      primary: rgb(0.1, 0.2, 0.4),
      secondary: rgb(0.2, 0.4, 0.6),
      accent: rgb(0.0, 0.7, 0.8),
      background: rgb(0.98, 1.0, 1.0),
      gold: rgb(0.9, 0.75, 0.2)
    },
    {
      primary: rgb(0.25, 0.1, 0.5),
      secondary: rgb(0.5, 0.3, 0.8),
      accent: rgb(0.6, 0.4, 0.9),
      background: rgb(0.98, 0.97, 1.0),
      gold: rgb(0.9, 0.75, 0.2)
    }
  ];
  return elegantSchemes[Math.floor(Math.random() * elegantSchemes.length)];
}
// 🔳 Genera QR code usando API externa (compatible con Edge Functions)
async function generateQRCode(uuid) {
  const verificationUrl = `${VERIFICATION_BASE_URL}${uuid}`;
  console.log("[DEBUG] Generating QR for URL:", verificationUrl);
  try {
    // Usar API pública de QR code que funciona en edge functions
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(verificationUrl)}`;
    const response = await fetch(qrApiUrl);
    if (!response.ok) {
      throw new Error(`QR API failed: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    console.error("[DEBUG] QR generation failed:", error);
    // Fallback: crear un QR simple de texto (si falla el API)
    return generateFallbackQR();
  }
}
// 🔄 Fallback QR (cuadrado simple con texto)
function generateFallbackQR() {
  // Crear una imagen PNG simple de 120x120 con texto "QR"
  // Esta es una implementación básica de fallback
  const size = 120;
  const canvas = new Uint8Array(size * size * 4); // RGBA
  // Fondo blanco
  for(let i = 0; i < canvas.length; i += 4){
    canvas[i] = 255; // R
    canvas[i + 1] = 255; // G  
    canvas[i + 2] = 255; // B
    canvas[i + 3] = 255; // A
  }
  // Borde negro simple
  for(let i = 0; i < size; i++){
    for(let j = 0; j < size; j++){
      if (i < 5 || i > size - 5 || j < 5 || j > size - 5) {
        const idx = (i * size + j) * 4;
        canvas[idx] = 0; // R
        canvas[idx + 1] = 0; // G
        canvas[idx + 2] = 0; // B
      }
    }
  }
  return canvas;
}
// 🔷 Fondo y formas decorativas suaves
function drawBackground(page, colors) {
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: colors.background
  });
  page.drawRectangle({
    x: 0,
    y: height - 60,
    width,
    height: 60,
    color: colors.primary,
    opacity: 0.95
  });
  page.drawCircle({
    x: width - 120,
    y: height - 120,
    size: 50,
    color: colors.secondary,
    opacity: 0.1
  });
}
// 🔶 Sello dorado simulado
function drawGoldSeal(page, colors, x, y, font) {
  page.drawCircle({
    x,
    y,
    size: 40,
    color: colors.gold,
    borderColor: rgb(0.7, 0.6, 0.1),
    borderWidth: 2
  });
  page.drawText("CERTIFICADO", {
    x: x - 30,
    y: y - 5,
    size: 7,
    font,
    color: rgb(0.2, 0.2, 0.2)
  });
}
// 🛠️ Función para dividir texto largo en líneas
function splitTextIntoLines(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words){
    if ((currentLine + word).length <= maxCharsPerLine) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}
// 📜 Generador de PDF
async function generateCertificatePDF(certData, readableCode, professorName, uuid) {
  console.log(`📦 Generando PDF para certificado: ${readableCode}`);
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([
    842,
    595
  ]); // A4 horizontal
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const { width, height } = page.getSize();
  const colors = generateModernColors();
  drawBackground(page, colors);
  // Generar e insertar QR code
  try {
    console.log("[DEBUG] Generating QR code...");
    const qrImageBytes = await generateQRCode(uuid);
    console.log("[DEBUG] QR code generated successfully");
    const qrImage = await pdfDoc.embedPng(qrImageBytes);
    const qrSize = 90;
    page.drawImage(qrImage, {
      x: width - qrSize - 50,
      y: 50,
      width: qrSize,
      height: qrSize
    });
    page.drawText("Verificar certificado", {
      x: width - qrSize - 50,
      y: 35,
      size: 8,
      font: italicFont,
      color: rgb(0.4, 0.4, 0.4)
    });
  } catch (qrError) {
    console.error("[DEBUG] QR code failed, continuing without QR:", qrError);
    // Continuar sin QR code - mostrar solo texto de verificación
    page.drawText(`Verificar: ${VERIFICATION_BASE_URL}${uuid}`, {
      x: width - 200,
      y: 50,
      size: 8,
      font: italicFont,
      color: rgb(0.4, 0.4, 0.4)
    });
  }
  const centerX = width / 2;
  // Título centrado
  page.drawText("Certificado de Finalización", {
    x: centerX - 140,
    y: height - 100,
    size: 26,
    font: titleFont,
    color: rgb(1, 1, 1)
  });
  // Texto secundario
  page.drawText("Se certifica que", {
    x: centerX - 60,
    y: height - 150,
    size: 14,
    font: italicFont,
    color: colors.accent
  });
  // Nombre del estudiante
  page.drawText(certData.student_name.toUpperCase(), {
    x: centerX - certData.student_name.length * 9.5,
    y: height - 200,
    size: 28,
    font: titleFont,
    color: colors.primary
  });
  // Curso (con salto de línea si es necesario)
  page.drawText("ha completado exitosamente el curso:", {
    x: centerX - 130,
    y: height - 240,
    size: 12,
    font: regularFont,
    color: rgb(0.3, 0.3, 0.3)
  });
  // Dividir título del curso en líneas si es muy largo
  const courseLines = splitTextIntoLines(certData.course_name, 50);
  const courseStartY = height - 270;
  courseLines.forEach((line, index)=>{
    page.drawText(line, {
      x: centerX - line.length * 6.5,
      y: courseStartY - index * 20,
      size: 18,
      font: titleFont,
      color: colors.accent
    });
  });
  // Fecha (ajustada según número de líneas del curso)
  const dateY = courseStartY - courseLines.length * 20 - 20;
  const formattedDate = new Date(certData.issued_at).toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  page.drawText(`Emitido el ${formattedDate}`, {
    x: centerX - 70,
    y: dateY,
    size: 12,
    font: italicFont,
    color: rgb(0.3, 0.3, 0.3)
  });
  // Skills centradas (ajustadas según posición anterior)
  const skillsY = dateY - 40;
  if (certData.skills?.length) {
    page.drawText("Habilidades Adquiridas:", {
      x: centerX - 75,
      y: skillsY,
      size: 12,
      font: titleFont,
      color: colors.accent
    });
    const skillsText = certData.skills.join(" • ");
    page.drawText(skillsText, {
      x: centerX - skillsText.length * 2.8,
      y: skillsY - 20,
      size: 10,
      font: regularFont,
      color: rgb(0.3, 0.3, 0.3)
    });
  }
  // Firma y sello
  const signatureY = 100;
  // Nombre del profesor centrado
  page.drawText(professorName, {
    x: centerX - professorName.length * 5,
    y: signatureY,
    size: 16,
    font: titleFont,
    color: colors.primary
  });
  // Línea de firma centrada
  page.drawLine({
    start: {
      x: centerX - 120,
      y: signatureY - 5
    },
    end: {
      x: centerX + 120,
      y: signatureY - 5
    },
    thickness: 1,
    color: colors.primary
  });
  page.drawText("Emisor", {
    x: centerX - 15,
    y: signatureY - 20,
    size: 10,
    font: italicFont,
    color: rgb(0.4, 0.4, 0.4)
  });
  // Sello dorado centrado
  drawGoldSeal(page, colors, centerX + 180, signatureY + 15, titleFont);
  // Footer
  page.drawText(`Código: ${readableCode} | UUID: ${uuid.substring(0, 8)}...`, {
    x: centerX - 150,
    y: 30,
    size: 8,
    font: regularFont,
    color: rgb(0.4, 0.4, 0.4)
  });
  const pdfBytes = await pdfDoc.save();
  return new Uint8Array(pdfBytes);
}
serve(handleRequest);
async function handleRequest(req) {
  // Responder inmediatamente preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    // --- Autenticación y perfil del profesor ---
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.split(" ")[1];
    if (!jwt) {
      return new Response("Missing auth", {
        status: 401,
        headers: corsHeaders
      });
    }
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response("Invalid token", {
        status: 401,
        headers: corsHeaders
      });
    }
    // --- Lectura y validación del body ---
    const rawBody = await req.text();
    console.log("[DEBUG] Raw body received:", rawBody);
    let bodyParsed;
    try {
      bodyParsed = JSON.parse(rawBody);
    } catch (parseError) {
      console.error("[DEBUG] JSON parse failed:", parseError.message);
      return new Response("Invalid JSON body", {
        status: 400,
        headers: corsHeaders
      });
    }
    const { student_id, course_id } = bodyParsed;
    console.log("[DEBUG] Parsed body:", {
      student_id,
      course_id
    });
    // --- Validaciones de negocio ---
    // Verifica que el solicitante sea un profesor
    const { data: professorProfile } = await supabase.from("profiles").select("role, first_name, last_name").eq("id", user.id).single();
    if (professorProfile?.role !== "PROFESSOR") {
      return new Response("User is not a professor", {
        status: 403,
        headers: corsHeaders
      });
    }
    // Confirma que el curso pertenece al profesor
    const { data: course, error: courseError } = await supabase.from("courses").select("id, title, professor_id, skills").eq("id", course_id).single();
    if (!course || courseError) {
      return new Response(`Course not found: ${course_id}. Error: ${courseError?.message || "None"}`, {
        status: 404,
        headers: corsHeaders
      });
    }
    if (course.professor_id !== user.id) {
      return new Response("You are not the owner of this course", {
        status: 403,
        headers: corsHeaders
      });
    }
    // Revisa que el estudiante completó el curso
    const { data: enrollment } = await supabase.from("enrollments").select("status").eq("student_id", student_id).eq("course_id", course_id).single();
    if (!enrollment || enrollment.status !== "COMPLETED") {
      return new Response("Student has not completed the course", {
        status: 403,
        headers: corsHeaders
      });
    }
    // Obtiene datos del estudiante para conformar el certificado
    const { data: student } = await supabase.from("profiles").select("first_name, last_name, email").eq("id", student_id).single();
    if (!student) {
      return new Response("Student not found", {
        status: 404,
        headers: corsHeaders
      });
    }
    // --- Preparación de datos a firmar ---
    const issuedDate = new Date().toISOString().split("T")[0];
    const issuedAtForSig = new Date(issuedDate).toISOString();
    const certUuid = crypto.randomUUID();
    const codigo = "CERT-" + crypto.randomUUID().substring(0, 8).toUpperCase();
    const certData = {
      student_id,
      course_id,
      student_name: `${student.first_name} ${student.last_name}`,
      student_email: student.email,
      course_name: course.title,
      skills: course.skills,
      issued_at: issuedAtForSig
    };
    console.log("[DEBUG] certData before signing:", certData);
    // --- Generación del PDF ---
    const professorName = `${professorProfile.first_name} ${professorProfile.last_name}`;
    const pdfBytes = await generateCertificatePDF(certData, codigo, professorName, certUuid);
    console.log("[DEBUG] PDF generated successfully, size:", pdfBytes.length);
    // --- Subida del PDF a Storage ---
    const pdfFilename = `${codigo}-certificado.pdf`;
    const { data: uploadData, error: uploadError } = await supabase.storage.from('PDF_CERTIFICATES').upload(pdfFilename, pdfBytes, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: false
    });
    if (uploadError) {
      console.error("[DEBUG] Storage upload error:", uploadError);
      return new Response(`Upload error: ${uploadError.message}`, {
        status: 500,
        headers: corsHeaders
      });
    }
    // Obtener URL pública del PDF
    const { data: { publicUrl } } = supabase.storage.from('PDF_CERTIFICATES').getPublicUrl(pdfFilename);
    console.log("[DEBUG] PDF uploaded successfully:", publicUrl);
    // --- Firma del certificado (SIN MODIFICAR) ---
    const encoder = new TextEncoder();
    const certBytes = encoder.encode(JSON.stringify(certData));
    const privateKey = await crypto.subtle.importKey("pkcs8", decodePEM(PRIVATE_KEY_PEM), {
      name: "RSA-PSS",
      hash: "SHA-256"
    }, false, [
      "sign"
    ]);
    const signature = await crypto.subtle.sign({
      name: "RSA-PSS",
      saltLength: 32
    }, privateKey, certBytes);
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    console.log("[DEBUG] Signature generated:", signatureBase64.substring(0, 50) + "...");
    // --- Persistencia del certificado con PDF URL ---
    const { data: cert, error: insertError } = await supabase.from("certificates").insert([
      {
        id: certUuid,
        readable_code: codigo,
        student_id,
        course_id,
        digital_signature: signatureBase64,
        issued_date: issuedDate,
        revoked: false,
        expiration_date: null,
        pdf_url: publicUrl // 🎯 NUEVA COLUMNA CON LA URL DEL PDF
      }
    ]).select().single();
    if (insertError) {
      console.error("[DEBUG] DB insert error:", insertError);
      return new Response(`Insert error: ${insertError.message}`, {
        status: 500,
        headers: corsHeaders
      });
    }
    console.log("[DEBUG] Certificate issued successfully with PDF:", cert.pdf_url);
    return new Response(JSON.stringify({
      success: true,
      cert_id: cert.id,
      codigo: cert.readable_code,
      pdf_url: cert.pdf_url,
      certData,
      signature: signatureBase64,
      issued_date: cert.issued_date
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (err) {
    console.error("[issue-certificate]", err);
    return new Response("Internal Server Error", {
      status: 500,
      headers: corsHeaders
    });
  }
}
// Convierte una cadena PEM en ArrayBuffer utilizable por WebCrypto.
function decodePEM(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++){
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
