// supabase/functions/Verify-Certificate/index.ts
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PUBLIC_KEY_PEM = Deno.env.get("UNIVERSITY_PUBLIC_KEY");
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const url = new URL(req.url);
    const uuid = url.searchParams.get("id");
    if (!uuid) {
      return new Response("Missing id parameter", {
        status: 400,
        headers: corsHeaders
      });
    }
    console.log("[DEBUG VERIFY] Requested UUID:", uuid);
    // 1️⃣ Buscar el certificado por ID
    const { data: cert, error: certError } = await supabase.from("certificates").select("*").eq("id", uuid).single();
    if (certError || !cert) {
      console.log("[DEBUG VERIFY] Certificate not found:", certError);
      return new Response("Certificate not found", {
        status: 404,
        headers: corsHeaders
      });
    }
    console.log("[DEBUG VERIFY] Certificate row:", cert);
    // 2️⃣ Chequear si está revocado o expirado
    const now = new Date();
    const issuedDate = new Date(cert.issued_date);
    const expirationDate = cert.expiration_date ? new Date(cert.expiration_date) : null;
    const revokedAt = cert.revoked_at ? new Date(cert.revoked_at) : null;
    if (cert.revoked || revokedAt || expirationDate && expirationDate < now) {
      const reason = cert.revoked ? "revoked" : revokedAt ? "revoked_at" : "expired";
      return new Response(JSON.stringify({
        valid: false,
        certificate: cert,
        reason: reason
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    // 3️⃣ Re-construir certData (ajustado para coincidir exactamente con emisión)
    // Fetch student
    const { data: student, error: studentError } = await supabase.from("profiles").select("first_name, last_name, email").eq("id", cert.student_id).single();
    if (studentError || !student) {
      console.log("[DEBUG VERIFY] Student not found:", studentError);
      return new Response("Student data not found", {
        status: 404,
        headers: corsHeaders
      });
    }
    // Fetch course
    const { data: course, error: courseError } = await supabase.from("courses").select("title, skills, professor_id").eq("id", cert.course_id).single();
    if (courseError || !course) {
      console.log("[DEBUG VERIFY] Course not found:", courseError);
      return new Response("Course data not found", {
        status: 404,
        headers: corsHeaders
      });
    }
    // 4️⃣ Reconstruir certData exacto — orden de keys idéntico a emisión, issued_at con medianoche
    const issuedAtString = new Date(cert.issued_date).toISOString(); // "2025-11-07T00:00:00.000Z" — coincide con emisión
    const reconstructedCertData = {
      student_id: cert.student_id,
      course_id: cert.course_id,
      student_name: `${student.first_name} ${student.last_name}`,
      student_email: student.email,
      course_name: course.title,
      skills: course.skills,
      issued_at: issuedAtString
    };
    console.log("[DEBUG VERIFY] Reconstructed certData:", reconstructedCertData);
    console.log("[DEBUG VERIFY] JSON string for hash:", JSON.stringify(reconstructedCertData));
    console.log("[DEBUG VERIFY] Professor ID match? Emission user (assumed):", "64a0f3ff-1026-426c-b9a7-13516c2696b4", "Course prof:", course.professor_id);
    // 5️⃣ Hash y verificar la firma
    const encoder = new TextEncoder();
    const certBytes = encoder.encode(JSON.stringify(reconstructedCertData));
    // Hash SHA-256 del data (para debug)
    const hashBuffer = await crypto.subtle.digest("SHA-256", certBytes);
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b)=>b.toString(16).padStart(2, '0')).join('');
    console.log("[DEBUG VERIFY] Data hash for signature:", hashHex.substring(0, 50) + "...");
    const publicKey = await crypto.subtle.importKey("spki", decodePEM(PUBLIC_KEY_PEM), {
      name: "RSA-PSS",
      hash: "SHA-256"
    }, false, [
      "verify"
    ]);
    const signatureBytes = Uint8Array.from(atob(cert.digital_signature), (c)=>c.charCodeAt(0));
    const validSignature = await crypto.subtle.verify({
      name: "RSA-PSS",
      saltLength: 32
    }, publicKey, signatureBytes, certBytes);
    console.log("[DEBUG VERIFY] Signature valid:", validSignature);
    // 6️⃣ Response final
    return new Response(JSON.stringify({
      valid: validSignature,
      certificate: {
        id: cert.id,
        readable_code: cert.readable_code,
        student_id: cert.student_id,
        course_id: cert.course_id,
        issued_date: cert.issued_date,
        ...reconstructedCertData
      },
      reason: !validSignature ? "Invalid signature or data mismatch (check logs for hash/prof match)" : null
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (err) {
    console.error("[verify-certificate]", err);
    return new Response("Internal Server Error", {
      status: 500,
      headers: corsHeaders
    });
  }
});
// Convierte PEM a ArrayBuffer (para public key)
function decodePEM(pem) {
  const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++)bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
