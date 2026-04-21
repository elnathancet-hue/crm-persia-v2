-- Fix: Add FK from organization_members.user_id to profiles.id
-- Required for Supabase PostgREST to resolve the join
-- profiles(full_name, phone) in getTeamMembers() queries.
-- Without this FK, the join fails with PGRST200 because
-- PostgREST cannot infer the relationship through auth.users.

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id);
