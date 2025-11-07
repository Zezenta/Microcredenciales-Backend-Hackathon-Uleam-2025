# Microcredenciales Backend para la Hackathon Uleam Tech Fest 2025

Este repositorio contiene las Edge Functions de Supabase desarrolladas para el sistema de microcredenciales digitales al que todavía no le hemos puesto nombre. Esperamos que para el deployment ya tenga nombre.

## Funciones

- **Certificate-Issuance**: Endpoint para la emisión de certificados digitales. Genera PDFs, los almacena en Supabase Storage y registra la firma digital del certificado usando una llave privada.

- **Verify-Certificate**: Endpoint público para verificar la autenticidad de certificados mediante código QR o UUID basándose en la llave pública.

## Desarrollo

Las funciones fueron desarrolladas usando Cursor y desplegadas mediante Supabase CLI.

## Estructura

```
supabase/
├── functions/
│   ├── Certificate-Issuance/
│   └── Verify-Certificate/
└── migrations/
```

## Pequeña Nota

Este repositorio fue creado principalmente para el desarrollo y despliegue de las Edge Functions. Las migraciones en `migrations/` pueden no estar completamente actualizadas debido a problemas que tuvimos al configurar Postgres con Docker durante el desarrollo. Mi querida Vivobook creo que no estaba muy lista para andar contenerizando cosas. El esquema de la base de datos se gestionó directamente en Supabase, así que las funciones son el foco principal de este repo.