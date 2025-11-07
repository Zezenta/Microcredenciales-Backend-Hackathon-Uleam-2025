


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."course_status" AS ENUM (
    'ACTIVE',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE "public"."course_status" OWNER TO "postgres";


CREATE TYPE "public"."enrollment_status" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'COMPLETED'
);


ALTER TYPE "public"."enrollment_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'STUDENT',
    'PROFESSOR',
    'ADMIN'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_professor_see_student"("p_prof" "uuid", "p_student" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.enrollments e
    join public.courses c on e.course_id = c.id
    where e.student_id = p_student
      and c.professor_id = p_prof
  );
$$;


ALTER FUNCTION "public"."can_professor_see_student"("p_prof" "uuid", "p_student" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email),
    '',
    '',
    'STUDENT'
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"("uid" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role = 'ADMIN'::user_role
  from public.profiles
  where id = uid;
$$;


ALTER FUNCTION "public"."is_admin"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_professor"("p_uid" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role = 'PROFESSOR'::user_role
  from public.profiles
  where id = p_uid;
$$;


ALTER FUNCTION "public"."is_professor"("p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_student_or_professor"("uid" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles
    where id = uid
      and role = any (array['STUDENT'::user_role, 'PROFESSOR'::user_role])
  );
$$;


ALTER FUNCTION "public"."is_student_or_professor"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."not_course_professor"("course_id" "uuid", "uid" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not exists (
    select 1
    from public.courses
    where id = course_id
      and professor_id = uid
  );
$$;


ALTER FUNCTION "public"."not_course_professor"("course_id" "uuid", "uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_role_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_user_role user_role;
begin
  -- Si no cambia el rol, permitir
  if new.role = old.role then
    return new;
  end if;

  -- Si no hay usuario autenticado (ej: operaciones internas), permitir
  if auth.uid() is null then
    return new;
  end if;

  -- Obtener el rol del usuario actual
  select role into current_user_role
  from public.profiles
  where id = auth.uid();

  -- Solo permitir cambios si el usuario actual es ADMIN
  if current_user_role != 'ADMIN'::user_role then
    raise exception 'Only administrators can change user roles.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_role_change"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."certificates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "readable_code" character varying,
    "student_id" "uuid" NOT NULL,
    "professor_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL,
    "digital_signature" "text" NOT NULL,
    "issued_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "expiration_date" "date",
    "revoked" boolean DEFAULT false NOT NULL,
    "revoked_at" timestamp with time zone,
    "revocation_reason" "text",
    "pdf_url" character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "check_revoked_fields" CHECK (((("revoked" = true) AND ("revoked_at" IS NOT NULL)) OR (("revoked" = false) AND ("revoked_at" IS NULL))))
);


ALTER TABLE "public"."certificates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" character varying NOT NULL,
    "description" "text" NOT NULL,
    "skills" character varying[] DEFAULT '{}'::character varying[] NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "max_students" integer,
    "professor_id" "uuid" NOT NULL,
    "status" "public"."course_status" DEFAULT 'ACTIVE'::"public"."course_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."enrollments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "status" "public"."enrollment_status" DEFAULT 'PENDING'::"public"."enrollment_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."enrollments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" character varying NOT NULL,
    "first_name" character varying NOT NULL,
    "last_name" character varying NOT NULL,
    "role" "public"."user_role" DEFAULT 'STUDENT'::"public"."user_role" NOT NULL,
    "birth_date" "date",
    "high_school" character varying,
    "soft_skills" "text"[],
    "avatar_url" character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_readable_code_key" UNIQUE ("readable_code");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_course_id_student_id_key" UNIQUE ("course_id", "student_id");



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



CREATE OR REPLACE TRIGGER "no_role_edit" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_role_change"();



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can manage all certificates" ON "public"."certificates" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"public"."user_role")))));



CREATE POLICY "Admins can manage all courses" ON "public"."courses" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can manage all enrollments" ON "public"."enrollments" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"public"."user_role")))));



CREATE POLICY "Admins can manage all profiles" ON "public"."profiles" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "All users can view active courses" ON "public"."courses" FOR SELECT TO "authenticated" USING (("status" = 'ACTIVE'::"public"."course_status"));



CREATE POLICY "Let everyone see professors" ON "public"."profiles" FOR SELECT USING (("role" = 'PROFESSOR'::"public"."user_role"));



CREATE POLICY "Let users update their own row" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Professors can create courses" ON "public"."courses" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_professor"("auth"."uid"()));



CREATE POLICY "Professors can issue certificates for their own courses" ON "public"."certificates" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."courses"
  WHERE (("courses"."id" = "certificates"."course_id") AND ("courses"."professor_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."enrollments"
  WHERE (("enrollments"."course_id" = "certificates"."course_id") AND ("enrollments"."student_id" = "certificates"."student_id") AND ("enrollments"."status" = 'COMPLETED'::"public"."enrollment_status"))))));



CREATE POLICY "Professors can manage enrollments for their courses" ON "public"."enrollments" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."courses"
  WHERE (("courses"."id" = "enrollments"."course_id") AND ("courses"."professor_id" = "auth"."uid"())))));



CREATE POLICY "Professors can manage their own courses" ON "public"."courses" TO "authenticated" USING (("professor_id" = "auth"."uid"())) WITH CHECK (("professor_id" = "auth"."uid"()));



CREATE POLICY "Professors can see their own students" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("public"."is_professor"("auth"."uid"()) AND "public"."can_professor_see_student"("auth"."uid"(), "id")));



CREATE POLICY "Professors can view certificates for their courses" ON "public"."certificates" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "certificates"."course_id") AND ("c"."professor_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Public can verify certificates by UUID" ON "public"."certificates" FOR SELECT USING (true);



CREATE POLICY "Students can enroll in courses" ON "public"."enrollments" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_student_or_professor"("auth"."uid"()) AND "public"."not_course_professor"("course_id", "auth"."uid"())));



CREATE POLICY "Students can view their certificates" ON "public"."certificates" FOR SELECT TO "authenticated" USING (("student_id" = "auth"."uid"()));



CREATE POLICY "Students can view their enrollments" ON "public"."enrollments" FOR SELECT TO "authenticated" USING (("student_id" = "auth"."uid"()));



CREATE POLICY "Users can see own profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."certificates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enrollments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."can_professor_see_student"("p_prof" "uuid", "p_student" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_professor_see_student"("p_prof" "uuid", "p_student" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_professor_see_student"("p_prof" "uuid", "p_student" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_professor"("p_uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_professor"("p_uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_professor"("p_uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_student_or_professor"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_student_or_professor"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_student_or_professor"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."not_course_professor"("course_id" "uuid", "uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."not_course_professor"("course_id" "uuid", "uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."not_course_professor"("course_id" "uuid", "uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_role_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_role_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_role_change"() TO "service_role";


















GRANT ALL ON TABLE "public"."certificates" TO "anon";
GRANT ALL ON TABLE "public"."certificates" TO "authenticated";
GRANT ALL ON TABLE "public"."certificates" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "anon";
GRANT ALL ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON TABLE "public"."enrollments" TO "anon";
GRANT ALL ON TABLE "public"."enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."enrollments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


