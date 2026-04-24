// Thin shim — `cn` lives in @persia/ui so admin + crm share the same
// implementation. Existing imports of `@/lib/utils` keep working without
// a fleet-wide codemod.
export { cn } from "@persia/ui/utils";
